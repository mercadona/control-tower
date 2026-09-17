import type { PlanWatch } from '../value-objects/plan-watch.ts'

export class PlanPublication {
  async publish(watch: PlanWatch): Promise<void> {
    throw new Error(`${this.constructor.name} must implement publish(watch), asked for ${watch.issue.number}`)
  }
}
