export const PlanningActivityState = Object.freeze({
  RUNNING: 'running',
  FINISHED: 'finished',
} as const)

export type PlanningActivityStateValue = (typeof PlanningActivityState)[keyof typeof PlanningActivityState]

export class PlanningToolCall {
  static readonly MAX_ARGUMENT_LENGTH = 200
  static readonly TRUNCATION_MARK = '…'
  static readonly #MAX_STORED_LENGTH = PlanningToolCall.MAX_ARGUMENT_LENGTH + PlanningToolCall.TRUNCATION_MARK.length

  readonly name: string
  readonly argument: string | null

  constructor({ name, argument }: { name: string, argument: string | null }) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new RangeError(`a planning tool call names its tool, got ${JSON.stringify(name)}`)
    }
    if (argument !== null && (
      typeof argument !== 'string'
      || argument.length === 0
      || argument.length > PlanningToolCall.#MAX_STORED_LENGTH
    )) {
      throw new RangeError(
        `a planning tool call argument is null or 1-${PlanningToolCall.#MAX_STORED_LENGTH} characters, `
        + `got ${JSON.stringify(argument)}`
      )
    }
    this.name = name
    this.argument = argument
    Object.freeze(this)
  }
}

type PlanningActivityFields = {
  state: PlanningActivityStateValue,
  runningMs: number,
  toolCalls: number,
  lastToolCall: PlanningToolCall | null,
  lastText: string | null,
}

export class PlanningActivity {
  static readonly MAX_TEXT_LENGTH = 200

  readonly state: PlanningActivityStateValue
  readonly runningMs: number
  readonly toolCalls: number
  readonly lastToolCall: PlanningToolCall | null
  readonly lastText: string | null

  constructor({ state, runningMs, toolCalls, lastToolCall, lastText }: PlanningActivityFields) {
    if (!Number.isFinite(runningMs) || runningMs < 0) {
      throw new RangeError(`runningMs must be a finite nonnegative number, got ${String(runningMs)}`)
    }
    if (!Number.isInteger(toolCalls) || toolCalls < 0) {
      throw new RangeError(`toolCalls must be a nonnegative integer, got ${String(toolCalls)}`)
    }
    this.state = state
    this.runningMs = runningMs
    this.toolCalls = toolCalls
    this.lastToolCall = lastToolCall
    this.lastText = lastText
    Object.freeze(this)
  }
}
