import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { Loopback, RunningServers } from '../servers.ts'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import {
  OpenCoordinatingSession, OpenCoordinatingSessionParams, CoordinatingSessionOpened,
} from '../../src/application/actions/open-coordinating-session.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState,
  CoordinatingOperation, OpeningReservation,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { Conversations } from '../../src/domain/ports/conversations.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { SessionHooks } from '../../src/domain/ports/session-hooks.ts'
import { UserStories } from '../../src/domain/ports/user-stories.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import { ConversationNotStarted } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversationMother } from '../coordinating-conversation-mother.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'

class OpenCoordinatingSessionSpy extends OpenCoordinatingSession {
  readonly asked: OpenCoordinatingSessionParams[]
  readonly answer: (params: OpenCoordinatingSessionParams) => Promise<CoordinatingSessionOpened>

  constructor(answer: (params: OpenCoordinatingSessionParams) => Promise<CoordinatingSessionOpened>) {
    super({
      userStories: new UserStories(),
      workspace: new Workspace(),
      conversations: new Conversations(),
      sessionHooks: new SessionHooks(),
      records: new ConversationRecords(),
      checkouts: new CheckoutRegistry(),
      specs: new EpicSpecs(),
    })
    this.asked = []
    this.answer = answer
  }

  static opening(): OpenCoordinatingSessionSpy {
    return new OpenCoordinatingSessionSpy(async () => Mother.opened())
  }

  static findingItFrozen(frozen: CoordinatingSessionOpened): OpenCoordinatingSessionSpy {
    return new OpenCoordinatingSessionSpy(async () => frozen)
  }

  static refusing(cause: Error): OpenCoordinatingSessionSpy {
    return new OpenCoordinatingSessionSpy(async () => { throw cause })
  }

  async execute(params: OpenCoordinatingSessionParams): Promise<CoordinatingSessionOpened> {
    this.asked.push(params)

    return this.answer(params)
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

class Mother {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly CONVERSATION = CoordinatingConversationMother.of({
    id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    repository: Mother.REPOSITORY,
    root: Mother.ROOT,
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'

  static readonly OPENING_REQUEST =
    '{"id":"ABC-1","path":"/repo"}'

  static readonly TIMELINE = [
    new SessionTimelineEvent({ id: 'event-1', kind: TimelineEventKind.OPENED, at: '2026-09-15T10:00:00.000Z', detail: null }),
  ]

  static opened(): CoordinatingSessionOpened {
    return CoordinatingSessionOpened.opened(Mother.CONVERSATION, Mother.SESSION, Mother.TIMELINE)
  }

  static registry(): CoordinatingSessions {
    return new CoordinatingSessions({
      liveSessions: new LiveSessionsDouble(), stderr: (): void => {}, newTarget: () => Mother.TARGET,
    })
  }

  static live(attention: SessionAttention): CoordinatingSessions {
    const held = Mother.registry()
    held.remember(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention,
    }), Mother.TIMELINE)

    return held
  }

  static ended(): CoordinatingSessions {
    const held = Mother.registry()
    held.remember(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.ENDED,
      conversation: Mother.CONVERSATION,
      session: null,
      attention: null,
    }), Mother.TIMELINE)

    return held
  }

  static unresumable(): CoordinatingSessions {
    const held = Mother.registry()
    held.remember(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.UNRESUMABLE,
      conversation: Mother.CONVERSATION,
      session: null,
      attention: null,
    }), Mother.TIMELINE)

    return held
  }

  static timelineJson(): unknown[] {
    return Mother.TIMELINE.map((event) => ({ id: event.id, kind: event.kind, at: event.at, detail: event.detail }))
  }
}

class AnOpeningYouFinishByHand {
  static inFlight(): { open: OpenCoordinatingSessionSpy, started: Promise<void>, finish: () => void } {
    let announce: () => void = (): void => {}
    const started = new Promise<void>((resolve) => { announce = resolve })
    let finish: () => void = (): void => {}
    const gate = new Promise<void>((resolve) => { finish = resolve })
    const open = new OpenCoordinatingSessionSpy(async () => {
      announce()
      await gate

      return Mother.opened()
    })

    return { open, started, finish: () => finish() }
  }
}

class RunningApi {
  static readonly PATH = '/coordinating-session'

  static async listening(open: OpenCoordinatingSession, held: CoordinatingSessions): Promise<number> {
    const server = new ApiServer({
      port: 0,
      frontendRoot: Loopback.FRONTEND_NEVER_BUILT,
      openCoordinatingSession: open,
      coordinatingSessions: held,
    })
    return RunningServers.started(server)
  }

  static async stopAll(): Promise<void> {
    await RunningServers.stopAll()
  }

  static async post(
    open: OpenCoordinatingSession, held: CoordinatingSessions, body: string
  ): Promise<Response> {
    return RunningApi.posting(await RunningApi.listening(open, held), body)
  }

  static posting(port: number, body: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  static async deleting(open: OpenCoordinatingSession, held: CoordinatingSessions): Promise<Response> {
    const port = await RunningApi.listening(open, held)

    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'DELETE' })
  }

  static async get(held: CoordinatingSessions): Promise<Response> {
    const port = await RunningApi.listening(OpenCoordinatingSessionSpy.opening(), held)

    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('CoordinatingSessionRoute', () => {
  it('reads and opening answers expose target and authoritative operation', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = Mother.registry()

    const response = await RunningApi.post(
      open, held, Mother.OPENING_REQUEST
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      status: 'brainstorming',
      conversation: Mother.CONVERSATION.id.text,
      target: Mother.TARGET,
      repo: Mother.REPOSITORY.text,
      story: Mother.CONVERSATION.story.text,
      root: Mother.ROOT.text,
      session: { id: Mother.SESSION.id, name: Mother.SESSION.name },
    })
  })

  it('holds the opened session as live and working', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = Mother.registry()

    await RunningApi.post(
      open, held, Mother.OPENING_REQUEST
    )

    const holding = held.held()
    expect(holding?.state).toBe('live')
    expect(holding?.conversation).toBe(Mother.CONVERSATION)
    expect(holding?.session).toBe(Mother.SESSION)
    expect(holding?.attention).toEqual(SessionAttention.working())
  })

  it('refuses the second opening with 409 while the first conversation is live', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = Mother.live(SessionAttention.working())

    const response = await RunningApi.post(
      open, held, Mother.OPENING_REQUEST
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'coordinating-session-already-live',
      detail: 'a coordinating conversation is already live: it has to end before another one opens',
      conversation: Mother.CONVERSATION.id.text,
      target: Mother.TARGET,
      session: { id: Mother.SESSION.id, name: Mother.SESSION.name },
    })
    expect(open.asked).toEqual([])
  })

  it('two openings fired at once open a single conversation', async () => {
    const controlled = AnOpeningYouFinishByHand.inFlight()
    const held = Mother.registry()
    const port = await RunningApi.listening(controlled.open, held)

    const first = RunningApi.posting(port, Mother.OPENING_REQUEST)
    await controlled.started
    const second = await RunningApi.posting(port, Mother.OPENING_REQUEST)

    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({
      code: 'coordinating-session-opening',
      detail: 'a coordinating conversation is being opened: wait for it to be live and try again',
    })
    expect(controlled.open.asked).toHaveLength(1)

    controlled.finish()
    expect((await first).status).toBe(202)
    expect(held.held()?.state).toBe('live')

    const third = await RunningApi.posting(port, Mother.OPENING_REQUEST)
    expect(third.status).toBe(409)
    expect(await third.json()).toMatchObject({ code: 'coordinating-session-already-live' })
    expect(controlled.open.asked).toHaveLength(1)
  }, 10_000)

  it('startup recovery reserves the coordinating slot before another process can open', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = Mother.registry()
    held.beginRecovery()

    const response = await RunningApi.post(open, held, Mother.OPENING_REQUEST)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'coordinating-session-opening',
      detail: 'a coordinating conversation is being opened: wait for it to be live and try again',
    })
    expect(open.asked).toEqual([])
    expect(held.operation()).toBe(CoordinatingOperation.RECOVERING)
  })

  it('a failed opening frees the next one', async () => {
    const open = OpenCoordinatingSessionSpy.refusing(
      new ConversationNotStarted('claude could not be spawned in /repo: command not found')
    )
    const held = Mother.registry()
    const port = await RunningApi.listening(open, held)

    const refused = await RunningApi.posting(port, Mother.OPENING_REQUEST)
    const next = await RunningApi.posting(port, Mother.OPENING_REQUEST)

    expect(await refused.json()).toEqual({
      code: 'conversation-not-started',
      detail: 'claude could not be spawned in /repo: command not found',
    })
    expect(next.status).toBe(400)
    expect(open.asked).toHaveLength(2)
  })

  it('a story whose spec is already frozen is refused with story-spec-frozen and frees the next opening', async () => {
    const frozen = CoordinatingSessionOpened.storySpecFrozen(new EpicSpec({
      path: 'docs/superpowers/specs/ABC-1-execution.md',
      text: `# Frozen epic${EpicSpec.TITLE_SUFFIX}\n${EpicSpec.STATE_LINE} ${EpicSpec.FROZEN}\n`,
    }))
    const held = Mother.registry()
    const port = await RunningApi.listening(OpenCoordinatingSessionSpy.findingItFrozen(frozen), held)

    const refused = await RunningApi.posting(port, Mother.OPENING_REQUEST)

    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      code: 'story-spec-frozen',
      detail: 'ABC-1 already has its execution spec frozen at docs/superpowers/specs/ABC-1-execution.md: its brainstorming is over, continue with the groom',
    })
    expect(held.held()).toBeNull()
    expect(held.reserve().outcome).toBe(OpeningReservation.RESERVED)
  })

  it('an opening that broke frees the next one', async () => {
    const open = OpenCoordinatingSessionSpy.refusing(new TypeError('a bug of ours'))
    const held = Mother.registry()
    const port = await RunningApi.listening(open, held)

    const broke = await RunningApi.posting(port, Mother.OPENING_REQUEST)
    const next = await RunningApi.posting(port, Mother.OPENING_REQUEST)

    expect(await broke.json()).toEqual({ code: 'request-failed', detail: 'request failed' })
    expect(next.status).toBe(400)
    expect(open.asked).toHaveLength(2)
  })

  it('opens again over a conversation that is no longer live', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = Mother.unresumable()

    const response = await RunningApi.post(
      open, held, Mother.OPENING_REQUEST
    )

    expect(response.status).toBe(202)
    expect(open.asked).toHaveLength(1)
    expect(held.held()?.state).toBe('live')
  })

  it('refuses a repository named in the body because the checkout path already says which one it is', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = Mother.registry()

    const response = await RunningApi.post(
      open, held,
      '{"id":"ABC-1","repo":"josemerca/ct-loop-sandbox","path":"/repo"}'
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'unknown-field',
      detail: 'unknown field: repo',
    })
    expect(open.asked).toEqual([])
  })

  it('asks the use case to open the session on the path the body names and nothing else', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = Mother.registry()

    await RunningApi.post(open, held, Mother.OPENING_REQUEST)

    expect(open.asked).toHaveLength(1)
    expect(open.asked[0].root.text).toBe(Mother.ROOT.text)
    expect(open.asked[0].story.text).toBe('ABC-1')
  })

  it('refuses a body with nothing to plan without asking the use case', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = Mother.registry()

    const response = await RunningApi.post(open, held, '{}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'nothing-to-plan',
      detail: 'id is required to say what to plan',
    })
    expect(open.asked).toEqual([])
  })

  it('collapses a conversation that could not be started into conversation-not-started', async () => {
    const open = OpenCoordinatingSessionSpy.refusing(
      new ConversationNotStarted('claude could not be spawned in /repo: command not found')
    )
    const held = Mother.registry()

    const response = await RunningApi.post(
      open, held, Mother.OPENING_REQUEST
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'conversation-not-started',
      detail: 'claude could not be spawned in /repo: command not found',
    })
    expect(held.held()).toBeNull()
  })

  it('answers 405 to a method that is neither GET nor POST', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = Mother.registry()

    const response = await RunningApi.deleting(open, held)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(open.asked).toEqual([])
  })

  it('answers none while no conversation has been opened', async () => {
    const held = Mother.registry()

    const response = await RunningApi.get(held)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none', operation: 'idle' })
  })

  it('answers the live conversation with its attention and its question', async () => {
    const held = Mother.live(SessionAttention.waiting('should the button read Arrancar brainstorming?'))

    const response = await RunningApi.get(held)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'live',
      operation: 'idle',
      target: Mother.TARGET,
      conversation: Mother.CONVERSATION.id.text,
      repo: Mother.REPOSITORY.text,
      story: Mother.CONVERSATION.story.text,
      root: Mother.ROOT.text,
      session: { id: Mother.SESSION.id, name: Mother.SESSION.name },
      attention: { status: 'waiting', question: 'should the button read Arrancar brainstorming?' },
      timeline: Mother.timelineJson(),
    })
  })

  it('answers ended for a conversation whose terminal exited', async () => {
    const held = Mother.ended()

    const response = await RunningApi.get(held)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ended',
      operation: 'idle',
      target: Mother.TARGET,
      conversation: Mother.CONVERSATION.id.text,
      repo: Mother.REPOSITORY.text,
      story: Mother.CONVERSATION.story.text,
      root: Mother.ROOT.text,
      detail: 'the terminal of this coordinating session exited and no other one was opened',
      timeline: Mother.timelineJson(),
    })
  })

  it('opens again over a conversation whose terminal exited', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = Mother.ended()

    const response = await RunningApi.post(
      open, held, Mother.OPENING_REQUEST
    )

    expect(response.status).toBe(202)
    expect(held.held()?.state).toBe('live')
  })

  it('answers the story of a conversation opened for a GitHub issue exactly as it was given', async () => {
    const held = Mother.registry()
    held.remember(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: CoordinatingConversationMother.of({
        id: Mother.CONVERSATION.id, repository: Mother.REPOSITORY, root: Mother.ROOT,
        story: CoordinatingConversationMother.ISSUE_STORY,
      }),
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    }), Mother.TIMELINE)

    const answered = await (await RunningApi.get(held)).json() as { story: string }

    expect(answered.story).toBe('https://github.com/owner/name/issues/12')
  })

  it('answers unresumable for a conversation Claude Code no longer holds', async () => {
    const held = Mother.unresumable()

    const response = await RunningApi.get(held)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'unresumable',
      operation: 'idle',
      target: Mother.TARGET,
      conversation: Mother.CONVERSATION.id.text,
      repo: Mother.REPOSITORY.text,
      story: Mother.CONVERSATION.story.text,
      root: Mother.ROOT.text,
      detail: 'claude code no longer holds this conversation: the coordinating session was not resumed',
      timeline: Mother.timelineJson(),
    })
  })

  it('reports opening recovering closing and close-failed operations without losing the held target', async () => {
    const opening = Mother.registry()
    opening.reserve()
    expect(await (await RunningApi.get(opening)).json()).toEqual({ status: 'none', operation: 'opening' })

    const recovering = Mother.registry()
    recovering.beginRecovery()
    expect(await (await RunningApi.get(recovering)).json()).toEqual({ status: 'none', operation: 'recovering' })

    const closing = Mother.live(SessionAttention.working())
    closing.beginClose({ conversation: Mother.CONVERSATION.id.text, target: Mother.TARGET })
    closing.trackClose(
      { conversation: Mother.CONVERSATION.id.text, target: Mother.TARGET },
      new Promise(() => {}),
    )
    expect(await (await RunningApi.get(closing)).json()).toMatchObject({
      status: 'live', operation: 'closing', target: Mother.TARGET,
    })

    closing.failClose(
      { conversation: Mother.CONVERSATION.id.text, target: Mother.TARGET },
      { code: 'session-not-terminated', detail: 'group still exists' },
    )
    expect(await (await RunningApi.get(closing)).json()).toMatchObject({
      status: 'live',
      operation: CoordinatingOperation.CLOSE_FAILED,
      target: Mother.TARGET,
      closureError: { code: 'session-not-terminated', detail: 'group still exists' },
    })
  })
})
