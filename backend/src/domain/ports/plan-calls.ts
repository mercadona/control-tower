import type { CompletedPlanCall, PlanCallPurpose, StartedPlanCall } from '../value-objects/plan-call.ts'
import type { PlanWatch } from '../value-objects/plan-watch.ts'

export class PlanCalls {
  async planningFor(watch: PlanWatch): Promise<StartedPlanCall> {
    throw new Error(`${this.constructor.name} must implement planningFor(watch), asked for ${watch.agent}`)
  }

  async implementationFor(watch: PlanWatch): Promise<StartedPlanCall | null> {
    throw new Error(`${this.constructor.name} must implement implementationFor(watch), asked for ${watch.agent}`)
  }

  async start(
    watch: PlanWatch,
    purpose: PlanCallPurpose,
    changes: string | null,
    requestId?: string,
  ): Promise<StartedPlanCall> {
    throw new Error(
      `${this.constructor.name} must implement start(watch, purpose, changes, requestId), `
      + `asked for ${purpose} on ${watch.issue.number} with ${changes} as ${String(requestId)}`
    )
  }

  async wait(call: StartedPlanCall): Promise<CompletedPlanCall> {
    throw new Error(`${this.constructor.name} must implement wait(call), asked for ${call.id}`)
  }
}
