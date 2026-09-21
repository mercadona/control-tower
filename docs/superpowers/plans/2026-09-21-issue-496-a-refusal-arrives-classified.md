# #496 — a refusal arrives classified

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`ct-step` is the loop's oracle. Every verb closes with prose. A verb that leaves the run open
prints `next: task N/M, step X — ask with "ct-step next"`. A verb that closes the run prints
`run <state>: task N/M, K discard(s)`.

The backend never reads that closure on a failure. `OracleBoundary.read`
(`ct-run-machine.ts:300-303`) checks the exit code first and pastes the bytes into one string,
`ct-step exited ${code}; stdout: …; stderr: …`. That string becomes the `uncertain` phase's
diagnostic, and `GET /active-plans` hands it to the page as it stands. So a spent discard
budget, a judge's veto, red controls and a wrong environment all reach the reader as the same
shape.

Four regexes carry the rest of the reading. Two of them parse the same `step:` line with two
different alphabets — `([a-z0-9-]+)` at `ct-run-machine.ts:328` and `([a-z-]+)` at
`run-dispatch.ts:173`. No `STEPS` value carries a digit today, so that one is latent.

Slice 1 declared the whole announcement. `StepAnnouncement.transition` and
`StepAnnouncement.refusal` exist, tested, with their key order fixed. No verb prints them, and
only `next` answers `--output-format json`. This slice prints them and makes the backend read
them.

### Desired end state

- Every `ct-step` verb accepts `--output-format json`. The two refusals of slice 1 are gone.
- The closure of a verb prints one announcement. It prints a `transition` when the exit code is
  0. It prints a `refusal` with `state`, `outcome`, `exit` and `detail` when the code is not 0.
- A spent discard budget prints a `refusal` of `blocked-judge` and `discarded` with exit 3.
- `ct-step next` on a delivered run prints a `transition` of `delivered` with exit 0.
- `backend/src/infrastructure/run-announcement.ts` reads one announcement, refuses an unknown
  `version`, and composes the diagnostic sentence in one place.
- `CtRunMachine` asks every consuming verb for the announcement, and `OracleBoundary.read`
  classifies from it.
- The four regexes no longer exist. One reader, `StepProse.step`, answers which step the prose
  names, and it validates the name against `STEPS` instead of against an alphabet.
- `GET /active-plans` carries a `refusal` object with `state`, `outcome` and `exit`, beside the
  diagnostic. A spent budget, red controls and a wrong environment then differ as fields.

### Out of scope

- The thirteen `EXIT` codes, the ten `RUN_STATES` and their meanings. This slice publishes
  them; it changes none of them.
- The frontend. `Home.tsx` keeps every line. A-1 of the execution spec parks that work.
- The fourteen prose labels, the five announcement sentences, `RunDispatch.#printed`,
  `#literal`, `#optionalLiteral`, `#glob` and `#requireAnnouncement`. Slice 2 retires them.
- `dispatch.agent`, `dispatch.inputs[]`, `commands[]` and `consuming.argv` as printed fields.
  Slices 2 and 4 populate them. This slice passes none of them.
- `OracleBoundary.#plainCommand` and the reconciler's prose branch. Slice 4 owns both.
- `RunConsumingCommand`. Slice 5 deletes it.
- `--output-format json` on `ct-step next` as the backend asks for it. `#nextArgv` keeps
  today's argv, because the prose of `next` still feeds slices 2 and 4.
- The wording of every `out()` line. No line changes what it says.
- The discard budget itself. An absent answer keeps costing a discard.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| The source of the shape | `plugin/scripts/step-announcement.js`, as slice 1 closed it |
| What a verb prints | one announcement per invocation, on stdout, nothing else |
| The flag | `--output-format json`, for every verb |
| The version field | `version: 1`; an unknown version refuses instead of a guess |
| Which kind a closure prints | `transition` when the exit code is 0, `refusal` when it is not |
| What a refusal publishes | the inputs of `exitCodeOf`: `state`, `outcome`, and its code |
| The step a closure names | `before`, the step the verb applied, as `exitCodeOf` reads it |
| The `detail` of a closure | the footer's own sentence, `run <state>: task N/M, K discard(s)` |
| A spent discard budget | `blocked-judge` and `discarded`, exit 3, with its own message |
| A delivered run under the flag | a `transition` of `delivered` and `done`, exit 0 |
| An unannounced non-zero exit | refused, with the code and the bytes, and no classification |
| Where the backend reads | `backend/src/infrastructure/run-announcement.ts`, a new module |
| Which verbs get the flag | the consuming verbs, through `#runnerArgv` |
| How the prose names its step | `StepProse.step`, one home, validated against `STEPS` |
| The alphabet of a step name | none: membership of `STEPS` decides |
| The typed error of a bad read | `RunNotUnderstood`, as `RunConsumingCommand` already raises |
| What the API adds | `refusal: { state, outcome, exit }`, beside `diagnostic` |
| The model and the tool list | stay in the agent markdown; they never travel |
| Feature flag | none; this repository's `flag-discipline` default is off |

## 3. Reference patterns

Files to imitate: `plugin/scripts/step-announcement.js` is the pure module this slice fills.
`plugin/__tests__/ct-step-announcement-real-process.test.js` drives the real `ct-step` through
the harness. `backend/src/infrastructure/run-dispatch.ts` holds `RunConsumingCommand`, the
typed reader of `ct-step`'s output, with `RunNotUnderstood` for every refusal.

`backend/src/infrastructure/run-journal.ts` shows a frozen record read from text.
`backend/src/domain/value-objects/run-instruction.ts` shows a discriminated union frozen per
case. `backend/__tests__/infrastructure/ct-run-machine.test.ts` holds `OracleMother` and its
literal stdout. `backend/__tests__/infrastructure/run-plan-recovery.test.ts` holds
`ProjectionScenario`, which asserts `activePlans.known()`.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/defects.md`,
`plugin/conventions/domain.md`, `plugin/conventions/simplicity.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/ct-step.mjs` | modify | the loop, the backend | Current state |
| `plugin/__tests__/ct-step-announcement-real-process.test.js` | modify | the plugin suite | none (bodies by TDD) |
| `backend/src/infrastructure/run-announcement.ts` | create | `ct-run-machine.ts`, `run-dispatch.ts` | Contract |
| `backend/__tests__/infrastructure/run-announcement.test.ts` | create | the backend suite | none (bodies by TDD) |
| `backend/src/infrastructure/ct-run-machine.ts` | modify | `RunPlanRecovery`, `DriveRun` | Current state, Contract |
| `backend/src/infrastructure/run-dispatch.ts` | modify | `ct-run-machine.ts` | Current state |
| `backend/src/domain/value-objects/run-instruction.ts` | modify | `ct-run-machine.ts` | Current state |
| `backend/src/infrastructure/run-plan-recovery.ts` | modify | `ActivePlansRoute` | Current state |
| `backend/src/infrastructure/active-plans-route.ts` | modify | `GET /active-plans` | Current state, Contract |
| `backend/__tests__/infrastructure/ct-run-machine.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/run-plan-recovery.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts` | modify | the backend suite | Current state |

## 5. Interfaces

Consumes, from `plugin/scripts/step-announcement.js`: `ANNOUNCEMENT_VERSION`,
`ANNOUNCEMENT_KINDS`, `StepAnnouncement.transition(asked)`, `StepAnnouncement.refusal(asked)`
and `StepAnnouncement#text()`. From `plugin/scripts/run-machine.js`: `STEPS`, `RUN_STATES` and
`OUTCOMES`. From `backend/src/domain/exceptions.ts`: `RunNotUnderstood`.

Produces, from `backend/src/infrastructure/run-announcement.ts`:
`RunAnnouncement.of(stdout): RunAnnouncement | null`, with the readonly members `kind`, `step`,
`closure` and `diagnostic`; `StepProse.step(stdout): string | null`; and the exported type
`RunClosure`. The refusal of `OracleEffect`, `RunWork` and `InspectionFact` each gain a
`closure` member of that type. `ProjectedActivePlan` gains an optional `refusal` of that type,
and `ActivePlans.rememberUncertain` takes it as a fourth argument. Slice 5 deletes `StepProse`
when the prose road has no reader left.

## 6. Test strategy

Tasks 1 and 2 drive the real `ct-step` through `plugin/__tests__/fixtures/ct-step-harness.js`,
in the `-real-process` file `plugin/conventions/testing.md` asks for. Every literal in them is
a hand-written JSON object, never a value the production module composed.

Task 3 unit-tests the new reader with literal stdout. Tasks 4, 5 and 6 assert the effect
`OracleBoundary.read` returns for a literal announcement, in `ct-run-machine.test.ts`. Task 7
asserts the projection of `GET /active-plans` for three refusals with a doubled machine, in
`run-plan-recovery.test.ts`.

`backend/__tests__/infrastructure/run-dispatch-real-process.test.ts:538` asserts the composed
argv, and it recomputes that argv with the production recipe. So it cannot fail for a missing
argument. This slice does not compose that argv, so that test stays as slice 1 left it. Every
assertion here states its expectation as a literal. A denial names the whole flag, never one
serialized value of it.

## 7. Tasks

### Task 1 — every verb answers the flag with its closure

**Objective:** Every `ct-step` verb prints its transition or its refusal under the flag.

**Files:** `plugin/scripts/ct-step.mjs` (modify),
`plugin/__tests__/ct-step-announcement-real-process.test.js` (modify)

Current state (plugin/scripts/ct-step.mjs, lines 197-200):

```js
const announcing = outputFormatRaw === 'json'
if (announcing && verb !== 'next') {
  die('only "ct-step next" answers with an announcement', EXIT.USAGE)
}
```

Current state (plugin/scripts/ct-step.mjs, lines 2753-2761):

```js
  if (transition.state === RUN_STATES.OPEN) {
    out('')
    out(`next: task ${run.task}/${run.tasksTotal}, step ${run.step} — ask with "ct-step next"`)
    process.exit(EXIT.OK)
  }

  out('')
  out(`run ${transition.state}: task ${run.task}/${run.tasksTotal}, ${run.discards} discard(s)`)
  process.exit(exitCodeOf(transition.state, before, outcome))
```

The three lines of the first block become one: `const announcing = outputFormatRaw === 'json'`.
The `USAGE` line for the flag now reads
`  --output-format json     every verb answers with one JSON object on stdout instead of prose`.

In the second block the `OPEN` branch keeps its two `out` lines and then writes
`StepAnnouncement.transition({ issue, task: run.task, tasksTotal: run.tasksTotal, step: before,
discards: run.discards, state: transition.state, outcome, exit: EXIT.OK })` under `announcing`.
The closing branch holds the footer sentence in a `const` and passes it to `out` and to the
announcement. It then calls `exitCodeOf` once, after those `out` lines, so the delivered line
keeps its place. With a code of `EXIT.OK` it writes a `transition`; otherwise it writes a
`refusal` with that `const` as `detail`. Both roads write with `safeWrite(1, …text())`, and
exit with the code `exitCodeOf` returned.

**TDD:** `it('a consuming verb answers the flag with its transition')` — `ct('report',
writeReport(['uno.txt']), '--output-format', 'json')` on a fresh run. Expect exit 0 and stdout
that parses to the literal `{ version: 1, kind: 'transition', state: 'open', outcome: 'done',
exit: 0, run: { issue: 7, task: 1, tasksTotal: 2, step: 'implement', discards: 0 } }`. Then
`it('a verb that closes the run in failure answers with its refusal')`.

**Tests:** added to `ct-step-announcement-real-process.test.js`: `'a consuming verb answers the
flag with its transition'`, `'a verb that closes the run in failure answers with its
refusal'`. The second reaches the closure with `taskOk('uno.txt')`, `taskOk('dos.txt')`,
`ct('reconcile')`, `ct('global')` and a `slice-verdict` of `writeSliceVerdict('FAIL', [{ detail:
'no' }])` under the flag. Expect exit 1 and the literals `state: 'blocked-slice-judge'`,
`outcome: 'failed'`, `step: 'slice-judge'` and `detail: 'run blocked-slice-judge: task 2/2, 0
discard(s)'`. Removed on purpose: `'a verb other than next refuses the flag'`.

**Verification:** The first command proves the two new announcements and every announcement of
slice 1. The second proves no other `ct-step` test reads a changed line.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-announcement-real-process.test.js   # expected: exit 0 — the closure of a verb announces itself
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-oracle.test.js __tests__/e2e-ct-step.test.js   # expected: exit 0 — the prose road is untouched
```

### Task 2 — the two closures that skip the transition answer in the contract

**Objective:** The two closures that exit before `after()` runs print their own shape.

**Files:** `plugin/scripts/ct-step.mjs` (modify),
`plugin/__tests__/ct-step-announcement-real-process.test.js` (modify)

Current state (plugin/scripts/ct-step.mjs, lines 2730-2733):

```js
  if (run.discards >= MAX_DISCARDS && outcome === OUTCOMES.DISCARDED) {
    save()
    die(`${run.discards} discards in this run: it stops instead of going on asking for answers that cannot be read`, EXIT.NO_VERDICT)
  }
```

This branch runs before `after()`, so no transition exists yet. It announces the pair
`exitCodeOf` maps to `EXIT.NO_VERDICT`: `state: RUN_STATES.BLOCKED_JUDGE` and `outcome:
OUTCOMES.DISCARDED`, with `exit: EXIT.NO_VERDICT`, `step: run.step`, `discards: run.discards`
and the `die` message as `detail`. Hold that message in a `const` and pass it to both, so the
stderr line and the `detail` stay one sentence. Under `announcing`, write the refusal to stdout
with `safeWrite` before the `die` call. `die` keeps its message and its code on both roads.

A delivered run is the second closure of the same family. It needs no block: slice 1 created
the code it changes, so this branch's base does not carry it.

In `plugin/scripts/ct-step.mjs`, the `run.closed === RUN_STATES.DELIVERED` branch answers
`next` before `after()` runs. So it holds no transition either. Slice 1 left a `die` there
under the flag, with a comment that names a later slice as the owner. This task is that owner.

Replace that `die` with a transition. It carries `state: RUN_STATES.DELIVERED`, `outcome:
OUTCOMES.DONE` and `exit: EXIT.OK`, and `safeWrite` puts it on stdout before the exit. The
`out` line below it keeps its words and its place. The backend task that retires `#delivered`
reads what this task writes.

**TDD:** `it('a spent discard budget announces the refusal that stops the run')` — six
unreadable verdicts through `writeRaw('not json')`, each one answered with `ct('verdict', …)`,
and the sixth one under the flag. Expect exit 3. Expect a literal with `kind: 'refusal'`,
`state: 'blocked-judge'`, `outcome: 'discarded'` and `exit: 3`. Expect a `detail` that starts
with `6 discards in this run:`.

**Tests:** added to `plugin/__tests__/ct-step-announcement-real-process.test.js`: `'a spent
discard budget announces the refusal that stops the run'`, `'a delivered run announces the transition that closes it'`. Nothing removed.

**Verification:** The first command proves the refusal and keeps the rest of the file green.
The second proves the stderr road of the same branch still says what it said.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-announcement-real-process.test.js   # expected: exit 0 — the spent budget refuses with its classification
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-verdict.test.js   # expected: exit 0 — the discard road keeps its message
```

### Task 3 — the backend reads one announcement, and names the step once

**Objective:** A new backend module reads an announcement and answers which step the prose
names.

**Files:** `backend/src/infrastructure/run-announcement.ts` (create),
`backend/__tests__/infrastructure/run-announcement.test.ts` (create)

Contract (backend/src/infrastructure/run-announcement.ts):

```ts
export type RunClosure = { readonly state: string, readonly outcome: string, readonly exit: number }

export class RunAnnouncement {
  readonly kind: 'step' | 'transition' | 'refusal'
  readonly step: string
  readonly closure: RunClosure | null
  readonly diagnostic: string
  static of(stdout: string): RunAnnouncement | null
}

export class StepProse {
  static step(stdout: string): string | null
}
```

`of` answers `null` when the first non-blank character of `stdout` is not `{`. That is the
prose road, and no prose line starts with a brace.

Past that point every fault raises `RunNotUnderstood`. The faults are bad JSON, a `version`
other than `ANNOUNCEMENT_VERSION`, a `kind` outside `ANNOUNCEMENT_KINDS` and an absent
`run.step`. They also are a `state` outside `RUN_STATES`, an `outcome` outside `OUTCOMES`, a
non-integer `exit` and a `refusal` with an empty `detail`.

`closure` holds `null` for `kind: 'step'`. For a refusal, `diagnostic` reads `ct-step refused:
the run is <state> with outcome <outcome> (exit <exit>) — <detail>`. For the other kinds it
names the kind and the step.

`StepProse.step` splits `stdout` on newlines and takes the one line that starts with `step: `.
It cuts that line at the first ` (`. It answers the name only when `Object.values(STEPS)` holds
it. No regex, and no character class: the vocabulary decides.

**TDD:** `it('a refusal composes the diagnostic from its state outcome and exit')` — the
literal stdout `{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"discarded","exit":3,"run":{"issue":9,"task":1,"tasksTotal":2,"step":"judge","discards":6},"detail":"6 discards"}`
and the whole expected sentence written by hand. Then `it('an announcement of an unknown
version is not understood')` with `"version":2`.

**Tests:** added to `backend/__tests__/infrastructure/run-announcement.test.ts`: `'a refusal
composes the diagnostic from its state outcome and exit'`, `'an announcement of an unknown
version is not understood'`, `'prose answers null instead of an announcement'`, `'a transition
of an undeclared state is not understood'`, `'a refusal with an empty detail is not
understood'`, `'the step of the prose comes from the declared vocabulary'`, `'a step name
outside the vocabulary answers null'`.

**Verification:** The first command proves every rule of the reader. The second proves the new
module typechecks against the plugin vocabularies it imports.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-announcement.test.ts   # expected: exit 0 — the reader obeys its seven rules
cd backend && npm run typecheck   # expected: exit 0 — the new module and its imports are sound
```

### Task 4 — the oracle asks for the announcement and classifies the closure

**Objective:** The backend asks every consuming verb for the announcement and reads its
closure.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts` (modify)

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 666-668):

```ts
  #runnerArgv(argv: readonly string[]): readonly string[] {
    return Object.freeze([this.ctStep, ...argv])
  }
```

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 299-306):

```ts
    const output = command.receipt.output
    if (output.code !== 0) {
      return OracleResult.refused(
        `ct-step exited ${output.code}; stdout: ${JSON.stringify(output.stdout)}; stderr: ${JSON.stringify(output.stderr)}`,
      )
    }
    if (OracleBoundary.#delivered(output.stdout)) {
      return OracleResult.delivered()
```

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 353-355):

```ts
    if (/^next: task \d+\/\d+, step [a-z-]+ — ask with "ct-step next"$/m.test(output.stdout)) {
      return OracleResult.next()
    }
```

`#runnerArgv` appends `'--output-format', 'json'`. `#nextArgv` keeps today's argv. In `read`,
`RunAnnouncement.of(output.stdout)` runs right after the receipt check. A `try` turns
`RunNotUnderstood` into `OracleResult.refused(cause.message)`.

A `transition` of `RUN_STATES.OPEN` answers `next()`. One of `RUN_STATES.DELIVERED` answers
`delivered()`. Any other `transition`, every `refusal` and a `kind` of `step` answer
`refused(announcement.diagnostic)`. With no announcement and a non-zero code it reads
`ct-step exited ${output.code} without announcing a run state; stdout: …; stderr: …`. Delete
`#delivered`, its helper `#escape`, and the `next:` block above.

**TDD:** `it('a transition that leaves the run open asks for the next step')` — the literal
receipt stdout `{"version":1,"kind":"transition","state":"open","outcome":"done","exit":0,"run":{"issue":332,"task":1,"tasksTotal":3,"step":"implement","discards":0}}`
and the effect `{ kind: 'next' }`. Then `it('a refusal reaches the instruction as its own
diagnostic')`.

**Tests:** added to `ct-run-machine.test.ts`: `'a transition that leaves the run open asks for
the next step'`, `'a transition of delivered closes the run'`, `'a refusal reaches the
instruction as its own diagnostic'`, `'a non-zero exit with no announcement says so'`, `'the
consuming argv asks for the announcement'`. `OracleMother` gains an announcement helper per
kind, and keeps its prose helpers. `run-driver-mother.ts` polls for
`'"kind":"transition","state":"delivered"'`, and its `FiniteBridge` receipts carry
announcements. The stale-ticket test expects `ct-step exited 9 without announcing a run state`.

**Verification:** The first command proves the classification and the argv. The second crosses
the real `ct-step` with the real reader.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — every closure is read from the announcement
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine-real-process.test.ts   # expected: exit 0 — the real oracle and the real reader agree
```

### Task 5 — one reader names the step, and the two alphabets go

**Objective:** Both readers of the `step:` line call `StepProse.step`, so neither alphabet
remains.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/src/infrastructure/run-dispatch.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify)

Current state (backend/src/infrastructure/ct-run-machine.ts, line 328):

```ts
    const step = /^step: ([a-z0-9-]+) \(attempt \d+\)$/m.exec(output.stdout)?.[1]
```

Current state (backend/src/infrastructure/run-dispatch.ts, line 173):

```ts
    const step = /^step: ([a-z-]+) \(attempt \d+\)$/m.exec(asked.stdout)?.[1]
```

Both lines become a call to `StepProse.step`, with `output.stdout` and `asked.stdout`. The
reader answers `string | null`, so the `case undefined:` arm of `OracleBoundary.read`'s switch
becomes `case null:`, and the `switch` in `RunDispatch.#material` keeps its arms. After this
task neither file holds a regular expression over `ct-step`'s prose. `run-dispatch.ts` imports
`StepProse` from `./run-announcement.ts`, which imports nothing from either file, so no cycle
appears.

**TDD:** `it('both prose readers name the same step for the same bytes')` — the literal stdout
`step: slice-judge (attempt 2)` through `StepProse.step`, and the effect of
`OracleBoundary.read` over a receipt carrying the same line. Expect the one name
`'slice-judge'`. Then `it('a step name with a digit is not a declared step')` with `step:
judge2 (attempt 1)`.

**Tests:** added to `backend/__tests__/infrastructure/ct-run-machine.test.ts`: `'both prose
readers name the same step for the same bytes'`, `'a step name with a digit is not a declared
step'`. Nothing removed.

**Verification:** The first command proves the shared reader over both consumers. The second
proves that neither file still holds an alphabet or an `(attempt` pattern.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — one reader serves both consumers
test -z "$(grep -l '(attempt' backend/src/infrastructure/ct-run-machine.ts backend/src/infrastructure/run-dispatch.ts)"   # expected: exit 0 — neither pattern remains
```

### Task 6 — the classification travels to the inspection

**Objective:** The refusal carries its `state`, `outcome` and `exit` from the oracle to the
inspection.

**Files:** `backend/src/domain/value-objects/run-instruction.ts` (modify),
`backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify)

Current state (backend/src/domain/value-objects/run-instruction.ts, line 4):

```ts
  | { readonly kind: 'refused'; readonly detail: string }
```

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 51-52):

```ts
  static refused(detail: string): OracleResult {
    return new OracleResult({ kind: 'refused', detail })
```

Contract (backend/src/domain/value-objects/run-instruction.ts):

```ts
export type RunWork =
  | { readonly kind: 'call' | 'command'; readonly ticket: string }
  | { readonly kind: 'delivered' }
  | { readonly kind: 'refused'; readonly detail: string; readonly closure: RunClosure | null }
```

`RunInstruction.#freeze` freezes `closure` beside `detail`, and it keeps the non-empty check on
`detail` alone. `OracleResult.refused(detail, closure: RunClosure | null = null)` carries it,
and so do `OracleEffect`'s `refused` arm, `InspectionFact`'s `uncertain` arm, `RunInspection`'s
`uncertain` case and `CtRunMachine.#instructionOf`. The announced refusal of Task 4 passes
`announcement.closure`; every other refusal passes the default. `RunPlanAgents` reads
`fact.detail` and keeps it.

**TDD:** `it('an announced refusal carries its state outcome and exit to the inspection')` — a
receipt with the literal refusal stdout of Task 4, and `machine.inspect`. Expect the fact
`{ kind: 'uncertain', detail: <the composed sentence>, closure: { state: 'blocked-judge',
outcome: 'discarded', exit: 3 } }`, written out by hand.

**Tests:** added to `backend/__tests__/infrastructure/ct-run-machine.test.ts`: `'an announced
refusal carries its state outcome and exit to the inspection'`, `'a refusal with no
announcement carries a null closure'`. Nothing removed.

**Verification:** The first command proves the value crosses the three layers. The second
proves every consumer of the two unions still compiles.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — the classification reaches the inspection
cd backend && npm run typecheck   # expected: exit 0 — every arm of both unions is handled
```

### Task 7 — the page tells a spent budget from red controls

**Objective:** `GET /active-plans` carries the refusal's `state`, `outcome` and `exit` as
fields.

**Files:** `backend/src/infrastructure/run-plan-recovery.ts` (modify),
`backend/src/infrastructure/active-plans-route.ts` (modify),
`backend/__tests__/infrastructure/run-plan-recovery.test.ts` (modify)

Current state (backend/src/infrastructure/run-plan-recovery.ts, lines 30-34):

```ts
  | {
    readonly phase: typeof ActivePlanPhase.UNCERTAIN,
    readonly diagnostic: string,
    readonly recovery: ActivePlanRecovery,
  }
```

Current state (backend/src/infrastructure/active-plans-route.ts, lines 156-158):

```ts
    if (diagnostic !== null) projected.diagnostic = diagnostic
    if (recovery !== null) projected.recovery = recovery
    return projected
```

Contract (backend/src/infrastructure/active-plans-route.ts):

```ts
export type ProjectedActivePlan = {
  // … every member of today, plus:
  refusal?: RunClosure,
}
```

`PlanOutcome`'s `UNCERTAIN` arm gains `readonly refusal: RunClosure | null`.
`RunPlanRecovery.#inspect(watch, detail, refusal: RunClosure | null = null)` stores it, and
`#uncertain` passes `null`. The `case 'uncertain'` arm of `#driver` becomes
`this.#inspect(watch, fact.detail, fact.closure)`. `FoundActivePlan`'s `UNCERTAIN` arm gains
`refusal: RunClosure | null`, `rememberUncertain` takes it as a fourth argument with `null` as
its default, and `#project` takes it as a sixth. `#project` writes the key only when the value
is not `null`, the same shape as the two lines above.

**TDD:** `it('a spent discard budget is reported apart from red controls')` — three
`ProjectionScenario` watches, each with a doubled inspection: `closure: { state:
'blocked-judge', outcome: 'discarded', exit: 3 }`, `{ state: 'blocked-controls', outcome:
'failed', exit: 4 }` and `null`. Expect three projections, the first two with those exact
`refusal` objects and the third with no `refusal` key at all.

**Tests:** added to `backend/__tests__/infrastructure/run-plan-recovery.test.ts`: `'a spent
discard budget is reported apart from red controls'`, `'a refusal with no classification
projects no refusal key'`. Nothing removed.

**Verification:** The first command proves the three projections differ as fields. The second
proves the route, the recovery and the API contract still hold together.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-plan-recovery.test.ts   # expected: exit 0 — three refusals project three different payloads
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/api-server.test.ts   # expected: exit 0 — the endpoint keeps its contract
cd backend && npm run typecheck   # expected: exit 0 — the optional field reaches every caller
```

## 8. Global verification

Three predicates prove the four regexes are gone. The first covers both `step:` patterns. The
suites prove the loop still crosses the real oracle. Read the diff of `ct-run-machine.ts` with
human eyes. Check that `#nextArgv` still carries no flag: slices 2 and 4 need that prose.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the whole backend graph is sound
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts __tests__/infrastructure/run-plan-recovery.test.ts __tests__/infrastructure/api-server.test.ts   # expected: exit 0 — reader, machine and route agree
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine-real-process.test.ts   # expected: exit 0 — the real oracle answers the real reader
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-announcement-real-process.test.js __tests__/step-announcement.test.js   # expected: exit 0 — every verb announces its closure
test -z "$(grep -l '(attempt' backend/src/infrastructure/ct-run-machine.ts backend/src/infrastructure/run-dispatch.ts)"   # expected: exit 0 — no step pattern is left in either file
test -z "$(grep -l 'next: task' backend/src/infrastructure/ct-run-machine.ts)"   # expected: exit 0 — the next pattern is gone
test -z "$(grep -l '#delivered' backend/src/infrastructure/ct-run-machine.ts)"   # expected: exit 0 — the delivered pattern is gone
test -z "$(git status --porcelain)"   # expected: exit 0 — every task committed its work
```

## 9. Assumptions

1. `#nextArgv` keeps today's argv and `#runnerArgv` gains the flag. Provenance: own call. Under
   the flag `out` writes nothing, so `ct-step next` would answer with JSON alone, and
   `RunDispatch.#material` and `OracleBoundary.#plainCommand` would have no prose to read.
   Those two belong to slices 2 and 4, which run in parallel with this one. A flag on `next`
   here would redden their ground before they touch it.
2. The two `step:` regexes die into one reader, not into a field. Provenance: own call, forced
   by assumption 1. The prose of `next` still arrives, so somebody must name its step.
   `StepProse.step` names it once, from `STEPS`, and that is why neither alphabet can diverge
   again. Slice 5 deletes it when the last prose reader goes.
3. A closure announces `transition` when its exit code is 0 and `refusal` when it is not.
   Provenance: own call from the design, which prints a transition for a run that stays open
   and a refusal for one that closes in failure. In the footer only `DELIVERED` and `OPEN`
   answer 0, so the rule and the two states agree.
4. A refusal's `detail` is the footer sentence the prose already prints. Provenance:
   the protected column, which forbids a change of words. A new sentence would be prose with
   no home, and slice 2 renders the prose from the announcement later.
5. The spent discard budget announces `blocked-judge` and `discarded`. Provenance: `exitCodeOf`
   maps exactly that pair to `EXIT.NO_VERDICT`, which is the code that `die` already passes.
   The branch runs before `after()`, so no transition exists to read the state from.
6. `RUN_STATES` has no `precondition` member, so a wrong environment cannot announce one.
   Provenance: measured — `run-machine.js:99-107` lists ten states and none of them is a
   precondition. A `die` before the run loads prints nothing on stdout, and the backend reports
   it as an exit with no announcement. That is the third case the acceptance criterion asks
   for, and it stays distinguishable as the absence of `refusal`.
7. `GET /active-plans` gains a field instead of a richer sentence. Provenance: A-1 of the
   execution spec, which says this slice publishes the classification the frontend needs. A
   sentence the page would have to parse is the defect this milestone removes.
8. The `--output-format json` line of `USAGE` changes its words, because it now names every
   verb. Provenance: own call. The protected column covers the `out()` lines. This one is a
   `die` payload, and the old line would state something false.
9. A run already in flight records prose receipts, and this slice stops reading them. That run
   reaches the page as uncertain, and a person restarts it. Provenance: the same class as
   assumption 6 of slice 1's plan, where a recorded call refuses a changed prompt.
10. `ct-run-machine.test.ts` carries the new machine tests instead of a file of its own.
    Provenance: `plugin/conventions/testing.md`, which asks whether the behaviour already has a
    home before a test gets a new one. `OracleMother` already builds these receipts.
11. Every command that launches `ct-step` or `vitest` clears `CT_STATE_DIR` with `env -u`.
    Provenance: measured on this tree with no change of mine. This machine exports that
    variable, and it reddens 38 unrelated tests across 8 files.
12. No command here runs a whole suite. Provenance: measured on this tree with no change of
    mine. Under load, `run-dispatch-real-process.test.ts:538` hits its inline 60-second cap and
    `plugin/__tests__/ct-status.test.js` and `ct-init.test.js` also time out. Each one passes
    alone on an idle machine. A timeout is not a defect of this slice. A command nobody has
    seen pass does not belong in a plan, so §8 names the files this slice touches.
13. Task 1 edits the one-line guard at `ct-step.mjs:198`, which gives the flag to `next` alone.
    Slice 4 edits the same line, because `ct-step reconcile` also has to answer the flag.
    Provenance: a sibling architect's finished plan, reported to me. Whoever reconciles the two
    branches keeps one deletion of that guard, not two.
14. `dispatch-check --check-plan` cannot reach exit 0 for #496 on this tree, and no task here
    changes that. Provenance: measured. `checkPlans` validates every `issue-496-` plan and
    returns on the first bad file, and slice 1's committed plan carries `[literality]`
    violations. Its own tasks rewrote the spans it cites, and `--check-plan` reads the working
    tree while `--release` reads the branch base those citations hold against. Nobody edits
    that file here, and this plan validates on its own through `validatePlan`.
