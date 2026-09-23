// #530 — the judge reviews the slice once, after the last commit. Every task
// goes from green controls straight to commit, under the seal of its controls;
// the last commit opens the review, and a veto there sends an implementer back
// with the controls of every task to pass again. The preamble is in
// fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLAN } from './fixtures/ct-step-harness.js'

// The harness plan without the marker it still carries for the older tests.
const REVIEW_PLAN = PLAN.replace('**Judge:** checkpoint\n', '')

let repo
const { ct, writeReport, writeVerdict, commits, runState, judgeTask } = makeHelpers(() => repo)

const filesOf = (rev) => execFileSync('git', ['show', '--name-only', '--format=', rev], { cwd: repo, encoding: 'utf8' })
const subjectOf = (rev) => execFileSync('git', ['log', '-1', '--format=%s', rev], { cwd: repo, encoding: 'utf8' }).trim()

// Both tasks down the road with no judge, up to the review.
const commitBothTasks = () => {
  for (const file of ['uno.txt', 'dos.txt']) {
    ct('report', writeReport([file]))
    ct('controls')
    expect(runState().step).toBe('commit')
    expect(ct('commit').status).toBe(0)
  }
}

beforeEach(() => { repo = makeRepo({ plan: REVIEW_PLAN }) })
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
})
