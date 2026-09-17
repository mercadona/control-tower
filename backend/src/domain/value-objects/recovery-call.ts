import type { CompletedPlanCall, PlanCallPurpose, StartedPlanCall } from './plan-call.ts'

export class RecoveryCall {
  readonly call: StartedPlanCall
  readonly purpose: PlanCallPurpose
  readonly startedAt: string
  readonly deadlineMs: number
  readonly completion: CompletedPlanCall | null

  constructor(asked: {
    call: StartedPlanCall,
    purpose: PlanCallPurpose,
    startedAt: string,
    deadlineMs: number,
    completion: CompletedPlanCall | null,
  }) {
    if (Number.isNaN(Date.parse(asked.startedAt))) throw new TypeError(`invalid recovery start time ${asked.startedAt}`)
    if (!Number.isFinite(asked.deadlineMs)) throw new TypeError(`invalid recovery deadline ${String(asked.deadlineMs)}`)
    this.call = asked.call
    this.purpose = asked.purpose
    this.startedAt = asked.startedAt
    this.deadlineMs = asked.deadlineMs
    this.completion = asked.completion
    Object.freeze(this)
  }
}
