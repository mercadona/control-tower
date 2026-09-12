import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import {
  WatchLiveSession, WatchLiveSessionParams, WatchLiveSessionResult,
} from '../../src/application/queries/watch-live-session.ts'
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

class WatchLiveSessionSpy extends WatchLiveSession {
  readonly asked: WatchLiveSessionParams[]
  readonly printed: string
  stopped: number
  #onStop: (() => void) | null

  constructor(printed: string) {
    super({ liveSessions: new LiveSessions() })
    this.asked = []
    this.printed = printed
    this.stopped = 0
    this.#onStop = null
  }

  static printing(printed: string): WatchLiveSessionSpy {
    return new WatchLiveSessionSpy(printed)
  }

  execute(params: WatchLiveSessionParams): WatchLiveSessionResult {
    this.asked.push(params)

    return new WatchLiveSessionResult({
      printed: this.printed,
      stop: () => {
        this.stopped += 1
        this.#onStop?.()
      },
    })
  }

  latestOnBytes(): (bytes: string) => void {
    return this.asked[this.asked.length - 1].onBytes
  }

  stoppedOnce(): Promise<void> {
    return new Promise((resolve) => { this.#onStop = resolve })
  }
}

class WithinBudget {
  static readonly #MS = 2_000

  static async awaited<T>(promise: Promise<T>, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>
    const budget = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} did not happen within ${WithinBudget.#MS}ms`)), WithinBudget.#MS)
    })
    try {
      return await Promise.race([promise, budget])
    } finally {
      clearTimeout(timer!)
    }
  }
}

class SseFrames {
  buffer: string
  readonly reader: ReadableStreamDefaultReader<Uint8Array>
  readonly decoder: TextDecoder

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader
    this.decoder = new TextDecoder()
    this.buffer = ''
  }

  static of(response: Response): SseFrames {
    return new SseFrames(response.body!.getReader())
  }

  async next(): Promise<string> {
    for (;;) {
      const boundary = this.buffer.indexOf('\n\n')
      if (boundary !== -1) {
        const frame = this.buffer.slice(0, boundary + 2)
        this.buffer = this.buffer.slice(boundary + 2)

        return frame
      }
      const { value, done } = await WithinBudget.awaited(this.reader.read(), 'a frame arriving')
      if (done) throw new Error('the stream ended before a full frame arrived')
      this.buffer += this.decoder.decode(value, { stream: true })
    }
  }

  async close(): Promise<void> {
    await this.reader.cancel()
  }
}

class RunningApi {
  static readonly #started: ApiServer[] = []
  static readonly NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static readonly NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })

  static async listening(liveSessions: LiveSessions, watchLiveSession: WatchLiveSession): Promise<number> {
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      implementProgress: undefined,
      externalTools: undefined,
      listLiveSessions: undefined,
      liveSessions,
      watchLiveSession,
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

  static async streaming(liveSessions: LiveSessions, watchLiveSession: WatchLiveSession, id: string): Promise<Response> {
    const port = await RunningApi.listening(liveSessions, watchLiveSession)

    return fetch(`http://127.0.0.1:${port}/sessions/${id}/stream`)
  }

  static async posting(liveSessions: LiveSessions, watchLiveSession: WatchLiveSession, id: string): Promise<Response> {
    const port = await RunningApi.listening(liveSessions, watchLiveSession)

    return fetch(`http://127.0.0.1:${port}/sessions/${id}/stream`, { method: 'POST' })
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('SessionStreamRoute', () => {
  it('the stream opens with what the session already printed', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const watchLiveSession = WatchLiveSessionSpy.printing('hola')

    const response = await RunningApi.streaming(liveSessions, watchLiveSession, claude.id)
    const frames = SseFrames.of(response)

    expect(await frames.next()).toBe('data: {"bytes":"hola"}\n\n')

    await frames.close()
  })

  it('bytes printed while the stream is open reach it as they are printed', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const watchLiveSession = WatchLiveSessionSpy.printing('hola')

    const response = await RunningApi.streaming(liveSessions, watchLiveSession, claude.id)
    const frames = SseFrames.of(response)
    await frames.next()

    watchLiveSession.latestOnBytes()('mas bytes')

    expect(await frames.next()).toBe('data: {"bytes":"mas bytes"}\n\n')

    await frames.close()
  })

  it('closing the stream stops only that watch and leaves the session live', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const watchLiveSession = WatchLiveSessionSpy.printing('hola')

    const response = await RunningApi.streaming(liveSessions, watchLiveSession, claude.id)
    const frames = SseFrames.of(response)
    await frames.next()

    const stopped = watchLiveSession.stoppedOnce()
    await frames.close()
    await WithinBudget.awaited(stopped, 'the watch was stopped')

    expect(watchLiveSession.stopped).toBe(1)
    expect(liveSessions.find(claude.id)).toBe(claude)
  })

  it('an unknown id is refused with session-not-live', async () => {
    const liveSessions = LiveSessionsDouble.holding()
    const watchLiveSession = WatchLiveSessionSpy.printing('never reached')

    const response = await RunningApi.streaming(liveSessions, watchLiveSession, 'missing-session')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'session-not-live', detail: 'no live session answers to that id' })
    expect(watchLiveSession.asked).toEqual([])
  })

  it('a method other than GET is refused naming GET as allowed', async () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(claude)
    const watchLiveSession = WatchLiveSessionSpy.printing('hola')

    const response = await RunningApi.posting(liveSessions, watchLiveSession, claude.id)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(watchLiveSession.asked).toEqual([])
  })
})
