import type { CompletedPlanCall, PlanCallPurpose, StartedPlanCall } from '../value-objects/plan-call.ts'
import type { PlanWatch } from '../value-objects/plan-watch.ts'

export class PlanCalls {
  async start(watch: PlanWatch, purpose: PlanCallPurpose, changes: string | null): Promise<StartedPlanCall> {
    throw new Error(
      `${this.constructor.name} must implement start(watch, purpose, changes), asked for ${purpose} on ${watch.issue.number} with ${changes}`
    )
  }

  async wait(call: StartedPlanCall): Promise<CompletedPlanCall> {
    throw new Error(`${this.constructor.name} must implement wait(call), asked for ${call.id}`)
  }
}
