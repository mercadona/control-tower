import type { AgentTokens } from '../domain/value-objects/agent-call-measurements.ts'
import type { CallExecution, CallMeasurement } from '../domain/value-objects/plan-call.ts'

type JsonRecord = Record<string, unknown>
type ResultSubtype = { readonly kind: 'success' }
  | { readonly kind: 'error', readonly name: string }
  | { readonly kind: 'unavailable', readonly reported: string | null }
type ResultReading = { readonly kind: 'invalid', readonly diagnostic: string }
  | { readonly kind: 'result', readonly result: ClaudeResultEnvelope }

class MeasuredNumber {
  readonly value: number | null
  readonly diagnostic: string | null

  private constructor(value: number | null, diagnostic: string | null) {
    this.value = value
    this.diagnostic = diagnostic
    Object.freeze(this)
  }

  static finiteNonnegative(field: string, value: unknown): MeasuredNumber {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? new MeasuredNumber(value, null)
      : new MeasuredNumber(null, `${field} was not a finite nonnegative number`)
  }

  static nonnegativeInteger(field: string, value: unknown): MeasuredNumber {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? new MeasuredNumber(value, null)
      : new MeasuredNumber(null, `${field} was not a nonnegative integer`)
  }
}

export class ClaudeResultEnvelope {
  static readonly UNKNOWN_TOKENS: AgentTokens = Object.freeze({
    input: null, output: null, cacheRead: null, cacheCreation: null,
  })

  readonly tokens: AgentTokens
  readonly models: readonly string[] | null
  readonly usageDiagnostics: readonly string[]
  readonly #subtype: ResultSubtype
  readonly #isError: boolean | null
  readonly #cost: MeasuredNumber
  readonly #turns: MeasuredNumber
  readonly #duration: MeasuredNumber

  private constructor(payload: JsonRecord) {
    this.#subtype = ClaudeResultEnvelope.#readSubtype(payload.subtype)
    this.#isError = typeof payload.is_error === 'boolean' ? payload.is_error : null
    this.#cost = MeasuredNumber.finiteNonnegative('total_cost_usd', payload.total_cost_usd)
    this.#turns = MeasuredNumber.nonnegativeInteger('num_turns', payload.num_turns)
    this.#duration = MeasuredNumber.finiteNonnegative('duration_ms', payload.duration_ms)
    const diagnostics: string[] = []
    this.tokens = ClaudeResultEnvelope.#tokens(payload.usage, diagnostics)
    this.models = ClaudeResultEnvelope.#models(payload.modelUsage, diagnostics)
    this.usageDiagnostics = Object.freeze(diagnostics)
    Object.freeze(this)
  }

  static read(stream: string, conversation: string): ResultReading {
    let result: JsonRecord | null = null
    let identity: string | null = null
    for (const line of stream.split('\n').filter((line) => line.length > 0)) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return { kind: 'invalid', diagnostic: 'Claude stream ended with malformed JSON' }
      }
      if (!ClaudeResultEnvelope.#isRecord(parsed) || parsed.type !== 'result') continue
      if (typeof parsed.session_id !== 'string') {
        return { kind: 'invalid', diagnostic: 'Claude result did not carry a readable session identity' }
      }
      if (parsed.session_id !== conversation) {
        return { kind: 'invalid', diagnostic: 'Claude reported a result for another conversation' }
      }
      const current = JSON.stringify(parsed)
      if (identity !== null && current !== identity) {
        return { kind: 'invalid', diagnostic: 'Claude reported conflicting results' }
      }
      identity = current
      result = parsed
    }
    return result === null
      ? { kind: 'invalid', diagnostic: 'Claude did not report a result' }
      : { kind: 'result', result: new ClaudeResultEnvelope(result) }
  }

  measurement(mode: 'initial' | 'resume'): CallMeasurement {
    return {
      cost: this.#cost.value === null
        ? { kind: 'unavailable', reason: this.#cost.diagnostic ?? 'Claude did not report total_cost_usd' }
        : {
          kind: 'reported', totalUsd: this.#cost.value,
          attribution: mode === 'initial' ? 'initial-invocation' : 'unverified-resume',
        },
      turns: this.#turns.value,
      durationMs: this.#duration.value,
      unavailable: [this.#cost, this.#turns, this.#duration]
        .flatMap((measurement) => measurement.diagnostic === null ? [] : [measurement.diagnostic]),
    }
  }

  execution(code: number | null): CallExecution {
    if (this.#isError === null) {
      return { kind: 'unavailable', diagnostic: 'Claude result did not carry a boolean is_error' }
    }
    switch (this.#subtype.kind) {
      case 'error':
        return { kind: 'error', diagnostic: `Claude reported ${this.#subtype.name}` }
      case 'unavailable':
        return {
          kind: 'unavailable',
          diagnostic: this.#subtype.reported === null
            ? 'Claude result subtype was absent'
            : `Claude result subtype was unknown: ${this.#subtype.reported}`,
        }
      case 'success':
        if (this.#isError) return { kind: 'error', diagnostic: 'Claude success result reported is_error true' }
        if (code === null) return { kind: 'unavailable', diagnostic: 'Claude process exit was unavailable' }
        if (code !== 0) return { kind: 'error', diagnostic: `Claude process exited with code ${code}` }
        return { kind: 'success' }
    }
  }

  static #readSubtype(value: unknown): ResultSubtype {
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

  static #tokens(value: unknown, diagnostics: string[]): AgentTokens {
    if (value === undefined || value === null) return ClaudeResultEnvelope.UNKNOWN_TOKENS
    if (!ClaudeResultEnvelope.#isRecord(value)) {
      diagnostics.push('usage must be a usage object')
      return ClaudeResultEnvelope.UNKNOWN_TOKENS
    }
    return Object.freeze({
      input: ClaudeResultEnvelope.#token(value, 'input_tokens', diagnostics),
      output: ClaudeResultEnvelope.#token(value, 'output_tokens', diagnostics),
      cacheRead: ClaudeResultEnvelope.#token(value, 'cache_read_input_tokens', diagnostics),
      cacheCreation: ClaudeResultEnvelope.#token(value, 'cache_creation_input_tokens', diagnostics),
    })
  }

  static #token(usage: JsonRecord, field: string, diagnostics: string[]): number | null {
    if (!Object.hasOwn(usage, field)) return null
    const measured = MeasuredNumber.nonnegativeInteger(`/usage/${field}`, usage[field])
    if (measured.diagnostic !== null) diagnostics.push(measured.diagnostic)
    return measured.value
  }

  static #models(value: unknown, diagnostics: string[]): readonly string[] | null {
    if (value === undefined || value === null) return null
    if (!ClaudeResultEnvelope.#isRecord(value)
      || Object.entries(value).some(([name, usage]) => name.trim().length === 0 || !ClaudeResultEnvelope.#isRecord(usage))) {
      diagnostics.push('modelUsage must map nonempty model names to usage objects')
      return null
    }
    return Object.freeze(Object.keys(value).sort())
  }

  static #isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
}
