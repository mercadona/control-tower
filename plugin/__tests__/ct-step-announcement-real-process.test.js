import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, sliceOk, taskOk, judgeSlice, writeSliceVerdict } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('ct-step next answers with the announcement under --output-format json', () => {
  it('the judge step answers with one JSON object carrying its response channel', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')

    const r = ct('next', '--output-format', 'json')

    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({
      version: 1,
      kind: 'step',
      run: { issue: 7, task: 1, tasksTotal: 2, step: 'judge', attempt: 1 },
      dispatch: { response: { kind: 'file', path: join(realpathSync(repo), '.agent', 'run-7', 'task-1-verdict.json') } },
    })
  })

  it('ct-step next keeps its prose when nobody asks for json', () => {
    const r = ct('next')

    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/DISPATCH AN IMPLEMENTER/)
    expect(() => JSON.parse(r.stdout)).toThrow()
  })

  it('the controls step announces the commands it measures and how to run them', () => {
    ct('report', writeReport(['uno.txt']))

    const r = ct('next', '--output-format', 'json')

    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({
      version: 1,
      kind: 'step',
      run: { issue: 7, task: 1, tasksTotal: 2, step: 'controls', attempt: 1 },
      commands: ['test -f uno.txt'],
      consuming: { argv: ['controls', '--plan', 'plan.md', '--issue', '7'] },
    })
  })

  it('the global step announces the commands of section eight', () => {
    taskOk('uno.txt')
    taskOk('dos.txt')
    ct('reconcile')

    const r = ct('next', '--output-format', 'json')

    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({
      version: 1,
      kind: 'step',
      run: { issue: 7, task: 2, tasksTotal: 2, step: 'global', attempt: 1 },
      commands: ['test -f uno.txt && test -f dos.txt'],
      consuming: { argv: ['global', '--plan', 'plan.md', '--issue', '7'] },
    })
  })

  it('a consuming verb answers the flag with its transition', () => {
    const r = ct('report', writeReport(['uno.txt']), '--output-format', 'json')

    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({
      version: 1,
      kind: 'transition',
      state: 'open',
      outcome: 'done',
      exit: 0,
      run: { issue: 7, task: 1, tasksTotal: 2, step: 'implement', discards: 0 },
    })
  })

  it('a verb that closes the run in failure answers with its refusal', () => {
    taskOk('uno.txt')
    taskOk('dos.txt')
    ct('reconcile')
    ct('global')

    const r = judgeSlice(writeSliceVerdict('FAIL', [{ severity: 'high', what: 'task 2 undoes task 1', path: 'uno.txt', line: 1 }]), '--output-format', 'json')

    expect(r.status).toBe(1)
    expect(JSON.parse(r.stdout)).toEqual({
      version: 1,
      kind: 'refusal',
      state: 'blocked-slice-judge',
      outcome: 'failed',
      exit: 1,
      run: { issue: 7, task: 2, tasksTotal: 2, step: 'slice-judge', discards: 0 },
      detail: 'run blocked-slice-judge: task 2/2, 0 discard(s)',
    })
  })

  it('an unknown output format refuses', () => {
    const r = ct('next', '--output-format', 'yaml')

    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/unknown --output-format/)
  })

  it('a delivered run refuses the flag instead of answering with silence', () => {
    sliceOk()

    const r = ct('next', '--output-format', 'json')

    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
  })
})
