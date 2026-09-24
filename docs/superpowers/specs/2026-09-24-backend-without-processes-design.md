# The backend suite launches no process — design

Brainstormed on 2026-09-24. It supersedes issue #418 and its closed pull request
#428, both discarded that day together with the branch
`feat/418-in-process-command-tests`, and issue #527, whose fixtures this design
removes.

## Why

The motive is **false reds**: a test that turns red because the machine is
loaded, not because an assertion broke. It is not wall-clock time and it is not
design for its own sake.

Measured over every run of `continuous-integration.yml` from 2026-09-08 to
2026-09-24 (595 runs, 51 failed attempts, logs read one by one). A red is
*confirmed false* when the same commit went green with no change; *probable*
when the same test failed on unrelated branches.

| Package | Test | Reds | Launches a process |
|---|---|---|---|
| backend | `claude-calls.test.ts` (three cases) | 6 (4 confirmed) | no |
| backend | `run-driver-real-process`, `run-recovery-real-process` | 5 (the `RunDriverMother` race, #439, since fixed) | yes |
| backend | `restart-recovery-real-process` | 3 (#449) | yes |
| frontend | `Home.sessions.test.tsx` › *the brainstorming terminal is immediately closeable…* | 3 (2 confirmed) | no |
| backend | `ct-run-machine-real-process` | 2 (1 confirmed) | yes |
| backend | `ct-api-real-process` | 3, one branch, possibly legitimate | yes |
| backend | `tool-runner-whole-output`, `checked-run-delivery`, `run-driver-runtime`, `run-dispatch` (all `-real-process`) | 1 each | yes |
| plugin | — | 0 | — |

What follows from it:

1. **Every false red of a process-launching test is in the backend.**
2. **The plugin produced no false red in sixteen days**, although its spawning
   tests take 99.9 % of its suite's time. Its `testTimeout` of 120 s turns the
   cost into time rather than into reds. The plugin is therefore a separate
   milestone (see *Parked for the plugin milestone*).
3. **About 40 % of the false reds do not involve a process at all**
   (`claude-calls.test.ts`, the frontend EventSource flake). This design does
   not fix them, and says so, so that nobody claims "the flakes went away".

The measurement recorded in #418 before it was closed (three reds on `main` on
20–21 September, none of whose commits touched the backend) agrees with this
table.

## Scope

The backend: `backend/src/` and `backend/__tests__/`, and the backend's own
convention document. Nothing under `plugin/` or `frontend/`.

## Design

### 1. One declared border and two ports

Today four modules of `backend/src` import `node:child_process` or `node-pty`:
`tool-runner.ts` (118 lines), `headless-call-worker.ts` (404),
`pty-live-sessions.ts` (1146) and `ct-api.ts` (821). The worker and the live
sessions already take `spawn` and `kill` by injection.

- **The border** is one new module under `infrastructure/`, with no logic: the
  real `spawn`/`execFile`, `node-pty.spawn`, `process.kill(±pid, signal)`
  (signal 0 included, which is the liveness question) and the read of `/bin/ps`.
- **`ProcessRunner`**: run and wait, or launch detached, and read the output.
- **`ProcessTable`**: whether a group lives, kill a group, list groups, talk to
  a PTY.
- The border and the `main` line of `ct-api.ts` and of the headless worker are
  excluded from coverage, each with its reason written next to the exclusion.
  Nothing else is.
- The rules of `backend/conventions/this-repository.md:119-141` — a dead leader
  alone does not authorise, a living group means a publication in flight, a
  restart resumes — are tested with `ProcessTable` doubled. A restart is a new
  instance built over the same state directory.

### 2. What answers `git`, `gh`, `claude` and the plugin scripts

One double: **the scripted conversation of `ProcessRunner`**, under the rules of
`plugin/conventions/testing.md`. It answers by what it is asked (binary, literal
argv, cwd), never by order, and raises when nobody wrote an answer for a
request. The test asserts the literal argv sent and what the adapter makes of
the output.

- **`git`, `gh`, `claude`**: answers are **real captures**, files under
  `backend/__tests__/captures/<tool>/`, each headed by the exact command, the
  tool's version and the capture date — the provenance rule 2 of `testing.md`
  asks for. There are captures of success, of refusal and of unreadable output,
  so the two failure causes of every adapter stay told apart.
- **The plugin scripts** (`ct-step.mjs`, `dispatch-check.mjs`): answers are not
  captured. They are produced by the plugin's own pure renderers, which the
  backend already imports (`this-repository.md:226`). A captured file would go
  stale in silence, which is what `plugin-contract.test.ts` exists to prevent.
- **The arrange** no longer builds repositories with `git init` and commits: the
  state an adapter reads is the scripted answers. Real temporary directories
  stay wherever the code reads or writes files of its own (`harness/`, the state
  directory) — the disk is not a process.

### 3. Coverage, ledger, ratchet

- **Baseline, first slice.** Measured with `c8` wrapping `vitest run`: `c8` sets
  `NODE_V8_COVERAGE` for every node descendant, so what the children execute is
  counted. Lines and branches per file of `backend/src`, committed as JSON.
  Every slice measures again **with the same instrument**, and no file may drop
  except the declared border. It is a verification command of each slice, not a
  permanent CI job.
- **The ledger.** One file under `docs/superpowers/`, one row per deleted test
  case: `file > test name` → its substitute, or *deleted without substitute —
  decided*. Every slice appends its rows; the judge reads them.
- **The ratchet, first slice.** A test under `backend/__tests__/` detects the
  files that launch a process — they import `node:child_process` or `node-pty`,
  directly or through a fixture, or carry the `-real-process` marker — and
  compares them with a written list. It fails on a spawning file that is not
  listed (the regression) and on a listed file that no longer spawns (the list
  can only shrink). The last slice empties the list, and the test stays as a
  permanent prohibition.

### 4. The Makefile tests

`makefile-local-env.test.ts` and `state-directory-real-process.test.ts` run
`make` to observe the Makefile. They are deleted with no substitute and
recorded in the ledger as such.

### 5. Order, by measured false reds

1. Foundations: baseline, ledger, ratchet, the border and the two ports.
2. The run driver family: `run-driver`, `run-recovery`, `run-driver-runtime`,
   `run-dispatch` (8 reds).
3. `restart-recovery` (3).
4. `ct-run-machine` and `checked-run-delivery` (3).
5. `ct-api-real-process` (3).
6. `tool-runner`, `tool-runner-whole-output`, `claude-calls-real-process`,
   `claude-conversations` (1).
7. The PTY and sessions: `pty-live-sessions`, `session-channel` (0).
8. The rest and the close: `git-workspace`, `state-directory`,
   `yardstick-real-process`, `makefile-local-env` (deleted). The ratchet list
   empties; `testTimeout` and `hookTimeout` in `backend/vitest.config.ts` go
   back to vitest's defaults; `this-repository.md` loses *"This suite launches
   real processes by design"* and the fast-subset line, and says the opposite.

## Conventions

`backend/conventions/this-repository.md` is amended here. The same amendment to
`plugin/conventions/testing.md` ("set up with the real tool" → "with a real
capture of the tool"; "marked as such" → "not written") is **not** made here:
that document governs the plugin too, whose spawning tests would break it on
day one. Inside `backend/`, the backend's own convention prevails.

## Parked for the plugin milestone

Decided in this brainstorming, for the separate milestone that will take the
plugin:

- `ct-init.sh` (2076 lines of bash) is ported to node.
- The command-line entrypoints (`ct-next.mjs` 4005 lines, `ct-step.mjs` 3097,
  `ct-groom.mjs` 1823, `dispatch-check.mjs` 1645, and the smaller ones) are
  decomposed per `plugin/conventions/architecture.md`; a refusal tested today
  through the command line moves to the application layer, and the ledger
  points at it.
- The same rules as here: no exception, git by scripted conversation, one
  declared border, baseline plus ledger, ratchet from day one, and the
  amendment of `testing.md`. `test:fast`, `vitest.fast.config.js` and the
  subset use of `SpawningTests` go away at its close.

## Not done

- The false reds of suites that launch nothing (`claude-calls.test.ts`, the
  frontend EventSource flake).
- The plugin and the frontend.
- A permanent coverage gate in CI.
