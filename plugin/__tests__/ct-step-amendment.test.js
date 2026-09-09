// A slice of the state machine of scripts/ct-step.mjs. The preamble —and why
// it is nine files and not one— is in fixtures/ct-step-harness.js.
//
// Issue 161 — the plan amended halfway through a task. Before, `esDelRun`
// excluded the plan's path from "what the task touched", so an amendment was
// left staged and uncommitted (the human blockage measured on 2026-09-08). Now
// the plan's path goes into the commit of ITS task, like any other file the
// implementer touches, and the three controls that read CONTENT out of the
// index (scope, tests, blocks) filter that path out so as not to read the plan
// as if it were the task's code.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, writeVerdict, writeSliceVerdict, commits, runState,
  taskPackage, judgeTask, judgeSlice, taskOk } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

const HALLAZGO = { severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }

// The amendment a real implementer would make halfway through a task: task 1
// declared only `uno.txt`, and now it also declares `extra.txt`. `writeReport`
// writes `extra.txt` on its own (it creates what it declares and does not
// exist), so here only the plan needs touching.
function enmendar() {
  const ruta = join(repo, 'plan.md')
  const original = readFileSync(ruta, 'utf8')
  const enmendado = original.replace(
    '**Files:** `uno.txt` (create).',
    '**Files:** `uno.txt` (create), `extra.txt` (create).',
  )
  expect(enmendado).not.toBe(original) // the fixture changed shape without this test noticing
  writeFileSync(ruta, enmendado)
}

describe('the amended plan travels inside the commit of its task', () => {
  it('the plan amended halfway through a task goes into that task\'s commit, and the state and the run directory do not', () => {
    enmendar()
    ct('report', writeReport(['uno.txt', 'extra.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    expect(ct('commit').status).toBe(0)

    const enElCommit = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(enElCommit).toMatch(/plan\.md/)
    expect(enElCommit).not.toMatch(/\.agent\/SLICE\.md/)
    expect(commits()).toBe(2) // base + this task: no new task because of the amendment
  })

  it('the scope control exits 0 and its output does not name the plan\'s path', () => {
    enmendar()
    ct('report', writeReport(['uno.txt', 'extra.txt']))
    const r = ct('controls')

    expect(r.stdout).toMatch(/controls: done/)
    const log = readFileSync(runState().lastControlsLog, 'utf8')
    expect(log).not.toMatch(/plan\.md/)
  })

  it('the task\'s review package brings the plan\'s diff', () => {
    enmendar()
    ct('report', writeReport(['uno.txt', 'extra.txt']))
    ct('controls')
    ct('next')

    const paquete = readFileSync(taskPackage(), 'utf8')
    expect(paquete).toMatch(/diff --git a\/plan\.md b\/plan\.md/)
    expect(paquete).toContain('extra.txt')
  })

  it('after a task with an amendment, reconcile, global and slice-verdict do not exit with PRECONDITION', () => {
    enmendar()
    ct('report', writeReport(['uno.txt', 'extra.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    expect(ct('commit').status).toBe(0)
    expect(taskOk('dos.txt').status).toBe(0)

    expect(ct('reconcile').status).not.toBe(8)
    expect(ct('global').status).not.toBe(8)
    expect(judgeSlice(writeSliceVerdict('PASS')).status).not.toBe(8)
  })

  it('a vetoed verdict returns the tree and HEAD\'s plan does not declare the path the amendment added', () => {
    // First attempt: a veto with no amendment yet — it only opens the retry
    // budget, it does not fire the advisor (that takes the SECOND veto).
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('FAIL', [HALLAZGO]))
    expect(runState().step).toBe('implement')

    // Second attempt: the implementer amends the plan and declares the new
    // path. The judge vetoes again — the second veto sends it to the advisor.
    enmendar()
    ct('report', writeReport(['uno.txt', 'extra.txt']))
    ct('controls')
    judgeTask(writeVerdict('FAIL', [HALLAZGO]))
    expect(runState().step).toBe('advise')

    ct('next')
    const consejo = join(repo, 'advice.json')
    writeFileSync(consejo, JSON.stringify({
      approach: 'prueba de otra forma',
      files_to_reconsider: ['uno.txt'],
    }))
    expect(ct('advice', consejo).status).toBe(0)
    expect(runState().step).toBe('implement')

    const plan = readFileSync(join(repo, 'plan.md'), 'utf8')
    expect(plan).not.toContain('extra.txt')
    expect(existsSync(join(repo, 'extra.txt'))).toBe(false)
  })
})

function quitarUnoDeLasFiles() {
  const ruta = join(repo, 'plan.md')
  const original = readFileSync(ruta, 'utf8')
  const enmendado = original.replace(
    '**Files:** `uno.txt` (create).',
    '**Files:** `dos.txt` (create).',
  )
  expect(enmendado).not.toBe(original)
  writeFileSync(ruta, enmendado)
}

describe('an amendment can only ADD paths', () => {
  it('an amendment that removes a declared path is refused and the step comes out red', () => {
    quitarUnoDeLasFiles()
    ct('report', writeReport(['uno.txt']))
    const r = ct('controls')

    expect(r.stdout).toMatch(/controls: failed/)
    const log = readFileSync(runState().lastControlsLog, 'utf8')
    expect(log).toMatch(/task 1 amended the plan by removing 'uno\.txt'.*can only ADD paths/)
  })

  it('an amendment that only adds paths passes the control', () => {
    enmendar()
    ct('report', writeReport(['uno.txt', 'extra.txt']))
    const r = ct('controls')

    expect(r.stdout).toMatch(/controls: done/)
  })

  it('after the refusal, HEAD\'s plan still declares the path the amendment removed', () => {
    quitarUnoDeLasFiles()
    ct('report', writeReport(['uno.txt']))
    ct('controls')

    const enHead = execFileSync('git', ['show', 'HEAD:plan.md'], { cwd: repo, encoding: 'utf8' })
    expect(enHead).toContain('**Files:** `uno.txt` (create).')
  })
})

// Issue 161, review — the four holes the pull request's review found. The
// first is the one that opened the very door this slice comes to close: the
// guard was conditioned on the INDEX while everything else measured the TREE.
describe('the plan that governs the controls is the one that is going to be committed', () => {
  const log = () => readFileSync(runState().lastControlsLog, 'utf8')

  it('editing the plan AFTER report leaves tree and index in disagreement, and the control refuses it', () => {
    ct('report', writeReport(['uno.txt']))
    enmendar()
    const r = ct('controls')

    expect(r.stdout).toMatch(/controls: failed/)
    expect(log()).toMatch(/the tree's plan is not the one that is going to be committed/)
    expect(log()).toMatch(/it is not among what is staged/)
  })

  it('a second edit after report, with the plan already staged, is refused too', () => {
    enmendar()
    ct('report', writeReport(['uno.txt', 'extra.txt']))
    const ruta = join(repo, 'plan.md')
    const otra = readFileSync(ruta, 'utf8')
      .replace('`extra.txt` (create).', '`extra.txt` (create), `otra.txt` (create).')
    expect(otra).not.toBe(readFileSync(ruta, 'utf8'))
    writeFileSync(ruta, otra)
    const r = ct('controls')

    expect(r.stdout).toMatch(/controls: failed/)
    expect(log()).toMatch(/the INDEX's says something else/)
  })
})

describe('the scope control does not exempt the machinery that reaches the index', () => {
  it('a docs/superpowers path staged by hand is flagged by the scope control', () => {
    ct('report', writeReport(['uno.txt']))
    const colado = join(repo, 'docs', 'superpowers', 'specs', 'colado.md')
    mkdirSync(dirname(colado), { recursive: true })
    writeFileSync(colado, 'colado\n')
    execFileSync('git', ['add', '--', 'docs/superpowers/specs/colado.md'], { cwd: repo })
    const r = ct('controls')

    expect(r.stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8'))
      .toMatch(/touched 'docs\/superpowers\/specs\/colado\.md'/)
  })
})

describe('the two messages of the scope control do not contradict each other', () => {
  it('the path declared and not touched no longer offers removing it from the PLAN', () => {
    ct('report', writeReport(['otro.txt']))
    const r = ct('controls')

    expect(r.stdout).toMatch(/controls: failed/)
    const texto = readFileSync(runState().lastControlsLog, 'utf8')
    expect(texto).toMatch(/REMOVING IT IS NOT YOUR WAY OUT/)
    expect(texto).not.toMatch(/or it is surplus in the PLAN/)
  })
})

describe('amending the plan is not read as a defect of the report', () => {
  it('report\'s discrepancy warning does not name the plan\'s path', () => {
    enmendar()
    const r = ct('report', writeReport(['uno.txt', 'extra.txt']))

    expect(String(r.stderr ?? '')).not.toMatch(/Tocado y no declarado:.*plan\.md/)
  })
})
