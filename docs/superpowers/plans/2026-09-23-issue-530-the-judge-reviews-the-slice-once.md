# #530 — the task judge reviews the whole slice once, after the last commit

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow this plan
> and `AGENTS.md`.

## 1. Context and goal

This plan replaces `2026-09-23-issue-530-the-judge-runs-at-checkpoints.md`, which Task 1
deletes. That plan landed on this branch. A plan task could carry `**Judge:** checkpoint`, the
last task was always a checkpoint, and a checkpoint judged its stretch before its commit. The
person who owns the issue then chose a simpler rule. `ct-judge` passes once, after the last task
commits, over the whole slice. Every fix the judge asks for lands in a commit of its own.

The branch already carries parts this plan keeps. `controlsVerb` in `plugin/scripts/ct-step.mjs`
seals the index for a task with no judge, and `commitVerb` refuses an index nobody sealed. The
package diff reads the whole repo minus the telemetry file, from any cwd. The judge brief can
carry several tasks. This plan removes the checkpoint marker, `isCheckpoint`, `stretchOf` and
`judgedSha`, and adds a review phase after the last commit.

### Desired end state

- Every task goes `implement → controls → commit`, with no judge.
- The last commit opens the review: `judge` over the diff from the run base to the index.
- A veto sends the findings to an implementer, and `controls` runs the verification commands of
  every task again.
- A PASS at the review goes to `commit`. That commit carries the fixes and the verdict, and then
  the run goes to `reconcile`.
- A run born before this change judges every task, as it did before.
- The plan marker `**Judge:**` is gone from the parser, the contract and the skill.
- `ct-judge.md` and `ct-slice-judge.md` describe the review.

### Out of scope

- `reconcile`, `global`, `slice-judge` and `e2e` keep their behaviour.
- The advisor after the second veto and the round a person grants keep their behaviour.
- The backend and the frontend keep every byte. They read the announced step.
- The telemetry gains no new field.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| The run mode | `judging: 'final'`, which `ct-step` passes to `newRun` for every new run |
| A run with no `judging` field | `judgesEachTask(run)` answers true, and the run judges every task |
| The review flag | `reviewing: boolean`, false at birth, true from the last commit to the review commit |
| The predicate | `judgesEachTask(run)` in `run-machine.js`, exported; `isCheckpoint` and `stretchOf` go |
| Controls in the review | the commands of every task of the plan, in plan order |
| Declared tests in the review | not checked again; each task checked its own |
| The seal | `controlsVerb` seals on green when the next step is `commit` |
| The review package diff | `git diff --cached -U10 <run.baseSha> -- :/ :(top,exclude)<METRICS_REL>` |
| A per-task package diff | `git diff --cached -U10 -- :/ :(top,exclude)<METRICS_REL>`, for old runs |
| The review verdict file | `docs/superpowers/verdicts/issue-<n>-review.json` |
| The review commit | `reviewCommitMessage({ issue, tasksTotal })` in `step-contracts.js` |
| After the review commit | `sliceCommits` grows by one, and the step is `reconcile` |
| The commit count on load | `tasksTotal` while `reviewing` is true |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `plugin/__tests__/ct-step-advice.test.js` drives a verb through
`plugin/__tests__/fixtures/ct-step-harness.js`. `plugin/__tests__/run-machine.test.js` tests the
pure table. `plugin/scripts/step-contracts.js` holds `commitMessage`, the shape
`reviewCommitMessage` follows.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `plugin/conventions/style.md`,
`plugin/conventions/testing.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/decisions.md`, `docs/glossary.md`,
`docs/language.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/run-machine.js` | modify | `ct-step.mjs`, the backend | Contract |
| `plugin/__tests__/run-machine.test.js` | modify | the plugin suite | none (body by TDD) |
| `plugin/scripts/ct-step.mjs` | modify | the loop and the backend oracle | Contract |
| `plugin/scripts/step-contracts.js` | modify | `ct-step.mjs` | Contract |
| `plugin/__tests__/ct-step-review.test.js` | create | the plugin suite | none (body by TDD) |
| `plugin/__tests__/ct-step-checkpoints.test.js` | delete | nobody | none |
| `plugin/__tests__/fixtures/ct-step-harness.js` | modify | every ct-step test | Contract |
| the ct-step test files Task 3 names | modify | the plugin suite | none (body by TDD) |
| `plugin/scripts/plan-tasks.js`, `plugin/scripts/plan-contract.js` | modify | `ct-step.mjs`, `--check-plan` | Contract |
| `plugin/agents/ct-judge.md`, `plugin/agents/ct-slice-judge.md` | modify | the two judges | Final text |
| `plugin/skills/ct-writing-plans-prescriptive/SKILL.md` | modify | the plan writer | none (prose) |

## 5. Interfaces

Consumes: `extractTasks(markdown)` from `plugin/scripts/plan-tasks.js`, `newRun` and `after` from
`plugin/scripts/run-machine.js`, `makeRepo` and `makeHelpers` from the harness.

Produces: `judgesEachTask(run): boolean` from `plugin/scripts/run-machine.js`.
`reviewCommitMessage({ issue, tasksTotal }): string` from `plugin/scripts/step-contracts.js`.
The harness helper `commitTask(paths)`.

## 6. Test strategy

Task 1 changes the table and `ct-step` together, so the old harness tests go red there. They
expect a judge after the controls of each task. Task 1 names only the pure table suite and the
new review file. Task 3 migrates every harness test to the new sequence and brings the plugin
suite back to green. The plugin runs its tests with `env -u CT_STATE_DIR npx vitest run <files>`
from `plugin/`. The backend check is `npm run typecheck` from `backend/`.

## 7. Tasks

### Task 1 — the judge reviews the slice once, after the last commit

**Objective:** Each task commits after green controls, and the last commit opens the review.

**Files:** `plugin/scripts/run-machine.js` (modify), `plugin/__tests__/run-machine.test.js`
(modify), `plugin/scripts/ct-step.mjs` (modify), `plugin/scripts/step-contracts.js` (modify),
`plugin/__tests__/ct-step-review.test.js` (create), and delete the earlier plan of #530

Contract (plugin/scripts/run-machine.js):

```js
export function newRun({ plan, issue, baseSha, tasksTotal, e2eRuns, judging = null })
// stores judging: judging === 'final' ? 'final' : null, and reviewing: false
// no checkpoints, no judgedSha
export function judgesEachTask(run) // run.judging !== 'final'
// afterControls DONE → JUDGE when judgesEachTask(run) || run.reviewing, else COMMIT
// afterCommit DONE:
//   run.reviewing → RECONCILE, reviewing: false, the three retry counters at 0
//   run.task < run.tasksTotal → next task, as today
//   judgesEachTask(run) → RECONCILE, as today
//   else → JUDGE, reviewing: true, the three retry counters at 0
```

Contract (plugin/scripts/step-contracts.js):

```js
export function reviewCommitMessage({ issue, tasksTotal })
// title `the judge's review of the slice (#${issue}, after task ${tasksTotal}/${tasksTotal})`
// body `The fixes the judge asked for and its verdict.`; trailer, Co-Authored-By
// and the closing-keyword refusal as commitMessage
```

In `ct-step.mjs`, `newRun` gets `judging: 'final'` and no `checkpoints`. The load drops the
`judgedSha` backfill and counts `tasksTotal` commits when `run.reviewing` is true. In the
review, `controlsVerb` runs `tasks.flatMap((t) => t.commands)` and skips `declaredTests`.

`controlsVerb` seals the index on green when the next step is `commit`. In the review,
`commitVerb` uses `reviewCommitMessage` and adds one to `sliceCommits`. Remove `isCheckpoint`,
`stretchOf` and `judgedSha`. Task 2 does the package and the briefs.

**TDD:** `it('done on a task before the last → commit, with no judge')`, then the boundary
`it('the last commit opens the review: judge, with the counters at zero')`, then
`it('the commit after the review opens reconcile')`, then
`it('a run born before the final review judges every task, as it always did')`. In the new file:
`it('green controls on every task go straight to commit, and no task commit carries a verdict')`
and `it('a veto at the review sends the implementer back, and the controls measure every task again')`.

**Tests:** added: the four names in `run-machine.test.js` and the two in
`ct-step-review.test.js`. Removed on purpose, from
`plugin/__tests__/run-machine.test.js`: `'done on a task that is not a checkpoint → commit, with no judge'`,
`'done on the last task → judge, even when the plan names no checkpoint'`,
`'a run with no checkpoints list judges every task, as a run born before the field did'`,
`'the stretch of a checkpoint starts one past the previous checkpoint'`.

**Verification:** The table suite, the new review file and the backend typecheck stay green.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/run-machine.test.js __tests__/ct-step-review.test.js   # expected: exit 0 — the table and the review road
cd backend && npm run typecheck   # expected: exit 0 — the backend still type-checks the table
test "$(grep -c 'isCheckpoint' plugin/scripts/ct-step.mjs)" -eq 0   # expected: exit 0 — the checkpoint predicate is gone
```

### Task 2 — the review judge sees the whole slice

**Objective:** At the review the package, the briefs and the verdict file cover every task of the
slice.

**Files:** `plugin/scripts/ct-step.mjs` (modify), `plugin/__tests__/ct-step-review.test.js`
(modify)

Contract (plugin/scripts/ct-step.mjs):

```js
// taskDiff while reviewing:
//   git(['diff', '--cached', '-U10', run.baseSha, '--', ':/', `:(top,exclude)${METRICS_REL}`])
// taskDiff otherwise: the same without run.baseSha
// the package --stat reads the same range as taskDiff
// package header while reviewing:
//   `# Review package: the ${run.tasksTotal} tasks of issue #${issue} (committed since ${run.baseSha.slice(0, 7)}, fixes staged)`
// judge brief and implementer brief while reviewing: task 1 with the plan context,
//   then each task k from 2 to tasksTotal under `## Task ${k} of the slice`
// veto line in next while reviewing, under the findings:
//   `The judge reviewed the whole slice: fix every finding, in any file of any task. The fixes land in one commit after the judge approves them.`
// verdict path while reviewing: docs/superpowers/verdicts/issue-${issue}-review.json
// slice-judge VERDICTS input glob: docs/superpowers/verdicts/issue-${issue}-*.json
```

The per-task package header keeps its old text for an old run. `next` names the review as
`slice of issue ${issue} — the review of the ${run.tasksTotal} tasks`.

**TDD:** `it('the review package carries the diff of every task since the base, without the telemetry')`,
then `it('the review judge brief carries every task of the plan once, with the plan context once')`,
then `it('the approved fixes and the verdict land in one commit of their own, and the run moves to reconcile')`,
then `it('an index changed after the review verdict is not committed')`, then
`it('the review package carries the whole slice when ct-step runs from a subdirectory')`.

**Tests:** added, in `plugin/__tests__/ct-step-review.test.js`: the five names above. Removed on
purpose: none.

**Verification:** The review file and the package suite stay green.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-review.test.js __tests__/ct-step-slice-judgement.test.js   # expected: exit 0 — the review and the slice judge
test "$(grep -c 'issue-${issue}-review.json' plugin/scripts/ct-step.mjs)" -ge 1   # expected: exit 0 — the review verdict has its path
```

### Task 3 — the harness tests walk the new sequence

**Objective:** Every test that drives `ct-step` over the harness walks `implement → controls →
commit`, and reaches the judge at the review.

**Files:** `plugin/__tests__/fixtures/ct-step-harness.js` (modify),
`plugin/__tests__/ct-step-checkpoints.test.js` (delete), and every file that
`grep -lE "judgeTask|'verdict'" plugin/__tests__/*.js` lists (modify)

No code — the harness is test code. `PLAN` loses its `**Judge:** checkpoint` line, and
`makeHelpers` gains `commitTask(paths)`: `next`, `report`, `controls`, `commit`.

A test that measured the judge at task 1 now walks to the review first: `commitTask` for each
task, then `next`. Keep the subject of each test. Move its judge to the review. Keep every
assertion that still describes a true behaviour, and change the numbers that the new sequence
changes: commits, steps and header text. Delete a test only when the review already measures
the same fact, and name it under **Tests:** in the report. The two old-run roads stay covered by
`'a run born before the final review judges every task, as it always did'`.

**TDD:** No TDD — this task moves existing tests to the new sequence. Each file goes red on
Task 1 and green here.

**Tests:** removed on purpose: the file `plugin/__tests__/ct-step-checkpoints.test.js`, whose
facts `plugin/__tests__/ct-step-review.test.js` now measures. Every other name stays.

**Verification:** The whole plugin suite runs green.

```bash
cd plugin && env -u CT_STATE_DIR npm test   # expected: exit 0 — the whole plugin suite on the new sequence
```

### Task 4 — the plan marker goes

**Objective:** The parser, the contract and the plan skill stop knowing `**Judge:**`.

**Files:** `plugin/scripts/plan-tasks.js` (modify), `plugin/__tests__/plan-tasks.test.js`
(modify), `plugin/scripts/plan-contract.js` (modify), `plugin/__tests__/plan-contract.test.js`
(modify), `plugin/skills/ct-writing-plans-prescriptive/SKILL.md` (modify)

Contract (plugin/scripts/plan-tasks.js):

```js
const OTHER_MARKERS = ['**Objective:**', FILES, TDD, TESTS]
// each task: { n, name, commands, testsAdded, testsRemoved }
// no JUDGE, no CHECKPOINT, no 'judge-line' problem
```

`plan-contract.js` stops forwarding `judge-line`. `SKILL.md` loses the paragraph that opens
with the `**Judge:**` marker, and nothing replaces it.

**TDD:** No TDD — this task removes a parser branch and its tests.

**Tests:** removed on purpose, from `plugin/__tests__/plan-tasks.test.js`:
`'a task that declares **Judge:** checkpoint is a checkpoint, and a task that declares nothing is not'`,
`'any other value of **Judge:** is a problem that names the task'`. Removed on purpose, from
`plugin/__tests__/plan-contract.test.js`:
`'the plan contract refuses a **Judge:** value that is not checkpoint'`,
`'**Judge:** checkpoint stays ok'`.

**Verification:** The parser, the contract and the skill suites stay green.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/plan-tasks.test.js __tests__/plan-contract.test.js __tests__/skills-fork.test.js   # expected: exit 0 — parser, contract, skill cap
test -z "$(grep -l 'Judge:\*\*' plugin/scripts/plan-tasks.js plugin/scripts/plan-contract.js plugin/skills/ct-writing-plans-prescriptive/SKILL.md)"   # expected: exit 0 — no file knows the marker
```

### Task 5 — the judges know the review

**Objective:** The two judge rubrics describe one review of the whole slice after the last
commit.

**Files:** `plugin/agents/ct-judge.md` (modify), `plugin/agents/ct-slice-judge.md` (modify)

Final text (plugin/agents/ct-judge.md):

```md
**You review the whole slice, once.** Every task was committed after its own controls,
with no judge. So `## Diff` runs from the base of the run to the index: every task, plus
the fixes a previous veto asked for. The brief carries every task of the plan. Judge each
task against its own text. A finding may name any file of any task. The fixes land in one
commit after your PASS.
```

It replaces the paragraph *"You may judge a stretch."* Then
reword the other sentences of `ct-judge.md` about a stretch or a checkpoint. They must read true
of the review. In `ct-slice-judge.md`, the verdicts bullet reads one JSON, the review verdict at
`docs/superpowers/verdicts/issue-<n>-review.json`. Its other sentences about a checkpoint now
name the review.

**TDD:** No TDD — prose for two agents. The rubric suites measure them.

**Tests:** N/A — no behaviour changes.

**Verification:** The rubric suites stay green and no judge file names a checkpoint.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/plugin-yardstick.test.js __tests__/yardstick-citation.test.js __tests__/prompts-en-positivo.test.js   # expected: exit 0 — the rubrics still parse
test -z "$(grep -li 'checkpoint' plugin/agents/ct-judge.md plugin/agents/ct-slice-judge.md)"   # expected: exit 0 — no judge speaks of a checkpoint
```

## 8. Global verification

The commands below measure the slice end to end.

```bash
cd plugin && env -u CT_STATE_DIR npm test   # expected: exit 0 — the whole plugin suite
cd backend && npm run typecheck   # expected: exit 0 — the backend reads the table
test "$(grep -c "judging: JUDGING.FINAL" plugin/scripts/ct-step.mjs)" -ge 1   # expected: exit 0 — ct-step births every run for the final review
```

## 9. Assumptions

1. **The earlier plan goes.** Provenance: the person chose to redo the branch. Two plans for one
   issue would describe two designs, and `--release` validates both.
2. **The review verdict commit carries the fixes.** Provenance: the person asked for commits
   with the fixes the judge dictates. A PASS with no fix still commits, because the verdict has
   to travel in the pull request.
3. **The review keeps `run.task` at the last task.** Provenance: my own call. The telemetry
   rows of the review carry the number of the last task.
4. **The review brief carries every task.** Provenance: my own call. A slice of nine tasks makes
   a long brief, and the brief of the judge is where it has to be long.
5. **An old run keeps the per-task diff with the whole-repo pathspec.** Provenance: my own call.
   From the repo root it reads the same diff as before.
