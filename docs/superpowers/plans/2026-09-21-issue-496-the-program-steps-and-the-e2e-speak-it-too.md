# #496 — the program steps and the e2e speak it too

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`ct-step next` prints prose for the five steps a program runs: `controls`, `commit`,
`reconcile`, `global` and `e2e`. The backend reads that prose back out.
`OracleBoundary.#plainCommand` builds the line `ct-step <verb> --plan <plan> --issue <issue>` by
hand and matches it against stdout twice, once bare and once behind `Run it with:  `. The
reconciler branch of `OracleBoundary.read` matches `DISPATCH ct-reconciler`, then
`RunConsumingCommand.edits` parses the `When it comes back:` line for the same argv.

Slice 1 opened the contract. `StepAnnouncement.program` already takes `commands` and
`consuming`, and every program step of `nextVerb` calls it with neither. This slice fills both
fields, makes `ct-step reconcile` announce the round it dispatches, and gives the backend one
reader for an announced step.

### Desired end state

- The announcement of `controls`, `commit`, `reconcile`, `global` and `e2e` carries `commands`
  and `consuming.argv`.
- `ct-step reconcile --output-format json` prints one dispatch announcement for a round that
  dispatches `ct-reconciler`: the reconciliation package as its one input, and `edits` as its
  response channel.
- `AnnouncedStep.read(stdout)` lives in `ct-run-machine.ts` and answers `null` for prose.
- `OracleBoundary.#plainCommand` returns the announced `consuming.argv` when an announcement
  arrives, and keeps the prose road a human still reads with no flag.
- The reconciler branch of `OracleBoundary.read` does the same with the announced round.
- `ct-step` with no flag prints what it prints today, word for word.

### Out of scope

- The e2e journeys and their `AGENTS.md` sections. The announcement carries no journey.
- The commit message composition and its closing-keyword guard.
- The wording of every `out()` line. No line changes what it says.
- The shape of the announcement. Slice 1 closed it and this slice adds no field.
- The fourteen prose labels, the five sentences, `RunDispatch.#printed`, `#literal`,
  `#optionalLiteral`, `#glob` and `#requireAnnouncement`. Slice 2 retires them.
- The transition, the refusal and the four regexes. Slice 3 delivers them.
- The deletion of `RunConsumingCommand`, and the flag on `#nextArgv`. Slice 5 closes both.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| What `commands` carries | the shell commands the step measures, never the `ct-step` invocation that consumes the step |
| `controls` | `commands: t.commands`, the list its prose prints behind `  $ ` |
| `global` | `commands: globalVerification.commands`, an empty array when §8 of the plan declares N/A |
| `commit`, `reconcile` and `e2e` | `commands: []`: those three measure no command of their own |
| What `consuming.argv` carries | `[verb, ...positional, '--plan', planPath, '--issue', String(issue)]` |
| Where that argv comes from | `consumingArgv(verb, ...positional)`, one arrow const beside `currentTask` |
| `e2e`'s consuming argv | `consumingArgv('e2e', E2E_REPORT_PLACEHOLDER)` |
| `E2E_REPORT_PLACEHOLDER` | `'<file.json>'`, and the `out()` line of the e2e step reads it instead of the same literal |
| Which verbs answer the flag | `next` and `reconcile` |
| What `ct-step reconcile` announces | `StepAnnouncement.dispatch` for a round that dispatches `ct-reconciler`, and nothing at all for any other round |
| That round's inputs | one `AnnouncedInput` with role `INPUT_ROLES.RECONCILIATION_PACKAGE` and kind `INPUT_KINDS.LITERAL` |
| That round's response | `AnnouncedResponse.of(STEPS.RECONCILE, null)`, which is kind `edits` |
| That round's `run.attempt` | `currentAttempt()`, the source `nextVerb` already reads |
| The round number | `nextReconcileAttempt()` runs once, hoisted to `const attempt` above the package |
| The backend's reader | `AnnouncedStep.read(stdout)` in `ct-run-machine.ts` |
| What the reader answers `null` for | anything that is not one JSON object with `version: 1` and `kind: "step"` |
| What the reader exposes | `step`, `commands`, `argv` and `responseKind` |
| What `#plainCommand` demands of it | `step` equal to the switch's step, `commands` an array, `argv[0]` equal to the verb |
| What the reconciler branch demands of it | `responseKind` equal to `RESPONSE_KINDS.EDITS`, and `argv[0]` equal to `reconcile` |
| The manifest check | it leaves the field road: `ct-step` builds the argv from the `--plan` and `--issue` the backend gave it |
| The refusal message of both field roads | `ct-step output is not understood: <stdout>`, the bytes the prose road already refuses with |
| The prose road | it stays on both branches, unchanged, until slice 5 |
| What the backend passes to `ct-step` | the flag on `#runnerArgv`, which slice 3's task 4 adds; `#nextArgv` keeps today's argv |
| The consuming command of the field road | `RunConsumingCommand.forEdits(argv)`, a static beside `edits` |
| Feature flag | none, because this repository's `flag-discipline` default is off |

## 3. Reference patterns

Files to imitate: `plugin/scripts/step-announcement.js` holds the shape this slice fills.
`plugin/__tests__/ct-step-announcement-real-process.test.js` shows how a real `ct-step` run
gets asserted against a literal object, and `plugin/__tests__/fixtures/ct-step-harness.js`
builds its temporary repository. `plugin/__tests__/e2e-ct-step.test.js` builds a real merge
conflict with `worktreeInConflict`. `backend/src/infrastructure/ct-run-machine.ts` shows a
value object with a static reader and a private constructor, and
`backend/__tests__/infrastructure/ct-run-machine.test.ts` shows `OracleMother`.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/decisions.md`,
`plugin/conventions/defects.md`, `plugin/conventions/simplicity.md`,
`plugin/conventions/boundaries.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/ct-step.mjs` | modify | the loop, the backend | Current state, Contract |
| `plugin/__tests__/ct-step-announcement-real-process.test.js` | modify | the plugin suite | Current state |
| `plugin/__tests__/e2e-ct-step.test.js` | modify | the plugin suite | none (bodies by TDD) |
| `backend/src/infrastructure/ct-run-machine.ts` | modify | `CtRunMachine` | Current state, Contract |
| `backend/src/infrastructure/run-dispatch.ts` | modify | `OracleBoundary` | Contract |
| `backend/__tests__/infrastructure/ct-run-machine.test.ts` | modify | the backend suite | Current state |

## 5. Interfaces

Consumes, from `plugin/scripts/step-announcement.js`: `StepAnnouncement.program({ issue, task,
tasksTotal, step, attempt, commands, consuming })`, `StepAnnouncement.dispatch({ issue, task,
tasksTotal, step, attempt, agent, inputs, response, consuming })`, `AnnouncedInput({ role, kind,
path })`, `AnnouncedResponse.of(step, path)`, `INPUT_ROLES`, `INPUT_KINDS`, `RESPONSE_KINDS`,
`ANNOUNCEMENT_KINDS` and `ANNOUNCEMENT_VERSION`. From `plugin/scripts/run-machine.js`: `STEPS`.
This slice adds no member to any of them.

Produces: `AnnouncedStep.read(stdout): AnnouncedStep | null`, with the readonly members `step:
string`, `commands: readonly string[] | null`, `argv: readonly string[]` and `responseKind:
string | null`. Also `RunConsumingCommand.forEdits(argv: readonly string[]):
RunConsumingCommand`. Slice 5 deletes the second one with the class that hosts it.

## 6. Test strategy

Tasks 1 and 2 drive the real `ct-step` through `ct-step-harness.js`, inside the file that
already carries the `-real-process` marker `plugin/conventions/testing.md` demands. Task 4
drives the real `ct-step reconcile` against the real conflict of `worktreeInConflict`, in
`e2e-ct-step.test.js`. Tasks 3 and 5 drive `OracleBoundary` through `CtRunMachine`, with the
announcement seeded into `OracleMother` as a literal string. Task 6 drives `RunAnnouncement`
over one literal JSON line, in `run-announcement.test.ts`.

Every expectation in this plan is a literal. No assertion recomputes its expected value with
the module under test. `run-dispatch-real-process.test.ts` asserted a composed argv that way,
could not fail for a missing argument, and hid a missing tool for months. A `not.toContain` of
one serialized value is weaker than the same denial of the field, so each denial names the
field.

The harness reaches each step by its own route, and every route below uses its helpers alone.
For `controls`: `ct('report', writeReport(['uno.txt']))`. For `commit`: the same, then
`ct('controls')` and `judgeTask(writeVerdict('PASS'))`. For `reconcile`: `taskOk('uno.txt')` and
`taskOk('dos.txt')`. For `global`: those two, then `ct('reconcile')`.

For `e2e`: a nested `beforeEach` that reassigns `repo` to `makeRepo({ e2e: ['the journey of the
fixture'] })`, then `sliceOk()`. Without that seeded journey the run skips the e2e step and
delivers.

Each task runs its own suites, named in its `**Verification:**` block. After each round, mutate
one line of the production code and run the suite. Then report which mutation survived, and
which of the two repairs you chose, as `plugin/conventions/testing.md` asks.

## 7. Tasks

### Task 1 — controls and global announce the commands they measure

**Objective:** The controls step and the global step announce their commands and their consuming
argv.

**Files:** `plugin/scripts/ct-step.mjs` (modify),
`plugin/__tests__/ct-step-announcement-real-process.test.js` (modify)

Current state (plugin/scripts/ct-step.mjs, lines 634-637):

```js
    case STEPS.CONTROLS:
      announcement = StepAnnouncement.program(stepRunFields)
      out('MEASURE THE TASK (the implementer does not do it, and its word does not count):')
      for (const c of t.commands) out(`  $ ${c}`)
```

Contract (plugin/scripts/ct-step.mjs):

```js
const consumingArgv = (verb, ...positional) => [verb, ...positional, '--plan', planPath, '--issue', String(issue)]
StepAnnouncement.program({ ...stepRunFields, commands: t.commands, consuming: { argv: consumingArgv('controls') } })
StepAnnouncement.program({ ...stepRunFields, commands: globalVerification.commands, consuming: { argv: consumingArgv('global') } })
```

`consumingArgv` goes beside `currentTask`, which closes over `planPath` and `issue` the same
way. The two command lists travel as they are, with no `$` prefix and no second copy. A plan
whose §8 declares N/A gives an empty array here, and the prose keeps its own line for that case.

**TDD:** `it('the controls step announces the commands it measures and how to run them')`. Ask at
task 1 of the harness plan. Expect the parsed object to equal the literal with `commands:
['test -f uno.txt']` and `consuming: { argv: ['controls', '--plan', 'plan.md', '--issue', '7']
}`. Then `it('the global step announces the commands of section eight')`.

**Tests:** added to `plugin/__tests__/ct-step-announcement-real-process.test.js`: `'the controls
step announces the commands it measures and how to run them'`, `'the global step announces the
commands of section eight'`. Removed on purpose from the same file: `'a program step announces
its run and no dispatch'`, whose name claims the absence this task ends.

**Verification:** The plugin suite proves the two announcements and the prose beside them. The
whole file runs, because one of its tests pins the prose of the flagless road.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-announcement-real-process.test.js   # expected: exit 0 — controls and global announce their commands, and the prose road keeps its bytes
```

### Task 2 — commit, reconcile and e2e announce how to close themselves

**Objective:** The commit step, the reconcile step and the e2e step announce an empty command
list and their consuming argv.

**Files:** `plugin/scripts/ct-step.mjs` (modify),
`plugin/__tests__/ct-step-announcement-real-process.test.js` (modify)

Current state (plugin/scripts/ct-step.mjs, lines 677-680):

```js
    case STEPS.COMMIT:
      announcement = StepAnnouncement.program(stepRunFields)
      out('COMITEA LA TAREA:')
      out(`  ct-step commit --plan ${planPath} --issue ${issue}`)
```

Contract (plugin/scripts/ct-step.mjs):

```js
const E2E_REPORT_PLACEHOLDER = '<file.json>'
StepAnnouncement.program({ ...stepRunFields, commands: [], consuming: { argv: consumingArgv('commit') } })
StepAnnouncement.program({ ...stepRunFields, commands: [], consuming: { argv: consumingArgv('reconcile') } })
StepAnnouncement.program({ ...stepRunFields, commands: [], consuming: { argv: consumingArgv('e2e', E2E_REPORT_PLACEHOLDER) } })
```

The three steps run no command of their own: the one line their prose prints is the consuming
command, and `consuming.argv` carries it. `ct-step` does not choose the e2e report path, so the
e2e argv carries the placeholder its own prose prints. The `out()` line of the e2e step reads
`E2E_REPORT_PLACEHOLDER` rather than a second copy of those bytes, and says what it said before.

**TDD:** `it('the e2e step announces the report placeholder its prose prints')` — expect
`consuming.argv` to equal the literal `['e2e', '<file.json>', '--plan', 'plan.md', '--issue',
'7']` and `commands` to equal `[]`. Then `it('the commit step announces no command of its own
and the verb that closes it')`.

**Tests:** added to `plugin/__tests__/ct-step-announcement-real-process.test.js`: `'the e2e step
announces the report placeholder its prose prints'`, `'the commit step announces no command of
its own and the verb that closes it'`, `'the reconcile step announces the verb that reconciles
the branch'`.

**Verification:** The plugin suite proves the three announcements. The e2e file proves the prose
of the e2e step, whose placeholder moved to a constant.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-announcement-real-process.test.js   # expected: exit 0 — commit, reconcile and e2e announce their consuming argv
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/e2e-ct-step.test.js   # expected: exit 0 — the prose of the nine steps is unchanged
```

### Task 3 — the backend reads the announced program step

**Objective:** `OracleBoundary.#plainCommand` returns the announced `consuming.argv` when an
announcement arrives, and keeps the prose road for everything else.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify)

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 392-397):

```ts
    const expected = `ct-step ${verb} --plan ${manifest.plan} --issue ${manifest.issue}`
    if (!stdout.split('\n').some((line) => line.trim() === expected || line === `Run it with:  ${expected}`)
      || !stdout.includes(`step: ${step} (`)) {
      return OracleResult.refused(`ct-step output is not understood: ${JSON.stringify(stdout)}`)
    }
    return OracleResult.command(ticket, [verb, '--plan', manifest.plan, '--issue', String(manifest.issue)])
```

Contract (backend/src/infrastructure/ct-run-machine.ts):

```ts
export class AnnouncedStep {
  static read(stdout: string): AnnouncedStep | null
  readonly step: string
  readonly commands: readonly string[] | null
  readonly argv: readonly string[]
  readonly responseKind: string | null
}

class OracleBoundary {
  static #announcedCommand(
    stdout: string, announced: AnnouncedStep, ticket: string, step: string, verb: string,
  ): OracleResult
}
```

`read` parses `stdout` as one JSON object and answers `null` unless `version` equals
`ANNOUNCEMENT_VERSION` and `kind` equals `ANNOUNCEMENT_KINDS.STEP`. Both names come from
`'../../../plugin/scripts/step-announcement.js'`, the extension that file really has. The
constructor stays private, so `read` is the only way to build one.

`read` takes `step` from `run.step` and `commands` from `commands`, which is `null` when absent.
It takes `argv` from `consuming.argv`, which is `[]` when absent, and `responseKind` from
`dispatch.response.kind`, which is `null` when absent. `#plainCommand` calls `read` first and
hands the result to `#announcedCommand`, which refuses with today's bytes unless the three
demands of §2 hold.

**TDD:** `it('the announced controls step hands over the argv it published')` — feed
`OracleMother.controlsAnnouncementJson()` and expect the recorded successor argv to equal the
literal `[CT_STEP, 'controls', '--plan', PLAN, '--issue', '332']`. Then `it('an announced step
with no consuming argv is refused instead of run')`.

**Tests:** added to `backend/__tests__/infrastructure/ct-run-machine.test.ts`: `'the announced
controls step hands over the argv it published'`, `'an announced step with no consuming argv is
refused instead of run'`, `'prose keeps its own road while the backend asks for no flag'`.
`OracleMother` gains `controlsAnnouncementJson()`, which `StepAnnouncement.program` builds. The
producer writes the arrange and the test writes every expectation by hand.

**Verification:** The typecheck proves the reader's types. The unit suite proves both roads. The
real-process suite proves the loop still crosses the prose road end to end.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the reader and its members are erasable syntax
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — the field road and the prose road both answer
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine-real-process.test.ts   # expected: exit 0 — the real loop is untouched
```

### Task 4 — the reconcile verb announces the round it dispatches

**Objective:** `ct-step reconcile --output-format json` prints one dispatch announcement for a
round that dispatches `ct-reconciler`.

**Files:** `plugin/scripts/ct-step.mjs` (modify), `plugin/__tests__/e2e-ct-step.test.js`
(modify)

Current state (plugin/scripts/ct-step.mjs, lines 197-200):

```js
const announcing = outputFormatRaw === 'json'
if (announcing && verb !== 'next') {
  die('only "ct-step next" answers with an announcement', EXIT.USAGE)
}
```

Current state (plugin/scripts/ct-step.mjs, lines 2027-2028):

```js
      if (budgetLeft) {
        const packagePath = writeReconcileReviewPackage({ branch, round, attempt: nextReconcileAttempt() })
```

Contract (plugin/scripts/ct-step.mjs):

```js
const ANNOUNCING_VERBS = ['next', 'reconcile']
if (announcing && !ANNOUNCING_VERBS.includes(verb)) {
  die('only "ct-step next" and "ct-step reconcile" answer with an announcement', EXIT.USAGE)
}
const attempt = nextReconcileAttempt()
StepAnnouncement.dispatch({
  issue, task: run.task, tasksTotal: run.tasksTotal, step: run.step, attempt: currentAttempt(),
  inputs: [new AnnouncedInput({ role: INPUT_ROLES.RECONCILIATION_PACKAGE, kind: INPUT_KINDS.LITERAL, path: packagePath })],
  response: AnnouncedResponse.of(STEPS.RECONCILE, null),
  consuming: { argv: consumingArgv('reconcile') },
})
```

The import of `step-announcement.js` grows by `AnnouncedInput`, `INPUT_ROLES` and `INPUT_KINDS`.
Two rounds build that announcement into a `let` of `reconcileVerb`: `CONFLICTING` with budget
left, and `ROUND_DISCARDED` with budget left. After its switch, `reconcileVerb` writes any
announcement it built with `safeWrite(1, announcement.text())`, and then returns its outcome as
before, so the run still advances and saves. A round that dispatches nobody announces nothing
yet, and slice 3 owns its transition. `nextReconcileAttempt()` runs once, because the package it
writes changes what a second call answers. The usage text names both verbs.

**TDD:** `it('a conflicting round announces the reconciler package and the edits channel')`. Run
`reconcile --output-format json` on `worktreeInConflict()`. Expect `dispatch.inputs` to equal one
literal input, whose path is `.agent/run-4/reconcile-package-1.md` under `realpathSync(dir)`.
Expect `dispatch.response` to equal `{ kind: 'edits', path: null }`. Expect `consuming.argv` to
equal the literal reconcile argv. Then `it('a round with nobody to dispatch still advances the
run under the flag')`.

**Tests:** added to `plugin/__tests__/e2e-ct-step.test.js`: `'a conflicting round announces the
reconciler package and the edits channel'`, `'a round with nobody to dispatch still advances the
run under the flag'`. The test `'a verb other than next refuses the flag'` keeps its name and
its subject, because it asks with `controls`.

**Verification:** The e2e file proves the announced round and the run's state. The announcement
file proves `next` keeps answering and a third verb keeps refusing.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/e2e-ct-step.test.js   # expected: exit 0 — the conflicting round announces its package and the run still advances
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-announcement-real-process.test.js   # expected: exit 0 — controls still refuses the flag
```

### Task 5 — the backend's reconciler branch reads the announced round

**Objective:** The reconciler branch of `OracleBoundary.read` takes its argv from the announced
round, and keeps its prose road.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/src/infrastructure/run-dispatch.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify)

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 313-322):

```ts
    const reconcileCommand = `When it comes back:  ct-step reconcile --plan ${manifest.plan} --issue ${manifest.issue}`
    if ((output.stdout.includes('DISPATCH ct-reconciler') || output.stdout.includes('REDISPATCH ct-reconciler'))
      && output.stdout.split('\n').some((line) => line.trim().startsWith(reconcileCommand))) {
      try {
        const consuming = RunConsumingCommand.edits({
          stdout: output.stdout,
          plan: manifest.plan,
          issue: manifest.issue,
        })
        return OracleResult.call(command.ticket, consuming.argv, consuming)
```

Contract (backend/src/infrastructure/run-dispatch.ts):

```ts
export class RunConsumingCommand {
  static forEdits(argv: readonly string[]): RunConsumingCommand
}
```

`forEdits` raises `RunNotUnderstood` unless `argv[0]` equals `reconcile`, and builds the command
with a `responsePath` of `null`, which is what `RunDispatch.#edits` demands. In
`OracleBoundary.read`, the announced road runs before the prose one: an `AnnouncedStep` whose
`responseKind` equals `RESPONSE_KINDS.EDITS` answers `OracleResult.call(command.ticket,
announced.argv, RunConsumingCommand.forEdits(announced.argv))`. `RESPONSE_KINDS` comes from
`'../../../plugin/scripts/step-announcement.js'`. The prose road below it keeps every byte it
has today.

**TDD:** `it('the announced reconciler round answers with a call and not with a command')`. Feed
`OracleMother.reconcilerRoundJson()`. Expect a `RunInstruction` of kind `call`, on the ticket the
prose road answers with today. Then `it('the announced round publishes the reconcile argv and the
edits channel')`, over `AnnouncedStep.read` of that line: `responseKind` equals `'edits'` and
`argv` equals the literal `['reconcile', '--plan', OracleMother.PLAN, '--issue', '332']`. Last,
`it('an edits round whose first argument is a foreign verb is refused')`.

**Tests:** added to `backend/__tests__/infrastructure/ct-run-machine.test.ts`: `'the announced
reconciler round answers with a call and not with a command'`, `'the announced round publishes
the reconcile argv and the edits channel'`, `'an edits round whose first argument is a foreign
verb is refused'`. `OracleMother` gains `reconcilerRoundJson()`, one literal JSON line, built by
`StepAnnouncement` in the mother and never by the reader under test.

**Verification:** The typecheck proves the new static. The unit suite proves the announced round
and the refusal. The real-process suite proves the prose road still resolves a real merge
conflict and reaches `run delivered:`.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the static and its caller agree
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — the announced round and its refusal
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine-real-process.test.ts   # expected: exit 0 — a real conflict still reaches the reconciler
```

### Task 6 — the announced round carries its inputs to the dispatch

**Objective:** `RunDispatch` takes the reconciliation package from the announced round and not
from prose.

**Files:** `backend/src/infrastructure/run-announcement.ts` (modify),
`backend/src/infrastructure/run-dispatch.ts` (modify),
`backend/__tests__/infrastructure/run-announcement.test.ts` (modify)

Current state (backend/src/infrastructure/run-dispatch.ts, lines 290-299):

```ts
  static #reconciliationInputs(stdout: string): readonly DispatchInput[] {
    try {
      return RunDispatch.#inputsOf(DispatchProse.read({ stdout, step: STEPS.RECONCILE }))
    } catch (cause) {
      if (cause instanceof UnreadableStepProse) {
        throw new RunNotUnderstood(`ct-step output has no supported reconciliation material: ${cause.detail}`)
      }
      throw cause
    }
  }
```

Contract (backend/src/infrastructure/run-announcement.ts):

```ts
export type AnnouncedInput = {
  readonly role: string
  readonly kind: string
  readonly path: string
}
export class RunAnnouncement {
  readonly inputs: readonly AnnouncedInput[] | null
}
```

`inputs` answers the frozen list of `dispatch.inputs` for an announcement of kind `step`. It
answers `null` for every other kind, and for a step that declares no input. A member whose
`role`, `kind` or `path` is not a string raises `RunNotUnderstood`, the error every other
refusal of this class raises.

In `#reconciliationInputs` the announced road runs before the prose one. The method asks
`RunAnnouncement.of` for the announcement. Then it maps every input of the role
`reconciliation-package` to a `DispatchInput` of the same `kind` and `path`. The prose road
below keeps every byte it has today, because a human who runs `ct-step reconcile` with no flag
still reads prose.

**TDD:** `it('the announced round takes its reconciliation package from the announcement')`.
Feed the JSON line of a round that dispatches. Expect `inputs` to equal the literal
`[{ role: 'reconciliation-package', kind: 'literal', path: '.agent/reconcile-package.md' }]`.
Then `it('an announced input with no path is refused')`.

**Tests:** added to `backend/__tests__/infrastructure/run-announcement.test.ts`: `'the announced
round takes its reconciliation package from the announcement'`, `'an announced input with no
path is refused'`, `'an announcement of kind transition carries no inputs'`. Removed on
purpose: none.

**Verification:** The typecheck proves the new field and its caller agree. The unit suite proves
the reader and its refusal. The predicate proves the dispatch asks the announcement.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the field and its caller agree
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-announcement.test.ts   # expected: exit 0 — the reader and its refusal
test "$(grep -c 'RunAnnouncement.of' backend/src/infrastructure/run-dispatch.ts)" -ge 1   # expected: exit 0 — the dispatch asks the announcement
```

## 8. Global verification

The two suites below prove the slice end to end. The five program steps announce their fields,
the reconcile verb announces its round, and both prose roads still answer. Read the diff of
`ct-step.mjs` with human eyes. Check that no `out()` line says something else.

The block names files rather than whole suites, and §9.15 says why. Two whole-suite tests time
out on a loaded machine, and neither belongs to this slice.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-announcement-real-process.test.js __tests__/e2e-ct-step.test.js   # expected: exit 0 — every program step announces its fields
cd backend && npm run typecheck   # expected: exit 0 — the whole graph is sound
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts __tests__/infrastructure/ct-run-machine-real-process.test.ts   # expected: exit 0 — both field roads and both prose roads answer
test -z "$(grep -L 'AnnouncedStep' backend/src/infrastructure/ct-run-machine.ts)"   # expected: exit 0 — the reader reached the boundary that needed it
test -z "$(git status --porcelain)"   # expected: exit 0 — every task committed its work
```

## 9. Assumptions

1. No groomed GitHub issue exists for this slice, so row 4 of «Tabla de slices» and its two
   `Acepta` criteria are the frozen input. Provenance: the kickoff brief, which also forbids
   opening one.
2. The backend keeps no flag on `#nextArgv` or `#runnerArgv`, so each new field road sits beside
   its prose road until slice 5. Provenance: own call, forced by measurement. Under the flag
   `out` is a no-op. So the prose of every step disappears at once, while slice 2's `#printed`
   and slice 3's regexes still read prose. Slice 5's own criterion says nobody could delete
   `RunConsumingCommand` earlier, which holds only while the prose road still runs.
3. Slice 3 edits different branches of `OracleBoundary.read` at the same time as this slice: its
   refusal branch and its `next:` and `run delivered:` patterns. This slice owns
   `#plainCommand` and the reconciler branch at lines 313-325. Whoever reconciles takes both
   sides of that switch, and neither deletes the other's branch.
4. Slice 3 will want an announcement reader of its own for a transition and a refusal. It should
   extend `AnnouncedStep` rather than add a second reader. Provenance:
   `plugin/conventions/decisions.md`, which forbids the same partition in two places.
5. `run-dispatch.ts` gains `RunConsumingCommand.forEdits`, so slices 2 and 4 share that file.
   «Enfoque técnico» says no backend file joins 2 and 4, and this one does. Provenance: measured
   — `RunDispatch.#edits` refuses unless the command carries a `responsePath` of `null` and a
   first argument of `reconcile`. No factory builds such a command without prose.
6. `ct-step reconcile` answers the flag, which slice 1 gave to `next` alone. Provenance: own
   call. The second criterion names the reconciler branch, and that branch reads the reconcile
   verb's stdout and never `next`'s. A round with nobody to dispatch announces nothing yet,
   because a conflicting round stays open and a closing round is slice 3's transition.
7. `commands` is `[]` for `commit`, `reconcile` and `e2e`. Provenance: own call. Those three
   measure no command of their own, and the one line their prose prints is already the consuming
   command.
8. The e2e announcement carries the placeholder `<file.json>`. Provenance: the prose prints it,
   because `ct-step` does not choose that path. The backend's `STEPS.E2E` branch keeps
   `OracleResult.call(command.ticket, [])` and runs that argv never.
9. The manifest check leaves the field road. Provenance: measured — the backend passes
   `manifest.plan` and `manifest.issue` to `ct-step`, and `ct-step` builds the announced argv
   from its own `--plan` and `--issue`. So the hand-built line could only fail on a rewording.
10. The backend reads `commands` for its shape and for nothing else. Provenance: own call —
    `OracleResult.command` carries an argv only, and a new member of it would reach the page,
    which the design's anti-scope parks.
11. Every command that launches `ct-step` clears `CT_STATE_DIR` with `env -u`. Provenance:
    measured — that variable reddens 38 tests across 8 files, and this machine exports it.
12. The brief names `an_absolute_one_is_taken_and_the_command_carries_on_reporting` as a test
    that already fails. Measured on this tree it passes, with 41 of 41 green under `env -u
    CT_STATE_DIR`. Whoever implements this plan reads a failure there as not their own.
13. `dispatch-check --check-plan` reports three literality violations, all of them in slice 1's
    committed plan, because slice 1's own tasks rewrote the files that plan cites. This plan
    does not edit that file. Provenance: measured on this worktree before any change of mine.
14. The announced round's inputs reach `RunDispatch` only after slice 2 rewrites `#material`,
    which reads `dispatch.inputs` by role. So `machine.dispatch` over a JSON stdout still raises
    `ct-step output has no dispatch role`, and Task 5 does not pin that. This slice announces
    the `reconciliation-package` input and stops there, rather than write a second announced
    road inside the one method slice 2 rewrites. Provenance: own call, and
    `plugin/conventions/decisions.md` on the helper that leaves a decision in two places.

    **This assumption did not hold, and Task 6 answers it.** Slice 2's Task 4 took only the
    consuming argv from the announcement. `#material` still reads prose for the four dispatch
    roles, and that is right. Slice 3 puts the flag on the consuming verbs alone, so `next`
    keeps its prose. Only the reconcile round loses its prose, because `reconcile` is a
    consuming verb. Provenance: the coordinating session measured it on `360f8181`.
15. §8 names files rather than whole suites. Provenance: measured on this worktree with no
    change of mine, while two other agents ran their own suites on this machine. The whole
    backend suite times out at `run-dispatch-real-process.test.ts:538`, the tautological argv
    test slice 1's own Task 5 replaces. The whole plugin suite times out at
    `ct-init.test.js:1103`. Both are timeouts under load, not red assertions, and this slice
    touches neither file. A whole-suite command in §8 would block `ct-step global` for the same
    reason.

16. Slice 3's Task 4 classifies closures alone. Its own text reads as though an announcement of
    kind `step` reaches `refused`. Its implementer departed from that on purpose: a refusal
    there would kill the `AnnouncedStep` road slice 2 landed. So Task 5's reconciler branch
    stays reachable, and the two readers need no order between them. Provenance: Task 4's
    reviewer raised the risk, and slice 3's own implementer measured the answer.
