import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { RunningServers } from '../servers.ts'
import { Browsers } from '../../src/infrastructure/http.ts'
import { GateKey } from '../../src/infrastructure/gate-key.ts'
import { CoordinatingSessionTarget } from '../../src/infrastructure/coordinating-session-target.ts'
import { GroomSessionRoute, GroomSessionOutcome } from '../../src/infrastructure/groom-session-route.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState,
} from '../../src/infrastructure/coordinating-sessions.ts'
import {
  OpenGroomSession, OpenGroomSessionParams, GroomSessionOpened,
} from '../../src/application/actions/open-groom-session.ts'
import {
  AskGroomReview, AskGroomReviewParams, GroomReviewAsk, GroomReviewAsked,
} from '../../src/application/actions/ask-groom-review.ts'
import { LiveSessionNotLive } from '../../src/domain/ports/live-sessions.ts'
import { CoordinatingOperation } from '../../src/infrastructure/coordinating-sessions.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { Conversations } from '../../src/domain/ports/conversations.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { SessionHooks } from '../../src/domain/ports/session-hooks.ts'
import { ConversationNotStarted } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { CoordinatingConversationMother } from '../coordinating-conversation-mother.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'
import { SessionHooksRoute } from '../../src/infrastructure/session-hooks-route.ts'
import { JsonBody } from '../../src/infrastructure/http.ts'
import { GroomReviewAdmission, GroomReviewRefusal } from '../../src/domain/ports/groom-review-admission.ts'

class OpenGroomSessionSpy extends OpenGroomSession {
  readonly asked: OpenGroomSessionParams[]
  readonly answer: () => Promise<GroomSessionOpened>

  constructor(answer: () => Promise<GroomSessionOpened>) {
    super({
      specs: new EpicSpecs(),
      conversations: new Conversations(),
      sessionHooks: new SessionHooks(),
      records: new ConversationRecords(),
    })
    this.asked = []
    this.answer = answer
  }

  static opening(): OpenGroomSessionSpy {
    return new OpenGroomSessionSpy(
      async () => GroomSessionOpened.opened(Mother.CONVERSATION, Mother.SESSION, Mother.TIMELINE)
    )
  }

  static withNoSpec(): OpenGroomSessionSpy {
    return new OpenGroomSessionSpy(async () => GroomSessionOpened.noSpec())
  }

  static collapsing(): OpenGroomSessionSpy {
    return new OpenGroomSessionSpy(async () => {
      throw new ConversationNotStarted('claude could not be spawned in /repo: no pty')
    })
  }

  async execute(params: OpenGroomSessionParams): Promise<GroomSessionOpened> {
    this.asked.push(params)

    return this.answer()
  }
}

class AskGroomReviewSpy extends AskGroomReview {
  readonly asked: AskGroomReviewParams[]
  readonly answer: () => Promise<GroomReviewAsked>

  constructor(answer: () => Promise<GroomReviewAsked>) {
    super({ specs: new EpicSpecs(), liveSessions: new LiveSessions(), admission: new GroomReviewAdmission() })
    this.asked = []
    this.answer = answer
  }

  static asking(): AskGroomReviewSpy {
    return new AskGroomReviewSpy(async () => GroomReviewAsked.asked())
  }

  static withNoSpec(): AskGroomReviewSpy {
    return new AskGroomReviewSpy(async () => GroomReviewAsked.noSpec())
  }

  static withNoPty(): AskGroomReviewSpy {
    return new AskGroomReviewSpy(async () => { throw new LiveSessionNotLive(Mother.SESSION.id) })
  }

  async execute(params: AskGroomReviewParams): Promise<GroomReviewAsked> {
    this.asked.push(params)

    return this.answer()
  }
}

class LiveSessionsDouble extends LiveSessions {
  find(id: string): LiveSession | null {
    return id === Mother.SESSION.id ? Mother.SESSION : null
  }

  watch(): LiveSessionStream {
    return { printed: '', stop: (): void => {} }
  }
}

class RecordsDouble extends ConversationRecords {
  async appendTimelineEvent(_asked: {
    conversation: CoordinatingConversation, event: SessionTimelineEvent,
  }): Promise<void> {}
}

class Keys {
  static readonly MINTED = '07'.repeat(GateKey.BYTES)
  static readonly FROM_ANOTHER_RUN = '09'.repeat(GateKey.BYTES)

  static minted(): GateKey {
    return new GateKey({ random: (size: number) => Buffer.alloc(size, 0x07) })
  }
}

class Mother {
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
  static readonly OLD_TARGET = 'f135ce89-e980-4fa3-a02d-44dd12228304'
  static readonly NEXT_TARGET = 'f910a470-13f7-4956-b750-bef89f55dd6d'
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly CONVERSATION = CoordinatingConversationMother.of({
    id: new ConversationId('9c3f1b7e-4d2a-4c8b-9a3e-6f2b1a6c2e8f'),
    repository: Mother.REPOSITORY,
    root: Mother.ROOT,
  })

  static readonly SESSION = new LiveSession({ id: 'session-9', name: 'brainstorming' })
  static readonly TIMELINE = [
    new SessionTimelineEvent({
      id: 'groom-opened', kind: TimelineEventKind.OPENED, at: '2026-09-15T10:00:00.000Z', detail: null,
    }),
  ]

  static registry(): CoordinatingSessions {
    return new CoordinatingSessions({
      liveSessions: new LiveSessionsDouble(),
      stderr: (): void => {},
      newTarget: () => Mother.NEXT_TARGET,
      records: new RecordsDouble(),
      newId: () => 'timeline-event',
      now: () => '2026-09-15T10:00:00.000Z',
    })
  }

  static ended(): CoordinatingSessions {
    const held = Mother.registry()
    held.remember(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.ENDED,
      conversation: Mother.CONVERSATION,
      session: null,
      attention: null,
    }))

    return held
  }

  static live(): CoordinatingSessions {
    const held = Mother.registry()
    held.remember(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    }))

    return held
  }

  static readonly PERMISSION_QUESTION = 'Claude needs your permission to use Bash'

  static liveWith(
    attention: SessionAttention, timeline: readonly SessionTimelineEvent[] = Mother.TIMELINE
  ): CoordinatingSessions {
    const held = Mother.registry()
    held.remember(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention,
    }), timeline)

    return held
  }

  static event(kind: typeof TimelineEventKind[keyof typeof TimelineEventKind]): SessionTimelineEvent {
    return new SessionTimelineEvent({ id: `event-${kind}`, kind, at: '2026-09-15T10:00:00.000Z', detail: null })
  }

  static completed(): CoordinatingSessions {
    return Mother.liveWith(SessionAttention.waiting(null), [Mother.event(TimelineEventKind.COMPLETED)])
  }

  static awaitingPermission(): CoordinatingSessions {
    return Mother.liveWith(
      SessionAttention.waiting(Mother.PERMISSION_QUESTION),
      [Mother.event(TimelineEventKind.WAITING_FOR_PERMISSION)],
    )
  }

  static resumed(): CoordinatingSessions {
    return Mother.liveWith(SessionAttention.waiting(null), [Mother.event(TimelineEventKind.RESUMED)])
  }

  static failedClose(): CoordinatingSessions {
    const held = Mother.live()
    const identity = { conversation: Mother.CONVERSATION.id.text, target: Mother.TARGET }
    held.beginClose(identity)
    held.failClose(identity, { code: 'session-not-terminated', detail: 'group still exists' })
    return held
  }
}

class RunningApi {
  static readonly PATH = GroomSessionRoute.PATH

  static async listening(
    held: CoordinatingSessions,
    open: OpenGroomSession,
    key: GateKey,
    ask: AskGroomReview = AskGroomReviewSpy.asking(),
  ): Promise<number> {
    const app = express()
    app.post(RunningApi.PATH, Browsers.turnAwayForeign, GroomSessionRoute.opening(held, open, key, ask))
    app.all(RunningApi.PATH, GroomSessionRoute.refuseOtherMethods)
    return RunningServers.listening(app)
  }

  static async stopAll(): Promise<void> {
    await RunningServers.stopAll()
  }

  static async posting(
    held: CoordinatingSessions,
    open: OpenGroomSession,
    headers: Record<string, string> = {},
    target: string | null = Mother.TARGET,
    ask: AskGroomReview = AskGroomReviewSpy.asking(),
  ): Promise<Response> {
    const port = await RunningApi.listening(held, open, Keys.minted(), ask)

    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, {
      method: 'POST',
      headers: { ...(target === null ? {} : { [CoordinatingSessionTarget.HEADER]: target }), ...headers },
    })
  }

  static async withHooks(held: CoordinatingSessions, ask: AskGroomReview): Promise<number> {
    const app = express()
    app.post(
      SessionHooksRoute.PATH, JsonBody.demandDeclared, JsonBody.reader(), SessionHooksRoute.handledBy(held)
    )
    app.post(
      RunningApi.PATH, Browsers.turnAwayForeign, GroomSessionRoute.opening(held, OpenGroomSessionSpy.opening(), Keys.minted(), ask)
    )
    return RunningServers.listening(app)
  }

  static async reportingHook(port: number, payload: Record<string, unknown>): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${SessionHooksRoute.PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  static async pressing(port: number): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, {
      method: 'POST',
      headers: { [GateKey.HEADER]: Keys.MINTED, [CoordinatingSessionTarget.HEADER]: Mother.TARGET },
    })
  }

  static async getting(held: CoordinatingSessions, open: OpenGroomSession): Promise<Response> {
    const port = await RunningApi.listening(held, open, Keys.minted(), AskGroomReviewSpy.asking())

    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('GroomSessionRoute', () => {
  it('a press carrying the gate key opens the groom conversation and answers the session it started', async () => {
    const open = OpenGroomSessionSpy.opening()
    const held = Mother.ended()

    const response = await RunningApi.posting(held, open, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      status: 'grooming',
      target: Mother.NEXT_TARGET,
      conversation: Mother.CONVERSATION.id.text,
      repo: Mother.REPOSITORY.text,
      root: Mother.ROOT.text,
      session: { id: Mother.SESSION.id, name: Mother.SESSION.name },
    })
    expect(open.asked).toEqual([new OpenGroomSessionParams({
      repository: Mother.REPOSITORY, root: Mother.ROOT, story: Mother.CONVERSATION.story,
    })])
    expect(held.held()?.state).toBe(CoordinatingSessionState.LIVE)
    expect(held.held()?.attention).toEqual(SessionAttention.working())
    expect(held.timeline()).toEqual(Mother.TIMELINE)
  })

  it('a press without the gate key is refused and the use case is never asked', async () => {
    const open = OpenGroomSessionSpy.opening()

    const response = await RunningApi.posting(Mother.ended(), open, { [GateKey.HEADER]: Keys.FROM_ANOTHER_RUN })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: GroomSessionOutcome.NOT_FROM_THE_PAGE,
      detail: 'gate 2 answers only a request carrying the key the page was given',
    })
    expect(open.asked).toEqual([])
  })

  it.each([
    ['missing', null],
    ['malformed', 'not-a-uuid'],
    ['stale', Mother.OLD_TARGET],
  ])('a press with a %s coordinating target is refused before opening', async (_kind, target) => {
    const open = OpenGroomSessionSpy.opening()

    const response = await RunningApi.posting(
      Mother.ended(), open, { [GateKey.HEADER]: Keys.MINTED }, target
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: CoordinatingSessionTarget.CHANGED,
      detail: 'the coordinating session target changed: refresh before acting',
    })
    expect(open.asked).toEqual([])
  })

  it('a press with no coordinating session held is refused before the use case is asked', async () => {
    const open = OpenGroomSessionSpy.opening()

    const response = await RunningApi.posting(Mother.registry(), open, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: CoordinatingSessionTarget.CHANGED,
      detail: 'the coordinating session target changed: refresh before acting',
    })
    expect(open.asked).toEqual([])
  })

  it('a press reaches the live conversation that finished its turn, and opens nothing', async () => {
    const open = OpenGroomSessionSpy.opening()
    const ask = AskGroomReviewSpy.asking()
    const held = Mother.completed()

    const response = await RunningApi.posting(held, open, { [GateKey.HEADER]: Keys.MINTED }, Mother.TARGET, ask)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      status: 'typed',
      target: Mother.TARGET,
      conversation: Mother.CONVERSATION.id.text,
      repo: Mother.REPOSITORY.text,
      root: Mother.ROOT.text,
      session: { id: Mother.SESSION.id, name: Mother.SESSION.name },
    })
    expect(ask.asked).toEqual([new AskGroomReviewParams({
      repository: Mother.REPOSITORY, root: Mother.ROOT, session: Mother.SESSION, target: Mother.TARGET,
    })])
    expect(open.asked).toEqual([])
    expect(held.held()?.target).toBe(Mother.TARGET)
    expect(held.held()?.conversation).toBe(Mother.CONVERSATION)
    expect(held.operation()).toBe(CoordinatingOperation.IDLE)
  })

  it('a press while the live conversation is working is refused, and nothing is typed into its turn', async () => {
    const open = OpenGroomSessionSpy.opening()
    const ask = AskGroomReviewSpy.asking()

    const response = await RunningApi.posting(
      Mother.live(), open, { [GateKey.HEADER]: Keys.MINTED }, Mother.TARGET, ask
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: GroomSessionOutcome.WORKING,
      detail: 'the coordinating conversation is working: what is typed now would land in the middle of its turn',
    })
    expect(ask.asked).toEqual([])
    expect(open.asked).toEqual([])
  })

  it.each([
    [GroomReviewRefusal.AWAITING_PERMISSION, 409, GroomSessionOutcome.AWAITING_PERMISSION],
    [GroomReviewRefusal.WORKING, 409, GroomSessionOutcome.WORKING],
    [GroomReviewRefusal.TURN_NOT_FINISHED, 409, GroomSessionOutcome.TURN_NOT_FINISHED],
    [GroomReviewRefusal.NOT_LIVE, 409, GroomSessionOutcome.NOT_LIVE],
    [GroomReviewRefusal.TARGET_CHANGED, 400, CoordinatingSessionTarget.CHANGED],
    [GroomReviewRefusal.BUSY, 409, CoordinatingSessionTarget.BUSY],
  ] as const)('reports a late %s refusal instead of claiming the prompt was typed', async (refusal, status, code) => {
    const ask = new AskGroomReviewSpy(async () => GroomReviewAsked.refused(refusal))
    const open = OpenGroomSessionSpy.opening()

    const response = await RunningApi.posting(
      Mother.completed(), open, { [GateKey.HEADER]: Keys.MINTED }, Mother.TARGET, ask
    )

    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code })
    expect(open.asked).toEqual([])
  })

  it('a press while the live conversation waits for a permission is refused, and answers no prompt for it', async () => {
    const open = OpenGroomSessionSpy.opening()
    const ask = AskGroomReviewSpy.asking()

    const response = await RunningApi.posting(
      Mother.awaitingPermission(), open, { [GateKey.HEADER]: Keys.MINTED }, Mother.TARGET, ask
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: GroomSessionOutcome.AWAITING_PERMISSION,
      detail: 'the coordinating conversation is waiting for a permission: '
        + 'what is typed now would answer that prompt instead of asking for the review',
    })
    expect(ask.asked).toEqual([])
    expect(open.asked).toEqual([])
  })

  it('a permission prompt that carried no message still refuses the ask', async () => {
    const ask = AskGroomReviewSpy.asking()
    const held = Mother.completed()
    const port = await RunningApi.withHooks(held, ask)

    const reported = await RunningApi.reportingHook(port, {
      session_id: Mother.CONVERSATION.id.text,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
    })
    const response = await RunningApi.pressing(port)

    expect(reported.status).toBe(202)
    expect(held.held()?.attention).toEqual(SessionAttention.waiting(null))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: GroomSessionOutcome.AWAITING_PERMISSION,
      detail: 'the coordinating conversation is waiting for a permission: '
        + 'what is typed now would answer that prompt instead of asking for the review',
    })
    expect(ask.asked).toEqual([])
  })

  it('a completed turn reported by the hook opens the ask, and a permission prompt closes it again', async () => {
    const ask = AskGroomReviewSpy.asking()
    const held = Mother.live()
    const port = await RunningApi.withHooks(held, ask)

    await RunningApi.reportingHook(port, {
      session_id: Mother.CONVERSATION.id.text, hook_event_name: 'Stop',
    })
    const afterTheTurn = await RunningApi.pressing(port)
    await RunningApi.reportingHook(port, {
      session_id: Mother.CONVERSATION.id.text,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: Mother.PERMISSION_QUESTION,
    })
    const afterThePrompt = await RunningApi.pressing(port)

    expect(afterTheTurn.status).toBe(202)
    expect(await afterTheTurn.json()).toMatchObject({ status: 'typed' })
    expect(afterThePrompt.status).toBe(409)
    expect(await afterThePrompt.json()).toMatchObject({ code: GroomSessionOutcome.AWAITING_PERMISSION })
    expect(ask.asked).toHaveLength(1)
  })

  it('a live conversation that has reported no finished turn is refused rather than typed into', async () => {
    const ask = AskGroomReviewSpy.asking()

    const response = await RunningApi.posting(
      Mother.resumed(), OpenGroomSessionSpy.opening(), { [GateKey.HEADER]: Keys.MINTED }, Mother.TARGET, ask
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: GroomSessionOutcome.TURN_NOT_FINISHED,
      detail: 'the coordinating conversation has not reported finishing a turn: '
        + 'what its terminal is showing now is unknown',
    })
    expect(ask.asked).toEqual([])
  })

  it('a press whose pty is already gone is refused as not live', async () => {
    const open = OpenGroomSessionSpy.opening()

    const response = await RunningApi.posting(
      Mother.completed(), open, { [GateKey.HEADER]: Keys.MINTED }, Mother.TARGET, AskGroomReviewSpy.withNoPty()
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: GroomSessionOutcome.NOT_LIVE,
      detail: 'the coordinating conversation is no longer live: nothing was typed into it',
    })
    expect(open.asked).toEqual([])
  })

  it('a press on a live conversation whose checkout carries no spec is refused as no-epic-spec', async () => {
    const open = OpenGroomSessionSpy.opening()

    const response = await RunningApi.posting(
      Mother.completed(), open, { [GateKey.HEADER]: Keys.MINTED }, Mother.TARGET, AskGroomReviewSpy.withNoSpec()
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: GroomSessionOutcome.NO_EPIC_SPEC,
      detail: 'no execution spec exists in this checkout to talk about',
    })
    expect(open.asked).toEqual([])
  })

  it('a failed closure refuses both the ask and a new groom terminal', async () => {
    const open = OpenGroomSessionSpy.opening()
    const ask = AskGroomReviewSpy.asking()

    const response = await RunningApi.posting(
      Mother.failedClose(), open, { [GateKey.HEADER]: Keys.MINTED }, Mother.TARGET, ask
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: CoordinatingSessionTarget.BUSY,
      detail: 'the coordinating session is close-failed: wait for it to settle before acting',
    })
    expect(ask.asked).toEqual([])
    expect(open.asked).toEqual([])
  })

  it('a checkout with no execution spec is refused as no-epic-spec and the opening reservation is released', async () => {
    const open = OpenGroomSessionSpy.withNoSpec()
    const held = Mother.ended()
    const port = await RunningApi.listening(held, open, Keys.minted())
    const press = (): Promise<Response> => fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, {
      method: 'POST', headers: {
        [GateKey.HEADER]: Keys.MINTED, [CoordinatingSessionTarget.HEADER]: Mother.TARGET,
      },
    })

    const refused = await press()
    const again = await press()

    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      code: GroomSessionOutcome.NO_EPIC_SPEC,
      detail: 'no execution spec exists in this checkout to talk about',
    })
    expect(again.status).toBe(400)
    expect(await again.json()).toEqual({
      code: GroomSessionOutcome.NO_EPIC_SPEC,
      detail: 'no execution spec exists in this checkout to talk about',
    })
    expect(held.held()?.state).toBe(CoordinatingSessionState.ENDED)
  })

  it('a session claude refused to spawn answers the failure it raised and leaves the next press free', async () => {
    const open = OpenGroomSessionSpy.collapsing()
    const held = Mother.ended()
    const port = await RunningApi.listening(held, open, Keys.minted())
    const press = (): Promise<Response> => fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, {
      method: 'POST', headers: {
        [GateKey.HEADER]: Keys.MINTED, [CoordinatingSessionTarget.HEADER]: Mother.TARGET,
      },
    })

    const refused = await press()
    const again = await press()

    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      code: 'conversation-not-started',
      detail: 'claude could not be spawned in /repo: no pty',
    })
    expect(await again.json()).toEqual({
      code: 'conversation-not-started',
      detail: 'claude could not be spawned in /repo: no pty',
    })
  })

  it('a get on the groom session door answers 405 naming the method it takes', async () => {
    const response = await RunningApi.getting(Mother.ended(), OpenGroomSessionSpy.opening())

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe(GroomSessionRoute.METHODS)
  })
})
