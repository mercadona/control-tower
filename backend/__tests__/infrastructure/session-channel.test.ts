import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import { RunningServers } from '../servers.ts'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { PtyLiveSessions } from '../../src/infrastructure/pty-live-sessions.ts'
import { ProcessTable } from '../../src/infrastructure/process-table.ts'
import type { TableRead, Terminal, TerminalOptions } from '../../src/infrastructure/process-table.ts'
import { ListLiveSessions } from '../../src/application/queries/list-live-sessions.ts'
import { WatchLiveSession } from '../../src/application/queries/watch-live-session.ts'
import { TypeIntoSession } from '../../src/application/actions/type-into-session.ts'
import type { LiveSession } from '../../src/domain/value-objects/live-session.ts'

type SessionsBody = { sessions: { id: string, name: string }[] }

type TypedBody = { status: string, id: string }

type StreamedFrame = { bytes: string }

class EchoingTerminal implements Terminal {
  readonly pid: number
  #onData: ((bytes: string) => void) | null = null
  #onExit: (() => void) | null = null

  constructor(pid: number) {
    this.pid = pid
  }

  onData(listener: (bytes: string) => void): void {
    this.#onData = listener
  }

  onExit(listener: () => void): void {
    this.#onExit = listener
  }

  write(text: string): void {
    this.#onData?.(text)
  }

  resize(_cols: number, _rows: number): void {}

  prints(bytes: string): void {
    if (this.#onData === null) throw new Error('EchoingTerminal: nobody is listening for data yet')
    this.#onData(bytes)
  }
}

class EchoingTerminals extends ProcessTable {
  static readonly #START = 'Thu Sep 17 22:29:08 2026'

  readonly opened: EchoingTerminal[] = []
  holdsInspections = false
  #nextPid = 81_000
  #held: (() => void)[] = []

  override openTerminal(_file: string, _argv: string[], _options: TerminalOptions): Terminal {
    const terminal = new EchoingTerminal(this.#nextPid)
    this.#nextPid += 1
    this.opened.push(terminal)

    return terminal
  }

  override readTable(_read: TableRead): Promise<string> {
    if (!this.holdsInspections) return Promise.resolve(this.#rows())

    return new Promise<string>((resolve) => {
      this.#held.push(() => resolve(this.#rows()))
    })
  }

  releaseInspections(): void {
    const held = this.#held.splice(0)
    for (const release of held) release()
  }

  #rows(): string {
    return this.opened.map((terminal) => `${terminal.pid} ${terminal.pid} ${EchoingTerminals.#START}`).join('\n')
  }
}

class NumberedBatch {
  static from(start: number, count: number): string {
    return Array.from({ length: count }, (_, index) => `${String(start + index).padStart(3, '0')},`).join('')
  }
}

class RunningApi {
  static readonly #NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static readonly #CWD = '/repo/channel'

  static async openedOn(table: EchoingTerminals): Promise<{ port: number, session: LiveSession, terminal: EchoingTerminal }> {
    const liveSessions = new PtyLiveSessions({
      spawn: table.openTerminal.bind(table),
      newId: () => randomUUID(),
      stderr: () => {},
      signal: table.signal.bind(table),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      now: Date.now,
      termGraceMs: 2_000,
      killGraceMs: 2_000,
      pollMs: 25,
      inspectProcessTable: table.readTable.bind(table),
    })
    const session = liveSessions.open(PtyLiveSessions.loginShell('/bin/zsh', RunningApi.#CWD, { PATH: '/usr/bin' }))
    const terminal = table.opened[table.opened.length - 1]
    const server = new ApiServer({
      port: 0,
      implementHistory: undefined,
      externalTools: undefined,
      listLiveSessions: new ListLiveSessions({ liveSessions }),
      liveSessions,
      watchLiveSession: new WatchLiveSession({ liveSessions }),
      typeIntoSession: new TypeIntoSession({ liveSessions }),
      activePlans: undefined,
      stderr: undefined,
      frontendRoot: RunningApi.#NO_FRONTEND,
    })
    const port = await RunningServers.started(server)

    return { port, session, terminal }
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

class WithinBudget {
  static readonly #MS = 2_000

  static async awaited<T>(promise: Promise<T>, detail: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>
    const budget = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${detail} within ${WithinBudget.#MS}ms`)), WithinBudget.#MS)
    })
    try {
      return await Promise.race([promise, budget])
    } finally {
      clearTimeout(timer!)
    }
  }
}

describe('the session channel over one EchoingTerminals double', () => {
  let table: EchoingTerminals

  beforeEach(() => {
    table = new EchoingTerminals()
  })

  afterEach(async () => {
    await SseFrames.closeAll()
    await RunningApi.stopAll()
  })

  it('the live session is listed, its stream carries what it prints and what is typed reaches it', async () => {
    const { port, session } = await RunningApi.openedOn(table)

    const listedBefore = await RunningApi.listed(port)
    expect(listedBefore.status).toBe(200)
    expect(await listedBefore.json() as SessionsBody).toEqual({
      sessions: [{ id: session.id, name: session.name }],
    })

    const frames = await SseFrames.openedOn(port, session.id)
    await frames.next()

    const token = `ct-${randomUUID()}`
    const typed = await RunningApi.typed(port, session.id, token)
    expect(typed.status).toBe(202)
    expect(await typed.json() as TypedBody).toEqual({ status: 'typed', id: session.id })

    const echoed = await WithinBudget.awaited(frames.next(), `${JSON.stringify(token)} reaching the stream`)
    expect(SseFrames.bytesOf(echoed)).toBe(token)

    await frames.closedByAbort()
  })

  it('closing the stream leaves the session listed and its process alive', async () => {
    const { port, session } = await RunningApi.openedOn(table)

    const frames = await SseFrames.openedOn(port, session.id)
    await frames.next()
    await frames.closedByAbort()

    const listedAfterClose = await RunningApi.listed(port)
    expect(listedAfterClose.status).toBe(200)
    expect(await listedAfterClose.json() as SessionsBody).toEqual({
      sessions: [{ id: session.id, name: session.name }],
    })

    const token = `ct-${randomUUID()}`
    const typed = await RunningApi.typed(port, session.id, token)
    expect(typed.status).toBe(202)

    const secondSubscription = await SseFrames.openedOn(port, session.id)
    const echoed = await WithinBudget.awaited(
      secondSubscription.next(), `${JSON.stringify(token)} reaching the reopened stream`
    )
    expect(SseFrames.bytesOf(echoed)).toBe(token)

    await secondSubscription.closedByAbort()
  })

  it('the listing answers and the stream keeps every byte in order while an inspection is pending', async () => {
    table.holdsInspections = true
    const { port, session, terminal } = await RunningApi.openedOn(table)

    const frames = await SseFrames.openedOn(port, session.id)
    await frames.next()

    const firstHalf = NumberedBatch.from(0, 60)
    terminal.prints(firstHalf)
    const firstFrame = await WithinBudget.awaited(frames.next(), 'the first half arriving')
    expect(SseFrames.bytesOf(firstFrame)).toBe(firstHalf)

    const listedWhilePending = await RunningApi.listed(port)
    expect(listedWhilePending.status).toBe(200)
    expect(await listedWhilePending.json() as SessionsBody).toEqual({
      sessions: [{ id: session.id, name: session.name }],
    })

    const secondHalf = NumberedBatch.from(60, 60)
    terminal.prints(secondHalf)
    const secondFrame = await WithinBudget.awaited(frames.next(), 'the second half arriving')
    expect(SseFrames.bytesOf(secondFrame)).toBe(secondHalf)

    table.releaseInspections()
    await frames.closedByAbort()
  })
})
