import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentDefinition } from '../../../plugin/scripts/judge-agent-definition.js'
import { RoleBytes } from '../../../plugin/scripts/role-bytes.js'
import { STEPS } from '../../../plugin/scripts/run-machine.js'
import { renderState } from '../../../plugin/scripts/state.js'
import {
  ADVICE_SCHEMA,
  ADVISOR_TOOLS,
  IMPLEMENTER_MODEL,
  IMPLEMENTER_TOOLS,
  JUDGE_TOOLS,
  RECONCILER_TOOLS,
  REPORT_SCHEMA,
  SLICE_JUDGE_TOOLS,
  SLICE_VERDICT_RULES,
  SLICE_VERDICT_SCHEMA,
  VERDICT_RULES,
  VERDICT_SCHEMA,
} from '../../../plugin/scripts/step-contracts.js'
import { RunNotUnderstood } from '../../src/domain/exceptions.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CtRunMachine } from '../../src/infrastructure/ct-run-machine.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { RunDispatch } from '../../src/infrastructure/run-dispatch.ts'
import { RunJournal } from '../../src/infrastructure/run-journal.ts'

type DispatchRole = RunDispatch['role']

class EnvironmentSnapshot {
  readonly values: ReadonlyMap<string, string | undefined>

  constructor(names: readonly string[]) {
    this.values = new Map(names.map((name) => [name, process.env[name]]))
  }

  restore(): void {
    for (const [name, value] of this.values) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

class DispatchRepository {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly TICKET = '22222222-2222-4222-8222-222222222222'
  static readonly ISSUE = 7
  static readonly PLAN = 'docs/superpowers/plans/2026-09-17-issue-7-dispatch.md'
  static readonly HERE = dirname(fileURLToPath(import.meta.url))
  static readonly REPOSITORY_ROOT = join(DispatchRepository.HERE, '..', '..', '..')
  static readonly PLUGIN_ROOT = join(DispatchRepository.REPOSITORY_ROOT, 'plugin')
  static readonly CT_STEP = join(DispatchRepository.PLUGIN_ROOT, 'scripts', 'ct-step.mjs')
  static readonly PLAN_TEXT = [
    '# #7 - dispatch fixture',
    '',
    '> **Task-scoped subagents execute this plan. They arrive with no context.**',
    '',
    '### Desired end state',
    '',
    '- Dispatch material is relayed.',
    '',
    '### Out of scope',
    '',
    '- Network calls.',
    '',
    '## 2. Closed decisions (take as given)',
    '',
    '- Use plugin output.',
    '',
    '## 3. Reference patterns',
    '',
    'Files to imitate:',
    '- `README.md`',
    '',
    'Rules to obey:',
    '- `AGENTS.md`',
    '',
    '## 7. Tasks',
    '',
    '### Task 1 — one file',
    '',
    '**Objective:** Write one file.',
    '',
    '**Files:** `work.txt` (create).',
    '',
    '**TDD:** No TDD - fixture.',
    '',
    '**Tests:** N/A - fixture.',
    '',
    '**Verification:**',
    '```bash',
    'test -f work.txt',
    '```',
    '',
    '## 8. Global verification',
    '',
    '```bash',
    'test -f work.txt',
    '```',
    '',
  ].join('\n')

  readonly root: string
  readonly stateRoot: string
  readonly origin: string
  readonly journal: RunJournal

  private constructor(root: string, stateRoot: string, origin: string) {
    this.root = root
    this.stateRoot = stateRoot
    this.origin = origin
    this.journal = new RunJournal({
      files: new HeadlessFiles({ root: stateRoot, fs, newId: () => 'temporary-record' }),
      newId: () => DispatchRepository.TICKET,
      now: () => { throw new Error('the journal clock is not asked') },
    })
  }

  static async create(): Promise<DispatchRepository> {
    let root: string | null = null
    let stateRoot: string | null = null
    let origin: string | null = null
    try {
      root = await mkdtemp(join(tmpdir(), 'ct-run-dispatch-'))
      stateRoot = await mkdtemp(join(tmpdir(), 'ct-run-dispatch-state-'))
      origin = await mkdtemp(join(tmpdir(), 'ct-run-dispatch-origin-'))
      const repository = new DispatchRepository(root, stateRoot, origin)
      await repository.#initialize()
      return repository
    } catch (cause) {
      await Promise.all([root, stateRoot, origin]
        .filter((path): path is string => path !== null)
        .map((path) => rm(path, { recursive: true, force: true })))
      throw cause
    }
  }

  async remove(): Promise<void> {
    await Promise.all([
      rm(this.root, { recursive: true, force: true }),
      rm(this.stateRoot, { recursive: true, force: true }),
      rm(this.origin, { recursive: true, force: true }),
    ])
  }

  watch(): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({
        number: DispatchRepository.ISSUE,
        url: 'https://github.com/mercadona/control-tower-plugin/issues/7',
      }),
      located: new WorkspaceLocation({ root: this.root, path: this.root, branch: 'feat/7' }),
      repository: new RepositoryName('mercadona/control-tower-plugin'),
      agent: DispatchRepository.CONVERSATION,
    })
  }

  async output(role: DispatchRole): Promise<string> {
    switch (role) {
      case 'implement':
        return this.#step('next')
      case 'judge':
        return this.#reachJudge()
      case 'advise':
        await this.#consumeTaskVerdict(await this.#reachJudge(), 'FAIL')
        await this.#submitReport(this.#step('next'))
        this.#step('controls')
        await this.#consumeTaskVerdict(this.#step('next'), 'FAIL')
        return this.#step('next')
      case 'slice-judge':
        return this.#reachSliceJudge()
      case 'reconcile':
        return this.#reconcileOutput()
    }
    return role satisfies never
  }

  async e2eOutput(): Promise<string> {
    const sliceJudge = await this.#reachSliceJudge()
    await this.#consumeSliceVerdict(sliceJudge)
    return this.#step('next')
  }

  async sliceFallbackOutput(): Promise<string> {
    await this.#completeTask()
    await this.#advanceBase('base bytes\n')
    await writeFile(join(this.root, 'work.txt'), 'dirty tree\n')
    return this.#step('reconcile')
  }

  async machine(stdout: string, pluginRoot = DispatchRepository.PLUGIN_ROOT): Promise<CtRunMachine> {
    const watch = this.watch()
    const plan = await readFile(join(this.root, DispatchRepository.PLAN), 'utf8')
    await this.journal.establish(watch, `${JSON.stringify({
      version: 1,
      conversation: DispatchRepository.CONVERSATION,
      repository: 'mercadona/control-tower-plugin',
      issue: DispatchRepository.ISSUE,
      plan: DispatchRepository.PLAN,
      initialPlanSha256: createHash('sha256').update(plan).digest('hex'),
    })}\n`)
    const ticket = await this.journal.begin(watch, `${JSON.stringify({
      version: 1,
      previous: null,
      argv: [DispatchRepository.CT_STEP, 'next', '--plan', DispatchRepository.PLAN, '--issue', '7'],
      cwd: this.root,
      planSha256: createHash('sha256').update(plan).digest('hex'),
    })}\n`)
    await this.journal.finish(watch, ticket, `${JSON.stringify({
      version: 1,
      code: 0,
      stdout,
      stderr: '',
      beforeRun: null,
      afterRun: await readFile(this.#runPath(), 'utf8'),
    })}\n`)
    return new CtRunMachine({
      journal: this.journal,
      node: async () => { throw new Error('dispatch resolution must not launch the oracle') },
      git: async () => { throw new Error('dispatch resolution must not invoke git') },
      read: async (path) => readFile(path, 'utf8').catch((cause: unknown) => {
        if (DispatchRepository.#hasCode(cause, 'ENOENT')) return null
        throw cause
      }),
      ctStep: DispatchRepository.CT_STEP,
      dispatchCheck: join(DispatchRepository.PLUGIN_ROOT, 'scripts', 'dispatch-check.mjs'),
      pluginRoot,
    })
  }

  async material(): Promise<string | null> {
    return this.journal.material(this.watch(), DispatchRepository.TICKET)
  }

  static async bytes(paths: readonly string[], cwd: string): Promise<readonly Buffer[]> {
    return Promise.all(paths.map((path) => readFile(path.startsWith('/') ? path : join(cwd, path))))
  }

  static expectedArgv(role: DispatchRole): readonly string[] {
    const schema = role === 'implement' ? REPORT_SCHEMA
      : role === 'judge' ? VERDICT_SCHEMA
        : role === 'advise' ? ADVICE_SCHEMA
          : role === 'slice-judge' ? SLICE_VERDICT_SCHEMA
            : null
    if (role === 'implement') {
      return [
        '--tools', IMPLEMENTER_TOOLS,
        '--allowedTools', IMPLEMENTER_TOOLS,
        '--model', IMPLEMENTER_MODEL,
        '--json-schema', JSON.stringify(schema),
      ]
    }
    const definition = DispatchRepository.definition(role)
    const tools = definition.tools.join(', ')
    const argv = [
      '--tools', tools,
      '--allowedTools', tools,
      '--model', definition.model,
      '--agents', JSON.stringify(definition.toClaudeAgents()),
      '--agent', definition.name,
    ]
    if (schema !== null) argv.push('--json-schema', JSON.stringify(schema))
    return argv
  }

  static definition(role: Exclude<DispatchRole, 'implement'>): AgentDefinition {
    const step = role === 'judge' ? STEPS.JUDGE
      : role === 'advise' ? STEPS.ADVISE
        : role === 'slice-judge' ? STEPS.SLICE_JUDGE
          : STEPS.RECONCILE
    const path = join(DispatchRepository.PLUGIN_ROOT, RoleBytes.filesOf(step)[0])
    return AgentDefinition.parse(readFileSync(path, 'utf8'))
  }

  async #initialize(): Promise<void> {
    this.#git('init', '-q', '-b', 'main')
    this.#git('config', 'user.email', 'fixture@example.com')
    this.#git('config', 'user.name', 'Fixture')
    this.#git('config', 'commit.gpgsign', 'false')
    await mkdir(dirname(join(this.root, DispatchRepository.PLAN)), { recursive: true })
    await mkdir(this.#runDirectory(), { recursive: true })
    await writeFile(join(this.root, DispatchRepository.PLAN), DispatchRepository.PLAN_TEXT)
    await writeFile(join(this.root, 'AGENTS.md'), '# Fixture rules\n')
    await writeFile(join(this.root, '.gitignore'), '.agent/run-*.json\n.agent/run-*/\n')
    await writeFile(join(this.root, '.agent', 'SLICE.md'), renderState({
      meta: {
        issue: DispatchRepository.ISSUE,
        base: 'main',
        senal: 'fixture signal',
        e2e: ['fixture journey'],
      },
      body: '# Fixture slice',
    }))
    this.#git('add', '-A')
    this.#git('commit', '-q', '-m', 'fixture base')
    this.#gitOutside('init', '-q', '--bare', '-b', 'main', this.origin)
    this.#git('remote', 'add', 'origin', this.origin)
    this.#git('push', '-q', 'origin', 'main')
    this.#git('switch', '-q', '-c', 'feat/7')
  }

  async #reconcileOutput(): Promise<string> {
    await this.#completeTask()
    await this.#advanceBase('base bytes\n')
    return this.#step('reconcile')
  }

  async #reachJudge(): Promise<string> {
    await this.#submitReport(this.#step('next'))
    this.#step('controls')
    return this.#step('next')
  }

  async #submitReport(implementOutput: string): Promise<void> {
    await writeFile(join(this.root, 'work.txt'), 'synthetic model response: implemented fixture task\n')
    const report = ProducerOutput.path(implementOutput, '  - that it write its report to: ')
    await writeFile(report, `${JSON.stringify({
      paths: ['work.txt'],
      summary: 'Synthetic model response used only to progress the real ct-step producer fixture.',
    })}\n`)
    this.#step('report', report)
  }

  async #consumeTaskVerdict(judgeOutput: string, ruling: 'PASS' | 'FAIL'): Promise<void> {
    const packagePath = ProducerOutput.path(judgeOutput, '  - the review package: ')
    const verdictPath = ProducerOutput.path(judgeOutput, '  - that it write its verdict to: ')
    const token = DispatchRepository.#reviewToken(await readFile(packagePath, 'utf8'))
    const findings = ruling === 'PASS' ? [] : [{
      rule: 'objetivo',
      severity: 'high',
      what: 'Synthetic model response requests another fixture attempt.',
      path: 'work.txt',
      line: 1,
      evidence: 'Synthetic response used only to progress the real ct-step producer fixture.',
    }]
    await writeFile(verdictPath, `${JSON.stringify({
      ruling,
      review_token: token,
      rubric: VERDICT_RULES.map((rule) => ({
        rule,
        result: `Synthetic model response evaluated ${rule} for producer progression.`,
        outcome: 'conforme',
      })),
      findings,
    })}\n`)
    this.#step('verdict', verdictPath)
  }

  async #completeTask(): Promise<void> {
    await this.#consumeTaskVerdict(await this.#reachJudge(), 'PASS')
    this.#step('commit')
  }

  async #reachSliceJudge(): Promise<string> {
    await this.#completeTask()
    this.#step('reconcile')
    this.#step('global')
    return this.#step('next')
  }

  async #consumeSliceVerdict(sliceOutput: string): Promise<void> {
    const packagePath = ProducerOutput.path(sliceOutput, "  - the slice's review package: ")
    const verdictPath = ProducerOutput.path(sliceOutput, '  - that it write its verdict to: ')
    const token = DispatchRepository.#reviewToken(await readFile(packagePath, 'utf8'))
    await writeFile(verdictPath, `${JSON.stringify({
      ruling: 'PASS',
      review_token: token,
      rubric: SLICE_VERDICT_RULES.map((rule) => ({
        rule,
        result: `Synthetic model response evaluated ${rule} for producer progression.`,
        outcome: 'conforme',
      })),
      findings: [],
    })}\n`)
    this.#step('slice-verdict', verdictPath)
  }

  async #advanceBase(content: string): Promise<void> {
    this.#git('switch', '-q', 'main')
    await writeFile(join(this.root, 'work.txt'), content)
    this.#git('add', 'work.txt')
    this.#git('commit', '-q', '-m', 'base change')
    this.#git('push', '-q', 'origin', 'main')
    this.#git('switch', '-q', 'feat/7')
  }

  #step(verb: string, ...arguments_: string[]): string {
    const result = spawnSync(process.execPath, [
      DispatchRepository.CT_STEP,
      verb,
      ...arguments_,
      '--plan', DispatchRepository.PLAN,
      '--issue', String(DispatchRepository.ISSUE),
    ], {
      cwd: this.root,
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
      env: { ...process.env, CLAUDE_CONFIG_DIR: this.stateRoot },
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`ct-step exited ${result.status}: ${result.stderr}`)
    return result.stdout
  }

  #git(...argv: string[]): string {
    const result = spawnSync('git', argv, {
      cwd: this.root,
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`git ${argv.join(' ')} exited ${result.status}: ${result.stderr}`)
    return result.stdout
  }

  #gitOutside(...argv: string[]): void {
    const result = spawnSync('git', argv, { encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`git ${argv.join(' ')} exited ${result.status}: ${result.stderr}`)
  }

  #runDirectory(): string {
    return join(this.root, '.agent', 'run-7')
  }

  #runPath(): string {
    return join(this.root, '.agent', 'run-7.json')
  }

  static #reviewToken(packageText: string): string {
    const token = /^Review token: ([0-9a-f]{64})$/m.exec(packageText)?.[1]
    if (token === undefined) throw new Error('the real review package has no review token')
    return token
  }

  static #hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }
}

class ProducerOutput {
  static path(stdout: string, label: string): string {
    const line = stdout.split('\n').find((candidate) => candidate.startsWith(label))
    if (line === undefined) throw new Error(`producer output lacks ${JSON.stringify(label)}`)
    return line.slice(label.length)
  }

  static implementPaths(stdout: string): readonly string[] {
    const printed = [
      ProducerOutput.path(stdout, '  - the rubric from '),
      ProducerOutput.path(stdout, "  - the task's brief: "),
    ]
    return Object.freeze(ProducerOutput.withRoleFiles(STEPS.IMPLEMENT, printed))
  }

  static paths(role: DispatchRole, stdout: string): readonly string[] {
    switch (role) {
      case 'implement':
        return ProducerOutput.implementPaths(stdout)
      case 'judge':
        return Object.freeze(ProducerOutput.withRoleFiles(STEPS.JUDGE, [
          ProducerOutput.path(stdout, '  - the review package: '),
          ProducerOutput.path(stdout, "  - the task's brief: "),
          ...ProducerOutput.optional(stdout, '  - the logs of the controls, ALREADY green, in case it wants them: ', '(none)'),
        ]))
      case 'advise':
        return Object.freeze(ProducerOutput.withRoleFiles(STEPS.ADVISE, [
          ProducerOutput.path(stdout, "  - the advisor's package: "),
        ]))
      case 'slice-judge':
        return Object.freeze(ProducerOutput.withRoleFiles(STEPS.SLICE_JUDGE, [
          ProducerOutput.path(stdout, "  - the slice's review package: "),
          ProducerOutput.path(stdout, '  - the plan: '),
          ...ProducerOutput.optional(stdout, '  - the log of the Global verification, ALREADY green, in case it wants it: ', '(N/A declared)'),
          ProducerOutput.path(stdout, '  - the verdict of every task, already committed: '),
        ]))
      case 'reconcile':
        return Object.freeze(ProducerOutput.withRoleFiles(STEPS.RECONCILE, [
          ProducerOutput.path(stdout, '  - the reconciliation package: '),
        ]))
    }
    return role satisfies never
  }

  static optional(stdout: string, label: string, absent: string): readonly string[] {
    const path = ProducerOutput.path(stdout, label)
    return path === absent ? Object.freeze([]) : Object.freeze([path])
  }

  static withRoleFiles(step: string, printed: readonly string[]): string[] {
    const paths = [...printed]
    for (const rolePath of RoleBytes.filesOf(step).map((path) => join(DispatchRepository.PLUGIN_ROOT, path))) {
      if (!paths.includes(rolePath)) paths.push(rolePath)
    }
    return paths
  }
}

describe('RunDispatch real process', () => {
  const repositories: DispatchRepository[] = []

  afterEach(async () => {
    await Promise.all(repositories.splice(0).map((repository) => repository.remove()))
  })

  it('real oracle material reaches the dispatch without rewritten bytes', async () => {
    const repository = await DispatchRepository.create()
    repositories.push(repository)
    const stdout = await repository.output('implement')
    const expectedPaths = ProducerOutput.implementPaths(stdout)
    const before = await DispatchRepository.bytes(expectedPaths, repository.root)
    const machine = await repository.machine(stdout)

    const dispatch = await machine.dispatch(repository.watch(), DispatchRepository.TICKET)
    const after = await DispatchRepository.bytes(dispatch.paths, repository.root)
    const replayed = await machine.dispatch(repository.watch(), DispatchRepository.TICKET)

    expect(dispatch.paths).toEqual(expectedPaths)
    expect(after).toEqual(before)
    expect(await DispatchRepository.bytes(replayed.paths, repository.root)).toEqual(before)
    expect(replayed).toEqual(dispatch)
  })

  it('plugin definitions tools and schemas determine every supported role', async () => {
    const roles: readonly DispatchRole[] = ['implement', 'judge', 'advise', 'slice-judge', 'reconcile']
    for (const role of roles) {
      const repository = await DispatchRepository.create()
      repositories.push(repository)
      const stdout = await repository.output(role)
      const machine = await repository.machine(stdout)

      const dispatch = await machine.dispatch(repository.watch(), DispatchRepository.TICKET)

      expect(dispatch.role).toBe(role)
      expect(dispatch.paths).toEqual(ProducerOutput.paths(role, stdout))
      expect(dispatch.argv).toEqual(DispatchRepository.expectedArgv(role))
      expect(dispatch.response.kind).toBe(role === 'reconcile' ? 'edits' : 'structured')
      expect(Object.isFrozen(dispatch)).toBe(true)
      expect(Object.isFrozen(dispatch.paths)).toBe(true)
      expect(Object.isFrozen(dispatch.argv)).toBe(true)
      expect(await repository.material()).not.toBeNull()
    }
    expect(DispatchRepository.expectedArgv('judge')).toContain(JUDGE_TOOLS)
    expect(DispatchRepository.expectedArgv('advise')).toContain(ADVISOR_TOOLS)
    expect(DispatchRepository.expectedArgv('slice-judge')).toContain(SLICE_JUDGE_TOOLS)
    expect(DispatchRepository.expectedArgv('reconcile')).toContain(RECONCILER_TOOLS)

    const malformed = await DispatchRepository.create()
    repositories.push(malformed)
    const stdout = await malformed.output('judge')
    const pluginRoot = join(malformed.root, 'malformed-plugin')
    await mkdir(join(pluginRoot, 'agents'), { recursive: true })
    await writeFile(join(pluginRoot, 'agents', 'ct-judge.md'), 'not an agent definition\n')
    const malformedMachine = await malformed.machine(stdout, pluginRoot)
    await expect(malformedMachine.dispatch(malformed.watch(), DispatchRepository.TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await malformed.material()).toBeNull()
  }, 60_000)

  it('unsupported E2E and slice fallback material starts no call', async () => {
    const e2e = await DispatchRepository.create()
    repositories.push(e2e)
    const e2eMachine = await e2e.machine(await e2e.e2eOutput())
    await expect(e2eMachine.dispatch(e2e.watch(), DispatchRepository.TICKET))
      .rejects.toThrow(/unsupported E2E material/)
    expect(await e2e.material()).toBeNull()

    const fallback = await DispatchRepository.create()
    repositories.push(fallback)
    const fallbackMachine = await fallback.machine(await fallback.sliceFallbackOutput())
    await expect(fallbackMachine.dispatch(fallback.watch(), DispatchRepository.TICKET))
      .rejects.toThrow(/unsupported slice-agent reconciliation/)
    expect(await fallback.material()).toBeNull()
  })

  it('a sealed dispatch refuses changed or missing input material', async () => {
    const repository = await DispatchRepository.create()
    repositories.push(repository)
    const stdout = await repository.output('implement')
    const machine = await repository.machine(stdout)
    const dispatch = await machine.dispatch(repository.watch(), DispatchRepository.TICKET)
    const changed = ProducerOutput.path(stdout, "  - the task's brief: ")
    expect(dispatch.paths).toContain(changed)
    const original = await readFile(changed)

    await writeFile(changed, 'changed bytes\n')
    await expect(machine.dispatch(repository.watch(), DispatchRepository.TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    await writeFile(changed, original)
    await rm(changed)
    await expect(machine.dispatch(repository.watch(), DispatchRepository.TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
  })

  it('literal producer paths and the declared verdict glob retain their different meanings', async () => {
    const environment = new EnvironmentSnapshot(['TMPDIR'])
    const parent = await mkdtemp(join(tmpdir(), 'ct-[literal]*?-'))
    try {
      process.env.TMPDIR = parent
      const literal = await DispatchRepository.create()
      repositories.push(literal)
      const literalMachine = await literal.machine(await literal.output('implement'))
      const dispatch = await literalMachine.dispatch(literal.watch(), DispatchRepository.TICKET)
      expect(dispatch.paths.some((path) => path.includes('[literal]*?'))).toBe(true)

      environment.restore()
      if (environment.values.get('TMPDIR') === undefined) expect('TMPDIR' in process.env).toBe(false)
      else expect(process.env.TMPDIR).toBe(environment.values.get('TMPDIR'))

      const verdict = await DispatchRepository.create()
      repositories.push(verdict)
      const produced = await verdict.output('slice-judge')
      const relativeGlob = `docs/superpowers/verdicts/issue-${DispatchRepository.ISSUE}-task-*.json`
      const absoluteGlob = join(verdict.root, relativeGlob)
      const machine = await verdict.machine(produced.replace(relativeGlob, absoluteGlob))
      const globDispatch = await machine.dispatch(verdict.watch(), DispatchRepository.TICKET)
      expect(globDispatch.paths).toContain(absoluteGlob)
    } finally {
      environment.restore()
      await rm(parent, { recursive: true, force: true })
    }
    if (environment.values.get('TMPDIR') === undefined) expect('TMPDIR' in process.env).toBe(false)
    else expect(process.env.TMPDIR).toBe(environment.values.get('TMPDIR'))
  })

  it('conflicting response announcements and duplicate consuming commands are refused before sealing', async () => {
    const conflicting = await DispatchRepository.create()
    repositories.push(conflicting)
    const produced = await conflicting.output('implement')
    const announced = ProducerOutput.path(produced, '  - that it write its report to: ')
    const conflictMachine = await conflicting.machine(produced.replace(announced, `${announced}.other`))
    await expect(conflictMachine.dispatch(conflicting.watch(), DispatchRepository.TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await conflicting.material()).toBeNull()

    const duplicate = await DispatchRepository.create()
    repositories.push(duplicate)
    const duplicateOutput = await duplicate.output('implement')
    const command = duplicateOutput.split('\n').find((line) => line.startsWith('When it comes back:'))
    if (command === undefined) throw new Error('producer output lacks a consuming command')
    const conflictingCommand = command
      .replace('task-1-report.json', 'wrong-report.json')
      .replace(DispatchRepository.PLAN, 'docs/superpowers/plans/wrong.md')
      .replace('--issue 7', '--issue 999')
    const duplicateMachine = await duplicate.machine(`${conflictingCommand}\n${duplicateOutput}`)
    await expect(duplicateMachine.dispatch(duplicate.watch(), DispatchRepository.TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await duplicate.material()).toBeNull()

    const differentStructuredVerb = await DispatchRepository.create()
    repositories.push(differentStructuredVerb)
    const structuredOutput = await differentStructuredVerb.output('implement')
    const contradictoryVerdict = `When it comes back:  ct-step verdict other.json --plan ${DispatchRepository.PLAN} --issue 7`
    const structuredMachine = await differentStructuredVerb.machine(`${contradictoryVerdict}\n${structuredOutput}`)
    await expect(structuredMachine.dispatch(differentStructuredVerb.watch(), DispatchRepository.TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await differentStructuredVerb.material()).toBeNull()

    const differentEditsVerb = await DispatchRepository.create()
    repositories.push(differentEditsVerb)
    const editsOutput = await differentEditsVerb.output('reconcile')
    const contradictoryReport = `When it comes back:  ct-step report other.json --plan ${DispatchRepository.PLAN} --issue 7`
    const editsMachine = await differentEditsVerb.machine(`${contradictoryReport}\n${editsOutput}`)
    await expect(editsMachine.dispatch(differentEditsVerb.watch(), DispatchRepository.TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await differentEditsVerb.material()).toBeNull()

    const mismatchedRubric = await DispatchRepository.create()
    repositories.push(mismatchedRubric)
    const rubricOutput = await mismatchedRubric.output('implement')
    const declaredRubric = ProducerOutput.path(rubricOutput, '  - the rubric from ')
    const mismatchedMachine = await mismatchedRubric.machine(
      rubricOutput.replace(declaredRubric, join(mismatchedRubric.root, 'AGENTS.md')),
    )
    await expect(mismatchedMachine.dispatch(mismatchedRubric.watch(), DispatchRepository.TICKET))
      .rejects.toBeInstanceOf(RunNotUnderstood)
    expect(await mismatchedRubric.material()).toBeNull()
  })

  it('fixture setup failures restore absent and present environment values without leaked roots', async () => {
    const original = new EnvironmentSnapshot(['TMPDIR', 'PATH'])
    const parent = await mkdtemp(join(tmpdir(), 'ct-run-dispatch-environment-'))
    try {
      delete process.env.TMPDIR
      delete process.env.PATH
      const absent = new EnvironmentSnapshot(['TMPDIR', 'PATH'])
      process.env.TMPDIR = parent
      process.env.PATH = ''
      await expect(DispatchRepository.create()).rejects.toThrow()
      expect(await readdir(parent)).toEqual([])
      absent.restore()
      expect('TMPDIR' in process.env).toBe(false)
      expect('PATH' in process.env).toBe(false)

      original.restore()
      if (original.values.get('TMPDIR') === undefined) expect('TMPDIR' in process.env).toBe(false)
      else expect(process.env.TMPDIR).toBe(original.values.get('TMPDIR'))
      if (original.values.get('PATH') === undefined) expect('PATH' in process.env).toBe(false)
      else expect(process.env.PATH).toBe(original.values.get('PATH'))

      const present = new EnvironmentSnapshot(['TMPDIR', 'PATH'])
      process.env.TMPDIR = parent
      process.env.PATH = ''
      await expect(DispatchRepository.create()).rejects.toThrow()
      expect(await readdir(parent)).toEqual([])
      present.restore()
      expect(process.env.TMPDIR).toBe(present.values.get('TMPDIR'))
      expect(process.env.PATH).toBe(present.values.get('PATH'))
    } finally {
      original.restore()
      await rm(parent, { recursive: true, force: true })
    }
    if (original.values.get('TMPDIR') === undefined) expect('TMPDIR' in process.env).toBe(false)
    else expect(process.env.TMPDIR).toBe(original.values.get('TMPDIR'))
    if (original.values.get('PATH') === undefined) expect('PATH' in process.env).toBe(false)
    else expect(process.env.PATH).toBe(original.values.get('PATH'))
    await access(tmpdir())
  })
})
