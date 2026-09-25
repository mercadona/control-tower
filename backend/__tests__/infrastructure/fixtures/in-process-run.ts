import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderState } from '../../../../plugin/scripts/state.js'
import { ContinuePlan } from '../../../src/application/actions/continue-plan.ts'
import { DriveRun } from '../../../src/application/actions/drive-run.ts'
import { ExecuteRunInstruction } from '../../../src/application/actions/execute-run-instruction.ts'
import { DeliverHeldMessages } from '../../../src/application/actions/deliver-held-messages.ts'
import { ReadSliceEscalation } from '../../../src/application/queries/read-slice-escalation.ts'
import { CheckoutRegistry } from '../../../src/domain/ports/checkout-registry.ts'
import { PlanPublication } from '../../../src/domain/ports/plan-publication.ts'
import { ReviewLog } from '../../../src/domain/ports/review-log.ts'
import { SliceEscalations } from '../../../src/domain/ports/slice-escalations.ts'
import { PlanBriefing } from '../../../src/domain/value-objects/plan-briefing.ts'
import type { CallCost, CallExecution, PlanCallPurpose } from '../../../src/domain/value-objects/plan-call.ts'
import type { AgentMeasurementReader } from '../../../src/domain/ports/agent-measurement-reader.ts'
import type { AgentMeasurementStore } from '../../../src/domain/ports/agent-measurement-store.ts'
import { CompletedPlanCall, StartedPlanCall } from '../../../src/domain/value-objects/plan-call.ts'
import { PlanIssue } from '../../../src/domain/value-objects/plan-issue.ts'
import type { PlanWatch } from '../../../src/domain/value-objects/plan-watch.ts'
import type { RegisteredCheckout } from '../../../src/domain/value-objects/registered-checkout.ts'
import { RepositoryName } from '../../../src/domain/value-objects/repository-name.ts'
import { SliceEscalation } from '../../../src/domain/value-objects/slice-escalation.ts'
import { WorkspaceLocation } from '../../../src/domain/value-objects/workspace-location.ts'
import { ActivePlans } from '../../../src/infrastructure/active-plans-route.ts'
import { CallDescriptor, CallInvocation, ClaudeCalls, StoredCompletion } from '../../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../../src/infrastructure/claude-plan-calls.ts'
import { ClaudeRunCalls } from '../../../src/infrastructure/claude-run-calls.ts'
import { ClaudeRunMeasurements } from '../../../src/infrastructure/claude-run-measurements.ts'
import { CtRunMachine } from '../../../src/infrastructure/ct-run-machine.ts'
import { DiskAgentMeasurements } from '../../../src/infrastructure/disk-agent-measurements.ts'
import { DiskPlanRecords } from '../../../src/infrastructure/disk-plan-records.ts'
import { HeadlessFiles } from '../../../src/infrastructure/headless-files.ts'
import { HeadlessPlanAgents } from '../../../src/infrastructure/headless-plan-agents.ts'
import { MeasuredAgentCalls } from '../../../src/infrastructure/measured-agent-calls.ts'
import { PlanAgentBrief } from '../../../src/infrastructure/plan-agent-brief.ts'
import { PlanSessions } from '../../../src/infrastructure/plan-sessions.ts'
import { RecordedPlanRecovery } from '../../../src/infrastructure/recorded-plan-recovery.ts'
import { ReviewWatch } from '../../../src/infrastructure/review-watch.ts'
import { RunJournal } from '../../../src/infrastructure/run-journal.ts'
import { RunPlanAgents, SilentChangeAnnouncements } from '../../../src/infrastructure/run-plan-agents.ts'
import { RunPlanRecovery } from '../../../src/infrastructure/run-plan-recovery.ts'
import { ToolRunner } from '../../../src/infrastructure/tool-runner.ts'
import { CompletedRunDelivery } from '../../run-delivery-double.ts'
import { InProcessWorkers } from './in-process-workers.ts'
import { ScriptedClaude } from './scripted-claude.ts'
import { Capture, ScriptedConversation } from './scripted-conversation.ts'
import { ScriptedOracle, type ScriptedStep } from './scripted-oracle.ts'

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

class RecordingPublication extends PlanPublication {
  readonly published: PlanWatch[]

  constructor(published: PlanWatch[]) {
    super()
    this.published = published
  }

  override async publish(watch: PlanWatch): Promise<void> {
    this.published.push(watch)
  }
}

class Identities {
  #next = 1

  next(): string {
    const suffix = String(this.#next++).padStart(12, '0')
    return `33333333-3333-4333-8333-${suffix}`
  }
}

class CountingReviewWatch extends ReviewWatch {
  started = 0

  constructor() {
    super({
      asked: async () => ({ changes: [] }),
      review: async () => {},
      sleep: async () => {},
      stderr: () => {},
      label: 'in-process recovery fixture',
      log: new ReviewLog(),
    })
  }

  override startRecovered(): Promise<void> {
    this.started += 1
    return new Promise(() => {})
  }
}

class SettlingAgentCalls extends MeasuredAgentCalls<CallInvocation, CallDescriptor> {
  readonly #pending: Set<Promise<unknown>>

  constructor(ports: {
    executor: ClaudeCalls,
    reader: AgentMeasurementReader,
    store: AgentMeasurementStore,
  }, pending: Set<Promise<unknown>>) {
    super(ports)
    this.#pending = pending
  }

  override wait(call: StartedPlanCall): Promise<CompletedPlanCall> {
    const waiting = super.wait(call)
    const settled = waiting.then(() => undefined, () => undefined)
    this.#pending.add(settled)
    void settled.then(() => this.#pending.delete(settled))
    return waiting
  }
}

class UnregisteredCheckouts extends CheckoutRegistry {
  override remember(_checkout: RegisteredCheckout): void {}
}

export class InProcessRun {
  static readonly ISSUE = 7
  static readonly REPOSITORY = 'acme/widget'
  static readonly PLAN = 'docs/superpowers/plans/2026-09-17-issue-7-driver.md'
  static readonly #WORKER = 'headless-call-worker.ts'
  static readonly #HERE = dirname(fileURLToPath(import.meta.url))
  static readonly #ROOT = join(InProcessRun.#HERE, '..', '..', '..', '..')
  static readonly #PLUGIN = join(InProcessRun.#ROOT, 'plugin')
  static readonly #CT_STEP = join(InProcessRun.#PLUGIN, 'scripts', 'ct-step.mjs')
  static readonly #DISPATCH_CHECK = join(InProcessRun.#PLUGIN, 'scripts', 'dispatch-check.mjs')
  static readonly #EPOCH = '2026-09-17T10:00:00.000Z'

  readonly checkout: string
  readonly state: string
  readonly oracle: ScriptedOracle
  readonly claude: ScriptedClaude
  readonly workers: InProcessWorkers
  readonly delivery: CompletedRunDelivery
  readonly published: PlanWatch[]
  readonly warnings: string[] = []
  readonly #pending = new Set<Promise<unknown>>()
  readonly #base: string
  readonly #identities: Identities
  readonly #files: HeadlessFiles
  readonly #journal: RunJournal
  readonly #machine: CtRunMachine

  private constructor(asked: {
    base: string,
    checkout: string,
    state: string,
    oracle: ScriptedOracle,
    claude: ScriptedClaude,
    workers: InProcessWorkers,
    delivery: CompletedRunDelivery,
    published: PlanWatch[],
    identities: Identities,
    files: HeadlessFiles,
    journal: RunJournal,
    machine: CtRunMachine,
  }) {
    this.#base = asked.base
    this.checkout = asked.checkout
    this.state = asked.state
    this.oracle = asked.oracle
    this.claude = asked.claude
    this.workers = asked.workers
    this.delivery = asked.delivery
    this.published = asked.published
    this.#identities = asked.identities
    this.#files = asked.files
    this.#journal = asked.journal
    this.#machine = asked.machine
  }

  static async create(
    steps: readonly ScriptedStep[], delivery: CompletedRunDelivery = new CompletedRunDelivery(),
  ): Promise<InProcessRun> {
    const base = await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-in-process-run-')))
    const checkout = join(base, 'checkout')
    const state = join(base, 'state')
    await mkdir(checkout, { recursive: true })
    await mkdir(state, { recursive: true })
    await mkdir(join(checkout, '.agent'), { recursive: true })
    await mkdir(dirname(join(checkout, InProcessRun.PLAN)), { recursive: true })

    const planText = Capture.read('git', 'show-plan').stdout
    await writeFile(join(checkout, 'AGENTS.md'), '# Fixture rules\n')
    await writeFile(join(checkout, 'work.txt'), 'fixture baseline\n')
    await writeFile(join(checkout, InProcessRun.PLAN), planText)
    await writeFile(join(checkout, '.agent', 'SLICE.md'), renderState({
      meta: { issue: InProcessRun.ISSUE, base: 'main', senal: 'fixture', e2e: [] },
      body: '# Fixture slice',
    }))

    const identities = new Identities()
    const files = new HeadlessFiles({ root: state, fs, newId: () => identities.next() })
    const claude = new ScriptedClaude(Capture.read('claude', 'result-success'))
    const workers = new InProcessWorkers({ files, claude, worker: InProcessRun.#WORKER })
    const journal = new RunJournal({
      files,
      newId: () => identities.next(),
      now: () => { throw new Error('the journal clock is not asked') },
    })
    const git = new ToolRunner({
      bin: 'git',
      budgetMs: 30_000,
      processes: new ScriptedConversation()
        .answering(
          { binary: 'git', argv: ['-C', checkout, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'docs/superpowers/plans'] },
          Capture.read('git', 'ls-tree-plans'),
        )
        .answering(
          { binary: 'git', argv: ['-C', checkout, 'show', `HEAD:${InProcessRun.PLAN}`] },
          Capture.read('git', 'show-plan'),
        ),
      signal: () => {},
    })
    const oracle = new ScriptedOracle({
      checkout,
      plan: InProcessRun.PLAN,
      issue: InProcessRun.ISSUE,
      pluginRoot: InProcessRun.#PLUGIN,
      dispatchCheck: InProcessRun.#DISPATCH_CHECK,
      steps,
    })
    const machine = new CtRunMachine({
      journal,
      node: oracle.run,
      git: git.runWholeOutput.bind(git),
      read: async (path) => readFile(path, 'utf8').catch((cause: unknown) => {
        if (InProcessRun.#hasCode(cause, 'ENOENT')) return null
        throw cause
      }),
      ctStep: InProcessRun.#CT_STEP,
      dispatchCheck: InProcessRun.#DISPATCH_CHECK,
      pluginRoot: InProcessRun.#PLUGIN,
    })

    return new InProcessRun({
      base, checkout, state, oracle, claude, workers,
      delivery, published: [],
      identities, files, journal, machine,
    })
  }

  agents(): RunPlanAgents {
    const transport = new SettlingAgentCalls({
      executor: new ClaudeCalls({
        files: this.#files,
        binary: '/usr/local/bin/claude',
        worker: InProcessRun.#WORKER,
        spawn: this.workers.launch.bind(this.workers),
        env: {},
        newId: () => this.#identities.next(),
        now: () => new Date().toISOString(),
        budgetMs: 60_000,
        killGraceMs: 5_000,
        acceptanceMs: 5_000,
        pollMs: 10,
        sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      }),
      reader: new ClaudeRunMeasurements({ files: this.#files }),
      store: new DiskAgentMeasurements({ files: this.#files }),
    }, this.#pending)
    const records = new DiskPlanRecords({
      files: this.#files,
      newId: () => this.#identities.next(),
      now: () => new Date().toISOString(),
      exists: async (path) => existsSync(path),
    })
    const planCalls = new ClaudePlanCalls({
      calls: transport,
      brief: new PlanAgentBrief({
        dispatchCheck: InProcessRun.#DISPATCH_CHECK,
        conventions: join(InProcessRun.#PLUGIN, 'conventions'),
        ctStep: InProcessRun.#CT_STEP,
      }),
      pluginRoot: InProcessRun.#PLUGIN,
      resumable: async () => true,
      records,
      nowMs: Date.now,
    })
    const runCalls = new ClaudeRunCalls({
      calls: transport,
      machine: this.#machine,
      files: this.#files,
      pluginRoot: InProcessRun.#PLUGIN,
    })
    const publication = new RecordingPublication(this.published)
    const driver = new DriveRun({
      calls: planCalls,
      publication,
      machine: this.#machine,
      delivery: this.delivery,
      step: new ExecuteRunInstruction({ machine: this.#machine, calls: runCalls }),
      messages: new DeliverHeldMessages({
        messages: this.#journal,
        calls: planCalls,
        escalations: new QuietEscalations(),
      }),
      escalations: QuietEscalations.reader(),
    })
    const legacy = new HeadlessPlanAgents({
      records,
      calls: planCalls,
      continuation: new ContinuePlan({ calls: planCalls, publication }),
      newId: () => this.#identities.next(),
      stderr: (line) => { this.warnings.push(line) },
    })
    return new RunPlanAgents({
      legacy,
      records,
      calls: planCalls,
      transport,
      driver,
      machine: this.#machine,
      journal: this.#journal,
      delivery: this.delivery,
      announcements: new SilentChangeAnnouncements(),
      newId: () => this.#identities.next(),
      nowMs: Date.now,
      stderr: (line) => { this.warnings.push(line) },
    })
  }

  async journaled(steps: readonly ScriptedStep[]): Promise<PlanWatch> {
    const records = new DiskPlanRecords({
      files: this.#files,
      newId: () => this.#identities.next(),
      now: () => new Date().toISOString(),
      exists: async (path) => existsSync(path),
    })
    const watch = await records.prepare(new PlanBriefing({
      story: null,
      issue: new PlanIssue({
        number: InProcessRun.ISSUE,
        url: `https://github.com/${InProcessRun.REPOSITORY}/issues/${InProcessRun.ISSUE}`,
      }),
      located: new WorkspaceLocation({ root: this.checkout, path: this.checkout, branch: 'feat/7' }),
      repository: new RepositoryName(InProcessRun.REPOSITORY),
    }))
    await this.#journal.admit(watch)
    await this.#recordCall(watch, {
      purpose: 'plan',
      requestId: null,
      argv: ['--session-id', watch.agent],
      execution: { kind: 'success' },
      cost: { kind: 'reported', totalUsd: 0.1, attribution: 'initial-invocation' },
      startedAt: InProcessRun.#EPOCH,
    })
    const plan = await readFile(join(this.checkout, InProcessRun.PLAN), 'utf8')
    await this.#journal.establish(watch, `${JSON.stringify({
      version: 1,
      conversation: watch.agent,
      repository: watch.repository.text,
      issue: watch.issue.number,
      plan: InProcessRun.PLAN,
      initialPlanSha256: InProcessRun.#digest(plan),
    })}\n`)
    let previous: string | null = null
    for (const step of steps) {
      const ticket = await this.#journal.begin(watch, `${JSON.stringify({
        version: 1,
        previous,
        argv: [
          InProcessRun.#CT_STEP, 'next', '--plan', InProcessRun.PLAN, '--issue', String(InProcessRun.ISSUE),
          '--output-format', 'json',
        ],
        cwd: this.checkout,
        planSha256: InProcessRun.#digest(plan),
      })}\n`)
      const stdout = await this.oracle.announce(step)
      await this.#journal.finish(watch, ticket, `${JSON.stringify({
        version: 1, code: 0, stdout, stderr: '', beforeRun: null, afterRun: null,
      })}\n`)
      previous = ticket
    }
    return watch
  }

  async recorded(call: {
    readonly watch: PlanWatch,
    readonly execution: CallExecution | null,
    readonly purpose?: PlanCallPurpose,
    readonly requestId?: string | null,
    readonly argv?: readonly string[],
    readonly startedAt?: string,
  }): Promise<StartedPlanCall> {
    const argv = call.argv ?? ['--resume', call.watch.agent]
    return this.#recordCall(call.watch, {
      purpose: call.purpose ?? 'fix',
      requestId: call.requestId === undefined ? 'fix:after-delivery' : call.requestId,
      argv,
      execution: call.execution,
      startedAt: call.startedAt ?? InProcessRun.#EPOCH,
      cost: {
        kind: 'reported',
        totalUsd: 0.5,
        attribution: argv.includes('--session-id') ? 'initial-invocation' : 'unverified-resume',
      },
    })
  }

  recovery(): { readonly recovery: RunPlanRecovery, readonly activePlans: ActivePlans, readonly reviews: CountingReviewWatch }
  recovery(reviews: ReviewWatch): { readonly recovery: RunPlanRecovery, readonly activePlans: ActivePlans, readonly reviews: ReviewWatch }
  recovery(reviews?: ReviewWatch): { readonly recovery: RunPlanRecovery, readonly activePlans: ActivePlans, readonly reviews: ReviewWatch } {
    const agents = this.agents()
    const watched = reviews ?? new CountingReviewWatch()
    const activePlans = new ActivePlans({ sessions: new PlanSessions() })
    const legacy = new RecordedPlanRecovery({
      records: agents.records,
      calls: agents.calls,
      ownership: agents.transport,
      checkouts: new UnregisteredCheckouts(),
      activePlans,
      reviews: watched,
    })
    const recovery = new RunPlanRecovery({
      legacy,
      records: agents.records,
      calls: agents.calls,
      transport: agents.transport,
      machine: agents.machine,
      journal: agents.journal,
      agents,
      delivery: agents.delivery,
      checkouts: new UnregisteredCheckouts(),
      activePlans,
      reviews: watched,
      nowMs: Date.now,
    })
    return { recovery, activePlans, reviews: watched }
  }

  async settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending])
    await this.workers.settled()
  }

  async remove(): Promise<void> {
    await this.settled()
    await rm(this.#base, { recursive: true, force: true })
    if (this.warnings.length > 0) throw new Error(`the run wrote to stderr: ${this.warnings.join('')}`)
  }

  async #recordCall(watch: PlanWatch, asked: {
    purpose: PlanCallPurpose,
    requestId: string | null,
    argv: readonly string[],
    execution: CallExecution | null,
    cost: CallCost,
    startedAt: string,
  }): Promise<StartedPlanCall> {
    const call = new StartedPlanCall({ conversation: watch.agent, id: this.#identities.next() })
    const directory = this.#files.callDirectory(call)
    const descriptor = new CallDescriptor({
      conversation: watch.agent,
      purpose: asked.purpose,
      requestId: asked.requestId,
      role: null,
      cwd: watch.located.path,
      binary: 'claude',
      argv: asked.argv,
      startedAt: asked.startedAt,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    })
    await mkdir(directory, { recursive: true })
    const writes = [
      writeFile(join(directory, CallDescriptor.FILE), descriptor.text()),
      writeFile(join(directory, CallDescriptor.PROMPT), 'Labelled synthetic call.\n'),
      writeFile(join(directory, CallDescriptor.STREAM), ''),
      writeFile(join(directory, CallDescriptor.STDERR), ''),
    ]
    if (asked.execution !== null) {
      const completed = new CompletedPlanCall({
        call,
        code: asked.execution.kind === 'success' ? 0 : null,
        signal: null,
        finishedAt: asked.startedAt,
        wallDurationMs: 60_000,
        execution: asked.execution,
        measurement: { cost: asked.cost, turns: 2, durationMs: 55_000, unavailable: [] },
      })
      writes.push(writeFile(join(directory, CallDescriptor.COMPLETION), StoredCompletion.text(completed)))
    }
    await Promise.all(writes)
    return call
  }

  static #digest(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }

  static #hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }
}

export type { ScriptedStep }
