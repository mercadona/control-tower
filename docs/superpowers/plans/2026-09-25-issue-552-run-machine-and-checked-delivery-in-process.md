# #552 — the run machine and the checked delivery run in process

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

Two files of `ProcessRatchet.LISTED` belong to this slice.
`backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts` has three cases. It runs the
real `plugin/scripts/ct-step.mjs`, real git and a fake `claude` binary through
`fixtures/run-driver-mother.ts`. `backend/__tests__/infrastructure/checked-run-delivery-real-process.test.ts`
has fifteen `it` calls, and one of them is an `it.each` of four rows, so eighteen test names. It runs
real git over a bare origin, and `node -e` children as the checked release. It also runs the real
`dispatch-check.mjs` with a fake `gh` on `PATH`, and publisher children from
`fixtures/delivery-publisher.ts`.

`CheckedRunDelivery` takes each effect as a port: `git` and `node` are `Launch` functions, `gh` is a
`Gh`, and `signal` is `ProcessTable['signal']`. So every case except the two of the real plugin
executable can run in process over doubles. `InProcessRun.checkedDelivery` already builds the real
`CheckedRunDelivery` over a `ScriptedConversation` for git and a `ProcessTable`.

| Deleted case (old file) | Substitute |
|---|---|
| ct-run-machine: stale ticket, exit nine | existing `ct-run-machine.test.ts > oracle exit nine survives the adapter unchanged` |
| ct-run-machine: two vetoes, advice | new in `run-driver.test.ts`, Task 1 |
| ct-run-machine: merge conflict, reconciler | new in `run-driver.test.ts`, Task 1 |
| checked delivery: five publication cases | new in `checked-run-delivery.test.ts`, Task 2 |
| checked delivery: two creation cases | new, Task 3 |
| checked delivery: three release group cases | new, Task 4 |
| checked delivery: four result and push cases | new, Task 5 |
| checked delivery: the real gate, and its account isolation | deleted without substitute, Task 6 |
| checked delivery: merged, and the proven receipt | existing cases of `checked-run-delivery-process-groups.test.ts`, Task 6 |

### Desired end state

- `ProcessRatchet.LISTED` names neither file, and neither file exists.
- `fixtures/run-driver-mother.ts` and `fixtures/delivery-publisher.ts` do not exist, because only the two files used them.
- `backend/__tests__/infrastructure/checked-run-delivery.test.ts` exists, and the ratchet test finds no process in it.
- The ledger has one row for each of the 21 deleted test names.
- The ratchet test, the ledger test, `npm run typecheck` and the backend suite pass.

### Out of scope

- `plugin/` and `frontend/`: nothing under them changes.
- The text that `ct-step.mjs` renders: the advice package, the third brief and the reconciliation package. The plugin milestone owns those tests.
- The coverage comparison. The owner of the milestone dropped it as a gate on 2026-09-24.
- `backend/src/`: no production code changes, so `backend/API.md` reports no change.
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
| A restart | a new `CheckedRunDelivery` from a second call of `InProcessRun.checkedDelivery` over the same `InProcessRun` |
| Liveness | `LivingProcessGroups` answers every liveness question of the new cases; a group is its negative number in `alive` |
| Where captures live | `backend/__tests__/infrastructure/captures/<tool>/`, the directory that `Capture.read` reads |
| The release answer | the double prints the line that `CheckedRunDelivery` reads, `released #7 → in-review`; no captured file, and no run of `dispatch-check.mjs` |
| A test name that stays | a substitute keeps the old name unless the old name says `real`, `child` or `actual`; §7 names each rename |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `backend/__tests__/infrastructure/checked-run-delivery-process-groups.test.ts`
builds `CheckedRunDelivery` over `InProcessRun`, a `ScriptedConversation` for git and
`LivingProcessGroups`. `backend/__tests__/infrastructure/run-driver.test.ts` drives an admission
to delivery over `InProcessRun` and reads `run.claude.asked`.
`backend/__tests__/infrastructure/fixtures/scripted-conversation.ts` holds `ScriptedConversation`,
`ScriptedProcess`, `Capture` and `UnscriptedRequest`.
`backend/__tests__/infrastructure/fixtures/scripted-oracle.ts` announces every step with the plugin's renderers.

Rules to obey: `CLAUDE.md`, `docs/language.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/defects.md`,
`plugin/conventions/domain.md`, `plugin/conventions/simplicity.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/__tests__/infrastructure/run-driver.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts` | delete | nobody | none |
| `backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` | delete | nobody | none |
| `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` | modify | `process-ratchet.test.ts` | Current state |
| `backend/__tests__/infrastructure/fixtures/scratch-origin.ts` | create | tasks 2 to 5 | none (prose) |
| `backend/__tests__/infrastructure/fixtures/scripted-github.ts` | create | tasks 2 to 5 | none (prose) |
| `backend/__tests__/infrastructure/fixtures/scripted-release.ts` | create | tasks 2 to 5 | none (prose) |
| `backend/__tests__/infrastructure/fixtures/in-process-run.ts` | modify | tasks 2 to 5 | none (prose) |
| `backend/__tests__/infrastructure/checked-run-delivery.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/captures/git/*.txt` | create | tasks 2, 5 | prose (a capture) |
| `backend/__tests__/infrastructure/checked-run-delivery-real-process.test.ts` | delete | nobody | none |
| `backend/__tests__/infrastructure/fixtures/delivery-publisher.ts` | delete | nobody | none |
| `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` | modify | `ledger.test.ts` and the judges | prose (one row per case) |

## 5. Interfaces

Consumes: from slice #3, `InProcessRun` with `create(steps, delivery?)`, `agents()`, `journaled(steps)`,
`intended(watch, sha)` and `checkedDelivery({ git, table })`, and `LivingProcessGroups` with `alive`
and `asked`. From slice #1, `ScriptedConversation`, `ScriptedProcess`, `UnscriptedRequest` and
`Capture.read(tool, name)`.

Produces: for slices #5 to #8, all under `backend/__tests__/infrastructure/fixtures/`.
`ScratchOrigin extends ScriptedConversation`, with `remote`, `pushes`, `holdNextPush()` and `advance(sha)`.
`ScriptedGitHub`, with `gh: Gh`, `pulls`, `queries`, `issueReads`, `labels`, `holdNextCreate(order)` and `merge()`.
`ScriptedRelease`, with `node`, `releases` and `next(outcome)`.
`InProcessRun.checkedDelivery({ git, table, github?, release? })`.

## 6. Test strategy

Every task runs `npm run typecheck` and `npx vitest run` over the files it touches, from
`backend/`. `env -u CT_STATE_DIR` goes in front of every `npx vitest run`, because a
`CT_STATE_DIR` of the shell leaks into the remaining real process tests.

Each task writes its test first and watches it fail. `process-ratchet.test.ts` then proves that
the new files launch nothing. `ledger.test.ts` proves the format of each new row.

No new test declares a per-test timeout, because nothing in them waits on a child. A capture
comes from one real run of the command it names, over a scratch repository and a bare origin.
Its header carries that command, the output of `git --version`, the date and the exit code.

## 7. Tasks

### Task 1 — the advisor and the reconciler rounds run in process

**Objective:** `run-driver.test.ts` proves the advisor and reconciler rounds in process, and the old run machine file leaves the ratchet list.

**Files:** `backend/__tests__/infrastructure/run-driver.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).
Delete `backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts` and
`backend/__tests__/infrastructure/fixtures/run-driver-mother.ts`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 15-17):
```ts
    'infrastructure/ct-api-real-process.test.ts',
    'infrastructure/ct-run-machine-real-process.test.ts',
    'infrastructure/git-workspace-real-process.test.ts',
```

Remove the middle line. Both cases call `InProcessRun.create(steps, delivery)` with the
`AwaitedDelivery` of the file, then `run.agents().launch(...)`, and await `delivery.settled`.
The advisor steps are `implement`, `advise`, `implement`, `controls`, `judge`, `commit`,
`reconcile-clean`, `global`, `slice-judge` and `delivered`. The reconciler steps are
`implement`, `controls`, `judge`, `commit`, `reconcile`, `global`, `slice-judge` and `delivered`.
Import `ADVICE_SCHEMA`, `ADVISOR_TOOLS` and `RECONCILER_TOOLS` from `plugin/scripts/step-contracts.js`.

**TDD:** `it('an advise round reaches the advisor with the paths, tools and schema its dispatch announced')`
expects one request of role `ct-advisor` in `run.claude.asked`. Its argv holds `--tools`,
`ADVISOR_TOOLS`, `--allowedTools`, `ADVISOR_TOOLS` and `--json-schema`, `JSON.stringify(ADVICE_SCHEMA)`.
Its prompt starts with `Read the listed files.` and names each input path the oracle wrote for `advise`.
Its call descriptor has a `requestId` that starts with `run:`.

**Tests:** added: that case, and
`'a reconcile round reaches the reconciler with the package its dispatch announced'`. The second
expects one request of role `ct-reconciler`, whose argv holds `--tools`, `RECONCILER_TOOLS`,
`--allowedTools`, `RECONCILER_TOOLS`. Its prompt names the `reconciliation-package` path. The
run reaches delivery. Removed on purpose: the three cases of the deleted file.

Append three ledger rows for `__tests__/infrastructure/ct-run-machine-real-process.test.ts`, in its order.
`a stale oracle ticket returns the real wrong-step exit nine` maps to
`__tests__/infrastructure/ct-run-machine.test.ts > oracle exit nine survives the adapter unchanged`.
`two real vetoes produce advice and the third plugin brief` maps to the advisor case.
`a real merge conflict uses the prepared reconciler package` maps to the reconciler case.

**Verification:** Both rounds run in process, and the old file is gone with its rows.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-driver.test.ts __tests__/infrastructure/ct-run-machine.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/fixtures/run-driver-mother.ts   # expected: exit 0
test "$(grep -c 'ct-run-machine-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 3   # expected: exit 0
```

### Task 2 — a whole publication runs in process

**Objective:** `checked-run-delivery.test.ts` proves a whole publication and its four corrupt records over scripted git, GitHub and release.

**Files:** under `backend/__tests__/infrastructure/`: `fixtures/scratch-origin.ts`, `fixtures/scripted-github.ts`,
`fixtures/scripted-release.ts` and `checked-run-delivery.test.ts` (create); `fixtures/in-process-run.ts` (modify). Also git captures and the ledger (modify).

No code — every file lives under `backend/__tests__`, so its signatures travel in prose and its body by TDD.

`ScriptedRelease` takes a `ScriptedGitHub`. It has `releases`, a list of `{ argv, cwd }`, and `node`, a `Launch`.
`next(outcome)` queues an outcome, and an empty queue answers `released`. `finish(output)` settles a held release.

An outcome is one of four kinds. `released` exits 0 with the stdout `released #7 → in-review`, and sets the labels to `status:in-review`.
`refused` calls `onSpawn` with its optional `group`, and exits 7 with the stderr `real gate refusal`.
`held` calls `onSpawn` with its `group` and waits for `finish`. `lost` calls `onSpawn` with its `group`, then rejects.

`ScriptedGitHub` has `gh`, a `Gh` over its own launch, with a zero-attempt `RetryPolicy`.
It answers `api graphql` from `pulls`, `pr create` with pull 41 of head `feat/7`, and `issue view` from `labels`.
Any other request throws `UnscriptedRequest`.
`holdNextCreate('before' | 'after')` returns a release function, and marks pull 41 `MERGED`, closes the issue and empties `labels`.

`ScratchOrigin extends ScriptedConversation`. It answers `ls-remote` and `push` from its `remote` field, and `advance(sha)` moves it.

`InProcessRun.checkedDelivery` gains two optional fields, `github` and `release`. When one is absent, the delivery keeps the refusing port of today.

The arrange writes `journaled` up to `delivered`, and `intended` with the sha of `rev-parse-worktree-pinned`.
Each new git answer gets its capture from the `UnscriptedRequest` that names it, one at a time.

**TDD:** `it('pins and pushes the revision, creates one exact PR, and retries only the checked release')`
queues `refused`, then `released`. It expects one pull, two releases and the remote at the sha.
A second `deliver` asks for no third release. `inspect()` gives `delivered` with pull 41, also after `advance(sha)` of a review fix.

**Tests:** added: that case, and the `it.each` `'keeps %s inspection-only instead of manufacturing delivery'`
over `malformed receipt`, `orphan release result`, `wrong release command` and `failed release predecessor`.
Each keeps the assertions of its old case. Removed on purpose: none.

Append five ledger rows. Each case of `__tests__/infrastructure/checked-run-delivery-real-process.test.ts`
maps to the case of the same name in `__tests__/infrastructure/checked-run-delivery.test.ts`.

**Verification:** The publication cases run in process, and each has its ledger row.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/checked-run-delivery.test.ts __tests__/infrastructure/checked-run-delivery-process-groups.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'checked-run-delivery-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 5   # expected: exit 0
```

### Task 3 — a pull request creation in flight stays unique

**Objective:** `checked-run-delivery.test.ts` proves that an interrupted creation gives one pull, and that only its own creation reads as in flight.

**Files:** `backend/__tests__/infrastructure/checked-run-delivery.test.ts` (modify). Also the ledger (modify).

No code — the two cases reuse the arrange of Task 2, with `holdNextCreate` of `ScriptedGitHub`.

**TDD:** `it('adopts the single PR created before an interrupted response instead of creating another')`
holds the creation with `before`. It expects one pull, a restart that rejects with `checked release failed`,
and a next restart that delivers. After the release of the hold, the first `deliver` rejects with `conflicting journal evidence`.

**Tests:** added: that case, and `'reads a live publication as publishing and only its own pull request creation as in flight'`.
The second holds the creation with `after`. The same delivery reads
`{ kind: 'publishing', pullRequest: null, diagnostic: 'pull request creation is in flight' }`.
A restart reads `{ kind: 'uncertain', pullRequest: null, diagnostic: 'pull request creation has an unknown effect' }`.
Removed on purpose: none.

Append two ledger rows. Each old case maps to the case of the same name in the new file.

**Verification:** The creation cases run in process, and each has its ledger row.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/checked-run-delivery.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'checked-run-delivery-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 7   # expected: exit 0
```

### Task 4 — a living release group holds back the next release

**Objective:** `checked-run-delivery.test.ts` proves that no second release starts while the group of an earlier release lives.

**Files:** `backend/__tests__/infrastructure/checked-run-delivery.test.ts` (modify). Also the ledger (modify).

No code — the three cases reuse the arrange of Task 2, with `ScriptedRelease` outcomes and `LivingProcessGroups`.

The group of each case is 4343. A case puts `-4343` in `alive` for a living group, and removes it for a gone group.

**TDD:** `it('does not start a second checked release while the recorded release group is alive')`
queues `held` with group 4343. While it holds, a restart gives `inspect()` of kind `publishing`, with
a diagnostic that contains `is still running`. It expects one release. Then `finish` with exit 9 rejects
the first `deliver` with `checked release failed`, and a restart delivers with a second release.

**Tests:** added: that case,
`'does not replay a failed release result while its owned process group has a live descendant'` and
`'loses the result writer, waits for the surviving checked-release group, and survives another lost retry writer'`.
The second queues `refused` with group 4343 and keeps `-4343` alive. It expects `inspect()` to say
`process group 4343 is still running`, a `deliver` rejection with `may still be running`, and one release.
With the group gone, a restart delivers with two releases.

The third queues `lost`, then `lost` again, then `released`. A restart while the group lives rejects
with `may still be running`. The final restart delivers with pull 41, and two `disposition.json` files exist.
Removed on purpose: none.

Append three ledger rows, in the order above. The first old name is
`does not start a second checked release while the recorded child is really alive`.
The other two old names equal their new names.

**Verification:** The group cases run in process, and each has its ledger row.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/checked-run-delivery.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'checked-run-delivery-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 10   # expected: exit 0
```

### Task 5 — a failed result and a held push wait for their evidence

**Objective:** `checked-run-delivery.test.ts` proves that a refusal, a pending result, a bad disposition and a held push claim no delivery.

**Files:** `backend/__tests__/infrastructure/fixtures/scratch-origin.ts` (modify),
`backend/__tests__/infrastructure/checked-run-delivery.test.ts` (modify). Also the ledger (modify).

No code — `holdNextPush()` of `ScratchOrigin` returns a release function, and the held push closes with the capture `push-rejected`.

**TDD:** `it('does not repeat a held push after restart and continues once its group terminates')`
holds the first push, and puts the group of its `owner.json` in `alive`. A restart rejects with
`may still be running`, with one push and no pull. With the group gone, the first `deliver` rejects with
`git push failed`. A restart then delivers, with two pushes and one pull.

**Tests:** added: that case, `'persists a refusal from the checked release without claiming delivery'`,
`'keeps inspection read-only while a failed owned release result is pending and accepts its bound disposition'`
and `'refuses an invalid disposition paired with a valid failed result'`.
The refusal case queues `refused`, and expects the labels still `status:in-progress` and `inspect()` of kind `publishing`.

The pending case queues `held`, then `finish` with exit 7. Before `finish`, it expects `publishing` and zero dispositions.
It then writes the disposition of attempt 1, and a restart delivers with two releases.
The invalid case writes a disposition with `ownerDigest` of 64 zeros. It expects a rejection with
`termination disposition is malformed or unbound`, and one release.
Removed on purpose: none.

Append four ledger rows. The old names of the push and the refusal cases are
`does not repeat a held push after restart and continues once its child terminates` and
`persists a refusal from the actual checked release gate without claiming delivery`.
The other two old names equal their new names.

**Verification:** The result cases run in process, and each has its ledger row.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/checked-run-delivery.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'checked-run-delivery-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 14   # expected: exit 0
```

### Task 6 — the old checked delivery file leaves the ratchet list

**Objective:** The old checked delivery file and its publisher go away, with the ledger rows of their last four cases.

**Files:** `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).
Delete `backend/__tests__/infrastructure/checked-run-delivery-real-process.test.ts` and
`backend/__tests__/infrastructure/fixtures/delivery-publisher.ts`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 9-11):
```ts
  static readonly LISTED: readonly string[] = [
    'infrastructure/checked-run-delivery-real-process.test.ts',
    'infrastructure/claude-calls-real-process.test.ts',
```

Remove the middle line.

**TDD:** No TDD — this task deletes a file, and `process-ratchet.test.ts` already fails on a listed file that is gone.

**Tests:** added: none. Removed on purpose: the eighteen cases of the deleted file.

Append four ledger rows. `runs the actual checked release executable through a persistent external GitHub boundary`
and `isolates the real gate from an unrelated inherited account marker` read `deleted without substitute — decided`.
`keeps reading a merged delivery as delivered once the branch and the issue are closed` maps to
`__tests__/infrastructure/checked-run-delivery-process-groups.test.ts > a merged pull request still reads as delivered once the branch and the issue are closed`.
`proves the receipt once and answers later reads without asking GitHub again` maps to
`__tests__/infrastructure/checked-run-delivery-process-groups.test.ts > a proven receipt answers later reads without asking GitHub again`.

**Verification:** Neither file exists, the list does not name the old one, and the ledger names all eighteen cases.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/checked-run-delivery-real-process.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/fixtures/delivery-publisher.ts   # expected: exit 0
test "$(grep -c 'checked-run-delivery-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 18   # expected: exit 0
```

## 8. Global verification

The whole backend suite runs once with the new cases in it. Both old files are off the list.
The ledger names all 21 old cases.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run   # expected: exit 0 — the whole backend suite
test -z "$(grep -l 'ct-run-machine-real-process\|checked-run-delivery-real-process' backend/__tests__/infrastructure/fixtures/process-ratchet.ts)"   # expected: exit 0 — both files are off the list
test ! -e backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/checked-run-delivery-real-process.test.ts   # expected: exit 0
test "$(grep -c 'real-process.test.ts > ' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 39   # expected: exit 0 — 18 earlier rows and 21 new rows
```

## 9. Assumptions

1. The coverage criterion stays in the issue, but the owner dropped it. So no task measures
   coverage. Provenance: issue, "Contexto heredado".
2. The advice package, the third brief and the reconciliation package come from `ct-step.mjs`.
   No pure renderer of the plugin makes them, so D-9 gives the backend no way to test them in
   process. The substitutes keep what the backend owns: the crossing from dispatch to the call.
   Provenance: repo, `plugin/scripts/ct-step.mjs`.
3. The two cases of the real `dispatch-check.mjs` test the plugin script, not the backend. D-3
   forbids the process, and D-2 leaves the plugin to its milestone. So they go without a substitute.
   Provenance: own call.
4. The release line `released #7 → in-review` is a string of `dispatch-check.mjs`, and no
   renderer exports it. The double prints the same line that `CheckedRunDelivery` checks.
   Provenance: repo, `backend/src/infrastructure/checked-run-delivery.ts`.
5. The old merged and receipt cases already have in-process substitutes from slice #3. The
   ledger maps them to those cases. Provenance: repo, `checked-run-delivery-process-groups.test.ts`.
6. The old stale ticket case asserted exit nine and its refusal detail. The unit case
   `oracle exit nine survives the adapter unchanged` asserts both over the same adapter. Provenance: repo.
7. A lost writer in process is a release that records its owner and then rejects, so no result
   reaches the journal. Provenance: own call.
8. The ledger held 18 rows before this slice, and each names a `-real-process.test.ts` file. §8
   counts 39 rows for that reason. Provenance: repo, the ledger.
