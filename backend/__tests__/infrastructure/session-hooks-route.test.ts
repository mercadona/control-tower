import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState } from '../../src/infrastructure/coordinating-sessions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'

class Mother {
  static readonly CONVERSATION_ID = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
  static readonly CONVERSATION = new CoordinatingConversation({
    id: new ConversationId(Mother.CONVERSATION_ID),
    repository: new RepositoryName('josemerca/ct-loop-sandbox'),
    root: new CheckoutRoot('/repo'),
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })

  static held(attention: SessionAttention): CoordinatingSessions {
    const sessions = new CoordinatingSessions({ stderr: (): void => {} })
    sessions.remember(new HeldCoordinatingSession({
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention,
    }))

    return sessions
  }
}

class RunningApi {
  static readonly #started: ApiServer[] = []
  static readonly PATH = '/session-hooks'
  static readonly NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')

  static async listening(held: CoordinatingSessions): Promise<number> {
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      frontendRoot: RunningApi.NO_FRONTEND,
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

  static async post(held: CoordinatingSessions, body: string): Promise<Response> {
    const port = await RunningApi.listening(held)

    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('SessionHooksRoute', () => {
  it('moves the held session from working to waiting with the question it was asked', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(
      held,
      `{"session_id":"${Mother.CONVERSATION_ID}","hook_event_name":"Notification",` +
        '"message":"should the button read Arrancar brainstorming?"}'
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'reported', attention: 'waiting' })
    expect(held.held()?.attention).toEqual(SessionAttention.waiting('should the button read Arrancar brainstorming?'))
  })

  it('drops the question when the session works again', async () => {
    const held = Mother.held(SessionAttention.waiting('should the button read Arrancar brainstorming?'))

    const response = await RunningApi.post(
      held, `{"session_id":"${Mother.CONVERSATION_ID}","hook_event_name":"UserPromptSubmit"}`
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'reported', attention: 'working' })
    expect(held.held()?.attention).toEqual(SessionAttention.working())
  })

  it('reads Stop as waiting with no question', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(
      held, `{"session_id":"${Mother.CONVERSATION_ID}","hook_event_name":"Stop"}`
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'reported', attention: 'waiting' })
    expect(held.held()?.attention).toEqual(SessionAttention.waiting(null))
  })

  it('ignores the fields of the payload it does not know', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(
      held,
      `{"session_id":"${Mother.CONVERSATION_ID}","hook_event_name":"Stop",` +
        '"transcript_path":"/tmp/transcript.jsonl","cwd":"/repo"}'
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'reported', attention: 'waiting' })
  })

  it('refuses an event it does not know with hook-not-understood', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(
      held, `{"session_id":"${Mother.CONVERSATION_ID}","hook_event_name":"PreToolUse"}`
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'hook-not-understood',
      detail: 'the hook payload does not carry a known event and a session id',
    })
    expect(held.held()?.attention).toEqual(SessionAttention.working())
  })

  it('refuses an id that is not the held conversation with conversation-not-live', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(
      held, '{"session_id":"not-the-held-conversation","hook_event_name":"Stop"}'
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'conversation-not-live',
      detail: 'no held conversation answers to that session id',
    })
    expect(held.held()?.attention).toEqual(SessionAttention.working())
  })
})
