import { join } from 'node:path'
import { PlanAgentNotLaunched, PlanAgentNotNamed } from '../domain/exceptions.ts'
import {
  CompletedPlanCall,
  StartedPlanCall,
  type CallCost,
  type CallExecution,
  type CallMeasurement,
  type PlanCallPurpose,
} from '../domain/value-objects/plan-call.ts'
import { ClaudeConversations } from './claude-conversations.ts'
import type { HeadlessFiles } from './headless-files.ts'
import { RecordedCall } from './recorded-call.ts'

type JsonRecord = Record<string, unknown>
type CallMode = 'initial' | 'resume'

export class CallInvocation {
  readonly conversation: string
  readonly purpose: PlanCallPurpose
  readonly cwd: string
  readonly argv: readonly string[]
  readonly prompt: string
  readonly requestId: string | null

  constructor(asked: {
    conversation: string,
    purpose: PlanCallPurpose,
    cwd: string,
    argv: readonly string[],
    prompt: string,
    requestId?: string,
  }) {
    this.conversation = asked.conversation
    this.purpose = asked.purpose
    this.cwd = asked.cwd
    this.argv = Object.freeze([...asked.argv])
    this.prompt = asked.prompt
    this.requestId = asked.requestId ?? null
    Object.freeze(this)
  }
}

export class CallDescriptor {
  static readonly FILE = 'call.json'
  static readonly PROMPT = 'prompt.md'
  static readonly STREAM = 'stream.ndjson'
  static readonly STDERR = 'stderr.log'
  static readonly COMPLETION = 'completion.json'
  static readonly PROMPT_VARIABLE = 'CT_CALL_PROMPT'
  static readonly #KEYS = Object.freeze([
    'conversation', 'purpose', 'requestId', 'cwd', 'binary', 'argv', 'startedAt', 'budgetMs', 'killGraceMs',
  ])

  readonly conversation: string
  readonly purpose: PlanCallPurpose
  readonly requestId: string | null
  readonly cwd: string
  readonly binary: string
  readonly argv: readonly string[]
  readonly startedAt: string
  readonly budgetMs: number
  readonly killGraceMs: number

  constructor(asked: {
    conversation: string,
    purpose: PlanCallPurpose,
    requestId: string | null,
    cwd: string,
    binary: string,
    argv: readonly string[],
    startedAt: string,
    budgetMs: number,
    killGraceMs: number,
  }) {
    this.conversation = CallDescriptor.#nonempty('conversation', asked.conversation)
    this.purpose = CallDescriptor.#purpose(asked.purpose)
    this.requestId = CallDescriptor.#nullableNonempty('requestId', asked.requestId)
    this.cwd = CallDescriptor.#nonempty('cwd', asked.cwd)
    this.binary = CallDescriptor.#nonempty('binary', asked.binary)
    this.argv = Object.freeze(CallDescriptor.#argv(asked.argv))
    this.startedAt = CallDescriptor.#timestamp('startedAt', asked.startedAt)
    this.budgetMs = CallDescriptor.#duration('budgetMs', asked.budgetMs)
    this.killGraceMs = CallDescriptor.#duration('killGraceMs', asked.killGraceMs)
    this.mode()
    Object.freeze(this)
  }

  static from(text: string): CallDescriptor {
    const raw: unknown = JSON.parse(text)
    if (!CallDescriptor.#isRecord(raw)) throw new Error(`expected a JSON object, got ${JSON.stringify(raw)}`)
    CallDescriptor.#exactKeys(raw, CallDescriptor.#KEYS)
    return new CallDescriptor({
      conversation: CallDescriptor.#nonempty('conversation', raw.conversation),
      purpose: CallDescriptor.#purpose(raw.purpose),
      requestId: CallDescriptor.#nullableNonempty('requestId', raw.requestId),
      cwd: CallDescriptor.#nonempty('cwd', raw.cwd),
      binary: CallDescriptor.#nonempty('binary', raw.binary),
      argv: CallDescriptor.#argv(raw.argv),
      startedAt: CallDescriptor.#timestamp('startedAt', raw.startedAt),
      budgetMs: CallDescriptor.#duration('budgetMs', raw.budgetMs),
      killGraceMs: CallDescriptor.#duration('killGraceMs', raw.killGraceMs),
    })
  }

  text(): string {
    return `${JSON.stringify({
      conversation: this.conversation,
      purpose: this.purpose,
      requestId: this.requestId,
      cwd: this.cwd,
      binary: this.binary,
      argv: this.argv,
      startedAt: this.startedAt,
      budgetMs: this.budgetMs,
      killGraceMs: this.killGraceMs,
    }, null, 2)}\n`
  }

  mode(): CallMode {
    const modes = this.argv.flatMap((value, index) => (
      value === '--session-id' || value === '--resume' ? [{ option: value, index }] : []
    ))
    if (modes.length !== 1 || this.argv[modes[0].index + 1] !== this.conversation) {
      throw new Error(
        `argv must carry exactly one --session-id or --resume matching conversation `
        + `${JSON.stringify(this.conversation)}, got ${JSON.stringify(this.argv)}`
      )
    }
    return modes[0].option === '--session-id' ? 'initial' : 'resume'
  }

  deadlineMs(): number {
    return Date.parse(this.startedAt) + this.budgetMs + this.killGraceMs
  }

  static #isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  static #exactKeys(record: JsonRecord, expected: readonly string[]): void {
    const actual = Object.keys(record).sort()
    const wanted = [...expected].sort()
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
      throw new Error(`expected keys ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`)
    }
  }

  static #nonempty(field: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${field} must be a nonempty string, got ${JSON.stringify(value)}`)
    }
    return value
  }

  static #nullableNonempty(field: string, value: unknown): string | null {
    if (value === null) return null
    return CallDescriptor.#nonempty(field, value)
  }

  static #purpose(value: unknown): PlanCallPurpose {
    switch (value) {
      case 'plan':
      case 'implementation':
      case 'fix':
        return value
      default:
        throw new Error(`purpose must be plan, implementation or fix, got ${JSON.stringify(value)}`)
    }
  }

  static #argv(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((argument) => typeof argument !== 'string')) {
      throw new Error(`argv must be an array of strings, got ${JSON.stringify(value)}`)
    }
    return value.map((argument) => String(argument))
  }

  static #timestamp(field: string, value: unknown): string {
    if (typeof value !== 'string') throw new Error(`${field} must be an ISO timestamp, got ${JSON.stringify(value)}`)
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
      throw new Error(`${field} must be an ISO timestamp, got ${JSON.stringify(value)}`)
    }
    return value
  }

  static #duration(field: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${field} must be a finite nonnegative number, got ${JSON.stringify(value)}`)
    }
    return value
  }
}

export class StoredCompletion {
  static readonly #KEYS = Object.freeze([
    'code', 'signal', 'finishedAt', 'wallDurationMs', 'execution', 'measurement',
  ])

  static text(completed: CompletedPlanCall): string {
    return `${JSON.stringify({
      code: completed.code,
      signal: completed.signal,
      finishedAt: completed.finishedAt,
      wallDurationMs: completed.wallDurationMs,
      execution: completed.execution,
      measurement: completed.measurement,
    }, null, 2)}\n`
  }

  static read(text: string, call: StartedPlanCall, mode: CallMode): CompletedPlanCall {
    const raw: unknown = JSON.parse(text)
    if (!StoredCompletion.#isRecord(raw)) throw new Error(`expected a JSON object, got ${JSON.stringify(raw)}`)
    StoredCompletion.#exactKeys(raw, StoredCompletion.#KEYS)
    const code = StoredCompletion.#nullableInteger('code', raw.code)
    const signal = StoredCompletion.#nullableString('signal', raw.signal)
    const execution = StoredCompletion.#execution(raw.execution)
    StoredCompletion.#requireCoherentTermination(code, signal, execution)
    const measurement = StoredCompletion.#measurement(raw.measurement, mode)
    return new CompletedPlanCall({
      call,
      code,
      signal,
      finishedAt: StoredCompletion.#timestamp(raw.finishedAt),
      wallDurationMs: StoredCompletion.#finiteNonnegative('wallDurationMs', raw.wallDurationMs),
      execution,
      measurement,
    })
  }

  static #requireCoherentTermination(
    code: number | null,
    signal: string | null,
    execution: CallExecution,
  ): void {
    const contradictoryTermination = code !== null && signal !== null
    const contradictorySuccess = execution.kind === 'success' && (code !== 0 || signal !== null)
    if (!contradictoryTermination && !contradictorySuccess) return
    throw new Error(
      `completion termination is incoherent: code=${JSON.stringify(code)}, `
      + `signal=${JSON.stringify(signal)}, execution.kind=${JSON.stringify(execution.kind)}`
    )
  }

  static #measurement(value: unknown, mode: CallMode): CallMeasurement {
    if (!StoredCompletion.#isRecord(value)) throw new Error('measurement must be a JSON object')
    StoredCompletion.#exactKeys(value, ['cost', 'turns', 'durationMs', 'unavailable'])
    if (!Array.isArray(value.unavailable) || value.unavailable.some((item) => typeof item !== 'string')) {
      throw new Error('measurement.unavailable must be an array of strings')
    }
    return Object.freeze({
      cost: StoredCompletion.#cost(value.cost, mode),
      turns: StoredCompletion.#optionalNonnegativeInteger('measurement.turns', value.turns),
      durationMs: StoredCompletion.#optionalFiniteNonnegative('measurement.durationMs', value.durationMs),
      unavailable: Object.freeze(value.unavailable.map((item) => String(item))),
    })
  }

  static #cost(value: unknown, mode: CallMode): CallCost {
    if (!StoredCompletion.#isRecord(value) || typeof value.kind !== 'string') {
      throw new Error('measurement.cost must be a JSON object with a kind')
    }
    switch (value.kind) {
      case 'unavailable':
        StoredCompletion.#exactKeys(value, ['kind', 'reason'])
        return Object.freeze({ kind: 'unavailable', reason: StoredCompletion.#string('measurement.cost.reason', value.reason) })
      case 'reported': {
        StoredCompletion.#exactKeys(value, ['kind', 'totalUsd', 'attribution'])
        const expected = mode === 'initial' ? 'initial-invocation' : 'unverified-resume'
        if (value.attribution !== expected) {
          throw new Error(`reported cost attribution must be ${expected}, got ${JSON.stringify(value.attribution)}`)
        }
        return Object.freeze({
          kind: 'reported',
          totalUsd: StoredCompletion.#finiteNonnegative('measurement.cost.totalUsd', value.totalUsd),
          attribution: expected,
        })
      }
      default:
        throw new Error(`measurement.cost.kind is unknown: ${JSON.stringify(value.kind)}`)
    }
  }

  static #execution(value: unknown): CallExecution {
    if (!StoredCompletion.#isRecord(value) || typeof value.kind !== 'string') {
      throw new Error('execution must be a JSON object with a kind')
    }
    switch (value.kind) {
      case 'success':
        StoredCompletion.#exactKeys(value, ['kind'])
        return Object.freeze({ kind: 'success' })
      case 'error':
      case 'unavailable':
        StoredCompletion.#exactKeys(value, ['kind', 'diagnostic'])
        return Object.freeze({ kind: value.kind, diagnostic: StoredCompletion.#string('execution.diagnostic', value.diagnostic) })
      default:
        throw new Error(`execution.kind is unknown: ${JSON.stringify(value.kind)}`)
    }
  }

  static #isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  static #exactKeys(record: JsonRecord, expected: readonly string[]): void {
    const actual = Object.keys(record).sort()
    const wanted = [...expected].sort()
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
      throw new Error(`expected keys ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`)
    }
  }

  static #string(field: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a nonempty string`)
    return value
  }

  static #nullableString(field: string, value: unknown): string | null {
    if (value === null || typeof value === 'string') return value
    throw new Error(`${field} must be a string or null`)
  }

  static #nullableInteger(field: string, value: unknown): number | null {
    if (value === null || (typeof value === 'number' && Number.isInteger(value))) return value
    throw new Error(`${field} must be an integer or null`)
  }

  static #finiteNonnegative(field: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${field} must be a finite nonnegative number`)
    }
    return value
  }

  static #optionalFiniteNonnegative(field: string, value: unknown): number | null {
    return value === null ? null : StoredCompletion.#finiteNonnegative(field, value)
  }

  static #optionalNonnegativeInteger(field: string, value: unknown): number | null {
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(`${field} must be a nonnegative integer or null`)
    }
    return value
  }

  static #timestamp(value: unknown): string {
    if (typeof value !== 'string') throw new Error('finishedAt must be an ISO timestamp')
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
      throw new Error('finishedAt must be an ISO timestamp')
    }
    return value
  }
}

export class ClaudeCalls {
  readonly files: HeadlessFiles
  readonly binary: string
  readonly worker: string
  readonly spawn: typeof import('node:child_process').spawn
  readonly env: NodeJS.ProcessEnv
  readonly newId: () => string
  readonly now: () => string
  readonly budgetMs: number
  readonly killGraceMs: number
  readonly acceptanceMs: number
  readonly pollMs: number
  readonly sleep: (ms: number) => Promise<void>
  readonly starts: Map<string, Promise<void>>
  readonly accepted: Map<string, StartedPlanCall>

  constructor(ports: {
    files: HeadlessFiles,
    binary: string,
    worker: string,
    spawn: typeof import('node:child_process').spawn,
    env: NodeJS.ProcessEnv,
    newId: () => string,
    now: () => string,
    budgetMs: number,
    killGraceMs: number,
    acceptanceMs: number,
    pollMs: number,
    sleep: (ms: number) => Promise<void>,
  }) {
    this.files = ports.files
    this.binary = ports.binary
    this.worker = ports.worker
    this.spawn = ports.spawn
    this.env = Object.freeze({ ...ports.env })
    this.newId = ports.newId
    this.now = ports.now
    this.budgetMs = ports.budgetMs
    this.killGraceMs = ports.killGraceMs
    this.acceptanceMs = ports.acceptanceMs
    this.pollMs = ports.pollMs
    this.sleep = ports.sleep
    this.starts = new Map()
    this.accepted = new Map()
  }

  async start(invocation: CallInvocation): Promise<StartedPlanCall> {
    const previous = this.starts.get(invocation.conversation) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    this.starts.set(invocation.conversation, gate)
    await previous
    try {
      return await this.#start(invocation)
    } finally {
      release()
      if (this.starts.get(invocation.conversation) === gate) this.starts.delete(invocation.conversation)
    }
  }

  async #start(invocation: CallInvocation): Promise<StartedPlanCall> {
    const recorded = await this.#recorded(invocation)
    if (recorded !== null) return recorded
    let call: StartedPlanCall
    let directory: string
    let descriptorPath: string
    let startedAt: string
    try {
      call = new StartedPlanCall({ conversation: invocation.conversation, id: this.newId() })
      directory = this.files.callDirectory(call)
      descriptorPath = join(directory, CallDescriptor.FILE)
      startedAt = this.now()
    } catch (cause) {
      throw new PlanAgentNotLaunched(
        `call preparation for conversation ${invocation.conversation} failed before validation: ${String(cause)}`
      )
    }
    let descriptor: CallDescriptor
    try {
      descriptor = new CallDescriptor({
        conversation: invocation.conversation,
        purpose: invocation.purpose,
        requestId: invocation.requestId,
        cwd: invocation.cwd,
        binary: this.binary,
        argv: invocation.argv,
        startedAt,
        budgetMs: this.budgetMs,
        killGraceMs: this.killGraceMs,
      })
    } catch (cause) {
      throw new PlanAgentNotNamed(
        `call descriptor for conversation ${JSON.stringify(invocation.conversation)} `
        + `and argv ${JSON.stringify(invocation.argv)} is invalid: ${String(cause)}`
      )
    }
    await this.#writeOnceOrMatch(join(directory, CallDescriptor.PROMPT), invocation.prompt)
    await this.#writeOnceOrMatch(descriptorPath, descriptor.text())
    await this.#launch(descriptorPath)
    this.accepted.set(ClaudeCalls.#callKey(call), call)
    return call
  }

  async #recorded(invocation: CallInvocation): Promise<StartedPlanCall | null> {
    const directory = join(this.files.root, 'harness', invocation.conversation, 'calls')
    let names: string[]
    try {
      names = await this.files.list(directory)
    } catch (cause) {
      throw new PlanAgentNotLaunched(`${directory} could not be listed: ${String(cause)}`)
    }
    let matching: StartedPlanCall | null = null
    let unfinishedCompetitor: StartedPlanCall | null = null
    for (const name of names.sort()) {
      const call = new StartedPlanCall({ conversation: invocation.conversation, id: name })
      const descriptor = await this.#descriptor(call)
      if (descriptor.requestId !== null && descriptor.requestId === invocation.requestId) {
        if (matching !== null) {
          throw new PlanAgentNotNamed(
            `request ${JSON.stringify(invocation.requestId)} has multiple records in conversation `
            + JSON.stringify(invocation.conversation)
          )
        }
        await this.#requireMatchingRequest(call, descriptor, invocation)
        await this.#completionAbsent(call)
        matching = call
        continue
      }
      if (await this.#completionAbsent(call)) unfinishedCompetitor = call
    }
    if (unfinishedCompetitor !== null) {
      throw new PlanAgentNotLaunched(
        `conversation ${JSON.stringify(invocation.conversation)} already has unfinished call ${unfinishedCompetitor.id}`
      )
    }
    return matching
  }

  async #requireMatchingRequest(
    call: StartedPlanCall,
    descriptor: CallDescriptor,
    invocation: CallInvocation,
  ): Promise<void> {
    const promptPath = join(this.files.callDirectory(call), CallDescriptor.PROMPT)
    let prompt: string | null
    try {
      prompt = await this.files.read(promptPath)
    } catch (cause) {
      throw new PlanAgentNotLaunched(`${promptPath} could not be read: ${String(cause)}`)
    }
    if (prompt === null) throw new PlanAgentNotLaunched(`${promptPath} is absent`)
    if (descriptor.purpose !== invocation.purpose || prompt !== invocation.prompt) {
      throw new PlanAgentNotNamed(
        `request ${JSON.stringify(invocation.requestId)} for conversation ${JSON.stringify(invocation.conversation)} `
        + 'was already recorded with a different purpose or prompt'
      )
    }
  }

  async #completionAbsent(call: StartedPlanCall): Promise<boolean> {
    return await this.completed(call) === null
  }

  async wait(call: StartedPlanCall): Promise<CompletedPlanCall> {
    const descriptor = await this.#descriptor(call)
    for (;;) {
      const completed = (await this.#read(call)).completion
      if (completed !== null) return completed
      if (Date.parse(this.now()) >= descriptor.deadlineMs()) {
        await this.sleep(this.pollMs)
        const final = (await this.#read(call)).completion
        if (final !== null) return final
        throw new PlanAgentNotLaunched(
          `completion for call ${call.id} is absent after its recorded deadline; launch outcome is uncertain`
        )
      }
      await this.sleep(this.pollMs)
    }
  }

  async completed(call: StartedPlanCall): Promise<CompletedPlanCall | null> {
    return (await this.#read(call)).completion
  }

  async history(conversation: string): Promise<readonly RecordedCall[]> {
    const directory = join(this.files.root, 'harness', conversation, 'calls')
    let names: string[]
    try {
      names = await this.files.list(directory)
    } catch (cause) {
      throw new PlanAgentNotLaunched(`${directory} could not be listed: ${String(cause)}`)
    }
    const history: RecordedCall[] = []
    for (const name of names) {
      history.push(await this.#read(new StartedPlanCall({ conversation, id: name })))
    }
    return Object.freeze(history)
  }

  owns(call: StartedPlanCall): boolean {
    return this.accepted.has(ClaudeCalls.#callKey(call))
  }

  async #read(call: StartedPlanCall): Promise<RecordedCall> {
    const descriptor = await this.#descriptor(call)
    const path = join(this.files.callDirectory(call), CallDescriptor.COMPLETION)
    let text: string | null
    try {
      text = await this.files.read(path)
    } catch (cause) {
      throw new PlanAgentNotLaunched(`${path} could not be read: ${String(cause)}`)
    }
    if (text === null) {
      return new RecordedCall({
        call,
        purpose: descriptor.purpose,
        startedAt: descriptor.startedAt,
        completion: null,
      })
    }
    try {
      const completion = StoredCompletion.read(text, call, descriptor.mode())
      this.accepted.delete(ClaudeCalls.#callKey(call))
      return new RecordedCall({
        call,
        purpose: descriptor.purpose,
        startedAt: descriptor.startedAt,
        completion,
      })
    } catch (cause) {
      throw new PlanAgentNotNamed(`${path} cannot be read as a call completion: ${String(cause)}`)
    }
  }

  async #descriptor(call: StartedPlanCall): Promise<CallDescriptor> {
    const path = join(this.files.callDirectory(call), CallDescriptor.FILE)
    let text: string | null
    try {
      text = await this.files.read(path)
    } catch (cause) {
      throw new PlanAgentNotLaunched(`${path} could not be read: ${String(cause)}`)
    }
    if (text === null) throw new PlanAgentNotLaunched(`${path} is absent`)
    try {
      const descriptor = CallDescriptor.from(text)
      if (descriptor.conversation !== call.conversation) {
        throw new Error(
          `descriptor identity differs from its directory: expected conversation=${JSON.stringify(call.conversation)}, `
          + `got conversation=${JSON.stringify(descriptor.conversation)}`
        )
      }
      return descriptor
    } catch (cause) {
      throw new PlanAgentNotNamed(`${path} cannot be read as a call descriptor: ${String(cause)}`)
    }
  }

  async #writeOnceOrMatch(path: string, text: string): Promise<void> {
    try {
      await this.files.writeOnce(path, text)
      return
    } catch (cause) {
      if (!ClaudeCalls.#hasCode(cause, 'EEXIST')) {
        throw new PlanAgentNotLaunched(`${path} could not be written: ${String(cause)}`)
      }
    }
    let existing: string | null
    try {
      existing = await this.files.read(path)
    } catch (cause) {
      throw new PlanAgentNotLaunched(`${path} could not be read after immutable publication collided: ${String(cause)}`)
    }
    if (existing === null) {
      throw new PlanAgentNotLaunched(`${path} is absent after immutable publication collided`)
    }
    if (existing !== text) {
      throw new PlanAgentNotNamed(`${path} contains different bytes after immutable publication collided`)
    }
  }

  #launch(descriptorPath: string): Promise<void> {
    let worker: import('node:child_process').ChildProcess
    try {
      worker = this.spawn(process.execPath, [this.worker, descriptorPath], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: ClaudeCalls.#childEnvironment(this.env),
      })
    } catch (cause) {
      throw new PlanAgentNotLaunched(`headless worker could not be spawned: ${String(cause)}`)
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => finish(new PlanAgentNotLaunched(
        `headless worker did not accept call within ${this.acceptanceMs}ms; launch outcome is uncertain`
      )), this.acceptanceMs)
      const finish = (failure: PlanAgentNotLaunched | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (worker.connected) {
          try {
            worker.disconnect()
          } catch {}
        }
        worker.unref()
        if (failure === null) resolve()
        else reject(failure)
      }
      worker.on('message', (message: unknown) => {
        if (ClaudeCalls.#accepted(message)) finish(null)
      })
      worker.once('error', (cause) => finish(new PlanAgentNotLaunched(`headless worker failed: ${cause.message}`)))
      worker.once('exit', (code, signal) => finish(new PlanAgentNotLaunched(
        `headless worker exited before acceptance with code ${String(code)} and signal ${String(signal)}`
      )))
    })
  }

  static #accepted(value: unknown): boolean {
    return value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'accepted'
  }

  static #childEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const child = { ...environment }
    delete child[ClaudeConversations.PROMPT_VARIABLE]
    delete child[ClaudeConversations.HOOKS_URL_VARIABLE]
    return child
  }

  static #hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }

  static #callKey(call: StartedPlanCall): string {
    return `${call.conversation}/${call.id}`
  }
}
