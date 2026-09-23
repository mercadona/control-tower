import { AgentCalls } from '../domain/ports/agent-calls.ts'
import type { AgentMeasurementReader } from '../domain/ports/agent-measurement-reader.ts'
import type { AgentMeasurementStore } from '../domain/ports/agent-measurement-store.ts'
import type { CompletedPlanCall, StartedPlanCall } from '../domain/value-objects/plan-call.ts'
import type { RecordedCall } from '../domain/value-objects/recorded-call.ts'

export class MeasuredAgentCalls<Invocation, Descriptor> extends AgentCalls<Invocation, Descriptor> {
  readonly executor: AgentCalls<Invocation, Descriptor>
  readonly reader: AgentMeasurementReader
  readonly store: AgentMeasurementStore

  constructor(ports: {
    executor: AgentCalls<Invocation, Descriptor>,
    reader: AgentMeasurementReader,
    store: AgentMeasurementStore,
  }) {
    super()
    this.executor = ports.executor
    this.reader = ports.reader
    this.store = ports.store
  }

  start(invocation: Invocation): Promise<StartedPlanCall> {
    return this.executor.start(invocation)
  }

  startedFor(invocation: Invocation): Promise<StartedPlanCall | null> {
    return this.executor.startedFor(invocation)
  }

  async wait(call: StartedPlanCall): Promise<CompletedPlanCall> {
    const completed = await this.executor.wait(call)
    await this.#record(completed)
    return completed
  }

  async completed(call: StartedPlanCall): Promise<CompletedPlanCall | null> {
    const completed = await this.executor.completed(call)
    if (completed !== null) await this.#record(completed)
    return completed
  }

  async history(conversation: string): Promise<readonly RecordedCall[]> {
    const history = await this.executor.history(conversation)
    for (const recorded of history) {
      if (recorded.completion !== null) await this.#record(recorded.completion)
    }
    return history
  }

  descriptorOf(call: StartedPlanCall): Promise<Descriptor> {
    return this.executor.descriptorOf(call)
  }

  deadlineOf(call: StartedPlanCall): Promise<number> {
    return this.executor.deadlineOf(call)
  }

  owns(call: StartedPlanCall): boolean {
    return this.executor.owns(call)
  }

  async #record(completed: CompletedPlanCall): Promise<void> {
    await this.store.record(await this.reader.read(completed))
  }
}
