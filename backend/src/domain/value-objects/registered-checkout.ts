import type { CheckoutRoot } from './checkout-root.ts'
import type { RepositoryName } from './repository-name.ts'

export class RegisteredCheckout {
  readonly repository: RepositoryName | null
  readonly root: CheckoutRoot

  constructor({ repository, root }: { repository: RepositoryName | null, root: CheckoutRoot }) {
    this.repository = repository
    this.root = root
    Object.freeze(this)
  }

  holds(repository: RepositoryName): boolean {
    return this.repository !== null &&
      this.repository.text.toLowerCase() === repository.text.toLowerCase()
  }
}
