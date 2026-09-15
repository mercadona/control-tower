import { LiveSessions, LiveSessionNotLive } from '../domain/ports/live-sessions.ts'
import { LiveSession } from '../domain/value-objects/live-session.ts'
import { SessionProgram } from '../domain/value-objects/session-program.ts'
import type { LiveSessionStream } from '../domain/ports/live-sessions.ts'

export type Terminal = {
  onData(listener: (bytes: string) => void): void,
  onExit(listener: () => void): void,
  write(text: string): void,
  resize(cols: number, rows: number): void,
}

export type TerminalSpawn = (file: string, argv: string[], options: {
  name: string, cols: number, rows: number, cwd: string, env: Record<string, string>,
}) => Terminal

type Watcher = { onBytes: (bytes: string) => void, onEnded: () => void }

type OpenTerminal = {
  session: LiveSession,
  terminal: Terminal,
  scrollback: string,
  watchers: Set<Watcher>,
  ended: boolean,
}

export class PtyLiveSessions extends LiveSessions {
  static readonly TERM = 'xterm-256color'
  static readonly COLUMNS = 80
  static readonly ROWS = 24
  static readonly LOGIN_INTERACTIVE = '-il'
  static readonly FALLBACK_SHELL = '/bin/sh'
  static readonly SCROLLBACK_CHARACTERS = 262_144

  readonly spawn: TerminalSpawn
  readonly newId: () => string
  readonly stderr: (line: string) => void
  readonly #open: Map<string, OpenTerminal>

  constructor({ spawn, newId, stderr }: {
    spawn: TerminalSpawn, newId: () => string, stderr: (line: string) => void,
  }) {
    super()
    this.spawn = spawn
    this.newId = newId
    this.stderr = stderr
    this.#open = new Map()
  }

  static loginShell(shell: string | undefined, cwd: string, env: NodeJS.ProcessEnv): SessionProgram {
    const file = shell ?? PtyLiveSessions.FALLBACK_SHELL

    return new SessionProgram({
      name: PtyLiveSessions.#basenameOf(file),
      file,
      argv: [PtyLiveSessions.LOGIN_INTERACTIVE],
      cwd,
      env: PtyLiveSessions.#definedEntriesOf(env),
    })
  }

  open(program: SessionProgram): LiveSession {
    const session = new LiveSession({ id: this.newId(), name: program.name })
    const terminal = this.spawn(program.file, [...program.argv], {
      name: PtyLiveSessions.TERM,
      cols: PtyLiveSessions.COLUMNS,
      rows: PtyLiveSessions.ROWS,
      cwd: program.cwd,
      env: PtyLiveSessions.#withForcedTerm(program.env),
    })
    const opened: OpenTerminal = { session, terminal, scrollback: '', watchers: new Set(), ended: false }
    this.#open.set(session.id, opened)
    terminal.onData((bytes) => this.#received(opened, bytes))
    terminal.onExit(() => this.#exited(opened, program.name))
    this.stderr(`live session ${session.id} (${program.name}) opened\n`)

    return session
  }

  all(): LiveSession[] {
    return [...this.#open.values()].map((opened) => opened.session)
  }

  find(id: string): LiveSession | null {
    return this.#open.get(id)?.session ?? null
  }

  watch({ session, onBytes, onEnded }: {
    session: LiveSession, onBytes: (bytes: string) => void, onEnded: () => void,
  }): LiveSessionStream {
    const opened = this.#terminalFor(session)
    const watcher: Watcher = { onBytes, onEnded }
    opened.watchers.add(watcher)

    return {
      printed: opened.scrollback,
      stop: () => { opened.watchers.delete(watcher) },
    }
  }

  write({ session, text }: { session: LiveSession, text: string }): void {
    const opened = this.#terminalFor(session)
    try {
      opened.terminal.write(text)
    } catch {
      throw this.#wentAway(opened)
    }
  }

  resize({ session, cols, rows }: { session: LiveSession, cols: number, rows: number }): void {
    const opened = this.#terminalFor(session)
    try {
      opened.terminal.resize(cols, rows)
    } catch {
      throw this.#wentAway(opened)
    }
  }

  #terminalFor(session: LiveSession): OpenTerminal {
    const opened = this.#open.get(session.id)
    if (opened === undefined || opened.ended) {
      throw new LiveSessionNotLive(session.id)
    }

    return opened
  }

  #wentAway(opened: OpenTerminal): LiveSessionNotLive {
    opened.ended = true

    return new LiveSessionNotLive(opened.session.id)
  }

  #received(opened: OpenTerminal, bytes: string): void {
    opened.scrollback = PtyLiveSessions.#trimmed(opened.scrollback + bytes)
    for (const watcher of opened.watchers) watcher.onBytes(bytes)
  }

  #exited(opened: OpenTerminal, program: string): void {
    this.#open.delete(opened.session.id)
    for (const watcher of opened.watchers) watcher.onEnded()
    opened.watchers.clear()
    this.stderr(`live session ${opened.session.id} (${program}) exited\n`)
  }

  static #basenameOf(file: string): string {
    const segments = file.split('/')

    return segments[segments.length - 1]
  }

  static #trimmed(scrollback: string): string {
    return scrollback.length > PtyLiveSessions.SCROLLBACK_CHARACTERS
      ? scrollback.slice(scrollback.length - PtyLiveSessions.SCROLLBACK_CHARACTERS)
      : scrollback
  }

  static #withForcedTerm(env: Readonly<Record<string, string>>): Record<string, string> {
    return { ...env, TERM: PtyLiveSessions.TERM }
  }

  static #definedEntriesOf(env: NodeJS.ProcessEnv): Record<string, string> {
    const filtered: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) filtered[key] = value
    }

    return filtered
  }
}
