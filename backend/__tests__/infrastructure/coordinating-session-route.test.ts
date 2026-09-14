import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import {
  OpenCoordinatingSession, OpenCoordinatingSessionParams, CoordinatingSessionOpened,
} from '../../src/application/actions/open-coordinating-session.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { Conversations } from '../../src/domain/ports/conversations.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { SessionHooks } from '../../src/domain/ports/session-hooks.ts'
import { UserStories } from '../../src/domain/ports/user-stories.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import { ConversationNotStarted } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'

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
    })
    this.asked = []
    this.answer = answer
  }

  static opening(): OpenCoordinatingSessionSpy {
    return new OpenCoordinatingSessionSpy(async () => Mother.opened())
  }

  static refusing(cause: Error): OpenCoordinatingSessionSpy {
    return new OpenCoordinatingSessionSpy(async () => { throw cause })
  }

  async execute(params: OpenCoordinatingSessionParams): Promise<CoordinatingSessionOpened> {
    this.asked.push(params)

    return this.answer(params)
  }
}

class Mother {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly CONVERSATION = new CoordinatingConversation({
    id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    repository: Mother.REPOSITORY,
    root: Mother.ROOT,
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })

  static opened(): CoordinatingSessionOpened {
    return new CoordinatingSessionOpened({ conversation: Mother.CONVERSATION, session: Mother.SESSION })
  }

  static live(attention: SessionAttention): CoordinatingSessions {
    const held = new CoordinatingSessions({ stderr: (): void => {} })
    held.remember(new HeldCoordinatingSession({
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention,
    }))

    return held
  }

  static unresumable(): CoordinatingSessions {
    const held = new CoordinatingSessions({ stderr: (): void => {} })
    held.remember(new HeldCoordinatingSession({
      state: CoordinatingSessionState.UNRESUMABLE,
      conversation: Mother.CONVERSATION,
      session: null,
      attention: null,
    }))

    return held
  }
}

class RunningApi {
  static readonly #started: ApiServer[] = []
  static readonly PATH = '/coordinating-session'
  static readonly NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')

  static async listening(open: OpenCoordinatingSession, held: CoordinatingSessions): Promise<number> {
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      frontendRoot: RunningApi.NO_FRONTEND,
      openCoordinatingSession: open,
      coordinatingSessions: held,
    })
    const port = await server.start()
    RunningApi.#started.push(server)

    return port
  }

  static async stopAll(): Promise<void> {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => server.stop()))
  }

  static async post(
    open: OpenCoordinatingSession, held: CoordinatingSessions, body: string
  ): Promise<Response> {
    const port = await RunningApi.listening(open, held)

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
  it('answers 202 with the conversation and the session it opened', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = new CoordinatingSessions({ stderr: (): void => {} })

    const response = await RunningApi.post(
      open, held, '{"user_comment":"explore the checkout screen","repo":"josemerca/ct-loop-sandbox","path":"/repo"}'
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      status: 'brainstorming',
      conversation: Mother.CONVERSATION.id.text,
      repo: Mother.REPOSITORY.text,
      root: Mother.ROOT.text,
      session: { id: Mother.SESSION.id, name: Mother.SESSION.name },
    })
  })

  it('holds the opened session as live and working', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = new CoordinatingSessions({ stderr: (): void => {} })

    await RunningApi.post(
      open, held, '{"user_comment":"explore the checkout screen","repo":"josemerca/ct-loop-sandbox","path":"/repo"}'
    )

    const holding = held.held()
    expect(holding?.state).toBe('live')
    expect(holding?.conversation).toBe(Mother.CONVERSATION)
    expect(holding?.session).toBe(Mother.SESSION)
    expect(holding?.attention).toEqual(SessionAttention.working())
  })

  it('refuses a repository list because an epic governs one checkout', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = new CoordinatingSessions({ stderr: (): void => {} })

    const response = await RunningApi.post(
      open, held,
      '{"user_comment":"explore the checkout screen","repo_list":[{"repo":"josemerca/ct-loop-sandbox","path":"/repo"}]}'
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'one-repository-only',
      detail: 'an epic governs one checkout: send repo and path instead of repo_list',
    })
    expect(open.asked).toEqual([])
  })

  it('refuses a body with nothing to plan without asking the use case', async () => {
    const open = OpenCoordinatingSessionSpy.opening()
    const held = new CoordinatingSessions({ stderr: (): void => {} })

    const response = await RunningApi.post(open, held, '{}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'nothing-to-plan',
      detail: 'either id or user_comment must say what to plan',
    })
    expect(open.asked).toEqual([])
  })

  it('collapses a conversation that could not be started into conversation-not-started', async () => {
    const open = OpenCoordinatingSessionSpy.refusing(
      new ConversationNotStarted('claude could not be spawned in /repo: command not found')
    )
    const held = new CoordinatingSessions({ stderr: (): void => {} })

    const response = await RunningApi.post(
      open, held, '{"user_comment":"explore the checkout screen","repo":"josemerca/ct-loop-sandbox","path":"/repo"}'
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
    const held = new CoordinatingSessions({ stderr: (): void => {} })

    const response = await RunningApi.deleting(open, held)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(open.asked).toEqual([])
  })

  it('answers none while no conversation has been opened', async () => {
    const held = new CoordinatingSessions({ stderr: (): void => {} })

    const response = await RunningApi.get(held)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
  })

  it('answers the live conversation with its attention and its question', async () => {
    const held = Mother.live(SessionAttention.waiting('should the button read Arrancar brainstorming?'))

    const response = await RunningApi.get(held)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'live',
      conversation: Mother.CONVERSATION.id.text,
      repo: Mother.REPOSITORY.text,
      root: Mother.ROOT.text,
      session: { id: Mother.SESSION.id, name: Mother.SESSION.name },
      attention: { status: 'waiting', question: 'should the button read Arrancar brainstorming?' },
    })
  })

  it('answers unresumable for a conversation Claude Code no longer holds', async () => {
    const held = Mother.unresumable()

    const response = await RunningApi.get(held)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'unresumable',
      conversation: Mother.CONVERSATION.id.text,
      repo: Mother.REPOSITORY.text,
      root: Mother.ROOT.text,
      detail: 'claude code no longer holds this conversation: the coordinating session was not resumed',
    })
  })
})
