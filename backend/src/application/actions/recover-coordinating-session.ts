import { SessionTimelineEvent, TimelineEventKind } from '../../domain/value-objects/session-timeline-event.ts'
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
  readonly timeline: readonly SessionTimelineEvent[]

  constructor({ outcome, conversation, session, timeline }: {
    outcome: RecoveredConversationValue,
    conversation: CoordinatingConversation | null,
    session: LiveSession | null,
    timeline: readonly SessionTimelineEvent[],
  }) {
    this.outcome = outcome
    this.conversation = conversation
    this.session = session
    this.timeline = timeline
    Object.freeze(this)
  }

  static none(): CoordinatingSessionRecovered {
    return new CoordinatingSessionRecovered({
      outcome: RecoveredConversation.NONE, conversation: null, session: null, timeline: [],
    })
  }

  static live(
    conversation: CoordinatingConversation, session: LiveSession, timeline: readonly SessionTimelineEvent[]
  ): CoordinatingSessionRecovered {
    return new CoordinatingSessionRecovered({ outcome: RecoveredConversation.LIVE, conversation, session, timeline })
  }

  static unresumable(
    conversation: CoordinatingConversation, timeline: readonly SessionTimelineEvent[]
  ): CoordinatingSessionRecovered {
    return new CoordinatingSessionRecovered({
      outcome: RecoveredConversation.UNRESUMABLE, conversation, session: null, timeline,
    })
  }
}

export class RecoverCoordinatingSession {
  readonly conversations: Conversations
  readonly sessionHooks: SessionHooks
  readonly records: ConversationRecords
  readonly newId: () => string
  readonly now: () => string
  readonly stderr: (line: string) => void

  constructor({ conversations, sessionHooks, records, newId, now, stderr }: {
    conversations: Conversations, sessionHooks: SessionHooks, records: ConversationRecords,
    newId: () => string, now: () => string, stderr: (line: string) => void,
  }) {
    this.conversations = conversations
    this.sessionHooks = sessionHooks
    this.records = records
    this.newId = newId
    this.now = now
    this.stderr = stderr
  }

  #event(kind: (typeof TimelineEventKind)[keyof typeof TimelineEventKind]): SessionTimelineEvent {
    return new SessionTimelineEvent({ id: this.newId(), kind, at: this.now(), detail: null })
  }

  async #persist(conversation: CoordinatingConversation, event: SessionTimelineEvent): Promise<void> {
    try {
      await this.records.appendTimelineEvent({ conversation, event })
    } catch (cause) {
      this.stderr(`coordinating session ${conversation.id.text}: timeline event not recorded: ${String(cause)}\n`)
    }
  }

  async execute(): Promise<CoordinatingSessionRecovered> {
    const conversation = await this.records.recall()
    if (conversation === null) return CoordinatingSessionRecovered.none()

    const prior = await this.records.recallTimeline(conversation)
    if (!this.conversations.isResumable(conversation)) {
      const event = this.#event(TimelineEventKind.UNRESUMABLE)
      await this.#persist(conversation, event)
      return CoordinatingSessionRecovered.unresumable(conversation, [...prior, event])
    }

    await this.sessionHooks.install(conversation.root)
    const session = this.conversations.resume(conversation)
    const event = this.#event(TimelineEventKind.RESUMED)
    await this.#persist(conversation, event)

    return CoordinatingSessionRecovered.live(conversation, session, [...prior, event])
  }
}
