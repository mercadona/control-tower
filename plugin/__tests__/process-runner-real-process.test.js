import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProcessRunner } from '../scripts/process-runner.js'

class RunnerMother {
  static roots = []

  static node() {
    const cwd = mkdtempSync(join(tmpdir(), 'ct runner with spaces '))
    RunnerMother.roots.push(cwd)
    return new ProcessRunner({ bin: process.execPath, cwd, env: { FIXTURE_VALUE: 'literal value' } })
  }

  static clean() {
    for (const root of RunnerMother.roots.splice(0)) rmSync(root, { recursive: true, force: true })
  }
}

describe('the process runner boundary', () => {
  afterEach(() => RunnerMother.clean())

  it('preserves literal arguments stdout stderr and a nonzero exit code', () => {
    const runner = RunnerMother.node()
    const result = runner.run(['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1))); process.stderr.write("refused" + String.fromCharCode(10)); process.exitCode = 23', 'one argument', 'two'])
    expect(result.code).toBe(23)
    expect(result.stdout).toBe('["one argument","two"]')
    expect(result.stderr).toBe('refused\n')
    expect(result.error).toBeUndefined()
  })

  it('passes stdin and the invocation environment to the real child', () => {
    const runner = RunnerMother.node()
    const result = runner.run(['-e', 'process.stdout.write(process.env.FIXTURE_VALUE + "|" + require("node:fs").readFileSync(0, "utf8"))'], { input: 'first\nsecond\n' })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('literal value|first\nsecond\n')
  })

  it('uses the explicit cwd even when its path contains spaces', () => {
    const runner = RunnerMother.node()
    const result = runner.run(['-e', 'process.stdout.write(require("node:path").basename(process.cwd()))'])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(runner.cwd.split('/').at(-1))
  })

  it('a missing executable retains its launch error instead of reporting a successful empty answer', () => {
    const runner = RunnerMother.node()
    const missing = new ProcessRunner({ bin: join(runner.cwd, 'not-installed'), cwd: runner.cwd, env: {} })
    const result = missing.run([])
    expect(result.code).not.toBe(0)
    expect(result.error.code).toBe('ENOENT')
    expect(result.stdout).toBe('')
  })

  it('a deadline kills the child and retains the timeout and signal as different evidence from an ordinary refusal', () => {
    const runner = RunnerMother.node()
    const result = runner.run(['-e', 'setInterval(() => {}, 1000)'], { timeout: 100, killSignal: 'SIGKILL' })
    expect(result.code).not.toBe(0)
    expect(result.signal).toBe('SIGKILL')
    expect(result.error.code).toBe('ETIMEDOUT')
  })

  it('the requested output budget retains bytes beyond the default buffer size', () => {
    const runner = RunnerMother.node()
    const result = runner.run(['-e', 'process.stdout.write("x".repeat(2 * 1024 * 1024))'], { maxBuffer: 3 * 1024 * 1024 })
    expect(result.code).toBe(0)
    expect(result.stdout.length).toBe(2 * 1024 * 1024)
    expect(result.error).toBeUndefined()
  })
})
