# #556 — the close: no backend test launches a process

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`ProcessRatchet.LISTED` in `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` still names ten files.

- Six files only import `ChildProcess` from `node:child_process` to build fake children:
  `claude-calls.test.ts`, `claude-run-calls.test.ts`, `headless-plan-agents.test.ts`,
  `headless-dispatch-dry-run.test.ts`, `recorded-plan-recovery.test.ts` and `run-plan-recovery.test.ts`.
  No case in them launches a real process.
- `git-workspace-real-process.test.ts` runs real `git` through `ToolRunner` and `SystemProcesses`. It has 5 cases.
- `yardstick-real-process.test.ts` runs `git ls-files`. It has 1 case.
- `makefile-local-env.test.ts` (4 cases) and `state-directory-real-process.test.ts` (1 case) run the real `make`.

`backend/vitest.config.ts` sets `testTimeout` and `hookTimeout` to `120_000`. The last two sections of
`backend/conventions/this-repository.md` name a fast subset and say the suite launches real processes.

This slice empties the list, removes it, and keeps the ratchet test as a prohibition. It also removes the
two timeouts and amends the convention.

### Desired end state

- `ProcessRatchet.LISTED`, `ProcessRatchet.unlisted` and `ProcessRatchet.stale` do not exist.
- `process-ratchet.test.ts` fails when any backend test file launches a process.
- No test file under `backend/__tests__/` imports `node:child_process`, `node-pty` or the border.
- `makefile-local-env.test.ts` and `state-directory-real-process.test.ts` do not exist, and the ledger records their 5 cases.
- `backend/vitest.config.ts` has no `testTimeout` and no `hookTimeout`.
- `this-repository.md` does not say the suite launches real processes, and names no fast subset.
- The ledger has one row for each deleted case, and the backend suite passes.

### Out of scope

- `plugin/` and `frontend/`: nothing under them changes.
- `backend/src/`: no module changes. So `backend/API.md` reports no change.
- A migration: this slice stores no new data, so no forward or rollback step exists.
- The coverage comparison. The owner of the milestone dropped it as a gate on 2026-09-24.
- `plugin/conventions/testing.md`. D-13 keeps it for the plugin milestone.
- The root `Makefile`: it stays as it is. Only its tests leave.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 · Motive | `the milestone exists to remove false reds, not to save time.` |
| D-2 · Scope | `the backend only; the plugin is a separate milestone, because it produced no false red in the measured window.` |
| D-3 · No exception | `no backend test launches any process, the git arrange included.` |
| D-4 · Proof of coverage | `a per-file line and branch baseline of backend/src measured with c8 over vitest run (children counted), which no file may drop below, plus a case-by-case ledger.` |
| D-5 · The comparison is a slice verification | `each slice re-measures with the same instrument; no permanent CI job.` |
| D-6 · One declared border | `every real spawn, execFile, node-pty.spawn, process.kill and /bin/ps read lives in one logic-free module, excluded from coverage with its reason, together with the main lines of ct-api.ts and of the headless worker.` |
| D-7 · Two ports | `ProcessRunner (run, launch detached, read output) and ProcessTable (group liveness, kill, list, PTY); the rules of this-repository.md:119-141 are tested with them doubled, and a restart is a new instance over the same state directory.` |
| D-8 · Git, gh and claude | `answered by a scripted conversation that answers by request and raises on an unscripted one, fed by real captures under backend/__tests__/captures/<tool>/ headed by command, tool version and date.` |
| D-9 · The plugin scripts | `their answers are produced by the plugin's pure renderers the backend already imports, never by a captured file.` |
| D-10 · The Makefile tests | `makefile-local-env.test.ts and state-directory-real-process.test.ts are deleted with no substitute and recorded as such in the ledger.` |
| D-11 · Ratchet from day one | `the first slice lands a test that fails on an unlisted spawning file and on a listed file that no longer spawns; the last slice empties the list and the test stays as a prohibition.` |
| D-12 · Order | `slices are ordered by the false reds measured in CI, the most first.` |
| D-13 · Conventions | `only backend/conventions/this-repository.md is amended; the amendment of plugin/conventions/testing.md waits for the plugin milestone.` |
| D-14 · Timeouts | `testTimeout and hookTimeout in backend/vitest.config.ts return to vitest's defaults at the close, since nothing left can wait on a child.` |
| Coverage is not a gate | `The acceptance criterion "no src file drops below its baseline" is dropped, and so is npm run coverage && npm run coverage:compare in the plan's global verification. The ledger rows and the ratchet stay.` (the milestone owner, 2026-09-24) |
| Test-only code | `Nothing goes into backend/src/ unless the real app uses it: doubles, scripted conversations, captures, mothers and helpers stay in __tests__/.` Reuse the border and the two ports; add no seam next to them |
| A fake child | each file keeps its own class name and behaviour, now `extends EventEmitter implements LaunchedProcess`; `kill()` returns `false`, `disconnect()` and `unref()` do nothing |
| The cleanup cases | they move into `git-workspace.test.ts` and keep their names; `UnlaunchedWorkspaceDouble` answers git |
| The yardstick census | its case goes; its substitute is the walk case of `yardstick.test.ts` |
| The prohibition | `ProcessRatchet` and its file keep their names; the list, `unlisted` and `stale` go |
| A ledger row of an `it.each` | one row for each expanded name, with `%s` replaced by its value |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `backend/__tests__/infrastructure/fixtures/in-process-workers.ts` holds `LaunchedWorker`, a fake child over `EventEmitter`.
`backend/__tests__/infrastructure/git-workspace.test.ts` holds `UnlaunchedWorkspaceDouble`, a git double with state.
`docs/superpowers/plans/2026-09-25-issue-555-pty-and-sessions-in-process.md` shows how a slice of this milestone writes ledger rows.

Rules to obey: `CLAUDE.md`, `docs/language.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/defects.md`,
`plugin/conventions/domain.md`, `plugin/conventions/simplicity.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/__tests__/infrastructure/claude-calls.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/claude-run-calls.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/headless-plan-agents.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/headless-dispatch-dry-run.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/recorded-plan-recovery.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/run-plan-recovery.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/git-workspace.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/git-workspace-real-process.test.ts` | delete | nobody | none |
| `backend/__tests__/yardstick-real-process.test.ts` | delete | nobody | none |
| `backend/__tests__/infrastructure/makefile-local-env.test.ts` | delete | nobody | none |
| `backend/__tests__/infrastructure/state-directory-real-process.test.ts` | delete | nobody | none |
| `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` | modify | `process-ratchet.test.ts` | Current state |
| `backend/__tests__/infrastructure/process-ratchet.test.ts` | modify | the backend suite | Current state |
| `backend/vitest.config.ts` | modify | vitest | prose (config) |
| `backend/conventions/this-repository.md` | modify | every task brief | Final text |
| `backend/__tests__/conventions-no-restatement.test.ts` | modify | the backend suite | Current state |
| `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` | modify | `ledger.test.ts` and the judges | prose (one row per case) |

## 5. Interfaces

Consumes: from slice #1, `ProcessRatchet.spawningUnder(tests: string): string[]`, the port `ProcessRunner`
and the type `LaunchedProcess`. From slice #7, the list `ProcessRatchet.LISTED` with ten entries, and the ledger.

Produces: nothing that a later slice consumes. `ProcessRatchet.spawningUnder` stays, and the prohibition test calls it.

## 6. Test strategy

Every task runs `npm run typecheck` and `npx vitest run` over the files it touches, from `backend/`.
`env -u CT_STATE_DIR` goes in front of every `npx vitest run`, as in the slices before this one.

Tasks 1 and 2 change no case. The cases already pass, so the ratchet test is their red: it fails
while the list names a file that no longer spawns. Task 3 keeps each case name and watches it pass
with the double.

Task 4 deletes cases, and its proof is the ledger test. Task 5 writes the prohibition
test first. Task 6 changes configuration only. Task 7 changes the text and its guard test first.

The slowest case that stays in process took 1443 ms on 2026-09-26, under the vitest default of 5000 ms.

## 7. Tasks

### Task 1 — three fake children leave node:child_process

**Objective:** `claude-calls.test.ts`, `claude-run-calls.test.ts` and `headless-plan-agents.test.ts` build their fake children without `node:child_process`.

**Files:** `backend/__tests__/infrastructure/claude-calls.test.ts` (modify),
`backend/__tests__/infrastructure/claude-run-calls.test.ts` (modify),
`backend/__tests__/infrastructure/headless-plan-agents.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify).

Current state (backend/__tests__/infrastructure/claude-calls.test.ts, lines 15-19):
```ts
class FakeChild extends ChildProcess {
  constructor(pid: number) {
    super()
    Object.defineProperty(this, 'pid', { value: pid })
  }
```

`FakeChild` becomes `extends EventEmitter implements LaunchedProcess` with `readonly pid: number`.
`AcceptedWorker` of `claude-run-calls.test.ts` and `AcceptedChild` of `headless-plan-agents.test.ts` change the same way.
Each class keeps its other methods, and gets `kill(): boolean` that returns `false`, `disconnect(): void {}` and `unref(): void {}`.
The import of `ChildProcess` goes. `EventEmitter` comes from `node:events`, and `LaunchedProcess` from `process-runner.ts`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 10-11):
```ts
    'infrastructure/claude-calls.test.ts',
    'infrastructure/claude-run-calls.test.ts',
```

Remove these two lines and the line `'infrastructure/headless-plan-agents.test.ts',`.

**TDD:** red first: remove the three list lines, and `the_backend_suite_launches_processes_in_exactly_the_listed_files` fails.
It finds the three files. It turns green when the three classes stop the import.

**Tests:** added: none. Removed on purpose: none.

**Verification:** The three files import no `node:child_process`, and their cases pass.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/claude-calls.test.ts __tests__/infrastructure/claude-run-calls.test.ts __tests__/infrastructure/headless-plan-agents.test.ts __tests__/infrastructure/process-ratchet.test.ts   # expected: exit 0
test -z "$(grep -l 'node:child_process' backend/__tests__/infrastructure/claude-calls.test.ts backend/__tests__/infrastructure/claude-run-calls.test.ts backend/__tests__/infrastructure/headless-plan-agents.test.ts)"   # expected: exit 0
```

### Task 2 — three more fake children leave node:child_process

**Objective:** `headless-dispatch-dry-run.test.ts`, `recorded-plan-recovery.test.ts` and `run-plan-recovery.test.ts` build their fake children without `node:child_process`.

**Files:** `backend/__tests__/infrastructure/headless-dispatch-dry-run.test.ts` (modify),
`backend/__tests__/infrastructure/recorded-plan-recovery.test.ts` (modify),
`backend/__tests__/infrastructure/run-plan-recovery.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify).

Current state (backend/__tests__/infrastructure/recorded-plan-recovery.test.ts, lines 60-60):
```ts
class AcceptedChild extends ChildProcess {}
```

This class, and `AcceptedWorker` of the other two files, become `extends EventEmitter implements LaunchedProcess`.
Each gets `kill(): boolean` that returns `false`, `disconnect(): void {}` and `unref(): void {}`. The import of `ChildProcess` goes.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 13-13):
```ts
    'infrastructure/headless-dispatch-dry-run.test.ts',
```

Remove this line, `'infrastructure/recorded-plan-recovery.test.ts',` and `'infrastructure/run-plan-recovery.test.ts',`.

**TDD:** red first: remove the three list lines, and `the_backend_suite_launches_processes_in_exactly_the_listed_files` fails.
It turns green when the three classes stop the import.

**Tests:** added: none. Removed on purpose: none.

**Verification:** The three files import no `node:child_process`, and their cases pass.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/headless-dispatch-dry-run.test.ts __tests__/infrastructure/recorded-plan-recovery.test.ts __tests__/infrastructure/run-plan-recovery.test.ts __tests__/infrastructure/process-ratchet.test.ts   # expected: exit 0
test -z "$(grep -l 'node:child_process' backend/__tests__/infrastructure/headless-dispatch-dry-run.test.ts backend/__tests__/infrastructure/recorded-plan-recovery.test.ts backend/__tests__/infrastructure/run-plan-recovery.test.ts)"   # expected: exit 0
```

### Task 3 — the cleanup cases run over the git double

**Objective:** The five cleanup cases run in `git-workspace.test.ts` over `UnlaunchedWorkspaceDouble`, and the real file leaves the tree.

**Files:** `backend/__tests__/infrastructure/git-workspace.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).
Delete `backend/__tests__/infrastructure/git-workspace-real-process.test.ts`.

Current state (backend/__tests__/infrastructure/git-workspace.test.ts, lines 1130-1131):
```ts
describe('GitWorkspace unused dispatch cleanup', () => {
  it('an untouched unlaunched workspace is rechecked and removed without force', async () => {
```

A new `describe('GitWorkspace cleanup retirement')` goes after this `describe`. It keeps the old arrange of
records, claims and issues under a `mkdtemp` state root, and removes that root in `afterEach`.
`UnlaunchedWorkspaceDouble.workspace()` replaces the real checkout.

`deleteFailure` plays the branch removal cut.
The double's `worktreePresent`, `branchPresent` and `calls` replace each `GitProcess.run` assertion.
The `baseSha` assertions use `UnlaunchedWorkspaceDouble.BASE`. If the flow asks git for a command the double
does not answer, add that answer to the double. `invalid checkout queries never prove absence` uses a `run` that
answers each command with code 128 and `fatal: cannot change to '<root>': No such file or directory`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 12-12):
```ts
    'infrastructure/git-workspace-real-process.test.ts',
```

Remove that line.

**TDD:** red first: the four rows of `'durable cleanup retries preserve evidence and finish retirement after %s'`,
with the old assertions. Then `'invalid checkout queries never prove absence'`, which still rejects with `checkout remote could not be read`.

**Tests:** added: those 5 cases. Removed on purpose: the 5 cases of the old file.

Append 5 ledger rows for `__tests__/infrastructure/git-workspace-real-process.test.ts`. Each maps to the case
of the same name in `__tests__/infrastructure/git-workspace.test.ts`. The four values of `%s` are
`full cleanup`, `branch removal`, `checked requeue` and `archive rename`.

**Verification:** The cases run over the double, and the ledger has 5 new rows.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/git-workspace.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/git-workspace-real-process.test.ts   # expected: exit 0
test "$(grep -c 'git-workspace-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 5   # expected: exit 0
```

### Task 4 — the census and the Makefile tests leave the tree

**Objective:** The yardstick census and the two Makefile tests leave the tree, and the ledger records their 6 cases.

**Files:** `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).
Delete `backend/__tests__/yardstick-real-process.test.ts`, `backend/__tests__/infrastructure/makefile-local-env.test.ts`
and `backend/__tests__/infrastructure/state-directory-real-process.test.ts`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 18-19):
```ts
    'infrastructure/state-directory-real-process.test.ts',
    'yardstick-real-process.test.ts',
```

Remove these two lines and the line `'infrastructure/makefile-local-env.test.ts',`.

**TDD:** No TDD — this task deletes cases and writes no new one.

**Tests:** added: none. Removed on purpose: the 6 cases named below.

Append 6 ledger rows. The case of `__tests__/yardstick-real-process.test.ts` is
`the_census_matches_what_git_sees_so_neither_a_new_file_nor_a_deleted_one_goes_unnoticed`. Its substitute is
`__tests__/yardstick.test.ts > the_guard_finds_its_subjects_by_walking_so_a_new_file_is_covered_without_anyone_listing_it`.
The four cases of `__tests__/infrastructure/makefile-local-env.test.ts` read `deleted without substitute — decided`:
`passes the harvest table from the local env file to the backend`, `starts with no local env file present`,
`lets the local env file override the default port` and `ignores .env and every .env.* file except .env.example in the real checkout`.
`__tests__/infrastructure/state-directory-real-process.test.ts > passes_the_local_env_value_to_child_processes_without_shell_splitting`
reads `deleted without substitute — decided` too.

**Verification:** The three files are gone, and the ledger has 6 new rows.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts __tests__/yardstick.test.ts   # expected: exit 0
test -z "$(ls backend/__tests__/yardstick-real-process.test.ts backend/__tests__/infrastructure/makefile-local-env.test.ts backend/__tests__/infrastructure/state-directory-real-process.test.ts 2>/dev/null)"   # expected: exit 0
test "$(grep -c 'makefile-local-env.test.ts > ' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 4   # expected: exit 0
```

### Task 5 — the ratchet becomes a prohibition

**Objective:** `process-ratchet.test.ts` fails on any backend test file that launches a process, and the list is gone.

**Files:** `backend/__tests__/infrastructure/process-ratchet.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).

Current state (backend/__tests__/infrastructure/process-ratchet.test.ts, lines 50-53):
```ts
describe('the ratchet over the test files that still launch a process', () => {
  it('the_backend_suite_launches_processes_in_exactly_the_listed_files', () => {
    expect(ProcessRatchet.spawningUnder(join(Tests.HERE, '..'))).toEqual(ProcessRatchet.LISTED)
  })
```

The `describe` becomes `'no backend test launches a process'`. Remove `LISTED`, `unlisted` and `stale` from
`ProcessRatchet`, and `TemporaryTree.withAListedEntryThatNoLongerSpawns`. `TemporaryTree.withAnUnlistedSpawn` becomes `withASpawningImport`.

**TDD:** red first: `it('the_backend_suite_launches_no_process')` expects `ProcessRatchet.spawningUnder(join(Tests.HERE, '..'))` to equal `[]`.
`it('a_test_file_that_imports_child_process_spawns')` expects `spawningUnder` over `withASpawningImport()` to equal `['unlisted.test.ts']`.

**Tests:** added: those 2 cases. Removed on purpose: `the_backend_suite_launches_processes_in_exactly_the_listed_files`,
`a_spawning_test_file_the_list_does_not_name_fails_the_ratchet` and `a_listed_file_that_no_longer_spawns_fails_the_ratchet`.

Append 3 ledger rows for `__tests__/infrastructure/process-ratchet.test.ts`. The first maps to
`the_backend_suite_launches_no_process`, and the second to `a_test_file_that_imports_child_process_spawns`, in the same file.
The third reads `deleted without substitute — decided`.

**Verification:** The list is gone, and the prohibition passes over the whole tree.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'LISTED' backend/__tests__/infrastructure/fixtures/process-ratchet.ts)" -eq 0   # expected: exit 0
test "$(grep -c 'process-ratchet.test.ts > ' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 3   # expected: exit 0
```

### Task 6 — the timeouts return to the vitest defaults

**Objective:** `backend/vitest.config.ts` declares no `testTimeout` and no `hookTimeout`.

**Files:** `backend/vitest.config.ts` (modify).

No code — configuration: `backend/vitest.config.ts` loses its whole `test` object, with `testTimeout: 120_000` and `hookTimeout: 120_000`.
The `resolve.alias` of `app` stays.

**TDD:** No TDD — a configuration change; the whole suite under the defaults is its proof.

**Tests:** added: none. Removed on purpose: none.

**Verification:** The two keys are gone, and the whole suite passes under the defaults of vitest.

```bash
test "$(grep -c 'Timeout' backend/vitest.config.ts)" -eq 0   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run   # expected: exit 0
```

### Task 7 — the convention says the suite launches no process

**Objective:** `this-repository.md` names no fast subset and says that no test launches a process.

**Files:** `backend/conventions/this-repository.md` (modify),
`backend/__tests__/conventions-no-restatement.test.ts` (modify).

Current state (backend/__tests__/conventions-no-restatement.test.ts, lines 26-28):
```ts
    "From `backend/`, never the repository root. The fast subset is `npx vitest run --exclude '**/*-real-process.test.ts'`",
    'never sow a label that is not ours',
    'killed in `afterEach`, not after the assertion',
```

The first entry becomes `'From `backend/`, never the repository root: `npx vitest run`.'` in double quotes.
The third becomes `'No test under `backend/__tests__/` launches a process'`.

The last two sections of `this-repository.md`, from `## Where the suite runs` to the end of the file, become this text.

Final text (backend/conventions/this-repository.md):
```md
## Where the suite runs

From `backend/`, never the repository root: `npx vitest run`. During a working session, run the files a change touches, and the whole suite before handing anything over.

## Testing: no test launches a process

No test under `backend/__tests__/` launches a process, the git arrange included. A test
reaches git, gh and claude through a double of `ProcessRunner` or `ProcessTable`.
`process-ratchet.test.ts` fails on a test file that imports `node:child_process`,
`node-pty` or `process-border.ts`, and on a file whose name carries `-real-process`.
```

**TDD:** red first: change the two entries, and `conventions-no-restatement.test.ts` fails. It turns green with the new text.

**Tests:** added: none. Removed on purpose: none.

**Verification:** The convention names no fast subset and no real process, and its guard passes.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/conventions-no-restatement.test.ts __tests__/agent-instructions-mirror.test.ts   # expected: exit 0
test "$(grep -c 'fast subset' backend/conventions/this-repository.md)" -eq 0   # expected: exit 0
test "$(grep -c 'launches real processes' backend/conventions/this-repository.md)" -eq 0   # expected: exit 0
```

## 8. Global verification

The whole backend suite runs once under the vitest defaults. No test file launches a process.
The ledger names every deleted case.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run   # expected: exit 0 — the whole backend suite
test -z "$(grep -rl 'node:child_process' backend/__tests__)"   # expected: exit 0 — no test imports child_process
test -z "$(find backend/__tests__ -name '*-real-process.test.ts')"   # expected: exit 0 — no real process file is left
test "$(grep -c 'real-process.test.ts > ' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 104   # expected: exit 0 — 97 earlier rows and 7 new rows
```

## 9. Assumptions

1. The six files of Tasks 1 and 2 launch no real process. The ratchet lists them only because they import
   `node:child_process` for a base class. So they change their base class and lose no case. Provenance: repo.
2. `UnlaunchedWorkspaceDouble` already answers the git commands of the cleanup flow. Task 3 reuses it and
   adds an answer only where the flow needs one. Provenance: own call, after D-8 and the rule on test-only code.
3. The census of `yardstick-real-process.test.ts` compares the walk of `Yardstick` with `git ls-files`. D-3
   forbids the git call, and the walk case of `yardstick.test.ts` proves that the walk finds a new file. Provenance: own call.
4. The ratchet test cases this slice deletes get ledger rows, because the ledger names each deleted case. Provenance: own call, after the milestone context.
5. The ledger held 97 rows that name a `-real-process.test.ts` file. Tasks 3 and 4 add 7 more such rows.
   So §8 counts 104. The rows of `makefile-local-env.test.ts` and `process-ratchet.test.ts` name no such file. Provenance: repo, the ledger.
6. The whole suite passed on 2026-09-26 with 3390 cases. Its slowest case in process took 1443 ms, so the
   default of 5000 ms holds. Provenance: measured, `npx vitest run --reporter=json`.
