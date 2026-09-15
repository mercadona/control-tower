import { describe, expect, it } from 'vitest'
import { ContinuePlan, ContinuePlanParams } from '../../src/application/actions/continue-plan.ts'
import { PlanCalls } from '../../src/domain/ports/plan-calls.ts'
import { PlanPublication } from '../../src/domain/ports/plan-publication.ts'
import {
  CompletedPlanCall, StartedPlanCall,
  type CallExecution, type CallMeasurement, type PlanCallPurpose,
} from '../../src/domain/value-objects/plan-call.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.ts'

class Deferred<T> {
  readonly promise: Promise<T>
  #resolve!: (answer: T) => void
  #reject!: (cause: Error) => void

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
  }

  resolve(answer: T): void {
    this.#resolve(answer)
  }

  reject(cause: Error): void {
    this.#reject(cause)
  }
}

class PlanCallMother {
  static readonly PLANNER = new StartedPlanCall({ conversation: 'conversation-7', id: 'call-plan' })
  static readonly IMPLEMENTATION = new StartedPlanCall({ conversation: 'conversation-7', id: 'call-implementation' })

  static measurement({
    attribution = 'initial-invocation', unavailable = [], turns = 1, durationMs = 25,
  }: {
    attribution?: 'initial-invocation' | 'unverified-resume',
    unavailable?: readonly string[],
    turns?: number | null,
    durationMs?: number | null,
  } = {}): CallMeasurement {
    return {
      cost: { kind: 'reported', totalUsd: 0.42, attribution }, turns, durationMs, unavailable,
    }
  }

  static completed({
    call = PlanCallMother.PLANNER,
    code = 0,
    signal = null,
    execution = { kind: 'success' },
    measurement = PlanCallMother.measurement(),
  }: {
    call?: StartedPlanCall,
    code?: number | null,
    signal?: string | null,
    execution?: CallExecution,
    measurement?: CallMeasurement,
  } = {}): CompletedPlanCall {
    return new CompletedPlanCall({
      call, code, signal, execution, measurement,
      finishedAt: '2026-09-15T10:00:00.000Z', wallDurationMs: 30,
    })
  }

  static failedPlanner(): CompletedPlanCall {
    return PlanCallMother.completed({
      code: 1, execution: { kind: 'error', diagnostic: 'planner exited 1' },
    })
  }

  static interruptedImplementation(): CompletedPlanCall {
    return PlanCallMother.completed({
      call: PlanCallMother.IMPLEMENTATION,
      code: null,
      signal: 'SIGTERM',
      execution: { kind: 'error', diagnostic: 'implementation interrupted by SIGTERM' },
    })
  }
}

type StartSubject = {
  watch: PlanWatch,
  purpose: PlanCallPurpose,
  changes: string | null,
}

class PlanCallsDouble extends PlanCalls {
  readonly planner: CompletedPlanCall
  readonly implementation: CompletedPlanCall
  readonly started: StartSubject[]
  readonly waited: StartedPlanCall[]

  constructor({ planner, implementation }: {
    planner?: CompletedPlanCall,
    implementation?: CompletedPlanCall,
  } = {}) {
    super()
    this.planner = planner ?? PlanCallMother.completed()
    this.implementation = implementation ?? PlanCallMother.completed({ call: PlanCallMother.IMPLEMENTATION })
    this.started = []
    this.waited = []
  }

  async start(watch: PlanWatch, purpose: PlanCallPurpose, changes: string | null): Promise<StartedPlanCall> {
    this.started.push({ watch, purpose, changes })
    return PlanCallMother.IMPLEMENTATION
  }

  async wait(call: StartedPlanCall): Promise<CompletedPlanCall> {
    this.waited.push(call)
    return call === PlanCallMother.PLANNER ? this.planner : this.implementation
  }
}

class PlanPublicationDouble extends PlanPublication {
  readonly published: PlanWatch[]
  readonly answer: Promise<void>

  constructor(answer: Promise<void> = Promise.resolve()) {
    super()
    this.published = []
    this.answer = answer
  }

  async publish(watch: PlanWatch): Promise<void> {
    this.published.push(watch)
    return this.answer
  }
}

class Flow {
  static readonly WATCH = new PlanWatch({
    story: null,
    issue: new PlanIssue({ number: 331, url: 'https://github.com/mercadona/control-tower-plugin/issues/331' }),
    located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/331', branch: 'feat/331' }),
    repository: new RepositoryName('mercadona/control-tower-plugin'),
    agent: 'conversation-7',
  })

  readonly calls: PlanCallsDouble
  readonly publication: PlanPublicationDouble

  constructor({ calls, publication }: {
    calls?: PlanCallsDouble,
    publication?: PlanPublicationDouble,
  } = {}) {
    this.calls = calls ?? new PlanCallsDouble()
    this.publication = publication ?? new PlanPublicationDouble()
  }

  run(): Promise<void> {
    return new ContinuePlan(this).execute(new ContinuePlanParams({
      watch: Flow.WATCH, call: PlanCallMother.PLANNER,
    }))
  }
}

describe('ContinuePlan', () => {
  it('a completed plan is published before implementation starts without a reply', async () => {
    const publication = new Deferred<void>()
    const flow = new Flow({ publication: new PlanPublicationDouble(publication.promise) })
    const continued = flow.run()
    await Promise.resolve()

    expect(flow.publication.published).toEqual([Flow.WATCH])
    expect(flow.calls.started).toEqual([])

    publication.resolve()
    await continued

    expect(flow.calls.started).toEqual([{ watch: Flow.WATCH, purpose: 'implementation', changes: null }])
    expect(flow.calls.waited).toEqual([PlanCallMother.PLANNER, PlanCallMother.IMPLEMENTATION])
  })

  it('a failed planner never publishes or implements', async () => {
    const flow = new Flow({ calls: new PlanCallsDouble({ planner: PlanCallMother.failedPlanner() }) })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toBe('planner exited 1')
    expect(flow.publication.published).toEqual([])
    expect(flow.calls.started).toEqual([])
  })

  it('publication failure starts no implementation', async () => {
    const publicationFailure = new Error('issue publication failed')
    const flow = new Flow({ publication: new PlanPublicationDouble(Promise.reject(publicationFailure)) })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toBe('issue publication failed')
    expect(flow.calls.started).toEqual([])
  })

  it('continuation parameters are immutable beside the action', () => {
    const params = new ContinuePlanParams({ watch: Flow.WATCH, call: PlanCallMother.PLANNER })

    expect(Object.isFrozen(params)).toBe(true)
    expect(params.watch).toBe(Flow.WATCH)
    expect(params.call).toBe(PlanCallMother.PLANNER)
  })

  it('an error execution never continues despite available measurements', async () => {
    const planner = PlanCallMother.completed({
      execution: { kind: 'error', diagnostic: 'known planner error' },
      measurement: PlanCallMother.measurement(),
    })
    const flow = new Flow({ calls: new PlanCallsDouble({ planner }) })

    const refusal = await flow.run().catch((cause) => cause)

    expect(planner.succeeded).toBe(false)
    expect(planner.attributableCostUsd).toBe(0.42)
    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(flow.publication.published).toEqual([])
  })

  it('proven success continues with unavailable telemetry or unverified resumed cost', async () => {
    const planner = PlanCallMother.completed({
      measurement: {
        cost: { kind: 'reported', totalUsd: 1.05, attribution: 'unverified-resume' },
        turns: null,
        durationMs: null,
        unavailable: ['turns', 'durationMs'],
      },
    })
    const flow = new Flow({ calls: new PlanCallsDouble({ planner }) })

    await flow.run()

    expect(planner.succeeded).toBe(true)
    expect(planner.attributableCostUsd).toBe(null)
    expect(flow.calls.started).toHaveLength(1)
  })

  it('an interrupted implementation is reported without a retry', async () => {
    const implementation = PlanCallMother.interruptedImplementation()
    const flow = new Flow({ calls: new PlanCallsDouble({ implementation }) })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toBe('implementation interrupted by SIGTERM')
    expect(flow.calls.started).toHaveLength(1)
    expect(flow.calls.waited).toEqual([PlanCallMother.PLANNER, PlanCallMother.IMPLEMENTATION])
  })

  it('call evidence stays immutable when constructor inputs change', () => {
    const cost = { kind: 'reported' as const, totalUsd: 0.42, attribution: 'initial-invocation' as const }
    const unavailable: string[] = []
    const measurement = { cost, turns: 1, durationMs: 25, unavailable }
    const execution = { kind: 'error' as const, diagnostic: 'original failure' }
    const completed = PlanCallMother.completed({ execution, measurement })

    cost.totalUsd = 8
    unavailable.push('cost')
    execution.diagnostic = 'changed failure'

    expect(completed.measurement.cost).toEqual({
      kind: 'reported', totalUsd: 0.42, attribution: 'initial-invocation',
    })
    expect(completed.measurement.unavailable).toEqual([])
    expect(completed.execution).toEqual({ kind: 'error', diagnostic: 'original failure' })
    expect(Object.isFrozen(completed.measurement.cost)).toBe(true)
    expect(Object.isFrozen(completed.measurement.unavailable)).toBe(true)
    expect(Object.isFrozen(completed.measurement)).toBe(true)
    expect(Object.isFrozen(completed.execution)).toBe(true)
  })

  it('invalid numeric telemetry is rejected with the field named', () => {
    expect(() => PlanCallMother.completed({
      measurement: { ...PlanCallMother.measurement(), cost: {
        kind: 'reported', totalUsd: -1, attribution: 'initial-invocation',
      } },
    })).toThrow(/totalUsd/)
    expect(() => PlanCallMother.completed({
      measurement: PlanCallMother.measurement({ durationMs: Number.POSITIVE_INFINITY }),
    })).toThrow(/durationMs/)
    expect(() => PlanCallMother.completed({
      measurement: PlanCallMother.measurement({ turns: 1.5 }),
    })).toThrow(/turns/)
    expect(() => new CompletedPlanCall({
      call: PlanCallMother.PLANNER,
      code: 0,
      signal: null,
      finishedAt: '2026-09-15T10:00:00.000Z',
      wallDurationMs: -1,
      execution: { kind: 'success' },
      measurement: PlanCallMother.measurement(),
    })).toThrow(/wallDurationMs/)
  })

  it('unimplemented call ports reject instead of returning undefined', async () => {
    const calls = new PlanCalls()

    await expect(calls.start(Flow.WATCH, 'implementation', null)).rejects.toThrow(/must implement start/)
    await expect(calls.wait(PlanCallMother.PLANNER)).rejects.toThrow(/must implement wait/)
    await expect(new PlanPublication().publish(Flow.WATCH)).rejects.toThrow(/must implement publish/)
  })
})
