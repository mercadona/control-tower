import type { PlanWatch } from '../value-objects/plan-watch.ts'
import type { PlanningActivity } from '../value-objects/planning-activity.ts'

export class PlanningActivities {
  async of(watch: PlanWatch): Promise<PlanningActivity> {
    throw new Error(`${this.constructor.name} must implement of(watch), asked for ${watch?.agent}`)
  }
}
