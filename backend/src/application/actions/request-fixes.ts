import type { PlanAgents } from '../../domain/ports/plan-agents.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { Workbench } from '../../domain/ports/workbench.ts'

export class RequestFixesParams {
  readonly agent: string
  readonly issueNumber: number
  readonly repository: RepositoryName
  readonly changes: string

  constructor({ agent, issue, repository, changes }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
    changes: string,
  }) {
    this.agent = agent
    this.issueNumber = issue
    this.repository = repository
    this.changes = changes
    Object.freeze(this)
  }
}

export class RequestFixes {
  readonly workbench: Workbench
  readonly planAgents: PlanAgents

  constructor({ workbench, planAgents }: { workbench: Workbench, planAgents: PlanAgents }) {
    this.workbench = workbench
    this.planAgents = planAgents
  }

  async execute(params: RequestFixesParams): Promise<void> {
    await this.workbench.reopen({ issueNumber: params.issueNumber, repository: params.repository })
    await this.planAgents.fix({
      agent: params.agent,
      issue: params.issueNumber,
      repository: params.repository,
      changes: params.changes,
    })
  }
}
