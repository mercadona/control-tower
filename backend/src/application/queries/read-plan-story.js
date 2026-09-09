export class ReadPlanStoryParams {
  constructor({ issueNumber, repository }) {
    this.issueNumber = issueNumber
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadPlanStoryResult {
  constructor({ story }) {
    this.story = story
    Object.freeze(this)
  }
}

export class ReadPlanStory {
  constructor({ planIssues }) {
    this.planIssues = planIssues
  }

  async execute(params) {
    return new ReadPlanStoryResult({
      story: await this.planIssues.storyOf({
        issueNumber: params.issueNumber,
        repository: params.repository,
      }),
    })
  }
}
