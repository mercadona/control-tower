export type PlanCallPurpose = 'plan' | 'implementation' | 'fix'

export class StartedPlanCall {
  readonly conversation: string
  readonly id: string

  constructor(asked: { conversation: string, id: string }) {
    this.conversation = asked.conversation
    this.id = asked.id
    Object.freeze(this)
  }
}

export type CallCost =
  | {
    readonly kind: 'reported',
    readonly totalUsd: number,
    readonly attribution: 'initial-invocation' | 'unverified-resume',
  }
  | { readonly kind: 'unavailable', readonly reason: string }

export type CallMeasurement = {
  readonly cost: CallCost,
  readonly turns: number | null,
  readonly durationMs: number | null,
  readonly unavailable: readonly string[],
}

export type CallExecution = { readonly kind: 'success' }
  | { readonly kind: 'error' | 'unavailable', readonly diagnostic: string }

export class CompletedPlanCall {
  readonly call: StartedPlanCall
  readonly code: number | null
  readonly signal: string | null
  readonly finishedAt: string
  readonly wallDurationMs: number
  readonly execution: CallExecution
  readonly measurement: CallMeasurement

  constructor(asked: {
    call: StartedPlanCall,
    code: number | null,
    signal: string | null,
    finishedAt: string,
    wallDurationMs: number,
    execution: CallExecution,
    measurement: CallMeasurement,
  }) {
    CompletedPlanCall.#requireFiniteNonnegative('wallDurationMs', asked.wallDurationMs)
    CompletedPlanCall.#requireOptionalFiniteNonnegative('durationMs', asked.measurement.durationMs)
    CompletedPlanCall.#requireOptionalNonnegativeInteger('turns', asked.measurement.turns)
    if (asked.measurement.cost.kind === 'reported') {
      CompletedPlanCall.#requireFiniteNonnegative('totalUsd', asked.measurement.cost.totalUsd)
    }

    this.call = asked.call
    this.code = asked.code
    this.signal = asked.signal
    this.finishedAt = asked.finishedAt
    this.wallDurationMs = asked.wallDurationMs
    this.execution = Object.freeze({ ...asked.execution })
    this.measurement = Object.freeze({
      cost: Object.freeze({ ...asked.measurement.cost }),
      turns: asked.measurement.turns,
      durationMs: asked.measurement.durationMs,
      unavailable: Object.freeze([...asked.measurement.unavailable]),
    })
    Object.freeze(this)
  }

  get succeeded(): boolean {
    return this.code === 0 && this.execution.kind === 'success'
  }

  get attributableCostUsd(): number | null {
    if (this.measurement.cost.kind === 'unavailable') return null
    if (this.measurement.cost.attribution === 'unverified-resume') return null
    return this.measurement.cost.totalUsd
  }

  static #requireFiniteNonnegative(field: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${field} must be a finite nonnegative number, got ${String(value)}`)
    }
  }

  static #requireOptionalFiniteNonnegative(field: string, value: number | null): void {
    if (value !== null) CompletedPlanCall.#requireFiniteNonnegative(field, value)
  }

  static #requireOptionalNonnegativeInteger(field: string, value: number | null): void {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new RangeError(`${field} must be a nonnegative integer or null, got ${String(value)}`)
    }
  }
}
