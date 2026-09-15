import type { EpicIssue } from '../value-objects/epic-issue.ts'
import type { EpicIssuesListing } from '../value-objects/epic-issues-listing.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export class EpicIssues {
  async listOf(
    { repository, milestone }: { repository: RepositoryName, milestone: string }
  ): Promise<EpicIssuesListing> {
    throw new Error(
      `${this.constructor.name} must implement listOf({ repository, milestone }), asked for ${milestone} in ${repository}`
    )
  }

  async promote({ repository, issue }: { repository: RepositoryName, issue: EpicIssue }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement promote({ repository, issue }), asked for ${issue?.number} in ${repository}`
    )
  }
}
