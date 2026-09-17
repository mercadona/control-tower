import { execFile, spawn } from 'node:child_process'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  static readonly PIPE_BUFFER_BYTES = 65536

  readonly bin: string
  readonly budgetMs: number
  readonly env: NodeJS.ProcessEnv | undefined

  constructor({ bin, budgetMs, env }: { bin: string, budgetMs: number, env?: NodeJS.ProcessEnv }) {
    this.bin = bin
    this.budgetMs = budgetMs
    this.env = env
  }

  run(argv: string[], { cwd }: { cwd?: string } = {}): Promise<ProcessOutput> {
    return new Promise((resolve) => {
      execFile(this.bin, argv, { timeout: this.budgetMs, cwd, env: this.env }, (failure, stdout, stderr) => {
        resolve(new ProcessOutput({
          code: ToolRunner.#codeOf(failure),
          stdout,
          stderr: failure === null || (
            typeof failure.code === 'number' && !failure.killed && failure.signal == null
          )
            ? stderr
            : (stderr.trim() || failure.message),
        }))
      })
    })
  }

  async runWholeOutput(argv: string[], { cwd }: { cwd?: string } = {}): Promise<ProcessOutput> {
    const collected = join(await mkdtemp(join(tmpdir(), 'ct-whole-output-')), 'stdout')
    const sink = await open(collected, 'w')
    try {
      const said = await this.#spawned(argv, { cwd, stdout: sink.fd })
      return new ProcessOutput({ code: said.code, stdout: await readFile(collected, 'utf8'), stderr: said.stderr })
    } finally {
      await sink.close()
      await rm(dirname(collected), { recursive: true, force: true })
    }
  }

  #spawned(argv: string[], { cwd, stdout }: { cwd?: string, stdout: number }): Promise<{ code: number, stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.bin, argv, {
        cwd, env: this.env, timeout: this.budgetMs, stdio: ['ignore', stdout, 'pipe'],
      })
      let stderr = ''
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => { stderr += chunk })
      child.on('error', (failure: Error) => resolve({ code: ToolRunner.#UNKNOWN_EXIT, stderr: stderr.trim() || failure.message }))
      child.on('close', (code: number | null) => resolve({ code: code ?? ToolRunner.#UNKNOWN_EXIT, stderr }))
    })
  }

  static #codeOf(failure: ExecFileException | null): number {
    if (failure === null) return 0

    return typeof failure.code === 'number' && Number.isInteger(failure.code)
      ? failure.code
      : ToolRunner.#UNKNOWN_EXIT
  }
}
