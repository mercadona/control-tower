import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState } from '../../src/infrastructure/coordinating-sessions.ts'
import { SessionHooksRoute } from '../../src/infrastructure/session-hooks-route.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'

class LiveSessionsDouble extends LiveSessions {
  find(id: string): LiveSession | null {
    return id === Mother.SESSION.id ? Mother.SESSION : null
  }

  watch(): LiveSessionStream {
    return { printed: '', stop: (): void => {} }
  }
}

class RecordsDouble extends ConversationRecords {
  failing: boolean
  recorded: boolean[]
  #delayMs: number

  constructor(failing = false) {
    super()
    this.failing = failing
    this.recorded = []
    this.#delayMs = 0
  }

  delayEachWriteBy(ms: number): void {
    this.#delayMs = ms
  }

  async appendTimelineEvent(): Promise<void> {
    if (this.#delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.#delayMs))
    if (this.failing) throw new Error('disk is full')
    this.recorded.push(true)
  }
}

class Mother {
  static readonly CONVERSATION_ID = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
  static readonly CONVERSATION = new CoordinatingConversation({
    id: new ConversationId(Mother.CONVERSATION_ID),
    repository: new RepositoryName('josemerca/ct-loop-sandbox'),
    root: new CheckoutRoot('/repo'),
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })

  static held(attention: SessionAttention, records: ConversationRecords = new RecordsDouble()): CoordinatingSessions {
    const sessions = new CoordinatingSessions({ liveSessions: new LiveSessionsDouble(), stderr: (): void => {}, records })
    sessions.remember(new HeldCoordinatingSession({
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention,
    }))

    return sessions
  }
}

class Hook {
  static readonly CWD = '/repo'
  static readonly TRANSCRIPT = '/home/someone/.claude/projects/-repo/2b1a6c2e.jsonl'
  static readonly IDLE_PROMPT = 'idle_prompt'
  static readonly AUTH_SUCCESS = 'auth_success'

  static #of(event: string, own: Readonly<Record<string, unknown>>, conversation = Mother.CONVERSATION_ID): string {
    return JSON.stringify({
      session_id: conversation,
      transcript_path: Hook.TRANSCRIPT,
      cwd: Hook.CWD,
      hook_event_name: event,
      ...own,
    })
  }

  static userPromptSubmit(input: string): string {
    return Hook.#of('UserPromptSubmit', { user_input: input })
  }

  static stop(own: Readonly<Record<string, unknown>> = {}): string {
    return Hook.#of('Stop', own)
  }

  static stopOf(conversation: string): string {
    return Hook.#of('Stop', {}, conversation)
  }

  static notification(type: string, message: string): string {
    return Hook.#of('Notification', { notification_type: type, message })
  }

  static unknownEvent(): string {
    return Hook.#of('PreToolUse', {})
  }
}

class RunningApi {
  static readonly #started: ApiServer[] = []
  static readonly PATH = SessionHooksRoute.PATH
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
  it('reads a Stop as a completed turn, never as a question, however it phrases its last message', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(
      held, Hook.stop({ last_assistant_message: '  should the button read Arrancar brainstorming?  ' })
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'reported', attention: 'waiting' })
    expect(held.held()?.attention).toEqual(SessionAttention.waiting(null))
    expect(held.timeline().at(-1)?.kind).toBe(TimelineEventKind.COMPLETED)
    expect(held.timeline().at(-1)?.detail).toBeNull()
  })

  it('leaves the question empty when the Stop carries no final message', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(held, Hook.stop())

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'reported', attention: 'waiting' })
    expect(held.held()?.attention).toEqual(SessionAttention.waiting(null))
  })

  it('shows a permission prompt as what the session is waiting for', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(
      held, Hook.notification('permission_prompt', 'Claude needs your permission to use Bash')
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'reported', attention: 'waiting' })
    expect(held.held()?.attention).toEqual(SessionAttention.waiting('Claude needs your permission to use Bash'))
    expect(held.timeline().at(-1)?.kind).toBe(TimelineEventKind.WAITING_FOR_PERMISSION)
    expect(held.timeline().at(-1)?.detail).toBe('Claude needs your permission to use Bash')
  })

  it('does not show an authentication notification as a question', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(held, Hook.notification(Hook.AUTH_SUCCESS, 'Authentication successful'))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'ignored' })
    expect(held.held()?.attention).toEqual(SessionAttention.working())
  })

  it('does not erase with an idle notification the question of a previous permission prompt', async () => {
    const held = Mother.held(SessionAttention.working())
    await RunningApi.post(held, Hook.notification('permission_prompt', 'which of the two screens do you mean?'))

    const response = await RunningApi.post(held, Hook.notification(Hook.IDLE_PROMPT, 'Claude is waiting for your input'))

    expect(response.status).toBe(202)
    expect(held.held()?.attention).toEqual(SessionAttention.waiting('which of the two screens do you mean?'))
  })

  it('drops the question when the session works again', async () => {
    const held = Mother.held(SessionAttention.waiting('should the button read Arrancar brainstorming?'))

    const response = await RunningApi.post(held, Hook.userPromptSubmit('the second one'))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'reported', attention: 'working' })
    expect(held.held()?.attention).toEqual(SessionAttention.working())
    expect(held.timeline().at(-1)?.kind).toBe(TimelineEventKind.WORKING)
  })

  it('acknowledges only after the timeline event has actually been persisted', async () => {
    const records = new RecordsDouble()
    records.delayEachWriteBy(20)
    const held = Mother.held(SessionAttention.working(), records)

    const response = await RunningApi.post(held, Hook.userPromptSubmit('go'))

    expect(response.status).toBe(202)
    expect(records.recorded).toEqual([true])
  })

  it('refuses timeline-not-recorded instead of falsely acknowledging a write that failed', async () => {
    const held = Mother.held(SessionAttention.working(), new RecordsDouble(true))

    const response = await RunningApi.post(held, Hook.userPromptSubmit('go'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'timeline-not-recorded',
      detail: 'the attention moved but the timeline event could not be recorded',
    })
    expect(held.held()?.attention).toEqual(SessionAttention.working())
  })

  it('ignores the fields of the payload it does not know', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(
      held, Hook.stop({ stop_hook_active: false, permission_mode: 'acceptEdits' })
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'reported', attention: 'waiting' })
  })

  it('refuses an event it does not know with hook-not-understood', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(held, Hook.unknownEvent())

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'hook-not-understood',
      detail: 'the hook payload does not carry a known event and a session id',
    })
    expect(held.held()?.attention).toEqual(SessionAttention.working())
  })

  it('refuses an id that is not the held conversation with conversation-not-live', async () => {
    const held = Mother.held(SessionAttention.working())

    const response = await RunningApi.post(held, Hook.stopOf('not-the-held-conversation'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'conversation-not-live',
      detail: 'no held conversation answers to that session id',
    })
    expect(held.held()?.attention).toEqual(SessionAttention.working())
  })
})
