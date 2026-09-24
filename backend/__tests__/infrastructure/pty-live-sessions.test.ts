import { afterEach, describe, it, expect, vi } from 'vitest'
import { PtyLiveSessions } from '../../src/infrastructure/pty-live-sessions.ts'
import { SystemProcesses } from '../../src/infrastructure/process-border.ts'
import type { TableRead, Terminal, TerminalSpawn } from '../../src/infrastructure/process-table.ts'
import { SessionProgram } from '../../src/domain/value-objects/session-program.ts'
import { LiveSessionNotLive } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import {
  SessionNotTerminated, SessionOwnershipUnverifiable, SessionTerminationPermissionDenied,
  SessionTerminationUnconfirmed,
} from '../../src/domain/exceptions.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import {
  CloseCoordinatingSession,
  CloseCoordinatingSessionParams,
} from '../../src/application/actions/close-coordinating-session.ts'
import { ClosureStatus, SessionClosure } from '../../src/domain/value-objects/session-closure.ts'
import { SessionProcessOwnership } from '../../src/domain/value-objects/session-process-ownership.ts'

const childProcessDouble = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: childProcessDouble.execFile, spawn: childProcessDouble.spawn }))

const border = new SystemProcesses()

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void
type ExecInvocation = {
  file: string,
  argv: string[],
  options: Record<string, unknown>,
  callback: ExecCallback,
  close: (() => void) | null,
}

class ExecFileDouble {
  readonly calls: ExecInvocation[] = []

  install(): void {
    childProcessDouble.execFile.mockImplementation((
      file: string, argv: string[], options: Record<string, unknown>, callback: ExecCallback
    ) => {
      const invocation: ExecInvocation = { file, argv, options, callback, close: null }
      this.calls.push(invocation)

      return { once: (event: string, listener: () => void) => {
        if (event === 'close') invocation.close = listener
      } }
    })
  }

  responds(index: number, error: Error | null, stdout = ''): void {
    const call = this.calls[index]
    if (call === undefined) throw new Error(`execFile call ${index} has not started`)
    call.callback(error, stdout, '')
  }

  closes(index: number): void {
    const call = this.calls[index]
    if (call?.close === null || call?.close === undefined) throw new Error(`execFile call ${index} cannot close`)
    call.close()
  }
}

type RecordedSpawn = {
  file: string,
  argv: string[],
  options: { name: string, cols: number, rows: number, cwd: string, env: Record<string, string> },
}

type ResizedTo = { cols: number, rows: number }

class TerminalDouble implements Terminal {
  static readonly opened = new Set<TerminalDouble>()
  readonly pid: number
  readonly written: string[] = []
  readonly resized: ResizedTo[] = []
  writeFailure: Error | null = null
  resizeFailure: Error | null = null
  #onData: ((bytes: string) => void) | null = null
  #onExit: (() => void) | null = null

  constructor(pid: number) {
    this.pid = pid
    TerminalDouble.opened.add(this)
  }

  onData(listener: (bytes: string) => void): void {
    this.#onData = listener
  }

  onExit(listener: () => void): void {
    this.#onExit = listener
  }

  write(text: string): void {
    if (this.writeFailure !== null) throw this.writeFailure
    this.written.push(text)
  }

  resize(cols: number, rows: number): void {
    if (this.resizeFailure !== null) throw this.resizeFailure
    this.resized.push({ cols, rows })
  }

  prints(bytes: string): void {
    if (this.#onData === null) throw new Error('TerminalDouble: nobody is listening for data yet')
    this.#onData(bytes)
  }

  exits(): void {
    if (this.#onExit === null) throw new Error('TerminalDouble: nobody is listening for exit yet')
    this.#onExit()
    TerminalDouble.opened.delete(this)
  }

  static closeAll(): void {
    for (const terminal of [...TerminalDouble.opened]) terminal.exits()
  }
}

type RecordingSpawn = TerminalSpawn & { calls: RecordedSpawn[], terminals: TerminalDouble[] }

class SpawnDouble {
  static recording(): RecordingSpawn {
    return SpawnDouble.withPids()
  }

  static withPids(...pids: number[]): RecordingSpawn {
    const calls: RecordedSpawn[] = []
    const terminals: TerminalDouble[] = []
    const spawn: TerminalSpawn = (file, argv, options) => {
      calls.push({ file, argv, options })
      const terminal = new TerminalDouble(pids[terminals.length] ?? 4101 + terminals.length)
      terminals.push(terminal)

      return terminal
    }

    return Object.assign(spawn, { calls, terminals })
  }
}

class Ids {
  static sequential(): () => string {
    let count = 0
    const newId = (): string => {
      count += 1

      return `session-${count}`
    }

    return newId
  }
}

class Cabin {
  static readonly CWD = '/repo/cabin'

  static opening(overrides: Partial<{
    spawn: TerminalSpawn, newId: () => string, stderr: (line: string) => void,
    signal: (pid: number, signal: NodeJS.Signals | 0) => void,
    sleep: (milliseconds: number) => Promise<void>,
    now: () => number,
    inspectProcessTable: (read: TableRead) => Promise<string>,
    inspectionNow: () => number,
    termGraceMs: number,
    killGraceMs: number,
    pollMs: number,
  }> = {}): PtyLiveSessions {
    return new PtyLiveSessions({
      spawn: overrides.spawn ?? SpawnDouble.recording(),
      newId: overrides.newId ?? Ids.sequential(),
      stderr: overrides.stderr ?? ((): void => {}),
      signal: overrides.signal ?? ((): void => {}),
      sleep: overrides.sleep ?? (async (): Promise<void> => {}),
      now: overrides.now ?? (() => 0),
      termGraceMs: overrides.termGraceMs ?? 10,
      killGraceMs: overrides.killGraceMs ?? 10,
      pollMs: overrides.pollMs ?? 1,
      inspectionNow: overrides.inspectionNow,
      inspectProcessTable: overrides.inspectProcessTable ?? ProcessTables.roots(),
    })
  }
}

class ProcessTables {
  static readonly ORIGINAL = 'Thu Sep 17 22:29:08 2026'
  static readonly CHILD = 'Thu Sep 17 22:29:09 2026'
  static readonly REPLACEMENT = 'Thu Sep 17 22:29:10 2026'

  static roots(): () => Promise<string> {
    return async () => Array.from({ length: 32 }, (_, index) => {
      const pid = 4101 + index

      return ProcessTables.row(pid, pid, ProcessTables.ORIGINAL)
    }).join('\n')
  }

  static group(processGroup: number, identities: ReadonlyMap<number, string>): string {
    const rows = [...identities].map(([pid, identity]) => {
      const start = identity.includes('replacement') ? ProcessTables.REPLACEMENT
        : identity.includes('child') ? ProcessTables.CHILD
          : ProcessTables.ORIGINAL

      return ProcessTables.row(pid, processGroup, start)
    })

    return `${rows.join('\n')}\n`
  }

  static groups(groups: ReadonlyMap<number, ReadonlyMap<number, string>>): string {
    return [...groups].map(([processGroup, identities]) => ProcessTables.group(processGroup, identities)).join('')
  }

  static rootGroups(count: number, firstChild = false): string {
    return ProcessTables.groups(new Map(Array.from({ length: count }, (_, index) => {
      const processGroup = 4101 + index
      const identities = new Map<number, string>([[processGroup, `${processGroup}:original`]])
      if (index === 0 && firstChild) identities.set(5000, '5000:original-child')

      return [processGroup, identities]
    })))
  }

  static row(pid: number, processGroup: number, start: string): string {
    return `${String(pid).padStart(5)} ${String(processGroup).padStart(5)} ${start}`
  }
}

type InspectionCall = {
  signal: AbortSignal,
  startedAt: number,
  resolve: (stdout: string) => void,
  reject: (cause: unknown) => void,
}

class ControlledInspection {
  readonly calls: InspectionCall[] = []
  readonly now: () => number
  active = 0
  maximumActive = 0

  constructor(now: () => number = () => 0) {
    this.now = now
  }

  inspect = (read: TableRead): Promise<string> => new Promise((resolve, reject) => {
    this.active += 1
    this.maximumActive = Math.max(this.maximumActive, this.active)
    this.calls.push({
      signal: read.abort,
      startedAt: this.now(),
      resolve: (stdout) => {
        this.active -= 1
        resolve(stdout)
      },
      reject: (cause) => {
        this.active -= 1
        reject(cause)
      },
    })
  })

  succeeds(index: number, stdout: string): void {
    const call = this.calls[index]
    if (call === undefined) throw new Error(`inspection ${index} has not started`)
    call.resolve(stdout)
  }

  fails(index: number, cause: unknown): void {
    const call = this.calls[index]
    if (call === undefined) throw new Error(`inspection ${index} has not started`)
    call.reject(cause)
  }
}

class AsyncTurns {
  static async run(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
  }
}

class Inspections {
  static async settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  static async until(started: () => boolean, detail: string, budget = 2_000): Promise<void> {
    for (let elapsed = 0; elapsed <= budget; elapsed += 1) {
      await AsyncTurns.run()
      if (started()) return
      await vi.advanceTimersByTimeAsync(1)
    }
    throw new Error(`${detail} within ${budget}ms of virtual inspection time`)
  }
}

class TerminationMother {
  static readonly CONVERSATION = new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'

  static evidence(sessions: PtyLiveSessions, session: LiveSession) {
    return sessions.terminationEvidence({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    })
  }

  static async prepared(sessions: PtyLiveSessions, session: LiveSession): Promise<SessionClosure> {
    return sessions.prepareTermination(TerminationMother.evidence(sessions, session))
  }
}

class ControlledProcesses {
  readonly alive = new Set<number>()
  readonly signals: { pid: number, signal: NodeJS.Signals | 0 }[] = []
  now = 0
  onSignal: ((pid: number, signal: NodeJS.Signals | 0) => void) | null = null

  signal = (pid: number, signal: NodeJS.Signals | 0): void => {
    this.signals.push({ pid, signal })
    const group = -pid
    if (!this.alive.has(group)) {
      const absent = new Error('no such process') as NodeJS.ErrnoException
      absent.code = 'ESRCH'
      throw absent
    }
    this.onSignal?.(pid, signal)
  }

  sleep = async (milliseconds: number): Promise<void> => {
    this.now += milliseconds
  }
}

class LoginProgram {
  static default(): SessionProgram {
    return PtyLiveSessions.loginShell('/bin/zsh', Cabin.CWD, { PATH: '/usr/bin' })
  }
}

class ClosureRecords extends ConversationRecords {
  closure: SessionClosure | null = null
  failCompletion = false
  requestStarted: Deferred | null = null
  requestRelease: Deferred | null = null
  checkpointStarted: Deferred | null = null
  checkpointRelease: Deferred | null = null
  requestCount = 0

  async recallClosure(): Promise<SessionClosure | null> {
    return this.closure
  }

  async requestClosure(closure: SessionClosure): Promise<void> {
    this.requestCount += 1
    if (this.requestCount === 1) {
      this.closure = closure
      this.requestStarted?.resolve()
      await this.requestRelease?.promise
      return
    }
    if (this.requestCount === 2) {
      this.checkpointStarted?.resolve()
      await this.checkpointRelease?.promise
    }
    await this.requestRelease?.promise
    this.closure = closure
  }

  async completeClosure(closure: SessionClosure): Promise<void> {
    if (this.failCompletion) throw new Error('completion refused')
    this.closure = closure
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

class OpenedTerminal {
  readonly sessions: PtyLiveSessions
  readonly spawn: RecordingSpawn
  readonly session: LiveSession
  readonly terminal: TerminalDouble

  constructor({ sessions, spawn, program }: {
    sessions: PtyLiveSessions, spawn: RecordingSpawn, program: SessionProgram,
  }) {
    this.sessions = sessions
    this.spawn = spawn
    this.session = sessions.open(program)
    const terminal = spawn.terminals.at(-1)
    if (terminal === undefined) throw new Error('OpenedTerminal: opening did not spawn a terminal')
    this.terminal = terminal
  }

  static with(overrides: Partial<{
    newId: () => string, stderr: (line: string) => void, program: SessionProgram,
  }> = {}): OpenedTerminal {
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({ newId: overrides.newId, stderr: overrides.stderr, spawn })
    const program = overrides.program ?? LoginProgram.default()

    return new OpenedTerminal({ sessions, spawn, program })
  }
}

describe('PtyLiveSessions', () => {
  afterEach(() => {
    TerminalDouble.closeAll()
    vi.useRealTimers()
    childProcessDouble.execFile.mockReset()
  })
  it('opening names the session after the program it runs', () => {
    const opened = OpenedTerminal.with({
      program: PtyLiveSessions.loginShell('/usr/local/bin/zsh', Cabin.CWD, { PATH: '/usr/bin' }),
    })

    expect(opened.session.name).toBe('zsh')
  })

  it('a watcher receives what the terminal printed before it arrived', () => {
    const opened = OpenedTerminal.with()

    opened.terminal.prints('hello ')
    opened.terminal.prints('world')
    const watch = opened.sessions.watch({ session: opened.session, onBytes: () => {}, onEnded: () => {} })

    expect(watch.printed).toBe('hello world')
  })

  it('two watchers of one session both receive the next bytes', () => {
    const opened = OpenedTerminal.with()
    const first: string[] = []
    const second: string[] = []
    opened.sessions.watch({ session: opened.session, onBytes: (bytes) => first.push(bytes), onEnded: () => {} })
    opened.sessions.watch({ session: opened.session, onBytes: (bytes) => second.push(bytes), onEnded: () => {} })

    opened.terminal.prints('shared bytes')

    expect(first).toEqual(['shared bytes'])
    expect(second).toEqual(['shared bytes'])
  })

  it('a stopped watcher receives nothing more and the session stays live', () => {
    const opened = OpenedTerminal.with()
    const received: string[] = []
    const watch = opened.sessions.watch({ session: opened.session, onBytes: (bytes) => received.push(bytes), onEnded: () => {} })

    watch.stop()
    opened.terminal.prints('after the stop')

    expect(received).toEqual([])
    expect(opened.sessions.find(opened.session.id)).toBe(opened.session)
  })

  it('the scrollback keeps the last 262144 characters and drops the oldest', () => {
    const opened = OpenedTerminal.with()
    const atLimit = 'a'.repeat(PtyLiveSessions.SCROLLBACK_CHARACTERS)

    opened.terminal.prints(atLimit)
    const withinLimit = opened.sessions.watch({ session: opened.session, onBytes: () => {}, onEnded: () => {} })
    expect(withinLimit.printed).toBe(atLimit)

    opened.terminal.prints('b')
    const overLimit = opened.sessions.watch({ session: opened.session, onBytes: () => {}, onEnded: () => {} })
    expect(overLimit.printed.length).toBe(PtyLiveSessions.SCROLLBACK_CHARACTERS)
    expect(overLimit.printed).toBe(`${atLimit.slice(1)}b`)
  })

  it('a session whose terminal exited is neither found nor listed', () => {
    const opened = OpenedTerminal.with()

    opened.terminal.exits()

    expect(opened.sessions.find(opened.session.id)).toBeNull()
    expect(opened.sessions.all()).toEqual([])
  })

  it('what is written reaches the terminal', () => {
    const opened = OpenedTerminal.with()

    opened.sessions.write({ session: opened.session, text: 'ls -la\n' })

    expect(opened.terminal.written).toEqual(['ls -la\n'])
  })

  it('a submitted message reaches the terminal as one bracketed paste and its enter only after the pause', async () => {
    const spawn = SpawnDouble.recording()
    const paused: number[] = []
    let resume: () => void = () => {}
    const sessions = Cabin.opening({
      spawn,
      sleep: (milliseconds) => {
        paused.push(milliseconds)

        return new Promise((resolved) => { resume = resolved })
      },
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]

    const submitted = sessions.submit({ session, text: 'review the slicing' })

    expect(terminal.written).toEqual(['\x1b[200~review the slicing\x1b[201~'])
    expect(paused).toEqual([PtyLiveSessions.SUBMIT_DELAY_MS])
    resume()
    await submitted
    expect(terminal.written).toEqual(['\x1b[200~review the slicing\x1b[201~', '\r'])
  })

  it('a submission whose session goes away during the pause fails instead of losing its enter silently', async () => {
    const spawn = SpawnDouble.recording()
    let resume: () => void = () => {}
    const sessions = Cabin.opening({
      spawn,
      sleep: () => new Promise((resolved) => { resume = resolved }),
    })
    const session = sessions.open(LoginProgram.default())

    const submitted = sessions.submit({ session, text: 'review the slicing' })
    spawn.terminals[0].exits()
    resume()

    await expect(submitted).rejects.toThrow(LiveSessionNotLive)
  })

  it('a resize reaches the terminal of that session', () => {
    const opened = OpenedTerminal.with()

    opened.sessions.resize({ session: opened.session, cols: 120, rows: 40 })

    expect(opened.terminal.resized).toEqual([{ cols: 120, rows: 40 }])
  })

  it('a resize whose terminal already closed its fd is refused as not live, and every later call too', () => {
    const opened = OpenedTerminal.with()
    opened.terminal.resizeFailure = new Error('ioctl(2) failed, EBADF')

    expect(() => opened.sessions.resize({ session: opened.session, cols: 120, rows: 40 }))
      .toThrow(LiveSessionNotLive)

    opened.terminal.resizeFailure = null
    expect(() => opened.sessions.resize({ session: opened.session, cols: 100, rows: 30 }))
      .toThrow(LiveSessionNotLive)
    expect(opened.terminal.resized).toEqual([])
  })

  it('the shell is the login interactive one, and /bin/sh when SHELL is unset', () => {
    const withShell = OpenedTerminal.with({
      program: PtyLiveSessions.loginShell('/usr/local/bin/fish', Cabin.CWD, { PATH: '/usr/bin' }),
    })

    expect(withShell.spawn.calls).toStrictEqual([{
      file: '/usr/local/bin/fish',
      argv: ['-il'],
      options: {
        name: PtyLiveSessions.TERM,
        cols: PtyLiveSessions.COLUMNS,
        rows: PtyLiveSessions.ROWS,
        cwd: Cabin.CWD,
        env: { PATH: '/usr/bin', TERM: PtyLiveSessions.TERM },
      },
    }])

    const withoutShell = OpenedTerminal.with({
      program: PtyLiveSessions.loginShell(undefined, Cabin.CWD, { PATH: '/usr/bin' }),
    })

    expect(withoutShell.spawn.calls[0].file).toBe('/bin/sh')
  })

  it('the environment carries TERM and no undefined entry', () => {
    const opened = OpenedTerminal.with({
      program: PtyLiveSessions.loginShell('/bin/zsh', Cabin.CWD, {
        PATH: '/usr/bin', GHOST: undefined, LANG: 'en_US.UTF-8',
      }),
    })

    expect(opened.spawn.calls[0].options.env).toStrictEqual({
      PATH: '/usr/bin', LANG: 'en_US.UTF-8', TERM: PtyLiveSessions.TERM,
    })
    expect(Object.keys(opened.spawn.calls[0].options.env)).not.toContain('GHOST')
  })

  it('opening a terminal is announced on stderr, naming the session id and the program', () => {
    const written: string[] = []
    const opened = OpenedTerminal.with({
      program: PtyLiveSessions.loginShell('/usr/local/bin/fish', Cabin.CWD, { PATH: '/usr/bin' }),
      stderr: (line) => written.push(line),
    })

    expect(written).toEqual([`live session ${opened.session.id} (fish) opened\n`])
  })

  it('the terminal exiting is announced on stderr after the announcement that it opened', () => {
    const written: string[] = []
    const opened = OpenedTerminal.with({
      program: PtyLiveSessions.loginShell('/usr/local/bin/fish', Cabin.CWD, { PATH: '/usr/bin' }),
      stderr: (line) => written.push(line),
    })

    opened.terminal.exits()

    expect(written).toEqual([
      `live session ${opened.session.id} (fish) opened\n`,
      `live session ${opened.session.id} (fish) exited\n`,
    ])
  })

  it('a watcher of a session that exits is told it ended', () => {
    const opened = OpenedTerminal.with()
    let ended = 0
    opened.sessions.watch({ session: opened.session, onBytes: () => {}, onEnded: () => { ended += 1 } })

    opened.terminal.exits()

    expect(ended).toBe(1)
  })

  it('a watcher that stopped is not told when the session exits', () => {
    const opened = OpenedTerminal.with()
    let ended = 0
    const watch = opened.sessions.watch({ session: opened.session, onBytes: () => {}, onEnded: () => { ended += 1 } })

    watch.stop()
    opened.terminal.exits()

    expect(ended).toBe(0)
  })

  it('spawns the program it is given, with its own argv and working directory', () => {
    const program = new SessionProgram({
      name: 'coordinator',
      file: '/usr/local/bin/claude',
      argv: ['--resume', 'abc123'],
      cwd: '/repo/governed-checkout',
      env: { PATH: '/usr/bin' },
    })
    const opened = OpenedTerminal.with({ program })

    expect(opened.spawn.calls[0].file).toBe('/usr/local/bin/claude')
    expect(opened.spawn.calls[0].argv).toEqual(['--resume', 'abc123'])
    expect(opened.spawn.calls[0].options.cwd).toBe('/repo/governed-checkout')
  })

  it('forces its own TERM over the program environment', () => {
    const program = new SessionProgram({
      name: 'coordinator',
      file: '/usr/local/bin/claude',
      argv: [],
      cwd: Cabin.CWD,
      env: { PATH: '/usr/bin', TERM: 'dumb' },
    })
    const opened = OpenedTerminal.with({ program })

    expect(opened.spawn.calls[0].options.env).toStrictEqual({ PATH: '/usr/bin', TERM: PtyLiveSessions.TERM })
  })

  it('names the login shell by its basename', () => {
    const program = PtyLiveSessions.loginShell('/usr/local/bin/fish', Cabin.CWD, { PATH: '/usr/bin' })

    expect(program.name).toBe('fish')
  })

  it('waits for exit and group absence before confirming termination', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 4,
      killGraceMs: 4,
      pollMs: 1,
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(terminal.pid)
    let ended = 0
    sessions.watch({ session, onBytes: () => {}, onEnded: () => { ended += 1 } })
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGKILL') processes.alive.delete(terminal.pid)
    }

    await Inspections.settle()
    const evidence = await TerminationMother.prepared(sessions, session)
    const closing = sessions.terminate(evidence)
    await expect(closing).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(processes.signals).toContainEqual({ pid: -terminal.pid, signal: 'SIGKILL' })

    processes.now = 0
    processes.signals.length = 0
    terminal.exits()
    const retry = sessions.terminate(TerminationMother.evidence(sessions, session))
    await expect(retry).resolves.toBeUndefined()
    expect(ended).toBe(1)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
  })

  it('never signals a reused group after the original root and group exited', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4101)
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(terminal.pid)
    const evidence = TerminationMother.evidence(sessions, session)

    processes.alive.delete(terminal.pid)
    terminal.exits()
    const replacement = sessions.open(LoginProgram.default())
    processes.alive.add(terminal.pid)
    processes.onSignal = (_pid, signal) => {
      if (signal !== 0) spawn.terminals[1].exits()
    }

    await expect(sessions.terminate(evidence)).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
    expect(sessions.find(replacement.id)).toBe(replacement)
  })

  it('does not escalate an active close after the original group identity was replaced', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let identity = new Map([[4101, '4101:original'], [4200, '4200:original-child']])
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
      inspectProcessTable: async () => ProcessTables.group(4101, identity),
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(terminal.pid)
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGTERM') {
        terminal.exits()
        identity = new Map([[4101, '4101:replacement']])
      }
    }

    await Inspections.settle()
    const closing = sessions.terminate(await TerminationMother.prepared(sessions, session))
    await expect(closing).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toEqual([])
  })

  it('does not kill a reused group after absence retired authority during the TERM wait', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let identity = new Map([[4101, '4101:original']])
    let sleeps = 0
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: async (milliseconds) => {
        processes.now += milliseconds
        sleeps += 1
        if (sleeps === 1) processes.alive.delete(4101)
        if (sleeps === 2) {
          identity = new Map([[4101, '4101:replacement']])
          processes.alive.add(4101)
        }
      },
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
      inspectProcessTable: async () => ProcessTables.group(4101, identity),
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)

    await Inspections.settle()
    const evidence = await TerminationMother.prepared(sessions, session)
    await expect(sessions.terminate(evidence)).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toEqual([])
  })

  it('validates the original identities before KILL when the exit callback is delayed', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let identity = new Map([[4101, '4101:original'], [4200, '4200:original-child']])
    let replaced = false
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: async (milliseconds) => {
        processes.now += milliseconds
        if (!replaced) {
          replaced = true
          identity = new Map([[4101, '4101:replacement']])
        }
      },
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
      inspectProcessTable: async () => ProcessTables.group(4101, identity),
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)

    await Inspections.settle()
    await expect(sessions.terminate(await TerminationMother.prepared(sessions, session))).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toEqual([])
  })

  it('a replaced leader confirms only the old group without signalling its replacement', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let identity = new Map([[4101, '4101:original'], [4200, '4200:original-child']])
    let firstTerm = true
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      inspectProcessTable: async () => ProcessTables.group(4101, identity),
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(4101)
    processes.onSignal = (_pid, signal) => {
      if (signal !== 'SIGTERM' || !firstTerm) return
      firstTerm = false
      identity = new Map([[4200, '4200:original-child']])
      terminal.exits()
      const refused = new Error('operation not permitted') as NodeJS.ErrnoException
      refused.code = 'EPERM'
      throw refused
    }
    const records = new ClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const params = new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    })

    await expect(close.execute(params)).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    identity = new Map([[4101, '4101:replacement']])
    processes.signals.length = 0

    await expect(close.execute(params)).resolves.toMatchObject({ target: TerminationMother.TARGET })
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
    expect(records.closure?.status).toBe(ClosureStatus.CLOSED)

    const replacementSignals: { pid: number, signal: NodeJS.Signals | 0 }[] = []
    const restarted = Cabin.opening({
      inspectProcessTable: async () => ProcessTables.group(9999, new Map([[4101, '4101:replacement']])),
      signal: (pid, signal) => { replacementSignals.push({ pid, signal }) },
    })
    const durable = new SessionClosure({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session: 'session-1',
      processGroup: 4101,
      status: ClosureStatus.REQUESTED,
      ownership: new SessionProcessOwnership({
        rootIdentity: '4101:Thu Sep 17 22:29:08 2026',
        members: [{ pid: 4101, identity: '4101:Thu Sep 17 22:29:08 2026' }],
      }),
    })
    await expect(restarted.terminate(durable)).resolves.toBeUndefined()
    expect(replacementSignals.filter(({ signal }) => signal !== 0)).toEqual([])
    await expect(restarted.terminate(durable)).resolves.toBeUndefined()
    expect(replacementSignals.filter(({ signal }) => signal !== 0)).toEqual([])
  })

  it('latches background leader replacement across the whole process table', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4102)
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
    })
    const sameGroup = sessions.open(LoginProgram.default())
    const movedGroup = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    processes.alive.add(4102)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.groups(new Map([
      [4101, new Map([[4101, '4101:original']])],
      [4102, new Map([[4102, '4102:original']])],
    ])))
    await AsyncTurns.run()
    const sameReceipt = TerminationMother.evidence(sessions, sameGroup)
    const movedReceipt = TerminationMother.evidence(sessions, movedGroup)

    await Inspections.until(() => inspection.calls.length === 2, 'replacement background scan did not start')
    inspection.succeeds(1, ProcessTables.groups(new Map([
      [4101, new Map([[4101, '4101:replacement']])],
      [9999, new Map([[4102, '4102:replacement']])],
    ])))
    await AsyncTurns.run()
    expect(sessions.find(sameGroup.id)).toBeNull()
    expect(sessions.find(movedGroup.id)).toBeNull()

    await vi.advanceTimersByTimeAsync(PtyLiveSessions.INSPECTION_INTERVAL_MS * 2)
    expect(inspection.calls).toHaveLength(2)
    await expect(sessions.terminate(sameReceipt)).resolves.toBeUndefined()
    await expect(sessions.terminate(movedReceipt)).resolves.toBeUndefined()
    await expect(sessions.terminate(sameReceipt)).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
  })

  it('replacement proof finalizes a previously unusable terminal exactly once', async () => {
    const spawn = SpawnDouble.withPids(4101, 4102)
    let table = ProcessTables.groups(new Map([
      [4101, new Map([[4101, '4101:original']])],
      [4102, new Map([[4102, '4102:original']])],
    ]))
    const signals: { pid: number, signal: NodeJS.Signals | 0 }[] = []
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: async () => table,
      signal: (pid, signal) => { signals.push({ pid, signal }) },
    })
    const brokenWrite = sessions.open(LoginProgram.default())
    const brokenResize = sessions.open(LoginProgram.default())
    await Inspections.settle()
    const writeReceipt = TerminationMother.evidence(sessions, brokenWrite)
    const resizeReceipt = TerminationMother.evidence(sessions, brokenResize)
    let writeEnded = 0
    let resizeEnded = 0
    let lateBytes = ''
    sessions.watch({ session: brokenWrite, onBytes: (bytes) => { lateBytes += bytes }, onEnded: () => { writeEnded += 1 } })
    sessions.watch({ session: brokenResize, onBytes: (bytes) => { lateBytes += bytes }, onEnded: () => { resizeEnded += 1 } })
    spawn.terminals[0].writeFailure = new Error('EBADF')
    spawn.terminals[1].resizeFailure = new Error('EBADF')
    expect(() => sessions.write({ session: brokenWrite, text: 'broken' })).toThrow(LiveSessionNotLive)
    expect(() => sessions.resize({ session: brokenResize, cols: 100, rows: 40 })).toThrow(LiveSessionNotLive)

    table = ProcessTables.groups(new Map([
      [4101, new Map([[4101, '4101:replacement']])],
      [9999, new Map([[4102, '4102:replacement']])],
    ]))
    const [preparedWrite, preparedResize] = await Promise.all([
      sessions.prepareTermination(writeReceipt),
      sessions.prepareTermination(resizeReceipt),
    ])
    await Promise.all([sessions.terminate(preparedWrite), sessions.terminate(preparedResize)])
    expect(writeEnded).toBe(1)
    expect(resizeEnded).toBe(1)
    spawn.terminals[0].prints('late write output')
    spawn.terminals[1].prints('late resize output')
    table = ProcessTables.row(9998, 9998, ProcessTables.ORIGINAL)
    await Promise.all([sessions.terminate(preparedWrite), sessions.terminate(preparedResize)])
    spawn.terminals[0].exits()
    spawn.terminals[1].exits()
    expect(writeEnded).toBe(1)
    expect(resizeEnded).toBe(1)
    expect(lateBytes).toBe('')
    expect(signals.filter(({ signal }) => signal !== 0)).toEqual([])
  })

  it('rejects incompatible recovered and confirmed ownership checkpoints before reuse', async () => {
    const root = '4101:Thu Sep 17 22:29:08 2026'
    const child = '5000:Thu Sep 17 22:29:09 2026'
    const closure = (ownership: SessionProcessOwnership | null, target = TerminationMother.TARGET) => new SessionClosure({
      conversation: TerminationMother.CONVERSATION,
      target,
      session: 'saved-session',
      processGroup: 4101,
      status: ClosureStatus.REQUESTED,
      ownership,
    })
    const original = closure(new SessionProcessOwnership({
      rootIdentity: root,
      members: [{ pid: 4101, identity: root }, { pid: 5000, identity: child }],
    }))
    const changedRoot = closure(new SessionProcessOwnership({
      rootIdentity: '4101:Thu Sep 17 22:29:10 2026',
      members: [{ pid: 4101, identity: '4101:Thu Sep 17 22:29:10 2026' }],
    }))
    const changedMember = closure(new SessionProcessOwnership({
      rootIdentity: root,
      members: [
        { pid: 4101, identity: root },
        { pid: 5000, identity: '5000:Thu Sep 17 22:29:10 2026' },
      ],
    }))
    let table = ProcessTables.group(4101, new Map([[4101, '4101:original'], [5000, '5000:original-child']]))
    let scans = 0
    const sessions = Cabin.opening({
      inspectProcessTable: async () => { scans += 1; return table },
      signal: () => {},
    })
    await expect(sessions.confirmTermination(original)).rejects.toBeInstanceOf(SessionTerminationUnconfirmed)
    const scansAfterOriginal = scans
    await expect(sessions.confirmTermination(changedRoot)).rejects.toBeInstanceOf(SessionOwnershipUnverifiable)
    await expect(sessions.confirmTermination(changedMember)).rejects.toBeInstanceOf(SessionOwnershipUnverifiable)
    await expect(sessions.confirmTermination(closure(null))).rejects.toBeInstanceOf(SessionOwnershipUnverifiable)
    expect(scans).toBe(scansAfterOriginal)

    table = ProcessTables.group(9999, new Map([[4101, '4101:replacement']]))
    await expect(sessions.confirmTermination(original)).resolves.toBeUndefined()
    await expect(sessions.confirmTermination(changedRoot)).rejects.toBeInstanceOf(SessionOwnershipUnverifiable)
    await expect(sessions.terminate(changedMember)).rejects.toBeInstanceOf(SessionOwnershipUnverifiable)

    const retainedSpawn = SpawnDouble.recording()
    const retained = Cabin.opening({ spawn: retainedSpawn })
    const live = retained.open(LoginProgram.default())
    await Inspections.settle()
    const retainedReceipt = TerminationMother.evidence(retained, live)
    const otherTarget = new SessionClosure({
      conversation: retainedReceipt.conversation,
      target: 'f910a470-13f7-4956-b750-bef89f55dd6d',
      session: retainedReceipt.session,
      processGroup: retainedReceipt.processGroup,
      status: ClosureStatus.REQUESTED,
      ownership: retainedReceipt.ownership,
    })
    await expect(retained.prepareTermination(otherTarget)).rejects.toBeInstanceOf(SessionOwnershipUnverifiable)
    await expect(retained.prepareTermination(retainedReceipt)).resolves.toMatchObject({ target: retainedReceipt.target })
    retainedSpawn.terminals[0].exits()
  })

  it('preserves permission diagnostics while independent replacement proof and bounded grace remain available', async () => {
    const root = '4101:Thu Sep 17 22:29:08 2026'
    const receipt = new SessionClosure({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session: 'saved-session',
      processGroup: 4101,
      status: ClosureStatus.REQUESTED,
      ownership: new SessionProcessOwnership({ rootIdentity: root, members: [{ pid: 4101, identity: root }] }),
    })
    let replacementScans = 0
    const replacement = Cabin.opening({
      signal: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) },
      inspectProcessTable: async () => {
        replacementScans += 1
        return ProcessTables.group(9999, new Map([[4101, '4101:replacement']]))
      },
    })
    await expect(replacement.confirmTermination(receipt)).resolves.toBeUndefined()
    expect(replacementScans).toBe(1)

    const denied = Cabin.opening({
      signal: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) },
      inspectProcessTable: async () => ProcessTables.group(4101, new Map([[4101, '4101:original']])),
    })
    await expect(denied.confirmTermination(receipt)).rejects.toMatchObject({
      constructor: SessionTerminationPermissionDenied,
      message: expect.stringContaining(TerminationMother.TARGET),
    })

    let transientProbe = true
    const transientSignals: (NodeJS.Signals | 0)[] = []
    const transient = Cabin.opening({
      inspectProcessTable: async () => ProcessTables.group(4101, new Map([[4101, '4101:original']])),
      signal: (_pid, signal) => {
        transientSignals.push(signal)
        if (signal === 'SIGTERM') return
        if (signal === 0 && transientProbe) {
          transientProbe = false
          throw Object.assign(new Error('reaping'), { code: 'EPERM' })
        }
        if (signal === 0) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      },
      sleep: async () => {},
      now: (() => { let now = 0; return () => now++ })(),
      termGraceMs: 3,
    })
    await expect(transient.terminate(receipt)).resolves.toBeUndefined()
    expect(transientSignals).toContain('SIGTERM')
    expect(transientSignals).not.toContain('SIGKILL')

    for (const code of ['EPERM', 'EACCES']) {
      let now = 0
      const persistentSignals: (NodeJS.Signals | 0)[] = []
      const persistent = Cabin.opening({
        inspectProcessTable: async () => ProcessTables.group(4101, new Map([[4101, '4101:original']])),
        signal: (_pid, signal) => {
          persistentSignals.push(signal)
          if (signal === 0) throw Object.assign(new Error(code), { code })
        },
        sleep: async (milliseconds) => { now += milliseconds },
        now: () => now,
        termGraceMs: 2,
        pollMs: 1,
      })
      await expect(persistent.terminate(receipt)).rejects.toBeInstanceOf(SessionTerminationPermissionDenied)
      expect(persistentSignals.filter((signal) => signal === 'SIGTERM')).toHaveLength(1)
      expect(persistentSignals).not.toContain('SIGKILL')
      expect(now).toBe(2)
    }
  })

  it('terminates a verified original child after the root exited before close', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let identity = new Map([[4101, '4101:original'], [4200, '4200:original-child']])
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      inspectProcessTable: async () => ProcessTables.group(4101, identity),
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(4101)
    await Inspections.settle()
    terminal.prints('child ready')
    identity = new Map([[4200, '4200:original-child']])
    terminal.exits()
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGKILL') processes.alive.delete(4101)
    }

    await expect(sessions.terminate(TerminationMother.evidence(sessions, session))).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toHaveLength(1)
  })

  it('retains authority over a verified child when close evidence is sampled before the delayed exit callback', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let identity = new Map([[4101, '4101:original'], [4200, '4200:original-child']])
    let exitDelivered = false
    let retryCanExit = false
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: async (milliseconds) => {
        processes.now += milliseconds
        if (!exitDelivered) {
          exitDelivered = true
          spawn.terminals[0].exits()
        }
      },
      now: () => processes.now,
      inspectProcessTable: async () => ProcessTables.group(4101, identity),
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await Inspections.settle()
    spawn.terminals[0].prints('child ready')
    identity = new Map([[4200, '4200:original-child']])
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGKILL' && retryCanExit) processes.alive.delete(4101)
    }
    const records = new ClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const params = new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    })

    await expect(close.execute(params)).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    retryCanExit = true
    processes.now = 0
    processes.signals.length = 0

    await expect(close.execute(params)).resolves.toMatchObject({ target: TerminationMother.TARGET })
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toHaveLength(1)
    expect(records.closure?.status).toBe(ClosureStatus.CLOSED)
  })

  it('terminates a verified original child when the root exits during the durable intent write', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let identity = new Map([[4101, '4101:original'], [4200, '4200:original-child']])
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      inspectProcessTable: async () => ProcessTables.group(4101, identity),
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(4101)
    await Inspections.settle()
    terminal.prints('child ready')
    const records = new ClosureRecords()
    records.requestStarted = new Deferred()
    records.requestRelease = new Deferred()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const params = new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    })
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGKILL') processes.alive.delete(4101)
    }

    const closing = close.execute(params)
    await records.requestStarted.promise
    identity = new Map([[4200, '4200:original-child']])
    terminal.exits()
    records.requestRelease.resolve()

    await expect(closing).resolves.toMatchObject({ target: TerminationMother.TARGET })
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toHaveLength(1)
    expect(records.closure?.status).toBe(ClosureStatus.CLOSED)
  })

  it('retains authority when buffered output follows physical root exit during the durable intent write', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let identity = new Map([[4101, '4101:original'], [4200, '4200:original-child']])
    let firstTerm = true
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      inspectProcessTable: async () => ProcessTables.group(4101, identity),
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(4101)
    await Inspections.settle()
    terminal.prints('child ready')
    const records = new ClosureRecords()
    records.requestStarted = new Deferred()
    records.requestRelease = new Deferred()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const params = new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    })
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGTERM' && firstTerm) {
        firstTerm = false
        const refused = new Error('operation not permitted') as NodeJS.ErrnoException
        refused.code = 'EPERM'
        throw refused
      }
      if (signal === 'SIGKILL') processes.alive.delete(4101)
    }

    const closing = close.execute(params)
    await records.requestStarted.promise
    identity = new Map([[4200, '4200:original-child']])
    terminal.prints('buffered trailing output')
    terminal.exits()
    records.requestRelease.resolve()

    await expect(closing).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    processes.now = 0
    processes.signals.length = 0

    await expect(close.execute(params)).resolves.toMatchObject({ target: TerminationMother.TARGET })
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toHaveLength(1)
    expect(records.closure?.status).toBe(ClosureStatus.CLOSED)
  })

  it('a requested close retry still waits for the PTY exit and retires the terminal', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(terminal.pid)
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGKILL') processes.alive.delete(terminal.pid)
    }
    const records = new ClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const params = new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    })

    await expect(close.execute(params)).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    processes.alive.add(terminal.pid)
    processes.now = 0
    processes.signals.length = 0

    await expect(close.execute(params)).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])

    processes.alive.delete(terminal.pid)
    terminal.exits()
    await expect(close.execute(params)).resolves.toMatchObject({ target: TerminationMother.TARGET })
    expect(records.closure?.status).toBe(ClosureStatus.CLOSED)
    expect(sessions.all()).toEqual([])
  })

  it('a completion-write retry trusts retired in-memory evidence without signalling a reused group', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({ spawn, signal: processes.signal, sleep: processes.sleep, now: () => processes.now })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(terminal.pid)
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGTERM') {
        processes.alive.delete(terminal.pid)
        terminal.exits()
      }
    }
    const records = new ClosureRecords()
    records.failCompletion = true
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const params = new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    })

    await expect(close.execute(params)).rejects.toThrow('completion refused')
    processes.alive.add(terminal.pid)
    processes.signals.length = 0
    records.failCompletion = false

    await expect(close.execute(params)).resolves.toMatchObject({ target: TerminationMother.TARGET })
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
    expect(records.closure?.status).toBe(ClosureStatus.CLOSED)
  })

  it('escalates within the bound and keeps failed termination retryable', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const first = sessions.open(LoginProgram.default())
    const second = sessions.open(LoginProgram.default())
    const firstTerminal = spawn.terminals[0]
    const secondTerminal = spawn.terminals[1]
    processes.alive.add(firstTerminal.pid)
    processes.alive.add(secondTerminal.pid)
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGKILL') {
        processes.alive.delete(firstTerminal.pid)
        firstTerminal.exits()
      }
    }

    await Inspections.settle()
    const evidence = await TerminationMother.prepared(sessions, first)
    await Promise.all([sessions.terminate(evidence), sessions.terminate(evidence)])

    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toHaveLength(1)
    expect(processes.signals.map(({ pid }) => pid)).not.toContain(-secondTerminal.pid)
    sessions.write({ session: second, text: 'still live' })
    expect(secondTerminal.written).toEqual(['still live'])

    const broken = sessions.open(LoginProgram.default())
    const brokenTerminal = spawn.terminals[2]
    processes.alive.add(brokenTerminal.pid)
    brokenTerminal.resizeFailure = new Error('EBADF')
    expect(() => sessions.resize({ session: broken, cols: 120, rows: 40 })).toThrow(LiveSessionNotLive)
    processes.now = 0
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGTERM') {
        processes.alive.delete(brokenTerminal.pid)
        brokenTerminal.exits()
      }
    }
    await Inspections.settle()
    await expect(sessions.terminate(await TerminationMother.prepared(sessions, broken))).resolves.toBeUndefined()

    const guardedSignals: { pid: number, signal: NodeJS.Signals | 0 }[] = []
    const guardedSpawn = SpawnDouble.recording()
    const guarded = Cabin.opening({
      spawn: guardedSpawn,
      signal: (pid, signal) => {
        guardedSignals.push({ pid, signal })
        if (signal !== 0) {
          const refused = new Error('operation not permitted') as NodeJS.ErrnoException
          refused.code = 'EPERM'
          throw refused
        }
      },
      sleep: async (): Promise<void> => {},
      now: () => 0,
      termGraceMs: 1,
      killGraceMs: 1,
      pollMs: 1,
    })
    const guardedSession = guarded.open(LoginProgram.default())
    await Inspections.settle()
    const guardedEvidence = await TerminationMother.prepared(guarded, guardedSession)

    await expect(guarded.terminate(guardedEvidence)).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(guardedSignals).toContainEqual({ pid: -guardedSpawn.terminals[0].pid, signal: 'SIGTERM' })

    guardedSignals.length = 0
    await expect(guarded.confirmTermination(guardedEvidence))
      .rejects.toBeInstanceOf(SessionTerminationUnconfirmed)
    expect(guardedSignals).toEqual([{ pid: -guardedSpawn.terminals[0].pid, signal: 0 }])
  })

  it('terminal output and replay do not wait for process inspection', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({ spawn, inspectProcessTable: inspection.inspect })
    const session = sessions.open(LoginProgram.default())
    const first: string[] = []
    const second: string[] = []
    sessions.watch({ session, onBytes: (bytes) => first.push(bytes), onEnded: () => {} })
    sessions.watch({ session, onBytes: (bytes) => second.push(bytes), onEnded: () => {} })
    await vi.advanceTimersByTimeAsync(0)
    const chunks = Array.from({ length: 100 }, (_, index) => `${index},`)

    for (const chunk of chunks) spawn.terminals[0].prints(chunk)
    const replay = sessions.watch({ session, onBytes: () => {}, onEnded: () => {} })

    expect(first).toEqual(chunks)
    expect(second).toEqual(chunks)
    expect(replay.printed).toBe(chunks.join(''))
    expect(inspection.calls).toHaveLength(1)
    inspection.fails(0, new Error('inspection refused'))
    await AsyncTurns.run()
    spawn.terminals[0].prints('live after failed inspection')
    expect(first.at(-1)).toBe('live after failed inspection')
    expect(second.at(-1)).toBe('live after failed inspection')
    await Inspections.until(() => inspection.calls.length === 2, 'retry inspection did not start')
    expect(inspection.calls).toHaveLength(2)
    spawn.terminals[0].exits()
    spawn.terminals[0].prints('buffered after root exit')
    expect(replay.printed).toBe(chunks.join(''))
    expect(first).toEqual([...chunks, 'live after failed inspection'])
    expect(inspection.calls).toHaveLength(2)
  })

  it.each([
    { probe: 'absent', expectedEligible: false },
    { probe: 'present', expectedEligible: true },
    { probe: 'forbidden', expectedEligible: true },
  ])('background missing-group observations handle $probe probes conservatively', async ({
    probe, expectedEligible,
  }) => {
    vi.useFakeTimers()
    let inspectionTime = 0
    const inspection = new ControlledInspection(() => inspectionTime)
    const spawn = SpawnDouble.recording()
    const probes: { pid: number, signal: NodeJS.Signals | 0 }[] = []
    let probeResult = probe
    const sessions = Cabin.opening({
      spawn,
      inspectionNow: () => inspectionTime,
      inspectProcessTable: inspection.inspect,
      signal: (pid, signal) => {
        probes.push({ pid, signal })
        if (signal !== 0 || probeResult === 'present') return
        const failure = new Error(probeResult) as NodeJS.ErrnoException
        failure.code = probeResult === 'absent' ? 'ESRCH' : 'EPERM'
        throw failure
      },
    })
    const session = sessions.open(LoginProgram.default())
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    inspectionTime = 100
    await Inspections.until(() => inspection.calls.length === 2, 'background inspection did not start')
    inspection.succeeds(1, ProcessTables.group(9999, new Map([[9999, 'original']])))
    await AsyncTurns.run()

    expect(probes).toContainEqual({ pid: -4101, signal: 0 })
    inspectionTime = 200
    if (expectedEligible) {
      await Inspections.until(() => inspection.calls.length === 3, 'eligible background inspection did not continue')
    } else {
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(inspection.calls).toHaveLength(expectedEligible ? 3 : 2)

    if (!expectedEligible) {
      probeResult = 'present'
      spawn.terminals[0].exits()
      const destructiveBefore = probes.filter(({ signal }) => signal !== 0)
      await expect(sessions.terminate(TerminationMother.evidence(sessions, session))).resolves.toBeUndefined()
      expect(probes.filter(({ signal }) => signal !== 0)).toEqual(destructiveBefore)
    }
  })

  it('quiet sessions share bounded nonoverlapping process inspections', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const spawn = SpawnDouble.withPids(...Array.from({ length: 20 }, (_, index) => 4101 + index))
    const processes = new ControlledProcesses()
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const opened = Array.from({ length: 20 }, () => sessions.open(LoginProgram.default()))
    for (let processGroup = 4101; processGroup < 4121; processGroup += 1) processes.alive.add(processGroup)
    await vi.advanceTimersByTimeAsync(0)

    expect(inspection.calls).toHaveLength(1)
    expect(inspection.maximumActive).toBe(1)
    inspection.succeeds(0, ProcessTables.rootGroups(20))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 2, 'periodic shared inspection did not start')

    expect(inspection.calls).toHaveLength(2)
    expect(inspection.calls[1].startedAt - inspection.calls[0].startedAt).toBeGreaterThanOrEqual(100)
    expect(inspection.maximumActive).toBe(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(inspection.calls).toHaveLength(2)
    inspection.succeeds(1, ProcessTables.rootGroups(20, true))
    await AsyncTurns.run()

    await Inspections.until(() => inspection.calls.length === 3, 'all-root background verification did not start')
    inspection.succeeds(2, ProcessTables.group(9999, new Map([[9999, 'original']])))
    await AsyncTurns.run()
    for (let processGroup = 4101; processGroup < 4121; processGroup += 1) {
      expect(processes.signals).toContainEqual({ pid: -processGroup, signal: 0 })
    }

    spawn.terminals[0].exits()
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGTERM') processes.alive.delete(4101)
    }
    const closing = sessions.terminate(TerminationMother.evidence(sessions, opened[0]))
    await Inspections.until(() => inspection.calls.length === 4, 'verified-child close inspection did not start')
    expect(inspection.calls).toHaveLength(4)
    inspection.succeeds(3, ProcessTables.group(4101, new Map([[5000, '5000:original-child']])))
    await AsyncTurns.run()
    await expect(closing).resolves.toBeUndefined()

    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toEqual([
      { pid: -4101, signal: 'SIGTERM' },
    ])
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toEqual([])
    sessions.write({ session: opened[1], text: 'still writable' })
    expect(spawn.terminals[1].written).toEqual(['still writable'])
    expect(inspection.maximumActive).toBe(1)
  })

  it('close waits for fresh ownership evidence after durable intent', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    const synchronousEvidence = TerminationMother.evidence(sessions, session)
    expect(synchronousEvidence.status).toBe(ClosureStatus.REQUESTED)
    expect(inspection.calls).toHaveLength(1)
    const records = new ClosureRecords()
    records.requestStarted = new Deferred()
    records.requestRelease = new Deferred()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const params = new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    })

    const first = close.execute(params)
    const duplicate = close.execute(params)
    await records.requestStarted.promise
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 2, 'pre-existing background inspection did not start')
    expect(inspection.calls).toHaveLength(2)

    records.requestRelease.resolve()
    await AsyncTurns.run()
    inspection.succeeds(1, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
    await Inspections.until(() => inspection.calls.length === 3, 'post-request fresh inspection did not start')
    expect(inspection.calls).toHaveLength(3)
    inspection.succeeds(2, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
    await Inspections.until(() => inspection.calls.length === 4, 'post-checkpoint TERM inspection did not start')
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGTERM') {
        processes.alive.delete(4101)
        spawn.terminals[0].exits()
      }
    }
    inspection.succeeds(3, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([first, duplicate])
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toEqual([
      { pid: -4101, signal: 'SIGTERM' },
    ])
  })

  it('a child learned while the checkpoint write is pending requires an enriched explicit retry', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    const records = new ClosureRecords()
    records.checkpointStarted = new Deferred()
    records.checkpointRelease = new Deferred()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const params = new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    })

    const first = close.execute(params)
    await Inspections.until(() => inspection.calls.length === 2, 'checkpoint preparation inspection did not start')
    inspection.succeeds(1, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await records.checkpointStarted.promise
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])

    await vi.advanceTimersByTimeAsync(PtyLiveSessions.INSPECTION_INTERVAL_MS)
    await Inspections.until(() => inspection.calls.length === 3, 'member-learning background inspection did not start')
    inspection.succeeds(2, ProcessTables.group(4101, new Map([
      [4101, 'original'],
      [5001, '5001:learned-child-during-write'],
    ])))
    await AsyncTurns.run()
    expect(records.requestCount).toBe(2)
    expect(TerminationMother.evidence(sessions, session).ownership?.members).toEqual([
      { pid: 4101, identity: `4101:${ProcessTables.ORIGINAL}` },
      { pid: 5001, identity: `5001:${ProcessTables.CHILD}` },
    ])
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])

    records.checkpointRelease.resolve()
    await Inspections.until(() => inspection.calls.length === 4, 'fresh TERM inspection did not start')
    inspection.succeeds(3, ProcessTables.group(4101, new Map([
      [4101, 'original'],
      [5001, '5001:learned-child-during-write'],
    ])))

    await expect(first).rejects.toBeInstanceOf(SessionOwnershipUnverifiable)
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    expect(records.closure?.ownership?.members).toEqual([{
      pid: 4101,
      identity: `4101:${ProcessTables.ORIGINAL}`,
    }])
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])

    const retry = close.execute(params)
    await Inspections.until(() => inspection.calls.length === 5, 'retry confirmation inspection did not start')
    inspection.succeeds(4, ProcessTables.group(4101, new Map([
      [4101, 'original'],
      [5001, '5001:learned-child-during-write'],
    ])))
    await Inspections.until(() => inspection.calls.length === 6, 'retry checkpoint inspection did not start')
    inspection.succeeds(5, ProcessTables.group(4101, new Map([
      [4101, 'original'],
      [5001, '5001:learned-child-during-write'],
    ])))
    await Inspections.until(() => inspection.calls.length === 7, 'retry TERM inspection did not start')
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGTERM') {
        expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
        expect(records.closure?.ownership?.members).toEqual([
          { pid: 4101, identity: `4101:${ProcessTables.ORIGINAL}` },
          { pid: 5001, identity: `5001:${ProcessTables.CHILD}` },
        ])
        processes.alive.delete(4101)
        spawn.terminals[0].exits()
      }
    }
    inspection.succeeds(6, ProcessTables.group(4101, new Map([
      [4101, 'original'],
      [5001, '5001:learned-child-during-write'],
    ])))
    await retry

    expect(records.closure?.status).toBe(ClosureStatus.CLOSED)
    expect(records.closure?.ownership?.members).toEqual([
      { pid: 4101, identity: `4101:${ProcessTables.ORIGINAL}` },
      { pid: 5001, identity: `5001:${ProcessTables.CHILD}` },
    ])
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toEqual([
      { pid: -4101, signal: 'SIGTERM' },
    ])
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toEqual([])
  })

  it('pending inspection results cannot adopt exited or retired ownership', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection()
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4101)
    const sessions = Cabin.opening({ spawn, inspectProcessTable: inspection.inspect, signal: processes.signal })
    const original = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    processes.alive.delete(4101)
    spawn.terminals[0].exits()
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    const replacement = sessions.open(LoginProgram.default())
    processes.alive.add(4101)

    await expect(sessions.terminate(TerminationMother.evidence(sessions, original))).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
    expect(sessions.find(replacement.id)).toBe(replacement)
  })

  it('an unanchored exited root with a surviving group fails closed', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    spawn.terminals[0].exits()
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))

    const closing = sessions.terminate(TerminationMother.evidence(sessions, session))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 2, 'unanchored close inspection did not start')
    inspection.succeeds(1, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await expect(closing).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
  })

  it('an anchored pre-exit observation can preserve a newly observed child after root exit', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 2, 'anchored historical inspection did not start')
    expect(inspection.calls).toHaveLength(2)

    spawn.terminals[0].exits()
    inspection.succeeds(1, ProcessTables.group(4101, new Map([
      [4101, '4101:original'],
      [5000, '5000:original-child'],
    ])))
    await AsyncTurns.run()
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGTERM') processes.alive.delete(4101)
    }
    const closing = sessions.terminate(TerminationMother.evidence(sessions, session))
    await Inspections.until(() => inspection.calls.length === 3, 'fresh child-only close inspection did not start')
    inspection.succeeds(2, ProcessTables.group(4101, new Map([[5000, '5000:original-child']])))

    await expect(closing).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toEqual([
      { pid: -4101, signal: 'SIGTERM' },
    ])
  })

  it('a snapshot released after retirement cannot teach replacement ownership', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4101)
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
    })
    const original = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 2, 'inspection to retire did not start')
    processes.alive.delete(4101)
    spawn.terminals[0].exits()
    await expect(sessions.terminate(TerminationMother.evidence(sessions, original))).resolves.toBeUndefined()

    const replacement = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    inspection.succeeds(1, ProcessTables.group(4101, new Map([
      [4101, '4101:original'],
      [5000, '5000:original-child'],
    ])))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 3, 'replacement bootstrap did not start after physical reap')
    inspection.succeeds(2, ProcessTables.group(4101, new Map([[4101, 'replacement']])))
    await AsyncTurns.run()
    spawn.terminals[1].exits()
    const refused = sessions.terminate(TerminationMother.evidence(sessions, replacement))
    await Inspections.until(() => inspection.calls.length === 4, 'replacement close inspection did not start')
    inspection.succeeds(3, ProcessTables.group(4101, new Map([[5000, '5000:original-child']])))

    await expect(refused).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
  })

  it.each([
    { change: 'child identity under the same PID', fresh: new Map([[4101, '4101:original'], [5000, '5000:replacement-child']]), exit: false },
    { change: 'unknown member after root exit', fresh: new Map([[5001, '5001:original-child']]), exit: true },
  ])('refuses $change during fresh TERM validation', async ({ fresh, exit }) => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([
      [4101, '4101:original'],
      [5000, '5000:original-child'],
    ])))
    await AsyncTurns.run()
    if (exit) spawn.terminals[0].exits()

    const closing = sessions.terminate(TerminationMother.evidence(sessions, session))
    await vi.advanceTimersByTimeAsync(100)
    inspection.succeeds(1, ProcessTables.group(4101, fresh))

    await expect(closing).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
  })

  it('each destructive signal requires a fresh matching process group', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection()
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4101)
    let inspectionTime = 0
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: () => inspectionTime,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    const evidence = TerminationMother.evidence(sessions, session)
    const closing = sessions.terminate(evidence)
    inspectionTime = 100
    await vi.advanceTimersByTimeAsync(100)
    inspection.succeeds(1, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    await vi.advanceTimersByTimeAsync(0)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    inspectionTime = 200
    await vi.advanceTimersByTimeAsync(100)
    inspection.succeeds(2, ProcessTables.group(4101, new Map([[4101, 'replacement']])))
    await vi.runAllTimersAsync()

    await expect(closing).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toEqual([])
  })

  it('inspection failures bound closure without signalling unverified processes', async () => {
    const coded = (code: string): NodeJS.ErrnoException => {
      const failure = new Error(code) as NodeJS.ErrnoException
      failure.code = code

      return failure
    }
    const failures: { name: string, inspect: () => Promise<string> }[] = [
      { name: 'synchronous throw', inspect: (): Promise<string> => { throw new Error('thrown inspection') } },
      { name: 'rejection', inspect: async () => { throw new Error('rejected inspection') } },
      { name: 'ENOENT', inspect: async () => { throw coded('ENOENT') } },
      { name: 'EPERM', inspect: async () => { throw coded('EPERM') } },
      { name: 'maxBuffer overflow', inspect: async () => { throw coded('ERR_CHILD_PROCESS_STDIO_MAXBUFFER') } },
      { name: 'empty table', inspect: async () => '' },
      { name: 'malformed row', inspect: async () => 'not a process row\n' },
      { name: 'zero PID', inspect: async () => '0 4101 Thu Sep 17 22:29:08 2026\n' },
      { name: 'unsafe PID', inspect: async () => '9007199254740992 4101 Thu Sep 17 22:29:08 2026\n' },
      { name: 'negative PGID', inspect: async () => '4101 -1 Thu Sep 17 22:29:08 2026\n' },
      { name: 'invalid start', inspect: async () => '4101 4101 Thursday September 17 2026\n' },
      {
        name: 'duplicate PID',
        inspect: async () => `${ProcessTables.row(4101, 4101, ProcessTables.ORIGINAL)}\n` +
          `${ProcessTables.row(4101, 4101, ProcessTables.ORIGINAL)}\n`,
      },
    ]
    for (const failure of failures) {
      const processes = new ControlledProcesses()
      processes.alive.add(4101)
      const sessions = Cabin.opening({
        signal: processes.signal,
        inspectProcessTable: failure.inspect,
      })
      const session = sessions.open(LoginProgram.default())
      const records = new ClosureRecords()
      const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
      const closing = close.execute(new CloseCoordinatingSessionParams({
        conversation: TerminationMother.CONVERSATION,
        target: TerminationMother.TARGET,
        session,
      }))
      const refused = expect(closing, failure.name).rejects.toBeInstanceOf(SessionNotTerminated)
      const startedAt = Date.now()
      await refused
      expect(Date.now() - startedAt, failure.name).toBeLessThanOrEqual(
        5 * PtyLiveSessions.INSPECTION_REQUEST_TIMEOUT_MS
      )
      expect(records.closure?.status, failure.name).toBe(ClosureStatus.REQUESTED)
      expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
    }

    vi.useFakeTimers()
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const inspection = new ControlledInspection(Date.now)
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    const records = new ClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const closing = close.execute(new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    }))
    await vi.advanceTimersByTimeAsync(100)
    inspection.succeeds(1, ProcessTables.group(9999, new Map([[9999, 'original']])))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 3, 'post-checkpoint disagreement inspection did not start')
    inspection.succeeds(2, ProcessTables.group(9999, new Map([[9999, 'original']])))

    await expect(closing).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    expect(processes.signals).toContainEqual({ pid: -4101, signal: 0 })
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
  })

  it('a transient foreground inspection failure preserves anchored ownership for retry', async () => {
    vi.useFakeTimers()
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let invocation = 0
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      inspectionNow: Date.now,
      inspectProcessTable: async () => {
        invocation += 1
        if (invocation === 2) throw new Error('transient inspection failure')

        return ProcessTables.group(4101, new Map([[4101, 'original']]))
      },
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    await AsyncTurns.run()
    const records = new ClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const params = new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    })
    const first = close.execute(params)
    const firstRefused = expect(first).rejects.toBeInstanceOf(SessionNotTerminated)
    await vi.advanceTimersByTimeAsync(100)
    await firstRefused
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)

    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGTERM') {
        processes.alive.delete(4101)
        spawn.terminals[0].exits()
      }
    }
    const retry = close.execute(params)
    for (let step = 0; step < 4; step += 1) {
      await vi.advanceTimersByTimeAsync(100)
      await AsyncTurns.run()
    }
    await expect(retry).resolves.toMatchObject({ target: TerminationMother.TARGET })
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(records.closure?.status).toBe(ClosureStatus.CLOSED)
  })

  it('retiring the last sampled root releases inspection resources', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection()
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({ spawn, inspectProcessTable: inspection.inspect, signal: processes.signal })
    sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    processes.alive.delete(4101)
    spawn.terminals[0].exits()

    expect(inspection.calls[0].signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(inspection.calls).toHaveLength(1)
    expect(inspection.maximumActive).toBe(1)
  })

  it('shared inspection survives one root exit and stops when the final interest retires', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4102)
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
    })
    sessions.open(LoginProgram.default())
    sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    processes.alive.add(4102)
    await vi.advanceTimersByTimeAsync(0)
    spawn.terminals[0].exits()

    expect(inspection.calls[0].signal.aborted).toBe(false)
    inspection.succeeds(0, ProcessTables.rootGroups(2))
    await AsyncTurns.run()
    processes.alive.delete(4102)
    spawn.terminals[1].exits()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(inspection.calls).toHaveLength(1)
  })

  it('aborts a hung inspection at its execution deadline while the root remains eligible', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const sessions = Cabin.opening({
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
    })
    const session = sessions.open(LoginProgram.default())
    await vi.advanceTimersByTimeAsync(0)

    expect(sessions.find(session.id)).toBe(session)
    expect(inspection.calls[0].signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(PtyLiveSessions.INSPECTION_TIMEOUT_MS - 1)
    expect(inspection.calls[0].signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(inspection.calls[0].signal.aborted).toBe(true)
    expect(sessions.find(session.id)).toBe(session)
  })

  it('a hung fresh TERM inspection bounds close without a destructive signal', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const sessions = Cabin.opening({
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    const records = new ClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const closing = close.execute(new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    }))
    const refused = expect(closing).rejects.toBeInstanceOf(SessionNotTerminated)
    await Inspections.until(() => inspection.calls.length === 2, 'preparation inspection did not start')
    inspection.succeeds(1, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 3, 'fresh TERM inspection did not start')
    await vi.advanceTimersByTimeAsync(PtyLiveSessions.INSPECTION_TIMEOUT_MS - 1)
    expect(inspection.calls[2].signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(inspection.calls[2].signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(PtyLiveSessions.INSPECTION_REQUEST_TIMEOUT_MS)
    await refused

    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
  })

  it('a hung fresh KILL inspection preserves the completed TERM boundary', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const sessions = Cabin.opening({
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    const records = new ClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const closing = close.execute(new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    }))
    const refused = expect(closing).rejects.toBeInstanceOf(SessionNotTerminated)
    await Inspections.until(() => inspection.calls.length === 2, 'preparation inspection did not start')
    inspection.succeeds(1, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 3, 'fresh TERM inspection did not start')
    inspection.succeeds(2, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 4, 'fresh KILL inspection did not start')
    await vi.advanceTimersByTimeAsync(PtyLiveSessions.INSPECTION_TIMEOUT_MS - 1)
    expect(inspection.calls[3].signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(inspection.calls[3].signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(PtyLiveSessions.INSPECTION_REQUEST_TIMEOUT_MS)
    await refused

    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([
      { pid: -4101, signal: 'SIGTERM' },
    ])
  })

  it('a normal close confirms immediately after TERM without entering KILL grace', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const destructive: { signal: NodeJS.Signals, at: number }[] = []
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: (pid, signal) => {
        processes.signal(pid, signal)
        if (signal === 0) return
        destructive.push({ signal, at: processes.now })
        if (signal === 'SIGTERM') {
          processes.alive.delete(4101)
          spawn.terminals[0].exits()
        }
      },
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 30,
      killGraceMs: 40,
      pollMs: 10,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    const closing = sessions.terminate(TerminationMother.evidence(sessions, session))
    await Inspections.until(() => inspection.calls.length === 2, 'fresh TERM inspection did not start')
    inspection.succeeds(1, ProcessTables.group(4101, new Map([[4101, 'original']])))

    await expect(closing).resolves.toBeUndefined()
    expect(destructive).toEqual([{ signal: 'SIGTERM', at: 0 }])
    expect(processes.now).toBe(0)
  })

  it('waits the full grace after each destructive signal before confirming delayed exit', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const spawn = SpawnDouble.recording()
    const termGraceMs = 30
    const killGraceMs = 40
    let processNow = 0
    let alive = true
    let killSent = false
    const destructive: { signal: NodeJS.Signals, at: number }[] = []
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: (pid, signal) => {
        if (signal === 0) {
          if (!alive) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
          return
        }
        expect(pid).toBe(-4101)
        destructive.push({ signal, at: processNow })
        if (signal === 'SIGKILL') killSent = true
      },
      sleep: async (milliseconds) => {
        processNow += milliseconds
        if (killSent && processNow >= termGraceMs + killGraceMs) {
          alive = false
          spawn.terminals[0].exits()
        }
      },
      now: () => processNow,
      termGraceMs,
      killGraceMs,
      pollMs: 10,
    })
    const session = sessions.open(LoginProgram.default())
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    const closing = sessions.terminate(TerminationMother.evidence(sessions, session))
    await Inspections.until(() => inspection.calls.length === 2, 'fresh TERM inspection did not start')
    inspection.succeeds(1, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    await vi.advanceTimersByTimeAsync(PtyLiveSessions.INSPECTION_INTERVAL_MS)
    expect(inspection.calls).toHaveLength(3)
    inspection.succeeds(2, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await expect(closing).resolves.toBeUndefined()

    expect(destructive).toEqual([
      { signal: 'SIGTERM', at: 0 },
      { signal: 'SIGKILL', at: termGraceMs },
    ])
    expect(processNow).toBe(termGraceMs + killGraceMs)
  })

  it.each(['EPERM', 'EACCES'] as const)(
    'a foreground absence probe denied with %s keeps contextual refusal without signalling',
    async (code) => {
      vi.useFakeTimers()
      const inspection = new ControlledInspection(Date.now)
      const destructive: { pid: number, signal: NodeJS.Signals }[] = []
      const sessions = Cabin.opening({
        inspectProcessTable: inspection.inspect,
        inspectionNow: Date.now,
        signal: (pid, signal) => {
          if (signal === 0) throw Object.assign(new Error(`probe refused with ${code}`), { code })
          destructive.push({ pid, signal })
        },
      })
      const session = sessions.open(LoginProgram.default())
      await vi.advanceTimersByTimeAsync(0)
      inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
      await AsyncTurns.run()
      const records = new ClosureRecords()
      const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
      const closing = close.execute(new CloseCoordinatingSessionParams({
        conversation: TerminationMother.CONVERSATION,
        target: TerminationMother.TARGET,
        session,
      }))
      await Inspections.until(() => inspection.calls.length === 2, 'fresh foreground inspection did not start')
      inspection.succeeds(1, ProcessTables.group(9999, new Map([[9999, 'other']])))
      await AsyncTurns.run()
      await Inspections.until(() => inspection.calls.length === 3, 'post-checkpoint foreground inspection did not start')
      inspection.succeeds(2, ProcessTables.group(9999, new Map([[9999, 'other']])))

      const failure = await closing.catch((cause: unknown) => cause)
      expect(failure).toBeInstanceOf(SessionTerminationPermissionDenied)
      expect((failure as Error).message).toContain(`target ${TerminationMother.TARGET}`)
      expect((failure as Error).message).toContain(`session ${session.id}`)
      expect((failure as Error).message).toContain('process group 4101')
      expect((failure as Error).message).toContain(`probe refused with ${code}`)
      expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
      expect(destructive).toEqual([])
    },
  )

  it('an unreaped inspection holds the physical slot while requests expire and later work restarts', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4102)
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
    })
    const first = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    processes.alive.delete(4101)
    spawn.terminals[0].exits()
    expect(inspection.calls[0].signal.aborted).toBe(true)

    const second = sessions.open(LoginProgram.default())
    processes.alive.add(4102)
    const startedAt = Date.now()
    const bounded = sessions.terminate(TerminationMother.evidence(sessions, second))
    const refused = expect(bounded).rejects.toBeInstanceOf(SessionNotTerminated)
    let settledAt: number | null = null
    void bounded.catch(() => { settledAt = Date.now() })
    await vi.advanceTimersByTimeAsync(1_499)
    expect(settledAt).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await refused
    expect(settledAt! - startedAt).toBe(PtyLiveSessions.INSPECTION_REQUEST_TIMEOUT_MS)
    expect(settledAt! - startedAt).toBeLessThanOrEqual(
      4 * PtyLiveSessions.INSPECTION_REQUEST_TIMEOUT_MS + 20
    )
    expect(inspection.calls).toHaveLength(1)
    expect(inspection.maximumActive).toBe(1)

    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    await Inspections.until(() => inspection.calls.length === 2, 'queued root did not restart after physical reap')
    expect(inspection.calls).toHaveLength(2)
    inspection.succeeds(1, ProcessTables.group(4102, new Map([[4102, 'original']])))
    await AsyncTurns.run()
    expect(sessions.find(second.id)).toBe(second)
    expect(sessions.find(first.id)).toBeNull()
  })

  it('the default inspector executes bounded asynchronous ps and validates its output', async () => {
    const exec = new ExecFileDouble()
    exec.install()
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let heartbeat = false
    const probeObservedAfterHeartbeat: boolean[] = []
    const sessions = new PtyLiveSessions({
      spawn,
      newId: Ids.sequential(),
      stderr: (): void => {},
      signal: (pid, signal) => {
        if (signal === 0) probeObservedAfterHeartbeat.push(heartbeat)
        processes.signal(pid, signal)
      },
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
      inspectProcessTable: (read) => border.readTable(read),
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await Inspections.settle()

    expect(exec.calls[0]).toMatchObject({ file: '/bin/ps', argv: ['-axo', 'pid=,pgid=,lstart='] })
    expect(exec.calls[0].options).toEqual(expect.objectContaining({
      encoding: 'utf8', timeout: 500, killSignal: 'SIGKILL', maxBuffer: 4_194_304,
      env: expect.objectContaining({ LC_ALL: 'C' }), signal: expect.any(AbortSignal),
    }))
    const delivered: string[] = []
    sessions.watch({ session, onBytes: (bytes) => delivered.push(bytes), onEnded: () => {} })
    spawn.terminals[0].prints('available before ps callback')
    expect(delivered).toEqual(['available before ps callback'])

    exec.responds(0, null, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    expect(exec.calls).toHaveLength(1)
    exec.closes(0)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(exec.calls).toHaveLength(2)

    const largeCapture = Array.from({ length: 257 }, (_, index) =>
      ProcessTables.row(10_000 + index, 0, ProcessTables.ORIGINAL)
    ).join('\n') + '\n'
    exec.responds(1, null, largeCapture)
    setImmediate(() => { heartbeat = true })
    exec.closes(1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(probeObservedAfterHeartbeat).toEqual([true])

    const closing = sessions.terminate(TerminationMother.evidence(sessions, session))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(exec.calls).toHaveLength(3)
    exec.responds(2, null, ProcessTables.groups(new Map([
      [4101, new Map([[4101, 'original']])],
      [9999, new Map([[9999, 'original']])],
    ])))
    exec.closes(2)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(exec.calls).toHaveLength(4)
    processes.onSignal = (pid, signal) => {
      if (signal !== 'SIGKILL') return
      processes.alive.delete(-pid)
      spawn.terminals[0].exits()
    }
    exec.responds(3, null, ProcessTables.group(4101, new Map([[4101, 'original']])))
    exec.closes(3)

    await expect(closing).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([
      { pid: -4101, signal: 'SIGTERM' },
      { pid: -4101, signal: 'SIGKILL' },
    ])
  })

  it.each([
    { name: 'ENOENT', code: 'ENOENT', stdout: '' },
    { name: 'abort', code: 'ABORT_ERR', stdout: '' },
    { name: 'maxBuffer', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', stdout: '' },
    { name: 'malformed output', code: null, stdout: 'truncated process row\n' },
  ])('the default inspector retains its slot after early $name until child close', async ({ code, stdout }) => {
    vi.useFakeTimers()
    const exec = new ExecFileDouble()
    exec.install()
    const spawn = SpawnDouble.withPids(4101, 4102)
    const destructive: { pid: number, signal: NodeJS.Signals }[] = []
    const sessions = new PtyLiveSessions({
      spawn,
      newId: Ids.sequential(),
      stderr: (): void => {},
      signal: (pid, signal): void => {
        if (signal !== 0) destructive.push({ pid, signal })
      },
      sleep: async (): Promise<void> => {},
      now: () => 0,
      inspectionNow: Date.now,
      termGraceMs: 1,
      killGraceMs: 1,
      pollMs: 1,
      inspectProcessTable: (read) => border.readTable(read),
    })
    sessions.open(LoginProgram.default())
    await vi.advanceTimersByTimeAsync(0)
    sessions.open(LoginProgram.default())
    const failure = code === null ? null : new Error(code) as NodeJS.ErrnoException
    if (failure !== null) failure.code = code ?? undefined
    exec.responds(0, failure, stdout)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(exec.calls).toHaveLength(1)
    expect(destructive).toEqual([])

    exec.closes(0)
    await AsyncTurns.run()
    await Inspections.until(() => exec.calls.length === 2, 'default inspection did not restart after child close')
    expect(exec.calls).toHaveLength(2)
  })

  it.each([
    { name: 'ENOENT', code: 'ENOENT', stdout: ProcessTables.group(4101, new Map([[4101, 'original']])) },
    { name: 'abort', code: 'ABORT_ERR', stdout: ProcessTables.group(4101, new Map([[4101, 'original']])) },
    {
      name: 'maxBuffer',
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      stdout: ProcessTables.group(4101, new Map([[4101, 'original']])),
    },
    { name: 'malformed output', code: null, stdout: 'truncated process row\n' },
  ])('a timely default-inspector $name failure leaves close durably requested', async ({ code, stdout }) => {
    vi.useFakeTimers()
    const exec = new ExecFileDouble()
    exec.install()
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    const sessions = new PtyLiveSessions({
      spawn,
      newId: Ids.sequential(),
      stderr: (): void => {},
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      inspectionNow: Date.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
      inspectProcessTable: (read) => border.readTable(read),
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    exec.responds(0, null, ProcessTables.group(4101, new Map([[4101, 'original']])))
    exec.closes(0)
    await AsyncTurns.run()
    const records = new ClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const startedAt = Date.now()
    const closing = close.execute(new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session,
    }))
    let settledAt: number | null = null
    void closing.catch(() => { settledAt = Date.now() })
    await vi.advanceTimersByTimeAsync(100)
    expect(exec.calls).toHaveLength(2)
    const failure = code === null ? null : Object.assign(new Error(code), { code })
    exec.responds(1, failure, stdout)
    exec.closes(1)
    await expect(closing).rejects.toBeInstanceOf(SessionNotTerminated)

    expect(settledAt! - startedAt).toBeLessThan(PtyLiveSessions.INSPECTION_TIMEOUT_MS)
    expect(exec.calls[1].options.signal).toMatchObject({ aborted: false })
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
  })

  it('the default inspector also waits for its callback when child close arrives first', async () => {
    vi.useFakeTimers()
    const exec = new ExecFileDouble()
    exec.install()
    const sessions = new PtyLiveSessions({
      spawn: SpawnDouble.recording(),
      newId: Ids.sequential(),
      stderr: (): void => {},
      signal: (): void => {},
      sleep: async (): Promise<void> => {},
      now: () => 0,
      inspectionNow: Date.now,
      termGraceMs: 1,
      killGraceMs: 1,
      pollMs: 1,
      inspectProcessTable: (read) => border.readTable(read),
    })
    sessions.open(LoginProgram.default())
    await vi.advanceTimersByTimeAsync(0)
    exec.closes(0)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(exec.calls).toHaveLength(1)

    exec.responds(0, null, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await Inspections.until(() => exec.calls.length === 2, 'default inspection did not settle after its late callback')
    expect(exec.calls).toHaveLength(2)
  })

  it('the_process_table_read_carries_the_inspection_bounds', async () => {
    const received: TableRead[] = []
    const sessions = Cabin.opening({
      inspectProcessTable: async (read) => {
        received.push(read)

        return ProcessTables.group(4101, new Map([[4101, '4101:original']]))
      },
    })
    sessions.open(LoginProgram.default())
    await Inspections.settle()

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      timeoutMs: PtyLiveSessions.INSPECTION_TIMEOUT_MS,
      maxBufferBytes: PtyLiveSessions.INSPECTION_MAX_BUFFER_BYTES,
    })
    expect(received[0].abort).toBeInstanceOf(AbortSignal)
  })

  it('concurrent closes share inspection work without sharing signal authority', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4102, 4103)
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
    })
    const first = sessions.open(LoginProgram.default())
    const second = sessions.open(LoginProgram.default())
    const third = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    processes.alive.add(4102)
    processes.alive.add(4103)
    await vi.advanceTimersByTimeAsync(0)
    const both = ProcessTables.groups(new Map([
      [4101, new Map([[4101, 'original']])],
      [4102, new Map([[4102, 'original']])],
      [4103, new Map([[4103, 'original']])],
    ]))
    inspection.succeeds(0, both)
    await AsyncTurns.run()
    const firstClose = sessions.terminate(TerminationMother.evidence(sessions, first))
    const secondClose = sessions.terminate(TerminationMother.evidence(sessions, second))
    await vi.advanceTimersByTimeAsync(100)

    expect(inspection.calls).toHaveLength(2)
    const thirdClose = sessions.terminate(TerminationMother.evidence(sessions, third))
    processes.onSignal = (pid, signal) => {
      if (signal !== 'SIGTERM') return
      processes.alive.delete(-pid)
      spawn.terminals[-pid - 4101].exits()
    }
    inspection.succeeds(1, ProcessTables.groups(new Map([
      [4101, new Map([[4101, 'original']])],
      [4102, new Map([[4102, 'replacement']])],
      [4103, new Map([[4103, 'original']])],
    ])))
    await AsyncTurns.run()
    await firstClose
    await expect(secondClose).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toEqual([{ pid: -4101, signal: 'SIGTERM' }])

    await vi.advanceTimersByTimeAsync(100)
    expect(inspection.calls).toHaveLength(3)
    inspection.succeeds(2, both)
    await thirdClose
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toEqual([
      { pid: -4101, signal: 'SIGTERM' },
      { pid: -4103, signal: 'SIGTERM' },
    ])
  })

  it('retiring one shared-scan interest does not cancel another close waiter', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4102)
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
    })
    const first = sessions.open(LoginProgram.default())
    const second = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    processes.alive.add(4102)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.rootGroups(2))
    await AsyncTurns.run()

    await vi.advanceTimersByTimeAsync(50)
    const secondClose = sessions.terminate(TerminationMother.evidence(sessions, second))
    await Inspections.until(() => inspection.calls.length === 2, 'shared foreground scan did not start')
    processes.alive.delete(4101)
    spawn.terminals[0].exits()
    await expect(sessions.terminate(TerminationMother.evidence(sessions, first))).resolves.toBeUndefined()

    expect(inspection.calls[1].signal.aborted).toBe(false)
    processes.onSignal = (pid, signal) => {
      if (pid === -4102 && signal === 'SIGTERM') {
        processes.alive.delete(4102)
        spawn.terminals[1].exits()
      }
    }
    inspection.succeeds(1, ProcessTables.group(4102, new Map([[4102, 'original']])))
    await expect(secondClose).resolves.toBeUndefined()
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toEqual([
      { pid: -4102, signal: 'SIGTERM' },
    ])
  })

  it('a failed inspection or exit probe does not poison a later owned close', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4102)
    let firstTable = new Map([[4101, '4101:original'], [5000, '5000:original-child']])
    let failInspection = false
    let denyExitProbe = false
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: async () => {
        if (failInspection) {
          failInspection = false
          throw new Error('transient inspection failure')
        }
        return ProcessTables.groups(new Map([
          [4101, firstTable],
          [4102, new Map([[4102, '4102:original']])],
        ]))
      },
      signal: (pid, signal) => {
        if (signal === 0 && denyExitProbe) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
        processes.signal(pid, signal)
      },
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const retried = sessions.open(LoginProgram.default())
    const other = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    processes.alive.add(4102)
    await Inspections.settle()
    const records = new ClosureRecords()
    const close = new CloseCoordinatingSession({ records, liveSessions: sessions })
    const params = new CloseCoordinatingSessionParams({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session: retried,
    })
    failInspection = true
    await expect(close.execute(params)).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])

    const checkpoint = await sessions.prepareTermination(records.closure!)
    firstTable = new Map([
      [4101, '4101:original'],
      [5000, '5000:original-child'],
      [5001, '5001:original-child'],
    ])
    const beforeRefusal = processes.now
    await expect(sessions.terminate(checkpoint)).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(processes.now).toBe(beforeRefusal)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])

    firstTable = new Map([[4101, '4101:original'], [5000, '5000:original-child']])
    denyExitProbe = true
    spawn.terminals[0].exits()
    firstTable = new Map([[5000, '5000:original-child']])
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGTERM') processes.alive.delete(4101)
    }
    await expect(close.execute(params)).rejects.toBeInstanceOf(SessionTerminationPermissionDenied)
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
    denyExitProbe = false
    await expect(close.execute(params)).resolves.toMatchObject({ target: TerminationMother.TARGET })
    expect(records.closure?.status).toBe(ClosureStatus.CLOSED)

    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toEqual([
      { pid: -4101, signal: 'SIGTERM' },
    ])
    sessions.write({ session: other, text: 'other remains usable' })
    expect(spawn.terminals[1].written).toEqual(['other remains usable'])
  })

  it('restart closure retries use saved identities without a live terminal', async () => {
    const processes = new ControlledProcesses()
    processes.alive.add(4101)
    const spawn = SpawnDouble.recording()
    const ownership = new SessionProcessOwnership({
      rootIdentity: '4101:Thu Sep 17 22:29:08 2026',
      members: [
        { pid: 4101, identity: '4101:Thu Sep 17 22:29:08 2026' },
        { pid: 5000, identity: '5000:Thu Sep 17 22:29:09 2026' },
      ],
    })
    const closure = new SessionClosure({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session: 'terminal-before-restart',
      processGroup: 4101,
      status: ClosureStatus.REQUESTED,
      ownership,
    })
    let table = new Map([[4101, '4101:original'], [5000, '5000:original-child']])
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: async () => ProcessTables.group(4101, table),
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    processes.onSignal = (_pid, signal) => {
      if (signal === 'SIGKILL') processes.alive.delete(4101)
    }

    await Promise.all([sessions.terminate(closure), sessions.terminate(closure)])

    expect(sessions.all()).toEqual([])
    expect(spawn.calls).toEqual([])
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toEqual([
      { pid: -4101, signal: 'SIGTERM' },
    ])
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toEqual([
      { pid: -4101, signal: 'SIGKILL' },
    ])

    const guardedProcesses = new ControlledProcesses()
    guardedProcesses.alive.add(4101)
    table = new Map([[4101, '4101:original'], [5001, '5001:original-child']])
    const guarded = Cabin.opening({
      inspectProcessTable: async () => ProcessTables.group(4101, table),
      signal: guardedProcesses.signal,
    })
    await expect(guarded.terminate(closure)).rejects.toBeInstanceOf(SessionOwnershipUnverifiable)
    expect(guardedProcesses.signals.filter(({ signal }) => signal !== 0)).toEqual([])
    expect(guarded.all()).toEqual([])

    const changedBeforeKill = new ControlledProcesses()
    changedBeforeKill.alive.add(4101)
    let killTable = new Map([[4101, '4101:original'], [5000, '5000:original-child']])
    const guardedKill = Cabin.opening({
      inspectProcessTable: async () => ProcessTables.group(4101, killTable),
      signal: changedBeforeKill.signal,
      sleep: async (milliseconds) => {
        changedBeforeKill.now += milliseconds
        killTable = new Map([[4101, '4101:original'], [5001, '5001:original-child']])
      },
      now: () => changedBeforeKill.now,
      termGraceMs: 1,
      killGraceMs: 1,
      pollMs: 1,
    })
    await expect(guardedKill.terminate(closure)).rejects.toBeInstanceOf(SessionOwnershipUnverifiable)
    expect(changedBeforeKill.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(changedBeforeKill.signals.filter(({ signal }) => signal === 'SIGKILL')).toEqual([])
  })

  it('retained and recovered ownership requests share one physical fresh scan', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection(Date.now)
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4102)
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: Date.now,
      signal: (pid, signal) => {
        if (pid === -4101 && signal === 'SIGTERM') processes.alive.delete(4101)
        processes.signal(pid, signal)
      },
      sleep: processes.sleep,
      now: () => processes.now,
    })
    const retained = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    processes.alive.add(4102)
    await vi.advanceTimersByTimeAsync(0)
    const both = ProcessTables.groups(new Map([
      [4101, new Map([[4101, '4101:original']])],
      [4102, new Map([[4102, '4102:original']])],
    ]))
    inspection.succeeds(0, both)
    await AsyncTurns.run()
    const recovered = new SessionClosure({
      conversation: TerminationMother.CONVERSATION,
      target: TerminationMother.TARGET,
      session: 'saved-before-restart',
      processGroup: 4101,
      status: ClosureStatus.REQUESTED,
      ownership: new SessionProcessOwnership({
        rootIdentity: '4101:Thu Sep 17 22:29:08 2026',
        members: [{ pid: 4101, identity: '4101:Thu Sep 17 22:29:08 2026' }],
      }),
    })

    const preparing = sessions.prepareTermination(TerminationMother.evidence(sessions, retained))
    const terminating = sessions.terminate(recovered)
    await Inspections.until(() => inspection.calls.length === 2, 'mixed ownership scan did not start')
    expect(inspection.maximumActive).toBe(1)
    inspection.succeeds(1, both)
    await expect(preparing).resolves.toMatchObject({ session: retained.id })
    await expect(terminating).resolves.toBeUndefined()
    expect(inspection.calls).toHaveLength(2)
    expect(spawn.calls).toHaveLength(1)
    spawn.terminals[0].exits()
  })

  it('confirmed absence prevents later inspection from reviving a reused group', async () => {
    vi.useFakeTimers()
    const inspection = new ControlledInspection()
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.withPids(4101, 4101)
    let inspectionTime = 0
    const sessions = Cabin.opening({
      spawn,
      inspectProcessTable: inspection.inspect,
      inspectionNow: () => inspectionTime,
      signal: processes.signal,
      sleep: async (milliseconds) => {
        processes.now += milliseconds
        inspectionTime = 200
        await vi.advanceTimersByTimeAsync(100)
        processes.alive.delete(4101)
        spawn.terminals[0].exits()
      },
      now: () => processes.now,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    await vi.advanceTimersByTimeAsync(0)
    inspection.succeeds(0, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await AsyncTurns.run()
    const evidence = TerminationMother.evidence(sessions, session)
    const closing = sessions.terminate(evidence)
    inspectionTime = 100
    await vi.advanceTimersByTimeAsync(100)
    inspection.succeeds(1, ProcessTables.group(4101, new Map([[4101, 'original']])))
    await closing
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)

    const replacement = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
    expect(inspection.calls).toHaveLength(3)
    inspection.succeeds(2, ProcessTables.group(4101, new Map([[4101, 'replacement']])))
    await AsyncTurns.run()
    await vi.advanceTimersByTimeAsync(100)
    inspection.succeeds(3, ProcessTables.group(4101, new Map([[4101, 'replacement']])))
    await AsyncTurns.run()
    processes.signals.length = 0

    await expect(sessions.terminate(evidence)).resolves.toBeUndefined()
    await expect(sessions.confirmTermination(evidence)).resolves.toBeUndefined()
    sessions.write({ session: replacement, text: 'replacement remains writable' })
    expect(spawn.terminals[1].written).toEqual(['replacement remains writable'])
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toEqual([])
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toEqual([])
  })
})
