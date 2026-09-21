# #496 — the dispatch material stops being prose

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`ct-step next` prints what a dispatch step needs as prose. The backend then rebuilds that
material out of the prose. `RunDispatch.#printed` matches label constants as exact line
prefixes. `#requireAnnouncement` demands a heading sentence as one whole line, byte for byte.
Each heading quotes the role's tool list, which the backend also composes from the agent
definition. One fact, two derivations, and a sentence holds them together.

Slice 1 closed the shape of the announcement. `StepAnnouncement.dispatch` already accepts
`agent`, `inputs` and `consuming`. `ct-step next --output-format json` prints whatever the
announcement carries. The four dispatch cases of `nextVerb` pass `response` and nothing else.

This slice fills those three fields and turns the prose into a projection of them. A new module,
`plugin/scripts/step-prose.js`, declares every label, heading and consuming verb once.
`DispatchProse.render` writes the lines of a dispatch step from its announcement. So a reworded
heading cannot change what the announcement carries. `DispatchProse.read` hands the material
back from those same lines, and that is the one door the backend enters by.

### Desired end state

- The announcement of every dispatch step carries `dispatch.agent`, `dispatch.inputs[]` with
  `role` and `kind`, and `consuming.argv`.
- `plugin/scripts/step-prose.js` holds every label, heading and consuming verb of a dispatch
  step, once, with two doors over them: `render` and `read`.
- `nextVerb` types no label and no heading. It renders them from the announcement it built.
- `RunDispatch.#printed`, `#literal`, `#optionalLiteral`, `#glob` and `#requireAnnouncement` no
  longer exist. Neither does the `step:` pattern of `run-dispatch.ts`.
- The slice judge's committed verdicts travel as one input of `kind: "glob"`.
- The `(none)` and `(N/A declared)` sentinels disappear. An absent optional input stays out of
  the `inputs` array, and its line stays out of the prose.
- `OracleBoundary.#fileCall` takes the consuming argv of a dispatch step from the announcement.
  `RunConsumingCommand.structured` loses its last caller and leaves.

### Out of scope / Protected

- The agent definitions stay the single home of each role's model and tool list. Neither travels
  in the announcement.
- The schemas of `step-contracts.js` stay there. `VERDICT_SCHEMA`, `ADVICE_SCHEMA` and
  `REPORT_SCHEMA` never travel.
- What each prose line says. A line moves from a hand-typed `out()` call to a rendered one, and
  its words stay its words.
- The transition, the refusal and the four regexes of `OracleBoundary.read`. Slice 3 owns them.
- `commands[]` of a program step and `OracleBoundary.#plainCommand`. Slice 4 owns them.
- `RunConsumingCommand` itself and `RunConsumingCommand.edits`. Slice 5 deletes the class.
- `.agent/run-<issue>.json`, `VERDICT_RULES`, the `review_token` binding and the agent prompts.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 · the source and the rendering | the structure is the source and the prose comes out of it; one value per invocation, two renderings |
| D-2 · where the contract lives | `plugin/scripts/step-announcement.js`, pure: no disk, no process, no `git` |
| D-3 · the hooks | `dispatch-gate.js` and `dispatch-guard.js` parse no stdout; leave both alone |
| D-4 · a refusal | it publishes the `state` and the `outcome` that already decide its exit code; slice 3 delivers it |
| D-5 · what travels | only what the run decides; the model, the tool list and the schema never travel |
| D-6 · `response.kind` | three values: `file`, `structured` and `edits` |
| D-7 · a `file` response | the backend reads the path and writes nothing |
| D-8 · a `structured` response | the agent declares `StructuredOutput` in its own `tools` |
| D-9 · the flag | `--output-format json`, and no second spelling |
| D-10 · the version field | `version: 1` |
| D-11 · slice order | slice 1 delivered the response channel first, and it has landed |
| D-12 · the module's shape | slice 1 closed all four kinds and every field; this slice adds no field |
| where the prose codec lives | `plugin/scripts/step-prose.js`, a new pure module over `step-announcement.js` and `step-contracts.js` |
| the codec's two doors | `DispatchProse.render(announcement)` and `DispatchProse.read({ stdout, step })` |
| the typed error of the codec | `UnreadableStepProse`, shaped like `MalformedAnnouncement` |
| the label table | one home, inside `step-prose.js`; no label constant survives anywhere else |
| where the table's text comes from | verbatim from `nextVerb`'s four dispatch cases and the reconcile verb's package line, in `plugin/scripts/ct-step.mjs` |
| an absent optional input | no element in `inputs`, and no line in the prose |
| when `read` refuses | a label that appears other than once, an empty value, a `\0`, an undeclared step, or a disagreeing consuming argv |
| the implementer's inputs | `rubric` then `brief`, and no `agent` field: its declared material is a prompt |
| the judge's inputs | `package`, `brief`, then `controls-log` only when `run.lastControlsLog` holds a path |
| the advisor's inputs | `package` |
| the slice judge's inputs | `package`, `plan`, then `global-log` only when `run.lastGlobalLog` holds a path, then `verdicts` |
| the committed verdicts | one input, role `verdicts`, `kind: "glob"`, path `docs/superpowers/verdicts/issue-<n>-task-*.json` |
| where the agent name comes from | the agent definition on disk, which `nextVerb` parses with `AgentDefinition.parse` |
| the tool list inside a heading | `step-contracts.js`, which `step-prose.js` imports; never the announcement |
| how the backend learns the step | `DispatchProse.stepOf(stdout)`; the backend keeps no pattern of its own |
| what the backend still derives | the agent definition, its model, its tools and the JSON schema of the step |
| the reconcile step in the table | one input label only; slice 4 gives that verb a heading and an announcement |

## 3. Reference patterns

Files to imitate: `plugin/scripts/step-announcement.js` is the pure module this slice works
beside, with its frozen vocabularies and its typed error. `plugin/scripts/run-machine.js` and
`plugin/scripts/role-bytes.js` show a frozen partition and a static map with no prose.
`plugin/scripts/judge-agent-definition.js` shows a reader of an outside text with its own typed
error. `plugin/__tests__/step-announcement.test.js` shows the unit test of such a module.
`plugin/__tests__/ct-step-announcement-real-process.test.js` and
`plugin/__tests__/fixtures/ct-step-harness.js` drive the real `ct-step`.
`backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` drives the real oracle into
the backend.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/style.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/boundaries.md`, `plugin/conventions/decisions.md`,
`plugin/conventions/defects.md`, `plugin/conventions/domain.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/step-prose.js` | create | `ct-step.mjs`, the backend | Contract |
| `plugin/__tests__/step-prose.test.js` | create | the plugin suite | none (bodies by TDD) |
| `plugin/__tests__/conforming-modules.test.js` | modify | the plugin suite | prose |
| `plugin/scripts/ct-step.mjs` | modify | the loop | Current state, Call site |
| `plugin/__tests__/ct-step-announcement-real-process.test.js` | modify | the plugin suite | none (bodies by TDD) |
| `backend/src/infrastructure/run-dispatch.ts` | modify | `ct-run-machine.ts` | Current state, Contract |
| `backend/src/infrastructure/ct-run-machine.ts` | modify | `DriveRun` | Current state, Call site |
| `backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` | modify | the backend suite | Current state |
| `plugin/conventions/style.md` | read only | the implementer and the judge | none |

## 5. Interfaces

Consumes, all from `plugin/scripts/step-announcement.js`, which slice 1 delivered:
`StepAnnouncement.dispatch({ issue, task, tasksTotal, step, attempt, agent, inputs, response,
consuming })`, `AnnouncedInput({ role, kind, path })`, `AnnouncedResponse.of(step, path)`,
`INPUT_ROLES`, `INPUT_KINDS`, `RESPONSE_KINDS`, `RESPONSE_KIND_OF_STEP` and
`MalformedAnnouncement`. Also `STEPS` from `run-machine.js`, `RoleBytes.filesOf(step)`,
`AgentDefinition.parse(text)`, and `IMPLEMENTER_MODEL`, `IMPLEMENTER_TOOLS`, `JUDGE_TOOLS`,
`ADVISOR_TOOLS` and `SLICE_JUDGE_TOOLS` from `step-contracts.js`.

Produces, all from `plugin/scripts/step-prose.js`: `UnreadableStepProse`, `StepProseLines`,
`DispatchMaterialRead`, `DispatchProse.render(announcement)`,
`DispatchProse.read({ stdout, step })`, `DispatchProse.inputLine(step, role, path)`,
`DispatchProse.stepLine(step, attempt)` and `DispatchProse.stepOf(stdout)`. Slices 3 and 4 add
the program steps and the closure kinds to that same table. They add no door.

## 6. Test strategy

Task 1 drives the codec with a pure unit test. The module and its test join
`BornConforming.PATHS`, so `conforming-modules.test.js` measures both. The codec's law travels
as one test: over the lines `render` wrote, `read` hands back the material the announcement
declared. Every expectation in that file is a literal string. None of them comes from the module
under test.

Tasks 2 and 3 each move both halves of one boundary in one commit, which is what the same
repository buys. The plugin half keeps the prose byte for byte, and
`ct-step-announcement-real-process.test.js` measures the announcement through the real process.
The backend half keeps `run-dispatch-real-process.test.ts` green. That file keeps its own
hand-written labels: they are the literal expectation, and the production codec must never
supply them.

Task 4 has the backend take the consuming argv of a dispatch step from the prose the codec owns.
The five cases of `'conflicting response announcements and duplicate consuming commands are
refused before sealing'` keep measuring every contradiction.

## 7. Tasks

### Task 1 — the prose of a dispatch step gets one home and two doors

**Objective:** A new pure module holds the prose of a dispatch step and writes it from the
announcement.

**Files:** `plugin/scripts/step-prose.js` (create), `plugin/__tests__/step-prose.test.js`
(create), `plugin/__tests__/conforming-modules.test.js` (modify)

Contract (plugin/scripts/step-prose.js):

```js
export class UnreadableStepProse extends Error { constructor(detail) }
export class StepProseLines { constructor({ heading, material, consuming }) }
export class DispatchMaterialRead { constructor({ inputs, response, consuming }) }
export class DispatchProse {
  static CONSUMING_PREFIX = 'When it comes back:  ct-step '
  static render(announcement)            // -> StepProseLines
  static read({ stdout, step })          // -> DispatchMaterialRead
  static inputLine(step, role, path)     // -> string
  static stepLine(step, attempt)         // -> `step: ${step} (attempt ${attempt})`
  static stepOf(stdout)                  // -> string | null
}
```

`render` returns `heading`, then `material`, then `consuming`. `material` carries one line per
input in declared order, then the response line. `consuming` is `CONSUMING_PREFIX` plus
`consuming.argv` joined by one space. `read` refuses with `UnreadableStepProse` in the five
cases §2 names. An absent optional input costs no line and no element.

`plugin/__tests__/conforming-modules.test.js`: `BornConforming.PATHS` gains
`'scripts/step-prose.js'` and `'__tests__/step-prose.test.js'`.

**TDD:** `it('the prose of a judge announcement is the four lines ct-step prints for it')` — a
fixed announcement with three inputs, and the four literal lines. Then `it('an absent optional
input costs no line')` — the same announcement with no `controls-log`, and three lines.

**Tests:** added to `plugin/__tests__/step-prose.test.js`: `'the prose of a judge announcement
is the four lines ct-step prints for it'`, `'an absent optional input costs no line'`, `'the
material read back over the rendered lines is the material the announcement declared'`, `'a
label printed twice makes the read refuse'`, `'an empty path makes the read refuse'`, `'a
consuming argv that names another path makes the read refuse'`, `'a step with no declared prose
makes the read refuse'`, `'the committed verdicts come back as the one glob input'`.

**Verification:** The new unit suite proves both doors and every refusal. The conforming guard
proves the module carries no prose and no loose function.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/step-prose.test.js   # expected: exit 0 — both doors and every refusal
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/conforming-modules.test.js   # expected: exit 0 — the new module is born conforming
test "$(grep -c 'DISPATCH THE JUDGE' plugin/scripts/step-prose.js)" -eq 1   # expected: exit 0 — the judge heading has one home
```

### Task 2 — the reconciliation package label gets one home

**Objective:** The reconcile verb prints its package line through the codec, and `RunDispatch`
reads that path through the same table.

**Files:** `plugin/scripts/ct-step.mjs` (modify),
`backend/src/infrastructure/run-dispatch.ts` (modify),
`plugin/scripts/step-prose.js` (modify), `plugin/__tests__/step-prose.test.js` (modify)

`step-prose.js` is on the list for one reason. Task 1's `read` refuses a step that declares no
heading and no response label. Until slice 4 gives `reconcile` both, `reconcile` is that step.
So the call this task prescribes needs a declared exception there. The first version of this
list left those two files out, and the task did not fit inside it.
Current state (plugin/scripts/ct-step.mjs, lines 2077-2079):

```js
      out(`REDISPATCH ct-reconciler (subagent — declared WITHOUT Bash and WITHOUT Write: ${RECONCILER_TOOLS}) with the new package:`)
      out(`  - the reconciliation package: ${packagePath}`)
      out(`When it comes back:  ct-step reconcile --plan ${planPath} --issue ${issue}`)
```

Current state (backend/src/infrastructure/run-dispatch.ts, lines 334-338):

```js
    return new DispatchMaterial({
      role: 'reconcile',
      inputs: RunDispatch.#withRoleFiles(STEPS.RECONCILE, asked.pluginRoot, [
        RunDispatch.#literal(asked.stdout, '  - the reconciliation package: '),
      ]),
```

Call site (plugin/scripts/ct-step.mjs):

```js
// before, twice — the DISPATCH branch and the REDISPATCH branch:
out(`  - the reconciliation package: ${packagePath}`)
// after, twice:
out(DispatchProse.inputLine(STEPS.RECONCILE, INPUT_ROLES.RECONCILIATION_PACKAGE, packagePath))
```

`RunDispatch.#edits` passes `DispatchProse.read({ stdout: asked.stdout, step: STEPS.RECONCILE
}).inputs` to `#withRoleFiles`. It translates an `UnreadableStepProse` into `RunNotUnderstood`,
with the codec's `detail` inside the message. `#literal` loses this caller and keeps the other
four. At the reconcile step `read` returns `inputs` alone: that step declares no response label
and no consuming verb, so `response` and `consuming` come back `null`.

**TDD:** `it('the reconciliation package line and the path the backend takes share one declared
label')` in `plugin/__tests__/step-prose.test.js`. The expectation is the literal line
`  - the reconciliation package: /tmp/p.md`, and `read` takes that same string.

**Tests:** added to `plugin/__tests__/step-prose.test.js`: `'the reconciliation package line and
the path the backend takes share one declared label'`. Nothing removed.

**Verification:** The typecheck proves the new call. The unit suite proves the label. The real
oracle suite proves the reconciler still gets the package the verb printed.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/step-prose.test.js   # expected: exit 0 — one label, both directions
cd backend && npm run typecheck   # expected: exit 0 — the codec's read fits RunDispatch
cd backend && env -u CT_STATE_DIR npx vitest run --testTimeout=180000 __tests__/infrastructure/run-dispatch-real-process.test.ts   # expected: exit 0 — the reconciler keeps its package
```

### Task 3 — the four dispatch steps announce their material and render it

**Objective:** `nextVerb` announces the material of every dispatch step and renders its prose,
and `RunDispatch` stops matching prose.

**Files:** `plugin/scripts/ct-step.mjs` (modify),
`backend/src/infrastructure/run-dispatch.ts` (modify),
`plugin/__tests__/ct-step-announcement-real-process.test.js` (modify),
`backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` (modify)

Current state (plugin/scripts/ct-step.mjs, lines 647-651):

```js
      out(`DISPATCH THE JUDGE (subagent ct-judge — declared WITHOUT Bash: ${JUDGE_TOOLS}) with:`)
      out(`  - the review package: ${packagePath}`)
      out(`  - the task's brief: ${judgeBrief}`)
      out(`  - the logs of the controls, ALREADY green, in case it wants them: ${run.lastControlsLog ?? '(none)'}`)
      out(`  - that it write its verdict to: ${verdictPath}`)
```

Current state (backend/__tests__/infrastructure/run-dispatch-real-process.test.ts, line 553):

```ts
  }, 60_000)
```

Contract (backend/src/infrastructure/run-dispatch.ts):

```ts
static #material(asked: {
  stdout: string, command: RunConsumingCommand, pluginRoot: string,
}): DispatchMaterial
static #defined(asked: {
  role: Exclude<RunRole, 'implement' | 'reconcile'>, step: string,
  material: DispatchMaterialRead, pluginRoot: string,
  tools: string, schema: object | null,
}): DispatchMaterial
```

`#structured` takes the same `material` in place of `inputs` and `responseLabel`. Both drop
`announced` and `stdout`. `#response` projects `material.response` over
`RESPONSE_KIND_BY_STEP`, and the tool check of `#defined` and the implement rubric check stay.

`#material` takes its step from `DispatchProse.stepOf(asked.stdout)`. Each dispatch case of
`nextVerb` builds its announcement with the `agent`, `inputs` and `consuming` of §2. It then
prints `render`'s three parts in order. Line 603 prints
`DispatchProse.stepLine(run.step, currentAttempt())`. `ProducerOutput.optional` drops its
sentinel argument. The cap of line 553 becomes `180_000`, per §9.9.

**TDD:** `it('the judge step announces its agent, its inputs and its consuming argv')`. The
expectation is the whole JSON object as a literal, with `dispatch.agent` of `'ct-judge'`.

**Tests:** added to `plugin/__tests__/ct-step-announcement-real-process.test.js`: `'the judge
step announces its agent, its inputs and its consuming argv'`, `'the slice judge announces the
committed verdicts as a glob'`, `'the default prose of the judge step still prints its four
material lines'`. The existing `'the judge step answers with one JSON object carrying its
response channel'` grows the three new fields and keeps its name. Nothing removed.

**Verification:** The plugin suite proves the announcement and the prose. The typecheck proves
the signatures. The oracle suite proves every role keeps its paths.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-announcement-real-process.test.js   # expected: exit 0 — new fields, same prose
cd backend && npm run typecheck   # expected: exit 0 — signatures hold
test -z "$(grep -l -e '#printed' -e '#literal' -e '#optionalLiteral' -e '#glob' -e '#requireAnnouncement' backend/src/infrastructure/run-dispatch.ts)"   # expected: exit 0 — the five helpers left
cd backend && env -u CT_STATE_DIR npx vitest run --testTimeout=180000 __tests__/infrastructure/run-dispatch-real-process.test.ts   # expected: exit 0 — roles keep their paths
```

### Task 4 — the consuming argv of a dispatch step comes from the announcement

**Objective:** `OracleBoundary.#fileCall` takes its consuming argv from the codec, and
`RunConsumingCommand.structured` leaves with its last caller.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/src/infrastructure/run-dispatch.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify)
Current state (backend/src/infrastructure/ct-run-machine.ts, lines 370-378):

```ts
    try {
      const command = RunConsumingCommand.structured({
        stdout,
        plan: manifest.plan,
        issue: manifest.issue,
        step,
        verb,
      })
      return OracleResult.call(ticket, command.argv, command)
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

Call site (backend/src/infrastructure/ct-run-machine.ts):

```ts
// #fileCall, after: the codec answers, and no RunConsumingCommand travels
const material = DispatchProse.read({ stdout, step })
return OracleResult.call(ticket, [...material.consuming.argv])
// dispatch(), after: an empty argv is the E2E step and nothing else
if (effect.argv.length === 0) throw new RunNotUnderstood('ct-step requested unsupported E2E material')
```

`#fileCall` keeps its `try`. It turns an `UnreadableStepProse` into `OracleResult.refused` with
the codec's message. It drops its `verb` parameter, because the table declares that verb.
`RunDispatch.resolve` takes `command: RunConsumingCommand | null`, and `#edits` keeps the only
check over it. `RunConsumingCommand.structured` goes. The class keeps `#PREFIX`, `#lines` and
`edits` for slice 5.

**TDD:** `it('a consuming line that names another verb makes the dispatch refuse')` in
`backend/__tests__/infrastructure/run-dispatch-real-process.test.ts`. It prepends `When it comes
back:  ct-step verdict other.json …` to an implement output. Expect `RunNotUnderstood` and a
null seal.

**Tests:** `'conflicting response announcements and duplicate consuming commands are refused
before sealing'` keeps its name and its five cases in
`backend/__tests__/infrastructure/run-dispatch-real-process.test.ts`. Nothing added and nothing
removed.

**Verification:** The typecheck proves the narrowed type. The real oracle suites prove the loop
still resolves and still refuses. The greps prove the parser lost its caller.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the nullable command narrows everywhere
test "$(grep -c 'RunConsumingCommand.structured' backend/src/infrastructure/ct-run-machine.ts)" -eq 0   # expected: exit 0 — the dispatch family stopped needing it
test "$(grep -c 'static structured' backend/src/infrastructure/run-dispatch.ts)" -eq 0   # expected: exit 0 — the parser of the dispatch family left
cd backend && env -u CT_STATE_DIR npx vitest run --testTimeout=180000 __tests__/infrastructure/run-dispatch-real-process.test.ts __tests__/infrastructure/ct-run-machine-real-process.test.ts   # expected: exit 0 — the loop resolves and refuses
```

### Task 5 — the consuming line stops being lossy

**Objective:** The prose carries a path with a space, and no reader splits that line.

**Files:** `plugin/scripts/step-prose.js` (modify),
`plugin/__tests__/step-prose.test.js` (modify),
`plugin/__tests__/ct-step-announcement-real-process.test.js` (modify),
`backend/src/infrastructure/run-dispatch.ts` (modify)

No code — this task deletes two guards and restores one, and the review of task 3 names all
three by file and line.

`render` refuses an argv element that carries whitespace. Task 3 put `render` on the real road,
so a checkout whose path holds a space now exits 10 at every dispatch step. The parent commit
ran there. Delete that refusal.

`read` splits the consuming line on spaces, and the split serves one membership check.
`RunConsumingCommand.structured` already reads that line by prefix and suffix, without loss, so
the check needs no split. Delete the split and test the path against the line.

`#response` compared the consuming command's response path by position, and task 3 left it
testing membership. A forged stdout whose positional is wrong, and whose plan argument equals
the response path, passes where it used to refuse. Restore the positional check.

**TDD:** `it('a dispatch step announces and prints in a checkout whose path holds a space')`.
Drive `ct-step next` at the judge step, in a repository whose directory name carries a space.
Expect exit 0. Expect the rendered `When it comes back:` line with that path, and the
announcement's `consuming.argv` equal to the literal six elements.

Then `it('a consuming line whose positional is not the response path is refused')`.

**Tests:** added to `plugin/__tests__/step-prose.test.js`: `'a consuming argv element with a
space survives the round trip'`, `'a consuming line whose positional is not the response path
is refused'`. Added to `plugin/__tests__/ct-step-announcement-real-process.test.js`: `'a
dispatch step announces and prints in a checkout whose path holds a space'`. Removed on
purpose: `'a consuming argv element with whitespace makes render refuse'`, whose subject this
task deletes.

**Verification:** The module's suite proves the round trip and the positional refusal. The
real-process suite proves the loop starts where it used to die. The backend suite proves the
sealing refusals still refuse.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/step-prose.test.js   # expected: exit 0 — a space survives and a wrong positional refuses
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-announcement-real-process.test.js   # expected: exit 0 — the loop starts in a path with a space
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-dispatch-real-process.test.ts   # expected: exit 0 — the five sealing refusals hold
```

## 8. Global verification

The two suites prove the slice end to end. The plugin suite proves the announcement and the
prose. The backend suite proves the loop resolves every role. The greps prove the backend keeps
no label, no heading and no sentinel. Read the diff of `step-prose.js` with human eyes. Check
that the table's labels match `ct-step.mjs` character for character.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/step-prose.test.js __tests__/step-announcement.test.js __tests__/conforming-modules.test.js __tests__/ct-step-announcement-real-process.test.js   # expected: exit 0
cd backend && npm run typecheck   # expected: exit 0
cd backend && env -u CT_STATE_DIR npx vitest run --testTimeout=180000 __tests__/infrastructure/run-dispatch-real-process.test.ts __tests__/infrastructure/ct-run-machine-real-process.test.ts __tests__/infrastructure/run-driver-real-process.test.ts   # expected: exit 0
test -z "$(grep -l -e '#printed' -e '#literal' -e '#optionalLiteral' -e '#glob' -e '#requireAnnouncement' -e '(none)' -e '(N/A declared)' -e 'DISPATCH THE JUDGE' -e 'DISPATCH AN IMPLEMENTER' -e 'DISPATCH THE ADVISOR' -e 'DISPATCH THE SLICE JUDGE' backend/src/infrastructure/run-dispatch.ts)"   # expected: exit 0
test "$(grep -c '(N/A declared)' plugin/scripts/ct-step.mjs)" -eq 0   # expected: exit 0
test "$(grep -c '(none)' plugin/scripts/ct-step.mjs)" -eq 2   # expected: exit 0
test -z "$(git status --porcelain)"   # expected: exit 0
```

## 9. Assumptions

1. The backend still calls `ct-step next` with no flag, so the dispatch material still arrives
   as prose. Provenance: measured — `CtRunMachine.#nextArgv` passes `next --plan … --issue …`
   and nothing else. The flag cannot move here. Under it `out` writes nothing, so the `step:`
   line and the `Run it with:` line of every program step disappear at once. And
   `OracleBoundary.#plainCommand` belongs to slice 4. So this slice removes the duplication and
   not the prose road: one home for the labels, in the plugin, with two doors over it.
2. `plugin/conventions/boundaries.md` licenses that shape. It asks for one door both ways at the
   edge. `plugin/conventions/testing.md` asks for a boundary payload fed to the real reader on
   the other side. Provenance: both documents, read on this tree. The backend keeps no label and
   forms no second opinion, so the two derivations the design measured become one.
3. The frozen spec says no backend file belongs to slices 2 and 3 or to 2 and 4 at once. That
   does not hold for `ct-run-machine.ts`. `#fileCall` routes the dispatch family, and slice 5
   cannot delete `RunConsumingCommand` until this slice stops that family needing it.
   Provenance: own call, against the brief, which assigns that sentence to this slice. Task 4
   touches `#fileCall` and the guard at line 544, and nothing else in that file.
4. `RunConsumingCommand` survives this slice with `#PREFIX`, `#lines` and `edits`. The `When it
   comes back:` line feeds the reconcile family too, so slice 5 deletes the class. Provenance:
   the brief, and row 5 of «Tabla de slices».
5. An absent optional input costs a prose line. So `ct-step next` with no flag no longer prints
   byte for byte what `35303a16` printed in that one case. Provenance: own call, forced by the
   third acceptance criterion and by the design's «What retires». Both kill the sentinels. No
   line changes its words. The case needs an absent controls log, or a plan that declares N/A
   for its Global verification.
6. The agent name travels from the agent definition on disk. Provenance:
   `plugin/conventions/decisions.md`, which forbids the same partition in two places. The
   alternative was a new map of step to agent name, and `RoleBytes` already declares that
   partition as paths. A malformed definition now stops `ct-step next` at a dispatch step, and
   the backend already refuses the same file for the same reason.
7. `DispatchProse` carries `stepLine` and `stepOf`, so the `step:` line keeps one home. Without
   them that format lives in `ct-step.mjs` and in the backend's pattern, which is the divergence
   the design measured. Provenance: own call. `OracleBoundary`'s own `step:` pattern belongs to
   slice 3, so two patterns read that line until slice 3 lands.
8. The heading of the reconcile verb stays hand-typed, and its table entry carries the input
   label alone. Provenance: own call — slice 4 owns the reconciler's branch, and a heading with
   no caller discharges no burden of proof.
9. Three backend tests time out on this machine, with no change of this slice. They are the
   session replacement case of `ct-api-real-process.test.ts`, the advice case of
   `ct-run-machine-real-process.test.ts` and the role case of
   `run-dispatch-real-process.test.ts`. Provenance: measured — the whole backend suite ran 2782
   of 2785 green, and all three report a timeout and no assertion. The role case declares its
   own cap at line 553, and it needs 63.8 seconds against 60. `--testTimeout=180000` turns the
   advice case green, measured, and Task 3 raises the role case's cap. A cap on wall clock is no
   assertion, and every assertion of that case stays.
10. Every command that launches `ct-step` clears `CT_STATE_DIR` with `env -u`. Provenance:
    measured on this tree, and declared in slice 1's plan. With that variable present 38 tests
    of 8 files turn red, because `ct-step` writes its telemetry outside each fixture's home.
11. `node plugin/scripts/dispatch-check.mjs 496 --repo mercadona/control-tower --check-plan`
    exits 6 on this worktree. The four violations it reports all belong to slice 1's committed
    plan, `2026-09-21-issue-496-the-announcement-is-born.md`. Its own tasks rewrote the files it
    cites, so those citations no longer match the working tree. Provenance: measured before any
    change of this slice. This plan reports no violation of its own.
12. One plugin test outside this slice fails on this tree: the `--update-slices-contract` case of
    `ct-init.test.js`, at 134 seconds. Provenance: measured on this tree with no change of ours.
    The brief also names `an_absolute_one_is_taken_and_the_command_carries_on_reporting` of
    `ct-status.test.js`. Whoever implements this plan must read neither failure as their own, and
    §8 measures the four plugin files this slice touches.
