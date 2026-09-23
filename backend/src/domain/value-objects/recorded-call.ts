import type {
  CompletedPlanCall,
  PlanCallPurpose,
  StartedPlanCall,
} from './plan-call.ts'

export class RecordedCall {
  readonly call: StartedPlanCall
  readonly purpose: PlanCallPurpose
  readonly startedAt: string
  readonly completion: CompletedPlanCall | null

  constructor(asked: {
    call: StartedPlanCall,
    purpose: PlanCallPurpose,
    startedAt: string,
    completion: CompletedPlanCall | null,
  }) {
    this.call = asked.call
    this.purpose = asked.purpose
    this.startedAt = asked.startedAt
    this.completion = asked.completion
    Object.freeze(this)
  }
}
