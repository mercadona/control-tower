# #607 — A run closed by its controls can be reopened

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`plugin/scripts/run-machine.js` closes a run at `blocked-controls` in `afterControls` and at
`blocked-global` in `afterGlobal`. `plugin/scripts/ct-step.mjs` writes `closed` to the run file
only for `delivered` and `blocked-judge`. The closing refusal explains only the judge's closure
(`explained`). At load time only `blocked-judge` has a block that answers `next` and `reopen`.
Any other `reopen` answers that the run stands outside `blocked-judge`.

The commit count at load time is `expectedCommits()` in `ct-step.mjs`. It compares
`git rev-list --count --no-merges baseSha..HEAD` with the phase of the run. The review phase
(`PHASES.REVIEW`) shows how a commit after the last task counts. Its unit answers
`commitsForTheSlice`, so `commitVerb` adds one to `sliceCommits`.

The issue asks for three things. `ct-step` writes both closures to the run file. Their refusal
names the failing command, its exit and the log path. `reopen --instruction` lifts both. The
controls go back to the implementer of the same task. The Global verification opens a fix
round after the last task.

### Desired end state

- A red or unmeasured Global verification leaves `closed: 'blocked-global'` in the run file.
  `next` repeats the refusal with the failing command and the log path.
- Red controls after the retries, or unmeasured controls, leave `closed: 'blocked-controls'`.
  `next` repeats the refusal with the failing command and the log path.
- `reopen` on `blocked-controls` returns the run to that task's `implement`, with
  `controlRetries: 0`. The brief carries the instruction and the controls log.
- `reopen` on `blocked-global` opens the phase `fix` at `implement`. Every brief of the fix
  round carries the global log. That covers the first round, a vetoed round, the adviser's
  attempt and a round reopened after a veto.
- `ct-judge` judges the fix round before its commit, as it judges the review's fix rounds. It
  reads the fix round's own staged diff. The judge budget and the veto → advise →
  `blocked-judge` path apply. Its commit counts as a slice commit. The run then goes to `global` and on green to
  `slice-judge`.
- `reopen` on an open run, or on a closure outside `blocked-judge`, `blocked-controls` and
  `blocked-global`, exits 9 as today.
- Outside the fix round, the judge's reopen gives the same run file, brief and prose as today.
  Its refusal adds only `vetoed`.
- The transitions live in pure modules, and in-process tests cover them. No new test case
  launches a process.

### Out of scope

- 🚫 `backend/` and `frontend/`.
- 🚫 `ct-next`, `ct-groom` and `dispatch-check`.
- 🚫 `plugin/__tests__/fixtures/ct-step-harness.js` and every test that runs a real process.
  Existing cases stay as they are, and no new case uses the harness.
- 🚫 `blocked-slice-judge`, `blocked-e2e`, `blocked-reconcile` and `blocked-commit` keep their
  behaviour.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 · One state machine | `a person lifts a closure with the same verb that already lifts the judge's veto, `ct-step reopen --instruction`; the backend never edits a run file to lift one.` |
| D-2 · Controls | `a run closed at `blocked-controls` (red after the retries, or unmeasured) is persisted as closed, and `reopen` returns it to the implementer of the same task with the control retries reset, the person's instruction as the advice and the last controls log in the brief.` |
| D-3 · Global verification | `a run closed at `blocked-global` (red or unmeasured) is persisted as closed, and `reopen` opens a fix round after the last task: the implementer gets the global log and the instruction, its commit is counted by the run as its own so the commit count does not refuse it, and the run goes back to the Global verification and then to the slice judge.` |
| D-4 · A closure explains itself | `the refusal of `blocked-controls` and `blocked-global` carries the failing command, its exit and the log path, as the judge's carries its findings and verdict.` |
| D-5 · Out of this epic | `blocked-slice-judge`, `blocked-e2e`, `blocked-reconcile` and `blocked-commit` keep their behaviour. |
| D-6 · Order | `the plugin first; the backend and the page come in later slices.` |
| The fix round | the phase `PHASES.FIX = 'fix'`: `implement`, `controls`, `judge`, `commit`; its commit opens `global` in the phase `slice`, counters at zero |
| The judge of the fix round | `ct-judge`, with the review's judge budget and its veto → advise → `blocked-judge` path. It reads the fix round's diff against HEAD. |
| Verdict of the fix round | `docs/superpowers/verdicts/issue-<n>-fix.json`, staged into the fix round's commit, as the review's verdict. |
| Controls of the fix round | every task's **Verification:** commands, as the review runs them. No promised tests. |
| Commit count of the fix round | `expectedCommits(run)` moves to `run-machine.js`. The phase `fix` expects `tasksTotal + sliceCommits`, as the phase `slice` does. |
| The failure record | `lastFailure: { outcome, command, code, log }`, from `controlsVerb` and `globalVerb` on red or unmeasured; `null` on green; `command` and `code` null for a check with no command |
| The announcement field | a refusal takes an optional `failure: { command, code, log }` and prints it after `detail`. |
| What a veto names | a refusal takes an optional `vetoed`, the unit's `vetoedName`, after `verdict` and before `failure`. `ct-step` passes it for `blocked-judge` on both roads. |
| Reopened closure marker | `reopen` on controls or global writes `reopenedFrom: <the closure>`. The judge's reopen writes no new field. `commitVerb` clears `reopenedFrom` and `lastFailure` with `lastAdvice`. |
| Log in the brief | the log path, and its last `200` lines inside a fenced `text` block. |
| Brief of the fix round | the phase `fix` decides it, not `reopenedFrom`. The global lead and `lastGlobalLog` go first. The round's guidance follows. |

## 3. Reference patterns

Files to imitate:

- `plugin/scripts/judged-unit.js` — a pure module of classes; `JudgedReview` is the shape of
  the fix round's unit.
- `plugin/scripts/step-announcement.js` — static factories that validate their input.
- `plugin/__tests__/run-machine.test.js` — in-process tests of the table.
- `plugin/__tests__/judged-unit.test.js` — in-process tests of a unit.

Rules to obey:

- `.agent/conventions.md`
- `CLAUDE.md`
- `docs/language.md`
- `plugin/conventions/style.md`
- `plugin/conventions/testing.md`
- `plugin/conventions/defects.md`

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/run-machine.js` | modify | `ct-step.mjs`, `run-closure.js`, `judged-unit.js` | Current state, Contract |
| `plugin/__tests__/run-machine.test.js` | modify | vitest | none (body by TDD) |
| `plugin/dist/dispatch-guard.js` | modify | the hook | none (built) |
| `plugin/scripts/run-closure.js` | create | `ct-step.mjs` | Contract |
| `plugin/__tests__/run-closure.test.js` | create | vitest | none (body by TDD) |
| `plugin/scripts/step-announcement.js` | modify | `ct-step.mjs` | Current state |
| `plugin/__tests__/step-announcement.test.js` | modify | vitest | none (body by TDD) |
| `plugin/scripts/judged-unit.js` | modify | `ct-step.mjs` | Contract |
| `plugin/scripts/step-contracts.js` | modify | `judged-unit.js` | Contract |
| `plugin/__tests__/judged-unit.test.js` | modify | vitest | none (body by TDD) |
| `plugin/scripts/reopened-brief.js` | create | `ct-step.mjs` | Contract |
| `plugin/__tests__/reopened-brief.test.js` | create | vitest | none (body by TDD) |
| `plugin/scripts/ct-step.mjs` | modify | the loop | Current state, Call site |

## 5. Interfaces

Consumes: N/A — no dependencies.

Produces, for the backend slice and the page slice:

- `RUN_STATES.BLOCKED_CONTROLS` and `RUN_STATES.BLOCKED_GLOBAL` in `closed` of `.agent/run-<n>.json`.
- `lastFailure: { outcome, command, code, log }` in the run file.
- The refusal announcement fields `failure: { command, code, log }` and `vetoed`.
- `ct-step reopen --instruction "<text>"` on a run closed at either state, exit 0 with a
  `transition` to `open`.

## 6. Test strategy

Every new case runs in process with vitest in `plugin/`, over pure modules. `ct-step.mjs` runs
only as a child process, so Tasks 6 and 7 add no case. The whole plugin suite, the existing
harness cases included, stays green after each task. Tasks 1 to 5 carry the in-process
cases for every acceptance criterion.

## 7. Tasks

### Task 1 — the fix phase and the commit count in the table

**Objective:** `run-machine.js` knows the phase `fix` and answers the commit count of a run.

**Files:** `plugin/scripts/run-machine.js` (modify), `plugin/__tests__/run-machine.test.js`
(modify), `plugin/scripts/ct-step.mjs` (modify), `plugin/dist/dispatch-guard.js` (modify).

Current state (plugin/scripts/run-machine.js, lines 321-331):

```js
function afterCommitIn(run) {
  switch (run.phase) {
    // The review commit carries the judge's fixes and verdict, and it opens
    // the slice queue as the last task commit did before the review existed.
    case PHASES.REVIEW:
      return open(run, { step: STEPS.RECONCILE, phase: PHASES.SLICE, ...freshCounters })
    case PHASES.TASK:
      return afterTaskCommit(run)
    default:
      throw new Error(`impossible transition: a commit in the phase "${run.phase}"`)
  }
}
```

Contract (plugin/scripts/run-machine.js):

```js
export const PHASES = Object.freeze({ TASK: 'task', REVIEW: 'review', SLICE: 'slice', FIX: 'fix' })
// judgesBeforeCommit: case PHASES.FIX → true, as PHASES.REVIEW
// afterCommitIn: case PHASES.FIX → open(run, { step: STEPS.GLOBAL, phase: PHASES.SLICE, ...freshCounters })
export function expectedCommits(run)
// TASK → task - 1; REVIEW → tasksTotal; SLICE and FIX → tasksTotal + (sliceCommits || 0)
// any other phase throws `a run phase this version does not know: "<phase>"`
```

Call site (plugin/scripts/ct-step.mjs):

```js
const expected = expectedCommits()      // before: the local function
const expected = expectedCommits(run)   // after: imported from run-machine.js
```

Delete the local `function expectedCommits()` of `ct-step.mjs`, and import the new one. The
file `plugin/dist/dispatch-guard.js` bundles `run-machine.js`, so run `make build-plugin`.

**TDD:** `it('the fix round commit goes back to the Global verification with the counters at zero')`
asserts `step: 'global'`, `phase: 'slice'` and three zero counters from a `fix` commit.

**Tests:** added: `'the fix round commit goes back to the Global verification with the counters at zero'`,
`'green controls in the fix round go to the judge before the commit'`,
`'the judge approving the fix round sends it to its commit, and the commit to the Global verification'`,
`'a veto in the fix round spends the judge budget, calls the adviser and then closes at blocked-judge'`,
`'the fix round counts the commits of the slice, so its own commit is expected'`,
`'a phase this version does not know has no commit count'`. Removed on purpose: none.

**Verification:** The table cases pass, and the built hook matches its sources.

```bash
make build-plugin   # expected: exit 0
cd plugin && npx vitest run __tests__/run-machine.test.js __tests__/dist-matches-sources.test.js   # expected: exit 0
cd plugin && npx vitest run   # expected: exit 0 — the whole plugin suite
```

### Task 2 — the closures a person can lift

**Objective:** a new pure module decides which closures the run file keeps and what `reopen` makes of each one.

**Files:** `plugin/scripts/run-closure.js` (create), `plugin/__tests__/run-closure.test.js` (create).

Contract (plugin/scripts/run-closure.js):

```js
export class ReopenRefused extends Error {}
export class RunClosure {
  static REOPENABLE   // frozen [BLOCKED_JUDGE, BLOCKED_CONTROLS, BLOCKED_GLOBAL]
  static persists(state)   // true for DELIVERED and every REOPENABLE state
  static outcomeOf(run)    // BLOCKED_JUDGE → OUTCOMES.FAILED; else run.lastFailure.outcome
  static reopen(run, instruction)   // the reopened run; throws ReopenRefused off REOPENABLE
}
```

`reopen` removes `closed` and keeps every other field. By closure it sets:

- `blocked-judge`: `step: 'implement'`, `judgeRetries: 0`, `lastAdvice: instruction`. Nothing else.
- `blocked-controls`: `step: 'implement'`, `controlRetries: 0`, `lastAdvice`, and
  `reopenedFrom: 'blocked-controls'`. The phase and the task stay.
- `blocked-global`: `phase: 'fix'`, `step: 'implement'`, the three retry counters at zero,
  `lastAdvice`, and `reopenedFrom: 'blocked-global'`.

The message of `ReopenRefused` is `the run of issue <n> is not closed at blocked-judge,
blocked-controls or blocked-global: it stands at step <step>, so there is nothing to reopen.`
The discards never change.

**TDD:** `it('a reopened controls closure goes back to the same task implementer with the control retries at zero')`
starts from `task: 2`, `controlRetries: 2` and asserts `task: 2`, `step: 'implement'`, `controlRetries: 0`.

**Tests:** added: `'a reopened controls closure goes back to the same task implementer with the control retries at zero'`,
`'a reopened global closure opens a fix round after the last task'`,
`'the judge reopen gives the same run as before this slice'` (a `toEqual` on the whole run),
`'an open run has nothing to reopen'`, `'a slice judge closure has nothing to reopen'`,
`'the discards survive every reopen'`, `'the run file keeps the three closures a person lifts'`,
`'the run file keeps no slice judge, e2e, reconcile or commit closure'`. For the fix round:
`'a judge closure of the fix round reopens in the fix round'`,
`'a controls closure of the fix round reopens in the fix round'`. Removed on purpose: none.

**Verification:** The closure cases pass in process.

```bash
cd plugin && npx vitest run __tests__/run-closure.test.js   # expected: exit 0
```

### Task 3 — a closure names its failing command

**Objective:** the refusal of a controls or global closure carries the failing command, its exit and the log path.

**Files:** `plugin/scripts/run-closure.js` (modify), `plugin/scripts/step-announcement.js`
(modify), `plugin/__tests__/run-closure.test.js` (modify), `plugin/__tests__/step-announcement.test.js` (modify).

Current state (plugin/scripts/step-announcement.js, lines 182-183):

```js
    if (typeof findings === 'string' && findings !== '') announcement.findings = findings
    if (typeof verdict === 'string' && verdict !== '') announcement.verdict = verdict
```

`refusal` takes a new optional `failure` parameter. When it is an object, the announcement gets
`failure: { command, code, log }`, after `verdict`. A second optional `vetoed` goes between them.

Contract (plugin/scripts/run-closure.js):

```js
static wayOut({ run, issue, planPath, subject })   // one sentence, the refusal detail
static failureOf(run)   // { command, code, log } of run.lastFailure, or null
```

`wayOut` keeps the judge's sentence of today, byte for byte, with `subject` in place of
`unit.vetoedName`. For the other two it writes:

- `the controls of <subject> of issue <n> <cause> (log at <log>) and the run is closed.`
- `the Global verification of issue <n> <cause> (log at <log>) and the run is closed.`

`<cause>` takes one of three forms, with the command inside backticks:

- red: `are red: <command> exited <code>`;
- unmeasured: `could not be measured: <command>`;
- no command: `are red: a check that runs no command failed`.
 Both end with
`Grant another round with "ct-step reopen --plan <plan> --issue <n> --instruction \"…\"".`

**TDD:** `it('the global closure names the failing command and the log path')` asserts that the
sentence contains `` `npm test` exited 1 `` and the log path.

**Tests:** added: `'the global closure names the failing command and the log path'`,
`'the controls closure names the failing command and the log path'`,
`'an unmeasured command says it could not be measured'`,
`'a red check with no command says so instead of naming one'`,
`'the judge way out reads as before this slice'`,
`'a refusal prints the failing command its exit and the log after the verdict'`,
`'a judge refusal names what was vetoed after the verdict and before the failure'`,
`'a refusal with an empty vetoed prints no vetoed'`. Removed on purpose: none.

**Verification:** The new cases and the old announcement cases pass.

```bash
cd plugin && npx vitest run __tests__/run-closure.test.js __tests__/step-announcement.test.js   # expected: exit 0
```

### Task 4 — the unit of the fix round

**Objective:** `JudgedUnit.of` answers the phase `fix` with a unit that runs every task's commands and commits for the slice.

**Files:** `plugin/scripts/judged-unit.js` (modify), `plugin/scripts/step-contracts.js`
(modify), `plugin/__tests__/judged-unit.test.js` (modify).

Contract (plugin/scripts/judged-unit.js):

```js
class FixRound   // JudgedUnit.of: case PHASES.FIX → new FixRound({ run, tasks, issue })
  stem = 'fix'; get diffBase() → [] (the fix round's own diff, staged against HEAD); get commands() → every task's commands
  get promisedTests() → PromisedTests.NONE; get commitsForTheSlice() → true
  get verdictPath() → `docs/superpowers/verdicts/issue-<n>-fix.json`; verdictRecord(verdict) → as JudgedReview
  commitMessage() → fixRoundCommitMessage({ issue, tasksTotal })
  committedLine(sha) → `the fix round committed: <sha7>`
  get packageHeader() → `# Review package: the fix round of issue #<n> after the Global verification (staged against HEAD, not yet committed)`
  get briefLead() / get briefAppendices() → as JudgedReview
  get nextHeading() → `slice of issue <n> — the fix round after the Global verification`
  get sentBackLines() → ['The judge reviewed the fix round: fix every finding, in any file of the slice. The fixes land in the fix round commit after the judge approves them.']
  get vetoedName() / get vetoedSelf() / get reopenedAt() → 'the fix round'
  get adviceLine() → "The judge has vetoed the fix round twice. …for the paths of the fix round…"
  get nothingToCommitWarning() → "warning: nothing to commit of the fix round (are the fixes and the telemetry gitignored?) — the run carries on."
// JudgedReview.nothingToCommitWarning → today's text in commitVerb, byte for byte
```

Contract (plugin/scripts/step-contracts.js):

```js
export function fixRoundCommitMessage({ issue, tasksTotal })
// title: `the fix round after the Global verification (#<n>, after task <m>/<m>)`
// body line: 'The fixes a person asked for after the Global verification of the slice went red.'
```

`fixRoundCommitMessage` copies the trailer and the closing keyword refusal of `reviewCommitMessage`.

**TDD:** `it('the fix round commits for the slice, so the run counts its commit')` asserts
`commitsForTheSlice` is `true` for a `fix` run.

**Tests:** added: `'the fix round commits for the slice, so the run counts its commit'`,
`'the fix round runs every task commands and promises no test'`,
`'the judge of the fix round judges the fix round diff staged against HEAD, not the whole slice'`,
`'the fix round verdict travels in its commit under its own path, with the shape of the whole slice'`,
`'a veto of the fix round names the fix round in the brief, the sending back and the advice'`,
`'the fix round commit message names the round and the issue'`,
`'the fix round brief leads with the first task and appends the others'`,
`'a veto names the task, the review of the slice or the fix round, so the three closures at blocked-judge tell apart'`. Removed on purpose: none.

**Verification:** The unit cases pass.

```bash
cd plugin && npx vitest run __tests__/judged-unit.test.js   # expected: exit 0
```

### Task 5 — the brief of a reopened closure

**Objective:** a new pure module writes the brief section that carries the person's instruction and the log of the closure.

**Files:** `plugin/scripts/reopened-brief.js` (create), `plugin/__tests__/reopened-brief.test.js` (create).

Contract (plugin/scripts/reopened-brief.js):

```js
export class ReopenedBrief {
  static LOG_TAIL_LINES = 200
  static section({ closure, instruction, log })   // blocked-controls only; log is a BriefLog
  static fixRoundOf(run, readLog)   // every brief of the phase fix
}
export class BriefLog { constructor({ path, text }) }
```

The section opens with `## Advice for this attempt`. The lead line by closure:

- `blocked-controls`: `The controls of this task stayed red, or could not be measured, and the
  run was closed. A person read the log and reopened it with an instruction of their own:`
- the fix round: `The Global verification of the slice stayed red, or could not be measured,
  and the run was closed. A person opened this fix round: fix what the log shows, in any file of
  the slice. The program runs the Global verification again after your commit.`

The fix round writes the global log next. Its guidance follows, and `lastAdvice` and
`reopenedFrom` pick it. It is `Their instruction:` after the global reopen, the judge's reopen or
the adviser's approach. It can also be the controls reopen with its own log, or nothing.

The controls section writes the instruction, ``The last log, at `<logPath>` (its last 200 lines):`` and the tail
in a fenced `text` block. With a null text, it writes `The log could not be read.` instead.
The controls section ends with ``This does not widen the task: `**Files:**` above is still its
scope.`` Any other closure throws.

**TDD:** `it('the controls brief carries the instruction and the controls log')` asserts the
instruction, the log path and a line of the log.

**Tests:** added: `'the controls brief carries the instruction and the controls log'`,
`'the global brief carries the instruction and the global log'`,
`'a vetoed fix round reopened by a person still carries the Global verification log'`,
`'the adviser attempt inside the fix round still carries the Global verification log'`,
`'only the last 200 lines of the log reach the brief'` (201 lines: line 1 is absent, line 2 is present),
`'an unreadable log is said, not left out'`, `'a closure with no reopen has no brief'`. For the fix round:
`'the judge of the fix round reads the Global verification log after green controls cleared the failure'`,
`'a controls reopen inside the fix round keeps the global log under the global lead and the controls log under its own'`,
`'a fix round with no guidance left still carries the Global verification log and nothing else'`,
`'a fix round reopened from a closure with no guidance throws instead of guessing one'`. Removed on purpose:
`'a controls reopen inside the fix round does not narrow the scope to one task'`, which the fix round cases replace.

**Verification:** The brief cases pass.

```bash
cd plugin && npx vitest run __tests__/reopened-brief.test.js   # expected: exit 0
```

### Task 6 — ct-step keeps and explains the two closures

**Objective:** `ct-step` writes both closures and their failure to the run file, and `next` repeats their refusal.

**Files:** `plugin/scripts/ct-step.mjs` (modify).

Current state (plugin/scripts/ct-step.mjs, lines 2995-3002):

```js
  if (transition.state === RUN_STATES.DELIVERED) run = { ...run, closed: RUN_STATES.DELIVERED }
  // The judge's veto is persisted for the same reason the good closure is: a
  // closure that lives only in the exit code of a process that has gone leaves
  // the run reading `step: judge` with the budget spent, so the next `next`
  // re-enters the judge and re-closes for free. Only this state, and only from
  // this path: the discard budget exits above, so a persisted `blocked-judge`
  // is always the veto — `FAILED`, `EXIT.VETOED`. `reopen` is what lifts it.
  if (transition.state === RUN_STATES.BLOCKED_JUDGE) run = { ...run, closed: RUN_STATES.BLOCKED_JUDGE }
```

Both lines become one: `if (RunClosure.persists(transition.state)) run = { ...run, closed: transition.state }`.

In `controlsVerb` and `globalVerb`, keep the command and the code that broke the loop. Write
`lastFailure` as §2 says, with the log path of that verb.

The load-time block `if (run.closed === RUN_STATES.BLOCKED_JUDGE)` becomes a block for every
`RunClosure.REOPENABLE` state. Its sentence is `RunClosure.wayOut({ run, issue, planPath,
subject: unit.vetoedName })`. The `next` refusal takes `state: run.closed`, `outcome:
RunClosure.outcomeOf(run)` and `exit: exitCodeOf(run.closed, run.step, outcome)`. The judge
keeps `findings` and `verdict` and adds `vetoed: unit.vetoedName`; the other two add `failure: RunClosure.failureOf(run)`. Any other
verb dies with that sentence and exit 9. `reopen` stays as today in this task.

At the closing refusal, `explained` also gives `{ failure: RunClosure.failureOf(run) }` for
`blocked-controls` and `blocked-global`.

**TDD:** No TDD — `ct-step.mjs` runs only as a child process. Tasks 2 and 3 carry its logic, tested in process.

**Tests:** N/A — no case added; the existing harness cases must stay green.

**Verification:** The whole plugin suite stays green, the closure and reopen cases too.

```bash
cd plugin && npx vitest run   # expected: exit 0 — the whole plugin suite
```

### Task 7 — ct-step reopens the two closures

**Objective:** `ct-step reopen` lifts `blocked-controls` and `blocked-global`, and the brief of the next round carries the instruction and the log.

**Files:** `plugin/scripts/ct-step.mjs` (modify).

Current state (plugin/scripts/ct-step.mjs, lines 428-435):

```js
  // `reopen` outside its closure: the run is not the judge's to give back.
  if (verb === 'reopen') {
    die(
      `the run of issue ${issue} is not closed at ${RUN_STATES.BLOCKED_JUDGE}: it stands at step ${run.step}, `
      + 'so there is nothing to reopen.',
      EXIT.WRONG_STEP,
    )
  }
```

This refusal dies with the message of `ReopenRefused`, from `RunClosure.reopen`, and exit 9.

Call site (plugin/scripts/ct-step.mjs):

```js
const { closed: _lifted, ...reopened } = run                                            // before
run = { ...reopened, step: STEPS.IMPLEMENT, judgeRetries: 0, lastAdvice: instruction }  // before
run = RunClosure.reopen(run, instruction)                                               // after
```

The prose after a reopen names the closure. The judge keeps its line. Controls:
`run reopened at <unit.reopenedAt> of issue <n>: the implementer gets another round with the
control retries at zero. Ask for the step with "ct-step next".` Global: `run reopened at a fix
round of issue <n>: the implementer fixes what the Global verification showed, and the program
then runs it again. Ask for the step with "ct-step next".`

`writeBrief` and `writeJudgeBrief` append `ReopenedBrief.fixRoundOf` in the phase `fix`. Else they
append `ReopenedBrief.section` when the run carries `reopenedFrom`, with a `BriefLog` of
`run.lastFailure.log`. Else they append
`adviceSection` as today. `commitVerb` clears `reopenedFrom` and `lastFailure` in both run
updates. Its empty-index warning becomes `err(unit.nothingToCommitWarning)`.

**TDD:** No TDD — `ct-step.mjs` runs only as a child process. Tasks 1, 2, 4 and 5 carry its logic, tested in process.

**Tests:** N/A — no case added; the existing reopen harness cases must stay green.

**Verification:** The whole plugin suite stays green, and the judge's reopen cases with it.

```bash
cd plugin && npx vitest run __tests__/ct-step-reopen.test.js   # expected: exit 0
cd plugin && npx vitest run   # expected: exit 0 — the whole plugin suite
```

## 8. Global verification

The plugin suite runs once over the whole slice. The built hooks match their sources.

```bash
make build-plugin   # expected: exit 0
cd plugin && npx vitest run   # expected: exit 0 — the whole plugin suite
test -z "$(git status --porcelain plugin/dist)"   # expected: exit 0 — dist is committed as built
```

## 9. Assumptions

1. The brief names the gate `plan`, and its amendment retires it (#434). So the plan goes on
   with no comment on the issue. Provenance: the amendment of the brief.
2. `ct-judge` judges the fix round before its commit, as it judges every fix round of the
   review. The slice judge trusts `ct-judge` for everything local to a change. That covers its
   tests, manipulated tests and contracts. With no judge, a fix round could let a weakened test
   reach `main` unseen.
   D-3 then sends its commit to the Global verification and the slice judge. Provenance: the
   review finding on PR #615.
3. The controls of the fix round run every task's commands, as the review does. The Global
   verification then runs §8. Provenance: own call, `JudgedReview.commands`.
4. The judge's reopen writes no `reopenedFrom`, so its run file stays as today. Outside the fix
   round, a run with no `reopenedFrom` gets today's advice section. Provenance: issue, acceptance criterion 7.
5. `reopen` of a controls closure in the phase `review` or `fix` keeps that phase. The same
   rule serves every phase. Provenance: own call.
6. A reopened controls round starts its attempt count again, so its log may reuse the name of
   the first attempt. The brief carries the old log before that write. Provenance: own call.
7. The backend and the page still read only `blocked-judge`. Slices 2 and 3 of the epic change
   them. Provenance: issue, D-6.
8. The fix round's brief reads `lastGlobalLog`, not `lastFailure.log`. Green controls clear
   `lastFailure`, and a veto or the adviser clears `reopenedFrom`. Provenance: own call.
