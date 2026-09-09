// One piece of the state machine of scripts/ct-step.mjs. The preamble —and why
// there are nine files and not one— is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLAN } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, writeVerdict, writeSliceVerdict, commits, runState, judgeTask, taskOk } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('next: the session asks and the oracle answers', () => {
  it('states the task, the step and what to dispatch, without transitioning', () => {
    const r = ct('next')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/task 1\/2 — the first one/)
    expect(r.stdout).toMatch(/step: implement/)
    expect(r.stdout).toMatch(/DISPATCH AN IMPLEMENTER/)
    // And with which model: omitting it inherits the session's, the priciest one.
    expect(r.stdout).toMatch(/model sonnet/)
    // Asking advances nothing: the step is still the same one.
    expect(ct('next').stdout).toMatch(/step: implement/)
    expect(runState().step).toBe('implement')
  })

  it('prepares the task brief, which is what the implementer needs', () => {
    ct('next')
    const brief = join(repo, '.agent', 'run-7', 'task-1-brief.md')
    expect(existsSync(brief)).toBe(true)
    expect(readFileSync(brief, 'utf8')).toMatch(/### Task 1 — the first one/)
  })

  it('at the judge step it prepares the review package of the INDEX', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    const r = ct('next')
    expect(r.stdout).toMatch(/DISPATCH THE JUDGE .*ct-judge.*WITHOUT Bash/)
    // The property "implementer and judge read the same text" hangs off this
    // line: the judge's dispatch names the brief, or the judge never opens it.
    expect(r.stdout).toMatch(/the task's brief: .*task-1-brief\.md/)
    const reviewPackage = join(repo, '.agent', 'run-7', 'task-1-review.diff')
    expect(readFileSync(reviewPackage, 'utf8')).toMatch(/\+uno/)
  })

  it('when the judge sent the task back, next tells the implementer so', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'está mal', path: 'uno.txt', line: 1 }]))
    expect(ct('next').stdout).toMatch(/The judge sent this task back[\s\S]*uno\.txt:1: está mal/)
  })
})

// ---------------------------------------------------------------------------
// THE CENTRAL PROPERTY: the sequence is mechanism, not prose.
// ---------------------------------------------------------------------------
describe('the step guard', () => {
  it.each([
    ['commit', 'implement'],
    ['controls', 'implement'],
    ['verdict', 'implement'],
    ['global', 'implement'],
    ['slice-verdict', 'implement'],
  ])('asking for "%s" while in "%s" is REFUSED with 9, and it says which one is due', (verb, step) => {
    const withJson = { verdict: () => ct('verdict', writeVerdict('PASS')), 'slice-verdict': () => ct('slice-verdict', writeSliceVerdict('PASS')) }
    const r = withJson[verb] ? withJson[verb]() : ct(verb)
    expect(r.status).toBe(9)
    expect(r.stderr).toMatch(new RegExp(`the run is at "${step}"`))
    expect(r.stderr).toMatch(/ct-step next/)
  })

  it('the judge cannot be skipped in order to commit', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    const r = ct('commit')
    expect(r.status).toBe(9)
    expect(commits()).toBe(1)
  })

  it('a task already committed cannot be measured again', () => {
    taskOk('uno.txt')
    expect(runState().task).toBe(2)
    expect(ct('controls').status).toBe(9)   // task 2 is in implement
  })
})

describe('the plan and the environment', () => {
  it('a plan whose verification is prose exits with 6, and does not even say what to dispatch', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(/```bash\ntest -f uno\.txt\n```/, ''))
    const r = ct('next')
    expect(r.status).toBe(6)
    expect(r.stderr).toMatch(/plan no ejecutable/)
  })

  it('outside a slice worktree it exits with 8', () => {
    rmSync(join(repo, '.agent', 'SLICE.md'))
    expect(ct('next').status).toBe(8)
  })

  it('with the index dirty from before and the run new it exits with 8', () => {
    writeFileSync(join(repo, 'uno.txt'), 'uno\n')
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })
    expect(ct('next').status).toBe(8)
  })

  it('an unknown verb is a usage error', () => {
    expect(ct('bailar').status).toBe(2)
  })
})
