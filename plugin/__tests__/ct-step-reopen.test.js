// The way out of the judge's third veto. The preamble — and why there are nine
// files and not one — is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, writeVerdict, runState, judgeTask } = makeHelpers(() => repo)

const veto = () => judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))

const advise = () => {
  ct('next')
  const p = join(repo, 'advice.json')
  writeFileSync(p, JSON.stringify({ approach: 'por otro camino', files_to_reconsider: [] }))
  return ct('advice', p)
}

// Three vetoes, through the adviser the second one opens.
const blocked = () => {
  for (let i = 0; i < 3; i++) {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    veto()
    if (runState().step === 'advise') advise()
  }
  expect(runState().closed).toBe('blocked-judge')
}

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('a run the judge closed does not quietly close again', () => {
  it('next answers the closure instead of re-entering the judge', () => {
    blocked()

    const answered = ct('next')

    expect(answered.status).toBe(1)
    expect(answered.stdout + answered.stderr).toContain('reopen')
    expect(runState().step).toBe('judge')
  })

  it('next announces the closure it is standing on, not a step', () => {
    blocked()

    const answered = ct('next', '--output-format', 'json')
    const announced = JSON.parse(answered.stdout.trim().split('\n').pop())

    expect(announced.kind).toBe('refusal')
    expect(announced.state).toBe('blocked-judge')
    expect(announced.outcome).toBe('failed')
    expect(announced.exit).toBe(1)
  })

  it('a verb that would transition is a sequence error that names the way out', () => {
    blocked()

    const answered = ct('report', writeReport(['uno.txt']))

    expect(answered.status).toBe(9)
    expect(answered.stderr).toContain('reopen')
  })
})
