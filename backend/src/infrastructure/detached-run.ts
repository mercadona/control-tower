import { spawn } from 'node:child_process'
import { appendFileSync, closeSync, openSync } from 'node:fs'
import { PlanAgentNotLaunched } from '../domain/exceptions.ts'

export type RunSpec = { argv: string[], cwd: string, out: string, err: string }
export type StartedPid = { readonly pid: number }

export class StartedRun implements StartedPid {
  readonly pid: number

  constructor({ pid }: { pid: number }) {
    this.pid = pid
    Object.freeze(this)
  }
}

export class DetachedRun {
  static readonly SIGNAL = 'SIGTERM'
  static readonly APPEND = 'a'
  static readonly #GROUP_ALREADY_GONE = 'ESRCH'

  readonly bin: string
  readonly budgetMs: number
  readonly env: NodeJS.ProcessEnv

  constructor({ bin, budgetMs, env }: { bin: string, budgetMs: number, env: NodeJS.ProcessEnv }) {
    this.bin = bin
    this.budgetMs = budgetMs
    this.env = env
  }

  start({ argv, cwd, out, err }: RunSpec): StartedRun {
    const { outFd, errFd } = DetachedRun.#openPair(out, err)
    const child = spawn(this.bin, argv, {
      cwd,
      env: this.env,
      detached: true,
      stdio: ['ignore', outFd, errFd],
    })
    closeSync(outFd)
    closeSync(errFd)
    child.on('error', (failure) => {
      appendFileSync(err, `${failure.message}\n`)
    })
    if (child.pid === undefined) {
      throw new PlanAgentNotLaunched(`spawn assigned no pid to ${JSON.stringify(this.bin)}`)
    }
    const pid = child.pid
    const timer = setTimeout(() => DetachedRun.#killGroupUnlessAlreadyGone(pid), this.budgetMs)
    timer.unref()
    child.on('exit', () => clearTimeout(timer))
    child.unref()

    return new StartedRun({ pid })
  }

  stop(started: StartedPid): void {
    DetachedRun.#killGroupUnlessAlreadyGone(started.pid)
  }

  static #killGroupUnlessAlreadyGone(pid: number): void {
    try {
      process.kill(-pid, DetachedRun.SIGNAL)
    } catch (failure) {
      const errno: NodeJS.ErrnoException | null = failure instanceof Error ? failure : null
      if (errno?.code !== DetachedRun.#GROUP_ALREADY_GONE) throw failure
    }
  }

  static #openPair(out: string, err: string): { outFd: number, errFd: number } {
    const outFd = openSync(out, DetachedRun.APPEND)
    try {
      return { outFd, errFd: openSync(err, DetachedRun.APPEND) }
    } catch (failure) {
      closeSync(outFd)
      throw failure
    }
  }
}
