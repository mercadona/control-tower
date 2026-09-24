import { CoordinatingConversation } from '../src/domain/value-objects/coordinating-conversation.ts'
import { UserStoryKey } from '../src/domain/value-objects/user-story-key.ts'
import { UserStoryUrl } from '../src/domain/value-objects/user-story-url.ts'
import type { CheckoutRoot } from '../src/domain/value-objects/checkout-root.ts'
import type { ConversationId } from '../src/domain/value-objects/conversation-id.ts'
import type { RepositoryName } from '../src/domain/value-objects/repository-name.ts'

export class CoordinatingConversationMother {
  static readonly STORY = new UserStoryKey('STAFF-128')
  static readonly ISSUE_STORY = new UserStoryUrl('https://github.com/owner/name/issues/12')

  static of({ id, repository, root, story = CoordinatingConversationMother.STORY }: {
    id: ConversationId, repository: RepositoryName, root: CheckoutRoot, story?: UserStoryKey | UserStoryUrl,
  }): CoordinatingConversation {
    return new CoordinatingConversation({ id, repository, root, story })
  }
}
