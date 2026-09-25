# #551 — restart recovery runs in process

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`restart-recovery-real-process.test.ts` started the whole `ct-api.ts` twice as a child and killed
the first life. PR #563 deleted it with the loose entrance of `POST /start-plan`, so the file is
already off `ProcessRatchet.LISTED`. Its two cases of *a crash of the backend with work in flight*
have no substitute yet. This slice owes them.

The acceptance criteria also ask for one in-process test for each rule of
`backend/conventions/this-repository.md:119-141`. That span holds twelve rules. Seven of them
already have an in-process test. Five do not, because only
`checked-run-delivery-real-process.test.ts` and `run-plan-recovery.test.ts` prove them, and both
files launch processes. This slice adds the five.

| Rule of lines 119-141 | In-process test |
|---|---|
| R1 · a dead leader alone does not authorize a retry while its group lives | new, Tasks 3 and 4 |
| R2 · termination evidence permits a retry, never a delivery claim | new, Task 4 |
| R3 · progress shows local completion as publication pending | `read-implementation-progress.test.ts > a driver run completed only locally is shown as publishing, with an existing PR if known` |
| R4 · a living process group reads as publishing, never uncertain | new, Task 3 |
| R5 · no read waits for a publication or starts one; the clock starts it | new, Task 2; the clock half is `work-recovery-clock.test.ts > recovers without browser requests and schedules the next scan only after the current scan settles` |
| R6 · the clock hands a refused publication to a person | new, Task 2 |
| R7 · inventory and progress only inspect | `inspected-work-inventory.test.ts > never reads an active slice as finished, and does not look for its harvest`, and the read case of Task 2 |
| R8 · a proven receipt answers later reads; a merged pull request stays delivered | new, Task 5 |
| R9 · durable provenance chooses compatibility behavior | `run-plan-agents.test.ts > a machine admission publishes before the first oracle call` |
| R10 · legacy delegation needs its exact evidence; everything else refuses | `run-plan-agents.test.ts > missing admission never downgrades driver call provenance` |
| R11 · restart recovery reads the records first; unowned work stays inspect only | `run-plan-agents.test.ts > restart preserves recorded ownership without migrating a conversation`, and Task 1 |
| R12 · a ct-step request with no receipt: active while owned, interrupted when not | `ct-run-machine.test.ts > a command nobody owns is closed as interrupted and the run continues through ct-step next` |

A restart is a new instance over the same state directory. `InProcessRun.recovery()` already builds
a new `RunPlanAgents`, `RecordedPlanRecovery` and `RunPlanRecovery` over the same `state`, so each
call of it is one life of the backend.

### Desired end state

- `ProcessRatchet.LISTED` does not name `restart-recovery-real-process.test.ts`, and no such file exists.
- Each rule of the table above has an in-process test that launches no process.
- `restart-recovery.test.ts` and `checked-run-delivery-process-groups.test.ts` exist under
  `backend/__tests__/infrastructure/`, and the ratchet test finds no process in them.
- The ledger has one row for each of the two cases that PR #563 owed to this slice.
- The ratchet test, the ledger test, `npm run typecheck` and the backend suite pass.

### Out of scope

- `plugin/` and `frontend/`: nothing under them changes.
- `checked-run-delivery-real-process.test.ts` stays as it is, on the list. Slice #4 migrates it.
- The new PTY terminal after a restart. Slice #7 puts the PTY behind `ProcessTable`.
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
| A substitute of #563 | `it does not set up its scenario through another feature. The admitted plan is built directly in the state, never with a POST (neither the milestone entrance nor any other).` |
| The ProcessTable double | `LivingProcessGroups extends ProcessTable`; its `signal` is the one liveness answer of every new test |
| One life of the backend | one call of `InProcessRun.recovery()`; a second call over the same `InProcessRun` is the restart |
| Where captures live | `backend/__tests__/infrastructure/captures/<tool>/`, the directory that `Capture.read` reads |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `backend/__tests__/infrastructure/run-driver-runtime.test.ts` composes a
recovery over `InProcessRun` and asserts zero launches.
`backend/__tests__/infrastructure/fixtures/in-process-run.ts` writes the admission, the journal
and the call records straight into the state.
`backend/__tests__/infrastructure/checked-run-delivery-recorded-pull-request.test.ts` builds a
`CheckedRunDelivery` in process over publication files that the test writes.
`backend/__tests__/infrastructure/fixtures/scripted-conversation.ts` holds `ScriptedConversation`
and `Capture`. `backend/__tests__/run-delivery-double.ts` holds `CompletedRunDelivery`.

Rules to obey: `CLAUDE.md`, `docs/language.md`, `docs/glossary.md`,
`backend/conventions/this-repository.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/boundaries.md`, `plugin/conventions/decisions.md`,
`plugin/conventions/defects.md`, `plugin/conventions/domain.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/style.md`,
`plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/__tests__/infrastructure/fixtures/in-process-run.ts` | modify | tasks 1, 2, 4 | none (prose) |
| `backend/__tests__/infrastructure/fixtures/in-process-workers.ts` | modify | Task 1 | none (prose) |
| `backend/__tests__/infrastructure/restart-recovery.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/run-delivery-double.ts` | modify | Task 2 | none (prose) |
| `backend/__tests__/infrastructure/fixtures/living-process-groups.ts` | create | tasks 3, 4, 5 | none (prose) |
| `backend/__tests__/infrastructure/checked-run-delivery-process-groups.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/captures/git/*.txt`, `captures/gh/*.txt` | create | tasks 3, 4, 5 | prose (a capture) |
| `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` | modify | `ledger.test.ts` and the judges | prose (one row per case) |

## 5. Interfaces

Consumes: from slice #2, `InProcessRun` with `create(steps, delivery?)`, `agents()`,
`journaled(steps)`, `recorded(call)`, `recovery()`, `settled()` and `remove()`, and
`InProcessWorkers` with `launches`. From slice #1, `ProcessTable['signal']`,
`ScriptedConversation`, `UnscriptedRequest` and `Capture.read(tool, name)`.

Produces: for slices #4 to #8, all under `backend/__tests__/`.
`LivingProcessGroups extends ProcessTable`, with `alive: Set<number>` and `asked: number[]`.
`RefusedRunDelivery extends CompletedRunDelivery`, with `asked: PlanWatch[]`.
`InProcessWorkers.kills`, a number.

Also on `InProcessRun`: `admitted(): Promise<PlanWatch>`, `intended(watch, sha): Promise<void>`,
and `checkedDelivery(asked: { git: ScriptedConversation, table: ProcessTable }): CheckedRunDelivery`.

## 6. Test strategy

Every task runs `npm run typecheck` and `npx vitest run` over the files it touches, from
`backend/`. `env -u CT_STATE_DIR` goes in front of every `npx vitest run`, because a
`CT_STATE_DIR` of the shell leaks into the remaining real process tests.

Each task writes its test first and watches it fail. `process-ratchet.test.ts` then proves that
the new files launch nothing. `ledger.test.ts` proves the format of each new row.

No new test declares a per-test timeout, because nothing in them waits on a child. A capture
comes from one real run of the command it names. Its header carries that command, the output of
`<tool> --version`, the date and the exit code.

## 7. Tasks

### Task 1 — a restart over the same state launches nothing

**Objective:** `restart-recovery.test.ts` proves the two cases that PR #563 owed, with a restart as a new recovery over the same state.

**Files:** `backend/__tests__/infrastructure/restart-recovery.test.ts` (create),
`backend/__tests__/infrastructure/fixtures/in-process-run.ts` (modify),
`backend/__tests__/infrastructure/fixtures/in-process-workers.ts` (modify). Also the ledger (modify).

No code — every file lives under `backend/__tests__`, so its signatures travel in prose and its body by TDD.

`InProcessRun.admitted()` prepares the watch and admits it, as the first lines of `journaled` do.
It records no call and writes no manifest. `journaled` then calls `admitted()` for those lines.
`InProcessWorkers` gains `kills`, a number, and its `kill` adds one to it before it throws.

The arrange of both cases is the same. Call `admitted()`, then `recorded` with `purpose: 'plan'`,
`requestId: null`, `argv: ['--session-id', watch.agent]`, `execution: null` and `startedAt` at
the current time. That call is the planner that the crash cut. Keep the bytes of each file of the
state directory.

The first case calls `recovery().recovery.recover()`. The second case also calls
`agents().recover()` for the watch two times, with the same located plan. Each call is a
new instance, so no instance owns the planner.

**TDD:** `it('a restart over the same state gives back the dispatched plan as uncertain and launches nothing')`
expects one plan in `activePlans`, phase `uncertain` and action `inspect`. The diagnostic, with each
call id replaced by `<call>`, is
`incomplete call <call> is not owned by this API process; plan call <call> is incomplete within its recorded deadline`.
It also expects `workers.launches` and `workers.kills` at 0, and each file of the state with its bytes.

**Tests:** added: that case, and
`'a recovery pressed after a restart is refused as often as it is pressed, naming the ownership the restart took away'`.
The second case expects each press to reject with `PlanRecoveryConflict`. The message ends
with `; the planner is not owned by this API process`. It expects zero launches, and the plan still `uncertain`.
Removed on purpose: none.

Append two ledger rows. The first case of
`__tests__/infrastructure/restart-recovery-real-process.test.ts` is
`gives back every record it had written, opens a new terminal, and reaps nothing it had started`.
The second is `refuses the recovery as often as it is pressed, naming the ownership the crash took away`.
Each maps to the new test of the same order.

**Verification:** Both cases run in process, and each has its ledger row.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/restart-recovery.test.ts __tests__/infrastructure/run-driver-runtime.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'restart-recovery-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 2   # expected: exit 0
```

### Task 2 — a read neither waits for a publication nor starts one

**Objective:** `restart-recovery.test.ts` proves that a read starts no publication and that a refused publication goes to a person.

**Files:** `backend/__tests__/infrastructure/restart-recovery.test.ts` (modify),
`backend/__tests__/run-delivery-double.ts` (modify).

No code — every file lives under `backend/__tests__`, so its signatures travel in prose and its body by TDD.

`RefusedRunDelivery extends CompletedRunDelivery`. Its `inspection` is
`{ kind: 'publishing', pullRequest: null, diagnostic: null }`. Its `deliver` pushes the watch to
`asked`. It then rejects with `RunDeliveryFailure(RefusedRunDelivery.REFUSAL)`, where
`static REFUSAL = 'the scripted checked release refused the delivery'`.

Both cases call `InProcessRun.create(steps, delivery)`, then `journaled` up to `delivered`.
The steps are `implement`, `controls`, `judge`, `commit`, `reconcile-clean`, `global`,
`slice-judge` and `delivered`.

The read case takes a `CompletedRunDelivery` whose `inspection` is the publishing value above,
and whose `deliver` never settles. It calls `recovery().recovery.inspect()` only.

The clock case takes a `RefusedRunDelivery`. It calls `recover()` two times on one life, as two
ticks of the recovery clock do, and awaits `run.settled()` between them.

**TDD:** `it('a read of a publication neither waits for it nor starts it')` expects `inspect()`
to resolve with `null`, `delivery.delivered` empty, and the plan in phase `implementing`.

**Tests:** added: that case, and
`'the recovery clock hands a refused publication to a person instead of another start on the next tick'`.
The second case expects `asked` with one watch after both ticks. It expects the plan
`uncertain`, with action `continue` and the diagnostic `RefusedRunDelivery.REFUSAL`.
Removed on purpose: none.

**Verification:** Both publication cases run in process.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/restart-recovery.test.ts __tests__/infrastructure/process-ratchet.test.ts   # expected: exit 0
```

### Task 3 — a living process group reads as publishing

**Objective:** `checked-run-delivery-process-groups.test.ts` proves that a publication whose group lives reads as publishing, even when its leader is dead.

**Files:** `backend/__tests__/infrastructure/fixtures/living-process-groups.ts` (create),
`backend/__tests__/infrastructure/checked-run-delivery-process-groups.test.ts` (create),
`backend/__tests__/infrastructure/fixtures/in-process-run.ts` (modify). Also one git capture (create).

No code — every file lives under `backend/__tests__`, so its signatures travel in prose and its body by TDD.

`LivingProcessGroups extends ProcessTable`. Its `signal(pid, signal)` pushes `pid` to `asked`.
It returns when `signal` is `0` and `alive` holds `pid`. Otherwise it throws an error whose
`code` is `ESRCH`. A group is its negative number in `alive`, and a leader its positive number.
`readTable` and `openTerminal` throw `UnscriptedRequest`.

`InProcessRun.checkedDelivery({ git, table })` builds the real `CheckedRunDelivery` over the
journal and the machine of the run. Its `git` is a `ToolRunner` over `git`, and its `signal` is
`table.signal`. Its `gh` and its `node` throw `UnscriptedRequest`.

`InProcessRun.intended(watch, sha)` writes `intent.json` under the publication of the watch.
Each field holds what `CheckedRunDelivery` writes for this run. `machineDigest` is the digest of
`journal.manifest` and `journal.entries` that `#requireIntentIdentity` checks.

The arrange writes `journaled` up to `delivered`, `intended`, and one push attempt with its request
and `owner.json`, with `processGroup` 4242 and no result. The capture
`captures/git/ls-remote-absent-branch.txt` comes from `git ls-remote --heads origin refs/heads/feat/7`
over a scratch origin with no such branch.

**TDD:** `it('a living process group reads as publishing and never as uncertain')` expects
`inspect()` to equal
`{ kind: 'publishing', pullRequest: null, diagnostic: 'push process group 4242 is still running' }`,
with `alive` holding `-4242` and `4242`.

**Tests:** added: that case, and `'a dead leader with a living group still reads as publishing'`.
The second case holds only `-4242` in `alive`, and expects the same value.
Removed on purpose: none.

**Verification:** The group cases run in process.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/checked-run-delivery-process-groups.test.ts __tests__/infrastructure/process-ratchet.test.ts   # expected: exit 0
test "$(head -n 1 backend/__tests__/infrastructure/captures/git/ls-remote-absent-branch.txt)" = "command: git ls-remote --heads origin refs/heads/feat/7"   # expected: exit 0
```

### Task 4 — a retry waits for termination and claims nothing

**Objective:** `checked-run-delivery-process-groups.test.ts` proves that only termination evidence permits a push retry, and that a failed retry claims no delivery.

**Files:** `backend/__tests__/infrastructure/checked-run-delivery-process-groups.test.ts` (modify).
Also the git captures that `deliver()` asks for (create).

No code — the two cases reuse the arrange of Task 3 and call `deliver()`.

Each git request that `deliver()` asks before the push gets its capture from the same scratch
repository. Take each capture from the `UnscriptedRequest` that names it, one at a time. The
retry push gets `captures/git/push-rejected.txt`. It comes from a real
`git push origin <sha>:refs/heads/feat/7` that the scratch origin refuses, with a nonzero exit.

**TDD:** `it('a dead leader alone does not authorize a retry while its group lives')` holds only
`-4242` in `alive`. It expects `deliver()` to reject with `RunDeliveryUncertain`, with the message
`push process group 4242 may still be running`. It expects no `push` request to the scripted git, and
no `disposition.json`.

**Tests:** added: that case, and
`'termination evidence permits a retry and never claims delivery'`. The second case holds nothing in
`alive`. It expects a `disposition.json` of kind `terminated` with `processGroup` 4242. It expects
one `push` request, a rejection with `RunDeliveryFailure`, no `receipt.json`, and an `inspect()`
whose kind is not `delivered`. Removed on purpose: none.

**Verification:** The retry cases run in process.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/checked-run-delivery-process-groups.test.ts __tests__/infrastructure/process-ratchet.test.ts   # expected: exit 0
test "$(head -n 1 backend/__tests__/infrastructure/captures/git/push-rejected.txt | cut -c 1-26)" = "command: git push origin "   # expected: exit 0
```

### Task 5 — a proven receipt answers later reads by itself

**Objective:** `checked-run-delivery-process-groups.test.ts` proves that a proven receipt answers a second read without GitHub, and that a merged pull request stays delivered.

**Files:** `backend/__tests__/infrastructure/checked-run-delivery-process-groups.test.ts` (modify).
Also `backend/__tests__/infrastructure/captures/gh/graphql-pull-requests-merged.txt` (create).

No code — the scenario lives in the test file and its body comes by TDD.

The capture comes from the exact `gh api graphql` request of `#pullCandidates`, over
`owner=mercadona`, `name=control-tower` and `headRefName=feat/550`. GitHub merged that pull request, #605.

These cases do not use `InProcessRun`, because its repository is `acme/widget`. They write the
publication of a delivered slice, as `DeliveredJournalMother` does in
`checked-run-delivery-recorded-pull-request.test.ts`. The repository, issue, branch, base and
revision come from the capture. The root and the worktree exist on disk, because the intent check
resolves them with `realpath`. The `gh` of the delivery answers from a `ScriptedConversation`.
`git` throws `UnscriptedRequest`, and `signal` is a `LivingProcessGroups` with nothing alive.

**TDD:** `it('a proven receipt answers later reads without asking GitHub again')` calls `inspect()`
two times on one delivery. It expects `delivered` with pull request 605 both times, and one `gh` request.

**Tests:** added: that case, and
`'a merged pull request still reads as delivered once the branch and the issue are closed'`.
The second case expects `delivered` with pull request 605, and zero `git` requests, since the
branch is gone. Removed on purpose: none.

**Verification:** The receipt cases run in process.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/checked-run-delivery-process-groups.test.ts __tests__/infrastructure/process-ratchet.test.ts   # expected: exit 0
test "$(head -n 1 backend/__tests__/infrastructure/captures/gh/graphql-pull-requests-merged.txt | cut -c 1-26)" = "command: gh api graphql --"   # expected: exit 0
```

## 8. Global verification

The whole backend suite runs once with the two new files in it. The old file is off the list,
and the ledger names both of its cases.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run   # expected: exit 0 — the whole backend suite
test -z "$(grep -l 'restart-recovery' backend/__tests__/infrastructure/fixtures/process-ratchet.ts)"   # expected: exit 0 — the file is off the list
test ! -e backend/__tests__/infrastructure/restart-recovery-real-process.test.ts   # expected: exit 0
test "$(grep -c 'restart-recovery-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 2   # expected: exit 0
```

## 9. Assumptions

1. The first criterion holds before this slice starts: PR #563 deleted the file, and the list does
   not name it. §8 still measures it. Provenance: repo, `process-ratchet.ts`.
2. The coverage criterion stays in the issue, but the owner dropped it. So no task measures
   coverage. Provenance: issue, "Contexto heredado".
3. The span of lines 119-141 ends inside the sentence about `ct-step next`. R12 takes the whole
   sentence. Provenance: own call.
4. The old first case also asserted a new PTY terminal and the timeline of the coordinating session.
   `recover-coordinating-session.test.ts > appends a resumed event to the timeline it recalled and answers the whole history`
   proves the timeline in process. Slice #7 owns the PTY, so the substitute leaves the terminal out.
   Provenance: spec table, row #7.
5. The old cases asserted that the orphaned worker and agent kept running. No recovery class takes a
   process port, so the substitute asserts zero kills and zero launches in place of that. Provenance: repo.
6. R1, R2, R4 and R8 live in `CheckedRunDelivery`, whose real-process file slice #4 migrates. This
   slice adds one in-process test for each rule and leaves that file alone. Provenance: spec table.
7. D-8 names `backend/__tests__/captures/<tool>/`. The reader of #549 reads
   `backend/__tests__/infrastructure/captures/<tool>/`, so new captures go there. Provenance: repo.
8. The `gh` capture reads public metadata of a merged pull request, and changes nothing on GitHub.
   Provenance: own call.
