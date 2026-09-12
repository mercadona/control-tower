import type { PlanComment } from '../value-objects/plan-comment.ts'
import type { PlanIssue } from '../value-objects/plan-issue.ts'
import type { PlanIssueStatusValue } from '../value-objects/plan-issue-status.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'
import type { UserStory } from '../value-objects/user-story.ts'
import type { UserStoryKey } from '../value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../value-objects/user-story-url.ts'

export class PlanIssues {
  async open({ story, comment, repository }: {
    story: UserStory | null,
    comment: PlanComment | null,
    repository: RepositoryName,
  }): Promise<PlanIssue> {
    throw new Error(
      `${this.constructor.name} must implement open({ story, comment, repository }), asked for ${story?.key} in ${repository}`
    )
  }

  async claim({ issue, repository }: { issue: PlanIssue, repository: RepositoryName }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement claim({ issue, repository }), asked for ${issue?.number} in ${repository}`
    )
  }

  async requeue({ issue, repository }: { issue: PlanIssue, repository: RepositoryName }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement requeue({ issue, repository }), asked for ${issue?.number} in ${repository}`
    )
  }

  async answerGo({ issueNumber, repository, nonce }: {
    issueNumber: number,
    repository: RepositoryName,
    nonce: string,
  }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement answerGo({ issueNumber, repository, nonce }), asked for ${issueNumber} in ${repository}`
    )
  }

  async storyOf({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): Promise<UserStoryKey | UserStoryUrl | null> {
    throw new Error(
      `${this.constructor.name} must implement storyOf({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }

  async statusOf({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): Promise<PlanIssueStatusValue> {
    throw new Error(
      `${this.constructor.name} must implement statusOf({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }
}
