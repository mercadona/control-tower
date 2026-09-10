import type { PlanProgress } from '../../domain/ports/plan-progress.ts'
import type { ReviewLog } from '../../domain/ports/review-log.ts'
import type { PlanIssue } from '../../domain/value-objects/plan-issue.ts'
import { PlanState, type PlanStateValue } from '../../domain/value-objects/plan-state.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { WorkspaceLocation } from '../../domain/value-objects/workspace-location.ts'

export class ReadPlanProgressParams {
  readonly located: WorkspaceLocation
  readonly issue: PlanIssue
  readonly repository: RepositoryName

  constructor({ located, issue, repository }: {
    located: WorkspaceLocation,
    issue: PlanIssue,
    repository: RepositoryName,
  }) {
    this.located = located
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadPlanProgressResult {
  readonly state: PlanStateValue

  constructor({ state }: { state: PlanStateValue }) {
    this.state = state
    Object.freeze(this)
  }
}

export class ReadPlanProgress {
  readonly planProgress: PlanProgress
  readonly reviewLog: ReviewLog

  constructor({ planProgress, reviewLog }: { planProgress: PlanProgress, reviewLog: ReviewLog }) {
    this.planProgress = planProgress
    this.reviewLog = reviewLog
  }

  async execute(params: ReadPlanProgressParams): Promise<ReadPlanProgressResult> {
    return new ReadPlanProgressResult({
      state: await this.#stateOf(params),
    })
  }

  async #stateOf(params: ReadPlanProgressParams): Promise<PlanStateValue> {
    if (await this.#underReview(params)) return PlanState.REVIEWING

    return await this.planProgress.of({
      located: params.located,
      issue: params.issue,
      repository: params.repository,
    })
  }

  async #underReview(params: ReadPlanProgressParams): Promise<boolean> {
    const asked = ReadPlanProgress.#momentOf(
      this.reviewLog.lastAskedAt({ issue: params.issue.number, repository: params.repository })
    )
    if (asked === null) return false
    const dated = await this.planProgress.committedAt({ located: params.located })
    if (dated === null) return true
    const committed = ReadPlanProgress.#momentOf(dated)

    return committed !== null && committed < asked
  }

  static #momentOf(dated: string | null): number | null {
    if (typeof dated !== 'string') return null
    const moment = Date.parse(dated)

    return Number.isNaN(moment) ? null : moment
  }
}
