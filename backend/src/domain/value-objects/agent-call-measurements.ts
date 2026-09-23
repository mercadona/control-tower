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
}
