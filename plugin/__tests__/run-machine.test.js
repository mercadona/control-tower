// The table that decides the next step (scripts/run-machine.js).
//
// This file is EXHAUSTIVE on purpose: it walks the 42 (step, outcome) pairs
// that exist — 7 steps x 6 outcomes — and checks, one by one, either where the
// run goes, or that the transition THROWS. The reason is that the whole value
// of the design lies in the sequence not being decided by a model: a table
// with a gap is not a table, it is a table plus an implicit decision taken by
// omission.
import { describe, it, expect } from 'vitest'
import { after, newRun, STEPS, OUTCOMES, RUN_STATES, DEFAULT_BUDGETS, outcomeOfReconcile } from '../scripts/run-machine.js'
import { ReconcileOutcome } from '../scripts/reconcile-outcome.js'

const run = (over = {}) => ({ ...newRun({ plan: 'p.md', issue: 7, baseSha: 'abc', tasksTotal: 3 }), ...over })

const PASOS = Object.values(STEPS)
const RESULTADOS = Object.values(OUTCOMES)

// The pairs the table DOES describe. Everything else has to throw.
const DESCRITOS = new Set([
  'implement/done', 'implement/discarded',
  'controls/done', 'controls/failed', 'controls/indeterminate',
  'judge/done', 'judge/failed', 'judge/corrections-ordered', 'judge/discarded',
  // H9: the second veto does not implement again blindly — it goes through the adviser.
  'advise/done', 'advise/discarded',
  'commit/done', 'commit/failed',
  // §3.7: the steps that run after the last task is committed.
  'reconcile/done', 'reconcile/failed', 'reconcile/discarded',
  'global/done', 'global/failed', 'global/indeterminate',
  'slice-judge/done', 'slice-judge/failed', 'slice-judge/discarded',
  // The e2e closes the queue, and only if the slice declares runs.
  'e2e/done', 'e2e/failed', 'e2e/indeterminate', 'e2e/discarded',
  // over-budget is understood by every step.
  ...PASOS.map((p) => `${p}/over-budget`),
])

describe('the table, entire', () => {
  it.each(PASOS.flatMap((step) => RESULTADOS.map((outcome) => [step, outcome])))(
    'the pair (%s, %s) is described or it throws, it never decides in silence',
    (step, outcome) => {
      const llamada = () => after(run({ step }), outcome)
      if (DESCRITOS.has(`${step}/${outcome}`)) {
        const { state } = llamada()
        expect(Object.values(RUN_STATES)).toContain(state)
      } else {
        expect(llamada).toThrow(/transición imposible/)
      }
    },
  )

  it('the impossible message names the step and the outcome, so that it can be fixed', () => {
    expect(() => after(run({ step: STEPS.IMPLEMENT }), OUTCOMES.FAILED))
      .toThrow(/paso "implement".*resultado "failed"/)
  })
})

describe('implement', () => {
  it('done → controls', () => {
    expect(after(run(), OUTCOMES.DONE).run.step).toBe(STEPS.CONTROLS)
  })

  it('discarded → implement again, with one more discard and WITHOUT spending a retry', () => {
    const { run: r } = after(run({ discards: 1, controlRetries: 1 }), OUTCOMES.DISCARDED)
    expect(r.step).toBe(STEPS.IMPLEMENT)
    expect(r.discards).toBe(2)
    expect(r.controlRetries).toBe(1)
  })
})

describe('controls', () => {
  const enControles = (over) => run({ step: STEPS.CONTROLS, ...over })

  it('done → judge', () => {
    expect(after(enControles(), OUTCOMES.DONE).run.step).toBe(STEPS.JUDGE)
  })

  it('failed goes back to implement while retries remain, counting them', () => {
    const primero = after(enControles(), OUTCOMES.FAILED)
    expect(primero.run.step).toBe(STEPS.IMPLEMENT)
    expect(primero.run.controlRetries).toBe(1)
    expect(primero.state).toBe(RUN_STATES.OPEN)

    const segundo = after(enControles({ controlRetries: 1 }), OUTCOMES.FAILED)
    expect(segundo.run.controlRetries).toBe(2)
    expect(segundo.state).toBe(RUN_STATES.OPEN)
  })

  it('failed with the retries spent closes in blocked-controls', () => {
    const { state } = after(enControles({ controlRetries: DEFAULT_BUDGETS.controlRetries }), OUTCOMES.FAILED)
    expect(state).toBe(RUN_STATES.BLOCKED_CONTROLS)
  })

  it('indeterminate closes ON THE FIRST GO, without spending the retries', () => {
    // It could not be measured. Retrying blindly repeats the cost without changing anything.
    const { run: r, state } = after(enControles(), OUTCOMES.INDETERMINATE)
    expect(state).toBe(RUN_STATES.BLOCKED_CONTROLS)
    expect(r.controlRetries).toBe(0)
  })
})

describe('judge', () => {
  const enJuez = (over) => run({ step: STEPS.JUDGE, ...over })

  it('done → commit', () => {
    expect(after(enJuez(), OUTCOMES.DONE).run.step).toBe(STEPS.COMMIT)
  })

  it('failed —the veto— goes back to implement, and spent it closes in blocked-judge', () => {
    expect(after(enJuez(), OUTCOMES.FAILED).run.judgeRetries).toBe(1)
    expect(after(enJuez(), OUTCOMES.FAILED).run.step).toBe(STEPS.IMPLEMENT)
    expect(after(enJuez({ judgeRetries: 2 }), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_JUDGE)
  })

  it('the SECOND veto does not implement again blindly: it opens advise, spending its retry', () => {
    // H9. The retry this veto grants is the LAST one, and it is the one the
    // advisor-strategy pattern says to escalate instead of repeat.
    const { run: r, state } = after(enJuez({ judgeRetries: 1 }), OUTCOMES.FAILED)
    expect(r.step).toBe(STEPS.ADVISE)
    expect(r.judgeRetries).toBe(2)
    expect(state).toBe(RUN_STATES.OPEN)
  })

  it('corrections-ordered —the grumble— goes back to implement with a budget of ITS OWN', () => {
    const { run: r } = after(enJuez(), OUTCOMES.CORRECTIONS_ORDERED)
    expect(r.step).toBe(STEPS.IMPLEMENT)
    expect(r.correctionRetries).toBe(1)
    // It does not spend a veto retry: they are two different budgets.
    expect(r.judgeRetries).toBe(0)
  })

  it('corrections-ordered spent DELIVERS ALL THE SAME: it moves on to commit, it does not block', () => {
    // This is the difference between a judge that vetoes and a judge that
    // grumbles. If spending the corrections blocked, three minor complaints
    // would stop a task the judge had approved.
    const { run: r, state } = after(enJuez({ correctionRetries: 2 }), OUTCOMES.CORRECTIONS_ORDERED)
    expect(r.step).toBe(STEPS.COMMIT)
    expect(state).toBe(RUN_STATES.OPEN)
  })

  it('discarded → judge again, with one more discard and without spending a retry', () => {
    const { run: r } = after(enJuez({ judgeRetries: 1 }), OUTCOMES.DISCARDED)
    expect(r.step).toBe(STEPS.JUDGE)
    expect(r.discards).toBe(1)
    expect(r.judgeRetries).toBe(1)
  })
})

describe('the advise step', () => {
  const enConsejo = (over) => run({ step: STEPS.ADVISE, judgeRetries: 2, ...over })

  it('done → the third implement attempt, without spending anything more', () => {
    const { run: r, state } = after(enConsejo(), OUTCOMES.DONE)
    expect(r.step).toBe(STEPS.IMPLEMENT)
    expect(r.judgeRetries).toBe(2)
    expect(r.discards).toBe(0)
    expect(state).toBe(RUN_STATES.OPEN)
  })

  it('discarded → ask the adviser again, with one more discard and WITHOUT spending a retry', () => {
    // An advice that breaks the schema did not cost an implementation attempt:
    // the tree was not touched. Same treatment as the judge's illegible
    // verdict, and with the same backing — the slice's discard cap.
    const { run: r, state } = after(enConsejo({ discards: 1 }), OUTCOMES.DISCARDED)
    expect(r.step).toBe(STEPS.ADVISE)
    expect(r.discards).toBe(2)
    expect(r.judgeRetries).toBe(2)
    expect(state).toBe(RUN_STATES.OPEN)
  })
})

describe('commit', () => {
  const enCommit = (over) => run({ step: STEPS.COMMIT, ...over })

  it('done advances the task and returns the run to implement', () => {
    const { run: r, state } = after(enCommit({ task: 1 }), OUTCOMES.DONE)
    expect(r.task).toBe(2)
    expect(r.step).toBe(STEPS.IMPLEMENT)
    expect(state).toBe(RUN_STATES.OPEN)
  })

  it('done on the last task does NOT deliver: it opens the reconciliation with the retries at zero', () => {
    // Phase B: after the last commit the run no longer closes in delivered —
    // the branch still has to be reconciled with its base, the end-to-end has
    // to be run (global) and the whole slice has to be judged (slice-judge).
    const { run: r, state } = after(enCommit({ task: 3, tasksTotal: 3 }), OUTCOMES.DONE)
    expect(state).toBe(RUN_STATES.OPEN)
    expect(r.step).toBe(STEPS.RECONCILE)
    expect([r.controlRetries, r.judgeRetries, r.correctionRetries]).toEqual([0, 0, 0])
    // The discards and the money belong to the whole slice: they are not touched here.
    expect(r.discards).toBe(0)
  })

  it('failed closes in blocked-commit without retrying', () => {
    expect(after(enCommit(), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_COMMIT)
  })
})

describe('the reconcile step', () => {
  const enReconcile = (over = {}) => run({ step: STEPS.RECONCILE, ...over })

  it('a_branch_that_is_up_to_date_moves_on_to_the_global_verification', () => {
    const { run: siguiente, state } = after(enReconcile(), OUTCOMES.DONE)
    expect(siguiente.step).toBe(STEPS.GLOBAL)
    expect(state).toBe(RUN_STATES.OPEN)
  })

  it('a_conflict_that_was_not_resolved_spends_a_retry_before_blocking', () => {
    const { run: siguiente, state } = after(enReconcile({ reconcileRetries: 0 }), OUTCOMES.FAILED)
    expect(siguiente.step).toBe(STEPS.RECONCILE)
    expect(siguiente.reconcileRetries).toBe(1)
    expect(state).toBe(RUN_STATES.OPEN)
  })

  it('the_run_blocks_on_reconcile_once_its_retries_are_spent_instead_of_looping', () => {
    const agotado = enReconcile({ reconcileRetries: DEFAULT_BUDGETS.reconcileRetries })
    expect(after(agotado, OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_RECONCILE)
  })

  // Reconcile's discard is NOT implement's nor the judge's: there the answer
  // could not be read and the tree stayed as it was; here the conflict
  // persists (the discard does not abort the merge), so without spending a
  // retry every later round discards again and the ladder never comes down.
  it('a_discarded_round_spends_a_retry_because_the_conflict_survives_it_and_the_dispatch_was_paid', () => {
    const { run: siguiente } = after(enReconcile({ reconcileRetries: 0 }), OUTCOMES.DISCARDED)
    expect(siguiente.step).toBe(STEPS.RECONCILE)
    expect(siguiente.reconcileRetries).toBe(1)
    expect(siguiente.discards).toBe(1)
  })

  it('discarded_rounds_alone_reach_blocked_reconcile_instead_of_looping_until_the_discard_budget_dies', () => {
    const agotado = enReconcile({ reconcileRetries: DEFAULT_BUDGETS.reconcileRetries })
    expect(after(agotado, OUTCOMES.DISCARDED).state).toBe(RUN_STATES.BLOCKED_RECONCILE)
  })

  it('the_ladder_from_a_first_conflict_to_blocked_reconcile_is_walked_by_rounds_that_only_ever_discard', () => {
    const rondas = [OUTCOMES.FAILED, OUTCOMES.DISCARDED, OUTCOMES.DISCARDED]
    let actual = { run: enReconcile({ reconcileRetries: 0 }), state: RUN_STATES.OPEN }
    for (const outcome of rondas) actual = after(actual.run, outcome)

    expect(actual.state).toBe(RUN_STATES.BLOCKED_RECONCILE)
    expect(actual.run.discards).toBeLessThan(6)
  })

  it('the_last_committed_task_reconciles_before_it_verifies_globally', () => {
    const ultima = run({ step: STEPS.COMMIT, task: 3, tasksTotal: 3 })
    expect(after(ultima, OUTCOMES.DONE).run.step).toBe(STEPS.RECONCILE)
  })
})

describe('the projection of reconcile vocabulary', () => {
  it.each([
    [ReconcileOutcome.UP_TO_DATE, OUTCOMES.DONE],
    [ReconcileOutcome.MERGED, OUTCOMES.DONE],
    [ReconcileOutcome.RESOLVED, OUTCOMES.DONE],
    [ReconcileOutcome.CONFLICTING, OUTCOMES.FAILED],
    [ReconcileOutcome.UNMERGEABLE_TREE, OUTCOMES.FAILED],
    [ReconcileOutcome.ROUND_DISCARDED, OUTCOMES.DISCARDED],
    [ReconcileOutcome.MARKERS_COMMITTED, OUTCOMES.FAILED],
  ])('%s projects to %s', (miembro, esperado) => {
    expect(outcomeOfReconcile(miembro)).toBe(esperado)
  })

  // The list above is typed by hand, so a new member could fail to appear in
  // it and the dispatch would still go uncovered. This ties it to the
  // vocabulary: every member projects, whether it was written above or not.
  it('todo_miembro_del_vocabulario_tiene_proyeccion_y_ninguno_se_queda_sin_recorrer', () => {
    for (const miembro of Object.values(ReconcileOutcome)) {
      expect(() => outcomeOfReconcile(miembro), miembro).not.toThrow()
    }
  })

  it('un_miembro_nuevo_sin_proyectar_lanza_en_vez_de_caer_en_una_rama_por_omision', () => {
    expect(() => outcomeOfReconcile('un-miembro-que-nadie-proyecto')).toThrow()
  })
})

describe('global (§3.7-A: the plan end-to-end is run by the program)', () => {
  const enGlobal = (over) => run({ step: STEPS.GLOBAL, ...over })

  it('done → slice-judge', () => {
    expect(after(enGlobal(), OUTCOMES.DONE).run.step).toBe(STEPS.SLICE_JUDGE)
  })

  it('failed closes blocked-global ON THE FIRST GO, without retrying', () => {
    // Everything is committed: retrying measures the same tree and repeats the
    // cost without changing anything.
    expect(after(enGlobal(), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_GLOBAL)
  })

  it('indeterminate closes blocked-global just like failed', () => {
    expect(after(enGlobal(), OUTCOMES.INDETERMINATE).state).toBe(RUN_STATES.BLOCKED_GLOBAL)
  })
})

describe('slice-judge (§3.7-B: the coherence between tasks does have a judge)', () => {
  const enJuezDeSlice = (over) => run({ step: STEPS.SLICE_JUDGE, ...over })

  it('done closes in delivered', () => {
    expect(after(enJuezDeSlice(), OUTCOMES.DONE).state).toBe(RUN_STATES.DELIVERED)
  })

  it('failed closes blocked-slice-judge with no retries and no corrections-ordered', () => {
    // There is no implementer left here with staged work to hand it back to:
    // everything is a commit. A FAIL closes the run.
    expect(after(enJuezDeSlice(), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_SLICE_JUDGE)
  })

  it('discarded goes back to slice-judge with one more discard, without spending a retry', () => {
    const { run: r, state } = after(enJuezDeSlice({ discards: 2 }), OUTCOMES.DISCARDED)
    expect(state).toBe(RUN_STATES.OPEN)
    expect(r.step).toBe(STEPS.SLICE_JUDGE)
    expect(r.discards).toBe(3)
  })
})

describe('what is reset when the task advances and what is not', () => {
  it('the three retries go back to zero; the discards and the money carry on', () => {
    const gastado = enCurso()
    const { run: r } = after(gastado, OUTCOMES.DONE)
    expect([r.controlRetries, r.judgeRetries, r.correctionRetries]).toEqual([0, 0, 0])
    expect(r.discards).toBe(4)
    expect(r.spendUsd).toBe(12.5)
  })

  function enCurso() {
    return run({
      step: STEPS.COMMIT, task: 1,
      controlRetries: 2, judgeRetries: 1, correctionRetries: 2,
      discards: 4, spendUsd: 12.5,
    })
  }
})

describe('the money cuts above everything else', () => {
  it.each(PASOS)('over-budget closes the run in aborted-budget from %s', (step) => {
    expect(after(run({ step }), OUTCOMES.OVER_BUDGET).state).toBe(RUN_STATES.ABORTED_BUDGET)
  })
})

describe('the run that goes in is never touched', () => {
  it('the transition returns a copy and leaves the original intact', () => {
    const antes = run()
    const { run: despues } = after(antes, OUTCOMES.DONE)
    expect(antes.step).toBe(STEPS.IMPLEMENT)
    expect(despues).not.toBe(antes)
  })

  it('the run is frozen: writing over it does not sneak a state past the table', () => {
    const r = newRun({ plan: 'p.md', issue: 7, baseSha: 'abc', tasksTotal: 2 })
    expect(Object.isFrozen(r)).toBe(true)
    expect(() => { 'use strict'; r.task = 99 }).toThrow()
  })
})

describe('bespoke budgets', () => {
  it('with zero control retries, the first red already blocks', () => {
    const { state } = after(run({ step: STEPS.CONTROLS }), OUTCOMES.FAILED, { ...DEFAULT_BUDGETS, controlRetries: 0 })
    expect(state).toBe(RUN_STATES.BLOCKED_CONTROLS)
  })

  it('with more corrections budget, the grumble keeps going back to implement', () => {
    const { run: r } = after(run({ step: STEPS.JUDGE, correctionRetries: 2 }), OUTCOMES.CORRECTIONS_ORDERED,
      { ...DEFAULT_BUDGETS, correctionRetries: 5 })
    expect(r.step).toBe(STEPS.IMPLEMENT)
    expect(r.correctionRetries).toBe(3)
  })
})
