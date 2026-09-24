import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ProcessRunner, RunFailure } from './process-runner.ts'

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

export type ProcessOwnership = {
  readonly pid: number,
  readonly processGroup?: number,
}

export type RunOptions = {
  readonly cwd?: string,
  readonly onSpawn?: (ownership: ProcessOwnership) => Promise<void>,
  readonly ownedProcessGroup?: boolean,
}

export class ToolRunner {
  static readonly #UNKNOWN_EXIT = 1
  static readonly PIPE_BUFFER_BYTES = 65536

  readonly bin: string
  readonly budgetMs: number
  readonly env: NodeJS.ProcessEnv | undefined
  readonly processes: ProcessRunner

  constructor({ bin, budgetMs, env, processes }: {
    bin: string, budgetMs: number, env?: NodeJS.ProcessEnv, processes: ProcessRunner,
  }) {
    this.bin = bin
    this.budgetMs = budgetMs
    this.env = env
    this.processes = processes
  }

  async run(argv: string[], { cwd }: RunOptions = {}): Promise<ProcessOutput> {
    const outcome = await this.processes.runAndWait(this.bin, argv, { cwd, env: this.env, timeoutMs: this.budgetMs })

    return new ProcessOutput({
      code: ToolRunner.#codeOf(outcome.failure),
      stdout: outcome.stdout,
      stderr: outcome.failure === null || (
        typeof outcome.failure.code === 'number' && !outcome.failure.killed && outcome.failure.signal == null
      )
        ? outcome.stderr
        : (outcome.stderr.trim() || outcome.failure.message),
    })
  }

  async runWholeOutput(argv: string[], options: RunOptions = {}): Promise<ProcessOutput> {
    const collected = join(await mkdtemp(join(tmpdir(), 'ct-whole-output-')), 'stdout')
    const sink = await open(collected, 'w')
    try {
      const said = await this.#spawned(argv, { ...options, stdout: sink.fd })
      return new ProcessOutput({ code: said.code, stdout: await readFile(collected, 'utf8'), stderr: said.stderr })
    } finally {
      await sink.close()
      await rm(dirname(collected), { recursive: true, force: true })
    }
  }

  #spawned(
    argv: string[],
    { cwd, stdout, onSpawn, ownedProcessGroup }: RunOptions & { stdout: number },
  ): Promise<{ code: number, stderr: string }> {
    return new Promise((resolve) => {
      const child = this.processes.launch(this.bin, argv, {
        cwd, env: this.env, timeout: this.budgetMs, stdio: ['ignore', stdout, 'pipe'], detached: ownedProcessGroup,
      })
      let stderr = ''
      let settled = false
      const finish = (said: { code: number, stderr: string }) => {
        if (settled) return
        settled = true
        resolve(said)
      }
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => { stderr += chunk })
      child.on('error', (failure: Error) => finish({ code: ToolRunner.#UNKNOWN_EXIT, stderr: stderr.trim() || failure.message }))
      child.on('close', (code: number | null) => finish({ code: code ?? ToolRunner.#UNKNOWN_EXIT, stderr }))
      if (onSpawn !== undefined && child.pid !== undefined) {
        const ownership = ownedProcessGroup === true && process.platform !== 'win32'
          ? { pid: child.pid, processGroup: child.pid }
          : { pid: child.pid }
        void onSpawn(ownership).catch((failure: unknown) => {
          if (ownership.processGroup === undefined) child.kill('SIGTERM')
          else {
            try { process.kill(-ownership.processGroup, 'SIGTERM') } catch {}
          }
          finish({ code: ToolRunner.#UNKNOWN_EXIT, stderr: `process ownership could not be recorded: ${String(failure)}` })
        })
      }
    })
  }

  static #codeOf(failure: RunFailure | null): number {
    if (failure === null) return 0

    return typeof failure.code === 'number' && Number.isInteger(failure.code)
      ? failure.code
      : ToolRunner.#UNKNOWN_EXIT
  }
}
