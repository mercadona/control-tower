import { afterEach, describe, expect, it } from 'vitest'
import { ToolRunner } from '../../src/infrastructure/tool-runner.ts'

class DiagnosticChildren {
  static readonly pids: number[] = []

  static stop(): void {
    for (const pid of DiagnosticChildren.pids.splice(0)) {
      try { process.kill(pid, 'SIGKILL') } catch {}
    }
  }
}

afterEach(() => DiagnosticChildren.stop())

describe('ToolRunner explicit diagnostic bounds', () => {
  it.each([false, true])('rejects_output_beyond_the_injected_limit_with_owned_group_%s', async (ownProcessGroup) => {
    const runner = new ToolRunner({ bin: process.execPath, budgetMs: 2_000, maxBufferBytes: 64, killSignal: 'SIGKILL', ownProcessGroup })
    const result = await runner.run(['-e', 'process.stdout.write("x".repeat(256))'])
    expect(result.failed).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(64)
  })

  it('terminates_owned_descendants_before_returning_a_timeout', async () => {
    const runner = new ToolRunner({
      bin: process.execPath, budgetMs: 1_000, maxBufferBytes: 256,
      killSignal: 'SIGKILL', ownProcessGroup: true,
    })
    const started = Date.now()
    const result = await runner.run(['-e',
      'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setTimeout(()=>{},5000)"],{stdio:["ignore","inherit","inherit"]}); console.log(child.pid); setTimeout(()=>{},10000);',
    ])
    const pid = Number(result.stdout.trim())
    if (Number.isInteger(pid) && pid > 0) DiagnosticChildren.pids.push(pid)
    expect(result.failed).toBe(true)
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(pid).toBeGreaterThan(0)
    await expect.poll(() => {
      try { process.kill(pid, 0); return true } catch { return false }
    }).toBe(false)
  })
})
