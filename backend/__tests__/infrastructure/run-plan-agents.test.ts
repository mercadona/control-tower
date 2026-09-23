import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { STEPS } from '../../../plugin/scripts/run-machine.js'
import { StepAnnouncement } from '../../../plugin/scripts/step-announcement.js'
import { DriveRun } from '../../src/application/actions/drive-run.ts'
import {
  AnotherRoundNotGranted,
  PlanAgentNeverLaunched,
  PlanAgentNotLaunched,
  PlanAgentNotNamed,
  PlanAgentNotResumed,
  PlanRecoveryConflict,
  PlanRecoveryNotRead,
  PlanRecoveryNotUnderstood,
  RunFailure,
  RunNotAdvanced,
  RunNotUnderstood,
} from '../../src/domain/exceptions.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { PlanCalls } from '../../src/domain/ports/plan-calls.ts'
import { PlanPublication } from '../../src/domain/ports/plan-publication.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { RunCalls } from '../../src/domain/ports/run-calls.ts'
import { RunEstablishment, RunMachine, type RunEstablishmentValue } from '../../src/domain/ports/run-machine.ts'
import { PlanRecovery } from '../../src/domain/policies/plan-recovery.ts'
import { ExecuteRunInstruction } from '../../src/application/actions/execute-run-instruction.ts'
import { CompletedPlanCall, StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanNonLaunch } from '../../src/domain/value-objects/plan-non-launch.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { RunInstruction } from '../../src/domain/value-objects/run-instruction.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CallDescriptor, CallInvocation, ClaudeCalls } from '../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../src/infrastructure/claude-plan-calls.ts'
import { CtRunMachine, RunInspection } from '../../src/infrastructure/ct-run-machine.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'
import { RecordedCall } from '../../src/domain/value-objects/recorded-call.ts'
import { ChangeAnnouncements } from '../../src/domain/ports/change-announcements.ts'
import { RunJournal } from '../../src/infrastructure/run-journal.ts'
import { RunPlanAgents } from '../../src/infrastructure/run-plan-agents.ts'
import { PlanCollapse } from '../../src/infrastructure/start-plan-route.ts'
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

class Deferred<T = void> {
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
}

class Bounded {
  static async wait<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('supervised work did not settle')), 1_000)
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }
}

class RecordsDouble extends PlanRecords {
  readonly watch: PlanWatch
  readonly events: string[]
  proof: PlanNonLaunch | null = null

  constructor(watch: PlanWatch, events: string[]) {
    super()
    this.watch = watch
    this.events = events
  }

  override async prepare(): Promise<PlanWatch> {
    this.events.push('record')
    return this.watch
  }

  override async find(): Promise<PlanWatch | null> {
    return this.watch
  }

  override async recordNonLaunch(_watch: PlanWatch, proof: PlanNonLaunch): Promise<void> {
    this.proof = proof
    this.events.push('proof')
  }
}

class CallsDouble extends PlanCalls {
  readonly events: string[]
  readonly planner: StartedPlanCall
  readonly fixCall: StartedPlanCall
  readonly plannerDone: Deferred<CompletedPlanCall>
  readonly fixDone: Deferred<CompletedPlanCall>
  readonly starts: ReadonlyArray<unknown>[] = []

  constructor(events: string[], plannerDone: Deferred<CompletedPlanCall>, fixDone: Deferred<CompletedPlanCall>) {
    super()
    this.events = events
    this.plannerDone = plannerDone
    this.fixDone = fixDone
    this.planner = AgentMother.call('22222222-2222-4222-8222-222222222222')
    this.fixCall = AgentMother.call('33333333-3333-4333-8333-333333333333')
  }

  override async start(
    _watch: PlanWatch,
    purpose: 'plan' | 'implementation' | 'fix',
    changes: string | null,
    requestId?: string,
  ): Promise<StartedPlanCall> {
    this.starts.push([purpose, changes, requestId])
    this.events.push(`start-${purpose}`)
    return purpose === 'fix' ? this.fixCall : this.planner
  }

  override async planningFor(): Promise<StartedPlanCall> {
    return this.planner
  }

  override async recoveryFor(): Promise<PlanRecovery> {
    return PlanRecovery.from({
      calls: [{
        call: this.planner,
        purpose: 'plan',
        startedAt: AgentMother.STARTED,
        deadlineMs: AgentMother.DEADLINE,
        completion: null,
      }],
      proof: null,
      cleanup: null,
      nowMs: Date.parse('2026-09-17T09:30:00.000Z'),
    })
  }

  override async wait(call: StartedPlanCall): Promise<CompletedPlanCall> {
    return call.id === this.fixCall.id ? this.fixDone.promise : this.plannerDone.promise
  }
}

class TransportDouble extends ClaudeCalls {
  historyValue: Awaited<ReturnType<ClaudeCalls['history']>> = []
  readonly owned = new Set<string>()
  readonly descriptors = new Map<string, CallDescriptor>()

  constructor() {
    super({
      files: new HeadlessFiles({ root: '/unused', fs, newId: () => 'unused' }),
      binary: 'unused', worker: 'unused', spawn: (() => { throw new Error('unused') }) as never,
      env: {}, newId: () => 'unused', now: () => AgentMother.STARTED,
      budgetMs: 1, killGraceMs: 1, acceptanceMs: 1, pollMs: 1, sleep: async () => {},
    })
  }

  override async history(): Promise<Awaited<ReturnType<ClaudeCalls['history']>>> {
    return this.historyValue
  }

  override owns(call: StartedPlanCall): boolean {
    return this.owned.has(call.id)
  }

  override async descriptorOf(call: StartedPlanCall): Promise<CallDescriptor> {
    const descriptor = this.descriptors.get(call.id)
    if (descriptor === undefined) throw new Error(`no descriptor arranged for ${call.id}`)
    return descriptor
  }

  override async deadlineOf(): Promise<number> {
    return AgentMother.DEADLINE
  }
}

class ProducerTransport extends ClaudeCalls {
  readonly invocations: CallInvocation[] = []

  constructor() {
    super({
      files: new HeadlessFiles({ root: '/unused', fs, newId: () => 'unused' }),
      binary: 'unused', worker: 'unused', spawn: (() => { throw new Error('unused') }) as never,
      env: {}, newId: () => 'unused', now: () => AgentMother.STARTED,
      budgetMs: 1, killGraceMs: 1, acceptanceMs: 1, pollMs: 1, sleep: async () => {},
    })
  }

  override async startedFor(): Promise<StartedPlanCall | null> {
    return null
  }

  override async start(invocation: CallInvocation): Promise<StartedPlanCall> {
    this.invocations.push(invocation)
    return AgentMother.call(invocation.purpose === 'implementation'
      ? AgentMother.callIdFor('implementation')
      : AgentMother.callIdFor('fix'))
  }
}

class RefusingWriteFiles extends HeadlessFiles {
  readonly cause: unknown

  constructor(root: string, cause: unknown) {
    super({ root, fs, newId: () => 'temporary-record' })
    this.cause = cause
  }

  override async writeOnce(): Promise<void> {
    throw this.cause
  }
}

class MachineDouble extends CtRunMachine {
  inspection = new RunInspection({ kind: 'absent' })
  establishmentValue: RunEstablishmentValue = RunEstablishment.ABSENT
  anotherRoundAnswer: RunInstruction = new RunInstruction({
    kind: 'command', ticket: '44444444-4444-4444-8444-444444444444',
  })

  readonly anotherRoundAsked: Array<{ watch: PlanWatch, instruction: string }> = []

  constructor(journal: RunJournal) {
    super({
      journal,
      node: async () => { throw new Error('oracle must not run in this double') },
      git: async () => { throw new Error('git must not run in this double') },
      read: async () => null,
      ctStep: '/plugin/ct-step.mjs',
      dispatchCheck: '/plugin/dispatch-check.mjs',
      pluginRoot: '/plugin',
    })
  }

  override async inspect(): Promise<RunInspection> {
    return this.inspection
  }

  override async establishment(): Promise<RunEstablishmentValue> {
    return this.establishmentValue
  }

  override async anotherRound(watch: PlanWatch, instruction: string): Promise<RunInstruction> {
    this.anotherRoundAsked.push({ watch, instruction })
    return this.anotherRoundAnswer
  }
}

class ControlledPublication extends PlanPublication {
  readonly events: string[]
  readonly entered: Deferred
  readonly release: Deferred

  constructor(events: string[], entered: Deferred, release: Deferred) {
    super()
    this.events = events
    this.entered = entered
    this.release = release
  }

  override async publish(): Promise<void> {
    this.events.push('publish-start')
    this.entered.resolve()
    await this.release.promise
    this.events.push('publish-complete')
  }
}

class ControlledRunMachine extends RunMachine {
  readonly events: string[]
  readonly oracle: Deferred
  readonly release: Deferred<RunInstruction>
  readonly opened: PlanWatch[] = []
  establishmentValue: RunEstablishmentValue = RunEstablishment.ABSENT

  constructor(events: string[], oracle: Deferred, release: Deferred<RunInstruction>) {
    super()
    this.events = events
    this.oracle = oracle
    this.release = release
  }

  async establishment(): Promise<RunEstablishmentValue> {
    return this.establishmentValue
  }

  async open(watch: PlanWatch): Promise<RunInstruction> {
    this.opened.push(watch)
    this.events.push('oracle')
    this.oracle.resolve()
    return this.release.promise
  }

  async advance(_watch: PlanWatch, instruction: RunInstruction): Promise<RunInstruction> {
    return instruction
  }
}

class RefusingRunCalls extends RunCalls {
  async perform(): Promise<never> {
    throw new Error('a delivered test instruction performs no model call')
  }
}

class LegacyDouble extends PlanAgents {
  readonly calls: unknown[][] = []

  override async recover(asked: unknown): Promise<void> {
    this.calls.push(['recover', asked])
  }

  override async fix(asked: unknown): Promise<void> {
    this.calls.push(['fix', asked])
  }
}

class AgentMother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly STARTED = '2026-09-17T09:00:00.000Z'
  static readonly DEADLINE = Date.parse('2026-09-17T11:00:05.000Z')
  static readonly PLAN = 'docs/superpowers/plans/2026-09-17-issue-332-machine.md'
  static readonly PLAN_TEXT = '# Issue 332 machine plan\n'
  static readonly RUN_BYTES = '{"step":"controls","task":1}\n'
  static readonly REPOSITORY = new RepositoryName('mercadona/control-tower-plugin')
  static readonly ISSUE = new PlanIssue({
    number: 332,
    url: 'https://github.com/mercadona/control-tower-plugin/issues/332',
  })
  static readonly LOCATION = new WorkspaceLocation({
    root: '/repo', path: '/repo/.worktrees/332', branch: 'feat/332',
  })
  static readonly WATCH = new PlanWatch({
    story: null,
    issue: AgentMother.ISSUE,
    located: AgentMother.LOCATION,
    repository: AgentMother.REPOSITORY,
    agent: AgentMother.CONVERSATION,
  })
  static readonly BRIEFING = new PlanBriefing({
    story: null,
    issue: AgentMother.ISSUE,
    located: AgentMother.LOCATION,
    repository: AgentMother.REPOSITORY,
  })

  static call(id: string): StartedPlanCall {
    return new StartedPlanCall({ conversation: AgentMother.CONVERSATION, id })
  }

  static completed(call: StartedPlanCall, succeeded = true): CompletedPlanCall {
    return new CompletedPlanCall({
      call,
      code: succeeded ? 0 : 1,
      signal: null,
      finishedAt: '2026-09-17T09:01:00.000Z',
      wallDurationMs: 60_000,
      execution: succeeded ? { kind: 'success' } : { kind: 'error', diagnostic: 'recorded failure' },
      measurement: {
        cost: { kind: 'reported', totalUsd: 1.25, attribution: call.id.startsWith('2') ? 'initial-invocation' : 'unverified-resume' },
        turns: 2,
        durationMs: 50_000,
        unavailable: [],
      },
    })
  }

  static descriptor(call: StartedPlanCall, purpose: 'plan' | 'implementation' | 'fix', requestId: string | null): CallDescriptor {
    return new CallDescriptor({
      conversation: call.conversation,
      purpose,
      requestId,
      cwd: AgentMother.LOCATION.path,
      binary: '/usr/local/bin/claude',
      argv: purpose === 'plan'
        ? ['--session-id', call.conversation]
        : ['--resume', call.conversation],
      startedAt: AgentMother.STARTED,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    })
  }

  static async saveDescriptor(root: string, descriptor: CallDescriptor): Promise<void> {
    const directory = join(root, 'harness', descriptor.conversation, 'calls', descriptor.requestId === null
      ? AgentMother.callIdFor(descriptor.purpose)
      : AgentMother.callIdForRequest(descriptor.requestId))
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(join(directory, CallDescriptor.FILE), descriptor.text(), 'utf8')
    await fs.writeFile(join(directory, CallDescriptor.PROMPT), `Recorded ${descriptor.purpose} errand.`, 'utf8')
  }

  static callIdFor(purpose: 'plan' | 'implementation' | 'fix'): string {
    if (purpose === 'plan') return '22222222-2222-4222-8222-222222222222'
    if (purpose === 'implementation') return '77777777-7777-4777-8777-777777777777'
    return '33333333-3333-4333-8333-333333333333'
  }

  static callIdForRequest(requestId: string): string {
    if (requestId.startsWith('implementation:') || requestId.startsWith('run:')) {
      return requestId.startsWith('run:')
        ? '66666666-6666-4666-8666-666666666666'
        : '77777777-7777-4777-8777-777777777777'
    }
    return '33333333-3333-4333-8333-333333333333'
  }

  static manifest(): string {
    return `${JSON.stringify({
      version: 1,
      conversation: AgentMother.CONVERSATION,
      repository: AgentMother.REPOSITORY.text,
      issue: AgentMother.ISSUE.number,
      plan: AgentMother.PLAN,
      initialPlanSha256: createHash('sha256').update(AgentMother.PLAN_TEXT).digest('hex'),
    })}\n`
  }

  static nextArgv(): readonly string[] {
    return [
      '/plugin/ct-step.mjs', 'next', '--plan', AgentMother.PLAN, '--issue', '332',
      '--output-format', 'json',
    ]
  }

  static controlsArgv(): readonly string[] {
    return [
      '/plugin/ct-step.mjs', 'controls', '--plan', AgentMother.PLAN, '--issue', '332',
      '--output-format', 'json',
    ]
  }

  static request(previous: string | null, argv: readonly string[]): string {
    return `${JSON.stringify({
      version: 1,
      previous,
      argv,
      cwd: AgentMother.LOCATION.path,
      planSha256: createHash('sha256').update(AgentMother.PLAN_TEXT).digest('hex'),
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

  static controlsAnnouncement(): string {
    return StepAnnouncement.program({
      issue: 332,
      task: 1,
      tasksTotal: 3,
      step: STEPS.CONTROLS,
      attempt: 1,
      commands: ['npm run lint', 'npm test'],
      consuming: { argv: ['controls', '--plan', AgentMother.PLAN, '--issue', '332'] },
    }).text()
  }

  static deliveredTransition(): string {
    return '{"version":1,"kind":"transition","state":"delivered","outcome":"done","exit":0,'
      + '"run":{"issue":332,"task":3,"tasksTotal":3,"step":"slice-judge","discards":0}}\n'
  }

  static readFailureFiles(root: string, cause: unknown): HeadlessFiles {
    const refused = new Proxy(fs, {
      get(target, property, receiver) {
        if (property === 'lstat') return async () => { throw cause }
        return Reflect.get(target, property, receiver)
      },
    })
    return new HeadlessFiles({ root, fs: refused, newId: () => 'temporary-record' })
  }

  static admissionPath(root: string): string {
    return join(root, 'harness', AgentMother.CONVERSATION, 'run', 'admission.json')
  }
}


class AnnouncementsDouble extends ChangeAnnouncements {
  readonly announced: Array<{ repository: string, issue: number, ticket: string }> = []

  override async announce({ repository, issue, ticket }: {
    repository: RepositoryName, issue: number, ticket: string,
  }): Promise<void> {
    this.announced.push({ repository: repository.text, issue, ticket })
  }
}

class Settled {
  static async waitFor(check: () => boolean, what: string): Promise<void> {
    await Settled.until(async () => check(), what)
  }

  static async until(check: () => Promise<boolean>, what: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`${what} never happened`)
  }
}

describe('RunPlanAgents', () => {
  const roots: string[] = []
  const finalizers: Array<() => void> = []
  const releases: Array<Deferred<RunInstruction>> = []
  const supervisors: Deferred[] = []

  afterEach(async () => {
    for (const finalize of finalizers.splice(0)) finalize()
    for (const release of releases.splice(0)) if (!release.settled) release.reject(new Error('test cleanup'))
    await Promise.all(supervisors.splice(0).map((supervisor) => Bounded.wait(supervisor.promise)))
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function scenario(admit = false, now: () => string = () => {
    throw new Error('the journal clock is not asked')
  }, tickets: readonly string[] = []) {
    const remaining = [...tickets]
    const root = await mkdtemp(join(tmpdir(), 'ct-run-plan-agents-'))
    roots.push(root)
    const events: string[] = []
    const plannerDone = new Deferred<CompletedPlanCall>()
    const fixDone = new Deferred<CompletedPlanCall>()
    const publicationEntered = new Deferred()
    const publicationRelease = new Deferred()
    const oracle = new Deferred()
    const release = new Deferred<RunInstruction>()
    const supervisor = new Deferred()
    const journal = new RunJournal({
      files: new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }),
      newId: () => remaining.shift() ?? '44444444-4444-4444-8444-444444444444',
      now,
    })
    if (admit) await journal.admit(AgentMother.WATCH)
    const calls = new CallsDouble(events, plannerDone, fixDone)
    finalizers.push(() => {
      if (!plannerDone.settled) plannerDone.resolve(AgentMother.completed(calls.planner))
      if (!fixDone.settled) fixDone.resolve(AgentMother.completed(calls.fixCall))
      if (!publicationRelease.settled) publicationRelease.resolve()
    })
    const transport = new TransportDouble()
    const machine = new MachineDouble(journal)
    const driverMachine = new ControlledRunMachine(events, oracle, release)
    const driver = new DriveRun({
      calls,
      publication: new ControlledPublication(events, publicationEntered, publicationRelease),
      machine: driverMachine,
      delivery: new CompletedRunDelivery(),
      step: new ExecuteRunInstruction({ machine: driverMachine, calls: new RefusingRunCalls() }),
      messages: new DeliverHeldMessages({
        messages: journal,
        calls: calls,
        escalations: new QuietEscalations(),
      }),
      escalations: QuietEscalations.reader(),
    })
    const legacy = new LegacyDouble()
    const warnings: string[] = []
    const announcements = new AnnouncementsDouble()
    const agents = new RunPlanAgents({
      legacy,
      records: new RecordsDouble(AgentMother.WATCH, events),
      calls,
      transport,
      driver,
      machine,
      journal,
      delivery: new CompletedRunDelivery(),
      announcements,
      newId: () => '55555555-5555-4555-8555-555555555555',
      nowMs: () => Date.parse('2026-09-17T09:30:00.000Z'),
      stderr: (line) => { warnings.push(line); supervisor.resolve() },
    })
    return {
      root, events, plannerDone, fixDone, publicationEntered, publicationRelease, oracle,
      release, supervisor, journal, calls, transport, machine,
      driverMachine, legacy, warnings, announcements, agents,
      registerDriverSupervisor: () => {
        releases.push(release)
        supervisors.push(supervisor)
      },
      registerSupervisor: () => supervisors.push(supervisor),
    }
  }

  async function sourceScenario(admit = false, filesFor?: (root: string) => HeadlessFiles) {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-plan-provenance-'))
    roots.push(root)
    const events: string[] = []
    const plannerDone = new Deferred<CompletedPlanCall>()
    const fixDone = new Deferred<CompletedPlanCall>()
    const publicationEntered = new Deferred()
    const publicationRelease = new Deferred()
    const oracle = new Deferred()
    const evidence = {
      run: null as string | null,
      calls: 0,
      asked: [] as (readonly string[])[],
      answers: new Map<string, () => ProcessOutput>(),
    }
    const files = filesFor === undefined
      ? new HeadlessFiles({ root, fs, newId: () => 'temporary-record' })
      : filesFor(root)
    const journalIds = [
      '44444444-4444-4444-8444-444444444444',
      '88888888-8888-4888-8888-888888888888',
      '99999999-9999-4999-8999-999999999999',
    ]
    const journal = new RunJournal({
      files,
      newId: () => {
        const id = journalIds.shift()
        if (id === undefined) throw new Error('no journal identity was arranged')
        return id
      },
      now: () => { throw new Error('the journal clock is not asked') },
    })
    if (admit) await journal.admit(AgentMother.WATCH)
    const calls = new CallsDouble(events, plannerDone, fixDone)
    finalizers.push(() => {
      if (!plannerDone.settled) plannerDone.resolve(AgentMother.completed(calls.planner))
      if (!fixDone.settled) fixDone.resolve(AgentMother.completed(calls.fixCall))
      if (!publicationRelease.settled) publicationRelease.resolve()
    })
    let spawns = 0
    const transport = new ClaudeCalls({
      files,
      binary: '/usr/local/bin/claude',
      worker: '/backend/headless-call-worker.ts',
      spawn: (() => { spawns += 1; throw new Error('provenance must not spawn') }) as typeof import('node:child_process').spawn,
      env: {},
      newId: () => { throw new Error('provenance must not allocate call identity') },
      now: () => AgentMother.STARTED,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
      acceptanceMs: 10_000,
      pollMs: 250,
      sleep: async () => { throw new Error('provenance must not wait') },
    })
    const machine = new CtRunMachine({
      journal,
      node: async (argv) => {
        evidence.calls += 1
        evidence.asked.push([...argv])
        oracle.resolve()
        const answer = evidence.answers.get(JSON.stringify(argv))
        if (answer !== undefined) return answer()
        return new ProcessOutput({
          code: 0,
          stdout: AgentMother.deliveredTransition(),
          stderr: '',
        })
      },
      git: async () => { throw new Error('established recovery must not inspect git') },
      read: async (path) => {
        if (path === join(AgentMother.LOCATION.path, '.agent', `run-${AgentMother.ISSUE.number}.json`)) return evidence.run
        if (path === join(AgentMother.LOCATION.path, AgentMother.PLAN)) return AgentMother.PLAN_TEXT
        throw new Error(`unlisted evidence read: ${path}`)
      },
      ctStep: '/plugin/ct-step.mjs',
      dispatchCheck: '/plugin/dispatch-check.mjs',
      pluginRoot: '/plugin',
    })
    const driver = new DriveRun({
      calls,
      publication: new ControlledPublication(events, publicationEntered, publicationRelease),
      machine,
      delivery: new CompletedRunDelivery(),
      step: new ExecuteRunInstruction({ machine, calls: new RefusingRunCalls() }),
      messages: new DeliverHeldMessages({
        messages: journal,
        calls: calls,
        escalations: new QuietEscalations(),
      }),
      escalations: QuietEscalations.reader(),
    })
    const legacy = new LegacyDouble()
    const agents = new RunPlanAgents({
      legacy,
      records: new RecordsDouble(AgentMother.WATCH, events),
      calls,
      transport,
      driver,
      machine,
      journal,
      delivery: new CompletedRunDelivery(),
      announcements: new AnnouncementsDouble(),
      newId: () => '55555555-5555-4555-8555-555555555555',
      nowMs: () => Date.parse('2026-09-17T09:30:00.000Z'),
      stderr: () => {},
    })
    return {
      root, events, plannerDone, publicationEntered, publicationRelease, oracle,
      evidence, journal, calls, transport, legacy, agents, driver, machine,
      spawns: () => spawns,
    }
  }

  it('a machine admission publishes before the first oracle call', async () => {
    const tested = await scenario()
    tested.registerDriverSupervisor()

    const conversation = await tested.agents.launch(AgentMother.BRIEFING)
    expect(conversation).toBe(AgentMother.CONVERSATION)
    expect(tested.events).toEqual(['record', 'start-plan'])
    expect(await tested.journal.admitted(AgentMother.WATCH)).toBe(true)
    expect(JSON.parse(await readFile(join(
      tested.root, 'harness', AgentMother.CONVERSATION, 'run', 'admission.json',
    ), 'utf8'))).toEqual({ version: 1, conversation: AgentMother.CONVERSATION })

    tested.plannerDone.resolve(AgentMother.completed(tested.calls.planner))
    await Bounded.wait(tested.publicationEntered.promise)
    expect(tested.events).toEqual(['record', 'start-plan', 'publish-start'])
    expect(tested.oracle.settled).toBe(false)

    tested.publicationRelease.resolve()
    await Bounded.wait(tested.oracle.promise)
    expect(tested.driverMachine.opened[0].agent).toBe(AgentMother.CONVERSATION)
    expect(tested.events).toEqual(['record', 'start-plan', 'publish-start', 'publish-complete', 'oracle'])
    tested.release.reject(new Error('driver stopped'))
    await Bounded.wait(tested.supervisor.promise)
    expect(tested.warnings.join('')).toContain('mercadona/control-tower-plugin#332')
    expect(tested.warnings.join('')).toContain(tested.calls.planner.id)
  })

  it('legacy record recovery and fixes retain exact calls without new admission evidence', async () => {
    const tested = await sourceScenario()
    const planner = AgentMother.call(AgentMother.callIdFor('plan'))
    const implementation = AgentMother.call(AgentMother.callIdFor('implementation'))
    const producerTransport = new ProducerTransport()
    const brief = new PlanAgentBrief({
      dispatchCheck: '/plugin/dispatch-check.mjs',
      conventions: '/plugin/conventions',
      ctStep: '/plugin/ct-step.mjs',
    })
    const producer = new ClaudePlanCalls({
      calls: producerTransport,
      brief,
      pluginRoot: '/plugin',
      resumable: async () => true,
      records: new RecordsDouble(AgentMother.WATCH, []),
      nowMs: () => Date.parse(AgentMother.STARTED),
    })
    const producedImplementation = await producer.start(
      AgentMother.WATCH, 'implementation', null, `implementation:${planner.id}`,
    )
    const implementationInvocation = producerTransport.invocations[0]
    await AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(planner, 'plan', null))
    await AgentMother.saveDescriptor(
      tested.root,
      new CallDescriptor({
        conversation: implementationInvocation.conversation,
        purpose: implementationInvocation.purpose,
        requestId: implementationInvocation.requestId,
        cwd: implementationInvocation.cwd,
        binary: '/usr/local/bin/claude',
        argv: implementationInvocation.argv,
        startedAt: AgentMother.STARTED,
        budgetMs: 7_200_000,
        killGraceMs: 5_000,
      }),
    )
    tested.evidence.run = '{"step":"review"}\n'
    const recovery = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
    }
    const fix = { ...recovery, changes: 'Keep the original errand.', requestId: 'review-9' }

    await tested.agents.recover(recovery)
    await tested.agents.fix(fix)
    const producedFix = await producer.start(AgentMother.WATCH, 'fix', fix.changes, fix.requestId)

    expect(tested.legacy.calls).toEqual([['recover', recovery], ['fix', fix]])
    expect(producedImplementation).toEqual(implementation)
    expect(producedFix.conversation).toBe(AgentMother.CONVERSATION)
    expect(producerTransport.invocations[1].argv).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,Skill,Agent',
      '--model', 'opus',
      '--plugin-dir', '/plugin',
      '--resume', AgentMother.CONVERSATION,
    ])
    expect(producerTransport.invocations[1].prompt).toBe(
      'A person reviewed the pull request for issue #332 and requested these changes: '
      + '«Keep the original errand.». Apply them on the existing branch and worktree without rewriting the plan, '
      + 'do not create new worktrees, and without opening another pull request: the existing one remains open and receives what you push. '
      + 'Once it is green, release again with `node /plugin/dispatch-check.mjs 332 --repo mercadona/control-tower-plugin --release --no-watch-merge`, '
      + 'which returns the issue to review. Then STOP: do not merge it.',
    )
    expect(producerTransport.invocations[1].requestId).toBe('review-9')
    expect(await tested.journal.admitted(AgentMother.WATCH)).toBe(false)
    expect(tested.calls.starts).toEqual([])
    expect((await tested.transport.descriptorOf(implementation)).argv).toEqual(implementationInvocation.argv)
    expect((await tested.transport.descriptorOf(implementation)).requestId).toBe(`implementation:${planner.id}`)
    expect(tested.spawns()).toBe(0)
  })

  it('restart preserves recorded ownership without migrating a conversation', async () => {
    const tested = await scenario(true)
    const machineCall = AgentMother.call('66666666-6666-4666-8666-666666666666')
    tested.machine.inspection = new RunInspection({
      kind: 'active',
      instruction: new RunInstruction({
        kind: 'call', ticket: '44444444-4444-4444-8444-444444444444',
      }),
    })
    tested.transport.historyValue = [new RecordedCall({
      call: machineCall,
      purpose: 'implementation',
      startedAt: AgentMother.STARTED,
      completion: null,
    })]
    tested.transport.descriptors.set(
      machineCall.id,
      AgentMother.descriptor(machineCall, 'implementation', 'run:44444444-4444-4444-8444-444444444444'),
    )
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
    }

    await expect(tested.agents.recover(asked)).rejects.toThrow('not owned by this API process')
    expect(tested.legacy.calls).toEqual([])
    expect(tested.calls.starts).toEqual([])

    tested.transport.owned.add(machineCall.id)
    tested.driverMachine.establishmentValue = RunEstablishment.ESTABLISHED
    tested.registerDriverSupervisor()

    await tested.agents.recover(asked)

    await Bounded.wait(tested.oracle.promise)
    expect(tested.driverMachine.opened).toEqual([AgentMother.WATCH])
    expect(tested.publicationEntered.settled).toBe(false)
    expect(tested.plannerDone.settled).toBe(false)
    expect(tested.legacy.calls).toEqual([])
    expect(tested.calls.starts).toEqual([])
    tested.release.reject(new Error('restart stopped'))
    await Bounded.wait(tested.supervisor.promise)

    const planner = await scenario(true)
    planner.transport.historyValue = [new RecordedCall({
      call: planner.calls.planner,
      purpose: 'plan',
      startedAt: AgentMother.STARTED,
      completion: null,
    })]
    planner.transport.descriptors.set(
      planner.calls.planner.id,
      AgentMother.descriptor(planner.calls.planner, 'plan', null),
    )
    planner.transport.owned.add(planner.calls.planner.id)
    planner.registerDriverSupervisor()

    await planner.agents.recover(asked)
    expect(planner.publicationEntered.settled).toBe(false)

    planner.plannerDone.resolve(AgentMother.completed(planner.calls.planner, false))
    await Bounded.wait(planner.supervisor.promise)
    expect(planner.publicationEntered.settled).toBe(false)

    const successful = await scenario(true)
    successful.transport.historyValue = [new RecordedCall({
      call: successful.calls.planner,
      purpose: 'plan',
      startedAt: AgentMother.STARTED,
      completion: null,
    })]
    successful.transport.descriptors.set(
      successful.calls.planner.id,
      AgentMother.descriptor(successful.calls.planner, 'plan', null),
    )
    successful.transport.owned.add(successful.calls.planner.id)
    successful.registerDriverSupervisor()

    await successful.agents.recover(asked)
    successful.plannerDone.resolve(AgentMother.completed(successful.calls.planner))
    await Bounded.wait(successful.publicationEntered.promise)
    successful.publicationRelease.resolve()
    await Bounded.wait(successful.oracle.promise)
    successful.release.reject(new Error('successful restart stopped'))
    await Bounded.wait(successful.supervisor.promise)
  })

  it('missing admission never downgrades driver call provenance', async () => {
    const cases: Array<{
      readonly name: string,
      readonly arrange: (tested: Awaited<ReturnType<typeof sourceScenario>>) => Promise<void>,
    }> = [
      { name: 'failed admission with no calls', arrange: async () => {} },
      {
        name: 'planner only',
        arrange: async (tested) => AgentMother.saveDescriptor(
          tested.root,
          AgentMother.descriptor(AgentMother.call(AgentMother.callIdFor('plan')), 'plan', null),
        ),
      },
      {
        name: 'driver request without journal',
        arrange: async (tested) => AgentMother.saveDescriptor(
          tested.root,
          AgentMother.descriptor(
            AgentMother.call(AgentMother.callIdForRequest('run:44444444-4444-4444-8444-444444444444')),
            'implementation',
            'run:44444444-4444-4444-8444-444444444444',
          ),
        ),
      },
      {
        name: 'mixed owners',
        arrange: async (tested) => {
          const planner = AgentMother.call(AgentMother.callIdFor('plan'))
          await AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(planner, 'plan', null))
          await AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(
            AgentMother.call(AgentMother.callIdFor('implementation')),
            'implementation',
            `implementation:${planner.id}`,
          ))
          await AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(
            AgentMother.call(AgentMother.callIdForRequest('run:44444444-4444-4444-8444-444444444444')),
            'implementation',
            'run:44444444-4444-4444-8444-444444444444',
          ))
        },
      },
      {
        name: 'wrong working directory',
        arrange: async (tested) => {
          const planner = AgentMother.call(AgentMother.callIdFor('plan'))
          await AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(planner, 'plan', null))
          const descriptor = AgentMother.descriptor(
            AgentMother.call(AgentMother.callIdFor('implementation')),
            'implementation',
            `implementation:${planner.id}`,
          )
          await AgentMother.saveDescriptor(tested.root, new CallDescriptor({
            conversation: descriptor.conversation,
            purpose: descriptor.purpose,
            requestId: descriptor.requestId,
            cwd: '/another/worktree',
            binary: descriptor.binary,
            argv: descriptor.argv,
            startedAt: descriptor.startedAt,
            budgetMs: descriptor.budgetMs,
            killGraceMs: descriptor.killGraceMs,
          }))
        },
      },
      {
        name: 'mismatched planner link',
        arrange: async (tested) => {
          const planner = AgentMother.call(AgentMother.callIdFor('plan'))
          await AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(planner, 'plan', null))
          await AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(
            AgentMother.call(AgentMother.callIdFor('implementation')),
            'implementation',
            'implementation:99999999-9999-4999-8999-999999999999',
          ))
        },
      },
      {
        name: 'unknown implementation request',
        arrange: async (tested) => AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(
          AgentMother.call(AgentMother.callIdFor('implementation')),
          'implementation',
          'manual-recovery',
        )),
      },
      {
        name: 'fix only',
        arrange: async (tested) => AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(
          AgentMother.call(AgentMother.callIdFor('fix')),
          'fix',
          'review-9',
        )),
      },
      {
        name: 'empty backend operations',
        arrange: async (tested) => {
          const planner = AgentMother.call(AgentMother.callIdFor('plan'))
          await AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(planner, 'plan', null))
          await AgentMother.saveDescriptor(tested.root, AgentMother.descriptor(
            AgentMother.call(AgentMother.callIdFor('implementation')),
            'implementation',
            `implementation:${planner.id}`,
          ))
          await fs.mkdir(join(
            tested.root, 'harness', AgentMother.CONVERSATION, 'run', 'operations',
          ), { recursive: true })
        },
      },
      {
        name: 'unrecorded plugin run',
        arrange: async (tested) => { tested.evidence.run = '{"step":"implement"}\n' },
      },
    ]

    for (const provenanceCase of cases) {
      const tested = await sourceScenario()
      await provenanceCase.arrange(tested)

      await expect(tested.agents.provenance(AgentMother.WATCH), provenanceCase.name)
        .rejects.toBeInstanceOf(PlanRecoveryConflict)
      expect(tested.legacy.calls, provenanceCase.name).toEqual([])
      expect(tested.calls.starts, provenanceCase.name).toEqual([])
      expect(tested.evidence.calls, provenanceCase.name).toBe(0)
      expect(tested.spawns(), provenanceCase.name).toBe(0)
    }

    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
    }
    const unreadable = await sourceScenario()
    const unreadableDirectory = join(
      unreadable.root, 'harness', AgentMother.CONVERSATION, 'calls', AgentMother.callIdFor('plan'),
    )
    await fs.mkdir(unreadableDirectory, { recursive: true })
    await fs.writeFile(join(unreadableDirectory, CallDescriptor.PROMPT), 'Planner errand.', 'utf8')
    await expect(unreadable.agents.recover(asked)).rejects.toBeInstanceOf(PlanRecoveryNotRead)
    await expect(unreadable.agents.fix({ ...asked, changes: 'Keep behavior.' }))
      .rejects.toBeInstanceOf(PlanAgentNotResumed)

    const malformed = await sourceScenario()
    const malformedDescriptor = new CallDescriptor({
      conversation: '99999999-9999-4999-8999-999999999999',
      purpose: 'plan',
      requestId: null,
      cwd: AgentMother.LOCATION.path,
      binary: '/usr/local/bin/claude',
      argv: ['--session-id', '99999999-9999-4999-8999-999999999999'],
      startedAt: AgentMother.STARTED,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    })
    const malformedDirectory = join(
      malformed.root, 'harness', AgentMother.CONVERSATION, 'calls', AgentMother.callIdFor('plan'),
    )
    await fs.mkdir(malformedDirectory, { recursive: true })
    await fs.writeFile(join(malformedDirectory, CallDescriptor.FILE), malformedDescriptor.text(), 'utf8')
    await fs.writeFile(join(malformedDirectory, CallDescriptor.PROMPT), 'Planner errand.', 'utf8')
    await expect(malformed.agents.recover(asked)).rejects.toBeInstanceOf(PlanRecoveryNotUnderstood)
    await expect(malformed.agents.fix({ ...asked, changes: 'Keep behavior.' }))
      .rejects.toBeInstanceOf(PlanAgentNotResumed)
    expect(unreadable.spawns()).toBe(0)
    expect(malformed.spawns()).toBe(0)
  })

  it('recovery of a refused run asks ct-step again instead of giving up on the journal (#504)', async () => {
    const tested = await sourceScenario(true)
    await tested.journal.establish(AgentMother.WATCH, AgentMother.manifest())
    const announced = await tested.journal.begin(
      AgentMother.WATCH, AgentMother.request(null, AgentMother.nextArgv()),
    )
    await tested.journal.finish(AgentMother.WATCH, announced, AgentMother.receipt(
      new ProcessOutput({ code: 0, stdout: AgentMother.controlsAnnouncement(), stderr: '' }), null, '{"step":"controls"}\n',
    ))
    const refused = await tested.journal.begin(
      AgentMother.WATCH, AgentMother.request(announced, AgentMother.controlsArgv()),
    )
    await tested.journal.finish(AgentMother.WATCH, refused, AgentMother.receipt(
      new ProcessOutput({
        code: 4,
        stdout: '{"version":1,"kind":"refusal","state":"blocked-controls","outcome":"failed","exit":4,'
          + '"run":{"issue":332,"task":1,"tasksTotal":3,"step":"controls","discards":0},'
          + '"detail":"run blocked-controls: task 1/3, 0 discard(s)"}\n',
        stderr: '',
      }), '{"step":"controls"}\n', '{"step":"controls"}\n',
    ))
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
    }

    await tested.agents.recover(asked)
    await Bounded.wait(tested.oracle.promise)
    const driving = tested.driver.driving.get(AgentMother.CONVERSATION)
    expect(driving).toBeDefined()
    await Bounded.wait(driving as Promise<void>)

    expect(tested.evidence.asked[0]).toEqual(AgentMother.nextArgv())
    const entries = await tested.journal.entries(AgentMother.WATCH)
    expect(entries).toHaveLength(3)
    expect(JSON.parse(entries[2].request)).toMatchObject({ previous: refused, argv: AgentMother.nextArgv() })
  })

  it('untouched established recovery issues next without planner wait or publication', async () => {
    const tested = await sourceScenario(true)
    await tested.journal.establish(AgentMother.WATCH, AgentMother.manifest())
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
    }

    await tested.agents.recover(asked)
    await Bounded.wait(tested.oracle.promise)
    const driving = tested.driver.driving.get(AgentMother.CONVERSATION)
    expect(driving).toBeDefined()
    await Bounded.wait(driving as Promise<void>)

    expect(tested.evidence.calls).toBe(1)
    expect(tested.plannerDone.settled).toBe(false)
    expect(tested.publicationEntered.settled).toBe(false)
    const entries = await tested.journal.entries(AgentMother.WATCH)
    expect(entries).toHaveLength(1)
    expect(JSON.parse(entries[0].request)).toMatchObject({
      version: 1,
      previous: null,
      cwd: AgentMother.LOCATION.path,
    })
    expect(entries[0].receipt.kind).toBe('present')

    await tested.agents.recover(asked)
    expect(tested.evidence.calls).toBe(1)
    expect(await tested.journal.entries(AgentMother.WATCH)).toHaveLength(1)

    const unexplained = await sourceScenario(true)
    await unexplained.journal.establish(AgentMother.WATCH, AgentMother.manifest())
    unexplained.evidence.run = '{"step":"implement"}\n'
    await expect(unexplained.agents.recover(asked)).rejects.toBeInstanceOf(PlanRecoveryConflict)
    expect(unexplained.evidence.calls).toBe(0)
    expect(unexplained.publicationEntered.settled).toBe(false)

    const pending = await sourceScenario(true)
    await pending.journal.establish(AgentMother.WATCH, AgentMother.manifest())
    await pending.journal.begin(AgentMother.WATCH, `${JSON.stringify({
      version: 1,
      previous: null,
      argv: [
        '/plugin/ct-step.mjs', 'next', '--plan', AgentMother.PLAN, '--issue', '332',
        '--output-format', 'json',
      ],
      cwd: AgentMother.LOCATION.path,
      planSha256: createHash('sha256').update(AgentMother.PLAN_TEXT).digest('hex'),
    })}\n`)
    await expect(pending.agents.recover(asked)).rejects.toBeInstanceOf(PlanRecoveryConflict)
    expect(pending.evidence.calls).toBe(0)
    expect(pending.publicationEntered.settled).toBe(false)
  })

  it('completed next recovery consumes its ready command exactly once', async () => {
    const tested = await sourceScenario(true)
    await tested.journal.establish(AgentMother.WATCH, AgentMother.manifest())
    const ticket = await tested.journal.begin(
      AgentMother.WATCH,
      AgentMother.request(null, AgentMother.nextArgv()),
    )
    await tested.journal.finish(
      AgentMother.WATCH,
      ticket,
      AgentMother.receipt(
        new ProcessOutput({ code: 0, stdout: AgentMother.controlsAnnouncement(), stderr: '' }),
        null,
        AgentMother.RUN_BYTES,
      ),
    )
    tested.evidence.run = AgentMother.RUN_BYTES
    tested.evidence.answers.set(JSON.stringify(AgentMother.controlsArgv()), () => {
      tested.evidence.run = '{"step":"implement","task":1}\n'
      return new ProcessOutput({ code: 0, stdout: AgentMother.deliveredTransition(), stderr: '' })
    })
    const inspection = await tested.machine.inspect(AgentMother.WATCH)
    expect(inspection.fact).toEqual({
      kind: 'active',
      instruction: new RunInstruction({ kind: 'command', ticket }),
    })
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
    }

    await tested.agents.recover(asked)
    await Bounded.wait(tested.oracle.promise)
    const driving = tested.driver.driving.get(AgentMother.CONVERSATION)
    expect(driving).toBeDefined()
    await Bounded.wait(driving as Promise<void>)

    expect(tested.evidence.asked).toEqual([AgentMother.controlsArgv()])
    expect(await tested.journal.entries(AgentMother.WATCH)).toHaveLength(2)
    expect(tested.plannerDone.settled).toBe(false)
    expect(tested.publicationEntered.settled).toBe(false)

    await tested.agents.recover(asked)
    expect(tested.evidence.asked).toEqual([AgentMother.controlsArgv()])
    expect(await tested.journal.entries(AgentMother.WATCH)).toHaveLength(2)
  })

  it('real run boundaries retain declared refusal mappings', async () => {
    const writeRefusal = Object.assign(new Error('admission write refused'), { code: 'EIO' })
    const unreadableLaunch = await sourceScenario(
      false,
      (root) => new RefusingWriteFiles(root, writeRefusal),
    )
    const internalWrite = await unreadableLaunch.journal.admit(AgentMother.WATCH).catch((cause) => cause)
    expect(internalWrite.constructor).toBe(RunNotAdvanced)

    const launchNotRead = await unreadableLaunch.agents.launch(AgentMother.BRIEFING).catch((cause) => cause)
    expect(launchNotRead.constructor).toBe(PlanAgentNotLaunched)
    expect(launchNotRead.message).toBe(internalWrite.message)
    const failedLaunch = PlanCollapse.of(launchNotRead)
    expect(failedLaunch.status).toBe(400)
    expect(failedLaunch.code).toBe('plan-agent-not-launched')
    expect(failedLaunch.detail).toBe(internalWrite.message)
    expect(unreadableLaunch.calls.starts).toEqual([])
    expect(unreadableLaunch.evidence.calls).toBe(0)

    const conflictingLaunch = await sourceScenario()
    const admissionPath = AgentMother.admissionPath(conflictingLaunch.root)
    await fs.mkdir(join(admissionPath, '..'), { recursive: true })
    await fs.writeFile(admissionPath, '{"version":1,"conversation":"99999999-9999-4999-8999-999999999999"}\n', 'utf8')
    const internalConflict = await conflictingLaunch.journal.admit(AgentMother.WATCH).catch((cause) => cause)
    expect(internalConflict.constructor).toBe(RunNotUnderstood)

    const launchNotNamed = await conflictingLaunch.agents.launch(AgentMother.BRIEFING).catch((cause) => cause)
    expect(launchNotNamed.constructor).toBe(PlanAgentNotNamed)
    expect(launchNotNamed.message).toBe(internalConflict.message)
    const malformedLaunch = PlanCollapse.of(launchNotNamed)
    expect(malformedLaunch.status).toBe(400)
    expect(malformedLaunch.code).toBe('plan-agent-not-named')
    expect(malformedLaunch.detail).toBe(internalConflict.message)
    expect(conflictingLaunch.calls.starts).toEqual([])
    expect(conflictingLaunch.evidence.calls).toBe(0)

    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
    }
    const readRefusal = Object.assign(new Error('admission read refused'), { code: 'EIO' })
    const unreadableEvidence = await sourceScenario(
      false,
      (root) => AgentMother.readFailureFiles(root, readRefusal),
    )
    const internalRead = await unreadableEvidence.journal.admitted(AgentMother.WATCH).catch((cause) => cause)
    expect(internalRead.constructor).toBe(RunNotAdvanced)

    const recoveryNotRead = await unreadableEvidence.agents.recover(asked).catch((cause) => cause)
    expect(recoveryNotRead.constructor).toBe(PlanRecoveryNotRead)
    expect(recoveryNotRead.message).toBe(internalRead.message)
    const fixNotRead = await unreadableEvidence.agents.fix({ ...asked, changes: 'Keep behavior.' }).catch((cause) => cause)
    expect(fixNotRead.constructor).toBe(PlanAgentNotResumed)
    expect(fixNotRead.message).toBe(internalRead.message)
    expect(unreadableEvidence.calls.starts).toEqual([])
    expect(unreadableEvidence.evidence.calls).toBe(0)

    const malformedEvidence = await sourceScenario()
    const malformedAdmission = AgentMother.admissionPath(malformedEvidence.root)
    await fs.mkdir(join(malformedAdmission, '..'), { recursive: true })
    await fs.writeFile(malformedAdmission, '{"version":', 'utf8')
    const internalMalformed = await malformedEvidence.journal.admitted(AgentMother.WATCH).catch((cause) => cause)
    expect(internalMalformed.constructor).toBe(RunNotUnderstood)

    const recoveryNotUnderstood = await malformedEvidence.agents.recover(asked).catch((cause) => cause)
    expect(recoveryNotUnderstood.constructor).toBe(PlanRecoveryNotUnderstood)
    expect(recoveryNotUnderstood.message).toBe(internalMalformed.message)
    const fixNotUnderstood = await malformedEvidence.agents.fix({ ...asked, changes: 'Keep behavior.' }).catch((cause) => cause)
    expect(fixNotUnderstood.constructor).toBe(PlanAgentNotResumed)
    expect(fixNotUnderstood.message).toBe(internalMalformed.message)
    expect(malformedEvidence.calls.starts).toEqual([])
    expect(malformedEvidence.evidence.calls).toBe(0)

    class UnknownRunFailure extends RunFailure {}
    for (const unexpected of [
      new TypeError('unexpected admission defect'),
      new UnknownRunFailure('unknown run cause'),
    ]) {
      const unhandled = await sourceScenario(
        false,
        (root) => new RefusingWriteFiles(root, unexpected),
      )
      const propagated = await unhandled.agents.launch(AgentMother.BRIEFING).catch((cause) => cause)
      expect(propagated).toBe(unexpected)
      expect(unhandled.calls.starts).toEqual([])
      expect(unhandled.evidence.calls).toBe(0)
    }
  })

  it('non-launch proof and ambiguous launch evidence keep their existing cleanup meanings', async () => {
    const definite = await scenario()
    const proof = new PlanNonLaunch({
      conversation: AgentMother.CONVERSATION,
      callId: null,
      source: 'before-worker',
      diagnostic: 'worker was never started',
      observedAt: AgentMother.STARTED,
    })
    definite.calls.start = async () => { throw new PlanAgentNeverLaunched(proof) }

    await expect(definite.agents.launch(AgentMother.BRIEFING)).rejects.toBeInstanceOf(PlanAgentNeverLaunched)
    expect((definite.agents.records as RecordsDouble).proof).toBe(proof)

    const ambiguous = await scenario()
    ambiguous.calls.start = async () => { throw new PlanAgentNotLaunched('acceptance was not observed') }
    await expect(ambiguous.agents.launch(AgentMother.BRIEFING)).rejects.toThrow('acceptance was not observed')
    expect((ambiguous.agents.records as RecordsDouble).proof).toBeNull()
    expect(await ambiguous.journal.admitted(AgentMother.WATCH)).toBe(true)
  })

  it('a change asked while the run is in flight is held rather than refused', async () => {
    const tested = await scenario(true, () => '2026-09-19T10:00:00.000Z', [
      '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777',
    ])
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      changes: 'Rename the port before the next task.',
      requestId: 'review-11',
    }

    tested.machine.inspection = new RunInspection({ kind: 'active', instruction: new RunInstruction({
      kind: 'command', ticket: '44444444-4444-4444-8444-444444444444',
    }) })
    await tested.agents.fix(asked)
    tested.machine.inspection = new RunInspection({ kind: 'unstarted' })
    await tested.agents.fix({ ...asked, changes: 'And drop the flag.' })

    const held = await tested.journal.pending(AgentMother.WATCH)
    expect(held.map((message) => message.text)).toEqual([
      'Rename the port before the next task.', 'And drop the flag.',
    ])
    expect(tested.calls.starts).toEqual([])
  })

  it('a change asked of a run nobody is driving puts somebody back on it', async () => {
    const tested = await scenario(true, () => '2026-09-19T10:00:00.000Z', [
      '66666666-6666-4666-8666-666666666666',
    ])
    tested.machine.inspection = new RunInspection({ kind: 'active', instruction: new RunInstruction({
      kind: 'command', ticket: '44444444-4444-4444-8444-444444444444',
    }) })

    expect(tested.agents.owns(AgentMother.WATCH)).toBe(false)

    await tested.agents.fix({
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      changes: 'Rename the port before the next task.',
      requestId: 'review-13',
    })

    expect(await tested.journal.pending(AgentMother.WATCH)).toHaveLength(1)
    expect(tested.agents.owns(AgentMother.WATCH)).toBe(true)
  })

  it('a change asked before the run is established is still refused', async () => {
    const tested = await scenario(true)
    tested.machine.inspection = new RunInspection({ kind: 'absent' })

    await expect(tested.agents.fix({
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      changes: 'Too early for this one.',
      requestId: 'review-12',
    })).rejects.toThrow('absent')
  })

  it('a fix after delivery retains its original errand', async () => {
    const tested = await scenario(true)
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      changes: 'Preserve the exact review request.',
      requestId: 'review-10',
    }

    tested.machine.inspection = new RunInspection({ kind: 'delivered' })
    tested.registerSupervisor()
    await tested.agents.fix(asked)
    expect(tested.calls.starts).toEqual([['fix', asked.changes, asked.requestId]])

    tested.fixDone.resolve(AgentMother.completed(tested.calls.fixCall, false))
    await Bounded.wait(tested.supervisor.promise)
    expect(tested.warnings.join('')).toContain('recorded failure')
    expect(tested.warnings.join('')).toContain(tested.calls.fixCall.id)
    tested.transport.historyValue = [new RecordedCall({
      call: tested.calls.fixCall,
      purpose: 'fix',
      startedAt: AgentMother.STARTED,
      completion: AgentMother.completed(tested.calls.fixCall, false),
    })]
    tested.transport.descriptors.set(
      tested.calls.fixCall.id,
      AgentMother.descriptor(tested.calls.fixCall, 'fix', asked.requestId),
    )
    await expect(tested.agents.fix(asked)).rejects.toBeInstanceOf(PlanAgentNotResumed)
  })

  it('a_change_a_busy_slice_cannot_take_is_kept_with_a_ticket_and_starts_nothing', async () => {
    const tested = await scenario(true, () => '2026-09-20T10:00:00.000Z', [
      '66666666-6666-4666-8666-666666666666',
    ])

    tested.machine.inspection = new RunInspection({ kind: 'delivered' })
    const ticket = await tested.agents.hold({
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      changes: 'And also rename the port.',
    })

    expect(ticket).toBe('66666666-6666-4666-8666-666666666666')
    expect(tested.calls.starts).toEqual([])
    expect((await tested.journal.pending(AgentMother.WATCH)).map((held) => held.text))
      .toEqual(['And also rename the port.'])
  })

  it('a_kept_change_outlives_the_session_because_it_is_written_where_the_run_keeps_its_journal', async () => {
    const tested = await scenario(true, () => '2026-09-20T10:00:00.000Z', [
      '66666666-6666-4666-8666-666666666666',
    ])

    tested.machine.inspection = new RunInspection({ kind: 'delivered' })
    await tested.agents.hold({
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      changes: 'Survive a restart.',
    })
    const reopened = new RunJournal({
      files: new HeadlessFiles({ root: tested.root, fs, newId: () => 'temporary-record' }),
      newId: () => 'unused',
      now: () => '2026-09-20T11:00:00.000Z',
    })

    expect((await reopened.pending(AgentMother.WATCH)).map((held) => held.text)).toEqual(['Survive a restart.'])
  })

  it('a_run_that_predates_the_journal_refuses_to_keep_a_change_instead_of_dropping_it', async () => {
    const tested = await scenario()

    await expect(tested.agents.hold({
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      changes: 'Nowhere to keep this.',
    })).rejects.toBeInstanceOf(PlanAgentNotResumed)
  })

  it('what_was_kept_while_a_fix_was_in_flight_goes_out_when_that_fix_finishes', async () => {
    const tested = await scenario(true, () => '2026-09-20T10:00:00.000Z', [
      '66666666-6666-4666-8666-666666666666',
    ])
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      changes: 'Fix the supervised thing.',
      requestId: 'review-20',
    }

    tested.machine.inspection = new RunInspection({ kind: 'delivered' })
    await tested.agents.fix(asked)
    await tested.agents.hold({ ...asked, changes: 'And also rename the port.' })
    expect(tested.calls.starts).toEqual([['fix', asked.changes, asked.requestId]])

    tested.fixDone.resolve(AgentMother.completed(tested.calls.fixCall))
    await Settled.waitFor(() => tested.calls.starts.length === 2, 'the held change going out')

    expect(tested.calls.starts[1]).toEqual([
      'fix', 'And also rename the port.', 'message:66666666-6666-4666-8666-666666666666',
    ])
    await Settled.until(async () => (await tested.journal.pending(AgentMother.WATCH)).length === 0, 'the ticket settling')
    await Settled.waitFor(() => tested.announcements.announced.length === 1, 'the session being told')
    expect(tested.announcements.announced).toEqual([{
      repository: AgentMother.REPOSITORY.text,
      issue: AgentMother.ISSUE.number,
      ticket: '66666666-6666-4666-8666-666666666666',
    }])
  })

  it('a granted round lifts the run and puts a driver back on it', async () => {
    const tested = await scenario(true)
    tested.machine.inspection = new RunInspection({
      kind: 'uncertain',
      detail: 'ct-step refused: the run is blocked-judge with outcome failed (exit 1)',
      closure: { state: 'blocked-judge', outcome: 'failed', exit: 1, task: 2, findings: null, verdict: null },
    })
    tested.machine.anotherRoundAnswer = new RunInstruction({
      kind: 'command', ticket: '44444444-4444-4444-8444-444444444444',
    })
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      instruction: 'Please try again, this time awaiting the flush.',
    }

    expect(tested.agents.owns(AgentMother.WATCH)).toBe(false)

    await tested.agents.anotherRound(asked)

    expect(tested.machine.anotherRoundAsked).toEqual([{ watch: AgentMother.WATCH, instruction: asked.instruction }])
    expect(tested.agents.owns(AgentMother.WATCH)).toBe(true)
  })

  it('a run nobody closed at the judge is refused before anything is journaled', async () => {
    const tested = await scenario(true)
    tested.machine.inspection = new RunInspection({
      kind: 'active',
      instruction: new RunInstruction({ kind: 'command', ticket: '44444444-4444-4444-8444-444444444444' }),
    })
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      instruction: 'Please try again.',
    }

    const failure = await tested.agents.anotherRound(asked).catch((cause: unknown) => cause)

    expect(failure).toBeInstanceOf(AnotherRoundNotGranted)
    expect((failure as Error).message).toBe(
      `conversation ${JSON.stringify(AgentMother.CONVERSATION)} is active rather than blocked-judge (no closure)`,
    )
    expect(tested.machine.anotherRoundAsked).toEqual([])
    expect(tested.agents.owns(AgentMother.WATCH)).toBe(false)
  })

  it('an uncertain inspection with no closure is refused and journals nothing', async () => {
    const tested = await scenario(true)
    tested.machine.inspection = new RunInspection({
      kind: 'uncertain',
      detail: 'the established run has unexplained plugin activity before its first command',
      closure: null,
    })
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      instruction: 'Please try again.',
    }

    const failure = await tested.agents.anotherRound(asked).catch((cause: unknown) => cause)

    expect(failure).toBeInstanceOf(AnotherRoundNotGranted)
    expect((failure as Error).message).toBe(
      `conversation ${JSON.stringify(AgentMother.CONVERSATION)} is uncertain rather than blocked-judge (no closure)`,
    )
    expect(tested.machine.anotherRoundAsked).toEqual([])
    expect(tested.agents.owns(AgentMother.WATCH)).toBe(false)
  })

  it('a reopen the plugin refused is never reported as a granted round', async () => {
    const tested = await scenario(true)
    tested.machine.inspection = new RunInspection({
      kind: 'uncertain',
      detail: 'ct-step refused: the run is blocked-judge with outcome failed (exit 1)',
      closure: { state: 'blocked-judge', outcome: 'failed', exit: 1, task: 2, findings: null, verdict: null },
    })
    const detail = 'ct-step did not print an executable consuming verb'
    tested.machine.anotherRoundAnswer = new RunInstruction({ kind: 'refused', detail, closure: null })
    const asked = {
      agent: AgentMother.CONVERSATION,
      issue: AgentMother.ISSUE.number,
      repository: AgentMother.REPOSITORY,
      instruction: 'Please try again.',
    }

    const failure = await tested.agents.anotherRound(asked).catch((cause: unknown) => cause)

    expect(failure).toBeInstanceOf(AnotherRoundNotGranted)
    expect((failure as Error).message).toBe(detail)
    expect(tested.agents.owns(AgentMother.WATCH)).toBe(false)
  })
})
