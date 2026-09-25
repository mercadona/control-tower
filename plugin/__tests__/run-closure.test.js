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

  it('a judge reopen after a controls reopen gives the judge brief', () => {
    const closed = ClosedRunMother.closedAtJudge({ reopenedFrom: RUN_STATES.BLOCKED_CONTROLS })
    const { closed: _lifted, reopenedFrom: _stale, ...rest } = closed
    const reopened = RunClosure.reopen(closed, ClosedRunMother.INSTRUCTION)

    expect(reopened).not.toHaveProperty('reopenedFrom')
    expect(reopened).toEqual({
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

describe('the end of a reopened round', () => {
  it('green controls end a controls reopen and keep a global one until the commit', () => {
    const afterControlsReopen = { task: 2, lastAdvice: ClosedRunMother.INSTRUCTION, reopenedFrom: RUN_STATES.BLOCKED_CONTROLS }
    const afterGlobalReopen = { task: 3, lastAdvice: ClosedRunMother.INSTRUCTION, reopenedFrom: RUN_STATES.BLOCKED_GLOBAL }

    expect(RunClosure.afterGreenControls(afterControlsReopen)).toEqual({ task: 2, lastAdvice: null, reopenedFrom: null })
    expect(RunClosure.afterGreenControls(afterGlobalReopen)).toEqual(afterGlobalReopen)
  })
})

describe('the fix round closed again', () => {
  it('a judge closure of the fix round reopens in the fix round', () => {
    const reopened = RunClosure.reopen(ClosedRunMother.closedAtJudge({ task: 3, phase: PHASES.FIX }), ClosedRunMother.INSTRUCTION)

    expect(reopened).toMatchObject({ task: 3, phase: PHASES.FIX, step: STEPS.IMPLEMENT, judgeRetries: 0 })
  })

  it('a controls closure of the fix round reopens in the fix round', () => {
    const reopened = RunClosure.reopen(ClosedRunMother.closedAtControls({ task: 3, phase: PHASES.FIX }), ClosedRunMother.INSTRUCTION)

    expect(reopened).toMatchObject({ task: 3, phase: PHASES.FIX, step: STEPS.IMPLEMENT, controlRetries: 0, reopenedFrom: RUN_STATES.BLOCKED_CONTROLS })
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

describe('a closure explains its way out', () => {
  it('the global closure names the failing command and the log path', () => {
    const closed = ClosedRunMother.closedAtGlobal({
      lastFailure: { outcome: OUTCOMES.FAILED, command: 'npm test', code: 1, log: '.agent/run-7/global.log' },
    })

    expect(RunClosure.wayOut({ run: closed, issue: 7, planPath: 'p.md', subject: 'the review' })).toBe(
      'the Global verification of issue 7 is red: `npm test` exited 1 (log at .agent/run-7/global.log) and the run is closed. '
      + 'Grant another round with "ct-step reopen --plan p.md --issue 7 --instruction \\"…\\"".',
    )
  })

  it('the controls closure names the failing command and the log path', () => {
    expect(RunClosure.wayOut({ run: ClosedRunMother.closedAtControls(), issue: 7, planPath: 'p.md', subject: 'task 2' })).toBe(
      'the controls of task 2 of issue 7 are red: `npm test` exited 1 (log at .agent/run-7/controls-2.log) and the run is closed. '
      + 'Grant another round with "ct-step reopen --plan p.md --issue 7 --instruction \\"…\\"".',
    )
  })

  it('an unmeasured command says it could not be measured', () => {
    expect(RunClosure.wayOut({ run: ClosedRunMother.closedAtGlobal(), issue: 7, planPath: 'p.md', subject: 'the review' })).toBe(
      'the Global verification of issue 7 could not be measured: `make build` (log at .agent/run-7/global.log) and the run is closed. '
      + 'Grant another round with "ct-step reopen --plan p.md --issue 7 --instruction \\"…\\"".',
    )
  })

  it('a red check with no command says so instead of naming one', () => {
    const closed = ClosedRunMother.closedAtControls({
      lastFailure: { outcome: OUTCOMES.FAILED, command: null, code: null, log: '.agent/run-7/controls-2.log' },
    })

    expect(RunClosure.wayOut({ run: closed, issue: 7, planPath: 'p.md', subject: 'task 2' })).toBe(
      'the controls of task 2 of issue 7 are red: a check that runs no command failed (log at .agent/run-7/controls-2.log) and the run is closed. '
      + 'Grant another round with "ct-step reopen --plan p.md --issue 7 --instruction \\"…\\"".',
    )
  })

  it('an unmeasured check with no command says it could not be measured', () => {
    const closed = ClosedRunMother.closedAtControls({
      lastFailure: { outcome: OUTCOMES.INDETERMINATE, command: null, code: null, log: '.agent/run-7/controls-2.log' },
    })

    expect(RunClosure.wayOut({ run: closed, issue: 7, planPath: 'p.md', subject: 'task 2' })).toBe(
      'the controls of task 2 of issue 7 could not be measured: a check that runs no command could not run (log at .agent/run-7/controls-2.log) and the run is closed. '
      + 'Grant another round with "ct-step reopen --plan p.md --issue 7 --instruction \\"…\\"".',
    )
  })

  it('a red global check with no command says it is red', () => {
    const closed = ClosedRunMother.closedAtGlobal({
      lastFailure: { outcome: OUTCOMES.FAILED, command: null, code: null, log: '.agent/run-7/global.log' },
    })

    expect(RunClosure.wayOut({ run: closed, issue: 7, planPath: 'p.md', subject: 'the review' })).toBe(
      'the Global verification of issue 7 is red: a check that runs no command failed (log at .agent/run-7/global.log) and the run is closed. '
      + 'Grant another round with "ct-step reopen --plan p.md --issue 7 --instruction \\"…\\"".',
    )
  })

  it('the judge way out reads as before this slice', () => {
    expect(RunClosure.wayOut({ run: ClosedRunMother.closedAtJudge(), issue: 7, planPath: 'p.md', subject: 'task 2' })).toBe(
      'the judge vetoed task 2 of issue 7 three times and the run is closed. '
      + 'Grant another round with "ct-step reopen --plan p.md --issue 7 --instruction \\"…\\"".',
    )
  })
})

describe('the outcome a closed run repeats', () => {
  it('the outcome of a closure is the judge failure or the recorded failure outcome', () => {
    const closures = [
      ClosedRunMother.closedAtJudge(),
      ClosedRunMother.closedAtControls({
        lastFailure: { outcome: OUTCOMES.INDETERMINATE, command: 'npm test', code: null, log: '.agent/run-7/controls-2.log' },
      }),
      ClosedRunMother.closedAtGlobal({
        lastFailure: { outcome: OUTCOMES.FAILED, command: 'npm test', code: 1, log: '.agent/run-7/global.log' },
      }),
    ]

    expect(closures.map((closed) => RunClosure.outcomeOf(closed))).toEqual([OUTCOMES.FAILED, OUTCOMES.INDETERMINATE, OUTCOMES.FAILED])
    expect(() => RunClosure.outcomeOf(ClosedRunMother.open({ closed: RUN_STATES.BLOCKED_SLICE_JUDGE }))).toThrow(/blocked-slice-judge/)
  })
})
