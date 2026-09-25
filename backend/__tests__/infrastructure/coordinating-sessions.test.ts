import { describe, it, expect } from 'vitest'
import {
  AttendOutcome,
  CloseReservation,
  CoordinatingOperation,
  CoordinatingSessions,
  HeldCoordinatingSession,
  CoordinatingSessionState,
  OpeningReservation,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { LiveSessionNotLive, LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { CoordinatingConversationMother } from '../coordinating-conversation-mother.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'
import { CoordinatingSessionRecovery } from '../../src/infrastructure/coordinating-session-recovery.ts'
import { CoordinatingSessionRecovered } from '../../src/application/actions/recover-coordinating-session.ts'
import { ClosureStatus, SessionClosure } from '../../src/domain/value-objects/session-closure.ts'
import { SessionTerminationPermissionDenied } from '../../src/domain/exceptions.ts'
import { GroomReviewRefusal } from '../../src/domain/ports/groom-review-admission.ts'

class LiveSessionsDouble extends LiveSessions {
  readonly stopped: string[]
  readonly #open: Map<string, LiveSession>
  readonly #following: Map<string, () => void>

  private constructor(open: LiveSession[]) {
    super()
    this.stopped = []
    this.#open = new Map(open.map((session) => [session.id, session]))
    this.#following = new Map()
  }

  static holding(...open: LiveSession[]): LiveSessionsDouble {
    return new LiveSessionsDouble(open)
  }

  readonly written: Array<{ id: string, text: string }> = []

  find(id: string): LiveSession | null {
    return this.#open.get(id) ?? null
  }

  write({ session, text }: { session: LiveSession, text: string }): void {
    this.written.push({ id: session.id, text })
  }

  readonly submitted: Array<{ id: string, text: string }> = []
  submitFailure: Error | null = null

  async submit({ session, text }: { session: LiveSession, text: string }): Promise<void> {
    this.submitted.push({ id: session.id, text })
    if (this.submitFailure !== null) throw this.submitFailure
  }

  watch({ session, onEnded }: {
    session: LiveSession, onBytes: (bytes: string) => void, onEnded: () => void,
  }): LiveSessionStream {
    this.#following.set(session.id, onEnded)

    return {
      printed: '',
      stop: (): void => {
        this.stopped.push(session.id)
        this.#following.delete(session.id)
      },
    }
  }

  isFollowing(session: LiveSession): boolean {
    return this.#following.has(session.id)
  }

  exitCallback(session: LiveSession): () => void {
    const ended = this.#following.get(session.id)
    if (ended === undefined) throw new Error(`LiveSessionsDouble: nobody follows ${session.id}`)

    return ended
  }

  exits(session: LiveSession): void {
    this.#open.delete(session.id)
    const ended = this.#following.get(session.id)
    if (ended === undefined) throw new Error(`LiveSessionsDouble: nobody follows ${session.id}`)
    this.#following.delete(session.id)
    ended()
  }
}

class Mother {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly FIRST_SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })
  static readonly SECOND_SESSION = new LiveSession({ id: 'session-2', name: 'brainstorming' })
  static readonly FIRST_TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
  static readonly SECOND_TARGET = 'f910a470-13f7-4956-b750-bef89f55dd6d'

  static conversation(id: string): CoordinatingConversation {
    return CoordinatingConversationMother.of({
      id: new ConversationId(id),
      repository: Mother.REPOSITORY,
      root: Mother.ROOT,
    })
  }

  static readonly FIRST = Mother.conversation('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
  static readonly SECOND = Mother.conversation('7c3d5e1a-4b2f-4c6d-8e9a-1b2c3d4e5f6a')

  static live(conversation: CoordinatingConversation, session: LiveSession): HeldCoordinatingSession {
    return new HeldCoordinatingSession({
      target: conversation === Mother.FIRST ? Mother.FIRST_TARGET : Mother.SECOND_TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation,
      session,
      attention: SessionAttention.working(),
    })
  }
}

class RecordsDouble extends ConversationRecords {
  appended: { conversation: CoordinatingConversation, event: SessionTimelineEvent }[]
  overlapping: number
  #busy: boolean
  #delayMs: number
  #failing: Error | null

  constructor() {
    super()
    this.appended = []
    this.overlapping = 0
    this.#busy = false
    this.#delayMs = 0
    this.#failing = null
  }

  delayEachWriteBy(ms: number): void {
    this.#delayMs = ms
  }

  failNextWriteWith(cause: Error): void {
    this.#failing = cause
  }

  async appendTimelineEvent({ conversation, event }: {
    conversation: CoordinatingConversation, event: SessionTimelineEvent,
  }): Promise<void> {
    if (this.#busy) this.overlapping += 1
    this.#busy = true
    if (this.#delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.#delayMs))
    this.#busy = false
    if (this.#failing !== null) {
      const failure = this.#failing
      this.#failing = null
      throw failure
    }
    this.appended.push({ conversation, event })
  }
}

class Registry {
  static readonly EVENT_ID = 'timeline-event-1'
  static readonly AT = '2026-09-15T10:00:00.000Z'

  static of(liveSessions: LiveSessionsDouble): { held: CoordinatingSessions, said: string[], records: RecordsDouble } {
    const said: string[] = []
    const records = new RecordsDouble()
    let sequence = 0
    const newId = () => { sequence += 1; return `timeline-event-${sequence}` }

    return {
      held: new CoordinatingSessions({
        liveSessions, stderr: (line) => { said.push(line) }, records, newId, now: () => Registry.AT,
      }),
      said,
      records,
    }
  }
}

describe('CoordinatingSessions', () => {
  it('revokes groom admission as soon as a permission or a new turn is reported', async () => {
    const { held } = Registry.of(LiveSessionsDouble.holding(Mother.FIRST_SESSION))
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    const asking = { target: Mother.FIRST_TARGET, session: Mother.FIRST_SESSION }
    await held.attend({
      conversation: Mother.FIRST.id.text, attention: SessionAttention.waiting(null), event: TimelineEventKind.COMPLETED,
    })
    expect(held.refusalFor(asking)).toBe(null)

    const permission = held.attend({
      conversation: Mother.FIRST.id.text, attention: SessionAttention.waiting(null),
      event: TimelineEventKind.WAITING_FOR_PERMISSION,
    })

    expect(held.refusalFor(asking)).toBe(GroomReviewRefusal.AWAITING_PERMISSION)
    await permission
    await held.attend({
      conversation: Mother.FIRST.id.text, attention: SessionAttention.working(), event: TimelineEventKind.WORKING,
    })
    expect(held.refusalFor(asking)).toBe(GroomReviewRefusal.WORKING)
    await held.attend({
      conversation: Mother.FIRST.id.text, attention: SessionAttention.waiting(null), event: TimelineEventKind.RESUMED,
    })
    expect(held.refusalFor(asking)).toBe(GroomReviewRefusal.TURN_NOT_FINISHED)
  })

  it('revokes groom admission when its target closes, is replaced, or its terminal ends', async () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION, Mother.SECOND_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    const asking = { target: Mother.FIRST_TARGET, session: Mother.FIRST_SESSION }
    const identity = { target: Mother.FIRST_TARGET, conversation: Mother.FIRST.id.text }
    await held.attend({
      conversation: Mother.FIRST.id.text, attention: SessionAttention.waiting(null), event: TimelineEventKind.COMPLETED,
    })
    expect(held.refusalFor(asking)).toBe(null)
    expect(held.refusalFor({ ...asking, session: Mother.SECOND_SESSION })).toBe(GroomReviewRefusal.NOT_LIVE)

    held.beginClose(identity)
    expect(held.refusalFor(asking)).toBe(GroomReviewRefusal.BUSY)
    held.failClose(identity, { code: 'session-not-terminated', detail: 'still live' })
    expect(held.refusalFor(asking)).toBe(GroomReviewRefusal.BUSY)
    held.beginClose(identity)
    held.finishClose(identity)
    expect(held.refusalFor(asking)).toBe(GroomReviewRefusal.TARGET_CHANGED)
    held.remember(Mother.live(Mother.SECOND, Mother.SECOND_SESSION))
    expect(held.refusalFor(asking)).toBe(GroomReviewRefusal.TARGET_CHANGED)
    liveSessions.exits(Mother.SECOND_SESSION)
    expect(held.refusalFor({ target: Mother.SECOND_TARGET, session: Mother.SECOND_SESSION }))
      .toBe(GroomReviewRefusal.NOT_LIVE)
    await held.settled()
  })

  it('projects a recovered permission failure with its specific diagnostic', () => {
    const sessions = new CoordinatingSessions({
      liveSessions: LiveSessionsDouble.holding(),
      stderr: () => {},
      newTarget: () => Mother.FIRST_TARGET,
    })
    const conversation = Mother.conversation('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
    const closure = new SessionClosure({
      conversation: conversation.id,
      target: Mother.FIRST_TARGET,
      session: 'saved-session',
      processGroup: 4101,
      status: ClosureStatus.REQUESTED,
    })
    const failure = new SessionTerminationPermissionDenied('saved group cannot be inspected')

    CoordinatingSessionRecovery.remember(
      CoordinatingSessionRecovered.interrupted(conversation, closure, failure),
      sessions,
      () => {},
    )

    expect(sessions.operation()).toBe(CoordinatingOperation.CLOSE_FAILED)
    expect(sessions.closureError()).toEqual({
      code: 'session-termination-permission-denied',
      detail: failure.message,
    })
  })
  it('holds as ended the live session whose terminal exits', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held, said } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    liveSessions.exits(Mother.FIRST_SESSION)

    const holding = held.held()
    expect(holding?.state).toBe('ended')
    expect(holding?.conversation).toBe(Mother.FIRST)
    expect(holding?.session).toBeNull()
    expect(holding?.attention).toBeNull()
    expect(said).toContain(`coordinating session ${Mother.FIRST.id.text} ended\n`)
  })

  it('holds as ended a session that is no longer open when it is remembered', () => {
    const liveSessions = LiveSessionsDouble.holding()
    const { held } = Registry.of(liveSessions)

    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    expect(held.held()?.state).toBe('ended')
  })

  it('refuses to attend a conversation that has ended', async () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    liveSessions.exits(Mother.FIRST_SESSION)

    const attended = await held.attend({
      conversation: Mother.FIRST.id.text,
      attention: SessionAttention.waiting('are you still there?'),
      event: TimelineEventKind.WAITING_FOR_PERMISSION,
    })

    expect(attended.outcome).toBe(AttendOutcome.NO_MATCH)
    expect(held.held()?.attention).toBeNull()
  })

  it('stops following the previous session when a new one is remembered', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION, Mother.SECOND_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    held.remember(Mother.live(Mother.SECOND, Mother.SECOND_SESSION))

    expect(liveSessions.stopped).toEqual([Mother.FIRST_SESSION.id])
    expect(liveSessions.isFollowing(Mother.FIRST_SESSION)).toBe(false)
    expect(liveSessions.isFollowing(Mother.SECOND_SESSION)).toBe(true)
  })

  it('follows no session for a conversation Claude Code no longer holds', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)

    held.remember(new HeldCoordinatingSession({
      target: Mother.FIRST_TARGET,
      state: CoordinatingSessionState.UNRESUMABLE,
      conversation: Mother.FIRST,
      session: null,
      attention: null,
    }))

    expect(liveSessions.isFollowing(Mother.FIRST_SESSION)).toBe(false)
    expect(held.held()?.state).toBe('unresumable')
  })

  it('reserves the opening while nothing is held', () => {
    const { held } = Registry.of(LiveSessionsDouble.holding())

    expect(held.reserve().outcome).toBe(OpeningReservation.RESERVED)
  })

  it('refuses to reserve a second opening while the first has not been closed', () => {
    const { held } = Registry.of(LiveSessionsDouble.holding())
    held.reserve()

    expect(held.reserve().outcome).toBe(OpeningReservation.OPENING_IN_PROGRESS)
  })

  it('refuses to reserve an opening once a live session is remembered, and says which', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)
    held.reserve()
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    const reserved = held.reserve()

    expect(reserved.outcome).toBe(OpeningReservation.LIVE_HELD)
    expect(reserved.live?.conversation).toBe(Mother.FIRST)
    expect(reserved.live?.session).toBe(Mother.FIRST_SESSION)
  })

  it('reserves the opening again once a reservation is released', () => {
    const { held } = Registry.of(LiveSessionsDouble.holding())
    held.reserve()

    held.release()

    expect(held.reserve().outcome).toBe(OpeningReservation.RESERVED)
  })

  it('reserves the opening over a conversation whose terminal exited', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    liveSessions.exits(Mother.FIRST_SESSION)

    expect(held.reserve().outcome).toBe(OpeningReservation.RESERVED)
  })

  it('reserves the opening over a conversation Claude Code no longer holds', () => {
    const { held } = Registry.of(LiveSessionsDouble.holding())
    held.remember(new HeldCoordinatingSession({
      target: Mother.FIRST_TARGET,
      state: CoordinatingSessionState.UNRESUMABLE,
      conversation: Mother.FIRST,
      session: null,
      attention: null,
    }))

    expect(held.reserve().outcome).toBe(OpeningReservation.RESERVED)
  })

  it('moves the attention of the live conversation it holds', async () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held, said } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    const attended = await held.attend({
      conversation: Mother.FIRST.id.text,
      attention: SessionAttention.waiting('which of the two screens do you mean?'),
      event: TimelineEventKind.WAITING_FOR_PERMISSION,
    })

    expect(attended.outcome).toBe(AttendOutcome.RECORDED)
    expect(held.held()?.attention).toEqual(SessionAttention.waiting('which of the two screens do you mean?'))
    expect(said).toContain(`coordinating session ${Mother.FIRST.id.text} waiting\n`)
  })

  it('starts with no timeline until a conversation is remembered', () => {
    const { held } = Registry.of(LiveSessionsDouble.holding())

    expect(held.timeline()).toEqual([])
  })

  it('holds the timeline it was remembered with', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)
    const seed = [
      new SessionTimelineEvent({ id: 'seed-1', kind: TimelineEventKind.OPENED, at: '2026-09-15T09:00:00.000Z', detail: null }),
    ]

    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION), seed)

    expect(held.timeline()).toEqual(seed)
  })

  it('appends and persists a timeline event when the attention moves', async () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held, records } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    held.attend({
      conversation: Mother.FIRST.id.text,
      attention: SessionAttention.waiting('which screen?'),
      event: TimelineEventKind.WAITING_FOR_PERMISSION,
    })
    await held.settled()

    const created = new SessionTimelineEvent({
      id: Registry.EVENT_ID, kind: TimelineEventKind.WAITING_FOR_PERMISSION, at: Registry.AT, detail: 'which screen?',
    })
    expect(held.timeline()).toEqual([created])
    expect(records.appended).toEqual([{ conversation: Mother.FIRST, event: created }])
  })

  it('appends and persists an ended event when the terminal exits', async () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held, records } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    liveSessions.exits(Mother.FIRST_SESSION)
    await held.settled()

    const created = new SessionTimelineEvent({
      id: Registry.EVENT_ID, kind: TimelineEventKind.ENDED, at: Registry.AT, detail: null,
    })
    expect(held.timeline()).toEqual([created])
    expect(records.appended).toEqual([{ conversation: Mother.FIRST, event: created }])
  })

  it('persists concurrent events one at a time, in the order they happened', async () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held, records } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    records.delayEachWriteBy(10)

    held.attend({
      conversation: Mother.FIRST.id.text,
      attention: SessionAttention.waiting('first?'),
      event: TimelineEventKind.WAITING_FOR_PERMISSION,
    })
    held.attend({
      conversation: Mother.FIRST.id.text,
      attention: SessionAttention.working(),
      event: TimelineEventKind.WORKING,
    })
    await held.settled()

    expect(records.overlapping).toBe(0)
    expect(records.appended.map(({ event }) => event.kind)).toEqual([
      TimelineEventKind.WAITING_FOR_PERMISSION, TimelineEventKind.WORKING,
    ])
    expect(held.timeline().map((event) => event.kind)).toEqual([
      TimelineEventKind.WAITING_FOR_PERMISSION, TimelineEventKind.WORKING,
    ])
  })

  it('persists the next event even after a previous one failed to persist', async () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held, records, said } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    records.failNextWriteWith(new Error('disk is full'))

    held.attend({
      conversation: Mother.FIRST.id.text,
      attention: SessionAttention.waiting('first?'),
      event: TimelineEventKind.WAITING_FOR_PERMISSION,
    })
    held.attend({
      conversation: Mother.FIRST.id.text,
      attention: SessionAttention.working(),
      event: TimelineEventKind.WORKING,
    })
    await held.settled()

    expect(records.appended.map(({ event }) => event.kind)).toEqual([TimelineEventKind.WORKING])
    expect(held.timeline().map((event) => event.kind)).toEqual([
      TimelineEventKind.WAITING_FOR_PERMISSION, TimelineEventKind.WORKING,
    ])
    expect(said.some((line) => line.includes('timeline event not recorded'))).toBe(true)
  })

  it('opening and closing reserve the same slot before any asynchronous work', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    liveSessions.exits(Mother.FIRST_SESSION)

    expect(held.reserve().outcome).toBe(OpeningReservation.RESERVED)
    expect(held.beginClose({ conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET }).outcome)
      .toBe(CloseReservation.OPENING)
    held.release()

    expect(held.beginClose({ conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET }).outcome)
      .toBe(CloseReservation.RESERVED)
    expect(held.operation()).toBe(CoordinatingOperation.CLOSING)
    expect(held.reserve().outcome).toBe(OpeningReservation.LIVE_HELD)

    held.failClose(
      { conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET },
      { code: 'session-not-terminated', detail: 'the process group is still present' },
    )
    expect(held.operation()).toBe(CoordinatingOperation.CLOSE_FAILED)
    expect(held.reserve().outcome).toBe(OpeningReservation.LIVE_HELD)
  })

  it('old exit and attention callbacks cannot replace or repopulate a newer target', async () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION, Mother.SECOND_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    const firstTimeline = held.timeline()
    const oldExit = liveSessions.exitCallback(Mother.FIRST_SESSION)

    held.remember(Mother.live(Mother.SECOND, Mother.SECOND_SESSION))
    oldExit()
    const attended = await held.attend({
      conversation: Mother.FIRST.id.text,
      attention: SessionAttention.waiting('old question'),
      event: TimelineEventKind.WAITING_FOR_PERMISSION,
    })

    expect(attended.outcome).toBe(AttendOutcome.NO_MATCH)
    expect(held.held()?.target).toBe(Mother.SECOND_TARGET)
    expect(held.held()?.state).toBe(CoordinatingSessionState.LIVE)
    expect(held.timeline()).not.toBe(firstTimeline)
    expect(held.timeline()).toEqual([])
  })

  it('duplicate closes join while ended and unresumable targets remain explicitly closeable', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    liveSessions.exits(Mother.FIRST_SESSION)

    const first = held.beginClose({ conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET })
    const closing = Promise.resolve()
    held.trackClose({ conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET }, closing)
    const duplicate = held.beginClose({ conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET })

    expect(first.outcome).toBe(CloseReservation.RESERVED)
    expect(duplicate.outcome).toBe(CloseReservation.JOINED)
    expect(duplicate.closing).toBe(closing)

    held.failClose(
      { conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET },
      { code: 'session-closure-not-recorded', detail: 'disk is full' },
    )
    expect(held.beginClose({ conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET }).outcome)
      .toBe(CloseReservation.RESERVED)
  })

  it('root exit during closure keeps the slot occupied until durable completion', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    const identity = { conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET }

    expect(held.beginClose(identity).outcome).toBe(CloseReservation.RESERVED)
    held.trackClose(identity, Promise.resolve())
    liveSessions.exits(Mother.FIRST_SESSION)

    expect(held.operation()).toBe(CoordinatingOperation.CLOSING)
    expect(held.held()?.state).toBe(CoordinatingSessionState.ENDED)
    expect(held.reserve().outcome).toBe(OpeningReservation.LIVE_HELD)

    expect(held.finishClose(identity)).toBe(true)
    expect(held.reserve().outcome).toBe(OpeningReservation.RESERVED)
  })
  it('reads the gates of the checkout it holds, and of the one it closed with no target', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    const identity = { conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET }

    const holding = held.gateCheckout()
    expect(holding?.conversation).toBe(Mother.FIRST)
    expect(holding?.target).toBe(Mother.FIRST_TARGET)

    held.beginClose(identity)
    held.finishClose(identity)

    const closed = held.gateCheckout()
    expect(closed?.conversation).toBe(Mother.FIRST)
    expect(closed?.target).toBe(null)
    expect(held.isCurrentCheckout(closed!)).toBe(true)
    expect(held.isCurrentCheckout(holding!)).toBe(false)
  })

  it('reads no gates before a conversation is ever held', () => {
    const { held } = Registry.of(LiveSessionsDouble.holding(Mother.FIRST_SESSION))

    expect(held.gateCheckout()).toBe(null)
  })

  it('a newly remembered conversation replaces the checkout the closed one left', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION, Mother.SECOND_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    const identity = { conversation: Mother.FIRST.id.text, target: Mother.FIRST_TARGET }
    held.beginClose(identity)
    held.finishClose(identity)

    held.remember(Mother.live(Mother.SECOND, Mother.SECOND_SESSION))

    expect(held.gateCheckout()?.conversation).toBe(Mother.SECOND)
    expect(held.gateCheckout()?.target).toBe(Mother.SECOND_TARGET)
  })

  it('an_announcement_reaches_the_live_coordinating_session_as_a_submitted_line', async () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const sessions = new CoordinatingSessions({
      liveSessions,
      stderr: () => {},
      newTarget: () => Mother.FIRST_TARGET,
    })
    sessions.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    expect(await sessions.announce('the held change went out')).toBe(true)
    expect(liveSessions.submitted).toEqual([{ id: Mother.FIRST_SESSION.id, text: 'the held change went out' }])
    expect(liveSessions.written).toEqual([])
  })

  it('an_announcement_whose_enter_never_reaches_the_session_is_not_reported_as_delivered', async () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    liveSessions.submitFailure = new LiveSessionNotLive(Mother.FIRST_SESSION.id)
    const sessions = new CoordinatingSessions({
      liveSessions,
      stderr: () => {},
      newTarget: () => Mother.FIRST_TARGET,
    })
    sessions.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    await expect(sessions.announce('the held change went out')).rejects.toThrow(LiveSessionNotLive)
  })

  it('an_announcement_with_nobody_to_hear_it_is_refused_rather_than_written_into_the_void', async () => {
    const liveSessions = LiveSessionsDouble.holding()
    const sessions = new CoordinatingSessions({
      liveSessions,
      stderr: () => {},
      newTarget: () => Mother.FIRST_TARGET,
    })

    expect(await sessions.announce('nobody is listening')).toBe(false)
    expect(liveSessions.written).toEqual([])
  })
})
