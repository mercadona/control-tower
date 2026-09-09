export class AskPlanChangesParams {
  constructor({ issue, repository, changes }) {
    this.issue = issue
    this.repository = repository
    this.changes = changes
    Object.freeze(this)
  }
}

export class AskPlanChanges {
  constructor({ planIssues }) {
    this.planIssues = planIssues
  }

  async execute(params) {
    await this.planIssues.askChanges({
      issue: params.issue,
      repository: params.repository,
      changes: params.changes,
    })
  }
}
