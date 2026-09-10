import { isAbsolute, join, relative } from 'node:path'
import { TestCommandDeclaration } from '../../../plugin/scripts/baseline.js'
import { ProjectSetup } from '../domain/ports/project-setup.ts'
import { ProjectReadiness } from '../domain/value-objects/project-readiness.ts'
import { ReadinessFinding } from '../domain/value-objects/readiness-finding.ts'
import type { ReadinessStatus } from '../domain/value-objects/readiness-finding.ts'
import type { PlanTarget } from '../domain/value-objects/plan-target.ts'
import { ProcessOutput } from './tool-runner.ts'

export type InspectionCommand = (
  bin: string, argv: string[], cwd: string, budgetMs: number,
) => Promise<ProcessOutput>

type InspectionOptions = {
  run: InspectionCommand, now: () => number, budgetMs: number, commandBudgetMs: number,
  maxFiles: number, maxContainers: number,
}

class InspectionJson {
  static record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  static parse(text: string): unknown {
    try { return JSON.parse(text) } catch { return null }
  }
}

type BindMount = { source: string, target: string }
type ServiceSetup = {
  name: string, image: string, bounded: boolean, healthy: boolean,
  dependencies: readonly string[], binds: readonly BindMount[], sharedNames: boolean,
  buildContext: string | null,
  startupDependencies: readonly string[],
}

class ComposeSetup {
  readonly name: string
  readonly services: readonly ServiceSetup[]

  constructor(name: string, services: ServiceSetup[]) {
    this.name = name
    this.services = services
  }

  static from(value: unknown): ComposeSetup | null {
    if (!InspectionJson.record(value) || typeof value.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(value.name)) return null
    if (!InspectionJson.record(value.services) || Object.keys(value.services).length === 0) return null
    const services: ServiceSetup[] = []
    for (const [name, service] of Object.entries(value.services)) {
      if (!InspectionJson.record(service)) return null
      if (service.image !== undefined && typeof service.image !== 'string') return null
      if (service.cpus !== undefined && typeof service.cpus !== 'number' && typeof service.cpus !== 'string') return null
      if (service.mem_limit !== undefined && typeof service.mem_limit !== 'number' && typeof service.mem_limit !== 'string') return null
      if (service.build !== undefined && (!InspectionJson.record(service.build) || typeof service.build.context !== 'string')) return null
      const buildContext = InspectionJson.record(service.build) && typeof service.build.context === 'string' ? service.build.context : null
      if (service.volumes !== undefined && !Array.isArray(service.volumes)) return null
      if (service.ports !== undefined && !Array.isArray(service.ports)) return null
      const binds: BindMount[] = []
      let sharedNames = typeof service.container_name === 'string' || (Array.isArray(service.ports) && service.ports.length > 0)
      for (const volume of service.volumes ?? []) {
        if (!InspectionJson.record(volume) || typeof volume.type !== 'string' || typeof volume.target !== 'string') return null
        if (volume.type === 'bind') {
          if (typeof volume.source !== 'string') return null
          binds.push({ source: volume.source, target: volume.target })
        }
        if (volume.type === 'volume' && typeof volume.source === 'string' && InspectionJson.record(value.volumes)) {
          const declared = value.volumes[volume.source]
          if (InspectionJson.record(declared)) {
            sharedNames ||= declared.external === true || (typeof declared.name === 'string' && declared.name !== `${value.name}_${volume.source}`)
          }
        }
      }
      const limits = InspectionJson.record(service.deploy) && InspectionJson.record(service.deploy.resources)
        && InspectionJson.record(service.deploy.resources.limits) ? service.deploy.resources.limits : {}
      const bounded = ComposeSetup.positive(service.cpus ?? limits.cpus) && ComposeSetup.memory(service.mem_limit ?? limits.memory)
      const health = service.healthcheck
      const healthy = InspectionJson.record(health) && health.disable !== true && Array.isArray(health.test)
        && health.test.length > 0 && health.test.every((item) => typeof item === 'string') && health.test[0] !== 'NONE'
      const dependencies: string[] = []
      const startupDependencies: string[] = []
      if (service.depends_on !== undefined) {
        if (!InspectionJson.record(service.depends_on)) return null
        for (const [dependency, condition] of Object.entries(service.depends_on)) {
          if (!InspectionJson.record(condition) || typeof condition.condition !== 'string') return null
          if (condition.condition === 'service_healthy') dependencies.push(dependency)
          else startupDependencies.push(dependency)
        }
      }
      services.push({ name, image: service.image ?? '', bounded, healthy, dependencies, startupDependencies, binds, sharedNames, buildContext })
    }
    return new ComposeSetup(value.name, services)
  }

  static positive(value: unknown): boolean {
    return (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) && Number(value) > 0
  }

  static memory(value: unknown): boolean {
    return ComposeSetup.positive(value) || (typeof value === 'string' && /^[1-9]\d*(?:\.\d+)?[bkmg](?:i?b)?$/i.test(value))
  }
}

class InspectionSession {
  static readonly COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml', 'docker/docker-compose.yml']
  static readonly FILES = ['AGENTS.md', '.agent/conventions.md', '.gitignore', 'Makefile', 'scripts/test-command.sh', 'package.json', ...InspectionSession.COMPOSE_FILES]
  static readonly RUNTIME_PATHS = ['.worktrees/__readiness__/probe', '.agent/SLICE.md', '.agent/run-1.json']
  static readonly PLAN_PATH = 'docs/superpowers/plans/__readiness__.md'
  readonly options: InspectionOptions
  readonly target: PlanTarget
  readonly started: number
  readonly findings: ReadinessFinding[] = []
  readonly files = new Map<string, string>()
  readonly available = new Set<string>()
  readonly unreadable = new Set<string>()
  root: string
  revision: string | null = null
  reads = 0

  constructor(options: InspectionOptions, target: PlanTarget) {
    this.options = options
    this.target = target
    this.root = target.root.text
    this.started = options.now()
  }

  finding(id: string, status: ReadinessStatus, evidence: string[], action: string | null): void {
    this.findings.push(new ReadinessFinding({ id, status, evidence, action }))
  }

  async ask(bin: string, argv: string[]): Promise<ProcessOutput> {
    const remaining = this.options.budgetMs - (this.options.now() - this.started)
    if (remaining <= 0) return new ProcessOutput({ code: 124, stdout: '', stderr: '' })
    return this.options.run(bin, argv, this.root, Math.min(remaining, this.options.commandBudgetMs))
  }

  report(): ProjectReadiness {
    return new ProjectReadiness({
      repository: this.target.repository.text, root: this.root, baseRevision: this.revision,
      observedAt: new Date(this.started).toISOString(), findings: this.findings,
    })
  }

  async inspect(): Promise<ProjectReadiness> {
    if (!await this.checkout()) return this.report()
    if (!await this.base()) return this.report()
    await this.declarations()
    await this.checkoutRules()
    await this.docker()
    this.finding('execution', 'unverified', [], 'verify-execution')
    return this.report()
  }

  async checkout(): Promise<boolean> {
    const root = await this.ask('git', ['rev-parse', '--show-toplevel'])
    if (root.failed || !isAbsolute(root.stdout.trim())) {
      this.finding('checkout', 'unverified', [`git rev-parse: exit ${root.code}`], 'confirm-checkout')
      return false
    }
    this.root = root.stdout.trim()
    const remote = await this.ask('git', ['remote', 'get-url', 'origin'])
    const named = remote.stdout.trim().match(/^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/)
    if (remote.failed || named === null) {
      this.finding('checkout', 'unverified', ['origin'], 'confirm-checkout')
      return false
    }
    const matches = named[1] === this.target.repository.text
    this.finding('checkout', matches ? 'ready' : 'changes-required', [this.root, named[1]], matches ? null : 'confirm-checkout')
    return matches
  }

  async base(): Promise<boolean> {
    const declared = await this.ask('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'])
    if (declared.failed || !/^refs\/remotes\/origin\/[^\s]+$/.test(declared.stdout.trim())) {
      this.finding('base', 'unverified', ['origin/HEAD'], 'update-checkout')
      return false
    }
    const commit = await this.ask('git', ['rev-parse', '--verify', `${declared.stdout.trim()}^{commit}`])
    if (commit.failed || !/^[a-f0-9]{40,64}$/.test(commit.stdout.trim())) {
      this.finding('base', 'unverified', ['origin/HEAD'], 'update-checkout')
      return false
    }
    this.revision = commit.stdout.trim()
    this.finding('base', 'ready', [declared.stdout.trim(), this.revision], null)
    return true
  }

  async readTracked(path: string): Promise<string | null> {
    if (this.files.has(path)) return this.files.get(path) ?? null
    if (path.startsWith('/') || path.split('/').includes('..') || !/^[\w./-]+$/.test(path)) return null
    if (this.reads >= this.options.maxFiles) {
      this.unreadable.add(path)
      return null
    }
    this.reads += 1
    if (!this.available.has(path)) {
      const listed = await this.ask('git', ['ls-tree', '-r', '--name-only', this.revision!, '--', path])
      if (listed.failed) { this.unreadable.add(path); return null }
      if (!listed.stdout.split('\n').includes(path)) return null
      this.available.add(path)
    }
    const read = await this.ask('git', ['show', `${this.revision}:${path}`])
    if (read.failed) { this.unreadable.add(path); return null }
    this.files.set(path, read.stdout)
    return read.stdout
  }

  static substantive(text: string | null): boolean {
    if (text === null) return false
    const content = text.replace(/<!--[\s\S]*?-->/g, '').split('\n')
      .filter((line) => !/^\s*(?:#|$)/.test(line)).join('\n').trim()
    return content.length > 0 && !/^(?:TODO|TBD|<[^>]+>|\.\.\.)$/i.test(content)
  }

  async declarations(): Promise<void> {
    const listed = await this.ask('git', ['ls-tree', '-r', '--name-only', this.revision!, '--', ...InspectionSession.FILES])
    if (listed.failed) {
      this.finding('commands', 'unverified', ['git ls-tree'], 'retry-inspection')
      return
    }
    const available = listed.stdout.split('\n').filter(Boolean)
    for (const path of available) this.available.add(path)
    for (const path of available.filter((path) => InspectionSession.FILES.includes(path))) await this.readTracked(path)
    const agents = this.files.get('AGENTS.md') ?? ''
    const conventions = this.files.get('.agent/conventions.md') ?? ''
    const test = TestCommandDeclaration.in('', (path: string) => this.files.get(path) ?? null)
    const missing = ['build', 'lint'].filter((name) => {
      const command = `${agents}\n${conventions}`.match(new RegExp(`^[ \\t]*(?:[-*+]\\s+)?${name}:\\s*\x60([^\x60\\n]+)\x60`, 'im'))?.[1]
      return command === undefined || /<[^>]+>|TODO|\.\.\./i.test(command)
    })
    if (test === null || /<[^>]+>|TODO|\.\.\./i.test(test)) missing.push('test')
    const declarationsUnreadable = this.unreadable.has('AGENTS.md') || this.unreadable.has('.agent/conventions.md')
    this.finding('commands', declarationsUnreadable ? 'unverified' : missing.length ? 'changes-required' : 'ready',
      missing.length ? missing : ['build', 'test', 'lint'], declarationsUnreadable ? 'retry-inspection' : missing.length ? 'declare-commands' : null)
    const references = [...conventions.replace(/<!--[\s\S]*?-->/g, '').matchAll(/`([\w./-]+\.md)`/g)].map((match) => match[1])
    const sources: string[] = []
    for (const path of [...new Set(references)].slice(0, this.options.maxFiles)) {
      if (InspectionSession.substantive(await this.readTracked(path))) sources.push(path)
    }
    const complete = references.length > 0 && sources.length === new Set(references).size
    const conventionsUnreadable = this.unreadable.has('.agent/conventions.md') || references.some((path) => this.unreadable.has(path))
    this.finding('conventions', conventionsUnreadable ? 'unverified' : complete ? 'ready' : 'changes-required',
      sources.length ? sources : ['.agent/conventions.md'], conventionsUnreadable ? 'retry-inspection' : complete ? null : 'declare-conventions')
    this.workers(test)
  }

  workers(command: string | null): void {
    let executable = command ?? ''
    let propagated = false
    if (/^make (?:env-start )?test$/.test(executable)) {
      const make = (this.files.get('Makefile') ?? '').split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
      const target = make.match(/^test[^\S\n]*:([^\n]*)\n((?:\t[^\n]*(?:\n|$))*)/m)
      const recipe = target?.[2].trim().split('\n') ?? []
      if (target?.[1].split('#')[0].trim() === '' && recipe.length === 1 && InspectionSession.referenceRecipe(make, recipe[0])) {
        executable = this.files.get('scripts/test-command.sh') ?? ''
        propagated = recipe[0].includes('PYTEST_WORKERS=$(PYTEST_WORKERS)')
      }
      else executable = ''
    }
    const lines = executable.split('\n').map((line) => line.trim()).filter((line) => line && !/^(?:#|set\s)/.test(line))
    if (lines.length !== 1 || !/^(?:python(?:3)? -m )?pytest\s/.test(lines[0]) || /[;&|`]/.test(lines[0])
      || (lines[0].match(/\s(?:-n(?=\s|\d)|--numprocesses(?=\s|=))/g)?.length ?? 0) !== 1) {
      this.finding('test-workers', 'unverified', ['AGENTS.md', 'Makefile', 'scripts/test-command.sh'], 'inspect-command')
      return
    }
    executable = lines[0]
    const literal = executable.match(/\bpytest\b[^\n]*?\s-n\s*["']?(\d+|auto|logical)(?=[\s"']|$)/)?.[1]
    const configured = executable.match(/\bpytest\b[^\n]*?\s-n\s+"\$\{PYTEST_WORKERS:-(\d+)\}"/)?.[1]
    const assignments = (this.files.get('Makefile') ?? '').match(/^PYTEST_WORKERS[^\n]*=/gm) ?? []
    const makeBound = assignments.length === 1 ? (this.files.get('Makefile') ?? '').match(/^PYTEST_WORKERS\s*\?=\s*(\d+)\s*$/m)?.[1] : undefined
    const bound = literal && /^\d+$/.test(literal) ? literal : (configured && makeBound === configured && propagated ? configured : null)
    if (literal === 'auto' || literal === 'logical') this.finding('test-workers', 'changes-required', [`pytest -n ${literal}`], 'limit-workers')
    else if (bound !== null) this.finding('test-workers', 'ready', [`pytest -n ${bound}`], null)
    else this.finding('test-workers', 'unverified', ['AGENTS.md', 'Makefile', 'scripts/test-command.sh'], 'inspect-command')
  }

  static referenceRecipe(make: string, recipe: string): boolean {
    if (/[;&|`]/.test(recipe)
      || !/^(?:@?\$\((?:DOCKER_EXEC|DOCKER_CHECK_EXEC)\)|@?docker compose\b).*\s(?:\$\([A-Z_]+\)|\/app)\/scripts\/test-command\.sh$/.test(recipe)) return false
    const macro = recipe.match(/^@?\$\((DOCKER_EXEC|DOCKER_CHECK_EXEC)\)/)?.[1]
    if (macro === undefined) return true
    const definitions = [...make.matchAll(new RegExp(`^${macro}\\s*:=\\s*([^\\n]+)$`, 'gm'))]
    if (definitions.length !== 1 || !/^\$\(DOCKER_COMMAND\) exec (?:-T )?-w \$\(CONTAINER_SRC\) app$/.test(definitions[0][1])) return false
    const commands = [...make.matchAll(/^DOCKER_COMMAND\s*:=\s*([^\n]+)$/gm)]
    return commands.length > 0 && commands.every((match) => /^(?:docker compose|\$\(DOCKER_COMMAND\))(?: -(?:p|f) \$\([A-Z_]+\))+$/.test(match[1]))
  }

  async checkoutRules(): Promise<void> {
    const diff = await this.ask('git', ['diff', '--name-only', this.revision!, '--', ...InspectionSession.FILES])
    this.finding('checkout-drift', diff.failed ? 'unverified' : diff.stdout.trim() ? 'changes-required' : 'ready',
      diff.failed ? ['git diff'] : diff.stdout.split('\n').filter(Boolean), diff.failed ? 'retry-inspection' : diff.stdout.trim() ? 'update-checkout' : null)
    const ignored = await this.ask('git', ['check-ignore', '--no-index', '--', ...InspectionSession.RUNTIME_PATHS, InspectionSession.PLAN_PATH])
    const paths = new Set(ignored.stdout.split('\n').filter(Boolean))
    const matches = InspectionSession.RUNTIME_PATHS.every((path) => paths.has(path)) && !paths.has(InspectionSession.PLAN_PATH)
    this.finding('git-ignore', ignored.code > 1 ? 'unverified' : matches ? 'ready' : 'changes-required',
      [...paths], ignored.code > 1 ? 'retry-inspection' : matches ? null : 'fix-ignore')
  }

  async docker(): Promise<void> {
    const candidates = InspectionSession.COMPOSE_FILES.filter((path) => this.files.has(path))
    if (candidates.length !== 1) {
      this.finding('compose', 'unverified', candidates, 'declare-compose')
      return
    }
    const info = await this.ask('docker', ['info', '--format', '{{json .}}'])
    const machine = InspectionJson.parse(info.stdout)
    if (info.failed || !InspectionJson.record(machine) || typeof machine.NCPU !== 'number' || typeof machine.MemTotal !== 'number'
      || !Number.isFinite(machine.NCPU) || machine.NCPU <= 0 || !Number.isFinite(machine.MemTotal) || machine.MemTotal <= 0) {
      this.finding('docker', 'unverified', ['docker info'], 'start-docker')
      return
    }
    this.finding('docker', 'ready', [`NCPU=${machine.NCPU}`, `MemTotal=${machine.MemTotal}`], null)
    const configured = await this.ask('docker', ['compose', '-f', join(this.root, candidates[0]), 'config', '--no-env-resolution', '--format', 'json'])
    const compose = configured.failed ? null : ComposeSetup.from(InspectionJson.parse(configured.stdout))
    if (compose === null || compose.services.length > this.options.maxContainers) {
      this.finding('compose', 'unverified', [candidates[0]], 'review-compose')
      return
    }
    this.finding('compose', 'ready', [candidates[0], compose.name], null)
    const unbounded = compose.services.filter((service) => !service.bounded).map((service) => service.name)
    this.finding('container-resources', unbounded.length ? 'changes-required' : 'ready', unbounded, unbounded.length ? 'limit-resources' : null)
    const databases = compose.services.filter((service) => /(?:^|\/)(?:postgres|postgresql)(?::|@|$)/i.test(service.image))
    const unready = databases.filter((db) => !db.healthy
      || !compose.services.some((service) => service.dependencies.includes(db.name))
      || compose.services.some((service) => service.startupDependencies.includes(db.name))).map((db) => db.name)
    this.finding('database-readiness', !databases.length ? 'unverified' : unready.length ? 'changes-required' : 'ready',
      unready, !databases.length ? 'review-compose' : unready.length ? 'wait-for-database' : null)
    const shared = compose.services.filter((service) => service.sharedNames || service.binds.some((bind) => {
      const path = relative(this.root, bind.source)
      return path === '..' || path.startsWith('../') || isAbsolute(path)
    })).map((service) => service.name)
    this.finding('worktree-config', shared.length ? 'changes-required' : 'unverified', shared, 'isolate-worktrees')
    const builds = compose.services.filter((service) => service.buildContext !== null)
    const externalBuilds = builds.filter((service) => {
      const path = relative(this.root, service.buildContext!)
      return !isAbsolute(service.buildContext!) || path === '..' || path.startsWith('../') || isAbsolute(path)
    }).map((service) => service.name)
    this.finding('build-context', externalBuilds.length ? 'changes-required' : builds.length ? 'ready' : 'unverified',
      builds.map((service) => `${service.name}:${service.buildContext}`), externalBuilds.length || !builds.length ? 'verify-dependencies' : null)
    await this.containers(compose)
  }

  async containers(compose: ComposeSetup): Promise<void> {
    const listed = await this.ask('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${compose.name}`, '--format', '{{.ID}}'])
    const ids = listed.stdout.split('\n').filter(Boolean)
    if (listed.failed || ids.length === 0 || ids.length > this.options.maxContainers || ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) {
      this.finding('container-mounts', 'unverified', [compose.name], 'recreate-environment')
      return
    }
    const inspected = await this.ask('docker', ['inspect', ...ids])
    const containers = InspectionJson.parse(inspected.stdout)
    if (inspected.failed || !Array.isArray(containers) || containers.length !== ids.length) {
      this.finding('container-mounts', 'unverified', [compose.name], 'retry-inspection')
      return
    }
    const mismatched: string[] = []
    const observed = new Set<string>()
    let running = true
    for (const container of containers) {
      if (!InspectionJson.record(container) || !InspectionJson.record(container.Config) || !InspectionJson.record(container.Config.Labels)
        || !InspectionJson.record(container.State) || typeof container.State.Status !== 'string' || !Array.isArray(container.Mounts)
        || !container.Mounts.every((mount: unknown) => InspectionJson.record(mount) && typeof mount.Type === 'string'
          && typeof mount.Source === 'string' && typeof mount.Destination === 'string')) {
        this.finding('container-mounts', 'unverified', [compose.name], 'retry-inspection')
        return
      }
      const name = container.Config.Labels['com.docker.compose.service']
      const service = compose.services.find((item) => item.name === name)
      if (service === undefined) {
        this.finding('container-mounts', 'unverified', [compose.name], 'review-compose')
        return
      }
      running &&= container.State.Status === 'running'
      observed.add(service.name)
      for (const expected of service.binds) {
        const matches = container.Mounts.some((mount: unknown) => InspectionJson.record(mount)
          && mount.Type === 'bind' && mount.Source === expected.source && mount.Destination === expected.target)
        if (!matches) mismatched.push(`- ${service.name}:${expected.source} -> ${expected.target}`)
      }
      for (const mount of container.Mounts) {
        if (InspectionJson.record(mount) && mount.Type === 'bind'
          && !service.binds.some((bind) => bind.source === mount.Source && bind.target === mount.Destination)) {
          mismatched.push(`+ ${service.name}:${mount.Source} -> ${mount.Destination}`)
        }
      }
    }
    running &&= compose.services.every((service) => observed.has(service.name))
    this.finding('container-mounts', mismatched.length ? 'changes-required' : running ? 'ready' : 'unverified',
      mismatched.length ? mismatched : [compose.name], mismatched.length || !running ? 'recreate-environment' : null)
    await this.images(compose, containers)
  }

  async images(compose: ComposeSetup, containers: unknown[]): Promise<void> {
    const images = [...new Set(compose.services.map((service) => service.image))]
    if (images.some((image) => !/^[\w][\w./:@-]*$/.test(image))) {
      this.finding('image-provenance', 'unverified', [compose.name], 'verify-dependencies')
      return
    }
    const inspected = await this.ask('docker', ['image', 'inspect', '--format', '{{json .Id}}', ...images])
    const identities = inspected.stdout.trim().split('\n').map((line) => InspectionJson.parse(line))
    if (inspected.failed || identities.length !== images.length || !identities.every((id) => typeof id === 'string' && /^sha256:[a-f0-9]{64}$/.test(id))) {
      this.finding('image-provenance', 'unverified', [compose.name], 'verify-dependencies')
      return
    }
    const mismatched: string[] = []
    const observed = new Set<string>()
    for (const container of containers) {
      if (!InspectionJson.record(container) || typeof container.Image !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(container.Image)
        || !InspectionJson.record(container.Config) || !InspectionJson.record(container.Config.Labels)) {
        this.finding('image-provenance', 'unverified', [compose.name], 'verify-dependencies')
        return
      }
      const name = container.Config.Labels['com.docker.compose.service']
      const service = compose.services.find((item) => item.name === name)
      if (service === undefined) {
        this.finding('image-provenance', 'unverified', [compose.name], 'verify-dependencies')
        return
      }
      observed.add(service.name)
      if (container.Image !== identities[images.indexOf(service.image)]) {
        const identity = typeof container.Name === 'string' ? container.Name : service.name
        mismatched.push(`${identity}:${container.Image}`)
      }
    }
    const complete = compose.services.every((service) => observed.has(service.name))
    this.finding('image-provenance', mismatched.length ? 'changes-required' : complete ? 'ready' : 'unverified',
      mismatched.length ? mismatched : images, mismatched.length ? 'recreate-environment' : complete ? null : 'verify-dependencies')
  }
}

export class GitDockerProjectSetup extends ProjectSetup {
  readonly options: InspectionOptions
  private active = false

  constructor(options: InspectionOptions) {
    super()
    for (const value of [options.budgetMs, options.commandBudgetMs, options.maxFiles, options.maxContainers]) {
      if (!Number.isInteger(value) || value <= 0) throw new Error('inspection budgets must be positive integers')
    }
    this.options = options
  }

  async inspect(target: PlanTarget): Promise<ProjectReadiness> {
    if (this.active) {
      return new ProjectReadiness({
        repository: target.repository.text, root: target.root.text, baseRevision: null,
        observedAt: new Date(this.options.now()).toISOString(),
        findings: [new ReadinessFinding({ id: 'inspection', status: 'unverified', evidence: [], action: 'retry-inspection' })],
      })
    }
    this.active = true
    try { return await new InspectionSession(this.options, target).inspect() }
    finally { this.active = false }
  }
}
