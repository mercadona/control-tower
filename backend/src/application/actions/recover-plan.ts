import type { PlanAgents } from '../../domain/ports/plan-agents.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export class RecoverPlanParams {
  readonly agent: string
  readonly issue: number
  readonly repository: RepositoryName

  constructor(asked: { agent: string, issue: number, repository: RepositoryName }) {
    this.agent = asked.agent
    this.issue = asked.issue
    this.repository = asked.repository
    Object.freeze(this)
  }
}

export class RecoverPlan {
  readonly agents: PlanAgents

  constructor({ agents }: { agents: PlanAgents }) {
    this.agents = agents
  }

  async execute(params: RecoverPlanParams): Promise<void> {
    await this.agents.recover(params)
  }
}
