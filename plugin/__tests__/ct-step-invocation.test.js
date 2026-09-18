import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CtStep } from '../scripts/ct-step.js'
import { StepPlanMother } from './fixtures/step-plan.js'

class InvocationMother {
  static roots = []
  static HEAD = 'a'.repeat(40)

  static fresh() {
    const root = mkdtempSync(join(tmpdir(), 'ct-step-invocation-'))
    InvocationMother.roots.push(root)
    mkdirSync(join(root, '.agent'))
    writeFileSync(join(root, '.agent/SLICE.md'), '---\nissue: 7\nbase: main\n---\n')
    writeFileSync(join(root, 'plan.md'), StepPlanMother.oneTask())
    const gitCalls = []
    const scripts = []
    const output = { stdout: '', stderr: '' }
    const answers = new Map([
      [['rev-parse', '--show-toplevel'], root],
      [['diff', '--cached', '--name-only'], ''],
      [['rev-parse', 'HEAD'], InvocationMother.HEAD],
      [['remote', 'get-url', 'origin'], 'https://github.com/acme/widget.git'],
      [['config', 'user.email'], 'fixture@example.test'],
      [['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], InvocationMother.HEAD],
      [['rev-list', '--count', '--no-merges', `${InvocationMother.HEAD}..HEAD`, '^origin/main'], '0'],
    ].map(([argv, stdout]) => [JSON.stringify(argv), stdout]))
    const io = {
      cwd: root, home: root, env: { CLAUDE_CONFIG_DIR: join(root, '.home') },
      pluginRoot: fileURLToPath(new URL('../', import.meta.url)), now: () => 0,
      out: (text) => { output.stdout += text }, err: (text) => { output.stderr += text },
      git: { run: (argv) => {
        gitCalls.push(argv)
        const stdout = answers.get(JSON.stringify(argv))
        if (stdout === undefined) throw new Error(`No Git reply declared for ${JSON.stringify(argv)}`)
        return { code: 0, stdout, stderr: '' }
      } },
      shell: { run: () => { throw new Error('This invocation must not run checks') } },
      scripts: { run: (argv) => {
        scripts.push(argv)
        expect(argv).toEqual([join(io.pluginRoot, 'skills/ct-subagent-driven-development/scripts/task-brief'), '--with-plan-context', 'plan.md', '1', join(root, '.agent/run-7/task-1-brief.md')])
        writeFileSync(argv.at(-1), '### Task 1 — do the work\n')
        return { code: 0, stdout: '', stderr: '' }
      } },
    }
    return { root, io, output, gitCalls, scripts }
  }

  static clean() { for (const root of InvocationMother.roots.splice(0)) rmSync(root, { recursive: true, force: true }) }
}

describe('an imported ct-step invocation', () => {
  afterEach(() => InvocationMother.clean())

  it('returns a usage error before asking any external collaborator', () => {
    const fixture = InvocationMother.fresh()
    expect(CtStep.run(['unknown'], fixture.io)).toBe(2)
    expect(fixture.output.stderr).toMatch(/^unknown verb: unknown\n\nusage: ct-step/)
    expect(fixture.gitCalls).toEqual([])
    expect(fixture.scripts).toEqual([])
  })

  it('interleaved roots retain their own state outputs and environment without changing the host cwd', () => {
    const first = InvocationMother.fresh()
    const second = InvocationMother.fresh()
    const before = process.cwd()
    const argv = ['next', '--plan', 'plan.md', '--issue', '7']
    expect(CtStep.run(argv, first.io), first.output.stderr).toBe(0)
    expect(CtStep.run(argv, second.io), second.output.stderr).toBe(0)
    expect(CtStep.run(argv, first.io), first.output.stderr).toBe(0)
    expect(first.scripts).toHaveLength(2)
    expect(second.scripts).toHaveLength(1)
    expect(first.output.stdout).not.toContain(second.root)
    expect(second.output.stdout).not.toContain(first.root)
    expect(JSON.parse(readFileSync(join(first.root, '.agent/run-7.json'), 'utf8')).step).toBe('implement')
    expect(JSON.parse(readFileSync(join(second.root, '.agent/run-7.json'), 'utf8')).step).toBe('implement')
    expect(process.cwd()).toBe(before)
  })

  it('a missing input path inside a transitioning verb returns usage rather than becoming an unnamed exception', () => {
    const fixture = InvocationMother.fresh()
    expect(CtStep.run(['report', '--plan', 'plan.md', '--issue', '7'], fixture.io)).toBe(2)
    expect(fixture.output.stderr).toContain('the path of the report JSON is missing')
    expect(fixture.gitCalls.some(([verb]) => ['add', 'commit', 'reset'].includes(verb))).toBe(false)
  })
})
