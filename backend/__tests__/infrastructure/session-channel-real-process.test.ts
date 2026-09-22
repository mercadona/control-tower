import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import { RunningServers } from '../servers.ts'
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

  static async openedOn(realTerminals: RealTerminals): Promise<{ port: number, session: LiveSession }> {
    const liveSessions = new PtyLiveSessions({
      spawn: realTerminals.spawn(),
      newId: () => randomUUID(),
      stderr: () => {},
      signal: (pid, signal) => process.kill(pid, signal),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      now: Date.now,
      termGraceMs: 2_000,
      killGraceMs: 2_000,
      pollMs: 25,
    })
    const session = liveSessions.open(PtyLiveSessions.loginShell(process.env.SHELL, process.cwd(), process.env))
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementProgress: undefined,
      implementHistory: undefined,
      externalTools: undefined,
      listLiveSessions: new ListLiveSessions({ liveSessions }),
      liveSessions,
      watchLiveSession: new WatchLiveSession({ liveSessions }),
      typeIntoSession: new TypeIntoSession({ liveSessions }),
      sessions: new PlanSessions(),
      activePlans: undefined,
      planEvents: RunningApi.#NO_EVENTS,
      stderr: undefined,
      frontendRoot: RunningApi.#NO_FRONTEND,
    })
    const port = await RunningServers.started(server)

    return { port, session }
  }

  static async stopAll(): Promise<void> {
    await RunningServers.stopAll()
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
  static readonly #opened = new Set<SseFrames>()
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>
  readonly #decoder: TextDecoder
  #buffer: string

  private constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.#reader = reader
    this.#decoder = new TextDecoder()
    this.#buffer = ''
    SseFrames.#opened.add(this)
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
    SseFrames.#opened.delete(this)
  }

  static async closeAll(): Promise<void> {
    const opened = [...SseFrames.#opened]
    await Promise.all(opened.map((frames) => frames.closedByAbort()))
  }

  static bytesOf(frame: string): string {
    return (JSON.parse(frame.slice('data: '.length).trim()) as StreamedFrame).bytes
  }
}

class Echo {
  static readonly #BUDGET_MS = 30_000

  static async reachesTheStream(frames: SseFrames, token: string): Promise<void> {
    await Echo.through(frames, token)
  }

  static async through(frames: SseFrames, token: string): Promise<string> {
    const held = { seen: '' }
    const reading = (async () => {
      for (;;) {
        held.seen += SseFrames.bytesOf(await frames.next())
        if (held.seen.includes(token)) return held.seen
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
      return await Promise.race([reading, budget])
    } finally {
      clearTimeout(timer!)
    }
  }
}

class AssembledToken {
  static unique(): string {
    return `ct-${randomUUID()}`
  }

  static typedInHalvesForTheShellToJoin(token: string): string {
    const first = token.slice(0, 1)
    const rest = token.slice(1)

    return `A=${first}; B=${rest}; echo "$A$B"\r`
  }
}

class Deadline {
  static async within<T>(promise: Promise<T>, milliseconds: number, detail: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${detail} within ${milliseconds}ms`)), milliseconds)
    })
    try {
      return await Promise.race([promise, expired])
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
    try {
      await SseFrames.closeAll()
      await RunningApi.stopAll()
    } finally {
      realTerminals.killAll()
    }
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

    const token = AssembledToken.unique()
    const typed = await RunningApi.typed(port, session.id, AssembledToken.typedInHalvesForTheShellToJoin(token))
    expect(typed.status).toBe(202)
    expect(await typed.json() as TypedBody).toEqual({ status: 'typed', id: session.id })

    await Echo.reachesTheStream(frames, token)

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

    const token = AssembledToken.unique()
    const typed = await RunningApi.typed(port, session.id, AssembledToken.typedInHalvesForTheShellToJoin(token))
    expect(typed.status).toBe(202)

    const secondSubscription = await SseFrames.openedOn(port, session.id)
    await Echo.reachesTheStream(secondSubscription, token)
    await secondSubscription.closedByAbort()
  })

  it('HTTP and SSE progress while noisy terminal ownership is inspected', async () => {
    const { port, session } = await RunningApi.openedOn(realTerminals)
    const frames = await SseFrames.openedOn(port, session.id)
    await frames.next()
    expect((await RunningApi.typed(port, session.id, 'A=CT_; B=READY; stty -echo; printf "$A$B\\n"\r')).status).toBe(202)
    await Deadline.within(Echo.through(frames, 'CT_READY'), 3_000, 'terminal echo was not disabled')
    const command = `node -e 'let i=0; process.stdout.write("CT_"+"BEGIN\\n"); ` +
      `const timer=setInterval(()=>{process.stdout.write(String(i).padStart(3,"0")+","); i++; ` +
      `if(i===60){clearInterval(timer); process.stdout.write("\\nCT_"+"PAUSED\\n"); ` +
      `process.stdin.once("data",()=>{while(i<120){process.stdout.write(String(i).padStart(3,"0")+","); i++} ` +
      `process.stdout.write("\\nCT_"+"END\\n")})}},5)' ; stty echo\r`
    try {
      expect((await RunningApi.typed(port, session.id, command)).status).toBe(202)
      const paused = await Deadline.within(
        Echo.through(frames, 'CT_PAUSED'), 10_000, 'the output flood did not reach its pause handshake'
      )
      const normalizedPaused = paused.replace(/\r/g, '')
      const firstHalf = normalizedPaused.match(/CT_BEGIN\n([^\n]+)\nCT_PAUSED\n/)?.[1]
      if (firstHalf === undefined) throw new Error(`paused flood framing was ${JSON.stringify(normalizedPaused)}`)
      expect(firstHalf).toBe(Array.from({ length: 60 }, (_, index) => `${String(index).padStart(3, '0')},`).join(''))

      const response = await Deadline.within(
        RunningApi.listed(port), 3_000, 'session listing did not progress while flood completion was blocked'
      )
      expect(response.status).toBe(200)
      expect((await response.json() as SessionsBody).sessions).toContainEqual({ id: session.id, name: session.name })
      expect(normalizedPaused).not.toContain('CT_END')

      expect((await RunningApi.typed(port, session.id, '\n')).status).toBe(202)
      const completed = await Deadline.within(
        Echo.through(frames, 'CT_END'), 10_000, 'the blocked output flood did not complete after its release handshake'
      )
      const assembled = (paused + completed).replace(/\r/g, '')
      const numbered = assembled.match(/CT_BEGIN\n([\s\S]*?)\nCT_END\n/)?.[1]
        ?.replace(/\nCT_PAUSED\n\n?/g, '')
      expect(numbered).toBe(
        Array.from({ length: 120 }, (_, index) => `${String(index).padStart(3, '0')},`).join('')
      )
    } finally {
      await frames.closedByAbort()
    }
  })
})
