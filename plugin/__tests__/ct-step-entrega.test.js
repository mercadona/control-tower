// A slice of the state machine of scripts/ct-step.mjs. The preamble —and why
// there are nine files and not one— is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { deliveredRun } from '../scripts/run-machine.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLAN } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, writeVerdict, writeRaw, log, commits, runState, judgeTask, taskOk, sliceOk } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('the happy path', () => {
  it('two tasks, two commits, and it is the PROGRAM that commits them', () => {
    taskOk('uno.txt')
    const r = taskOk('dos.txt')
    expect(r.status).toBe(0)
    // §3.7: the last commit no longer delivers — it opens Phase B (Task 8):
    // before the global verification, the branch has to be reconciled with its
    // base.
    expect(r.stdout).toMatch(/paso reconcile/)
    expect(commits()).toBe(3)
    expect(log()).toMatch(/the first one \(#7, tarea 1\/2\)/)
    expect(log()).toMatch(/the second one \(#7, tarea 2\/2\)/)
  })

  it('the whole slice: tasks + global + slice judging, and it delivers', () => {
    const r = sliceOk()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/run delivered/)
    expect(r.stdout).toMatch(/lista para la pull request/)
    // 1 base + 2 tasks + 1 for the slice verdict, which gets a commit of its own.
    expect(commits()).toBe(4)
    expect(log()).toMatch(/Veredicto del slice entero \(#7\)/)
  })

  // What goes into the commit is what the task TOUCHED, measured by the
  // program: task 2's file is not written yet, so it cannot slip into task 1's
  // commit however much the plan names it further down.
  it('only what this task touched goes into the commit', () => {
    taskOk('uno.txt')
    const primero = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(primero).toMatch(/uno\.txt/)
    expect(primero).not.toMatch(/dos\.txt/)
  })

  // THE DECLARATION IS A CROSS-CHECK: if it differs from what the tree says, a
  // warning is issued and what was measured is staged. Before, the declaration
  // decided, so a path forgotten from the list was left out of the commit
  // without anything saying so.
  it('a path that was touched and not declared goes into the commit, and the mismatch is warned about', () => {
    writeFileSync(join(repo, 'uno.txt'), 'uno\n')
    writeFileSync(join(repo, 'olvidado.txt'), 'esto lo toqué y no lo dije\n')
    const r = ct('report', writeReport([]))
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/Tocado y no declarado: olvidado\.txt, uno\.txt/)
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' }))
      .toMatch(/olvidado\.txt/)
  })

  // The other side of the cross-check: a path that is declared and was not
  // touched. Before, the program did a `git add` of it and the step died with
  // an exception; now a warning is issued and nothing is staged for it. The
  // report is written with `crudo` because `informe` creates the files it
  // declares, and here the case is precisely that it does not exist.
  it('a path that is declared and was not touched is warned about, and does not bring the step down', () => {
    writeFileSync(join(repo, 'uno.txt'), 'uno\n')
    const r = ct('report', writeRaw(JSON.stringify({ paths: ['uno.txt', 'inventado.txt'], summary: 'hecho' })))
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/Declarado y no tocado: inventado\.txt/)
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' }).trim())
      .toBe('uno.txt')
  })

  it('the message carries no closing keywords even if the plan does', () => {
    // The plan is COMMITTED after being changed: in a real run it comes
    // committed from before, and since `ct-step report` measures the tree, a
    // modified and uncommitted plan would be undeclared work of this task.
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('### Task 1 — the first one', '### Task 1 — fixes #451 the first one'))
    execFileSync('git', ['add', 'plan.md'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'el plan con la palabra de cierre dentro'], { cwd: repo })
    taskOk('uno.txt')
    expect(log()).not.toMatch(/fixes\s*#451/i)
    expect(log()).toMatch(/issue 451/)
  })

  it('it rejects paths from outside the worktree: the list is written by a model', () => {
    const r = ct('report', writeRaw(JSON.stringify({ paths: ['/etc/passwd'], summary: 'ups' })))
    expect(r.stdout).toMatch(/informe descartado.*fuera del worktree/)
    expect(runState().discards).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// THE WHOLE QUEUE WITH JOURNEYS. No file walked it: this one never put `e2e`
// in the SLICE.md (so the last task's commit closed on the branch with no
// journey) and __tests__/e2e-ct-step.test.js seeds the run already stopped
// at `e2e` with exactly `tasksTotal` commits, without going through
// `slice-verdict`. The defect fitted in the gap between the two: the slice
// verdict gets a commit of its own, the next process re-reads the file and the
// commit count did not add up — EVERY slice with journeys died in PRECONDITION
// (exit 8) without ever reaching DELIVERED, and `dispatch-check --release`
// rejected it with the 7 forever.
// ---------------------------------------------------------------------------
describe('the complete queue: commit → global → slice-verdict → e2e → DELIVERED', () => {
  const RECORRIDO = 'levantado con el example, curl -i :9115/metrics responde 200'
  const informeE2e = (nombre = 'e2e.json') => {
    const p = join(repo, nombre)
    writeFileSync(p, JSON.stringify({
      runs: [{
        run: RECORRIDO, verdict: 'verde', brought_up: 'cargo run --example serve',
        evidence: [{ command: 'curl -sS -o /dev/null -w \'%{http_code}\' localhost:9115/metrics', output: '200' }],
      }],
    }))
    return p
  }

  beforeEach(() => {
    rmSyncBestEffort(repo)
    repo = makeRepo({ e2e: [RECORRIDO] })
  })

  it('a slice with journeys traverses the e2e and DELIVERS', () => {
    expect(sliceOk().status).toBe(0)
    // The slice verdict does not deliver here: it opens the e2e step.
    expect(runState().step).toBe('e2e')
    expect(runState().closed).toBeUndefined()
    // Asking no longer dies in PRECONDITION: that is the defect's exact symptom.
    const n = ct('next')
    expect(n.status).toBe(0)
    expect(n.stdout).toContain(RECORRIDO)

    const r = ct('e2e', informeE2e())
    expect(r.status).toBe(0)
    expect(runState().closed).toBe('delivered')
    expect(deliveredRun(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'), 7)).toEqual({ ok: true })
    // 1 base + 2 tasks + slice verdict + e2e report.
    expect(commits()).toBe(5)
    expect(log()).toMatch(/informe de e2e del issue #7/)
    // And the slice verdict's commit was COUNTED: that is what lets the next
    // process cross the commits without the sums going wrong.
    expect(runState().sliceCommits).toBe(1)
  })

  it('a `git add` before the e2e does not go into the writeReport commit (slice 12)', () => {
    sliceOk()
    writeFileSync(join(repo, 'colado.txt'), 'nadie ha visto esto\n')
    execFileSync('git', ['add', 'colado.txt'], { cwd: repo })
    const r = ct('e2e', informeE2e())
    expect(r.status).toBe(0)                      // the report is valid: it delivers
    expect(runState().closed).toBe('delivered')
    expect(r.stderr).toMatch(/ajenas a la maquinaria \(colado\.txt\)/)
    expect(execFileSync('git', ['log', '--oneline', '--', 'colado.txt'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('')
    expect(log()).not.toMatch(/informe de e2e del issue #7/)
    // The report is left STAGED, as on the red path: it waits for whoever commits it.
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' }))
      .toMatch(/docs\/superpowers\/e2e\/7\.md/)
  })
})

// capde's review (2026-08-19), point 3 / F37's closing criterion: a slice's PR
// brings a VERDICT, not a sentence in the commit message asserting it.
describe('the verdict travels in the pull request', () => {
  it("each task's PASS ends up tracked and inside that task's commit", () => {
    taskOk('uno.txt')
    const ruta = join('docs', 'superpowers', 'verdicts', 'issue-7-task-1.json')
    expect(existsSync(join(repo, ruta))).toBe(true)
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(files).toMatch(/issue-7-task-1\.json/)
    const guardado = JSON.parse(readFileSync(join(repo, ruta), 'utf8'))
    expect(guardado.verdict.ruling).toBe('PASS')
    expect(guardado.task).toBe(1)
  })

  it('a FAIL leaves no tracked verdict: only the one that passes travels', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)
  })
})
