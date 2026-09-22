import type { PlanningActivities } from '../../domain/ports/planning-activity.ts'
import type { PlanningActivity } from '../../domain/value-objects/planning-activity.ts'
import type { PlanWatch } from '../../domain/value-objects/plan-watch.ts'

export class ReadPlanningActivityParams {
  readonly watch: PlanWatch

  constructor({ watch }: { watch: PlanWatch }) {
    this.watch = watch
    Object.freeze(this)
  }
}

class ReadPlanningActivityResult {
  readonly activity: PlanningActivity

  constructor({ activity }: { activity: PlanningActivity }) {
    this.activity = activity
    Object.freeze(this)
  }
}

export class ReadPlanningActivity {
  readonly planningActivities: PlanningActivities

  constructor({ planningActivities }: { planningActivities: PlanningActivities }) {
    this.planningActivities = planningActivities
  }

  async execute(params: ReadPlanningActivityParams): Promise<ReadPlanningActivityResult> {
    return new ReadPlanningActivityResult({ activity: await this.planningActivities.of(params.watch) })
  }
}
