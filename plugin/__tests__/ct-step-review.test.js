// #530 — the judge reviews the slice once, after the last commit. Every task
// goes from green controls straight to commit, under the seal of its controls;
// the last commit opens the review, and a veto there sends an implementer back
// with the controls of every task to pass again. The preamble is in
// fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, ctFrom, writeReport, writeVerdict, commits, runState, taskPackage, judgeTask,
  reviewFix, bornBeforeTheReview, judgedTaskOk } = makeHelpers(() => repo)

const filesOf = (rev) => execFileSync('git', ['show', '--name-only', '--format=', rev], { cwd: repo, encoding: 'utf8' })
const subjectOf = (rev) => execFileSync('git', ['log', '-1', '--format=%s', rev], { cwd: repo, encoding: 'utf8' }).trim()

// The diff section of a package, where the paths of the slice have to show.
const diffOf = (path) => readFileSync(path, 'utf8').split('## ').pop()
const TELEMETRY = 'docs/superpowers/metrics/issue-7.jsonl'
const REVIEW_VERDICT = 'docs/superpowers/verdicts/issue-7-review.json'

// Both tasks down the road with no judge, up to the review.
const commitBothTasks = () => {
  for (const file of ['uno.txt', 'dos.txt']) {
    ct('report', writeReport([file]))
    ct('controls')
    expect(runState().step).toBe('commit')
    expect(ct('commit').status).toBe(0)
  }
}

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('the review of the whole slice, after the last commit', () => {
  it('green controls on every task go straight to commit, and no task commit carries a verdict', () => {
    commitBothTasks()

    expect(commits()).toBe(3)
    for (const rev of ['HEAD~1', 'HEAD']) expect(filesOf(rev)).not.toContain('docs/superpowers/verdicts/')
    const state = runState()
    expect(state.step).toBe('judge')
    expect(state.reviewing).toBe(true)
    expect(state.task).toBe(2)
  })

  it('a veto at the review sends the implementer back, and the controls measure every task again', () => {
    commitBothTasks()
    judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'wrong in the first task', path: 'uno.txt', line: 1 }]))
    expect(runState().step).toBe('implement')

    writeFileSync(join(repo, 'uno.txt'), 'uno.txt, fixed at the review\n')
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    const controlsLog = readFileSync(runState().lastControlsLog, 'utf8')
    expect(controlsLog).toMatch(/\$ test -f uno\.txt[\s\S]*\$ test -f dos\.txt/)
    expect(runState().step).toBe('judge')

    judgeTask(writeVerdict('PASS'))
    const r = ct('commit')
    expect(r.status).toBe(0)
    expect(commits()).toBe(4)
    expect(subjectOf('HEAD')).toBe("the judge's review of the slice (#7, after task 2/2)")
    expect(filesOf('HEAD')).toContain('uno.txt')
    const state = runState()
    expect(state.step).toBe('reconcile')
    expect(state.reviewing).toBe(false)
    expect(state.sliceCommits).toBe(1)
    // A new process reads the state again, and the commit count still agrees.
    expect(ct('next').status).toBe(0)
  })

  it('the review package carries the diff of every task since the base, without the telemetry', () => {
    commitBothTasks()
    // The task commits carried the telemetry, so a plain diff against the base
    // would show it.
    const naive = execFileSync('git', ['diff', '--cached', '--name-only', runState().baseSha], { cwd: repo, encoding: 'utf8' })
    expect(naive).toContain(TELEMETRY)

    ct('next')
    const pkg = readFileSync(taskPackage(), 'utf8')
    expect(pkg).toMatch(/^# Review package: the 2 tasks of issue #7 \(committed since [0-9a-f]{7}, fixes staged\)$/m)
    expect(diffOf(taskPackage())).toMatch(/\+\+\+ b\/uno\.txt/)
    expect(diffOf(taskPackage())).toMatch(/\+\+\+ b\/dos\.txt/)
    expect(pkg).not.toContain(TELEMETRY)
  })

  it('the review judge brief carries every task of the plan once, with the plan context once', () => {
    commitBothTasks()

    const r = ct('next')
    expect(r.stdout).toContain('slice of issue 7 — the review of the 2 tasks')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'review-judge-brief.md'), 'utf8')
    expect(brief).toMatch(/### Task 1 — the first one[\s\S]*## Task 2 of the slice\n+### Task 2 — the second one/)
    expect(brief.match(/### Task 1 — the first one/g)).toHaveLength(1)
    expect(brief.match(/### Task 2 — the second one/g)).toHaveLength(1)
    expect(brief.match(/### Desired end state|\(section '### Desired end state' not found in the plan\)/g)).toHaveLength(1)
  })

  it('the approved fixes and the verdict land in one commit of their own, and the run moves to reconcile', () => {
    commitBothTasks()
    judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'wrong in the first task', path: 'uno.txt', line: 1 }]))
    const vetoed = ct('next')
    expect(vetoed.stdout).toContain('The judge reviewed the whole slice: fix every finding, in any file of any task. The fixes land in one commit after the judge approves them.')
    // The implementer of the fixes reads every task too.
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'review-brief.md'), 'utf8')
    expect(brief).toMatch(/### Task 1 — the first one[\s\S]*## Task 2 of the slice\n+### Task 2 — the second one/)

    writeFileSync(join(repo, 'uno.txt'), 'uno.txt, fixed at the review\n')
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    const r = ct('commit')

    expect(r.status).toBe(0)
    expect(commits()).toBe(4)
    const committed = filesOf('HEAD')
    expect(committed).toContain('uno.txt')
    expect(committed).toContain(REVIEW_VERDICT)
    expect(committed).not.toContain('dos.txt')
    expect(committed).not.toContain('issue-7-task-')
    // The review's verdict names no task: it has the slice verdict's shape.
    const saved = JSON.parse(execFileSync('git', ['show', `HEAD:${REVIEW_VERDICT}`], { cwd: repo, encoding: 'utf8' }))
    expect(Object.keys(saved)).toEqual(['issue', 'tasks_total', 'verdict'])
    expect(saved.tasks_total).toBe(2)
    expect(runState().step).toBe('reconcile')
  })

  it('an index changed after the review verdict is not committed', () => {
    commitBothTasks()
    judgeTask(writeVerdict('PASS'))
    writeFileSync(join(repo, 'extra.txt'), 'staged after the verdict\n')
    execFileSync('git', ['add', 'extra.txt'], { cwd: repo })

    const r = ct('commit')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/the index is no longer the one the judge approved/)
    expect(commits()).toBe(3)
    expect(runState().step).toBe('commit')
  })

  it('the review package carries the whole slice when ct-step runs from a subdirectory', () => {
    commitBothTasks()
    mkdirSync(join(repo, 'sub'))

    const r = ctFrom('sub', 'next')
    expect(r.status).toBe(0)
    const diff = diffOf(taskPackage())
    expect(diff).toMatch(/\+\+\+ b\/uno\.txt/)
    expect(diff).toMatch(/\+\+\+ b\/dos\.txt/)
    expect(readFileSync(taskPackage(), 'utf8')).not.toContain(TELEMETRY)
  })

  it('a last task with a controls retry keeps its archives through the review', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('commit')
    // The last task goes red once, so it archives two attempts of its own.
    ct('report', writeReport(['dos.txt']))
    rmSync(join(repo, 'dos.txt'))
    expect(ct('controls').stdout).toMatch(/controls: failed/)
    ct('report', writeReport(['dos.txt']))
    ct('controls')
    expect(ct('commit').status).toBe(0)
    const runDir = join(repo, '.agent', 'run-7')
    const taskReport = readFileSync(join(runDir, 'task-2-report-2.json'), 'utf8')
    const taskControls = readFileSync(join(runDir, 'task-2-controls-2.log'), 'utf8')

    // The review vetoes once, and its fix round is its own attempt 2.
    judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'wrong in the first task', path: 'uno.txt', line: 1 }]))
    ct('next')
    reviewFix(['uno.txt'])

    expect(readFileSync(join(runDir, 'task-2-report-2.json'), 'utf8')).toBe(taskReport)
    expect(readFileSync(join(runDir, 'task-2-controls-2.log'), 'utf8')).toBe(taskControls)
    expect(JSON.parse(readFileSync(join(runDir, 'review-report-2.json'), 'utf8')).paths).toEqual(['uno.txt'])
    expect(readFileSync(join(runDir, 'review-controls-2.log'), 'utf8')).toMatch(/\$ test -f uno\.txt[\s\S]*\$ test -f dos\.txt/)
    expect(existsSync(join(runDir, 'review-verdict-1.json'))).toBe(true)
  })

  it('the first review judge is handed no controls log of the last task', () => {
    commitBothTasks()

    const r = ct('next', '--output-format', 'json')
    expect(r.status).toBe(0)
    const { dispatch } = JSON.parse(r.stdout)
    expect(dispatch.inputs.map((i) => i.role)).toEqual(['package', 'brief'])
  })

  it('a review with nothing to commit, because its evidence is gitignored, goes on to reconcile with no commit to count', () => {
    appendFileSync(join(repo, '.gitignore'), 'docs/superpowers/\n')
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'ignore the evidence'], { cwd: repo })
    commitBothTasks()
    judgeTask(writeVerdict('PASS'))

    const r = ct('commit')
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/nothing to commit of the judge's review/)
    expect(commits()).toBe(4)
    const state = runState()
    expect(state.step).toBe('reconcile')
    expect(state.reviewing).toBe(false)
    expect(state.sliceCommits ?? 0).toBe(0)
    // A new process reads the state again, and the commit count still agrees.
    expect(ct('next').status).toBe(0)
  })
})

// Moved from the checkpoints suite (#530), whose other facts the tests above
// measure at the review.
describe('a task is committed under the seal of its controls', () => {
  it('green controls on a task go straight to commit, and the commit carries no verdict file and spends the seal', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    expect(runState().step).toBe('commit')

    const r = ct('commit')
    expect(r.status).toBe(0)
    expect(commits()).toBe(2)
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)
    expect(runState().sealedTree).toBeNull()
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

describe('a run born before the final review judges every task over its own diff', () => {
  it('the package of a task carries that task alone, after the task before it was judged and committed', () => {
    bornBeforeTheReview()
    judgedTaskOk('uno.txt')
    ct('report', writeReport(['dos.txt']))
    ct('controls')
    expect(runState().step).toBe('judge')

    ct('next')
    const pkg = readFileSync(taskPackage(), 'utf8')
    expect(pkg).toMatch(/^# Review package: task 2\/2 of issue #7 \(staged, not yet committed\)$/m)
    expect(diffOf(taskPackage())).not.toMatch(/uno\.txt/)
    expect(diffOf(taskPackage())).toMatch(/\+\+\+ b\/dos\.txt/)
  })
})
