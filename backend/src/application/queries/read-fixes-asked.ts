import { DeliveryPolicy, DeliveryState } from '../../domain/policies/delivery-policy.ts'
import type { ChangeAsked } from '../../domain/value-objects/change-asked.ts'
import type { PlanIssue } from '../../domain/value-objects/plan-issue.ts'
import type { PlanIssues } from '../../domain/ports/plan-issues.ts'
import type { PullRequests } from '../../domain/ports/pull-requests.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export class ReadFixesAskedParams {
  readonly issue: PlanIssue
  readonly repository: RepositoryName

  constructor({ issue, repository }: { issue: PlanIssue, repository: RepositoryName }) {
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadFixesAskedResult {
  readonly changes: ChangeAsked[]

  constructor({ changes }: { changes: ChangeAsked[] }) {
    this.changes = changes
    Object.freeze(this)
  }
}

export class ReadFixesAsked {
  readonly pullRequests: PullRequests
  readonly planIssues: PlanIssues

  constructor({ pullRequests, planIssues }: { pullRequests: PullRequests, planIssues: PlanIssues }) {
    this.pullRequests = pullRequests
    this.planIssues = planIssues
  }

  async execute(params: ReadFixesAskedParams): Promise<ReadFixesAskedResult> {
    const pullRequest = await this.pullRequests.openOf({
      issueNumber: params.issue.number, repository: params.repository,
    })
    if (pullRequest === null) return new ReadFixesAskedResult({ changes: [] })

    const status = await this.planIssues.statusOf({
      issueNumber: params.issue.number, repository: params.repository,
    })
    if (DeliveryPolicy.of({ status }) !== DeliveryState.IN_REVIEW) {
      return new ReadFixesAskedResult({ changes: [] })
    }

    return new ReadFixesAskedResult({
      changes: await this.pullRequests.fixesAsked({ pullRequest, repository: params.repository }),
    })
  }
}
