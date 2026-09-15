import type { ChangeAsked } from '../value-objects/change-asked.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'
import type { Reslicing } from '../value-objects/reslicing.ts'

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

  async openOfBranch({ branch, repository }: {
    branch: string,
    repository: RepositoryName,
  }): Promise<ReviewedPullRequest | null> {
    throw new Error(
      `${this.constructor.name} must implement openOfBranch({ branch, repository }), asked for ${branch} in ${repository}`
    )
  }

  async mergedReslicingOf({ branch, repository, approving, into }: {
    branch: string,
    repository: RepositoryName,
    approving: Reslicing,
    into: string,
  }): Promise<ReviewedPullRequest | null> {
    throw new Error(
      `${this.constructor.name} must implement mergedReslicingOf({ branch, repository, approving, into }) and answer `
      + `the pull request of ${branch} that merged into ${into} of ${repository} approving revision `
      + `${approving?.revision} of ${approving?.path}`
    )
  }

  async open({ repository, branch, title, body }: {
    repository: RepositoryName,
    branch: string,
    title: string,
    body: string,
  }): Promise<ReviewedPullRequest> {
    throw new Error(
      `${this.constructor.name} must implement open({ repository, branch, title, body }), asked for ${branch} in ${repository}`
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
