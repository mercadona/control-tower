// ============================================================================
// STEP-CONTRACTS — what crosses the boundary between the session and its
// subagents.
//
// The session dispatches an implementer and a judge; what comes back from them
// are files. This module says what is accepted as an answer and what the plugin
// writes, and it is PURE: it launches no processes, it reads no disk.
//
// This used to build the argv of `claude -p` as well —the conductor-program
// that made the two calls itself—, and that went with D-4: the decision to stop
// the orchestrator being a chat session is deferred and its owner is José. What
// survives is the part that holds just the same with a subagent on the other
// side: the SCHEMA of what is accepted.
//
// And the schema matters more now, not less. With `claude -p` the binary
// imposed it (`--json-schema`, which only exists in `--print` mode); with a
// subagent this validation imposes it, and a verdict that does not comply is a
// discard — the question is asked again instead of interpreting it towards
// whichever side suits.
// ============================================================================

import { findClosingKeywords } from './closing-keywords.js'
import { CtStepCommit } from './ct-step-commit.js'
import { OUTCOMES } from './run-machine.js'
// `node:crypto` does not break the «PURE module» of the header, and the
// precedent is written in go-response.js: `createHash` is a deterministic
// function of its argument —no disk, no network and no clock—, «the same as a
// more expensive String.trim».
import { createHash } from 'node:crypto'

export const SEVERITIES = ['high', 'medium', 'low']

// The nine rules of the judge's rubric, in the order it walks them (the rubric
// itself is written in a later task of this same plan; here only the vocabulary
// is fixed). A CLOSED enum, and not for validation's own sake: the telemetry
// counts findings per rule (`findings_by_rule` in run-metrics.js), and a rule
// invented by the judge would turn that count into noise. A `rule` that is not
// here discards the verdict just as an invented `ruling` already does — the
// discard is not an error, it is "ask again": a finding that fits no rule is a
// finding the judge has not managed to justify.
//
// The ninth goes in BEHIND `alcance` and not interleaved among the test items:
// the order of this array IS the order in which the judge walks the rubric
// —`reglasDelAgente()` ties it heading by heading in step-contracts.test.js—,
// so putting it in the middle renumbers six headings of `ct-judge.md` without
// changing anything measurable.
//
// `test-desiderata` judges the task's NEW tests as an instrument (deterministic,
// isolated, and verifying real behaviour) and blocks only on those three;
// everything else warns at `low` and never at `medium`, because a `medium` buys
// the implementer a paid round on a task whose suite is already green. It is the
// only item whose yardstick is NOT set by the plan: the three are properties of
// a test, not the repo's taste, so it cannot come back `sin-vara` — a ninth item
// that in a repo without conventions always came out without a yardstick would
// inflate precisely the column (`rubric_sin_vara`) that was added to measure
// whether the yardstick arrives. WEAKENED PRE-EXISTING tests still belong to
// `manipulacion-tests`: a relaxed assert in a test that already existed is ONE
// defect and not two, and duplicating it would falsify `findings_by_rule`.
export const VERDICT_RULES = [
  'objetivo', 'asercion-tdd', 'contrato', 'decisiones-cerradas',
  'patrones', 'manipulacion-tests', 'fixture-theater', 'alcance',
  'test-desiderata',
]

// The SLICE judge's rubric (§3.7-B of the handoff
// docs/prompt-juez-lo-que-queda.md), THREE items and not nine — the argument is
// the same one that already settled `boundaries` and `rollout` as absorbed:
// everything added competes for the judge's attention, and
// `agents/ct-slice-judge.md` inherits none of `ct-judge.md`'s nine (those are
// per-task: markers, brief, the staged package of ONE task; here the subject is
// the whole slice, already committed). The first two are exactly the two gaps
// §3.7 names:
//
//   `estado-final`  — whether the tasks together deliver the plan's
//     `### Desired end state`. Nobody was looking at it: the task judge has
//     that same text in the brief and a line saying explicitly that it is NOT
//     its yardstick (a closed decision from §4 of the handoff, which this item
//     does not reopen).
//   `coherencia`    — whether a later task undoes what an earlier one
//     established, or whether the three leave behind scaffolding of an
//     intermediate state that one of them should have withdrawn. `ct-judge`
//     judges ONE task; nobody was looking at this.
//
// `observabilidad` (Slice 10, §3.9) is the third, and it goes in BEHIND — the
// same argument with which `test-desiderata` went in ninth in VERDICT_RULES: the
// order of the array IS the order of the walk, the rubric's headings are tied by
// a test, and interleaving it would renumber without measuring anything. It
// measures §3.9's three checks over the SIGNAL the slice declared (the package's
// `## Señal` section, pasted by the program from the dispatch's SLICE.md)
// against the ACCUMULATED diff: that what was promised is emitted by production
// code, with the instrumentation THE REPO already uses, without labels of
// unbounded cardinality. It lives HERE and not in `ct-judge` for three closed
// reasons: (a) the subject is THE SLICE's signal — a task can legitimately not
// emit it because the next one does, and the only diff with the complete subject
// is the accumulated one, which only this judge sees; (b) §3.6's argument: every
// item competes for attention, and `ct-judge` already walks 9 for EVERY task and
// retry while here they are 3 once per slice; (c) it is where `agentic-skills`
// has it (its item 9 judges the whole slice). It is not absorbed into
// `estado-final` because it measures ANOTHER source (the declared signal, not
// the `### Desired end state`) with its own `no-aplica`/`sin-vara`, and the
// telemetry needs to count it per rule.
//
// The same CLOSED enum as VERDICT_RULES, and for the same reason: the telemetry
// counts findings per rule, and a rule invented by this judge would dirty that
// count just as it would dirty the task judge's.
export const SLICE_VERDICT_RULES = ['estado-final', 'coherencia', 'observabilidad']

// What an item of the walk was able to do. The walk already told "it was not
// looked at" from "it was looked at", but inside "it was looked at" there were
// still two things that read the same, and one of them is a gap:
//
//   `no-aplica` — the item has no SUBJECT. There are no previous tests to
//     weaken, there are no symbols to compare, the task is prose. It is the
//     rubric working: there is nothing to look at and it gets said.
//   `sin-vara`  — the item has a subject but is missing the INPUT to measure it
//     with. The plan named no pattern, or the section that had to arrive in the
//     brief did not arrive. The judge did not judge: it judged blind.
//
// Without this field the two come out as a `result` in prose that nobody
// aggregates, and `patrones: N/A` is indistinguishable from
// `patrones: conforme`. It is half of H5 of the report of the run in somebody
// else's repo, and the reason two people looking at verdicts by hand suspected
// the judge was not looking: there was no way to know. `run-metrics.js` counts
// the `sin-vara` per attempt, so the gap goes from suspicion to a column.
//
// A CLOSED enum for the same reason as VERDICT_RULES: what cannot be counted
// cannot be read, and a fourth value invented by the judge turns the count into
// noise.
export const RUBRIC_OUTCOMES = ['conforme', 'no-aplica', 'sin-vara']

// The verdict: the ruling, the WALK of the rubric and the findings. The
// severity is what separates a veto from a grumble, and the rest of the judge's
// prose is read by no program.
//
// Each finding also carries its RULE: which of the nine of the rubric it
// breaks. Before this a finding said severity, what and where, but not WHY it
// is a finding — and without that, the telemetry cannot count how many vetoes
// come from each rule, which is exactly the datum that says whether the rubric
// is well calibrated.
//
// And `rubric` is the walk through the nine items, each exactly once with what
// it gave. The rubric already asked for it, but it asked for it in PROSE and
// for the subagent's conversational answer, which nobody captures: what was
// validated and persisted was only `{ruling, findings}`. Measured in
// jjponz/rust-monitoring#10, where the three verdicts that travelled committed
// in the pull request were `{"ruling": "PASS", "findings": []}` — exactly the
// artefact the rubric itself declares indistinguishable from eight items nobody
// opened. The worst of that case is that the empty PASS was CORRECT: four of
// the eight items had no subject (a skeleton over an empty repo, with no
// patterns to cite, no previous tests, no contracts), and there was no way of
// knowing that by reading the file. The walk is what tells "it did not apply,
// and here is why" from "it was not looked at"; that is why it goes into the
// schema and not into a line nobody validates.
//
// And each finding carries `evidence`: the literal QUOTE that sustains it — the
// sentence of the plan that is broken, or the line of the diff that proves it.
// It is not `what` (which narrates the defect) nor `path`/`line` (which
// locate): it is the text somebody can check against without opening anything.
// The rubric already demanded citing before blocking ("evidence before
// blocking"), but it demanded it in PROSE, in a two-hundred-and-forty-line file
// where it competes with eight items that really have to be walked. A mandatory
// field of the schema is not forgotten; a sentence is. And it is demanded at all
// three severities and not only at `high`: a conditional field is forgotten just
// like prose, and a `medium` without a quote sends the implementer on a paid
// round without telling them what to look at.
//
// The item's enum is the SAME VERDICT_RULES array, not a copy: two lists of nine
// identifiers diverge at the first rename, which is the decoupling this module
// already paid for with JUDGE_TOOLS.
//
// And the location is TWO fields, `path` and `line`, and not the `"path:line"`
// string it carried up to here. What the string prevented is aggregating: the
// telemetry counts findings per rule (`findings_by_rule`) and cannot count them
// per file, because splitting on the last `:` a string a model wrote is guessing
// — a Windows `C:\`, an `a.js:10-14`, a `src/a.js` with no line and a
// `toda la clase Foo` are the same string to the program. It is §3.13 of the
// handoff, and it is the shape `agentic-skills`' `Finding` already has.
//
// `path` is mandatory and `line` is NOT, and the asymmetry is deliberate: a
// finding about the whole file (an import that is redundant across the whole
// module, a file that should not exist) has no line to cite, and demanding one
// from the judge only buys two bad things — an invented number, or one more of
// the six discards that kill the run (§3.2). Absent and `null` are the same.
// What is rejected is a line that cannot be read as a number: `"12"` and `12` do
// not aggregate the same, and tolerating the string today is dirty telemetry
// tomorrow.
// THE TOKEN'S SHAPE, in a constant and not typed twice. The schema's `pattern`
// is what the object SAYS about itself —and it is the block the rubric teaches
// the judge— and `readVerdict`'s regex is what is really applied: two hand-made
// copies of the same shape are documentation that can lie without anything
// going red. The rest of `schemaFor`'s fields already derive from a shared
// constant (`enum: rules`, `enum: SEVERITIES`, `enum: RUBRIC_OUTCOMES`) for
// exactly this reason, and slice 11 exported REVIEW_TOKEN_LABEL so that the
// LABEL would not diverge; the SHAPE was left out of that criterion.
//
// It lives up here, far from the token's block, for a mechanical reason:
// VERDICT_SCHEMA is built when the module LOADS, so a `const` declared further
// down would give a ReferenceError through the dead zone.
//
// The third copy of the shape —RE_REVIEW_TOKEN's, in the token's block— is NOT
// a divergence and is not touched: there it is lowercase only, on purpose (it is
// what `reviewToken` produces) and it goes inside a line with a label and a
// capture.
const REVIEW_TOKEN_PATTERN = '^[0-9a-fA-F]{64}$'
const RE_REVIEW_TOKEN_FORM = new RegExp(REVIEW_TOKEN_PATTERN)

// A FACTORY, not a loose object: the slice judge validates against the SAME
// schema with another rubric inside it (§3.7-B), and two hand-made copies of
// this shape would diverge at the first field added — the same decoupling
// JUDGE_TOOLS and VERDICT_RULES already suffered. `rules` decides only the enum
// of `rule` and the cardinality of the walk; the rest of the shape —`ruling`,
// `outcome`, `evidence`, the location in two fields— is the same for a task
// verdict and a slice one: it is the same ANSWER schema, not a different rubric
// on the inside.
const schemaFor = (rules) => ({
  type: 'object',
  additionalProperties: false,
  required: ['ruling', 'rubric', 'findings'],
  properties: {
    ruling: { type: 'string', enum: ['PASS', 'FAIL'] },
    // THE PROGRAM WRITES THE TOKEN, not the judge. `ct-step verdict` injects
    // it before validating, with the value it has just computed itself from the
    // package and from the current cut, so here it is NOT mandatory: a verdict
    // that does not carry it is accepted. What is still rejected is one that
    // carries ANOTHER —defence in depth, in case the file is from an earlier
    // judgement— and that is why the field stays in the schema with its shape.
    //
    // It used to be mandatory and the judge copied it by hand: 64 hex
    // characters typed by a model, and a copying error discarded a whole opus
    // verdict and spent one of the six discards that kill the run. A value the
    // program knows is not asked of the model.
    review_token: { type: 'string', pattern: REVIEW_TOKEN_PATTERN },
    rubric: {
      type: 'array',
      minItems: rules.length,
      maxItems: rules.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'result', 'outcome'],
        properties: {
          rule: { type: 'string', enum: rules },
          result: { type: 'string' },
          outcome: { type: 'string', enum: RUBRIC_OUTCOMES },
        },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'severity', 'what', 'path', 'evidence'],
        properties: {
          rule: { type: 'string', enum: rules },
          severity: { type: 'string', enum: SEVERITIES },
          what: { type: 'string' },
          path: { type: 'string' },
          line: { type: ['integer', 'null'], minimum: 1 },
          evidence: { type: 'string' },
        },
      },
    },
  },
})

export const VERDICT_SCHEMA = Object.freeze(schemaFor(VERDICT_RULES))
// The SLICE verdict's schema: the same shape, the two-item rubric.
export const SLICE_VERDICT_SCHEMA = Object.freeze(schemaFor(SLICE_VERDICT_RULES))

// The implementer's report carries a schema too, and the spec did not ask for
// it. The reason is the same one that made a `plan-tasks.js` necessary: the
// program needs the PATHS that were touched in order to stage them, and pulling
// paths out of a report in prose is §2.5's trap again, at the other end of the
// loop.
//
// There used to be a KIND per path here ('production' or 'test'). The idea was
// that the judge —via `writeReviewPackage` in `scripts/ct-step.mjs`— would see at a
// glance whether a diff with a green suite touched no production file. It was
// removed: the judge has the diff in front of it and tells a test file from a
// production one without anyone saying so, so the label added nothing it could
// not see for itself. On top of that it was produced by the very agent being
// judged, nobody verified it, and when it came in wrong it did not degrade the
// judgement: it DISABLED it — the rubric item that looks at test files stopped
// looking at a mislabelled test. A layer of indirection between the judge and
// the evidence that could only introduce error. Do not add it again without
// first solving that problem at the root.
export const REPORT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['paths', 'summary'],
  properties: {
    paths: {
      type: 'array',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
})

export const E2E_VERDICTS = ['verde', 'rojo', 'no-verificado']

// E2E_REQUIRED_BY_VERDICT: what each verdict demands BESIDES `run` and
// `verdict`. It lives here, exported and in a single place, because TWO
// consume it: `readE2eReport` (below, which validates against this table) and
// `ct-step.mjs#nextVerb` (which tells the agent about it before it writes the
// report). Until the final branch review it only existed inside
// `readE2eReport`'s branches, and `next` announced only `run` and `verdict`:
// the program instructed the agent with a contract it rejected itself, and
// every slice paid at least one DISCARDED round — which comes out of the whole
// slice's discard budget (MAX_DISCARDS) on top of that.
//
// `brought_up` is mandatory in `verde` and in `rojo` (§8.1 of the design). The
// evidence of an e2e report is falsifiable and the design says so; its ONLY
// mitigation is that the command be REPRODUCIBLE by a human ("an invented
// output falls apart the moment somebody pastes it"). A green that documents
// the `curl` but not how the system was brought up is NOT reproducible, so the
// mitigation evaporated on exactly the path that matters. In `no-verificado` it
// is not demanded, and that is not a capricious exception: the typical reason
// for that verdict is precisely that it could not be brought up.
export const E2E_REQUIRED_BY_VERDICT = Object.freeze({
  verde: Object.freeze(['brought_up', 'evidence']),
  rojo: Object.freeze(['brought_up', 'expected', 'actual', 'repro', 'refuted_by']),
  // The format of `blocked` (state.js), not the field: "why" and "what it
  // would take". Without both, a no-verificado is a shrug that releases the
  // slice leaving nobody knowing what to fix.
  'no-verificado': Object.freeze(['reason', 'unblock']),
})

// E2E_SCHEMA: what is asked of the agent that walks the journeys through.
// Declarative and exported for the same reason as VERDICT_SCHEMA: the prompt
// cites it, and two hand-made copies of the same shape diverge (it happened
// with JUDGE_TOOLS).
//
// `required` is what EVERY entry carries; the conditional part travels in
// `requiredByVerdict` (the same constant from above, not a copy) because the
// validator is hand-written and a table reads better than an `if/then/else` of
// JSON Schema. That it is INSIDE the schema matters: whoever cites it —the
// prompt, the `next`— takes the whole contract with them, not the
// unconditional half.
export const E2E_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['runs'],
  properties: {
    runs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['run', 'verdict'],
        requiredByVerdict: E2E_REQUIRED_BY_VERDICT,
        properties: {
          run: { type: 'string' },
          verdict: { enum: E2E_VERDICTS },
          brought_up: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['command', 'output'],
              properties: { command: { type: 'string' }, output: { type: 'string' } },
            },
          },
          expected: { type: 'string' },
          actual: { type: 'string' },
          repro: { type: 'string' },
          refuted_by: { type: 'string' },
          reason: { type: 'string' },
          unblock: { type: 'string' },
        },
      },
    },
  },
})

// `Skill` is here because the implementer's rubric
// (`prompts/task-implementer.md`) no longer carries the TDD cycle inside it: it
// orders it to load `control-tower-loop:test-driven-development`, the copy the
// plugin ships. Without this tool that first line is impossible to obey and the
// implementer is left without the craft the rubric delegates.
export const IMPLEMENTER_TOOLS = 'Read, Write, Edit, Grep, Glob, Bash, Skill'
// Which model it is dispatched with. Omitting it is NOT neutral: the subagent
// inherits the session's model, which is the most expensive one, and the
// implementer is the step dispatched most often in a run —once per task, and
// once more for each round the judge sends back—. The three declared agents
// (`agents/*.md`) fix theirs in their frontmatter and there the harness imposes
// it; the implementer was not given a file of its own, so its model travels on
// the line `ct-step next` prints, and holding it up depends on the session
// obeying that line.
//
// Fixed, and not scaled by complexity as seam 5 of the fork asks
// (`skills/subagent-driven-development/SKILL.md`, "Model Selection"): that skill
// no longer drives here —`scripts/kickoff.js` says so—, and whoever would pick
// the tier per task would be the same session that saves the money. The floor is
// fixed on purpose.
export const IMPLEMENTER_MODEL = 'sonnet'
// The judge cannot EXECUTE, and that is not a promise in prose: the agent's
// declaration takes it away (`agents/ct-judge.md`), just as the binary used to
// take it away before. Nor does it see the OUTPUT of the checks —it is handed
// paths— because a dirty lint must not dirty the criterion of the one agent
// whose value is judgement.
//
// `Write` YES, and it does not weaken the above: the channel through which it
// delivers its verdict is a file, so without `Write` the `judge` step cannot be
// closed —measured on task 1 of repo-pulse's slice #5, the first time this agent
// judged anything—. What it could write in excess reaches nowhere: `ct-step
// commit` commits the paths the IMPLEMENTER declared, not whatever is in the
// tree.
//
// `Skill` YES, and for the same reason the implementer has it: the rubric orders
// it to exercise it. Since `e473c97`, the `Rules to obey:` of `## 3. Reference
// patterns` allows declaring a skill as a secondary yardstick, and the
// `patrones` item orders it to open it («any skill named there — open them and
// read the rules»). But a skill name
// (`backend-engineering:backend-best-practices`) is not a path: `Read` does not
// open it, and `plan-contract.js` does not check it on disk either, ON PURPOSE.
// Without this tool the secondary yardstick was unreachable, and silently: the
// judge would answer `conforme` about a document it could never open, which is
// exactly the gap `sin-vara` exists to close. It is defect §3.1 of
// `docs/prompt-juez-lo-que-queda.md`, and it is what `agentic-skills` does in
// its `slice_verifier_judge.py`: TOOLS = ("Read", "Grep", "Glob", "Skill").
//
// It does not weaken the «no shell»: `Skill` loads instructions, it does not
// execute processes. What the judge cannot do is still decided by the absence of
// `Bash` in the agent's declaration.
//
// This constant is a COPY of `agents/ct-judge.md`'s frontmatter, and what ties
// them together is `step-contracts.test.js`: it is duplicated because this
// module is pure and does not read disk, not because it does not matter if they
// diverge. They diverged once, and the result was that `ct-step next` announced
// tools that were not those of the judge about to be dispatched.
export const JUDGE_TOOLS = 'Read, Grep, Glob, Write, Skill'

// The three headings of the review package `writeReviewPackage` writes in
// `scripts/ct-step.mjs`, in the order in which they appear in the file. The
// judge's rubric (`agents/ct-judge.md`) cites them by name in backticks under
// "What you are given" to tell the judge what each section carries — and that
// crossing is the same decoupling JUDGE_TOOLS and VERDICT_RULES already
// suffered: two hand-made copies of the same string, with nothing tying them
// together. Here it is worse than with JUDGE_TOOLS because there is not even a
// runtime error to betray it — a heading renamed in the script leaves the rubric
// pointing at a section that does not exist, and the judge goes on answering as
// if it had read it.
//
// `Vara de ct` opens the package and is written by
// `PluginYardstick.composePathSection` (scripts/plugin-yardstick.js), not by
// `writeReviewPackage`: they are the PATHS of the documents that reach this task,
// for a judge that has `Read`. It goes first for the same reason as `Señal` in
// the slice package — behind a `-U10` diff it would be buried.
export const PACKAGE_SECTIONS = ['Vara de ct', 'Files changed', 'Rutas tocadas', 'Diff']

// The SLICE judge (§3.7-B, `agents/ct-slice-judge.md`), WITHOUT `Skill`: its
// two items measure against the plan (committed) and the accumulated diff of
// the whole slice, and neither of the two loads a skill rubric — unlike
// `patrones`/`test-desiderata` in the task judge, here there is no repo
// yardstick to open. Fewer tools, less drift: giving them to it «just in case»
// would be the same indirection already removed from `REPORT_SCHEMA`'s `kind`.
//
// A copy of `agents/ct-slice-judge.md`'s frontmatter, tied by
// `step-contracts.test.js` with the same criterion as `JUDGE_TOOLS`: this module
// is pure and does not read disk, so what stops the two from diverging is the
// test, not the code.
export const SLICE_JUDGE_TOOLS = 'Read, Grep, Glob, Write'

// The reconciler (Branch reconciliation, Task 9, `agents/ct-reconciler.md`)
// inverts the asymmetry of the two judges above instead of repeating it: `Edit`
// instead of `Write`, and neither `Bash` nor `Write`. Git does not consider a
// conflicted file resolved until somebody runs `git add`, and the only one who
// runs that command is the program (`BranchReconciliation.conclude()`,
// `scripts/branch-reconciliation.js`) — never the agent. Without `Write` it
// cannot create a new file to work around a conflict it did not want to touch
// directly, and without `Bash` it cannot stage, commit or abort the merge on its
// own. All it can do is open the files git already marked as conflicted and edit
// their content: hygiene stops being a check and becomes a property of what the
// agent can reach.
//
// A copy of `agents/ct-reconciler.md`'s frontmatter, tied by
// `step-contracts.test.js` with the same criterion as `JUDGE_TOOLS` and
// `SLICE_JUDGE_TOOLS`: this module is pure and does not read disk, so what stops
// the two from diverging is the test, not the code.
export const RECONCILER_TOOLS = 'Read, Grep, Glob, Edit'

// The five headings of the SLICE package `writeSliceReviewPackage` writes in
// `scripts/ct-step.mjs`. The slice judge measures final state, coherence and
// signal — not code rule by rule, and it deliberately has fewer tools — so it
// does not receive the whole yardstick: it receives ONE single path, that of
// `simplicity.md`, because it is exactly the rule its `observabilidad` item
// measures (a trace names its reader). `Vara` FIRST, for the same reason `Señal`
// goes ahead of the `-U10` diff: buried behind a diff like that nobody reads it.
// It is followed by the observability signal the slice's issue declared, the
// slice's commit log (which does not exist in the per-task package, because a
// task is ONE commit with no history of its own to show), the summary of touched
// files and the accumulated diff since the base. The same crossing as
// `PACKAGE_SECTIONS`: `agents/ct-slice-judge.md`'s rubric cites them by name,
// and without this test a renamed heading leaves the judge pointing at a section
// that does not exist — the test that ties them together forces package and
// agent to change in the SAME task.
export const SLICE_PACKAGE_SECTIONS = ['Vara', 'Señal', 'Commits', 'Files changed', 'Diff']

// THE ADVISOR (H9, `agents/ct-advisor.md`), with ONE single tool: `Read`. It
// does not write its answer to a file like the two judges —it returns it through
// `structured_output`, which is all `ct-step advice` needs to read— so giving it
// `Write` would be granting it reach over the tree in precisely the step whose
// whole point is that the tree becomes clean again. No `Grep` or `Glob` for the
// same reason the slice judge does not carry `Skill`: what it has to look at is
// put in front of it by the package, and giving it more «just in case» is the
// indirection this module already removed from the report's `kind`.
//
// A copy of `agents/ct-advisor.md`'s frontmatter, tied by
// `step-contracts.test.js` with the same criterion as JUDGE_TOOLS: this module
// is pure and does not read disk, so what stops the two from diverging is the
// test.
export const ADVISOR_TOOLS = 'Read'

// The three headings of the advisor's package `writeAdviceReviewPackage` writes
// in `scripts/ct-step.mjs`, in the order in which they appear: the task's brief
// (what was asked for), the reports of the two vetoed attempts (what was done)
// and the two verdicts (why it did not do). The same crossing and the same test
// as `PACKAGE_SECTIONS`: the agent's rubric cites them by name, and without the
// tie a renamed heading leaves the advisor pointing at a section that does not
// exist.
export const ADVICE_PACKAGE_SECTIONS = ['Brief', 'Intentos', 'Veredictos']

// THE ADVICE. Two fields and no more: the APPROACH, which is what the third
// attempt's brief is going to carry inside it, and the PATHS to reconsider,
// which is what makes the approach actionable. No severities and no rubric: the
// advisor does not judge —there are already two verdicts in its package for that
// — and it is not asked for a diagnosis nobody would consume.
export const ADVICE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['approach', 'files_to_reconsider'],
  properties: {
    approach: { type: 'string' },
    files_to_reconsider: {
      type: 'array',
      items: { type: 'string' },
    },
  },
})

// Hand-written validation, like the other three in this module and for the same
// reason: zero new dependencies and it fits here.
//
// The EMPTY list is valid and does not discard: «no path to reconsider» is an
// answer —the approach may be to redo the same thing by another route over the
// same files— and spending one of the six discards that kill the run on it would
// be the highest price for the cheapest defect, which is the reasoning
// `readReport` already wrote for the repeated path.
//
// The paths are deduplicated and checked just as in `readReport`: nothing is
// staged with them here, but they travel to the third attempt's brief, and an
// absolute path or one that climbs out of the directory there can only send the
// implementer outside its scope.
export function readAdvice(structured) {
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
    return { why: 'el consejero no devolvió structured_output' }
  }
  const { approach, files_to_reconsider: files } = structured
  if (!isText(approach)) return { why: 'el consejo no dice qué enfoque tomar: falta `approach`' }
  if (!Array.isArray(files) || !files.every(isText)) {
    return { why: 'el consejo no trae la lista de rutas a reconsiderar: `files_to_reconsider` es una lista de rutas, vacía si no hay ninguna' }
  }
  const outside = files.filter((p) => p.startsWith('/') || p.split('/').includes('..'))
  if (outside.length) return { why: `el consejo nombra rutas fuera del worktree: ${outside.join(', ')}` }
  return { advice: { approach: approach.trim(), files_to_reconsider: [...new Set(files)] } }
}

// ---------------------------------------------------------------------------
// THE PACKAGE'S TOKEN — the package ties its PRODUCT, not only its input.
//
// THE DEFECT IT CLOSES. Slice 6 made the package single-use, so a verdict
// cannot spend an already spent input again. What still tied nothing is the
// other direction: NOTHING bound the `verdict.json` to the package. Reproduced
// along two routes, both MUTE in the telemetry:
//
//   (a) the RECYCLED verdict. After an accepted verdict that sends the task
//       back, the message orders a return to `next` — and it does not say «and
//       redispatch the judge». Obeying that half, `next` regenerates the
//       package and the file of the PREVIOUS judgement (same path:
//       `task-<N>-verdict.json`) is accepted. Measured: three indistinguishable
//       judge rows, `correctionRetries` exhausted, and the task COMMITTED with
//       another diff's verdict inside it.
//   (b) the DISCARD GAP. A discard for unreadable JSON does not consume the
//       package —rightly so: the retry has to be able to ask again— and that
//       was justified with «the retry judges the same diff», which is an
//       assumption about the agent's behaviour. If the index changes in that
//       gap, the next `PASS` comes in over unreviewed code.
//
// THE SHAPE. The package declares in its header the sha256 of the DIFF IT
// CAPTURED; the judge copies it into `review_token`; the verdict's verb demands
// that the verdict's, the package's and the one recomputed from the cut at that
// instant all match. (a) dies because a recycled verdict carries another
// package's token; (b) dies because changed code does not reproduce the
// captured sha.
//
// CONTENT-ADDRESSED AND NOT A DRAWN NONCE, and the difference with the `go`
// nonce (go-response.js) is the reason: that one is SECRET and unguessable, and
// its property is that the agent cannot fabricate the permission. This one is
// public and derivable —it is in the file the judge reads, and anyone with a
// shell recomputes it—, so it does NOT authenticate the judge: it ties the
// verdict to a state of the code. A random nonce would close (a) and not (b)
// (in the gap the package is not regenerated, so the nonce is still valid), and
// on top of that it would punish the obedient: a verdict reissued over a package
// regenerated with the SAME diff would be discarded for carrying the old nonce.
// With the content as the address, «the code did not change» and «the verdict is
// valid» are the same sentence.
//
// The LABEL is exported and the reader is built from it: whoever writes the line
// (`writeReviewPackage`), whoever reads it (`reviewTokenOf`), the two rubrics that
// quote it to the judge and the tests are four copies of the same string, and
// that is exactly what already diverged with JUDGE_TOOLS, VERDICT_RULES and
// PACKAGE_SECTIONS. Here the failure would be mute twice over: the judge copies
// from a line that does not exist, and every verdict is discarded.
// ---------------------------------------------------------------------------
export const REVIEW_TOKEN_LABEL = 'Review token'

// The token: the sha256 hex of the diff's text. A function of the ARGUMENT and
// of nothing else — whoever decides WHICH diff is the subject is ct-step.mjs,
// which is the one with git in front of it.
export const reviewToken = (diff) => createHash('sha256').update(String(diff ?? ''), 'utf8').digest('hex')

// The line, in a single function: the screen that dictates it to the judge (the
// rubric) and the matcher that recognises it cannot diverge by a single space.
export const reviewTokenLine = (token) => `${REVIEW_TOKEN_LABEL}: ${token}`

// The RegExp is built from the label and not typed: the label carries no
// metacharacters, so interpolating it is safe and it ties the reader to the
// writer. Lowercase and exactly 64: it is what `reviewToken` produces, and a
// package whose line does not comply declares NO token at all (null), which is
// what the verb treats as «a package from an earlier version, or hand-edited».
const RE_REVIEW_TOKEN = new RegExp(`^${REVIEW_TOKEN_LABEL}: ([0-9a-f]{64})$`, 'm')
export function reviewTokenOf(packageText) {
  const m = RE_REVIEW_TOKEN.exec(String(packageText ?? ''))
  return m ? m[1] : null
}

const isText = (v) => typeof v === 'string' && v.trim() !== ''

// Hand-written validation and not a schema library: the spec demands zero new
// dependencies, and what has to be checked fits in twenty lines.
//
// `rules` is the second parameter, not a separate module: the task verdict and
// the slice verdict share ALL of this validation —schema, cardinality, PASS/high
// coherence— and differ only in which enum of `rule` they accept and how many
// steps the walk demands. Parameterising is what avoids a second function that
// would copy these twenty lines and diverge at the first fix applied to only one
// of the two.
export function readVerdict(structured, rules = VERDICT_RULES) {
  if (!structured || typeof structured !== 'object') return { why: 'el juez no devolvió structured_output' }
  const { ruling, rubric, findings, review_token: token } = structured
  if (ruling !== 'PASS' && ruling !== 'FAIL') return { why: `ruling desconocido: ${JSON.stringify(ruling)}` }
  if (!Array.isArray(findings)) return { why: 'findings no es una lista' }
  for (const [i, f] of findings.entries()) {
    if (!f || typeof f !== 'object') return { why: `el hallazgo ${i} no es un objeto` }
    if (!SEVERITIES.includes(f.severity)) return { why: `el hallazgo ${i} tiene una severidad desconocida: ${JSON.stringify(f.severity)}` }
    if (!isText(f.what) || !isText(f.path)) return { why: `el hallazgo ${i} no dice qué o dónde: hacen falta 'what' y 'path'` }
    // `line` is optional and `null` is valid: a finding about the whole file
    // has no line, and demanding one would be asking for an invented number or
    // spending one of the six discards that kill the run. What is not valid is
    // a line that is not a number: the string `"12"` passes the `typeof` and
    // breaks any aggregation.
    if (f.line !== undefined && f.line !== null && !(Number.isInteger(f.line) && f.line > 0)) {
      return { why: `el hallazgo ${i} trae una línea que no es un número: ${JSON.stringify(f.line)} — un entero, o null (u omitida) si el hallazgo es del fichero entero` }
    }
    // The quote, given the same treatment as the what and the where: without
    // it the finding cannot be checked against anything, and a veto that cannot
    // be checked is the defensive veto the rubric's calibration exists to
    // prevent.
    if (!isText(f.evidence)) return { why: `el hallazgo ${i} no cita la evidencia que lo sostiene` }
    // The rule is the CLOSED enum: none is assumed by default, because a rule
    // invented by the judge would dirty the telemetry's per-rule count just as
    // much as a missing `rule`.
    if (!rules.includes(f.rule)) return { why: `el hallazgo ${i} incumple una regla desconocida: ${JSON.stringify(f.rule)}` }
  }
  // The walk of the rubric, with the same criterion as a finding's `rule`: a
  // CLOSED enum and a discard, not interpretation. Here the discard also covers
  // CARDINALITY, which does not apply to a finding — the rubric is walked whole
  // and answered whole, so a short walk, one with a repeated item and one with
  // an identifier nobody recognises are the same failure: a verdict of which it
  // cannot be asserted that the rubric was walked.
  if (!Array.isArray(rubric)) return { why: 'el veredicto no trae el recorrido de la rúbrica' }
  const walked = []
  for (const [i, step] of rubric.entries()) {
    if (!step || typeof step !== 'object') return { why: `el paso ${i} del recorrido no es un objeto` }
    if (!rules.includes(step.rule)) return { why: `el recorrido nombra un ítem desconocido de la rúbrica: ${JSON.stringify(step.rule)}` }
    // An item named with no result is identifiers with nothing behind them:
    // the same empty PASS of rust-monitoring#10, only longer.
    if (!isText(step.result)) return { why: `el ítem ${step.rule} del recorrido no dice lo que dio` }
    // The result in prose says what it gave; `outcome` says what CLASS it was,
    // which is the only aggregable part. Without it, "there was nothing to
    // measure with" and "I measured and it is fine" are the same datum.
    if (!RUBRIC_OUTCOMES.includes(step.outcome)) return { why: `el ítem ${step.rule} del recorrido no dice de qué clase fue su resultado: ${JSON.stringify(step.outcome)}` }
    if (walked.includes(step.rule)) return { why: `el recorrido repite el ítem ${step.rule} de la rúbrica` }
    walked.push(step.rule)
  }
  const notWalked = rules.filter((rule) => !walked.includes(rule))
  // The number comes from the array and not from the prose: the ninth item made
  // a hand-written "eight" obsolete in one go, and this `why` is the text the
  // judge reads in order to answer again after a discard.
  if (notWalked.length) return { why: `el recorrido no pasa por ${notWalked.join(', ')}: la rúbrica son ${rules.length} ítems y se contestan los ${rules.length}` }
  // The coherence the original checks on the aggregate itself: a PASS with a
  // serious finding contradicts itself. It is not "interpreted" towards the
  // prudent side — it is discarded and asked again, because a judge that does
  // not understand itself has not judged.
  if (ruling === 'PASS' && findings.some((f) => f.severity === 'high')) {
    return { why: 'un PASS con un hallazgo de severidad high contradice la rúbrica: un hallazgo grave es FAIL' }
  }
  // THE PACKAGE'S TOKEN, copied — and deliberately THE LAST of the checks. The
  // ones above decide whether this is a verdict; this one decides what it is a
  // verdict OF. An incomplete walk or an invented ruling have to go on reading
  // the `why` of their own defect: it is the text with which the judge answers
  // again, and bringing this check forward would send it off to fix the wrong
  // field.
  //
  // It is accepted in uppercase and returned in lowercase, with the literal
  // precedent of `matchesGo`: whoever copies a 64-character hex may reformat it,
  // and «the worst moment of all is typing the right permission and nothing
  // happening». What this module CANNOT decide is whether the token is THE
  // PACKAGE'S: that demands reading the package and measuring the cut again, and
  // ct-step.mjs does that (`currentToken`).
  // ABSENT IS VALID, because whoever writes it is the program: `ct-step verdict`
  // injects it with the value it has just computed before calling here, so on
  // the real path this field always arrives. A verdict that reaches here without
  // it is one nobody tied to any cut, and the one who can decide that is not
  // this module (it does not read the package): `null` is returned and ct-step
  // resolves it, which is the one that compares.
  //
  // What is still discarded is a token with the SHAPE of a token that is not
  // one: a string that is not 64 hex characters cannot be compared with
  // anything, and tolerating it would be dirty telemetry tomorrow.
  if (token === undefined || token === null) {
    return { verdict: { ruling, rubric, findings, review_token: null } }
  }
  if (typeof token !== 'string' || !RE_REVIEW_TOKEN_FORM.test(token)) {
    return { why: `el veredicto trae un "${REVIEW_TOKEN_LABEL}" que no tiene su forma (64 hex): ${JSON.stringify(token)}. El programa escribe ese campo por su cuenta, así que no hay nada que copiar — un valor que no es un token sólo puede venir de otro sitio` }
  }
  return { verdict: { ruling, rubric, findings, review_token: token.toLowerCase() } }
}

// The verdict of the WHOLE slice (§3.7-B): the same validation, the rubric of
// `agents/ct-slice-judge.md`. A function with a name of its own and not a loose
// call to `readVerdict(x, SLICE_VERDICT_RULES)` at every site that uses it: it
// is what keeps `ct-step.mjs` from having to import `SLICE_VERDICT_RULES` just
// to pass it along, and what leaves a single point where "reading a slice
// verdict" means one thing.
export const readSliceVerdict = (structured) => readVerdict(structured, SLICE_VERDICT_RULES)

// From a verdict to a result of the table. The three outputs are the three
// `run-machine.js` knows how to attend to from the `judge` step.
export function outcomeOfVerdict(verdict) {
  if (verdict.ruling === 'FAIL') return 'failed'
  // A PASS with findings that are not of low severity does not block, but it is
  // not ignored either: it goes back to the implementer with a budget of its
  // own.
  return verdict.findings.some((f) => f.severity !== 'low') ? 'corrections-ordered' : 'done'
}

// From a SLICE verdict to a result of the table — only TWO outputs, the ones
// `afterSliceJudge` knows how to attend to. `PASS` is ALWAYS `done`, with or
// without findings: unlike a task, here no implementer is left with staged work
// to send back to — the whole slice is already committed, task by task. A medium
// does not buy a paid round there is nobody to charge for: it travels INSIDE the
// verdict this very verb commits, and it is read by whoever reviews the pull
// request — a gate that ALREADY exists, not a fourth one.
export function outcomeOfSliceVerdict(verdict) {
  return verdict.ruling === 'FAIL' ? 'failed' : 'done'
}

// `path:line` out of the two fields, in ONE single place. The finding carries
// them separately so that a program can group by file, but whoever reads the
// correction warning wants the location in one piece. It lives here, glued to
// the schema, so that the next reader does not invent their own recomposition:
// two formats of the same location is the divergence this module already paid
// for with JUDGE_TOOLS. With no line it prints only the file, which is exactly
// what that finding says.
export function findingLocation(finding) {
  const { path, line } = finding || {}
  return line === undefined || line === null ? String(path ?? '') : `${path}:${line}`
}

export function readReport(structured) {
  if (!structured || typeof structured !== 'object') return { why: 'el implementador no devolvió structured_output' }
  const { paths, summary } = structured
  if (!Array.isArray(paths) || !paths.every(isText)) return { why: 'el informe no trae la lista de rutas tocadas' }
  if (!isText(summary)) return { why: 'el informe no trae resumen' }
  // An absolute path, or one that climbs out of the directory, does not get
  // staged: the program runs `git add` on whatever this list says, so the list
  // is an attack surface, not trusted data.
  const outside = paths.filter((p) => p.startsWith('/') || p.split('/').includes('..'))
  if (outside.length) return { why: `el informe declara rutas fuera del worktree: ${outside.join(', ')}` }
  // The same path twice NO LONGER DISCARDS. It used to discard when this list
  // was the source of what gets staged: two declarations of the same path
  // could not be arbitrated. Ever since the program MEASURES the paths against
  // the tree as it stood before the task, the list is a cross-check, and in a
  // cross-check a duplicate leaves nothing undecidable: it says the same thing
  // twice. Discarding the whole report —and spending one of the six discards
  // that kill the run— over a repetition that changes nothing was the dearest
  // price for the cheapest defect.
  return { report: { paths: [...new Set(paths)], summary } }
}

// readE2eReport: the report -> an OUTCOME. Validated by hand and not with a
// schema library, just like readVerdict and for the same reason: the spec
// demands zero new dependencies and what has to be checked fits here.
//
// THE COMPARISON OF `run` IS IDENTICAL, collapsing whitespace and nothing
// else. The run reaches the agent verbatim from the spec's cell precisely so
// that this is possible; normalising any further (lowercasing, stripping
// punctuation) would let two texts a human wrote differently pass as "the same
// run", and that title is the only proof that what was asked for was walked
// through and not something else.
//
// WHAT IT DOES NOT CHECK: that the output is real. See the test's header.
const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim()

// fieldName: the field's name exactly as it travels in the JSON, plus the
// clarification needed when the name alone is not enough. `evidence` is the
// only such case: an empty list —or one with pairs missing the command or the
// output— is as insufficient as leaving it out, and saying only "`evidence` is
// missing" would send an agent that ALREADY put it there to look where the
// problem is not.
const fieldName = (field) => (field === 'evidence' ? '`evidence` (al menos un par comando/salida, los dos con texto)' : `\`${field}\``)
const hasEvidence = (e) => (Array.isArray(e.evidence) ? e.evidence.filter((x) => x && isText(x.command) && isText(x.output)) : []).length > 0

export function readE2eReport(structured, declaredRuns) {
  // The declared runs are DEDUPLICATED. Two identical cells are the same run,
  // and without this the report had no correct way of being written: `find`
  // returned the SAME entry for both, `buenos` duplicated it (and with it the
  // section in docs/superpowers/e2e/<issue>.md), while sending two equal
  // entries made the second one fall into "an entry this slice does not
  // declare". A repeated run is not a contradiction that has to be rejected
  // —it is a redundancy—, so it collapses instead of aborting the step.
  const declared = [...new Set((declaredRuns || []).map(collapse).filter(Boolean))]
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
    return { outcome: OUTCOMES.DISCARDED, why: 'el agente no devolvió structured_output' }
  }
  if (!Array.isArray(structured.runs)) {
    return { outcome: OUTCOMES.DISCARDED, why: '`runs` no es una lista' }
  }
  const problems = []
  // `buenos` keeps its name: e2e-schema.test.js documents this list by it.
  const buenos = []
  const seen = new Set()
  for (const run of declared) {
    const e = structured.runs.find((x) => x && collapse(x.run) === run)
    if (!e) { problems.push(`falta la entrada del recorrido "${run}"`); continue }
    seen.add(e)
    if (!E2E_VERDICTS.includes(e.verdict)) {
      problems.push(`el recorrido "${run}" trae un veredicto desconocido: ${JSON.stringify(e.verdict)}`)
      continue
    }
    // The three verdicts are validated against ONE table
    // (E2E_REQUIRED_BY_VERDICT, above), not against three branches written by
    // hand — it is the same table `ct-step next` shows the agent before it
    // writes the report, so they cannot diverge. Without it they did diverge:
    // `next` announced `run and verdict` while here the evidence, the reason
    // or the four fields of the red one were demanded on top.
    //
    // Why each verdict demands what it demands: a green with no evidence (not
    // even how it was brought up) is a claim with nothing behind it; a
    // not-verified with no `reason` and no `unblock` is a shrug that releases
    // the slice without leaving anyone knowing what to fix; and a half-written
    // red slipped a literal "undefined" into
    // `docs/superpowers/e2e/<issue>.md` —an artefact of the pull request—
    // because `writeE2eReport` (ct-step.mjs) trusts that whatever reaches
    // it here is already validated and checks nothing again.
    const missing = E2E_REQUIRED_BY_VERDICT[e.verdict].filter((field) => (field === 'evidence' ? !hasEvidence(e) : !isText(e[field])))
    if (missing.length) {
      problems.push(`el recorrido "${run}" se declara ${e.verdict} sin ${missing.map(fieldName).join(', ')}: ese veredicto no se sostiene sin eso. Añádelo al informe y vuelve a cerrar el paso con "ct-step e2e"`)
      continue
    }
    buenos.push(e)
  }
  for (const e of structured.runs) {
    if (!seen.has(e)) problems.push(`el informe trae una entrada que esta slice no declara: "${collapse(e && e.run)}"`)
  }
  // RED BEATS MALFORMED: see the test of the same name.
  //
  // `why` is OMITTED here when there are no problems — it is not set to `null`
  // — so as not to diverge from `readVerdict`/`readReport`, which do not carry
  // the `why` key on their happy path either. An explicit `null` would have
  // been a third value for no reason: the caller (`ct-step.mjs#e2eVerb`)
  // already normalises with `why || null`, so omitting it changes no
  // behaviour.
  if (buenos.some((e) => e.verdict === 'rojo')) {
    return problems.length
      ? { outcome: OUTCOMES.FAILED, runs: buenos, why: problems.join('; ') }
      : { outcome: OUTCOMES.FAILED, runs: buenos }
  }
  if (problems.length) return { outcome: OUTCOMES.DISCARDED, why: problems.join('; ') }
  return { outcome: OUTCOMES.DONE, runs: buenos }
}

// ============================================================================
// WHAT THE PROGRAM WRITES
//
// THE IMPLEMENTER DOES NOT COMMIT: THE PROGRAM COMMITS. That is what makes a
// veto leave no trail to undo, and it fits here without friction because in
// Control Tower a task is already a commit.
//
// And that is why this module validates its own message: the
// `commit-keyword-guard` hook is a PreToolUse over the Bash tool of a SESSION,
// so a `git commit` launched by a program does not go through that door. If
// the program does not look at its own message, the guardrail the repo built
// in F27 does not cover this path.
// ============================================================================
export function commitMessage({ issue, task, tasksTotal, name }) {
  const title = `${sanitize(name)} (#${issue}, tarea ${task}/${tasksTotal})`
  const body = [
    '',
    `Tarea ${task} de ${tasksTotal} del plan del slice, implementada y juzgada paso a paso con ct-step.`,
    '',
    // #95/H5: the marker by which the `Stop` hook recognises that this commit
    // was made by the PROGRAM and not by the agent — and then updates
    // `last_commit` itself instead of blocking the turn asking for a sha to be
    // copied that it already has. It is a trailer and not a sentence of the
    // body because git parses it itself (`%(trailers:key=…)`), so no message
    // can pass itself off as one of these by accident.
    CtStepCommit.TRAILER_LINE,
    'Co-Authored-By: Claude <noreply@anthropic.com>',
  ].join('\n')
  const message = title + '\n' + body
  const keywords = findClosingKeywords(message)
  if (keywords.length) {
    throw new Error(`el mensaje de commit contiene una closing keyword (${keywords.map((k) => `${k.keyword} ${k.ref}`).join(', ')}) y cerraría un issue sin que nadie lo haya decidido`)
  }
  return message
}

// The task's name comes from the plan, that is, from an agent. "fixes #12" in
// the title of a task is exactly the F27 accident, so the keyword is defused
// by breaking the reference, not by deleting the word: the title still reads
// the same.
function sanitize(name) {
  return String(name || 'tarea sin nombre').replace(/#(\d+)/g, 'issue $1').trim()
}

// The SLICE verdict has no task to hang off: a task's verdict travels INSIDE
// the commit of its own task, and the whole slice's is committed after the
// last one — so it gets a commit of its own, following the exact same
// precedent the rest of this module already obeys: the PROGRAM commits, and
// the program looks at its own message because `commit-keyword-guard` never
// sees a `git commit` that no session launched.
export function sliceVerdictCommitMessage({ issue, tasksTotal }) {
  const title = `Veredicto del slice entero (#${issue})`
  const body = [
    '',
    `Las ${tasksTotal} tareas comiteadas, la Global verification en verde y el slice juzgado de una vez por ct-slice-judge.`,
    '',
    CtStepCommit.TRAILER_LINE,
    'Co-Authored-By: Claude <noreply@anthropic.com>',
  ].join('\n')
  const message = title + '\n' + body
  const keywords = findClosingKeywords(message)
  if (keywords.length) {
    throw new Error(`el mensaje de commit del veredicto de slice contiene una closing keyword (${keywords.map((k) => `${k.keyword} ${k.ref}`).join(', ')}) y cerraría un issue sin que nadie lo haya decidido`)
  }
  return message
}
