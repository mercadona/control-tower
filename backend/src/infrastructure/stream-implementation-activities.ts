import { join } from 'node:path'
import { ImplementationActivityNotRead } from '../domain/exceptions.ts'
import { ImplementationActivities } from '../domain/ports/implementation-activities.ts'
import { ImplementationActivity } from '../domain/value-objects/implementation-activity.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { RecordedCall } from '../domain/value-objects/recorded-call.ts'
import type { AgentCalls } from '../domain/ports/agent-calls.ts'
import { CallDescriptor, type CallInvocation } from './claude-calls.ts'
import type { HeadlessFiles } from './headless-files.ts'
import { StreamCursors, StreamLine } from './stream-planning-activities.ts'

export class StreamImplementationActivities extends ImplementationActivities {
  readonly calls: AgentCalls<CallInvocation, CallDescriptor>
  readonly files: HeadlessFiles

  constructor(ports: { calls: AgentCalls<CallInvocation, CallDescriptor>, files: HeadlessFiles }) {
    super()
    this.calls = ports.calls
    this.files = ports.files
  }

  override async of(watch: PlanWatch): Promise<ImplementationActivity | null> {
    const record = StreamImplementationActivities.#latestImplementationOf(await this.calls.history(watch.agent))
    if (record === null) return null
    const path = join(this.files.callDirectory(record.call), CallDescriptor.STREAM)
    const text = await this.#read(path)
    if (text === null) {
      return new ImplementationActivity({ startedAt: record.startedAt, lastToolCall: null, lastText: null })
    }
    const cursor = StreamCursors.empty()
    for (const line of text.split('\n')) StreamLine.apply(cursor, line)

    return new ImplementationActivity({
      startedAt: record.startedAt, lastToolCall: cursor.lastToolCall, lastText: cursor.lastText,
    })
  }

  async #read(path: string): Promise<string | null> {
    try {
      return await this.files.read(path)
    } catch (cause) {
      throw new ImplementationActivityNotRead(cause instanceof Error ? cause.message : String(cause))
    }
  }

  static #latestImplementationOf(history: readonly RecordedCall[]): RecordedCall | null {
    const implementations = history.filter((recorded) => recorded.purpose === 'implementation')
    if (implementations.length === 0) return null

    return implementations.reduce((latest, candidate) =>
      Date.parse(candidate.startedAt) > Date.parse(latest.startedAt) ? candidate : latest)
  }
}
