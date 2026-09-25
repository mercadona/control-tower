# #555 — the PTY and the sessions run in process

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

Three files of `ProcessRatchet.LISTED` belong to this slice. Each one reaches a real process.

- `backend/__tests__/infrastructure/pty-live-sessions.test.ts` imports `SystemProcesses` from the border. Four of its cases read the process table through `border.readTable`, over a `vi.mock` of `node:child_process`.
- `backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts` has 12 cases. It opens real terminals with `node-pty` and reads `/bin/ps`.
- `backend/__tests__/infrastructure/session-channel-real-process.test.ts` has 3 cases. It serves `ApiServer` over `PtyLiveSessions` with real terminals.

`PtyLiveSessions` in `backend/src/infrastructure/pty-live-sessions.ts` takes `spawn`, `signal` and
`inspectProcessTable` as functions. `CtApi` binds all three to the `ProcessTable` of the host.
So a `ProcessTable` double can stand behind the PTY, and the doubles of `pty-live-sessions.test.ts` already do.

This slice moves each case in process, or records it in the ledger with its substitute.

### Desired end state

- `ProcessRatchet.LISTED` does not name the three files.
- `pty-live-sessions-real-process.test.ts` and `session-channel-real-process.test.ts` do not exist.
- `pty-live-sessions.test.ts` imports nothing from the border and mocks no `node:child_process`.
- `backend/__tests__/infrastructure/session-channel.test.ts` exists, and the ratchet test finds no process in it.
- The ledger has one row for each deleted case: 10 of `pty-live-sessions.test.ts`, 12 and 3 of the two old files.
- The ratchet test, the ledger test, `npm run typecheck` and the backend suite pass.

### Out of scope

- `plugin/` and `frontend/`: nothing under them changes.
- `backend/src/`: no module changes. So `backend/API.md` reports no change.
- A migration: this slice stores no new data, so no forward or rollback step exists.
- The coverage comparison. The owner of the milestone dropped it as a gate on 2026-09-24.
- `backend/__tests__/infrastructure/fixtures/scripted-terminals.ts`: it stays as it is.
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
| The files of this slice | the three listed files whose names start with `pty-live-sessions` or `session-channel` |
| How the PTY sits behind the port | a test builds `PtyLiveSessions` from one `ProcessTable` double, with the three bindings that `CtApi` uses |
| A ledger row of an `it.each` | one row for each expanded name, with `$name` replaced by its value |
| A test name that stays | a substitute keeps the old name unless the old name names what only a real process shows; §7 names each rename |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `backend/__tests__/infrastructure/pty-live-sessions.test.ts` holds `ControlledInspection`,
`ControlledProcesses`, `SpawnDouble`, `TerminalDouble`, `Cabin` and `TerminationMother`.
`backend/__tests__/infrastructure/fixtures/scripted-terminals.ts` shows a `ProcessTable` double with live terminals.
`backend/__tests__/infrastructure/session-stream-route.test.ts` reads the frames of the stream route.
`backend/__tests__/servers.ts` holds `RunningServers` and `Loopback`.

Rules to obey: `CLAUDE.md`, `docs/language.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/defects.md`,
`plugin/conventions/domain.md`, `plugin/conventions/simplicity.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/__tests__/infrastructure/pty-live-sessions.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/session-channel.test.ts` | create | the backend suite | Contract |
| `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` | modify | `process-ratchet.test.ts` | Current state |
| `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` | modify | `ledger.test.ts` and the judges | prose (one row per case) |
| `backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts` | delete | nobody | none |
| `backend/__tests__/infrastructure/session-channel-real-process.test.ts` | delete | nobody | none |

## 5. Interfaces

Consumes: from slice #1, the port `ProcessTable` with `openTerminal`, `signal` and `readTable`,
and the types `Terminal`, `TerminalOptions` and `TableRead`. From slice #6, the list `ProcessRatchet.LISTED` and the ledger.

Produces: nothing that a later slice consumes. Slice #8 finds three fewer entries in `ProcessRatchet.LISTED`.

## 6. Test strategy

Every task runs `npm run typecheck` and `npx vitest run` over the files it touches, from
`backend/`. `env -u CT_STATE_DIR` goes in front of every `npx vitest run`, because a
`CT_STATE_DIR` of the shell leaks into the remaining real process tests.

Each task writes its test first and watches it fail. `process-ratchet.test.ts` then proves that
the new cases launch nothing, and that the list lost the old file. `ledger.test.ts` proves the
format of each new row. No new case declares a per-test timeout, because nothing waits on a child.

## 7. Tasks

### Task 1 — pty-live-sessions.test.ts leaves the border

**Objective:** `pty-live-sessions.test.ts` reads the process table only through doubles, and the ratchet list stops naming it.

**Files:** `backend/__tests__/infrastructure/pty-live-sessions.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).

Current state (backend/__tests__/infrastructure/pty-live-sessions.test.ts, lines 21-24):
```ts
const childProcessDouble = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: childProcessDouble.execFile, spawn: childProcessDouble.spawn }))

const border = new SystemProcesses()
```

Remove these lines, the import of `SystemProcesses`, the class `ExecFileDouble` and its types, and
`childProcessDouble.execFile.mockReset()`. Delete three cases that prove only the border:
`the default inspector executes bounded asynchronous ps and validates its output`,
`the default inspector retains its slot after early $name until child close` and
`the default inspector also waits for its callback when child close arrives first`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 17-17):
```ts
    'infrastructure/pty-live-sessions.test.ts',
```

Remove that line.

**TDD:** `it.each` `('a timely $name inspection failure leaves close durably requested')` replaces the
`default-inspector` case with the same four rows. `ControlledInspection` answers the second read.
It fails with an error that carries the row's code, or succeeds with `truncated process row\n`.
Each row keeps the old assertions: `SessionNotTerminated`, a settle under `PtyLiveSessions.INSPECTION_TIMEOUT_MS`,
the status `ClosureStatus.REQUESTED` and no destructive signal.

**Tests:** added: that case with its 4 rows. Removed on purpose: the 4 cases of the border, 10 rows in all.

Append 10 ledger rows for `__tests__/infrastructure/pty-live-sessions.test.ts`. Each row of
`a timely default-inspector $name failure leaves close durably requested` maps to the new row with the same `$name`.
`the default inspector executes bounded asynchronous ps and validates its output` maps to
`terminal output and replay do not wait for process inspection`. Each row of the slot case, and the callback case, maps to
`an unreaped inspection holds the physical slot while requests expire and later work restarts`.
The four values of `$name` are `ENOENT`, `abort`, `maxBuffer` and `malformed output`.

**Verification:** The file reads no border, and the ledger has 10 new rows.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test "$(grep -c 'process-border\|node:child_process' backend/__tests__/infrastructure/pty-live-sessions.test.ts)" -eq 0   # expected: exit 0
test "$(grep -c '^| .__tests__/infrastructure/pty-live-sessions.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 10   # expected: exit 0
```

### Task 2 — closing one session leaves the others writable

**Objective:** `pty-live-sessions.test.ts` proves with doubles that a close touches only its own session.

**Files:** `backend/__tests__/infrastructure/pty-live-sessions.test.ts` (modify).

Current state (backend/__tests__/infrastructure/pty-live-sessions.test.ts, lines 492-498):
```ts
  it('what is written reaches the terminal', () => {
    const opened = OpenedTerminal.with()

    opened.sessions.write({ session: opened.session, text: 'ls -la\n' })

    expect(opened.terminal.written).toEqual(['ls -la\n'])
  })
```

The new case goes after the close cases, and reads as this one does.

**TDD:** `it('closing one session leaves another session live and writable')` opens two sessions over
`SpawnDouble.withPids(4101, 4102)`, closes the first and writes a token to the second.
`find` gives null for the first and the second session for the second. The token is in the `written` of its terminal.

**Tests:** added: that case. Removed on purpose: none.

**Verification:** The new case passes with doubles.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/pty-live-sessions.test.ts   # expected: exit 0
```

### Task 3 — the real terminal cases leave the tree

**Objective:** Each case of `pty-live-sessions-real-process.test.ts` maps to a doubled substitute, and the old file leaves the tree.

**Files:** `backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).
Delete `backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts`.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 16-16):
```ts
    'infrastructure/pty-live-sessions-real-process.test.ts',
```

Remove that line.

**TDD:** No TDD — Task 2 wrote the last missing substitute.

**Tests:** added: none. Removed on purpose: the 12 cases of the old file.

Append 12 ledger rows for `__tests__/infrastructure/pty-live-sessions-real-process.test.ts`. Ten map to a case of `__tests__/infrastructure/pty-live-sessions.test.ts`:

| Old case | Substitute |
|---|---|
| `a real terminal prints into the scrollback and answers what is written to it` | `a watcher receives what the terminal printed before it arrived` |
| `the real process stays alive after every watcher has stopped` | `a stopped watcher receives nothing more and the session stays live` |
| `a resize reaches the real terminal, and the shell sees the new size` | `a resize reaches the terminal of that session` |
| `closing an owned terminal stops its child process and leaves another terminal writable` | `closing one session leaves another session live and writable` |
| `a TERM ignoring terminal and child are killed within the closure budget` | `escalates within the bound and keeps failed termination retryable` |
| `saved ownership closes a surviving real group from a fresh adapter` | `restart closure retries use saved identities without a live terminal` |
| `a closure already in progress still accounts for an owned child after its root exits` | `retains authority over a verified child when close evidence is sampled before the delayed exit callback` |
| `an original child that survives its already exited root is terminated on close` | `terminates a verified original child after the root exited before close` |
| `an original child is terminated when its root exits during the durable close intent write` | `terminates a verified original child when the root exits during the durable intent write` |
| `a silently sampled surviving child can be closed after its root exits` | `an anchored pre-exit observation can preserve a newly observed child after root exit` |

`on Linux it comes from /proc, with this process and its start ticks in it` maps to
`__tests__/infrastructure/proc-process-table.test.ts > each process is reported with its process group and its start ticks`.
`elsewhere it comes from ps, with this process and its start time in it` reads `deleted without substitute — decided`.

**Verification:** The old file is gone, and the ledger has 12 new rows.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts   # expected: exit 0
test "$(grep -c 'pty-live-sessions-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 12   # expected: exit 0
```

### Task 4 — the session channel runs over a ProcessTable double

**Objective:** `session-channel.test.ts` proves the list, the stream and the input of a session, and the old file leaves the tree.

**Files:** `backend/__tests__/infrastructure/session-channel.test.ts` (create),
`backend/__tests__/infrastructure/fixtures/process-ratchet.ts` (modify). Also the ledger (modify).
Delete `backend/__tests__/infrastructure/session-channel-real-process.test.ts`.

The test file builds `PtyLiveSessions` from one `EchoingTerminals`, bound as `CtApi` binds it. It serves
`ApiServer` as the old file does, and starts it with `RunningServers`. `readTable` answers the rows of
the live terminals, one group each. When `holdsInspections` is true, it answers only when the test releases it.

The file declares `class EchoingTerminals extends ProcessTable`, with `readonly opened: EchoingTerminal[]`,
`holdsInspections: boolean` and `releaseInspections(): void`. `class EchoingTerminal implements Terminal` gives
each `write(text)` back through its `onData` listener. Its `prints(bytes: string): void` plays what the program prints.

Current state (backend/__tests__/infrastructure/fixtures/process-ratchet.ts, lines 20-20):
```ts
    'infrastructure/session-channel-real-process.test.ts',
```

Remove that line.

**TDD:** `it('the live session is listed, its stream carries what it prints and what is typed reaches it')`
expects the list `{ sessions: [{ id, name }] }` with status 200. A typed text answers 202 `{ status: 'typed', id }`.
The same text then reaches the stream.

**Tests:** added: that case, `'closing the stream leaves the session listed and its process alive'` and
`'the listing answers and the stream keeps every byte in order while an inspection is pending'`.
The third holds the inspections, prints `000,` to `059,`, and lists with status 200. It then prints `060,` to `119,`.
The frames carry all 120 numbers in order. Removed on purpose: the 3 cases of the old file.

Append 3 ledger rows for `__tests__/infrastructure/session-channel-real-process.test.ts`. The first two cases keep their names
in `__tests__/infrastructure/session-channel.test.ts`. `HTTP and SSE progress while noisy terminal ownership is inspected`
maps to the third case.

**Verification:** The channel runs in process, and the ledger has 3 new rows.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/session-channel.test.ts __tests__/infrastructure/process-ratchet.test.ts __tests__/infrastructure/ledger.test.ts   # expected: exit 0
test ! -e backend/__tests__/infrastructure/session-channel-real-process.test.ts   # expected: exit 0
test "$(grep -c 'session-channel-real-process.test.ts >' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 3   # expected: exit 0
```

## 8. Global verification

The whole backend suite runs once with the new cases in it. The three files are off the list.
The ledger names every deleted case.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run   # expected: exit 0 — the whole backend suite
test -z "$(grep -l 'pty-live-sessions\|session-channel' backend/__tests__/infrastructure/fixtures/process-ratchet.ts)"   # expected: exit 0 — the three files are off the list
test "$(grep -c 'real-process.test.ts > ' docs/superpowers/ledgers/2026-09-24-backend-without-processes.md)" -eq 97   # expected: exit 0 — 82 earlier rows and 15 new rows
```

## 9. Assumptions

1. The issue names "both files", and three listed files carry the two names. This plan takes all three.
   `pty-live-sessions.test.ts` reaches the border, so it belongs to the family. Provenance: own call, after the spec table.
2. The coverage criterion stays in the issue, but the owner dropped it. So no task measures
   coverage. Provenance: issue, "Contexto heredado".
3. Four cases prove only the border: the arguments of `/bin/ps`, and the wait for both the callback and the close.
   D-6 keeps the border out of coverage, so these go to a substitute that proves the behaviour of `PtyLiveSessions`. Provenance: own call, after D-6.
4. The format of a `ps` row stays proven by the parse cases of `pty-live-sessions.test.ts`, which feed `ProcessTables.row`.
   So the `ps` case of the host goes without a substitute. Provenance: repo.
5. The ledger held 82 rows before this slice, and each names a `-real-process.test.ts` file. §8
   counts 97 rows for that reason. The 10 rows of Task 1 name no such file. Provenance: repo, the ledger.
