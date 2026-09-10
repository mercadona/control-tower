import { execFile, spawn } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'

export class ProcessOutput {
  readonly code: number
  readonly stdout: string
  readonly stderr: string

  constructor({ code, stdout, stderr }: { code: number, stdout: string, stderr: string }) {
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
    Object.freeze(this)
  }

  get failed(): boolean {
    return this.code !== 0
  }
}

export class ToolRunner {
  static readonly #UNKNOWN_EXIT = 1

  readonly bin: string
  readonly budgetMs: number
  readonly env: NodeJS.ProcessEnv | undefined
  readonly maxBufferBytes: number | undefined
  readonly killSignal: NodeJS.Signals | undefined
  readonly ownProcessGroup: boolean

  constructor({ bin, budgetMs, env, maxBufferBytes, killSignal, ownProcessGroup = false }: {
    bin: string, budgetMs: number, env?: NodeJS.ProcessEnv,
    maxBufferBytes?: number, killSignal?: NodeJS.Signals, ownProcessGroup?: boolean,
  }) {
    this.bin = bin
    this.budgetMs = budgetMs
    this.env = env
    this.maxBufferBytes = maxBufferBytes
    this.killSignal = killSignal
    this.ownProcessGroup = ownProcessGroup
    if (ownProcessGroup && (!Number.isInteger(maxBufferBytes) || maxBufferBytes! <= 0 || !Number.isInteger(budgetMs) || budgetMs <= 0)) {
      throw new Error('an owned process group requires positive time and output bounds')
    }
  }

  run(argv: string[], { cwd }: { cwd?: string } = {}): Promise<ProcessOutput> {
    if (this.ownProcessGroup) return this.#runOwned(argv, cwd)
    return new Promise((resolve) => {
      execFile(this.bin, argv, {
        timeout: this.budgetMs, cwd, env: this.env,
        ...(this.maxBufferBytes === undefined ? {} : { maxBuffer: this.maxBufferBytes }),
        ...(this.killSignal === undefined ? {} : { killSignal: this.killSignal }),
      }, (failure, stdout, stderr) => {
        resolve(new ProcessOutput({
          code: ToolRunner.#codeOf(failure),
          stdout,
          stderr: failure === null ? stderr : (stderr.trim() || failure.message),
        }))
      })
    })
  }

  #runOwned(argv: string[], cwd: string | undefined): Promise<ProcessOutput> {
    if (process.platform === 'win32') {
      return Promise.resolve(new ProcessOutput({ code: 1, stdout: '', stderr: 'owned process groups require a POSIX host' }))
    }
    return new Promise((resolve) => {
      const child = spawn(this.bin, argv, { cwd, env: this.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const output = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
      let finished = false
      const killGroup = () => {
        if (child.pid === undefined) return
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
      const finish = (code: number, reason: string) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        resolve(new ProcessOutput({
          code, stdout: output.stdout.toString('utf8'),
          stderr: reason || output.stderr.toString('utf8'),
        }))
      }
      const stop = (reason: string) => {
        killGroup()
        child.stdout.destroy()
        child.stderr.destroy()
        finish(1, reason)
      }
      const timer = setTimeout(() => stop('command exceeded its time budget'), this.budgetMs)
      const collect = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
        if (finished) return
        const remaining = this.maxBufferBytes! - output[stream].length
        output[stream] = Buffer.concat([output[stream], chunk.subarray(0, remaining)])
        if (chunk.length > remaining) stop('command exceeded its output budget')
      }
      child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk))
      child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk))
      child.once('error', (failure) => { killGroup(); finish(1, failure.message) })
      child.once('close', (code, signal) => { killGroup(); finish(code ?? 1, signal ?? '') })
    })
  }

  static #codeOf(failure: ExecFileException | null): number {
    if (failure === null) return 0

    return typeof failure.code === 'number' && Number.isInteger(failure.code)
      ? failure.code
      : ToolRunner.#UNKNOWN_EXIT
  }
}
