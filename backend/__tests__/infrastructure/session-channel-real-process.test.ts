import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import { PtyLiveSessions } from '../../src/infrastructure/pty-live-sessions.ts'
import type { TerminalSpawn } from '../../src/infrastructure/pty-live-sessions.ts'
import { ListLiveSessions } from '../../src/application/queries/list-live-sessions.ts'
import { WatchLiveSession } from '../../src/application/queries/watch-live-session.ts'
import { TypeIntoSession } from '../../src/application/actions/type-into-session.ts'
import type { LiveSession } from '../../src/domain/value-objects/live-session.ts'

type SessionsBody = { sessions: { id: string, name: string }[] }

type TypedBody = { status: string, id: string }

type StreamedFrame = { bytes: string }

class RealTerminals {
  readonly #opened: IPty[] = []

  spawn(): TerminalSpawn {
    return (file, argv, options) => {
      const terminal = spawn(file, argv, options)
      this.#opened.push(terminal)

      return terminal
    }
  }

  killAll(): void {
    for (const terminal of this.#opened) terminal.kill()
  }
}

class RunningApi {
  static readonly #NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static readonly #NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })
  static readonly #started: ApiServer[] = []

  static async openedOn(realTerminals: RealTerminals): Promise<{ port: number, session: LiveSession }> {
    const liveSessions = new PtyLiveSessions({
      spawn: realTerminals.spawn(),
      shell: process.env.SHELL,
      cwd: process.cwd(),
      env: process.env,
      newId: () => randomUUID(),
      stderr: () => {},
    })
    const session = liveSessions.open()
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      implementProgress: undefined,
      implementHistory: undefined,
      externalTools: undefined,
      listLiveSessions: new ListLiveSessions({ liveSessions }),
      liveSessions,
      watchLiveSession: new WatchLiveSession({ liveSessions }),
      typeIntoSession: new TypeIntoSession({ liveSessions }),
      pullRequestReviews: undefined,
      sessions: new PlanSessions(),
      activePlans: undefined,
      implementationStarts: undefined,
      planEvents: RunningApi.#NO_EVENTS,
      stderr: undefined,
      frontendRoot: RunningApi.#NO_FRONTEND,
    })
    const port = await server.start()
    RunningApi.#started.push(server)

    return { port, session }
  }

  static async stopAll(): Promise<void> {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => server.stop()))
  }

  static listed(port: number): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/sessions`)
  }

  static typed(port: number, id: string, text: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/sessions/${id}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  }
}

class SseFrames {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>
  readonly #decoder: TextDecoder
  #buffer: string

  private constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.#reader = reader
    this.#decoder = new TextDecoder()
    this.#buffer = ''
  }

  static async openedOn(port: number, id: string): Promise<SseFrames> {
    const response = await fetch(`http://127.0.0.1:${port}/sessions/${id}/stream`)

    return new SseFrames(response.body!.getReader())
  }

  async next(): Promise<string> {
    for (;;) {
      const boundary = this.#buffer.indexOf('\n\n')
      if (boundary !== -1) {
        const frame = this.#buffer.slice(0, boundary + 2)
        this.#buffer = this.#buffer.slice(boundary + 2)

        return frame
      }
      const { value, done } = await this.#reader.read()
      if (done) throw new Error('the stream ended before a full frame arrived')
      this.#buffer += this.#decoder.decode(value, { stream: true })
    }
  }

  async closedByAbort(): Promise<void> {
    await this.#reader.cancel().catch(() => {})
  }

  static bytesOf(frame: string): string {
    return (JSON.parse(frame.slice('data: '.length).trim()) as StreamedFrame).bytes
  }
}

class Echo {
  static readonly #BUDGET_MS = 30_000

  static async reachesTheStream(frames: SseFrames, token: string): Promise<void> {
    const held = { seen: '' }
    const reading = (async () => {
      for (;;) {
        held.seen += SseFrames.bytesOf(await frames.next())
        if (held.seen.includes(token)) return
      }
    })()
    let timer: ReturnType<typeof setTimeout>
    const budget = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(
        `${JSON.stringify(token)} never reached the stream within ${Echo.#BUDGET_MS}ms; ` +
        `seen so far: ${JSON.stringify(held.seen)}`
      )), Echo.#BUDGET_MS)
    })
    try {
      await Promise.race([reading, budget])
    } finally {
      clearTimeout(timer!)
    }
  }
}

describe('the session channel over one real process', () => {
  let realTerminals: RealTerminals

  beforeEach(() => {
    realTerminals = new RealTerminals()
  })

  afterEach(async () => {
    await RunningApi.stopAll()
    realTerminals.killAll()
  })

  it('the live session is listed, its stream carries what it prints and what is typed reaches it', async () => {
    const { port, session } = await RunningApi.openedOn(realTerminals)

    const listedBefore = await RunningApi.listed(port)
    expect(listedBefore.status).toBe(200)
    expect(await listedBefore.json() as SessionsBody).toEqual({
      sessions: [{ id: session.id, name: session.name }],
    })

    const frames = await SseFrames.openedOn(port, session.id)
    await frames.next()

    const typed = await RunningApi.typed(port, session.id, 'echo ct\r')
    expect(typed.status).toBe(202)
    expect(await typed.json() as TypedBody).toEqual({ status: 'typed', id: session.id })

    await Echo.reachesTheStream(frames, 'ct')

    await frames.closedByAbort()
  })

  it('closing the stream leaves the session listed and its process alive', async () => {
    const { port, session } = await RunningApi.openedOn(realTerminals)

    const frames = await SseFrames.openedOn(port, session.id)
    await frames.next()
    await frames.closedByAbort()

    const listedAfterClose = await RunningApi.listed(port)
    expect(listedAfterClose.status).toBe(200)
    expect(await listedAfterClose.json() as SessionsBody).toEqual({
      sessions: [{ id: session.id, name: session.name }],
    })

    const typed = await RunningApi.typed(port, session.id, 'echo ct\r')
    expect(typed.status).toBe(202)

    const secondSubscription = await SseFrames.openedOn(port, session.id)
    await Echo.reachesTheStream(secondSubscription, 'ct')
    await secondSubscription.closedByAbort()
  })
})
