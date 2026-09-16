import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CompletedPlanCall, StartedPlanCall } from '../domain/value-objects/plan-call.ts'
import { CallDescriptor, StoredCompletion } from './claude-calls.ts'
import { ClaudeCallResult } from './claude-call-result.ts'
import { HeadlessFiles } from './headless-files.ts'

type LeaderOutcome = { readonly kind: 'pending' }
  | { readonly kind: 'known', readonly code: number | null, readonly signal: string | null }
type GroupEnforcement = { readonly kind: 'pending' }
  | { readonly kind: 'disappeared' }
  | { readonly kind: 'escalated' }
type WorkerTimer = { cancel: () => void }

class WorkerOutcome {
  readonly code: number | null
  readonly signal: string | null
  readonly finishedAt: string
  readonly wallDurationMs: number
  readonly diagnostics: readonly string[]

  constructor(asked: {
    code: number | null,
    signal: string | null,
    finishedAt: string,
    wallDurationMs: number,
    diagnostics: readonly string[],
  }) {
    this.code = asked.code
    this.signal = asked.signal
    this.finishedAt = asked.finishedAt
    this.wallDurationMs = asked.wallDurationMs
    this.diagnostics = Object.freeze([...asked.diagnostics])
    Object.freeze(this)
  }
}

class RecordedStream {
  static async *of(text: string): AsyncIterable<string> {
    yield text
  }
}

export class HeadlessCallWorker {
  readonly files: HeadlessFiles
  readonly spawn: typeof import('node:child_process').spawn
  readonly kill: (pid: number, signal: NodeJS.Signals | 0) => void
  readonly now: () => string
  readonly schedule: (callback: () => void, delayMs: number) => WorkerTimer
  readonly cancel: (timer: WorkerTimer) => void
  readonly acknowledge: () => void
  #descriptor: CallDescriptor | null = null
  #descriptorPath: string | null = null
  #leader: LeaderOutcome = Object.freeze({ kind: 'pending' })
  #enforcement: GroupEnforcement = Object.freeze({ kind: 'pending' })
  #pid: number | null = null
  #budgetTimer: WorkerTimer | null = null
  #graceTimer: WorkerTimer | null = null
  #diagnostics: string[] = []
  #publication: Promise<void> | null = null

  constructor(ports: {
    files: HeadlessFiles,
    spawn: typeof import('node:child_process').spawn,
    kill: (pid: number, signal: NodeJS.Signals | 0) => void,
    now: () => string,
    schedule: (callback: () => void, delayMs: number) => WorkerTimer,
    cancel: (timer: WorkerTimer) => void,
    acknowledge: () => void,
  }) {
    this.files = ports.files
    this.spawn = ports.spawn
    this.kill = ports.kill
    this.now = ports.now
    this.schedule = ports.schedule
    this.cancel = ports.cancel
    this.acknowledge = ports.acknowledge
  }

  async run(descriptorPath: string): Promise<void> {
    this.#descriptorPath = descriptorPath
    this.#descriptor = CallDescriptor.from(await this.files.fs.readFile(descriptorPath, 'utf8'))
    const directory = dirname(descriptorPath)
    const stdout = await this.files.fs.open(join(directory, CallDescriptor.STREAM), 'wx')
    const stderr = await this.files.fs.open(join(directory, CallDescriptor.STDERR), 'wx')
    let child: import('node:child_process').ChildProcess
    try {
      child = this.spawn(this.#descriptor.binary, [...this.#descriptor.argv], {
        cwd: this.#descriptor.cwd,
        env: {
          ...process.env,
          [CallDescriptor.PROMPT_VARIABLE]: join(directory, CallDescriptor.PROMPT),
        },
        detached: true,
        stdio: ['ignore', stdout.fd, stderr.fd],
      })
      this.#pid = child.pid ?? null
      child.once('spawn', () => this.#accepted())
      child.once('error', (cause) => this.#spawnFailed(cause))
      child.once('close', (code, signal) => this.#closed(code, signal))
      const remainingBudget = Math.max(
        0,
        Date.parse(this.#descriptor.startedAt) + this.#descriptor.budgetMs - Date.parse(this.now()),
      )
      this.#budgetTimer = this.schedule(() => this.#deadline(), remainingBudget)
    } catch (cause) {
      this.#spawnFailed(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      await stdout.close()
      await stderr.close()
    }
  }

  #accepted(): void {
    try {
      this.acknowledge()
    } catch (cause) {
      this.#diagnostics.push(`worker acceptance could not be reported: ${String(cause)}`)
    }
  }

  #spawnFailed(cause: Error): void {
    if (this.#leader.kind === 'known') return
    this.#diagnostics.push(`recorded child could not be spawned: ${cause.message}`)
    this.#leader = Object.freeze({ kind: 'known', code: null, signal: null })
    this.#enforcement = Object.freeze({ kind: 'disappeared' })
    this.#settle()
  }

  #closed(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#leader.kind === 'pending') {
      this.#leader = Object.freeze({ kind: 'known', code, signal })
    }
    if (this.#enforcement.kind === 'pending') this.#confirmDisappearance()
    this.#settle()
  }

  #deadline(): void {
    if (this.#enforcement.kind !== 'pending') return
    this.#signal('SIGTERM')
    if (this.#enforcement.kind !== 'pending') {
      this.#settle()
      return
    }
    const grace = this.#descriptor?.killGraceMs
    if (grace === undefined) return
    this.#graceTimer = this.schedule(() => this.#escalate(), grace)
  }

  #escalate(): void {
    if (this.#enforcement.kind !== 'pending') return
    this.#signal('SIGKILL')
    if (this.#enforcement.kind === 'pending') {
      this.#enforcement = Object.freeze({ kind: 'escalated' })
    }
    this.#settle()
  }

  #confirmDisappearance(): void {
    const pid = this.#pid
    if (pid === null) {
      this.#enforcement = Object.freeze({ kind: 'disappeared' })
      return
    }
    try {
      this.kill(-pid, 0)
    } catch (cause) {
      if (HeadlessCallWorker.#hasCode(cause, 'ESRCH')) {
        this.#enforcement = Object.freeze({ kind: 'disappeared' })
      } else {
        this.#diagnostics.push(`process group presence could not be checked: ${String(cause)}`)
      }
    }
  }

  #signal(signal: NodeJS.Signals): void {
    const pid = this.#pid
    if (pid === null) {
      this.#enforcement = Object.freeze({ kind: 'disappeared' })
      return
    }
    try {
      this.kill(-pid, signal)
    } catch (cause) {
      if (HeadlessCallWorker.#hasCode(cause, 'ESRCH')) {
        this.#enforcement = Object.freeze({ kind: 'disappeared' })
      } else {
        this.#diagnostics.push(`${signal} could not be sent to process group: ${String(cause)}`)
      }
    }
  }

  #settle(): void {
    if (this.#publication !== null || this.#leader.kind !== 'known' || this.#enforcement.kind === 'pending') return
    if (this.#budgetTimer !== null) this.cancel(this.#budgetTimer)
    if (this.#graceTimer !== null) this.cancel(this.#graceTimer)
    const finishedAt = this.now()
    const descriptor = this.#descriptor
    if (descriptor === null) return
    const outcome = new WorkerOutcome({
      code: this.#leader.code,
      signal: this.#leader.signal,
      finishedAt,
      wallDurationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(descriptor.startedAt)),
      diagnostics: this.#diagnostics,
    })
    this.#publication = this.#publish(descriptor, outcome).catch(async (cause: unknown) => {
      if (this.#descriptorPath === null) return
      await this.files.fs.appendFile(
        join(dirname(this.#descriptorPath), CallDescriptor.STDERR),
        `completion could not be published: ${String(cause)}\n`,
        'utf8',
      ).catch(() => {})
    })
  }

  async #publish(descriptor: CallDescriptor, outcome: WorkerOutcome): Promise<void> {
    const descriptorPath = this.#descriptorPath
    if (descriptorPath === null) return
    const stream = await this.files.fs.readFile(join(dirname(descriptorPath), CallDescriptor.STREAM), 'utf8')
    const converted = await ClaudeCallResult.read({
      lines: RecordedStream.of(stream),
      call: new StartedPlanCall({ conversation: descriptor.conversation, id: basename(dirname(descriptorPath)) }),
      code: outcome.code,
      signal: outcome.signal,
      finishedAt: outcome.finishedAt,
      wallDurationMs: outcome.wallDurationMs,
      mode: descriptor.mode(),
    })
    const completed = HeadlessCallWorker.#withDiagnostics(converted, outcome.diagnostics)
    await this.files.writeOnce(join(dirname(descriptorPath), CallDescriptor.COMPLETION), StoredCompletion.text(completed))
  }

  static #withDiagnostics(completed: CompletedPlanCall, diagnostics: readonly string[]): CompletedPlanCall {
    if (diagnostics.length === 0) return completed
    return new CompletedPlanCall({
      call: completed.call,
      code: completed.code,
      signal: completed.signal,
      finishedAt: completed.finishedAt,
      wallDurationMs: completed.wallDurationMs,
      execution: completed.execution,
      measurement: {
        ...completed.measurement,
        unavailable: [...completed.measurement.unavailable, ...diagnostics],
      },
    })
  }

  static #hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }

  static async main(argv: readonly string[]): Promise<void> {
    if (argv.length !== 1) throw new Error(`expected one descriptor path, got ${argv.length}`)
    const files = new HeadlessFiles({ root: '/', fs, newId: () => randomUUID() })
    const worker = new HeadlessCallWorker({
      files,
      spawn,
      kill: (pid, signal) => process.kill(pid, signal),
      now: () => new Date().toISOString(),
      schedule: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs)
        return { cancel: () => clearTimeout(timer) }
      },
      cancel: (timer) => timer.cancel(),
      acknowledge: () => HeadlessCallWorker.#acknowledge(),
    })
    await worker.run(argv[0])
  }

  static #acknowledge(): void {
    if (!process.connected || process.send === undefined) return
    try {
      process.send({ kind: 'accepted' }, (cause) => {
        if (cause !== null && cause !== undefined) return
        HeadlessCallWorker.#disconnect()
      })
    } catch {
      HeadlessCallWorker.#disconnect()
    }
  }

  static #disconnect(): void {
    if (!process.connected) return
    try {
      process.disconnect()
    } catch {}
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void HeadlessCallWorker.main(process.argv.slice(2)).catch((cause: unknown) => {
    process.stderr.write(`${String(cause)}\n`)
    process.exitCode = 1
  })
}
