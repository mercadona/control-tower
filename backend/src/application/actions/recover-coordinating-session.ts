import { SessionTimelineEvent, TimelineEventKind } from '../../domain/value-objects/session-timeline-event.ts'
import { RegisteredCheckout } from '../../domain/value-objects/registered-checkout.ts'
import type { CheckoutRegistry } from '../../domain/ports/checkout-registry.ts'
import type { CoordinatingConversation } from '../../domain/value-objects/coordinating-conversation.ts'
import type { ConversationRecords } from '../../domain/ports/conversation-records.ts'
import type { Conversations } from '../../domain/ports/conversations.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'
import type { SessionHooks } from '../../domain/ports/session-hooks.ts'
import { ClosureStatus } from '../../domain/value-objects/session-closure.ts'
import { SessionClosureNotRecorded, SessionTerminationUnconfirmed } from '../../domain/exceptions.ts'
import type { SessionClosure } from '../../domain/value-objects/session-closure.ts'
import type { LiveSessions } from '../../domain/ports/live-sessions.ts'

export const RecoveredConversation = Object.freeze({
  NONE: 'none',
  LIVE: 'live',
  UNRESUMABLE: 'unresumable',
  INTERRUPTED: 'interrupted',
} as const)

export type RecoveredConversationValue = (typeof RecoveredConversation)[keyof typeof RecoveredConversation]

export class CoordinatingSessionRecovered {
  readonly outcome: RecoveredConversationValue
  readonly conversation: CoordinatingConversation | null
  readonly session: LiveSession | null
  readonly timeline: readonly SessionTimelineEvent[]
  readonly closure: SessionClosure | null
  readonly failure: Error | null

  constructor({ outcome, conversation, session, timeline, closure, failure }: {
    outcome: RecoveredConversationValue,
    conversation: CoordinatingConversation | null,
    session: LiveSession | null,
    timeline: readonly SessionTimelineEvent[],
    closure?: SessionClosure | null,
    failure?: Error | null,
  }) {
    this.outcome = outcome
    this.conversation = conversation
    this.session = session
    this.timeline = timeline
    this.closure = closure ?? null
    this.failure = failure ?? null
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

  static interrupted(
    conversation: CoordinatingConversation, closure: SessionClosure, failure: Error
  ): CoordinatingSessionRecovered {
    return new CoordinatingSessionRecovered({
      outcome: RecoveredConversation.INTERRUPTED,
      conversation,
      session: null,
      timeline: [],
      closure,
      failure,
    })
  }
}

export class RecoverCoordinatingSession {
  readonly conversations: Conversations
  readonly sessionHooks: SessionHooks
  readonly records: ConversationRecords
  readonly liveSessions: LiveSessions
  readonly checkouts: CheckoutRegistry
  readonly newId: () => string
  readonly now: () => string
  readonly stderr: (line: string) => void

  constructor({ conversations, sessionHooks, records, liveSessions, checkouts, newId, now, stderr }: {
    conversations: Conversations, sessionHooks: SessionHooks, records: ConversationRecords,
    liveSessions: LiveSessions, checkouts: CheckoutRegistry,
    newId: () => string, now: () => string, stderr: (line: string) => void,
  }) {
    this.conversations = conversations
    this.sessionHooks = sessionHooks
    this.records = records
    this.liveSessions = liveSessions
    this.checkouts = checkouts
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

    const closure = await this.records.recallClosure(conversation.id)
    if (closure !== null) {
      switch (closure.status) {
        case ClosureStatus.CLOSED:
          return CoordinatingSessionRecovered.none()
        case ClosureStatus.REQUESTED:
          try {
            await this.liveSessions.confirmTermination(closure)
            await this.records.completeClosure(closure.closed())
            return CoordinatingSessionRecovered.none()
          } catch (cause) {
            if (cause instanceof SessionTerminationUnconfirmed || cause instanceof SessionClosureNotRecorded) {
              return CoordinatingSessionRecovered.interrupted(conversation, closure, cause)
            }
            throw cause
          }
        default: {
          const exhaustive: never = closure.status
          throw new Error(`no coordinating session closure recovery declared for ${exhaustive}`)
        }
      }
    }

    this.checkouts.remember(new RegisteredCheckout({
      repository: conversation.repository, root: conversation.root,
    }))

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
