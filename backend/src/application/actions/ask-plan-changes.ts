import type { PlanIssues } from '../../domain/ports/plan-issues.ts'
import type { PlanIssue } from '../../domain/value-objects/plan-issue.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export class AskPlanChangesParams {
  readonly issue: PlanIssue
  readonly repository: RepositoryName
  readonly changes: string

  constructor({ issue, repository, changes }: {
    issue: PlanIssue,
    repository: RepositoryName,
    changes: string,
  }) {
    this.issue = issue
    this.repository = repository
    this.changes = changes
    Object.freeze(this)
  }
}

export class AskPlanChanges {
  readonly planIssues: PlanIssues

  constructor({ planIssues }: { planIssues: PlanIssues }) {
    this.planIssues = planIssues
  }

  async execute(params: AskPlanChangesParams): Promise<void> {
    await this.planIssues.askChanges({
      issue: params.issue,
      repository: params.repository,
      changes: params.changes,
    })
  }
}
