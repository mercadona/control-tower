import type { PlanIssueStatusValue } from '../value-objects/plan-issue-status.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export class PlanIssues {
  async statusOf({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): Promise<PlanIssueStatusValue> {
    throw new Error(
      `${this.constructor.name} must implement statusOf({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }
}
