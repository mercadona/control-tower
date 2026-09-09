import type { ChangeAsked } from '../value-objects/change-asked.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

export class PullRequests {
  async openOf({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): Promise<ReviewedPullRequest | null> {
    throw new Error(
      `${this.constructor.name} must implement openOf({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }

  async fixesAsked({ pullRequest, repository }: {
    pullRequest: ReviewedPullRequest,
    repository: RepositoryName,
  }): Promise<ChangeAsked[]> {
    throw new Error(
      `${this.constructor.name} must implement fixesAsked({ pullRequest, repository }), asked for ${pullRequest?.number} in ${repository}`
    )
  }
}
