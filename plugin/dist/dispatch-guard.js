#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// hooks/dispatch-guard.js
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// scripts/reconcile-outcome.js
var ReconcileOutcome = Object.freeze({
  UP_TO_DATE: "up-to-date",
  MERGED: "merged",
  CONFLICTING: "conflicting",
  UNMERGEABLE_TREE: "unmergeable-tree",
  RESOLVED: "resolved",
  ROUND_DISCARDED: "round-discarded",
  MARKERS_COMMITTED: "markers-committed"
});
var DiscardReason = Object.freeze({
  MARKERS_LEFT: "markers-left",
  TOUCHED_OUTSIDE_THE_CONFLICT: "touched-outside-the-conflict",
  UNRESOLVED_FILES_REMAIN: "unresolved-files-remain"
});

// scripts/run-machine.js
var STEPS = Object.freeze({
  IMPLEMENT: "implement",
  CONTROLS: "controls",
  JUDGE: "judge",
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
  ADVISE: "advise",
  COMMIT: "commit",
  // RECONCILE goes BEFORE GLOBAL and not after: the plan's end-to-end
  // (`global`) has to run over the tree already brought up to date with its
  // base, not over one that lags behind and that the pull request's merge then
  // moves again. Verifying before reconciling would measure a tree that is no
  // longer the one being delivered.
  RECONCILE: "reconcile",
  // GLOBAL / SLICE_JUDGE (§3.7) and E2E are the three steps that are NOT
  // per-task: they are entered on committing the last one, and they close the
  // SLICE, not a task.
  GLOBAL: "global",
  SLICE_JUDGE: "slice-judge",
  // E2E — the last of that queue, and the only conditional one: it is only
  // entered if the slice declares runs. It goes here and not hung off
  // `controls` because `controls` measures what the PLAN promised against the
  // tree, per task, and this walks through what the SPEC declared against the
  // system brought up, per slice. Hanging it off controls would force every
  // task to drag along an e2e that is none of its business, or a special
  // controls on the last one — a branch of the table that describes no real
  // state.
  E2E: "e2e"
});
var OUTCOMES = Object.freeze({
  DONE: "done",
  FAILED: "failed",
  INDETERMINATE: "indeterminate",
  CORRECTIONS_ORDERED: "corrections-ordered",
  DISCARDED: "discarded",
  OVER_BUDGET: "over-budget"
});
var RUN_STATES = Object.freeze({
  OPEN: "open",
  DELIVERED: "delivered",
  BLOCKED_CONTROLS: "blocked-controls",
  BLOCKED_JUDGE: "blocked-judge",
  BLOCKED_COMMIT: "blocked-commit",
  BLOCKED_GLOBAL: "blocked-global",
  BLOCKED_SLICE_JUDGE: "blocked-slice-judge",
  BLOCKED_RECONCILE: "blocked-reconcile",
  // Same place and same shape as its siblings: a closure in failure that a
  // person gets out of, not a retry.
  BLOCKED_E2E: "blocked-e2e",
  ABORTED_BUDGET: "aborted-budget"
});
var DEFAULT_BUDGETS = Object.freeze({
  controlRetries: 2,
  judgeRetries: 2,
  correctionRetries: 2,
  reconcileRetries: 2
});

// scripts/dispatch-gate.js
var Dispatch = Object.freeze({
  LET_THROUGH: "let-through",
  DENIED: "denied"
});
var DispatchVerdict = class _DispatchVerdict {
  static letThrough() {
    return new _DispatchVerdict(Dispatch.LET_THROUGH, null);
  }
  static denied(reason) {
    return new _DispatchVerdict(Dispatch.DENIED, reason);
  }
  constructor(dispatch, reason) {
    this.dispatch = dispatch;
    this.reason = reason;
    Object.freeze(this);
  }
};
var StepSeal = class _StepSeal {
  static #INPUT_OF = Object.freeze({
    [STEPS.IMPLEMENT]: "el brief de la tarea",
    [STEPS.JUDGE]: "el paquete de revisi\xF3n de la tarea",
    [STEPS.ADVISE]: "el paquete del consejero",
    [STEPS.SLICE_JUDGE]: "el paquete de revisi\xF3n del slice"
  });
  static SEALED_STEPS = Object.freeze(Object.keys(_StepSeal.#INPUT_OF));
  static of(run) {
    return `${run.task}:${run.step}:${_StepSeal.attemptOf(run)}`;
  }
  static inputWrittenFor(step) {
    return _StepSeal.#INPUT_OF[step] ?? null;
  }
  static attemptOf(run) {
    return run.controlRetries + run.judgeRetries + run.correctionRetries + 1;
  }
};
var DispatchGate = class _DispatchGate {
  static verdictFor(run, ctStepPath) {
    if (run.closed) return DispatchVerdict.letThrough();
    const input = StepSeal.inputWrittenFor(run.step);
    if (input === null) return DispatchVerdict.letThrough();
    if (run.nextSeal === StepSeal.of(run)) return DispatchVerdict.letThrough();
    return DispatchVerdict.denied(_DispatchGate.#reason(run, ctStepPath, input));
  }
  static #reason(run, ctStepPath, input) {
    return [
      `El run del issue ${run.issue} est\xE1 en el paso "${run.step}" y todav\xEDa no has pedido el paso.`,
      "",
      `"ct-step next" no s\xF3lo dice cu\xE1l es el paso: ESCRIBE ${input}, que es el fichero que este subagente tiene que leer. Despachado ahora se queda sin \xE9l, y eso no se ve hasta que vuelve con el trabajo hecho encima de otra cosa.`,
      "",
      "Pide el paso y despacha con lo que imprima:",
      `  node ${ctStepPath} next --plan ${run.plan} --issue ${run.issue}`,
      "",
      '"next" no transiciona el run: informa y prepara, as\xED que pedirlo no cuesta ning\xFAn intento ni ning\xFAn descarte.'
    ].join("\n");
  }
};

// hooks/dispatch-guard.js
var RunFile = class _RunFile {
  static #DIR = ".agent";
  static #SHAPE = /^run-\d+\.json$/;
  static onlyOneIn(cwd) {
    const found = _RunFile.#listedIn(cwd);
    if (found.length !== 1) return null;
    return _RunFile.#parsed(found[0]);
  }
  static #listedIn(cwd) {
    if (cwd === "") return [];
    try {
      return readdirSync(join(cwd, _RunFile.#DIR)).filter((entry) => _RunFile.#SHAPE.test(entry)).map((entry) => join(cwd, _RunFile.#DIR, entry));
    } catch {
      return [];
    }
  }
  static #parsed(path) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  }
};
var DispatchGuard = class _DispatchGuard {
  static #EVENT = "PreToolUse";
  static #TOOL = "Task";
  static decide(input, readRun, ctStepPath) {
    if (input?.hook_event_name !== _DispatchGuard.#EVENT) return null;
    if (input.tool_name !== _DispatchGuard.#TOOL) return null;
    const run = readRun(input.cwd);
    if (run === null) return null;
    const verdict = DispatchGate.verdictFor(run, ctStepPath);
    if (verdict.dispatch === Dispatch.LET_THROUGH) return null;
    if (verdict.dispatch === Dispatch.DENIED) return _DispatchGuard.#payloadDenying(verdict.reason);
    throw new Error(`DispatchGuard cannot answer a verdict it does not know: ${JSON.stringify(verdict.dispatch)}`);
  }
  static #payloadDenying(reason) {
    return {
      hookSpecificOutput: {
        hookEventName: _DispatchGuard.#EVENT,
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    };
  }
  static ctStepBesideThisHook(hookUrl) {
    return join(dirname(dirname(fileURLToPath(hookUrl))), "scripts", "ct-step.mjs");
  }
};
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const decision = DispatchGuard.decide(input, RunFile.onlyOneIn, DispatchGuard.ctStepBesideThisHook(import.meta.url));
  if (decision) process.stdout.write(JSON.stringify(decision), () => process.exit(0));
  else process.exit(0);
}
export {
  DispatchGuard
};
