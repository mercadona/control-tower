import { describe, expect, it } from 'vitest'
import {
  DeliverHeldMessages,
} from '../../src/application/actions/deliver-held-messages.ts'
import { DriveRun, DriveRunParams } from '../../src/application/actions/drive-run.ts'
import {
  ExecuteRunInstruction, ExecuteRunInstructionParams,
} from '../../src/application/actions/execute-run-instruction.ts'
import {
  PlanAgentNotResumed, PlanProgressNotRead, RunNotAdvanced,
} from '../../src/domain/exceptions.ts'
import { CallMeasurements } from '../../src/domain/ports/call-measurements.ts'
import { PlanCalls } from '../../src/domain/ports/plan-calls.ts'
import { PlanPublication } from '../../src/domain/ports/plan-publication.ts'
import { SliceMessages } from '../../src/domain/ports/slice-messages.ts'
import { HeldMessage } from '../../src/domain/value-objects/held-message.ts'
import { RunCalls } from '../../src/domain/ports/run-calls.ts'
import {
  RunEstablishment, type RunEstablishmentValue, RunMachine,
} from '../../src/domain/ports/run-machine.ts'
import {
  CompletedPlanCall, StartedPlanCall, type CallExecution,
} from '../../src/domain/value-objects/plan-call.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RunInstruction } from '../../src/domain/value-objects/run-instruction.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'

class Deferred<T> {
  readonly promise: Promise<T>
  #resolve!: (answer: T) => void

  constructor() {
    this.promise = new Promise((resolve) => { this.#resolve = resolve })
  }

  resolve(answer: T): void {
    this.#resolve(answer)
  }
}

class RunMother {
  static readonly WATCH = new PlanWatch({
    story: null,
    issue: new PlanIssue({
      number: 332,
      url: 'https://github.com/mercadona/control-tower-plugin/issues/332',
    }),
    located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/332', branch: 'feat/332' }),
    repository: new RepositoryName('mercadona/control-tower-plugin'),
    agent: 'conversation-332',
  })
  static readonly PLANNER = new StartedPlanCall({ conversation: RunMother.WATCH.agent, id: 'planner-332' })

  static command(ticket: string): RunInstruction {
    return new RunInstruction({ kind: 'command', ticket })
  }

  static call(ticket: string): RunInstruction {
    return new RunInstruction({ kind: 'call', ticket })
  }

  static delivered(): RunInstruction {
    return new RunInstruction({ kind: 'delivered' })
  }

  static refused(detail: string): RunInstruction {
    return new RunInstruction({ kind: 'refused', detail })
  }

  static completed(execution: CallExecution = { kind: 'success' }, code = 0): CompletedPlanCall {
    return new CompletedPlanCall({
      call: RunMother.PLANNER,
      code,
      signal: null,
      finishedAt: '2026-09-17T10:00:00.000Z',
      wallDurationMs: 20,
      execution,
      measurement: {
        cost: { kind: 'unavailable', reason: 'application boundary fixture' },
        turns: null,
        durationMs: null,
        unavailable: ['cost', 'turns', 'durationMs'],
      },
    })
  }
}

class PlanCallsDouble extends PlanCalls {
  readonly completion: CompletedPlanCall
  readonly trace: string[]

  constructor(trace: string[], completion = RunMother.completed()) {
    super()
    this.trace = trace
    this.completion = completion
  }

  override async start(
    watch: PlanWatch,
    purpose: string,
    _changes: string | null,
    requestId?: string,
  ): Promise<StartedPlanCall> {
    this.trace.push(`start:${purpose}:${String(requestId)}`)
    return new StartedPlanCall({ conversation: watch.agent, id: `call-${String(requestId)}` })
  }

  override async wait(call: StartedPlanCall): Promise<CompletedPlanCall> {
    this.trace.push(`wait:${call.id}`)
    return this.completion
  }
}

class HeldMessagesDouble extends SliceMessages {
  readonly trace: string[] | null
  held: HeldMessage[]

  constructor(trace: string[] | null = null, held: readonly HeldMessage[] = []) {
    super()
    this.trace = trace
    this.held = [...held]
  }

  override async hold(): Promise<string> {
    throw new Error('the driver never holds a change')
  }

  override async pending(): Promise<readonly HeldMessage[]> {
    this.trace?.push('pending')
    return Object.freeze([...this.held])
  }

  override async settle(_watch: PlanWatch, ticket: string): Promise<void> {
    this.trace?.push(`settle:${ticket}`)
    this.held = this.held.filter((message) => message.ticket !== ticket)
  }
}

class CallMeasurementsDouble extends CallMeasurements {
  readonly trace: string[]

  constructor(trace: string[]) {
    super()
    this.trace = trace
  }

  override async capture(call: StartedPlanCall): Promise<void> {
    this.trace.push(`capture:${call.id}`)
  }
}

class PlanPublicationDouble extends PlanPublication {
  readonly trace: string[]
  readonly failure: Error | null

  constructor(trace: string[], failure: Error | null = null) {
    super()
    this.trace = trace
    this.failure = failure
  }

  override async publish(): Promise<void> {
    this.trace.push('publish')
    if (this.failure !== null) throw this.failure
  }
}

class ThrowingPlanCalls extends PlanCalls {
  override async wait(): Promise<CompletedPlanCall> {
    throw new Error('planner wait must not run')
  }
}

class ThrowingPublication extends PlanPublication {
  override async publish(): Promise<void> {
    throw new Error('publication must not run')
  }
}

class RunCallsDouble extends RunCalls {
  readonly trace: string[]

  constructor(trace: string[]) {
    super()
    this.trace = trace
  }

  override async perform(_watch: PlanWatch, instruction: RunInstruction): Promise<void> {
    if (instruction.work.kind !== 'call') throw new Error('perform received a non-call instruction')
    this.trace.push(`perform:${instruction.work.ticket}`)
  }
}

class RunMachineDouble extends RunMachine {
  readonly trace: string[]
  readonly continuations: ReadonlyMap<string, RunInstruction>
  readonly openings: RunInstruction[]
  readonly establishmentAnswer: RunEstablishmentValue | Promise<RunEstablishmentValue>
  openCount = 0
  establishmentCount = 0

  constructor(asked: {
    trace: string[],
    opening: RunInstruction | RunInstruction[],
    continuations?: ReadonlyMap<string, RunInstruction>,
    establishment?: RunEstablishmentValue | Promise<RunEstablishmentValue>,
  }) {
    super()
    this.trace = asked.trace
    this.openings = Array.isArray(asked.opening) ? [...asked.opening] : [asked.opening]
    this.continuations = asked.continuations ?? new Map()
    this.establishmentAnswer = asked.establishment ?? RunEstablishment.ESTABLISHED
  }

  override async establishment(): Promise<RunEstablishmentValue> {
    this.establishmentCount += 1
    this.trace.push('establishment')
    return this.establishmentAnswer
  }

  override async open(): Promise<RunInstruction> {
    this.openCount += 1
    this.trace.push('open')
    const answer = this.openings.shift()
    if (answer === undefined) throw new Error('open received no scripted answer')
    return answer
  }

  override async advance(_watch: PlanWatch, instruction: RunInstruction): Promise<RunInstruction> {
    if (instruction.work.kind !== 'call' && instruction.work.kind !== 'command') {
      throw new Error('advance received a terminal instruction')
    }
    this.trace.push(`advance:${instruction.work.ticket}`)
    const answer = this.continuations.get(instruction.work.ticket)
    if (answer === undefined) throw new Error(`no continuation for ${instruction.work.ticket}`)
    return answer
  }
}

class RejectingRunMachine extends RunMachine {
  override async establishment(): Promise<RunEstablishmentValue> {
    throw new RunNotAdvanced('journal read exited 17: malformed receipt')
  }

  override async open(): Promise<RunInstruction> {
    throw new Error('open must not run')
  }

  override async advance(): Promise<RunInstruction> {
    throw new Error('advance must not run')
  }
}

class RunFlow {
  readonly trace: string[]
  readonly machine: RunMachine
  readonly calls: PlanCalls
  readonly publication: PlanPublication
  readonly runCalls: RunCallsDouble
  readonly driver: DriveRun

  constructor(asked: {
    machine: RunMachine,
    trace?: string[],
    calls?: PlanCalls,
    publication?: PlanPublication,
    messages?: SliceMessages,
    drainCalls?: PlanCalls,
  }) {
    this.trace = asked.trace ?? []
    this.machine = asked.machine
    this.calls = asked.calls ?? new PlanCallsDouble(this.trace)
    this.publication = asked.publication ?? new PlanPublicationDouble(this.trace)
    this.runCalls = new RunCallsDouble(this.trace)
    this.driver = new DriveRun({
      calls: this.calls,
      publication: this.publication,
      machine: this.machine,
      step: new ExecuteRunInstruction({ machine: this.machine, calls: this.runCalls }),
      messages: new DeliverHeldMessages({
        messages: asked.messages ?? new HeldMessagesDouble(),
        calls: asked.drainCalls ?? new PlanCallsDouble(this.trace),
        measurements: new CallMeasurementsDouble(this.trace),
      }),
    })
  }

  run(): Promise<void> {
    return this.driver.execute(new DriveRunParams({ watch: RunMother.WATCH, planner: RunMother.PLANNER }))
  }
}

describe('DriveRun', () => {
  it('every held change is handed over before the next instruction runs', async () => {
    const trace: string[] = []
    const held = new HeldMessagesDouble(trace, [
      new HeldMessage({ ticket: 'ticket-1', askedAt: '2026-09-19T10:00:00.000Z', text: 'drop the flag' }),
    ])
    const flow = new RunFlow({
      trace,
      messages: held,
      machine: new RunMachineDouble({
        trace,
        opening: RunMother.call('c1'),
        continuations: new Map([['c1', RunMother.command('c2')], ['c2', RunMother.delivered()]]),
      }),
    })

    await flow.run()

    expect(trace).toEqual([
      'establishment',
      'open',
      'pending',
      'start:fix:message:ticket-1',
      'wait:call-message:ticket-1',
      'capture:call-message:ticket-1',
      'settle:ticket-1',
      'perform:c1',
      'advance:c1',
      'pending',
      'advance:c2',
    ])
  })

  it('a drain that refuses stops the run', async () => {
    const trace: string[] = []
    const held = new HeldMessagesDouble(trace, [
      new HeldMessage({ ticket: 'ticket-1', askedAt: '2026-09-19T10:00:00.000Z', text: 'drop the flag' }),
    ])
    const flow = new RunFlow({
      trace,
      messages: held,
      drainCalls: new PlanCallsDouble(trace, RunMother.completed({ kind: 'error', diagnostic: 'the agent refused' }, 1)),
      machine: new RunMachineDouble({
        trace,
        opening: RunMother.call('c1'),
        continuations: new Map([['c1', RunMother.delivered()]]),
      }),
    })

    await expect(flow.run()).rejects.toThrow('the agent refused')

    expect(trace).toEqual([
      'establishment',
      'open',
      'pending',
      'start:fix:message:ticket-1',
      'wait:call-message:ticket-1',
      'capture:call-message:ticket-1',
    ])
    expect(held.held).toHaveLength(1)
  })

  it('the driver follows oracle instructions without a local step order', async () => {
    const trace: string[] = []
    const first = RunMother.command('judge-before-implementation')
    const second = RunMother.call('implementation-after-judge')
    const third = RunMother.command('review-after-implementation')
    const machine = new RunMachineDouble({
      trace,
      opening: first,
      continuations: new Map([
        ['judge-before-implementation', second],
        ['implementation-after-judge', third],
        ['review-after-implementation', RunMother.delivered()],
      ]),
      establishment: RunEstablishment.ABSENT,
    })
    const flow = new RunFlow({ machine, trace })

    await flow.run()

    expect(trace).toEqual([
      'establishment',
      'wait:planner-332',
      'publish',
      'open',
      'advance:judge-before-implementation',
      'perform:implementation-after-judge',
      'advance:implementation-after-judge',
      'advance:review-after-implementation',
    ])
  })

  it('a failed planner or publication starts no machine work', async () => {
    const plannerTrace: string[] = []
    const plannerMachine = new RunMachineDouble({
      trace: plannerTrace,
      opening: RunMother.delivered(),
      establishment: RunEstablishment.ABSENT,
    })
    const failedPlanner = RunMother.completed({ kind: 'error', diagnostic: 'planner exited 23' }, 23)
    const plannerFlow = new RunFlow({
      machine: plannerMachine,
      trace: plannerTrace,
      calls: new PlanCallsDouble(plannerTrace, failedPlanner),
    })

    await expect(plannerFlow.run()).rejects.toThrow('planner exited 23')
    expect(plannerMachine.openCount).toBe(0)

    const publicationTrace: string[] = []
    const publicationMachine = new RunMachineDouble({
      trace: publicationTrace,
      opening: RunMother.delivered(),
      establishment: RunEstablishment.ABSENT,
    })
    const publicationFlow = new RunFlow({
      machine: publicationMachine,
      trace: publicationTrace,
      publication: new PlanPublicationDouble(publicationTrace, new PlanProgressNotRead('publication exited 41')),
    })

    const refusal = await publicationFlow.run().catch((cause) => cause)
    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toBe('publication exited 41')
    expect(publicationMachine.openCount).toBe(0)
  })

  it('an unexpected publication defect retains identity without machine effects', async () => {
    const trace: string[] = []
    const machine = new RunMachineDouble({
      trace,
      opening: RunMother.delivered(),
      establishment: RunEstablishment.ABSENT,
    })
    const sentinel = new TypeError('publication sentinel')
    const flow = new RunFlow({
      machine,
      trace,
      publication: new PlanPublicationDouble(trace, sentinel),
    })

    const failure = await flow.run().catch((cause) => cause)

    expect(failure).toBe(sentinel)
    expect(machine.openCount).toBe(0)
  })

  it('concurrent continuation shares one driver and releases it after failure', async () => {
    const establishment = new Deferred<RunEstablishmentValue>()
    const trace: string[] = []
    const machine = new RunMachineDouble({
      trace,
      opening: [RunMother.refused('oracle held the run'), RunMother.delivered()],
      establishment: establishment.promise,
    })
    const flow = new RunFlow({ machine, trace })

    const first = flow.run()
    const second = flow.run()
    establishment.resolve(RunEstablishment.ESTABLISHED)

    await expect(first).rejects.toThrow('oracle held the run')
    await expect(second).rejects.toThrow('oracle held the run')
    expect(machine.establishmentCount).toBe(1)
    expect(machine.openCount).toBe(1)

    await flow.run()
    expect(machine.establishmentCount).toBe(2)
    expect(machine.openCount).toBe(2)
  })

  it('a refused instruction preserves the oracle detail without another effect', async () => {
    const trace: string[] = []
    const machine = new RunMachineDouble({
      trace,
      opening: RunMother.refused('ct-step exited 29: receipt fork at ticket run:332'),
    })
    const flow = new RunFlow({ machine, trace })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(RunNotAdvanced)
    expect(refusal.message).toBe('ct-step exited 29: receipt fork at ticket run:332')
    expect(trace).toEqual(['establishment', 'open'])
  })

  it('established continuation reaches the journal without planner wait or publication', async () => {
    const trace: string[] = []
    const machine = new RunMachineDouble({ trace, opening: RunMother.delivered() })
    const flow = new RunFlow({
      machine,
      trace,
      calls: new ThrowingPlanCalls(),
      publication: new ThrowingPublication(),
    })

    await flow.run()
    expect(trace).toEqual(['establishment', 'open'])

    const unreadable = new RunFlow({
      machine: new RejectingRunMachine(),
      calls: new ThrowingPlanCalls(),
      publication: new ThrowingPublication(),
    })
    await expect(unreadable.run()).rejects.toThrow('journal read exited 17: malformed receipt')
  })

  it('empty oracle evidence is rejected at entry', () => {
    expect(() => RunMother.call('')).toThrow('ticket')
    expect(() => RunMother.command('   ')).toThrow('ticket')
    expect(() => RunMother.refused('')).toThrow('detail')
    expect(() => RunMother.refused('\t')).toThrow('detail')
  })

  it('instruction parameters and values stay immutable', () => {
    const mutable = { kind: 'call' as const, ticket: 'opaque-ticket' }
    const instruction = new RunInstruction(mutable)
    const params = new ExecuteRunInstructionParams({ watch: RunMother.WATCH, instruction })

    mutable.ticket = 'changed-ticket'

    expect(instruction.work).toEqual({ kind: 'call', ticket: 'opaque-ticket' })
    expect(Object.isFrozen(instruction.work)).toBe(true)
    expect(Object.isFrozen(instruction)).toBe(true)
    expect(Object.isFrozen(params)).toBe(true)
  })
})
