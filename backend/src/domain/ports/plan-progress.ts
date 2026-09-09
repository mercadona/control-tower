import type { PlanIssue } from '../value-objects/plan-issue.ts'
import type { PlanStateValue } from '../value-objects/plan-state.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'
import type { WorkspaceLocation } from '../value-objects/workspace-location.ts'

export class PlanProgress {
  async of({ located, issue, repository }: {
    located: WorkspaceLocation,
    issue: PlanIssue,
    repository: RepositoryName,
  }): Promise<PlanStateValue> {
    throw new Error(
      `${this.constructor.name} must implement of({ located, issue, repository }), asked for ${issue?.number} at ${located?.path} in ${repository}`
    )
  }
}
