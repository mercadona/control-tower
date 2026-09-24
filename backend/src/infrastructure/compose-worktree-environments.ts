import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { parse } from 'shell-quote'
import { WorktreeEnvironments } from '../domain/ports/worktree-environments.ts'
import type { PreparationTarget, PreparationWorkspace } from '../domain/ports/worktree-environments.ts'
import { PreparationFinding, PreparationState, RepositoryPreparation } from '../domain/value-objects/repository-preparation.ts'
import type { PreparationStateValue } from '../domain/value-objects/repository-preparation.ts'
import type { ToolLaunch } from './external-tool.ts'
import type { ProcessOutput } from './tool-runner.ts'

type FileAccess = {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, text: string, options: { encoding: 'utf8', flag: 'wx' }): Promise<unknown>
}

class ConfigurationNotChecked extends Error {}

export class ComposeWorktreeEnvironments extends WorktreeEnvironments {
  readonly git: ToolLaunch
  readonly make: ToolLaunch
  readonly docker: (argv: string[], cwd: string) => Promise<ProcessOutput>
  readonly files: FileAccess

  constructor(ports: {
    git: ToolLaunch, make: ToolLaunch,
    docker: (argv: string[], cwd: string) => Promise<ProcessOutput>, files: FileAccess,
  }) {
    super()
    this.git = ports.git
    this.make = ports.make
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
      const makefile = await this.#git(asked.root.text, ['show', `${revision}:Makefile`])
      const invocation = makefile.split('\n').filter((line) =>
        !line.trimStart().startsWith('#') && /docker(?:\s+compose|-compose)|\$\(DOCKER_COMMAND\)/.test(line)
      ).join('\n')
      const findings = /(?:\s-p(?:\s|=)|--project-name(?:\s|=))/.test(invocation)
        ? [new PreparationFinding({ path: 'Makefile',
          reason: 'The Compose invocation overrides the per-worktree project name.',
          correction: 'Remove -p/--project-name so the local Compose override can select the worktree project.',
        })] : []
      return this.#result(asked, revision, findings.length ? PreparationState.REQUIRED : PreparationState.COMPATIBLE, findings)
    } catch (error) {
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
      await this.#git(asked.path, ['diff', '--exit-code', revision, '--', 'Makefile', source])
      const worktree = (await this.#git(asked.path, ['rev-parse', '--show-toplevel'])).trim()
      if (!worktree.startsWith('/')) throw new ConfigurationNotChecked('Git did not resolve the worktree directory')
      const override = join(dirname(source), 'docker-compose.local.yml')
      await this.#git(asked.path, ['check-ignore', '--quiet', '--', override])
      const name = `ct-${createHash('sha256').update(worktree).digest('hex').slice(0, 16)}`
      const destination = join(asked.path, override)
      try {
        await this.files.readFile(destination, 'utf8')
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
          throw new ConfigurationNotChecked(`${override}: could not read the local override`)
        }
        const base = await this.#config(['compose', '-f', join(asked.path, source)], asked.path)
        const ports = Object.entries(base.services).filter(([, service]) =>
          ComposeWorktreeEnvironments.#record(service) && Array.isArray(service.ports) && service.ports.length > 0
        ).map(([service]) => `  ${JSON.stringify(service)}:\n    ports: !reset []\n`).join('')
        try {
          await this.files.writeFile(destination, `name: ${name}\n${ports ? `services:\n${ports}` : ''}`, { encoding: 'utf8', flag: 'wx' })
        } catch {
          throw new ConfigurationNotChecked(`${override}: could not create the local override without overwriting a file`)
        }
      }
      const expanded = await this.make(['-C', asked.path, '--no-print-directory', '-qp'])
      if (expanded.code !== 0 && expanded.code !== 1) throw new ConfigurationNotChecked('Make could not resolve DOCKER_COMMAND')
      const command = expanded.stdout.match(/^DOCKER_COMMAND\s*:=\s*(.+)$/m)?.[1]
      if (command === undefined) throw new ConfigurationNotChecked('Make did not provide an expanded DOCKER_COMMAND; this environment has not been checked')
      const effective = await this.#config(ComposeWorktreeEnvironments.#composeArguments(command), asked.path)
      const findings: PreparationFinding[] = []
      if (effective.name !== name) findings.push(new PreparationFinding({ path: 'Makefile',
        reason: 'The resolved Compose command does not select this worktree project.',
        correction: `Load ${override} without overriding its project name (${name}).`,
      }))
      let mounted = false
      for (const [serviceName, service] of Object.entries(effective.services)) {
        if (!ComposeWorktreeEnvironments.#record(service)) throw new ConfigurationNotChecked('Compose returned an unreadable service')
        for (const port of Array.isArray(service.ports) ? service.ports : []) {
          if (!ComposeWorktreeEnvironments.#record(port)) throw new ConfigurationNotChecked('Compose returned an unreadable port')
          if (port.published === undefined || port.published === '') continue
          findings.push(new PreparationFinding({ path: override,
            reason: `Service ${serviceName} publishes host port ${String(port.published)}, which another worktree can also claim.`,
            correction: `Reset its ports in ${override} (ports: !reset []) or publish no fixed host port.`,
          }))
        }
        for (const volume of Array.isArray(service.volumes) ? service.volumes : []) {
          if (!ComposeWorktreeEnvironments.#record(volume) || volume.target !== '/app') continue
          mounted = true
          if (volume.type !== 'bind' || volume.source !== worktree) findings.push(new PreparationFinding({ path: source,
            reason: 'The application at /app is not mounted from this worktree.',
            correction: `Mount ${asked.path} at /app before running this slice's tests.`,
          }))
        }
      }
      if (!mounted) throw new ConfigurationNotChecked('No /app mount was found; this environment has not been checked')
      return this.#result(asked, revision, findings.length ? PreparationState.REQUIRED : PreparationState.COMPATIBLE, findings)
    } catch (error) {
      return this.#unreadable(asked, revision, error)
    }
  }

  static #composeArguments(command: string): string[] {
    const parts = parse(command, () => { throw new ConfigurationNotChecked('DOCKER_COMMAND contains unresolved shell variables') })
    if (!parts.every((part): part is string => typeof part === 'string') || parts[0] !== 'docker' || parts[1] !== 'compose') {
      throw new ConfigurationNotChecked('DOCKER_COMMAND is not a direct docker compose invocation')
    }
    for (let index = 2; index < parts.length; index += 2) {
      if (!['-f', '--file', '-p', '--project-name'].includes(parts[index]) || !parts[index + 1] || parts[index + 1].startsWith('-')) {
        throw new ConfigurationNotChecked('DOCKER_COMMAND contains options this check does not resolve')
      }
    }
    return parts.slice(1)
  }

  async #config(argv: string[], cwd: string): Promise<{ name: string, services: Record<string, unknown> }> {
    const output = await this.docker([...argv, 'config', '--no-env-resolution', '--format', 'json'], cwd)
    if (output.failed) throw new ConfigurationNotChecked(`Compose could not read the configuration: ${output.stderr.trim()}`)
    let config: unknown
    try { config = JSON.parse(output.stdout) } catch { throw new ConfigurationNotChecked('Compose returned unreadable configuration') }
    if (!ComposeWorktreeEnvironments.#record(config) || typeof config.name !== 'string' || !ComposeWorktreeEnvironments.#record(config.services)) {
      throw new ConfigurationNotChecked('Compose returned an unexpected configuration shape')
    }
    return { name: config.name, services: config.services }
  }

  async #source(root: string, revision: string): Promise<string | null> {
    const tree = (await this.#git(root, ['ls-tree', '-r', '--name-only', revision])).split('\n')
    const names = tree.filter((path) => /^(docker\/)?(docker-)?compose\.ya?ml$/.test(path))
    if (names.length > 1) throw new ConfigurationNotChecked('The Compose base configuration is ambiguous')
    return names[0] ?? null
  }

  async #git(root: string, args: string[]): Promise<string> {
    const output = await this.git(['-C', root, ...args])
    if (output.failed) throw new ConfigurationNotChecked(`git ${args[0]} could not complete the preparation check (${output.stderr.trim()})`)
    return output.stdout
  }

  #unreadable(asked: PreparationTarget, revision: string | null, error: unknown): RepositoryPreparation {
    if (!(error instanceof ConfigurationNotChecked)) throw error
    return this.#result(asked, revision, PreparationState.NOT_CHECKED, [new PreparationFinding({
      path: asked.root.text, reason: error.message,
      correction: 'Resolve the reported error and check again; this result does not authorize dispatch.',
    })])
  }

  #result(asked: PreparationTarget & { path?: string }, revision: string | null, state: PreparationStateValue, findings: PreparationFinding[]): RepositoryPreparation {
    const summary = `${asked.repository.text} at ${revision ?? 'unread revision'} (${asked.path ?? asked.root.text}): ${state}.\n`
      + findings.map((finding) => `${finding.path}: ${finding.reason}\nCorrection: ${finding.correction}`).join('\n')
    return new RepositoryPreparation({ revision, state, findings, summary })
  }

  static #record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
}
