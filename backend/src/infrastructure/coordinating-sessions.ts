import { WorkInFlight, Reservation } from './work-in-flight.ts'
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

export const OpeningReservation = Object.freeze({
  RESERVED: 'reserved',
  LIVE_HELD: 'live-held',
  OPENING_IN_PROGRESS: 'opening-in-progress',
} as const)

export type OpeningReservationValue = (typeof OpeningReservation)[keyof typeof OpeningReservation]

export class ReservedOpening {
  readonly outcome: OpeningReservationValue
  readonly live: HeldCoordinatingSession | null

  private constructor(outcome: OpeningReservationValue, live: HeldCoordinatingSession | null) {
    this.outcome = outcome
    this.live = live
    Object.freeze(this)
  }

  static reserved(): ReservedOpening {
    return new ReservedOpening(OpeningReservation.RESERVED, null)
  }

  static liveHeld(live: HeldCoordinatingSession): ReservedOpening {
    return new ReservedOpening(OpeningReservation.LIVE_HELD, live)
  }

  static openingInProgress(): ReservedOpening {
    return new ReservedOpening(OpeningReservation.OPENING_IN_PROGRESS, null)
  }
}

export class CoordinatingSessions {
  static readonly #OPENING = 'opening'

  readonly liveSessions: LiveSessions
  readonly stderr: (line: string) => void
  #held: HeldCoordinatingSession | null
  #stopFollowing: (() => void) | null
  readonly #opening: WorkInFlight

  constructor({ liveSessions, stderr }: { liveSessions: LiveSessions, stderr: (line: string) => void }) {
    this.liveSessions = liveSessions
    this.stderr = stderr
    this.#held = null
    this.#stopFollowing = null
    this.#opening = new WorkInFlight()
  }

  reserve(): ReservedOpening {
    const live = this.#live()
    if (live !== null) return ReservedOpening.liveHeld(live)
    if (this.#opening.reserve(CoordinatingSessions.#OPENING) !== Reservation.RESERVED) {
      return ReservedOpening.openingInProgress()
    }

    return ReservedOpening.reserved()
  }

  release(): void {
    this.#opening.release(CoordinatingSessions.#OPENING)
  }

  remember(held: HeldCoordinatingSession): void {
    this.#opening.release(CoordinatingSessions.#OPENING)
    this.#stopFollowingTheHeldSession()
    this.#held = held
    if (held.state !== CoordinatingSessionState.LIVE) return
    this.#follow(held)
  }

  held(): HeldCoordinatingSession | null {
    return this.#held
  }

  attend({ conversation, attention }: { conversation: string, attention: SessionAttention }): boolean {
    const current = this.#live()
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

  #live(): HeldCoordinatingSession | null {
    return this.#held !== null && this.#held.state === CoordinatingSessionState.LIVE ? this.#held : null
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
