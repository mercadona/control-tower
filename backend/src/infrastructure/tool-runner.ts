import { execFile } from 'node:child_process'
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
          stderr: failure === null ? stderr : (stderr.trim() || failure.message),
        }))
      })
    })
  }

  static #codeOf(failure: ExecFileException | null): number {
    if (failure === null) return 0

    return typeof failure.code === 'number' && Number.isInteger(failure.code)
      ? failure.code
      : ToolRunner.#UNKNOWN_EXIT
  }
}
