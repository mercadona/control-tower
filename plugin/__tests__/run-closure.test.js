import { describe, it, expect } from 'vitest'
import { newRun, PHASES, STEPS, OUTCOMES, RUN_STATES } from '../scripts/run-machine.js'
import { RunClosure, ReopenRefused } from '../scripts/run-closure.js'

class ClosedRunMother {
  static INSTRUCTION = 'read the log and fix the import of the parser'

  static open(over = {}) {
    return { ...newRun({ plan: 'p.md', issue: 7, baseSha: 'abc', tasksTotal: 3 }), ...over }
  }

  static closedAtControls(over = {}) {
    return ClosedRunMother.open({
      task: 2, step: STEPS.CONTROLS, controlRetries: 2, discards: 1,
      lastFailure: { outcome: OUTCOMES.FAILED, command: 'npm test', code: 1, log: '.agent/run-7/controls-2.log' },
      closed: RUN_STATES.BLOCKED_CONTROLS,
      ...over,
    })
  }

  static closedAtGlobal(over = {}) {
    return ClosedRunMother.open({
      task: 3, phase: PHASES.SLICE, step: STEPS.GLOBAL,
      controlRetries: 1, judgeRetries: 2, correctionRetries: 1, discards: 2,
      lastFailure: { outcome: OUTCOMES.INDETERMINATE, command: 'make build', code: null, log: '.agent/run-7/global.log' },
      closed: RUN_STATES.BLOCKED_GLOBAL,
      ...over,
    })
  }

  static closedAtJudge(over = {}) {
    return ClosedRunMother.open({
      task: 2, step: STEPS.JUDGE, judgeRetries: 2, discards: 3,
      lastFindings: 'the parser is untested',
      closed: RUN_STATES.BLOCKED_JUDGE,
      ...over,
    })
  }
}

describe('reopening a closure a person can lift', () => {
  it('a reopened controls closure goes back to the same task implementer with the control retries at zero', () => {
    const reopened = RunClosure.reopen(ClosedRunMother.closedAtControls(), ClosedRunMother.INSTRUCTION)

    expect(reopened).toMatchObject({ task: 2, phase: PHASES.TASK, step: STEPS.IMPLEMENT, controlRetries: 0 })
    expect(reopened.lastAdvice).toBe(ClosedRunMother.INSTRUCTION)
    expect(reopened.reopenedFrom).toBe(RUN_STATES.BLOCKED_CONTROLS)
    expect(reopened).not.toHaveProperty('closed')
  })

  it('a reopened global closure opens a fix round after the last task', () => {
    const reopened = RunClosure.reopen(ClosedRunMother.closedAtGlobal(), ClosedRunMother.INSTRUCTION)

    expect(reopened).toMatchObject({
      task: 3, phase: PHASES.FIX, step: STEPS.IMPLEMENT,
      controlRetries: 0, judgeRetries: 0, correctionRetries: 0,
      lastAdvice: ClosedRunMother.INSTRUCTION,
      reopenedFrom: RUN_STATES.BLOCKED_GLOBAL,
    })
    expect(reopened).not.toHaveProperty('closed')
  })

  it('the judge reopen gives the same run as before this slice', () => {
    const closed = ClosedRunMother.closedAtJudge()
    const { closed: _lifted, ...rest } = closed

    expect(RunClosure.reopen(closed, ClosedRunMother.INSTRUCTION)).toEqual({
      ...rest, step: STEPS.IMPLEMENT, judgeRetries: 0, lastAdvice: ClosedRunMother.INSTRUCTION,
    })
  })

  it('an open run has nothing to reopen', () => {
    const open = ClosedRunMother.open({ step: STEPS.CONTROLS })

    expect(() => RunClosure.reopen(open, ClosedRunMother.INSTRUCTION)).toThrow(ReopenRefused)
    expect(() => RunClosure.reopen(open, ClosedRunMother.INSTRUCTION)).toThrow(
      'the run of issue 7 is not closed at blocked-judge, blocked-controls or blocked-global: it stands at step controls, so there is nothing to reopen.',
    )
  })

  it('a slice judge closure has nothing to reopen', () => {
    const closed = ClosedRunMother.open({ phase: PHASES.SLICE, step: STEPS.SLICE_JUDGE, closed: RUN_STATES.BLOCKED_SLICE_JUDGE })

    expect(() => RunClosure.reopen(closed, ClosedRunMother.INSTRUCTION)).toThrow(ReopenRefused)
  })

  it('the discards survive every reopen', () => {
    const closures = [ClosedRunMother.closedAtJudge(), ClosedRunMother.closedAtControls(), ClosedRunMother.closedAtGlobal()]

    expect(closures.map((closed) => RunClosure.reopen(closed, ClosedRunMother.INSTRUCTION).discards)).toEqual([3, 1, 2])
  })
})

describe('the closures the run file keeps', () => {
  it('the run file keeps the three closures a person lifts', () => {
    expect([RUN_STATES.DELIVERED, RUN_STATES.BLOCKED_JUDGE, RUN_STATES.BLOCKED_CONTROLS, RUN_STATES.BLOCKED_GLOBAL]
      .map((state) => RunClosure.persists(state))).toEqual([true, true, true, true])
  })

  it('the run file keeps no slice judge, e2e, reconcile or commit closure', () => {
    expect([RUN_STATES.BLOCKED_SLICE_JUDGE, RUN_STATES.BLOCKED_E2E, RUN_STATES.BLOCKED_RECONCILE, RUN_STATES.BLOCKED_COMMIT]
      .map((state) => RunClosure.persists(state))).toEqual([false, false, false, false])
  })
})
