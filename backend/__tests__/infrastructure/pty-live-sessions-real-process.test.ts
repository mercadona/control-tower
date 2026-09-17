import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { PtyLiveSessions } from '../../src/infrastructure/pty-live-sessions.ts'
import type { TerminalSpawn } from '../../src/infrastructure/pty-live-sessions.ts'
import { SessionProgram } from '../../src/domain/value-objects/session-program.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import type { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import type { SessionClosure } from '../../src/domain/value-objects/session-closure.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import {
  CloseCoordinatingSession,
  CloseCoordinatingSessionParams,
} from '../../src/application/actions/close-coordinating-session.ts'

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

class Deferred {
  readonly promise: Promise<void>
  #resolve: (() => void) | null = null

  constructor() {
    this.promise = new Promise((resolve) => { this.#resolve = resolve })
  }

  resolve(): void {
    this.#resolve?.()
  }
}

class PausedClosureRecords extends ConversationRecords {
  readonly requested = new Deferred()
  readonly release = new Deferred()
  closure: SessionClosure | null = null

  async recallClosure(): Promise<SessionClosure | null> {
    return this.closure
  }

  async requestClosure(closure: SessionClosure): Promise<void> {
    this.closure = closure
    this.requested.resolve()
    await this.release.promise
  }

  async completeClosure(closure: SessionClosure): Promise<void> {
    this.closure = closure
  }
}

class Processes {
  static exists(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (failure) {
      return (failure as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  }

  static async absent(pid: number, milliseconds = 2_000): Promise<void> {
    const until = Date.now() + milliseconds
    while (Date.now() < until) {
      if (!Processes.exists(pid)) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (Processes.exists(pid)) throw new Error(`process ${pid} remained present after ${milliseconds}ms`)
  }

  static groupExists(group: number): boolean {
    try {
      process.kill(-group, 0)
      return true
    } catch (failure) {
      return (failure as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  }

  static async groupAbsent(group: number, milliseconds = 2_000): Promise<void> {
    const until = Date.now() + milliseconds
    while (Date.now() < until) {
      if (!Processes.groupExists(group)) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (Processes.groupExists(group)) throw new Error(`process group ${group} remained present after ${milliseconds}ms`)
  }
}

class RealTerminals {
  readonly opened: IPty[] = []

  spawn(): TerminalSpawn {
    return (file, argv, options) => {
      const terminal = spawn(file, argv, options)
      this.opened.push(terminal)
      return terminal
    }
  }

  async closeAll(): Promise<void> {
    for (const terminal of this.opened) this.#send(terminal.pid, 'SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 100))
    for (const terminal of this.opened) {
      if (Processes.groupExists(terminal.pid)) this.#send(terminal.pid, 'SIGKILL')
    }
    await Promise.all(this.opened.flatMap((terminal) => [
      Processes.groupAbsent(terminal.pid),
      Processes.absent(terminal.pid),
    ]))
    this.opened.length = 0
  }

  #send(group: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-group, signal)
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure
    }
  }
}

class RealCabin {
  static opening(realTerminals: RealTerminals, over: Partial<{
    termGraceMs: number, killGraceMs: number, pollMs: number,
  }> = {}): PtyLiveSessions {
    return new PtyLiveSessions({
      spawn: realTerminals.spawn(),
      newId: randomUUID,
      stderr: () => {},
      signal: (pid, signal) => process.kill(pid, signal),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      now: Date.now,
      termGraceMs: over.termGraceMs ?? 500,
      killGraceMs: over.killGraceMs ?? 500,
      pollMs: over.pollMs ?? 10,
    })
  }
}

class Programs {
  static readonly NORMAL_PARENT = [
    "const { spawn } = require('node:child_process')",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
    "console.log(`READY:${process.pid}:${child.pid}`)",
    'setInterval(() => {}, 1000)',
  ].join(';')

  static readonly TERM_IGNORING_PARENT = [
    "const { spawn } = require('node:child_process')",
    "process.on('SIGTERM', () => {})",
    "const code = `process.on('SIGTERM', () => {}); if (process.send) process.send('ready'); setInterval(() => {}, 1000)`",
    "const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })",
    "child.on('message', () => console.log(`READY:${process.pid}:${child.pid}`))",
    'setInterval(() => {}, 1000)',
  ].join(';')

  static readonly EXITING_PARENT = [
    "const { spawn } = require('node:child_process')",
    "const code = `process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); if (process.send) process.send('ready'); setInterval(() => {}, 1000)`",
    "const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })",
    "child.on('message', () => { console.log(`READY:${process.pid}:${child.pid}`); setTimeout(() => process.exit(0), 200) })",
  ].join(';')

  static node(name: string, code: string): SessionProgram {
    return new SessionProgram({
      name,
      file: process.execPath,
      argv: ['-e', code],
      cwd: process.cwd(),
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
      ),
    })
  }

  static echo(): SessionProgram {
    return Programs.node('echo', "process.stdin.on('data', bytes => process.stdout.write(bytes)); setInterval(() => {}, 1000)")
  }
}

class Printed {
  static async until(sessions: PtyLiveSessions, session: LiveSession, pattern: RegExp): Promise<RegExpMatchArray> {
    let seen = ''
    let stop = (): void => {}
    const matching = new Promise<RegExpMatchArray>((resolve, reject) => {
      const watch = sessions.watch({
        session,
        onBytes: (bytes) => {
          seen += bytes
          const match = seen.match(pattern)
          if (match !== null) {
            stop()
            resolve(match)
          }
        },
        onEnded: () => reject(new Error(`session ended before ${pattern} appeared in ${JSON.stringify(seen)}`)),
      })
      stop = watch.stop
      seen = watch.printed
      const match = seen.match(pattern)
      if (match !== null) {
        stop()
        resolve(match)
      }
    })

    return Deadline.within(matching, 3_000, `${pattern} did not appear`)
  }
}

class ClosureMother {
  static readonly CONVERSATION = new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'

  static evidence(sessions: PtyLiveSessions, session: LiveSession) {
    return sessions.terminationEvidence({
      conversation: ClosureMother.CONVERSATION,
      target: ClosureMother.TARGET,
      session,
    })
  }
}

describe('PtyLiveSessions with real processes', () => {
  const terminals = new RealTerminals()

  afterEach(async () => {
    await terminals.closeAll()
  })

  it('a real terminal prints into the scrollback and answers what is written to it', async () => {
    const sessions = RealCabin.opening(terminals)
    const session = sessions.open(PtyLiveSessions.loginShell(process.env.SHELL, process.cwd(), process.env))
    const token = `ct-real-pty-${randomUUID()}`

    const echoed = Printed.until(sessions, session, new RegExp(token))
    sessions.write({ session, text: `A=${token.slice(0, 1)}; B=${token.slice(1)}; echo "$A$B"\n` })
    await echoed

    const watch = sessions.watch({ session, onBytes: () => {}, onEnded: () => {} })
    watch.stop()
    expect(watch.printed).toContain(token)
  })

  it('the real process stays alive after every watcher has stopped', async () => {
    const sessions = RealCabin.opening(terminals)
    const session = sessions.open(PtyLiveSessions.loginShell(process.env.SHELL, process.cwd(), process.env))
    const abandoned = sessions.watch({ session, onBytes: () => {}, onEnded: () => {} })
    abandoned.stop()
    const token = `ct-real-pty-${randomUUID()}`

    const echoed = Printed.until(sessions, session, new RegExp(token))
    sessions.write({ session, text: `echo ${token}\n` })
    await echoed

    expect(sessions.find(session.id)).toBe(session)
  })

  it('a resize reaches the real terminal, and the shell sees the new size', async () => {
    const sessions = RealCabin.opening(terminals)
    const session = sessions.open(PtyLiveSessions.loginShell(process.env.SHELL, process.cwd(), process.env))
    const token = 'ct-size:40 120'

    const echoed = Printed.until(sessions, session, new RegExp(token))
    sessions.resize({ session, cols: 120, rows: 40 })
    sessions.write({ session, text: 'echo ct-size:$(stty size)\n' })
    await echoed

    const watch = sessions.watch({ session, onBytes: () => {}, onEnded: () => {} })
    watch.stop()
    expect(watch.printed).toContain(token)
  })

  it('closing an owned terminal stops its child process and leaves another terminal writable', async () => {
    const sessions = RealCabin.opening(terminals)
    const closing = sessions.open(Programs.node('owned-tree', Programs.NORMAL_PARENT))
    const other = sessions.open(Programs.echo())
    const ready = await Printed.until(sessions, closing, /READY:(\d+):(\d+)/)
    const parent = Number(ready[1])
    const child = Number(ready[2])

    await sessions.terminate(ClosureMother.evidence(sessions, closing))
    await Promise.all([Processes.absent(parent), Processes.absent(child)])

    const token = `unrelated-${randomUUID()}`
    const echoed = Printed.until(sessions, other, new RegExp(token))
    sessions.write({ session: other, text: token })
    await echoed
    expect(sessions.find(other.id)).toBe(other)
  })

  it('a TERM ignoring terminal and child are killed within the closure budget', async () => {
    const sessions = RealCabin.opening(terminals, { termGraceMs: 100, killGraceMs: 500, pollMs: 10 })
    const session = sessions.open(Programs.node('term-ignoring-tree', Programs.TERM_IGNORING_PARENT))
    const ready = await Printed.until(sessions, session, /READY:(\d+):(\d+)/)
    const parent = Number(ready[1])
    const child = Number(ready[2])

    const started = Date.now()
    await sessions.terminate(ClosureMother.evidence(sessions, session))
    const elapsed = Date.now() - started
    await Promise.all([Processes.absent(parent), Processes.absent(child)])

    expect(elapsed).toBeGreaterThanOrEqual(75)
    expect(elapsed).toBeLessThan(1_500)
  })

  it('a closure already in progress still accounts for an owned child after its root exits', async () => {
    const sessions = RealCabin.opening(terminals, { termGraceMs: 100, killGraceMs: 500, pollMs: 10 })
    const session = sessions.open(Programs.node('exiting-root', Programs.EXITING_PARENT))
    const ready = await Printed.until(sessions, session, /READY:(\d+):(\d+)/)
    const parent = Number(ready[1])
    const child = Number(ready[2])
    const closing = sessions.terminate(ClosureMother.evidence(sessions, session))
    await Processes.absent(parent)
    await closing
    await Processes.absent(child)

    expect(sessions.find(session.id)).toBeNull()
  })

  it('an original child that survives its already exited root is terminated on close', async () => {
    const sessions = RealCabin.opening(terminals, { termGraceMs: 100, killGraceMs: 500, pollMs: 10 })
    const session = sessions.open(Programs.node('exited-root', Programs.EXITING_PARENT))
    const ready = await Printed.until(sessions, session, /READY:(\d+):(\d+)/)
    const parent = Number(ready[1])
    const child = Number(ready[2])

    await Processes.absent(parent)
    expect(Processes.exists(child)).toBe(true)

    await sessions.terminate(ClosureMother.evidence(sessions, session))
    await Processes.absent(child)
    expect(sessions.find(session.id)).toBeNull()
  })

  it('an original child is terminated when its root exits during the durable close intent write', async () => {
    const sessions = RealCabin.opening(terminals, { termGraceMs: 100, killGraceMs: 500, pollMs: 10 })
    const session = sessions.open(Programs.node('intent-exit-root', Programs.EXITING_PARENT))
    const ready = await Printed.until(sessions, session, /READY:(\d+):(\d+)/)
    const parent = Number(ready[1])
    const child = Number(ready[2])
    const records = new PausedClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const closing = close.execute(new CloseCoordinatingSessionParams({
      conversation: ClosureMother.CONVERSATION,
      target: ClosureMother.TARGET,
      session,
    }))

    await records.requested.promise
    await Processes.absent(parent)
    expect(Processes.exists(child)).toBe(true)
    records.release.resolve()

    await closing
    await Processes.absent(child)
    expect(sessions.find(session.id)).toBeNull()
  })
})
