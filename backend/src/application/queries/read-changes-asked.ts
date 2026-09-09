import type { PlanIssues } from '../../domain/ports/plan-issues.ts'
import type { ChangeAsked } from '../../domain/value-objects/change-asked.ts'
import type { PlanIssue } from '../../domain/value-objects/plan-issue.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export class ReadChangesAskedParams {
  readonly issue: PlanIssue
  readonly repository: RepositoryName

  constructor({ issue, repository }: { issue: PlanIssue, repository: RepositoryName }) {
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadChangesAskedResult {
  readonly changes: ChangeAsked[]

  constructor({ changes }: { changes: ChangeAsked[] }) {
    this.changes = changes
    Object.freeze(this)
  }
}

export class ReadChangesAsked {
  readonly planIssues: PlanIssues

  constructor({ planIssues }: { planIssues: PlanIssues }) {
    this.planIssues = planIssues
  }

  async execute(params: ReadChangesAskedParams): Promise<ReadChangesAskedResult> {
    return new ReadChangesAskedResult({
      changes: await this.planIssues.changesAsked({
        issue: params.issue,
        repository: params.repository,
      }),
    })
  }
}
