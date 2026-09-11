import type { CheckoutRoot } from '../value-objects/checkout-root.ts'
import type { ImplementationHistoryEntry } from '../value-objects/implementation-history-entry.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export class ImplementationHistory {
  async of({ root, issue, repository }: {
    root: CheckoutRoot,
    issue: number,
    repository: RepositoryName,
  }): Promise<ImplementationHistoryEntry[]> {
    throw new Error(
      `${this.constructor.name} must implement of({ root, issue, repository }), asked for ${issue} of ${repository} at ${root}`
    )
  }
}
