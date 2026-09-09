import type { PlanIssue } from './plan-issue.ts'
import type { RepositoryName } from './repository-name.ts'
import type { UserStoryKey } from './user-story-key.ts'
import type { UserStoryUrl } from './user-story-url.ts'
import type { WorkspaceLocation } from './workspace-location.ts'

export class PlanWatch {
  readonly story: UserStoryKey | UserStoryUrl | null
  readonly issue: PlanIssue
  readonly located: WorkspaceLocation
  readonly repository: RepositoryName
  readonly agent: string

  constructor({ story, issue, located, repository, agent }: {
    story: UserStoryKey | UserStoryUrl | null,
    issue: PlanIssue,
    located: WorkspaceLocation,
    repository: RepositoryName,
    agent: string,
  }) {
    this.story = story
    this.issue = issue
    this.located = located
    this.repository = repository
    this.agent = agent
    Object.freeze(this)
  }

  storyText(): string | null {
    return this.story === null ? null : this.story.text
  }
}
