import { LiveSessions } from '../domain/ports/live-sessions.ts'
import { LiveSession } from '../domain/value-objects/live-session.ts'
import type { LiveSessionStream } from '../domain/ports/live-sessions.ts'

export type Terminal = {
  onData(listener: (bytes: string) => void): void,
  onExit(listener: () => void): void,
  write(text: string): void,
}

export type TerminalSpawn = (file: string, argv: string[], options: {
  name: string, cols: number, rows: number, cwd: string, env: Record<string, string>,
}) => Terminal

type OpenTerminal = {
  session: LiveSession,
  terminal: Terminal,
  scrollback: string,
  watchers: Set<(bytes: string) => void>,
}

export class PtyLiveSessions extends LiveSessions {
  static readonly TERM = 'xterm-256color'
  static readonly COLUMNS = 80
  static readonly ROWS = 24
  static readonly LOGIN_INTERACTIVE = '-il'
  static readonly FALLBACK_SHELL = '/bin/sh'
  static readonly SCROLLBACK_CHARACTERS = 262_144

  readonly spawn: TerminalSpawn
  readonly shell: string | undefined
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly newId: () => string
  readonly stderr: (line: string) => void
  readonly #open: Map<string, OpenTerminal>

  constructor({ spawn, shell, cwd, env, newId, stderr }: {
    spawn: TerminalSpawn, shell: string | undefined, cwd: string, env: NodeJS.ProcessEnv,
    newId: () => string, stderr: (line: string) => void,
  }) {
    super()
    this.spawn = spawn
    this.shell = shell
    this.cwd = cwd
    this.env = env
    this.newId = newId
    this.stderr = stderr
    this.#open = new Map()
  }

  open(): LiveSession {
    const file = this.shell ?? PtyLiveSessions.FALLBACK_SHELL
    const program = PtyLiveSessions.#basenameOf(file)
    const session = new LiveSession({ id: this.newId(), name: program })
    const terminal = this.spawn(file, [PtyLiveSessions.LOGIN_INTERACTIVE], {
      name: PtyLiveSessions.TERM,
      cols: PtyLiveSessions.COLUMNS,
      rows: PtyLiveSessions.ROWS,
      cwd: this.cwd,
      env: PtyLiveSessions.#environmentOf(this.env),
    })
    const opened: OpenTerminal = { session, terminal, scrollback: '', watchers: new Set() }
    this.#open.set(session.id, opened)
    terminal.onData((bytes) => this.#received(opened, bytes))
    terminal.onExit(() => this.#exited(session, program))
    this.stderr(`live session ${session.id} (${program}) opened\n`)

    return session
  }

  all(): LiveSession[] {
    return [...this.#open.values()].map((opened) => opened.session)
  }

  find(id: string): LiveSession | null {
    return this.#open.get(id)?.session ?? null
  }

  watch({ session, onBytes }: { session: LiveSession, onBytes: (bytes: string) => void }): LiveSessionStream {
    const opened = this.#terminalFor(session)
    opened.watchers.add(onBytes)

    return {
      printed: opened.scrollback,
      stop: () => { opened.watchers.delete(onBytes) },
    }
  }

  write({ session, text }: { session: LiveSession, text: string }): void {
    this.#terminalFor(session).terminal.write(text)
  }

  #terminalFor(session: LiveSession): OpenTerminal {
    const opened = this.#open.get(session.id)
    if (opened === undefined) {
      throw new Error(`PtyLiveSessions holds no live terminal for session ${session.id}`)
    }

    return opened
  }

  #received(opened: OpenTerminal, bytes: string): void {
    opened.scrollback = PtyLiveSessions.#trimmed(opened.scrollback + bytes)
    for (const onBytes of opened.watchers) onBytes(bytes)
  }

  #exited(session: LiveSession, program: string): void {
    this.#open.delete(session.id)
    this.stderr(`live session ${session.id} (${program}) exited\n`)
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

  static #environmentOf(env: NodeJS.ProcessEnv): Record<string, string> {
    const filtered: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) filtered[key] = value
    }
    filtered.TERM = PtyLiveSessions.TERM

    return filtered
  }
}
