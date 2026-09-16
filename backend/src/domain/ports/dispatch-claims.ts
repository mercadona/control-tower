import type { CheckoutRoot } from '../value-objects/checkout-root.ts'
import type { PlanIssue } from '../value-objects/plan-issue.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

type DispatchClaim = { issue: PlanIssue, repository: RepositoryName, root: CheckoutRoot }

export class DispatchClaims {
  async claim(asked: DispatchClaim): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement claim({ issue, repository, root }), asked for ${asked.issue} in ${asked.repository} at ${asked.root}`
    )
  }

  async requeue(asked: DispatchClaim): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement requeue({ issue, repository, root }), asked for ${asked.issue} in ${asked.repository} at ${asked.root}`
    )
  }
}
