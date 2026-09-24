import type { AuthorisedMilestones } from '../value-objects/authorised-milestones.ts'
import type { PlanIssue } from '../value-objects/plan-issue.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export class DispatchCandidates {
  async admissible(asked: { repository: RepositoryName, milestone: string }): Promise<readonly PlanIssue[]> {
    throw new Error(
      `${this.constructor.name} must implement admissible({ repository, milestone }), asked for ${asked.milestone} in ${asked.repository}`
    )
  }

  async authorisedMilestones(asked: { repository: RepositoryName }): Promise<AuthorisedMilestones> {
    throw new Error(
      `${this.constructor.name} must implement authorisedMilestones({ repository }), asked for ${asked.repository}`
    )
  }
}
