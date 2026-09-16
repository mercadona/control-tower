import type { PlanIssue } from '../value-objects/plan-issue.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export class DispatchCandidates {
  async next(asked: { repository: RepositoryName, milestone: string }): Promise<PlanIssue> {
    throw new Error(
      `${this.constructor.name} must implement next({ repository, milestone }), asked for ${asked.milestone} in ${asked.repository}`
    )
  }
}
