// A slice of the state machine of scripts/ct-step.mjs. The preamble —and why
// there are nine files and not one— is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLAN, F } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, commits, runState } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe("the task's scope is decided by the plan", () => {
  it('a touched path that the plan does not declare for that task is red', () => {
    // Task 1 declares only uno.txt; the report also brings dos.txt.
    ct('report', writeReport(['uno.txt', 'dos.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8')).toMatch(/dos\.txt.*surplus/)
  })

  it('a declared path that the task did not touch is red', () => {
    // The report brings nothing: uno.txt, which task 1 declares, is left untouched.
    ct('report', writeReport([]))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8')).toMatch(/uno\.txt.*is not among what was touched/)
  })

  it('(create) over a file that already existed is red', () => {
    writeFileSync(join(repo, 'existente.txt'), 'ya estaba\n')
    execFileSync('git', ['add', 'existente.txt'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'ya existía'], { cwd: repo, stdio: 'ignore' })
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('`uno.txt` (create)', '`existente.txt` (create)'))
    // The implementer really changes it: the scope is measured over the
    // INDEX, and a declared file with no changes stages nothing.
    writeFileSync(join(repo, 'existente.txt'), 'ya estaba, y ahora cambia\n')
    ct('report', writeReport(['existente.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8')).toMatch(/existente\.txt.*already existed in the previous commit/)
  })
})

describe("what the plan's blocks promise has to be there", () => {
  it('a file that a block names and the task did not touch is red', () => {
    const withBlock = PLAN.replace(
      '**Files:** `uno.txt` (create).\n**TDD:** No TDD — fixture.',
      ['**Files:** `uno.txt` (create).', '', 'Contract (falta.txt):', '', F + 'ts', 'function foo(): void', F, '', '**TDD:** No TDD — fixture.'].join('\n'),
    )
    writeFileSync(join(repo, 'plan.md'), withBlock)
    ct('report', writeReport(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8')).toMatch(/Contract block \(falta\.txt\).*is not among what was touched/)
  })

  it('the test the TDD declares has to be in what was staged', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(
      '**TDD:** No TDD — fixture.',
      "**TDD:** `it('uno se sabe de memoria')`",
    ))
    ct('report', writeReport(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8')).toMatch(/said it was adding the test 'uno se sabe de memoria' and it is not in what is staged/)
  })

  it('the Final text text has to appear verbatim', () => {
    const withFinalText = PLAN.replace(
      '**Files:** `uno.txt` (create).\n**TDD:** No TDD — fixture.',
      ['**Files:** `uno.txt` (create), `doc.md` (create).', '', 'Final text (doc.md):', '', F + 'md', 'línea uno', 'línea dos', F, '', '**TDD:** No TDD — fixture.'].join('\n'),
    )
    writeFileSync(join(repo, 'plan.md'), withFinalText)
    // The implementer stages doc.md with one of the two lines changed.
    writeFileSync(join(repo, 'doc.md'), 'línea uno\nlínea distinta\n')
    ct('report', writeReport(['uno.txt', 'doc.md']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8')).toMatch(/Final text \(doc\.md\).*'línea dos'.*is not verbatim/)
  })

  // ==========================================================================
  // THE ADVERSARIAL CASE of the previous check. `git show :<path>` returns
  // content for ANY file in the index, whether or not it is among what the
  // task touched — so on its own that check does not close the gap: a
  // `Final text` citing an already-committed file, with the text already
  // verbatim there from before, would pass it even though the task never
  // touched it. What closes the gap is that every `Final text (path):` block
  // ALSO goes into `blockPaths`, and that loop does require membership of
  // `run.lastPaths` (see the note about `declaredBlocks` in ct-step.mjs).
  // The guarantee is real but implicit: nothing pinned it until this test, so
  // simplifying that loop for looking redundant with `finalTexts` would
  // silently reintroduce the failure this test exists to catch — the same kind
  // of false negative `declaredTests` already suffered (see `commitPlan`
  // below): the plan lives committed in `docs/`, so searching the repo is
  // searching the plan.
  // ==========================================================================
  it('a Final text citing an ALREADY COMMITTED file, which the task does not touch, is red even though the content is already verbatim', () => {
    writeFileSync(join(repo, 'ya-existe.md'), 'línea uno\nlínea dos\n')
    execFileSync('git', ['add', 'ya-existe.md'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'ya existía con el texto'], { cwd: repo, stdio: 'ignore' })

    const withFinalText = PLAN.replace(
      '**Files:** `uno.txt` (create).\n**TDD:** No TDD — fixture.',
      ['**Files:** `uno.txt` (create).', '', 'Final text (ya-existe.md):', '', F + 'md', 'línea uno', 'línea dos', F, '', '**TDD:** No TDD — fixture.'].join('\n'),
    )
    writeFileSync(join(repo, 'plan.md'), withFinalText)
    execFileSync('git', ['add', 'plan.md'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'el plan del slice'], { cwd: repo, stdio: 'ignore' })

    // The task only declares and touches uno.txt: ya-existe.md is left out.
    ct('report', writeReport(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8')).toMatch(/Final text block \(ya-existe\.md\).*is not among what was touched/)
  })
})

describe('the checks are measured by the program, not by the implementer', () => {
  it('a check in the red sends the task back and, once exhausted, exits with 4', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt', 'test -f no-existe.txt'))
    for (let i = 0; i < 3; i++) {
      ct('report', writeReport(['uno.txt']))
      var r = ct('controls')
    }
    expect(r.status).toBe(4)
    expect(commits()).toBe(1)
  })

  it('a check that could not be MEASURED closes on the first try, with 5', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt', 'comando-que-no-existe-en-esta-maquina'))
    ct('report', writeReport(['uno.txt']))
    expect(ct('controls').status).toBe(5)
  })

  it('the tests the task promised have to exist in what was staged', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(
      '**Tests:** N/A — fixture.\n**Verification:** the file is there.',
      "**Tests:** añade `'uno pinta uno'`.\n**Verification:** the file is there.",
    ))
    ct('report', writeReport(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8')).toMatch(/said it was adding the test 'uno pinta uno'/)
  })

  // ==========================================================================
  // THE SCOPE OF THAT CHECK — the two below are the same bug seen from its two
  // sides, and the one above caught neither: it rewrites the plan WITHOUT
  // committing it, so the test's name never reaches the index and
  // `git grep --cached` does not find it wherever it looks.
  //
  // In real life the plan IS committed —the gate requires it— and a
  // prescriptive plan CITES the code verbatim. Measured on repo-pulse's slice
  // #5: the name of every test of every task lives inside `docs/`. That is why
  // the plan of these two is committed: without that, the test passes with the
  // bug in place.
  // ==========================================================================
  const commitPlan = (text) => {
    writeFileSync(join(repo, 'plan.md'), text)
    execFileSync('git', ['add', 'plan.md'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'el plan del slice'], { cwd: repo, stdio: 'ignore' })
  }
  const withTestsLine = (line) => PLAN.replace(
    '**Tests:** N/A — fixture.\n**Verification:** the file is there.',
    `**Tests:** ${line}\n**Verification:** the file is there.`,
  )

  it('a WITHDRAWN test that is still named in the committed plan is not a test that is still there', () => {
    // The false positive: the work done properly and the checks in the red, so
    // the task could not be closed however much the implementer insisted.
    commitPlan(withTestsLine("retira `'uno pinta uno'`."))
    ct('report', writeReport(['uno.txt']))
    expect(ct('controls').stdout).toMatch(/controls: done/)
  })

  it('a PROMISED test that is only in the plan, and not in what the task touched, is red', () => {
    // The false negative, which is the serious one: without bounding the
    // scope, this check passes a task that promised a test and did not write
    // it —exactly the failure it exists for— because the name is in the plan.
    commitPlan(withTestsLine("añade `'uno pinta uno'`."))
    ct('report', writeReport(['uno.txt']))
    expect(ct('controls').stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8')).toMatch(/said it was adding the test 'uno pinta uno'/)
  })

  it('a promised test that IS in a path the task staged is green', () => {
    commitPlan(withTestsLine("añade `'uno pinta uno'`."))
    writeFileSync(join(repo, 'uno.txt'), "it('uno pinta uno')\n")
    ct('report', writeReport(['uno.txt']))
    expect(ct('controls').stdout).toMatch(/controls: done/)
  })

  it('a test the task said it withdrew and is still in a staged path is red', () => {
    commitPlan(withTestsLine("retira `'uno pinta uno'`."))
    writeFileSync(join(repo, 'uno.txt'), "it('uno pinta uno')\n")
    ct('report', writeReport(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controls: failed/)
    expect(readFileSync(runState().lastControlsLog, 'utf8')).toMatch(/said it was removing the test 'uno pinta uno' and it is still there/)
  })
})
