# #549 — amendment: covered lines are the gate while tests still launch processes

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

That was not a drop. Under tests that launch processes, V8 does not count branches the same
way twice. Five samples of the full suite measured it. Covered lines were equal in all 235
files, and branches varied in three files, in their uncovered count too.

The owner of the milestone decided the rule. While a test still launches a process, covered
lines are the gate and branches are information. This amendment applies it to
`backend/__tests__/coverage-baseline.ts` and writes `backend/coverage-baseline.json` again.

### Desired end state

- `npm run coverage:compare` fails when the covered lines of a file drop below its baseline.
- It prints each branch difference as information and never fails on one.
- `backend/coverage-baseline.json` comes from one run of `npm run coverage` and records lines
  and branches for every file of `backend/src` but the border.
- The ledger header states the rule, and that #556 makes branches a strict gate too.
- The global verification of the first plan passes.

### Out of scope

- `plugin/` and `frontend/`: nothing under them changes.
- The low finding of the review on the `CASE` pattern of `backend/__tests__/ledger.test.ts`.
  The pull request reports it.
- The branch gate itself. #556 turns it on, once `ProcessRatchet.LISTED` is empty.

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
| The amendment of D-4 | `Gate: covered lines per file must not drop below the baseline. It is strict and applies to every file of backend/src except the declared border. Branches: recorded in the baseline for every file, and not compared while any test still launches a process. The comparison prints branch differences as information and never fails on them. At the close (#556), when the ratchet list is empty, branches become a strict gate too.` |
| Who decided it | the owner of the milestone, on 2026-09-24, through the coordinating session |
| A line drop | `lines.covered` of the report is lower than `lines.covered` of the baseline |
| A branch difference | `branches` of the report differs from `branches` of the baseline, in covered or in total |
| Where the information goes | stdout of `compare`, one line per file; the drops go to stderr, as today |
| The baseline | one run of `npm run coverage`, then `npm run coverage:baseline`; the task deletes the old file first |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: N/A — the module that this task changes is new in this branch. Its own shape
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
| `backend/coverage-baseline.json` | modify | `npm run coverage:compare` | none (generated) |
| `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` | modify | the judges of slices 2 to 8 | Final text |
| `backend/conventions/this-repository.md` | modify | every later slice | Final text |

## 5. Interfaces

Consumes: `CoverageBaseline.measured`, `dropsAgainst`, `write` and `main`, which the first plan
of #549 produced.

Produces: `CoverageBaseline.branchDifferences(baseline, measured): string[]`.
`dropsAgainst(baseline, measured): string[]` now names line drops and missing files only.

## 6. Test strategy

The task runs `npm run typecheck` and `npx vitest run` over its files, from `backend/`, with
`env -u CT_STATE_DIR` in front. Literal tallies drive the tests, so no test runs `c8`. The task
runs `npm run coverage` once to write the baseline, and the global verification runs it again.

## 7. Tasks

### Task 1 — covered lines are the gate, and branches are information

**Objective:** `npm run coverage:compare` fails only on a covered line that a file lost, and
prints every branch difference.

**Files:** `backend/__tests__/coverage-baseline.ts` and `backend/__tests__/coverage-baseline.test.ts`
(modify). Also `backend/coverage-baseline.json`,
`docs/superpowers/ledgers/2026-09-24-backend-without-processes.md` and
`backend/conventions/this-repository.md` (modify).

No code — the module lives under `backend/__tests__`, so its signatures travel in prose.

`dropsAgainst` stops the comparison of ratios. It names a file whose `lines.covered` falls below
its baseline, and a baseline file that the report lacks. `branchDifferences` names each file
whose `branches` differ, with both tallies. The verb `compare` writes the drops to stderr and
sets exit code 1 when there is one. It writes the branch differences to stdout, and they never
change the exit code.

Delete `backend/coverage-baseline.json`. Then run `env -u CT_STATE_DIR npm run coverage` once,
then `npm run coverage:baseline`. Commit the file it writes as it is.

Final text (docs/superpowers/ledgers/2026-09-24-backend-without-processes.md):

```markdown
The coverage gate: while a test on `ProcessRatchet.LISTED` still launches a process, `npm run coverage:compare` fails only when the covered lines of a file drop below `backend/coverage-baseline.json`, and prints branch differences as information; at the close (#556), with that list empty, branches become a strict gate too.
```

It goes after the paragraph that ends `reads each one.`, with a blank line on each side.

Final text (backend/conventions/this-repository.md):

```markdown
While a test still launches a process, the comparison gates covered lines only, and it prints
branch differences without a failure.
```

It goes after the paragraph that ends `says what it leaves out and why.`, with a blank line.

**TDD:** `it('a_file_whose_covered_lines_fall_below_its_baseline_is_a_drop_and_an_equal_count_is_not')`.
Its boundary: 88 covered against 89 is a drop, and 89 against 89 is not.

**Tests:** added: that one, and `'a_branch_difference_is_printed_and_never_fails_the_comparison'`.
Removed on purpose: `'a_file_whose_line_ratio_falls_below_its_baseline_is_a_drop_and_an_equal_ratio_is_not'`,
`'a_branch_drop_is_named_even_when_every_line_holds'`. Both pin the ratio rule that this task
retires.

**Verification:** The rule holds in its tests, and a fresh run holds against the new baseline.

```bash
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/coverage-baseline.test.ts __tests__/ledger.test.ts __tests__/yardstick.test.ts   # expected: exit 0
cd backend && env -u CT_STATE_DIR npm run coverage && npm run coverage:compare   # expected: exit 0 — no line drop
test "$(grep -c '"unstable"' backend/coverage-baseline.json)" -eq 0   # expected: exit 0 — no unstable list
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
2. Two attempts of this task implemented earlier rules, and the owner replaced both. Their
   uncommitted work went back to the committed state before this rewrite. A patch of it stays in
   the scratchpad of the session. Provenance: the coordinating session.
3. The first run sits in `.agent/run-549-first-run/`, untouched. Provenance: the coordinating
   session.
4. `backend/coverage-baseline.json` exists already, and `write` refuses to overwrite it. The task
   deletes it first. This is the first write under the rule, not an upward rewrite. Provenance:
   the coordinating session.
5. No block quotes a current state. Each span that this task changes is new in this branch,
   and the base of the branch does not hold it. Provenance: own call.
