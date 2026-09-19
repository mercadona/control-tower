import type { PlanAgents } from '../../domain/ports/plan-agents.ts'
import type { PlanIssues } from '../../domain/ports/plan-issues.ts'
import { PlanIssueStatus } from '../../domain/value-objects/plan-issue-status.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { Workbench } from '../../domain/ports/workbench.ts'

export class RequestFixesParams {
  readonly agent: string
  readonly issueNumber: number
  readonly repository: RepositoryName
  readonly changes: string
  readonly requestId: string | undefined

  constructor({ agent, issue, repository, changes, requestId }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
    changes: string,
    requestId?: string,
  }) {
    this.agent = agent
    this.issueNumber = issue
    this.repository = repository
    this.changes = changes
    this.requestId = requestId
    Object.freeze(this)
  }
}

export class RequestFixes {
  readonly workbench: Workbench
  readonly planAgents: PlanAgents
  readonly planIssues: PlanIssues

  constructor({ workbench, planAgents, planIssues }: {
    workbench: Workbench,
    planAgents: PlanAgents,
    planIssues: PlanIssues,
  }) {
    this.workbench = workbench
    this.planAgents = planAgents
    this.planIssues = planIssues
  }

  async execute(params: RequestFixesParams): Promise<void> {
    const status = await this.planIssues.statusOf({
      issueNumber: params.issueNumber,
      repository: params.repository,
    })
    if (status === PlanIssueStatus.IN_REVIEW) {
      await this.workbench.reopen({ issueNumber: params.issueNumber, repository: params.repository })
    }
    await this.planAgents.fix({
      agent: params.agent,
      issue: params.issueNumber,
      repository: params.repository,
      changes: params.changes,
      requestId: params.requestId,
    })
  }
}
