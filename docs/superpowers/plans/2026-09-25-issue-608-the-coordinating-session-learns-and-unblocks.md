# #608 — The coordinating session learns and unblocks

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

Slice #1 (PR #615) taught `ct-step` two new closures, `blocked-controls` and `blocked-global`.
Their refusal carries an optional `failure: {command, code, log}`. A `blocked-judge` refusal
carries an optional `vetoed` that names the unit: `task 3`, `the review of the slice` or
`the fix round`.

`ct-step reopen --instruction` lifts all three closures.

The backend reads none of it. `RunAnnouncement` in `backend/src/infrastructure/run-announcement.ts`
parses only `task`, `findings` and `verdict` into `RunClosure`. `ReadMilestoneProgress` keeps
only the judge's refusal, so the other two closures read as `uncertain`.

`DriveRun.#announce`
tells the coordinating session only about `blocked-judge`. `SessionClosureAnnouncements.lineFor`
names the task number, so a veto of the review of the slice names the wrong unit. The phase
prompt names only `blocked-judge`. `RunPlanAgents.anotherRound` refuses any closure but
`blocked-judge`.

This slice makes the backend read, show, announce and lift the two new closures.

### Desired end state

- `RunClosure` carries `vetoed` and `failure`. `RunAnnouncement` reads both, and a refusal
  without them still parses. `GET /active-plans` projects both.
- `GET /milestone-progress` gives a line closed at `blocked-controls` the attention kind
  `controls`, and one closed at `blocked-global` the kind `global`. Each carries the outcome,
  the failing command, its exit and the log path.
- When a run closes at `blocked-controls` or `blocked-global`, `DriveRun` tells the coordinating
  session what failed. The line names the command, its exit and the log.
- The veto line names what the plugin says the judge vetoed.
- When no session hears the closure, stderr gets
  `drive run: <repo>#<n> closed at <state> and the closure was not announced: <why>`.
- The phase prompt names `blocked-controls` and `blocked-global` and what a round does for each.
- `POST /slices/:issue/another-round` grants a round for `blocked-judge`, `blocked-controls` and
  `blocked-global`, through `ct-step reopen`. It still refuses an open run and every other
  closure.
- Every new test runs in process, with doubles of the run machine and the process runner.

### Out of scope

- 🚫 `plugin/` and `frontend/`. The page slice reads the new attention kinds.
- 🚫 `blocked-slice-judge`, `blocked-e2e`, `blocked-reconcile` and `blocked-commit` keep their
  behaviour (D-5).
- 🚫 `ProcessRatchet.LISTED` gets no new entry. No new test runs the real `ct-step`.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 · One state machine | a person lifts a closure with the verb that lifts the judge's veto, `ct-step reopen --instruction`. The backend never edits a run file to lift one. |
| D-2 · Controls | `reopen` on `blocked-controls` sends the run back to the implementer of the same task, with the instruction and the controls log |
| D-3 · Global verification | `reopen` on `blocked-global` opens a fix round after the last task; the run goes back to the Global verification and then to the slice judge. |
| D-4 · A closure explains itself | the refusal of `blocked-controls` and `blocked-global` carries the failing command, its exit and the log path. |
| D-5 · Out of this epic | `blocked-slice-judge`, `blocked-e2e`, `blocked-reconcile` and `blocked-commit` keep their behaviour. |
| D-6 · Order | the plugin first; then the backend (this slice); then the page. |
| The failure type | `RunFailure = { command: string \| null, code: number \| null, log: string }` in `run-instruction.ts` |
| Closure fields | `RunClosure` adds `vetoed: string \| null` and `failure: RunFailure \| null`, both always present |
| A malformed failure | `null` for a `failure` with no non-empty string `log`; inside one, `null` for a `command` or `code` of the wrong type |
| Attention kinds | `controls` and `global`, with flat fields `outcome`, `command`, `code`, `log`; `controls` also carries `task` |
| Announced closure | `AnnouncedClosure` adds `state`, `outcome`, `vetoed` and `failure` |
| Grantable closures | `RunPlanAgents.REOPENABLE = [RUN_STATES.BLOCKED_JUDGE, RUN_STATES.BLOCKED_CONTROLS, RUN_STATES.BLOCKED_GLOBAL]` |
| New prompt constant | `PhasePrompt.ANOTHER_ROUND_AFTER_A_FAILED_CHECK`, right after `ANOTHER_ROUND_AFTER_A_VETO` in the three prompts |

## 3. Reference patterns

Files to imitate:

- `backend/src/infrastructure/session-closure-announcements.ts` — the one line per closure.
- `backend/__tests__/application/drive-run.test.ts` — `DriveRunMother.refusing` and
  `AnnouncementsSpy`, doubles of the run machine.
- `backend/__tests__/infrastructure/ct-run-machine.test.ts` — `OracleFixture` doubles the
  process runner, and `vetoedJournal` builds a closed journal.
- `backend/__tests__/infrastructure/run-plan-agents.test.ts` — `RunMachineDouble` for a grant.

Rules to obey:

- `.agent/conventions.md`
- `CLAUDE.md`
- `docs/language.md`
- `backend/conventions/this-repository.md`
- `plugin/conventions/style.md`
- `plugin/conventions/testing.md`
- `plugin/conventions/defects.md`

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/value-objects/run-instruction.ts` | modify | every closure reader | Current state, Contract |
| `backend/src/infrastructure/run-announcement.ts` | modify | `CtRunMachine` | Current state |
| `backend/src/infrastructure/active-plans-route.ts` | modify | `GET /active-plans` | Current state |
| `backend/src/domain/value-objects/slice-line.ts` | modify | `GET /milestone-progress` | Current state, Contract |
| `backend/src/application/queries/read-milestone-progress.ts` | modify | `MilestoneProgressRoute` | Current state |
| `backend/src/domain/ports/closure-announcements.ts` | modify | `DriveRun` | Current state, Contract |
| `backend/src/infrastructure/session-closure-announcements.ts` | modify | the coordinating session | Current state |
| `backend/src/application/actions/drive-run.ts` | modify | `RunPlanAgents` | Current state |
| `backend/src/domain/value-objects/phase-prompt.ts` | modify | the coordinating session | Contract |
| `backend/src/infrastructure/run-plan-agents.ts` | modify | `AnotherRoundRoute` | Current state, Contract |
| `backend/__tests__/**` named in §7 | modify | vitest | none (body by TDD) |

## 5. Interfaces

Consumes, from slice #1 (PR #615): the refusal announcement fields `failure: {command, code, log}`
and `vetoed`, both optional. The states `blocked-controls` and `blocked-global` of `RUN_STATES` in
`plugin/scripts/run-machine.js`. `ct-step reopen --instruction` on the three closures.

Produces, for the page slice:

- The attention `{ kind: 'controls', task, outcome, command, code, log }` of a slice line.
- The attention `{ kind: 'global', outcome, command, code, log }` of a slice line.
- `refusal.vetoed` and `refusal.failure` in `GET /active-plans`.
- `POST /slices/:issue/another-round` answers 202 for the three closures.

## 6. Test strategy

Every new case runs in process with vitest in `backend/`. Application tests use the doubles of
the run machine (`RunMachineDouble`, `DriveRunMother`). The machine test uses `OracleFixture`,
which doubles the process runner, so no case runs the real `ct-step`. The whole backend suite
and `tsc` stay green after each task.

## 7. Tasks

### Task 1 — the closure carries what was vetoed and what failed

**Objective:** `RunClosure` carries `vetoed` and `failure` from the refusal to `GET /active-plans`.

**Files:** `backend/src/domain/value-objects/run-instruction.ts` (modify),
`backend/src/infrastructure/run-announcement.ts` (modify),
`backend/src/infrastructure/active-plans-route.ts` (modify),
`backend/__tests__/infrastructure/run-announcement.test.ts` (modify),
`backend/__tests__/infrastructure/active-plans-route.test.ts` (modify).

Current state (backend/src/domain/value-objects/run-instruction.ts, lines 1-8):

```ts
export type RunClosure = {
  readonly state: string,
  readonly outcome: string,
  readonly exit: number,
  readonly task: number | null,
  readonly findings: string | null,
  readonly verdict: string | null,
}
```

Contract (backend/src/domain/value-objects/run-instruction.ts):

```ts
export type RunFailure = {
  readonly command: string | null,
  readonly code: number | null,
  readonly log: string,
}
// RunClosure adds:
//   readonly vetoed: string | null,
//   readonly failure: RunFailure | null,
```

Current state (backend/src/infrastructure/run-announcement.ts, lines 117-118):

```ts
      findings: RunAnnouncement.#textOrNothing(record.findings),
      verdict: RunAnnouncement.#textOrNothing(record.verdict),
```

After these two lines add `vetoed: RunAnnouncement.#textOrNothing(record.vetoed)` and
`failure: RunAnnouncement.#failureOf(record.failure)`. The new `static #failureOf(value: unknown):
RunFailure | null` follows §2 "A malformed failure" and returns a frozen object.
`ActivePlansRoute.#project` copies both new fields into `projected.refusal`, after `verdict`.
Add `vetoed: null, failure: null` to every closure literal that `tsc` or a `toEqual` now refuses.

**TDD:** `it('reads the failing command, its exit and the log path of a blocked-controls refusal')`
asserts `closure.failure` equals `{ command: 'npm test', code: 1, log: '.agent/run-7/controls.log' }`.

**Tests:** added, in `run-announcement.test.ts`:
`'reads the failing command, its exit and the log path of a blocked-controls refusal'`,
`'reads a blocked-global refusal that could not measure its command with a null exit'`,
`'a failure with no log is read as nothing, not as an unreadable announcement'`,
`'reads what the judge vetoed when the plugin names it'`,
`'a refusal from a plugin too old to name the failure or the veto reads both as null'`.
Added, in `active-plans-route.test.ts`:
`'an uncertain plan projects what its closure vetoed and what failed'`. Removed on purpose: none.

**Verification:** The two test files pass, and the whole backend compiles and passes.

```bash
cd backend && npx vitest run __tests__/infrastructure/run-announcement.test.ts __tests__/infrastructure/active-plans-route.test.ts   # expected: exit 0
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run --maxWorkers=4   # expected: exit 0 — the whole backend suite
```

### Task 2 — the milestone progress shows a closure by a check

**Objective:** a slice line closed at `blocked-controls` or `blocked-global` carries its own attention with what failed.

**Files:** `backend/src/domain/value-objects/slice-line.ts` (modify),
`backend/src/application/queries/read-milestone-progress.ts` (modify),
`backend/src/application/actions/drive-run.ts` (modify),
`backend/__tests__/application/read-milestone-progress.test.ts` (modify),
`backend/__tests__/infrastructure/milestone-progress-route.test.ts` (modify).

Current state (backend/src/domain/value-objects/slice-line.ts, lines 14-15):

```ts
export type SliceAttention =
  | { readonly kind: 'veto', readonly task: number | null, readonly findings: string | null, readonly verdict: string | null }
```

Contract (backend/src/domain/value-objects/slice-line.ts):

```ts
  | { readonly kind: 'controls', readonly task: number | null, readonly outcome: string,
      readonly command: string | null, readonly code: number | null, readonly log: string | null }
  | { readonly kind: 'global', readonly outcome: string,
      readonly command: string | null, readonly code: number | null, readonly log: string | null }
// DriveRun gains: static readonly BLOCKED_CONTROLS = 'blocked-controls'
//                 static readonly BLOCKED_GLOBAL = 'blocked-global'
```

Current state (backend/src/application/queries/read-milestone-progress.ts, lines 225-228):

```ts
    const veto = ReadMilestoneProgress.#vetoOf(condition.refusal)
    const attention: SliceAttention = veto !== null
      ? { kind: 'veto', task: veto.task, findings: veto.findings, verdict: veto.verdict }
      : { kind: 'uncertain', action: condition.recovery.action, detail: condition.recovery.detail }
```

A new `static #closureAttention(refusal: RunClosure | null): SliceAttention | null` answers the
`veto`, `controls` or `global` attention by `refusal.state`, and `null` for any other state. The
`uncertain` attention stays the fallback. A closure with `failure: null` gives `command`,
`code` and `log` as `null`. `#vetoOf` stays as it is for `SliceTask.listOf`.

**TDD:** `it('a slice closed by its controls needs the person and carries the failing command and the log path')`
asserts `state: 'needs-person'` and `attention` equals `{ kind: 'controls', task: 2, outcome: 'failed', command: 'npm test', code: 1, log: '.agent/run-7/controls.log' }`.

**Tests:** added, in `read-milestone-progress.test.ts`:
`'a slice closed by its controls needs the person and carries the failing command and the log path'`,
`'a slice closed by its Global verification needs the person and carries the failing command and the log path'`,
`'a slice closed by a check from a plugin too old to name the failure carries nulls'`,
`'a closure outside the judge, the controls and the Global verification still reads as uncertain'`.
Added, in `milestone-progress-route.test.ts`:
`'a line closed by its controls answers the controls attention with the command and the log'`.
Removed on purpose: none.

**Verification:** The two test files pass, and the whole backend compiles and passes.

```bash
cd backend && npx vitest run __tests__/application/read-milestone-progress.test.ts __tests__/infrastructure/milestone-progress-route.test.ts   # expected: exit 0
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run --maxWorkers=4   # expected: exit 0 — the whole backend suite
```

### Task 3 — the closure line names what was vetoed and what failed

**Objective:** the closure line has one wording per state, and a veto line names the unit the plugin names.

**Files:** `backend/src/domain/ports/closure-announcements.ts` (modify),
`backend/src/infrastructure/session-closure-announcements.ts` (modify),
`backend/src/application/actions/drive-run.ts` (modify),
`backend/__tests__/infrastructure/session-closure-announcements.test.ts` (modify),
`backend/__tests__/application/drive-run.test.ts` (modify).

Current state (backend/src/domain/ports/closure-announcements.ts, lines 3-9):

```ts
export type AnnouncedClosure = {
  repository: RepositoryName,
  issue: number,
  task: number | null,
  findings: string | null,
  verdict: string | null,
}
```

Contract (backend/src/domain/ports/closure-announcements.ts):

```ts
// AnnouncedClosure adds: state: string, outcome: string,
//   vetoed: string | null, failure: RunFailure | null
// the <cause> of a check line, in session-closure-announcements.ts:
//   failed, a command:        went red: `<command>` exited <code>
//   failed, no command:       went red
//   indeterminate, a command: could not be measured: `<command>`
//   indeterminate, none:      could not be measured
// a state outside the three throws: a closure with no line to announce: "<state>"
```

`SessionClosureAnnouncements.lineFor` switches on `state`:

- `blocked-judge`: today's line, but its `which` is `vetoed` when that is not null.
- `blocked-controls`: `The controls of task <n> of <repo>#<issue> <cause> and the run is closed at blocked-controls.`
  With no task, `a task` replaces `task <n>`.
- `blocked-global`: `The Global verification of <repo>#<issue> <cause> and the run is closed at blocked-global.`
- A check line adds ` The log is at <log>.` when `failure` is not null. It ends with
  `Tell the person what failed, ask them what to change, and send THEIR words with POST /slices/<issue>/another-round {repo, agent, instruction}. The instruction is theirs: you do not invent it.`

`DriveRun.#announce` passes the four new fields from the closure, and still announces only a veto.

**TDD:** `it('names_what_the_judge_vetoed_when_the_plugin_says_it_instead_of_the_task_number')`
with `vetoed: 'the review of the slice'` and `task: 3` asserts the line contains
`The judge vetoed the review of the slice of owner/name#973` and not `task 3`.

**Tests:** added, in `session-closure-announcements.test.ts`:
`'names_what_the_judge_vetoed_when_the_plugin_says_it_instead_of_the_task_number'`,
`'a_run_closed_by_its_controls_names_the_task_the_failing_command_its_exit_and_the_log'`,
`'a_run_closed_by_its_global_verification_names_the_failing_command_its_exit_and_the_log'`,
`'an_unmeasured_check_says_it_could_not_be_measured_instead_of_red'`,
`'a_closure_by_a_check_names_the_call_that_grants_the_round_and_keeps_the_instruction_with_the_person'`,
`'a_closure_by_a_check_from_a_plugin_that_named_no_failure_still_names_the_slice_and_the_state'`.
In `drive-run.test.ts`: `'a veto announces what the plugin says the judge vetoed'`.
Removed on purpose: none.

**Verification:** Both files pass; the backend compiles and passes.

```bash
cd backend && npx vitest run __tests__/infrastructure/session-closure-announcements.test.ts __tests__/application/drive-run.test.ts   # expected: exit 0
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run --maxWorkers=4   # expected: exit 0 — the whole backend suite
```

### Task 4 — the drive announces a closure by a check

**Objective:** `DriveRun` tells the coordinating session when a run closes at `blocked-controls` or `blocked-global`.

**Files:** `backend/src/application/actions/drive-run.ts` (modify),
`backend/__tests__/application/drive-run.test.ts` (modify).

Current state (backend/src/application/actions/drive-run.ts, lines 118-118):

```ts
    if (closure.state !== DriveRun.BLOCKED_JUDGE || closure.outcome !== DriveRun.VETOED) return
```

Current state (backend/src/application/actions/drive-run.ts, lines 137-140):

```ts
  static #unheard(watch: PlanWatch, why: string): string {
    return `drive run: ${watch.repository.text}#${watch.issue.number} closed at ${DriveRun.BLOCKED_JUDGE} `
      + `and the closure was not announced: ${why}\n`
  }
```

A new `static #isAnnounced(closure: RunClosure): boolean` answers true for the judge's veto
(today's two conditions), and for `BLOCKED_CONTROLS` and `BLOCKED_GLOBAL` with any outcome.
`#unheard(watch, state, why)` names `closure.state` in place of `DriveRun.BLOCKED_JUDGE`.

Current state (backend/__tests__/application/drive-run.test.ts, lines 658-661):

```ts
  it('a refusal of any other state is not announced, because only the judge has a way out', async () => {
    const announcements = new AnnouncementsSpy()
    const driving = DriveRunMother.refusing({
      detail: 'run blocked-global: task 3/3, 0 discard(s)',
```

That test gets a new name and the state `blocked-slice-judge`.

**TDD:** `it('a closure by the controls that nobody was live to hear names blocked-controls on stderr')`
asserts `written` equals the one line
`drive run: <repo>#<n> closed at blocked-controls and the closure was not announced: no coordinating session was live to be told\n`.

**Tests:** added:
`'a run closed by its controls is announced with the failing command, and still stops the drive'`,
`'a run closed by its Global verification is announced with the failing command, and still stops the drive'`,
`'a closure by the controls that nobody was live to hear names blocked-controls on stderr'`,
`'a refusal of any other state is not announced, because only the judge, the controls and the Global verification have a way out'`.
Removed on purpose: `'a refusal of any other state is not announced, because only the judge has a way out'`.

**Verification:** The drive tests pass, and the whole backend compiles and passes.

```bash
cd backend && npx vitest run __tests__/application/drive-run.test.ts   # expected: exit 0
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run --maxWorkers=4   # expected: exit 0 — the whole backend suite
```

### Task 5 — the phase prompt names the closures by a check

**Objective:** the three phase prompts tell the coordinating session what to do with `blocked-controls` and `blocked-global`.

**Files:** `backend/src/domain/value-objects/phase-prompt.ts` (modify),
`backend/__tests__/application/phase-prompt.test.ts` (modify).

Contract (backend/src/domain/value-objects/phase-prompt.ts):

```ts
static readonly ANOTHER_ROUND_AFTER_A_FAILED_CHECK: string
// brainstorming, groom and implementation list it right after ANOTHER_ROUND_AFTER_A_VETO
```

The text says these things, each with the literal phrase in backticks:

- a run closes at `blocked-controls` when the controls of a task stay red or `could not be measured`;
- a run closes at `blocked-global` when the Global verification goes red or `could not be measured`;
- read `GET /active-plans` and tell the person `the failing command and the log`;
- ask the person what to change and send their words with `POST /slices/<issue>/another-round`
  and `{repo, agent, instruction}`;
- for `blocked-controls`, `the implementer of the same task` gets another round;
- for `blocked-global`, `a fix round after the last task` opens, and then `the Global verification runs again`;
- `you do not invent it`, and `do not retry it in a loop` when the call answers a refusal.

**TDD:** `it('names_both_closures_and_the_call_that_lifts_them')` asserts the constant contains
`blocked-controls`, `blocked-global` and `POST /slices/<issue>/another-round`.

**Tests:** added, in a new `describe('what the coordinating session is told about a check that closes a run')`:
`'reaches_the_coordinating_session_in_every_phase_because_a_red_check_lands_in_any'`,
`'names_both_closures_and_the_call_that_lifts_them'`,
`'says_what_a_round_does_for_each_closure'`,
`'keeps_the_instruction_with_the_person'`. Removed on purpose: none.

**Verification:** The prompt tests pass, and the whole backend compiles and passes.

```bash
cd backend && npx vitest run __tests__/application/phase-prompt.test.ts   # expected: exit 0
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run --maxWorkers=4   # expected: exit 0 — the whole backend suite
```

### Task 6 — another round lifts a closure by a check

**Objective:** `RunPlanAgents.anotherRound` grants a round for `blocked-controls` and `blocked-global` too, through `ct-step reopen`.

**Files:** `backend/src/infrastructure/run-plan-agents.ts` (modify),
`backend/__tests__/infrastructure/run-plan-agents.test.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify).

Current state (backend/src/infrastructure/run-plan-agents.ts, lines 249-252):

```ts
      if (inspection.fact.kind !== 'uncertain'
        || inspection.fact.closure === null
        || inspection.fact.closure.state !== RunPlanAgents.BLOCKED_JUDGE) {
        throw new AnotherRoundNotGranted(RunPlanAgents.#notBlockedJudgeDetail(watch.agent, inspection))
```

Contract (backend/src/infrastructure/run-plan-agents.ts):

```ts
static readonly REOPENABLE: readonly string[] = Object.freeze([
  RUN_STATES.BLOCKED_JUDGE, RUN_STATES.BLOCKED_CONTROLS, RUN_STATES.BLOCKED_GLOBAL,
])
// replaces BLOCKED_JUDGE; #notBlockedJudgeDetail becomes #notReopenableDetail and reads
// `conversation "<agent>" is <kind> rather than blocked-judge, blocked-controls or blocked-global (<closedAt>)`
```

Current state (backend/__tests__/infrastructure/run-plan-agents.test.ts, lines 1606-1608):

```ts
    expect((failure as Error).message).toBe(
      `conversation ${JSON.stringify(AgentMother.CONVERSATION)} is active rather than blocked-judge (no closure)`,
    )
```

That assertion, and the `uncertain` one at line 1631, take the new wording.

**TDD:** `it('a granted round lifts a run closed by its controls and puts a driver back on it')`
asserts `machine.anotherRoundAsked` equals one `{ watch, instruction }` and `agents.owns(watch)` is true.

**Tests:** added, in `run-plan-agents.test.ts`:
`'a granted round lifts a run closed by its controls and puts a driver back on it'`,
`'a granted round lifts a run closed by its Global verification and puts a driver back on it'`,
`'a run closed by the slice judge is refused before anything is journaled'`.
Added, in `ct-run-machine.test.ts`:
`'the grant of a run closed by its controls runs the same reopen verb as the successor of the last command'`.
Removed on purpose: none.

**Verification:** The two test files pass, and the whole backend compiles and passes.

```bash
cd backend && npx vitest run __tests__/infrastructure/run-plan-agents.test.ts __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run --maxWorkers=4   # expected: exit 0 — the whole backend suite
```

## 8. Global verification

The backend compiles and its whole suite passes once over the slice. The ratchet list of
tests that spawn a process stays as it is on `main`.

```bash
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run --maxWorkers=4   # expected: exit 0 — the whole backend suite
test -z "$(git diff origin/main -- backend/__tests__/infrastructure/fixtures/process-ratchet.ts)"   # expected: exit 0 — the ratchet list stays
test -z "$(git diff origin/main --name-only -- plugin frontend)"   # expected: exit 0 — plugin and frontend untouched
```

## 9. Assumptions

1. The brief of the coordinating session asks for no plan comment on the issue and no plan
   gate. So the plan goes on with no comment. Provenance: the brief.
2. `GET /active-plans` projects `vetoed` and `failure` too. The phase prompt sends the session
   there to learn what failed, so the read must carry it. Provenance: own call.
3. The attention kinds get the names `controls` and `global`, with flat fields. The page slice
   reads them with no nested object. Provenance: own call.
4. The `veto` attention keeps its fields. The page slice can ask for `vetoed` when it needs it.
   Provenance: own call, the issue asks for it only in the announcement.
5. `DriveRun` announces `blocked-controls` and `blocked-global` with any outcome. `ct-step
   reopen` lifts both outcomes, `failed` and `indeterminate`. Provenance: `RunClosure.reopen` in
   `plugin/scripts/run-closure.js`.
6. The grant does not read the outcome of a `blocked-judge` closure, as today. Provenance:
   D-5, the judge's behaviour stays.
