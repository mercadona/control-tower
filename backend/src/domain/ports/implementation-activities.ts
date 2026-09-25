import type { ImplementationActivity } from '../value-objects/implementation-activity.ts'
import type { PlanWatch } from '../value-objects/plan-watch.ts'

export abstract class ImplementationActivities {
  abstract of(watch: PlanWatch): Promise<ImplementationActivity | null>
}
