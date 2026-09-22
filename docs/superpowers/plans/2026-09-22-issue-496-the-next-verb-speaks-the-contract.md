# #496 — the next verb speaks the contract

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow this plan
> and `AGENTS.md`.

## 1. Context and goal

`ct-step` is the oracle of the loop. Slice 1 opened the JSON contract, and slice 3 put
`--output-format json` on every consuming verb. `CtRunMachine.#runnerArgv` appends that flag.
`CtRunMachine.#nextArgv` does not. So `ct-step next` still answers the backend in prose, and
`OracleBoundary.#fileCall` rebuilds the material of `implement`, `judge`, `advise` and
`slice-judge` out of that prose with `DispatchProse.read`.

The plugin side already carries everything those four steps need. `ct-step.mjs` builds
`StepAnnouncement.dispatch` with the agent, the inputs, the response and the consuming argv,
and `DispatchProse.render` writes the prose out of that same object. Slice 4's own «Out of
scope» promised slice 5 the flag on `#nextArgv`. Slice 5 closed neither that nor the deletion
it named there.

This slice closes the flag and moves the four dispatch steps off the prose. It also answers the
design spec's parked question A-3 for the repository half. No module of `backend/src` reads a
sentence of stdout after it. Nothing else in the tree parses that prose, so the plugin's reader
goes with it. The prose a human reads does not move one byte, because `out` writes nothing only
under the flag.

### Desired end state

- `CtRunMachine` asks `ct-step next` with `--output-format json`, and `#runnerArgv` is the one
  place that appends the flag.
- `OracleBoundary` takes the consuming argv of the four dispatch steps from the announcement,
  and it checks the announced response kind against `RESPONSE_KIND_OF_STEP`.
- `RunDispatch` takes the step, the inputs, the response path and the argv of those four steps
  from the announcement. The seal keeps its five keys and their values.
- One class reads a step announcement in the backend: `AnnouncedStep`, in
  `backend/src/infrastructure/run-announcement.ts`.
- No module under `backend/src` names `DispatchProse`, `StepProse` or `ConsumingProse`, and the
  census of `backend/__tests__/retired-prose-contract.test.ts` measures that third module too.
- `plugin/scripts/step-prose.js` keeps `render` and loses `read` and `stepOf`.
- The nine steps of `ct-step next` with no flag print the bytes of `35303a16`.
- The backend typecheck stays green, and so does every suite the tasks touch.

### Out of scope

- The prose itself. No `out()` line changes a word, and the byte comparison against `35303a16`
  measures it.
- `RunConsumingCommand`. Slice 4's task 5 gave it `forEdits(argv)`, which reads no prose. The
  frozen spec says the class would go; the execution spec records that divergence, and a person
  owns it.
- `RESPONSE_KIND_OF_STEP` and the three response kinds. D-6 freezes both.
- The announcement's shape. This slice adds no field, no kind and no role to
  `plugin/scripts/step-announcement.js`.
- `dispatch.agent`. §9.2 says why no reader takes it.
- The two hooks, `plugin/hooks/dispatch-guard.js` and `plugin/scripts/dispatch-gate.js`.
- The frontend, `plugin/scripts/judge-dispatch.js`, the discard budget, the rubrics, the agent
  prompts and `plugin/scripts/plan-contract.js`.
- The two Spanish `out()` lines of `plugin/scripts/ct-step.mjs`.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-6 · the response kind of a step | frozen in `RESPONSE_KIND_OF_STEP`; this slice reads it and never edits it |
| D-9 · the flag | `--output-format json` |
| Where the flag goes | `#nextArgv` returns `#runnerArgv(['next', '--plan', plan, '--issue', issue])` |
| What prints the prose for a human | `ct-step next` with no flag, unchanged |
| Who reads a step announcement | `AnnouncedStep` alone, moved to `run-announcement.ts` |
| What `AnnouncedStep` gains | `responsePath` in task 1, `inputs` in task 2 |
| What `AnnouncedStep` does not gain | `agent`; no caller in the tree needs it |
| Where an input kind meets its check | `AnnouncedStep.read`, the door the value enters by |
| What `RunAnnouncement` loses | `inputs`, in the task that gives `AnnouncedStep` its own |
| What replaces `#fileCall` | `#dispatchCall(stdout, round, ticket, step)` |
| Its refusal words | `ct-step output is not understood: ` plus `JSON.stringify(stdout)` |
| The `commands === null` refusal | it stays; only the four program steps reach it |
| What `RunDispatch.resolve` takes | the same `stdout`, read with `AnnouncedStep.read` |
| The seal | the same five keys and the same values: paths, sha256, role, argv, response |
| The order of the two roads | the announcement first and the prose second, until task 6 cuts the prose |
| What `DispatchProse` keeps | `render`, `inputLine`, `stepLine` and `CONSUMING_PREFIX` |
| What `DispatchProse` loses | `read` and `stepOf`, with no caller left anywhere |
| What the census may do | grow a module and a family; it never narrows its list or its walk |
| The feature flag | none; this repository's `flag-discipline` default is off |
| The one order the numbers do not give | tasks 8 to 11 land before task 5, which gives the announced road the traffic |
| What the announced road owes | every refusal the prose road made: the roles, the verb, the manifest and an argv's elements |
| What `manifest` does inside `OracleBoundary.read` | it stays, because task 11 compares the announced argv with it |

## 3. Reference patterns

Files to imitate: `backend/src/infrastructure/run-announcement.ts` is the module that reads
`ct-step`'s announcements, and `AnnouncedStep` joins it there.
`backend/src/infrastructure/ct-run-machine.ts` and `backend/src/infrastructure/run-dispatch.ts`
are the two modules the slice cuts. `backend/__tests__/retired-prose-contract.test.ts` is the
census, with its synthetic tree that proves it fires.
`plugin/__tests__/ct-step-announcement-real-process.test.js` states what every step announces,
literal by literal.

`backend/__tests__/infrastructure/ct-run-machine.test.ts` holds `OracleMother` and its fixture.
`backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` drives the real oracle through
the real machine. `plugin/__tests__/ct-step-prose-unchanged-real-process.test.js` is the byte
comparison.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/decisions.md`,
`plugin/conventions/defects.md`, `plugin/conventions/domain.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/infrastructure/run-announcement.ts` | modify | `ct-run-machine.ts`, `run-dispatch.ts` | Contract / Current state |
| `backend/src/infrastructure/ct-run-machine.ts` | modify | `ct-api.ts`, `run-plan-agents.ts` | Current state |
| `backend/src/infrastructure/run-dispatch.ts` | modify | `ct-run-machine.ts`, `claude-run-calls.ts` | Current state |
| `backend/__tests__/infrastructure/ct-run-machine.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/run-announcement.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/run-plan-recovery.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/run-plan-agents.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/run-driver-runtime-real-process.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/retired-prose-contract.test.ts` | modify | the backend suite | none (body by TDD) |
| `plugin/scripts/step-announcement.js` | modify | `ct-step.mjs`, `step-prose.js`, the backend | Contract |
| `plugin/scripts/ct-step.mjs` | modify | the loop's sessions | Current state |
| `plugin/scripts/step-prose.js` | modify | `ct-step.mjs` | Current state |
| `plugin/__tests__/step-prose.test.js` | modify | the plugin suite | none (body by TDD) |
| `plugin/conventions/style.md` | read | ct's yardstick, at the kickoff's path | none |

## 5. Interfaces

Consumes: `ANNOUNCEMENT_KINDS`, `ANNOUNCEMENT_VERSION`, `RESPONSE_KINDS`,
`RESPONSE_KIND_OF_STEP`, `INPUT_KINDS` and `INPUT_ROLES` from
`plugin/scripts/step-announcement.js`. `STEPS` and `RUN_STATES` from
`plugin/scripts/run-machine.js`. `RoleBytes.filesOf(step)` from `plugin/scripts/role-bytes.js`.
`StepAnnouncement.dispatch`, `StepAnnouncement.program`, `AnnouncedInput` and
`AnnouncedResponse`, which the backend suite already imports for its fixtures.

Produces: `AnnouncedStep`, from `backend/src/infrastructure/run-announcement.ts`, with
`static read(stdout: string): AnnouncedStep | null` and the readonly fields `step`, `commands`,
`argv`, `responseKind`, `responsePath` and `inputs`. `AnnouncedInput`, the type of one entry of
`inputs`, exported from the same module. `backend/src/infrastructure/ct-run-machine.ts` stops
exporting `AnnouncedStep`, and `backend/src/infrastructure/run-announcement.ts` stops exporting
`StepProse` and `ConsumingProse`.

## 6. Test strategy

Every task drives its change from the backend suite, with the commands of
`backend/package.json`: `npm run typecheck` and `npx vitest run` over the files it touches.
Three files launch a real subprocess and carry the `-real-process` marker
`plugin/conventions/testing.md` demands. They stay slow on purpose, and tasks 4, 5 and 7 name
them one by one.

The mother of the oracle is `OracleMother`, in
`backend/__tests__/infrastructure/ct-run-machine.test.ts`. Its dispatch fixtures stop composing
prose by hand and start answering `StepAnnouncement.dispatch(...).text()`, which is the literal
payload `ct-step` writes. `plugin/conventions/testing.md` asks for that at a boundary: the real
payload of the other side, never a model of it rebuilt in the test.

Two suites measure the whole chain against the real oracle and need no new case. The first is
`backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts`, which drives
`machine.open` through the real `ct-step next`. The second is
`backend/__tests__/infrastructure/run-driver-runtime-real-process.test.ts`, which starts the
production graph. Task 5 keeps both green, and that is what proves the flag works end to end.

What stays unmeasured on purpose: `dispatch.agent`. No reader takes it, so no test can watch
it from the backend. `plugin/__tests__/ct-step-announcement-real-process.test.js` already pins
it on the plugin side.

Tasks 8 to 11 drive their cases from `OracleMother` and from `AnnouncedStep` directly. None of
them adds a real-process file. The real oracle never announces an incomplete round, a foreign
verb, a foreign issue or a number inside an argv. So only a literal announcement reaches those
refusals.

One dependency `run-dispatch-real-process.test.ts` leans on, and does not declare: its injection
of a response path relies on `response.path` before `consuming.argv[1]` in the serialization. A
flipped key order would keep that case green over something else. D-12 freezes the
announcement's shape, so the order holds. No task of this plan changes that reliance.

## 7. Tasks

### Task 1 — the dispatch call comes out of the announcement

**Objective:** `OracleBoundary` takes the consuming argv of a dispatch step from the
announcement when `ct-step` prints one.

**Files:** `backend/src/infrastructure/run-announcement.ts` (modify),
`backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify)

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 428-434):

```ts
    try {
      const material = DispatchProse.read({ stdout, step })
      return OracleResult.call(ticket, [...material.consuming!.argv])
    } catch (cause) {
      if (cause instanceof UnreadableStepProse) return OracleResult.refused(cause.message)
      throw cause
    }
```

Contract (backend/src/infrastructure/run-announcement.ts):

```ts
export class AnnouncedStep {
  readonly step: string
  readonly commands: readonly string[] | null
  readonly argv: readonly string[]
  readonly responseKind: string | null
  readonly responsePath: string | null
  static read(stdout: string): AnnouncedStep | null
}
```

The class moves whole, with its two private helpers. `ct-run-machine.ts` imports it from
`./run-announcement.ts`, which it already imports, and stops exporting it. `responsePath` comes
out of `dispatch.response.path`, and it stays `null` when the announcement declares none.

`#fileCall` keeps its body and gains a sibling, `#dispatchCall(stdout, round, ticket, step)`.
The switch calls the sibling when `round` is not `null`, and `#fileCall` otherwise. The sibling
refuses when `round.responseKind` differs from `RESPONSE_KIND_OF_STEP[step]`, when
`round.responsePath` is `null`, or when `round.argv[1]` differs from `round.responsePath`.
Otherwise it answers `OracleResult.call(ticket, round.argv)`.

**TDD:** `it('an announced judge round hands over the consuming argv the announcement carries')`
— arrange the judge announcement with `StepAnnouncement.dispatch`, then expect `fixture.asked`
to hold the verdict argv with `--output-format json` appended. Then the two boundary cases:
`it('an announced judge round whose consuming argv does not name its response path is refused')`
with a second argument nobody announced, and
`it('an announced implement round whose response kind is not its own is refused')` built with
`new AnnouncedResponse({ kind: 'file', path })`.

**Tests:** added, in `backend/__tests__/infrastructure/ct-run-machine.test.ts`:
`'an announced judge round hands over the consuming argv the announcement carries'`,
`'an announced judge round whose consuming argv does not name its response path is refused'`,
`'an announced implement round whose response kind is not its own is refused'`. Removed on
purpose: none.

**Verification:** The oracle suite covers both roads. The graph typechecks, so the moved export
has no stale importer.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — both roads answer
cd backend && npm run typecheck   # expected: exit 0 — no importer of the old home is left
test "$(grep -c 'class AnnouncedStep' backend/src/infrastructure/run-announcement.ts)" -eq 1   # expected: exit 0 — the reader has one home
```

### Task 2 — the announced inputs have one reader, and RunDispatch uses it

**Objective:** `RunDispatch` builds its material from the announcement when `ct-step` prints
one.

**Files:** `backend/src/infrastructure/run-announcement.ts` (modify),
`backend/src/infrastructure/run-dispatch.ts` (modify),
`backend/__tests__/infrastructure/run-announcement.test.ts` (modify)

Current state (backend/src/infrastructure/run-dispatch.ts, lines 141-143):

```ts
    if (RunDispatch.#consumesEdits(asked.command)) return RunDispatch.#edits(asked)
    const step = DispatchProse.stepOf(asked.stdout)
    switch (step) {
```

Contract (backend/src/infrastructure/run-announcement.ts):

```ts
export type AnnouncedInput = {
  readonly role: string,
  readonly kind: 'literal' | 'glob',
  readonly path: string,
}
// on AnnouncedStep:
  readonly inputs: readonly AnnouncedInput[]
```

`AnnouncedStep.read` answers `null` for an entry of `dispatch.inputs` with a `role`, a `kind`
or a `path` that is not a string. It answers `null` too for a `kind` outside `INPUT_KINDS`.
That check lives at the door, so `RunDispatch.#inputsOf` drops its own throw and keeps only the
projection that drops `role`. `RunAnnouncement` loses `inputs` and the two helpers behind it,
because `AnnouncedStep` now answers that question for its one caller.

`RunDispatch.#material` reads `AnnouncedStep.read(asked.stdout)` first. With a round in hand it
routes on `round.step`. It takes the inputs from `round.inputs`, the response path from
`round.responsePath` and the argv from `round.argv`. `#response` refuses with the same words
when `round.argv[1]` differs from `round.responsePath`. With no round it keeps the prose road
of `#read` and `DispatchProse.stepOf`. `#reconciliationInputs` filters `round.inputs` by
`INPUT_ROLES.RECONCILIATION_PACKAGE`.

**TDD:** move the two cases of `RunAnnouncement` to `AnnouncedStep`:
`it('the announced round takes its reconciliation package from the announcement')` and
`it('an announced input with no path is refused')`, the second expecting `null`. Then
`it('an announced input whose kind is outside the vocabulary leaves the round unread')` with
`kind: 'directory'`, and `it('an announced input of kind glob survives the door')`.

**Tests:** added, in `backend/__tests__/infrastructure/run-announcement.test.ts`:
`'an announced input whose kind is outside the vocabulary leaves the round unread'`,
`'an announced input of kind glob survives the door'`. Moved to `AnnouncedStep`, same names:
`'the announced round takes its reconciliation package from the announcement'`,
`'an announced input with no path is refused'`.

**Verification:** The door refuses a bad kind. The real oracle still resolves all five roles
through the prose road, which this task leaves standing.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-announcement.test.ts   # expected: exit 0 — the door owns the input check
cd backend && npm run typecheck   # expected: exit 0 — no caller of the cut member survives
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-dispatch-real-process.test.ts   # expected: exit 0 — the five roles still resolve
```

### Task 3 — the oracle's unit mothers announce

**Objective:** Every dispatch fixture of the backend unit suites answers with the announcement
`ct-step` writes.

**Files:** `backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify),
`backend/__tests__/infrastructure/run-plan-recovery.test.ts` (modify)

No code — this task rewrites test fixtures, and the shapes they build already travel in
`plugin/scripts/step-announcement.js` and in task 1's contract.

In `OracleMother`, four fixtures stop composing lines by hand. `implementAnnouncement()` answers
`StepAnnouncement.dispatch(...).text()` for the implement step, attempt 1, with the rubric
`/plugin/prompts/task-implementer.md`, the brief, a `structured` response on
`implementReportPath()` and the consuming argv `report <path> --plan <plan> --issue 332`.
`sliceJudgeAnnouncement()` does the same for the slice judge, attempt 2. It carries the agent
`ct-slice-judge`, the package, the plan, the verdicts glob, a `file` response and the argv
`slice-verdict <path> --plan <plan> --issue 332`. `controlsAnnouncement()` becomes
`controlsAnnouncementJson()`, and the duplicate goes. `reconcileAnnouncement()` answers
`StepAnnouncement.program` with empty commands and the argv `reconcile --plan <plan> --issue 332`.

The three prose-only mothers stay untouched: `controlsAnnouncementOfAnotherIssue()`,
`controlsAnnouncementWithoutAConsumingLine()` and `undeclaredStepAnnouncement()`. Task 6 owns
them. In `run-plan-recovery.test.ts`, the two hand-written implement transcripts of
`FiniteBridge` answer `StepAnnouncement.dispatch(...).text()` with the same response path they
carry today.

**One case turns on this mother and splits here.**
`'both prose readers name the same step for the same bytes'` is its only consumer. Its third
assertion is the only one in the backend over an announced slice-judge round that answers
`call`. Its two prose-reader assertions cannot survive a JSON mother, and the case below them
already measures both readers. So those two go, the `call` assertion stays, and the case becomes
`it('an announced slice-judge round answers with a call')`.

**TDD:** No TDD — the fixtures move the transport of cases that already exist, and every
assertion keeps its literal. The fixture swap is the red step. A wrong path or a wrong verb
reddens the case that reads it.

**Tests:** added, in `ct-run-machine.test.ts`:
`'an announced slice-judge round answers with a call'`, which is the third assertion of
`'both prose readers name the same step for the same bytes'`, split out before that case loses
its mother. Removed on purpose: the two prose-reader assertions of that case. Kept with a new
transport: `'a command request precedes execution and its receipt precedes the next effect'`,
`'the announced controls step hands over the argv it published'`,
`'the announced reconciler round answers with a call and not with a command'`.

**Verification:** Both suites stay green with the announcement as their transport.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts __tests__/infrastructure/run-plan-recovery.test.ts   # expected: exit 0 — the announced fixtures drive every case
cd backend && npm run typecheck   # expected: exit 0 — the fixtures typecheck
test "$(grep -c 'DISPATCH AN IMPLEMENTER' backend/__tests__/infrastructure/run-plan-recovery.test.ts)" -eq 0   # expected: exit 0 — no hand-written heading is left there
```

### Task 4 — the real-process fixture reads the announcement

**Objective:** The real-process dispatch fixture drives `ct-step next` under the flag and takes
every path from its announcement.

**Files:** `backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` (modify)

No code — this task rewrites one test fixture, and the announcement shape it reads travels in
task 1's contract.

`DispatchRepository.#step('next', ...)` gains `'--output-format', 'json'` on every call that
feeds `machine(stdout)`, so the journal receipt carries the announcement instead of the prose.
`ProducerOutput` stops looking for a label. It gains `static of(stdout)`, which answers
`JSON.parse(stdout).dispatch`, plus `responsePath(stdout)` and `pathOf(stdout, role)`, which
read `response.path` and the `path` of the entry whose `role` matches. Every call site names a
role of `INPUT_ROLES` in place of the label it named before. The three roles: `package` for the
review package, `brief` for the brief and `reconciliation-package` for the reconciler's.

The seven expectations of `RESPONSE_EXPECTATION_OF_ROLE` do not change, and neither does one
assertion about paths, argv or the response. That is the point of the task: the same
expectations, a new transport. `sliceFallbackOutput()` and `#reconcileOutput()` already pass the
flag, so they stay as they are.

**TDD:** No TDD — every case of this file already exists, with its expectations written as
literals. The red step is the transport swap: a role nobody announces answers `undefined`, and
the case that reads it falls.

**Tests:** added: none. Removed on purpose: none. Kept with a new transport, in
`backend/__tests__/infrastructure/run-dispatch-real-process.test.ts`: every case of the file,
which the command below runs whole.

**Verification:** The five roles resolve from the announcement against the real oracle. The
paths, the argv and the response stay the ones the file already demands.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-dispatch-real-process.test.ts   # expected: exit 0 — the five roles resolve from the announcement
cd backend && npm run typecheck   # expected: exit 0 — the fixture typechecks
test "$(grep -c "the task's brief: " backend/__tests__/infrastructure/run-dispatch-real-process.test.ts)" -eq 0   # expected: exit 0 — no label is left in the fixture
```

### Task 5 — ct-step next answers the machine in the contract

**Objective:** `CtRunMachine` asks `ct-step next` with `--output-format json`.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify),
`backend/__tests__/infrastructure/run-plan-agents.test.ts` (modify),
`backend/__tests__/infrastructure/run-plan-recovery.test.ts` (modify),
`backend/__tests__/infrastructure/run-driver-runtime-real-process.test.ts` (modify)

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 718-726):

```ts
  #nextArgv(manifest: RunManifest): readonly string[] {
    return Object.freeze([
      this.ctStep, 'next', '--plan', manifest.plan, '--issue', String(manifest.issue),
    ])
  }

  #runnerArgv(argv: readonly string[]): readonly string[] {
    return Object.freeze([this.ctStep, ...argv, '--output-format', 'json'])
  }
```

`#nextArgv` answers `this.#runnerArgv(['next', '--plan', manifest.plan, '--issue', String(manifest.issue)])`.
So one method appends the flag for both roads, and no second copy of it exists. The prose road
of `OracleBoundary` stays reachable in this task, and task 6 cuts it.

Four fixtures follow the flag. `OracleMother.nextArgv()` and `AgentMother.nextArgv()` append
`'--output-format', 'json'`, and so do the inline copy of `run-plan-agents.test.ts` and the
three copies of `FiniteBridge` in `run-plan-recovery.test.ts`. In
`run-driver-runtime-real-process.test.ts`, the receipt probe reads `'"step":"implement"'` in
place of `'step: implement'`, because the production graph now records the announcement.

**TDD:** `it('the machine asks the next verb with the output format of the contract')`. Expect
`fixture.asked[0].argv` to equal the `next` argv with `'--output-format'` and `'json'` last.
Expect `fixture.asked[1]` to keep the consuming argv it already asserts. The flag's position is
the boundary. The assertion pins the whole array, so an argv with the flag in the middle falls.

**Tests:** added, in `backend/__tests__/infrastructure/ct-run-machine.test.ts`:
`'the machine asks the next verb with the output format of the contract'`. Removed on purpose:
none.

**Verification:** The three unit suites follow the flag. The two real-process suites cross the
whole chain against the real oracle. Only the receipt probe changes in them.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts __tests__/infrastructure/run-plan-agents.test.ts __tests__/infrastructure/run-plan-recovery.test.ts   # expected: exit 0 — the flag reaches every fixture
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine-real-process.test.ts __tests__/infrastructure/run-driver-runtime-real-process.test.ts   # expected: exit 0 — the real oracle answers the machine in JSON
cd backend && npm run typecheck   # expected: exit 0 — the graph is sound
```

### Task 6 — the prose road leaves backend/src, and the census grows

**Objective:** No module under `backend/src` names a prose reader of `ct-step`'s stdout.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/src/infrastructure/run-dispatch.ts` (modify),
`backend/src/infrastructure/run-announcement.ts` (modify),
`backend/__tests__/retired-prose-contract.test.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify),
`backend/__tests__/infrastructure/run-announcement.test.ts` (modify)

Current state (backend/src/infrastructure/run-announcement.ts, lines 170-173):

```ts
export class StepProse {
  static readonly #PREFIX = 'step: '
  static readonly #CUT = ' ('
  static readonly #STEPS: readonly string[] = Object.values(STEPS)
```

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 386-388):

```ts
    }
    const step = round?.step ?? StepProse.step(output.stdout)
    switch (step) {
```

`OracleBoundary.read` refuses when `AnnouncedStep.read` answers `null`, with the words it
already prints. `step` becomes `round.step`. `#fileCall` goes, and `#plainCommand` folds into
`#announcedCommand` under the name `#programCommand(stdout, round, ticket, step, manifest)`,
which keeps the `commands === null` clause. **`manifest` stays**, because task 11 compares the
announced argv with it. `StepProse` and `ConsumingProse` go whole from
`run-announcement.ts`, and `run-dispatch.ts` drops `#read` and the prose half of
`#reconciliationInputs`.

`StdoutScanning.MODULES` gains `'infrastructure/run-announcement.ts'`. A fourth family joins
`RetiredProseContract`, over the whole of `backend/src`: `DispatchProse`, `StepProse` and
`ConsumingProse`, the three delegations that let the scan live in the plugin.

**TDD:** the fourth family and the third module enter the census first, and
`it('no_module_under_backend_src_carries_a_fragment_of_the_retired_prose_contract')` and
`it('neither_module_of_the_dispatch_path_scans_ct_step_stdout_as_text')` both turn red. The cut
turns them green. `it('the_census_fires_on_a_tree_that_carries_every_fragment_of_the_contract')`
grows one synthetic module for the new family.

**Tests:** added: none. Removed on purpose:
`'a printed consuming command that names another issue is refused'`, whose announced heir task
11 already added, `'a transcript that prints no consuming command at all is refused'` and
`'a step name with a digit is not a declared step'`. Also the two cases of
`describe('StepProse')` in `run-announcement.test.ts`. Task 3 already split the one case that
measured a `call` too, so none goes with this cut.

**Verification:** Every census is green over the real tree and red over the synthetic one. The
graph typechecks, so no caller of a cut member survives.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/retired-prose-contract.test.ts __tests__/infrastructure/ct-run-machine.test.ts __tests__/infrastructure/run-announcement.test.ts   # expected: exit 0 — the censuses and the oracle
test -z "$(grep -rlF -e 'DispatchProse' -e 'StepProse' -e 'ConsumingProse' backend/src)"   # expected: exit 0 — no delegation to a prose reader is left
cd backend && npm run typecheck   # expected: exit 0 — no caller of a cut member survives
```

### Task 7 — DispatchProse loses the reader nobody calls

**Objective:** `plugin/scripts/step-prose.js` keeps the renderer of the prose and drops its
parser.

**Files:** `plugin/scripts/step-prose.js` (modify),
`plugin/__tests__/step-prose.test.js` (modify)

Current state (plugin/scripts/step-prose.js, lines 176-179):

```js
  static stepOf(stdout) {
    const match = /^step: (\S+) \(attempt \d+\)$/m.exec(String(stdout ?? ''))
    return match && DispatchProse.#DECLARED_STEPS.has(match[1]) ? match[1] : null
  }
```

Current state (plugin/scripts/step-prose.js, lines 110-112):

```js
  static read({ stdout, step }) {
    const labels = INPUT_LABELS.get(step)
    if (!labels) {
```

Six members go: `read`, `stepOf`, `#DECLARED_STEPS`, `#consumingArgv`, `#requireOnce` and
`#valueOf`. So do the four symbols only they use: `DispatchMaterialRead`, `LABELS_ONLY_STEPS`,
the map of a role to its kind and the set of optional roles. Nine stay: `render`, `inputLine`,
`stepLine`, `CONSUMING_PREFIX`, `STEP_HEADINGS`, `INPUT_LABELS`, `RESPONSE_LABELS`,
`StepProseLines` and `UnreadableStepProse`. `ct-step.mjs` calls the first four of those, and
`render` throws the last.

`plugin/__tests__/step-prose.test.js` drops the two describes of the parser and keeps the three
of the renderer. The coupling case names the one labels-only step by hand, `reconcile`, in place
of `LABELS_ONLY_STEPS`. So the assertion stops taking its expectation out of the module under
test.

**TDD:** No TDD — this task removes code with no caller. The deletion of the cases that call it
is the red step. `it('every step of INPUT_LABELS outside the labels-only steps has an entry in STEP_HEADINGS and in RESPONSE_LABELS')`
keeps the coupling, with `reconcile` written by hand.

**Tests:** removed on purpose, in `plugin/__tests__/step-prose.test.js`: the cases of
`describe('DispatchProse.read parses the prose back into the material an announcement declared')`,
of `describe('DispatchProse and the reconciliation package label')` and of
`describe('DispatchProse names the step from the stdout it prints')`. Kept with a literal
expectation: `'every step of INPUT_LABELS outside the labels-only steps has an entry in STEP_HEADINGS and in RESPONSE_LABELS'`.

**Verification:** The renderer's suite is green. The nine steps of `ct-step next` print the
bytes of the branch base, so no prose moved with the parser.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/step-prose.test.js   # expected: exit 0 — the renderer keeps its cases
test "$(grep -c 'static read(' plugin/scripts/step-prose.js)" -eq 0   # expected: exit 0 — the parser is out
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-prose-unchanged-real-process.test.js   # expected: exit 0 — the prose a human reads did not move
```

### Task 8 — the mandatory input roles get one home, and the door enforces them

**Objective:** The door leaves a dispatch round unread when it omits a mandatory input role.

**Files:** `plugin/scripts/step-announcement.js` (modify), `plugin/scripts/step-prose.js`
(modify), `backend/src/infrastructure/run-announcement.ts` (modify),
`backend/__tests__/infrastructure/run-announcement.test.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify),
`plugin/__tests__/step-prose.test.js` (modify)

**This task lands before task 5**, which gives the announced road the traffic. §9.12 measures
why.

Contract (plugin/scripts/step-announcement.js):

```js
export const MANDATORY_INPUT_ROLES_OF_STEP = Object.freeze({
  [STEPS.IMPLEMENT]: Object.freeze([INPUT_ROLES.RUBRIC, INPUT_ROLES.BRIEF]),
  [STEPS.JUDGE]: Object.freeze([INPUT_ROLES.PACKAGE, INPUT_ROLES.BRIEF]),
  [STEPS.ADVISE]: Object.freeze([INPUT_ROLES.PACKAGE]),
  [STEPS.SLICE_JUDGE]: Object.freeze([INPUT_ROLES.PACKAGE, INPUT_ROLES.PLAN, INPUT_ROLES.VERDICTS]),
  [STEPS.RECONCILE]: Object.freeze([INPUT_ROLES.RECONCILIATION_PACKAGE]),
})
```

Current state (plugin/scripts/step-prose.js, line 51):

```js
const OPTIONAL_INPUT_ROLES = new Set([INPUT_ROLES.CONTROLS_LOG, INPUT_ROLES.GLOBAL_LOG])
```

Current state (backend/src/infrastructure/run-announcement.ts, line 193):

```ts
    if (!Array.isArray(declared)) return Object.freeze([])
```

The map sits beside `RESPONSE_KIND_OF_STEP`, with the same shape and readers. D-2 freezes that
module, and task 7 leaves it alone. Its values are the labels of `INPUT_LABELS` per step, minus
the two optional roles above; the name follows `step-prose.js:131`.

`OPTIONAL_INPUT_ROLES` goes, and the check at line 130 reads the new map with no change of
words. `#inputs` takes the step as a second argument, which `read` resolves at line 174.

**The new check runs on the list the loop built, never behind the early return above.** So a
`dispatch` with no `inputs` key meets the rule too. Both callers already handle the `null` that
`read` answers, so neither reader changes; §9.9 records what that shared channel costs.

**TDD:** `it('a judge round that announces no input leaves the round unread')`. Expect
`AnnouncedStep.read` to answer `null`. The boundary beside it:
`it('a slice-judge round with both optional roles absent stays readable')`, which expects a
round back: an optional role stays optional.

**Tests:** added. In `run-announcement.test.ts`:
`'a judge round that announces no input leaves the round unread'`,
`'a slice-judge round with both optional roles absent stays readable'`. In
`ct-run-machine.test.ts`:
`'a judge round that announces no input is refused instead of dispatched'`. In
`step-prose.test.js`:
`'the mandatory roles of a step are its prose labels minus the two optional ones'`. Removed on
purpose: none.

**Verification:** The door and the oracle both refuse an incomplete round. The partition matches
the labels, and no prose moved.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-announcement.test.ts __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — the door and the oracle
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/step-prose.test.js __tests__/ct-step-prose-unchanged-real-process.test.js   # expected: exit 0 — the partition holds and no prose moved
cd backend && npm run typecheck   # expected: exit 0 — the widened door resolves
```

### Task 9 — the announced road runs the verb its step names

**Objective:** The announced road refuses a dispatch round whose consuming verb is not the one
its step consumes.

**Files:** `plugin/scripts/step-announcement.js` (modify), `plugin/scripts/ct-step.mjs`
(modify), `backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify),
`backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` (modify)

**This task lands before task 5 too.** §9.13 carries the measurement and the history that make
it this slice's business rather than a later issue.

Contract (plugin/scripts/step-announcement.js):

```js
export const CONSUMING_VERB_OF_STEP = Object.freeze({
  [STEPS.IMPLEMENT]: 'report', [STEPS.CONTROLS]: 'controls', [STEPS.JUDGE]: 'verdict',
  [STEPS.ADVISE]: 'advice', [STEPS.COMMIT]: 'commit', [STEPS.RECONCILE]: 'reconcile',
  [STEPS.GLOBAL]: 'global', [STEPS.SLICE_JUDGE]: 'slice-verdict', [STEPS.E2E]: 'e2e',
})
```

Current state (plugin/scripts/ct-step.mjs, lines 617-620):

```js
const VERB_OF = {
  report: STEPS.IMPLEMENT, controls: STEPS.CONTROLS, verdict: STEPS.JUDGE, advice: STEPS.ADVISE, commit: STEPS.COMMIT,
  reconcile: STEPS.RECONCILE, global: STEPS.GLOBAL, 'slice-verdict': STEPS.SLICE_JUDGE, e2e: STEPS.E2E,
}
```

One partition, nine members, one home. `VERB_OF` becomes the inverse of the new map, built from
it, so its values stay the ones above and no message of `requireStep` moves. The backend cannot
import `ct-step.mjs`, which exits at load, so the map goes in the pure module the two sides
already share.

`#dispatchCall` adds `round.argv[0] !== CONSUMING_VERB_OF_STEP[step]` to the clause it has, so
its refusal keeps its words. `#plainCommand` and `#announcedCommand` drop their `verb` parameter
and read the map, which retires the four string literals of the switch above them.

**One existing sub-part starts measuring its own name here.** The `different structured verb`
case of `run-dispatch-real-process.test.ts` injects the verb alone from now on. Today it refuses
on the response path, which it shares with the `conflicting response` sub-part beside it,
because a verb-only injection would seal rather than refuse.

**TDD:** `it('an implement round that announces the judge verb is refused')`. Arrange the
implement announcement with a consuming argv of `['verdict', <its own report path>, …]`, which
answers `call` today. Expect `refused`, and expect `fixture.asked` to hold the `next` call alone.
The boundary beside it: the same round with `report` still answers `call`.

**Tests:** added, in `ct-run-machine.test.ts`:
`'an implement round that announces the judge verb is refused'`,
`'a slice-judge round that announces the judge verb is refused'`. Kept, now reading its verb
from the map: `'the announced controls step hands over the argv it published'`. Removed on
purpose: none.

**Verification:** The oracle measures the verb against the step. The nine verbs still sequence
through the real process, and no prose moved.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — the oracle measures the verb
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/e2e-ct-step.test.js __tests__/ct-step-prose-unchanged-real-process.test.js   # expected: exit 0 — the sequence holds and no prose moved
cd backend && npm run typecheck   # expected: exit 0 — the graph is sound
```

### Task 10 — the announcement's boundary promises only what it checks

**Objective:** The door checks every element of an announced argv, and the two guards that
repeat its work go.

**Files:** `backend/src/infrastructure/run-announcement.ts` (modify),
`backend/src/infrastructure/run-dispatch.ts` (modify),
`backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/__tests__/infrastructure/run-announcement.test.ts` (modify)

**This task lands before task 5 too.** §9.14 carries the measurement of the cast.

Current state (backend/src/infrastructure/run-announcement.ts, lines 222-224):

```ts
  static #stringArray(value: unknown): readonly string[] | null {
    return Array.isArray(value) ? Object.freeze([...value]) as readonly string[] : null
  }
```

Current state (backend/src/infrastructure/run-dispatch.ts, lines 334-336):

```ts
  static #response(step: string, round: DispatchRound): RunResponse {
    if (round.responsePath === null || round.argv[1] !== round.responsePath) {
      throw new RunNotUnderstood('the announced response path conflicts with the consuming command')
```

Current state (backend/src/infrastructure/ct-run-machine.ts, line 22):

```ts
const RESPONSE_KIND_BY_STEP: Readonly<Record<string, string>> = RESPONSE_KIND_OF_STEP
```

Three places where the boundary's promise and its check disagree, and one commit for all three.

`#stringArray` answers `null` unless every element of the array is a string. `read` then tells
an absent key from a malformed one. A `consuming` object whose `argv` fails that check makes
`read` answer `null`. No `consuming` key at all keeps the empty argv that
`'an announced step with no consuming argv is refused instead of run'` already pins. An absent
`commands` key still answers `null`, because `#announcedCommand` refuses on that.

The `argv[1]` half of `#response` goes, and the `responsePath === null` half stays, because the
type needs it. §9.10 carries that decision. `ct-run-machine.ts` drops its own
`RESPONSE_KIND_BY_STEP` and imports the one `run-announcement.ts` exports, which
`run-dispatch.ts` already reads.

**TDD:** `it('an announced consuming argv that carries a number leaves the round unread')`.
Expect `AnnouncedStep.read` to answer `null`. The boundary beside it:
`it('an announced step with no consuming key keeps an empty argv')`, which expects `round.argv`
to equal `[]`, so absence and corruption stay apart.

**Tests:** added, in `run-announcement.test.ts`:
`'an announced consuming argv that carries a number leaves the round unread'`,
`'an announced commands list that carries a number leaves the round unread'`,
`'an announced step with no consuming key keeps an empty argv'`. Removed on purpose: none.

**Verification:** The door refuses a corrupt argv and keeps an absent one readable. The five
roles still resolve, and the graph typechecks with one alias.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-announcement.test.ts __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — the door and the oracle
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-dispatch-real-process.test.ts   # expected: exit 0 — the five roles resolve without the removed guard
test "$(grep -c 'RESPONSE_KIND_OF_STEP' backend/src/infrastructure/ct-run-machine.ts)" -eq 0   # expected: exit 0 — the duplicate declaration is out
```
### Task 11 — the announced argv names the run it belongs to

**Objective:** Both announced roads refuse a consuming argv whose plan or issue is not the
manifest's.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify)

**This task lands before task 5 too.** §9.15 carries the two measurements, which two agents
took hours apart without either seeing the other's work.

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 407-408):

```ts
    const argv = [verb, '--plan', manifest.plan, '--issue', String(manifest.issue)]
    if (!ConsumingProse.carries(stdout, `ct-step ${argv.join(' ')}`)) {
```

Contract (backend/src/infrastructure/ct-run-machine.ts):

```ts
// on OracleBoundary:
  static #namesThisRun(argv: readonly string[], manifest: RunManifest): boolean
  static #dispatchCall(
    stdout: string,
    round: AnnouncedStep,
    ticket: string,
    step: string,
    manifest: RunManifest,
  ): OracleResult
```

The prose road builds the argv it expects out of the manifest and refuses every other. The
announced road runs the argv the announcement carries, and `#dispatchCall` does not even take
the manifest. So an announced round may name another plan or another issue, and the machine runs
it.

`#namesThisRun` reads `--plan` and `--issue` by flag name and never by position, then compares
them with `manifest.plan` and `String(manifest.issue)`. A flag that is absent answers `false`.
`#dispatchCall` and `#announcedCommand` both add it to the clause they have, so their refusals
keep their words. `#dispatchCall` takes the manifest as its fifth argument, which
`OracleBoundary.read` already holds.

**Task 6 must not undo this.** Its text keeps `manifest` inside `OracleBoundary.read`, because
this task gives it a reader there.

**TDD:** `it('an announced slice-judge round that names another issue is refused')`. Arrange the
slice-judge announcement with `--issue 331` against a manifest of 332, which answers `call`
today. Expect `refused`, and expect `fixture.asked` to hold the `next` call alone. The boundary
beside it: `it('an announced controls round that names another plan is refused')`, which covers
the program road.

**Tests:** added, in `ct-run-machine.test.ts`:
`'an announced slice-judge round that names another issue is refused'`,
`'an announced controls round that names another plan is refused'`. The second is the announced
heir of `'a printed consuming command that names another issue is refused'`, which task 6
deletes with the prose road. Removed on purpose: none.

**Verification:** Both roads refuse an argv of another run. The real oracle still drives the
chain end to end.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — both roads compare the manifest
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine-real-process.test.ts   # expected: exit 0 — the real oracle still drives the chain
cd backend && npm run typecheck   # expected: exit 0 — the widened signature resolves
```

## 8. Global verification

The eight commands below measure the slice end to end. I ran all eight on `2144dd17`, the tip
of the branch. The typecheck exited 0. The three greps exited 1, and that is the state this
slice changes.

The first named `run-dispatch.ts`, `ct-run-machine.ts` and `run-announcement.ts`. The second
counted one `static read(`. The third named the census file, which does not name that module
yet.

The four suite commands exited 0 on the tip. They must still exit 0 at the end. The block names
files and never a whole suite. Two real-process files on this machine reach their own time cap
under load, with no change from anybody.

Read the diff of `step-prose.js` with human eyes. Check that no `out()` line of `ct-step.mjs`
moved.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the whole graph is sound
test -z "$(grep -rlF -e 'DispatchProse' -e 'StepProse' -e 'ConsumingProse' backend/src)"   # expected: exit 0 — no module of backend/src names a prose reader
test "$(grep -c 'static read(' plugin/scripts/step-prose.js)" -eq 0   # expected: exit 0 — the plugin's parser is gone
test -z "$(grep -LF 'infrastructure/run-announcement.ts' backend/__tests__/retired-prose-contract.test.ts)"   # expected: exit 0 — the census measures the third module
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/retired-prose-contract.test.ts __tests__/infrastructure/ct-run-machine.test.ts __tests__/infrastructure/run-announcement.test.ts   # expected: exit 0 — the censuses and the oracle
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine-real-process.test.ts __tests__/infrastructure/run-dispatch-real-process.test.ts   # expected: exit 0 — the real oracle answers the machine in JSON
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-prose-unchanged-real-process.test.js __tests__/step-prose.test.js   # expected: exit 0 — the nine steps and the renderer
test -z "$(git status --porcelain)"   # expected: exit 0 — every task committed its work
```

## 9. Assumptions

1. **The flag goes on `#nextArgv`, and nothing prints the prose for the backend any more.**
   Provenance: own call, measured. `plugin/scripts/ct-step.mjs:150` declares
   `const out = (msg) => { if (!announcing) safeWrite(1, msg + '\n') }`, so under the flag
   `nextVerb` writes the announcement alone. A human who runs `ct-step next` by hand passes no
   flag and reads the same prose, and
   `plugin/__tests__/ct-step-prose-unchanged-real-process.test.js:36` spawns the verb without
   the flag. So constraint 1 holds by construction, and constraint 3 holds too: one JSON object
   per invocation.
2. **`AnnouncedStep` does not expose `agent`.** Provenance: own call, against
   `plugin/conventions/simplicity.md`. `RunDispatch` resolves the agent definition from the step
   with `RoleBytes.filesOf`, and it checks the definition's tools against the frozen plugin
   contract. A check of the announced name against `definition.name` would compare two reads of
   one file, which that document names an unreachable check. No caller breaks without the field,
   so it does not go in. A later slice that wants to catch a stale plugin root in the backend
   adds the field with its reader, in one commit.
3. **`#announcedCommand` keeps its `commands === null` refusal.** Provenance: own call,
   measured. `StepAnnouncement.program` always writes `commands`, and
   `plugin/__tests__/ct-step-announcement-real-process.test.js` pins `commands: []` for the
   commit step and for the reconcile step. Only `controls`, `commit`, `reconcile` and `global`
   reach that method, and the edits branch catches the reconciler round before the switch. So
   the clause stays as the check that a program step announced its list.
4. **`RunDispatch.resolve` keeps its `stdout` parameter.** Provenance: own call. The alternative
   passes an `AnnouncedStep` down from `CtRunMachine.dispatch`, which changes a signature and an
   effect shape for no reader. The door reads the same bytes twice, and both reads are pure.
5. **The seal survives a run in flight.** Provenance: own call, measured by hand over both
   modules. `DispatchProse.render` writes the prose out of the announcement. The order of
   `INPUT_LABELS` matches the order `ct-step.mjs` builds its inputs in, role by role, for all
   five steps. So `paths`, `argv` and `response` keep their values and a sealed ticket holds.
6. **`DispatchProse` loses its parser.** Provenance: own call, and it answers A-3 of the design
   spec. That question parked whether the prose road keeps a second reader. Nothing outside
   `backend/src` calls `read` or `stepOf`, so after task 6 they have no caller at all.
   `plugin/conventions/simplicity.md` gives a public symbol no life without one. This also
   closes the second gap of the execution spec's closing record: two step readers with different
   accepted languages become one.
7. **Task 3 and task 4 carry no TDD.** Provenance: own call, against
   `plugin/conventions/testing.md`. Both tasks change the transport of cases that already exist
   and keep every literal expectation. A new case would measure the fixture, not the code.
8. **No GitHub issue backs this plan.** Provenance: the kickoff brief. An end-to-end run is live
   on this repository, so nobody groomed an issue and nobody may open one. The brief plus what I
   measured is the whole input, and every decision of §2 is mine or a frozen one it names.
9. **The door's `null` is one channel for two meanings, and task 8 accepts that.** Provenance:
   task 2's review, accepted. A missing mandatory role answers the same `null` a bad kind
   answers. So the refusal quotes the whole stdout instead of naming the role. The diagnostic
   still shows the `dispatch` object without its inputs, and no backend reader branches on the
   shape that failed. A second channel out of `read` would reopen the door task 2 froze, for a
   diagnostic nobody reads differently.
   
   `plugin/conventions/simplicity.md` asks who reads a line and what they do differently for it.
   Until task 6 the words come from the prose reader, because a `null` round falls to it. After
   task 6 they are `ct-step output is not understood` plus the JSON.
10. **`#response`'s second guard on the consuming argv goes, in task 10.** Provenance: task 2's
    review raised it and left the call to me; this is the call. The review measured 34 tests
    green without that half. `ct-run-machine.ts:565` is the one caller of `RunDispatch.resolve`,
    inside `CtRunMachine.dispatch`. That method refuses unless `OracleBoundary.read` answers
    `call`, and `#dispatchCall` already compares `argv[1]` with the response path.
    
    On the prose road `DispatchProse.#consumingArgv` builds that element as the response path.
    `plugin/conventions/simplicity.md` names both shapes: a second check downstream of the door,
    and a condition that cannot occur. The `responsePath === null` half stays, because the type
    needs it.
11. **No single base makes every `Current state` block of this plan verbatim.** Provenance: I
    measured three of them. Against the working tree at `f38f459f` one block fails: task 2's own
    citation of `run-dispatch.ts`, whose three lines task 2 rewrote when it landed. Against
    `2144dd17`, the tree I wrote this plan on, four fail. All four sit in tasks 8 to 10, which
    cite what tasks 1 and 2 built. Against `916df6f3`, the merge-base with `origin/main`,
    seventeen fail: `run-announcement.ts` and `step-prose.js` do not exist there at all.
    
    No citation moves for that. A relabel would take a block out of the one check that proves
    the plan described the real repo. A rewrite would make a "before" block describe an "after"
    tree. This is what a plan of eleven tasks costs when each task cites what the one before it
    built. The sibling plans of issue 496 carry the same entries, for the same reason. So whoever
    runs `--check-plan` from here on reads its output as a list, not as a verdict.
12. **The mandatory-role hole, measured three ways.** Provenance: task 1's review, task 2's
    implementer, and my own runs on `f38f459f`. `StepAnnouncement.dispatch` with `inputs: []`
    writes no `inputs` key at all, and `AnnouncedStep.read` answers a round whose `inputs` is
    the empty list. `#dispatchCall` then answers `call`.
    
    `RunDispatch.resolve` seals a judge dispatch whose paths are `plugin/agents/ct-judge.md` and
    the two files of `ct-test-driven-development`, so no review package and no brief reach the
    judge. `DispatchProse.read` refuses that same round. The partition that decides it lives only
    as `OPTIONAL_INPUT_ROLES`, private to the module task 7 cuts down.
13. **The announced road never measured the consuming verb.** Provenance: task 4's review, and
    my own run on `f38f459f`. An `implement` round whose consuming argv starts with `verdict`,
    on its own announced report path, passes `responseKind`, `responsePath` and `argv[1]`. So
    `#dispatchCall` answers `call` and `RunDispatch` seals it.
    
    The prose road never checked `argv[0]` either, and slice 2's task 4 review deleted a test
    that claimed otherwise. The announced road inherited the gap, and task 5 makes that road the
    only one. So the gap becomes the whole surface. Task 9 closes it with the partition
    `ct-step.mjs` already carries.
15. **The announced road never cross-checked the manifest, and two agents found that
    independently.** Provenance: task 3's review, an agent working on the stale-verdict fix hours
    earlier, and my own run. The second agent named it the one thing it most wanted a look at,
    and it had not seen the first.
    
    Task 3's review mutated `--issue 332` to `331` in the announced controls argv. Seven cases
    went red, all of them `unlisted node request`: the machine accepted the argv and tried to run
    it. The same mutation on the slice-judge argv gave zero red. I measured the reason on
    `f38f459f`: an announced slice-judge round carrying `--issue 331` passes all three checks of
    `#dispatchCall`, whose signature takes no manifest at all.
    
    The prose road does compare, at `ct-run-machine.ts:407-408`, and its only case feeds
    `controlsAnnouncementOfAnotherIssue()` — a mother task 6 deletes with the road. Task 11
    closes it, and its own case is that coverage's announced heir.
14. **`#stringArray` promised more than it checked.** Provenance: task 1's review named it the
    one Minor to fix before merge, and I measured it. A `consuming.argv` of `[1, 2]` comes back
    as `argv=[1,2]` under a type that says `readonly string[]`. `CommandRequest.read` catches a
    non-string only on replay, after the first spawn. An empty argv would not help either:
    `#runnerArgv([])` spawns `ct-step --output-format json`, which exits 2, measured. So task 10
    leaves the whole round unread instead.
