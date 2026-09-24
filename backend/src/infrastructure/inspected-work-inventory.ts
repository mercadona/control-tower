import { WorkInventory } from '../domain/ports/work-inventory.ts'
import { PlanRecoveryConflict, WorkNotFound, WorkNotRead, WorkNotUnderstood } from '../domain/exceptions.ts'
import { TrackedWork } from '../domain/value-objects/tracked-work.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { ActivePlans, ActivePlanInspecting } from './active-plans-route.ts'

export class InspectedWorkInventory extends WorkInventory {
  readonly inspection: ActivePlanInspecting
  readonly plans: ActivePlans

  constructor({ inspection, plans }: { inspection: ActivePlanInspecting, plans: ActivePlans }) {
    super()
    this.inspection = inspection
    this.plans = plans
  }

  async find(issue: number, repository: RepositoryName): Promise<TrackedWork> {
    let diagnostic: string | null
    try {
      diagnostic = await this.inspection.inspect()
    } catch (cause) {
      if (!(cause instanceof PlanRecoveryConflict)) throw cause
      throw new WorkNotUnderstood(cause.message)
    }
    if (diagnostic !== null) throw new WorkNotRead(diagnostic)
    const found = this.plans.find({ issue, repository })
    if (found === null) throw new WorkNotFound(`no recorded work for ${repository.text}#${issue}`)
    if (found.watch.located.root === undefined) throw new WorkNotUnderstood('recorded work has no checkout root')
    switch (found.phase) {
      case 'planning':
        return new TrackedWork(found.watch, { phase: 'planning' })
      case 'implementing':
        return new TrackedWork(found.watch, { phase: 'implementing', acceptsChange: found.acceptsChange })
      case 'uncertain':
        return new TrackedWork(found.watch, {
          phase: 'uncertain', diagnostic: found.diagnostic ?? found.recovery.detail,
          recovery: found.recovery, refusal: found.refusal,
          execution: found.execution,
        })
    }
  }
}
