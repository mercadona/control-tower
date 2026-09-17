import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ToolRunner } from '../../src/infrastructure/tool-runner.ts'

const tracked = vi.hoisted(() => ({ children: new Set<ChildProcess>() }))

vi.mock('node:child_process', async (importOriginal) => {
  const native = await importOriginal<typeof import('node:child_process')>()
  return {
    ...native,
    execFile: vi.fn(((...args: unknown[]) => {
      const child = (native.execFile as (...asked: unknown[]) => ChildProcess)(...args)
      tracked.children.add(child)
      return child
    }) as typeof native.execFile),
  }
})

class Node {
  static SLOW_MS = 5_000
  static INHERITED = 'CT_TOOL_RUNNER_INHERITED'
  static GIVEN = 'CT_TOOL_RUNNER_GIVEN'

  static running(budgetMs: number) {
    return new ToolRunner({ bin: process.execPath, budgetMs })
  }

  static sleeping() {
    return ['-e', `setTimeout(() => {}, ${Node.SLOW_MS})`]
  }

  static withEnvironment(env: NodeJS.ProcessEnv) {
    return new ToolRunner({ bin: process.execPath, budgetMs: 30_000, env })
  }

  static printing(variable: string) {
    return ['-e', `process.stdout.write(String(process.env.${variable}))`]
  }

  static started() {
    process.env[Node.INHERITED] = 'from the api'
  }

  static forgotten() {
    delete process.env[Node.INHERITED]
  }
}

describe('ToolRunner', () => {
  async function stopChildren(): Promise<void> {
    const children = [...tracked.children]
    tracked.children.clear()
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
      const closed = once(child, 'close')
      try {
        child.kill('SIGKILL')
      } catch (cause) {
        if (!(cause instanceof Error && 'code' in cause && cause.code === 'ESRCH')) throw cause
      }
      await closed
    }))
  }

  afterEach(async () => {
    try {
      await stopChildren()
    } finally {
      Node.forgotten()
      vi.clearAllMocks()
    }
  })

  it('what_the_tool_prints_comes_back_with_the_code_that_says_it_went_well', async () => {
    const output = await Node.running(30_000).run(['-e', 'process.stdout.write("printed")'])

    expect(output.stdout).toBe('printed')
    expect(output.code).toBe(0)
    expect(output.failed).toBe(false)
  })

  it('a_tool_that_outlives_its_budget_is_killed_instead_of_holding_the_request_open', async () => {
    const started = Date.now()

    const output = await Node.running(250).run(Node.sleeping())

    expect(output.failed).toBe(true)
    expect(output.stderr).not.toBe('')
    expect(Date.now() - started).toBeLessThan(Node.SLOW_MS)
  })

  it('runner teardown stops a live child independently of its timeout', async () => {
    const started = Date.now()
    const running = Node.running(30_000).run(['-e', [
      'process.stdout.write("ready\\n")',
      'setInterval(() => {}, 1_000)',
    ].join(';')])
    const child = [...tracked.children][0]
    expect(child).toBeDefined()
    await once(child.stdout!, 'data')
    const sentinel = new Error('abort after child readiness')
    let aborted: unknown
    try {
      throw sentinel
    } catch (cause) {
      aborted = cause
    } finally {
      await stopChildren()
    }
    const output = await running

    expect(aborted).toBe(sentinel)
    expect(output.failed).toBe(true)
    expect(child.signalCode).toBe('SIGKILL')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('timeout exits keep a diagnostic even when the child exits numerically', async () => {
    const running = Node.running(5_000).run(['-e', [
      'process.stdout.write("ready\\n")',
      'process.on("SIGTERM", () => process.exit(1))',
      'setInterval(() => {}, 1_000)',
    ].join(';')])
    const child = [...tracked.children][0]
    expect(child).toBeDefined()
    const output = await running

    expect(output).toMatchObject({ code: 1, stdout: 'ready\n' })
    expect(output.stderr).not.toBe('')
    expect(child.exitCode).toBe(1)
    expect(child.signalCode).toBeNull()
  })

  it('a_tool_that_refuses_is_a_code_and_a_reason_and_not_something_thrown_at_the_caller', async () => {
    const output = await Node.running(30_000)
      .run(['-e', 'process.stderr.write("no such work item"); process.exit(3)'])

    expect(output.code).toBe(3)
    expect(output.stderr).toBe('no such work item')
  })

  it('a normal nonzero exit preserves an actually empty stderr channel', async () => {
    const output = await Node.running(30_000).run(['-e', 'process.exit(1)'])

    expect(output).toMatchObject({ code: 1, stdout: '', stderr: '' })
  })

  it('what_the_tool_printed_before_refusing_is_kept_because_the_adapter_may_have_to_read_it', async () => {
    const output = await Node.running(30_000)
      .run(['-e', 'process.stdout.write("half an answer"); process.exit(1)'])

    expect(output.stdout).toBe('half an answer')
    expect(output.failed).toBe(true)
  })

  it('a_tool_that_is_not_installed_is_a_refusal_with_a_reason_and_not_an_empty_channel', async () => {
    const output = await new ToolRunner({ bin: 'ct-no-such-tool', budgetMs: 30_000 }).run(['whatever'])

    expect(output.failed).toBe(true)
    expect(output.stderr).toContain('ct-no-such-tool')
  })

  it('the_directory_the_caller_names_is_where_the_tool_runs_and_not_where_the_api_was_started', async () => {
    const elsewhere = realpathSync(tmpdir())

    const output = await Node.running(30_000)
      .run(['-e', 'process.stdout.write(process.cwd())'], { cwd: elsewhere })

    expect(output.stdout).toBe(elsewhere)
    expect(output.stdout).not.toBe(process.cwd())
  })

  it('a_call_that_names_no_directory_still_runs_where_the_api_was_started', async () => {
    const output = await Node.running(30_000).run(['-e', 'process.stdout.write(process.cwd())'])

    expect(output.stdout).toBe(process.cwd())
  })

  it('the_environment_the_caller_composed_is_what_the_tool_reads_and_the_one_the_api_inherited_is_gone', async () => {
    Node.started()
    const runner = Node.withEnvironment({ [Node.GIVEN]: 'from the caller' })

    const given = await runner.run(Node.printing(Node.GIVEN))
    const dropped = await runner.run(Node.printing(Node.INHERITED))

    expect(given.stdout).toBe('from the caller')
    expect(dropped.stdout).toBe('undefined')
  })

  it('a_runner_that_names_no_environment_hands_the_tool_the_one_the_api_was_started_with', async () => {
    Node.started()

    const output = await Node.running(30_000).run(Node.printing(Node.INHERITED))

    expect(output.stdout).toBe('from the api')
  })
})
