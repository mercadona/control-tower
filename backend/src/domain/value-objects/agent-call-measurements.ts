import type { CompletedPlanCall, PlanCallPurpose } from './plan-call.ts'

export type AgentTokens = {
  readonly input: number | null,
  readonly output: number | null,
  readonly cacheRead: number | null,
  readonly cacheCreation: number | null,
}

export class AgentCallMeasurements {
  readonly provider: string
  readonly purpose: PlanCallPurpose
  readonly requestId: string | null
  readonly role: string | null
  readonly startedAt: string
  readonly completed: CompletedPlanCall
  readonly tokens: AgentTokens
  readonly models: readonly string[] | null
  readonly diagnostics: readonly string[]

  constructor(asked: {
    provider: string,
    purpose: PlanCallPurpose,
    requestId: string | null,
    role: string | null,
    startedAt: string,
    completed: CompletedPlanCall,
    tokens: AgentTokens,
    models: readonly string[] | null,
    diagnostics: readonly string[],
  }) {
    AgentCallMeasurements.#requireName('provider', asked.provider)
    if (asked.requestId !== null) AgentCallMeasurements.#requireName('requestId', asked.requestId)
    if (asked.role !== null) AgentCallMeasurements.#requireName('role', asked.role)
    AgentCallMeasurements.#requireName('startedAt', asked.startedAt)
    const startedAt = new Date(asked.startedAt)
    if (Number.isNaN(startedAt.getTime()) || startedAt.toISOString() !== asked.startedAt) {
      throw new TypeError(`startedAt must be an ISO timestamp, got ${JSON.stringify(asked.startedAt)}`)
    }
    for (const field of ['input', 'output', 'cacheRead', 'cacheCreation'] as const) {
      const value = asked.tokens[field]
      if (value !== null && (!Number.isInteger(value) || value < 0)) {
        throw new RangeError(`tokens.${field} must be a nonnegative integer or null, got ${String(value)}`)
      }
    }
    for (const model of asked.models ?? []) AgentCallMeasurements.#requireName('model', model)
    this.provider = asked.provider
    this.purpose = asked.purpose
    this.requestId = asked.requestId
    this.role = asked.role
    this.startedAt = asked.startedAt
    this.completed = asked.completed
    this.tokens = Object.freeze({ ...asked.tokens })
    this.models = asked.models === null ? null : Object.freeze([...asked.models])
    this.diagnostics = Object.freeze([...asked.diagnostics])
    Object.freeze(this)
  }

  static #requireName(field: string, value: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError(`${field} must be a nonempty string, got ${JSON.stringify(value)}`)
    }
  }
}
