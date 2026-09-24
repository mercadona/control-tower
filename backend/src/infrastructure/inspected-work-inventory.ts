import { WorkInventory } from '../domain/ports/work-inventory.ts'
import type { PlanRecords } from '../domain/ports/plan-records.ts'
import type { RunDelivery } from '../domain/ports/run-delivery.ts'
import {
  PlanAgentFailure, PlanRecoveryConflict, WorkNotFound, WorkNotRead, WorkNotUnderstood,
} from '../domain/exceptions.ts'
import { RunDeliveryFailure } from '../domain/value-objects/run-delivery.ts'
import { TrackedWork } from '../domain/value-objects/tracked-work.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { ActivePlans, ActivePlanInspecting } from './active-plans-route.ts'

export class InspectedWorkInventory extends WorkInventory {
  readonly inspection: ActivePlanInspecting
  readonly plans: ActivePlans
  readonly records: PlanRecords
  readonly delivery: RunDelivery

  constructor({ inspection, plans, records, delivery }: {
    inspection: ActivePlanInspecting,
    plans: ActivePlans,
    records: PlanRecords,
    delivery: RunDelivery,
  }) {
    super()
    this.inspection = inspection
    this.plans = plans
    this.records = records
    this.delivery = delivery
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
    if (found === null) return this.#finished(issue, repository)
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

  async #finished(issue: number, repository: RepositoryName): Promise<TrackedWork> {
    try {
      const harvested = await this.records.harvested({ issue, repository })
      if (harvested === null) throw new WorkNotFound(`no recorded work for ${repository.text}#${issue}`)
      return new TrackedWork(harvested.watch, {
        phase: 'finished',
        harvestedAt: harvested.harvestedAt,
        pullRequest: await this.delivery.recordedPullRequest(harvested.watch),
      })
    } catch (cause) {
      if (cause instanceof PlanAgentFailure || cause instanceof RunDeliveryFailure) throw new WorkNotRead(cause.message)
      throw cause
    }
  }
}
