import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RoleBytes } from '../../../plugin/scripts/role-bytes.js'
import { STEPS } from '../../../plugin/scripts/run-machine.js'
import {
  AnnouncedInput, AnnouncedResponse, INPUT_KINDS, INPUT_ROLES, StepAnnouncement,
} from '../../../plugin/scripts/step-announcement.js'
import { IMPLEMENTER_MODEL, IMPLEMENTER_TOOLS, REPORT_SCHEMA } from '../../../plugin/scripts/step-contracts.js'
import { DriveRun } from '../../src/application/actions/drive-run.ts'
import { ExecuteRunInstruction } from '../../src/application/actions/execute-run-instruction.ts'
import { PlanRecoveryConflict } from '../../src/domain/exceptions.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { RunDelivery } from '../../src/domain/ports/run-delivery.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { PlanCalls } from '../../src/domain/ports/plan-calls.ts'
import { PlanPublication } from '../../src/domain/ports/plan-publication.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { PlanRecovery } from '../../src/domain/policies/plan-recovery.ts'
import { CompletedPlanCall, StartedPlanCall, type PlanCallPurpose } from '../../src/domain/value-objects/plan-call.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanNonLaunch } from '../../src/domain/value-objects/plan-non-launch.ts'
import { PlansInFlight } from '../../src/domain/value-objects/plans-in-flight.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RecoveryCall } from '../../src/domain/value-objects/recovery-call.ts'
import { RegisteredCheckout } from '../../src/domain/value-objects/registered-checkout.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { RunInstruction } from '../../src/domain/value-objects/run-instruction.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import type { DeliveredPullRequest, RunDeliveryInspection } from '../../src/domain/value-objects/run-delivery.ts'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.ts'
import { CallDescriptor, CallInvocation, ClaudeCalls, StoredCompletion } from '../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../src/infrastructure/claude-plan-calls.ts'
import { ClaudeRunCalls } from '../../src/infrastructure/claude-run-calls.ts'
import { ClaudeRunMeasurements } from '../../src/infrastructure/claude-run-measurements.ts'
import { MeasuredAgentCalls } from '../../src/infrastructure/measured-agent-calls.ts'
import { DiskAgentMeasurements } from '../../src/infrastructure/disk-agent-measurements.ts'
import { CtRunMachine, RunInspection } from '../../src/infrastructure/ct-run-machine.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import type { LaunchedProcess, ProcessRunner } from '../../src/infrastructure/process-runner.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'
import { PlanSessions } from '../../src/infrastructure/plan-sessions.ts'
import { RecordedCall } from '../../src/domain/value-objects/recorded-call.ts'
import { RecordedPlanRecovery } from '../../src/infrastructure/recorded-plan-recovery.ts'
import { ReviewWatch } from '../../src/infrastructure/review-watch.ts'
import type { ChangesAsked, Delivered } from '../../src/infrastructure/review-watch.ts'
import { ReviewLog } from '../../src/domain/ports/review-log.ts'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.ts'
import { MemoryReviewLog } from '../../src/infrastructure/memory-review-log.ts'
import { RunJournal, type JournalEntry } from '../../src/infrastructure/run-journal.ts'
import { RunPlanAgents, SilentChangeAnnouncements, RunProvenance, type RunProvenanceValue } from '../../src/infrastructure/run-plan-agents.ts'
import { RunPlanRecovery } from '../../src/infrastructure/run-plan-recovery.ts'
import { InspectedWorkInventory } from '../../src/infrastructure/inspected-work-inventory.ts'
import { ReadWorkProgress, ReadWorkProgressParams } from '../../src/application/queries/read-work-progress.ts'
import { PlanProgress } from '../../src/domain/ports/plan-progress.ts'
import { PlanningActivities } from '../../src/domain/ports/planning-activity.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { DeliverHeldMessages } from '../../src/application/actions/deliver-held-messages.ts'
import { ReadSliceEscalation } from '../../src/application/queries/read-slice-escalation.ts'
import { SliceEscalations } from '../../src/domain/ports/slice-escalations.ts'
import { SliceEscalation } from '../../src/domain/value-objects/slice-escalation.ts'
import { CompletedRunDelivery } from '../run-delivery-double.ts'

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

class Barrier<T = void> {
  readonly promise: Promise<T>
  resolve!: (value: T) => void
  reject!: (cause: unknown) => void
  settled = false

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = (value) => { this.settled = true; resolve(value) }
      this.reject = (cause) => { this.settled = true; reject(cause) }
    })
    void this.promise.catch(() => {})
  }

  static async bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('pending work did not settle')), 1_000)
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  static turn(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve))
  }
}

class RecoveryRecords extends PlanRecords {
  found: PlansInFlight

  constructor(watches: readonly PlanWatch[]) {
    super()
    this.found = PlansInFlight.listed(watches)
  }

  override async inFlight(): Promise<PlansInFlight> {
    return this.found
  }
}

class RecoveryCalls extends PlanCalls {
  readonly decisions = new Map<string, PlanRecovery>()

  override async recoveryFor(watch: PlanWatch): Promise<PlanRecovery> {
    const decision = this.decisions.get(watch.agent)
    if (decision === undefined) throw new Error(`no recovery decision for ${watch.agent}`)
    return decision
  }
}

class RecoveryTransport extends ClaudeCalls {
  readonly histories = new Map<string, readonly RecordedCall[]>()
  readonly descriptors = new Map<string, CallDescriptor>()
  readonly deadlines = new Map<string, number>()
  readonly owned = new Set<string>()
  readonly restored: string[] = []
  restorationFailure: Error | null = null
  spawns = 0

  constructor() {
    super({
      files: new HeadlessFiles({ root: '/unused', fs, newId: () => 'unused' }),
      binary: 'unused',
      worker: 'unused',
      spawn: (() => { this.spawns += 1; throw new Error('recovery must not spawn') }) as ProcessRunner['launch'],
      env: {},
      newId: () => 'unused',
      now: () => RecoveryMother.STARTED,
      budgetMs: 1,
      killGraceMs: 1,
      acceptanceMs: 1,
      pollMs: 1,
      sleep: async () => {},
    })
  }

  override async history(conversation: string): Promise<readonly RecordedCall[]> {
    return this.histories.get(conversation) ?? []
  }

  override async recover(conversation: string): Promise<readonly RecordedCall[]> {
    this.restored.push(conversation)
    if (this.restorationFailure !== null) throw this.restorationFailure
    return this.history(conversation)
  }

  override async descriptorOf(call: StartedPlanCall): Promise<CallDescriptor> {
    const descriptor = this.descriptors.get(call.id)
    if (descriptor === undefined) throw new Error(`descriptor ${call.id} is absent`)
    return descriptor
  }

  override async deadlineOf(call: StartedPlanCall): Promise<number> {
    return this.deadlines.get(call.id) ?? RecoveryMother.DEADLINE
  }

  override owns(call: StartedPlanCall): boolean {
    return this.owned.has(call.id)
  }
}

class RecoveryMachine extends CtRunMachine {
  readonly inspections = new Map<string, RunInspection>()
  readonly effects: { commands: number }

  constructor() {
    const files = new HeadlessFiles({ root: '/unused', fs, newId: () => 'unused' })
    const effects = { commands: 0 }
    super({
      journal: new RunJournal({ files, newId: () => 'unused', now: () => { throw new Error('the journal clock is not asked') } }),
      node: async () => { effects.commands += 1; throw new Error('GET must not execute the oracle') },
      git: async () => { throw new Error('GET must not inspect git') },
      read: async () => null,
      ctStep: '/plugin/ct-step.mjs',
      dispatchCheck: '/plugin/dispatch-check.mjs',
      pluginRoot: '/plugin',
    })
    this.effects = effects
  }

  override async inspect(watch: PlanWatch): Promise<RunInspection> {
    return this.inspections.get(watch.agent) ?? new RunInspection({ kind: 'delivered' })
  }
}

class RecoveryJournal extends RunJournal {
  readonly recorded = new Map<string, readonly JournalEntry[]>()

  constructor() {
    super({
      files: new HeadlessFiles({ root: '/unused', fs, newId: () => 'unused' }),
      newId: () => 'unused',
      now: () => { throw new Error('the journal clock is not asked') },
    })
  }

  override async entries(watch: PlanWatch): Promise<readonly JournalEntry[]> {
    return this.recorded.get(watch.agent) ?? []
  }
}

class RecoveryAgents extends RunPlanAgents {
  readonly provenances = new Map<string, RunProvenanceValue | Error>()

  constructor(transport: ClaudeCalls, machine: CtRunMachine, journal: RunJournal) {
    const calls = new PlanCalls()
    const publication = new PlanPublication()
    const driver = new DriveRun({
      calls,
      publication,
      machine,
      delivery: new CompletedRunDelivery(),
      step: new ExecuteRunInstruction({ machine, calls: new ClaudeRunCalls({
        calls: transport,
        machine,
        files: new HeadlessFiles({ root: '/unused', fs, newId: () => 'unused' }),
        pluginRoot: '/plugin',
      }) }),
      messages: new DeliverHeldMessages({
        messages: journal,
        calls: calls,
        escalations: new QuietEscalations(),
      }),
      escalations: QuietEscalations.reader(),
    })
    super({
      legacy: new PlanAgents(),
      records: new PlanRecords(),
      calls,
      transport,
      driver,
      machine,
      journal,
      delivery: new CompletedRunDelivery(),
      announcements: new SilentChangeAnnouncements(),
      newId: () => 'unused',
      nowMs: () => RecoveryMother.NOW,
      stderr: () => {},
    })
  }

  override async provenance(watch: PlanWatch): Promise<RunProvenanceValue> {
    const provenance = this.provenances.get(watch.agent) ?? RunProvenance.DRIVER
    if (provenance instanceof Error) throw provenance
    return provenance
  }
}

class RecoveryCheckouts extends CheckoutRegistry {
  readonly remembered: RegisteredCheckout[] = []

  override remember(checkout: RegisteredCheckout): void {
    this.remembered.push(checkout)
  }
}

class RecoveryReviews extends ReviewWatch {
  readonly started: PlanWatch[] = []
  readonly stopped: string[] = []
  readonly settlements = new Map<string, () => void>()

  constructor() {
    super({
      asked: async () => ({ changes: [] }),
      review: async () => {},
      sleep: async () => {},
      stderr: () => {},
      label: 'run recovery review',
      log: new ReviewLog(),
    })
  }

  override startRecovered(watch: PlanWatch): Promise<void> {
    this.started.push(watch)
    return new Promise((resolve) => {
      this.settlements.set(watch.agent, resolve)
    })
  }

  override stop(asked: { issue: number, repository: RepositoryName }): void {
    this.stopped.push(`${asked.repository.text}#${asked.issue}`)
  }

  settle(watch: PlanWatch): void {
    this.settlements.get(watch.agent)?.()
    this.settlements.delete(watch.agent)
  }
}

class RecoveryLegacy extends RecordedPlanRecovery {
  recoveries = 0

  constructor() {
    super({
      records: new PlanRecords(),
      calls: new PlanCalls(),
      ownership: new RecoveryTransport(),
      checkouts: new RecoveryCheckouts(),
      activePlans: new ActivePlans({ sessions: new PlanSessions() }),
      reviews: new RecoveryReviews(),
    })
  }

  override async recover(): Promise<string | null> {
    this.recoveries += 1
    return null
  }
}

class StartupRunDelivery extends RunDelivery {
  readonly refuse: boolean
  deliveries = 0
  released = false

  constructor(refuse = false) {
    super()
    this.refuse = refuse
  }

  override async deliver(): Promise<void> {
    this.deliveries += 1
    if (this.refuse) throw new Error('checked release refused at startup')
    this.released = true
  }

  override async inspect(): Promise<RunDeliveryInspection> {
    return this.released
      ? { kind: 'delivered', pullRequest: { number: 31, url: 'https://github.com/owner/name/pull/31' } }
      : { kind: 'publishing', pullRequest: null, diagnostic: this.refuse ? 'checked release refused at startup' : null }
  }
  override async recordedPullRequest(watch: PlanWatch): Promise<DeliveredPullRequest | null> {
    throw new Error(`nobody scripted the recorded pull request of ${watch.agent}`)
  }

}

class HeldRunDelivery extends RunDelivery {
  deliveries = 0
  #release: (() => void) | null = null

  override async deliver(): Promise<void> {
    this.deliveries += 1
    await new Promise<void>((resolve) => { this.#release = resolve })
  }

  override async inspect(): Promise<RunDeliveryInspection> {
    return { kind: 'publishing', pullRequest: null, diagnostic: null }
  }
  override async recordedPullRequest(watch: PlanWatch): Promise<DeliveredPullRequest | null> {
    throw new Error(`nobody scripted the recorded pull request of ${watch.agent}`)
  }


  finish(): void {
    this.#release?.()
  }
}

class LifecycleRecords extends PlanRecords {
  readonly watch: PlanWatch

  constructor(watch: PlanWatch) {
    super()
    this.watch = watch
  }

  override async prepare(): Promise<PlanWatch> {
    return this.watch
  }

  override async find(): Promise<PlanWatch> {
    return this.watch
  }

  override async inFlight(): Promise<PlansInFlight> {
    return PlansInFlight.listed([this.watch])
  }
}

class LifecycleCalls extends PlanCalls {
  readonly planner: StartedPlanCall
  readonly completion = new Barrier<CompletedPlanCall>()

  constructor(watch: PlanWatch) {
    super()
    this.planner = RecoveryMother.call(watch, '77777777-7777-4777-8777-777777777777')
  }

  override async start(): Promise<StartedPlanCall> {
    return this.planner
  }

  override wait(): Promise<CompletedPlanCall> {
    return this.completion.promise
  }
}

class RecoveryMother {
  static readonly STARTED = '2026-09-17T09:00:00.000Z'
  static readonly NOW = Date.parse('2026-09-17T10:00:00.000Z')
  static readonly DEADLINE = Date.parse('2026-09-17T11:00:00.000Z')
  static readonly REPOSITORY = new RepositoryName('mercadona/control-tower-plugin')

  static watch(issue = 332, suffix = '1'): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({
        number: issue,
        url: `https://github.com/mercadona/control-tower-plugin/issues/${issue}`,
      }),
      located: new WorkspaceLocation({
        root: '/repo',
        path: `/repo/.worktrees/${issue}`,
        branch: `feat/${issue}`,
      }),
      repository: RecoveryMother.REPOSITORY,
      agent: `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(12)}`,
    })
  }

  static call(watch: PlanWatch, id: string): StartedPlanCall {
    return new StartedPlanCall({ conversation: watch.agent, id })
  }

  static descriptor(watch: PlanWatch, call: StartedPlanCall, purpose: PlanCallPurpose, requestId: string | null): CallDescriptor {
    return new CallDescriptor({
      conversation: watch.agent,
      purpose,
      requestId,
      cwd: watch.located.path,
      binary: '/usr/local/bin/claude',
      argv: purpose === 'plan' ? ['--session-id', watch.agent] : ['--resume', watch.agent],
      startedAt: RecoveryMother.STARTED,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    })
  }

  static completion(call: StartedPlanCall, succeeded = true): CompletedPlanCall {
    return new CompletedPlanCall({
      call,
      code: succeeded ? 0 : 1,
      signal: null,
      finishedAt: '2026-09-17T09:01:00.000Z',
      wallDurationMs: 60_000,
      execution: succeeded ? { kind: 'success' } : { kind: 'error', diagnostic: 'recorded failure' },
      measurement: {
        cost: { kind: 'unavailable', reason: 'fixture' },
        turns: null,
        durationMs: null,
        unavailable: [],
      },
    })
  }

  static fact(call: StartedPlanCall, purpose: PlanCallPurpose, completion: CompletedPlanCall | null, startedAt = RecoveryMother.STARTED): RecoveryCall {
    return new RecoveryCall({ call, purpose, completion, startedAt, deadlineMs: RecoveryMother.DEADLINE })
  }

  static decision(facts: readonly RecoveryCall[], nowMs = RecoveryMother.NOW): PlanRecovery {
    return PlanRecovery.from({ calls: facts, proof: null, cleanup: null, nowMs })
  }

  static recorded(call: StartedPlanCall, purpose: PlanCallPurpose, completion: CompletedPlanCall | null, startedAt = RecoveryMother.STARTED): RecordedCall {
    return new RecordedCall({ call, purpose, completion, startedAt })
  }
}

class ProjectionScenario {
  readonly watches: readonly PlanWatch[]
  readonly records: RecoveryRecords
  readonly calls: RecoveryCalls
  readonly transport: RecoveryTransport
  readonly machine: RecoveryMachine
  readonly journal: RecoveryJournal
  readonly agents: RecoveryAgents
  readonly checkouts: RecoveryCheckouts
  readonly activePlans: ActivePlans
  readonly reviews: RecoveryReviews
  readonly legacy: RecoveryLegacy
  readonly recovery: RunPlanRecovery

  constructor(
    watches: readonly PlanWatch[] = [RecoveryMother.watch()],
    delivery: RunDelivery = new CompletedRunDelivery(),
  ) {
    this.watches = watches
    this.records = new RecoveryRecords(watches)
    this.calls = new RecoveryCalls()
    this.transport = new RecoveryTransport()
    this.machine = new RecoveryMachine()
    this.journal = new RecoveryJournal()
    this.agents = new RecoveryAgents(this.transport, this.machine, this.journal)
    this.checkouts = new RecoveryCheckouts()
    this.activePlans = new ActivePlans({ sessions: new PlanSessions() })
    this.reviews = new RecoveryReviews()
    this.legacy = new RecoveryLegacy()
    this.recovery = new RunPlanRecovery({
      legacy: this.legacy,
      records: this.records,
      calls: this.calls,
      transport: this.transport,
      machine: this.machine,
      journal: this.journal,
      agents: this.agents,
      delivery,
      checkouts: this.checkouts,
      activePlans: this.activePlans,
      reviews: this.reviews,
      nowMs: () => RecoveryMother.NOW,
    })
    for (const watch of watches) {
      this.calls.decisions.set(watch.agent, RecoveryMother.decision([]))
      this.transport.histories.set(watch.agent, [])
    }
  }

  add(watch: PlanWatch, purpose: PlanCallPurpose, requestId: string | null, asked: {
    id?: string,
    completion?: CompletedPlanCall | null,
    startedAt?: string,
    deadline?: number,
    owned?: boolean,
  } = {}): StartedPlanCall {
    const call = RecoveryMother.call(watch, asked.id ?? '22222222-2222-4222-8222-222222222222')
    const completion = asked.completion === undefined ? RecoveryMother.completion(call) : asked.completion
    const history = [...(this.transport.histories.get(watch.agent) ?? [])]
    history.push(RecoveryMother.recorded(call, purpose, completion, asked.startedAt))
    this.transport.histories.set(watch.agent, history)
    this.transport.descriptors.set(call.id, RecoveryMother.descriptor(watch, call, purpose, requestId))
    this.transport.deadlines.set(call.id, asked.deadline ?? RecoveryMother.DEADLINE)
    if (asked.owned) this.transport.owned.add(call.id)
    return call
  }

  entries(watch: PlanWatch, ...tickets: string[]): void {
    this.journal.recorded.set(watch.agent, tickets.map((ticket) => ({
      ticket,
      request: '{}',
      receipt: { kind: 'present', text: '{}' },
    })))
  }

  async settlePublications(): Promise<void> {
    await Promise.all([...this.recovery.publications.values()].map((publication) => publication.work))
  }
}

describe('RunPlanRecovery projection', () => {
  it('publication uncertainty preserves proven local delivery through inventory and the unified query without publishing', async () => {
    const watch = RecoveryMother.watch()
    const delivery = new CompletedRunDelivery()
    delivery.inspection = { kind: 'uncertain', pullRequest: null, diagnostic: 'GitHub unavailable' }
    const tested = new ProjectionScenario([watch], delivery)
    const query = new ReadWorkProgress({
      inventory: new InspectedWorkInventory({
        inspection: tested.recovery, plans: tested.activePlans, records: new PlanRecords(), delivery,
      }),
      plans: new PlanProgress(), activities: new PlanningActivities(),
      implementation: { execute: async () => { throw new Error('known local completion must not depend on another remote read') } },
    })

    const result = await query.execute(new ReadWorkProgressParams(watch.issue.number, watch.repository))

    expect(result.progress.detail).toMatchObject({
      phase: 'uncertain', diagnostic: 'GitHub unavailable',
      recovery: { action: 'inspect', detail: 'GitHub unavailable' },
      execution: { kind: 'partial', value: { step: 'delivered', pullRequest: null }, detail: 'GitHub unavailable' },
    })
    await tested.recovery.recover()
    expect(tested.activePlans.find({ issue: watch.issue.number, repository: watch.repository })).toMatchObject({
      phase: 'uncertain', execution: { step: 'delivered' }, recovery: { action: 'inspect' },
    })
    expect(delivery.delivered).toEqual([])
    expect(tested.reviews.started).toEqual([])
    expect(tested.machine.effects.commands).toBe(0)
  })

  it('startup restores recorded calls while subsequent plan observations leave measurements alone', async () => {
    const tested = new ProjectionScenario()

    expect(await tested.recovery.restoreCalls()).toBeNull()
    expect(tested.transport.restored).toEqual(tested.watches.map((watch) => watch.agent))
    tested.transport.restored.length = 0
    expect(await tested.recovery.recover()).toBeNull()
    expect(await tested.recovery.recover()).toBeNull()

    expect(tested.transport.restored).toEqual([])
    expect(tested.transport.spawns).toBe(0)
  })

  it('startup reports a failed measurement restoration without replaying an agent', async () => {
    const tested = new ProjectionScenario()
    tested.transport.restorationFailure = new Error('measurement disk is full')

    expect(await tested.recovery.restoreCalls()).toContain('measurement disk is full')
    expect(tested.transport.spawns).toBe(0)
  })

  it('startup refuses an unreadable call registry instead of treating it as empty', async () => {
    const tested = new ProjectionScenario()
    tested.records.found = PlansInFlight.refused('call registry is unreadable')

    expect(await tested.recovery.restoreCalls()).toBe('call registry is unreadable')
    expect(tested.transport.restored).toEqual([])
  })

  it('an inventory read can forget retired work without losing the maintenance-owned review cleanup', async () => {
    const watch = RecoveryMother.watch()
    const tested = new ProjectionScenario([watch])
    await tested.recovery.recover()
    expect(tested.reviews.started).toEqual([watch])
    const stopped = tested.reviews.stopped.length
    tested.records.found = PlansInFlight.listed([])

    await tested.recovery.inspect()
    expect(tested.activePlans.known()).toEqual([])
    expect(tested.reviews.stopped).toHaveLength(stopped)
    await tested.recovery.recover()
    expect(tested.reviews.stopped).toHaveLength(stopped + 1)
  })

  it('conflicting recorded identities are refused before publication or review effects', async () => {
    const watch = RecoveryMother.watch()
    const tested = new ProjectionScenario([watch, watch])
    await expect(tested.recovery.inspect()).rejects.toBeInstanceOf(PlanRecoveryConflict)
    expect(tested.activePlans.known()).toEqual([])
    expect(tested.reviews.started).toEqual([])
    expect(tested.machine.effects.commands).toBe(0)
  })

  it('inspection reports pending publication without publishing or managing review observers', async () => {
    const watch = RecoveryMother.watch()
    const delivery = new StartupRunDelivery()
    const tested = new ProjectionScenario([watch], delivery)

    expect(await tested.recovery.inspect()).toBeNull()
    expect(await tested.recovery.inspect()).toBeNull()

    expect(tested.activePlans.known()[0]).toMatchObject({ phase: 'implementing', acceptsChange: false })
    expect(delivery.deliveries).toBe(0)
    expect(tested.reviews.started).toEqual([])
    expect(tested.machine.effects.commands).toBe(0)
    expect(tested.transport.spawns).toBe(0)

    await tested.recovery.recover()
    expect(delivery.deliveries).toBe(1)
    await tested.settlePublications()
    await tested.recovery.inspect()
    expect(tested.activePlans.known()[0]).toMatchObject({ phase: 'implementing', acceptsChange: true })
    expect(tested.reviews.started).toEqual([])
    await tested.recovery.recover()
    expect(tested.reviews.started).toEqual([watch])
  })

  it('continues publication during startup without a GET and starts review only after checked delivery', async () => {
    const watch = RecoveryMother.watch()
    const delivery = new StartupRunDelivery()
    const tested = new ProjectionScenario([watch], delivery)

    expect(await tested.recovery.recover()).toBeNull()

    expect(delivery.deliveries).toBe(1)
    expect(tested.machine.effects.commands).toBe(0)
    expect(tested.reviews.started).toEqual([])
    expect(tested.activePlans.known()[0]).toMatchObject({ phase: 'implementing', acceptsChange: false })

    await tested.settlePublications()
    expect(await tested.recovery.recover()).toBeNull()

    expect(delivery.deliveries).toBe(1)
    expect(tested.reviews.started).toEqual([watch])
  })

  it('reads an in-flight publication without waiting for it to finish', async () => {
    const watch = RecoveryMother.watch()
    const delivery = new HeldRunDelivery()
    const tested = new ProjectionScenario([watch], delivery)

    expect(await tested.recovery.recover()).toBeNull()
    expect(await tested.recovery.recover()).toBeNull()

    expect(delivery.deliveries).toBe(1)
    expect(tested.reviews.started).toEqual([])
    expect(tested.activePlans.known()[0]).toMatchObject({ phase: 'implementing', acceptsChange: false })
    delivery.finish()
  })

  it('does not start the review observer when startup publication cannot prove checked delivery', async () => {
    const watch = RecoveryMother.watch()
    const delivery = new StartupRunDelivery(true)
    const tested = new ProjectionScenario([watch], delivery)

    expect(await tested.recovery.recover()).toBeNull()
    await tested.settlePublications()
    expect(await tested.recovery.recover()).toBeNull()

    expect(delivery.deliveries).toBe(1)
    expect(tested.machine.effects.commands).toBe(0)
    expect(tested.reviews.started).toEqual([])
    expect(tested.activePlans.known()[0]).toMatchObject({
      phase: 'uncertain',
      diagnostic: 'checked release refused at startup',
      recovery: { action: 'continue' },
    })
  })

  it('restart recovers a driver identity without replaying an unowned call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-recovery-unowned-'))
    try {
      const fixture = await FiniteBridge.build(root)
      await FiniteBridge.recordWatch(fixture)
      await fixture.journal.admit(fixture.watch)
      await fixture.journal.establish(fixture.watch, FiniteBridge.manifest(fixture.watch))
      const ticket = await fixture.journal.begin(
        fixture.watch,
        FiniteBridge.request(fixture.worktree, null, FiniteBridge.initialNext()),
      )
      await fixture.journal.finish(
        fixture.watch,
        ticket,
        FiniteBridge.receipt(
          new ProcessOutput({ code: 0, stdout: FiniteBridge.announcement(fixture), stderr: '' }),
          null,
          fixture.run.bytes,
        ),
      )
      const dispatch = await fixture.machine.dispatch(fixture.watch, ticket)
      const call = new StartedPlanCall({
        conversation: fixture.watch.agent,
        id: FiniteBridge.IMPLEMENTATION,
      })
      const invocation = new CallInvocation({
        conversation: fixture.watch.agent,
        purpose: 'implementation',
        cwd: fixture.worktree,
        argv: [
          '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
          '--plugin-dir', FiniteBridge.pluginRoot, '--resume', fixture.watch.agent,
          ...dispatch.argv,
          CallDescriptor.opening(join(fixture.files.callDirectory(call), CallDescriptor.PROMPT)),
        ],
        prompt: `Read the listed files.\n${dispatch.paths.join('\n')}\n${ClaudeRunCalls.ERRAND_END}`,
        requestId: `run:${ticket}`,
      })
      await FiniteBridge.saveCall({
        fixture,
        call,
        descriptor: new CallDescriptor({
          conversation: invocation.conversation,
          purpose: invocation.purpose,
          requestId: invocation.requestId,
          cwd: invocation.cwd,
          binary: '/usr/local/bin/claude',
          argv: invocation.argv,
          startedAt: FiniteBridge.STARTED,
          budgetMs: 7_200_000,
          killGraceMs: 5_000,
        }),
        prompt: invocation.prompt,
        stream: '',
      })
      const operation = join(fixture.state, 'harness', fixture.watch.agent, 'run', 'operations', ticket)
      const callDirectory = fixture.files.callDirectory(call)
      const before = {
        dispatch: await readFile(join(fixture.state, 'harness', fixture.watch.agent, 'dispatch.json'), 'utf8'),
        descriptor: await readFile(join(callDirectory, CallDescriptor.FILE), 'utf8'),
        prompt: await readFile(join(callDirectory, CallDescriptor.PROMPT), 'utf8'),
        request: await readFile(join(operation, 'request.json'), 'utf8'),
        receipt: await readFile(join(operation, 'receipt.json'), 'utf8'),
        material: await readFile(join(operation, 'material.json'), 'utf8'),
      }
      const restarted = await FiniteBridge.build(root, {
        ids: [],
        calls: fixture.calls,
        run: fixture.run,
        warnings: fixture.warnings,
        prepare: false,
      })
      const activePlans = new ActivePlans({ sessions: new PlanSessions() })
      const reviews = new RecoveryReviews()
      const recovery = new RunPlanRecovery({
        legacy: new RecoveryLegacy(),
        records: restarted.records,
        calls: restarted.planCalls,
        transport: restarted.transport,
        machine: restarted.machine,
        journal: restarted.journal,
        agents: restarted.agents,
        delivery: new CompletedRunDelivery(),
        checkouts: new RecoveryCheckouts(),
        activePlans,
        reviews,
        nowMs: () => Date.parse(FiniteBridge.STARTED),
      })

      expect(await recovery.recover()).toBeNull()

      expect(activePlans.known()).toEqual([
        expect.objectContaining({
          phase: 'uncertain',
          diagnostic: expect.stringContaining('not owned'),
          recovery: { action: 'inspect', detail: expect.stringContaining('not owned') },
          plan: expect.objectContaining({ agent: FiniteBridge.CONVERSATION }),
        }),
      ])
      expect(reviews.started).toEqual([])
      expect(fixture.calls.count).toBe(0)
      expect(fixture.spawns()).toBe(0)
      expect(restarted.spawns()).toBe(0)
      expect(await readFile(join(fixture.state, 'harness', fixture.watch.agent, 'dispatch.json'), 'utf8')).toBe(before.dispatch)
      expect(await readFile(join(callDirectory, CallDescriptor.FILE), 'utf8')).toBe(before.descriptor)
      expect(await readFile(join(callDirectory, CallDescriptor.PROMPT), 'utf8')).toBe(before.prompt)
      expect(await readFile(join(operation, 'request.json'), 'utf8')).toBe(before.request)
      expect(await readFile(join(operation, 'receipt.json'), 'utf8')).toBe(before.receipt)
      expect(await readFile(join(operation, 'material.json'), 'utf8')).toBe(before.material)
      await expect(fs.stat(join(callDirectory, CallDescriptor.COMPLETION))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fs.stat(join(callDirectory, ClaudeRunCalls.RESPONSE))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['unstarted', new RunInspection({ kind: 'unstarted' })],
    ['completed command', new RunInspection({
      kind: 'active',
      instruction: new RunInstruction({ kind: 'command', ticket: '33333333-3333-4333-8333-333333333333' }),
    })],
    ['completed call', new RunInspection({
      kind: 'active',
      instruction: new RunInstruction({ kind: 'call', ticket: '33333333-3333-4333-8333-333333333333' }),
    })],
  ])('%s machine work offers explicit continuation without executing GET', async (_name, inspection) => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    tested.machine.inspections.set(watch.agent, inspection)

    await tested.recovery.recover()

    expect(tested.activePlans.known()[0]).toMatchObject({
      phase: 'uncertain',
      recovery: { action: 'continue' },
    })
  })

  it.each([
    ['owned incomplete planner', 'planning', null, null],
    ['completed planner', 'uncertain', 'continue', 'continuation remain pending'],
    ['failed planner', 'uncertain', 'inspect', 'recorded failure'],
    ['expired planner', 'uncertain', 'inspect', 'after its recorded deadline'],
    ['definite non-launch', 'uncertain', 'cleanup', 'definite initial non-launch'],
  ] as const)('pre-manifest %s preserves planner and non-launch policy', async (
    state,
    phase,
    action,
    diagnostic,
  ) => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    tested.machine.inspections.set(watch.agent, new RunInspection({ kind: 'absent' }))
    if (state === 'definite non-launch') {
      tested.calls.decisions.set(watch.agent, PlanRecovery.from({
        calls: [],
        proof: new PlanNonLaunch({
          conversation: watch.agent,
          callId: null,
          source: 'before-worker',
          diagnostic: 'worker was never started',
          observedAt: RecoveryMother.STARTED,
        }),
        cleanup: null,
        nowMs: RecoveryMother.NOW,
      }))
    } else {
      const planner = RecoveryMother.call(watch, '33333333-3333-4333-8333-333333333333')
      const completion = state === 'owned incomplete planner' || state === 'expired planner'
        ? null
        : RecoveryMother.completion(planner, state === 'completed planner')
      const deadline = state === 'expired planner' ? RecoveryMother.NOW : RecoveryMother.DEADLINE
      tested.add(watch, 'plan', null, { id: planner.id, completion, deadline, owned: true })
      tested.calls.decisions.set(watch.agent, PlanRecovery.from({
        calls: [new RecoveryCall({
          call: planner,
          purpose: 'plan',
          startedAt: RecoveryMother.STARTED,
          deadlineMs: deadline,
          completion,
        })],
        proof: null,
        cleanup: null,
        nowMs: RecoveryMother.NOW,
      }))
    }

    await tested.recovery.recover()

    const projected = tested.activePlans.known()[0]
    expect(projected.phase).toBe(phase)
    if (action !== null) {
      expect(projected).toMatchObject({
        diagnostic: expect.stringContaining(diagnostic),
        recovery: { action, detail: expect.stringContaining(diagnostic) },
      })
    }
    expect(tested.reviews.started).toEqual([])
    expect(tested.machine.effects.commands).toBe(0)
    expect(tested.transport.spawns).toBe(0)
  })

  it('restart projects a command nobody finished as continuable without closing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-recovery-pending-'))
    try {
      const fixture = await FiniteBridge.build(root)
      await FiniteBridge.recordWatch(fixture)
      await fixture.journal.admit(fixture.watch)
      await fixture.journal.establish(fixture.watch, FiniteBridge.manifest(fixture.watch))
      const ticket = await fixture.journal.begin(
        fixture.watch,
        FiniteBridge.request(fixture.worktree, null, FiniteBridge.initialNext()),
      )
      const operation = join(fixture.state, 'harness', fixture.watch.agent, 'run', 'operations', ticket)
      const restarted = await FiniteBridge.build(root, {
        ids: [],
        calls: fixture.calls,
        run: fixture.run,
        warnings: fixture.warnings,
        prepare: false,
      })
      const activePlans = new ActivePlans({ sessions: new PlanSessions() })
      const recovery = new RunPlanRecovery({
        legacy: new RecoveryLegacy(),
        records: restarted.records,
        calls: restarted.planCalls,
        transport: restarted.transport,
        machine: restarted.machine,
        journal: restarted.journal,
        agents: restarted.agents,
        delivery: new CompletedRunDelivery(),
        checkouts: new RecoveryCheckouts(),
        activePlans,
        reviews: new RecoveryReviews(),
        nowMs: () => Date.parse(FiniteBridge.STARTED),
      })

      expect(await recovery.recover()).toBeNull()

      expect(activePlans.known()).toEqual([
        expect.objectContaining({
          phase: 'uncertain',
          recovery: { action: 'continue', detail: expect.any(String) },
          plan: expect.objectContaining({ agent: FiniteBridge.CONVERSATION }),
        }),
      ])
      await expect(fs.stat(join(operation, 'receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(fixture.calls.count).toBe(0)
      expect(restarted.spawns()).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['unexplained run bytes', 'the established run has unexplained plugin activity'],
  ])('%s remains inspect-only', async (_name, detail) => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    tested.machine.inspections.set(watch.agent, new RunInspection({ kind: 'uncertain', detail, closure: null }))

    await tested.recovery.recover()

    expect(tested.activePlans.known()[0]).toMatchObject({
      phase: 'uncertain',
      diagnostic: detail,
      recovery: { action: 'inspect', detail },
    })
  })

  it('a spent discard budget is reported apart from red controls', async () => {
    const spent = RecoveryMother.watch(331, '1')
    const red = RecoveryMother.watch(332, '2')
    const unclassified = RecoveryMother.watch(333, '3')
    const tested = new ProjectionScenario([spent, red, unclassified])
    tested.machine.inspections.set(spent.agent, new RunInspection({
      kind: 'uncertain',
      detail: 'ct-step refused: the run is blocked-judge with outcome discarded (exit 3)',
      closure: { state: 'blocked-judge', outcome: 'discarded', exit: 3, task: null, findings: null, verdict: null },
    }))
    tested.machine.inspections.set(red.agent, new RunInspection({
      kind: 'uncertain',
      detail: 'ct-step refused: the run is blocked-controls with outcome failed (exit 4)',
      closure: { state: 'blocked-controls', outcome: 'failed', exit: 4, task: null, findings: null, verdict: null },
    }))
    tested.machine.inspections.set(unclassified.agent, new RunInspection({
      kind: 'uncertain',
      detail: 'ct-step exited 9 without announcing a run state',
      closure: null,
    }))

    await tested.recovery.recover()

    const projected = tested.activePlans.known()
    expect(projected).toHaveLength(3)
    expect(projected[0].refusal).toEqual({
      state: 'blocked-judge', outcome: 'discarded', exit: 3, task: null, findings: null, verdict: null,
    })
    expect(projected[1].refusal).toEqual({
      state: 'blocked-controls', outcome: 'failed', exit: 4, task: null, findings: null, verdict: null,
    })
    expect(Object.hasOwn(projected[2], 'refusal')).toBe(false)
    expect(Object.isFrozen(projected[0].refusal)).toBe(true)
    expect(Object.isFrozen(projected[0].recovery)).toBe(true)
  })

  it('a refusal with no classification projects no refusal key', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    tested.machine.inspections.set(watch.agent, new RunInspection({
      kind: 'uncertain',
      detail: 'ct-step exited 9 without announcing a run state',
      closure: null,
    }))

    await tested.recovery.recover()

    const projected = tested.activePlans.known()[0]
    expect(Object.keys(projected)).toEqual(['phase', 'acceptsChange', 'request', 'plan', 'diagnostic', 'recovery'])
    expect(projected.diagnostic).toBe('ct-step exited 9 without announcing a run state')
  })

  it('a driver implementation must name a journal ticket exactly once', async () => {
    const missing = new ProjectionScenario()
    const watch = missing.watches[0]
    missing.add(watch, 'implementation', 'run:33333333-3333-4333-8333-333333333333')
    missing.entries(watch, '44444444-4444-4444-8444-444444444444')

    await missing.recovery.recover()
    expect(missing.activePlans.known()[0].diagnostic).toContain('that is absent')

    const duplicate = new ProjectionScenario()
    const duplicateWatch = duplicate.watches[0]
    const ticket = '33333333-3333-4333-8333-333333333333'
    duplicate.add(duplicateWatch, 'implementation', `run:${ticket}`)
    duplicate.add(duplicateWatch, 'implementation', `run:${ticket}`, {
      id: '44444444-4444-4444-8444-444444444444',
    })
    duplicate.entries(duplicateWatch, ticket)

    await duplicate.recovery.recover()
    expect(duplicate.activePlans.known()[0].diagnostic).toContain('multiple implementation calls')
  })

  it('multiple completed step calls with distinct tickets are valid driver history', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    const first = '33333333-3333-4333-8333-333333333333'
    const second = '44444444-4444-4444-8444-444444444444'
    tested.add(watch, 'implementation', `run:${first}`)
    tested.add(watch, 'implementation', `run:${second}`, { id: '55555555-5555-4555-8555-555555555555' })
    tested.entries(watch, first, second)

    await tested.recovery.recover()

    expect(tested.activePlans.known()[0].phase).toBe('implementing')
    expect(tested.reviews.started).toEqual([watch])
  })

  it('all positively legacy records delegate the whole recovery', async () => {
    const tested = new ProjectionScenario()
    tested.agents.provenances.set(tested.watches[0].agent, RunProvenance.LEGACY)

    expect(await tested.recovery.recover()).toBeNull()

    expect(tested.legacy.recoveries).toBe(1)
    expect(tested.activePlans.known()).toEqual([])
  })

  it('mixed legacy and driver histories keep distinct ownership and recovery rules', async () => {
    const legacyWatch = RecoveryMother.watch(331, '1')
    const driverWatch = RecoveryMother.watch(332, '2')
    const tested = new ProjectionScenario([legacyWatch, driverWatch])
    tested.agents.provenances.set(legacyWatch.agent, RunProvenance.LEGACY)
    const implementation = RecoveryMother.call(legacyWatch, '33333333-3333-4333-8333-333333333333')
    tested.calls.decisions.set(legacyWatch.agent, RecoveryMother.decision([
      RecoveryMother.fact(implementation, 'implementation', RecoveryMother.completion(implementation)),
    ]))

    await tested.recovery.recover()

    expect(tested.legacy.recoveries).toBe(0)
    expect(tested.activePlans.known()).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'implementing', plan: expect.objectContaining({ agent: legacyWatch.agent }) }),
      expect.objectContaining({ phase: 'implementing', plan: expect.objectContaining({ agent: driverWatch.agent }) }),
    ]))
    expect(tested.reviews.started).toEqual(expect.arrayContaining([legacyWatch, driverWatch]))
  })

  it('an unproven legacy record is projected as uncertain while every other plan keeps its phase', async () => {
    const first = RecoveryMother.watch(331, '1')
    const second = RecoveryMother.watch(332, '2')
    const tested = new ProjectionScenario([first, second])
    tested.agents.provenances.set(
      second.agent,
      new PlanRecoveryConflict('conversation "workspace:2" has unproven call provenance'),
    )

    expect(await tested.recovery.recover()).toBeNull()

    expect(tested.activePlans.known()).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'implementing', plan: expect.objectContaining({ agent: first.agent }) }),
      expect.objectContaining({
        phase: 'uncertain',
        diagnostic: 'conversation "workspace:2" has unproven call provenance',
        recovery: { action: 'inspect', detail: 'conversation "workspace:2" has unproven call provenance' },
        plan: expect.objectContaining({ agent: second.agent }),
      }),
    ]))
    expect(tested.reviews.started).toEqual([first])
  })

  it('a record that cannot be read preserves every previous projection transactionally', async () => {
    const first = RecoveryMother.watch(331, '1')
    const second = RecoveryMother.watch(332, '2')
    const tested = new ProjectionScenario([first, second])
    tested.activePlans.rememberPlanning(first)
    tested.activePlans.rememberUncertain(second, 'previous evidence', { action: 'inspect', detail: 'previous evidence' })
    const before = tested.activePlans.known()
    tested.agents.provenances.set(second.agent, new Error('malformed second record'))

    expect(await tested.recovery.recover()).toBe('malformed second record')

    expect(tested.activePlans.known()).toEqual(before)
    expect(tested.checkouts.remembered).toEqual([])
    expect(tested.reviews.stopped).toEqual([])
  })

  it('GET recovery writes no evidence and cannot revive an obsolete review watcher', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    await tested.recovery.recover()
    expect(tested.reviews.started).toEqual([watch])
    tested.machine.inspections.set(watch.agent, new RunInspection({ kind: 'uncertain', detail: 'inspect only', closure: null }))
    await tested.recovery.recover()
    tested.machine.inspections.set(watch.agent, new RunInspection({ kind: 'delivered' }))
    await tested.recovery.recover()

    expect(tested.reviews.started).toEqual([watch, watch])
    expect(tested.reviews.stopped.length).toBeGreaterThanOrEqual(2)
  })

  it('repeated delivered recovery starts one watcher and harvested work is forgotten', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    await tested.recovery.recover()
    await tested.recovery.recover()
    expect(tested.reviews.started).toEqual([watch])

    tested.records.found = PlansInFlight.listed([])
    await tested.recovery.recover()

    expect(tested.activePlans.known()).toEqual([])
    expect(tested.reviews.stopped).toContain(`${watch.repository.text}#${watch.issue.number}`)
  })

  it('a terminated recovered watcher can be registered again', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    await tested.recovery.recover()
    tested.reviews.settle(watch)
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    await tested.recovery.recover()

    expect(tested.reviews.started).toEqual([watch, watch])
  })

  it('a delayed obsolete watcher settlement cannot remove its replacement registration', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    const firstRead = new Barrier<{ changes: readonly never[] }>()
    const secondRead = new Barrier<{ changes: readonly never[] }>()
    let reads = 0
    let deliveries = 0
    const warnings: string[] = []
    const reviews = new ReviewWatch({
      asked: async () => {
        reads += 1
        if (reads === 1) return firstRead.promise
        if (reads === 2) return secondRead.promise
        throw new Error(`unexpected review read ${reads}`)
      },
      review: async () => { deliveries += 1 },
      sleep: async () => { throw new Error('the replacement watcher must remain at its baseline barrier') },
      stderr: (line) => { warnings.push(line) },
      label: 'run recovery registration lifecycle',
      log: new ReviewLog(),
    })
    const recovery = new RunPlanRecovery({
      legacy: tested.legacy,
      records: tested.records,
      calls: tested.calls,
      transport: tested.transport,
      machine: tested.machine,
      journal: tested.journal,
      agents: tested.agents,
      delivery: new CompletedRunDelivery(),
      checkouts: tested.checkouts,
      activePlans: tested.activePlans,
      reviews,
      nowMs: () => RecoveryMother.NOW,
    })

    try {
      await recovery.recover()
      expect(reads).toBe(1)
      tested.machine.inspections.set(watch.agent, new RunInspection({ kind: 'uncertain', detail: 'replace watcher', closure: null }))
      await recovery.recover()
      tested.machine.inspections.set(watch.agent, new RunInspection({ kind: 'delivered' }))
      await recovery.recover()
      expect(reads).toBe(2)
      const replacement = reviews.live.get(`${watch.repository.text}#${watch.issue.number}`)
      expect(replacement).toBeDefined()

      firstRead.resolve({ changes: [] })
      await Barrier.turn()
      await Barrier.turn()
      await recovery.recover()

      expect(reads).toBe(2)
      expect(reviews.live.get(`${watch.repository.text}#${watch.issue.number}`)).toBe(replacement)
      expect(deliveries).toBe(0)
      expect(warnings).toEqual([])
    } finally {
      reviews.stop({ issue: watch.issue.number, repository: watch.repository })
      if (!firstRead.settled) firstRead.resolve({ changes: [] })
      if (!secondRead.settled) secondRead.resolve({ changes: [] })
      await Barrier.turn()
    }
  })

  it('a change asked while a fix ran is delivered once when the watcher comes back', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    const A = new ChangeAsked({ id: 'IC_kwDOAAAAAAABAAAA', text: 'first change', askedAt: '2026-09-17T09:05:00.000Z' })
    const B = new ChangeAsked({ id: 'IC_kwDOAAAAAAABBBBB', text: 'second change', askedAt: '2026-09-17T09:10:00.000Z' })
    const answers: ChangesAsked[] = [{ changes: [] }, { changes: [A] }, { changes: [A, B] }]
    let readIndex = 0
    const reviewed: Delivered[] = []
    const deliveredA = new Barrier<void>()
    const deliveredB = new Barrier<void>()
    let sleeps = 0
    const blockedSleeps: Barrier<void>[] = []
    const reviews = new ReviewWatch({
      asked: async () => {
        const answer = answers[readIndex]
        readIndex += 1
        return answer
      },
      review: async (params) => {
        reviewed.push(params)
        if (params.requestId === A.id) deliveredA.resolve()
        if (params.requestId === B.id) deliveredB.resolve()
      },
      sleep: async () => {
        sleeps += 1
        if (sleeps === 2 || sleeps === 4) {
          const barrier = new Barrier<void>()
          blockedSleeps.push(barrier)
          return barrier.promise
        }
      },
      stderr: () => {},
      label: 'run recovery review',
      log: new MemoryReviewLog(),
    })
    const recovery = new RunPlanRecovery({
      legacy: tested.legacy,
      records: tested.records,
      calls: tested.calls,
      transport: tested.transport,
      machine: tested.machine,
      journal: tested.journal,
      agents: tested.agents,
      delivery: new CompletedRunDelivery(),
      checkouts: tested.checkouts,
      activePlans: tested.activePlans,
      reviews,
      nowMs: () => RecoveryMother.NOW,
    })

    try {
      await recovery.recover()
      await Barrier.bounded(deliveredA.promise)

      const fix = tested.add(watch, 'fix', A.id, { completion: null, owned: true })
      await recovery.recover()

      tested.transport.histories.set(watch.agent, [
        RecoveryMother.recorded(fix, 'fix', RecoveryMother.completion(fix)),
      ])
      await recovery.recover()
      await Barrier.bounded(deliveredB.promise)

      expect(reviewed.map((entry) => entry.requestId)).toEqual([A.id, B.id])
    } finally {
      reviews.stop({ issue: watch.issue.number, repository: watch.repository })
      for (const barrier of blockedSleeps) barrier.resolve()
      await Barrier.turn()
    }
  })

  it('RunPlanAgents exposes only its active supervisor reservation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-recovery-reservation-'))
    let lifecycleCalls: LifecycleCalls | null = null
    let lifecycleSettled: Barrier<void> | null = null
    try {
      const watch = RecoveryMother.watch()
      const files = new HeadlessFiles({ root, fs, newId: () => 'temporary-record' })
      const journal = new RunJournal({
        files,
        newId: () => '99999999-9999-4999-8999-999999999999',
        now: () => { throw new Error('the journal clock is not asked') },
      })
      const records = new LifecycleRecords(watch)
      const calls = new LifecycleCalls(watch)
      lifecycleCalls = calls
      const transport = new RecoveryTransport()
      transport.histories.set(watch.agent, [RecoveryMother.recorded(calls.planner, 'plan', null)])
      transport.descriptors.set(calls.planner.id, RecoveryMother.descriptor(watch, calls.planner, 'plan', null))
      transport.deadlines.set(calls.planner.id, RecoveryMother.DEADLINE)
      transport.owned.add(calls.planner.id)
      const machine = new RecoveryMachine()
      machine.inspections.set(watch.agent, new RunInspection({ kind: 'absent' }))
      const driver = new DriveRun({
        calls,
        publication: new PlanPublication(),
        machine,
        delivery: new CompletedRunDelivery(),
        step: new ExecuteRunInstruction({
          machine,
          calls: new ClaudeRunCalls({ calls: transport, machine, files, pluginRoot: '/plugin' }),
        }),
        messages: new DeliverHeldMessages({
          messages: journal,
          calls: calls,
          escalations: new QuietEscalations(),
        }),
        escalations: QuietEscalations.reader(),
      })
      const settled = new Barrier()
      lifecycleSettled = settled
      const warnings: string[] = []
      const agents = new RunPlanAgents({
        legacy: new PlanAgents(),
        records,
        calls,
        transport,
        driver,
        machine,
        journal,
        delivery: new CompletedRunDelivery(),
        announcements: new SilentChangeAnnouncements(),
        newId: () => 'unused',
        nowMs: () => RecoveryMother.NOW,
        stderr: (line) => { warnings.push(line); settled.resolve() },
      })
      const policyCalls = new RecoveryCalls()
      policyCalls.decisions.set(watch.agent, PlanRecovery.from({
        calls: [new RecoveryCall({
          call: calls.planner,
          purpose: 'plan',
          startedAt: RecoveryMother.STARTED,
          deadlineMs: RecoveryMother.DEADLINE,
          completion: null,
        })],
        proof: null,
        cleanup: null,
        nowMs: RecoveryMother.NOW,
      }))
      const activePlans = new ActivePlans({ sessions: new PlanSessions() })
      const recovery = new RunPlanRecovery({
        legacy: new RecoveryLegacy(),
        records,
        calls: policyCalls,
        transport,
        machine,
        journal,
        agents,
        delivery: new CompletedRunDelivery(),
        checkouts: new RecoveryCheckouts(),
        activePlans,
        reviews: new RecoveryReviews(),
        nowMs: () => RecoveryMother.NOW,
      })
      const briefing = new PlanBriefing({
        story: watch.story,
        issue: watch.issue,
        located: watch.located,
        repository: watch.repository,
      })

      expect(agents.owns(watch)).toBe(false)
      await agents.launch(briefing)
      expect(agents.owns(watch)).toBe(true)

      await recovery.recover()
      expect(activePlans.known()[0].phase).toBe('planning')

      machine.inspections.set(watch.agent, new RunInspection({
        kind: 'active',
        instruction: new RunInstruction({ kind: 'call', ticket: '66666666-6666-4666-8666-666666666666' }),
      }))
      await recovery.recover()
      expect(activePlans.known()[0]).toMatchObject({
        phase: 'uncertain',
        diagnostic: expect.stringContaining('not the current machine work'),
        recovery: { action: 'inspect' },
      })

      const fix = RecoveryMother.call(watch, '88888888-8888-4888-8888-888888888888')
      transport.histories.set(watch.agent, [RecoveryMother.recorded(fix, 'fix', null)])
      transport.descriptors.set(fix.id, RecoveryMother.descriptor(watch, fix, 'fix', 'review-1'))
      transport.deadlines.set(fix.id, RecoveryMother.NOW)
      transport.owned.add(fix.id)
      machine.inspections.set(watch.agent, new RunInspection({ kind: 'delivered' }))

      await recovery.recover()
      expect(activePlans.known()[0]).toMatchObject({
        phase: 'uncertain',
        diagnostic: expect.stringContaining('after its recorded deadline'),
        recovery: { action: 'inspect' },
      })
      expect(agents.owns(watch)).toBe(true)

      calls.completion.reject(new Error('bounded lifecycle stop'))
      await Barrier.bounded(settled.promise)
      expect(warnings.join('')).toContain('bounded lifecycle stop')
      expect(agents.owns(watch)).toBe(false)
    } finally {
      if (lifecycleCalls !== null && lifecycleSettled !== null && !lifecycleSettled.settled) {
        lifecycleCalls.completion.reject(new Error('bounded lifecycle cleanup'))
        await Barrier.bounded(lifecycleSettled.promise)
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('another unfinished call blocks a completed current response', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    const ticket = '33333333-3333-4333-8333-333333333333'
    tested.add(watch, 'implementation', `run:${ticket}`)
    tested.add(watch, 'plan', null, { id: '44444444-4444-4444-8444-444444444444', completion: null, owned: true })
    tested.entries(watch, ticket)
    tested.machine.inspections.set(watch.agent, new RunInspection({
      kind: 'active',
      instruction: new RunInstruction({ kind: 'call', ticket }),
    }))

    await tested.recovery.recover()

    expect(tested.activePlans.known()[0]).toMatchObject({ phase: 'uncertain', recovery: { action: 'inspect' } })
    expect(tested.activePlans.known()[0].diagnostic).toContain('not the current machine work')
  })

  it('a run that is mid-step accepts a change, because the queue holds it to the next boundary', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    const ticket = '33333333-3333-4333-8333-333333333333'
    tested.add(watch, 'implementation', `run:${ticket}`)
    tested.entries(watch, ticket)
    tested.machine.inspections.set(watch.agent, new RunInspection({
      kind: 'active',
      instruction: new RunInstruction({ kind: 'call', ticket }),
    }))
    tested.agents.reservations.add(watch.agent)

    await tested.recovery.recover()

    expect(tested.activePlans.known()[0]).toMatchObject({ phase: 'implementing', acceptsChange: true })
  })

  describe.each([
    ['failed', 'failed', false, 'uncertain', 'inspect', 'recorded failure', true, null],
    ['successful', 'successful', true, 'implementing', null, null, false, true],
    ['owned incomplete', 'incomplete', true, 'implementing', null, null, true, false],
    ['unowned incomplete', 'incomplete', false, 'uncertain', 'inspect', 'not owned', true, null],
  ] as const)('%s post-delivery fix', (
    _name,
    state,
    owned,
    phase,
    action,
    diagnostic,
    stopsReview,
    acceptsChange,
  ) => {
    it('post-delivery fix policy precedes the permanent delivered marker', async () => {
      const tested = new ProjectionScenario()
      const watch = tested.watches[0]
      await tested.recovery.recover()
      expect(tested.reviews.started).toEqual([watch])
      const stoppedBefore = tested.reviews.stopped.length
      const fix = RecoveryMother.call(watch, '33333333-3333-4333-8333-333333333333')
      const completion = state === 'incomplete' ? null : RecoveryMother.completion(fix, state === 'successful')
      tested.add(watch, 'fix', 'review-1', { completion, owned })

      await tested.recovery.recover()

      const projected = tested.activePlans.known()[0]
      expect(projected.phase).toBe(phase)
      if (acceptsChange !== null) expect(projected).toMatchObject({ acceptsChange })
      if (action !== null) {
        expect(projected).toMatchObject({
          diagnostic: expect.stringContaining(diagnostic),
          recovery: { action, detail: expect.stringContaining(diagnostic) },
        })
      } else {
        expect(projected).not.toHaveProperty('recovery')
      }
      expect(tested.reviews.started).toEqual([watch])
      expect(tested.reviews.stopped).toHaveLength(stoppedBefore + (stopsReview ? 1 : 0))
      expect(tested.machine.effects.commands).toBe(0)
      expect(tested.transport.spawns).toBe(0)
    })
  })

  it('an incomplete fix is expired at its exact recorded deadline', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    await tested.recovery.recover()
    const stoppedBefore = tested.reviews.stopped.length
    tested.add(watch, 'fix', 'review-1', { completion: null, owned: true, deadline: RecoveryMother.NOW })

    await tested.recovery.recover()

    expect(tested.activePlans.known()[0]).toMatchObject({
      phase: 'uncertain',
      diagnostic: expect.stringContaining('after its recorded deadline'),
      recovery: { action: 'inspect', detail: expect.stringContaining('after its recorded deadline') },
    })
    expect(tested.reviews.stopped).toHaveLength(stoppedBefore + 1)
    expect(tested.machine.effects.commands).toBe(0)
    expect(tested.transport.spawns).toBe(0)
  })

  it('equal-timestamp fixes remain ambiguous instead of selecting one', async () => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    await tested.recovery.recover()
    const stoppedBefore = tested.reviews.stopped.length
    tested.add(watch, 'fix', 'review-1', { completion: RecoveryMother.completion(
      RecoveryMother.call(watch, '33333333-3333-4333-8333-333333333333'),
    ) })
    tested.add(watch, 'fix', 'review-2', {
      id: '44444444-4444-4444-8444-444444444444',
      completion: RecoveryMother.completion(
        RecoveryMother.call(watch, '44444444-4444-4444-8444-444444444444'),
      ),
    })

    await tested.recovery.recover()

    expect(tested.activePlans.known()[0]).toMatchObject({
      diagnostic: expect.stringContaining('ambiguous evidence'),
      recovery: { action: 'inspect', detail: expect.stringContaining('ambiguous evidence') },
    })
    expect(tested.reviews.started).toEqual([watch])
    expect(tested.reviews.stopped).toHaveLength(stoppedBefore + 1)
    expect(tested.machine.effects.commands).toBe(0)
    expect(tested.transport.spawns).toBe(0)
  })

  it.each([
    ['newer failure after success', true, false, 'uncertain', 'recorded failure', true],
    ['newer success after failure', false, true, 'implementing', null, false],
  ] as const)('%s controls delivered recovery', async (
    _name,
    olderSucceeded,
    newerSucceeded,
    phase,
    diagnostic,
    stopsReview,
  ) => {
    const tested = new ProjectionScenario()
    const watch = tested.watches[0]
    await tested.recovery.recover()
    const stoppedBefore = tested.reviews.stopped.length
    const older = RecoveryMother.call(watch, '33333333-3333-4333-8333-333333333333')
    const newer = RecoveryMother.call(watch, '44444444-4444-4444-8444-444444444444')
    tested.add(watch, 'fix', 'review-1', {
      id: older.id,
      completion: RecoveryMother.completion(older, olderSucceeded),
      startedAt: '2026-09-17T09:01:00.000Z',
    })
    tested.add(watch, 'fix', 'review-2', {
      id: newer.id,
      completion: RecoveryMother.completion(newer, newerSucceeded),
      startedAt: '2026-09-17T09:02:00.000Z',
    })

    await tested.recovery.recover()

    const projected = tested.activePlans.known()[0]
    expect(projected.phase).toBe(phase)
    if (diagnostic !== null) {
      expect(projected).toMatchObject({
        diagnostic: expect.stringContaining(diagnostic),
        recovery: { action: 'inspect', detail: expect.stringContaining(diagnostic) },
      })
    } else {
      expect(projected).not.toHaveProperty('recovery')
    }
    expect(tested.reviews.started).toEqual([watch])
    expect(tested.reviews.stopped).toHaveLength(stoppedBefore + (stopsReview ? 1 : 0))
    expect(tested.machine.effects.commands).toBe(0)
    expect(tested.transport.spawns).toBe(0)
  })

})

class AcceptedWorker extends EventEmitter implements LaunchedProcess {
  kill(): boolean {
    return false
  }

  disconnect(): void {}

  unref(): void {}
}

class FiniteBridgePublication extends PlanPublication {
  override async publish(): Promise<void> {
    throw new Error('established recovery must not publish')
  }
}

class FiniteBridgeLegacy extends PlanAgents {}

class FiniteBridge {
  static readonly CONVERSATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  static readonly PLANNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  static readonly IMPLEMENTATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  static readonly DISPATCH = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  static readonly CONSUMING = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  static readonly BOUNDARY = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  static readonly PLAN = 'docs/superpowers/plans/2026-09-17-issue-332-machine.md'
  static readonly PLAN_BYTES = '# Recovery bridge plan\n'
  static readonly STARTED = '2026-09-17T09:00:00.000Z'
  static readonly RESPONSE = { paths: ['backend/src/recovered.ts'], summary: 'Recovered once.' }
  static readonly repositoryRoot = join(import.meta.dirname, '..', '..', '..')
  static readonly pluginRoot = join(FiniteBridge.repositoryRoot, 'plugin')
  static readonly roots: string[] = []

  static async build(root: string, asked: {
    ids?: string[],
    calls?: { count: number, asked: Array<{ argv: readonly string[], cwd: string | null }> },
    run?: { bytes: string | null },
    warnings?: string[],
    prepare?: boolean,
  } = {}) {
    const state = join(root, 'state')
    const checkout = join(root, 'checkout')
    const worktree = join(checkout, '.worktrees', '332')
    const response = join(worktree, '.agent', 'run-332', 'task-1-report.json')
    const brief = join(worktree, '.agent', 'run-332', 'task-1-brief.md')
    if (asked.prepare ?? true) {
      await fs.mkdir(dirname(brief), { recursive: true })
      await fs.mkdir(dirname(join(worktree, FiniteBridge.PLAN)), { recursive: true })
      await writeFile(brief, '# Prepared task brief\n', 'utf8')
      await writeFile(join(worktree, FiniteBridge.PLAN), FiniteBridge.PLAN_BYTES, 'utf8')
    }
    const files = new HeadlessFiles({ root: state, fs, newId: () => 'temporary-response' })
    const ids = asked.ids ?? [FiniteBridge.DISPATCH, FiniteBridge.CONSUMING, FiniteBridge.BOUNDARY]
    const journal = new RunJournal({
      files,
      newId: () => {
        const id = ids.shift()
        if (id === undefined) throw new Error('unexpected or duplicate journal request')
        return id
      },
      now: () => { throw new Error('the journal clock is not asked') },
    })
    const watch = new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 332, url: 'https://github.com/mercadona/control-tower-plugin/issues/332' }),
      located: new WorkspaceLocation({ root: checkout, path: worktree, branch: 'feat/332' }),
      repository: new RepositoryName('mercadona/control-tower-plugin'),
      agent: FiniteBridge.CONVERSATION,
    })
    const calls = asked.calls ?? { count: 0, asked: [] }
    const run = asked.run ?? { bytes: '{"task":1,"step":"implement"}\n' }
    const warnings = asked.warnings ?? []
    const reportArgv = [
      join(FiniteBridge.pluginRoot, 'scripts', 'ct-step.mjs'),
      'report', response, '--plan', FiniteBridge.PLAN, '--issue', '332',
      '--output-format', 'json',
    ]
    const nextArgv = [
      join(FiniteBridge.pluginRoot, 'scripts', 'ct-step.mjs'),
      'next', '--plan', FiniteBridge.PLAN, '--issue', '332',
      '--output-format', 'json',
    ]
    const node = async (argv: readonly string[], options: { cwd?: string } = {}): Promise<ProcessOutput> => {
      calls.count += 1
      calls.asked.push({ argv: [...argv], cwd: options.cwd ?? null })
      expect(options.cwd).toBe(worktree)
      if (calls.count === 1) {
        expect(argv).toEqual(reportArgv)
        expect(await readFile(response, 'utf8')).toBe(`${JSON.stringify(FiniteBridge.RESPONSE)}\n`)
        run.bytes = '{"task":1,"step":"judge"}\n'
        return new ProcessOutput({
          code: 0,
          stdout: '{"version":1,"kind":"transition","state":"open","outcome":"done","exit":0,'
            + '"run":{"issue":332,"task":1,"tasksTotal":1,"step":"implement","discards":0}}\n',
          stderr: '',
        })
      }
      if (calls.count === 2) {
        expect(argv).toEqual(nextArgv)
        return new ProcessOutput({ code: 17, stdout: '', stderr: 'finite recovery boundary\n' })
      }
      throw new Error(`unexpected or duplicate process request: ${JSON.stringify(argv)}`)
    }
    const machine = new CtRunMachine({
      journal,
      node,
      git: async () => { throw new Error('established recovery must not inspect git') },
      read: async (path) => {
        if (path === join(worktree, '.agent', 'run-332.json')) return run.bytes
        if (path === join(worktree, FiniteBridge.PLAN)) return FiniteBridge.PLAN_BYTES
        throw new Error(`unexpected machine read: ${path}`)
      },
      ctStep: join(FiniteBridge.pluginRoot, 'scripts', 'ct-step.mjs'),
      dispatchCheck: join(FiniteBridge.pluginRoot, 'scripts', 'dispatch-check.mjs'),
      pluginRoot: FiniteBridge.pluginRoot,
    })
    let spawns = 0
    const transport = new ClaudeCalls({
      files,
      binary: '/usr/local/bin/claude',
      worker: '/backend/headless-call-worker.ts',
      spawn: (() => {
        spawns += 1
        const child = new AcceptedWorker()
        queueMicrotask(() => child.emit('message', { kind: 'accepted' }))
        return child
      }) as ProcessRunner['launch'],
      env: {},
      newId: () => { throw new Error('recovery must not create a model call') },
      now: () => FiniteBridge.STARTED,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
      acceptanceMs: 10_000,
      pollMs: 250,
      sleep: async () => { throw new Error('recovery must not poll a completed call') },
    })
    const measured = new MeasuredAgentCalls({
      executor: transport, reader: new ClaudeRunMeasurements({ files }), store: new DiskAgentMeasurements({ files }),
    })
    const runCalls = new ClaudeRunCalls({
      calls: measured,
      machine,
      files,
      pluginRoot: FiniteBridge.pluginRoot,
    })
    const planCalls = new ClaudePlanCalls({
      calls: measured,
      records: new PlanRecords(),
      brief: new PlanAgentBrief({
        dispatchCheck: join(FiniteBridge.pluginRoot, 'scripts', 'dispatch-check.mjs'),
        conventions: join(FiniteBridge.pluginRoot, 'conventions'),
        ctStep: join(FiniteBridge.pluginRoot, 'scripts', 'ct-step.mjs'),
      }),
      pluginRoot: FiniteBridge.pluginRoot,
      resumable: async () => true,
      nowMs: () => Date.parse(FiniteBridge.STARTED),
    })
    const driver = new DriveRun({
      calls: planCalls,
      publication: new FiniteBridgePublication(),
      machine,
      delivery: new CompletedRunDelivery(),
      step: new ExecuteRunInstruction({ machine, calls: runCalls }),
      messages: new DeliverHeldMessages({
        messages: journal,
        calls: planCalls,
        escalations: new QuietEscalations(),
      }),
      escalations: QuietEscalations.reader(),
    })
    const records = new DiskPlanRecords({
      files,
      newId: () => { throw new Error('recovery must not prepare a plan') },
      now: () => { throw new Error('recovery must not timestamp a plan') },
      exists: async (path) => {
        try {
          await fs.stat(path)
          return true
        } catch (cause) {
          if (cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') return false
          throw cause
        }
      },
    })
    const agents = new RunPlanAgents({
      legacy: new FiniteBridgeLegacy(),
      records,
      calls: planCalls,
      transport: measured,
      driver,
      machine,
      journal,
      delivery: new CompletedRunDelivery(),
      announcements: new SilentChangeAnnouncements(),
      newId: () => 'unused-fix',
      nowMs: () => Date.parse(FiniteBridge.STARTED),
      stderr: (line) => { warnings.push(line) },
    })
    return { state, checkout, worktree, response, brief, files, journal, watch, calls, run, warnings, machine,
      transport: measured, runCalls, planCalls, driver, records, agents, spawns: () => spawns, reportArgv, nextArgv }
  }

  static async recordWatch(fixture: Awaited<ReturnType<typeof FiniteBridge.build>>): Promise<void> {
    await fs.mkdir(join(fixture.state, 'harness', fixture.watch.agent), { recursive: true })
    await writeFile(join(fixture.state, 'harness', fixture.watch.agent, 'dispatch.json'), `${JSON.stringify({
      repository: fixture.watch.repository.text,
      issue: { number: fixture.watch.issue.number, url: fixture.watch.issue.url },
      story: null,
      root: fixture.checkout,
      worktree: fixture.worktree,
      branch: fixture.watch.located.branch,
      startedAt: FiniteBridge.STARTED,
    }, null, 2)}\n`, 'utf8')
  }

  static announcement(fixture: Awaited<ReturnType<typeof FiniteBridge.build>>): string {
    return StepAnnouncement.dispatch({
      issue: 332,
      task: 1,
      tasksTotal: 1,
      step: STEPS.IMPLEMENT,
      attempt: 1,
      agent: undefined,
      inputs: [
        new AnnouncedInput({
          role: INPUT_ROLES.RUBRIC,
          kind: INPUT_KINDS.LITERAL,
          path: join(FiniteBridge.pluginRoot, RoleBytes.filesOf(STEPS.IMPLEMENT)[0]),
        }),
        new AnnouncedInput({
          role: INPUT_ROLES.BRIEF,
          kind: INPUT_KINDS.LITERAL,
          path: fixture.brief,
        }),
      ],
      response: AnnouncedResponse.of(STEPS.IMPLEMENT, fixture.response),
      consuming: {
        argv: ['report', fixture.response, '--plan', FiniteBridge.PLAN, '--issue', '332'],
      },
    }).text()
  }

  static initialNext(): readonly string[] {
    return [
      join(FiniteBridge.pluginRoot, 'scripts', 'ct-step.mjs'),
      'next', '--plan', FiniteBridge.PLAN, '--issue', '332',
      '--output-format', 'json',
    ]
  }

  static manifest(watch: PlanWatch): string {
    return `${JSON.stringify({
      version: 1,
      conversation: watch.agent,
      repository: watch.repository.text,
      issue: watch.issue.number,
      plan: FiniteBridge.PLAN,
      initialPlanSha256: createHash('sha256').update(FiniteBridge.PLAN_BYTES).digest('hex'),
    })}\n`
  }

  static request(worktree: string, previous: string | null, argv: readonly string[]): string {
    return `${JSON.stringify({
      version: 1,
      previous,
      argv,
      cwd: worktree,
      planSha256: createHash('sha256').update(FiniteBridge.PLAN_BYTES).digest('hex'),
    })}\n`
  }

  static receipt(output: ProcessOutput, beforeRun: string | null, afterRun: string | null): string {
    return `${JSON.stringify({
      version: 1,
      code: output.code,
      stdout: output.stdout,
      stderr: output.stderr,
      beforeRun,
      afterRun,
    })}\n`
  }

  static completion(call: StartedPlanCall, attribution: 'initial-invocation' | 'unverified-resume'): CompletedPlanCall {
    return new CompletedPlanCall({
      call,
      code: 0,
      signal: null,
      finishedAt: '2026-09-17T09:01:00.000Z',
      wallDurationMs: 60_000,
      execution: { kind: 'success' },
      measurement: {
        cost: { kind: 'reported', totalUsd: 0.25, attribution },
        turns: 1,
        durationMs: 55_000,
        unavailable: [],
      },
    })
  }

  static async saveCall(asked: {
    fixture: Awaited<ReturnType<typeof FiniteBridge.build>>,
    call: StartedPlanCall,
    descriptor: CallDescriptor,
    prompt: string,
    stream: string,
    completion?: CompletedPlanCall,
  }): Promise<void> {
    const directory = asked.fixture.files.callDirectory(asked.call)
    await fs.mkdir(directory, { recursive: true })
    await writeFile(join(directory, CallDescriptor.FILE), asked.descriptor.text(), 'utf8')
    await writeFile(join(directory, CallDescriptor.PROMPT), asked.prompt, 'utf8')
    await writeFile(join(directory, CallDescriptor.STREAM), asked.stream, 'utf8')
    if (asked.completion !== undefined) {
      await writeFile(join(directory, CallDescriptor.COMPLETION), StoredCompletion.text(asked.completion), 'utf8')
    }
  }

  static async bounded(condition: () => boolean): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('supervised recovery did not settle')), 1_000)
      const inspect = (): void => {
        if (condition()) {
          clearTimeout(timeout)
          resolve()
          return
        }
        setImmediate(inspect)
      }
      inspect()
    })
  }
}

describe('RunPlanRecovery finite bridge', () => {
  afterEach(async () => {
    await Promise.all(FiniteBridge.roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('completed response recovery consumes once without another model invocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-recovery-bridge-'))
    FiniteBridge.roots.push(root)
    const fixture = await FiniteBridge.build(root)
    await fs.mkdir(join(fixture.state, 'harness', fixture.watch.agent), { recursive: true })
    await writeFile(join(fixture.state, 'harness', fixture.watch.agent, 'dispatch.json'), `${JSON.stringify({
      repository: fixture.watch.repository.text,
      issue: { number: fixture.watch.issue.number, url: fixture.watch.issue.url },
      story: null,
      root: fixture.checkout,
      worktree: fixture.worktree,
      branch: fixture.watch.located.branch,
      startedAt: FiniteBridge.STARTED,
    }, null, 2)}\n`, 'utf8')
    await fixture.journal.admit(fixture.watch)
    await fixture.journal.establish(fixture.watch, FiniteBridge.manifest(fixture.watch))
    const announcement = FiniteBridge.announcement(fixture)
    const initialNext = [
      join(FiniteBridge.pluginRoot, 'scripts', 'ct-step.mjs'),
      'next', '--plan', FiniteBridge.PLAN, '--issue', '332',
      '--output-format', 'json',
    ]
    const dispatchTicket = await fixture.journal.begin(
      fixture.watch,
      FiniteBridge.request(fixture.worktree, null, initialNext),
    )
    expect(dispatchTicket).toBe(FiniteBridge.DISPATCH)
    await fixture.journal.finish(
      fixture.watch,
      dispatchTicket,
      FiniteBridge.receipt(new ProcessOutput({ code: 0, stdout: announcement, stderr: '' }), null, fixture.run.bytes),
    )
    const dispatch = await fixture.machine.dispatch(fixture.watch, dispatchTicket)
    expect(dispatch.argv).toEqual([
      '--tools', IMPLEMENTER_TOOLS,
      '--allowedTools', IMPLEMENTER_TOOLS,
      '--model', IMPLEMENTER_MODEL,
      '--json-schema', JSON.stringify(REPORT_SCHEMA),
    ])
    const planner = new StartedPlanCall({ conversation: fixture.watch.agent, id: FiniteBridge.PLANNER })
    const plannerDescriptor = new CallDescriptor({
      conversation: fixture.watch.agent,
      purpose: 'plan',
      requestId: null,
      cwd: fixture.worktree,
      binary: '/usr/local/bin/claude',
      argv: ['--session-id', fixture.watch.agent],
      startedAt: FiniteBridge.STARTED,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    })
    await FiniteBridge.saveCall({
      fixture,
      call: planner,
      descriptor: plannerDescriptor,
      prompt: 'Recorded planner prompt.',
      stream: `${JSON.stringify({ type: 'result', subtype: 'success', session_id: fixture.watch.agent, is_error: false })}\n`,
      completion: FiniteBridge.completion(planner, 'initial-invocation'),
    })
    const implementation = new StartedPlanCall({ conversation: fixture.watch.agent, id: FiniteBridge.IMPLEMENTATION })
    const invocation = new CallInvocation({
      conversation: fixture.watch.agent,
      purpose: 'implementation',
      cwd: fixture.worktree,
      argv: [
        '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
        '--plugin-dir', FiniteBridge.pluginRoot, '--resume', fixture.watch.agent,
        ...dispatch.argv,
        CallDescriptor.opening(join(fixture.files.callDirectory(implementation), CallDescriptor.PROMPT)),
      ],
      prompt: `Read the listed files.\n${dispatch.paths.join('\n')}\n${ClaudeRunCalls.ERRAND_END}`,
      requestId: `run:${dispatchTicket}`,
    })
    const descriptor = new CallDescriptor({
      conversation: invocation.conversation,
      purpose: invocation.purpose,
      requestId: invocation.requestId,
      cwd: invocation.cwd,
      binary: '/usr/local/bin/claude',
      argv: invocation.argv,
      startedAt: FiniteBridge.STARTED,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    })
    const stream = `${JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: fixture.watch.agent,
      is_error: false,
      total_cost_usd: 0.25,
      num_turns: 1,
      duration_ms: 55_000,
      structured_output: FiniteBridge.RESPONSE,
    })}\n`
    await FiniteBridge.saveCall({
      fixture,
      call: implementation,
      descriptor,
      prompt: invocation.prompt,
      stream,
      completion: FiniteBridge.completion(implementation, 'unverified-resume'),
    })
    const restarted = await FiniteBridge.build(root, {
      ids: [FiniteBridge.CONSUMING, FiniteBridge.BOUNDARY],
      calls: fixture.calls,
      run: fixture.run,
      warnings: fixture.warnings,
      prepare: false,
    })
    const originalDescriptor = await readFile(join(fixture.files.callDirectory(implementation), CallDescriptor.FILE), 'utf8')
    const originalCompletion = await readFile(join(fixture.files.callDirectory(implementation), CallDescriptor.COMPLETION), 'utf8')
    const checkouts = new RecoveryCheckouts()
    const activePlans = new ActivePlans({ sessions: new PlanSessions() })
    const reviews = new RecoveryReviews()
    const recovery = new RunPlanRecovery({
      legacy: new RecoveryLegacy(),
      records: restarted.records,
      calls: restarted.planCalls,
      transport: restarted.transport,
      machine: restarted.machine,
      journal: restarted.journal,
      agents: restarted.agents,
      delivery: new CompletedRunDelivery(),
      checkouts,
      activePlans,
      reviews,
      nowMs: () => Date.parse(FiniteBridge.STARTED),
    })
    const beforeGet = await restarted.journal.entries(restarted.watch)

    expect(await recovery.recover()).toBeNull()
    expect(activePlans.known()[0]).toMatchObject({ phase: 'uncertain', recovery: { action: 'continue' } })
    expect(fixture.calls.count).toBe(0)
    expect(restarted.spawns()).toBe(0)
    expect(await restarted.journal.entries(restarted.watch)).toEqual(beforeGet)
    const metricPath = join(fixture.files.callDirectory(implementation), 'agent-measurements-v1.json')
    await expect(readFile(metricPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await restarted.agents.recover({
      agent: restarted.watch.agent,
      issue: restarted.watch.issue.number,
      repository: restarted.watch.repository,
    })
    await FiniteBridge.bounded(() => fixture.warnings.length > 0)
    expect(fixture.warnings.join('')).toContain('finite recovery boundary')
    expect(JSON.parse(await readFile(metricPath, 'utf8'))).toMatchObject({
      callId: implementation.id, conversation: implementation.conversation,
      cost: { kind: 'reported', attribution: 'unverified-resume' },
    })

    expect(fixture.calls.asked).toEqual([
      { argv: fixture.reportArgv, cwd: fixture.worktree },
      { argv: fixture.nextArgv, cwd: fixture.worktree },
    ])
    expect(restarted.spawns()).toBe(0)
    expect(await readFile(fixture.response, 'utf8')).toBe(`${JSON.stringify(FiniteBridge.RESPONSE)}\n`)
    expect(await readFile(join(fixture.files.callDirectory(implementation), ClaudeRunCalls.RESPONSE), 'utf8'))
      .toBe(`${JSON.stringify(FiniteBridge.RESPONSE)}\n`)
    expect(await readFile(join(fixture.files.callDirectory(implementation), CallDescriptor.FILE), 'utf8'))
      .toBe(originalDescriptor)
    expect(await readFile(join(fixture.files.callDirectory(implementation), CallDescriptor.COMPLETION), 'utf8'))
      .toBe(originalCompletion)
    const entries = await restarted.journal.entries(restarted.watch)
    expect(entries).toHaveLength(3)
    expect(JSON.parse(entries[1].request)).toMatchObject({ previous: dispatchTicket, argv: fixture.reportArgv })
    expect(JSON.parse(entries[1].receipt.kind === 'present' ? entries[1].receipt.text : '{}')).toMatchObject({
      code: 0,
      beforeRun: '{"task":1,"step":"implement"}\n',
      afterRun: '{"task":1,"step":"judge"}\n',
    })
    expect(JSON.parse(entries[2].request)).toMatchObject({ previous: entries[1].ticket, argv: fixture.nextArgv })
    expect(JSON.parse(entries[2].receipt.kind === 'present' ? entries[2].receipt.text : '{}')).toEqual({
      version: 1,
      code: 17,
      stdout: '',
      stderr: 'finite recovery boundary\n',
      beforeRun: '{"task":1,"step":"judge"}\n',
      afterRun: '{"task":1,"step":"judge"}\n',
    })

    const rebuilt = await FiniteBridge.build(root, {
      ids: [],
      calls: fixture.calls,
      run: fixture.run,
      warnings: fixture.warnings,
      prepare: false,
    })
    const rebuiltActive = new ActivePlans({ sessions: new PlanSessions() })
    const rebuiltRecovery = new RunPlanRecovery({
      legacy: new RecoveryLegacy(),
      records: rebuilt.records,
      calls: rebuilt.planCalls,
      transport: rebuilt.transport,
      machine: rebuilt.machine,
      journal: rebuilt.journal,
      agents: rebuilt.agents,
      delivery: new CompletedRunDelivery(),
      checkouts: new RecoveryCheckouts(),
      activePlans: rebuiltActive,
      reviews: new RecoveryReviews(),
      nowMs: () => Date.parse(FiniteBridge.STARTED),
    })
    const journalBytes = JSON.stringify(await rebuilt.journal.entries(rebuilt.watch))
    const responseBytes = await readFile(rebuilt.response, 'utf8')

    expect(await rebuiltRecovery.recover()).toBeNull()
    expect(rebuiltActive.known()[0]).toMatchObject({ phase: 'uncertain', recovery: { action: 'inspect' } })
    await expect(rebuilt.agents.recover({
      agent: rebuilt.watch.agent,
      issue: rebuilt.watch.issue.number,
      repository: rebuilt.watch.repository,
    })).rejects.toThrow('ct-step exited 17')
    expect(rebuilt.calls.count).toBe(2)
    expect(rebuilt.spawns()).toBe(0)
    expect(JSON.stringify(await rebuilt.journal.entries(rebuilt.watch))).toBe(journalBytes)
    expect(await readFile(rebuilt.response, 'utf8')).toBe(responseBytes)
  })
})
