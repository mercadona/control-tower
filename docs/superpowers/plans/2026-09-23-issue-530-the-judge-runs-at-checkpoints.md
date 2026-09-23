# #530 — the task judge runs at the checkpoints the plan names

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow this plan
> and `AGENTS.md`.

## 1. Context and goal

`ct-step` judges every task of a slice. `afterControls` in `plugin/scripts/run-machine.js` sends
every green `controls` to `judge`, and `commitVerb` in `plugin/scripts/ct-step.mjs` refuses to
commit without the index seal that only a PASS writes. A slice of 6 to 9 tasks pays 6 to 9
`ct-judge` passes. The committed telemetry shows that the judge vetoes the first attempt in 21
of 86 tasks, so three passes in four find nothing.

The issue asks for a middle road. A plan task may carry `**Judge:** checkpoint`. The last task is
always a checkpoint. A task that is not a checkpoint goes from green `controls` to `commit`. A
checkpoint judge reviews the whole stretch since the last judged commit. A veto at a checkpoint
sends the findings to the implementer of the checkpoint task, and the fix lands in the commit of
that task.

### Desired end state

- `extractTasks` gives each task a `checkpoint` boolean, and it reports any `**Judge:**` value
  other than `checkpoint` as a problem.
- `newRun` stores the plan checkpoints, and `isCheckpoint(run)` answers for the current task.
- Green `controls` on a task that is not a checkpoint goes to `commit`, with the index sealed by
  `controls`.
- The review package of a checkpoint carries the staged diff against the last judged commit,
  without the telemetry file.
- The judge brief of a checkpoint carries every task of its stretch.
- A veto at a checkpoint tells the implementer that the earlier tasks of the stretch are its to
  fix.
- `ct-judge.md`, `ct-slice-judge.md` and the plan skill describe the checkpoints.

### Out of scope

- The slice judge, `global`, `reconcile` and `e2e` keep their behaviour.
- The advisor and the round a person grants keep their behaviour.
- No per-task architect exists in the loop, so nothing goes there.
- The backend and the frontend keep every byte. They read the announced step and need no change.
- The telemetry gains no new field.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| The plan marker | `**Judge:** checkpoint`, one line in the task, optional |
| Any other value | a problem with rule `judge-line`, so `--check-plan` refuses the plan |
| A task with no marker | not a checkpoint, unless it is the last task |
| The task field | `checkpoint: boolean` on each task `extractTasks` returns |
| The run field | `checkpoints`: the task numbers the plan marks, frozen when the run is born |
| A run with no `checkpoints` field | every task is a checkpoint, as a run born before this slice |
| The predicate | `isCheckpoint(run)` in `run-machine.js`, exported |
| The stretch | `stretchOf(run)` in `run-machine.js` answers `{ from, to }` |
| The last judged commit | `run.judgedSha`: `baseSha` at birth, HEAD after each checkpoint commit |
| An old run with no `judgedSha` | the load sets it to HEAD, since that run judged every task |
| The seal of a task with no judge | `controlsVerb` writes `sealedTree: indexTree()` on green |
| After every commit | `sealedTree` goes back to `null` |
| The veto fix | it lands in the commit of the checkpoint task; no history is rewritten |
| The harness plan | task 1 gains `**Judge:** checkpoint`, so the old tests keep their judge |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `plugin/__tests__/ct-step-advice.test.js` drives a verb through
`plugin/__tests__/fixtures/ct-step-harness.js`. `plugin/__tests__/run-machine.test.js` tests the
pure table. `plugin/__tests__/plan-tasks.test.js` tests the parser.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `plugin/conventions/style.md`,
`plugin/conventions/testing.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/decisions.md`, `docs/glossary.md`,
`docs/language.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/plan-tasks.js` | modify | `ct-step.mjs`, `plan-contract.js` | Current state / Contract |
| `plugin/__tests__/plan-tasks.test.js` | modify | the plugin suite | none (body by TDD) |
| `plugin/scripts/run-machine.js` | modify | `ct-step.mjs` | Current state / Contract |
| `plugin/__tests__/run-machine.test.js` | modify | the plugin suite | none (body by TDD) |
| `plugin/scripts/ct-step.mjs` | modify | the loop and the backend oracle | Current state / Contract |
| `plugin/__tests__/fixtures/ct-step-harness.js` | modify | every ct-step test | Current state |
| `plugin/__tests__/ct-step-checkpoints.test.js` | create | the plugin suite | none (body by TDD) |
| `plugin/agents/ct-judge.md` | modify | the judge | Final text |
| `plugin/agents/ct-slice-judge.md` | modify | the slice judge | Final text |
| `plugin/skills/ct-writing-plans-prescriptive/SKILL.md` | modify | the plan writer | Final text |

## 5. Interfaces

Consumes: `extractTasks(markdown)` from `plugin/scripts/plan-tasks.js`, `newRun` and `after` from
`plugin/scripts/run-machine.js`, and `makeRepo` and `makeHelpers` from
`plugin/__tests__/fixtures/ct-step-harness.js`.

Produces: `isCheckpoint(run): boolean` and `stretchOf(run): { from: number, to: number }` from
`plugin/scripts/run-machine.js`. The `checkpoint` field on each task of `extractTasks`. The
`plan` option of `makeRepo({ e2e, plan })`.

## 6. Test strategy

Each task names its own test files. The plugin runs them with `env -u CT_STATE_DIR npx vitest
run <files>` from `plugin/`. The files that drive `ct-step` launch a real process, so they cost
about a minute each. The table and the parser are pure, and their tests run in under a second.

The new file `ct-step-checkpoints.test.js` drives the real `ct-step` over the harness. It writes
its own plan through the `plan` option of `makeRepo`. The old harness tests keep their plan,
with task 1 marked, so every one of them still reaches the judge at task 1.

## 7. Tasks

### Task 1 — the plan names its checkpoints

**Objective:** `extractTasks` reads `**Judge:** checkpoint` into a `checkpoint` boolean on each
task.

**Files:** `plugin/scripts/plan-tasks.js` (modify), `plugin/__tests__/plan-tasks.test.js`
(modify), `plugin/scripts/plan-contract.js` (modify), `plugin/__tests__/plan-contract.test.js`
(modify)

Current state (plugin/scripts/plan-tasks.js, lines 80-80):

```js
const OTHER_MARKERS = ['**Objective:**', FILES, TDD, TESTS]
```

Contract (plugin/scripts/plan-tasks.js):

```js
const JUDGE = '**Judge:**'
const CHECKPOINT = 'checkpoint'
const OTHER_MARKERS = ['**Objective:**', FILES, TDD, TESTS, JUDGE]
// each task: { n, name, commands, testsAdded, testsRemoved, checkpoint }
// problem on any other value, rule 'judge-line':
//   `task ${n} declares "${JUDGE} ${value}": the only value is "${CHECKPOINT}".`
```

Read the value from the first structural line that starts with `**Judge:**`, trimmed. A task
with no such line gets `checkpoint: false`. `validatePlan` in `plan-contract.js` forwards only
the verification problems of `extractTasks`, so it also forwards `judge-line` as a violation with
rule `judge`.

**TDD:** `it('a task that declares **Judge:** checkpoint is a checkpoint, and a task that declares nothing is not')`
expects `true` for the marked task and `false` for the other. The boundary is
`it('any other value of **Judge:** is a problem that names the task')`. It expects one problem
with rule `judge-line` for `**Judge:** always`.

**Tests:** added, in `plugin/__tests__/plan-tasks.test.js`:
`'a task that declares **Judge:** checkpoint is a checkpoint, and a task that declares nothing is not'`,
`'any other value of **Judge:** is a problem that names the task'`. Removed on purpose: none.

**Verification:** The parser suite and the contract suite stay green.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/plan-tasks.test.js __tests__/plan-contract.test.js   # expected: exit 0 — the parser and the contract
test "$(grep -c "'judge-line'" plugin/scripts/plan-tasks.js)" -eq 1   # expected: exit 0 — one rule refuses the wrong value
```

### Task 2 — the table skips the judge between checkpoints

**Objective:** Green `controls` goes to `judge` only at a checkpoint, and to `commit` on any
other task.

**Files:** `plugin/scripts/run-machine.js` (modify), `plugin/__tests__/run-machine.test.js`
(modify)

Current state (plugin/scripts/run-machine.js, lines 196-199):

```js
function afterControls(run, outcome, budgets) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return open(run, { step: STEPS.JUDGE })
```

Contract (plugin/scripts/run-machine.js):

```js
export function newRun({ plan, issue, baseSha, tasksTotal, e2eRuns, checkpoints })
// stores checkpoints: Array.isArray(checkpoints) ? [...checkpoints] : null
// stores judgedSha: baseSha
export function isCheckpoint(run)
// true when run.checkpoints is not an array, when it holds run.task,
// or when run.task === run.tasksTotal
export function stretchOf(run)
// { from, to: run.task }; from is one past the greatest checkpoint below
// run.task, or 1 when none is below; from is run.task when isCheckpoint
// answers true for every task
```

`afterControls` on `DONE` opens `JUDGE` when `isCheckpoint(run)` answers true, and `COMMIT`
otherwise. The other outcomes keep their branches.

**TDD:** `it('done on a task that is not a checkpoint → commit, with no judge')` builds a run of
three tasks with `checkpoints: [2]` at task 1. The boundary is
`it('done on the last task → judge, even when the plan names no checkpoint')`, with
`checkpoints: []` at task 3. Then
`it('a run with no checkpoints list judges every task, as a run born before the field did')`.
Then `it('the stretch of a checkpoint starts one past the previous checkpoint')` expects
`{ from: 3, to: 4 }` for `checkpoints: [2]` at task 4 of four.

**Tests:** added, in `plugin/__tests__/run-machine.test.js`:
`'done on a task that is not a checkpoint → commit, with no judge'`,
`'done on the last task → judge, even when the plan names no checkpoint'`,
`'a run with no checkpoints list judges every task, as a run born before the field did'`,
`'the stretch of a checkpoint starts one past the previous checkpoint'`. Removed on purpose:
none.

**Verification:** The table suite stays green, the old `done → judge` case included.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/run-machine.test.js __tests__/e2e-run-machine.test.js   # expected: exit 0 — the table, old and new cases
test "$(grep -c 'export function isCheckpoint' plugin/scripts/run-machine.js)" -eq 1   # expected: exit 0 — one predicate
```

### Task 3 — ct-step commits a task with no judge

**Objective:** `ct-step` seeds the checkpoints and commits a green task with no judge, under the
seal of its controls.

**Files:** `plugin/scripts/ct-step.mjs` (modify), `plugin/__tests__/fixtures/ct-step-harness.js`
(modify), `plugin/__tests__/ct-step-checkpoints.test.js` (create),
`plugin/__tests__/ct-step-index.test.js` (modify)

Current state (plugin/scripts/ct-step.mjs, lines 485-485):

```js
  run = newRun({ plan: planPath, issue, baseSha: headSha(), tasksTotal: tasks.length, e2eRuns: sliceMeta.e2e })
```

Current state (plugin/scripts/ct-step.mjs, lines 1714-1714):

```js
  run = { ...run, lastControlsLog: log }
```

Current state (plugin/__tests__/fixtures/ct-step-harness.js, lines 53-54):

```js
  '### Task 1 — the first one',
  '**Objective:** one file.',
```

The `newRun` call passes `checkpoints: tasks.filter((t) => t.checkpoint).map((t) => t.n)`. The
load at line 337 also sets `judgedSha: run.judgedSha ?? headSha()`. On green `controls` for a
task where `isCheckpoint(run)` answers false, `controlsVerb` adds `sealedTree: indexTree()`.
`commitVerb` sets `judgedSha` to the new HEAD when `isCheckpoint(run)` answers true, and it sets
`sealedTree: null` after every commit. The harness adds `'**Judge:** checkpoint',` after the
objective line of task 1. `makeRepo` gains a `plan = PLAN` option and writes it to `plan.md`.

**TDD:** `it('green controls on a task the plan does not mark go straight to commit, and the commit carries no verdict file')`
expects `step` `commit` after `controls` at task 1. It expects no
`docs/superpowers/verdicts/issue-7-task-1.json` after `commit`. The boundary is
`it('the last task is judged even when the plan marks no checkpoint')`. Then
`it('an index changed after the controls is not committed on a task with no judge')` stages one
more file after `controls` and expects `commit` to exit 8.

**Tests:** added, in `plugin/__tests__/ct-step-checkpoints.test.js`:
`'green controls on a task the plan does not mark go straight to commit, and the commit carries no verdict file'`,
`'the last task is judged even when the plan marks no checkpoint'`,
`'an index changed after the controls is not committed on a task with no judge'`. Removed on
purpose: none.

**Verification:** The new file and the old harness files stay green.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-checkpoints.test.js __tests__/ct-step-index.test.js __tests__/ct-step-verdict.test.js __tests__/ct-step-delivery.test.js   # expected: exit 0 — the new road and the sealed index
```

### Task 4 — the checkpoint judge sees its whole stretch

**Objective:** At a checkpoint the package, the judge brief and the veto line cover every task of
the stretch.

**Files:** `plugin/scripts/ct-step.mjs` (modify), `plugin/__tests__/ct-step-checkpoints.test.js`
(modify)

Current state (plugin/scripts/ct-step.mjs, lines 1092-1092):

```js
const taskDiff = () => git(['diff', '--cached', '-U10']) || ''
```

Contract (plugin/scripts/ct-step.mjs):

```js
const taskDiff = () => git(['diff', '--cached', '-U10', run.judgedSha, '--', '.', `:(exclude)${METRICS_REL}`]) || ''
// package header when stretchOf(run).from < run.task:
//   `# Review package: tasks ${from}-${to}/${run.tasksTotal} of issue #${issue} (${from}-${to - 1} committed since ${run.judgedSha.slice(0, 7)}, ${to} staged)`
// veto line in next, under the findings, when from < to:
//   `The judge reviewed tasks ${from}-${to} together: a finding in a file of an earlier task of that stretch is yours to fix in this attempt, and it lands in the commit of task ${to}.`
// judge brief section for each earlier task k of the stretch:
//   `## Earlier task of this stretch: ${k}`
```

`writeTaskBody(path, n = run.task, { withContext = true } = {})` takes the task number.
`writeJudgeBrief` writes the current task with its context as today. Then it appends each earlier
task of the stretch, in order, under its section heading and without the plan context. The
package header keeps its old text when the stretch holds one task.

**TDD:** `it('the package of a checkpoint carries the diff of every task since the last judged commit')`
marks task 2 only, commits task 1 with no judge, and expects `uno.txt` and `dos.txt` in the
package diff. The boundary is
`it('the package of a checkpoint right after another carries its own task alone')`. Then
`it('the package leaves the telemetry of the committed tasks out of the diff')`, then
`it('the judge brief of a checkpoint carries every task of its stretch')`, then
`it('a veto at a checkpoint tells the implementer the earlier tasks of the stretch are its to fix')`.

**Tests:** added, in `plugin/__tests__/ct-step-checkpoints.test.js`:
`'the package of a checkpoint carries the diff of every task since the last judged commit'`,
`'the package of a checkpoint right after another carries its own task alone'`,
`'the package leaves the telemetry of the committed tasks out of the diff'`,
`'the judge brief of a checkpoint carries every task of its stretch'`,
`'a veto at a checkpoint tells the implementer the earlier tasks of the stretch are its to fix'`.
Removed on purpose: none.

**Verification:** The stretch tests and the package suites stay green.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-checkpoints.test.js __tests__/ct-step-package.test.js __tests__/ct-step-advice.test.js   # expected: exit 0 — the stretch, the package and the advisor
```

### Task 5 — the judges and the plan writer know the checkpoints

**Objective:** The two judge rubrics and the plan skill describe the checkpoints in the words the
program uses.

**Files:** `plugin/agents/ct-judge.md` (modify), `plugin/agents/ct-slice-judge.md` (modify),
`plugin/skills/ct-writing-plans-prescriptive/SKILL.md` (modify)

Current state (plugin/agents/ct-slice-judge.md, lines 51-54):

```md
- **The task verdicts**, one JSON per task, already committed under
  `docs/superpowers/verdicts/issue-<n>-task-*.json`. Each one is what
  `ct-judge` already found for that task alone — read them to see which defects
  are already on the record, which is what keeps you off them.
```

Final text (plugin/agents/ct-slice-judge.md):

```md
- **The task verdicts**, one JSON per checkpoint, already committed under
  `docs/superpowers/verdicts/issue-<n>-task-*.json`. Each one is what
  `ct-judge` already found for the stretch that checkpoint closed — read them to
  see which defects are already on the record, which is what keeps you off them.
```

Final text (plugin/agents/ct-judge.md):

```md
**You may judge a stretch.** The plan marks some tasks `**Judge:** checkpoint`, and
the last task is always one. A task between two checkpoints goes to its commit with
no judge. So the package can open with `tasks A-B`: then `## Diff` runs from the last
judged commit to the index, and the brief adds each earlier task of the stretch.
Judge every task of the stretch against its own text. After a veto, a fix in a file
of an earlier task of the stretch is in scope, and it lands in this task's commit.
```

That paragraph goes in `ct-judge.md` right after the paragraph that opens with *"The task's own
verification commands"*. The `SKILL.md` paragraph goes after the `**Verification:**` paragraph of
`## Structure`, with this text:

Final text (plugin/skills/ct-writing-plans-prescriptive/SKILL.md):

```md
**A task may carry `**Judge:** checkpoint`.** The judge reviews only the checkpoints and
the last task, each time over the whole stretch since the previous checkpoint. Mark a task
that fixes a contract, an interface or a shape that later tasks lean on. A task with no
marker goes to its commit with no judge. Any other value fails `--check-plan`.
```

No code — the three files are rubric and skill prose.

**TDD:** No TDD — prose for two agents and one skill. The yardstick suites measure them.

**Tests:** N/A — no behaviour changes.

**Verification:** The yardstick suites stay green and each file names the checkpoint.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/plugin-yardstick.test.js __tests__/yardstick-citation.test.js   # expected: exit 0 — the rubrics still parse
test "$(grep -c 'Judge:\*\* checkpoint' plugin/agents/ct-judge.md)" -ge 1   # expected: exit 0 — the judge knows the marker
test "$(grep -c 'one JSON per checkpoint' plugin/agents/ct-slice-judge.md)" -eq 1   # expected: exit 0 — the slice judge counts checkpoints
test "$(grep -c 'Judge:\*\* checkpoint' plugin/skills/ct-writing-plans-prescriptive/SKILL.md)" -ge 1   # expected: exit 0 — the writer knows the marker
```

## 8. Global verification

The commands below measure the slice end to end. The fast subset covers the pure modules. The
named files drive the real `ct-step` over the harness.

```bash
cd plugin && env -u CT_STATE_DIR npm run test:fast   # expected: exit 0 — the fast subset of the plugin
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-checkpoints.test.js __tests__/ct-step-advice.test.js __tests__/ct-step-reopen.test.js __tests__/ct-step-slice-judgement.test.js   # expected: exit 0 — the stretch, the advisor, the round and the slice judge
test "$(grep -c 'isCheckpoint' plugin/scripts/ct-step.mjs)" -ge 2   # expected: exit 0 — ct-step asks the table
```

## 9. Assumptions

1. **A task with no marker gets no judge.** Provenance: the issue. It changes the cost of every
   plan written before this slice. A run already open keeps its old behaviour, because its file
   has no `checkpoints` field.
2. **The checkpoints freeze when the run is born.** Provenance: my own call. An amendment that
   adds a marker later does not reach the open run. The table stays pure that way.
3. **The veto fix travels in the commit of the checkpoint task.** Provenance: the issue asks for
   a new commit with no history rewrite. The checkpoint task has no commit yet at the veto, so its
   commit carries the fix. The count of commits per task stays `task - 1`.
4. **The telemetry file leaves the diff by pathspec.** Provenance: my own call.
   `commitVerb` stages `METRICS_REL` in every commit, so a stretch diff would carry the rows of
   the earlier tasks.
5. **The implementer scope needs no change.** Provenance: I read `reportVerb`. It stages what the
   tree measured, so a fix in an earlier file of the stretch reaches the index as it is.
