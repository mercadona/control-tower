# #554 — the tool runner and the Claude calls run in process

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

Four files of `ProcessRatchet.LISTED` belong to this slice. Each one launches real processes.

- `backend/__tests__/infrastructure/tool-runner-real-process.test.ts` has 12 cases. It runs `node -e` through `ToolRunner.run` over `SystemProcesses`.
- `backend/__tests__/infrastructure/tool-runner-whole-output-real-process.test.ts` has 2 cases. It runs a node script through `ToolRunner.run` and `ToolRunner.runWholeOutput`.
- `backend/__tests__/infrastructure/claude-calls-real-process.test.ts` has 4 cases. It spawns `headless-call-worker.ts` detached, over the child `fixtures/headless-child.ts`.
- `backend/__tests__/infrastructure/claude-conversations-real-process.test.ts` has 1 case. It runs the opening command of `ClaudeConversations` in `/bin/sh`.

`ToolRunner` in `backend/src/infrastructure/tool-runner.ts` takes a `ProcessRunner`. So the
`ScriptedConversation` of slice #1 can answer it. `ClaudeCalls` takes a `spawn`, and
`InProcessWorkers` runs the real `HeadlessCallWorker` in process over a `ScriptedClaude`.
`backend/__tests__/infrastructure/in-process-workers.test.ts` already does that for one case.

This slice moves each case in process, or records it in the ledger as deleted. It also proves
that each adapter that reads the output of a tool keeps a refusal apart from an unreadable output.

### Desired end state

- `ProcessRatchet.LISTED` does not name the four files, and the four files do not exist.
- `backend/__tests__/infrastructure/tool-runner.test.ts` exists, and the ratchet test finds no process in it.
- A refusal capture and an unreadable capture come back apart through `ToolRunner`, and through `ClaudeCalls` and its worker.
- The ledger has one row for each of the 19 cases of the four files.
- The ratchet test, the ledger test, `npm run typecheck` and the backend suite pass.

### Out of scope

- `plugin/` and `frontend/`: nothing under them changes.
- `backend/src/`: no module changes. So `backend/API.md` reports no change.
- A migration: this slice stores no new data, so no forward or rollback step exists.
- The coverage comparison. The owner of the milestone dropped it as a gate on 2026-09-24.
- `backend/__tests__/infrastructure/claude-calls.test.ts`. It stays on the list for slice #8.
- `testTimeout` and `hookTimeout` in `backend/vitest.config.ts`. D-14 gives them to the last slice.

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
| Where captures live | `backend/__tests__/infrastructure/captures/<tool>/`, the directory that `Capture.read` reads |
| The two new captures | `claude/result-text` and `claude/result-turn-limit`, each from one real run of the command in its header |
| An answer that is not a capture | only a failure that node builds and no tool prints: a killed child, a missing binary. `AnsweredRunner` in `tool-runner.test.ts` gives it |
| A test name that stays | a substitute keeps the old name unless the old name names what only a real process shows; §7 names each rename |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `backend/__tests__/infrastructure/in-process-workers.test.ts` builds `ClaudeCalls`
over `InProcessWorkers` and `ScriptedClaude` in a temporary root. `backend/__tests__/infrastructure/ct-api.test.ts`
answers tools with `ScriptedConversation` and `Capture.read`. `backend/__tests__/infrastructure/fixtures/scripted-conversation.ts`
holds `ScriptedConversation`, `ScriptedProcess`, `Capture` and `UnscriptedRequest`.
`backend/__tests__/infrastructure/captures/claude/result-success.txt` shows the header of a capture.

Rules to obey: `CLAUDE.md`, `docs/language.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/defects.md`,
`plugin/conventions/domain.md`, `plugin/conventions/simplicity.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/__tests__/infrastructure/tool-runner.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/in-process-workers.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/fixtures/scripted-claude.ts` | modify | `in-process-workers.test.ts`, `in-process-run.ts` | Current state |
| `backend/__tests__/infrastructure/captures/claude/result-text.txt` | create | tasks 1 and 3 | prose (a capture) |
| `backend/__tests__/infrastructure/captures/claude/result-turn-limit.txt` | create | task 3 | prose (a capture) |
| `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` | modify | `process-ratchet.test.ts` | Current state |
| `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` | modify | `ledger.test.ts` and the judges | prose (one row per case) |
| the four old test files | delete | nobody | none |

## 5. Interfaces

Consumes: from slice #1, `ScriptedConversation` with `answering(request, capture)` and `asked`,
`ScriptedProcess`, `UnscriptedRequest` and `Capture.read(tool, name)`, and the port `ProcessRunner`.
From slice #2, `InProcessWorkers` with `launch`, `settled()` and `launches`, and `ScriptedClaude` with `asked`.

Produces: for slices #7 and #8, the captures `claude/result-text` and `claude/result-turn-limit`.
`ScriptedClaude` plays a capture whose stdout is no JSON object unchanged.

## 6. Test strategy

Every task runs `npm run typecheck` and `npx vitest run` over the files it touches, from
`backend/`. `env -u CT_STATE_DIR` goes in front of every `npx vitest run`, because a
`CT_STATE_DIR` of the shell leaks into the remaining real process tests.

Each task writes its test first and watches it fail. `process-ratchet.test.ts` then proves that
the new cases launch nothing, and that the list lost the old file. `ledger.test.ts` proves the
format of each new row. No new case declares a per-test timeout, because nothing waits on a child.

A capture comes from one real run of the command it names. Its header carries that command, the
version line of the tool, the date and the exit code, in the format of `Capture.parse`.

## 7. Tasks

### Task 1 — ToolRunner.run answers from a scripted conversation

**Objective:** `tool-runner.test.ts` proves each rule of `ToolRunner.run` in process, and the old file leaves the tree.

**Files:** `backend/__tests__/infrastructure/tool-runner.test.ts` (create),
`backend/__tests__/infrastructure/captures/claude/result-text.txt` (create),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).
Delete `backend/__tests__/infrastructure/tool-runner-real-process.test.ts`.

The test file declares `class AnsweredRunner extends ProcessRunner`, with `constructor(outcome: RunOutcome)`
and `asked: { binary, argv, options: RunAndWaitOptions }[]`. Its `runAndWait` records the request and
gives its `outcome`. Its `launch` throws `UnscriptedRequest`. The capture cases use `ScriptedConversation` with the bin `gh`.

The capture `claude/result-text` comes from `claude -p --output-format text 'Answer with the single word ok.'`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 24-24):
```ts
    'infrastructure/tool-runner-real-process.test.ts',
```

Remove that line.

**TDD:** `it('a_refusal_and_an_answer_nobody_can_parse_come_back_apart')` answers `gh/issue-view-missing`
and then `claude/result-text`. The first gives `failed` true, code 1 and the stderr of the capture.
The second gives `failed` false and the stdout of the capture byte for byte.

**Tests:** added: that case, and the 11 substitutes of the ledger rows below. Removed on purpose: the 12 cases of the old file.

Append 12 ledger rows for `__tests__/infrastructure/tool-runner-real-process.test.ts`. Seven cases keep their names:
`what_the_tool_prints_comes_back_with_the_code_that_says_it_went_well`,
`timeout exits keep a diagnostic even when the child exits numerically`,
`a_tool_that_refuses_is_a_code_and_a_reason_and_not_something_thrown_at_the_caller`,
`a normal nonzero exit preserves an actually empty stderr channel`,
`what_the_tool_printed_before_refusing_is_kept_because_the_adapter_may_have_to_read_it`,
`a_tool_that_is_not_installed_is_a_refusal_with_a_reason_and_not_an_empty_channel` and
`a_call_that_names_no_directory_still_runs_where_the_api_was_started`.

Four cases get a new name. The budget case becomes `a_tool_that_outlives_its_budget_comes_back_failed_with_a_reason`.
It asserts `timeoutMs` equal to the budget. The cwd case becomes `the_directory_the_caller_names_is_the_one_the_runner_asks_for`.
The first env case becomes `the_environment_the_caller_composed_is_the_one_the_runner_hands_over`.
The last env case becomes `a_runner_that_names_no_environment_hands_over_none_so_the_tool_inherits_the_api_one`.

`runner teardown stops a live child independently of its timeout` reads `deleted without substitute — decided`.

**Verification:** The runner answers in process, and the ledger has 12 new rows.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/tool-runner.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/tool-runner-real-process.test.ts   # expected: exit 0
test "$(grep -c 'tool-runner-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 12   # expected: exit 0
```

### Task 2 — ToolRunner.runWholeOutput answers from a scripted conversation

**Objective:** `tool-runner.test.ts` proves that `runWholeOutput` keeps every byte, the code and the stderr, and the old file leaves the tree.

**Files:** `backend/__tests__/infrastructure/tool-runner.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).
Delete `backend/__tests__/infrastructure/tool-runner-whole-output-real-process.test.ts`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 25-25):
```ts
    'infrastructure/tool-runner-whole-output-real-process.test.ts',
```

Remove that line. `ScriptedConversation.launch` answers the call, and `ScriptedProcess` writes
the stdout of the capture to the descriptor that `runWholeOutput` gives it.

**TDD:** `it('keeps every byte when its output is collected whole, and still tells its exit code and its stderr')`
answers `gh/graphql-open-issues-repo-pulse` and expects the stdout of the capture, byte for byte, with code 0.
It then answers `gh/issue-view-missing`, and expects code 1 and the stderr of the capture.

**Tests:** added: that case. Removed on purpose: the 2 cases of the old file.

Append 2 ledger rows for `__tests__/infrastructure/tool-runner-whole-output-real-process.test.ts`.
The case `keeps every byte when its output is collected whole, and still tells its exit code and its stderr`
maps to the case of the same name in `__tests__/infrastructure/tool-runner.test.ts`.
`loses everything past the pipe buffer when its output is read through a pipe` reads `deleted without substitute — decided`.

**Verification:** The whole output answers in process, and the ledger has 2 new rows.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/tool-runner.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/tool-runner-whole-output-real-process.test.ts   # expected: exit 0
test "$(grep -c 'tool-runner-whole-output-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 2   # expected: exit 0
```

### Task 3 — a Claude call tells a refusal from an unreadable output in process

**Objective:** `in-process-workers.test.ts` proves that a call over a refusal and a call over an unreadable output complete apart.

**Files:** `backend/__tests__/infrastructure/in-process-workers.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/scripted-claude.ts` (modify),
`backend/__tests__/infrastructure/captures/claude/result-turn-limit.txt` (create).

Current state (backend/__tests__/infrastructure/fixtures/scripted-claude.ts, lines 55-57):
```ts
  #played(request: ClaudeRequest): Capture {
    const result = JSON.parse(this.#capture.stdout) as Record<string, unknown>
    result.session_id = request.conversation
```

When the stdout of the capture is no JSON object, `#played` gives the capture unchanged.
Otherwise it keeps its current body.

The capture `claude/result-turn-limit` comes from
`claude -p --output-format json --max-turns 1 'Run the shell command date with your Bash tool and tell me its output.'`.
Its exit is 1, and its result carries `error_max_turns` and `is_error` true.

**TDD:** `it('a claude that refuses and a claude whose output nobody can read complete apart')` runs one
call over `claude/result-turn-limit` and one over `claude/result-text`. The first completion has the
execution `{ kind: 'error', diagnostic: 'Claude reported error_max_turns' }` and code 1. The second
has `{ kind: 'unavailable', diagnostic: 'Claude stream ended with malformed JSON' }` and code 0.

**Tests:** added: that case. Removed on purpose: none.

**Verification:** Both outcomes come back apart in process.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/in-process-workers.test.ts __tests__/infrastructure/process-ratchet.test.ts   # expected: exit 0
```

### Task 4 — the Claude call cases run over the in-process worker

**Objective:** `in-process-workers.test.ts` proves three cases of a call in process, and the old file leaves the tree.

**Files:** `backend/__tests__/infrastructure/in-process-workers.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).
Delete `backend/__tests__/infrastructure/claude-calls-real-process.test.ts`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 10-10):
```ts
    'infrastructure/claude-calls-real-process.test.ts',
```

Remove that line. For the spawn failure, a `ScriptedClaude` subclass in the test file throws
`Object.assign(new Error('spawn /nonexistent-claude ENOENT'), { code: 'ENOENT' })` from `launch`.
The case also writes the `dispatch.json` of the old `failedDescriptor`.

**TDD:** `it('output and completion reach the call record the worker publishes')` expects
`succeeded` true and `signal` null. `stream.ndjson` contains `"subtype":"success"`, and
`stderr.log` holds the stderr of `claude/result-success`. It keeps the old measurement assertions.

**Tests:** added: that case,
`'a started call tells the child the concrete path of its prompt file instead of a shell variable'` and
`'a claude that cannot be spawned publishes a consumable child-spawn failure'`. The second reads the
argv from `claude.asked`. The third keeps the old assertions for one identity. Removed on purpose: the 4 cases of the old file.

Append 4 ledger rows for `__tests__/infrastructure/claude-calls-real-process.test.ts`.
`output and completion survive API exit` maps to the first case. The prompt case keeps its name.
`worker entrypoint publishes consumable child-spawn failure` maps to the third case.
`the surviving deadline terminates the child process group` maps to
`__tests__/infrastructure/claude-calls.test.ts > a leader closing while the deadline terminates its group still waits for the escalation`.

**Verification:** The call cases run in process, and the ledger has 4 new rows.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/in-process-workers.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/claude-calls-real-process.test.ts   # expected: exit 0
test "$(grep -c 'claude-calls-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 4   # expected: exit 0
```

### Task 5 — the opening command of a conversation leaves the shell

**Objective:** The real shell case of `ClaudeConversations` leaves the tree, and its ledger row names its substitute.

**Files:** `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).
Delete `backend/__tests__/infrastructure/claude-conversations-real-process.test.ts`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 12-12):
```ts
    'infrastructure/claude-conversations-real-process.test.ts',
```

Remove that line. The command names each path by its variable, so no path reaches the shell as text.
`claude-conversations.test.ts` already asserts that command, and a plugin root with a space and a single quote.

**TDD:** No TDD — the substitute case exists and stays as it is.

**Tests:** added: none. Removed on purpose:
`sends the opening sentence and the plugin root to claude as one argument each when both paths carry spaces and a single quote`.

Append 1 ledger row for `__tests__/infrastructure/claude-conversations-real-process.test.ts`. It maps to
`__tests__/infrastructure/claude-conversations.test.ts > leaves the plugin root in the environment and never in the command`.

**Verification:** The old file is gone, and the ledger has its row.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/claude-conversations.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/claude-conversations-real-process.test.ts   # expected: exit 0
test "$(grep -c 'claude-conversations-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 1   # expected: exit 0
```

## 8. Global verification

The whole backend suite runs once with the new cases in it. The four files are off the list.
The ledger names all 19 of their cases.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run   # expected: exit 0 — the whole backend suite
test -z "$(grep -l 'tool-runner-real-process\|tool-runner-whole-output-real-process\|claude-calls-real-process\|claude-conversations-real-process' backend/__tests__/infrastructure/fixtures/process-ratchet.ts)"   # expected: exit 0 — the four files are off the list
test "$(grep -c 'real-process.test.ts > ' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 82   # expected: exit 0 — 63 earlier rows and 19 new rows
```

## 9. Assumptions

1. The coverage criterion stays in the issue, but the owner dropped it. So no task measures
   coverage. Provenance: issue, "Contexto heredado".
2. "Each adapter" means each adapter of this slice that reads the output of a tool: `ToolRunner`,
   and `ClaudeCalls` with its worker. `ClaudeConversations` hands a terminal to a person and reads
   no output of `claude`. Provenance: own call.
3. A killed child and a missing binary are failures that node builds, not answers that a tool
   prints. No capture can hold them, so `AnsweredRunner` gives their shape, the one that
   `SystemProcesses.runAndWait` builds. Provenance: own call, after D-8.
4. Three cases prove only what the operating system does. They are the teardown of a live child,
   the loss past a pipe buffer, and a group that survives the exit of the API. The first two go
   without a substitute. Of the third, the record part stays, in Task 4. Provenance: own call, after D-3.
5. The deadline case maps to a case of `claude-calls.test.ts`, which doubles the child and the
   clock. That file stays on the list for slice #8 by a type import, but it launches nothing.
   Provenance: repo, and the spec, A-2.
6. The prompt case loses its assertion on the prompt variable of the child. The worker hands the
   child its own environment, and `ScriptedClaude` does not read it. Provenance: own call.
7. The ledger held 63 rows before this slice, and each names a `-real-process.test.ts` file. §8
   counts 82 rows for that reason. Provenance: repo, the ledger.
