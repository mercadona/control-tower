import { afterEach, describe, expect, it } from 'vitest'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { CoordinatingSessionTarget } from '../../src/infrastructure/coordinating-session-target.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState, OpeningReservation,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { CoordinatingConversationMother } from '../coordinating-conversation-mother.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import {
  CoordinatingSessionReopened, Reopening, type ReopenCoordinatingSession, type ReopenCoordinatingSessionParams,
} from '../../src/application/actions/reopen-coordinating-session.ts'
import { StoryStep } from '../../src/domain/policies/story-step.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'
import { UserStoryNotRead } from '../../src/domain/exceptions.ts'

class LiveSessionsDouble extends LiveSessions {
  readonly #open: LiveSession

  constructor(open: LiveSession) {
    super()
    this.#open = open
  }

  find(id: string): LiveSession | null {
    return this.#open.id === id ? this.#open : null
  }

  watch(): LiveSessionStream {
    return { printed: '', stop: (): void => {} }
  }
}

class ReopenCoordinatingSessionDouble {
  readonly asked: ReopenCoordinatingSessionParams[] = []
  answer: (params: ReopenCoordinatingSessionParams) => Promise<CoordinatingSessionReopened> = async () => {
    throw new Error('no answer scripted for this double')
  }

  static answering(reopened: CoordinatingSessionReopened): ReopenCoordinatingSessionDouble {
    const double = new ReopenCoordinatingSessionDouble()
    double.answer = async () => reopened
    return double
  }

  static failing(failure: Error): ReopenCoordinatingSessionDouble {
    const double = new ReopenCoordinatingSessionDouble()
    double.answer = async () => { throw failure }
    return double
  }

  static neverAsked(): ReopenCoordinatingSessionDouble {
    return new ReopenCoordinatingSessionDouble()
  }

  async execute(params: ReopenCoordinatingSessionParams): Promise<CoordinatingSessionReopened> {
    this.asked.push(params)
    return this.answer(params)
  }
}

class RunningApi {
  static readonly live: ApiServer[] = []
  readonly server: ApiServer

  constructor({ coordinatingSessions, reopenCoordinatingSession }: {
    coordinatingSessions: CoordinatingSessions, reopenCoordinatingSession: Pick<ReopenCoordinatingSession, 'execute'>,
  }) {
    this.server = new ApiServer({ port: 0, frontendRoot: '/no-frontend', coordinatingSessions, reopenCoordinatingSession })
  }

  async start(): Promise<string> {
    RunningApi.live.push(this.server)
    return `http://127.0.0.1:${await this.server.start()}`
  }

  static async stop(): Promise<void> {
    await Promise.all(RunningApi.live.splice(0).map((server) => server.stop()))
  }
}

class Mother {
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
  static readonly NEXT_TARGET = '69d8d78f-1f6f-47db-98c5-3a13b1710691'
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly CONVERSATION = CoordinatingConversationMother.of({
    id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    repository: Mother.REPOSITORY,
    root: Mother.ROOT,
  })

  static readonly REOPENED_CONVERSATION = CoordinatingConversationMother.of({
    id: new ConversationId('3c2b7d3f-9f3b-5c9c-ab4f-7f3c2b7d3f9f'),
    repository: Mother.REPOSITORY,
    root: Mother.ROOT,
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'implementation' })
  static readonly NEW_SESSION = new LiveSession({ id: 'session-2', name: 'implementation' })

  static ended(): CoordinatingSessions {
    const held = new CoordinatingSessions({
      liveSessions: new LiveSessionsDouble(Mother.NEW_SESSION), stderr: (): void => {}, newTarget: () => Mother.NEXT_TARGET,
    })
    held.remember(HeldCoordinatingSession.ended(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    })))

    return held
  }

  static live(): CoordinatingSessions {
    const held = new CoordinatingSessions({
      liveSessions: new LiveSessionsDouble(Mother.SESSION), stderr: (): void => {}, newTarget: () => Mother.NEXT_TARGET,
    })
    held.remember(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    }))

    return held
  }

  static reopened(): CoordinatingSessionReopened {
    return new CoordinatingSessionReopened({
      outcome: Reopening.OPENED,
      step: StoryStep.GROOM,
      conversation: Mother.REOPENED_CONVERSATION,
      session: Mother.NEW_SESSION,
      timeline: [new SessionTimelineEvent({
        id: 'event-1', kind: TimelineEventKind.OPENED, at: '2026-09-25T12:00:00.000Z', detail: null,
      })],
    })
  }
}

describe('CoordinatingSessionReopenRoute', () => {
  afterEach(() => RunningApi.stop())

  it('an ended session reopens and the page gets the new target and the session', async () => {
    const held = Mother.ended()
    const reopen = ReopenCoordinatingSessionDouble.answering(Mother.reopened())
    const api = new RunningApi({ coordinatingSessions: held, reopenCoordinatingSession: reopen })

    const response = await fetch(`${await api.start()}/coordinating-session/reopen`, {
      method: 'POST', headers: { [CoordinatingSessionTarget.HEADER]: Mother.TARGET },
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      status: 'opened',
      step: 'groom',
      target: Mother.NEXT_TARGET,
      conversation: Mother.REOPENED_CONVERSATION.id.text,
      repo: Mother.REPOSITORY.text,
      story: Mother.REOPENED_CONVERSATION.story.text,
      root: Mother.ROOT.text,
      session: { id: Mother.NEW_SESSION.id, name: Mother.NEW_SESSION.name },
    })
    expect(reopen.asked[0].conversation).toBe(Mother.CONVERSATION)
    expect(held.held()!.state).toBe(CoordinatingSessionState.LIVE)
    expect(held.held()!.target).toBe(Mother.NEXT_TARGET)
  })

  it('a live session is refused as not ended and the reopen gets no call', async () => {
    const reopen = ReopenCoordinatingSessionDouble.neverAsked()
    const api = new RunningApi({ coordinatingSessions: Mother.live(), reopenCoordinatingSession: reopen })

    const response = await fetch(`${await api.start()}/coordinating-session/reopen`, {
      method: 'POST', headers: { [CoordinatingSessionTarget.HEADER]: Mother.TARGET },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'coordinating-session-not-ended',
      detail: 'the coordinating conversation is still live: it has to end before it can be reopened',
    })
    expect(reopen.asked).toEqual([])
  })

  it('a stale target is refused and the reopen gets no call', async () => {
    const reopen = ReopenCoordinatingSessionDouble.neverAsked()
    const api = new RunningApi({ coordinatingSessions: Mother.ended(), reopenCoordinatingSession: reopen })

    const response = await fetch(`${await api.start()}/coordinating-session/reopen`, {
      method: 'POST', headers: { [CoordinatingSessionTarget.HEADER]: Mother.NEXT_TARGET },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'coordinating-session-target-changed', detail: 'the coordinating session target changed: refresh before acting',
    })
    expect(reopen.asked).toEqual([])
  })

  it('a reopen already under way is refused as busy and the reopen gets no second call', async () => {
    const held = Mother.ended()
    held.reserve()
    const reopen = ReopenCoordinatingSessionDouble.neverAsked()
    const api = new RunningApi({ coordinatingSessions: held, reopenCoordinatingSession: reopen })

    const response = await fetch(`${await api.start()}/coordinating-session/reopen`, {
      method: 'POST', headers: { [CoordinatingSessionTarget.HEADER]: Mother.TARGET },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'coordinating-session-busy',
      detail: 'the coordinating session is opening: wait for it to settle before acting',
    })
    expect(reopen.asked).toEqual([])
    held.release()
  })

  it('a session whose close failed is refused until the close is finished', async () => {
    const held = Mother.ended()
    const identity = { conversation: Mother.CONVERSATION.id.text, target: Mother.TARGET }
    held.beginClose(identity)
    held.failClose(identity, { code: 'session-not-terminated', detail: 'the terminal did not exit' })
    const reopen = ReopenCoordinatingSessionDouble.neverAsked()
    const api = new RunningApi({ coordinatingSessions: held, reopenCoordinatingSession: reopen })

    const response = await fetch(`${await api.start()}/coordinating-session/reopen`, {
      method: 'POST', headers: { [CoordinatingSessionTarget.HEADER]: Mother.TARGET },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'coordinating-session-close-failed',
      detail: 'closing the coordinating conversation failed: finish the close before reopening it',
    })
    expect(reopen.asked).toEqual([])
  })

  it('a reopen that fails frees the next press', async () => {
    const failure = new UserStoryNotRead('the ticket could not be read')
    const held = Mother.ended()
    const reopen = ReopenCoordinatingSessionDouble.failing(failure)
    const api = new RunningApi({ coordinatingSessions: held, reopenCoordinatingSession: reopen })

    const response = await fetch(`${await api.start()}/coordinating-session/reopen`, {
      method: 'POST', headers: { [CoordinatingSessionTarget.HEADER]: Mother.TARGET },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'user-story-not-read', detail: 'the ticket could not be read' })
    expect(held.reserve().outcome).toBe(OpeningReservation.RESERVED)
    held.release()
  })

  it('a method other than POST is refused', async () => {
    const reopen = ReopenCoordinatingSessionDouble.neverAsked()
    const api = new RunningApi({ coordinatingSessions: Mother.ended(), reopenCoordinatingSession: reopen })

    const response = await fetch(`${await api.start()}/coordinating-session/reopen`, { method: 'GET' })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(reopen.asked).toEqual([])
  })
})
