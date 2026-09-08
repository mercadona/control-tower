// ============================================================================
// RUN-MACHINE — who decides the next step of the implementation phase.
//
// Today a chat session decides it by reading prose
// (`subagent-driven-development` in the skill's own language). Here this table
// decides it, and it is a pure function: same state and same outcome, same
// decision, always, and with no need for a model to take it.
//
// Ported from agentic-skills' `state_machine.py` and reduced to Control
// Tower's shape: of its seven steps, four survive. The alignment one does not
// apply —its equivalent is the `plan` gate, which happens before the program
// starts— and neither do `await-ci` / `await-merge`: this repo has no
// continuous integration (D-6 is still open) and the merge is a human decision
// with the pull request in front of it, which is where the session stops
// today.
//
// The dimension the original does NOT have is the TASK: there the run is the
// whole slice, here a slice is N tasks and each one is a commit. That is why
// the three retry counters are reset when moving on to the next task —each
// task starts its own count afresh— while the discards and the money
// accumulate over the whole slice.
//
// §3.7 of the handoff (docs/prompt-juez-lo-que-queda.md) adds the two steps
// that close its two holes: `## 8. Global verification` was never run by
// anyone (`controls` only measures the PER-TASK block) and the whole slice
// never had a judge (`ct-judge` judges one task; the coherence between the
// three was looked at by nobody). The four steps of before become SIX: after
// the last task is committed, `commit` no longer closes the run — it opens
// `global` (the program runs the end-to-end) and, on green, `slice-judge` (the
// judgement of the whole slice). Both go WITHOUT a retry of their own:
// everything is committed, so retrying measures the same tree and repeats the
// cost without changing anything — the same reasoning that already closes
// `indeterminate` on the first go in `controls`.
//
// PURE: not one import, not one read, not one clock. That is what makes it
// possible to test the whole table —impossible pairs included— without
// touching disk or launching a process.
// ============================================================================

import { ReconcileOutcome } from './reconcile-outcome.js'

export const STEPS = Object.freeze({
  IMPLEMENT: 'implement',
  CONTROLS: 'controls',
  JUDGE: 'judge',
  // ADVISE (H9) — between the SECOND veto and the THIRD attempt, and nowhere
  // else. The first two attempts are the feedback-flip pattern: the
  // implementer inherits the vetoed tree and the verdict that vetoed it, and
  // that is the right thing while the correction is local. The third one no
  // longer is — it patches two layers of patches — so here the strategy is
  // changed instead of repeating the same one blindly: an adviser of a higher
  // tier, with no tool other than `Read`, looks at the two attempts and the
  // two vetoes and dictates an approach, and the program returns the tree to
  // the last commit before the third implementer starts (happy-to-delete).
  //
  // WITH NO COUNTER OF ITS OWN, and that is a decision: the retry this step
  // occupies was already spent by the veto that opened it (`judgeRetries`), so
  // the attempt is still `controlRetries + judgeRetries + correctionRetries +
  // 1` — the same formula the dispatch's stamp and the backend that reads this
  // file count.
  ADVISE: 'advise',
  COMMIT: 'commit',
  // RECONCILE goes BEFORE GLOBAL and not after: the plan's end-to-end
  // (`global`) has to run over the tree already brought up to date with its
  // base, not over one that lags behind and that the pull request's merge then
  // moves again. Verifying before reconciling would measure a tree that is no
  // longer the one being delivered.
  RECONCILE: 'reconcile',
  // GLOBAL / SLICE_JUDGE (§3.7) and E2E are the three steps that are NOT
  // per-task: they are entered on committing the last one, and they close the
  // SLICE, not a task.
  GLOBAL: 'global',
  SLICE_JUDGE: 'slice-judge',
  // E2E — the last of that queue, and the only conditional one: it is only
  // entered if the slice declares runs. It goes here and not hung off
  // `controls` because `controls` measures what the PLAN promised against the
  // tree, per task, and this walks through what the SPEC declared against the
  // system brought up, per slice. Hanging it off controls would force every
  // task to drag along an e2e that is none of its business, or a special
  // controls on the last one — a branch of the table that describes no real
  // state.
  E2E: 'e2e',
})

export const OUTCOMES = Object.freeze({
  DONE: 'done',
  FAILED: 'failed',
  INDETERMINATE: 'indeterminate',
  CORRECTIONS_ORDERED: 'corrections-ordered',
  DISCARDED: 'discarded',
  OVER_BUDGET: 'over-budget',
})

export const RUN_STATES = Object.freeze({
  OPEN: 'open',
  DELIVERED: 'delivered',
  BLOCKED_CONTROLS: 'blocked-controls',
  BLOCKED_JUDGE: 'blocked-judge',
  BLOCKED_COMMIT: 'blocked-commit',
  BLOCKED_GLOBAL: 'blocked-global',
  BLOCKED_SLICE_JUDGE: 'blocked-slice-judge',
  BLOCKED_RECONCILE: 'blocked-reconcile',
  // Same place and same shape as its siblings: a closure in failure that a
  // person gets out of, not a retry.
  BLOCKED_E2E: 'blocked-e2e',
  ABORTED_BUDGET: 'aborted-budget',
})

export const DEFAULT_BUDGETS = Object.freeze({
  controlRetries: 2,
  judgeRetries: 2,
  correctionRetries: 2,
  reconcileRetries: 2,
})

// The newborn run: task 1, step implement, every counter at zero.
export function newRun({ plan, issue, baseSha, tasksTotal, e2eRuns }) {
  return freeze({
    plan, issue, baseSha,
    task: 1,
    tasksTotal,
    // e2eRuns — the runs the spec's E2E column declares for this slice, seeded
    // by /ct-next into .agent/SLICE.md (ct-step does not talk to GitHub). An
    // empty list and not `undefined` on purpose: `[]` means "this slice has no
    // e2e" and is a datum, whereas `undefined` cannot be told apart from "an
    // old version wrote this run".
    e2eRuns: Array.isArray(e2eRuns) ? [...e2eRuns] : [],
    step: STEPS.IMPLEMENT,
    controlRetries: 0,
    judgeRetries: 0,
    correctionRetries: 0,
    reconcileRetries: 0,
    discards: 0,
    spendUsd: 0,
  })
}

const freeze = (run) => Object.freeze({ ...run })
const con = (run, cambios) => freeze({ ...run, ...cambios })

const abierto = (run, cambios) => ({ run: con(run, cambios), state: RUN_STATES.OPEN })
const cerrado = (run, state) => ({ run: freeze(run), state })

// The pair the table does not describe THROWS. It does not fall into a generic
// branch and it is not read as "well, carry on where you were": it is the
// original's `_impossible` property, and it is what makes a new outcome —or a
// step reached by a path nobody thought of— a noisy error and not a silent
// decision taken by omission.
function imposible(run, outcome) {
  throw new Error(`transición imposible: el paso "${run.step}" no sabe qué hacer con el resultado "${outcome}"`)
}

// ============================================================================
// THE TABLE (§3.3 of the spec)
//
//   after(run, outcome, budgets) → { run, state }
//
// `state` is `open` while the run is still alive, and the reason for the
// closure when it is not. Every transition returns a COPY: the run that goes
// in is never touched, so whoever persists the state can keep the previous one
// without fear.
// ============================================================================
export function after(run, outcome, budgets = DEFAULT_BUDGETS) {
  // The money cuts above everything else. It does not matter which step the
  // run is on: if the cap is spent, the next call is not launched.
  if (outcome === OUTCOMES.OVER_BUDGET) return cerrado(run, RUN_STATES.ABORTED_BUDGET)

  switch (run.step) {
    case STEPS.IMPLEMENT: return trasImplementar(run, outcome)
    case STEPS.CONTROLS: return trasLosControles(run, outcome, budgets)
    case STEPS.JUDGE: return trasElJuez(run, outcome, budgets)
    case STEPS.ADVISE: return trasElConsejo(run, outcome)
    case STEPS.COMMIT: return trasElCommit(run, outcome)
    case STEPS.RECONCILE: return trasReconciliar(run, outcome, budgets)
    case STEPS.GLOBAL: return trasLaGlobal(run, outcome)
    case STEPS.SLICE_JUDGE: return trasElJuezDeSlice(run, outcome)
    case STEPS.E2E: return trasElE2e(run, outcome)
    default: return imposible(run, outcome)
  }
}

function trasImplementar(run, outcome) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return abierto(run, { step: STEPS.CONTROLS })
    // The implementer's report that cannot be read. It does not spend a retry
    // because the code was not touched: the only thing backing this path is
    // the cap in money.
    case OUTCOMES.DISCARDED:
      return abierto(run, { step: STEPS.IMPLEMENT, discards: run.discards + 1 })
    default:
      return imposible(run, outcome)
  }
}

function trasLosControles(run, outcome, budgets) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return abierto(run, { step: STEPS.JUDGE })
    case OUTCOMES.FAILED:
      return run.controlRetries < budgets.controlRetries
        ? abierto(run, { step: STEPS.IMPLEMENT, controlRetries: run.controlRetries + 1 })
        : cerrado(run, RUN_STATES.BLOCKED_CONTROLS)
    // It could not be MEASURED: the command does not exist, or it hung and the
    // time cap fired. Retrying blindly repeats the cost without changing
    // anything, so it closes on the first go instead of spending both
    // attempts.
    case OUTCOMES.INDETERMINATE:
      return cerrado(run, RUN_STATES.BLOCKED_CONTROLS)
    default:
      return imposible(run, outcome)
  }
}

function trasElJuez(run, outcome, budgets) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return abierto(run, { step: STEPS.COMMIT })
    case OUTCOMES.FAILED:
      if (run.judgeRetries >= budgets.judgeRetries) return cerrado(run, RUN_STATES.BLOCKED_JUDGE)
      // THE LAST RETRY IS NOT GRANTED BLINDLY. Whether the one being granted
      // is the last is the only question that separates the two paths, and it
      // is asked with the budget in front of it instead of with a typed `2`:
      // whoever raises `judgeRetries` to three moves the adviser to the third
      // veto without touching this line.
      return esElUltimoReintentoDeVeto(run, budgets)
        ? abierto(run, { step: STEPS.ADVISE, judgeRetries: run.judgeRetries + 1 })
        : abierto(run, { step: STEPS.IMPLEMENT, judgeRetries: run.judgeRetries + 1 })
    // The difference between a judge that VETOES and a judge that GRUMBLES: a
    // PASS with findings that are not of low severity goes back to the
    // implementer with a budget of its own, and spending it DELIVERS ALL THE
    // SAME. Without this distinction, every grumble would spend a veto retry
    // and three minor complaints would block a task the judge had approved.
    case OUTCOMES.CORRECTIONS_ORDERED:
      return run.correctionRetries < budgets.correctionRetries
        ? abierto(run, { step: STEPS.IMPLEMENT, correctionRetries: run.correctionRetries + 1 })
        : abierto(run, { step: STEPS.COMMIT })
    // The verdict that breaks the schema. Like the implementer's discard: the
    // code was not touched, so it does not spend a retry.
    case OUTCOMES.DISCARDED:
      return abierto(run, { step: STEPS.JUDGE, discards: run.discards + 1 })
    default:
      return imposible(run, outcome)
  }
}

// H9 — the advice, between the second veto and the third attempt. Only two
// outcomes: the advice that meets the schema (and with it the clean tree and
// the third attempt's brief) or the one that does not.
//
// The DISCARD does not spend a retry, and it is the same reasoning that
// already rules in `implement` and in the judge: the adviser does not touch
// the code, so a JSON that breaks the schema cannot cost an implementation
// attempt — just as an illegible verdict is not a veto. What backs this
// self-loop is the slice's discard cap, not a budget of its own; and unlike
// `reconcile`, no half-made state is left here that would make the next round
// discard for the same reason again.
function trasElConsejo(run, outcome) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return abierto(run, { step: STEPS.IMPLEMENT })
    case OUTCOMES.DISCARDED:
      return abierto(run, { step: STEPS.ADVISE, discards: run.discards + 1 })
    default:
      return imposible(run, outcome)
  }
}

function trasElCommit(run, outcome) {
  switch (outcome) {
    case OUTCOMES.DONE:
      // Each task starts its retry count afresh. The discards and the money do
      // not: those belong to the whole slice.
      return run.task < run.tasksTotal
        ? abierto(run, {
            task: run.task + 1,
            step: STEPS.IMPLEMENT,
            controlRetries: 0,
            judgeRetries: 0,
            correctionRetries: 0,
          })
        // The last task committed does NOT deliver the run: §3.7 opens the
        // RECONCILE phase here — the branch has to end up up to date with its
        // base before GLOBAL measures the end-to-end — with the three counters
        // at zero (the phase starts its own count afresh, like every task).
        // `delivered` comes to mean tasks committed + branch reconciled +
        // end-to-end green + slice judged, not just the first of those.
        //
        // `task` does NOT advance in any of the steps of that final queue
        // (RECONCILE, GLOBAL, SLICE_JUDGE and, if the spec declared runs,
        // E2E): they are steps of the SLICE, not of a sixth task that does not
        // exist. (Careful: that breaks the `commits === task - 1` invariant
        // ct-step checks when loading the state — see Task 8.)
        : abierto(run, { step: STEPS.RECONCILE, controlRetries: 0, judgeRetries: 0, correctionRetries: 0 })
    // A commit that fails is not retried: if git says no, it is the index or
    // the message, and neither of those gets fixed by implementing again.
    case OUTCOMES.FAILED:
      return cerrado(run, RUN_STATES.BLOCKED_COMMIT)
    default:
      return imposible(run, outcome)
  }
}

// THE RECONCILIATION (Phase B). The policy lives here, not in the verb that
// will do the `git merge`/`git rebase`: which step comes after each outcome
// and what counts as spent is a decision of this table.
function trasReconciliar(run, outcome, budgets) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return abierto(run, { step: STEPS.GLOBAL })
    case OUTCOMES.FAILED:
      return reconcileBudgetSpent(run, budgets)
        ? cerrado(run, RUN_STATES.BLOCKED_RECONCILE)
        : abierto(run, { step: STEPS.RECONCILE, reconcileRetries: run.reconcileRetries + 1 })
    // The discarded round DOES spend a retry, and this is where this step
    // parts company with implement and with the judge. There a discard means
    // "the answer could not be read" and the tree stayed as it was, so the
    // next round starts from scratch. Here the conflict PERSISTS: the discard
    // does not abort the merge, so every later call goes back to `conclude()`
    // and discards again. Without spending, `reconcileRetries` is never
    // consumed, BLOCKED_RECONCILE and the handover to the slice agent are
    // unreachable, and the run ends up dying in MAX_DISCARDS —"there is no
    // trustworthy verdict"— while talking about a half-made merge. And the
    // expensive part has already been spent: every discard consumed a real
    // dispatch of ct-reconciler.
    case OUTCOMES.DISCARDED:
      return reconcileBudgetSpent(run, budgets)
        ? cerrado(run, RUN_STATES.BLOCKED_RECONCILE)
        : abierto(run, {
            step: STEPS.RECONCILE,
            reconcileRetries: run.reconcileRetries + 1,
            discards: run.discards + 1,
          })
    default:
      return imposible(run, outcome)
  }
}

// The question about the reconcile budget, with the datum. `ct-step` asks it
// to decide who the message names —the reconciler or already the slice agent—
// and the table asks it to decide whether it holds on to the step or closes in
// BLOCKED_RECONCILE: it is ONE decision, and the two halves have to answer the
// same thing or the verb announces one thing and the machine does another.
// The question about the last veto retry, with the datum — exported for the
// same reason as `reconcileBudgetSpent`: `ct-step` asks it in order to name in
// the veto's message who gets dispatched next, and the table asks it to decide
// the step. It is ONE decision, and the two halves have to answer the same
// thing or the verb announces one thing and the machine does another.
export function esElUltimoReintentoDeVeto(run, budgets = DEFAULT_BUDGETS) {
  return run.judgeRetries + 1 === budgets.judgeRetries
}

export function reconcileBudgetSpent(run, budgets = DEFAULT_BUDGETS) {
  return run.reconcileRetries >= budgets.reconcileRetries
}

// The projection of Task 4's vocabulary (`reconcile-outcome.js`) onto the
// flow's vocabulary. It lives here and not in `ct-step.mjs`: translating the
// outcome of a step into the flow's vocabulary is the destination's business,
// not the conductor's.
export function outcomeOfReconcile(reconcileOutcome) {
  switch (reconcileOutcome) {
    case ReconcileOutcome.UP_TO_DATE:
    case ReconcileOutcome.MERGED:
    case ReconcileOutcome.RESOLVED:
      return OUTCOMES.DONE
    case ReconcileOutcome.CONFLICTING:
    case ReconcileOutcome.UNMERGEABLE_TREE:
    // Conflict markers INSIDE a merge commit that is already made: there is no
    // round to discard (no live merge is left) and the step does not advance —
    // whoever has a shell fixes it, and if they do not, it blocks. Same
    // projection as the dirty tree, for the same reason.
    case ReconcileOutcome.MARKERS_COMMITTED:
      return OUTCOMES.FAILED
    case ReconcileOutcome.ROUND_DISCARDED:
      return OUTCOMES.DISCARDED
    default:
      throw new Error(`desenlace de reconciliación sin proyectar: "${reconcileOutcome}"`)
  }
}

// THE GLOBAL VERIFICATION (§3.7-A). `ct-step global` runs the plan's "## 8.
// Global verification" block, with the same machinery as `controls`: the exit
// code rules, `unmeasured` is a different class of red. With no retry of its
// own: everything is committed, so retrying measures the same tree and repeats
// the cost without changing anything — the same argument that already closes
// `indeterminate` on the first go in `trasLosControles`.
function trasLaGlobal(run, outcome) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return abierto(run, { step: STEPS.SLICE_JUDGE })
    case OUTCOMES.FAILED:
      return cerrado(run, RUN_STATES.BLOCKED_GLOBAL)
    case OUTCOMES.INDETERMINATE:
      return cerrado(run, RUN_STATES.BLOCKED_GLOBAL)
    default:
      return imposible(run, outcome)
  }
}

// THE JUDGEMENT OF THE WHOLE SLICE (§3.7-B). `agents/ct-slice-judge.md`
// judges the two items no task judge looks at: whether the three tasks
// together deliver the plan's `### Desired end state`, and whether they are
// coherent with each other. With no veto budget of its own and no
// `corrections-ordered`: there is no implementer left here with staged work to
// hand it back to — everything is a commit, so a FAIL closes the run
// (`blocked-slice-judge`) and a PASS with medium/low findings delivers all the
// same, travelling in the verdict for whoever reviews the PR. `discarded` does
// ask again without spending a retry, just like the task judge: an illegible
// verdict is not a veto.
function trasElJuezDeSlice(run, outcome) {
  switch (outcome) {
    // With the slice judged, all that is left is walking through it — and only
    // if the spec declared runs. The e2e goes AFTER the judge, and not before,
    // for two reasons: its design fixes it as a TERMINAL step (its DONE and its
    // INDETERMINATE both close in DELIVERED, they chain into nothing), and the
    // slice judge has no shell on purpose — it judges the accumulated diff, not
    // the system brought up, so it gains nothing by waiting for the e2e's
    // report. With no runs, the judge closes the run as it did until now.
    case OUTCOMES.DONE:
      return (run.e2eRuns || []).length
        ? abierto(run, { step: STEPS.E2E })
        : cerrado(run, RUN_STATES.DELIVERED)
    case OUTCOMES.FAILED:
      return cerrado(run, RUN_STATES.BLOCKED_SLICE_JUDGE)
    case OUTCOMES.DISCARDED:
      return abierto(run, { step: STEPS.SLICE_JUDGE, discards: run.discards + 1 })
    default:
      return imposible(run, outcome)
  }
}

function trasElE2e(run, outcome) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return cerrado(run, RUN_STATES.DELIVERED)
    // The unverified DELIVERS. It is not indulgence: if it held the run back, a
    // docker that does not start or an expired credential would leave the slice
    // in status:in-progress occupying `area:`/`touches:` and a `--cap` slot
    // with nobody working — the failure mode F13 and F18 were dedicated to
    // removing. What never happens is that green gets asserted: the reason
    // travels in the report and `--release` prints it.
    case OUTCOMES.INDETERMINATE:
      return cerrado(run, RUN_STATES.DELIVERED)
    case OUTCOMES.FAILED:
      return cerrado(run, RUN_STATES.BLOCKED_E2E)
    // A report that cannot be read does not spend a retry: neither the code nor
    // the environment was touched. Same treatment as in `implement`, and with
    // the same backing — the slice's discard cap.
    case OUTCOMES.DISCARDED:
      return abierto(run, { step: STEPS.E2E, discards: run.discards + 1 })
    default:
      return imposible(run, outcome)
  }
}

// ============================================================================
// THE RELEASE GATE (the half that reads; the one that writes is in
// ct-step.mjs, which persists `closed: 'delivered'` when it closes well).
//
// `dispatch-check --release` cannot trust that the session obeyed the kickoff
// — a prompt is not a gate (the doctrine of the convergence document when it
// discarded option (a) of F36). This turns it into mechanism: without a
// DELIVERED ct-step run, nothing is released. Pure on purpose: it receives the
// raw content of the file (or null if it does not exist) and answers, with no
// git and no disk, so that it can be tested on its own.
// ============================================================================
export function deliveredRun(raw, issue) {
  if (raw === null) {
    return { ok: false, why: `no existe .agent/run-${issue}.json: la implementación no la condujo ct-step (o el run se borró). El kickoff manda conducir con ct-step, y este gate es lo que convierte esa orden en mecanismo.` }
  }
  let run
  try { run = JSON.parse(raw) } catch (e) {
    return { ok: false, why: `.agent/run-${issue}.json no es JSON válido (${e.message}): no se puede afirmar que el run esté entregado.` }
  }
  if (Number(run.issue) !== Number(issue)) {
    return { ok: false, why: `.agent/run-${issue}.json dice issue ${run.issue}, no ${issue}: ese run es de otro slice.` }
  }
  if (run.closed !== RUN_STATES.DELIVERED) {
    return { ok: false, why: `el run del issue ${issue} no está entregado (closed: ${run.closed ?? '(ausente)'}, tarea ${run.task}/${run.tasksTotal}, paso ${run.step}): termina el run con ct-step hasta "run delivered" y reintenta.` }
  }
  return { ok: true }
}
