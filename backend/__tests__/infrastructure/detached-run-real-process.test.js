import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { closeSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DetachedRun } from '../../src/infrastructure/detached-run.js'
import { PlanAgentNotLaunched } from '../../src/domain/exceptions.js'

class Files {
  static PROBE_FLAG = 'a'

  static named() {
    const directory = mkdtempSync(join(tmpdir(), 'ct-detached-run-'))

    return { out: join(directory, 'out.log'), err: join(directory, 'err.log') }
  }

  static lowestFreeDescriptorProbedAgainst(path) {
    const fd = openSync(path, Files.PROBE_FLAG)
    closeSync(fd)

    return fd
  }
}

class Child {
  static SLOW_MS = 5_000
  static DEFAULT_BUDGET_MS = 30_000
  static MARKER = 'printed-by-the-child'
  static INHERITED = 'CT_DETACHED_RUN_INHERITED'
  static #groupsStarted = []
  static #soloProcessesStarted = []

  static running(budgetMs = Child.DEFAULT_BUDGET_MS) {
    return new DetachedRun({ bin: process.execPath, budgetMs })
  }

  static printing(marker) {
    return ['-e', `process.stdout.write(${JSON.stringify(marker)})`]
  }

  static printingToBoth(marker) {
    return ['-e', `process.stdout.write(${JSON.stringify(marker)}); process.stderr.write(${JSON.stringify(marker)})`]
  }

  static sleeping(ms = Child.SLOW_MS) {
    return ['-e', `setTimeout(() => {}, ${ms})`]
  }

  static exitingCleanly() {
    return ['-e', "process.on('exit', (code) => { require('fs').writeSync(1, String(code)) })"]
  }

  static trappingSigterm() {
    return ['-e', `
      process.on('SIGTERM', () => {
        require('fs').writeSync(1, 'trapped-sigterm')
        process.exit(0)
      })
      setTimeout(() => {}, ${Child.SLOW_MS})
    `]
  }

  static spawningAGrandchild() {
    return ['-e', `
      const grandchild = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${Child.SLOW_MS})'], { stdio: 'ignore' })
      process.stdout.write(String(grandchild.pid))
      setTimeout(() => {}, ${Child.SLOW_MS})
    `]
  }

  static pgidOf(pid) {
    return execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)]).toString().trim()
  }

  static alive(pid) {
    try {
      process.kill(pid, 0)

      return true
    } catch {
      return false
    }
  }

  static trackedGroup(pid) {
    Child.#groupsStarted.push(pid)

    return pid
  }

  static tracked(startedRun) {
    Child.trackedGroup(startedRun.pid)

    return startedRun
  }

  static killEveryGroupStarted() {
    for (const pid of Child.#groupsStarted.splice(0)) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        continue
      }
    }
  }

  static trackedSolo(pid) {
    Child.#soloProcessesStarted.push(pid)

    return pid
  }

  static killEverySoloProcessStarted() {
    for (const pid of Child.#soloProcessesStarted.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        continue
      }
    }
  }

  static inheritedByApi() {
    process.env[Child.INHERITED] = 'from the api'
  }

  static forgotten() {
    delete process.env[Child.INHERITED]
  }

  static async eventually(check, { timeoutMs = 5_000, everyMs = 20 } = {}) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = check()
      if (value) return value
      if (Date.now() > deadline) throw new Error('timed out waiting for the condition')
      await new Promise((wake) => setTimeout(wake, everyMs))
    }
  }
}

class ChildExitRace {
  static beforeTheModuleAttachesItsOwnExitListener(startTheRun) {
    const originalOn = EventEmitter.prototype.on
    let child = null
    EventEmitter.prototype.on = function (event, listener) {
      if (event === 'exit' && child === null) child = this

      return originalOn.call(this, event, listener)
    }
    try {
      const started = startTheRun()

      return { started, child }
    } finally {
      EventEmitter.prototype.on = originalOn
    }
  }

  static onceTheChildExitsButBeforeTheModuleReactsToIt(child, act) {
    return new Promise((resolve) => {
      child.prependListener('exit', () => {
        act()
        resolve()
      })
    })
  }
}

class Wrapper {
  static #HERE = dirname(fileURLToPath(import.meta.url))
  static #MODULE_URL = pathToFileURL(
    join(Wrapper.#HERE, '..', '..', 'src', 'infrastructure', 'detached-run.js')
  ).href

  static callingStartAndThenDoingNothingElse({ cap, out, err }) {
    return ['-e', `
      import(${JSON.stringify(Wrapper.#MODULE_URL)}).then(({ DetachedRun }) => {
        const run = new DetachedRun({ bin: process.execPath, budgetMs: ${cap}, env: undefined })
        const started = run.start({
          argv: ['-e', 'setTimeout(() => {}, 60000)'],
          cwd: process.cwd(),
          out: ${JSON.stringify(out)},
          err: ${JSON.stringify(err)},
        })
        process.stdout.write(String(started.pid))
      }).catch((failure) => {
        process.stderr.write(failure.stack)
        process.exitCode = 2
      })
    `]
  }
}

describe('DetachedRun', () => {
  afterEach(() => {
    Child.killEveryGroupStarted()
    Child.killEverySoloProcessStarted()
    Child.forgotten()
    vi.restoreAllMocks()
  })

  it('what_the_call_prints_lands_in_the_file_the_caller_named', async () => {
    const files = Files.named()
    const run = Child.running()

    Child.tracked(
      run.start({ argv: Child.printing(Child.MARKER), cwd: process.cwd(), out: files.out, err: files.err })
    )

    const printed = await Child.eventually(() => {
      const text = readFileSync(files.out, 'utf8')

      return text.length > 0 ? text : null
    })

    expect(printed).toBe(Child.MARKER)
  })

  it('the_started_run_handed_back_to_the_caller_is_frozen_so_nothing_downstream_can_mutate_it', async () => {
    const files = Files.named()
    const run = Child.running()

    const started = Child.tracked(
      run.start({ argv: Child.sleeping(), cwd: process.cwd(), out: files.out, err: files.err })
    )

    expect(Object.isFrozen(started)).toBe(true)
  })

  it('the_call_gets_a_process_group_of_its_own_so_the_cap_can_reach_what_it_launched', async () => {
    const files = Files.named()
    const run = Child.running()

    const started = Child.tracked(
      run.start({ argv: Child.sleeping(), cwd: process.cwd(), out: files.out, err: files.err })
    )

    const pgid = await Child.eventually(() => {
      try {
        return Child.pgidOf(started.pid)
      } catch {
        return null
      }
    })

    expect(pgid).toBe(String(started.pid))
  })

  it('the_cap_kills_the_whole_group_so_a_tool_the_call_launched_is_not_left_orphaned', async () => {
    const files = Files.named()
    const run = Child.running(250)

    const started = Child.tracked(
      run.start({ argv: Child.spawningAGrandchild(), cwd: process.cwd(), out: files.out, err: files.err })
    )

    const grandchildPid = Number(await Child.eventually(() => {
      const text = readFileSync(files.out, 'utf8')

      return text.length > 0 ? text : null
    }))

    await Child.eventually(() => (Child.alive(started.pid) ? null : true), { timeoutMs: 3_000 })

    expect(Child.alive(started.pid)).toBe(false)
    expect(Child.alive(grandchildPid)).toBe(false)
  })

  it('the_cap_sends_sigterm_so_a_tool_trapping_it_gets_the_chance_to_leave_on_its_own_terms', async () => {
    const files = Files.named()
    const run = Child.running(250)

    Child.tracked(
      run.start({ argv: Child.trappingSigterm(), cwd: process.cwd(), out: files.out, err: files.err })
    )

    const printed = await Child.eventually(() => {
      const text = readFileSync(files.out, 'utf8')

      return text.length > 0 ? text : null
    }, { timeoutMs: 3_000 })

    expect(printed).toBe('trapped-sigterm')
  })

  it('a_call_that_finishes_inside_its_cap_leaves_its_own_exit_code_in_out', async () => {
    const files = Files.named()
    const run = Child.running(5_000)

    Child.tracked(
      run.start({ argv: Child.exitingCleanly(), cwd: process.cwd(), out: files.out, err: files.err })
    )

    const printed = await Child.eventually(() => {
      const text = readFileSync(files.out, 'utf8')

      return text.length > 0 ? text : null
    })

    expect(printed).toBe('0')
  })

  it('a_call_that_finished_is_never_signalled_once_its_cap_comes_round', async () => {
    const files = Files.named()
    const budgetMs = 300
    const run = Child.running(budgetMs)
    const kill = vi.spyOn(process, 'kill')

    const started = Child.tracked(
      run.start({ argv: Child.exitingCleanly(), cwd: process.cwd(), out: files.out, err: files.err })
    )

    await Child.eventually(() => {
      const text = readFileSync(files.out, 'utf8')

      return text.length > 0 ? text : null
    })

    await new Promise((wake) => setTimeout(wake, budgetMs + 500))

    expect(kill).not.toHaveBeenCalledWith(-started.pid, DetachedRun.SIGNAL)
  })

  describe('when the cap races the child exiting on its own', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('the_cap_firing_on_a_group_that_is_already_gone_does_not_take_the_api_down_with_it', async () => {
      const files = Files.named()
      const budgetMs = 10_000
      const run = Child.running(budgetMs)
      const { started, child } = ChildExitRace.beforeTheModuleAttachesItsOwnExitListener(() =>
        run.start({ argv: Child.exitingCleanly(), cwd: process.cwd(), out: files.out, err: files.err })
      )
      Child.tracked(started)

      let groupWasAlreadyGone = null
      let firingTheCap = null
      await ChildExitRace.onceTheChildExitsButBeforeTheModuleReactsToIt(child, () => {
        try {
          process.kill(-started.pid, 0)
        } catch (probe) {
          groupWasAlreadyGone = probe.code
        }
        try {
          vi.advanceTimersByTime(budgetMs)
        } catch (failure) {
          firingTheCap = failure
        }
      })

      expect(groupWasAlreadyGone).toBe('ESRCH')
      expect(firingTheCap).toBeNull()
    })
  })

  it('a_binary_that_is_not_installed_raises_without_taking_the_api_down_with_it', async () => {
    const files = Files.named()
    const run = new DetachedRun({ bin: 'ct-detached-run-missing-binary', budgetMs: 5_000 })

    let thrown = null
    try {
      run.start({ argv: [], cwd: process.cwd(), out: files.out, err: files.err })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(PlanAgentNotLaunched)
    expect(thrown.message).toContain('ct-detached-run-missing-binary')

    const writtenToErr = await Child.eventually(() => {
      const text = readFileSync(files.err, 'utf8')

      return text.length > 0 ? text : null
    })

    const nodeOwnDiagnosticCapturedByHandFromASeparateSpawnOfTheSameMissingBinary =
      'spawn ct-detached-run-missing-binary ENOENT\n'

    expect(writtenToErr).toBe(nodeOwnDiagnosticCapturedByHandFromASeparateSpawnOfTheSameMissingBinary)
  })

  it('what_was_already_in_either_file_survives_because_the_call_opens_both_to_append', async () => {
    const files = Files.named()
    writeFileSync(files.out, 'already out\n')
    writeFileSync(files.err, 'already err\n')
    const run = Child.running()

    Child.tracked(
      run.start({ argv: Child.printingToBoth(Child.MARKER), cwd: process.cwd(), out: files.out, err: files.err })
    )

    const printedOut = await Child.eventually(() => {
      const text = readFileSync(files.out, 'utf8')

      return text.includes(Child.MARKER) ? text : null
    })
    const printedErr = await Child.eventually(() => {
      const text = readFileSync(files.err, 'utf8')

      return text.includes(Child.MARKER) ? text : null
    })

    expect(printedOut).toBe(`already out\n${Child.MARKER}`)
    expect(printedErr).toBe(`already err\n${Child.MARKER}`)
  })

  it('the_environment_the_caller_composed_is_what_the_child_reads_and_the_one_the_api_inherited_is_gone', async () => {
    Child.inheritedByApi()
    const files = Files.named()
    const run = new DetachedRun({
      bin: process.execPath, budgetMs: Child.DEFAULT_BUDGET_MS, env: { CT_DETACHED_RUN_GIVEN: 'from the caller' },
    })

    Child.tracked(
      run.start({
        argv: ['-e', `process.stdout.write(
          String(process.env.CT_DETACHED_RUN_GIVEN) + '|' + String(process.env.${Child.INHERITED})
        )`],
        cwd: process.cwd(),
        out: files.out,
        err: files.err,
      })
    )

    const printed = await Child.eventually(() => {
      const text = readFileSync(files.out, 'utf8')

      return text.length > 0 ? text : null
    })

    expect(printed).toBe('from the caller|undefined')
  })

  it('the_directory_the_caller_names_is_where_the_child_runs_and_not_where_the_api_happens_to_run', async () => {
    const files = Files.named()
    const elsewhere = realpathSync(tmpdir())
    const run = Child.running()

    Child.tracked(
      run.start({
        argv: ['-e', 'process.stdout.write(process.cwd())'],
        cwd: elsewhere,
        out: files.out,
        err: files.err,
      })
    )

    const printed = await Child.eventually(() => {
      const text = readFileSync(files.out, 'utf8')

      return text.length > 0 ? text : null
    })

    expect(printed).toBe(elsewhere)
    expect(printed).not.toBe(process.cwd())
  })

  it('the_descriptors_this_process_opened_for_the_files_are_closed_once_the_child_has_its_own_copy', async () => {
    const files = Files.named()
    const run = Child.running()

    const beforeStart = Files.lowestFreeDescriptorProbedAgainst(files.out)

    Child.tracked(
      run.start({ argv: Child.sleeping(), cwd: process.cwd(), out: files.out, err: files.err })
    )

    const afterStart = Files.lowestFreeDescriptorProbedAgainst(files.out)

    expect(afterStart).toBe(beforeStart)
  })

  it('the_process_that_called_start_is_free_to_exit_right_away_because_nothing_it_holds_keeps_its_loop_open', async () => {
    const files = Files.named()
    const wrapper = spawn(
      process.execPath,
      Wrapper.callingStartAndThenDoingNothingElse({ cap: 60_000, out: files.out, err: files.err }),
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    Child.trackedSolo(wrapper.pid)
    let stdout = ''
    let stderr = ''
    wrapper.stdout.on('data', (chunk) => { stdout += chunk })
    wrapper.stderr.on('data', (chunk) => { stderr += chunk })

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ exited: false, code: null }), 2_000)
      wrapper.once('exit', (code) => {
        clearTimeout(timer)
        resolve({ exited: true, code })
      })
    })

    const launchedPid = Number(stdout.trim())
    if (Number.isInteger(launchedPid) && launchedPid > 0) Child.trackedGroup(launchedPid)

    expect(stderr).toBe('')
    expect(result).toEqual({ exited: true, code: 0 })
  })
})
