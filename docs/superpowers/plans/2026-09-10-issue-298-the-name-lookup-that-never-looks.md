# #298 — the name lookup of `ct-step controls` finds what is staged, and says so when it cannot look

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

`inIndex(name)` in `plugin/scripts/ct-step.mjs` (lines 1549-1556) is the one query behind the two
controls that measure what a task's plan promised: `declaredTests` (lines 1558-1563, the names of
`**Tests:**`) and `declaredBlocks` (line 1594, the name of `**TDD:**`). It computes the list of
staged paths into a local called `ambito` and then hands `git grep --cached` a pathspec called
`scope`, which is declared nowhere in the module: line 1553 throws `ReferenceError`, the bare
`catch` of line 1555 discards it, and the function answers `false` to every name it is asked
about.

Measured in this worktree with the harness of `plugin/__tests__/fixtures/ct-step-harness.js`: with
the plan committed, the name `uno pinta uno` written inside the staged `uno.txt` and the task
declaring it added, `controls` still writes «the task said it was adding the test 'uno pinta uno'
and it is not in what is staged» and fails; and with the same name declared as WITHDRAWN while it
is still in that staged file, `controls` says `done`. So a plan whose `**TDD:**` names its test can
never get past `controls`, and a withdrawal nobody made goes green.

### Desired end state

- `inIndex()` answers `true` for a name that is present in a path the task staged.
- `inIndex()` answers `false` for a name that is absent from every staged path.
- A lookup that could not RUN — `git grep` exiting with anything other than 0 (match) or 1 (no
  match), the 60 s cap included — is reported as unmeasured instead of folded into "not found":
  `controls` closes the task with `OUTCOMES.INDETERMINATE`, which is exit 5
  (`EXIT.CONTROLS_UNMEASURED`), and its log carries the reason.
- A `**Tests:**` line declaring a removal that did not happen makes `declaredTests` fail.
- The identifier the module carries in that function is English.

### Out of scope

- The rest of `ct-step.mjs`. Only `inIndex`, its `catch`, and the two lines of the `controls` step
  that consume them: the `try` around the two name controls and the guard of the command loop
  (line 1380), without which an unmeasured lookup would go on spending the task's commands.
- Any other control of `controls`: `declaredScope`, `amendmentOnlyAdds`, `finalTexts` and the
  command loop's own semantics stay as they are.
- Widening what `workingPathsInTheIndex()` returns. The narrowing to staged paths is the property
  two tests already pin and this slice does not touch it.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Which of the two names moves | the LOCAL: line 1550 becomes `const scope = workingPathsInTheIndex()` and the pathspec of line 1553 stays `...scope` |
| Why the local and not the call | `plugin/conventions/style.md` requires English identifiers and `AGENTS.md` refuses the declared-debt exemption for language: a diff that touches that line leaves it in English |
| What a broken query is | any exit status of `git grep --cached` other than 0 and 1 — 128 for a query git refused, `null` when the 60 s cap fires |
| How a broken query travels | a typed error, `class NameLookupDidNotRun extends Error {}`, thrown by `inIndex` |
| Who catches it | the `controls` step, around its two name controls; the message goes to the log under the heading `# names that could not be looked up` and `result` becomes `OUTCOMES.INDETERMINATE` |
| What the caller sees | exit 5, `EXIT.CONTROLS_UNMEASURED`, and the run closed on the first go (`run-machine.js`, line 208: an unmeasurable control does not retry) |
| Where git's own reason comes from | `stdio: ['ignore', 'ignore', 'pipe']` in that `execFileSync`, so `e.stderr` can travel inside the message; `--quiet` stays |
| Where the tests live | `plugin/__tests__/ct-step-plan-and-checks.test.js`, inside its `describe('the checks are measured by the program, not by the implementer')`, next to the `commitPlan` helper that already exists there |
| The test command | `npm test --prefix plugin` (the `test-plugin` target of `Makefile`), scoped to one file with `-- __tests__/<file>` |

## 3. Reference patterns

Files to imitate: `plugin/__tests__/ct-step-plan-and-checks.test.js` — its last two tests
(`a WITHDRAWN test that is still named in the committed plan...` and `a PROMISED test that is only
in the plan...`) are the exact shape the new ones take, `commitPlan` and `withTestsLine` included;
`plugin/__tests__/fixtures/ct-step-harness.js` — `makeHelpers` gives `ct`, `ctIn` (the one that
hands a step a different environment), `writeReport` and `runState`; `plugin/scripts/ct-step.mjs` —
the module the fix lives in, and the style its neighbours are written in.

Rules to obey: `AGENTS.md` (English on every surface; a repository control is not an obstacle to
route around); `CLAUDE.md` (the same text); `docs/glossary.md` (read before renaming: the English
term is decided, not improvised). ct's own eight documents in `plugin/conventions/` travel with
every task brief and are not repeated here.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/ct-step.mjs` | modify | the `controls` step of every slice | Current state (Task 1), Current state + Contract (Task 2) |
| `plugin/__tests__/ct-step-plan-and-checks.test.js` | modify | `npm test --prefix plugin` | none (bodies by TDD) |

## 5. Interfaces

Consumes: N/A — the issue declares no "Dependencias" section and this slice depends on nothing
already merged.
Produces: N/A — `inIndex`, `declaredTests` and `declaredBlocks` are internal to
`plugin/scripts/ct-step.mjs` and nothing is exported. What later slices rely on is what
`ct-step controls` already promises: exit 0 when the controls pass, 4 when they are red, 5 when
they could not be measured.

## 6. Test strategy

Both tasks are tested through the program, exactly as the twenty-four `describe`s of the nine
`ct-step-*.test.js` files are: the test writes the JSON a subagent would write, runs
`node scripts/ct-step.mjs` against a temporary repo with a real git, and asserts on what the
program did — the `controls` outcome, the exit code and the log at `runState().lastControlsLog`.
There is no unit seam over `inIndex`: it is not exported, and the behaviour that matters is the
one the log and the exit code carry.

The plan of every new test is COMMITTED with `commitPlan` before `report`, because that is the
only arrangement in which these controls have ever been wrong: a prescriptive plan quotes its test
names verbatim and lives committed under `docs/`, so a test that leaves the plan uncommitted
passes with the defect in place — the comment at line 152 of that file records it.

Criterion 2 of the issue (a name absent from every staged path answers `false`) gets NO new test:
it is already pinned, on the other side of the same boundary, by
`a PROMISED test that is only in the plan, and not in what the task touched, is red`. Its pair with
the new positive test is what discriminates the fix — same committed plan, the name inside the
staged file in one and only inside the plan in the other.

## 7. Tasks

### Task 1 — the lookup looks where it says it looks

**Objective:** `inIndex()` answers about a name over the paths the task staged, instead of
answering `false` to every name.

**Files:** `plugin/scripts/ct-step.mjs` (modify), `plugin/__tests__/ct-step-plan-and-checks.test.js` (modify)

Current state (plugin/scripts/ct-step.mjs, lines 1549-1556):

```js
function inIndex(name) {
  const ambito = workingPathsInTheIndex()
  if (!ambito.length) return false
  try {
    execFileSync('git', ['grep', '--cached', '--quiet', '-F', '-e', name, '--', ...scope], { cwd: repoRoot, stdio: 'ignore', timeout: 60_000 })
    return true
  } catch { return false }
}
```

The local of line 1550 is renamed to `scope`, and the pathspec of line 1553 stays `...scope`: the
two names agree, the identifier is English, and nothing else in the function moves. `git grep
--cached --quiet` exits 0 for a match and 1 for no match, so `true` and `false` go on meaning what
they say; narrowing the `catch` is Task 2's work and this task leaves it untouched.

**TDD:** `it('a promised test that IS in a path the task staged is green')` — with the plan
committed declaring `añade \`'uno pinta uno'\``, the name written inside `uno.txt` and the report
declaring `uno.txt`, `controls` says `done`. The boundary's other side is the test already at line
191 of that file, where the same name lives only in the committed plan and stays red.

**Tests:** added: `'a promised test that IS in a path the task staged is green'`,
`'a test the task said it withdrew and is still in a staged path is red'` — the second one is the
inverted half of the same query, and it is the one that goes green today. Removed on purpose: none.

**Verification:** the file's own suite, the two new tests included; and that the two names in
`inIndex` agree, with the Spanish local gone from the module.

```bash
npm test --prefix plugin -- __tests__/ct-step-plan-and-checks.test.js   # expected: exit 0 — 14 tests, the 12 that were already there plus the 2 added
test "$(grep -c 'const scope = workingPathsInTheIndex()' plugin/scripts/ct-step.mjs)" -eq 1   # expected: exit 0 — the local is declared once, with the name the pathspec uses
test -z "$(grep -n ambito plugin/scripts/ct-step.mjs)"   # expected: exit 0 — no occurrence of the Spanish local is left
```

### Task 2 — a lookup that could not run is unmeasured, not "not found"

**Objective:** when `git grep --cached` cannot answer, `controls` closes the task as unmeasured
with the reason in its log, instead of reading it as "the test is not there".

**Files:** `plugin/scripts/ct-step.mjs` (modify), `plugin/__tests__/ct-step-plan-and-checks.test.js` (modify)

Current state (plugin/scripts/ct-step.mjs, lines 1553-1555):

```js
    execFileSync('git', ['grep', '--cached', '--quiet', '-F', '-e', name, '--', ...scope], { cwd: repoRoot, stdio: 'ignore', timeout: 60_000 })
    return true
  } catch { return false }
```

Current state (plugin/scripts/ct-step.mjs, lines 1380-1385):

```js
  for (const command of result === OUTCOMES.FAILED ? [] : t.commands) {
    const measured = runCheck(command)
    lines.push(`$ ${command}`, measured.output ?? '', `-> exit ${measured.code}`, '')
    if (measured.code === 'unmeasured') { result = OUTCOMES.INDETERMINATE; break }
    if (measured.code !== 0) { result = OUTCOMES.FAILED; break }
  }
```

Contract (plugin/scripts/ct-step.mjs):

```js
class NameLookupDidNotRun extends Error {}
```

Four decisions, and the bodies are yours. The `catch` takes the error: `e.status === 1` is "no
match" and goes on returning `false`; any other status throws `NameLookupDidNotRun`, whose message
names the name it was asked about, the status and git's own stderr. That `execFileSync` gets
`stdio: ['ignore', 'ignore', 'pipe']` so there is a stderr to quote. The `controls` step wraps its
two name controls — `declaredTests(t)` at line 1366 and `declaredBlocks(t)` at line 1374 — in one
`try`, and on `NameLookupDidNotRun` pushes the heading `# names that could not be looked up` with
the message and sets `result = OUTCOMES.INDETERMINATE`; any other exception goes on travelling to
the top-level handler. And the guard of line 1380 becomes
`result === OUTCOMES.DONE ? t.commands : []`, so an unmeasured lookup does not go on to spend the
task's commands.

**TDD:** `it('a name lookup that could not RUN closes the task as unmeasured, not as a missing test')`
— with a `git` first on `PATH` that exits 128 when its first argument is `grep` and delegates
everything else to the real one, `ctIn({ PATH: ... }, 'controls')` exits 5, its log carries the
reason and does NOT carry `is not in what is staged`, and it has no `$ test -f uno.txt` line: the
commands were not spent on a control that could not be measured.

**Tests:** added:
`'a name lookup that could not RUN closes the task as unmeasured, not as a missing test'`.
Removed on purpose: none.

**Verification:** the file's own suite with the third test in it; and that the vocabulary and the
guard are in the module.

```bash
npm test --prefix plugin -- __tests__/ct-step-plan-and-checks.test.js   # expected: exit 0 — 15 tests, Task 1's 14 plus this one
test "$(grep -c NameLookupDidNotRun plugin/scripts/ct-step.mjs)" -ge 3   # expected: exit 0 — the class, the throw and the catch that tells it apart
test "$(grep -c 'OUTCOMES.DONE ? t.commands : \[\]' plugin/scripts/ct-step.mjs)" -eq 1   # expected: exit 0 — the commands only run while nothing has gone wrong before them
```

## 8. Global verification

The whole plugin suite, which is what `make test-plugin` runs and the only thing that proves the
two controls still hold for every other `ct-step` test; plus the property the fix is about, read
off the module: the pathspec and its local are the same name.

```bash
npm test --prefix plugin   # expected: exit 0 — the whole suite of the package, build included
test "$(grep -c 'const scope = workingPathsInTheIndex()' plugin/scripts/ct-step.mjs)" -eq 1   # expected: exit 0 — the local the pathspec reads is declared
test -z "$(grep -n ambito plugin/scripts/ct-step.mjs)"   # expected: exit 0 — the unfinished rename is finished
```

## 9. Assumptions

1. **The issue's own "Acceptance criteria" section at the end says "(fill in from the spec)" and
   the real criteria live inside its "Contexto del epic".** Those four EARS sentences are taken as
   the criteria. Provenance: issue body.
2. **The rename of the local is taken, not the rename of the call.** The issue puts renaming out of
   scope and adds "If the rename is finished instead, the local is what moves, not the call". The
   language rule of `AGENTS.md` decides it: the diff touches those lines, so they are left in
   English. Provenance: issue plus repo convention.
3. **A broken query is reported as UNMEASURED (exit 5), not as red (exit 4).** The issue asks for
   "the failure is reported" without saying how. `controls` already has that vocabulary for a
   control it could not measure, and an unmeasurable control closes on the first go instead of
   spending the retries. Provenance: own call, on `run-machine.js` line 208.
4. **The guard of the command loop moves from `OUTCOMES.FAILED` to `OUTCOMES.DONE`.** Without it an
   INDETERMINATE result would go on running the task's commands, and the log would carry a green
   command under an unmeasured control. It is one token, and the third test pins it. Provenance:
   own call, declared here because the issue's "Out of scope" names only `inIndex` and its `catch`.
5. **Criterion 2 gets no new test of its own**, being already pinned by the existing test named in
   §6. `plugin/conventions/testing.md` asks for that check before adding one. Provenance: repo
   convention.
6. **The broken query is provoked with a `git` shim first on `PATH`.** There is no input to
   `git grep --cached` that a real git refuses while the staged paths are real, and `ctIn` exists
   precisely to hand a step a different environment. The shim delegates everything that is not
   `grep` to the real git, so the rest of the run is untouched. Provenance: own call.
7. **The baseline of this slice is `no-verificado`** (`.agent/SLICE.md`: `AGENTS.md` declares no
   `test:` line), so §8's green is not measured against a green baseline. What §8 asserts is the
   suite of the package the diff lives in. Provenance: slice state.
