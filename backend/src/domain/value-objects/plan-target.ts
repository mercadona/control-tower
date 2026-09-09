import type { CheckoutRoot } from './checkout-root.ts'
import type { RepositoryName } from './repository-name.ts'

export class PlanTarget {
  readonly repository: RepositoryName
  readonly root: CheckoutRoot

  constructor({ repository, root }: { repository: RepositoryName, root: CheckoutRoot }) {
    this.repository = repository
    this.root = root
    Object.freeze(this)
  }
}
