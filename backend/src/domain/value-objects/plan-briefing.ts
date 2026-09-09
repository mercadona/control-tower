import type { PlanIssue } from './plan-issue.ts'
import type { RepositoryName } from './repository-name.ts'
import type { UserStoryKey } from './user-story-key.ts'
import type { UserStoryUrl } from './user-story-url.ts'
import type { WorkspaceLocation } from './workspace-location.ts'

export class PlanBriefing {
  readonly story: UserStoryKey | UserStoryUrl | null
  readonly issue: PlanIssue
  readonly located: WorkspaceLocation
  readonly repository: RepositoryName

  constructor({ story, issue, located, repository }: {
    story: UserStoryKey | UserStoryUrl | null,
    issue: PlanIssue,
    located: WorkspaceLocation,
    repository: RepositoryName,
  }) {
    this.story = story
    this.issue = issue
    this.located = located
    this.repository = repository
    Object.freeze(this)
  }
}
