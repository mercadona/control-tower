import type { PlanIssue } from '../value-objects/plan-issue.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export class DispatchCandidates {
  async admissible(asked: { repository: RepositoryName, milestone: string }): Promise<readonly PlanIssue[]> {
    throw new Error(
      `${this.constructor.name} must implement admissible({ repository, milestone }), asked for ${asked.milestone} in ${asked.repository}`
    )
  }
}
