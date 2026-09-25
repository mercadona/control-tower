import { EventEmitter } from 'node:events'
import { HeadlessCallWorker } from '../../../src/infrastructure/headless-call-worker.ts'
import type { HeadlessFiles } from '../../../src/infrastructure/headless-files.ts'
import { ProcessRunner } from '../../../src/infrastructure/process-runner.ts'
import type { LaunchedProcess, LaunchOptions } from '../../../src/infrastructure/process-runner.ts'
import type { ScriptedClaude } from './scripted-claude.ts'
import { UnscriptedRequest } from './scripted-conversation.ts'

type WorkerTimer = { readonly cancel: () => void }

class LaunchedWorker extends EventEmitter implements LaunchedProcess {
  kill(): boolean {
    return true
  }

  disconnect(): void {}

  unref(): void {}
}

export class InProcessWorkers extends ProcessRunner {
  launches = 0
  kills = 0
  readonly #files: HeadlessFiles
  readonly #claude: ScriptedClaude
  readonly #worker: string
  readonly #settling: Promise<void>[] = []

  constructor(ports: { files: HeadlessFiles, claude: ScriptedClaude, worker: string }) {
    super()
    this.#files = ports.files
    this.#claude = ports.claude
    this.#worker = ports.worker
  }

  override launch(binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess {
    if (binary !== process.execPath || argv[0] !== this.#worker) {
      throw new UnscriptedRequest({ binary, argv, cwd: options.cwd })
    }
    this.launches += 1
    const emitter = new LaunchedWorker()
    this.#settling.push(new Promise((resolve, reject) => {
      queueMicrotask(() => { this.#run(emitter, argv[1]).then(resolve, reject) })
    }))

    return emitter
  }

  async settled(): Promise<void> {
    await Promise.all(this.#settling)
  }

  async #run(emitter: LaunchedWorker, descriptorPath: string): Promise<void> {
    const worker = new HeadlessCallWorker({
      files: this.#files,
      spawn: this.#claude.launch.bind(this.#claude),
      kill: this.kill.bind(this),
      now: () => new Date().toISOString(),
      schedule: InProcessWorkers.#schedule,
      cancel: InProcessWorkers.#cancel,
      acknowledge: () => emitter.emit('message', { kind: 'accepted' }),
    })
    emitter.emit('spawn')
    await worker.run(descriptorPath)
    await worker.terminal()
    emitter.emit('exit', 0, null)
    emitter.emit('close', 0, null)
  }

  kill(pid: number, signal: NodeJS.Signals | 0): void {
    this.kills += 1
    throw Object.assign(new Error('the scripted leader leaves no group'), { code: 'ESRCH' })
  }

  static #schedule(callback: () => void, delayMs: number): WorkerTimer {
    const timer = setTimeout(callback, delayMs)

    return { cancel: () => clearTimeout(timer) }
  }

  static #cancel(timer: WorkerTimer): void {
    timer.cancel()
  }
}
