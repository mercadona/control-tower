import { performance } from 'node:perf_hooks'
import { LiveSessions, LiveSessionNotLive } from '../domain/ports/live-sessions.ts'
import { LiveSession } from '../domain/value-objects/live-session.ts'
import { SessionProgram } from '../domain/value-objects/session-program.ts'
import { ClosureStatus, SessionClosure } from '../domain/value-objects/session-closure.ts'
import { SessionProcessOwnership } from '../domain/value-objects/session-process-ownership.ts'
import {
  SessionNotTerminated,
  SessionOwnershipUnverifiable,
  SessionTerminationPermissionDenied,
  SessionTerminationUnconfirmed,
} from '../domain/exceptions.ts'
import type { LiveSessionStream } from '../domain/ports/live-sessions.ts'
import type { ConversationId } from '../domain/value-objects/conversation-id.ts'
import type { ProcessTable, Terminal, TerminalSpawn } from './process-table.ts'

type Watcher = { onBytes: (bytes: string) => void, onEnded: () => void }
type Sleep = (milliseconds: number) => Promise<void>
type InspectionGroups = ReadonlyMap<number, ReadonlyMap<number, string>>

type OwnershipContext = {
  readonly key: string,
  readonly sessionId: string,
  readonly processGroup: number,
  readonly retained: boolean,
  terminal: Terminal | null,
  scrollback: string,
  watchers: Set<Watcher>,
  ended: boolean,
  rootExited: boolean,
  originalGroupGone: boolean,
  rootIdentity: string | null,
  originalIdentities: Map<number, string>,
  bootstrap: Promise<void>,
  termination: Promise<void> | null,
  closureIdentity: string | null,
}

type OpenTerminal = OwnershipContext & { readonly session: LiveSession, readonly terminal: Terminal }
type ProcessSnapshot = {
  readonly group: ReadonlyMap<number, string>,
  readonly leaderIdentity: string | null,
  readonly leaderProcessGroup: number | null,
}

type SnapshotWaiter = {
  resolve: (snapshot: ProcessSnapshot) => void,
  reject: (cause: unknown) => void,
  timer: ReturnType<typeof setTimeout>,
}

type PendingInspection = {
  opened: OwnershipContext,
  waiters: Set<SnapshotWaiter>,
  background: boolean,
}

type StartedInspection = {
  opened: OwnershipContext,
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
  static readonly PASTE_START = '\x1b[200~'
  static readonly PASTE_END = '\x1b[201~'
  static readonly SUBMIT = '\r'
  static readonly SUBMIT_DELAY_MS = 10

  readonly spawn: TerminalSpawn
  readonly newId: () => string
  readonly stderr: (line: string) => void
  readonly signal: ProcessTable['signal']
  readonly sleep: Sleep
  readonly now: () => number
  readonly inspectionNow: () => number
  readonly termGraceMs: number
  readonly killGraceMs: number
  readonly pollMs: number
  readonly inspectProcessTable: ProcessTable['readTable']
  readonly #open: Map<string, OpenTerminal>
  readonly #owned: Map<string, OpenTerminal>
  readonly #confirmed: Map<string, SessionClosure>
  readonly #recovered: Map<string, OwnershipContext>
  readonly #pending: Map<OwnershipContext, PendingInspection>
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
    signal: ProcessTable['signal'],
    sleep: Sleep,
    now: () => number,
    inspectionNow?: () => number,
    termGraceMs: number,
    killGraceMs: number,
    pollMs: number,
    inspectProcessTable: ProcessTable['readTable'],
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
    this.inspectProcessTable = inspectProcessTable
    this.#open = new Map()
    this.#owned = new Map()
    this.#confirmed = new Map()
    this.#recovered = new Map()
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
      key: session.id,
      sessionId: session.id,
      processGroup: terminal.pid,
      retained: true,
      session,
      terminal,
      scrollback: '',
      watchers: new Set(),
      ended: false,
      rootExited: false,
      originalGroupGone: false,
      rootIdentity: null,
      originalIdentities: new Map(),
      bootstrap: Promise.resolve(),
      termination: null,
      closureIdentity: null,
    }
    this.#open.set(session.id, opened)
    this.#owned.set(session.id, opened)
    terminal.onData((bytes) => this.#received(opened, bytes))
    terminal.onExit(() => this.#exited(opened, program.name))
    opened.bootstrap = this.#requestSnapshot(opened).then((snapshot) => {
      this.#applyBootstrap(opened, snapshot.group)
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

  submit({ session, text }: { session: LiveSession, text: string }): Promise<void> {
    this.write({ session, text: `${PtyLiveSessions.PASTE_START}${text}${PtyLiveSessions.PASTE_END}` })

    return this.sleep(PtyLiveSessions.SUBMIT_DELAY_MS)
      .then(() => this.write({ session, text: PtyLiveSessions.SUBMIT }))
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

    const closure = new SessionClosure({
      conversation,
      target,
      session: session.id,
      processGroup: owned.terminal.pid,
      status: ClosureStatus.REQUESTED,
      ownership: this.#ownershipOf(owned),
    })
    this.#bind(owned, closure)
    return closure
  }

  async prepareTermination(closure: SessionClosure): Promise<SessionClosure> {
    if (closure.session === null || closure.processGroup === null) return closure
    const owned = this.#owned.get(closure.session)
    if (owned === undefined) return closure
    this.#requireMatchingContext(owned, closure)
    await owned.bootstrap.catch(() => {})
    if (owned.rootIdentity === null && !owned.rootExited && !owned.originalGroupGone) {
      const bootstrap = await this.#freshSnapshot(owned, closure.processGroup)
      this.#applyBootstrap(owned, bootstrap.group)
    }
    if (owned.rootIdentity !== null && !owned.originalGroupGone) {
      const snapshot = await this.#freshSnapshot(owned, closure.processGroup)
      this.#applyPreparation(owned, snapshot)
    }
    const ownership = this.#ownershipOf(owned)
    return ownership === null ? closure : closure.withOwnership(ownership)
  }

  async terminate(closure: SessionClosure): Promise<void> {
    if (closure.session === null || closure.processGroup === null) return
    if (this.#isConfirmed(closure)) return
    const owned = this.#contextFor(closure)
    if (owned.termination !== null) return owned.termination

    const termination = Promise.resolve().then(() => this.#terminateOwned(owned, closure))
    owned.termination = termination
    try {
      await termination
      this.#retire(owned, closure)
    } finally {
      if (this.#isCurrent(owned)) owned.termination = null
    }
  }

  async confirmTermination(closure: SessionClosure): Promise<void> {
    if (closure.processGroup === null) return
    if (this.#isConfirmed(closure)) return
    const owned = closure.session === null ? undefined : this.#matchingContext(closure)
    if (owned !== undefined) {
      if (owned.termination !== null) await owned.termination
      await this.#confirmOwned(owned, closure)
      this.#retire(owned, closure)
      return
    }
    const context = this.#recoveryContext(closure)
    await this.#confirmOwned(context, closure)
    this.#retire(context, closure)
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
    if (!opened.originalGroupGone) {
      try {
        if (this.#groupAbsent(opened.terminal.pid)) {
          opened.originalGroupGone = true
        }
      } catch {
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

  async #terminateOwned(opened: OwnershipContext, closure: SessionClosure): Promise<void> {
    const processGroup = closure.processGroup!
    this.#requireMatchingContext(opened, closure)
    if (opened.originalGroupGone) {
      if (!opened.retained || opened.rootExited) return
      this.#refuseUnverified(opened, closure, 'unverifiable until the retained PTY exit is observed')
    }
    const beforeTerm = await this.#freshSnapshot(opened, processGroup)
    const termDecision = this.#signalDecision(opened, closure, beforeTerm)
    if (termDecision === 'gone') return
    if (termDecision !== 'verified') this.#refuseUnverified(opened, closure, termDecision)
    if (!this.#isCurrent(opened) || opened.originalGroupGone) {
      throw new SessionNotTerminated(`session ${opened.sessionId} lost ownership before SIGTERM`)
    }
    this.#send(closure, 'SIGTERM')
    if (await this.#terminatedWithin(opened, closure, this.termGraceMs)) return

    const beforeKill = await this.#freshSnapshot(opened, processGroup)
    const killDecision = this.#signalDecision(opened, closure, beforeKill)
    if (killDecision === 'gone') return
    if (killDecision !== 'verified') this.#refuseUnverified(opened, closure, killDecision)
    if (!this.#isCurrent(opened) || opened.originalGroupGone) {
      throw new SessionNotTerminated(`session ${opened.sessionId} lost ownership before SIGKILL`)
    }
    this.#send(closure, 'SIGKILL')
    if (await this.#terminatedWithin(opened, closure, this.killGraceMs)) return

    throw new SessionNotTerminated(
      `session ${opened.sessionId} did not exit with process group ${processGroup} within ` +
      `${this.termGraceMs + this.killGraceMs}ms`
    )
  }

  async #freshSnapshot(opened: OwnershipContext, processGroup: number): Promise<ProcessSnapshot> {
    try {
      return await this.#requestSnapshot(opened)
    } catch (cause) {
      throw new SessionNotTerminated(
        `process group ${processGroup} identity could not be inspected: ${String(cause)}`
      )
    }
  }

  async #terminatedWithin(opened: OwnershipContext, closure: SessionClosure, budgetMs: number): Promise<boolean> {
    const processGroup = closure.processGroup!
    const deadline = this.now() + budgetMs
    let probeFailure: unknown = null
    while (this.now() < deadline) {
      try {
        if (this.#terminationConfirmed(opened, processGroup)) return true
        probeFailure = null
      } catch (cause) {
        probeFailure = cause
      }
      await this.sleep(Math.min(this.pollMs, deadline - this.now()))
    }

    try {
      return this.#terminationConfirmed(opened, processGroup)
    } catch (cause) {
      this.#throwProbeFailure(closure, probeFailure ?? cause)
    }
  }

  #terminationConfirmed(opened: OwnershipContext, processGroup: number): boolean {
    if (!opened.originalGroupGone) {
      try {
        if (this.#groupAbsent(processGroup)) {
          opened.originalGroupGone = true
          this.#removeBackgroundInterest(opened)
        }
      } catch (cause) {
        throw cause
      }
    }

    return opened.originalGroupGone && (!opened.retained || opened.rootExited)
  }

  async #confirmOwned(opened: OwnershipContext, closure: SessionClosure): Promise<void> {
    const processGroup = closure.processGroup!
    let probeFailure: unknown = null
    try {
      if (this.#terminationConfirmed(opened, processGroup)) return
    } catch (cause) {
      probeFailure = cause
    }
    if (closure.ownership !== null) {
      let snapshot: ProcessSnapshot
      try {
        snapshot = await this.#freshSnapshot(opened, processGroup)
      } catch (cause) {
        if (probeFailure !== null) this.#throwProbeFailure(closure, probeFailure)
        throw new SessionTerminationUnconfirmed(
          `target ${closure.target} session ${closure.session} owned process group ${processGroup} ` +
          `could not be confirmed terminated: ${String(cause)}`
        )
      }
      if (this.#leaderReplaced(opened, snapshot)) {
        opened.originalGroupGone = true
        this.#endRetained(opened)
        return
      }
    }
    if (probeFailure !== null) this.#throwProbeFailure(closure, probeFailure)
    if (closure.ownership === null) {
      throw new SessionOwnershipUnverifiable(
        `target ${closure.target} session ${closure.session} process group ${processGroup} has no durable original identity; ` +
        'automatic termination is unavailable until absence can be verified'
      )
    }
    throw new SessionTerminationUnconfirmed(
      `target ${closure.target} session ${opened.sessionId} process group ${processGroup} ` +
      'still lacks process-group extinction confirmation'
    )
  }

  #retire(opened: OwnershipContext, closure: SessionClosure): void {
    opened.originalGroupGone = true
    this.#confirmed.set(PtyLiveSessions.#closureIdentity(closure), closure)
    this.#endRetained(opened)
    this.#owned.delete(opened.sessionId)
    this.#recovered.delete(opened.key)
    this.#cancelInterest(opened)
  }

  #isConfirmed(closure: SessionClosure): boolean {
    const confirmed = this.#confirmed.get(PtyLiveSessions.#closureIdentity(closure))
    if (confirmed === undefined) return false
    this.#requireExactCheckpoint(confirmed, closure, 'confirmed closure')
    return true
  }

  #applyBootstrap(opened: OwnershipContext, group: ReadonlyMap<number, string>): void {
    if (!opened.retained || !this.#isCurrent(opened) || opened.rootExited ||
      opened.originalGroupGone || opened.rootIdentity !== null) return
    const rootIdentity = group.get(opened.processGroup)
    if (rootIdentity === undefined) return
    opened.rootIdentity = rootIdentity
    opened.originalIdentities = new Map(group)
  }

  #applyObservation(target: StartedInspection, snapshot: ProcessSnapshot): void {
    const opened = target.opened
    if (!this.#isCurrent(opened) || opened.originalGroupGone || !opened.retained) return
    const group = snapshot.group
    if (!target.anchored) {
      this.#applyBootstrap(opened, group)
      return
    }
    if (this.#leaderReplaced(opened, snapshot)) {
      opened.originalGroupGone = true
      this.#endRetained(opened)
      this.#removeBackgroundInterest(opened)
      return
    }
    if (group.size === 0) {
      try {
        if (this.#groupAbsent(opened.processGroup)) {
          opened.originalGroupGone = true
          this.#removeBackgroundInterest(opened)
        }
      } catch {
      }
      return
    }
    const rootIdentity = opened.rootIdentity
    const currentRoot = group.get(opened.processGroup)
    if (rootIdentity !== null && currentRoot === rootIdentity && target.rootWasLive) {
      this.#learnMembers(opened, group)
      return
    }
  }

  #membersMatch(opened: OwnershipContext, current: ReadonlyMap<number, string>): boolean {
    for (const [pid, identity] of current) {
      if (opened.originalIdentities.get(pid) !== identity) return false
    }

    return true
  }

  #learnMembers(opened: OwnershipContext, current: ReadonlyMap<number, string>): boolean {
    for (const [pid, identity] of current) {
      const original = opened.originalIdentities.get(pid)
      if (original !== undefined && original !== identity) return false
    }
    for (const [pid, identity] of current) {
      if (!opened.originalIdentities.has(pid)) opened.originalIdentities.set(pid, identity)
    }

    return true
  }

  #applyPreparation(opened: OwnershipContext, snapshot: ProcessSnapshot): void {
    if (!opened.retained || !this.#isCurrent(opened) || opened.originalGroupGone) return
    if (this.#leaderReplaced(opened, snapshot)) {
      opened.originalGroupGone = true
      this.#endRetained(opened)
      return
    }
    if (!opened.rootExited && snapshot.group.get(opened.processGroup) === opened.rootIdentity) {
      this.#learnMembers(opened, snapshot.group)
    }
  }

  #signalDecision(
    opened: OwnershipContext,
    closure: SessionClosure,
    snapshot: ProcessSnapshot,
  ): 'verified' | 'gone' | 'unverifiable' {
    if (!this.#isCurrent(opened)) return 'gone'
    if (opened.originalGroupGone) return !opened.retained || opened.rootExited ? 'gone' : 'unverifiable'
    if (this.#leaderReplaced(opened, snapshot)) {
      opened.originalGroupGone = true
      this.#endRetained(opened)
      return 'gone'
    }
    if (snapshot.group.size === 0) {
      let absent: boolean
      try {
        absent = this.#groupAbsent(opened.processGroup)
      } catch (cause) {
        this.#throwProbeFailure(closure, cause)
      }
      if (absent) {
        opened.originalGroupGone = true
        this.#removeBackgroundInterest(opened)
        return !opened.retained || opened.rootExited ? 'gone' : 'unverifiable'
      }
      return 'unverifiable'
    }
    if (opened.rootIdentity === null || closure.ownership === null) return 'unverifiable'
    if (snapshot.leaderIdentity === opened.rootIdentity && snapshot.leaderProcessGroup !== opened.processGroup) {
      return 'unverifiable'
    }
    const checkpoint = new Map(closure.ownership.members.map(({ pid, identity }) => [pid, identity]))
    for (const [pid, identity] of snapshot.group) {
      if (opened.originalIdentities.get(pid) !== identity || checkpoint.get(pid) !== identity) return 'unverifiable'
    }
    return 'verified'
  }

  #leaderReplaced(opened: OwnershipContext, snapshot: ProcessSnapshot): boolean {
    return opened.rootIdentity !== null && snapshot.leaderIdentity !== null &&
      snapshot.leaderIdentity !== opened.rootIdentity
  }

  #refuseUnverified(opened: OwnershipContext, closure: SessionClosure, decision: string): never {
    throw new SessionOwnershipUnverifiable(
      `target ${closure.target} session ${opened.sessionId} process group ${closure.processGroup} is ${decision}; ` +
      'automatic termination requires every current member in the durable original checkpoint'
    )
  }

  #ownershipOf(opened: OwnershipContext): SessionProcessOwnership | null {
    if (opened.rootIdentity === null) return null
    return new SessionProcessOwnership({
      rootIdentity: opened.rootIdentity,
      members: [...opened.originalIdentities].map(([pid, identity]) => ({ pid, identity })),
    })
  }

  #contextFor(closure: SessionClosure): OwnershipContext {
    const retained = this.#owned.get(closure.session!)
    if (retained !== undefined) {
      this.#requireMatchingContext(retained, closure)
      return retained
    }
    return this.#recoveryContext(closure)
  }

  #matchingContext(closure: SessionClosure): OwnershipContext | undefined {
    const retained = this.#owned.get(closure.session!)
    if (retained !== undefined) {
      this.#requireMatchingContext(retained, closure)
      return retained
    }
    const recovered = this.#recovered.get(PtyLiveSessions.#closureIdentity(closure))
    if (recovered !== undefined) this.#requireMatchingContext(recovered, closure)
    return recovered
  }

  #recoveryContext(closure: SessionClosure): OwnershipContext {
    const identity = PtyLiveSessions.#closureIdentity(closure)
    const existing = this.#recovered.get(identity)
    if (existing !== undefined) {
      this.#requireMatchingContext(existing, closure)
      return existing
    }
    for (const retained of this.#owned.values()) {
      if (retained.sessionId === closure.session || retained.processGroup === closure.processGroup) {
        throw new SessionOwnershipUnverifiable(
          `target ${closure.target} cannot borrow retained session ${retained.sessionId} process group ${retained.processGroup}`
        )
      }
    }
    const ownership = closure.ownership
    const recovered: OwnershipContext = {
      key: identity,
      sessionId: closure.session!,
      processGroup: closure.processGroup!,
      retained: false,
      terminal: null,
      scrollback: '',
      watchers: new Set(),
      ended: true,
      rootExited: true,
      originalGroupGone: false,
      rootIdentity: ownership?.rootIdentity ?? null,
      originalIdentities: new Map(ownership?.members.map(({ pid, identity: memberIdentity }) => [pid, memberIdentity])),
      bootstrap: Promise.resolve(),
      termination: null,
      closureIdentity: identity,
    }
    this.#recovered.set(identity, recovered)
    return recovered
  }

  #bind(opened: OwnershipContext, closure: SessionClosure): void {
    const identity = PtyLiveSessions.#closureIdentity(closure)
    if (opened.closureIdentity !== null && opened.closureIdentity !== identity) {
      throw new SessionOwnershipUnverifiable(
        `session ${opened.sessionId} process group ${opened.processGroup} is bound to another closure target`
      )
    }
    opened.closureIdentity = identity
  }

  #requireMatchingContext(opened: OwnershipContext, closure: SessionClosure): void {
    if (opened.sessionId !== closure.session || opened.processGroup !== closure.processGroup) {
      throw new SessionOwnershipUnverifiable(
        `session ${closure.session} process group ${closure.processGroup} does not match retained ownership`
      )
    }
    const identity = PtyLiveSessions.#closureIdentity(closure)
    if (opened.closureIdentity !== null && opened.closureIdentity !== identity) {
      throw new SessionOwnershipUnverifiable(
        `target ${closure.target} session ${closure.session} process group ${closure.processGroup} ` +
        'is bound to another closure target'
      )
    }
    if (!opened.retained) {
      this.#requireContextCheckpoint(opened, closure)
    } else if (closure.ownership !== null && !this.#compatibleRetainedCheckpoint(opened, closure.ownership)) {
      throw new SessionOwnershipUnverifiable(
        `target ${closure.target} session ${closure.session} durable checkpoint conflicts with retained ownership`
      )
    }
    this.#bind(opened, closure)
  }

  #requireContextCheckpoint(opened: OwnershipContext, closure: SessionClosure): void {
    const ownership = closure.ownership
    if (ownership === null) {
      if (opened.rootIdentity === null && opened.originalIdentities.size === 0) return
    } else if (opened.rootIdentity === ownership.rootIdentity &&
      PtyLiveSessions.#membersEqual(opened.originalIdentities, ownership.members)) {
      return
    }
    throw new SessionOwnershipUnverifiable(
      `target ${closure.target} session ${closure.session} process group ${closure.processGroup} ` +
      'checkpoint conflicts with recovered ownership'
    )
  }

  #compatibleRetainedCheckpoint(opened: OwnershipContext, ownership: SessionProcessOwnership): boolean {
    if (opened.rootIdentity !== ownership.rootIdentity) return false
    return ownership.members.every(({ pid, identity }) => opened.originalIdentities.get(pid) === identity)
  }

  #requireExactCheckpoint(recorded: SessionClosure, offered: SessionClosure, source: string): void {
    const left = recorded.ownership
    const right = offered.ownership
    const matches = left === null || right === null
      ? left === right
      : left.rootIdentity === right.rootIdentity &&
        PtyLiveSessions.#membersEqual(new Map(left.members.map(({ pid, identity }) => [pid, identity])), right.members)
    if (matches) return
    throw new SessionOwnershipUnverifiable(
      `target ${offered.target} session ${offered.session} process group ${offered.processGroup} ` +
      `checkpoint conflicts with ${source}`
    )
  }

  static #membersEqual(
    recorded: ReadonlyMap<number, string>,
    offered: readonly { readonly pid: number, readonly identity: string }[],
  ): boolean {
    return recorded.size === offered.length &&
      offered.every(({ pid, identity }) => recorded.get(pid) === identity)
  }

  #isCurrent(opened: OwnershipContext): boolean {
    return opened.retained
      ? this.#owned.get(opened.sessionId) === opened
      : this.#recovered.get(opened.key) === opened
  }

  #endRetained(opened: OwnershipContext): void {
    if (!opened.retained) return
    opened.rootExited = true
    opened.ended = true
    this.#open.delete(opened.sessionId)
    for (const watcher of opened.watchers) watcher.onEnded()
    opened.watchers.clear()
  }

  #throwProbeFailure(closure: SessionClosure, cause: unknown): never {
    const code = PtyLiveSessions.#codeOf(cause)
    if (cause instanceof SessionTerminationPermissionDenied || code === 'EPERM' || code === 'EACCES') {
      throw new SessionTerminationPermissionDenied(
        `target ${closure.target} session ${closure.session} process group ${closure.processGroup} ` +
        `cannot be inspected with current OS permissions: ${String(cause)}`
      )
    }
    throw new SessionTerminationUnconfirmed(
      `process group ${closure.processGroup} could not be confirmed absent: ${String(cause)}`
    )
  }

  static #closureIdentity(closure: SessionClosure): string {
    return `${closure.conversation.text}\u0000${closure.target}\u0000${closure.session ?? ''}\u0000${closure.processGroup ?? ''}`
  }

  #requestSnapshot(opened: OwnershipContext): Promise<ProcessSnapshot> {
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
      if (opened.rootExited || opened.originalGroupGone) continue
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
      .then(() => this.inspectProcessTable({
        abort: controller.signal,
        timeoutMs: PtyLiveSessions.INSPECTION_TIMEOUT_MS,
        maxBufferBytes: PtyLiveSessions.INSPECTION_MAX_BUFFER_BYTES,
      }))
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
      const group = groups.get(target.opened.processGroup) ?? new Map<number, string>()
      let leaderIdentity: string | null = null
      let leaderProcessGroup: number | null = null
      for (const [processGroup, members] of groups) {
        const identity = members.get(target.opened.processGroup)
        if (identity !== undefined) {
          leaderIdentity = identity
          leaderProcessGroup = processGroup
          break
        }
      }
      const snapshot: ProcessSnapshot = { group, leaderIdentity, leaderProcessGroup }
      try {
        this.#applyObservation(target, snapshot)
      } catch {
      }
      for (const waiter of target.waiters) {
        clearTimeout(waiter.timer)
        waiter.resolve({ ...snapshot, group: new Map(group) })
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
      if (!opened.rootExited && !opened.originalGroupGone) return true
    }

    return false
  }

  #removeBackgroundInterest(opened: OwnershipContext): void {
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

  #cancelInterest(opened: OwnershipContext): void {
    const pending = this.#pending.get(opened)
    if (pending !== undefined) {
      this.#pending.delete(opened)
      for (const waiter of pending.waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error(`session ${opened.sessionId} was retired during process-table inspection`))
      }
      this.#clearUnusedStartTimer()
    }
    const active = this.#active?.targets.find((target) => target.opened === opened)
    if (active !== undefined) {
      for (const waiter of active.waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error(`session ${opened.sessionId} was retired during process-table inspection`))
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
      target.waiters.size > 0 || (target.background && this.#isCurrent(target.opened))
    )
    if (!interested) active.controller.abort()
  }

  #send(closure: SessionClosure, signal: NodeJS.Signals): void {
    const processGroup = closure.processGroup!
    try {
      this.signal(-processGroup, signal)
    } catch (cause) {
      if (PtyLiveSessions.#codeOf(cause) === 'ESRCH') return
      if (PtyLiveSessions.#codeOf(cause) === 'EPERM' || PtyLiveSessions.#codeOf(cause) === 'EACCES') {
        throw new SessionTerminationPermissionDenied(
          `target ${closure.target} session ${closure.session} ${signal} permission denied for ` +
          `process group ${processGroup}: ${String(cause)}`
        )
      }
      throw new SessionNotTerminated(
        `target ${closure.target} session ${closure.session} ${signal} could not be sent to ` +
        `process group ${processGroup}: ${String(cause)}`
      )
    }
  }

  #groupAbsent(processGroup: number): boolean {
    try {
      this.signal(-processGroup, 0)
      return false
    } catch (cause) {
      if (PtyLiveSessions.#codeOf(cause) === 'ESRCH') return true
      if (PtyLiveSessions.#codeOf(cause) === 'EPERM' || PtyLiveSessions.#codeOf(cause) === 'EACCES') {
        throw new SessionTerminationPermissionDenied(
          `process group ${processGroup} inspection permission denied: ${String(cause)}`
        )
      }
      throw new SessionNotTerminated(`process group ${processGroup} could not be inspected: ${String(cause)}`)
    }
  }

  static #codeOf(failure: unknown): string | undefined {
    if (!(failure instanceof Error) || !('code' in failure) || typeof failure.code !== 'string') return undefined

    return failure.code
  }

  static async #parseProcessTable(stdout: string, signal: AbortSignal): Promise<InspectionGroups> {
    if (stdout.length === 0) throw new Error('process table was empty')
    const groups = new Map<number, Map<number, string>>()
    const seen = new Set<number>()
    const rows = stdout.split('\n')
    const startPattern = '(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([ 0-3]?\\d) ([0-2]\\d:[0-5]\\d:[0-5]\\d) (\\d{4})'
    const rowPattern = new RegExp(`^\\s*(\\d+)\\s+(\\d+)\\s+(${startPattern}|@\\d+)\\s*$`)
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
