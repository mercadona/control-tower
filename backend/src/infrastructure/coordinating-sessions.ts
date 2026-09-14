import type { LiveSessions } from '../domain/ports/live-sessions.ts'
import type { CoordinatingConversation } from '../domain/value-objects/coordinating-conversation.ts'
import type { LiveSession } from '../domain/value-objects/live-session.ts'
import type { SessionAttention } from '../domain/value-objects/session-attention.ts'

export const CoordinatingSessionState = Object.freeze({
  LIVE: 'live',
  UNRESUMABLE: 'unresumable',
  ENDED: 'ended',
} as const)

export type CoordinatingSessionStateValue = (typeof CoordinatingSessionState)[keyof typeof CoordinatingSessionState]

export class HeldCoordinatingSession {
  readonly state: CoordinatingSessionStateValue
  readonly conversation: CoordinatingConversation
  readonly session: LiveSession | null
  readonly attention: SessionAttention | null

  constructor({ state, conversation, session, attention }: {
    state: CoordinatingSessionStateValue,
    conversation: CoordinatingConversation,
    session: LiveSession | null,
    attention: SessionAttention | null,
  }) {
    this.state = state
    this.conversation = conversation
    this.session = session
    this.attention = attention
    Object.freeze(this)
  }

  static ended(conversation: CoordinatingConversation): HeldCoordinatingSession {
    return new HeldCoordinatingSession({
      state: CoordinatingSessionState.ENDED,
      conversation,
      session: null,
      attention: null,
    })
  }
}

export class CoordinatingSessions {
  readonly liveSessions: LiveSessions
  readonly stderr: (line: string) => void
  #held: HeldCoordinatingSession | null
  #stopFollowing: (() => void) | null

  constructor({ liveSessions, stderr }: { liveSessions: LiveSessions, stderr: (line: string) => void }) {
    this.liveSessions = liveSessions
    this.stderr = stderr
    this.#held = null
    this.#stopFollowing = null
  }

  remember(held: HeldCoordinatingSession): void {
    this.#stopFollowingTheHeldSession()
    this.#held = held
    if (held.state !== CoordinatingSessionState.LIVE) return
    this.#follow(held)
  }

  held(): HeldCoordinatingSession | null {
    return this.#held
  }

  attend({ conversation, attention }: { conversation: string, attention: SessionAttention }): boolean {
    const current = this.#held
    if (current === null || current.state !== CoordinatingSessionState.LIVE) return false
    if (current.conversation.id.text !== conversation) return false

    this.#held = new HeldCoordinatingSession({
      state: current.state,
      conversation: current.conversation,
      session: current.session,
      attention,
    })
    this.stderr(`coordinating session ${conversation} ${attention.status}\n`)

    return true
  }

  #follow(held: HeldCoordinatingSession): void {
    const session = this.liveSessions.find(held.session!.id)
    if (session === null) {
      this.#ended(held.conversation)
      return
    }
    const { stop } = this.liveSessions.watch({
      session,
      onBytes: (): void => {},
      onEnded: (): void => this.#ended(held.conversation),
    })
    this.#stopFollowing = stop
  }

  #ended(conversation: CoordinatingConversation): void {
    this.#stopFollowing = null
    this.#held = HeldCoordinatingSession.ended(conversation)
    this.stderr(`coordinating session ${conversation.id.text} ended\n`)
  }

  #stopFollowingTheHeldSession(): void {
    if (this.#stopFollowing === null) return
    this.#stopFollowing()
    this.#stopFollowing = null
  }
}
