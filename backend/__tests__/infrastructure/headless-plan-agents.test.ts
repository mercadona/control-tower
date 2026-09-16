import { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ContinuePlan, ContinuePlanParams } from '../../src/application/actions/continue-plan.ts'
import { PlanAgentNeverLaunched, PlanAgentNotLaunched, PlanAgentNotResumed } from '../../src/domain/exceptions.ts'
import { PlanCalls } from '../../src/domain/ports/plan-calls.ts'
import { PlanPublication } from '../../src/domain/ports/plan-publication.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanNonLaunch } from '../../src/domain/value-objects/plan-non-launch.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CallInvocation, ClaudeCalls } from '../../src/infrastructure/claude-calls.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { HeadlessPlanAgents } from '../../src/infrastructure/headless-plan-agents.ts'

class Deferred<T> {
  readonly promise: Promise<T>
  resolve!: (value: T) => void
  reject!: (cause: Error) => void

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

class RecordsDouble extends PlanRecords {
  readonly watch: PlanWatch
  readonly events: string[]
  proofFailure: Error | null = null

  constructor(watch: PlanWatch, events: string[]) {
    super()
    this.watch = watch
    this.events = events
  }

  override async prepare(): Promise<PlanWatch> {
    this.events.push('recorded')
    return this.watch
  }

  override async find(): Promise<PlanWatch | null> {
    return this.watch
  }

  override async recordNonLaunch(_watch: PlanWatch, _proof: PlanNonLaunch): Promise<void> {
    this.events.push('proof-recorded')
    if (this.proofFailure !== null) throw this.proofFailure
  }
}

class CallsDouble extends PlanCalls {
  readonly events: string[]
  readonly call: StartedPlanCall

  constructor(events: string[], call: StartedPlanCall) {
    super()
    this.events = events
    this.call = call
  }

  override async start(): Promise<StartedPlanCall> {
    this.events.push('started')
    return this.call
  }

  override async planningFor(): Promise<StartedPlanCall> {
    this.events.push('planner-read')
    return this.call
  }
}

class PublicationDouble extends PlanPublication {}

class ContinuationDouble extends ContinuePlan {
  readonly entered: Deferred<void>
  readonly completion: Deferred<void>
  readonly params: ContinuePlanParams[] = []

  constructor(entered: Deferred<void>, completion: Deferred<void>) {
    super({ calls: new PlanCalls(), publication: new PublicationDouble() })
    this.entered = entered
    this.completion = completion
  }

  override async execute(params: ContinuePlanParams): Promise<void> {
    this.params.push(params)
    this.entered.resolve()
    return this.completion.promise
  }
}

class AcceptedChild extends ChildProcess {
  constructor() {
    super()
    queueMicrotask(() => this.emit('message', { kind: 'accepted' }))
  }
}

class HeadlessMother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly CALL = new StartedPlanCall({
    conversation: HeadlessMother.CONVERSATION,
    id: '22222222-2222-4222-8222-222222222222',
  })
  static readonly REPOSITORY = new RepositoryName('mercadona/control-tower-plugin')
  static readonly ISSUE = new PlanIssue({
    number: 331,
    url: 'https://github.com/mercadona/control-tower-plugin/issues/331',
  })
  static readonly LOCATION = new WorkspaceLocation({
    root: '/repo', path: '/repo/.worktrees/331', branch: 'feat/331',
  })
  static readonly WATCH = new PlanWatch({
    story: null,
    issue: HeadlessMother.ISSUE,
    located: HeadlessMother.LOCATION,
    repository: HeadlessMother.REPOSITORY,
    agent: HeadlessMother.CONVERSATION,
  })
  static readonly BRIEFING = new PlanBriefing({
    story: null,
    issue: HeadlessMother.ISSUE,
    located: HeadlessMother.LOCATION,
    repository: HeadlessMother.REPOSITORY,
  })

  static invocation(requestId: string): CallInvocation {
    return new CallInvocation({
      conversation: HeadlessMother.CONVERSATION,
      purpose: 'fix',
      requestId,
      cwd: '/repo/.worktrees/331',
      argv: ['--resume', HeadlessMother.CONVERSATION],
      prompt: 'Apply the requested correction.',
    })
  }
}

describe('HeadlessPlanAgents', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('launch records before starting and automatically supervises the bridge', async () => {
    const events: string[] = []
    const entered = new Deferred<void>()
    const completion = new Deferred<void>()
    const continuation = new ContinuationDouble(entered, completion)
    const agents = new HeadlessPlanAgents({
      records: new RecordsDouble(HeadlessMother.WATCH, events),
      calls: new CallsDouble(events, HeadlessMother.CALL),
      continuation,
      newId: () => '33333333-3333-4333-8333-333333333333',
      stderr: () => {},
    })

    const agent = await agents.launch(HeadlessMother.BRIEFING)
    await entered.promise

    expect(agent).toBe(HeadlessMother.CONVERSATION)
    expect(events).toEqual(['recorded', 'started'])
    expect(continuation.params).toEqual([
      new ContinuePlanParams({ watch: HeadlessMother.WATCH, call: HeadlessMother.CALL }),
    ])
    completion.resolve()
  })

  it('background failures preserve recorded work without an unhandled rejection', async () => {
    const events: string[] = []
    const entered = new Deferred<void>()
    const completion = new Deferred<void>()
    const warnings: string[] = []
    const agents = new HeadlessPlanAgents({
      records: new RecordsDouble(HeadlessMother.WATCH, events),
      calls: new CallsDouble(events, HeadlessMother.CALL),
      continuation: new ContinuationDouble(entered, completion),
      newId: () => '33333333-3333-4333-8333-333333333333',
      stderr: (line) => warnings.push(line),
    })

    await agents.launch(HeadlessMother.BRIEFING)
    completion.reject(new PlanAgentNotResumed('implementation failed'))
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(events).toEqual(['recorded', 'started'])
    expect(warnings.join('')).toContain('implementation failed')
    expect(warnings.join('')).toContain(HeadlessMother.CALL.id)
  })

  it('proof write failure preserves uncertainty', async () => {
    const events: string[] = []
    const records = new RecordsDouble(HeadlessMother.WATCH, events)
    records.proofFailure = new Error('proof disk full')
    const proof = new PlanNonLaunch({
      conversation: HeadlessMother.CONVERSATION,
      callId: null,
      source: 'before-worker',
      diagnostic: 'worker was never started',
      observedAt: '2026-09-16T10:00:00.000Z',
    })
    class NeverStartedCalls extends CallsDouble {
      override async start(): Promise<StartedPlanCall> {
        throw new PlanAgentNeverLaunched(proof)
      }
    }
    const agents = new HeadlessPlanAgents({
      records,
      calls: new NeverStartedCalls(events, HeadlessMother.CALL),
      continuation: new ContinuationDouble(new Deferred<void>(), new Deferred<void>()),
      newId: () => '33333333-3333-4333-8333-333333333333',
      stderr: () => {},
    })

    const failure = await agents.launch(HeadlessMother.BRIEFING).catch((cause) => cause)

    expect(failure).toBeInstanceOf(PlanAgentNotLaunched)
    expect(failure).not.toBeInstanceOf(PlanAgentNeverLaunched)
    expect(failure.message).toContain('worker was never started')
    expect(failure.message).toContain('proof disk full')
    expect(events).toEqual(['recorded', 'proof-recorded'])
  })

  it('restart observes the original planner deadline', async () => {
    const events: string[] = []
    const entered = new Deferred<void>()
    const completion = new Deferred<void>()
    const continuation = new ContinuationDouble(entered, completion)
    const agents = new HeadlessPlanAgents({
      records: new RecordsDouble(HeadlessMother.WATCH, events),
      calls: new CallsDouble(events, HeadlessMother.CALL),
      continuation,
      newId: () => '33333333-3333-4333-8333-333333333333',
      stderr: () => {},
    })

    await agents.recover({
      agent: HeadlessMother.CONVERSATION,
      issue: HeadlessMother.ISSUE.number,
      repository: HeadlessMother.REPOSITORY,
    })
    await entered.promise

    expect(events).toEqual(['planner-read'])
    expect(continuation.params).toEqual([
      new ContinuePlanParams({ watch: HeadlessMother.WATCH, call: HeadlessMother.CALL }),
    ])
    completion.resolve()
  })

  it('failed ambiguous or expired calls cannot relaunch', async () => {
    const events: string[] = []
    class RefusingCalls extends CallsDouble {
      override async planningFor(): Promise<StartedPlanCall> {
        throw new PlanAgentNotResumed('recorded planner is expired or ambiguous')
      }
    }
    const agents = new HeadlessPlanAgents({
      records: new RecordsDouble(HeadlessMother.WATCH, events),
      calls: new RefusingCalls(events, HeadlessMother.CALL),
      continuation: new ContinuationDouble(new Deferred<void>(), new Deferred<void>()),
      newId: () => '33333333-3333-4333-8333-333333333333',
      stderr: () => {},
    })

    await expect(agents.recover({
      agent: HeadlessMother.CONVERSATION,
      issue: HeadlessMother.ISSUE.number,
      repository: HeadlessMother.REPOSITORY,
    })).rejects.toThrow('expired or ambiguous')
    expect(events).toEqual([])
  })

  it('review retries reuse a recorded request without launching again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-headless-agents-'))
    roots.push(root)
    let launches = 0
    const calls = new ClaudeCalls({
      files: new HeadlessFiles({ root, fs, newId: () => `temporary-${launches}` }),
      binary: 'claude',
      worker: 'worker.ts',
      spawn: (() => { launches += 1; return new AcceptedChild() }) as typeof import('node:child_process').spawn,
      env: {},
      newId: () => HeadlessMother.CALL.id,
      now: () => '2026-09-16T10:00:00.000Z',
      budgetMs: 100,
      killGraceMs: 20,
      acceptanceMs: 50,
      pollMs: 10,
      sleep: async () => {},
    })

    const firstStart = calls.start(HeadlessMother.invocation('review-1'))
    const retry = calls.start(HeadlessMother.invocation('review-1'))
    const [first, retried] = await Promise.all([firstStart, retry])

    expect(retried).toEqual(first)
    expect(launches).toBe(1)
  })

  it('different review ids remain different requests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-headless-agents-'))
    roots.push(root)
    let id = 1
    let launches = 0
    const calls = new ClaudeCalls({
      files: new HeadlessFiles({ root, fs, newId: () => `temporary-${id}-${launches}` }),
      binary: 'claude',
      worker: 'worker.ts',
      spawn: (() => { launches += 1; return new AcceptedChild() }) as typeof import('node:child_process').spawn,
      env: {},
      newId: () => `${id++}1111111-1111-4111-8111-111111111111`,
      now: () => '2026-09-16T10:00:00.000Z',
      budgetMs: 100,
      killGraceMs: 20,
      acceptanceMs: 50,
      pollMs: 10,
      sleep: async () => {},
    })
    const first = await calls.start(HeadlessMother.invocation('review-1'))
    await writeFile(join(root, 'harness', first.conversation, 'calls', first.id, 'completion.json'), `${JSON.stringify({
      code: 0,
      signal: null,
      finishedAt: '2026-09-16T10:00:00.000Z',
      wallDurationMs: 0,
      execution: { kind: 'success' },
      measurement: {
        cost: { kind: 'reported', totalUsd: 0, attribution: 'unverified-resume' },
        turns: 0,
        durationMs: 0,
        unavailable: [],
      },
    })}\n`, 'utf8')

    const second = await calls.start(HeadlessMother.invocation('review-2'))

    expect(second.id).not.toBe(first.id)
    expect(launches).toBe(2)
  })
})
