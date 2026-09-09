// ============================================================================
// The e2e step in the table. TERMINAL, not per task: it is the LAST step of the
// queue that starts when the last task is committed (commit → global →
// slice-judge → e2e), and the only conditional one in that queue — it is only
// entered if the run declares e2e runs.
//
// Why terminal and not per task: the e2e verifies what the SLICE delivers, and
// a task is a commit — asking task 2 of 5 to walk a user flow is asking it to
// walk something that does not exist yet.
//
// And why in the table and not alongside the release: #31 made this function
// decide the sequence and not the prose of a skill. An e2e hooked up in
// parallel would be two mechanisms verifying the same delivery.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { after, newRun, deliveredRun, STEPS, OUTCOMES, RUN_STATES } from '../scripts/run-machine.js'

const enCommitDeLaUltima = (e2eRuns) => ({
  ...newRun({ plan: 'p.md', issue: 4, baseSha: 'abc', tasksTotal: 2, e2eRuns }),
  task: 2,
  step: STEPS.COMMIT,
})

// trasLaColaDeSlice: committing the last task NO LONGER decides the delivery —
// since Phase B (RECONCILE + GLOBAL + SLICE_JUDGE) there are three slice steps
// between that commit and the closure, and the e2e goes BEHIND all three: it is
// the last of the queue and the only conditional one. This helper walks the
// whole queue so that each test measures the transition it is about and not the
// order of the queue, which is tested in the global phase tests.
const trasLaColaDeSlice = (e2eRuns) => {
  const trasCommit = after(enCommitDeLaUltima(e2eRuns), OUTCOMES.DONE)
  const trasReconcile = after(trasCommit.run, OUTCOMES.DONE)
  const trasGlobal = after(trasReconcile.run, OUTCOMES.DONE)
  return after(trasGlobal.run, OUTCOMES.DONE)
}

describe('entering the e2e step', () => {
  it('with no e2e runs, the slice queue closes in DELIVERED without going through e2e', () => {
    const r = trasLaColaDeSlice([])
    expect(r.state).toBe(RUN_STATES.DELIVERED)
  })

  it('with e2e runs, the end of the slice queue opens the e2e step', () => {
    const r = trasLaColaDeSlice(['el server escucha en 9115'])
    expect(r.state).toBe(RUN_STATES.OPEN)
    expect(r.run.step).toBe(STEPS.E2E)
    // `task` does NOT advance: the e2e belongs to the SLICE, not to a third
    // task that does not exist — the same invariant ct-step checks when it
    // loads the state.
    expect(r.run.task).toBe(2)
  })

  it('an intermediate task does NOT enter e2e even when there are e2e runs', () => {
    const run = { ...enCommitDeLaUltima(['un recorrido']), task: 1 }
    const r = after(run, OUTCOMES.DONE)
    expect(r.state).toBe(RUN_STATES.OPEN)
    expect(r.run.step).toBe(STEPS.IMPLEMENT)
    expect(r.run.task).toBe(2)
  })

  it('newRun stores the e2e runs and leaves them frozen', () => {
    const run = newRun({ plan: 'p.md', issue: 4, baseSha: 'abc', tasksTotal: 1, e2eRuns: ['uno', 'dos'] })
    expect(run.e2eRuns).toEqual(['uno', 'dos'])
    expect(Object.isFrozen(run)).toBe(true)
  })

  it('newRun with no e2eRuns leaves an empty list, not undefined', () => {
    expect(newRun({ plan: 'p.md', issue: 4, baseSha: 'abc', tasksTotal: 1 }).e2eRuns).toEqual([])
  })
})

describe('the transitions of the e2e step', () => {
  const enE2e = () => trasLaColaDeSlice(['un recorrido']).run

  it('DONE closes in DELIVERED', () => {
    expect(after(enE2e(), OUTCOMES.DONE).state).toBe(RUN_STATES.DELIVERED)
  })

  it('FAILED closes in BLOCKED_E2E', () => {
    expect(after(enE2e(), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_E2E)
  })

  it('INDETERMINATE closes in DELIVERED: not verified does NOT hold the slice back', () => {
    // Deliberate: a docker that does not start would leave the slice in
    // status:in-progress holding area:/touches: and a cap slot with nobody
    // working — the failure mode F13 and F18 were dedicated to removing.
    expect(after(enE2e(), OUTCOMES.INDETERMINATE).state).toBe(RUN_STATES.DELIVERED)
  })

  it('DISCARDED repeats the step and adds a discard', () => {
    const r = after(enE2e(), OUTCOMES.DISCARDED)
    expect(r.state).toBe(RUN_STATES.OPEN)
    expect(r.run.step).toBe(STEPS.E2E)
    expect(r.run.discards).toBe(1)
  })

  it('OVER_BUDGET cuts above everything else, as in any step', () => {
    expect(after(enE2e(), OUTCOMES.OVER_BUDGET).state).toBe(RUN_STATES.ABORTED_BUDGET)
  })

  it('CORRECTIONS_ORDERED THROWS: the pair the table does not describe is not interpreted', () => {
    expect(() => after(enE2e(), OUTCOMES.CORRECTIONS_ORDERED)).toThrow(/impossible transition/)
  })

  it('the run that comes in is never touched', () => {
    const antes = enE2e()
    after(antes, OUTCOMES.FAILED)
    expect(antes.step).toBe(STEPS.E2E)
    expect(antes.discards).toBe(0)
  })

  // The release gate does not change its criterion: it keeps demanding `closed:
  // delivered`, and a run stopped at e2e does not have it. That is what makes a
  // new door unnecessary to enforce the step.
  it('a run stopped at e2e is NOT delivered as far as deliveredRun is concerned', () => {
    const parado = enE2e()
    const r = deliveredRun(JSON.stringify({ ...parado, issue: 4 }), 4)
    expect(r.ok).toBe(false)
    expect(r.why).toMatch(/is not delivered/)
  })
})
