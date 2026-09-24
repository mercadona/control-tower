import { PlanFailure } from '../../domain/exceptions.ts'
import type { WorkInventory } from '../../domain/ports/work-inventory.ts'
import type { PlanProgress } from '../../domain/ports/plan-progress.ts'
import type { PlanningActivities } from '../../domain/ports/planning-activity.ts'
import { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import { WorkProgress, type WorkReading, type WorkExecutionReading } from '../../domain/value-objects/work-progress.ts'
import { ReadImplementationProgress, ReadImplementationProgressParams } from './read-implementation-progress.ts'

export class ReadWorkProgressParams {
  readonly issue: number
  readonly repository: RepositoryName

  constructor(issue: number, repository: RepositoryName) {
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

export class ReadWorkProgressResult {
  readonly progress: WorkProgress

  constructor(progress: WorkProgress) {
    this.progress = progress
    Object.freeze(this)
  }
}

export class ReadWorkProgress {
  readonly inventory: WorkInventory
  readonly plans: PlanProgress
  readonly activities: PlanningActivities
  readonly implementation: Pick<ReadImplementationProgress, 'execute'>

  constructor({ inventory, plans, activities, implementation }: {
    inventory: WorkInventory,
    plans: PlanProgress,
    activities: PlanningActivities,
    implementation: Pick<ReadImplementationProgress, 'execute'>,
  }) {
    this.inventory = inventory
    this.plans = plans
    this.activities = activities
    this.implementation = implementation
  }

  async execute(params: ReadWorkProgressParams): Promise<ReadWorkProgressResult> {
    const work = await this.inventory.find(params.issue, params.repository)
    const watch = work.watch
    switch (work.condition.phase) {
      case 'planning': {
        const [plan, activity] = await Promise.all([
          ReadWorkProgress.#read(() => this.plans.of({ located: watch.located, issue: watch.issue, repository: watch.repository })),
          ReadWorkProgress.#read(() => this.activities.of(watch)),
        ])
        return new ReadWorkProgressResult(new WorkProgress(watch, { phase: 'planning', plan, activity }))
      }
      case 'implementing': {
        let execution: WorkExecutionReading
        try {
          const result = await this.implementation.execute(new ReadImplementationProgressParams({
            root: new CheckoutRoot(watch.located.root), issue: watch.issue.number, repository: watch.repository,
          }))
          execution = result.delivery.kind === 'verified'
            ? { kind: 'available', value: result.state }
            : { kind: 'partial', value: result.state, detail: result.delivery.detail }
        } catch (cause) {
          if (!(cause instanceof PlanFailure)) throw cause
          execution = { kind: 'unavailable', detail: cause.message }
        }
        return new ReadWorkProgressResult(new WorkProgress(watch, { phase: 'implementing', execution }))
      }
      case 'uncertain':
        return new ReadWorkProgressResult(new WorkProgress(watch, {
          ...work.condition,
          execution: work.condition.execution === null
            ? { kind: 'unavailable', detail: work.condition.diagnostic }
            : { kind: 'partial', value: work.condition.execution, detail: work.condition.diagnostic },
        }))
      case 'finished':
        return new ReadWorkProgressResult(new WorkProgress(watch, work.condition))
    }
  }

  static async #read<T>(read: () => Promise<T>): Promise<WorkReading<T>> {
    try {
      return Object.freeze({ kind: 'available', value: await read() })
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      return Object.freeze({ kind: 'unavailable', detail: cause.message })
    }
  }
}
