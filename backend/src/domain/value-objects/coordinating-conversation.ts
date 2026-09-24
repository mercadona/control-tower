import type { CheckoutRoot } from './checkout-root.ts'
import type { ConversationId } from './conversation-id.ts'
import type { RepositoryName } from './repository-name.ts'
import type { UserStoryKey } from './user-story-key.ts'
import type { UserStoryUrl } from './user-story-url.ts'

export class CoordinatingConversation {
  readonly id: ConversationId
  readonly repository: RepositoryName
  readonly root: CheckoutRoot
  readonly story: UserStoryKey | UserStoryUrl

  constructor({ id, repository, root, story }: {
    id: ConversationId, repository: RepositoryName, root: CheckoutRoot, story: UserStoryKey | UserStoryUrl,
  }) {
    this.id = id
    this.repository = repository
    this.root = root
    this.story = story
    Object.freeze(this)
  }
}
