import { describe, expect, it } from 'vitest'
import { AgentCalls } from '../../src/domain/ports/agent-calls.ts'
import { AgentMeasurementReader } from '../../src/domain/ports/agent-measurement-reader.ts'
import { AgentMeasurementStore } from '../../src/domain/ports/agent-measurement-store.ts'
import { AgentCallMeasurements } from '../../src/domain/value-objects/agent-call-measurements.ts'
import { CompletedPlanCall, StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { RecordedCall } from '../../src/domain/value-objects/recorded-call.ts'
import { MeasuredAgentCalls } from '../../src/infrastructure/measured-agent-calls.ts'
import { AgentCallMother as CommonAgentCallMother } from '../agent-call-mother.ts'

class AgentCallMother extends CommonAgentCallMother {
  static succeeded(): MeasurementScenario {
    return new MeasurementScenario(AgentCallMother.completed())
  }

  static failed(): MeasurementScenario {
    return new MeasurementScenario(AgentCallMother.completed(true))
  }

  static unfinished(): MeasurementScenario {
    return new MeasurementScenario(null)
  }
}

class ScriptedAgent extends AgentCalls<string, number> {
  readonly completion: CompletedPlanCall | null
  readonly starts: string[] = []
  readonly uncertainty = new Error('completion is not known')

  constructor(completion: CompletedPlanCall | null) {
    super()
    this.completion = completion
  }

  override async start(invocation: string): Promise<StartedPlanCall> {
    this.starts.push(invocation)
    return AgentCallMother.call()
  }

  override async startedFor(): Promise<StartedPlanCall | null> {
    return AgentCallMother.call()
  }

  override async wait(): Promise<CompletedPlanCall> {
    if (this.completion === null) throw this.uncertainty
    return this.completion
  }

  override async completed(): Promise<CompletedPlanCall | null> {
    return this.completion
  }

  override async history(conversation: string): Promise<readonly RecordedCall[]> {
    if (conversation !== 'conversation') throw new Error(`unlisted conversation ${conversation}`)
    return [new RecordedCall({
      call: AgentCallMother.call(), purpose: 'implementation',
      startedAt: AgentCallMother.STARTED_AT, completion: this.completion,
    })]
  }

  override async descriptorOf(): Promise<number> { return 17 }
  override async deadlineOf(): Promise<number> { return 12345 }
  override owns(): boolean { return false }
}

class ReportedAgentMeasurements extends AgentMeasurementReader {
  readonly readCalls: CompletedPlanCall[] = []

  override async read(completed: CompletedPlanCall): Promise<AgentCallMeasurements> {
    this.readCalls.push(completed)
    return AgentCallMother.measurements(completed)
  }
}

class RecordedAgentMeasurements extends AgentMeasurementStore {
  readonly recorded: AgentCallMeasurements[] = []
  refusal: Error | null = null
  hold: Promise<void> | null = null
  entered: () => void = () => {}

  override async record(measurements: AgentCallMeasurements): Promise<void> {
    if (this.refusal !== null) throw this.refusal
    this.entered()
    if (this.hold !== null) await this.hold
    this.recorded.push(measurements)
  }
}

class MeasurementScenario {
  readonly executor: ScriptedAgent
  readonly reader = new ReportedAgentMeasurements()
  readonly store = new RecordedAgentMeasurements()
  readonly calls: MeasuredAgentCalls<string, number>

  constructor(completed: CompletedPlanCall | null) {
    this.executor = new ScriptedAgent(completed)
    this.calls = this.observer()
  }

  observer(): MeasuredAgentCalls<string, number> {
    return new MeasuredAgentCalls({ executor: this.executor, reader: this.reader, store: this.store })
  }
}

describe('measured agent calls', () => {
  it('a completion cannot escape while its measurement is still being persisted', async () => {
    const scenario = AgentCallMother.succeeded()
    let release!: () => void
    scenario.store.hold = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { scenario.store.entered = resolve })
    let returned = false
    const waiting = scenario.calls.wait(AgentCallMother.call()).then(() => { returned = true })
    try {
      await entered
      await Promise.resolve()
      expect(returned).toBe(false)
      expect(scenario.store.recorded).toEqual([])
    } finally {
      release()
      await waiting
    }
    expect(returned).toBe(true)
    expect(scenario.store.recorded).toHaveLength(1)
  })

  it('waiting exposes completion only after its provider-neutral measurements have been recorded', async () => {
    const scenario = AgentCallMother.succeeded()

    const completion = await scenario.calls.wait(AgentCallMother.call())

    expect(completion).toBe(scenario.executor.completion)
    expect(scenario.store.recorded).toEqual([AgentCallMother.measurements(completion)])
    expect(scenario.executor.starts).toEqual([])
  })

  it('a nonblocking completion read also leaves measurements', async () => {
    const scenario = AgentCallMother.succeeded()

    await scenario.calls.completed(AgentCallMother.call())

    expect(scenario.store.recorded).toHaveLength(1)
    expect(scenario.store.recorded[0].provider).toBe('scripted-agent')
  })

  it('history reconciles finished calls after restart without launching an agent', async () => {
    const scenario = AgentCallMother.succeeded()

    const history = await scenario.observer().history('conversation')

    expect(scenario.store.recorded.map((measurement) => measurement.completed.call)).toEqual([history[0].call])
    expect(scenario.executor.starts).toEqual([])
  })

  it('a failed invocation retains its original execution failure and available consumption', async () => {
    const scenario = AgentCallMother.failed()

    const completion = await scenario.calls.wait(AgentCallMother.call())

    expect(completion).toBe(scenario.executor.completion)
    expect(scenario.store.recorded[0].completed.execution).toEqual({
      kind: 'error', diagnostic: 'agent exhausted its budget',
    })
    expect(scenario.store.recorded[0].tokens.output).toBe(5)
  })

  it('unfinished observations cannot invent terminal measurements', async () => {
    const scenario = AgentCallMother.unfinished()

    expect(await scenario.calls.completed(AgentCallMother.call())).toBeNull()
    expect((await scenario.calls.history('conversation'))[0].completion).toBeNull()

    expect(scenario.reader.readCalls).toEqual([])
    expect(scenario.store.recorded).toEqual([])
  })

  it('uncertain completion remains uncertain without recording a false timeout or retrying execution', async () => {
    const scenario = AgentCallMother.unfinished()

    await expect(scenario.calls.wait(AgentCallMother.call())).rejects.toBe(scenario.executor.uncertainty)

    expect(scenario.reader.readCalls).toEqual([])
    expect(scenario.store.recorded).toEqual([])
    expect(scenario.executor.starts).toEqual([])
  })

  it('a recording failure can be retried from completion without repeating execution', async () => {
    const scenario = AgentCallMother.succeeded()
    const refusal = new Error('measurement disk is full')
    scenario.store.refusal = refusal

    await expect(scenario.calls.wait(AgentCallMother.call())).rejects.toBe(refusal)
    scenario.store.refusal = null
    const completed = await scenario.calls.completed(AgentCallMother.call())

    expect(completed).toBe(scenario.executor.completion)
    expect(scenario.store.recorded).toHaveLength(1)
    expect(scenario.executor.starts).toEqual([])
  })

  it('launch and ownership delegate without provider-specific invocation requirements', async () => {
    const scenario = AgentCallMother.unfinished()

    expect(await scenario.calls.start('implement the requested work')).toEqual(AgentCallMother.call())
    expect(await scenario.calls.startedFor('implement the requested work')).toEqual(AgentCallMother.call())
    expect(await scenario.calls.descriptorOf(AgentCallMother.call())).toBe(17)
    expect(await scenario.calls.deadlineOf(AgentCallMother.call())).toBe(12345)
    expect(scenario.calls.owns(AgentCallMother.call())).toBe(false)
    expect(scenario.executor.starts).toEqual(['implement the requested work'])
    expect(scenario.store.recorded).toEqual([])
  })
})
