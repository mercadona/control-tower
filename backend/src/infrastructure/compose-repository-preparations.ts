import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { RepositoryPreparations } from '../domain/ports/repository-preparations.ts'
import type { PreparationTarget, PreparationWorkspace } from '../domain/ports/repository-preparations.ts'
import { PreparationFinding, PreparationState, RepositoryPreparation } from '../domain/value-objects/repository-preparation.ts'
import type { PreparationStateValue } from '../domain/value-objects/repository-preparation.ts'
import type { ToolLaunch } from './external-tool.ts'

type FileAccess = {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, text: string, options: { encoding: 'utf8', flag: 'wx' }): Promise<unknown>
}

class ConfigurationNotChecked extends Error {}

class ComposeSource {
  readonly path: string
  readonly services: readonly string[]
  readonly conflicts: readonly PreparationFinding[]

  constructor(path: string, services: readonly string[], conflicts: readonly PreparationFinding[]) {
    this.path = path
    this.services = services
    this.conflicts = conflicts
  }

  get override(): string {
    return `${dirname(this.path)}/docker-compose.local.yml`.replace(/^\.\//, '')
  }

  static from(path: string, text: string): ComposeSource {
    const document = parseDocument(text)
    if (document.errors.length !== 0) throw new ConfigurationNotChecked(`${path}: invalid Compose YAML`)
    let data: unknown
    try { data = document.toJS() } catch { throw new ConfigurationNotChecked(`${path}: Compose YAML could not be expanded`) }
    if (!ComposeSource.isRecord(data) || !ComposeSource.isRecord(data.services) || Object.keys(data.services).length === 0) {
      throw new ConfigurationNotChecked(`${path}: no readable services`)
    }
    if (data.include !== undefined) throw new ConfigurationNotChecked(`${path}: Compose includes need explicit review`)
    const conflicts: PreparationFinding[] = []
    for (const [name, service] of Object.entries(data.services)) {
      if (!ComposeSource.isRecord(service) || service.extends !== undefined || service.network_mode === 'host') {
        throw new ConfigurationNotChecked(`${path}: service ${name} cannot be checked for isolation`)
      }
      if (service.container_name !== undefined) conflicts.push(new PreparationFinding({
        path, reason: `Service ${name} declares a container_name outside Compose project scoping.`,
        correction: 'Remove container_name so Compose can name the container per worktree.',
      }))
    }
    for (const collection of ['volumes', 'networks']) {
      const resources = data[collection]
      if (resources === undefined) continue
      if (!ComposeSource.isRecord(resources)) throw new ConfigurationNotChecked(`${path}: unreadable ${collection}`)
      for (const [name, resource] of Object.entries(resources)) {
        if (resource === null) continue
        if (!ComposeSource.isRecord(resource)) throw new ConfigurationNotChecked(`${path}: unreadable ${collection}/${name}`)
        if (resource.external || resource.name !== undefined) conflicts.push(new PreparationFinding({
          path, reason: `${collection}/${name} has an external or explicit resource name.`,
          correction: 'Use a project-scoped resource for parallel tests instead of a shared named resource.',
        }))
      }
    }
    return new ComposeSource(path, Object.keys(data.services), conflicts)
  }

  static isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  compatibleMakefile(makefile: string): PreparationFinding[] {
    const lines = makefile.split('\n').filter((line) => !line.trimStart().startsWith('#'))
    const command = lines.filter((line) => /docker(?:\s+compose|-compose)|\$\(DOCKER_COMMAND\)/.test(line)).join('\n')
    if (/(?:\s-p(?:\s|=)|--project-name(?:\s|=))/.test(command)) {
      return [new PreparationFinding({
        path: 'Makefile', reason: 'The Compose invocation forces a project name shared by worktrees.',
        correction: 'Remove -p/--project-name and let Compose read the per-worktree local override.',
      })]
    }
    const expectedBase = `DOCKER_COMPOSE_FILE := $(ROOT_FOLDER)/${this.path}`
    const expectedOverride = `DOCKER_COMPOSE_OVERRIDE_FILE := $(ROOT_FOLDER)/${this.override}`
    const supported = lines.includes(expectedBase) && lines.includes(expectedOverride)
      && lines.includes('DOCKER_COMMAND := docker compose -f $(DOCKER_COMPOSE_FILE)')
      && lines.includes('DOCKER_COMMAND := $(DOCKER_COMMAND) -f $(DOCKER_COMPOSE_OVERRIDE_FILE)')
      && lines.includes('ifneq ("$(wildcard $(DOCKER_COMPOSE_OVERRIDE_FILE))","")')
      && !lines.some((line) => /^\s*(-?include|sinclude|override|export\s+COMPOSE_)\b/.test(line))
      && lines.filter((line) => /^DOCKER_COMMAND\s*[:?+]?=/.test(line)).length === 2
    if (!supported) {
      throw new ConfigurationNotChecked('Makefile: the Compose command cannot be resolved safely. Use the standard DOCKER_COMPOSE_FILE and optional DOCKER_COMPOSE_OVERRIDE_FILE pattern, or review this invocation explicitly.')
    }
    return [...this.conflicts]
  }

  overrideText(name: string): string {
    return `name: ${name}\nservices:\n` + this.services.map((service) =>
      `  ${JSON.stringify(service)}:\n    ports: !reset []\n`
    ).join('')
  }

  checkEffective(raw: string, expectedName: string, worktree: string): PreparationFinding[] {
    let config: unknown
    try { config = JSON.parse(raw) } catch { throw new ConfigurationNotChecked('Compose returned unreadable configuration') }
    if (!ComposeSource.isRecord(config) || !ComposeSource.isRecord(config.services) || typeof config.name !== 'string') {
      throw new ConfigurationNotChecked('Compose returned an unexpected configuration shape')
    }
    const findings: PreparationFinding[] = []
    const add = (reason: string, correction: string): void => {
      findings.push(new PreparationFinding({ path: this.override, reason, correction }))
    }
    if (config.name !== expectedName) add('The project name differs from the worktree-specific name reserved by Control Tower.', `Set name: ${expectedName}.`)
    for (const [name, service] of Object.entries(config.services)) {
      if (!ComposeSource.isRecord(service)) throw new ConfigurationNotChecked(`Compose service ${name} is unreadable`)
      if (service.container_name !== undefined || service.network_mode === 'host') {
        add(`Service ${name} shares a container name or the host network.`, 'Remove the fixed container_name or host network mode.')
      }
      if (service.ports !== undefined && !Array.isArray(service.ports)) throw new ConfigurationNotChecked(`Compose ports for ${name} are unreadable`)
      if (Array.isArray(service.ports) && service.ports.length > 0) {
        add(`Service ${name} publishes host ports.`, 'Remove published ports in this tests-only override with ports: !reset [].')
      }
      if (service.volumes !== undefined && !Array.isArray(service.volumes)) throw new ConfigurationNotChecked(`Compose mounts for ${name} are unreadable`)
      for (const volume of Array.isArray(service.volumes) ? service.volumes : []) {
        if (!ComposeSource.isRecord(volume)) throw new ConfigurationNotChecked(`Compose mount for ${name} is unreadable`)
        if (volume.type === 'bind' && volume.target === '/app' && volume.source !== worktree) {
          add(`Service ${name} mounts another checkout at /app.`, 'Point the application bind mount at this worktree.')
        }
      }
    }
    for (const collection of ['volumes', 'networks']) {
      const resources = config[collection]
      if (resources === undefined) continue
      if (!ComposeSource.isRecord(resources)) throw new ConfigurationNotChecked(`Compose ${collection} are unreadable`)
      for (const [key, value] of Object.entries(resources)) {
        if (!ComposeSource.isRecord(value) || typeof value.name !== 'string') throw new ConfigurationNotChecked(`Compose ${collection}/${key} has no name`)
        if (value.external === true || !value.name.startsWith(`${expectedName}_`)) {
          add(`${collection}/${key} is shared with other projects.`, 'Use a project-scoped resource instead of external or fixed-name resources.')
        }
      }
    }
    return findings
  }
}

export class ComposeRepositoryPreparations extends RepositoryPreparations {
  readonly git: ToolLaunch
  readonly docker: ToolLaunch
  readonly files: FileAccess

  constructor(ports: { git: ToolLaunch, docker: ToolLaunch, files: FileAccess }) {
    super()
    this.git = ports.git
    this.docker = ports.docker
    this.files = ports.files
  }

  override async inspect(asked: PreparationTarget): Promise<RepositoryPreparation> {
    let revision: string | null = null
    try {
      const remote = await this.#git(asked.root.text, ['ls-remote', '--symref', 'origin', 'HEAD'])
      revision = remote.match(/^([a-f0-9]{40})\s+HEAD$/m)?.[1] ?? null
      if (revision === null) throw new ConfigurationNotChecked('origin HEAD did not name a commit')
      await this.#git(asked.root.text, ['fetch', '--quiet', '--no-tags', 'origin', revision])
      const source = await this.#source(asked.root.text, revision)
      if (source === null) return this.#result(asked, revision, PreparationState.NOT_APPLICABLE, [])
      const findings = source.compatibleMakefile(await this.#git(asked.root.text, ['show', `${revision}:Makefile`]))
      return this.#result(asked, revision, findings.length ? PreparationState.REQUIRED : PreparationState.COMPATIBLE, findings)
    } catch (error) {
      if (!(error instanceof ConfigurationNotChecked)) throw error
      return this.#unreadable(asked, revision, error)
    }
  }

  override async prepare(asked: PreparationWorkspace): Promise<RepositoryPreparation> {
    let revision: string | null = null
    try {
      revision = (await this.#git(asked.path, ['rev-parse', 'HEAD'])).trim()
      if (!/^[a-f0-9]{40}$/.test(revision)) throw new ConfigurationNotChecked('the worktree did not name a commit')
      const source = await this.#source(asked.path, revision)
      if (source === null) return this.#result(asked, revision, PreparationState.NOT_APPLICABLE, [])
      await this.#git(asked.path, ['diff', '--exit-code', revision, '--', 'Makefile', source.path])
      const findings = source.compatibleMakefile(await this.#git(asked.path, ['show', `${revision}:Makefile`]))
      if (findings.length) return this.#result(asked, revision, PreparationState.REQUIRED, findings)
      const name = `ct-${createHash('sha256').update(resolve(asked.path)).digest('hex').slice(0, 16)}`
      await this.#git(asked.path, ['check-ignore', '--quiet', '--', source.override])
      const destination = join(asked.path, source.override)
      try {
        await this.files.readFile(destination, 'utf8')
      } catch (error) {
        if (!ComposeRepositoryPreparations.#missing(error)) throw new ConfigurationNotChecked(`${source.override}: could not read the local override`)
        try {
          await this.files.writeFile(destination, source.overrideText(name), { encoding: 'utf8', flag: 'wx' })
        } catch {
          throw new ConfigurationNotChecked(`${source.override}: could not create the local override without overwriting a file`)
        }
      }
      const effective = await this.docker(['compose', '-f', join(asked.path, source.path), '-f', destination,
        'config', '--no-env-resolution', '--format', 'json'])
      if (effective.failed) throw new ConfigurationNotChecked(`Compose configuration could not be checked: ${effective.stderr.trim()}. Verify Docker Compose supports config --no-env-resolution and !reset, and that interpolation variables are set.`)
      const problems = source.checkEffective(effective.stdout, name, asked.path)
      return this.#result(asked, revision, problems.length ? PreparationState.REQUIRED : PreparationState.COMPATIBLE, problems)
    } catch (error) {
      if (!(error instanceof ConfigurationNotChecked)) throw error
      return this.#unreadable(asked, revision, error)
    }
  }

  async #source(root: string, revision: string): Promise<ComposeSource | null> {
    const tree = (await this.#git(root, ['ls-tree', '-r', '--name-only', revision])).split('\n')
    const names = tree.filter((path) => /^(docker\/)?(docker-)?compose\.ya?ml$/.test(path))
    if (names.length === 0) {
      if (tree.some((path) => /^(docker\/)?(docker-)?compose[^/]*\.ya?ml$/.test(path))) {
        throw new ConfigurationNotChecked('Compose files were found but no supported base configuration could be identified')
      }
      if (tree.includes('Makefile')) {
        const makefile = await this.#git(root, ['show', `${revision}:Makefile`])
        if (/docker(?:\s+compose|-compose)/.test(makefile)) throw new ConfigurationNotChecked('Makefile invokes Compose but its configuration could not be located')
      }
      return null
    }
    if (names.length !== 1) throw new ConfigurationNotChecked('Multiple Compose base files need explicit review')
    return ComposeSource.from(names[0], await this.#git(root, ['show', `${revision}:${names[0]}`]))
  }

  async #git(root: string, args: string[]): Promise<string> {
    const output = await this.git(['-C', root, ...args])
    if (output.failed) throw new ConfigurationNotChecked(`git ${args[0]} could not complete the preparation check (${output.stderr.trim()})`)
    return output.stdout
  }

  #unreadable(asked: PreparationTarget, revision: string | null, error: Error): RepositoryPreparation {
    return this.#result(asked, revision, PreparationState.NOT_CHECKED, [new PreparationFinding({
      path: asked.root.text, reason: error.message,
      correction: 'Resolve the configuration or tool error and check again; this result does not authorize dispatch.',
    })])
  }

  #result(asked: PreparationTarget & { path?: string }, revision: string | null, state: PreparationStateValue, findings: PreparationFinding[]): RepositoryPreparation {
    const summary = `${asked.repository.text} at ${revision ?? 'unread revision'} (${asked.path ?? asked.root.text}): ${state}.\n`
      + findings.map((finding) => `${finding.path}: ${finding.reason}\nCorrection: ${finding.correction}`).join('\n')
    return new RepositoryPreparation({ revision, state, findings, summary })
  }

  static #missing(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
  }
}
