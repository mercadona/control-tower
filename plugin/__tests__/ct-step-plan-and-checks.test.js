// A slice of the state machine of scripts/ct-step.mjs. The preamble —and why
// there are nine files and not one— is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, mkdtempSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLAN, F } from './fixtures/ct-step-harness.js'

let repo
const { ct, ctIn, writeReport, commits, runState } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

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

  // THE PLAN OF THE NEXT TWO IS COMMITTED, not merely written: the amendment
  // control compares the working tree's plan against `HEAD:plan.md`, so
  // changing a task's **Files:** without committing reads as an amendment that
  // REMOVES a path, and that is red before any command is reached.
  const commitThePlanOfThisScenario = (plan) => {
    writeFileSync(join(repo, 'plan.md'), plan)
    execFileSync('git', ['add', '--', 'plan.md'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'the plan of this scenario'], { cwd: repo })
  }

  it('a task whose diff carries only documentation says why it did not run the suite, and does not run it', () => {
    commitThePlanOfThisScenario(PLAN
      .replace('**Files:** `uno.txt` (create).', '**Files:** `guia.md` (create).')
      .replace('test -f uno.txt', 'test -f no-existe.txt'))
    ct('report', writeReport(['guia.md']))

    const r = ct('controls')

    expect(r.stdout).toContain('controls: done')
    expect(r.stdout).toMatch(/no code/i)
  })

  it('a diff that carries documentation AND code runs the suite: one path of code is enough', () => {
    commitThePlanOfThisScenario(PLAN
      .replace('**Files:** `uno.txt` (create).', '**Files:** `guia.md` (create), `uno.ts` (create).')
      .replace('test -f uno.txt', 'test -f no-existe.txt'))
    ct('report', writeReport(['guia.md', 'uno.ts']))

    const r = ct('controls')

    expect(r.stdout).toContain('controls: failed')
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

  it('a name lookup that could not RUN closes the task as unmeasured, not as a missing test', () => {
    commitPlan(withTestsLine("añade `'uno pinta uno'`."))
    ct('report', writeReport(['uno.txt']))

    // A `git` shim first on PATH: it refuses `grep` with the exit status a
    // real git uses for a query it does not understand, and delegates
    // everything else to the real one, so the rest of the run is untouched.
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const shimDir = mkdtempSync(join(tmpdir(), 'ct-step-git-shim-'))
    const shimPath = join(shimDir, 'git')
    writeFileSync(shimPath, [
      '#!/bin/sh',
      'if [ "$1" = "grep" ]; then',
      '  exit 128',
      'fi',
      `exec "${realGit}" "$@"`,
      '',
    ].join('\n'))
    chmodSync(shimPath, 0o755)

    const r = ctIn({ PATH: `${shimDir}:${process.env.PATH}` }, 'controls')
    rmSyncBestEffort(shimDir)

    expect(r.status).toBe(5)
    const log = readFileSync(runState().lastControlsLog, 'utf8')
    expect(log).toMatch(/# names that could not be looked up/)
    expect(log).not.toMatch(/is not in what is staged/)
    expect(log).not.toMatch(/\$ test -f uno\.txt/)
  })
})
