import { randomUUID } from 'node:crypto'
import { ConversationRecords } from '../domain/ports/conversation-records.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../domain/value-objects/session-timeline-event.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import type { TimelineEventKindValue } from '../domain/value-objects/session-timeline-event.ts'
import type { LiveSessions } from '../domain/ports/live-sessions.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { CoordinatingConversation } from '../domain/value-objects/coordinating-conversation.ts'
import type { LiveSession } from '../domain/value-objects/live-session.ts'
import type { SessionAttention } from '../domain/value-objects/session-attention.ts'
import { AttentionStatus } from '../domain/value-objects/session-attention.ts'
import { GroomReviewRefusal } from '../domain/ports/groom-review-admission.ts'
import type { GroomReviewAdmission, GroomReviewRefusalValue } from '../domain/ports/groom-review-admission.ts'

export const CoordinatingSessionState = Object.freeze({
  LIVE: 'live',
  UNRESUMABLE: 'unresumable',
  ENDED: 'ended',
} as const)

export type CoordinatingSessionStateValue = (typeof CoordinatingSessionState)[keyof typeof CoordinatingSessionState]

export const CoordinatingOperation = Object.freeze({
  IDLE: 'idle',
  RECOVERING: 'recovering',
  OPENING: 'opening',
  CLOSING: 'closing',
  CLOSE_FAILED: 'close-failed',
} as const)

export type CoordinatingOperationValue = (typeof CoordinatingOperation)[keyof typeof CoordinatingOperation]

export type CoordinatingSessionIdentity = { readonly conversation: string, readonly target: string }

export class CoordinatingClosureError {
  readonly code: string
  readonly detail: string

  constructor({ code, detail }: { code: string, detail: string }) {
    this.code = code
    this.detail = detail
    Object.freeze(this)
  }
}

export class HeldCoordinatingSession {
  readonly target: string
  readonly state: CoordinatingSessionStateValue
  readonly conversation: CoordinatingConversation
  readonly session: LiveSession | null
  readonly terminal: LiveSession | null
  readonly attention: SessionAttention | null

  constructor({ target, state, conversation, session, terminal, attention }: {
    target: string,
    state: CoordinatingSessionStateValue,
    conversation: CoordinatingConversation,
    session: LiveSession | null,
    terminal?: LiveSession | null,
    attention: SessionAttention | null,
  }) {
    if (!ConversationId.isWellFormed(target)) {
      throw new Error(`a coordinating target must be a UUID, got ${JSON.stringify(target)}`)
    }
    this.target = target
    this.state = state
    this.conversation = conversation
    this.session = session
    this.terminal = terminal === undefined ? session : terminal
    this.attention = attention
    Object.freeze(this)
  }

  static ended(held: HeldCoordinatingSession): HeldCoordinatingSession {
    return new HeldCoordinatingSession({
      target: held.target,
      state: CoordinatingSessionState.ENDED,
      conversation: held.conversation,
      session: null,
      terminal: held.terminal,
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

export const CloseReservation = Object.freeze({
  RESERVED: 'reserved',
  JOINED: 'joined',
  TARGET_CHANGED: 'target-changed',
  OPENING: 'opening',
} as const)

export type CloseReservationValue = (typeof CloseReservation)[keyof typeof CloseReservation]

export class ReservedClosure {
  readonly outcome: CloseReservationValue
  readonly held: HeldCoordinatingSession | null
  readonly closing: Promise<unknown> | null

  private constructor({ outcome, held, closing }: {
    outcome: CloseReservationValue, held: HeldCoordinatingSession | null, closing: Promise<unknown> | null,
  }) {
    this.outcome = outcome
    this.held = held
    this.closing = closing
    Object.freeze(this)
  }

  static reserved(held: HeldCoordinatingSession): ReservedClosure {
    return new ReservedClosure({ outcome: CloseReservation.RESERVED, held, closing: null })
  }

  static joined(held: HeldCoordinatingSession, closing: Promise<unknown>): ReservedClosure {
    return new ReservedClosure({ outcome: CloseReservation.JOINED, held, closing })
  }

  static targetChanged(): ReservedClosure {
    return new ReservedClosure({ outcome: CloseReservation.TARGET_CHANGED, held: null, closing: null })
  }

  static opening(): ReservedClosure {
    return new ReservedClosure({ outcome: CloseReservation.OPENING, held: null, closing: null })
  }
}

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

export class GateCheckout {
  readonly conversation: CoordinatingConversation
  readonly target: string | null

  constructor({ conversation, target }: { conversation: CoordinatingConversation, target: string | null }) {
    this.conversation = conversation
    this.target = target
    Object.freeze(this)
  }
}

export class CoordinatingSessions implements GroomReviewAdmission {
  static readonly SUBMIT = '\r'

  readonly liveSessions: LiveSessions
  readonly stderr: (line: string) => void
  readonly records: ConversationRecords
  readonly newId: () => string
  readonly now: () => string
  readonly newTarget: () => string
  #held: HeldCoordinatingSession | null
  #timeline: readonly SessionTimelineEvent[]
  #persisting: Promise<void>
  #stopFollowing: (() => void) | null
  #operation: CoordinatingOperationValue
  #closureError: CoordinatingClosureError | null
  #closing: Promise<unknown> | null
  #closed: CoordinatingConversation | null

  constructor({
    liveSessions,
    stderr,
    records = new ConversationRecords(),
    newId = randomUUID,
    newTarget = randomUUID,
    now = () => new Date().toISOString(),
  }: {
    liveSessions: LiveSessions, stderr: (line: string) => void,
    records?: ConversationRecords, newId?: () => string, newTarget?: () => string, now?: () => string,
  }) {
    this.liveSessions = liveSessions
    this.stderr = stderr
    this.records = records
    this.newId = newId
    this.newTarget = newTarget
    this.now = now
    this.#held = null
    this.#timeline = []
    this.#persisting = Promise.resolve()
    this.#stopFollowing = null
    this.#operation = CoordinatingOperation.IDLE
    this.#closureError = null
    this.#closing = null
    this.#closed = null
  }

  reserve(): ReservedOpening {
    if (this.#operation === CoordinatingOperation.OPENING || this.#operation === CoordinatingOperation.RECOVERING) {
      return ReservedOpening.openingInProgress()
    }
    if (this.#operation === CoordinatingOperation.CLOSING || this.#operation === CoordinatingOperation.CLOSE_FAILED) {
      return ReservedOpening.liveHeld(this.#held!)
    }
    const live = this.#live()
    if (live !== null) return ReservedOpening.liveHeld(live)
    this.#operation = CoordinatingOperation.OPENING

    return ReservedOpening.reserved()
  }

  release(): void {
    if (this.#operation === CoordinatingOperation.OPENING) this.#operation = CoordinatingOperation.IDLE
  }

  beginRecovery(): void {
    if (this.#operation !== CoordinatingOperation.IDLE) {
      throw new Error(`coordinating recovery cannot begin while ${this.#operation}`)
    }
    this.#operation = CoordinatingOperation.RECOVERING
  }

  finishRecoveryWithoutSession(): void {
    if (this.#operation !== CoordinatingOperation.RECOVERING) {
      throw new Error(`coordinating recovery cannot finish while ${this.#operation}`)
    }
    this.#held = null
    this.#timeline = []
    this.#operation = CoordinatingOperation.IDLE
  }

  mintTarget(): string {
    const target = this.newTarget()
    if (!ConversationId.isWellFormed(target)) {
      throw new Error(`a coordinating target must be a UUID, got ${JSON.stringify(target)}`)
    }

    return target
  }

  remember(held: HeldCoordinatingSession, timeline: readonly SessionTimelineEvent[] = []): void {
    this.#stopFollowingTheHeldSession()
    this.#closed = null
    this.#held = held
    this.#timeline = timeline
    this.#operation = CoordinatingOperation.IDLE
    this.#closureError = null
    this.#closing = null
    if (held.state !== CoordinatingSessionState.LIVE) return
    this.#follow(held)
  }

  rememberFailedClosure(
    held: HeldCoordinatingSession,
    error: CoordinatingClosureError,
    timeline: readonly SessionTimelineEvent[] = [],
  ): void {
    this.#stopFollowingTheHeldSession()
    this.#closed = null
    this.#held = held
    this.#timeline = timeline
    this.#operation = CoordinatingOperation.CLOSE_FAILED
    this.#closureError = error
    this.#closing = null
  }

  held(): HeldCoordinatingSession | null {
    return this.#held
  }

  timeline(): readonly SessionTimelineEvent[] {
    return this.#timeline
  }

  operation(): CoordinatingOperationValue {
    return this.#operation
  }

  closureError(): CoordinatingClosureError | null {
    return this.#closureError
  }

  refusalFor({ target, session }: { target: string, session: LiveSession }): GroomReviewRefusalValue | null {
    const current = this.#held
    if (current === null || current.target !== target) return GroomReviewRefusal.TARGET_CHANGED
    if (this.#operation !== CoordinatingOperation.IDLE) return GroomReviewRefusal.BUSY
    if (current.state !== CoordinatingSessionState.LIVE || current.session?.id !== session.id) {
      return GroomReviewRefusal.NOT_LIVE
    }
    const reported = this.#timeline.at(-1)?.kind
    if (reported === TimelineEventKind.WAITING_FOR_PERMISSION) return GroomReviewRefusal.AWAITING_PERMISSION
    if (current.attention === null || current.attention.status === AttentionStatus.WORKING) {
      return GroomReviewRefusal.WORKING
    }
    if (reported !== TimelineEventKind.COMPLETED) return GroomReviewRefusal.TURN_NOT_FINISHED

    return null
  }

  gateCheckout(): GateCheckout | null {
    if (this.#held !== null) {
      return new GateCheckout({ conversation: this.#held.conversation, target: this.#held.target })
    }
    if (this.#closed === null) return null

    return new GateCheckout({ conversation: this.#closed, target: null })
  }

  isCurrentCheckout(checkout: GateCheckout): boolean {
    const current = this.gateCheckout()
    if (current === null) return false

    return current.target === checkout.target && current.conversation.root.text === checkout.conversation.root.text
  }

  planStartedIn(root: CheckoutRoot): void {
    if (this.#closed === null || this.#closed.root.text === root.text) return
    this.#closed = null
  }

  beginClose(identity: CoordinatingSessionIdentity): ReservedClosure {
    if (this.#operation === CoordinatingOperation.OPENING || this.#operation === CoordinatingOperation.RECOVERING) {
      return ReservedClosure.opening()
    }
    if (!this.#matches(identity)) return ReservedClosure.targetChanged()
    if (this.#operation === CoordinatingOperation.CLOSING) {
      if (this.#closing === null) throw new Error('a coordinating close has no in-flight promise')
      return ReservedClosure.joined(this.#held!, this.#closing)
    }
    this.#operation = CoordinatingOperation.CLOSING
    this.#closureError = null

    return ReservedClosure.reserved(this.#held!)
  }

  trackClose(identity: CoordinatingSessionIdentity, closing: Promise<unknown>): void {
    if (!this.#matches(identity) || this.#operation !== CoordinatingOperation.CLOSING || this.#closing !== null) {
      throw new Error(`cannot track closure for coordinating target ${identity.target}`)
    }
    this.#closing = closing
  }

  finishClose(identity: CoordinatingSessionIdentity): boolean {
    if (!this.#matches(identity) || this.#operation !== CoordinatingOperation.CLOSING) return false
    this.#stopFollowingTheHeldSession()
    this.#closed = this.#held!.conversation
    this.#held = null
    this.#timeline = []
    this.#operation = CoordinatingOperation.IDLE
    this.#closureError = null
    this.#closing = null

    return true
  }

  failClose(identity: CoordinatingSessionIdentity, error: { readonly code: string, readonly detail: string }): boolean {
    if (!this.#matches(identity) || this.#operation !== CoordinatingOperation.CLOSING) return false
    this.#operation = CoordinatingOperation.CLOSE_FAILED
    this.#closureError = new CoordinatingClosureError(error)
    this.#closing = null

    return true
  }

  settled(): Promise<void> {
    return this.#persisting
  }

  async attend({ conversation, attention, event }: {
    conversation: string, attention: SessionAttention, event: TimelineEventKindValue,
  }): Promise<AttendResult> {
    if (this.#operation !== CoordinatingOperation.IDLE) return AttendResult.noMatch()
    const current = this.#live()
    if (current === null || current.conversation.id.text !== conversation) return AttendResult.noMatch()

    this.#held = new HeldCoordinatingSession({
      target: current.target,
      state: current.state,
      conversation: current.conversation,
      session: current.session,
      terminal: current.terminal,
      attention,
    })
    const recorded = await this.#record(current.conversation, event, attention.question)
    this.stderr(`coordinating session ${conversation} ${attention.status}\n`)

    return recorded ? AttendResult.recorded() : AttendResult.notRecorded()
  }

  announce(line: string): boolean {
    const held = this.#live()
    if (held === null || held.session === null) return false
    const session = this.liveSessions.find(held.session.id)
    if (session === null) return false
    this.liveSessions.write({ session, text: `${line}${CoordinatingSessions.SUBMIT}` })

    return true
  }

  #live(): HeldCoordinatingSession | null {
    return this.#held !== null && this.#held.state === CoordinatingSessionState.LIVE ? this.#held : null
  }

  #follow(held: HeldCoordinatingSession): void {
    const session = this.liveSessions.find(held.session!.id)
    if (session === null) {
      this.#ended(held.target)
      return
    }
    const { stop } = this.liveSessions.watch({
      session,
      onBytes: (): void => {},
      onEnded: (): void => this.#ended(held.target),
    })
    this.#stopFollowing = stop
  }

  #ended(target: string): void {
    if (this.#held?.target !== target) return
    this.#stopFollowing = null
    const ended = HeldCoordinatingSession.ended(this.#held)
    this.#held = ended
    this.#record(ended.conversation, TimelineEventKind.ENDED)
    this.stderr(`coordinating session ${ended.conversation.id.text} ended\n`)
  }

  #matches(identity: CoordinatingSessionIdentity): boolean {
    return this.#held?.conversation.id.text === identity.conversation && this.#held.target === identity.target
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
