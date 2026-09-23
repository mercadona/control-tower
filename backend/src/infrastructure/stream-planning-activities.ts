import { join } from 'node:path'
import { PlanAgentNotResumed, PlanningActivityNotRead } from '../domain/exceptions.ts'
import { PlanningActivities } from '../domain/ports/planning-activity.ts'
import { PlanningActivity, PlanningActivityState, PlanningToolCall } from '../domain/value-objects/planning-activity.ts'
import type { PlanningActivityStateValue } from '../domain/value-objects/planning-activity.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import { CallDescriptor } from './claude-calls.ts'
import type { ClaudePlanCalls } from './claude-plan-calls.ts'
import type { HeadlessFiles } from './headless-files.ts'
import type { RecordedCall } from '../domain/value-objects/recorded-call.ts'

type StreamCursor = {
  consumedChars: number,
  toolCalls: number,
  lastToolCall: PlanningToolCall | null,
  lastText: string | null,
}

class StreamCursors {
  static empty(): StreamCursor {
    return { consumedChars: 0, toolCalls: 0, lastToolCall: null, lastText: null }
  }

  static reset(cursor: StreamCursor): void {
    cursor.consumedChars = 0
    cursor.toolCalls = 0
    cursor.lastToolCall = null
    cursor.lastText = null
  }
}

class Truncation {
  static of(text: string): string {
    if (text.length <= PlanningToolCall.MAX_ARGUMENT_LENGTH) return text
    return `${text.slice(0, PlanningToolCall.MAX_ARGUMENT_LENGTH)}${PlanningToolCall.TRUNCATION_MARK}`
  }
}

class MainArgument {
  static readonly #PREFERRED_KEYS: readonly string[] = Object.freeze([
    'file_path', 'path', 'notebook_path', 'command', 'pattern', 'query', 'url', 'prompt',
  ])

  static of(input: unknown): string | null {
    if (input === null || typeof input !== 'object') return null
    const record = input as Record<string, unknown>
    for (const key of MainArgument.#PREFERRED_KEYS) {
      const found = MainArgument.#stringValue(record[key])
      if (found !== null) return Truncation.of(found)
    }
    for (const value of Object.values(record)) {
      const found = MainArgument.#stringValue(value)
      if (found !== null) return Truncation.of(found)
    }
    return null
  }

  static #stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
  }
}

class StreamLine {
  static apply(cursor: StreamCursor, raw: string): void {
    const trimmed = raw.trim()
    if (trimmed.length === 0) return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }
    if (parsed === null || typeof parsed !== 'object') return
    const line = parsed as Record<string, unknown>
    if (line.type !== 'assistant') return
    const message = line.message as Record<string, unknown> | undefined
    const content = message?.content
    if (!Array.isArray(content)) return
    for (const block of content) StreamLine.#applyBlock(cursor, block as Record<string, unknown>)
  }

  static #applyBlock(cursor: StreamCursor, block: Record<string, unknown>): void {
    if (block.type === 'text' && typeof block.text === 'string') {
      cursor.lastText = Truncation.of(block.text)
      return
    }
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      cursor.toolCalls += 1
      cursor.lastToolCall = new PlanningToolCall({ name: block.name, argument: MainArgument.of(block.input) })
    }
  }
}

export class StreamPlanningActivities extends PlanningActivities {
  readonly planCalls: ClaudePlanCalls
  readonly files: HeadlessFiles
  readonly nowMs: () => number
  readonly #cursors: Map<string, StreamCursor>

  constructor(ports: { planCalls: ClaudePlanCalls, files: HeadlessFiles, nowMs: () => number }) {
    super()
    this.planCalls = ports.planCalls
    this.files = ports.files
    this.nowMs = ports.nowMs
    this.#cursors = new Map()
  }

  async of(watch: PlanWatch): Promise<PlanningActivity> {
    const record = await this.#recordFor(watch)
    const key = StreamPlanningActivities.#keyFor(record)
    const completion = record.completion
    const cursor = await this.#advanced(key, record, completion !== null)
    if (completion !== null) {
      return StreamPlanningActivities.#activityFrom(PlanningActivityState.FINISHED, completion.wallDurationMs, cursor)
    }
    return StreamPlanningActivities.#activityFrom(
      PlanningActivityState.RUNNING, this.nowMs() - Date.parse(record.startedAt), cursor
    )
  }

  async #recordFor(watch: PlanWatch): Promise<RecordedCall> {
    try {
      return await this.planCalls.planningRecordFor(watch)
    } catch (cause) {
      if (cause instanceof PlanAgentNotResumed) throw new PlanningActivityNotRead(cause.message)
      throw cause
    }
  }

  async #advanced(key: string, record: RecordedCall, finished: boolean): Promise<StreamCursor> {
    const path = join(this.files.callDirectory(record.call), CallDescriptor.STREAM)
    const text = await this.#read(path)
    const cursor = this.#cursors.get(key) ?? StreamCursors.empty()
    if (text === null) {
      this.#cursors.set(key, cursor)
      return cursor
    }
    if (text.length < cursor.consumedChars) StreamCursors.reset(cursor)
    const unread = text.slice(cursor.consumedChars)
    const consumable = finished ? unread.length : StreamPlanningActivities.#completeLinesLength(unread)
    if (consumable > 0) {
      for (const line of unread.slice(0, consumable).split('\n')) StreamLine.apply(cursor, line)
      cursor.consumedChars += consumable
    }
    this.#cursors.set(key, cursor)
    return cursor
  }

  static #completeLinesLength(unread: string): number {
    const lastNewline = unread.lastIndexOf('\n')
    return lastNewline === -1 ? 0 : lastNewline + 1
  }

  async #read(path: string): Promise<string | null> {
    try {
      return await this.files.read(path)
    } catch (cause) {
      throw new PlanningActivityNotRead(cause instanceof Error ? cause.message : String(cause))
    }
  }

  static #keyFor(record: RecordedCall): string {
    return `${record.call.conversation}/${record.call.id}`
  }

  static #activityFrom(state: PlanningActivityStateValue, runningMs: number, cursor: StreamCursor): PlanningActivity {
    return new PlanningActivity({
      state,
      runningMs,
      toolCalls: cursor.toolCalls,
      lastToolCall: cursor.lastToolCall,
      lastText: cursor.lastText,
    })
  }
}
