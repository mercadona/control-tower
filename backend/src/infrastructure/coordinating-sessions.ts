import type { CoordinatingConversation } from '../domain/value-objects/coordinating-conversation.ts'
import type { LiveSession } from '../domain/value-objects/live-session.ts'
import type { SessionAttention } from '../domain/value-objects/session-attention.ts'

export const CoordinatingSessionState = Object.freeze({
  LIVE: 'live',
  UNRESUMABLE: 'unresumable',
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
}

export class CoordinatingSessions {
  readonly stderr: (line: string) => void
  #held: HeldCoordinatingSession | null

  constructor({ stderr }: { stderr: (line: string) => void }) {
    this.stderr = stderr
    this.#held = null
  }

  remember(held: HeldCoordinatingSession): void {
    this.#held = held
  }

  held(): HeldCoordinatingSession | null {
    return this.#held
  }

  attend({ conversation, attention }: { conversation: string, attention: SessionAttention }): boolean {
    const current = this.#held
    if (current === null || current.conversation.id.text !== conversation) return false

    this.#held = new HeldCoordinatingSession({
      state: current.state,
      conversation: current.conversation,
      session: current.session,
      attention,
    })
    this.stderr(`coordinating session ${conversation} ${attention.status}\n`)

    return true
  }
}
