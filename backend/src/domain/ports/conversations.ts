import type { ConversationId } from '../value-objects/conversation-id.ts'
import type { CoordinatingConversation } from '../value-objects/coordinating-conversation.ts'
import type { LiveSession } from '../value-objects/live-session.ts'

export class Conversations {
  mint(): ConversationId {
    throw new Error(`${this.constructor.name} must implement mint()`)
  }

  isResumable(conversation: CoordinatingConversation): boolean {
    throw new Error(
      `${this.constructor.name} must implement isResumable(conversation), asked for ${conversation.id}`
    )
  }

  start({ conversation, promptPath }: {
    conversation: CoordinatingConversation, promptPath: string,
  }): LiveSession {
    throw new Error(
      `${this.constructor.name} must implement start({ conversation, promptPath }), asked for ${conversation.id} at ${promptPath}`
    )
  }

  resume(conversation: CoordinatingConversation): LiveSession {
    throw new Error(
      `${this.constructor.name} must implement resume(conversation), asked for ${conversation.id}`
    )
  }
}
