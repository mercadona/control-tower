# #549 — the declared border, the two ports, the baseline, the ledger and the ratchet

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow this plan
> and `AGENTS.md`.

## 1. Context and goal

Today six modules of `backend/src/infrastructure/` reach the operating system directly.
`tool-runner.ts` imports `execFile` and `spawn` from `node:child_process`, and it calls
`process.kill` on a group. `headless-call-worker.ts` imports `spawn` and calls `process.kill` in
its `main`. `claude-calls.ts` names `import('node:child_process')` in two types.

`pty-live-sessions.ts` runs `/bin/ps` through `execFile`. `ct-api.ts` imports `spawn` from both
`node:child_process` and `node-pty`, and it passes `process.kill` on. `checked-run-delivery.ts`
asks `process.kill(pid, 0)` in its static `#alive`.

This slice is the first of the milestone *The backend suite launches no process*. It moves every
real call into one module with no logic, `process-border.ts`, behind two ports. It adds the
scripted conversation that later slices use in place of `git`, `gh` and `claude`. It adds the
instrument that measures coverage with the children counted, and it commits the baseline.

It also adds the ledger of deleted test cases, and the ratchet over the test files that still
launch a process. No test migrates here: the later slices do that.

### Desired end state

- `backend/src/infrastructure/process-border.ts` is the only module under `backend/src` that
  imports `node:child_process` or `node-pty`.
- The ratchet test fails on a spawning test file that its list does not name, and on a listed
  file that no longer spawns.
- `backend/coverage-baseline.json` holds covered and total lines and branches for every file of
  `backend/src` but the border. `c8` over `vitest run` measured it, with the children counted.
- `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` exists with its format, and
  a test reads every row of it.
- The whole backend suite and `npm run typecheck` stay green.

### Out of scope

- `plugin/` and `frontend/`: nothing under them changes.
- The migration of any test file off the ratchet list. Slices 2 to 8 do that.
- `testTimeout` and `hookTimeout` in `backend/vitest.config.ts`. The last slice restores the
  defaults.
- The sentence *"This suite launches real processes by design"* and the fast subset line of
  `backend/conventions/this-repository.md`. The last slice changes them.
- A permanent coverage job in CI. The comparison is a verification of each slice.
- `backend/API.md`: no endpoint changes, so the API reports no change.

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
| The border | `backend/src/infrastructure/process-border.ts`, class `SystemProcesses`, which extends `ProcessRunner` and implements `ProcessTable` |
| The ports | `backend/src/infrastructure/process-runner.ts` and `backend/src/infrastructure/process-table.ts`, base classes whose methods throw `must implement`, the shape of `domain/ports/tool-sessions.ts` |
| Where the ports sit | `infrastructure/`: `plugin/conventions/architecture.md` gives the subprocess to infrastructure alone, and every consumer of the two ports is an adapter |
| The injection | `ToolRunner` takes `processes: ProcessRunner` and `signal: ProcessTable['signal']`; `CheckedRunDelivery` takes `signal`; the three modules that inject today keep their field names and take the port member type |
| The coverage exclusion | the table `CoverageBaseline.EXCLUDED`, one `reason` per entry: the yardstick forbids every comment, so it forbids `c8 ignore` too |
| The instrument | `npm run coverage` in `backend/`, then `npm run coverage:baseline` once, then `npm run coverage:compare` in every later slice |
| The ledger | `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md`, a table `Deleted case` → `Substitute` |
| The ratchet list | `ProcessRatchet.LISTED` in `backend/__tests__/process-ratchet.ts` |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `backend/__tests__/spawned-children.ts` and
`backend/__tests__/spawned-children.test.ts` are the census shape. They hold a table with a
reason per entry, a walk over the tree, and a second `describe` that proves the guard fires.
`backend/__tests__/typescript-only.test.ts` builds a temporary tree to prove a census walks.
`backend/src/domain/ports/tool-sessions.ts` is the shape of a port. The `GitDouble` of
`backend/__tests__/infrastructure/git-workspace.test.ts` raises `nobody wrote an answer for git`
on an unscripted request. `backend/__tests__/yardstick.test.ts` measures every file this slice
adds.

Rules to obey: `.agent/conventions.md`, `CLAUDE.md`, `docs/language.md`, `docs/glossary.md`,
`backend/conventions/this-repository.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/boundaries.md`, `plugin/conventions/decisions.md`,
`plugin/conventions/defects.md`, `plugin/conventions/domain.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/style.md`,
`plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/infrastructure/process-runner.ts` | create | `tool-runner.ts`, `claude-calls.ts`, `headless-call-worker.ts` | Contract |
| `backend/src/infrastructure/process-table.ts` | create | `tool-runner.ts`, `checked-run-delivery.ts`, `pty-live-sessions.ts` | Contract |
| `backend/src/infrastructure/process-border.ts` | create | `ct-api.ts`, `headless-call-worker.ts` | none (prose) |
| `backend/src/infrastructure/tool-runner.ts` | modify | every adapter over a tool | none (prose) |
| `backend/src/infrastructure/checked-run-delivery.ts` | modify | `ct-api.ts` | Current state |
| `backend/src/infrastructure/pty-live-sessions.ts` | modify | `ct-api.ts` | Call site |
| `backend/src/infrastructure/headless-call-worker.ts` | modify | its own `main` | Current state |
| `backend/src/infrastructure/claude-calls.ts` | modify | `ct-api.ts` | none (prose) |
| `backend/src/infrastructure/ct-api.ts` | modify | the running API | Current state |
| `backend/__tests__/spawned-children.ts` | modify | `spawned-children.test.ts` | none (prose) |
| `backend/__tests__/spawned-children.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/scripted-conversation.ts` | create | slices 2 to 8 | Contract |
| `backend/__tests__/scripted-conversation.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/captures/git/rev-parse-head.txt` | create | `scripted-conversation.test.ts` | Final text |
| `backend/__tests__/captures/git/rev-parse-outside-a-repository.txt` | create | `scripted-conversation.test.ts` | prose (a capture) |
| `backend/__tests__/process-ratchet.ts` | create | `process-ratchet.test.ts` | Contract |
| `backend/__tests__/process-ratchet.test.ts` | create | the backend suite | none (body by TDD) |
| `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` | create | the judges of slices 2 to 8 | Final text |
| `backend/__tests__/ledger.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/coverage-baseline.ts` | create | the `package.json` scripts | Contract |
| `backend/__tests__/coverage-baseline.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/coverage-flush.ts` | create | `coverage.config.ts` | prose (config) |
| `backend/__tests__/coverage.config.ts` | create | `npm run coverage` | prose (config) |
| `backend/package.json`, `backend/package-lock.json` | modify | `npm run coverage` | prose (config) |
| `backend/coverage-baseline.json` | create | `npm run coverage:compare` | none (generated) |
| `backend/conventions/this-repository.md` | modify | every later slice | Current state / Final text |
| the tests and fixtures that build `ToolRunner`, `CheckedRunDelivery`, `PtyLiveSessions`, `ClaudeCalls` or `HeadlessCallWorker` | modify | the backend suite | none (prose) |

## 5. Interfaces

Consumes: N/A — this slice is the first of its milestone and depends on no other.

Produces:
`ProcessRunner.runAndWait(binary: string, argv: readonly string[], options: RunAndWaitOptions): Promise<RunOutcome>`.
`ProcessRunner.launch(binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess`.
`ProcessTable.signal(pid: number, signal: NodeJS.Signals | 0): void`.
`ProcessTable.readTable(read: TableRead): Promise<string>`.
`ProcessTable.openTerminal(file: string, argv: string[], options: TerminalOptions): Terminal`.
`SystemProcesses` from `process-border.ts`, the one real instance of both ports.

`ScriptedConversation`, `ScriptedRequest`, `UnscriptedRequest` and `Capture` from
`backend/__tests__/scripted-conversation.ts`.
`ProcessRatchet.LISTED` from `backend/__tests__/process-ratchet.ts`.
`CoverageBaseline.EXCLUDED`, and the scripts `coverage`, `coverage:baseline` and
`coverage:compare` of `backend/package.json`.

## 6. Test strategy

Every task runs `npm run typecheck` and `npx vitest run` over the files it touches, from
`backend/`. `env -u CT_STATE_DIR` goes in front of every `npx vitest run`. A `CT_STATE_DIR` of the
shell leaks into the real process tests: with it set, four cases of
`run-driver-runtime-real-process.test.ts` read a foreign harness and fail.

Tasks 1 to 3 move calls and keep the behaviour. The real process tests of today are their safety
net, and each of those tasks runs the ones it touches. The new census assertions of
`spawned-children.test.ts` are the red first.

Tasks 4 to 7 add test infrastructure, each with its own test file. Every census proves that it
fires over a temporary tree or a literal source, the way `typescript-only.test.ts` does.

No test measures the border itself. It has no logic, and the real process tests reach it. The
coverage table leaves it out with that reason.

## 7. Tasks

### Task 1 — the process runner port, the border, and the tool runner behind it

**Objective:** `ToolRunner` starts every process through `ProcessRunner`, which `SystemProcesses`
implements.

**Files:** `backend/src/infrastructure/process-runner.ts` (create),
`backend/src/infrastructure/process-border.ts` (create).
Also `backend/src/infrastructure/tool-runner.ts` and `backend/src/infrastructure/ct-api.ts`
(modify). Also `backend/__tests__/spawned-children.ts` and its test (modify).
Also every test or fixture that builds a `ToolRunner` (modify).

Contract (backend/src/infrastructure/process-runner.ts):

```ts
export type RunAndWaitOptions = { readonly cwd?: string, readonly env?: NodeJS.ProcessEnv, readonly timeoutMs: number }
export type RunFailure = {
  readonly code?: number | string | null, readonly killed?: boolean,
  readonly signal?: NodeJS.Signals | null, readonly message: string,
}
export type RunOutcome = { readonly failure: RunFailure | null, readonly stdout: string, readonly stderr: string }
export type LaunchOptions = {
  readonly cwd?: string, readonly env?: NodeJS.ProcessEnv, readonly timeout?: number,
  readonly detached?: boolean, readonly stdio: readonly ('ignore' | 'pipe' | 'ipc' | number)[],
}
export class ProcessRunner {
  runAndWait(binary: string, argv: readonly string[], options: RunAndWaitOptions): Promise<RunOutcome>
  launch(binary: string, argv: readonly string[], options: LaunchOptions): LaunchedProcess
}
```

`LaunchedProcess` is a structural type in the same file. It declares only the members that
`tool-runner.ts`, `claude-calls.ts` and `headless-call-worker.ts` read today, so a `ChildProcess`
fits it. `SystemProcesses` calls `execFile` and `spawn` of `node:child_process`, and nothing
else. Its methods never read `this`, so a consumer can take one as a detached function.

`ToolRunner` takes `processes: ProcessRunner` and keeps `#codeOf`, its stderr rule and
`#spawned`, now over `runAndWait` and `launch`. `ct-api.ts` builds one `SystemProcesses` and
gives it to every `ToolRunner`.

`SpawnedChildren.SPAWNING` also finds `launch`, `runAndWait` and `openTerminal`. `ACCOUNTED`
gains the border, with the reason `the border starts what a caller asks, and the caller's entry
says what happens to that child`. It gains `process-runner.ts`, with the reason
`this module declares the verb and starts nothing`. The row of `tool-runner.ts` lists its new
calls.

**TDD:** `it('a_call_through_a_process_port_is_a_site_of_its_own')` expects
`sitesIn("this.processes.launch('git', [])\n", 'x.ts')` to answer the call `launch`. The census
over the real tree stays green.

**Tests:** added: `'a_call_through_a_process_port_is_a_site_of_its_own'`. Removed on purpose:
none.

**Verification:** The census and the real runner tests pass through the border.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the graph is sound
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/spawned-children.test.ts __tests__/infrastructure/tool-runner-real-process.test.ts __tests__/infrastructure/tool-runner-whole-output-real-process.test.ts   # expected: exit 0
test -z "$(grep -l 'node:child_process' backend/src/infrastructure/tool-runner.ts)"   # expected: exit 0 — the tool runner imports it no more
```

### Task 2 — the process table port, and every kill, liveness read and terminal behind it

**Objective:** Every `process.kill`, the `/bin/ps` read and the PTY go through `ProcessTable`.

**Files:** `backend/src/infrastructure/process-table.ts` (create).
Also `process-border.ts`, `tool-runner.ts`, `checked-run-delivery.ts`, `pty-live-sessions.ts`
and `ct-api.ts`, all under `backend/src/infrastructure/` (modify).
Also `backend/__tests__/spawned-children.ts` and the tests that build these classes (modify).

Contract (backend/src/infrastructure/process-table.ts):

```ts
export type TerminalOptions = { name: string, cols: number, rows: number, cwd: string, env: Record<string, string> }
export type TableRead = { readonly abort: AbortSignal, readonly timeoutMs: number, readonly maxBufferBytes: number }
export class ProcessTable {
  signal(pid: number, signal: NodeJS.Signals | 0): void
  readTable(read: TableRead): Promise<string>
  openTerminal(file: string, argv: string[], options: TerminalOptions): Terminal
}
export type TerminalSpawn = ProcessTable['openTerminal']
```

`Terminal` moves here from `pty-live-sessions.ts` byte for byte, and its imports follow it.
`SystemProcesses` adds `process.kill`, `node-pty`'s `spawn` and the `/bin/ps` read. That read is
the body of `PtyLiveSessions.#inspectProcessTable` today, bounded by its argument.

Current state (backend/src/infrastructure/checked-run-delivery.ts, lines 933-940):

```ts
  static #alive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (failure) {
      return failure !== null && typeof failure === 'object' && 'code' in failure && failure.code === 'EPERM'
    }
  }
```

It becomes an instance method over `this.signal(pid, 0)` and keeps the `EPERM` rule. The
optional `alive` port goes, because no caller passes it. `ToolRunner` takes
`signal: ProcessTable['signal']` for its group kill at line 103.

Call site (backend/src/infrastructure/pty-live-sessions.ts):

```ts
      .then(() => this.inspectProcessTable({
        abort: controller.signal,
        timeoutMs: PtyLiveSessions.INSPECTION_TIMEOUT_MS,
        maxBufferBytes: PtyLiveSessions.INSPECTION_MAX_BUFFER_BYTES,
      }))
```

`inspectProcessTable` takes `ProcessTable['readTable']` and loses its default. `spawn` and
`signal` take the two other members. `ct-api.ts` passes all three from its `SystemProcesses`.

**TDD:** `it('the_process_table_read_carries_the_inspection_bounds')` in
`pty-live-sessions.test.ts` expects the double to receive `INSPECTION_TIMEOUT_MS` and
`INSPECTION_MAX_BUFFER_BYTES`. `ACCOUNTED` also names `process-table.ts`, like the runner port.

**Tests:** added: `'the_process_table_read_carries_the_inspection_bounds'`. Removed on purpose:
none.

**Verification:** The census, the delivery and the terminal tests pass through the border.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/spawned-children.test.ts __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/pty-live-sessions-real-process.test.ts __tests__/infrastructure/checked-run-delivery-real-process.test.ts __tests__/infrastructure/tool-runner-real-process.test.ts   # expected: exit 0
test -z "$(grep -rl 'process\.kill\|node-pty' backend/src/infrastructure/tool-runner.ts backend/src/infrastructure/checked-run-delivery.ts backend/src/infrastructure/pty-live-sessions.ts)"   # expected: exit 0
```

### Task 3 — the headless worker and the claude calls launch through the border

**Objective:** `process-border.ts` becomes the only module under `backend/src` that imports a
spawning library.

**Files:** `backend/src/infrastructure/headless-call-worker.ts`,
`backend/src/infrastructure/claude-calls.ts` and `backend/src/infrastructure/ct-api.ts`
(modify). Also `backend/__tests__/spawned-children.ts` and its test (modify). Also the tests that
build `ClaudeCalls` or `HeadlessCallWorker` (modify).

Current state (backend/src/infrastructure/headless-call-worker.ts, lines 363-366):

```ts
    const worker = new HeadlessCallWorker({
      files,
      spawn,
      kill: (pid, signal) => process.kill(pid, signal),
```

`main` builds one `SystemProcesses` and passes `spawn: processes.launch` and
`kill: processes.signal`. `main` still opens with `InheritedTerminals.ofThisProcess().released()`.
`HeadlessCallWorker.spawn` and `ClaudeCalls.spawn` take the type `ProcessRunner['launch']`, and
`kill` takes `ProcessTable['signal']`. Their `ChildProcess` variables become `LaunchedProcess`.

Current state (backend/src/infrastructure/ct-api.ts, lines 7-8):

```ts
import { spawn as spawnChild } from 'node:child_process'
import { setTimeout as after } from 'node:timers/promises'
```

The first line goes, and `ClaudeCalls` gets `spawn: processes.launch`. `ct-api.ts` no longer
imports a spawning library, so its `INJECTS_ONLY` row leaves `ACCOUNTED`. The constant goes with
it, because no row uses it.

**TDD:** `it('the_border_is_the_only_module_of_src_that_imports_a_spawning_library')` expects
`SpawnedChildren.importersUnder(Backend.ROOT)` to equal `[join('infrastructure', 'process-border.ts')]`.

**Tests:** added: `'the_border_is_the_only_module_of_src_that_imports_a_spawning_library'`.
Removed on purpose: none.

**Verification:** The census holds the border alone, and the worker still runs as a real child.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/spawned-children.test.ts __tests__/infrastructure/claude-calls.test.ts __tests__/infrastructure/claude-calls-real-process.test.ts __tests__/infrastructure/claude-run-calls.test.ts __tests__/infrastructure/headless-plan-agents.test.ts   # expected: exit 0
test "$(grep -rlE "node:child_process|'node-pty'" backend/src)" = "backend/src/infrastructure/process-border.ts"   # expected: exit 0 — the border alone
```

### Task 4 — the scripted conversation of the process runner, fed by real captures

**Objective:** A `ToolRunner` over `ScriptedConversation` reads the captured answer of its
request, and an unscripted request raises.

**Files:** `backend/__tests__/scripted-conversation.ts` (create),
`backend/__tests__/scripted-conversation.test.ts` (create).
Also `backend/__tests__/captures/git/rev-parse-head.txt` (create) and
`backend/__tests__/captures/git/rev-parse-outside-a-repository.txt` (create).

No code — every file lives under `backend/__tests__`, so its signatures travel in prose and its body by TDD.

`scripted-conversation.ts` exports four names. `ScriptedRequest` is
`{ readonly binary: string, readonly argv: readonly string[], readonly cwd?: string }`.
`UnscriptedRequest extends Error`. `ScriptedConversation extends ProcessRunner`, with
`readonly asked: ScriptedRequest[]` and `answering(request, capture): ScriptedConversation`.
`Capture` has `static read(tool, name)`, `static parse(text)` and six readonly fields: `command`,
`version`, `date`, `code`, `stdout` and `stderr`.

A request matches when its binary, argv and cwd equal the scripted ones. The order of
`answering` never decides. `UnscriptedRequest` reads
`nobody wrote an answer for <binary> <argv joined by spaces> in <cwd>`. `runAndWait` answers
`failure: null` on exit 0, else `{ code, killed: false, signal: null, message: stderr }`.
`launch` answers a double that emits `spawn`, writes the stdout into a numeric `stdio[1]`, emits
the stderr on `stderr`, and emits `close` with the code.

A capture file has four header lines, `command:`, `version:`, `date:` and `exit:`. Then a line
`--- stdout`, the stdout, a line `--- stderr` and the stderr follow. Capture `git rev-parse HEAD`
in this worktree and in `/private/tmp`, with `git --version`, and copy what they print. Today
they print the head sha with exit 0, and
`fatal: not a git repository (or any of the parent directories): .git` with exit 128.

**TDD:** `it('a_request_nobody_scripted_raises_and_names_the_binary_the_argv_and_the_cwd')`. Its
boundary: the same argv in another cwd raises too.

**Tests:** added: `'a_tool_runner_over_the_conversation_reads_the_captured_answer_of_the_request_it_sent'`,
`'the_answer_follows_what_is_asked_not_the_order_the_answers_were_written'`,
`'a_request_nobody_scripted_raises_and_names_the_binary_the_argv_and_the_cwd'`,
`'a_captured_refusal_reaches_the_tool_runner_as_its_exit_code_and_its_stderr'`,
`'the_whole_output_path_reads_the_captured_stdout_through_the_launched_double'`,
`'a_capture_without_its_command_its_version_or_its_date_is_refused'`. Removed on purpose: none.

**Verification:** The conversation answers a real `ToolRunner`, and the yardstick measures the
new files.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/scripted-conversation.test.ts __tests__/yardstick.test.ts __tests__/typescript-only.test.ts   # expected: exit 0
test "$(ls backend/__tests__/captures/git | wc -l)" -eq 2   # expected: exit 0 — the two captures
```

### Task 5 — the ratchet over the test files that still launch a process

**Objective:** The ratchet fails on an unlisted spawning test file, and on a listed file that no
longer spawns.

**Files:** `backend/__tests__/process-ratchet.ts` (create),
`backend/__tests__/process-ratchet.test.ts` (create)

No code — both files live under `backend/__tests__`, so the signatures travel in prose and the body by TDD.

`ProcessRatchet` holds four constants. `MARKER` is `'-real-process'`. `SPAWNING` is
`['node:child_process', 'child_process', 'node-pty']`. `BORDER` is `'/process-border.ts'`.
`LISTED` is a `readonly string[]`. It has three static methods:
`spawningUnder(tests: string): string[]`, and
`unlisted(spawning, listed): string[]` and `stale(spawning, listed): string[]`.

`spawningUnder` walks `backend/__tests__` and answers the `.test.ts` files that spawn, sorted.
Each path is relative to `backend/__tests__`, with `/` separators. A file spawns when its name
carries `MARKER`, or when an `import`, a `from` or an `import(` names one of `SPAWNING`. A
specifier that ends with `BORDER` counts too. A relative specifier to a module under
`backend/__tests__` counts when that module spawns by the same rule, at any depth.

`unlisted` answers `<file> launches a process and ProcessRatchet.LISTED does not name it`.
`stale` answers `<file> is in ProcessRatchet.LISTED and launches no process any more`.
`LISTED` holds what `spawningUnder` finds at this commit, sorted, one path per line.

**TDD:** `it('a_spawning_test_file_the_list_does_not_name_fails_the_ratchet')` and
`it('a_listed_file_that_no_longer_spawns_fails_the_ratchet')`, over a temporary tree.

**Tests:** added: `'the_backend_suite_launches_processes_in_exactly_the_listed_files'`,
`'a_spawning_test_file_the_list_does_not_name_fails_the_ratchet'`,
`'a_listed_file_that_no_longer_spawns_fails_the_ratchet'`,
`'a_test_that_spawns_through_a_fixture_is_found_by_the_import_it_follows'`,
`'the_real_process_marker_alone_makes_a_file_spawning'`,
`'a_test_that_imports_the_border_spawns'`. Removed on purpose: none.

**Verification:** The ratchet holds over the real tree and fires over a temporary one.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/process-ratchet.test.ts __tests__/yardstick.test.ts   # expected: exit 0
test "$(grep -c 'real-process.test.ts' backend/__tests__/process-ratchet.ts)" -ge "$(find backend/__tests__ -name '*-real-process.test.ts' | wc -l)"   # expected: exit 0 — every marked file is listed
```

### Task 6 — the ledger of deleted test cases, and the test that reads it

**Objective:** The ledger exists with its format, and a test names every row that breaks it.

**Files:** `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` (create),
`backend/__tests__/ledger.test.ts` (create)

Final text (docs/superpowers/ledgers/2026-09-24-backend-without-processes.md):

```markdown
# Ledger — the backend suite launches no process

One row per test case that a slice of this milestone deletes. The first cell names the case as
`file > test name`, with the path from `backend/`. The second cell names its substitute the
same way, or reads `deleted without substitute — decided`. Every slice appends its rows, and
`backend/__tests__/ledger.test.ts` reads each one.

| Deleted case | Substitute |
|---|---|
```

A row is `` | `<path>.test.ts > <name>` | <substitute> | ``. The substitute is a cell of the same
shape, or the literal `deleted without substitute — decided`. The test keeps its parse in a
class `LedgerRows` inside the test file: `ledger.test.ts` is its only consumer.

**TDD:** `it('a_row_whose_case_has_no_file_or_no_test_name_is_named_by_its_line')` over a literal
ledger text. Its boundary: the same row with ` > ` in it passes.

**Tests:** added: `'the_ledger_exists_with_its_header_and_every_row_in_its_format'`,
`'a_row_whose_case_has_no_file_or_no_test_name_is_named_by_its_line'`,
`'a_row_with_an_empty_substitute_is_named_by_its_line'`,
`'deleted_without_substitute_decided_is_a_substitute_of_its_own'`. Removed on purpose: none.

**Verification:** The ledger parses, and the test fires on a broken row.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/ledger.test.ts __tests__/yardstick.test.ts   # expected: exit 0
test "$(grep -c '^| Deleted case | Substitute |$' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 1   # expected: exit 0 — the header
```

### Task 7 — the coverage instrument

**Objective:** `npm run coverage` measures `backend/src` with the children counted, and the
comparison names every drop.

**Files:** `backend/__tests__/coverage-baseline.ts`, `backend/__tests__/coverage-baseline.test.ts`,
`backend/__tests__/coverage-flush.ts` and `backend/__tests__/coverage.config.ts` (create). Also
`backend/package.json` and `backend/package-lock.json` (modify).

No code — the modules live under `backend/__tests__`, and the configuration travels as prose.

`coverage-baseline.ts` exports `Tally` (`{ covered, total }`), `FileCoverage`
(`{ lines, branches }`), `Exclusion` (`{ file, from: string | null, reason }`),
`BaselineExists extends Error` and `CoverageBaseline`. The class holds `REPORT`
(`'node_modules/.cache/coverage/coverage-final.json'`), `BASELINE` (`'coverage-baseline.json'`)
and `EXCLUDED`. Its static methods are `measured(report, sourceOf)`, `dropsAgainst(baseline,
measured): string[]`, `write(path, measured)` and `main(argv)`, with the verbs `write` and
`compare`.

`EXCLUDED` holds three rows, each with its reason. `src/infrastructure/process-border.ts` has
`from: null`. `src/infrastructure/ct-api.ts` has `from: 'await CtApi.run('`, and
`src/infrastructure/headless-call-worker.ts` has `from: '  static async main('`. A `from` leaves
out each line from the first line that holds it to the end of the file.

A line counts when a statement starts on it, and a statement that ran covers it. A branch is
one location of one `branchMap` entry. A drop is a ratio of covered to total under the baseline,
for lines or branches. A baseline file that the report lacks is a drop.

`write` throws `BaselineExists` when the file exists. The JSON holds `instrument` and a sorted
`files` map, keyed from `backend/`.

`package.json` adds `c8` `^11.0.0` to `devDependencies`, and three scripts.
`coverage` is `c8 --reporter=json --report-dir=node_modules/.cache/coverage --temp-directory=node_modules/.cache/coverage/raw --include='src/**' --all vitest run --config __tests__/coverage.config.ts`.
`coverage:baseline` is `node __tests__/coverage-baseline.ts write`, and `coverage:compare` is
`node __tests__/coverage-baseline.ts compare`.

`coverage.config.ts` merges `../vitest.config.ts` with `test.setupFiles` set to
`./__tests__/coverage-flush.ts` and `test.experimental.viteModuleRunner: false`. It excludes
`__tests__/infrastructure/work-progress-contract.test.ts`. `coverage-flush.ts` calls
`takeCoverage()` of `node:v8` in an `afterAll`.

**TDD:** `it('a_file_whose_line_ratio_falls_below_its_baseline_is_a_drop_and_an_equal_ratio_is_not')`:
one covered line less is a drop, and the same ratio is not.

**Tests:** added: that one, and `'a_branch_drop_is_named_even_when_every_line_holds'`,
`'a_baseline_file_the_report_no_longer_holds_is_named'`,
`'the_border_is_absent_and_the_entrypoint_lines_do_not_count'`,
`'writing_over_an_existing_baseline_is_refused'`. Removed on purpose: none.

**Verification:** The instrument runs over the whole suite, and its own tests pass.

```bash
cd backend && env -u CT_STATE_DIR npm run coverage   # expected: exit 0 — the whole suite under c8
test -s backend/node_modules/.cache/coverage/coverage-final.json   # expected: exit 0 — the report exists
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/coverage-baseline.test.ts __tests__/yardstick.test.ts __tests__/typescript-only.test.ts   # expected: exit 0
cd backend && npm run typecheck   # expected: exit 0
```

### Task 8 — the baseline, written once, and the line that names the instrument

**Objective:** `backend/coverage-baseline.json` holds every file of `backend/src` but the border,
with the children counted.

**Files:** `backend/coverage-baseline.json` (create), `backend/__tests__/coverage-baseline.test.ts`
(modify), `backend/conventions/this-repository.md` (modify)

Run `npm run coverage` and then `npm run coverage:baseline` from `backend/`, with
`env -u CT_STATE_DIR` in front. Commit the file that the second command writes, as it is.

Current state (backend/conventions/this-repository.md, lines 298-300):

```markdown
## Where the suite runs

From `backend/`, never the repository root. The fast subset is `npx vitest run --exclude '**/*-real-process.test.ts'`. During a working session, run the fast subset per change and the whole suite before handing anything over.
```

Final text (backend/conventions/this-repository.md):

```markdown
The coverage of `src/` is measured from `backend/` with `env -u CT_STATE_DIR npm run coverage`:
`c8` over `vitest run`, children counted. `npm run coverage:compare` then names every file that
fell below `coverage-baseline.json`. The baseline is written once, and
`CoverageBaseline.EXCLUDED` says what it leaves out and why.
```

The new paragraph goes after line 300, with one blank line before it.

**TDD:** `it('the_committed_baseline_counts_what_only_a_child_process_runs')` expects
`lines.covered` of `src/infrastructure/ct-api.ts` above zero. No test imports `ct-api.ts` in
process, so only a child can cover it.

**Tests:** added: that one, and `'the_committed_baseline_names_every_src_file_but_the_border'`.
Removed on purpose: none.

**Verification:** The baseline exists, a fresh measurement holds against it, and its tests pass.

```bash
test -s backend/coverage-baseline.json   # expected: exit 0
cd backend && npm run coverage:compare   # expected: exit 0 — no file fell below the baseline
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/coverage-baseline.test.ts   # expected: exit 0
test "$(grep -c 'process-border.ts' backend/coverage-baseline.json)" -eq 0   # expected: exit 0 — the border is absent
```

## 8. Global verification

The whole backend suite runs once more, and so does the instrument. The last two commands
restate the first and the third acceptance criteria as predicates.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run   # expected: exit 0 — the whole suite
cd backend && env -u CT_STATE_DIR npm run coverage && npm run coverage:compare   # expected: exit 0 — no drop
test "$(grep -rlE "node:child_process|'node-pty'" backend/src)" = "backend/src/infrastructure/process-border.ts"   # expected: exit 0
test -f docs/superpowers/ledgers/2026-09-24-backend-without-processes.md   # expected: exit 0
test -z "$(git status --porcelain -- plugin frontend)"   # expected: exit 0 — nothing under plugin or frontend moved
```

## 9. Assumptions

1. The gate of Simplified Technical English refuses the frozen decisions word for word. It
   finds passives and long sentences in them. The kickoff asks for their exact words, so §2
   quotes each one inside a code span, the way a test name travels. The words stay; the inner
   backticks go. Provenance: own call.
2. The two ports sit in `infrastructure/`, not in `domain/ports/`. A port about subprocesses would
   tell the domain that a subprocess exists. Provenance: repo convention,
   `plugin/conventions/architecture.md`.
3. `c8` over plain `vitest run` measures nothing in this repository. The vitest forks end before
   they write their coverage. Worker threads crash in `node-pty`. The flush of `node:v8` in an
   `afterAll` fixes the first. Provenance: measured on 2026-09-24.
4. Vite's module runner transforms each file in its own way, and Node strips the types of a
   child in another. `c8` merges them by url, and the merge broke `api-server.ts` from 99 % to
   44 %. `viteModuleRunner: false` gives both the same bytes. Provenance: measured on 2026-09-24.
5. Without Vite's runner, the `app` alias of `vitest.config.ts` does not reach frontend code.
   So the measurement excludes `work-progress-contract.test.ts`, the one file that needs it. The
   floor of the files it covers is lower, and each slice measures the same way. Provenance: own
   call.
6. A child that a signal ends writes no coverage. `ct-api.ts` measures 28 % because its tests end
   the server with a signal. An in-process test later only raises it. Provenance: measured.
7. The exclusion of the worker runs from `main` to the end of the file. `#acknowledge`,
   `#disconnect` and the entry guard run only in the child too. Provenance: own call.
8. The `/bin/ps` read keeps its wait for the callback and for `close` inside the border. That is
   plumbing of one call, not a decision. Provenance: own call.
9. The worker child now loads `node-pty` with the border. The API process already loads it.
   Provenance: own call.
10. `spawned-children.test.ts` stays in `LISTED`: its literal sample sources name
    `node:child_process`. The last slice empties the list. Provenance: own call.
11. The census of `spawned-children.ts` gains verbs and rows and loses none, so it grows
    stronger. Provenance: own call.
12. The baseline of `.agent/SLICE.md` reads `no-verificado`: `AGENTS.md` declares no test command. This
    plan runs the commands of `backend/package.json` from `backend/`. Provenance: `.agent/SLICE.md`.
13. `c8` `^11.0.0` is the version measured here. Provenance: measured.
14. The backend API does not change, so no migration, no rollback and no API report apply.
    Provenance: issue scope.
