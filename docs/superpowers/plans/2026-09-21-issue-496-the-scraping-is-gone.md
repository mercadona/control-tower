# #496 — the scraping is gone

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`ct-step` is the loop's oracle. The backend rebuilt every dispatch out of its human prose:
fourteen literal labels, five sentences matched byte for byte, four regexes. Slice 1 opened the
contract. Slices 2, 3 and 4 each stop one family of consumers from a need for a sentence. None
of them proves the sum, and none of them cuts what two of them share. The one
`When it comes back:` line feeds every step family, so its reader outlives slice 2 and slice 4
both.

This slice closes the experiment, and it is the row that makes the whole hypothesis
falsifiable. It ships the census that proves the prose contract reached zero under
`backend/src`. It cuts the last prose out of the consuming command and out of
`CtRunMachine.dispatch`. It pins the prose a human still reads to the bytes of `35303a16`, the
base of this branch.

### Desired end state

- No module under `backend/src` carries any of the twenty-eight prose fragments of the retired
  contract. One census test owns that list, and a second test proves the census fires.
- Neither `backend/src/infrastructure/run-dispatch.ts` nor
  `backend/src/infrastructure/ct-run-machine.ts` scans `ct-step`'s stdout as text.
- `CtRunMachine.dispatch` reads no sentence of that stdout, and the two refusals it printed
  keep their words.
- `ct-step next` with no flag prints, for all nine steps, the bytes `35303a16` printed. The
  advise step differs in one line, which slice 1 moved with the advisor's tool declaration.
- The backend typecheck stays green, and so does every test file the three tasks touch.

### Out of scope

- The prose itself. No `out()` line changes its wording here, and Task 3 is the control that
  proves it.
- The announcement's shape as slice 1 closed it. This slice adds no field, no kind and no role.
- The work of slices 2, 3 and 4. This slice re-plans none of it, and it fixes no internal name
  of theirs beyond the frozen decisions below.
- The one prose home slice 2 builds in the plugin. The labels move there; they do not vanish
  from the repository, and that is the design.
- `.agent/run-<issue>.json`, `VERDICT_RULES`, the `review_token` binding, the agent prompts,
  `plan-contract.js`, the rubrics and the yardstick.
- The frontend, the discard budget and `judge-dispatch.js`.
- The two Spanish `out()` lines of `ct-step.mjs`. They are prose a human reads, and Task 3
  protects them as they stand.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 · Where the structure lives | the announcement is the source and the prose is a rendering of it, under `--output-format json` |
| D-2 · Where the contract lives | `plugin/scripts/step-announcement.js`, pure, imported by both sides |
| D-3 · The two hooks | `dispatch-gate.js` and `dispatch-guard.js` parse nothing; out of scope |
| D-4 · A refusal | publishes the `state` and the `outcome` that already decide its exit code |
| D-5 · What travels | what the run decides; never the model, the tool list or the schema |
| D-6 · `response.kind` | `file`, `structured`, `edits` |
| D-7 · `kind: "file"` | the backend reads the path and writes nothing |
| D-8 · `kind: "structured"` | the agent declares `StructuredOutput` in its own `tools` |
| D-9 · The flag | `--output-format json` |
| D-10 · The version field | `version: 1` |
| D-11 · Slice 1 delivered the channel first | done; this slice depends on it |
| D-12 · Slice 1 closed the whole shape | this slice adds no field |
| The scope of the prose census | `backend/src`, which is the criterion's own scope |
| Where the inventory lives | one literal table in one census test; nowhere else |
| How the census proves it fires | a synthetic tree with one fragment of each family |
| What goes out of the consuming command | `#PREFIX`, `#lines` and every factory with a `stdout` field |
| When the class itself goes | only if nothing constructs it out of fields after that cut |
| What Task 2 changes on `OracleEffect` | nothing; it keeps whatever the siblings left it carrying |
| Who refuses the `e2e` step | `OracleBoundary.read`, with the words `ct-step requested unsupported E2E material` |
| Who refuses the slice's own agent | `OracleBoundary.read` alone; `dispatch` drops its second probe |
| The base of the byte comparison | the literal sha `35303a16` |
| How the base tree arrives | `git archive` plus `tar`, never a registered worktree |
| The one declared prose difference | the advisor's tool list, hand-written on both sides |
| What an assertion may not do | recompute its expectation from the module under test |
| What a control may not name | a whole suite nobody here saw pass |
| The feature flag | none; this repository's `flag-discipline` default is off |

## 3. Reference patterns

Files to imitate: `backend/__tests__/typescript-only.test.ts` is the census over the tree. It
ships with a synthetic tree that proves it fires, and Task 1 has that exact shape.
`backend/__tests__/spawned-children.test.ts` shows a second guard of the same genre.
`plugin/__tests__/ct-step-announcement-real-process.test.js` shows a real-process test over
`ct-step`, and `plugin/__tests__/fixtures/ct-step-harness.js` is the harness it drives.
`plugin/__tests__/conforming-modules.test.js` holds the list a new plugin module joins.
`backend/src/infrastructure/run-dispatch.ts` and
`backend/src/infrastructure/ct-run-machine.ts` are the two modules Task 2 cuts.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/defects.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/decisions.md`,
`plugin/conventions/boundaries.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/__tests__/retired-prose-contract.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/src/infrastructure/run-dispatch.ts` | modify | `ct-run-machine.ts`, `claude-run-calls.ts` | Current state |
| `backend/src/infrastructure/ct-run-machine.ts` | modify | `drive-run.ts`, `ct-api.ts` | Current state |
| `plugin/__tests__/ct-step-prose-unchanged-real-process.test.js` | create | the plugin suite | none (body by TDD) |
| `plugin/__tests__/conforming-modules.test.js` | modify | the plugin suite | Current state |

## 5. Interfaces

Consumes: `STEPS` from `plugin/scripts/run-machine.js`, which `ct-run-machine.ts` already
imports. `makeRepo(options)` and `makeHelpers(ref)` from
`plugin/__tests__/fixtures/ct-step-harness.js`, with the helpers `ct`, `writeReport`,
`writeVerdict`, `writeSliceVerdict`, `taskPackage`, `slicePackage`, `seal` and `taskOk`.
`SCRIPT` and `PLUGIN_ROOT_TEST` from the same harness. Whatever slices 2, 3 and 4 left inside
`OracleBoundary.read`, `RunDispatch.#material` and `RunConsumingCommand`. This slice reads
their result through the compiler and the touched test files. It fixes no internal name of
theirs here.

Produces: nothing exported, and no later slice depends on this one.

## 6. Test strategy

Task 1 adds a census over `backend/src` with a literal inventory, plus a synthetic tree that
proves the census fires. Task 2 grows that inventory by six fragments, adds a second census
over the mechanism, and then cuts the code. Task 3 adds a real-process test in the plugin,
under the `-real-process` marker `plugin/conventions/testing.md` demands, and joins it to
`BornConforming.PATHS`.

Every assertion of the three tasks states its expectation as a literal.
`backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` once asserted the composed
argv with a recomputation of the production recipe, so no missing argument could redden it.
Task 3 carries the same risk in its own genre: an expectation read out of `ADVISOR_TOOLS` would
approve whatever that constant says. So the advisor's two lines travel hand-written, on both
sides of the comparison.

The census walks `backend/src` and never `backend/__tests__`, which keeps it off its own
fragments and off `Source.regularExpression` in
`backend/__tests__/spawned-children.test.ts`. That fixture carries a `^step: ` pattern on
purpose, and it is no survivor of the retired contract.

No command in this plan names a whole suite. Two real-process files on this machine reach their
own time cap under load, with no change from anybody. So a whole-suite command would redden
this slice for somebody else's reason. Every command here names the files it measures.

## 7. Tasks

### Task 1 — the census of the prose that slices 2, 3 and 4 retire

**Objective:** One census test proves that no module under `backend/src` carries the
twenty-two prose fragments slices 2, 3 and 4 retire.

**Files:** `backend/__tests__/retired-prose-contract.test.ts` (create)

No code — this task adds one test whose body follows the named assertions, and the inventory
travels here as prose with every fragment inline.

The thirteen labels, spaces and tail included: `  - the rubric from `,
`  - the task's brief: `, `  - that it write its report to: `, `  - the review package: `,
`  - the logs of the controls, ALREADY green, in case it wants them: `,
`  - that it write its verdict to: `, `  - the advisor's package: `,
`  - that it write its advice to: `, `  - the slice's review package: `, `  - the plan: `,
`  - the log of the Global verification, ALREADY green, in case it wants it: `,
`  - the verdict of every task, already committed: `, `  - the reconciliation package: `.

The two sentinels: `(none)`, `(N/A declared)`. The four sentences: `DISPATCH AN IMPLEMENTER`,
`DISPATCH THE JUDGE`, `DISPATCH THE ADVISOR`, `DISPATCH THE SLICE JUDGE`. The three pattern
probes: `^step: (`, `next: task `, `(?:^|\\n)run `.

The census reads every `.ts` file under `backend/src` and skips no directory of it. It answers
with one entry per file and fragment it finds. A fixed-string match, never a regular
expression: three of the probes are regex source themselves.

**TDD:** `it('no_module_under_backend_src_carries_a_fragment_of_the_retired_prose_contract')`.
Expect the census over `backend/src` to equal the empty list. Then
`it('the_census_fires_on_a_tree_that_carries_one_fragment_of_each_family')` over a temporary
tree of four files, one family each: expect the four pairs of file and fragment.

**Tests:** added, in `backend/__tests__/retired-prose-contract.test.ts`:
`'no_module_under_backend_src_carries_a_fragment_of_the_retired_prose_contract'`,
`'the_census_fires_on_a_tree_that_carries_one_fragment_of_each_family'`. Removed on purpose:
none.

**Verification:** The census is green over the real tree. It is red over the synthetic one. The
graph still typechecks with the new module in it.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/retired-prose-contract.test.ts   # expected: exit 0 — both tests green
cd backend && npm run typecheck   # expected: exit 0 — the census module is sound
```

### Task 2 — the consuming command stops reading prose, and the last two probes go

**Objective:** Neither module of the dispatch path scans `ct-step`'s stdout as text any more.

**Files:** `backend/src/infrastructure/run-dispatch.ts` (modify),
`backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/__tests__/retired-prose-contract.test.ts` (modify)

Current state (backend/src/infrastructure/run-dispatch.ts, lines 61-62):

```ts
export class RunConsumingCommand {
  static readonly #PREFIX = 'When it comes back:  ct-step '
```

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 538-540):

```ts
    if (command.receipt.output.stdout.includes("DISPATCH THE SLICE'S AGENT")) {
      throw new RunNotUnderstood('ct-step requested unsupported slice-agent reconciliation material')
    }
```

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 544-549):

```ts
    if (effect.command === null) {
      if (command.receipt.output.stdout.includes('step: e2e (')) {
        throw new RunNotUnderstood('ct-step requested unsupported E2E material')
      }
      throw new RunNotUnderstood(`ticket ${ticket} has no validated consuming command`)
    }
```

`#PREFIX`, `#lines` and every factory with a `stdout` field go out of
`RunConsumingCommand`. The class itself goes whole only if nothing constructs it out of fields
after that cut. Slice 4's plan declares a `forEdits` that does, so read the code first.
`OracleEffect` keeps whatever the siblings left it carrying. `OracleBoundary.read` refuses the
`e2e` step itself with the words `ct-step requested unsupported E2E material`. `dispatch` then
drops both probes above and keeps its own refusal for a consuming command it cannot use.

It routes to `#edits` on the consuming command: a `responsePath` of `null` and a first
argument of `reconcile`.

The census grows six fragments over `backend/src`: `DISPATCH THE SLICE'S AGENT`, `step: ${`,
`step: e2e (`, `When it comes back`, `DISPATCH ct-reconciler` and `Run it with:`. The last two
stay in the code slice 4 keeps, so this task retires them. A second census over the two modules above pins the
mechanism, with seven fragments: `stdout.includes(`, `stdout.split(`, `stdout.startsWith(`,
`exec(output.stdout)`, `exec(asked.stdout)`, `.test(stdout)` and `.test(output.stdout)`.

**TDD:** the six fragments enter the inventory first, and
`it('no_module_under_backend_src_carries_a_fragment_of_the_retired_prose_contract')` turns red.
Then `it('neither_module_of_the_dispatch_path_scans_ct_step_stdout_as_text')`, over the two
paths, red as well. The cut turns both green.

**Tests:** added, in `backend/__tests__/retired-prose-contract.test.ts`:
`'neither_module_of_the_dispatch_path_scans_ct_step_stdout_as_text'`. Kept with a grown
inventory: `'no_module_under_backend_src_carries_a_fragment_of_the_retired_prose_contract'`.
Removed on purpose: none.

**Verification:** Both censuses are green. The graph typechecks, so no caller of a cut member
survives. The oracle keeps refusing what it refused, in the same words.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/retired-prose-contract.test.ts   # expected: exit 0 — three tests green
cd backend && npm run typecheck   # expected: exit 0 — no caller of a cut member is left
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — the oracle still refuses what it refused
```

### Task 3 — the prose a human reads is the prose of the branch base

**Objective:** One real-process test proves that `ct-step next` prints the bytes the branch
base printed, for nine steps.

**Files:** `plugin/__tests__/ct-step-prose-unchanged-real-process.test.js` (create),
`plugin/__tests__/conforming-modules.test.js` (modify)

Current state (plugin/__tests__/conforming-modules.test.js, lines 78-80):

```js
    'scripts/step-announcement.js',
    '__tests__/step-announcement.test.js',
    '__tests__/ct-step-announcement-real-process.test.js',
```

The new file joins that list, right after the quoted three lines, so it carries no comment and
its marker has to be real. The base is the literal sha `35303a16`, a constant of the test. Its
plugin tree arrives with
`git archive --format=tar --output=<temporary>/base.tar 35303a16 plugin`, with `cwd` at the
repo root, and then `tar -xf <temporary>/base.tar -C <temporary>`. No registered worktree, so a
parallel test file races with nothing.

Two drives through the harness reach the nine steps. One happy path of the whole slice, with a
journey declared, reaches `implement`, `controls`, `judge`, `commit`, `reconcile`, `global`,
`slice-judge` and `e2e`. Two vetoes over the same task reach `advise`. At each step the test
runs both scripts against the same fixture repo, so only the plugin root differs. One
`beforeAll` drives both fixtures once: each `ct-step` call costs about 2.5 seconds, and the
whole file costs about 100.

The normaliser replaces each plugin root, and its `realpathSync`, with `<PLUGIN_ROOT>`, and
then the fixture repo, and its `realpathSync`, with `<REPO>`. The one declared difference
travels hand-written on both sides: the base line is
`DISPATCH THE ADVISOR (subagent ct-advisor — declared with Read only) with:` and the tree's line
is `DISPATCH THE ADVISOR (subagent ct-advisor — declared with Read, StructuredOutput only) with:`.
The expectation names `ADVISOR_TOOLS` nowhere.

**TDD:** `it('eight_of_the_nine_steps_print_the_bytes_the_branch_base_printed')`, one equality
per step. Then
`it('the_advise_step_differs_in_the_one_line_the_advisor_tool_declaration_moved')`: expect the
tree's transcript to equal the base's with that one line swapped. Then
`it('the_base_transcript_comes_from_git_and_not_from_the_tree_under_test')`: expect the base's
advise transcript to contain `declared with Read only) with:`, a wording this tree cannot
print.

**Tests:** added, in `plugin/__tests__/ct-step-prose-unchanged-real-process.test.js`:
`'eight_of_the_nine_steps_print_the_bytes_the_branch_base_printed'`,
`'the_advise_step_differs_in_the_one_line_the_advisor_tool_declaration_moved'`,
`'the_base_transcript_comes_from_git_and_not_from_the_tree_under_test'`. Removed on purpose:
none.

**Verification:** The nine transcripts match the base. The third test proves the base side is
not this tree. The guard of the list accepts the new file and its marker.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-prose-unchanged-real-process.test.js   # expected: exit 0 — the nine steps agree
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/conforming-modules.test.js   # expected: exit 0 — the new file conforms and its marker is real
```

## 8. Global verification

The first three commands are the slice's reason to exist. Each one lists the files that still
carry a piece of the retired contract. An empty list is the claim, so `test -z` is the
assertion, and `grep -c` would go green on any match.

I ran the three greps and the typecheck on `12a7c177`. The greps exited 1 and named
`run-dispatch.ts` and `ct-run-machine.ts`. The same shapes exit 0 over `backend/src/domain` and
over `tool-runner.ts`, which carry none of it. `npm run typecheck` exited 0. The two vitest
lines name files the tasks create, so nobody can run them before Task 3.

```bash
test -z "$(grep -rlF -e '  - the rubric from ' -e "  - the task's brief: " -e '  - that it write its report to: ' -e '  - the review package: ' -e '  - the logs of the controls, ALREADY green, in case it wants them: ' -e '  - that it write its verdict to: ' -e "  - the advisor's package: " -e '  - that it write its advice to: ' -e "  - the slice's review package: " -e '  - the plan: ' -e '  - the log of the Global verification, ALREADY green, in case it wants it: ' -e '  - the verdict of every task, already committed: ' -e '  - the reconciliation package: ' -e '(none)' -e '(N/A declared)' backend/src)"   # expected: exit 0 — no label and no sentinel is left
test -z "$(grep -rlF -e 'DISPATCH AN IMPLEMENTER' -e 'DISPATCH THE JUDGE' -e 'DISPATCH THE ADVISOR' -e 'DISPATCH THE SLICE JUDGE' -e "DISPATCH THE SLICE'S AGENT" -e 'DISPATCH ct-reconciler' -e '^step: (' -e 'step: ${' -e 'step: e2e (' -e 'next: task ' -e '(?:^|\\n)run ' -e 'When it comes back' -e 'Run it with:' backend/src)"   # expected: exit 0 — no sentence and no pattern is left
test -f backend/src/infrastructure/run-dispatch.ts && test -f backend/src/infrastructure/ct-run-machine.ts && test -z "$(grep -lF -e 'stdout.includes(' -e 'stdout.split(' -e 'stdout.startsWith(' -e 'exec(output.stdout)' -e 'exec(asked.stdout)' -e '.test(stdout)' -e '.test(output.stdout)' backend/src/infrastructure/run-dispatch.ts backend/src/infrastructure/ct-run-machine.ts)"   # expected: exit 0 — both modules are there and neither scans stdout
cd backend && npm run typecheck   # expected: exit 0 — the whole graph is sound
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/retired-prose-contract.test.ts __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — the censuses and the oracle
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-prose-unchanged-real-process.test.js __tests__/conforming-modules.test.js   # expected: exit 0 — the nine steps and the list guard
test -z "$(git status --porcelain)"   # expected: exit 0 — every task committed its work
```

## 9. Assumptions

1. This slice depends on slices 2, 3 and 4, and its controls are what discover an incomplete
   one. Their plans did not exist when I started. Provenance: the execution spec's `Dep` column
   for row 5. If a census turns red on a fragment, the fault lies in the sibling that owed it.
   The implementer reports that, and repairs no sibling's work.
2. Every control here measures the **absence** of the prose contract in the backend, never the
   presence of a replacement. Provenance: own call. A control keyed to a name a sibling chose
   would fail for the wrong reason. None of the twenty-eight fragments is a name of theirs.
3. Slice 2's plan gives the labels one home, `plugin/scripts/step-prose.js`, with a `render`
   and a `read`. So the strings do not leave the repository, and the census must not claim they
   do. Provenance: the coordinator's reading of that plan. The census scope is `backend/src`
   for exactly this reason, and row 5's criterion names that scope itself.
4. Criterion 2 of row 5 says `RunConsumingCommand` no longer exists. Slice 4's plan adds
   `RunConsumingCommand.forEdits`, which builds the command out of fields and reads no prose.
   So the name may survive the slice, and the provenance is the coordinator's reading of that
   plan. **This is a finding for a person, not a decision of mine.** Task 2 delivers the purpose of
   that criterion: no prose feeds the consuming command. It cuts the class whole only if
   nothing constructs it.
5. The ownership split between Task 1 and Task 2 comes from a measurement on `12a7c177`, file
   and line. Twenty-two fragments live only in code that slices 2, 3 and 4 own. Six others go
   to Task 2, because they also live in code no sibling retires. The coordinating session added
   the last two after a measurement on `4fbf9d78`: `DISPATCH ct-reconciler` in both modules,
   `Run it with:` in `ct-run-machine.ts`. Slice 4's task 5 keeps every byte of the prose road,
   so Task 1's census would be red on birth. Over-delivery by a sibling is harmless, because a
   census measures absence.
6. The design spec says «fourteen literal labels». I measured fifteen label arguments into
   `RunDispatch.#printed` at `35303a16`, and thirteen distinct strings, because
   `  - the task's brief: ` and `  - that it write its verdict to: ` each appear at two call
   sites. The census greps the distinct strings, which is what «a grep returns nothing» means.
   Provenance: measured.
7. The design spec says «five announcement sentences». I measured four `announced` arguments
   into `#requireAnnouncement` at `35303a16`, and the fifth whole-line requirement is not in
   that method. Provenance: measured. The census covers six `DISPATCH` fragments, so the count
   of the spec costs nothing either way.
8. `step: ` on its own is not a fragment, and that is deliberate. `backend/src` carries it
   dozens of times as ordinary object-literal syntax. The three probes `^step: (`, `step: ${`
   and `step: e2e (` cover the five prose sites and hit nothing else. Provenance: measured.
9. `run delivered` on its own is not a fragment either. `ct-run-machine.ts` composes that
   pattern out of `RUN_STATES.DELIVERED`, so the words never appear in its source, while
   `backend/src/infrastructure/plan-agent-brief.ts` does carry them for its own reason. The
   probe is the regex source `(?:^|\\n)run `. Provenance: measured.
10. The mechanism census is bound to the two modules of the dispatch path and not to
    `backend/src`. Provenance: measured — `stdout.split(` is ordinary git and gh output work in
    `gh-plan-publication.ts`, `git-workspace.ts` and `pty-live-sessions.ts`. The two `test -f`
    guards are there because an empty list from a missing file would read as a green.
11. `OracleBoundary.read` refuses the `e2e` step, and `dispatch` keeps no probe. Provenance:
    measured. `run-dispatch-real-process.test.ts` pins the two messages with
    `/unsupported E2E material/` and `/unsupported slice-agent reconciliation/`, and both
    regexes still match after the move. No backend test pins the words «executable consuming
    verb», which is what `#advanceFrom` printed for `e2e` until now.
12. Byte-identity holds for eight steps and breaks in one line of the ninth. Provenance:
    measured twice, with two `ct-step` scripts over the same fixture repo. `ADVISOR_TOOLS` went
    from `Read` to `Read, StructuredOutput` in slice 1, and row 1's own criterion declares that
    exception. Without a normaliser the `implement` step differs too, on the plugin root alone.
13. The comparison reads the base with `git archive` and needs `35303a16` in the clone. CI
    checks out with `fetch-depth: 0` for two tests that say so already, so the commit is there.
    Provenance: `.github/workflows/continuous-integration.yml`.
14. Every command that launches `ct-step` or `vitest` clears `CT_STATE_DIR` with `env -u`.
    Provenance: measured on this tree, with no change of mine. The dispatching session exports
    that variable, and it reddens tests that prepare their own temporary home.
15. Real-process tests on this machine are load-dependent, so no command of this plan names a
    whole suite. In one full backend run, `ct-api-real-process.test.ts:426` timed out on a poll
    of `launchCount`, and `run-dispatch-real-process.test.ts` failed its teardown with
    `ENOTEMPTY`; 2783 of 2785 passed. Run alone with `ct-run-machine.test.ts`, the same file
    passed 15 of 15 in 35 seconds. Provenance: measured. Whoever executes this plan must read
    neither result as its own doing.
16. `dispatch-check.mjs --check-plan` cannot reach exit 0 in this worktree, and no task of this
    plan changes that. It validates every `issue-496-` plan and stops at the first that fails.
    That is slice 1's committed plan: its own landed work invalidated four of its
    `Current state` citations, and the gate reads the working tree. Provenance: measured, and
    `checkPlans` returns on the first failure. I validated this file on its own through
    `checkPlans`, with this path as the only candidate. The implementer reads the file name in
    the message and acts only on a violation that names this plan.
17. A `Current state` citation of code this plan cuts stops existing once the task lands. So
    `--check-plan` reports literality against this plan too, from Task 2 on. Provenance: the
    gate reads the working tree. The citation of
    `plugin/__tests__/conforming-modules.test.js` survives on purpose: Task 3 appends after the
    quoted three lines instead of inside them.
18. There is no `.agent/SLICE.md` in this worktree and no groomed issue for this slice. The
    input is the two committed specs. Provenance: the dispatch. Nothing in this plan opens an
    issue or writes to GitHub.
