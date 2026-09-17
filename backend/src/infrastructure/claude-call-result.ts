import {
  CompletedPlanCall,
  type CallExecution,
  type StartedPlanCall,
} from '../domain/value-objects/plan-call.ts'

type KnownErrorSubtype = 'error_during_execution'
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries'

type ResultSubtype = { readonly kind: 'success' }
  | { readonly kind: 'error', readonly name: KnownErrorSubtype }
  | { readonly kind: 'unavailable', readonly reported: string | null }

type LineReading = { readonly kind: 'ignored' }
  | { readonly kind: 'invalid', readonly diagnostic: string }
  | { readonly kind: 'result', readonly result: ClaudeResultEnvelope }

type MeasuredNumberOutcome = { readonly kind: 'measured', readonly value: number }
  | { readonly kind: 'unavailable', readonly diagnostic: string }

class MeasuredNumber {
  readonly outcome: MeasuredNumberOutcome

  private constructor(outcome: MeasuredNumberOutcome) {
    this.outcome = Object.freeze({ ...outcome })
    Object.freeze(this)
  }

  get value(): number | null {
    switch (this.outcome.kind) {
      case 'measured':
        return this.outcome.value
      case 'unavailable':
        return null
    }
  }

  get diagnostic(): string | null {
    switch (this.outcome.kind) {
      case 'measured':
        return null
      case 'unavailable':
        return this.outcome.diagnostic
    }
  }

  static finiteNonnegative(field: string, value: unknown): MeasuredNumber {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return new MeasuredNumber({ kind: 'measured', value })
    }
    return new MeasuredNumber({ kind: 'unavailable', diagnostic: `${field} was not a finite nonnegative number` })
  }

  static nonnegativeInteger(field: string, value: unknown): MeasuredNumber {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return new MeasuredNumber({ kind: 'measured', value })
    }
    return new MeasuredNumber({ kind: 'unavailable', diagnostic: `${field} was not a nonnegative integer` })
  }
}

class ClaudeResultEnvelope {
  readonly identity: string
  readonly sessionId: string
  readonly subtype: ResultSubtype
  readonly isError: boolean | null
  readonly cost: MeasuredNumber
  readonly turns: MeasuredNumber
  readonly duration: MeasuredNumber

  constructor(asked: {
    identity: string,
    sessionId: string,
    subtype: ResultSubtype,
    isError: boolean | null,
    cost: MeasuredNumber,
    turns: MeasuredNumber,
    duration: MeasuredNumber,
  }) {
    this.identity = asked.identity
    this.sessionId = asked.sessionId
    this.subtype = Object.freeze({ ...asked.subtype })
    this.isError = asked.isError
    this.cost = asked.cost
    this.turns = asked.turns
    this.duration = asked.duration
    Object.freeze(this)
  }

  static read(line: string): LineReading {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return { kind: 'invalid', diagnostic: 'Claude stream ended with malformed JSON' }
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'ignored' }
    if (!('type' in parsed) || parsed.type !== 'result') return { kind: 'ignored' }
    if (!('session_id' in parsed) || typeof parsed.session_id !== 'string') {
      return { kind: 'invalid', diagnostic: 'Claude result did not carry a readable session identity' }
    }

    return {
      kind: 'result',
      result: new ClaudeResultEnvelope({
        identity: JSON.stringify(parsed),
        sessionId: parsed.session_id,
        subtype: ClaudeResultEnvelope.#subtype('subtype' in parsed ? parsed.subtype : undefined),
        isError: 'is_error' in parsed && typeof parsed.is_error === 'boolean' ? parsed.is_error : null,
        cost: MeasuredNumber.finiteNonnegative(
          'total_cost_usd', 'total_cost_usd' in parsed ? parsed.total_cost_usd : undefined,
        ),
        turns: MeasuredNumber.nonnegativeInteger('num_turns', 'num_turns' in parsed ? parsed.num_turns : undefined),
        duration: MeasuredNumber.finiteNonnegative(
          'duration_ms', 'duration_ms' in parsed ? parsed.duration_ms : undefined,
        ),
      }),
    }
  }

  static #subtype(value: unknown): ResultSubtype {
    switch (value) {
      case 'success':
        return { kind: 'success' }
      case 'error_during_execution':
      case 'error_max_turns':
      case 'error_max_budget_usd':
      case 'error_max_structured_output_retries':
        return { kind: 'error', name: value }
      default:
        return { kind: 'unavailable', reported: typeof value === 'string' ? value : null }
    }
  }
}

export class ClaudeCallResult {
  static async read(asked: {
    lines: AsyncIterable<string>,
    call: StartedPlanCall,
    code: number | null,
    signal: string | null,
    finishedAt: string,
    wallDurationMs: number,
    mode: 'initial' | 'resume',
  }): Promise<CompletedPlanCall> {
    let stream = ''
    for await (const chunk of asked.lines) stream += chunk

    const readings = stream.split('\n').filter((line) => line.length > 0).map((line) => ClaudeResultEnvelope.read(line))
    const invalid = readings.find((reading) => reading.kind === 'invalid')
    if (invalid?.kind === 'invalid') return ClaudeCallResult.#unavailable(asked, invalid.diagnostic)

    const results = readings.flatMap((reading) => reading.kind === 'result' ? [reading.result] : [])
    if (results.length === 0) return ClaudeCallResult.#unavailable(asked, 'Claude did not report a result')
    if (results.some((result) => result.sessionId !== asked.call.conversation)) {
      return ClaudeCallResult.#unavailable(asked, 'Claude reported a result for another conversation')
    }

    const unique = new Map(results.map((result) => [result.identity, result]))
    if (unique.size !== 1) return ClaudeCallResult.#unavailable(asked, 'Claude reported conflicting results')

    return ClaudeCallResult.#completed(asked, results[0])
  }

  static #completed(asked: {
    call: StartedPlanCall,
    code: number | null,
    signal: string | null,
    finishedAt: string,
    wallDurationMs: number,
    mode: 'initial' | 'resume',
  }, result: ClaudeResultEnvelope): CompletedPlanCall {
    const unavailable = [result.cost, result.turns, result.duration]
      .flatMap((measurement) => measurement.diagnostic === null ? [] : [measurement.diagnostic])

    return new CompletedPlanCall({
      call: asked.call,
      code: asked.code,
      signal: asked.signal,
      finishedAt: asked.finishedAt,
      wallDurationMs: asked.wallDurationMs,
      execution: ClaudeCallResult.#execution(result, asked.code),
      measurement: {
        cost: result.cost.value === null
          ? { kind: 'unavailable', reason: result.cost.diagnostic ?? 'Claude did not report total_cost_usd' }
          : {
            kind: 'reported',
            totalUsd: result.cost.value,
            attribution: asked.mode === 'initial' ? 'initial-invocation' : 'unverified-resume',
          },
        turns: result.turns.value,
        durationMs: result.duration.value,
        unavailable,
      },
    })
  }

  static #execution(result: ClaudeResultEnvelope, code: number | null): CallExecution {
    if (result.isError === null) {
      return { kind: 'unavailable', diagnostic: 'Claude result did not carry a boolean is_error' }
    }

    switch (result.subtype.kind) {
      case 'error':
        return { kind: 'error', diagnostic: `Claude reported ${result.subtype.name}` }
      case 'unavailable':
        return {
          kind: 'unavailable',
          diagnostic: result.subtype.reported === null
            ? 'Claude result subtype was absent'
            : `Claude result subtype was unknown: ${result.subtype.reported}`,
        }
      case 'success':
        if (result.isError) return { kind: 'error', diagnostic: 'Claude success result reported is_error true' }
        if (code === null) return { kind: 'unavailable', diagnostic: 'Claude process exit was unavailable' }
        if (code !== 0) return { kind: 'error', diagnostic: `Claude process exited with code ${code}` }
        return { kind: 'success' }
    }
  }

  static #unavailable(asked: {
    call: StartedPlanCall,
    code: number | null,
    signal: string | null,
    finishedAt: string,
    wallDurationMs: number,
  }, diagnostic: string): CompletedPlanCall {
    return new CompletedPlanCall({
      call: asked.call,
      code: asked.code,
      signal: asked.signal,
      finishedAt: asked.finishedAt,
      wallDurationMs: asked.wallDurationMs,
      execution: { kind: 'unavailable', diagnostic },
      measurement: {
        cost: { kind: 'unavailable', reason: diagnostic },
        turns: null,
        durationMs: null,
        unavailable: [diagnostic],
      },
    })
  }
}
