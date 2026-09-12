import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { ReviewsSpy } from '../reviews-spy.ts'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import { TypeIntoSession, TypeIntoSessionParams } from '../../src/application/actions/type-into-session.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'

class LiveSessionMother {
  static claude(): LiveSession {
    return new LiveSession({ id: 'session-1', name: 'claude' })
  }
}

class LiveSessionsDouble extends LiveSessions {
  readonly held: Map<string, LiveSession>

  constructor(sessions: LiveSession[]) {
    super()
    this.held = new Map(sessions.map((session) => [session.id, session]))
  }

  static holding(...sessions: LiveSession[]): LiveSessionsDouble {
    return new LiveSessionsDouble(sessions)
  }

  find(id: string): LiveSession | null {
    return this.held.get(id) ?? null
  }
}

class TypeIntoSessionSpy extends TypeIntoSession {
  readonly asked: TypeIntoSessionParams[]

  constructor() {
    super({ liveSessions: new LiveSessions() })
    this.asked = []
  }

  execute(params: TypeIntoSessionParams): void {
    this.asked.push(params)
  }
}

class RunningApi {
  static readonly #started: ApiServer[] = []
  static readonly NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static readonly NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })

  static async listening(liveSessions: LiveSessions, typeIntoSession: TypeIntoSession): Promise<number> {
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      askPlanChanges: undefined,
      implementProgress: undefined,
      externalTools: undefined,
      listLiveSessions: undefined,
      liveSessions,
      typeIntoSession,
      reviews: new ReviewsSpy(),
      pullRequestReviews: undefined,
      sessions: new PlanSessions(),
      activePlans: undefined,
      implementationStarts: undefined,
      planEvents: RunningApi.NO_EVENTS,
      stderr: undefined,
      readPlanProgress: null,
      frontendRoot: RunningApi.NO_FRONTEND,
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
    liveSessions: LiveSessions, typeIntoSession: TypeIntoSession, id: string, body: string,
    headers: Record<string, string> = { 'Content-Type': 'application/json' }
  ): Promise<Response> {
    const port = await RunningApi.listening(liveSessions, typeIntoSession)

    return fetch(`http://127.0.0.1:${port}/sessions/${id}/input`, { method: 'POST', body, headers })
  }

  static async getting(liveSessions: LiveSessions, typeIntoSession: TypeIntoSession, id: string): Promise<Response> {
    const port = await RunningApi.listening(liveSessions, typeIntoSession)

    return fetch(`http://127.0.0.1:${port}/sessions/${id}/input`)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('SessionInputRoute', () => {
  it('the text typed on the page reaches the session', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const typeIntoSession = new TypeIntoSessionSpy()

    const response = await RunningApi.post(liveSessions, typeIntoSession, claude.id, '{"text":"ls\\r"}')

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'typed', id: claude.id })
    expect(typeIntoSession.asked).toEqual([{ session: claude, text: 'ls\r' }])
  })

  it('a lone carriage return is text and reaches the session', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const typeIntoSession = new TypeIntoSessionSpy()

    const response = await RunningApi.post(liveSessions, typeIntoSession, claude.id, '{"text":"\\r"}')

    expect(response.status).toBe(202)
    expect(typeIntoSession.asked).toEqual([{ session: claude, text: '\r' }])
  })

  it('an empty text is refused with malformed-text', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const typeIntoSession = new TypeIntoSessionSpy()

    const response = await RunningApi.post(liveSessions, typeIntoSession, claude.id, '{"text":""}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'malformed-text', detail: 'text must be a non-empty string' })
    expect(typeIntoSession.asked).toEqual([])
  })

  it('an unknown id is refused as session-not-live', async () => {
    const liveSessions = LiveSessionsDouble.holding()
    const typeIntoSession = new TypeIntoSessionSpy()

    const response = await RunningApi.post(liveSessions, typeIntoSession, 'missing-session', '{"text":"ls\\r"}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'session-not-live', detail: 'no live session answers to that id' })
    expect(typeIntoSession.asked).toEqual([])
  })

  it('an unknown field is refused naming it', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const typeIntoSession = new TypeIntoSessionSpy()

    const response = await RunningApi.post(liveSessions, typeIntoSession, claude.id, '{"text":"ls\\r","zip":1}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'unknown-field', detail: 'unknown field: zip' })
    expect(typeIntoSession.asked).toEqual([])
  })

  it('a method other than POST is refused naming POST as allowed', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const typeIntoSession = new TypeIntoSessionSpy()

    const response = await RunningApi.getting(liveSessions, typeIntoSession, claude.id)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(typeIntoSession.asked).toEqual([])
  })
})
