// A slice of the state machine of scripts/ct-step.mjs. The preamble —and why
// it is nine files and not one— is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { deliveredRun } from '../scripts/run-machine.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, writeVerdict, writeRaw, writeSliceVerdict, log, commits, runState,
  judgeRows, judgeTask, judgeSlice, taskOk, sliceOk } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// Slice 12 — THE THIRD WINDOW. The two equalities of slice 11 measure the
// instant of the verdict; between the ACCEPTED verdict and the `commit` there
// was a gap in which a `git add` slipped unreviewed code into the commit, with
// the telemetry row asserting the review_token of the code that actually was
// reviewed. Now the accepted verdict SEALS the index tree and `commit` demands
// to find it unchanged.
describe('what gets committed is what was approved: the index seal', () => {
  it('THE ATTACK: code re-staged AFTER the accepted verdict does not get into the commit', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    expect(judgeTask(writeVerdict('PASS')).stdout).toMatch(/veredicto PASS/)
    expect(runState().step).toBe('commit')
    // THE THIRD WINDOW: the verdict is already accepted and its package consumed.
    writeFileSync(join(repo, 'uno.txt'), 'uno, cambiado DESPUÉS del veredicto aceptado\n')
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })
    const r = ct('commit')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/el índice ya no es el que el juez aprobó/)
    expect(commits()).toBe(1)                    // NOTHING gets committed
    expect(runState().step).toBe('commit')         // the run neither advances nor goes back
    expect(runState().task).toBe(1)
    // And there is still no `commit` row: this failure does not open it.
    expect(judgeRows('commit')).toHaveLength(0)
  })

  it('the message carries the command that gives the approved index back, and that command gives it back', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    writeFileSync(join(repo, 'uno.txt'), 'otra versión\n')
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })
    // The sha of the message without pinning the length at 40: a repository
    // with `extensions.objectFormat = sha256` gives ids of 64, and the
    // mechanism is indifferent (it compares strings). What is pinned down is
    // that the message carries THE seal, whole and untruncated, because it has
    // to be typed.
    const m = /git read-tree ([0-9a-f]+)/.exec(ct('commit').stderr)
    expect(m).not.toBeNull()
    expect(m[1]).toBe(runState().sealedTree)
    execFileSync('git', ['read-tree', m[1]], { cwd: repo })
    expect(ct('commit').status).toBe(0)
    // What was committed is what the judge read...
    expect(execFileSync('git', ['show', 'HEAD:uno.txt'], { cwd: repo, encoding: 'utf8' })).toBe('uno.txt\n')
    // ...and the worktree keeps the work that was hung there afterwards: nothing is lost.
    expect(readFileSync(join(repo, 'uno.txt'), 'utf8')).toBe('otra versión\n')
  })

  it('the seal is the tree of the INDEX at the moment the verdict is accepted, with the machinery artefact inside', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    // Measured from the outside: the seal is exactly the index tree of right now.
    const arbol = execFileSync('git', ['write-tree'], { cwd: repo, encoding: 'utf8' }).trim()
    expect(runState().sealedTree).toBe(arbol)
    // And the verdict that travels is INSIDE that tree: sealing before its
    // `git add` would make every commit fail.
    expect(execFileSync('git', ['ls-tree', '-r', '--name-only', arbol], { cwd: repo, encoding: 'utf8' }))
      .toMatch(/docs\/superpowers\/verdicts\/issue-7-task-1\.json/)
    expect(ct('commit').status).toBe(0)
  })

  it('a FORGED verdict staged in the gap does not travel in the pull request', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    const rutaV = join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json')
    writeFileSync(rutaV, JSON.stringify({ issue: 7, task: 1, verdict: { ruling: 'PASS', findings: ['FORJADO'] } }))
    execFileSync('git', ['add', '--', 'docs/superpowers/verdicts/issue-7-task-1.json'], { cwd: repo })
    const r = ct('commit')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/el índice ya no es el que el juez aprobó/)
    expect(commits()).toBe(1)
  })

  it('the happy path does not change: the verdict STILL travels inside its task\'s commit', () => {
    expect(taskOk('uno.txt').status).toBe(0)
    const enElCommit = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(enElCommit).toMatch(/docs\/superpowers\/verdicts\/issue-7-task-1\.json/)   // F37's closure criterion
    expect(enElCommit).toMatch(/docs\/superpowers\/metrics\/issue-7\.jsonl/)
    expect(enElCommit).toMatch(/uno\.txt/)
    expect(runState().sealedTree).toMatch(/^[0-9a-f]{40,64}$/)   // sha1 or sha256: it makes no difference
    // And the second task too, with its new artefact and the telemetry already tracked.
    expect(taskOk('dos.txt').status).toBe(0)
    expect(commits()).toBe(3)
    expect(execFileSync('git', ['show', 'HEAD:docs/superpowers/verdicts/issue-7-task-2.json'], { cwd: repo, encoding: 'utf8' }))
      .toMatch(/"ruling": "PASS"/)
  })

  it('THE SLICE\'S TWIN: code staged before the slice verdict does not get into its commit', () => {
    taskOk('uno.txt'); taskOk('dos.txt'); ct('reconcile'); ct('global')
    writeFileSync(join(repo, 'colado.txt'), 'nadie ha visto esto\n')
    execFileSync('git', ['add', 'colado.txt'], { cwd: repo })
    const r = judgeSlice(writeSliceVerdict('PASS'))
    expect(r.status).toBe(0)                      // the verdict is valid: it delivers
    expect(runState().closed).toBe('delivered')
    expect(r.stderr).toMatch(/ajenas a la maquinaria \(colado\.txt\)/)
    expect(commits()).toBe(3)                     // base + 2 tasks: NO verdict commit at all
    expect(log()).not.toMatch(/Veredicto del slice entero/)
    expect(execFileSync('git', ['log', '--oneline', '--', 'colado.txt'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('')
    expect(runState().sliceCommits ?? 0).toBe(0)    // the commit that did not happen is not counted
    // The evidence stays STAGED: taking the foreign file out and committing it is one line.
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' }))
      .toMatch(/docs\/superpowers\/verdicts\/issue-7-slice\.json/)
  })

  it('a run with no seal in its state does not commit: absence is not a guardrail-free mode', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    // The run of an earlier version of the plugin: the field is not there. It
    // is simulated by DELETING it, which is also the shortcut a conductor with
    // Bash would have.
    const s = runState(); delete s.sealedTree
    writeFileSync(join(repo, '.agent', 'run-7.json'), JSON.stringify(s, null, 2) + '\n')
    const r = ct('commit')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/no trae el sello del índice/)
    expect(commits()).toBe(1)
  })
})

describe('where it has got to lives on disk, not in the conversation', () => {
  it('the state survives between invocations: every verb is a fresh process', () => {
    ct('report', writeReport(['uno.txt']))
    expect(runState().step).toBe('controls')
    ct('controls')
    expect(runState().step).toBe('judge')
  })

  it('if the state and git do not tell the same story, it stops instead of carrying on', () => {
    taskOk('uno.txt')
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'a mano'], { cwd: repo })
    const r = ct('next')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/no cuentan lo mismo/)
  })

  it('writes telemetry with the epic seeded in every one of its rows', () => {
    // The SEQUENCE of steps is pinned down by the Step 6 test, at the end of
    // the file: that is where the `commit` row was withdrawn and that is where
    // the reason is on record.
    taskOk('uno.txt')
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas.length).toBeGreaterThan(0)
    expect(filas.every((f) => f.epic === '12')).toBe(true)
  })

  it('the implement row carries the report summary: it is the only channel that ever tells it', () => {
    // The summary dies in the state if nobody reads it (no other verb queries
    // run.lastSummary): telemetry is the only thing that gets it out.
    ct('report', writeReport(['uno.txt']))
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas[0].step).toBe('implement')
    expect(filas[0].summary).toBe('done')
  })

  it('a discarded report has no summary to tell', () => {
    ct('report', writeRaw(JSON.stringify({ paths: ['/etc/passwd'], summary: 'ups' })))
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas[0].outcome).toBe('discarded')
    expect(filas[0].summary).toBeNull()
  })
})

// capde's review (2026-08-19), point 2: the index accumulated between attempts
// and the scope check looked at the report's list, not at what actually gets
// committed. The two halves of the fix, each with its own test.
describe('the index does not accumulate between attempts', () => {
  it('the out-of-scope path of attempt 1 does NOT travel in the commit of attempt 2', () => {
    // Attempt 1: the implementer touches too much; it gets staged and the check
    // catches it.
    ct('report', writeReport(['uno.txt', 'dos.txt']))
    expect(ct('controls').stdout).toMatch(/controles: failed/)
    // Attempt 2: the implementer WITHDRAWS what it touched too much and reports
    // only the legitimate part. Withdrawing it from the worktree and not only
    // from the declaration is what the veto demands ever since the paths are
    // measured by the program: a file that is still there is still this task's
    // work, whoever declares it. The `report` reset also empties the index, so
    // attempt 1's dos.txt is not left quietly staged either.
    rmSync(join(repo, 'dos.txt'))
    ct('report', writeReport(['uno.txt']))
    expect(ct('controls').stdout).toMatch(/controles: done/)
    judgeTask(writeVerdict('PASS'))
    expect(ct('commit').status).toBe(0)
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(files).toMatch(/uno\.txt/)
    expect(files).not.toMatch(/dos\.txt/)
  })

  it('scope measures the INDEX, not the report\'s list: what is staged without being declared is red', () => {
    ct('report', writeReport(['uno.txt']))
    // Something writes and stages dos.txt outside the report — it makes no difference who.
    writeFileSync(join(repo, 'dos.txt'), 'dos\n')
    execFileSync('git', ['add', 'dos.txt'], { cwd: repo })
    expect(ct('controls').stdout).toMatch(/controles: failed/)
    const registro = readFileSync(join(repo, '.agent', 'run-7', 'task-1-controls-1.log'), 'utf8')
    expect(registro).toMatch(/dos\.txt.*no la declara/)
  })
})

// capde's review (2026-08-19), point 1: a prompt is not a gate. The ct-step
// half: the good closure is persisted and deliveredRun (which reads the gate of
// dispatch-check --release) accepts it or explains why not.
describe('the good closure is persisted, and the release gate reads it', () => {
  it('run delivered → closed: "delivered" in the file, and deliveredRun accepts it', () => {
    sliceOk()
    expect(runState().closed).toBe('delivered')
    expect(deliveredRun(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'), 7)).toEqual({ ok: true })
  })

  it('on a delivered run, next says "that is that" and the verbs that transition exit with 9', () => {
    sliceOk()
    const n = ct('next')
    expect(n.status).toBe(0)
    expect(n.stdout).toMatch(/run delivered/)
    expect(ct('report', writeReport(['uno.txt'])).status).toBe(9)
  })

  it('deliveredRun refuses the absent run, another issue\'s run and the undelivered one', () => {
    expect(deliveredRun(null, 7).ok).toBe(false)
    expect(deliveredRun(JSON.stringify({ issue: 8, closed: 'delivered' }), 7).ok).toBe(false)
    expect(deliveredRun('esto no es json', 7).ok).toBe(false)
    taskOk('uno.txt') // 1 of 2: the run is going fine but it is NOT delivered
    const parcial = deliveredRun(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'), 7)
    expect(parcial.ok).toBe(false)
    expect(parcial.why).toMatch(/no está entregado/)
  })

  it('the two tasks committed WITHOUT global nor slice judgement is not delivered either', () => {
    // §3.7: "delivered" comes to mean tasks + green end to end + slice judged.
    // This is the case that used to close and no longer does.
    taskOk('uno.txt')
    taskOk('dos.txt')
    const parcial = deliveredRun(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'), 7)
    expect(parcial.ok).toBe(false)
  })
})
