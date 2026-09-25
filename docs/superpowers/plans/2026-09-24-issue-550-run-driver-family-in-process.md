# #550 — the run driver family runs in process

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

Three test files of the run driver family still launch processes, and `ProcessRatchet.LISTED`
in `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` names them.
`run-dispatch-real-process.test.ts` runs the real `ct-step.mjs` and real `git` only to get an
announcement and its input files. The dispatch itself reads the journal and the disk.
`run-recovery-real-process.test.ts` drives `RunDriverMother`, which runs `git`, `node ct-step.mjs`
and a fake `claude` executable. `run-driver-runtime-real-process.test.ts` starts the whole
`ct-api.ts` as a child and fakes `claude` and `gh` on the `PATH`.

The fourth file, `run-driver-real-process.test.ts`, is gone: PR #563 deleted it with the loose
entrance of `POST /start-plan`. PR #563 also deleted three more cases of this family. This slice
owes the in-process substitutes of those four cases.

This slice moves every case to an in-process test. A scripted oracle renders what `ct-step`
prints with the plugin's own `StepAnnouncement`. A scripted conversation answers `git` from
real captures. An in-process worker runs the real `HeadlessCallWorker` against a scripted
`claude` that plays a real capture. The ledger gets one row per deleted case.

### Desired end state

- `ProcessRatchet.LISTED` names none of `run-dispatch-real-process.test.ts`,
  `run-recovery-real-process.test.ts` and `run-driver-runtime-real-process.test.ts`, and none of
  the three files exists.
- `run-dispatch.test.ts`, `run-driver.test.ts`, `run-recovery.test.ts` and
  `run-driver-runtime.test.ts` under `backend/__tests__/infrastructure/` launch no process.
- The ledger has one row for every case that a file of this family lost. The four cases that
  PR #563 owed to this slice are among them.
- The ratchet test, the ledger test, `npm run typecheck` and the backend suite pass.

### Out of scope

- `plugin/` and `frontend/`: nothing under them changes.
- `ct-run-machine-real-process.test.ts` and the rest of `RunDriverMother`. Slice #4 migrates
  them, so the mother stays, minus the one method that only `run-recovery` calls.
- The production composition in `ct-api.ts`. Slice #5 tests it in process.
- The coverage comparison. The owner of the milestone dropped it as a gate on 2026-09-24.
- `backend/API.md`: no endpoint changes, so the API reports no change.
- A migration: this slice stores no new data, so no forward or rollback step exists.

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
| A substitute of #563 | builds its admitted plan directly in the state, never through a `POST` |
| The oracle | `ScriptedOracle` answers the `node` port of `CtRunMachine` with `StepAnnouncement` text; it is the one place that renders an announcement in these tests |
| The model | `InProcessWorkers` runs the real `HeadlessCallWorker` in this process; its `spawn` is `ScriptedClaude.launch` |
| Where captures live | `backend/__tests__/infrastructure/captures/<tool>/`, the directory that `Capture.read` of #549 reads |
| Test names | a migrated case keeps its name; a name that says `real` loses the word, and the ledger maps the old name to the new one |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `backend/__tests__/infrastructure/run-plan-agents.test.ts` composes
`RunPlanAgents` in process with doubles of its ports.
`backend/__tests__/infrastructure/fixtures/scripted-conversation.ts` is the scripted conversation
and the `Capture` reader, and `backend/__tests__/infrastructure/scripted-conversation.test.ts`
tests it. `backend/__tests__/run-delivery-double.ts` is the delivery double to reuse.
`backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` shows the graph that the old
tests built, and the role effects of its fake `claude`.

Rules to obey: `.agent/conventions.md`, `CLAUDE.md`, `docs/language.md`, `docs/glossary.md`,
`backend/conventions/this-repository.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/boundaries.md`, `plugin/conventions/decisions.md`,
`plugin/conventions/defects.md`, `plugin/conventions/domain.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/style.md`,
`plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/__tests__/infrastructure/fixtures/scripted-oracle.ts` | create | tasks 1, 2, 4, 5, 6 | none (prose) |
| `backend/__tests__/infrastructure/run-dispatch.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` | delete | — | none (prose) |
| `backend/__tests__/infrastructure/fixtures/scripted-conversation.ts` | modify | `scripted-claude.ts` | none (prose) |
| `backend/__tests__/infrastructure/fixtures/scripted-claude.ts` | create | `in-process-run.ts` | none (prose) |
| `backend/__tests__/infrastructure/fixtures/in-process-workers.ts` | create | `in-process-run.ts` | none (prose) |
| `backend/__tests__/infrastructure/in-process-workers.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/captures/claude/result-success.txt` | create | `scripted-claude.ts` | prose (a capture) |
| `backend/__tests__/infrastructure/captures/git/ls-tree-plans.txt`, `show-plan.txt` | create | `in-process-run.ts` | prose (a capture) |
| `backend/__tests__/infrastructure/fixtures/in-process-run.ts` | create | tasks 4, 5, 6 | none (prose) |
| `backend/__tests__/infrastructure/run-driver.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/run-recovery.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/run-recovery-real-process.test.ts` | delete | — | none (prose) |
| `backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` | modify | `ct-run-machine-real-process.test.ts` | none (prose) |
| `backend/__tests__/infrastructure/run-driver-runtime.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/run-driver-runtime-real-process.test.ts` | delete | — | none (prose) |
| `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` | modify | `process-ratchet.test.ts` | none (prose) |
| `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` | modify | `ledger.test.ts` and the judges | prose (one row per case) |

## 5. Interfaces

Consumes: from slice #1, `ProcessRunner` and its `launch(binary, argv, options): LaunchedProcess`,
`ProcessTable['signal']`, and `ScriptedConversation`, `UnscriptedRequest` and
`Capture.read(tool, name)` from `backend/__tests__/infrastructure/fixtures/scripted-conversation.ts`.
Also `ProcessRatchet.LISTED` and the ledger table.

Produces: for slices #3 to #8, all under `backend/__tests__/infrastructure/fixtures/`.
`ScriptedOracle`, with `announce(step): Promise<string>` and the `run` port of `CtRunMachine['node']`.
`ScriptedClaude extends ProcessRunner`, with `asked: ClaudeRequest[]`.
`InProcessWorkers extends ProcessRunner`, with `launches` and `settled()`.
`InProcessRun`, with `create()`, `agents()`, `journaled(steps)`, `recorded(call)`, `recovery()`
and `remove()`.
`ScriptedProcess`, now exported from `scripted-conversation.ts`.

## 6. Test strategy

Every task runs `npm run typecheck` and `npx vitest run` over the files it touches, from
`backend/`. `env -u CT_STATE_DIR` goes in front of every `npx vitest run`, because a
`CT_STATE_DIR` of the shell leaks into the remaining real process tests.

Each task writes its new test file first, against the fixture it adds, and watches it fail. Then
the task deletes the old file and takes its entry off `ProcessRatchet.LISTED`. It appends the
ledger rows in the format of the table: `file > test name`, with the path from `backend/`.
`process-ratchet.test.ts` then proves that the new file launches nothing and that the list
matches the tree. `ledger.test.ts` proves the format of each row.

No new test declares a per-test timeout. Nothing in them waits on a child, and D-14 restores
the defaults at the close.

## 7. Tasks

### Task 1 — the scripted oracle and the first dispatch cases

**Objective:** `run-dispatch.test.ts` proves four dispatch cases against announcements that `ScriptedOracle` renders.

**Files:** `backend/__tests__/infrastructure/fixtures/scripted-oracle.ts` (create),
`backend/__tests__/infrastructure/run-dispatch.test.ts` (create).

No code — every file lives under `backend/__tests__`, so its signatures travel in prose and its body by TDD.

`ScriptedOracle` takes `{ checkout, plan, issue, pluginRoot, dispatchCheck, steps }`. `steps`
holds values of `ScriptedStep`: `implement`, `controls`, `judge`, `advise`, `commit`,
`reconcile`, `reconcile-clean`, `global`, `slice-judge`, `e2e`, `delivered` and `refused`. It
exposes `static REFUSAL = 'the scripted judge refused the task'`, `asked`, the list of every
argv, `announce(step): Promise<string>`, and `run`, of the type `CtRunMachine['node']`.

`announce` writes each input under `<checkout>/.agent/run-<issue>/<input role>.md`. It returns
`StepAnnouncement.<kind>(…).text()` for task 1 of 1, attempt 1. A dispatch declares
`MANDATORY_INPUT_ROLES_OF_STEP[step]`, plus `global-log` for `slice-judge`. The rubric is
`join(pluginRoot, RoleBytes.filesOf(STEPS.IMPLEMENT)[0])`, with no file written.

The `verdicts` input is the glob `docs/superpowers/verdicts/issue-<issue>-*.json`, with one file
`issue-<issue>-task-1.json`. The response path is `<checkout>/.agent/run-<issue>/<step>-response.json`,
and `e2e` answers `structured`. `consuming.argv` is the verb of `CONSUMING_VERB_OF_STEP`, the
response path if any, `--plan`, the plan, `--issue` and the issue.

`controls`, `commit`, `reconcile-clean` and `global` are `StepAnnouncement.program`, with the one
command `ct-step <verb>`. `reconcile` is a dispatch with an `edits` response. `delivered` is a
transition to `delivered`, outcome `done`, exit 0, at `slice-judge`. `refused` is a refusal at
`judge`: state `blocked-judge`, outcome `failed`, exit 1, detail `REFUSAL`.

`run` answers `[ctStep, 'next', …]` with the next entry of `steps`, and any other `ct-step` verb
with a transition to `open`, outcome `done`, exit 0. It answers `[dispatchCheck, …, '--check-plan']`
with code 0 and no output. Anything else throws `UnscriptedRequest`.

The test writes the manifest and the finished `next` command in the journal, as `machine()` of
the old file does, with `afterRun: null`. Each case keeps the assertions of its old case.

**TDD:** `it('announced oracle material reaches the dispatch without rewritten bytes')` expects
the dispatch paths to equal the announced inputs plus the role files, byte for byte.

**Tests:** added: `'announced oracle material reaches the dispatch without rewritten bytes'`,
`'every supported role carries its agent, its channel and the schema it needs'`,
`'unsupported E2E and slice fallback material starts no call'` and
`'a changed judge definition goes out under a new versioned seal'`. Removed on purpose: none.

**Verification:** The four cases run in process.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-dispatch.test.ts __tests__/infrastructure/process-ratchet.test.ts   # expected: exit 0 — the new file launches nothing
```

### Task 2 — the last dispatch cases, and the old dispatch file leaves

**Objective:** `run-dispatch-real-process.test.ts` leaves the tree and the ratchet list, and the ledger names each of its cases.

**Files:** `backend/__tests__/infrastructure/run-dispatch.test.ts` (modify),
`backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` (delete),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify),
`docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` (modify).

No code — the three cases keep the assertions of their old cases, over the oracle of Task 1.

The literal path case sets `TMPDIR` to a directory named `ct-[literal]*?-…`, as today, and
`InProcessRun` plays no part. Remove `'infrastructure/run-dispatch-real-process.test.ts'` from
`ProcessRatchet.LISTED`. Append seven ledger rows, in the order of **Tests:**. The case
`real oracle material reaches the dispatch without rewritten bytes` maps to
`announced oracle material reaches the dispatch without rewritten bytes`. The other six keep
their names. The row of the removed case lands in Task 6, see §9.

**TDD:** `it('a dispatch whose input material is missing is refused')` expects `RunNotUnderstood`
and no material, after the test removes the announced brief.

**Tests:** added: `'a dispatch whose input material is missing is refused'`,
`'literal producer paths and the declared verdict glob retain their different meanings'` and
`'conflicting response announcements and duplicate consuming commands are refused before sealing'`.
Removed on purpose:
`'fixture setup failures restore absent and present environment values without leaked roots'`.
It tested the git arrange of the old fixture, and no arrange runs git now.

**Verification:** The old file is gone, off the list, and its kept cases are in the ledger.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-dispatch.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/run-dispatch-real-process.test.ts   # expected: exit 0 — the old file is gone
test "$(grep -c 'run-dispatch-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -ge 7   # expected: exit 0 — every kept case has its row; Task 6 adds the eighth
```

### Task 3 — the scripted model and the worker in process

**Objective:** A real `ClaudeCalls` over `InProcessWorkers` completes a call from a real capture and launches no process.

**Files:** `backend/__tests__/infrastructure/fixtures/scripted-claude.ts` (create),
`backend/__tests__/infrastructure/fixtures/in-process-workers.ts` (create),
`backend/__tests__/infrastructure/in-process-workers.test.ts` (create),
`backend/__tests__/infrastructure/captures/claude/result-success.txt` (create). Also
`backend/__tests__/infrastructure/fixtures/scripted-conversation.ts` (modify).

No code — every file lives under `backend/__tests__`, so its signatures travel in prose and its body by TDD.

`scripted-conversation.ts` exports `ScriptedProcess`, and nothing else changes in it.

`ScriptedClaude extends ProcessRunner`. Its `asked` holds one
`ClaudeRequest = { conversation, role, argv, prompt }` per launch. The role is `plan` with
`--session-id`, the value after `--agent` when that flag exists, else `implement`. The prompt is
the file that the last argv names in `Read the file at <path> and do exactly what it says.`.

`launch` writes `{"ruling":"PASS"}` and a newline to the path on the last prompt line, when the
line before it is `ClaudeRunCalls.FILE_ERRAND_END`. It then plays the capture through
`ScriptedProcess`, with `session_id` set to the conversation of `--resume` or `--session-id`. For
`implement` it adds `structured_output: { paths: ['work.txt'], summary: 'Scripted implementer response.' }`,
and for `ct-advisor` `{ approach: 'Keep the scripted scope.', files_to_reconsider: [] }`.
`runAndWait` throws `UnscriptedRequest`.

`InProcessWorkers extends ProcessRunner` takes `{ files, claude, worker }`. `launch` throws
`UnscriptedRequest` unless the binary is `process.execPath` and `argv[0]` is `worker`. Otherwise
it adds one to `launches` and returns an emitter that fits `LaunchedProcess`. The emitter emits
`spawn`, runs `new HeadlessCallWorker({…}).run(argv[1])` and `terminal()`, then emits `exit` and
`close` with 0. `acknowledge` emits `message` with `{ kind: 'accepted' }`.

`kill` throws an error whose `code` is `ESRCH`, because the scripted leader leaves no group.
`schedule` and `cancel` wrap `setTimeout`. `settled()` resolves when every started worker ends.

The capture comes from one real run of `claude -p --output-format json 'Answer with the single word ok.'`.
Its header carries that command, the output of `claude --version`, the date and `exit: 0`.

**TDD:** `it('a call through the in-process worker completes from the captured result in the asked conversation')`
expects a successful completion, one request in `ScriptedClaude.asked`, and `launches` at 1.

**Tests:** added: that case, and `'a launch that is not the headless worker is refused as unscripted'`.
Removed on purpose: none.

**Verification:** The worker runs in process, and the ratchet sees no new spawning file.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/in-process-workers.test.ts __tests__/infrastructure/scripted-conversation.test.ts __tests__/infrastructure/process-ratchet.test.ts   # expected: exit 0
test "$(head -n 1 backend/__tests__/infrastructure/captures/claude/result-success.txt)" = "command: claude -p --output-format json 'Answer with the single word ok.'"   # expected: exit 0
```

### Task 4 — a new admission reaches delivery in process

**Objective:** `run-driver.test.ts` proves that a new admission reaches machine delivery with one conversation.

**Files:** `backend/__tests__/infrastructure/fixtures/in-process-run.ts` (create),
`backend/__tests__/infrastructure/run-driver.test.ts` (create),
`backend/__tests__/infrastructure/captures/git/ls-tree-plans.txt` (create),
`backend/__tests__/infrastructure/captures/git/show-plan.txt` (create). Also the ledger (modify).

No code — every file lives under `backend/__tests__`, so its signatures travel in prose and its body by TDD.

`InProcessRun` carries `static ISSUE = 7`, `static REPOSITORY = 'acme/widget'` and
`static PLAN = 'docs/superpowers/plans/2026-09-17-issue-7-driver.md'`. Its fields are `checkout`,
`state`, `oracle`, `claude`, `workers`, `delivery`, a `CompletedRunDelivery`, and `published`, a
`PlanWatch[]`. It has `static create(steps): Promise<InProcessRun>`, `agents(): RunPlanAgents`
and `remove()`.

`create` makes a temporary base with `checkout/` and `state/`, and no repository. It writes
`AGENTS.md`, `work.txt`, `.agent/SLICE.md` through `renderState`, and the plan. The plan text is
`Capture.read('git', 'show-plan').stdout`. `git` is a `ToolRunner` over a `ScriptedConversation`
that answers the `ls-tree` and `show` requests of `CtRunMachine`, with `-C <checkout>`.

`agents()` composes the real classes of `RunDriverMother`, with four differences:
`InProcessWorkers` for `spawn`, `oracle.run` for `node`, a `PlanPublication` double that pushes
to `published`, and `delivery`. Ids come from one counter. `remove` awaits `workers.settled()`,
then removes the base. Take both captures in a scratch repository with the plan committed.

The test calls `agents().launch(briefing)` with a `PlanBriefing` that it builds, and waits until
`delivery.delivered` holds the watch. The steps are `implement`, `controls`, `judge`, `commit`,
`reconcile-clean`, `global`, `slice-judge` and `delivered`.

Append two ledger rows, one for each case of #563, both to this test:
`run-driver-real-process.test.ts > a new admission reaches real machine delivery with one conversation`
and `run-driver-runtime-real-process.test.ts > the runtime routes every new admission through the machine driver`.

**TDD:** `it('a new admission reaches machine delivery with one conversation')` expects the
roles `plan`, `implement`, `ct-judge`, `ct-slice-judge` in one conversation. It also expects one
publication, `run:` request ids and a success measurement for each call.

**Tests:** added: that case. Removed on purpose: none.

**Verification:** The admission reaches delivery in process.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-driver.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'run-driver.test.ts > a new admission' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 2   # expected: exit 0
```

### Task 5 — run recovery in process

**Objective:** `run-recovery.test.ts` proves the recovery of a cut run and of a later fix without a process.

**Files:** `backend/__tests__/infrastructure/run-recovery.test.ts` (create),
`backend/__tests__/infrastructure/fixtures/in-process-run.ts` (modify),
`backend/__tests__/infrastructure/run-recovery-real-process.test.ts` (delete),
`backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` (modify). Also the ratchet list
and the ledger (modify).

No code — every file lives under `backend/__tests__`, so its signatures travel in prose and its body by TDD.

`InProcessRun` gains three members. `journaled(steps)` writes the admission, the planner record
and the manifest directly in the state. It then writes one finished command per step, chained by
`previous`, with the stdout of `oracle.announce`. `recorded(call)` writes a call directory with
its descriptor, prompt, empty stream and stderr, and completion.

`recovery()` composes `RunPlanRecovery` and `RecordedPlanRecovery` over one `ActivePlans`. It
uses a `ReviewWatch` double that counts `startRecovered`, and the checkout double of
`RunDriverMother`.

The first case keeps the cut of `recoverCompletedResponses`, now over `agents()`. It asserts
`publications: 0, launches: 0, consumptions: 1` for both kinds. The second case is a substitute
of #563. It calls `journaled` up to `delivered`, then `recorded` with one `fix` call after
delivery. It does that in two runs, failed and successful. The failed completion carries
`'synthetic fix failed after delivery'`.

Delete `recoverCompletedResponses` from `RunDriverMother`, and every member and import of that
file that nothing uses after that. Remove `'infrastructure/run-recovery-real-process.test.ts'`
from `ProcessRatchet.LISTED`. Append two ledger rows: the kept name, and
`a later fix result overrides real delivered journal evidence after restart` to the new name.

**TDD:** `it('a later fix result overrides delivered journal evidence after restart')` expects the
failed run as `uncertain`, with that diagnostic, action `inspect`, and no watch. It expects the
successful run as `implementing` and watched, and zero launches and oracle verbs in both.

**Tests:** added: that case and
`'established recovery consumes rewritten citations and dirty scope amendments once'`. Removed on
purpose: none.

**Verification:** Recovery runs in process, and the file leaves the list.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-recovery.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/run-recovery-real-process.test.ts   # expected: exit 0
test -z "$(grep -l 'recoverCompletedResponses' backend/__tests__/infrastructure/fixtures/run-driver-mother.ts)"   # expected: exit 0
```

### Task 6 — the runtime cases in process

**Objective:** `run-driver-runtime.test.ts` proves legacy recovery, the legacy fix and the kept driver ownership without a process.

**Files:** `backend/__tests__/infrastructure/run-driver-runtime.test.ts` (create),
`backend/__tests__/infrastructure/run-driver-runtime-real-process.test.ts` (delete),
`backend/__tests__/infrastructure/fixtures/in-process-run.ts` (modify). Also the ratchet list and
the ledger (modify).

No code — every file lives under `backend/__tests__`, so its signatures travel in prose and its body by TDD.

The legacy cases write the records of `LegacyRuntimeFixture` into the state through `recorded`,
and call `recovery().recover()`. The metric check reads `ActivePlans.known()` twice. For the
review case, `recovery()` takes the real `ReviewWatch` as an option. Its `asked` port answers
review `'701'` once, and its `review` port runs the real `RequestFixes`.

`RequestFixes` gets a `PlanIssues` double that answers `in-review` and a `Workbench` double that
records `reopen`. The case expects one `reopen` for issue 41 in place of the three `gh` argv. The
plugin script runs that edit, not the backend.

The ownership case is a substitute of #563. It calls `journaled` with `implement`, `controls` and
`refused`, and `recorded` with the implementation call. After `recover()` it expects the same
call names and journal bytes, zero review reads, and one plan `uncertain` with the refusal
diagnostic and action `inspect`.

Remove `'infrastructure/run-driver-runtime-real-process.test.ts'` from `ProcessRatchet.LISTED`.
Append four ledger rows. The watcher case maps `through the runtime watcher` to
`through the review watcher`, and `runtime recovery keeps recorded driver ownership without another launch`
maps to the name below. The census case of #563,
`the recovery read census distinguishes the captured harvest query from the review watcher query`,
reads `deleted without substitute — decided`. Append also the row of Task 2's removed
case, `fixture setup failures restore absent and present environment values without leaked roots`
of `run-dispatch-real-process.test.ts`, with the same substitute cell.

**TDD:** `it('recovery keeps recorded driver ownership without another launch')` expects
`workers.launches` at 0 and the journal bytes equal to the bytes before `recover()`.

**Tests:** added: `'legacy record recovery preserves original call argv and response identity'`,
`'a new review request resumes the completed legacy conversation through the review watcher'` and
that case. Removed on purpose: none.

**Verification:** The runtime cases run in process, and the file leaves the list.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-driver-runtime.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/run-driver-runtime-real-process.test.ts   # expected: exit 0
test "$(grep -c 'run-dispatch-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 8   # expected: exit 0 — the dispatch file is whole in the ledger
```

## 8. Global verification

The whole backend suite runs once with the four new files in it. The three old files are off
the list, and the ledger names every lost case.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run   # expected: exit 0 — the whole backend suite
test -z "$(grep -l 'run-dispatch-real-process\|run-recovery-real-process\|run-driver-runtime-real-process' backend/__tests__/infrastructure/fixtures/process-ratchet.ts)"   # expected: exit 0 — none of the three is listed
test "$(grep -c '^| `__tests__/infrastructure/run-' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 16   # expected: exit 0 — sixteen rows for this family
```

## 9. Assumptions

1. The issue names four files. `run-driver-real-process.test.ts` no longer exists, so its one
   owed case stands for it. Provenance: issue, "Contexto heredado".
2. The acceptance criterion on the coverage baseline stays in the issue, but the owner dropped
   it. So no task measures coverage. Provenance: issue, "Contexto heredado".
3. D-8 names `backend/__tests__/captures/<tool>/`. The reader of #549 reads
   `backend/__tests__/infrastructure/captures/<tool>/`, so new captures go there. Provenance: repo.
4. No real `gh` capture can feed a review request. The last 60 pull requests of the repository
   carry only `APPROVED` reviews, and a capture of an `issue edit` would change GitHub. So the
   review case doubles the `asked` port of `ReviewWatch` and the `Workbench` and `PlanIssues`
   ports. `gh-pull-requests.test.ts` keeps the `gh` argv of those reads. Provenance: own call.
5. The two owed admission cases prove the same path in process. So one test replaces both, and
   slice #5 proves that `ct-api.ts` composes `RunPlanAgents`. Provenance: own call, spec table.
6. `ScriptedClaude` writes a bare `PASS` verdict, because `ClaudeRunCalls` only asks that the
   file exists. The scripted oracle reads no verdict. Provenance: own call, `simplicity.md`.
7. The census case of the runtime file tested the old fixture. PR #563 sent it to nobody, and
   its row records that decision. Provenance: PR #563.
8. `InProcessWorkers` imports `headless-call-worker.ts`, which imports the border. The ratchet
   follows imports under `__tests__` only, and the worker never calls the border here, because
   its `spawn` and `kill` are doubles. Provenance: repo.
9. The controls of `ct-step` refuse a task that declares a removed test while a staged file
   still names it. The ledger row of that test names it, as the ledger demands. So the row of
   Task 2's removed case lands in Task 6, which removes no test by that name. The controls then
   measure the test files alone. Provenance: `ct-step controls` of Task 2, attempt 1.
10. The review round runs the verification of every task again, on the final tree. So Task 2
    counts at least seven dispatch rows, not exactly seven. Task 6 and §8 keep the exact count
    of eight. Provenance: `ct-step controls` of the review round, attempt 2.
