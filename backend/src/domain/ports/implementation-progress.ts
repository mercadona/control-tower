import type { CheckoutRoot } from '../value-objects/checkout-root.ts'
import type { ImplementationState } from '../value-objects/implementation-state.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export class ImplementationProgress {
  async of({ root, issue, repository }: {
    root: CheckoutRoot,
    issue: number,
    repository?: RepositoryName,
  }): Promise<ImplementationState> {
    throw new Error(
      `${this.constructor.name} must implement of({ root, issue, repository }), asked for ${issue} of ${repository} at ${root}`
    )
  }
}
