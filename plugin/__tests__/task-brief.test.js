// task-brief is the boundary with José's decision (D-4, deferred): the default
// path of subagent-driven-development calls this script WITHOUT the flag, so
// without `--with-plan-context` its output cannot change by a single byte.
// That is why the first test does not compare against a hand-written
// expectation, but against the output of the script itself at a fixed point in
// history — it is the only yardstick that cannot lie if someone touches the
// script without meaning to break that contract.
//
// That fixed point is the sha `2f30f9a` (the last commit before this round,
// right before `1c2fc61` put the script and this test in the SAME commit) and
// not HEAD. A baseline on HEAD is a moving baseline: the script and its test
// went in together, so in a clean checkout HEAD:script IS the file under test
// — the flagless path can be broken and the test, comparing itself against
// itself, stays green. Pinning it to a commit earlier than the one that
// introduced the contract is the only thing that lets the test compare against
// something that is not the very change that could break it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Two roots ever since the plugin lives in plugin/: the script under test is
// inside the plugin, but the plan that acts as the fixed input is REPO
// documentation (docs/ is deliberately not distributed) and sits one level up.
const PLUGIN_ROOT = join(here, '..')
const REPO_ROOT = join(PLUGIN_ROOT, '..')
const SCRIPT = join(PLUGIN_ROOT, 'skills', 'subagent-driven-development', 'scripts', 'task-brief')
const PLAN = join(REPO_ROOT, 'docs', 'superpowers', 'plans', '2026-08-18-los-dos-agentes-y-la-vara-del-plan.md')
const TASK = '7'
// The last commit before this round, earlier as well than `1c2fc61` (which
// put the script and this test in the same commit). See the header note.
const BASELINE_SHA = '2f30f9a'

let dir

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'task-brief-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const run = (args) => {
  try {
    const stdout = execFileSync(SCRIPT, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout }
  } catch (e) {
    return { status: e.status, stdout: e.stdout, stderr: e.stderr }
  }
}

describe('task-brief', () => {
  it('without the flag the output is, byte for byte, the one from before this round', () => {
    const baselineScript = join(dir, 'task-brief-baseline')
    writeFileSync(baselineScript, execFileSync('git', ['show', `${BASELINE_SHA}:skills/subagent-driven-development/scripts/task-brief`], { cwd: REPO_ROOT, encoding: 'utf8' }))
    chmodSync(baselineScript, 0o755)

    const outBaseline = join(dir, 'baseline-brief.md')
    const outNew = join(dir, 'new-brief.md')

    execFileSync(baselineScript, [PLAN, TASK, outBaseline], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    execFileSync(SCRIPT, [PLAN, TASK, outNew], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

    expect(readFileSync(outNew)).toEqual(readFileSync(outBaseline))
  })

  it("with the flag it adds the slice's end and the three yardstick sections", () => {
    const out = join(dir, 'con-flag.md')
    const r = run(['--with-plan-context', PLAN, TASK, out])
    expect(r.status).toBe(0)

    const text = readFileSync(out, 'utf8')
    expect(text).toContain('### Desired end state')
    expect(text).toContain('### Out of scope')
    expect(text).toContain('## 2. Closed decisions')
    expect(text).toContain('## 3. Reference patterns')
    expect(text).toMatch(/vara/i)
    expect(text).toMatch(/ganan/i)

    // The four sections go ahead of the task, in the plan's order, and the
    // task is still whole.
    const idxDesired = text.indexOf('### Desired end state')
    const idxOutOfScope = text.indexOf('### Out of scope')
    const idxClosed = text.indexOf('## 2. Closed decisions')
    const idxReference = text.indexOf('## 3. Reference patterns')
    const idxTask = text.indexOf('### Task 7')
    expect(idxDesired).toBeGreaterThanOrEqual(0)
    expect(idxOutOfScope).toBeGreaterThan(idxDesired)
    expect(idxClosed).toBeGreaterThan(idxOutOfScope)
    expect(idxReference).toBeGreaterThan(idxClosed)
    expect(idxTask).toBeGreaterThan(idxReference)
    expect(text).toContain('el brief lleva la vara, detrás de un flag')

    // Each section is cut before the next one; it does not swallow the whole plan.
    expect(text).not.toContain('## 4. Inventory')
  })

  // -------------------------------------------------------------------------
  // THE FOUR SECTIONS DO NOT CARRY THE SAME AUTHORITY. The slice's end travels
  // so that whoever implements and whoever judges know what the task serves —it
  // was the only thing tying it to the issue's acceptance criteria and it was
  // not arriving—, but giving it yardstick authority would be a licence to
  // widen the task ("it serves the slice's end"), and that weakens the
  // `alcance` item, which works today. That is why they go under two different
  // lines, and that is why there is a test.
  // -------------------------------------------------------------------------
  it("the slice's end does not travel as yardstick: it says it does not widen the task's scope", () => {
    const out = join(dir, 'autoridades.md')
    expect(run(['--with-plan-context', PLAN, TASK, out]).status).toBe(0)

    const text = readFileSync(out, 'utf8')
    const idxDesired = text.indexOf('### Desired end state')
    const header = text.slice(0, idxDesired)

    // The line preceding the slice's end unmarks it as yardstick.
    expect(header).toMatch(/no amplía/i)
    expect(header).toMatch(/\*\*Files:\*\*/)
    // And the "they win" line does NOT cover the slice's end: it comes after,
    // with the three that are yardstick.
    expect(header).not.toMatch(/ganan/i)
    expect(text.indexOf('ganan')).toBeGreaterThan(idxDesired)
  })

  it('when the plan is missing a yardstick section, it says so instead of leaving a mute gap', () => {
    // A plan without "### Out of scope" nor "## 3. Reference patterns" (but
    // with its "## 2. Closed decisions"): the two absent ones have to be
    // declared, not leave two blank lines indistinguishable from an empty
    // section.
    const incompletePlan = join(dir, 'plan-incompleto.md')
    writeFileSync(incompletePlan, [
      '# Plan de prueba',
      '',
      '## 7. Tasks',
      '',
      '### Task 1 — la única tarea',
      '',
      '**Files:**',
      '- `a.js` (create)',
      '',
    ].join('\n'))

    const out = join(dir, 'plan-incompleto-brief.md')
    const r = run(['--with-plan-context', incompletePlan, '1', out])
    expect(r.status).toBe(0)

    const text = readFileSync(out, 'utf8')
    expect(text).toMatch(/### Out of scope.*not found in the plan/)
    expect(text).toMatch(/## 3\. Reference patterns.*not found in the plan/)
    // The line that says they are the yardstick is still printed all the same.
    expect(text).toMatch(/vara/i)
  })

  it('an unknown flag exits with 2', () => {
    const out = join(dir, 'flag-desconocido.md')
    const r = run(['--nope', PLAN, TASK, out])
    expect(r.status).toBe(2)
  })
})
