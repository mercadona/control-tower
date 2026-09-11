import { describe, it, expect, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DetachedRun } from '../../src/infrastructure/detached-run.ts'
import type { StartedRun } from '../../src/infrastructure/detached-run.ts'
import { PlanAgentNotLaunched } from '../../src/domain/exceptions.ts'

type Poll<T> = () => T | null
type WaitOptions = { timeoutMs?: number, everyMs?: number }

class Files {
  static #directoriesCreated: string[] = []

  static named(): { out: string, err: string } {
    const directory = mkdtempSync(join(tmpdir(), 'ct-detached-run-'))
    Files.#directoriesCreated.push(directory)

    return { out: join(directory, 'out.log'), err: join(directory, 'err.log') }
  }

  static reapEveryDirectoryCreated(): void {
    for (const directory of Files.#directoriesCreated.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

class Child {
  static SLOW_MS = 5_000
  static DEFAULT_BUDGET_MS = 30_000
  static MARKER = 'printed-by-the-child'
  static MISSING_BINARY = 'ct-detached-run-missing-binary'
  static #groupsStarted: number[] = []

  static running(budgetMs: number = Child.DEFAULT_BUDGET_MS): DetachedRun {
    return new DetachedRun({ bin: process.execPath, budgetMs, env: process.env })
  }

  static printing(marker: string): string[] {
    return ['-e', `process.stdout.write(${JSON.stringify(marker)})`]
  }

  static sleeping(ms: number = Child.SLOW_MS): string[] {
    return ['-e', `setTimeout(() => {}, ${ms})`]
  }

  static exitingCleanly(): string[] {
    return ['-e', "process.on('exit', (code) => { require('fs').writeSync(1, String(code)) })"]
  }

  static spawningAGrandchild(): string[] {
    return ['-e', `
      const grandchild = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${Child.SLOW_MS})'], { stdio: 'ignore' })
      process.stdout.write(String(grandchild.pid))
      setTimeout(() => {}, ${Child.SLOW_MS})
    `]
  }

  static pgidOf(pid: number): string {
    return execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)]).toString().trim()
  }

  static alive(pid: number): boolean {
    try {
      process.kill(pid, 0)

      return true
    } catch {
      return false
    }
  }

  static tracked(startedRun: StartedRun): StartedRun {
    Child.#groupsStarted.push(startedRun.pid)

    return startedRun
  }

  static killEveryGroupStarted(): void {
    for (const pid of Child.#groupsStarted.splice(0)) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        continue
      }
    }
  }

  static async eventually<T>(check: Poll<T>, { timeoutMs = 5_000, everyMs = 20 }: WaitOptions = {}): Promise<T> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = check()
      if (value) return value
      if (Date.now() > deadline) throw new Error('timed out waiting for the condition')
      await new Promise<void>((wake) => setTimeout(wake, everyMs))
    }
  }

  static eventuallyPrinted(path: string, options?: WaitOptions): Promise<string> {
    return Child.eventually(() => {
      const text = readFileSync(path, 'utf8')

      return text.length > 0 ? text : null
    }, options)
  }
}

describe('DetachedRun', () => {
  afterEach(() => {
    Child.killEveryGroupStarted()
    vi.restoreAllMocks()
    Files.reapEveryDirectoryCreated()
  })

  it('what_the_call_prints_lands_in_the_file_the_caller_named', async () => {
    const files = Files.named()
    const run = Child.running()

    Child.tracked(
      run.start({ argv: Child.printing(Child.MARKER), cwd: process.cwd(), out: files.out, err: files.err })
    )

    const printed = await Child.eventuallyPrinted(files.out)

    expect(printed).toBe(Child.MARKER)
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
    const grandchildPid = Number(await Child.eventuallyPrinted(files.out))

    await Child.eventually(() => (Child.alive(started.pid) ? null : true), { timeoutMs: 3_000 })
    await Child.eventually(() => (Child.alive(grandchildPid) ? null : true), { timeoutMs: 3_000 })

    expect(Child.alive(started.pid)).toBe(false)
    expect(Child.alive(grandchildPid)).toBe(false)
  })

  it('a_call_that_finishes_inside_its_cap_leaves_its_own_exit_code_in_out', async () => {
    const files = Files.named()
    const run = Child.running(5_000)

    Child.tracked(
      run.start({ argv: Child.exitingCleanly(), cwd: process.cwd(), out: files.out, err: files.err })
    )

    const printed = await Child.eventuallyPrinted(files.out)

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

    await Child.eventuallyPrinted(files.out)
    await new Promise<void>((wake) => setTimeout(wake, budgetMs + 500))

    expect(kill).not.toHaveBeenCalledWith(-started.pid, DetachedRun.SIGNAL)
  })

  it('a_binary_that_is_not_installed_raises_without_taking_the_api_down_with_it', async () => {
    const files = Files.named()
    const run = new DetachedRun({ bin: Child.MISSING_BINARY, budgetMs: 5_000, env: process.env })

    let thrown: unknown = null
    try {
      run.start({ argv: [], cwd: process.cwd(), out: files.out, err: files.err })
    } catch (error) {
      thrown = error
    }

    if (!(thrown instanceof PlanAgentNotLaunched)) throw new Error('expected a PlanAgentNotLaunched')
    expect(thrown.message).toContain(Child.MISSING_BINARY)

    const writtenToErr = await Child.eventuallyPrinted(files.err)

    expect(writtenToErr).toContain(Child.MISSING_BINARY)
    expect(writtenToErr).toContain('ENOENT')
  })
})
