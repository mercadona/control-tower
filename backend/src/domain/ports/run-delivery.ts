import type { PlanWatch } from '../value-objects/plan-watch.ts'
import type { RunDeliveryInspection } from '../value-objects/run-delivery.ts'

export abstract class RunDelivery {
  abstract deliver(watch: PlanWatch): Promise<void>
  abstract inspect(watch: PlanWatch): Promise<RunDeliveryInspection>
}
