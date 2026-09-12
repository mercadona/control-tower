import { describe, it, expect } from 'vitest'
import { PtyLiveSessions } from '../../src/infrastructure/pty-live-sessions.ts'
import type { Terminal, TerminalSpawn } from '../../src/infrastructure/pty-live-sessions.ts'
import type { LiveSession } from '../../src/domain/value-objects/live-session.ts'

type RecordedSpawn = {
  file: string,
  argv: string[],
  options: { name: string, cols: number, rows: number, cwd: string, env: Record<string, string> },
}

class TerminalDouble implements Terminal {
  readonly written: string[] = []
  #onData: ((bytes: string) => void) | null = null
  #onExit: (() => void) | null = null

  onData(listener: (bytes: string) => void): void {
    this.#onData = listener
  }

  onExit(listener: () => void): void {
    this.#onExit = listener
  }

  write(text: string): void {
    this.written.push(text)
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
    const calls: RecordedSpawn[] = []
    const terminals: TerminalDouble[] = []
    const spawn: TerminalSpawn = (file, argv, options) => {
      calls.push({ file, argv, options })
      const terminal = new TerminalDouble()
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
    spawn: TerminalSpawn, shell: string | undefined, cwd: string, env: NodeJS.ProcessEnv,
    newId: () => string, stderr: (line: string) => void,
  }> = {}): PtyLiveSessions {
    return new PtyLiveSessions({
      spawn: overrides.spawn ?? SpawnDouble.recording(),
      shell: 'shell' in overrides ? overrides.shell : '/bin/zsh',
      cwd: overrides.cwd ?? Cabin.CWD,
      env: overrides.env ?? { PATH: '/usr/bin' },
      newId: overrides.newId ?? Ids.sequential(),
      stderr: overrides.stderr ?? ((): void => {}),
    })
  }
}

class OpenedTerminal {
  readonly sessions: PtyLiveSessions
  readonly spawn: RecordingSpawn
  readonly session: LiveSession
  readonly terminal: TerminalDouble

  constructor({ sessions, spawn }: { sessions: PtyLiveSessions, spawn: RecordingSpawn }) {
    this.sessions = sessions
    this.spawn = spawn
    this.session = sessions.open()
    const terminal = spawn.terminals.at(-1)
    if (terminal === undefined) throw new Error('OpenedTerminal: opening did not spawn a terminal')
    this.terminal = terminal
  }

  static with(overrides: Partial<{
    shell: string | undefined, cwd: string, env: NodeJS.ProcessEnv,
    newId: () => string, stderr: (line: string) => void,
  }> = {}): OpenedTerminal {
    const spawn = SpawnDouble.recording()
    const sessions = Cabin.opening({ ...overrides, spawn })

    return new OpenedTerminal({ sessions, spawn })
  }
}

describe('PtyLiveSessions', () => {
  it('opening names the session after the program it runs', () => {
    const opened = OpenedTerminal.with({ shell: '/usr/local/bin/zsh' })

    expect(opened.session.name).toBe('zsh')
  })

  it('a watcher receives what the terminal printed before it arrived', () => {
    const opened = OpenedTerminal.with()

    opened.terminal.prints('hello ')
    opened.terminal.prints('world')
    const watch = opened.sessions.watch({ session: opened.session, onBytes: () => {} })

    expect(watch.printed).toBe('hello world')
  })

  it('two watchers of one session both receive the next bytes', () => {
    const opened = OpenedTerminal.with()
    const first: string[] = []
    const second: string[] = []
    opened.sessions.watch({ session: opened.session, onBytes: (bytes) => first.push(bytes) })
    opened.sessions.watch({ session: opened.session, onBytes: (bytes) => second.push(bytes) })

    opened.terminal.prints('shared bytes')

    expect(first).toEqual(['shared bytes'])
    expect(second).toEqual(['shared bytes'])
  })

  it('a stopped watcher receives nothing more and the session stays live', () => {
    const opened = OpenedTerminal.with()
    const received: string[] = []
    const watch = opened.sessions.watch({ session: opened.session, onBytes: (bytes) => received.push(bytes) })

    watch.stop()
    opened.terminal.prints('after the stop')

    expect(received).toEqual([])
    expect(opened.sessions.find(opened.session.id)).toBe(opened.session)
  })

  it('the scrollback keeps the last 262144 characters and drops the oldest', () => {
    const opened = OpenedTerminal.with()
    const atLimit = 'a'.repeat(PtyLiveSessions.SCROLLBACK_CHARACTERS)

    opened.terminal.prints(atLimit)
    const withinLimit = opened.sessions.watch({ session: opened.session, onBytes: () => {} })
    expect(withinLimit.printed).toBe(atLimit)

    opened.terminal.prints('b')
    const overLimit = opened.sessions.watch({ session: opened.session, onBytes: () => {} })
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

  it('the shell is the login interactive one, and /bin/sh when SHELL is unset', () => {
    const withShell = OpenedTerminal.with({ shell: '/usr/local/bin/fish' })

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

    const withoutShell = OpenedTerminal.with({ shell: undefined })

    expect(withoutShell.spawn.calls[0].file).toBe('/bin/sh')
  })

  it('the environment carries TERM and no undefined entry', () => {
    const opened = OpenedTerminal.with({ env: { PATH: '/usr/bin', GHOST: undefined, LANG: 'en_US.UTF-8' } })

    expect(opened.spawn.calls[0].options.env).toStrictEqual({
      PATH: '/usr/bin', LANG: 'en_US.UTF-8', TERM: PtyLiveSessions.TERM,
    })
    expect(Object.keys(opened.spawn.calls[0].options.env)).not.toContain('GHOST')
  })

  it('opening a terminal is announced on stderr, naming the session id and the program', () => {
    const written: string[] = []
    const opened = OpenedTerminal.with({ shell: '/usr/local/bin/fish', stderr: (line) => written.push(line) })

    expect(written).toEqual([`live session ${opened.session.id} (fish) opened\n`])
  })

  it('the terminal exiting is announced on stderr after the announcement that it opened', () => {
    const written: string[] = []
    const opened = OpenedTerminal.with({ shell: '/usr/local/bin/fish', stderr: (line) => written.push(line) })

    opened.terminal.exits()

    expect(written).toEqual([
      `live session ${opened.session.id} (fish) opened\n`,
      `live session ${opened.session.id} (fish) exited\n`,
    ])
  })
})
