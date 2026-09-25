# #553 — the API entrypoint runs in process

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`backend/__tests__/infrastructure/ct-api-real-process.test.ts` is on `ProcessRatchet.LISTED`. It
has 21 cases. Each case spawns `node backend/src/infrastructure/ct-api.ts`, or `make`, with fake
`claude` and `gh` scripts on `PATH` and real git repositories. Its helper is
`backend/__tests__/infrastructure/fixtures/ct-api-process.ts`, and nothing else imports it.

`backend/src/infrastructure/ct-api.ts` composes the whole backend in `CtApi.run(argv, environment)`.
It keeps its processes in the static field `#PROCESSES = SystemProcesses.forThisHost()`. It writes
to `process.stdout` and `process.stderr`, it calls `process.exit`, and it waits with `after` of
`node:timers/promises`. Its last line calls `CtApi.run` at import. So no test can compose it in
process today.

This slice gives the composition a host: the processes, the two output channels, the exit and
the wait. The main lines of `ct-api.ts` pass the real host. The tests pass doubles. Each case of
the old file then runs over the composed API in process, and the old file leaves the list.

PR #563 deleted three cases of the old file, and this slice owes their substitutes. Two of them
become new cases here. The third maps to the sweep case of Task 6, as §9 explains.

| Old cases | Substitute |
|---|---|
| the port line, the bad invocation, no session, no activation setting | new in `ct-api.test.ts`, Task 1 |
| the two `make run-backend --dry-run` cases | deleted without substitute, Task 1 |
| eight mounted and retired routes | new, Task 2 |
| the two external tools cases | new, Task 3 |
| a session closed, replaced and restarted; two openings at once | new, Task 4 |
| the two recovery cases; the acli and gh cases of #563 | new, Task 5 |
| the held story sweep; the chain case of #563 | new, Task 6 |

### Desired end state

- `ProcessRatchet.LISTED` does not name `infrastructure/ct-api-real-process.test.ts`, and the file does not exist.
- `backend/__tests__/infrastructure/fixtures/ct-api-process.ts` does not exist.
- `backend/__tests__/infrastructure/ct-api.test.ts` exists, and the ratchet test finds no process in it.
- `CtApi.run` takes an `ApiHost`, and only the main lines of `ct-api.ts` build the real one.
- The ledger has one row for each of the 21 cases of the old file and for the three cases of #563.
- The ratchet test, the ledger test, `npm run typecheck` and the backend suite pass.

### Out of scope

- `plugin/` and `frontend/`: nothing under them changes.
- The HTTP API: no route, body or status changes, so `backend/API.md` reports no change.
- A migration: this slice stores no new data, so no forward or rollback step exists.
- The coverage comparison. The owner of the milestone dropped it as a gate on 2026-09-24.
- The `Makefile`. D-10 leaves the tests of the Makefile without substitute.
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
| The #563 substitutes | `it does not set up its scenario through another feature. The admitted plan is built directly in the state, never with a POST (neither the milestone entrance nor any other).` |
| The host | `CtApi.run` takes one `ApiHost` with `processes`, `stdout`, `stderr`, `exit` and `wait`; the main lines build the real host, and nothing else in `backend/src/` builds one |
| The main lines | the call of `CtApi.run` runs only when the real path of `process.argv[1]` is the path of `ct-api.ts` |
| Every wait | `#waiting`, the `sleep` of `ClaudeCalls` and the `sleep` of `PtyLiveSessions` go through `host.wait`; the recovery clock keeps its `setTimeout`, because `ApiServer.stop` clears it |
| The answer of `run` | `CtApi.run` resolves to the `ApiServer` it started, so a case can stop it |
| A restart | `stop()` of the first `InProcessApi`, then `InProcessApi.started` again over the same environment and the same `HostProcesses` |
| The environment | a case passes its whole environment; nothing of the `process.env` of the shell reaches the composition |
| Where captures live | `backend/__tests__/infrastructure/captures/<tool>/`, the directory that `Capture.read` reads |
| A test name that stays | a substitute keeps the old name unless the old name says `real`; §7 names each rename |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `backend/src/infrastructure/headless-call-worker.ts` keeps its main lines under a
guard at the end of the file. `backend/__tests__/infrastructure/fixtures/in-process-run.ts` builds
real modules over doubles in a temporary root and removes it. `backend/__tests__/servers.ts` stops
every started server after each case. `backend/__tests__/infrastructure/fixtures/scripted-conversation.ts`
holds `ScriptedConversation`, `Capture` and `UnscriptedRequest`.
`backend/__tests__/infrastructure/fixtures/living-process-groups.ts` doubles `ProcessTable`.
`backend/__tests__/infrastructure/claude-conversations.test.ts` doubles a `Terminal`.

Rules to obey: `CLAUDE.md`, `docs/language.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/defects.md`,
`plugin/conventions/domain.md`, `plugin/conventions/simplicity.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/infrastructure/ct-api.ts` | modify | `make run-backend`, `ct-api.test.ts` | Current state, Contract, Call site |
| `backend/__tests__/infrastructure/fixtures/in-process-api.ts` | create | `ct-api.test.ts` | none (prose) |
| `backend/__tests__/infrastructure/fixtures/scripted-terminals.ts` | create | tasks 4 to 6 | none (prose) |
| `backend/__tests__/infrastructure/ct-api.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/captures/<tool>/*.txt` | create | tasks 3 to 6 | prose (a capture) |
| `backend/__tests__/infrastructure/ct-api-real-process.test.ts` | delete | nobody | none |
| `backend/__tests__/infrastructure/fixtures/ct-api-process.ts` | delete | nobody | none |
| `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` | modify | `process-ratchet.test.ts` | Current state |
| `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` | modify | `ledger.test.ts` and the judges | prose (one row per case) |

## 5. Interfaces

Consumes: from slice #1, `ScriptedConversation`, `ScriptedProcess`, `UnscriptedRequest` and
`Capture.read(tool, name)`, and the two ports `ProcessRunner` and `ProcessTable`. From slice #3,
`LivingProcessGroups` with `alive` and `asked`.

Produces: for slices #6 to #8. In `backend/src/infrastructure/ct-api.ts`:
`type ApiHost = { processes, stdout, stderr, exit, wait }`, and
`CtApi.run(argv: string[], environment: NodeJS.ProcessEnv, host: ApiHost): Promise<ApiServer>`.
Under `backend/__tests__/infrastructure/fixtures/`: `InProcessApi` with `started(environment, processes?)`,
`refused(environment)`, `stopAll()`, `port`, `said()`, `saidLater()` and `stop()`.
`HostProcesses extends ProcessRunner implements ProcessTable`, with `constructor({ conversation, table })`.
`ExitRequested extends Error`, with `code`. `ScriptedTerminals extends ProcessTable`, with `opened`, `typed` and `signalled`.

## 6. Test strategy

Every task runs `npm run typecheck` and `npx vitest run` over the files it touches, from
`backend/`. `env -u CT_STATE_DIR` goes in front of every `npx vitest run`, because a
`CT_STATE_DIR` of the shell leaks into the remaining real process tests.

Each task writes its test first and watches it fail. `process-ratchet.test.ts` then proves that
the new files launch nothing. `ledger.test.ts` proves the format of each new row. The old file
stays in the tree until Task 6, so the whole suite still runs its cases.

No new test declares a per-test timeout, because nothing in them waits on a child. A capture
comes from one real run of the command it names. Its header carries that command, the version
line of the tool, the date and the exit code. Each new answer of a scripted conversation comes
from the `UnscriptedRequest` that names it, one at a time.

## 7. Tasks

### Task 1 — the composition takes its host

**Objective:** `CtApi.run` composes the backend over an `ApiHost`, and four startup cases run in process over a doubled host.

**Files:** `backend/src/infrastructure/ct-api.ts` (modify),
`backend/__tests__/infrastructure/fixtures/in-process-api.ts` (create),
`backend/__tests__/infrastructure/ct-api.test.ts` (create). Also the ledger (modify).

Current state (backend/src/infrastructure/ct-api.ts, lines 232-233):
```ts
class CtApi {
  static readonly #PROCESSES = SystemProcesses.forThisHost()
```

Remove the field. Each private static helper that reads it, or writes to `process.stdout`,
`process.stderr` or `process.exit`, takes the host instead. `ClaudeCalls` gets `spawn: host.processes.launch.bind(host.processes)`.

Contract (backend/src/infrastructure/ct-api.ts):
```ts
export type ApiHost = {
  readonly processes: ProcessRunner & ProcessTable,
  readonly stdout: (text: string) => void,
  readonly stderr: (text: string) => void,
  readonly exit: (code: number) => never,
  readonly wait: (milliseconds: number) => Promise<void>,
}

export class CtApi {
  static async run(argv: string[], environment: NodeJS.ProcessEnv, host: ApiHost): Promise<ApiServer>
}
```

Call site (backend/src/infrastructure/ct-api.ts):
```ts
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await CtApi.run(process.argv.slice(2), process.env, {
    processes: SystemProcesses.forThisHost(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    exit: (code) => process.exit(code),
    wait: (milliseconds) => after(milliseconds),
  })
}
```

`HostProcesses` sends `runAndWait` and `launch` to its `conversation`, and the table calls to its
`table`. The host of `InProcessApi` keeps `stdout` and `stderr` as text, and its `exit` throws
`ExitRequested`. Its `wait` is `setTimeout` of `node:timers/promises` with `{ ref: false }`, and
never settles after `stop()`. `stopAll()` stops each API and removes its temporary directories.

**TDD:** `it('prints_the_port_it_bound_so_whoever_started_it_knows_where_to_knock')` expects
`said()` to equal `{"port":N}` and a newline, with `N` equal to `port` and above zero.

**Tests:** added: that case,
`'a_bad_invocation_is_refused_with_the_reason_and_a_usage_line_that_names_the_command_the_documentation_starts_the_backend_with'`,
`'a_freshly_started_backend_lists_no_session_because_nothing_has_been_asked_of_it_yet'` and
`'existing entrypoints start without an activation setting'`. The refusal gives status 2, and its
stderr lines keep the old assertions. The last case passes only `CT_API_PORT`, `CLAUDE_CONFIG_DIR`,
`SHELL` and an empty `CT_HARVEST_BQ_TABLE`. Removed on purpose: none.

Append six ledger rows for `__tests__/infrastructure/ct-api-real-process.test.ts`. The four cases map
to the cases of the same name in `__tests__/infrastructure/ct-api.test.ts`. The two cases of
`run-backend` read `deleted without substitute — decided`.

**Verification:** The API starts in process, with six rows.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-api.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'ct-api-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 6   # expected: exit 0
```

### Task 2 — the mounted and the retired routes answer in process

**Objective:** `ct-api.test.ts` proves eight routes of the composed API in process, each with the answer of its old case.

**Files:** `backend/__tests__/infrastructure/ct-api.test.ts` (modify). Also the ledger (modify).

No code — each case starts an `InProcessApi` over a `HostProcesses` with an empty `ScriptedConversation` and `new LivingProcessGroups([])`.

If a route asks a tool, the `UnscriptedRequest` names it, and the answer gets its capture. The
run file of the first two cases lives under a temporary root that the case removes.

**TDD:** `it('the runtime switch retains the retired implementation endpoint as not found')` expects
`404` and `{ code: 'not-found', detail: 'not found' }` for `POST` and for `GET` of `/implement-plan`.
After both, `control-tower/go` does not exist under the `CLAUDE_CONFIG_DIR` of the case.

**Tests:** added: that case, `'the_running_api_does_not_read_an_arbitrary_checkout_as_recorded_work'`,
`'the_retired_progress_route_is_absent_even_when_a_run_file_exists'`,
`'unified_progress_is_mounted_in_the_composed_api_and_refuses_unknown_work'`,
`'a_whole_request_to_spec_freeze_reaches_the_wiring_the_entrypoint_built'`,
`'a started backend answers gate 2 with no session held'`,
`'review_plan_is_no_longer_mounted_in_the_composed_api'` and
`'the mounted path refuses another method with an allow header'`. Each keeps the request and the
assertions of its old case. Removed on purpose: none.

Append eight ledger rows. Two old names change. `unified_progress_is_mounted_in_the_real_process_and_refuses_unknown_work`
maps to `unified_progress_is_mounted_in_the_composed_api_and_refuses_unknown_work`.
`review_plan_is_no_longer_mounted_in_the_real_process` maps to `review_plan_is_no_longer_mounted_in_the_composed_api`.
The other six old names equal their new names.

**Verification:** The eight routes answer in process, and each has its ledger row.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-api.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'ct-api-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 14   # expected: exit 0
```

### Task 3 — the external tools survey reaches every probe in process

**Objective:** `ct-api.test.ts` proves that `GET /external-tools` asks each probe the composition wired, and reads the delivery from the startup settings.

**Files:** `backend/__tests__/infrastructure/ct-api.test.ts` (modify). Also captures and the ledger (modify).

No code — the probes are the five rows of `ProbedToolSessions.PROBES`, and their answers are real captures.

The `PATH` of the case is one temporary directory. It holds an empty executable file for `gh`,
`acli`, `claude`, `git`, `ssh`, `bq` and `gcloud`, because `Invocation.lookUp` reads only the disk.
The five new captures are `gh/auth-status`, `acli/jira-auth-status`, `claude/auth-status`,
`ssh/github-batch-mode` and `gcloud/auth-list-active`. Each comes from one real run of the argv of its row.

**TDD:** `it('a_whole_request_to_external_tools_reaches_every_probe_client_the_entrypoint_wired_up')`
sets `CT_HARVEST_BQ_TABLE` to `fixture-project:fixture_dataset.fixture_table`. It expects the tools
`['gh', 'acli', 'claude', 'git', 'bq']` in that order, and the binaries of `conversation.asked`
equal to `['gh', 'acli', 'claude', 'ssh', 'gcloud']`. It keeps the old session, fix and delivery assertions.

**Tests:** added: that case, and
`'without_the_harvest_table_the_entrypoint_answers_a_disabled_delivery_read_from_the_startup_configuration'`.
The second sets an empty `CT_HARVEST_BQ_TABLE`, and expects
`{ enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null }`. Removed on purpose: none.

Append two ledger rows. Each old case maps to the case of the same name in the new file.

**Verification:** The survey runs in process, and each case has its ledger row.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-api.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'ct-api-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 16   # expected: exit 0
```

### Task 4 — a coordinating session opens, closes and survives a restart in process

**Objective:** `ct-api.test.ts` proves that a coordinating session opens, takes input, closes, reopens and stays closed after a restart, over scripted terminals.

**Files:** `backend/__tests__/infrastructure/fixtures/scripted-terminals.ts` (create),
`backend/__tests__/infrastructure/ct-api.test.ts` (modify). Also captures and the ledger (modify).

No code — `ScriptedTerminals` lives under `backend/__tests__`, so its surface travels in prose and its body by TDD.

`ScriptedTerminals extends ProcessTable`. `openTerminal` records `{ file, argv, cwd }` in `opened`,
and gives a new pid that is also its group. Each terminal prints `ScriptedTerminals.READY` after one
microtask. `write` appends the text to `typed`.

`signal` records the pid in `signalled`. A signal
other than 0 to a live group ends its terminal. `signal(pid, 0)` throws `ESRCH` for a group that is
gone. `readTable` prints one `pid pgid lstart` line per live terminal, in the format of `/bin/ps -axo pid=,pgid=,lstart=`.

The ticket is `https://github.com/mercadona/control-tower/issues/154`. Its answer is the new
capture `gh/issue-view-154`, from `gh issue view` of that URL with `--json title,body,comments`.

**TDD:** `it('a session can be closed and replaced and stays closed after backend restart')` keeps
each HTTP assertion of the old case. `opened` grows to 1, then 2, then 3 after the restart.
`typed` holds `typed-through-the-api`. `sentinel.txt` and `untracked.txt` of the checkout keep their bytes.
No git request names `checkout`, `reset`, `clean`, `stash` or `restore`. `signalled` names only groups of `opened`.

**Tests:** added: that case, and `'two_openings_fired_at_once_open_a_single_conversation'`. The second
fires two openings at once, and expects the statuses `[202, 409]` and one `brainstorming` session.
Removed on purpose: none.

Append two ledger rows. Each old case maps to the case of the same name in the new file.

**Verification:** The session cases run in process, and each has its ledger row.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-api.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'ct-api-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 18   # expected: exit 0
```

### Task 5 — a recorded conversation and a story read run in process

**Objective:** `ct-api.test.ts` proves the recovery of a recorded conversation, and the story reads through acli and gh, in process.

**Files:** `backend/__tests__/infrastructure/ct-api.test.ts` (modify). Also captures and the ledger (modify).

No code — the four cases reuse `ScriptedTerminals` of Task 4 and the arrange of its checkout.

The recovery cases write `control-tower/coordinating-session/conversation.json` under the
`CLAUDE_CONFIG_DIR` of the case, with the fields of the old `ARecordedConversation`. The first
case also writes the transcript `<id>` plus `ClaudeCodeTranscript.EXTENSION`. Its directory is
`ClaudeCodeTranscript.FOLDER` and `ClaudeCodeTranscript.folderFor(checkout)`, under `CLAUDE_CONFIG_DIR`.

The story cases post `{ id, path }` to `/coordinating-session`. The acli case posts `ZZZ-999999`,
with the new capture `acli/workitem-view-missing` of `AcliUserStories.argvFor` for that key. The gh
case posts `https://github.com/mercadona/control-tower/issues/999999999`, with the new capture
`gh/issue-view-missing` of `gh issue view` for that URL.

**TDD:** `it('the_recovery_reads_the_transcript_under_the_configured_claude_directory')` expects the
status of `GET /coordinating-session` not to be `unresumable`. It expects one terminal in `opened`,
and the argv of that terminal names the recorded conversation id.

**Tests:** added: that case,
`'a_recorded_conversation_with_no_transcript_at_all_is_not_resumed'`,
`'a_whole_request_reaches_acli_so_a_typo_in_the_key_that_wires_the_user_stories_would_show_up_here'` and
`'a_whole_request_reaches_gh_so_a_typo_in_the_url_that_wires_the_user_stories_would_show_up_here'`.
The second expects `unresumable`, and no terminal in `opened`. The acli case expects `400`, the code
`user-story-not-read` and a detail that matches `/^acli jira failed: /`. The gh case expects the same,
with `/^gh issue view failed: /`. Neither story case opens a terminal. Removed on purpose: none.

Append four ledger rows. The two recovery cases map to the cases of the same name in the new file.
The two story rows name the deleted cases of #563 in `__tests__/infrastructure/ct-api-real-process.test.ts`:
`a_whole_request_reaches_acli_so_a_typo_in_the_key_that_wires_the_user_stories_would_show_up_here_and_not_only_in_the_first_real_use`
and `a_whole_request_reaches_gh_so_a_typo_in_the_url_that_wires_the_user_stories_would_show_up_here_and_not_only_in_the_first_real_use`.
Each maps to the new case without the tail `_and_not_only_in_the_first_real_use`.

**Verification:** The recovery and story cases run in process, and each has its ledger row.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-api.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'ct-api-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 22   # expected: exit 0
```

### Task 6 — the held story sweep runs in process, and the old file leaves the list

**Objective:** `ct-api.test.ts` proves the sweep of the held story in process, and the old file and its helper leave the tree.

**Files:** `backend/__tests__/infrastructure/ct-api.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also a capture and the ledger (modify).
Delete `backend/__tests__/infrastructure/ct-api-real-process.test.ts` and
`backend/__tests__/infrastructure/fixtures/ct-api-process.ts`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 13-15):
```ts
    'infrastructure/claude-run-calls.test.ts',
    'infrastructure/ct-api-real-process.test.ts',
    'infrastructure/git-workspace-real-process.test.ts',
```

Remove the middle line. The held story is `IDLE-1` of `jjponz/repo-pulse`. The state holds
`checkouts.json` and `coordinating-session/conversation.json` under `control-tower/`, as in the old case.
The checkout holds `docs/superpowers/specs/IDLE-1-execution.md`, with the title `# The idle milestone — Execution spec`.
The new capture `gh/graphql-open-issues-repo-pulse` comes from the argv of `GhDispatchCandidates` for open issues, over `jjponz/repo-pulse`.

**TDD:** `it('the runtime sweeps the checkout of its held story and mounts the slice message path')`
expects `POST /slices/42/message` with `{}` not to give `404`, and a body with the code `malformed-repo`.
Once the first sweep asks gh, every gh request carries `query=` plus `issuesQueryFor(['OPEN'])`.
`saidLater()` contains neither `could not survey` nor `relay:`. No terminal opens, and `control-tower/go` does not exist.

**Tests:** added: that case. Removed on purpose: the 21 cases of the deleted file.

Append two ledger rows. The old sweep case maps to the new case of the same name.
The #563 row names `both entrances use recorded calls, the chain taking the milestone one by itself, and the runtime constructs no go or window client`,
and maps to the same new case.

**Verification:** Neither file exists, the list does not name the old file, and the ledger names its 24 cases.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-api.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/ct-api-real-process.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/fixtures/ct-api-process.ts   # expected: exit 0
test "$(grep -c 'ct-api-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 24   # expected: exit 0
```

## 8. Global verification

The whole backend suite runs once with the new cases in it. The old file is off the list.
The ledger names all 24 of its cases.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run   # expected: exit 0 — the whole backend suite
test -z "$(grep -l 'ct-api-real-process' backend/__tests__/infrastructure/fixtures/process-ratchet.ts)"   # expected: exit 0 — the file is off the list
test ! -e backend/__tests__/infrastructure/ct-api-real-process.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/fixtures/ct-api-process.ts   # expected: exit 0
test "$(grep -c 'real-process.test.ts > ' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 63   # expected: exit 0 — 39 earlier rows and 24 new rows
```

## 9. Assumptions

1. The coverage criterion stays in the issue, but the owner dropped it. So no task measures
   coverage. Provenance: issue, "Contexto heredado".
2. The two `run-backend` cases read the `Makefile` with `make --dry-run`. They test the Makefile, not
   the backend, as the two files of D-10 do. So they go without a substitute. Provenance: own call, after D-10.
3. `existing entrypoints start without an activation setting` ran `make run-backend`. Its substitute
   keeps what the backend owns: the composition starts with no activation setting. Provenance: own call.
4. The chain case of #563 had two halves. A real capture of a dispatch that admits a slice
   weighs about 1.2 MB of issue tables. No small real repository holds a ready slice in a milestone
   today. The backend refuses a recovery over a restarted state, as `restart-recovery.test.ts` proves.

   So the row maps to the sweep case: the relay reads only its own held story, and opens no
   terminal and no `go`. The launch through recorded calls stays with
   `run-driver.test.ts > a new admission reaches machine delivery with one conversation`, and the
   relay with `dispatch-relay.test.ts`. A person can ask for more at review. Provenance: own call.
5. `CtApi.run` resolves to its `ApiServer`. The main lines ignore it, and a case calls `stop()` on it.
   A return value is no seam next to the ports, so the rule on test-only code holds. Provenance: own call.
6. `host.wait` exists for one reason: a sweep of a stopped API must not wake up inside a later case.
   That false red is the motive of D-1. Provenance: own call.
7. The main guard compares real paths, because a symlink in the path of the checkout would otherwise
   stop the backend with no line. Provenance: own call, after `headless-call-worker.ts`.
8. The acli capture carries the Spanish error text of the real tool. That text is external output,
   so the language rule leaves it alone. Provenance: repo, `docs/language.md`.
9. The ledger held 39 rows before this slice, and each names a `-real-process.test.ts` file. §8
   counts 63 rows for that reason. Provenance: repo, the ledger.
