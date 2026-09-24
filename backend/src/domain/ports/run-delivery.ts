import type { PlanWatch } from '../value-objects/plan-watch.ts'
import type { DeliveredPullRequest, RunDeliveryInspection } from '../value-objects/run-delivery.ts'

export abstract class RunDelivery {
  abstract deliver(watch: PlanWatch): Promise<void>
  abstract inspect(watch: PlanWatch): Promise<RunDeliveryInspection>

  async recordedPullRequest(watch: PlanWatch): Promise<DeliveredPullRequest | null> {
    throw new Error(`${this.constructor.name} must implement recordedPullRequest(watch), asked for ${watch.agent}`)
  }
}
