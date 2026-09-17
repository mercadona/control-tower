import { execFile } from 'node:child_process'
import { performance } from 'node:perf_hooks'
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
type SignalProcess = (pid: number, signal: NodeJS.Signals | 0) => void
type Sleep = (milliseconds: number) => Promise<void>
type InspectProcessTable = (signal: AbortSignal) => Promise<string>
type InspectionGroups = ReadonlyMap<number, ReadonlyMap<number, string>>

type OpenTerminal = {
  session: LiveSession,
  terminal: Terminal,
  scrollback: string,
  watchers: Set<Watcher>,
  ended: boolean,
  rootExited: boolean,
  signalAuthority: boolean,
  groupAbsenceConfirmed: boolean,
  rootIdentity: string | null,
  originalIdentities: Map<number, string>,
  bootstrap: Promise<void>,
  termination: Promise<void> | null,
}

type SnapshotWaiter = {
  resolve: (group: ReadonlyMap<number, string>) => void,
  reject: (cause: unknown) => void,
  timer: ReturnType<typeof setTimeout>,
}

type PendingInspection = {
  opened: OpenTerminal,
  waiters: Set<SnapshotWaiter>,
  background: boolean,
}

type StartedInspection = {
  opened: OpenTerminal,
  anchored: boolean,
  rootWasLive: boolean,
  waiters: Set<SnapshotWaiter>,
  background: boolean,
}

type ActiveInspection = {
  controller: AbortController,
  targets: StartedInspection[],
}

export class PtyLiveSessions extends LiveSessions {
  static readonly TERM = 'xterm-256color'
  static readonly COLUMNS = 80
  static readonly ROWS = 24
  static readonly LOGIN_INTERACTIVE = '-il'
  static readonly FALLBACK_SHELL = '/bin/sh'
  static readonly SCROLLBACK_CHARACTERS = 262_144
  static readonly INSPECTION_INTERVAL_MS = 100
  static readonly INSPECTION_TIMEOUT_MS = 500
  static readonly INSPECTION_REQUEST_TIMEOUT_MS = 1_500
  static readonly INSPECTION_MAX_BUFFER_BYTES = 4_194_304
  static readonly INSPECTION_PARSE_BATCH_ROWS = 256

  readonly spawn: TerminalSpawn
  readonly newId: () => string
  readonly stderr: (line: string) => void
  readonly signal: SignalProcess
  readonly sleep: Sleep
  readonly now: () => number
  readonly inspectionNow: () => number
  readonly termGraceMs: number
  readonly killGraceMs: number
  readonly pollMs: number
  readonly inspectProcessTable: InspectProcessTable
  readonly #open: Map<string, OpenTerminal>
  readonly #owned: Map<string, OpenTerminal>
  readonly #confirmed: Map<string, SessionClosure>
  readonly #pending: Map<OpenTerminal, PendingInspection>
  #active: ActiveInspection | null
  #startTimer: ReturnType<typeof setTimeout> | null
  #backgroundTimer: ReturnType<typeof setTimeout> | null
  #lastInspectionStartedAt: number

  constructor({
    spawn, newId, stderr, signal, sleep, now, inspectionNow, termGraceMs, killGraceMs, pollMs,
    inspectProcessTable,
  }: {
    spawn: TerminalSpawn,
    newId: () => string,
    stderr: (line: string) => void,
    signal: SignalProcess,
    sleep: Sleep,
    now: () => number,
    inspectionNow?: () => number,
    termGraceMs: number,
    killGraceMs: number,
    pollMs: number,
    inspectProcessTable?: InspectProcessTable,
  }) {
    super()
    this.spawn = spawn
    this.newId = newId
    this.stderr = stderr
    this.signal = signal
    this.sleep = sleep
    this.now = now
    this.inspectionNow = inspectionNow ?? performance.now.bind(performance)
    this.termGraceMs = termGraceMs
    this.killGraceMs = killGraceMs
    this.pollMs = pollMs
    this.inspectProcessTable = inspectProcessTable ?? PtyLiveSessions.#inspectProcessTable
    this.#open = new Map()
    this.#owned = new Map()
    this.#confirmed = new Map()
    this.#pending = new Map()
    this.#active = null
    this.#startTimer = null
    this.#backgroundTimer = null
    this.#lastInspectionStartedAt = Number.NEGATIVE_INFINITY
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
    const opened: OpenTerminal = {
      session,
      terminal,
      scrollback: '',
      watchers: new Set(),
      ended: false,
      rootExited: false,
      signalAuthority: true,
      groupAbsenceConfirmed: false,
      rootIdentity: null,
      originalIdentities: new Map(),
      bootstrap: Promise.resolve(),
      termination: null,
    }
    this.#open.set(session.id, opened)
    this.#owned.set(session.id, opened)
    terminal.onData((bytes) => this.#received(opened, bytes))
    terminal.onExit(() => this.#exited(opened, program.name))
    opened.bootstrap = this.#requestSnapshot(opened).then((group) => {
      this.#applyBootstrap(opened, group)
    })
    opened.bootstrap.catch(() => {})
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
    if (opened === undefined || opened.ended) throw new LiveSessionNotLive(session.id)

    return opened
  }

  #wentAway(opened: OpenTerminal): LiveSessionNotLive {
    opened.ended = true
    this.#open.delete(opened.session.id)

    return new LiveSessionNotLive(opened.session.id)
  }

  #received(opened: OpenTerminal, bytes: string): void {
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
        }
      } catch {
        opened.signalAuthority = false
      }
    }
    opened.ended = true
    this.#open.delete(opened.session.id)
    for (const watcher of opened.watchers) watcher.onEnded()
    opened.watchers.clear()
    this.#cancelUnanchoredBootstrap(opened)
    this.#removeBackgroundInterest(opened)
    this.stderr(`live session ${opened.session.id} (${program}) exited\n`)
  }

  async #terminateOwned(opened: OpenTerminal, processGroup: number): Promise<void> {
    if (opened.rootExited && opened.groupAbsenceConfirmed) return
    await opened.bootstrap.catch(() => {})
    if (opened.rootIdentity === null && !opened.rootExited && !opened.groupAbsenceConfirmed) {
      const bootstrap = await this.#freshSnapshot(opened, processGroup)
      this.#applyBootstrap(opened, bootstrap)
    }
    if (opened.rootIdentity === null) {
      if (opened.rootExited && opened.groupAbsenceConfirmed) return
      throw new SessionNotTerminated(
        `session ${opened.session.id} has no established root identity for process group ${processGroup}`
      )
    }
    if (!opened.signalAuthority) {
      if (await this.#terminatedWithin(opened, processGroup, this.termGraceMs + this.killGraceMs)) return
      throw new SessionNotTerminated(
        `session ${opened.session.id} no longer has verified authority over process group ${processGroup}`
      )
    }

    const beforeTerm = await this.#freshSnapshot(opened, processGroup)
    if (!this.#applyFreshSnapshot(opened, beforeTerm)) {
      if (await this.#terminatedWithin(opened, processGroup, this.termGraceMs + this.killGraceMs)) return
      throw new SessionNotTerminated(
        `session ${opened.session.id} no longer has a present original process group ${processGroup}`
      )
    }
    if (this.#owned.get(opened.session.id) !== opened || !opened.signalAuthority || opened.groupAbsenceConfirmed) {
      throw new SessionNotTerminated(`session ${opened.session.id} lost signal authority before SIGTERM`)
    }
    this.#send(processGroup, 'SIGTERM')
    if (await this.#terminatedWithin(opened, processGroup, this.termGraceMs)) return

    const beforeKill = await this.#freshSnapshot(opened, processGroup)
    if (this.#applyFreshSnapshot(opened, beforeKill) &&
      this.#owned.get(opened.session.id) === opened && opened.signalAuthority && !opened.groupAbsenceConfirmed) {
      this.#send(processGroup, 'SIGKILL')
    }
    if (await this.#terminatedWithin(opened, processGroup, this.killGraceMs)) return

    throw new SessionNotTerminated(
      `session ${opened.session.id} did not exit with process group ${processGroup} within ` +
      `${this.termGraceMs + this.killGraceMs}ms`
    )
  }

  async #freshSnapshot(opened: OpenTerminal, processGroup: number): Promise<ReadonlyMap<number, string>> {
    try {
      return await this.#requestSnapshot(opened)
    } catch (cause) {
      throw new SessionNotTerminated(
        `process group ${processGroup} identity could not be inspected: ${String(cause)}`
      )
    }
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
          this.#removeBackgroundInterest(opened)
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
    this.#cancelInterest(opened)
  }

  #isConfirmed(closure: SessionClosure): boolean {
    if (closure.session === null) return false
    const confirmed = this.#confirmed.get(closure.session)

    return confirmed !== undefined && confirmed.conversation.text === closure.conversation.text &&
      confirmed.target === closure.target && confirmed.processGroup === closure.processGroup
  }

  #applyBootstrap(opened: OpenTerminal, group: ReadonlyMap<number, string>): void {
    if (this.#owned.get(opened.session.id) !== opened || opened.rootExited ||
      opened.groupAbsenceConfirmed || !opened.signalAuthority || opened.rootIdentity !== null) return
    const rootIdentity = group.get(opened.terminal.pid)
    if (rootIdentity === undefined) return
    opened.rootIdentity = rootIdentity
    opened.originalIdentities = new Map(group)
  }

  #applyObservation(target: StartedInspection, group: ReadonlyMap<number, string>): void {
    const opened = target.opened
    if (this.#owned.get(opened.session.id) !== opened || opened.groupAbsenceConfirmed || !opened.signalAuthority) return
    if (!target.anchored) {
      this.#applyBootstrap(opened, group)
      return
    }
    if (group.size === 0) {
      try {
        if (this.#groupAbsent(opened.terminal.pid)) {
          opened.groupAbsenceConfirmed = true
          opened.signalAuthority = false
          this.#removeBackgroundInterest(opened)
        }
      } catch {
      }
      return
    }
    const rootIdentity = opened.rootIdentity
    const currentRoot = group.get(opened.terminal.pid)
    if (rootIdentity !== null && currentRoot === rootIdentity && target.rootWasLive) {
      if (!this.#learnMembers(opened, group)) opened.signalAuthority = false
      return
    }
    if (currentRoot !== undefined || !this.#membersMatch(opened, group)) opened.signalAuthority = false
  }

  #applyFreshSnapshot(opened: OpenTerminal, group: ReadonlyMap<number, string>): boolean {
    if (this.#owned.get(opened.session.id) !== opened || !opened.signalAuthority || opened.groupAbsenceConfirmed) {
      return false
    }
    if (group.size === 0) {
      if (this.#groupAbsent(opened.terminal.pid)) {
        opened.groupAbsenceConfirmed = true
        opened.signalAuthority = false
        this.#removeBackgroundInterest(opened)
        return false
      }
      throw new SessionNotTerminated(
        `process group ${opened.terminal.pid} is absent from the process table but still exists`
      )
    }
    const currentRoot = group.get(opened.terminal.pid)
    if (currentRoot === opened.rootIdentity && !opened.rootExited) {
      if (!this.#learnMembers(opened, group)) {
        opened.signalAuthority = false
        throw new SessionNotTerminated(
          `session ${opened.session.id} cannot verify the original members of process group ${opened.terminal.pid}`
        )
      }
    }
    if (this.#membersMatch(opened, group)) return true
    opened.signalAuthority = false
    throw new SessionNotTerminated(
      `session ${opened.session.id} cannot verify the original members of process group ${opened.terminal.pid}`
    )
  }

  #membersMatch(opened: OpenTerminal, current: ReadonlyMap<number, string>): boolean {
    for (const [pid, identity] of current) {
      if (opened.originalIdentities.get(pid) !== identity) return false
    }

    return true
  }

  #learnMembers(opened: OpenTerminal, current: ReadonlyMap<number, string>): boolean {
    for (const [pid, identity] of current) {
      const original = opened.originalIdentities.get(pid)
      if (original !== undefined && original !== identity) return false
    }
    for (const [pid, identity] of current) {
      if (!opened.originalIdentities.has(pid)) opened.originalIdentities.set(pid, identity)
    }

    return true
  }

  #requestSnapshot(opened: OpenTerminal): Promise<ReadonlyMap<number, string>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.#pending.get(opened)
        if (pending !== undefined) {
          for (const waiter of pending.waiters) {
            if (waiter.resolve === resolve) pending.waiters.delete(waiter)
          }
          if (pending.waiters.size === 0 && !pending.background) this.#pending.delete(opened)
          this.#clearUnusedStartTimer()
        }
        const active = this.#active?.targets.find((target) => target.opened === opened)
        if (active !== undefined) {
          for (const waiter of active.waiters) {
            if (waiter.resolve === resolve) active.waiters.delete(waiter)
          }
        }
        reject(new Error(`process-table inspection exceeded ${PtyLiveSessions.INSPECTION_REQUEST_TIMEOUT_MS}ms`))
        this.#abortUnusedInspection()
      }, PtyLiveSessions.INSPECTION_REQUEST_TIMEOUT_MS)
      timer.unref?.()
      const waiter: SnapshotWaiter = { resolve, reject, timer }
      const pending = this.#pending.get(opened)
      if (pending === undefined) {
        this.#pending.set(opened, { opened, waiters: new Set([waiter]), background: false })
      } else {
        pending.waiters.add(waiter)
      }
      this.#scheduleInspection()
    })
  }

  #queueBackgroundInspections(): void {
    this.#backgroundTimer = null
    for (const opened of this.#owned.values()) {
      if (opened.rootExited || opened.groupAbsenceConfirmed || !opened.signalAuthority) continue
      const pending = this.#pending.get(opened)
      if (pending === undefined) {
        this.#pending.set(opened, { opened, waiters: new Set(), background: true })
      } else {
        pending.background = true
      }
    }
    this.#scheduleInspection()
  }

  #scheduleInspection(): void {
    if (this.#active !== null || this.#startTimer !== null || this.#pending.size === 0) return
    const delay = Math.max(
      0,
      PtyLiveSessions.INSPECTION_INTERVAL_MS - (this.inspectionNow() - this.#lastInspectionStartedAt)
    )
    this.#startTimer = setTimeout(() => {
      this.#startTimer = null
      this.#startInspection()
    }, delay)
    this.#startTimer.unref?.()
  }

  #startInspection(): void {
    if (this.#active !== null || this.#pending.size === 0) return
    const targets = [...this.#pending.values()].map((target): StartedInspection => ({
      opened: target.opened,
      anchored: target.opened.rootIdentity !== null,
      rootWasLive: !target.opened.rootExited,
      waiters: target.waiters,
      background: target.background,
    }))
    this.#pending.clear()
    const controller = new AbortController()
    const active: ActiveInspection = { controller, targets }
    this.#active = active
    this.#lastInspectionStartedAt = this.inspectionNow()
    const executionTimer = setTimeout(() => controller.abort(), PtyLiveSessions.INSPECTION_TIMEOUT_MS)
    executionTimer.unref?.()
    Promise.resolve()
      .then(() => this.inspectProcessTable(controller.signal))
      .then((stdout) => PtyLiveSessions.#parseProcessTable(stdout, controller.signal))
      .then((groups) => this.#inspectionSucceeded(active, groups))
      .catch((cause) => this.#inspectionFailed(active, cause))
      .finally(() => {
        clearTimeout(executionTimer)
        if (this.#active !== active) return
        this.#active = null
        this.#scheduleBackgroundInspection()
        this.#scheduleInspection()
      })
  }

  #inspectionSucceeded(active: ActiveInspection, groups: InspectionGroups): void {
    if (active.controller.signal.aborted) {
      this.#inspectionFailed(active, new Error('process-table inspection was aborted'))
      return
    }
    for (const target of active.targets) {
      const group = groups.get(target.opened.terminal.pid) ?? new Map<number, string>()
      try {
        this.#applyObservation(target, group)
      } catch {
      }
      for (const waiter of target.waiters) {
        clearTimeout(waiter.timer)
        waiter.resolve(new Map(group))
      }
      target.waiters.clear()
    }
  }

  #inspectionFailed(active: ActiveInspection, cause: unknown): void {
    for (const target of active.targets) {
      for (const waiter of target.waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(cause)
      }
      target.waiters.clear()
    }
  }

  #scheduleBackgroundInspection(): void {
    if (this.#backgroundTimer !== null || !this.#hasEligibleRoots()) return
    this.#backgroundTimer = setTimeout(
      () => this.#queueBackgroundInspections(),
      PtyLiveSessions.INSPECTION_INTERVAL_MS
    )
    this.#backgroundTimer.unref?.()
  }

  #hasEligibleRoots(): boolean {
    for (const opened of this.#owned.values()) {
      if (!opened.rootExited && !opened.groupAbsenceConfirmed && opened.signalAuthority) return true
    }

    return false
  }

  #removeBackgroundInterest(opened: OpenTerminal): void {
    const pending = this.#pending.get(opened)
    if (pending !== undefined) {
      pending.background = false
      if (pending.waiters.size === 0) this.#pending.delete(opened)
    }
    this.#clearUnusedStartTimer()
    if (!this.#hasEligibleRoots() && this.#backgroundTimer !== null) {
      clearTimeout(this.#backgroundTimer)
      this.#backgroundTimer = null
    }
    this.#abortUnusedInspection()
  }

  #cancelUnanchoredBootstrap(opened: OpenTerminal): void {
    if (opened.rootIdentity !== null) return
    const cause = new Error(`session ${opened.session.id} exited before process ownership was established`)
    const pending = this.#pending.get(opened)
    if (pending !== undefined) {
      this.#pending.delete(opened)
      for (const waiter of pending.waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(cause)
      }
      this.#clearUnusedStartTimer()
    }
    const active = this.#active?.targets.find((target) => target.opened === opened && !target.anchored)
    if (active !== undefined) {
      for (const waiter of active.waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(cause)
      }
      active.waiters.clear()
      active.background = false
    }
  }

  #cancelInterest(opened: OpenTerminal): void {
    const pending = this.#pending.get(opened)
    if (pending !== undefined) {
      this.#pending.delete(opened)
      for (const waiter of pending.waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error(`session ${opened.session.id} was retired during process-table inspection`))
      }
      this.#clearUnusedStartTimer()
    }
    const active = this.#active?.targets.find((target) => target.opened === opened)
    if (active !== undefined) {
      for (const waiter of active.waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error(`session ${opened.session.id} was retired during process-table inspection`))
      }
      active.waiters.clear()
      active.background = false
    }
    this.#removeBackgroundInterest(opened)
  }

  #clearUnusedStartTimer(): void {
    if (this.#pending.size !== 0 || this.#startTimer === null) return
    clearTimeout(this.#startTimer)
    this.#startTimer = null
  }

  #abortUnusedInspection(): void {
    const active = this.#active
    if (active === null) return
    const interested = active.targets.some((target) =>
      target.waiters.size > 0 || (target.background && this.#owned.get(target.opened.session.id) === target.opened)
    )
    if (!interested) active.controller.abort()
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

  static #inspectProcessTable(signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      let callbackSettled = false
      let childClosed = false
      let failure: Error | null = null
      let stdout = ''
      const settle = (): void => {
        if (!callbackSettled || !childClosed) return
        if (failure !== null) reject(failure)
        else resolve(stdout)
      }
      let child
      try {
        child = execFile('/bin/ps', ['-axo', 'pid=,pgid=,lstart='], {
          encoding: 'utf8',
          timeout: PtyLiveSessions.INSPECTION_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          maxBuffer: PtyLiveSessions.INSPECTION_MAX_BUFFER_BYTES,
          env: { ...process.env, LC_ALL: 'C' },
          signal,
        }, (error, output) => {
          failure = error
          stdout = output
          callbackSettled = true
          settle()
        })
      } catch (cause) {
        reject(cause)
        return
      }
      child.once('close', () => {
        childClosed = true
        settle()
      })
    })
  }

  static async #parseProcessTable(stdout: string, signal: AbortSignal): Promise<InspectionGroups> {
    if (stdout.length === 0) throw new Error('process table was empty')
    const groups = new Map<number, Map<number, string>>()
    const seen = new Set<number>()
    const rows = stdout.split('\n')
    const startPattern = '(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([ 0-3]?\\d) ([0-2]\\d:[0-5]\\d:[0-5]\\d) (\\d{4})'
    const rowPattern = new RegExp(`^\\s*(\\d+)\\s+(\\d+)\\s+(${startPattern})\\s*$`)
    let parsed = 0
    for (const row of rows) {
      if (row.trim().length === 0) continue
      const matched = row.match(rowPattern)
      if (matched === null) throw new Error(`malformed process-table row: ${JSON.stringify(row)}`)
      const pid = Number(matched[1])
      const processGroup = Number(matched[2])
      if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(processGroup) || processGroup < 0) {
        throw new Error(`invalid process-table identity: ${JSON.stringify(row)}`)
      }
      if (seen.has(pid)) throw new Error(`duplicate process-table pid: ${pid}`)
      seen.add(pid)
      const normalizedStart = matched[3].replace(/\s+/g, ' ')
      const group = groups.get(processGroup) ?? new Map<number, string>()
      group.set(pid, `${pid}:${normalizedStart}`)
      groups.set(processGroup, group)
      parsed += 1
      if (parsed % PtyLiveSessions.INSPECTION_PARSE_BATCH_ROWS === 0) {
        if (signal.aborted) throw new Error('process-table parsing was aborted')
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    if (parsed === 0) throw new Error('process table contained no process rows')
    if (signal.aborted) throw new Error('process-table parsing was aborted')

    return groups
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
