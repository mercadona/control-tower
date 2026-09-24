# #549 — amendment: the coverage floor of the files whose counts vary between runs

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow this plan
> and `AGENTS.md`.

## 1. Context and goal

The first plan of #549, `docs/superpowers/plans/2026-09-24-issue-549-the-declared-border-and-the-ratchet.md`,
delivered its eight tasks. Its run closed at `blocked-global`. `npm run coverage:compare` named
`src/infrastructure/pty-live-sessions.ts`: branches `374/419` against a baseline of `375/420`.

That was not a drop. V8 counts only the branches that a run reaches. The real PTY tests of
that file run timers, so its covered count and its total change between two runs of the same
tree. Task 8 saw the same noise in `checked-run-delivery.ts` and `run-journal.ts`.

The owner of the milestone decided a rule for these files. This amendment applies it to
`backend/__tests__/coverage-baseline.ts` and writes `backend/coverage-baseline.json` again.

### Desired end state

- `backend/coverage-baseline.json` comes from 5 runs of `npm run coverage` over one tree.
- A file with the same counts in all 5 runs is stable, and `files` keeps its strict floor.
- A file whose counts vary is in `unstable`, floored at its minimum covered count.
- `npm run coverage:compare` compares an unstable file with its floor, and a stable file as
  before.
- The ledger header states the rule in one line.
- The global verification of the first plan passes.

### Out of scope

- `plugin/` and `frontend/`: nothing under them changes.
- The low finding of the review on the `CASE` pattern of `backend/__tests__/ledger.test.ts`.
  The pull request reports it.
- The migration of any test file. Slices 2 to 8 do that, and each one empties its files from
  `unstable`.

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
| The amendment of D-4 | `The baseline is measured 5 times on the same tree. A file whose covered and total counts are identical in all 5 runs is stable. Its floor stays strict, exactly as D-4 says. A file whose counts vary between runs is unstable. The baseline JSON lists it in a list of its own, with the minimum covered count over the 5 runs as its floor, and compares its ratio against that floor. That list can only shrink.` |
| Who decided it | the owner of the milestone, on 2026-09-24, through the coordinating session |
| The floor of an unstable file | for lines and for branches, `covered` is the minimum over the 5 runs and `total` is the maximum |
| The list | `unstable` in `backend/coverage-baseline.json`, beside `files`; no file sits in both |
| A stable file | never enters `unstable` after the baseline exists; only a new baseline of the whole tree moves it |
| The samples | `node_modules/.cache/coverage/samples/<n>.json`, one per run, written by `npm run coverage:sample` |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: N/A — the module that this task extends is new in this branch. Its own shape
is the pattern.

Rules to obey: `.agent/conventions.md`, `CLAUDE.md`, `docs/language.md`, `docs/glossary.md`,
`backend/conventions/this-repository.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/defects.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/style.md`,
`plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/__tests__/coverage-baseline.ts` | modify | the `package.json` scripts | none (prose) |
| `backend/__tests__/coverage-baseline.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/package.json` | modify | `npm run coverage:sample` | prose (config) |
| `backend/coverage-baseline.json` | modify | `npm run coverage:compare` | none (generated) |
| `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` | modify | the judges of slices 2 to 8 | Final text |
| `backend/conventions/this-repository.md` | modify | every later slice | Final text |

## 5. Interfaces

Consumes: `CoverageBaseline.measured`, `dropsAgainst`, `write` and `main`, which the first plan
of #549 produced.

Produces: `CoverageBaseline.SAMPLES` (`5`) and `CoverageBaseline.SAMPLE_DIR`.
`CoverageBaseline.sampled(runs: readonly Record<string, FileCoverage>[]): Baseline`.
`Baseline` becomes `{ instrument, files, unstable }`, and `write` takes a `Baseline`.
The verb `sample` of `main`, and the script `coverage:sample` of `backend/package.json`.

## 6. Test strategy

The task runs `npm run typecheck` and `npx vitest run` over its files, from `backend/`, with
`env -u CT_STATE_DIR` in front. `sampled` gets literal runs in its tests, so no test runs `c8`.
The five measurements run in the task itself, and the global verification runs one more.

## 7. Tasks

### Task 1 — the unstable list, measured over five runs

**Objective:** The baseline floors each file whose counts vary between five runs at its minimum,
and keeps every other floor strict.

**Files:** `backend/__tests__/coverage-baseline.ts` and `backend/__tests__/coverage-baseline.test.ts`
(modify). Also `backend/package.json`, `backend/coverage-baseline.json`,
`docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` and
`backend/conventions/this-repository.md` (modify).

No code — the module lives under `backend/__tests__`, so its signatures travel in prose.

`sampled` throws unless it gets `SAMPLES` runs. It puts a file with equal counts in every run in
`files`. It puts any other file in `unstable`, with the floor of §2. `dropsAgainst` compares a
file of `unstable` with its floor the way it compares a file of `files`. The verb `sample`
writes the measurement of `REPORT` to the next free `<n>.json` of `SAMPLE_DIR`. The verb `write`
reads every sample there and gives them to `sampled`.

`package.json` adds the script `coverage:sample`, which is `node __tests__/coverage-baseline.ts sample`.
Delete `backend/coverage-baseline.json` and `SAMPLE_DIR`. Then run five times
`env -u CT_STATE_DIR npm run coverage && npm run coverage:sample`, and then
`npm run coverage:baseline`. Commit the file it writes as it is.

Final text (docs/superpowers/ledgers/2026-09-24-backend-without-processes.md):

```markdown
The coverage floor: a file whose counts vary across the five runs that wrote `backend/coverage-baseline.json` sits in its `unstable` list, floored at its minimum covered count; that list only shrinks, and the slice that migrates a file's tests takes it out and measures its entry again.
```

It goes after the paragraph that ends `reads each one.`, with a blank line on each side.

Final text (backend/conventions/this-repository.md):

```markdown
The baseline comes from five runs: `npm run coverage` then `npm run coverage:sample`, five
times, then `npm run coverage:baseline`.
```

It goes after the paragraph that ends `says what it leaves out and why.`, with a blank line.

**TDD:** `it('a_file_whose_counts_vary_between_runs_is_unstable_with_the_minimum_covered_count_as_its_floor')`.
Runs of `375/420` and `374/419` branches give the floor `374/420`.

**Tests:** added: that one, and `'a_file_whose_counts_are_identical_in_all_five_runs_is_stable_and_keeps_its_strict_floor'`,
`'an_unstable_file_below_its_floor_is_a_drop_and_one_at_its_floor_is_not'`,
`'a_baseline_is_refused_from_any_number_of_runs_but_five'`,
`'the_committed_baseline_lists_no_file_as_both_stable_and_unstable'`. The two tests of the
committed baseline read `files` and `unstable` together. Removed on purpose: none.

**Verification:** The rule holds in its tests, and a fresh run holds against the new baseline.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/coverage-baseline.test.ts __tests__/ledger.test.ts __tests__/yardstick.test.ts   # expected: exit 0
cd backend && env -u CT_STATE_DIR npm run coverage && npm run coverage:compare   # expected: exit 0 — no drop
test "$(grep -c '"unstable"' backend/coverage-baseline.json)" -eq 1   # expected: exit 0 — the list exists
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

1. §2 quotes each frozen decision inside a code span, as the first plan does: the gate of
   Simplified Technical English refuses their exact words. Provenance: own call.
2. The floor of an unstable file takes the maximum total beside the minimum covered count. The
   rule names only the covered count, and totals vary too. The lower ratio is the safe side.
   Provenance: own call.
3. The first run sits in `.agent/run-549-first-run/`, untouched. Provenance: the coordinating
   session.
4. `backend/coverage-baseline.json` exists already, and `write` refuses to overwrite it. The task
   deletes it first. This is the first write under the rule, not an upward rewrite. Provenance:
   the coordinating session.
5. No block quotes a current state. Each span that this task changes is new in this branch,
   and the base of the branch does not hold it. Provenance: own call.
