import { spawn } from 'node:child_process'
import { appendFileSync, closeSync, openSync } from 'node:fs'
import { PlanAgentNotLaunched } from '../domain/exceptions.js'

export class StartedRun {
  constructor({ pid }) {
    this.pid = pid
    Object.freeze(this)
  }
}

export class DetachedRun {
  static SIGNAL = 'SIGTERM'
  static APPEND = 'a'
  static GROUP_ALREADY_GONE = 'ESRCH'

  static #killGroupUnlessAlreadyGone(pid) {
    try {
      process.kill(-pid, DetachedRun.SIGNAL)
    } catch (failure) {
      if (failure.code !== DetachedRun.GROUP_ALREADY_GONE) throw failure
    }
  }

  constructor({ bin, budgetMs, env }) {
    this.bin = bin
    this.cap = budgetMs
    this.env = env
  }

  start({ argv, cwd, out, err }) {
    const outFd = openSync(out, DetachedRun.APPEND)
    const errFd = openSync(err, DetachedRun.APPEND)
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
    const timer = setTimeout(() => DetachedRun.#killGroupUnlessAlreadyGone(pid), this.cap)
    timer.unref()
    child.on('exit', () => clearTimeout(timer))
    child.unref()

    return new StartedRun({ pid })
  }
}
