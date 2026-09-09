import type { GoRegistry } from '../../domain/ports/go-registry.ts'
import type { PlanAgents } from '../../domain/ports/plan-agents.ts'
import type { PlanIssues } from '../../domain/ports/plan-issues.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export class ImplementPlanParams {
  readonly agent: string
  readonly issue: number
  readonly repository: RepositoryName

  constructor({ agent, issue, repository }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
  }) {
    this.agent = agent
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

export class ImplementPlan {
  readonly goRegistry: GoRegistry
  readonly planIssues: PlanIssues
  readonly planAgents: PlanAgents

  constructor({ goRegistry, planIssues, planAgents }: {
    goRegistry: GoRegistry,
    planIssues: PlanIssues,
    planAgents: PlanAgents,
  }) {
    this.goRegistry = goRegistry
    this.planIssues = planIssues
    this.planAgents = planAgents
  }

  async execute(params: ImplementPlanParams): Promise<void> {
    const nonce = await this.goRegistry.mint({
      issueNumber: params.issue, repository: params.repository,
    })
    await this.planIssues.answerGo({
      issueNumber: params.issue, repository: params.repository, nonce,
    })
    await this.planAgents.resume({
      agent: params.agent, issue: params.issue, repository: params.repository,
    })
  }
}
