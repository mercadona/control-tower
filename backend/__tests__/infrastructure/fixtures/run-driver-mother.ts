import { execFileSync, spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { issuesQueryFor } from '../../../../plugin/scripts/gh-issues.js'
import { RoleBytes } from '../../../../plugin/scripts/role-bytes.js'
import { STEPS } from '../../../../plugin/scripts/run-machine.js'
import { renderState } from '../../../../plugin/scripts/state.js'
import { RESPONSE_KINDS, RESPONSE_KIND_OF_STEP } from '../../../../plugin/scripts/step-announcement.js'
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
  VERDICT_RULES,
} from '../../../../plugin/scripts/step-contracts.js'
import { AgentDefinition } from '../../../../plugin/scripts/judge-agent-definition.js'
import { RecoverPlan, RecoverPlanParams } from '../../../src/application/actions/recover-plan.ts'
import { RunInstruction } from '../../../src/domain/value-objects/run-instruction.ts'
import { RunCalls } from '../../../src/domain/ports/run-calls.ts'
import { CheckoutRegistry } from '../../../src/domain/ports/checkout-registry.ts'
import { PlanAgents } from '../../../src/domain/ports/plan-agents.ts'
import { ReviewLog } from '../../../src/domain/ports/review-log.ts'
import { CompletedPlanCall, StartedPlanCall } from '../../../src/domain/value-objects/plan-call.ts'
import { ActivePlans } from '../../../src/infrastructure/active-plans-route.ts'
import { CallDescriptor, ClaudeCalls, StoredCompletion, type CallInvocation } from '../../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../../src/infrastructure/claude-plan-calls.ts'
import { ClaudeRunCalls } from '../../../src/infrastructure/claude-run-calls.ts'
import { ClaudeRunMeasurements } from '../../../src/infrastructure/claude-run-measurements.ts'
import { MeasuredAgentCalls } from '../../../src/infrastructure/measured-agent-calls.ts'
import { DiskAgentMeasurements } from '../../../src/infrastructure/disk-agent-measurements.ts'
import { DiskPlanRecords } from '../../../src/infrastructure/disk-plan-records.ts'
import { PlanAgentBrief } from '../../../src/infrastructure/plan-agent-brief.ts'
import { PlanSessions } from '../../../src/infrastructure/plan-sessions.ts'
import { RecordedPlanRecovery } from '../../../src/infrastructure/recorded-plan-recovery.ts'
import { ReviewWatch } from '../../../src/infrastructure/review-watch.ts'
import { RunPlanAgents, SilentChangeAnnouncements } from '../../../src/infrastructure/run-plan-agents.ts'
import { RunPlanRecovery } from '../../../src/infrastructure/run-plan-recovery.ts'
import { DriveRun, DriveRunParams } from '../../../src/application/actions/drive-run.ts'
import {
  ExecuteRunInstruction, ExecuteRunInstructionParams,
} from '../../../src/application/actions/execute-run-instruction.ts'
import { PlanPublication } from '../../../src/domain/ports/plan-publication.ts'
import { PlanIssue } from '../../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../../src/domain/value-objects/plan-watch.ts'
import { PlanBriefing } from '../../../src/domain/value-objects/plan-briefing.ts'
import { RepositoryName } from '../../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../../src/domain/value-objects/workspace-location.ts'
import type { RegisteredCheckout } from '../../../src/domain/value-objects/registered-checkout.ts'
import { CtRunMachine } from '../../../src/infrastructure/ct-run-machine.ts'
import type { LaunchedProcess, LaunchOptions, ProcessRunner } from '../../../src/infrastructure/process-runner.ts'
import { HeadlessFiles } from '../../../src/infrastructure/headless-files.ts'
import { RunJournal } from '../../../src/infrastructure/run-journal.ts'
import type { RunDispatch } from '../../../src/infrastructure/run-dispatch.ts'
import { ToolRunner } from '../../../src/infrastructure/tool-runner.ts'
import { SystemProcesses } from '../../../src/infrastructure/process-border.ts'
import { GhPlanPublication } from '../../../src/infrastructure/gh-plan-publication.ts'
import { PlanContractProgress } from '../../../src/infrastructure/plan-contract-progress.ts'
import { Gh } from '../../../src/infrastructure/gh.ts'
import { GhPlanIssues } from '../../../src/infrastructure/gh-plan-issues.ts'
import { UserStory } from '../../../src/domain/value-objects/user-story.ts'
import { UserStoryUrl } from '../../../src/domain/value-objects/user-story-url.ts'
import { RetryBudget, RetryPolicy } from '../../../src/domain/policies/retry-policy.ts'
import { DeliverHeldMessages } from '../../../src/application/actions/deliver-held-messages.ts'
import { ReadSliceEscalation } from '../../../src/application/queries/read-slice-escalation.ts'
import { SliceEscalations } from '../../../src/domain/ports/slice-escalations.ts'
import { SliceEscalation } from '../../../src/domain/value-objects/slice-escalation.ts'
import { CompletedRunDelivery } from '../../run-delivery-double.ts'

type CommandResult = { readonly code: number, readonly stdout: string, readonly stderr: string }
export type ModelCapture = {
  readonly callId: string,
  readonly role: string,
  readonly conversation: string,
  readonly argv: readonly string[],
  readonly prompt: string,
  readonly paths: readonly string[],
  readonly sha256: readonly (string | null)[],
}
type DispatchCapture = {
  readonly role: string,
  readonly paths: readonly string[],
  readonly sha256: readonly string[],
  readonly argv: readonly string[],
  readonly response:
    | { readonly kind: 'file' | 'structured', readonly path: string }
    | { readonly kind: 'edits' },
}
type ProducerCapture = DispatchCapture & { readonly ticket: string, readonly invocationArgv: readonly string[] }
type RoleCrossing = {
  readonly producer: ProducerCapture,
  readonly consumer: ModelCapture,
  readonly requestId: string,
}
type FixProjection = {
  readonly phase: string,
  readonly diagnostic?: string,
  readonly recovery?: { readonly action: string, readonly detail: string },
  readonly watching: boolean,
  readonly calls: number,
  readonly verbs: number,
}

class QuietEscalations extends SliceEscalations {
  static reader(): ReadSliceEscalation {
    return new ReadSliceEscalation({ escalations: new QuietEscalations() })
  }

  override async of(): Promise<SliceEscalation> {
    return SliceEscalation.none()
  }

  override async lift(): Promise<void> {
    return undefined
  }
}

class FixtureProcesses {
  readonly spawn: typeof spawn
  readonly #captures: string
  readonly #children = new Map<ChildProcess, Promise<void>>()
  readonly #groups = new Set<number>()
  readonly #barriers = new Set<() => void>()
  #accepting = true
  #draining: Promise<void> | null = null

  constructor(captures: string) {
    this.#captures = captures
    this.spawn = new Proxy(spawn, {
      apply: (target, thisArgument, argumentsList) => {
        if (!this.#accepting) throw new Error('fixture process owner is draining')
        const child = Reflect.apply(target, thisArgument, argumentsList)
        this.#register(child, FixtureProcesses.#detached(argumentsList[2]))
        return child
      },
    })
  }

  launch(binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess {
    return this.spawn(binary, [...argv], {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      detached: options.detached,
      stdio: [...options.stdio],
    })
  }

  barrier(): {
    readonly reached: Promise<void>,
    readonly release: () => void,
    readonly cancel: (cause: Error) => void,
  } {
    let finish!: () => void
    let fail!: (cause: Error) => void
    const reached = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
    const release = (): void => {
      this.#barriers.delete(release)
      finish()
    }
    const cancel = (cause: Error): void => {
      this.#barriers.delete(release)
      fail(cause)
    }
    this.#barriers.add(release)
    return Object.freeze({ reached, release, cancel })
  }

  hold(): number {
    const child = this.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true, stdio: 'ignore',
    })
    if (child.pid === undefined) throw new Error('owned fixture process has no pid')
    return child.pid
  }

  async stop(child: ChildProcess): Promise<void> {
    const pids = new Set(FixtureProcesses.#descendants(child.pid))
    if (child.pid !== undefined) pids.add(child.pid)
    await this.#terminate(pids, new Set([...pids, ...this.#groups]))
    const closed = this.#children.get(child)
    if (closed !== undefined) await FixtureProcesses.#bounded(closed, 'fixture process did not close')
  }

  drain(): Promise<void> {
    if (this.#draining !== null) return this.#draining
    this.#draining = this.#drain()
    return this.#draining
  }

  drained(pid: number): boolean {
    return !FixtureProcesses.#alive(pid) && !FixtureProcesses.#alive(-pid)
  }

  async #drain(): Promise<void> {
    this.#accepting = false
    for (const release of [...this.#barriers]) release()
    const pids = new Set<number>()
    for (const child of this.#children.keys()) {
      for (const descendant of FixtureProcesses.#descendants(child.pid)) pids.add(descendant)
      if (child.pid !== undefined) pids.add(child.pid)
    }
    const groups = new Set([...this.#groups, ...await this.#modelGroups(), ...pids])
    await this.#terminate(pids, groups)
    await FixtureProcesses.#bounded(Promise.all(this.#children.values()).then(() => {}), 'owned fixture processes did not close')
    const alive = [...new Set([...pids, ...groups])].filter((pid) => (
      FixtureProcesses.#alive(pid) || FixtureProcesses.#alive(-pid)
    ))
    if (alive.length > 0) throw new Error(`owned fixture process groups survived disposal: ${alive.join(', ')}`)
  }

  async #terminate(pids: ReadonlySet<number>, groups: ReadonlySet<number>): Promise<void> {
    for (const group of groups) FixtureProcesses.#signal(-group, 'SIGTERM')
    for (const pid of pids) FixtureProcesses.#signal(pid, 'SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 250))
    for (const group of groups) FixtureProcesses.#signal(-group, 'SIGKILL')
    for (const pid of pids) FixtureProcesses.#signal(pid, 'SIGKILL')
  }

  async #modelGroups(): Promise<readonly number[]> {
    try {
      const text = await readFile(join(this.#captures, 'processes.jsonl'), 'utf8')
      return text.split('\n').filter(Boolean).map((line) => {
        const value: unknown = JSON.parse(line)
        if (value === null || typeof value !== 'object' || !('pid' in value)
          || typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid < 1) {
          throw new Error(`model process evidence is malformed: ${line}`)
        }
        return value.pid
      })
    } catch (cause) {
      if (RunDriverMother.hasCode(cause, 'ENOENT')) return []
      throw cause
    }
  }

  #register(child: ChildProcess, detached: boolean): void {
    if (detached && child.pid !== undefined) this.#groups.add(child.pid)
    const closed = new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      child.once('close', finish)
      child.once('exit', finish)
      child.once('error', finish)
    })
    this.#children.set(child, closed)
  }

  static #detached(options: unknown): boolean {
    return options !== null && typeof options === 'object' && 'detached' in options && options.detached === true
  }

  static #descendants(pid: number | undefined): number[] {
    if (pid === undefined) return []
    const result = spawnSync('pgrep', ['-P', String(pid)], {
      encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL',
    })
    if (result.status !== 0) return []
    return result.stdout.split('\n').filter(Boolean).map(Number)
      .flatMap((child) => [child, ...FixtureProcesses.#descendants(child)])
  }

  static #signal(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(pid, signal)
    } catch (cause) {
      if (!RunDriverMother.hasCode(cause, 'ESRCH')) throw cause
    }
  }

  static #alive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (cause) {
      if (RunDriverMother.hasCode(cause, 'ESRCH')) return false
      throw cause
    }
  }

  static async #bounded(completion: Promise<void>, diagnostic: string): Promise<void> {
    let expired!: () => void
    const timeout = new Promise<void>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(diagnostic)), 2_000)
      expired = () => clearTimeout(timer)
    })
    try {
      await Promise.race([completion, timeout])
    } finally {
      expired()
    }
  }
}

class RuntimeProcess {
  static readonly #ENTRYPOINT = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'infrastructure', 'ct-api.ts',
  )
  readonly child: ChildProcess
  readonly port: Promise<number>
  stderr = ''

  readonly #processes: FixtureProcesses

  constructor(environment: NodeJS.ProcessEnv, processes: FixtureProcesses) {
    this.#processes = processes
    this.child = processes.spawn(process.execPath, [RuntimeProcess.#ENTRYPOINT], {
      env: { ...process.env, CT_STATE_DIR: undefined, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.port = this.#port()
  }

  async stop(): Promise<void> {
    await this.#processes.stop(this.child)
  }

  async #port(): Promise<number> {
    let stdout = ''
    this.child.stderr?.on('data', (chunk) => { this.stderr += String(chunk) })
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`API did not listen: ${this.stderr}`)), 30_000)
      const fail = (cause: unknown): void => {
        clearTimeout(timer)
        reject(cause)
      }
      this.child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
        const end = stdout.indexOf('\n')
        if (end < 0) return
        clearTimeout(timer)
        resolve((JSON.parse(stdout.slice(0, end)) as { port: number }).port)
      })
      this.child.once('error', fail)
      this.child.once('close', (code) => fail(new Error(`API exited ${String(code)}: ${this.stderr}`)))
    })
  }

}

class RecoveryReviews extends ReviewWatch {
  started = 0
  stopped = 0

  constructor() {
    super({
      asked: async () => ({ changes: [] }), review: async () => {}, sleep: async () => {}, stderr: () => {},
      label: 'real process recovery fixture', log: new ReviewLog(),
    })
  }

  override startRecovered(): Promise<void> {
    this.started += 1
    return new Promise(() => {})
  }

  override stop(): void {
    this.stopped += 1
  }
}

class RecoveryCheckouts extends CheckoutRegistry {
  override remember(_checkout: RegisteredCheckout): void {}
}

export class RunDriverMother {
  static measured(executor: ClaudeCalls, files: HeadlessFiles): MeasuredAgentCalls<CallInvocation, CallDescriptor> {
    return new MeasuredAgentCalls({
      executor, reader: new ClaudeRunMeasurements({ files }), store: new DiskAgentMeasurements({ files }),
    })
  }

  static readonly ISSUE = 7
  static readonly REPOSITORY = 'acme/widget'
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly PLAN = 'docs/superpowers/plans/2026-09-17-issue-7-driver.md'
  static readonly #HERE = dirname(fileURLToPath(import.meta.url))
  static readonly #ROOT = join(RunDriverMother.#HERE, '..', '..', '..', '..')
  static readonly #PLUGIN = join(RunDriverMother.#ROOT, 'plugin')
  static readonly #CT_STEP = join(RunDriverMother.#PLUGIN, 'scripts', 'ct-step.mjs')
  static readonly #DISPATCH_CHECK = join(RunDriverMother.#PLUGIN, 'scripts', 'dispatch-check.mjs')
  static readonly #PROCESSES = new SystemProcesses()
  static readonly #PLAN_TEXT = [
    '# #7 - Finite run driver rehearsal', '',
    '> **Task-scoped subagents execute this plan. They arrive with no context.**', '',
    '### Desired end state', '', '- The real machine delivers the one task.', '',
    '### Out of scope', '', '- Network access.', '',
    '## 1. Context and goal', '', 'Exercise the finite producer-consumer graph.', '',
    '## 2. Closed decisions (take as given)', '',
    '| Decision | Exact choice |', '|---|---|', '| Fixture | Use actual CT verbs. |', '',
    '## 3. Reference patterns', '', 'Files to imitate:', '- `AGENTS.md`', '',
    'Rules to obey:', '- `AGENTS.md`', '',
    '## 4. Inventory', '', '- `work.txt` contains the fixture baseline.', '',
    '## 5. Interfaces', '', 'N/A - no public interface.', '',
    '## 6. Test strategy', '', 'The verification reads the produced bytes.', '',
    '## 7. Tasks', '', '### Task 1 — Produce fixture work', '',
    '**Objective:** Replace the fixture work.', '',
    '**Files:** `work.txt` (modify).', '',
    '**TDD:** No TDD - integration fixture.', '',
    '**Tests:** N/A - integration fixture.', '',
    'No code — the fixture task changes declared text only.', '',
    '**Verification:**', '```bash', "test \"$(cat work.txt)\" = 'synthetic model response'", '```', '',
    '## 8. Global verification', '', '```bash', "test \"$(cat work.txt)\" = 'synthetic model response'", '```', '',
    '## 9. Assumptions', '', '- Git and Node are available locally.', '',
  ].join('\n')

  readonly base: string
  readonly checkout: string
  readonly origin: string
  readonly state: string
  readonly bin: string
  readonly captures: string
  readonly publication: string
  readonly files: HeadlessFiles
  readonly journal: RunJournal
  readonly watch: PlanWatch
  readonly machine: CtRunMachine
  readonly #processes: FixtureProcesses
  #runtime: RuntimeProcess | null = null
  #disposal: Promise<void> | null = null
  #nextIdentity = 1

  private constructor(asked: {
    base: string,
    checkout: string,
    origin: string,
    state: string,
    bin: string,
    captures: string,
    publication: string,
  }) {
    this.base = asked.base
    this.checkout = asked.checkout
    this.origin = asked.origin
    this.state = asked.state
    this.bin = asked.bin
    this.captures = asked.captures
    this.publication = asked.publication
    this.#processes = new FixtureProcesses(this.captures)
    this.files = new HeadlessFiles({ root: this.state, fs, newId: () => this.#identity() })
    this.journal = new RunJournal({
      files: this.files,
      newId: () => this.#identity(),
      now: () => { throw new Error('the journal clock is not asked') },
    })
    this.watch = new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: RunDriverMother.ISSUE, url: 'https://github.com/acme/widget/issues/7' }),
      located: new WorkspaceLocation({ root: this.checkout, path: this.checkout, branch: 'feat/7' }),
      repository: new RepositoryName(RunDriverMother.REPOSITORY),
      agent: RunDriverMother.CONVERSATION,
    })
    const oracle = new ToolRunner({ bin: process.execPath, budgetMs: 30_000, processes: RunDriverMother.#PROCESSES, signal: RunDriverMother.#PROCESSES.signal.bind(RunDriverMother.#PROCESSES) })
    const git = new ToolRunner({ bin: 'git', budgetMs: 30_000, processes: RunDriverMother.#PROCESSES, signal: RunDriverMother.#PROCESSES.signal.bind(RunDriverMother.#PROCESSES) })
    this.machine = new CtRunMachine({
      journal: this.journal,
      node: oracle.runWholeOutput.bind(oracle),
      git: git.runWholeOutput.bind(git),
      read: async (path) => readFile(path, 'utf8').catch((cause: unknown) => {
        if (RunDriverMother.hasCode(cause, 'ENOENT')) return null
        throw cause
      }),
      ctStep: RunDriverMother.#CT_STEP,
      dispatchCheck: RunDriverMother.#DISPATCH_CHECK,
      pluginRoot: RunDriverMother.#PLUGIN,
    })
  }

  static async ready(): Promise<RunDriverMother> {
    return RunDriverMother.#create(false)
  }

  static async conflictingBase(): Promise<RunDriverMother> {
    return RunDriverMother.#create(true)
  }

  static async #create(conflicting: boolean): Promise<RunDriverMother> {
    const temporaryRoot = await fs.realpath(tmpdir())
    const base = await mkdtemp(join(temporaryRoot, 'ct-run-driver-mother-'))
    const fixture = new RunDriverMother({
      base,
      checkout: join(base, 'checkout'),
      origin: join(base, 'origin.git'),
      state: join(base, 'state'),
      bin: join(base, 'bin'),
      captures: join(base, 'captures'),
      publication: join(base, 'publication.md'),
    })
    try {
      await fixture.#initialize(conflicting)
      return fixture
    } catch (cause) {
      try {
        await fixture.dispose()
      } catch (drainFailure) {
        throw new AggregateError([cause, drainFailure], 'fixture setup and disposal failed')
      }
      throw cause
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposal !== null) return this.#disposal
    this.#disposal = this.#dispose()
    return this.#disposal
  }

  holdOwnedProcess(): number {
    return this.#processes.hold()
  }

  disposedWith(pid: number): boolean {
    return !existsSync(this.base) && this.#processes.drained(pid)
  }

  async #dispose(): Promise<void> {
    await this.#processes.drain()
    this.#runtime = null
    await rm(this.base, { recursive: true, force: true })
  }

  async consumeStaleTicket(): Promise<{ code: number, instruction: RunInstruction }> {
    await this.journal.admit(this.watch)
    const instruction = await this.machine.open(this.watch)
    if (instruction.work.kind !== 'call') throw new Error('first real oracle instruction was not implement')
    const dispatch = await this.machine.dispatch(this.watch, instruction.work.ticket)
    if (dispatch.response.kind !== 'structured') throw new Error('implement dispatch did not request a response')
    await writeFile(join(this.checkout, 'work.txt'), 'synthetic model response\n')
    await writeFile(dispatch.response.path, `${JSON.stringify({
      paths: ['work.txt'], summary: 'Synthetic model response for stale-ticket rehearsal.',
    })}\n`)
    const competing = this.#step('report', dispatch.response.path)
    if (competing.code !== 0) throw new Error(competing.stderr)
    const stale = await this.machine.advance(this.watch, instruction)
    const entries = await this.journal.entries(this.watch)
    const receipt = entries.at(-1)?.receipt
    const last = JSON.parse(receipt?.kind === 'present' ? receipt.text : '{}') as { code?: number }
    return { code: last.code ?? -1, instruction: stale }
  }

  async reachThirdAttempt(): Promise<{
    advicePackage: string, thirdBrief: string, approach: string, advisor: RoleCrossing,
  }> {
    await this.journal.admit(this.watch)
    await this.#modelExecutable()
    const calls = this.#runCalls('veto')
    let instruction = await this.machine.open(this.watch)
    let advicePackage = ''
    let advisor: ProducerCapture | null = null
    for (;;) {
      if (instruction.work.kind === 'call') {
        const dispatch = await this.machine.dispatch(this.watch, instruction.work.ticket)
        if (dispatch.role === 'advise') {
          advisor = await this.#producer(instruction.work.ticket, dispatch)
          advicePackage = await readFile(dispatch.paths[0], 'utf8')
        }
        if (dispatch.role === 'implement' && advicePackage.length > 0) {
          const brief = dispatch.paths.find((path) => !path.startsWith(RunDriverMother.#PLUGIN))
          if (brief === undefined) throw new Error('third implement dispatch omitted its task brief')
          const approach = 'Use the exact fixture bytes and preserve the declared task scope.'
          if (advisor === null) throw new Error('advisor producer material was not captured')
          return {
            advicePackage, thirdBrief: await readFile(brief, 'utf8'), approach,
            advisor: await this.#crossing(advisor),
          }
        }
      }
      instruction = await calls.step.execute(new ExecuteRunInstructionParams({ watch: this.watch, instruction }))
      RunDriverMother.#requireAdvance(instruction)
    }
  }

  async reconcileConflict(): Promise<{
    packagePath: string,
    package: string,
    promptPaths: readonly string[],
    conflictBytes: string,
    stagedTaskDiff: string,
    sliceDiff: string,
    delivered: string,
    reconciler: RoleCrossing,
  }> {
    await this.journal.admit(this.watch)
    await this.#modelExecutable()
    const calls = this.#runCalls('reconcile')
    let instruction = await this.machine.open(this.watch)
    await this.#advanceBase()
    let stagedTaskDiff = ''
    let packagePath = ''
    let packageText = ''
    let conflictBytes = ''
    let promptPaths: readonly string[] = []
    let reconciler: ProducerCapture | null = null
    for (;;) {
      if (instruction.work.kind === 'command' && stagedTaskDiff.length === 0) {
        const ticket = instruction.work.ticket
        const entries = await this.journal.entries(this.watch)
        const entry = entries.find((candidate) => candidate.ticket === ticket)
        const request = JSON.parse(entry?.request ?? '{}') as { argv?: string[] }
        if (request.argv?.[1] === 'controls') {
          stagedTaskDiff = this.#git('diff', '--cached', '-U10')
        }
      }
      if (instruction.work.kind === 'call') {
        const dispatch = await this.machine.dispatch(this.watch, instruction.work.ticket)
        if (dispatch.role === 'judge' && stagedTaskDiff.length === 0) {
          stagedTaskDiff = this.#git('diff', '--cached', '-U10', this.#baseSha())
        }
        if (dispatch.role === 'reconcile') {
          reconciler = await this.#producer(instruction.work.ticket, dispatch)
          packagePath = dispatch.paths[0]
          packageText = await readFile(packagePath, 'utf8')
          conflictBytes = await readFile(join(this.checkout, 'work.txt'), 'utf8')
        }
      }
      const next = await calls.step.execute(new ExecuteRunInstructionParams({ watch: this.watch, instruction }))
      RunDriverMother.#requireAdvance(next)
      if (next.work.kind === 'delivered') {
        if (reconciler === null) throw new Error('reconciler producer material was not captured')
        const crossing = await this.#crossing(reconciler)
        promptPaths = crossing.consumer.paths
        const entries = await this.journal.entries(this.watch)
        const receipt = entries.at(-1)?.receipt
        const delivered = JSON.parse(receipt?.kind === 'present' ? receipt.text : '{}') as { stdout?: string }
        return {
          packagePath, package: packageText, promptPaths, conflictBytes, stagedTaskDiff,
          sliceDiff: this.#git('diff', '-U10', this.#baseSha(), 'HEAD'), delivered: delivered.stdout ?? '',
          reconciler: crossing,
        }
      }
      instruction = next
    }
  }

  async observeWithoutMeasurements(conversation: string): Promise<readonly string[]> {
    if (this.#runtime === null) throw new Error('the fixture backend is not running')
    const directory = join(this.state, 'control-tower', 'harness', conversation, 'calls')
    const names = await readdir(directory)
    for (const name of names) await rm(join(directory, name, 'agent-measurements-v1.json'))
    const port = await this.#runtime.port
    for (let observation = 0; observation < 2; observation += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/active-plans`)
      const body = await response.text()
      if (response.status !== 200) throw new Error(`active-plans answered ${response.status}: ${body}`)
    }
    const regenerated: string[] = []
    for (const name of names) {
      if ((await readdir(join(directory, name))).includes('agent-measurements-v1.json')) regenerated.push(name)
    }
    return regenerated
  }

  async deliverThroughApi(): Promise<{
    admission: { conversation: string },
    conversations: string[],
    roles: string[],
    callIds: string[],
    requests: string[],
    commonMeasurements: string[],
    modelCalls: ModelCapture[],
    attemptSteps: string[],
    consumingSteps: string[],
    dispatches: DispatchCapture[],
    pullRequestRefusals: string[],
    delivered: string,
    publication: string,
  }> {
    this.#git('switch', '-q', 'main')
    this.#git('branch', '-D', 'feat/7')
    await rm(join(this.checkout, '.agent', 'SLICE.md'))
    this.#git('add', '-u')
    this.#git('commit', '-q', '-m', 'leave slice state to the production seed')
    this.#git('push', '-q', 'origin', 'main')
    await this.#modelExecutable()
    const pullRequestRefusals = this.#pullRequestRefusals()
    const runtime = new RuntimeProcess({
      CT_API_PORT: '0',
      CLAUDE_CONFIG_DIR: this.state,
      SHELL: '/bin/sh',
      PATH: `${this.bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      CT_FIXTURE_CAPTURES: this.captures,
      CT_FIXTURE_PUBLICATION: this.publication,
    }, this.#processes)
    this.#runtime = runtime
    const port = await runtime.port
    const response = await fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'https://github.com/acme/widget/issues/1',
        repo: RunDriverMother.REPOSITORY,
        path: this.checkout,
      }),
    })
    const responseText = await response.text()
    if (response.status !== 202) throw new Error(`start-plan answered ${response.status}: ${responseText}`)
    const started = JSON.parse(responseText) as { agent: string, worktree: string }
    const harness = join(this.state, 'control-tower', 'harness', started.agent)
    const delivered = await RunDriverMother.#until(async () => {
      try {
        const operations = await readdir(join(harness, 'run', 'operations'))
        for (const ticket of operations) {
          const receipt = JSON.parse(
            await readFile(join(harness, 'run', 'operations', ticket, 'receipt.json'), 'utf8'),
          ) as { stdout: string }
          if (receipt.stdout.includes('"kind":"transition","state":"delivered"')) return receipt.stdout
        }
        return null
      } catch (cause) {
        if (RunDriverMother.hasCode(cause, 'ENOENT')) return null
        throw cause
      }
    }, () => `runtime did not deliver: ${runtime.stderr}`)
    const admission = JSON.parse(await readFile(join(harness, 'run', 'admission.json'), 'utf8')) as {
      conversation: string,
    }
    const callIds = (await readdir(join(harness, 'calls'))).sort()
    const calls = await Promise.all(callIds.map(async (id) => ({
      id,
      descriptor: JSON.parse(await readFile(join(harness, 'calls', id, 'call.json'), 'utf8')) as {
        conversation: string, purpose: string, requestId: string | null, argv: string[],
      },
    })))
    const operationNames = await readdir(join(harness, 'run', 'operations'))
    const operations = await Promise.all(operationNames.map(async (ticket) => ({
      ticket,
      request: JSON.parse(await readFile(join(harness, 'run', 'operations', ticket, 'request.json'), 'utf8')) as {
        previous: string | null,
      },
    })))
    const order = new Map<string, number>()
    let previous: string | null = null
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations.find((candidate) => candidate.request.previous === previous)
      if (operation === undefined) break
      order.set(operation.ticket, index)
      previous = operation.ticket
    }
    const implementations = calls.filter((call) => call.descriptor.purpose === 'implementation')
      .sort((left, right) => (
        (order.get(left.descriptor.requestId?.slice('run:'.length) ?? '') ?? Number.MAX_SAFE_INTEGER)
        - (order.get(right.descriptor.requestId?.slice('run:'.length) ?? '') ?? Number.MAX_SAFE_INTEGER)
      ))
    const roles = implementations.map((call) => {
      const at = call.descriptor.argv.indexOf('--agent')
      if (at < 0) return 'implement'
      if (call.descriptor.argv[at + 1] === 'ct-judge') return 'judge'
      if (call.descriptor.argv[at + 1] === 'ct-slice-judge') return 'slice-judge'
      throw new Error(`unexpected model role: ${JSON.stringify(call.descriptor.argv)}`)
    })
    const commonMeasurements = await Promise.all(calls.map((call) =>
      readFile(join(harness, 'calls', call.id, 'agent-measurements-v1.json'), 'utf8'),
    ))
    const metrics = await readFile(
      join(started.worktree, 'docs', 'superpowers', 'metrics', `issue-${RunDriverMother.ISSUE}.jsonl`),
      'utf8',
    )
    const attemptSteps = metrics.trim().split('\n').filter(Boolean).map((line) => (
      JSON.parse(line) as { step: string }
    ).step)
    const verbSteps = new Map([
      ['report', 'implement'], ['controls', 'controls'], ['verdict', 'judge'], ['reconcile', 'reconcile'],
      ['global', 'global'], ['slice-verdict', 'slice-judge'],
    ])
    const orderedOperations = [...operations].sort((left, right) => (
      (order.get(left.ticket) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.ticket) ?? Number.MAX_SAFE_INTEGER)
    ))
    const consumingSteps = orderedOperations.flatMap((operation) => {
      const request = JSON.parse(readFileSync(
        join(harness, 'run', 'operations', operation.ticket, 'request.json'), 'utf8',
      )) as { argv: string[] }
      const step = verbSteps.get(request.argv[1])
      return step === undefined ? [] : [step]
    })
    const modelCalls = (await readFile(join(this.captures, 'model.jsonl'), 'utf8')).trim().split('\n')
      .filter(Boolean).map((line) => RunDriverMother.#modelCapture(line))
    const dispatches = await Promise.all(implementations.map(async (call) => {
      const ticket = call.descriptor.requestId?.slice('run:'.length) ?? ''
      return JSON.parse(await readFile(join(harness, 'run', 'operations', ticket, 'material.json'), 'utf8')) as DispatchCapture
    }))
    return {
      admission,
      conversations: [...new Set(implementations.map((call) => call.descriptor.conversation))],
      roles,
      callIds: implementations.map((call) => call.id),
      requests: implementations.map((call) => call.descriptor.requestId ?? ''),
      commonMeasurements,
      modelCalls,
      attemptSteps,
      consumingSteps,
      dispatches,
      pullRequestRefusals,
      delivered,
      publication: await readFile(this.publication, 'utf8'),
    }
  }

  async recoverCompletedResponses(): Promise<ReadonlyArray<{
    kind: string, publications: number, launches: number, consumptions: number,
  }>> {
    const outcomes: Array<{ kind: string, publications: number, launches: number, consumptions: number }> = []
    for (const kind of ['rewritten-citation', 'dirty-scope-amendment'] as const) {
      const fixture = await RunDriverMother.ready()
      try {
        await fixture.#modelExecutable()
        const records = new DiskPlanRecords({
          files: fixture.files, newId: () => fixture.#identity(), now: () => new Date().toISOString(),
          exists: async (path) => existsSync(path),
        })
        const watch = await records.prepare(new PlanBriefing({
          story: null, issue: fixture.watch.issue, located: fixture.watch.located,
          repository: fixture.watch.repository,
        }))
        const initial = fixture.#graph({ files: fixture.files, records, machine: fixture.machine, scenario: 'pass' })
        await fixture.journal.admit(watch)
        const planner = await initial.planCalls.start(watch, 'plan', null)
        await initial.planCalls.wait(planner)
        let completedTicket = ''
        const cutCalls = new class extends RunCalls {
          override async perform(cutWatch: PlanWatch, instruction: RunInstruction): Promise<void> {
            await initial.runCalls.perform(cutWatch, instruction)
            if (instruction.work.kind === 'call') completedTicket = instruction.work.ticket
            throw new Error('labelled fixture cut after completed role')
          }
        }()
        const establishing = new DriveRun({
          calls: initial.planCalls,
          publication: fixture.#publication(fixture.files),
          machine: fixture.machine,
          delivery: new CompletedRunDelivery(),
          step: new ExecuteRunInstruction({ machine: fixture.machine, calls: cutCalls }),
          messages: new DeliverHeldMessages({
            messages: fixture.journal,
            calls: initial.planCalls,
            escalations: new QuietEscalations(),
          }),
          escalations: QuietEscalations.reader(),
        })
        await establishing.execute(new DriveRunParams({ watch, planner })).catch((cause: unknown) => {
          if (!(cause instanceof Error) || cause.message !== 'labelled fixture cut after completed role') throw cause
        })
        if (completedTicket.length === 0) throw new Error('recovery cut did not complete a role')
        const callsDirectory = join(fixture.state, 'harness', watch.agent, 'calls')
        const launchesBeforeRecovery = (await readdir(callsDirectory)).length
        if (kind === 'rewritten-citation') {
          await writeFile(join(fixture.checkout, 'AGENTS.md'), '# Rewritten cited source span\n')
        } else {
          const planPath = join(fixture.checkout, RunDriverMother.PLAN)
          const plan = await readFile(planPath, 'utf8')
          await writeFile(planPath, plan.replace(
            '**Files:** `work.txt` (modify).',
            '**Files:** `work.txt` (modify), `AGENTS.md` (modify).',
          ))
        }
        const publicationsBefore = await fixture.#publicationCount()
        const rebuiltFiles = new HeadlessFiles({ root: fixture.state, fs, newId: () => fixture.#identity() })
        const rebuiltJournal = new RunJournal({
          files: rebuiltFiles,
          newId: () => fixture.#identity(),
          now: () => { throw new Error('the journal clock is not asked') },
        })
        const rebuiltRecords = new DiskPlanRecords({
          files: rebuiltFiles, newId: () => fixture.#identity(), now: () => new Date().toISOString(),
          exists: async (path) => existsSync(path),
        })
        const rebuiltMachine = fixture.#machine(rebuiltFiles, rebuiltJournal)
        const rebuilt = fixture.#graph({
          files: rebuiltFiles, records: rebuiltRecords, machine: rebuiltMachine, scenario: 'pass',
        })
        const nextRoleGate = fixture.#processes.barrier()
        const recoveryCalls = new class extends RunCalls {
          override async perform(recoveryWatch: PlanWatch, instruction: RunInstruction): Promise<void> {
            if (instruction.work.kind !== 'call' || instruction.work.ticket !== completedTicket) {
              nextRoleGate.release()
              throw new Error('labelled fixture cut before the next role')
            }
            await rebuilt.runCalls.perform(recoveryWatch, instruction)
          }
        }()
        const driver = new DriveRun({
          calls: rebuilt.planCalls,
          publication: fixture.#publication(rebuiltFiles),
          machine: rebuiltMachine,
          delivery: new CompletedRunDelivery(),
          step: new ExecuteRunInstruction({ machine: rebuiltMachine, calls: recoveryCalls }),
          messages: new DeliverHeldMessages({
            messages: rebuiltJournal,
            calls: rebuilt.planCalls,
            escalations: new QuietEscalations(),
          }),
          escalations: QuietEscalations.reader(),
        })
        const agents = new RunPlanAgents({
          legacy: new PlanAgents(), records: rebuiltRecords, calls: rebuilt.planCalls,
          transport: rebuilt.transport, driver, machine: rebuiltMachine, journal: rebuiltJournal,
          delivery: new CompletedRunDelivery(),
          newId: () => fixture.#identity(), nowMs: Date.now,
          announcements: new SilentChangeAnnouncements(),
          stderr: (line) => nextRoleGate.cancel(new Error(line.trim())),
        })
        const recover = new RecoverPlan({ agents })
        const params = new RecoverPlanParams({ agent: watch.agent, issue: watch.issue.number, repository: watch.repository })
        await recover.execute(params)
        await recover.execute(params)
        await nextRoleGate.reached
        const entries = await rebuiltJournal.entries(watch)
        const consumptions = entries.filter((entry) => {
          const request = JSON.parse(entry.request) as { argv: string[] }
          return request.argv[1] === 'report'
        }).length
        const launchesAfterRecovery = (await readdir(callsDirectory)).length
        outcomes.push({
          kind,
          publications: await fixture.#publicationCount() - publicationsBefore,
          launches: launchesAfterRecovery - launchesBeforeRecovery,
          consumptions,
        })
      } finally {
        await fixture.dispose()
      }
    }
    return outcomes
  }

  async recoverLaterFixes(): Promise<{
    failed: FixProjection,
    successful: FixProjection,
  }> {
    await this.deliverThroughApi()
    const runtime = this.#runtime
    this.#runtime = null
    if (runtime !== null) await runtime.stop()
    const sourceState = join(this.state, 'control-tower')
    const failedState = join(this.base, 'failed-state')
    const successfulState = join(this.base, 'successful-state')
    await fs.cp(sourceState, failedState, { recursive: true })
    await fs.cp(sourceState, successfulState, { recursive: true })
    return {
      failed: await this.#recoverFix(failedState, false),
      successful: await this.#recoverFix(successfulState, true),
    }
  }

  #machine(files: HeadlessFiles, journal: RunJournal): CtRunMachine {
    const oracle = new ToolRunner({ bin: process.execPath, budgetMs: 30_000, processes: RunDriverMother.#PROCESSES, signal: RunDriverMother.#PROCESSES.signal.bind(RunDriverMother.#PROCESSES) })
    const git = new ToolRunner({ bin: 'git', budgetMs: 30_000, processes: RunDriverMother.#PROCESSES, signal: RunDriverMother.#PROCESSES.signal.bind(RunDriverMother.#PROCESSES) })
    return new CtRunMachine({
      journal,
      node: oracle.runWholeOutput.bind(oracle), git: git.runWholeOutput.bind(git),
      read: async (path) => readFile(path, 'utf8').catch((cause: unknown) => {
        if (RunDriverMother.hasCode(cause, 'ENOENT')) return null
        throw cause
      }),
      ctStep: RunDriverMother.#CT_STEP, dispatchCheck: RunDriverMother.#DISPATCH_CHECK,
      pluginRoot: RunDriverMother.#PLUGIN,
    })
  }

  #graph(asked: {
    files: HeadlessFiles,
    records: DiskPlanRecords,
    machine: CtRunMachine,
    scenario: 'veto' | 'reconcile' | 'pass',
  }): {
    transport: MeasuredAgentCalls<CallInvocation, CallDescriptor>,
    planCalls: ClaudePlanCalls,
    runCalls: ClaudeRunCalls,
  } {
    const transport = RunDriverMother.measured(new ClaudeCalls({
      files: asked.files, binary: join(this.bin, 'claude'),
      worker: join(RunDriverMother.#ROOT, 'backend', 'src', 'infrastructure', 'headless-call-worker.ts'),
      spawn: this.#processes.launch.bind(this.#processes), env: {
        CT_FIXTURE_CAPTURES: this.captures, CT_FIXTURE_SCENARIO: asked.scenario,
        PATH: `${this.bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      }, newId: () => this.#identity(), now: () => new Date().toISOString(),
      budgetMs: 30_000, killGraceMs: 1_000, acceptanceMs: 10_000, pollMs: 25,
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    }), asked.files)
    const planCalls = new ClaudePlanCalls({
      calls: transport, records: asked.records,
      brief: new PlanAgentBrief({
        dispatchCheck: RunDriverMother.#DISPATCH_CHECK,
        conventions: join(RunDriverMother.#PLUGIN, 'conventions'), ctStep: RunDriverMother.#CT_STEP,
      }),
      pluginRoot: RunDriverMother.#PLUGIN, resumable: async () => true, nowMs: Date.now,
    })
    return {
      transport, planCalls,
      runCalls: new ClaudeRunCalls({
        calls: transport, machine: asked.machine,
        files: asked.files, pluginRoot: RunDriverMother.#PLUGIN,
      }),
    }
  }

  #publication(files: HeadlessFiles): GhPlanPublication {
    const environment = {
      ...process.env,
      CT_STATE_DIR: undefined,
      CLAUDE_CONFIG_DIR: this.state,
      CT_FIXTURE_CAPTURES: this.captures,
      CT_FIXTURE_PUBLICATION: this.publication,
    }
    const node = new ToolRunner({
      bin: process.execPath, budgetMs: 30_000, env: environment, processes: RunDriverMother.#PROCESSES, signal: RunDriverMother.#PROCESSES.signal.bind(RunDriverMother.#PROCESSES),
    })
    const git = new ToolRunner({
      bin: 'git', budgetMs: 30_000, env: environment, processes: RunDriverMother.#PROCESSES, signal: RunDriverMother.#PROCESSES.signal.bind(RunDriverMother.#PROCESSES),
    })
    const ghRunner = new ToolRunner({
      bin: join(this.bin, 'gh'), budgetMs: 30_000, env: environment, processes: RunDriverMother.#PROCESSES, signal: RunDriverMother.#PROCESSES.signal.bind(RunDriverMother.#PROCESSES),
    })
    const gh = new Gh({
      launch: (argv) => ghRunner.run(argv),
      policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
      sleep: async () => {},
    })
    return new GhPlanPublication({
      gh, git: git.run.bind(git),
      progress: new PlanContractProgress({
        node: node.run.bind(node), git: git.run.bind(git), dispatchCheck: RunDriverMother.#DISPATCH_CHECK,
      }),
      files, digest: (text) => createHash('sha256').update(text).digest('hex'),
    })
  }

  async #publicationCount(): Promise<number> {
    try {
      const lines = (await readFile(join(this.captures, 'gh.jsonl'), 'utf8')).trim().split('\n').filter(Boolean)
      return lines.map((line) => JSON.parse(line) as string[])
        .filter((argv) => argv[0] === 'issue' && argv[1] === 'comment').length
    } catch (cause) {
      if (RunDriverMother.hasCode(cause, 'ENOENT')) return 0
      throw cause
    }
  }

  #runCalls(scenario: 'veto' | 'reconcile' | 'pass'): {
    transport: MeasuredAgentCalls<CallInvocation, CallDescriptor>,
    calls: ClaudeRunCalls,
    step: ExecuteRunInstruction,
  } {
    const transport = RunDriverMother.measured(new ClaudeCalls({
      files: this.files,
      binary: join(this.bin, 'claude'),
      worker: join(RunDriverMother.#ROOT, 'backend', 'src', 'infrastructure', 'headless-call-worker.ts'),
      spawn: this.#processes.launch.bind(this.#processes),
      env: {
        CT_FIXTURE_CAPTURES: this.captures,
        CT_FIXTURE_SCENARIO: scenario,
        PATH: `${this.bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      },
      newId: () => this.#identity(),
      now: () => new Date().toISOString(),
      budgetMs: 30_000,
      killGraceMs: 1_000,
      acceptanceMs: 10_000,
      pollMs: 25,
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    }), this.files)
    const calls = new ClaudeRunCalls({
      calls: transport,
      machine: this.machine,
      files: this.files,
      pluginRoot: RunDriverMother.#PLUGIN,
    })
    return { transport, calls, step: new ExecuteRunInstruction({ machine: this.machine, calls }) }
  }

  async #producer(ticket: string, dispatch: RunDispatch): Promise<ProducerCapture> {
    const sha256: string[] = []
    for (const path of dispatch.paths) {
      sha256.push(createHash('sha256').update(await readFile(path)).digest('hex'))
    }
    return Object.freeze({
      ticket,
      role: dispatch.role,
      paths: Object.freeze([...dispatch.paths]),
      sha256: Object.freeze(sha256),
      argv: Object.freeze([...dispatch.argv]),
      response: dispatch.response,
      invocationArgv: Object.freeze([
        '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
        '--plugin-dir', RunDriverMother.#PLUGIN, '--resume', this.watch.agent,
        ...dispatch.argv,
      ]),
    })
  }

  async #crossing(producer: ProducerCapture): Promise<RoleCrossing> {
    const callsRoot = join(this.state, 'harness', this.watch.agent, 'calls')
    const callIds = await readdir(callsRoot)
    let callId: string | null = null
    for (const candidate of callIds) {
      const descriptor = CallDescriptor.from(await readFile(join(callsRoot, candidate, CallDescriptor.FILE), 'utf8'))
      if (descriptor.requestId === `run:${producer.ticket}`) callId = candidate
    }
    if (callId === null) throw new Error(`no model call recorded request run:${producer.ticket}`)
    const invocationArgv = Object.freeze([
      ...producer.invocationArgv,
      CallDescriptor.opening(join(callsRoot, callId, CallDescriptor.PROMPT)),
    ])
    const captures = (await readFile(join(this.captures, 'model.jsonl'), 'utf8')).split('\n').filter(Boolean)
      .map((line) => RunDriverMother.#modelCapture(line))
    const consumer = captures.find((capture) => capture.callId === callId)
    if (consumer === undefined) throw new Error(`model subprocess ${callId} left no capture`)
    return Object.freeze({ producer: { ...producer, invocationArgv }, consumer, requestId: `run:${producer.ticket}` })
  }

  static #modelCapture(line: string): ModelCapture {
    const value: unknown = JSON.parse(line)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`model capture is not an object: ${line}`)
    }
    const keys = Object.keys(value).sort()
    const expected = ['argv', 'callId', 'conversation', 'paths', 'prompt', 'role', 'sha256'].sort()
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw new Error(`model capture has unexpected keys: ${line}`)
    }
    if (!('callId' in value) || typeof value.callId !== 'string'
      || !('role' in value) || typeof value.role !== 'string'
      || !('conversation' in value) || typeof value.conversation !== 'string'
      || !('prompt' in value) || typeof value.prompt !== 'string'
      || !('argv' in value) || !RunDriverMother.#strings(value.argv)
      || !('paths' in value) || !RunDriverMother.#strings(value.paths)
      || !('sha256' in value) || !Array.isArray(value.sha256)
      || value.sha256.some((hash) => hash !== null && typeof hash !== 'string')) {
      throw new Error(`model capture is malformed: ${line}`)
    }
    return Object.freeze({
      callId: value.callId,
      role: value.role,
      conversation: value.conversation,
      argv: Object.freeze([...value.argv]),
      prompt: value.prompt,
      paths: Object.freeze([...value.paths]),
      sha256: Object.freeze([...value.sha256]),
    })
  }

  static #strings(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
  }

  async #recoverFix(stateRoot: string, successful: boolean): Promise<FixProjection> {
    const harnesses = await readdir(join(stateRoot, 'harness'))
    const conversation = harnesses[0]
    const dispatch = JSON.parse(await readFile(join(stateRoot, 'harness', conversation, 'dispatch.json'), 'utf8')) as {
      worktree: string,
    }
    const callId = successful
      ? '77777777-7777-4777-8777-777777777777'
      : '66666666-6666-4666-8666-666666666666'
    const call = new StartedPlanCall({ conversation, id: callId })
    const directory = join(stateRoot, 'harness', conversation, 'calls', callId)
    await fs.mkdir(directory)
    const descriptor = new CallDescriptor({
      conversation, purpose: 'fix', requestId: 'review-1', cwd: dispatch.worktree,
      binary: 'claude', argv: ['--resume', conversation], startedAt: '2026-09-17T10:00:00.000Z',
      budgetMs: 7_200_000, killGraceMs: 5_000,
    })
    const diagnostic = 'synthetic fix failed after delivery'
    const completion = new CompletedPlanCall({
      call, code: 0, signal: null, finishedAt: '2026-09-17T10:01:00.000Z', wallDurationMs: 60_000,
      execution: successful ? { kind: 'success' } : { kind: 'error', diagnostic },
      measurement: {
        cost: { kind: 'reported', totalUsd: 0.5, attribution: 'unverified-resume' },
        turns: 2, durationMs: 55_000, unavailable: [],
      },
    })
    await Promise.all([
      writeFile(join(directory, CallDescriptor.FILE), descriptor.text()),
      writeFile(join(directory, CallDescriptor.PROMPT), 'Labelled synthetic post-delivery fix.\n'),
      writeFile(join(directory, CallDescriptor.STREAM), ''),
      writeFile(join(directory, CallDescriptor.STDERR), ''),
      writeFile(join(directory, CallDescriptor.COMPLETION), StoredCompletion.text(completion)),
    ])
    const files = new HeadlessFiles({ root: stateRoot, fs, newId: () => this.#identity() })
    let calls = 0
    let verbs = 0
    const refusingSpawn: ProcessRunner['launch'] = () => { calls += 1; throw new Error('recovery must not spawn') }
    const transport = RunDriverMother.measured(new ClaudeCalls({
      files, binary: 'claude', worker: 'worker',
      spawn: refusingSpawn,
      env: {}, newId: () => this.#identity(), now: () => '2026-09-17T12:00:00.000Z',
      budgetMs: 7_200_000, killGraceMs: 5_000, acceptanceMs: 10_000, pollMs: 250, sleep: async () => {},
    }), files)
    const records = new DiskPlanRecords({
      files, newId: () => this.#identity(), now: () => '2026-09-17T12:00:00.000Z',
      exists: async (path) => existsSync(path),
    })
    const journal = new RunJournal({
      files,
      newId: () => this.#identity(),
      now: () => { throw new Error('the journal clock is not asked') },
    })
    const machine = new CtRunMachine({
      journal,
      node: async () => { verbs += 1; throw new Error('recovery must not execute a verb') },
      git: async () => { throw new Error('recovery must not inspect git') },
      read: async (path) => readFile(path, 'utf8').catch((cause: unknown) => {
        if (RunDriverMother.hasCode(cause, 'ENOENT')) return null
        throw cause
      }),
      ctStep: RunDriverMother.#CT_STEP, dispatchCheck: RunDriverMother.#DISPATCH_CHECK,
      pluginRoot: RunDriverMother.#PLUGIN,
    })
    const planCalls = new ClaudePlanCalls({
      calls: transport, records,
      brief: new PlanAgentBrief({
        dispatchCheck: RunDriverMother.#DISPATCH_CHECK,
        conventions: join(RunDriverMother.#PLUGIN, 'conventions'), ctStep: RunDriverMother.#CT_STEP,
      }),
      pluginRoot: RunDriverMother.#PLUGIN, resumable: async () => true, nowMs: () => Date.parse('2026-09-17T12:00:00.000Z'),
    })
    const driver = new DriveRun({
      calls: planCalls, publication: new PlanPublication(), machine, delivery: new CompletedRunDelivery(),
      step: new ExecuteRunInstruction({ machine, calls: new ClaudeRunCalls({
        calls: transport, machine, files, pluginRoot: RunDriverMother.#PLUGIN,
      }) }),
      messages: new DeliverHeldMessages({
        messages: journal,
        calls: planCalls,
        escalations: new QuietEscalations(),
      }),
      escalations: QuietEscalations.reader(),
    })
    const agents = new RunPlanAgents({
      legacy: new PlanAgents(), records, calls: planCalls, transport, driver, machine, journal,
      delivery: new CompletedRunDelivery(),
      announcements: new SilentChangeAnnouncements(),
      newId: () => this.#identity(), nowMs: () => Date.parse('2026-09-17T12:00:00.000Z'), stderr: () => {},
    })
    const reviews = new RecoveryReviews()
    const activePlans = new ActivePlans({ sessions: new PlanSessions() })
    const legacy = new RecordedPlanRecovery({
      records, calls: planCalls, ownership: transport, checkouts: new RecoveryCheckouts(), activePlans, reviews,
    })
    const recovery = new RunPlanRecovery({
      legacy, records, calls: planCalls, transport, machine, journal, agents, delivery: new CompletedRunDelivery(),
      checkouts: new RecoveryCheckouts(), activePlans, reviews,
      nowMs: () => Date.parse('2026-09-17T12:00:00.000Z'),
    })
    const recoveryDiagnostic = await recovery.recover()
    if (recoveryDiagnostic !== null) throw new Error(recoveryDiagnostic)
    const projected = activePlans.known()[0] as {
      phase: string, diagnostic?: string, recovery?: { action: string, detail: string },
    }
    return successful
      ? { phase: projected.phase, watching: reviews.started > 0, calls, verbs }
      : {
          phase: projected.phase, diagnostic: projected.diagnostic, recovery: projected.recovery,
          watching: reviews.started > 0, calls, verbs,
        }
  }

  async #advanceBase(): Promise<void> {
    const clone = join(this.base, 'base-clone')
    this.#outsideGit('clone', '-q', this.origin, clone)
    this.#gitAt(clone, 'config', 'user.email', 'fixture@example.test')
    this.#gitAt(clone, 'config', 'user.name', 'Fixture')
    this.#gitAt(clone, 'config', 'commit.gpgsign', 'false')
    await writeFile(join(clone, 'work.txt'), 'base conflict\n')
    this.#gitAt(clone, 'add', 'work.txt')
    this.#gitAt(clone, 'commit', '-q', '-m', 'conflicting base')
    this.#gitAt(clone, 'push', '-q', 'origin', 'main')
  }

  async #initialize(conflicting: boolean): Promise<void> {
    await fs.mkdir(this.checkout)
    await Promise.all([
      fs.mkdir(this.state), fs.mkdir(this.bin), fs.mkdir(this.captures),
      fs.mkdir(dirname(join(this.checkout, RunDriverMother.PLAN)), { recursive: true }),
      fs.mkdir(join(this.checkout, '.agent'), { recursive: true }),
    ])
    this.#git('init', '-q', '-b', 'main')
    this.#git('config', 'user.email', 'fixture@example.test')
    this.#git('config', 'user.name', 'Fixture')
    this.#git('config', 'commit.gpgsign', 'false')
    await writeFile(join(this.checkout, 'AGENTS.md'), '# Fixture rules\n')
    await writeFile(join(this.checkout, 'work.txt'), conflicting ? 'feature baseline\n' : 'fixture baseline\n')
    await writeFile(join(this.checkout, RunDriverMother.PLAN), RunDriverMother.#PLAN_TEXT)
    await writeFile(join(this.checkout, '.gitignore'), '.agent/run-*.json\n.agent/run-*/\n')
    await writeFile(join(this.checkout, '.agent', 'SLICE.md'), renderState({
      meta: { issue: RunDriverMother.ISSUE, base: 'main', senal: 'fixture', e2e: [] },
      body: '# Fixture slice',
    }))
    this.#git('add', '-A')
    this.#git('commit', '-q', '-m', 'fixture base')
    this.#outsideGit('init', '-q', '--bare', '-b', 'main', this.origin)
    this.#git('remote', 'add', 'origin', this.origin)
    this.#git('push', '-q', '-u', 'origin', 'main')
    this.#git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    this.#git('switch', '-q', '-c', 'feat/7')
    await this.#executables()
  }

  async #executables(): Promise<void> {
    const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
    const issueCreate = GhPlanIssues.argvFor({
      story: new UserStory({
        key: new UserStoryUrl('https://github.com/acme/widget/issues/1'),
        summary: 'Run the finite offline driver fixture', description: '',
      }),
      repository: new RepositoryName(RunDriverMother.REPOSITORY),
    })
    await writeFile(join(this.bin, 'git'), [
      '#!/bin/sh',
      'if [ "$3" = "remote" ] && [ "$4" = "get-url" ]; then printf "%s\\n" "git@github.com:acme/widget.git"; exit 0; fi',
      `exec ${JSON.stringify(realGit)} "$@"`,
    ].join('\n') + '\n', { mode: 0o755 })
    await writeFile(join(this.bin, 'gh'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      'const argv = process.argv.slice(2)',
      `const issueCreate = ${JSON.stringify(issueCreate)}`,
      "const equal = (expected) => JSON.stringify(argv) === JSON.stringify(expected)",
      "const page = (nodes) => JSON.stringify([{ data: { repository: { issues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } }])",
      "fs.appendFileSync(path.join(process.env.CT_FIXTURE_CAPTURES, 'gh.jsonl'), JSON.stringify(argv) + '\\n')",
      "if (equal(issueCreate)) console.log('https://github.com/acme/widget/issues/7')",
      "else if (equal(['issue', 'view', 'https://github.com/acme/widget/issues/1', '--json', 'title,body,comments'])) console.log(JSON.stringify({ title: 'Run the finite offline driver fixture', body: '', comments: [] }))",
      "else if (equal(['issue', 'view', '7', '--repo', 'acme/widget', '--json', 'labels', '-q', '[.labels[].name]'])) console.log(JSON.stringify(['status:in-progress']))",
      "else if (equal(['issue', 'view', '7', '--repo', 'acme/widget', '--json', 'body', '-q', '.body'])) console.log('<!-- ct-order:1 -->')",
      "else if (equal(['issue', 'view', '7', '--repo', 'acme/widget', '--json', 'number,title,body,labels,milestone'])) console.log(JSON.stringify({ number: 7, title: 'Finite fixture', body: '<!-- ct-order:1 -->', labels: [{ name: 'status:ready' }], milestone: null }))",
      "else if (equal(['issue', 'view', '7', '--repo', 'acme/widget', '--json', 'comments'])) console.log(JSON.stringify({ number: 7, title: 'Finite fixture', body: '<!-- ct-order:1 -->', labels: [{ name: 'status:ready' }], milestone: null, comments: [] }))",
      "else if (argv.length === 7 && equal(['issue', 'comment', '7', '--repo', 'acme/widget', '--body-file', argv[6]])) {",
      "  const body = fs.readFileSync(argv[6], 'utf8')",
      "  if (!body.includes('Source: docs/superpowers/plans/2026-09-17-issue-7-driver.md')) throw new Error('publication body mismatch')",
      "  fs.copyFileSync(argv[6], process.env.CT_FIXTURE_PUBLICATION)",
      "}",
      "else if (equal(['issue', 'edit', '7', '--repo', 'acme/widget', '--add-label', 'status:in-progress', '--remove-label', 'status:ready'])) {}",
      `else if (equal(['api', 'graphql', '--paginate', '--slurp', '-f', ${JSON.stringify(`query=${issuesQueryFor(['OPEN'])}`)}, '-f', 'owner=acme', '-f', 'name=widget'])) console.log(page([{ number: 7, url: 'https://github.com/acme/widget/issues/7', title: 'Finite fixture', body: '<!-- ct-order:1 -->', state: 'OPEN', stateReason: null, milestone: null, labels: { nodes: [{ name: 'status:ready' }] } }]))`,
      `else if (equal(['api', 'graphql', '--paginate', '--slurp', '-f', ${JSON.stringify(`query=${issuesQueryFor(['CLOSED'])}`)}, '-f', 'owner=acme', '-f', 'name=widget'])) console.log(page([]))`,
      "else if (equal(['api', 'repos/acme/widget/issues/7/comments', '--paginate', '--slurp'])) console.log('[[]]')",
      "else if ([",
      "  ['pr', 'list', '--repo', 'acme/widget', '--state', 'all', '--head', 'feat/7', '--json', 'number', '--limit', '1'],",
      "  ['pr', 'list', '--repo', 'acme/widget', '--head', 'feat/7', '--state', 'open', '--json', 'number,url', '--limit', '1'],",
      "].some(equal)) console.log('[]')",
      "else throw new Error('unlisted gh request: ' + JSON.stringify(argv))",
    ].join('\n') + '\n', { mode: 0o755 })
  }

  async #modelExecutable(): Promise<void> {
    const definition = (step: string): AgentDefinition => AgentDefinition.parse(
      readFileSync(join(RunDriverMother.#PLUGIN, RoleBytes.filesOf(step)[0]), 'utf8'),
    )
    const definedArgv = (step: string, tools: string, schema?: object): string[] => {
      const agent = definition(step)
      return [
        '--tools', tools, '--allowedTools', tools, '--model', agent.model,
        '--agents', JSON.stringify(agent.toClaudeAgents()), '--agent', agent.name,
        ...(schema === undefined ? [] : ['--json-schema', JSON.stringify(schema)]),
      ]
    }
    const contracts = {
      implement: {
        argv: ['--tools', IMPLEMENTER_TOOLS, '--allowedTools', IMPLEMENTER_TOOLS, '--model', IMPLEMENTER_MODEL,
          '--json-schema', JSON.stringify(REPORT_SCHEMA)],
        roleFiles: RoleBytes.filesOf(STEPS.IMPLEMENT).map((path) => join(RunDriverMother.#PLUGIN, path)),
        response: RESPONSE_KIND_OF_STEP[STEPS.IMPLEMENT],
      },
      'ct-judge': {
        argv: definedArgv(STEPS.JUDGE, JUDGE_TOOLS),
        roleFiles: RoleBytes.filesOf(STEPS.JUDGE).map((path) => join(RunDriverMother.#PLUGIN, path)),
        response: RESPONSE_KIND_OF_STEP[STEPS.JUDGE],
      },
      'ct-advisor': {
        argv: definedArgv(STEPS.ADVISE, ADVISOR_TOOLS, ADVICE_SCHEMA),
        roleFiles: RoleBytes.filesOf(STEPS.ADVISE).map((path) => join(RunDriverMother.#PLUGIN, path)),
        response: RESPONSE_KIND_OF_STEP[STEPS.ADVISE],
      },
      'ct-slice-judge': {
        argv: definedArgv(STEPS.SLICE_JUDGE, SLICE_JUDGE_TOOLS),
        roleFiles: RoleBytes.filesOf(STEPS.SLICE_JUDGE).map((path) => join(RunDriverMother.#PLUGIN, path)),
        response: RESPONSE_KIND_OF_STEP[STEPS.SLICE_JUDGE],
      },
      'ct-reconciler': {
        argv: definedArgv(STEPS.RECONCILE, RECONCILER_TOOLS),
        roleFiles: RoleBytes.filesOf(STEPS.RECONCILE).map((path) => join(RunDriverMother.#PLUGIN, path)),
        response: RESPONSE_KIND_OF_STEP[STEPS.RECONCILE],
      },
    }
    const brief = new PlanAgentBrief({
      dispatchCheck: RunDriverMother.#DISPATCH_CHECK,
      conventions: join(RunDriverMother.#PLUGIN, 'conventions'),
      ctStep: RunDriverMother.#CT_STEP,
    })
    const planner = {
      prompt: brief.errandFor({ issue: this.watch.issue, repository: this.watch.repository }),
      argv: [
        '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
        '--allowedTools', ClaudePlanCalls.ALLOWED_TOOLS, '--model', 'opus',
        '--plugin-dir', RunDriverMother.#PLUGIN, '--session-id', RunDriverMother.CONVERSATION,
      ],
    }
    await writeFile(join(this.bin, 'claude'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      "const crypto = require('node:crypto')",
      'const argv = process.argv.slice(2)',
      'const errand = argv[argv.length - 1]',
      "const errandMatch = /^Read the file at (.+) and do exactly what it says\\.$/.exec(errand)",
      "if (errandMatch === null) throw new Error('unexpected CLI errand: ' + JSON.stringify(errand))",
      "const promptPath = errandMatch[1]",
      "const prompt = fs.readFileSync(promptPath, 'utf8')",
      "const callId = path.basename(path.dirname(promptPath))",
      "const opening = 'Read the file at ' + promptPath + ' and do exactly what it says.'",
      "const conversation = argv[(argv.indexOf('--session-id') >= 0 ? argv.indexOf('--session-id') : argv.indexOf('--resume')) + 1]",
      "const agentAt = argv.indexOf('--agent')",
      "const role = argv.indexOf('--session-id') >= 0 ? 'plan' : agentAt < 0 ? 'implement' : argv[agentAt + 1]",
      "fs.appendFileSync(path.join(process.env.CT_FIXTURE_CAPTURES, 'processes.jsonl'), JSON.stringify({ pid: process.pid, ppid: process.ppid, callId }) + '\\n')",
      `const contracts = ${JSON.stringify(contracts)}`,
      `const planner = ${JSON.stringify(planner)}`,
      `const errandEnd = ${JSON.stringify(ClaudeRunCalls.ERRAND_END)}`,
      `const fileErrandEnd = ${JSON.stringify(ClaudeRunCalls.FILE_ERRAND_END)}`,
      `const fileResponse = ${JSON.stringify(RESPONSE_KINDS.FILE)}`,
      "const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)",
      "let paths = []",
      "let responsePath = null",
      "if (role === 'plan') {",
      "  const expectedPlannerArgv = [...planner.argv, opening]",
      "  expectedPlannerArgv[expectedPlannerArgv.indexOf('--session-id') + 1] = conversation",
      "  if (!equal(argv, expectedPlannerArgv) || prompt !== planner.prompt) throw new Error('planner request mismatch: ' + JSON.stringify({ argv, prompt }))",
      "} else {",
      "  const contract = contracts[role]",
      "  if (!contract) throw new Error('unlisted model role: ' + role)",
      "  const common = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--plugin-dir', " + JSON.stringify(RunDriverMother.#PLUGIN) + ", '--resume', conversation]",
      "  if (!equal(argv, [...common, ...contract.argv, opening])) throw new Error('model argv mismatch: ' + JSON.stringify({ role, argv }))",
      "  const prefix = 'Read the listed files.\\n'",
      "  if (!prompt.startsWith(prefix)) throw new Error('model prompt envelope mismatch')",
      "  const listed = prompt.slice(prefix.length).split('\\n')",
      "  if (contract.response === fileResponse) {",
      "    responsePath = listed.pop()",
      "    if (!responsePath || listed.pop() !== fileErrandEnd) throw new Error('model file envelope mismatch')",
      "  } else if (listed.pop() !== errandEnd) throw new Error('model prompt envelope mismatch')",
      "  paths = listed",
      "  if (!contract.roleFiles.every((material) => paths.includes(material))) throw new Error('role files mismatch: ' + JSON.stringify({ role, paths }))",
      "  for (const material of paths) if (!material.includes('*') && !fs.existsSync(material)) throw new Error('missing model material: ' + material)",
      "}",
      "const sha256 = paths.map((material) => material.includes('*') ? null : crypto.createHash('sha256').update(fs.readFileSync(material)).digest('hex'))",
      "fs.appendFileSync(path.join(process.env.CT_FIXTURE_CAPTURES, 'model.jsonl'), JSON.stringify({ callId, role, conversation, argv, prompt, paths, sha256 }) + '\\n')",
      "let structured = null",
      "if (role === 'implement') {",
      "  fs.writeFileSync(path.join(process.cwd(), 'work.txt'), 'synthetic model response\\n')",
      "  structured = { paths: ['work.txt'], summary: 'Labelled synthetic model response for the offline fixture.' }",
      "} else if (role === 'ct-judge' || role === 'ct-slice-judge') {",
      "  const packagePath = paths.find((candidate) => { try { return fs.readFileSync(candidate, 'utf8').includes('Review token: ') } catch { return false } })",
      "  if (!packagePath) throw new Error('prepared review package was not supplied')",
      "  const packageText = fs.readFileSync(packagePath, 'utf8')",
      "  const token = /^Review token: ([0-9a-f]{64})$/m.exec(packageText)?.[1]",
      `  const rules = role === 'ct-judge' ? ${JSON.stringify(VERDICT_RULES)} : ${JSON.stringify(SLICE_VERDICT_RULES)}`,
      "  const veto = process.env.CT_FIXTURE_SCENARIO === 'veto' && role === 'ct-judge'",
      "  const priorJudges = fs.readFileSync(path.join(process.env.CT_FIXTURE_CAPTURES, 'model.jsonl'), 'utf8').split('\\n').filter((line) => line.includes('\\\"role\\\":\\\"ct-judge\\\"')).length",
      "  const verdict = { ruling: veto && priorJudges <= 2 ? 'FAIL' : 'PASS', review_token: token, rubric: rules.map((rule) => ({ rule, result: 'Labelled synthetic model response checked ' + rule + ' on attempt ' + priorJudges + '.', outcome: 'conforme' })), findings: veto && priorJudges <= 2 ? [{ rule: 'objetivo', severity: 'high', what: 'Synthetic veto requires another fixture attempt.', path: 'work.txt', line: 1, evidence: 'Labelled synthetic model response attempt ' + priorJudges + '.' }] : [] }",
      "  fs.writeFileSync(responsePath, JSON.stringify(verdict) + '\\n')",
      "} else if (role === 'ct-advisor') {",
      "  const packageText = fs.readFileSync(paths[0], 'utf8')",
      "  if (!packageText.includes('## Intentos') || !packageText.includes('attempt 1') || !packageText.includes('attempt 2')) throw new Error('prepared advisor package was not supplied')",
      "  structured = { approach: 'Use the exact fixture bytes and preserve the declared task scope.', files_to_reconsider: ['work.txt'] }",
      "} else if (role === 'ct-reconciler') {",
      "  const packageText = fs.readFileSync(paths[0], 'utf8')",
      "  if (!packageText.includes('## Conflicted files')) throw new Error('prepared reconciliation package was not supplied')",
      "  fs.writeFileSync(path.join(process.cwd(), 'work.txt'), 'synthetic model response\\n')",
      "  require('node:child_process').execFileSync('git', ['add', 'work.txt'], { cwd: process.cwd() })",
      "} else if (role !== 'plan') throw new Error('unlisted model request: ' + JSON.stringify({ role, argv, prompt }))",
      "const event = { type: 'result', subtype: 'success', session_id: conversation, is_error: false, total_cost_usd: 0.25, num_turns: 2, duration_ms: 15, usage: { input_tokens: 11, output_tokens: 7 } }",
      "if (responsePath === null) event.structured_output = structured",
      "console.log(JSON.stringify(event))",
    ].join('\n') + '\n', { mode: 0o755 })
  }

  #step(verb: string, ...arguments_: string[]): CommandResult {
    const result = spawnSync(process.execPath, [
      RunDriverMother.#CT_STEP, verb, ...arguments_,
      '--plan', RunDriverMother.PLAN, '--issue', String(RunDriverMother.ISSUE),
    ], {
      cwd: this.checkout,
      env: { ...process.env, CT_STATE_DIR: undefined, CLAUDE_CONFIG_DIR: this.state },
      encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL',
    })
    if (result.error !== undefined) throw result.error
    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
  }

  #pullRequestRefusals(): string[] {
    const requests = [
      ['pr', 'list', '--repo', 'other/widget', '--state', 'all', '--head', 'feat/7', '--json', 'number', '--limit', '1'],
      ['pr', 'list', '--repo', 'acme/widget', '--state', 'all', '--head', 'feat/8', '--json', 'number', '--limit', '1'],
      ['pr', 'list', '--repo', 'acme/widget', '--state', 'all', '--head', 'feat/7', '--json', 'number', '--limit', '1', '--web'],
    ]
    return requests.map((argv) => {
      const result = spawnSync(join(this.bin, 'gh'), argv, {
        env: {
          ...process.env,
          CT_FIXTURE_CAPTURES: this.captures,
          CT_FIXTURE_PUBLICATION: this.publication,
        },
        encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL',
      })
      if (result.status === 0) throw new Error(`unexpected pull-request request was accepted: ${JSON.stringify(argv)}`)
      return result.stderr
    })
  }

  #baseSha(): string {
    const run = JSON.parse(readFileSync(join(this.checkout, '.agent', 'run-7.json'), 'utf8')) as { baseSha: string }
    return run.baseSha
  }

  #git(...argv: string[]): string {
    return this.#gitAt(this.checkout, ...argv)
  }

  #gitAt(cwd: string, ...argv: string[]): string {
    const result = spawnSync('git', argv, { cwd, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`git ${argv.join(' ')} exited ${result.status}: ${result.stderr}`)
    return result.stdout
  }

  #outsideGit(...argv: string[]): string {
    const result = spawnSync('git', argv, { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`git ${argv.join(' ')} exited ${result.status}: ${result.stderr}`)
    return result.stdout
  }

  #identity(): string {
    const suffix = String(this.#nextIdentity++).padStart(12, '0')
    return `22222222-2222-4222-8222-${suffix}`
  }

  static hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }

  static #requireAdvance(instruction: RunInstruction): void {
    if (instruction.work.kind === 'refused') {
      throw new Error(`the real run refused instead of advancing: ${instruction.work.detail}`)
    }
  }

  static async #until<T>(read: () => Promise<T | null>, diagnostic: () => string): Promise<T> {
    for (let attempt = 0; attempt < 1_200; attempt += 1) {
      const value = await read()
      if (value !== null) return value
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(diagnostic())
  }
}
