import { isAbsolute, join, normalize } from 'node:path'
import { ProjectEnvironment } from '../domain/ports/project-environment.ts'
import { EnvironmentObservations } from '../domain/value-objects/environment-observations.ts'
import { EnvironmentConfiguration } from '../domain/value-objects/environment-configuration.ts'
import { EnvironmentService } from '../domain/value-objects/environment-service.ts'
import { EnvironmentContainer } from '../domain/value-objects/environment-container.ts'
import { WorkspaceMount } from '../domain/value-objects/workspace-mount.ts'
import type { InspectionBudget } from '../domain/value-objects/inspection-budget.ts'
import type { InspectionCommands } from './inspection-commands.ts'

class DockerReadings {
  static #record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  static #parse(text: string): unknown {
    try { return JSON.parse(text) } catch { return null }
  }

  static host(text: string): readonly string[] | null {
    const value = DockerReadings.#parse(text)
    if (!DockerReadings.#record(value) || typeof value.NCPU !== 'number' || typeof value.MemTotal !== 'number'
      || !Number.isFinite(value.NCPU) || value.NCPU <= 0 || !Number.isFinite(value.MemTotal) || value.MemTotal <= 0) return null
    return [`NCPU=${value.NCPU}`, `MemTotal=${value.MemTotal}`]
  }

  static configuration(text: string, limit: number): EnvironmentConfiguration | null {
    const value = DockerReadings.#parse(text)
    if (!DockerReadings.#record(value) || typeof value.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(value.name)
      || !DockerReadings.#record(value.services) || Object.keys(value.services).length === 0 || Object.keys(value.services).length > limit) return null
    const services: EnvironmentService[] = []
    for (const [name, service] of Object.entries(value.services)) {
      if (!DockerReadings.#record(service)) return null
      if (service.image !== undefined && typeof service.image !== 'string') return null
      if (service.cpus !== undefined && typeof service.cpus !== 'number' && typeof service.cpus !== 'string') return null
      if (service.mem_limit !== undefined && typeof service.mem_limit !== 'number' && typeof service.mem_limit !== 'string') return null
      if (service.build !== undefined && (!DockerReadings.#record(service.build) || typeof service.build.context !== 'string')) return null
      if (service.volumes !== undefined && !Array.isArray(service.volumes)) return null
      if (service.ports !== undefined && !Array.isArray(service.ports)) return null
      const mounts: WorkspaceMount[] = []
      let sharedVolumes = false
      for (const volume of service.volumes ?? []) {
        if (!DockerReadings.#record(volume) || typeof volume.type !== 'string' || typeof volume.target !== 'string') return null
        if (volume.type === 'bind') {
          if (typeof volume.source !== 'string') return null
          mounts.push(new WorkspaceMount(DockerReadings.#path(volume.source), DockerReadings.#path(volume.target)))
        }
        if (volume.type === 'volume' && typeof volume.source === 'string' && DockerReadings.#record(value.volumes)) {
          const declared = value.volumes[volume.source]
          if (DockerReadings.#record(declared)) sharedVolumes ||= declared.external === true
            || (typeof declared.name === 'string' && declared.name !== `${value.name}_${volume.source}`)
        }
      }
      const healthDependencies: string[] = []
      const startupDependencies: string[] = []
      if (service.depends_on !== undefined) {
        if (!DockerReadings.#record(service.depends_on)) return null
        for (const [dependency, condition] of Object.entries(service.depends_on)) {
          if (!DockerReadings.#record(condition) || typeof condition.condition !== 'string') return null
          if (condition.condition === 'service_healthy') healthDependencies.push(dependency)
          else startupDependencies.push(dependency)
        }
      }
      const limits = DockerReadings.#record(service.deploy) && DockerReadings.#record(service.deploy.resources)
        && DockerReadings.#record(service.deploy.resources.limits) ? service.deploy.resources.limits : {}
      const health = service.healthcheck
      const image = service.image ?? null
      const buildContext = DockerReadings.#record(service.build) && typeof service.build.context === 'string' ? DockerReadings.#path(service.build.context) : null
      services.push(new EnvironmentService({
        name, image, cpuLimited: DockerReadings.#positive(service.cpus ?? limits.cpus),
        memoryLimited: DockerReadings.#memory(service.mem_limit ?? limits.memory),
        healthcheck: DockerReadings.#record(health) && health.disable !== true && Array.isArray(health.test)
          && health.test.length > 0 && health.test.every((item) => typeof item === 'string') && health.test[0] !== 'NONE',
        database: image !== null && /(?:^|\/)(?:postgres|postgresql)(?::|@|$)/i.test(image) ? 'postgresql' : null,
        healthDependencies, startupDependencies, mounts, buildContext, sharedVolumes,
        publishedPorts: Array.isArray(service.ports) && service.ports.length > 0, fixedName: typeof service.container_name === 'string',
      }))
    }
    return new EnvironmentConfiguration(value.name, services)
  }

  static containers(text: string, count: number): readonly EnvironmentContainer[] | null {
    const values = DockerReadings.#parse(text)
    if (!Array.isArray(values) || values.length !== count) return null
    const containers: EnvironmentContainer[] = []
    for (const value of values) {
      if (!DockerReadings.#record(value) || !DockerReadings.#record(value.Config) || !DockerReadings.#record(value.Config.Labels)
        || !DockerReadings.#record(value.State) || typeof value.State.Status !== 'string' || !Array.isArray(value.Mounts)) return null
      const service = value.Config.Labels['com.docker.compose.service']
      if (typeof service !== 'string') return null
      const mounts: WorkspaceMount[] = []
      for (const mount of value.Mounts) {
        if (!DockerReadings.#record(mount) || typeof mount.Type !== 'string' || typeof mount.Source !== 'string' || typeof mount.Destination !== 'string') return null
        if (mount.Type === 'bind') mounts.push(new WorkspaceMount(DockerReadings.#path(mount.Source), DockerReadings.#path(mount.Destination)))
      }
      containers.push(new EnvironmentContainer({
        service, name: typeof value.Name === 'string' ? value.Name : service, running: value.State.Status === 'running', mounts,
        image: typeof value.Image === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.Image) ? value.Image : null,
      }))
    }
    return containers
  }

  static images(text: string, names: readonly string[]): ReadonlyMap<string, string> | null {
    const identities = text.trim().split('\n').map((line) => DockerReadings.#parse(line))
    if (identities.length !== names.length || !identities.every((id): id is string => typeof id === 'string' && /^sha256:[a-f0-9]{64}$/.test(id))) return null
    return new Map(names.map((name, index) => [name, identities[index]]))
  }

  static #positive(value: unknown): boolean {
    return (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) && Number(value) > 0
  }

  static #memory(value: unknown): boolean {
    return DockerReadings.#positive(value) || (typeof value === 'string' && /^[1-9]\d*(?:\.\d+)?[bkmg](?:i?b)?$/i.test(value))
  }

  static #path(value: string): string { return isAbsolute(value) ? normalize(value) : value }
}

export class DockerProjectEnvironment extends ProjectEnvironment {
  readonly #commands: InspectionCommands

  constructor(commands: InspectionCommands) { super(); this.#commands = commands }

  async observe(root: string, file: string, budget: InspectionBudget): Promise<EnvironmentObservations> {
    const data: ConstructorParameters<typeof EnvironmentObservations>[0] = {
      hostEvidence: null, configuration: null, containers: null, images: null,
    }
    const info = await this.#commands.ask('docker', ['info', '--format', '{{json .}}'], root, budget)
    data.hostEvidence = info.failed ? null : DockerReadings.host(info.stdout)
    if (data.hostEvidence === null) return new EnvironmentObservations(data)
    const configured = await this.#commands.ask('docker', ['compose', '-f', join(root, file), 'config', '--no-env-resolution', '--format', 'json'], root, budget)
    const configuration = configured.failed ? null : DockerReadings.configuration(configured.stdout, budget.limits.maxContainers)
    data.configuration = configuration
    if (configuration === null) return new EnvironmentObservations(data)
    const listed = await this.#commands.ask('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${configuration.name}`, '--format', '{{.ID}}'], root, budget)
    const ids = listed.stdout.split('\n').filter(Boolean)
    if (listed.failed || ids.length > budget.limits.maxContainers || ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) return new EnvironmentObservations(data)
    if (ids.length === 0) return new EnvironmentObservations({ ...data, containers: [] })
    const inspected = await this.#commands.ask('docker', ['inspect', ...ids], root, budget)
    data.containers = inspected.failed ? null : DockerReadings.containers(inspected.stdout, ids.length)
    if (data.containers === null) return new EnvironmentObservations(data)
    const names = configuration.imageNames
    if (!names.every((image): image is string => image !== null && /^[\w][\w./:@-]*$/.test(image))) return new EnvironmentObservations(data)
    const images = await this.#commands.ask('docker', ['image', 'inspect', '--format', '{{json .Id}}', ...names], root, budget)
    data.images = images.failed ? null : DockerReadings.images(images.stdout, names)
    return new EnvironmentObservations(data)
  }
}
