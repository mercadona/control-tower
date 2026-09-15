import { randomUUID } from 'node:crypto'
import { WorkInFlight, Reservation } from './work-in-flight.ts'
import { ConversationRecords } from '../domain/ports/conversation-records.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../domain/value-objects/session-timeline-event.ts'
import type { TimelineEventKindValue } from '../domain/value-objects/session-timeline-event.ts'
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

export const AttendOutcome = Object.freeze({
  NO_MATCH: 'no-match',
  RECORDED: 'recorded',
  NOT_RECORDED: 'not-recorded',
} as const)

export type AttendOutcomeValue = (typeof AttendOutcome)[keyof typeof AttendOutcome]

export class AttendResult {
  readonly outcome: AttendOutcomeValue

  private constructor(outcome: AttendOutcomeValue) {
    this.outcome = outcome
    Object.freeze(this)
  }

  static noMatch(): AttendResult {
    return new AttendResult(AttendOutcome.NO_MATCH)
  }

  static recorded(): AttendResult {
    return new AttendResult(AttendOutcome.RECORDED)
  }

  static notRecorded(): AttendResult {
    return new AttendResult(AttendOutcome.NOT_RECORDED)
  }
}

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
  readonly records: ConversationRecords
  readonly newId: () => string
  readonly now: () => string
  #held: HeldCoordinatingSession | null
  #timeline: readonly SessionTimelineEvent[]
  #persisting: Promise<void>
  #stopFollowing: (() => void) | null
  readonly #opening: WorkInFlight

  constructor({
    liveSessions, stderr, records = new ConversationRecords(), newId = randomUUID, now = () => new Date().toISOString(),
  }: {
    liveSessions: LiveSessions, stderr: (line: string) => void,
    records?: ConversationRecords, newId?: () => string, now?: () => string,
  }) {
    this.liveSessions = liveSessions
    this.stderr = stderr
    this.records = records
    this.newId = newId
    this.now = now
    this.#held = null
    this.#timeline = []
    this.#persisting = Promise.resolve()
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

  remember(held: HeldCoordinatingSession, timeline: readonly SessionTimelineEvent[] = []): void {
    this.#opening.release(CoordinatingSessions.#OPENING)
    this.#stopFollowingTheHeldSession()
    this.#held = held
    this.#timeline = timeline
    if (held.state !== CoordinatingSessionState.LIVE) return
    this.#follow(held)
  }

  held(): HeldCoordinatingSession | null {
    return this.#held
  }

  timeline(): readonly SessionTimelineEvent[] {
    return this.#timeline
  }

  settled(): Promise<void> {
    return this.#persisting
  }

  async attend({ conversation, attention, event }: {
    conversation: string, attention: SessionAttention, event: TimelineEventKindValue,
  }): Promise<AttendResult> {
    const current = this.#live()
    if (current === null || current.conversation.id.text !== conversation) return AttendResult.noMatch()

    this.#held = new HeldCoordinatingSession({
      state: current.state,
      conversation: current.conversation,
      session: current.session,
      attention,
    })
    const recorded = await this.#record(current.conversation, event, attention.question)
    this.stderr(`coordinating session ${conversation} ${attention.status}\n`)

    return recorded ? AttendResult.recorded() : AttendResult.notRecorded()
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
    this.#record(conversation, TimelineEventKind.ENDED)
    this.stderr(`coordinating session ${conversation.id.text} ended\n`)
  }

  #record(conversation: CoordinatingConversation, kind: TimelineEventKindValue, detail: string | null = null): Promise<boolean> {
    const event = new SessionTimelineEvent({ id: this.newId(), kind, at: this.now(), detail })
    this.#timeline = [...this.#timeline, event]
    const attempted = this.#persisting.then(() => this.records.appendTimelineEvent({ conversation, event }))
    const settled = attempted.then(
      () => true,
      (cause) => {
        this.stderr(`coordinating session ${conversation.id.text}: timeline event not recorded: ${String(cause)}\n`)
        return false
      }
    )
    this.#persisting = settled.then(() => undefined)

    return settled
  }

  #stopFollowingTheHeldSession(): void {
    if (this.#stopFollowing === null) return
    this.#stopFollowing()
    this.#stopFollowing = null
  }
}
