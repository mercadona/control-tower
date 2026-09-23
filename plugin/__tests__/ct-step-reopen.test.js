// The way out of the judge's third veto. The preamble — and why there are nine
// files and not one — is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, writeVerdict, writeRaw, runState, judgeTask, taskOk, reviewFix } = makeHelpers(() => repo)

const veto = () => judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))

const advise = () => {
  ct('next')
  const p = join(repo, 'advice.json')
  writeFileSync(p, JSON.stringify({ approach: 'por otro camino', files_to_reconsider: [] }))
  return ct('advice', p)
}

// Three vetoes at the review of the slice (#530), through the adviser the
// second one opens. `discarding` spends one discard on the way, on an answer the
// judge wrote that cannot be read: the only way the run reaches the closure with
// a non-zero discard count.
const blocked = ({ discarding = false } = {}) => {
  taskOk('uno.txt')
  taskOk('dos.txt')
  for (let i = 0; i < 3; i++) {
    if (i > 0) reviewFix()
    if (discarding && i === 0) judgeTask(writeRaw('no json'))
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

  it('every re-ask carries the reason again, because the backend announces each one', () => {
    blocked()

    const announcementOf = () => JSON.parse(ct('next', '--output-format', 'json').stdout.trim().split('\n').pop())
    const first = announcementOf()
    const second = announcementOf()

    expect(first.findings).toContain('mal')
    expect(first.verdict).toBe('.agent/run-7/task-2-verdict-3.json')
    expect(second).toEqual(first)
  })

  it('a verb that would transition is a sequence error that names the way out', () => {
    blocked()

    const answered = ct('report', writeReport(['uno.txt']))

    expect(answered.status).toBe(9)
    expect(answered.stderr).toContain('reopen')
  })
})

describe('reopen is the way a person gets a run out of the judge', () => {
  it('lifts the closure and sends the run back to the implementer', () => {
    blocked()

    const reopened = ct('reopen', '--instruction', 'redondea después de aplicar el descuento')

    expect(reopened.status).toBe(0)
    expect(runState().closed).toBeUndefined()
    expect(runState().step).toBe('implement')
    expect(runState().judgeRetries).toBe(0)
  })

  it('carries the person instruction to the implementer the way the adviser does', () => {
    blocked()

    ct('reopen', '--instruction', 'redondea después de aplicar el descuento')

    expect(runState().lastAdvice).toContain('redondea después de aplicar el descuento')
  })

  it('does not reset the discards, because an illegible judge is a different failure', () => {
    blocked({ discarding: true })
    const spent = runState().discards
    expect(spent).toBeGreaterThan(0)

    ct('reopen', '--instruction', 'otra vuelta')

    expect(runState().discards).toBe(spent)
  })

  it('after it, next dispatches the implementer again instead of answering a closure', () => {
    blocked()
    ct('reopen', '--instruction', 'otra vuelta')

    const answered = ct('next')

    expect(answered.status).toBe(0)
    expect(runState().step).toBe('implement')
  })

  it('a run that is not closed at the judge has nothing to reopen', () => {
    ct('report', writeReport(['uno.txt']))

    const refused = ct('reopen', '--instruction', 'otra vuelta')

    expect(refused.status).toBe(9)
    expect(refused.stderr).toContain('not closed')
  })

  it('an instruction is required, because a reopen with nothing to say repeats the veto', () => {
    blocked()

    const refused = ct('reopen')

    expect(refused.status).toBe(2)
    expect(refused.stderr).toContain('--instruction')
  })

  it('under the output format flag it announces a transition that leaves the run open', () => {
    blocked()

    const reopened = ct('reopen', '--instruction', 'otra vuelta', '--output-format', 'json')
    const announced = JSON.parse(reopened.stdout.trim().split('\n').pop())

    expect(announced.kind).toBe('transition')
    expect(announced.state).toBe('open')
    expect(announced.outcome).toBe('done')
    expect(announced.exit).toBe(0)
  })

  it('without the flag the stdout stays the prose a person reads', () => {
    blocked()

    const reopened = ct('reopen', '--instruction', 'otra vuelta')

    expect(reopened.stdout).toContain('run reopened at task 2 of issue 7')
    expect(reopened.stdout).not.toContain('{"version"')
  })
})
