import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
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
    inspectProcessTable: (signal: AbortSignal) => Promise<string>,
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
      inspectProcessTable: over.inspectProcessTable,
    })
  }
}

class ObservedProcessTables {
  readonly completed = new Deferred()
  observations = 0
  targetGroup: number | null = null
  child: number | null = null

  watch(processGroup: number): void {
    this.targetGroup = processGroup
  }

  inspect = async (signal: AbortSignal): Promise<string> => {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('/bin/ps', ['-axo', 'pid=,pgid=,lstart='], {
        encoding: 'utf8',
        timeout: PtyLiveSessions.INSPECTION_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: PtyLiveSessions.INSPECTION_MAX_BUFFER_BYTES,
        env: { ...process.env, LC_ALL: 'C' },
        signal,
      }, (failure, output) => {
        if (failure !== null) reject(failure)
        else resolve(output)
      })
    })
    const members = this.#membersOf(stdout)
    if (this.targetGroup !== null && members.includes(this.targetGroup) && members.some((pid) => pid !== this.targetGroup)) {
      this.observations += 1
      this.child = members.find((pid) => pid !== this.targetGroup) ?? null
      if (this.observations >= 2) this.completed.resolve()
    }

    return stdout
  }

  #membersOf(stdout: string): number[] {
    if (this.targetGroup === null) return []

    return stdout.split('\n').flatMap((row) => {
      const matched = row.match(/^\s*(\d+)\s+(\d+)\s+/)
      if (matched === null || Number(matched[2]) !== this.targetGroup) return []

      return [Number(matched[1])]
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
    "child.on('message', () => { console.log(`READY:${process.pid}:${child.pid}`); process.stdin.once('data', () => process.exit(0)) })",
  ].join(';')

  static readonly SILENT_CHILD = [
    "const { spawn } = require('node:child_process')",
    "const child = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); setInterval(() => {}, 1000)`], { stdio: 'ignore' })",
    "process.stdin.once('data', () => process.exit(0))",
    "process.on('exit', () => child.unref())",
    'setInterval(() => {}, 1000)',
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

  static shell(): SessionProgram {
    return new SessionProgram({
      name: 'interactive-shell',
      file: '/bin/sh',
      argv: ['-i'],
      cwd: process.cwd(),
      env: { PATH: '/usr/bin:/bin' },
    })
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

  static checkpoint(sessions: PtyLiveSessions, session: LiveSession): Promise<SessionClosure> {
    return sessions.prepareTermination(ClosureMother.evidence(sessions, session))
  }
}

describe('PtyLiveSessions with real processes', () => {
  const terminals = new RealTerminals()

  afterEach(async () => {
    await terminals.closeAll()
  })

  it('a real terminal prints into the scrollback and answers what is written to it', async () => {
    const sessions = RealCabin.opening(terminals)
    const session = sessions.open(Programs.shell())
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
    const session = sessions.open(Programs.shell())
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
    const session = sessions.open(Programs.shell())
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

    await sessions.terminate(await ClosureMother.checkpoint(sessions, closing))
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
    await sessions.terminate(await ClosureMother.checkpoint(sessions, session))
    const elapsed = Date.now() - started
    await Promise.all([Processes.absent(parent), Processes.absent(child)])

    expect(elapsed).toBeGreaterThanOrEqual(75)
    expect(elapsed).toBeLessThan(1_500)
  })

  it('saved ownership closes a surviving real group from a fresh adapter', async () => {
    const first = RealCabin.opening(terminals, { termGraceMs: 100, killGraceMs: 500, pollMs: 10 })
    const owned = first.open(Programs.node('restart-owned-tree', Programs.TERM_IGNORING_PARENT))
    const other = first.open(Programs.echo())
    const ready = await Printed.until(first, owned, /READY:(\d+):(\d+)/)
    const parent = Number(ready[1])
    const child = Number(ready[2])
    const receipt = await first.prepareTermination(ClosureMother.evidence(first, owned))
    expect(receipt.ownership?.members.map(({ pid }) => pid)).toEqual(expect.arrayContaining([parent, child]))
    const openedBeforeRestart = terminals.opened.length
    const restarted = RealCabin.opening(terminals, { termGraceMs: 100, killGraceMs: 500, pollMs: 10 })

    await restarted.terminate(receipt)
    await Promise.all([Processes.absent(parent), Processes.absent(child), Processes.groupAbsent(parent)])

    expect(restarted.all()).toEqual([])
    expect(terminals.opened).toHaveLength(openedBeforeRestart)
    const token = `restart-unrelated-${randomUUID()}`
    const echoed = Printed.until(first, other, new RegExp(token))
    first.write({ session: other, text: token })
    await echoed
    expect(first.find(other.id)).toBe(other)
  })

  it('a closure already in progress still accounts for an owned child after its root exits', async () => {
    const sessions = RealCabin.opening(terminals, { termGraceMs: 100, killGraceMs: 500, pollMs: 10 })
    const session = sessions.open(Programs.node('exiting-root', Programs.EXITING_PARENT))
    const ready = await Printed.until(sessions, session, /READY:(\d+):(\d+)/)
    const parent = Number(ready[1])
    const child = Number(ready[2])
    const checkpoint = await ClosureMother.checkpoint(sessions, session)
    expect(checkpoint.ownership?.members.map(({ pid }) => pid)).toEqual(expect.arrayContaining([parent, child]))
    const closing = sessions.terminate(checkpoint)
    sessions.write({ session, text: 'exit\n' })
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
    const checkpoint = await ClosureMother.checkpoint(sessions, session)
    expect(checkpoint.ownership?.members.map(({ pid }) => pid)).toEqual(expect.arrayContaining([parent, child]))

    sessions.write({ session, text: 'exit\n' })
    await Processes.absent(parent)
    expect(Processes.exists(child)).toBe(true)

    await sessions.terminate(checkpoint)
    await Processes.absent(child)
    expect(sessions.find(session.id)).toBeNull()
  })

  it('an original child is terminated when its root exits during the durable close intent write', async () => {
    const sessions = RealCabin.opening(terminals, { termGraceMs: 100, killGraceMs: 500, pollMs: 10 })
    const session = sessions.open(Programs.node('intent-exit-root', Programs.EXITING_PARENT))
    const ready = await Printed.until(sessions, session, /READY:(\d+):(\d+)/)
    const parent = Number(ready[1])
    const child = Number(ready[2])
    const checkpoint = await ClosureMother.checkpoint(sessions, session)
    expect(checkpoint.ownership?.members.map(({ pid }) => pid)).toEqual(expect.arrayContaining([parent, child]))
    const records = new PausedClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const closing = close.execute(new CloseCoordinatingSessionParams({
      conversation: ClosureMother.CONVERSATION,
      target: ClosureMother.TARGET,
      session,
    }))

    try {
      await records.requested.promise
      expect(records.closure!.ownership?.members.map(({ pid }) => pid)).toEqual(expect.arrayContaining([parent, child]))
      sessions.write({ session, text: 'exit\n' })
      await Processes.absent(parent)
      expect(Processes.exists(child)).toBe(true)
    } finally {
      records.release.resolve()
    }

    await closing
    await Processes.absent(child)
    expect(sessions.find(session.id)).toBeNull()
  })

  it('a silently sampled surviving child can be closed after its root exits', async () => {
    const observations = new ObservedProcessTables()
    const sessions = RealCabin.opening(terminals, {
      termGraceMs: 100,
      killGraceMs: 500,
      pollMs: 10,
      inspectProcessTable: observations.inspect,
    })
    const session = sessions.open(Programs.node('silent-child', Programs.SILENT_CHILD))
    const other = sessions.open(Programs.echo())
    observations.watch(terminals.opened[0].pid)
    await Deadline.within(observations.completed.promise, 3_000, 'two ownership observations did not complete')
    const child = observations.child
    if (child === null) throw new Error('the silent child was not present in the observed process group')

    sessions.write({ session, text: 'exit\n' })
    await Deadline.within(new Promise<void>((resolve) => {
      const watch = sessions.watch({ session, onBytes: () => {}, onEnded: resolve })
      if (sessions.find(session.id) === null) {
        watch.stop()
        resolve()
      }
    }), 3_000, 'silent parent did not exit')
    await sessions.terminate(ClosureMother.evidence(sessions, session))
    await Promise.all([Processes.absent(child), Processes.groupAbsent(terminals.opened[0].pid)])

    const token = `silent-child-other-${randomUUID()}`
    const echoed = Printed.until(sessions, other, new RegExp(token))
    sessions.write({ session: other, text: token })
    await echoed
    expect(sessions.find(other.id)).toBe(other)
  })
})
