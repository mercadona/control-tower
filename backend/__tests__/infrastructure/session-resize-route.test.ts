import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import { ResizeSession, ResizeSessionParams } from '../../src/application/actions/resize-session.ts'
import { LiveSessions, LiveSessionNotLive } from '../../src/domain/ports/live-sessions.ts'
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

class ResizeSessionSpy extends ResizeSession {
  readonly asked: ResizeSessionParams[]

  constructor() {
    super({ liveSessions: new LiveSessions() })
    this.asked = []
  }

  execute(params: ResizeSessionParams): void {
    this.asked.push(params)
  }
}

class ResizeSessionThatFoundTheSessionGone extends ResizeSession {
  constructor() {
    super({ liveSessions: new LiveSessions() })
  }

  execute(params: ResizeSessionParams): void {
    throw new LiveSessionNotLive(params.session.id)
  }
}

class RunningApi {
  static readonly #started: ApiServer[] = []
  static readonly NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static readonly NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })

  static async listening(liveSessions: LiveSessions, resizeSession: ResizeSession): Promise<number> {
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      implementProgress: undefined,
      externalTools: undefined,
      listLiveSessions: undefined,
      liveSessions,
      resizeSession,
      pullRequestReviews: undefined,
      sessions: new PlanSessions(),
      activePlans: undefined,
      implementationStarts: undefined,
      planEvents: RunningApi.NO_EVENTS,
      stderr: undefined,
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
    liveSessions: LiveSessions, resizeSession: ResizeSession, id: string, body: string,
    headers: Record<string, string> = { 'Content-Type': 'application/json' }
  ): Promise<Response> {
    const port = await RunningApi.listening(liveSessions, resizeSession)

    return fetch(`http://127.0.0.1:${port}/sessions/${id}/resize`, { method: 'POST', body, headers })
  }

  static async getting(liveSessions: LiveSessions, resizeSession: ResizeSession, id: string): Promise<Response> {
    const port = await RunningApi.listening(liveSessions, resizeSession)

    return fetch(`http://127.0.0.1:${port}/sessions/${id}/resize`)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('SessionResizeRoute', () => {
  it('the size asked from the page reaches the session', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const resizeSession = new ResizeSessionSpy()

    const response = await RunningApi.post(liveSessions, resizeSession, claude.id, '{"cols":120,"rows":40}')

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'resized', id: claude.id, cols: 120, rows: 40 })
    expect(resizeSession.asked).toEqual([{ session: claude, cols: 120, rows: 40 }])
  })

  it('a non-JSON body is refused as body-not-a-json-object', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const resizeSession = new ResizeSessionSpy()

    const response = await RunningApi.post(liveSessions, resizeSession, claude.id, 'not json')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'body-not-a-json-object', detail: 'body must be a JSON object' })
    expect(resizeSession.asked).toEqual([])
  })

  it('an unknown field is refused naming it', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const resizeSession = new ResizeSessionSpy()

    const response = await RunningApi.post(liveSessions, resizeSession, claude.id, '{"cols":120,"rows":40,"zip":1}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'unknown-field', detail: 'unknown field: zip' })
    expect(resizeSession.asked).toEqual([])
  })

  it('cols 0 is refused as malformed-size', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const resizeSession = new ResizeSessionSpy()

    const response = await RunningApi.post(liveSessions, resizeSession, claude.id, '{"cols":0,"rows":40}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-size',
      detail: 'cols and rows must be positive integers, at most 500 and 300',
    })
    expect(resizeSession.asked).toEqual([])
  })

  it('rows as a string is refused as malformed-size', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const resizeSession = new ResizeSessionSpy()

    const response = await RunningApi.post(liveSessions, resizeSession, claude.id, '{"cols":120,"rows":"24"}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-size',
      detail: 'cols and rows must be positive integers, at most 500 and 300',
    })
    expect(resizeSession.asked).toEqual([])
  })

  it('an oversize is refused as malformed-size', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const resizeSession = new ResizeSessionSpy()

    const response = await RunningApi.post(liveSessions, resizeSession, claude.id, '{"cols":501,"rows":40}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-size',
      detail: 'cols and rows must be positive integers, at most 500 and 300',
    })
    expect(resizeSession.asked).toEqual([])
  })

  it('an unknown id is refused as session-not-live', async () => {
    const liveSessions = LiveSessionsDouble.holding()
    const resizeSession = new ResizeSessionSpy()

    const response = await RunningApi.post(liveSessions, resizeSession, 'missing-session', '{"cols":120,"rows":40}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'session-not-live', detail: 'no live session answers to that id' })
    expect(resizeSession.asked).toEqual([])
  })

  it('a session whose pty already closed its fd is refused as session-not-live, not a request failure', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const resizeSession = new ResizeSessionThatFoundTheSessionGone()

    const response = await RunningApi.post(liveSessions, resizeSession, claude.id, '{"cols":120,"rows":40}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'session-not-live', detail: 'no live session answers to that id' })
  })

  it('a method other than POST is refused naming POST as allowed', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const resizeSession = new ResizeSessionSpy()

    const response = await RunningApi.getting(liveSessions, resizeSession, claude.id)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(resizeSession.asked).toEqual([])
  })
})
