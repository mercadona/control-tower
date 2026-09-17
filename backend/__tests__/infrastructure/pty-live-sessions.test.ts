import { describe, it, expect } from 'vitest'
import { PtyLiveSessions } from '../../src/infrastructure/pty-live-sessions.ts'
import type { Terminal, TerminalSpawn } from '../../src/infrastructure/pty-live-sessions.ts'
import { SessionProgram } from '../../src/domain/value-objects/session-program.ts'
import { LiveSessionNotLive } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { SessionNotTerminated, SessionTerminationUnconfirmed } from '../../src/domain/exceptions.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import {
  CloseCoordinatingSession,
  CloseCoordinatingSessionParams,
} from '../../src/application/actions/close-coordinating-session.ts'
import { ClosureStatus, SessionClosure } from '../../src/domain/value-objects/session-closure.ts'

type RecordedSpawn = {
  file: string,
  argv: string[],
  options: { name: string, cols: number, rows: number, cwd: string, env: Record<string, string> },
}

type ResizedTo = { cols: number, rows: number }

class TerminalDouble implements Terminal {
  readonly pid: number
  readonly written: string[] = []
  readonly resized: ResizedTo[] = []
  resizeFailure: Error | null = null
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
    inspectProcessGroup: (processGroup: number) => ReadonlyMap<number, string>,
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
      inspectProcessGroup: overrides.inspectProcessGroup ?? ((processGroup) => new Map([
        [processGroup, `${processGroup}:original`],
      ])),
    })
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

  async recallClosure(): Promise<SessionClosure | null> {
    return this.closure
  }

  async requestClosure(closure: SessionClosure): Promise<void> {
    this.closure = closure
    this.requestStarted?.resolve()
    await this.requestRelease?.promise
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

    const closing = sessions.terminate(TerminationMother.evidence(sessions, session))
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
      inspectProcessGroup: () => identity,
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

    await expect(sessions.terminate(TerminationMother.evidence(sessions, session)))
      .rejects.toBeInstanceOf(SessionNotTerminated)
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
      inspectProcessGroup: () => identity,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)

    await expect(sessions.terminate(TerminationMother.evidence(sessions, session)))
      .rejects.toBeInstanceOf(SessionNotTerminated)
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
      inspectProcessGroup: () => identity,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)

    await expect(sessions.terminate(TerminationMother.evidence(sessions, session)))
      .rejects.toBeInstanceOf(SessionNotTerminated)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGTERM')).toHaveLength(1)
    expect(processes.signals.filter(({ signal }) => signal === 'SIGKILL')).toEqual([])
  })

  it('validates the original identities before retrying TERM after root exit', async () => {
    const processes = new ControlledProcesses()
    const spawn = SpawnDouble.recording()
    let identity = new Map([[4101, '4101:original'], [4200, '4200:original-child']])
    let firstTerm = true
    const sessions = Cabin.opening({
      spawn,
      signal: processes.signal,
      sleep: processes.sleep,
      now: () => processes.now,
      inspectProcessGroup: () => identity,
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

    await expect(close.execute(params)).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(processes.signals.filter(({ signal }) => signal !== 0)).toEqual([])
    expect(records.closure?.status).toBe(ClosureStatus.REQUESTED)
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
      inspectProcessGroup: () => identity,
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(4101)
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
      inspectProcessGroup: () => identity,
      termGraceMs: 2,
      killGraceMs: 2,
      pollMs: 1,
    })
    const session = sessions.open(LoginProgram.default())
    processes.alive.add(4101)
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
      inspectProcessGroup: () => identity,
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(4101)
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
      inspectProcessGroup: () => identity,
    })
    const session = sessions.open(LoginProgram.default())
    const terminal = spawn.terminals[0]
    processes.alive.add(4101)
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

    const evidence = TerminationMother.evidence(sessions, first)
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
    await expect(sessions.terminate(TerminationMother.evidence(sessions, broken))).resolves.toBeUndefined()

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
    const guardedEvidence = TerminationMother.evidence(guarded, guardedSession)

    await expect(guarded.terminate(guardedEvidence)).rejects.toBeInstanceOf(SessionNotTerminated)
    expect(guardedSignals).toContainEqual({ pid: -guardedSpawn.terminals[0].pid, signal: 'SIGTERM' })

    guardedSignals.length = 0
    await expect(guarded.confirmTermination(guardedEvidence))
      .rejects.toBeInstanceOf(SessionTerminationUnconfirmed)
    expect(guardedSignals).toEqual([{ pid: -guardedSpawn.terminals[0].pid, signal: 0 }])
  })
})
