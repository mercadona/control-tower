import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, sliceOk } = makeHelpers(() => repo)

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

  it('a program step announces its run and no dispatch', () => {
    ct('report', writeReport(['uno.txt']))

    const r = ct('next', '--output-format', 'json')

    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({
      version: 1,
      kind: 'step',
      run: { issue: 7, task: 1, tasksTotal: 2, step: 'controls', attempt: 1 },
    })
  })

  it('a verb other than next refuses the flag', () => {
    const r = ct('controls', '--output-format', 'json')

    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/only "ct-step next" answers with an announcement/)
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
