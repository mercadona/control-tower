import type { CheckoutRoot } from './checkout-root.ts'
import type { ConversationId } from './conversation-id.ts'
import type { RepositoryName } from './repository-name.ts'

export class CoordinatingConversation {
  readonly id: ConversationId
  readonly repository: RepositoryName
  readonly root: CheckoutRoot

  constructor({ id, repository, root }: { id: ConversationId, repository: RepositoryName, root: CheckoutRoot }) {
    this.id = id
    this.repository = repository
    this.root = root
    Object.freeze(this)
  }
}
