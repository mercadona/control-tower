import type { PlanAgents } from '../../domain/ports/plan-agents.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export class ReviewPlanParams {
  readonly agent: string
  readonly issue: number
  readonly repository: RepositoryName
  readonly changes: string

  constructor({ agent, issue, repository, changes }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
    changes: string,
  }) {
    this.agent = agent
    this.issue = issue
    this.repository = repository
    this.changes = changes
    Object.freeze(this)
  }
}

export class ReviewPlan {
  readonly planAgents: PlanAgents

  constructor({ planAgents }: { planAgents: PlanAgents }) {
    this.planAgents = planAgents
  }

  async execute(params: ReviewPlanParams): Promise<void> {
    await this.planAgents.review({
      agent: params.agent,
      issue: params.issue,
      repository: params.repository,
      changes: params.changes,
    })
  }
}
