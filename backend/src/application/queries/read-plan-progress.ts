import type { PlanProgress } from '../../domain/ports/plan-progress.ts'
import type { PlanIssue } from '../../domain/value-objects/plan-issue.ts'
import type { PlanStateValue } from '../../domain/value-objects/plan-state.ts'
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

  constructor({ planProgress }: { planProgress: PlanProgress }) {
    this.planProgress = planProgress
  }

  async execute(params: ReadPlanProgressParams): Promise<ReadPlanProgressResult> {
    return new ReadPlanProgressResult({
      state: await this.#stateOf(params),
    })
  }

  async #stateOf(params: ReadPlanProgressParams): Promise<PlanStateValue> {
    return this.planProgress.of({
      located: params.located,
      issue: params.issue,
      repository: params.repository,
    })
  }
}
