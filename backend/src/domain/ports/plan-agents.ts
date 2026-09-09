import type { PlanBriefing } from '../value-objects/plan-briefing.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export class PlanAgents {
  async launch(briefing: PlanBriefing): Promise<string> {
    throw new Error(
      `${this.constructor.name} must implement launch(briefing), asked for ${briefing?.story} on ${briefing?.issue}`
    )
  }

  async resume({ agent, issue, repository }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
  }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement resume({ agent, issue, repository }), asked for ${agent} on ${issue} in ${repository}`
    )
  }

  async review({ agent, issue, repository, changes }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
    changes: string,
  }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement review({ agent, issue, repository, changes }), asked for ${agent} on ${issue} in ${repository}`
    )
  }

  async fix({ agent, issue, repository, changes }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
    changes: string,
  }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement fix({ agent, issue, repository, changes }), asked for ${agent} on ${issue} in ${repository}`
    )
  }
}
