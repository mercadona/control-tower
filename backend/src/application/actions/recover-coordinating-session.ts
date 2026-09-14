import type { CoordinatingConversation } from '../../domain/value-objects/coordinating-conversation.ts'
import type { ConversationRecords } from '../../domain/ports/conversation-records.ts'
import type { Conversations } from '../../domain/ports/conversations.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'
import type { SessionHooks } from '../../domain/ports/session-hooks.ts'

export const RecoveredConversation = Object.freeze({
  NONE: 'none',
  LIVE: 'live',
  UNRESUMABLE: 'unresumable',
} as const)

export type RecoveredConversationValue = (typeof RecoveredConversation)[keyof typeof RecoveredConversation]

export class CoordinatingSessionRecovered {
  readonly outcome: RecoveredConversationValue
  readonly conversation: CoordinatingConversation | null
  readonly session: LiveSession | null

  constructor({ outcome, conversation, session }: {
    outcome: RecoveredConversationValue,
    conversation: CoordinatingConversation | null,
    session: LiveSession | null,
  }) {
    this.outcome = outcome
    this.conversation = conversation
    this.session = session
    Object.freeze(this)
  }

  static none(): CoordinatingSessionRecovered {
    return new CoordinatingSessionRecovered({ outcome: RecoveredConversation.NONE, conversation: null, session: null })
  }

  static live(conversation: CoordinatingConversation, session: LiveSession): CoordinatingSessionRecovered {
    return new CoordinatingSessionRecovered({ outcome: RecoveredConversation.LIVE, conversation, session })
  }

  static unresumable(conversation: CoordinatingConversation): CoordinatingSessionRecovered {
    return new CoordinatingSessionRecovered({
      outcome: RecoveredConversation.UNRESUMABLE, conversation, session: null,
    })
  }
}

export class RecoverCoordinatingSession {
  readonly conversations: Conversations
  readonly sessionHooks: SessionHooks
  readonly records: ConversationRecords

  constructor({ conversations, sessionHooks, records }: {
    conversations: Conversations, sessionHooks: SessionHooks, records: ConversationRecords,
  }) {
    this.conversations = conversations
    this.sessionHooks = sessionHooks
    this.records = records
  }

  async execute(): Promise<CoordinatingSessionRecovered> {
    const conversation = await this.records.recall()
    if (conversation === null) return CoordinatingSessionRecovered.none()
    if (!this.conversations.isResumable(conversation)) return CoordinatingSessionRecovered.unresumable(conversation)

    await this.sessionHooks.install(conversation.root)
    const session = this.conversations.resume(conversation)

    return CoordinatingSessionRecovered.live(conversation, session)
  }
}
