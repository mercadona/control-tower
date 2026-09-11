import { isAbsolute } from 'node:path'
import { TestCommandDeclaration } from '../../../plugin/scripts/baseline.js'
import { ProjectRepository } from '../domain/ports/project-repository.ts'
import { RepositoryIdentity } from '../domain/value-objects/repository-identity.ts'
import { RepositoryObservations } from '../domain/value-objects/repository-observations.ts'
import type { InspectionBudget } from '../domain/value-objects/inspection-budget.ts'
import type { InspectionCommands } from './inspection-commands.ts'

type RepositoryData = ConstructorParameters<typeof RepositoryObservations>[0]

class WorkerDeclaration {
  readonly count: number | 'automatic' | null
  readonly evidence: readonly string[]

  constructor(count: number | 'automatic' | null, evidence: readonly string[]) {
    this.count = count
    this.evidence = Object.freeze([...evidence])
    Object.freeze(this)
  }

  static read(command: string | null, makefile: string, script: string): WorkerDeclaration {
    let executable = command ?? ''
    let propagated = false
    const unknown = new WorkerDeclaration(null, ['AGENTS.md', 'Makefile', 'scripts/test-command.sh'])
    if (/^make (?:env-start )?test$/.test(executable)) {
      const make = makefile.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
      const target = make.match(/^test[^\S\n]*:([^\n]*)\n((?:\t[^\n]*(?:\n|$))*)/m)
      const recipe = target?.[2].trim().split('\n') ?? []
      if (target?.[1].split('#')[0].trim() !== '' || recipe.length !== 1 || !WorkerDeclaration.#referenceRecipe(make, recipe[0])) return unknown
      executable = script
      propagated = recipe[0].includes('PYTEST_WORKERS=$(PYTEST_WORKERS)')
    }
    const lines = executable.split('\n').map((line) => line.trim()).filter((line) => line && !/^(?:#|set\s)/.test(line))
    if (lines.length !== 1 || !/^(?:python(?:3)? -m )?pytest\s/.test(lines[0]) || /[;&|`]/.test(lines[0])
      || /[$<>{}()[\]*?~\\]/.test(lines[0].replace(/(\s-n\s+)"\$\{PYTEST_WORKERS:-\d+\}"/, '$1value'))
      || (lines[0].match(/\s(?:-n(?=\s|\d)|--numprocesses(?=\s|=))/g)?.length ?? 0) !== 1) return unknown
    const literal = lines[0].match(/\bpytest\b[^\n]*?\s-n\s*["']?(\d+|auto|logical)(?=[\s"']|$)/)?.[1]
    if (literal === 'auto' || literal === 'logical') return new WorkerDeclaration('automatic', [`pytest -n ${literal}`])
    const configured = lines[0].match(/\bpytest\b[^\n]*?\s-n\s+"\$\{PYTEST_WORKERS:-(\d+)\}"/)?.[1]
    const assignments = makefile.match(/^PYTEST_WORKERS[^\n]*=/gm) ?? []
    const makeBound = assignments.length === 1 ? makefile.match(/^PYTEST_WORKERS\s*\?=\s*(\d+)\s*$/m)?.[1] : undefined
    const bound = literal ?? (configured && configured === makeBound && propagated ? configured : undefined)
    return bound !== undefined && Number.isSafeInteger(Number(bound))
      ? new WorkerDeclaration(Number(bound), [`pytest -n ${bound}`]) : unknown
  }

  static #referenceRecipe(make: string, recipe: string): boolean {
    if (/[;&|`]/.test(recipe) || /[$<>]/.test(recipe.replace(/\$\([A-Z_]+\)/g, ''))
      || !/^(?:@?\$\((?:DOCKER_EXEC|DOCKER_CHECK_EXEC)\)|@?docker compose\b).*\s(?:\$\([A-Z_]+\)|\/app)\/scripts\/test-command\.sh$/.test(recipe)) return false
    const macro = recipe.match(/^@?\$\((DOCKER_EXEC|DOCKER_CHECK_EXEC)\)/)?.[1]
    if (macro === undefined) return true
    const definitions = [...make.matchAll(new RegExp(`^${macro}\\s*:=\\s*([^\\n]+)$`, 'gm'))]
    if (definitions.length !== 1 || !/^\$\(DOCKER_COMMAND\) exec (?:-T )?-w \$\(CONTAINER_SRC\) app$/.test(definitions[0][1])) return false
    const commands = [...make.matchAll(/^DOCKER_COMMAND\s*:=\s*([^\n]+)$/gm)]
    return commands.length > 0 && commands.every((match) => /^(?:docker compose|\$\(DOCKER_COMMAND\))(?: -(?:p|f) \$\([A-Z_]+\))+$/.test(match[1]))
  }
}

class RepositoryScan {
  static readonly COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml', 'docker/docker-compose.yml']
  static readonly CONTENT_FILES = ['AGENTS.md', '.agent/conventions.md', 'Makefile', 'scripts/test-command.sh']
  static readonly FILES = [...RepositoryScan.CONTENT_FILES, '.gitignore', 'package.json', ...RepositoryScan.COMPOSE_FILES]
  readonly #commands: InspectionCommands
  readonly #budget: InspectionBudget
  readonly #root: string
  readonly #files = new Map<string, string>()
  readonly #available = new Set<string>()
  readonly #unreadable = new Set<string>()
  #reads = 0

  constructor(commands: InspectionCommands, root: string, budget: InspectionBudget) {
    this.#commands = commands
    this.#root = root
    this.#budget = budget
  }

  #ask(argv: string[]) { return this.#commands.ask('git', argv, this.#root, this.#budget) }

  async read(): Promise<RepositoryObservations> {
    const data: RepositoryData = {
      root: this.#root, base: null, commands: null, sources: null, workerCount: null, workerEvidence: [],
      composeFiles: null, changedPaths: null, ignoredPaths: null,
    }
    const declared = await this.#ask(['symbolic-ref', 'refs/remotes/origin/HEAD'])
    const reference = declared.stdout.trim()
    if (declared.failed || !/^refs\/remotes\/origin\/[^\s]+$/.test(reference)) return new RepositoryObservations(data)
    const commit = await this.#ask(['rev-parse', '--verify', `${reference}^{commit}`])
    const revision = commit.stdout.trim()
    if (commit.failed || !/^[a-f0-9]{40,64}$/.test(revision)) return new RepositoryObservations(data)
    data.base = { reference, revision }
    const listed = await this.#ask(['ls-tree', '-r', '--name-only', revision, '--', ...RepositoryScan.FILES])
    if (!listed.failed) {
      for (const path of listed.stdout.split('\n').filter(Boolean)) this.#available.add(path)
      data.composeFiles = RepositoryScan.COMPOSE_FILES.filter((path) => this.#available.has(path))
      for (const path of RepositoryScan.CONTENT_FILES.filter((path) => this.#available.has(path))) await this.#readTracked(revision, path)
      const agents = this.#files.get('AGENTS.md') ?? ''
      const conventions = this.#files.get('.agent/conventions.md') ?? ''
      const test = TestCommandDeclaration.in('', (path: string) => this.#files.get(path) ?? null)
      if (!this.#unreadable.has('AGENTS.md') && !this.#unreadable.has('.agent/conventions.md')) {
        data.commands = { build: RepositoryScan.#command('build', agents, conventions), test, lint: RepositoryScan.#command('lint', agents, conventions) }
      }
      const workers = WorkerDeclaration.read(test, this.#files.get('Makefile') ?? '', this.#files.get('scripts/test-command.sh') ?? '')
      data.workerCount = workers.count
      data.workerEvidence = workers.evidence
      if (!this.#unreadable.has('.agent/conventions.md')) {
        const references = [...new Set([...conventions.replace(/<!--[\s\S]*?-->/g, '').matchAll(/`([\w./-]+\.md)`/g)].map((match) => match[1]))]
        const sources: NonNullable<RepositoryData['sources']>[number][] = []
        for (const path of references) {
          const content = await this.#readTracked(revision, path)
          sources.push(content === null
            ? { path, state: this.#unreadable.has(path) ? 'unreadable' : 'missing' }
            : { path, state: 'read', body: RepositoryScan.#bodyOf(content) })
          if (this.#reads >= this.#budget.limits.maxFiles && this.#unreadable.has(path)) break
        }
        data.sources = sources
      }
    }
    const diff = await this.#ask(['diff', '--name-only', revision, '--', ...RepositoryScan.FILES])
    data.changedPaths = diff.failed ? null : diff.stdout.split('\n').filter(Boolean)
    const ignored = await this.#ask(['check-ignore', '--no-index', '--', ...RepositoryObservations.RUNTIME_PATHS, RepositoryObservations.PLAN_PATH])
    data.ignoredPaths = ignored.code > 1 ? null : ignored.stdout.split('\n').filter(Boolean)
    return new RepositoryObservations(data)
  }

  async #readTracked(revision: string, path: string): Promise<string | null> {
    if (this.#files.has(path)) return this.#files.get(path) ?? null
    if (path.startsWith('/') || path.split('/').includes('..') || !/^[\w./-]+$/.test(path)) return null
    if (this.#reads >= this.#budget.limits.maxFiles) { this.#unreadable.add(path); return null }
    this.#reads += 1
    if (!this.#available.has(path)) {
      const listed = await this.#ask(['ls-tree', '-r', '--name-only', revision, '--', path])
      if (listed.failed) { this.#unreadable.add(path); return null }
      if (!listed.stdout.split('\n').includes(path)) return null
      this.#available.add(path)
    }
    const read = await this.#ask(['show', `${revision}:${path}`])
    if (read.failed) { this.#unreadable.add(path); return null }
    this.#files.set(path, read.stdout)
    return read.stdout
  }

  static #command(name: string, agents: string, conventions: string): string | null {
    return `${agents}\n${conventions}`.match(new RegExp(`^[ \\t]*(?:[-*+]\\s+)?${name}:\\s*\x60([^\x60\\n]+)\x60`, 'im'))?.[1] ?? null
  }

  static #bodyOf(text: string): string {
    return text.replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((line) => !/^\s*(?:#|$)/.test(line)).join('\n')
  }
}

export class GitProjectRepository extends ProjectRepository {
  readonly #commands: InspectionCommands

  constructor(commands: InspectionCommands) { super(); this.#commands = commands }

  async identify(root: string, budget: InspectionBudget): Promise<RepositoryIdentity> {
    const directory = await this.#commands.ask('git', ['rev-parse', '--show-toplevel'], root, budget)
    if (directory.failed || !isAbsolute(directory.stdout.trim())) {
      return new RepositoryIdentity({ root, name: null, evidence: [`git rev-parse: exit ${directory.code}`] })
    }
    root = directory.stdout.trim()
    const remote = await this.#commands.ask('git', ['remote', 'get-url', 'origin'], root, budget)
    const name = remote.failed ? null : remote.stdout.trim().match(/^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null
    return new RepositoryIdentity({ root, name, evidence: name === null ? ['origin'] : [root, name] })
  }

  observe(root: string, budget: InspectionBudget): Promise<RepositoryObservations> {
    return new RepositoryScan(this.#commands, root, budget).read()
  }
}
