import type { PlanIssues } from '../../domain/ports/plan-issues.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { UserStoryKey } from '../../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../../domain/value-objects/user-story-url.ts'

export class ReadPlanStoryParams {
  readonly issueNumber: number
  readonly repository: RepositoryName

  constructor({ issueNumber, repository }: { issueNumber: number, repository: RepositoryName }) {
    this.issueNumber = issueNumber
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadPlanStoryResult {
  readonly story: UserStoryKey | UserStoryUrl | null

  constructor({ story }: { story: UserStoryKey | UserStoryUrl | null }) {
    this.story = story
    Object.freeze(this)
  }
}

export class ReadPlanStory {
  readonly planIssues: PlanIssues

  constructor({ planIssues }: { planIssues: PlanIssues }) {
    this.planIssues = planIssues
  }

  async execute(params: ReadPlanStoryParams): Promise<ReadPlanStoryResult> {
    return new ReadPlanStoryResult({
      story: await this.planIssues.storyOf({
        issueNumber: params.issueNumber,
        repository: params.repository,
      }),
    })
  }
}
