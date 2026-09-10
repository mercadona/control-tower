import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolRunner } from '../../src/infrastructure/tool-runner.ts'

class DiagnosticChildren {
  static readonly pids: number[] = []

  static stop(): void {
    for (const pid of DiagnosticChildren.pids.splice(0)) {
      try { process.kill(pid, 'SIGKILL') } catch {}
    }
  }
}

afterEach(() => { DiagnosticChildren.stop(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('ToolRunner explicit diagnostic bounds', () => {
  it('rejects_output_beyond_the_owned_group_limit', async () => {
    const runner = new ToolRunner({ bin: process.execPath, budgetMs: 30_000, ownedProcessGroup: { maxBufferBytes: 64 } })
    const result = await runner.run(['-e', 'process.stdout.write("x".repeat(256))'])
    expect(result.code).toBe(125)
    expect(result.stdout.length).toBeLessThanOrEqual(64)
  })

  it('expires_the_command_when_the_controlled_deadline_is_reached', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const signals = vi.spyOn(process, 'kill')
    const runner = new ToolRunner({ bin: process.execPath, budgetMs: 1_000, ownedProcessGroup: { maxBufferBytes: 64 } })
    const running = runner.run(['-e', 'setTimeout(()=>{},5000)'])
    await vi.advanceTimersByTimeAsync(1_000)
    const result = await running
    expect(result.code).toBe(125)
    expect(result.stderr).toBe('command exceeded its time budget')
    expect(signals.mock.calls.some(([pid, signal]) => pid < 0 && signal === 'SIGKILL')).toBe(true)
  })

  it('terminates_a_ready_descendant_when_the_output_bound_is_exceeded', async () => {
    const runner = new ToolRunner({
      bin: process.execPath, budgetMs: 30_000, ownedProcessGroup: { maxBufferBytes: 4_096 },
    })
    const result = await runner.run(['-e',
      'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","process.send(1);setTimeout(()=>{},10000)"],{stdio:["ignore","inherit","inherit","ipc"]}); child.once("message",()=>{console.log(child.pid);process.stdout.write("x".repeat(8192));});',
    ])
    const pid = Number(result.stdout.split('\n')[0])
    if (Number.isInteger(pid) && pid > 0) DiagnosticChildren.pids.push(pid)
    expect(result.code, result.stderr).toBe(125)
    expect(result.stderr).toBe('command exceeded its output budget')
    expect(pid).toBeGreaterThan(0)
    await expect.poll(() => {
      try { process.kill(pid, 0); return true } catch { return false }
    }).toBe(false)
  })

  it('preserves_a_completed_commands_exit_code_one', async () => {
    const runner = new ToolRunner({ bin: process.execPath, budgetMs: 30_000, ownedProcessGroup: { maxBufferBytes: 64 } })
    expect((await runner.run(['-e', 'process.exit(1)'])).code).toBe(1)
  })
})
