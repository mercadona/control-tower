// #530 — the judge runs at the checkpoints the plan names, and at the last
// task. A task between checkpoints goes from green controls straight to
// commit, under the seal of its controls. The preamble is in
// fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLAN } from './fixtures/ct-step-harness.js'

// The harness plan with its only marker taken out: no task is a checkpoint, so
// only the last one is judged.
const UNMARKED = PLAN.replace('**Judge:** checkpoint\n', '')

let repo
const { ct, ctFrom, writeReport, writeVerdict, commits, runState, taskPackage, judgeTask, taskOk } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo({ plan: UNMARKED }) })
afterEach(() => { rmSyncBestEffort(repo) })

describe('a task the plan does not mark is committed with no judge', () => {
  it('green controls on a task the plan does not mark go straight to commit, and the commit carries no verdict file', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    expect(runState().step).toBe('commit')

    const r = ct('commit')
    expect(r.status).toBe(0)
    expect(commits()).toBe(2)
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)
    expect(runState().sealedTree).toBeNull()
  })

  it('the last task is judged even when the plan marks no checkpoint', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('commit')

    ct('report', writeReport(['dos.txt']))
    ct('controls')
    expect(runState().task).toBe(2)
    expect(runState().step).toBe('judge')
  })

  it('an index changed after the controls is not committed on a task with no judge', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    writeFileSync(join(repo, 'extra.txt'), 'staged after the controls\n')
    execFileSync('git', ['add', 'extra.txt'], { cwd: repo })

    const r = ct('commit')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/the index is no longer the one the judge approved/)
    expect(commits()).toBe(1)
    expect(runState().step).toBe('commit')
  })
})

// The harness plan with its marker moved from task 1 to task 2: task 1 is
// committed with no judge, and the judge of task 2 answers for both.
const SECOND_MARKED = UNMARKED.replace('**Objective:** another file.\n', '**Objective:** another file.\n**Judge:** checkpoint\n')

// The diff section of a package, where the paths of the stretch have to show.
const diffOf = (path) => readFileSync(path, 'utf8').split('## ').pop()

describe('the judge of a checkpoint sees its whole stretch', () => {
  const commitFirstUnjudged = () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('commit')
    ct('report', writeReport(['dos.txt']))
    ct('controls')
  }

  it('the package of a checkpoint carries the diff of every task since the last judged commit', () => {
    rmSyncBestEffort(repo)
    repo = makeRepo({ plan: SECOND_MARKED })
    commitFirstUnjudged()
    expect(runState().step).toBe('judge')

    ct('next')
    const pkg = readFileSync(taskPackage(), 'utf8')
    expect(pkg).toMatch(/^# Review package: tasks 1-2\/2 of issue #7 \(1-1 committed since [0-9a-f]{7}, 2 staged\)$/m)
    expect(diffOf(taskPackage())).toMatch(/\+\+\+ b\/uno\.txt/)
    expect(diffOf(taskPackage())).toMatch(/\+\+\+ b\/dos\.txt/)
  })

  it('the package of a checkpoint right after another carries its own task alone', () => {
    rmSyncBestEffort(repo)
    repo = makeRepo()
    taskOk('uno.txt')
    ct('report', writeReport(['dos.txt']))
    ct('controls')

    ct('next')
    const pkg = readFileSync(taskPackage(), 'utf8')
    expect(pkg).toMatch(/^# Review package: task 2\/2 of issue #7 \(staged, not yet committed\)$/m)
    expect(diffOf(taskPackage())).not.toMatch(/uno\.txt/)
    expect(diffOf(taskPackage())).toMatch(/\+\+\+ b\/dos\.txt/)
  })

  it('the package leaves the telemetry of the committed tasks out of the diff', () => {
    rmSyncBestEffort(repo)
    repo = makeRepo({ plan: SECOND_MARKED })
    commitFirstUnjudged()
    // The commit of task 1 carried the telemetry, so a plain diff against the
    // last judged commit would show it.
    const telemetry = 'docs/superpowers/metrics/issue-7.jsonl'
    const committed = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(committed).toContain(telemetry)
    const naive = execFileSync('git', ['diff', '--cached', '--name-only', runState().judgedSha], { cwd: repo, encoding: 'utf8' })
    expect(naive).toContain(telemetry)

    ct('next')
    expect(readFileSync(taskPackage(), 'utf8')).not.toContain(telemetry)
  })

  it('the judge brief of a checkpoint carries every task of its stretch', () => {
    rmSyncBestEffort(repo)
    repo = makeRepo({ plan: SECOND_MARKED })
    commitFirstUnjudged()

    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-2-judge-brief.md'), 'utf8')
    expect(brief).toMatch(/### Task 2 — the second one[\s\S]*## Earlier task of this stretch: 1\n+### Task 1 — the first one/)
    // The earlier task travels without a second copy of the plan context.
    expect(brief.match(/### Desired end state|\(section '### Desired end state' not found in the plan\)/g)).toHaveLength(1)
  })

  it('a veto at a checkpoint tells the implementer the earlier tasks of the stretch are its to fix', () => {
    rmSyncBestEffort(repo)
    repo = makeRepo({ plan: SECOND_MARKED })
    commitFirstUnjudged()
    judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'wrong in the earlier task', path: 'uno.txt', line: 1 }]))

    const r = ct('next')
    expect(r.stdout).toContain('The judge reviewed tasks 1-2 together: a finding in a file of an earlier task of that stretch is yours to fix in this attempt, and it lands in the commit of task 2.')
  })

  it('the package of a checkpoint carries the whole stretch when ct-step runs from a subdirectory', () => {
    rmSyncBestEffort(repo)
    repo = makeRepo({ plan: SECOND_MARKED })
    commitFirstUnjudged()
    mkdirSync(join(repo, 'sub'))

    const r = ctFrom('sub', 'next')
    expect(r.status).toBe(0)
    const diff = diffOf(taskPackage())
    expect(diff).toMatch(/\+\+\+ b\/uno\.txt/)
    expect(diff).toMatch(/\+\+\+ b\/dos\.txt/)
    expect(readFileSync(taskPackage(), 'utf8')).not.toContain('docs/superpowers/metrics/issue-7.jsonl')
  })

  it('a retry after a veto at a checkpoint fixes a file of an earlier task, and the fix lands in the commit of the checkpoint', () => {
    rmSyncBestEffort(repo)
    repo = makeRepo({ plan: SECOND_MARKED })
    commitFirstUnjudged()
    judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'wrong in the earlier task', path: 'uno.txt', line: 1 }]))
    ct('next')

    writeFileSync(join(repo, 'uno.txt'), 'uno.txt, fixed at the checkpoint\n')
    ct('report', writeReport(['uno.txt', 'dos.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    const r = ct('commit')

    expect(r.status).toBe(0)
    expect(commits()).toBe(3)
    const committed = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(committed).toContain('uno.txt')
  })
})
