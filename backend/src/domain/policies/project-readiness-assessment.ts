import { ProjectReadiness } from '../value-objects/project-readiness.ts'
import { ReadinessFinding } from '../value-objects/readiness-finding.ts'
import type { ReadinessAction, ReadinessId, ReadinessStatus } from '../value-objects/readiness-finding.ts'
import type { PlanTarget } from '../value-objects/plan-target.ts'
import type { RepositoryIdentity } from '../value-objects/repository-identity.ts'
import { RepositoryObservations } from '../value-objects/repository-observations.ts'
import type { EnvironmentObservations } from '../value-objects/environment-observations.ts'
import type { EnvironmentConfiguration } from '../value-objects/environment-configuration.ts'
import { WorkspaceMount } from '../value-objects/workspace-mount.ts'

export class ProjectReadinessAssessment {
  identity(target: PlanTarget, identity: RepositoryIdentity): ReadinessFinding {
    const status = identity.name === null ? 'unverified' : identity.name === target.repository.text ? 'ready' : 'changes-required'
    return this.#finding('checkout', status, identity.evidence, status === 'ready' ? null : 'confirm-checkout')
  }

  repository(observed: RepositoryObservations): readonly ReadinessFinding[] {
    if (observed.baseRevision === null) return [this.#finding('base', 'unverified', ['origin/HEAD'], 'update-checkout')]
    const findings = [this.#finding('base', 'ready', [observed.baseReference!, observed.baseRevision], null)]
    const missing = observed.missingCommands
    findings.push(this.#finding('commands', !observed.commandsKnown ? 'unverified' : missing.length ? 'changes-required' : 'ready',
      missing.length ? missing : ['build', 'test', 'lint'], !observed.commandsKnown ? 'retry-inspection' : missing.length ? 'declare-commands' : null))
    const conventions = observed.conventionState
    findings.push(this.#finding('conventions', conventions === 'complete' ? 'ready' : conventions === 'incomplete' ? 'changes-required' : 'unverified',
      observed.conventionPaths.length ? observed.conventionPaths : ['.agent/conventions.md'],
      conventions === 'complete' ? null : conventions === 'incomplete' ? 'declare-conventions' : 'retry-inspection'))
    findings.push(this.#finding('test-workers', observed.workerCount === null ? 'unverified' : observed.workerCount === 'automatic' ? 'changes-required' : 'ready',
      observed.workerEvidence, observed.workerCount === null ? 'inspect-command' : observed.workerCount === 'automatic' ? 'limit-workers' : null))
    const drift = observed.changedPaths
    findings.push(this.#finding('checkout-drift', drift === null ? 'unverified' : drift.length ? 'changes-required' : 'ready',
      drift ?? ['git diff'], drift === null ? 'retry-inspection' : drift.length ? 'update-checkout' : null))
    const ignored = observed.ignoredPaths
    const matches = ignored !== null && RepositoryObservations.RUNTIME_PATHS.every((path) => ignored.includes(path))
      && !ignored.includes(RepositoryObservations.PLAN_PATH)
    findings.push(this.#finding('git-ignore', ignored === null ? 'unverified' : matches ? 'ready' : 'changes-required',
      ignored ?? [], ignored === null ? 'retry-inspection' : matches ? null : 'fix-ignore'))
    if (observed.environmentFile === null) findings.push(this.#finding('compose', 'unverified', observed.composeFiles ?? [], 'declare-compose'))
    return findings
  }

  environment(root: string, file: string, observed: EnvironmentObservations): readonly ReadinessFinding[] {
    if (observed.hostEvidence === null) return [this.#finding('docker', 'unverified', ['docker info'], 'start-docker')]
    const findings = [this.#finding('docker', 'ready', observed.hostEvidence, null)]
    const configuration = observed.configuration
    if (configuration === null) return [...findings, this.#finding('compose', 'unverified', [file], 'review-compose')]
    findings.push(this.#finding('compose', 'ready', [file, configuration.name], null))
    findings.push(...this.#services(root, configuration), ...this.#instances(configuration, observed))
    return findings
  }

  execution(): ReadinessFinding { return this.#finding('execution', 'unverified', [], 'verify-execution') }

  busy(target: PlanTarget, observedAt: number): ProjectReadiness {
    return new ProjectReadiness({
      repository: target.repository.text, root: target.root.text, baseRevision: null, observedAt,
      findings: [this.#finding('inspection', 'unverified', [], 'retry-inspection')],
    })
  }

  #services(root: string, configuration: EnvironmentConfiguration): readonly ReadinessFinding[] {
    const services = configuration.services
    const unbounded = services.filter((service) => !service.cpuLimited || !service.memoryLimited).map((service) => service.name)
    const databases = services.filter((service) => service.database === 'postgresql')
    const unready = databases.filter((database) => !database.healthcheck
      || !services.some((service) => service.healthDependencies.includes(database.name))
      || services.some((service) => service.startupDependencies.includes(database.name))).map((service) => service.name)
    const shared = services.filter((service) => service.publishedPorts || service.fixedName || service.sharedVolumes
      || service.mounts.some((mount) => !WorkspaceMount.contains(root, mount.source))).map((service) => service.name)
    const builds = services.filter((service) => service.buildContext !== null)
    const externalBuilds = builds.filter((service) => !WorkspaceMount.contains(root, service.buildContext!))
    return [
      this.#finding('container-resources', unbounded.length ? 'changes-required' : 'ready', unbounded, unbounded.length ? 'limit-resources' : null),
      this.#finding('database-readiness', !databases.length ? 'unverified' : unready.length ? 'changes-required' : 'ready',
        unready, !databases.length ? 'review-compose' : unready.length ? 'wait-for-database' : null),
      this.#finding('worktree-config', shared.length ? 'changes-required' : 'unverified', shared, 'isolate-worktrees'),
      this.#finding('build-context', externalBuilds.length ? 'changes-required' : builds.length ? 'ready' : 'unverified',
        builds.map((service) => `${service.name}:${service.buildContext}`), externalBuilds.length || !builds.length ? 'verify-dependencies' : null),
    ]
  }

  #instances(configuration: EnvironmentConfiguration, observed: EnvironmentObservations): readonly ReadinessFinding[] {
    const containers = observed.containers
    if (containers === null) return [this.#finding('container-mounts', 'unverified', [configuration.name], 'retry-inspection')]
    if (containers.length === 0) return [this.#finding('container-mounts', 'unverified', [configuration.name], 'recreate-environment')]
    const mounts: string[] = []
    const images: string[] = []
    const servicesSeen = new Set<string>()
    let running = true
    let imagesKnown = observed.imagesKnown && configuration.imageNames.every((image) => image !== null)
    for (const container of containers) {
      const service = configuration.services.find((candidate) => candidate.name === container.service)
      if (service === undefined) return [this.#finding('container-mounts', 'unverified', [configuration.name], 'review-compose')]
      servicesSeen.add(service.name)
      running &&= container.running
      for (const expected of service.mounts) {
        if (!container.mounts.some((mount) => mount.matches(expected))) mounts.push(`- ${service.name}:${expected.source} -> ${expected.target}`)
      }
      for (const actual of container.mounts) {
        if (!service.mounts.some((mount) => mount.matches(actual))) mounts.push(`+ ${service.name}:${actual.source} -> ${actual.target}`)
      }
      const expectedImage = service.image === null ? null : observed.imageIdentity(service.image)
      if (container.image === null || expectedImage === null) imagesKnown = false
      else if (container.image !== expectedImage) images.push(`${container.name}:${container.image}`)
    }
    const complete = configuration.services.every((service) => servicesSeen.has(service.name))
    return [
      this.#finding('container-mounts', mounts.length ? 'changes-required' : running && complete ? 'ready' : 'unverified',
        mounts.length ? mounts : [configuration.name], mounts.length || !running || !complete ? 'recreate-environment' : null),
      this.#finding('image-provenance', !imagesKnown ? 'unverified' : images.length ? 'changes-required' : complete ? 'ready' : 'unverified',
        imagesKnown && images.length ? images : [configuration.name],
        !imagesKnown ? 'verify-dependencies' : images.length ? 'recreate-environment' : complete ? null : 'verify-dependencies'),
    ]
  }

  #finding(id: ReadinessId, status: ReadinessStatus, evidence: readonly string[], action: ReadinessAction | null): ReadinessFinding {
    return new ReadinessFinding({ id, status, evidence, action })
  }
}
