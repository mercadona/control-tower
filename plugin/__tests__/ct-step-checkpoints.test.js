// #530 — the judge runs at the checkpoints the plan names, and at the last
// task. A task between checkpoints goes from green controls straight to
// commit, under the seal of its controls. The preamble is in
// fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLAN } from './fixtures/ct-step-harness.js'

// The harness plan with its only marker taken out: no task is a checkpoint, so
// only the last one is judged.
const UNMARKED = PLAN.replace('**Judge:** checkpoint\n', '')

let repo
const { ct, writeReport, commits, runState } = makeHelpers(() => repo)

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
    expect(commits()).toBe(1)
    expect(runState().step).toBe('commit')
  })
})
