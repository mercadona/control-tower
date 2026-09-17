import { execFileSync } from 'node:child_process'
import { LiveSessions, LiveSessionNotLive } from '../domain/ports/live-sessions.ts'
import { LiveSession } from '../domain/value-objects/live-session.ts'
import { SessionProgram } from '../domain/value-objects/session-program.ts'
import { ClosureStatus, SessionClosure } from '../domain/value-objects/session-closure.ts'
import { SessionNotTerminated, SessionTerminationUnconfirmed } from '../domain/exceptions.ts'
import type { LiveSessionStream } from '../domain/ports/live-sessions.ts'
import type { ConversationId } from '../domain/value-objects/conversation-id.ts'

export type Terminal = {
  readonly pid: number,
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
  rootExited: boolean,
  signalAuthority: boolean,
  groupAbsenceConfirmed: boolean,
  originalIdentities: Map<number, string>,
  termination: Promise<void> | null,
}

type SignalProcess = (pid: number, signal: NodeJS.Signals | 0) => void
type Sleep = (milliseconds: number) => Promise<void>
type InspectProcessGroup = (processGroup: number) => ReadonlyMap<number, string>

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
  readonly signal: SignalProcess
  readonly sleep: Sleep
  readonly now: () => number
  readonly termGraceMs: number
  readonly killGraceMs: number
  readonly pollMs: number
  readonly inspectProcessGroup: InspectProcessGroup
  readonly #open: Map<string, OpenTerminal>
  readonly #owned: Map<string, OpenTerminal>
  readonly #confirmed: Map<string, SessionClosure>

  constructor({ spawn, newId, stderr, signal, sleep, now, termGraceMs, killGraceMs, pollMs, inspectProcessGroup }: {
    spawn: TerminalSpawn,
    newId: () => string,
    stderr: (line: string) => void,
    signal: SignalProcess,
    sleep: Sleep,
    now: () => number,
    termGraceMs: number,
    killGraceMs: number,
    pollMs: number,
    inspectProcessGroup?: InspectProcessGroup,
  }) {
    super()
    this.spawn = spawn
    this.newId = newId
    this.stderr = stderr
    this.signal = signal
    this.sleep = sleep
    this.now = now
    this.termGraceMs = termGraceMs
    this.killGraceMs = killGraceMs
    this.pollMs = pollMs
    this.inspectProcessGroup = inspectProcessGroup ?? PtyLiveSessions.#inspectProcessGroup
    this.#open = new Map()
    this.#owned = new Map()
    this.#confirmed = new Map()
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
    if (!Number.isSafeInteger(terminal.pid) || terminal.pid <= 0) {
      throw new Error(`a terminal pid must be a positive safe integer, got ${JSON.stringify(terminal.pid)}`)
    }
    let originalIdentities = new Map<number, string>()
    try {
      originalIdentities = new Map(this.inspectProcessGroup(terminal.pid))
    } catch {
      originalIdentities = new Map()
    }
    const opened: OpenTerminal = {
      session,
      terminal,
      scrollback: '',
      watchers: new Set(),
      ended: false,
      rootExited: false,
      signalAuthority: true,
      groupAbsenceConfirmed: false,
      originalIdentities,
      termination: null,
    }
    this.#open.set(session.id, opened)
    this.#owned.set(session.id, opened)
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

  terminationEvidence({ conversation, target, session }: {
    conversation: ConversationId, target: string, session: LiveSession | null,
  }): SessionClosure {
    if (session === null) {
      return new SessionClosure({
        conversation, target, session: null, processGroup: null, status: ClosureStatus.REQUESTED,
      })
    }
    const owned = this.#owned.get(session.id)
    if (owned === undefined) {
      throw new SessionNotTerminated(`session ${session.id} has no retained process ownership`)
    }
    this.#rememberOriginalMembers(owned)

    return new SessionClosure({
      conversation,
      target,
      session: session.id,
      processGroup: owned.terminal.pid,
      status: ClosureStatus.REQUESTED,
    })
  }

  async terminate(closure: SessionClosure): Promise<void> {
    if (closure.session === null || closure.processGroup === null) return
    if (this.#isConfirmed(closure)) return
    const owned = this.#owned.get(closure.session)
    if (owned === undefined || owned.terminal.pid !== closure.processGroup) {
      throw new SessionNotTerminated(
        `session ${closure.session} process group ${closure.processGroup} is not owned by this backend`
      )
    }
    if (owned.termination !== null) return owned.termination

    const termination = Promise.resolve().then(() => this.#terminateOwned(owned, closure.processGroup!))
    owned.termination = termination
    try {
      await termination
      this.#retire(owned, closure)
    } finally {
      if (this.#owned.get(owned.session.id) === owned) owned.termination = null
    }
  }

  async confirmTermination(closure: SessionClosure): Promise<void> {
    if (closure.processGroup === null) return
    if (this.#isConfirmed(closure)) return
    const owned = closure.session === null ? undefined : this.#owned.get(closure.session)
    if (owned !== undefined && owned.terminal.pid === closure.processGroup) {
      if (owned.termination !== null) await owned.termination
      await this.#confirmOwned(owned, closure.processGroup)
      this.#retire(owned, closure)
      return
    }
    try {
      if (!this.#groupAbsent(closure.processGroup)) {
        throw new SessionTerminationUnconfirmed(
          `process group ${closure.processGroup} still exists after backend ownership was lost`
        )
      }
    } catch (cause) {
      if (cause instanceof SessionTerminationUnconfirmed) throw cause
      throw new SessionTerminationUnconfirmed(
        `process group ${closure.processGroup} could not be confirmed absent: ${String(cause)}`
      )
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
    this.#open.delete(opened.session.id)

    return new LiveSessionNotLive(opened.session.id)
  }

  #received(opened: OpenTerminal, bytes: string): void {
    try {
      this.#rememberOriginalMembers(opened)
    } catch {
    }
    opened.scrollback = PtyLiveSessions.#trimmed(opened.scrollback + bytes)
    for (const watcher of opened.watchers) watcher.onBytes(bytes)
  }

  #exited(opened: OpenTerminal, program: string): void {
    if (opened.rootExited) return
    opened.rootExited = true
    if (!opened.groupAbsenceConfirmed) {
      try {
        if (this.#groupAbsent(opened.terminal.pid)) {
          opened.groupAbsenceConfirmed = true
          opened.signalAuthority = false
        } else if (!this.#currentMembersAreOriginal(opened, opened.terminal.pid)) {
          opened.signalAuthority = false
        }
      } catch {
        opened.signalAuthority = false
      }
    }
    opened.ended = true
    this.#open.delete(opened.session.id)
    for (const watcher of opened.watchers) watcher.onEnded()
    opened.watchers.clear()
    this.stderr(`live session ${opened.session.id} (${program}) exited\n`)
  }

  async #terminateOwned(opened: OpenTerminal, processGroup: number): Promise<void> {
    if (opened.rootExited && opened.groupAbsenceConfirmed) return
    if (!opened.signalAuthority) {
      if (await this.#terminatedWithin(opened, processGroup, this.termGraceMs + this.killGraceMs)) return
      throw new SessionNotTerminated(
        `session ${opened.session.id} no longer has verified authority over process group ${processGroup}`
      )
    }
    if (!this.#refreshSignalAuthority(opened, processGroup)) {
      if (await this.#terminatedWithin(opened, processGroup, this.termGraceMs + this.killGraceMs)) return
      throw new SessionNotTerminated(
        `session ${opened.session.id} no longer has a present original process group ${processGroup}`
      )
    }
    this.#send(processGroup, 'SIGTERM')
    if (await this.#terminatedWithin(opened, processGroup, this.termGraceMs)) return

    if (opened.signalAuthority && this.#refreshSignalAuthority(opened, processGroup)) {
      this.#send(processGroup, 'SIGKILL')
    }
    if (await this.#terminatedWithin(opened, processGroup, this.killGraceMs)) return

    throw new SessionNotTerminated(
      `session ${opened.session.id} did not exit with process group ${processGroup} within ` +
      `${this.termGraceMs + this.killGraceMs}ms`
    )
  }

  async #terminatedWithin(opened: OpenTerminal, processGroup: number, budgetMs: number): Promise<boolean> {
    const deadline = this.now() + budgetMs
    while (this.now() < deadline) {
      if (this.#terminationConfirmed(opened, processGroup)) return true
      await this.sleep(Math.min(this.pollMs, deadline - this.now()))
    }

    return this.#terminationConfirmed(opened, processGroup)
  }

  #terminationConfirmed(opened: OpenTerminal, processGroup: number): boolean {
    if (!opened.groupAbsenceConfirmed) {
      try {
        if (this.#groupAbsent(processGroup)) {
          opened.groupAbsenceConfirmed = true
          opened.signalAuthority = false
        }
      } catch (cause) {
        if (!opened.signalAuthority) throw cause
      }
    }

    return opened.rootExited && opened.groupAbsenceConfirmed
  }

  async #confirmOwned(opened: OpenTerminal, processGroup: number): Promise<void> {
    try {
      if (this.#terminationConfirmed(opened, processGroup)) return
    } catch (cause) {
      throw new SessionTerminationUnconfirmed(
        `owned process group ${processGroup} could not be confirmed terminated: ${String(cause)}`
      )
    }
    throw new SessionTerminationUnconfirmed(
      `session ${opened.session.id} still lacks PTY exit and process-group absence confirmation`
    )
  }

  #retire(opened: OpenTerminal, closure: SessionClosure): void {
    opened.signalAuthority = false
    opened.groupAbsenceConfirmed = true
    this.#confirmed.set(opened.session.id, closure)
    this.#open.delete(opened.session.id)
    this.#owned.delete(opened.session.id)
  }

  #isConfirmed(closure: SessionClosure): boolean {
    if (closure.session === null) return false
    const confirmed = this.#confirmed.get(closure.session)

    return confirmed !== undefined && confirmed.conversation.text === closure.conversation.text &&
      confirmed.target === closure.target && confirmed.processGroup === closure.processGroup
  }

  #rememberOriginalMembers(opened: OpenTerminal): void {
    if (opened.rootExited || !opened.signalAuthority) return
    const processGroup = opened.terminal.pid
    const current = this.#identifiedGroup(processGroup)
    if (current.size === 0) {
      opened.groupAbsenceConfirmed = true
      opened.signalAuthority = false
      return
    }
    const rootIdentity = opened.originalIdentities.get(processGroup)
    if (rootIdentity !== undefined && current.get(processGroup) === rootIdentity) {
      for (const [pid, identity] of current) opened.originalIdentities.set(pid, identity)
      return
    }
    if (current.get(processGroup) === undefined && this.#membersMatch(opened, current)) return
    opened.signalAuthority = false
  }

  #refreshSignalAuthority(opened: OpenTerminal, processGroup: number): boolean {
    if (!opened.signalAuthority) return false
    const current = this.#identifiedGroup(processGroup)
    if (current.size === 0) {
      opened.groupAbsenceConfirmed = true
      opened.signalAuthority = false
      return false
    }
    const rootIdentity = opened.originalIdentities.get(processGroup)
    if (rootIdentity !== undefined && current.get(processGroup) === rootIdentity) {
      for (const [pid, identity] of current) opened.originalIdentities.set(pid, identity)
    }
    if (this.#membersMatch(opened, current)) return true
    opened.signalAuthority = false
    throw new SessionNotTerminated(
      `session ${opened.session.id} cannot verify the original members of process group ${processGroup}`
    )
  }

  #currentMembersAreOriginal(opened: OpenTerminal, processGroup: number): boolean {
    const current = this.#identifiedGroup(processGroup)
    if (current.size === 0) return false

    return this.#membersMatch(opened, current)
  }

  #membersMatch(opened: OpenTerminal, current: ReadonlyMap<number, string>): boolean {
    for (const [pid, identity] of current) {
      if (opened.originalIdentities.get(pid) !== identity) return false
    }

    return true
  }

  #identifiedGroup(processGroup: number): ReadonlyMap<number, string> {
    try {
      return this.inspectProcessGroup(processGroup)
    } catch (cause) {
      throw new SessionNotTerminated(
        `process group ${processGroup} identity could not be inspected: ${String(cause)}`
      )
    }
  }

  #send(processGroup: number, signal: NodeJS.Signals): void {
    try {
      this.signal(-processGroup, signal)
    } catch (cause) {
      if (PtyLiveSessions.#codeOf(cause) === 'ESRCH') return
      throw new SessionNotTerminated(
        `${signal} could not be sent to process group ${processGroup}: ${String(cause)}`
      )
    }
  }

  #groupAbsent(processGroup: number): boolean {
    try {
      this.signal(-processGroup, 0)
      return false
    } catch (cause) {
      if (PtyLiveSessions.#codeOf(cause) === 'ESRCH') return true
      throw new SessionNotTerminated(`process group ${processGroup} could not be inspected: ${String(cause)}`)
    }
  }

  static #codeOf(failure: unknown): string | undefined {
    if (!(failure instanceof Error) || !('code' in failure) || typeof failure.code !== 'string') return undefined

    return failure.code
  }

  static #inspectProcessGroup(processGroup: number): ReadonlyMap<number, string> {
    const processes = new Map<number, string>()
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,lstart='], { encoding: 'utf8' })
    for (const row of rows.split('\n')) {
      const matched = row.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
      if (matched === null || Number(matched[2]) !== processGroup) continue
      processes.set(Number(matched[1]), `${matched[1]}:${matched[3]}`)
    }

    return processes
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
