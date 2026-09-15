import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Browsers } from '../../src/infrastructure/http.ts'
import { GateKey } from '../../src/infrastructure/gate-key.ts'
import { GroomSessionRoute, GroomSessionOutcome } from '../../src/infrastructure/groom-session-route.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState,
} from '../../src/infrastructure/coordinating-sessions.ts'
import {
  OpenGroomSession, OpenGroomSessionParams, GroomSessionOpened,
} from '../../src/application/actions/open-groom-session.ts'
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
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'

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

class LiveSessionsDouble extends LiveSessions {
  find(id: string): LiveSession | null {
    return id === Mother.SESSION.id ? Mother.SESSION : null
  }

  watch(): LiveSessionStream {
    return { printed: '', stop: (): void => {} }
  }
}

class Keys {
  static readonly MINTED = '07'.repeat(GateKey.BYTES)
  static readonly FROM_ANOTHER_RUN = '09'.repeat(GateKey.BYTES)

  static minted(): GateKey {
    return new GateKey({ random: (size: number) => Buffer.alloc(size, 0x07) })
  }
}

class Mother {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly CONVERSATION = new CoordinatingConversation({
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
    return new CoordinatingSessions({ liveSessions: new LiveSessionsDouble(), stderr: (): void => {} })
  }

  static ended(): CoordinatingSessions {
    const held = Mother.registry()
    held.remember(HeldCoordinatingSession.ended(Mother.CONVERSATION))

    return held
  }

  static live(): CoordinatingSessions {
    const held = Mother.registry()
    held.remember(new HeldCoordinatingSession({
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    }))

    return held
  }
}

class RunningApi {
  static readonly #started: Server[] = []
  static readonly PATH = GroomSessionRoute.PATH

  static async listening(held: CoordinatingSessions, open: OpenGroomSession, key: GateKey): Promise<number> {
    const app = express()
    app.post(RunningApi.PATH, Browsers.turnAwayForeign, GroomSessionRoute.opening(held, open, key))
    app.all(RunningApi.PATH, GroomSessionRoute.refuseOtherMethods)
    const server = createServer(app)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    RunningApi.#started.push(server)

    return (server.address() as AddressInfo).port
  }

  static async stopAll(): Promise<void> {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve())
    })))
  }

  static async posting(
    held: CoordinatingSessions, open: OpenGroomSession, headers: Record<string, string> = {}
  ): Promise<Response> {
    const port = await RunningApi.listening(held, open, Keys.minted())

    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'POST', headers })
  }

  static async getting(held: CoordinatingSessions, open: OpenGroomSession): Promise<Response> {
    const port = await RunningApi.listening(held, open, Keys.minted())

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
      conversation: Mother.CONVERSATION.id.text,
      repo: Mother.REPOSITORY.text,
      root: Mother.ROOT.text,
      session: { id: Mother.SESSION.id, name: Mother.SESSION.name },
    })
    expect(open.asked).toEqual([new OpenGroomSessionParams({
      repository: Mother.REPOSITORY, root: Mother.ROOT,
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

  it('a press with no coordinating session held is refused before the use case is asked', async () => {
    const open = OpenGroomSessionSpy.opening()

    const response = await RunningApi.posting(Mother.registry(), open, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: GroomSessionOutcome.NO_COORDINATING_SESSION,
      detail: 'no coordinating session is held: there is no checkout to open the groom conversation in',
    })
    expect(open.asked).toEqual([])
  })

  it('a press while a coordinating conversation is live is refused as already live', async () => {
    const open = OpenGroomSessionSpy.opening()

    const response = await RunningApi.posting(Mother.live(), open, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: GroomSessionOutcome.ALREADY_LIVE,
      detail: 'a coordinating conversation is already live: it has to end before the groom conversation opens',
    })
    expect(open.asked).toEqual([])
  })

  it('a checkout with no execution spec is refused as no-epic-spec and the opening reservation is released', async () => {
    const open = OpenGroomSessionSpy.withNoSpec()
    const held = Mother.ended()
    const port = await RunningApi.listening(held, open, Keys.minted())
    const press = (): Promise<Response> => fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, {
      method: 'POST', headers: { [GateKey.HEADER]: Keys.MINTED },
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
      method: 'POST', headers: { [GateKey.HEADER]: Keys.MINTED },
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
