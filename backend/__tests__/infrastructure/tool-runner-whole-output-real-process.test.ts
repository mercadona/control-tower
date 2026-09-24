import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolRunner } from '../../src/infrastructure/tool-runner.ts'
import { SystemProcesses } from '../../src/infrastructure/process-border.ts'

const processes = new SystemProcesses()

class PrintsThenExits {
  static readonly #MADE: string[] = []

  static readonly BYTES = ToolRunner.PIPE_BUFFER_BYTES * 4

  static script(): string {
    const at = mkdtempSync(join(tmpdir(), 'ct-prints-then-exits-'))
    PrintsThenExits.#MADE.push(at)
    const script = join(at, 'prints-then-exits.mjs')
    writeFileSync(script, [
      `console.log(JSON.stringify({ milestone: 'big', padding: 'x'.repeat(${PrintsThenExits.BYTES}) }))`,
      "console.error('a diagnosis on the other channel')",
      'process.exit(3)',
    ].join('\n'))

    return script
  }

  static clean(): void {
    for (const at of PrintsThenExits.#MADE.splice(0)) rmSync(at, { recursive: true, force: true })
  }
}

describe('a tool that prints more than a pipe holds and then exits', () => {
  afterEach(() => {
    PrintsThenExits.clean()
  })

  it('loses everything past the pipe buffer when its output is read through a pipe', async () => {
    const runner = new ToolRunner({ bin: process.execPath, budgetMs: 30_000, processes, signal: processes.signal.bind(processes) })

    const said = await runner.run([PrintsThenExits.script()])

    expect(said.stdout.length).toBeLessThan(PrintsThenExits.BYTES)
    expect(() => JSON.parse(said.stdout)).toThrow()
  })

  it('keeps every byte when its output is collected whole, and still tells its exit code and its stderr', async () => {
    const runner = new ToolRunner({ bin: process.execPath, budgetMs: 30_000, processes, signal: processes.signal.bind(processes) })

    const said = await runner.runWholeOutput([PrintsThenExits.script()])

    expect(JSON.parse(said.stdout)).toEqual({ milestone: 'big', padding: 'x'.repeat(PrintsThenExits.BYTES) })
    expect(said.code).toBe(3)
    expect(said.stderr.trim()).toBe('a diagnosis on the other channel')
  })
})
