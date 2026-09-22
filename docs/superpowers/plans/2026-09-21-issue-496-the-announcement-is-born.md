# #496 — the announcement is born declaring the response channel

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`ct-step` is the loop's oracle. The backend runs it, parses its prose and dispatches what that
prose names. `ClaudeRunCalls.#installResponse` then overwrites the announced path with the
call's `structured_output`, whatever the role answered. A judge writes its verdict to that path
with `Write`; the backend replaces it with the four bytes `null`.

The run of #490 spent seven opus dispatches, $24.15 and about 17 minutes on that closed
channel. `--json-schema` travels since #417, so the schema was never the missing piece. An
agent dispatched with `--agent` carries only the tools its own definition declares, and the
advisor's declares no `StructuredOutput`.

This slice opens the contract that closes the hole. A new pure module,
`plugin/scripts/step-announcement.js`, declares the whole shape of one announcement.
`ct-step next --output-format json` prints it. The backend reads the response kind from that
same module, and it keeps its hands off an answer the agent wrote itself.

### Desired end state

- `plugin/scripts/step-announcement.js` exists and stays pure. It declares the four shapes, the
  three response kinds, the two input kinds, the eight input roles and every field.
- `ct-step next --output-format json` prints one JSON object with `version`, `kind`, `run` and,
  at a dispatch step, `dispatch.response`.
- `ct-step next` with no flag prints the prose of `35303a16`, with one word more in the
  advisor's tool list.
- `RunDispatch` gives the judge and the slice judge a response of kind `file`, and gives the
  implementer and the advisor one of kind `structured`.
- `ClaudeRunCalls` writes the announced path for `structured` alone, and its errand names that
  path to the two roles that write it themselves.
- `plugin/agents/ct-advisor.md` declares `StructuredOutput`, and a test ties that declaration
  to the channel its step answers through.
- The offline model fixture answers each role through the declared channel, and the run reaches
  `run delivered:` with the judge's own verdict bytes.

### Out of scope

- The prose of every `out()` line. No line changes its wording here.
- `.agent/run-<issue>.json`, `VERDICT_RULES`, the `review_token` binding and the body of every
  agent prompt after its frontmatter.
- The fourteen prose labels, the five announcement sentences and the four regexes of the
  backend. Slices 2, 3 and 4 retire them; this slice keeps them.
- `dispatch.agent`, `dispatch.inputs[]`, `commands[]` and `consuming.argv` as printed fields.
  This slice declares them and passes none of them.
- A transition or a refusal printed by any verb. Slice 3 delivers them; here only `next`
  answers the flag.
- The discard budget, the frontend and `judge-dispatch.js`.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Where the contract lives | `plugin/scripts/step-announcement.js`, pure: no disk, no process, no `git` |
| What the module prints | one JSON object per invocation, on stdout, nothing else |
| The flag | `--output-format json`, the spelling `judge-dispatch.js:65` already passes |
| The version field | `version: 1` |
| The three response kinds | `file`, `structured`, `edits` |
| Which step answers how | `RESPONSE_KIND_OF_STEP`, one home for the partition, in the new module |
| The judge and the slice judge | `file`: they hold `Write` and their rubrics order the file |
| The advisor | `structured`, and its agent declares `StructuredOutput` |
| The implementer | `structured`, exactly as today; #490 measured that channel open |
| The reconciler | `edits`: the tree is the answer |
| What a `file` role gets told | the errand names the path on the prompt's last line |
| What the backend writes for `file` | nothing; `ct-step verdict` reads the file the agent wrote |
| `--json-schema` | only for a role whose channel is `structured` |
| What slice 1 populates | `version`, `kind`, `run`, and `dispatch.response` |
| What slice 1 declares and leaves empty | `agent`, `inputs`, `commands`, `consuming`, `state`, `outcome`, `exit`, `detail` |
| An absent optional field | never reaches the printed line |
| The model and the tool list | stay in the agent markdown; they never travel |
| The JSON schema | stays in `step-contracts.js`; it never travels |
| The typed error | `MalformedAnnouncement`, the shape of `MalformedAgentDefinition` |
| Which verbs answer the flag | `next` alone; any other verb refuses with exit 2 |

## 3. Reference patterns

Files to imitate: `plugin/scripts/run-machine.js` is the pure module of frozen vocabularies
that the backend already imports. `plugin/scripts/role-bytes.js` and
`plugin/scripts/judge-agent-definition.js` show a typed error, a static map and a class with no
prose. `plugin/__tests__/role-bytes.test.js` shows its test.
`plugin/__tests__/fixtures/ct-step-harness.js` drives `ct-step` in a temporary repo.
`backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` holds the offline model
executable. `backend/__tests__/infrastructure/claude-run-calls.test.ts` shows the scripted call.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/defects.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/decisions.md`,
`plugin/conventions/boundaries.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/step-announcement.js` | create | `ct-step.mjs`, the backend | Contract |
| `plugin/__tests__/step-announcement.test.js` | create | the plugin suite | none (bodies by TDD) |
| `plugin/__tests__/conforming-modules.test.js` | modify | the plugin suite | Current state |
| `plugin/scripts/ct-step.mjs` | modify | the loop | Current state |
| `plugin/__tests__/ct-step-announcement-real-process.test.js` | create | the plugin suite | none (bodies by TDD) |
| `plugin/agents/ct-advisor.md` | modify | `--agents`, the harness | Final text |
| `plugin/scripts/step-contracts.js` | modify | `ct-step.mjs`, the backend | Current state |
| `plugin/__tests__/step-contracts.test.js` | modify | the plugin suite | Current state |
| `plugin/README.md` | modify | whoever reads the plugin | Final text |
| `backend/src/infrastructure/run-dispatch.ts` | modify | `ClaudeRunCalls` | Current state, Contract |
| `backend/src/infrastructure/claude-run-calls.ts` | modify | `DriveRun` | Current state, Contract |
| `backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/claude-run-calls.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/run-driver-real-process.test.ts` | modify | the backend suite | Current state |
| `backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts` | modify | the backend suite | none (bodies by TDD) |

## 5. Interfaces

Consumes: `STEPS`, `RUN_STATES` and `OUTCOMES` from `plugin/scripts/run-machine.js`;
`RoleBytes.STEPS` and `RoleBytes.filesOf(step)`; `AgentDefinition.parse(text)`.

Produces, all from `plugin/scripts/step-announcement.js`: `ANNOUNCEMENT_VERSION`,
`ANNOUNCEMENT_KINDS`, `RESPONSE_KINDS`, `INPUT_KINDS`, `INPUT_ROLES`,
`RESPONSE_KIND_OF_STEP`, `MalformedAnnouncement`, `AnnouncedResponse.of(step, path)`,
`AnnouncedInput`, `StepAnnouncement.dispatch(asked)`, `StepAnnouncement.program(asked)`,
`StepAnnouncement.transition(asked)`, `StepAnnouncement.refusal(asked)` and
`StepAnnouncement#text()`. Slices 2 to 4 fill the fields this slice leaves empty; they add
none. The backend also gains a `RunResponse` member of kind `file` and
`ClaudeRunCalls.FILE_ERRAND_END`.

## 6. Test strategy

Tasks 1 and 2 drive the new module with a pure unit test. Both module and test join
`BornConforming.PATHS`, so the guard of `conforming-modules.test.js` measures them. Task 3
drives the real `ct-step` through the harness of `ct-step-harness.js`, in a file that carries
the `-real-process` marker `plugin/conventions/testing.md` demands. Task 4 ties the tool
declaration to the channel partition, which is the measured copy `decisions.md` asks for.
Tasks 5 and 6 keep the backend suite green at every commit. Task 5 changes the argv and the
kind; Task 6 moves the channel, the errand and the fixture that answers it.

The echo of `run-dispatch-real-process.test.ts:538` goes in Task 5. It asserts the composed
argv against a recomputation of the production recipe, so no missing argument can redden it.
Its replacement is literal per role. The outcome arrives in Task 6, where the offline model
writes the verdict itself and the run still reaches `run delivered:`.

## 7. Tasks

### Task 1 — the response channel gets a vocabulary and one home per step

**Objective:** A new pure module declares the three response kinds and the channel each
dispatch step answers through.

**Files:** `plugin/scripts/step-announcement.js` (create),
`plugin/__tests__/step-announcement.test.js` (create),
`plugin/__tests__/conforming-modules.test.js` (modify)

Contract (plugin/scripts/step-announcement.js):

```js
export const ANNOUNCEMENT_VERSION = 1
export const RESPONSE_KINDS = Object.freeze({ FILE: 'file', STRUCTURED: 'structured', EDITS: 'edits' })
export const INPUT_KINDS = Object.freeze({ LITERAL: 'literal', GLOB: 'glob' })
export const INPUT_ROLES = Object.freeze({
  PACKAGE: 'package', BRIEF: 'brief', RUBRIC: 'rubric', PLAN: 'plan',
  CONTROLS_LOG: 'controls-log', GLOBAL_LOG: 'global-log', VERDICTS: 'verdicts',
  RECONCILIATION_PACKAGE: 'reconciliation-package',
})
export const RESPONSE_KIND_OF_STEP = Object.freeze({
  [STEPS.IMPLEMENT]: RESPONSE_KINDS.STRUCTURED, [STEPS.JUDGE]: RESPONSE_KINDS.FILE,
  [STEPS.ADVISE]: RESPONSE_KINDS.STRUCTURED, [STEPS.SLICE_JUDGE]: RESPONSE_KINDS.FILE,
  [STEPS.RECONCILE]: RESPONSE_KINDS.EDITS,
})
export class MalformedAnnouncement extends Error {
  constructor(detail)
}
export class AnnouncedResponse {
  static of(step, path)
  constructor({ kind, path })
}
export class AnnouncedInput {
  constructor({ role, kind, path })
}
```

`AnnouncedResponse.of` reads `RESPONSE_KIND_OF_STEP` and refuses a step that declares no
channel. `file` and `structured` need a non-empty string path; `edits` takes none, and a path
beside it raises. `AnnouncedInput` needs a declared role, a declared kind and a non-empty path.
Every refusal raises `MalformedAnnouncement`. The module imports `STEPS` from
`./run-machine.js` and touches no disk, no process and no `git`.

**TDD:** `it('every dispatch step declares the channel its role answers through')`. Expect the
keys of `RESPONSE_KIND_OF_STEP` to equal `RoleBytes.STEPS`. Expect the literal kind of each of
the five steps. Then `it('a step with no declared channel is malformed')`.

**Tests:** added to `plugin/__tests__/step-announcement.test.js`: `'every dispatch step
declares the channel its role answers through'`, `'a step with no declared channel is
malformed'`, `'a file response without a path is malformed'`, `'an edits response with a path
is malformed'`, `'an input with an undeclared role is malformed'`.

**Verification:** The module's own suite proves the partition and the four refusals. The guard
proves the new module carries no prose and no loose function. The grep proves the guard names
it.

```bash
cd plugin && npx vitest run __tests__/step-announcement.test.js   # expected: exit 0 — the partition and the refusals hold
cd plugin && npx vitest run __tests__/conforming-modules.test.js   # expected: exit 0 — the new module is born conforming
test "$(grep -c 'scripts/step-announcement.js' plugin/__tests__/conforming-modules.test.js)" -eq 1   # expected: exit 0 — the guard names the module
```

### Task 2 — the announcement declares its whole shape

**Objective:** The module declares the four announcement shapes and renders each one as one
JSON line.

**Files:** `plugin/scripts/step-announcement.js` (modify),
`plugin/__tests__/step-announcement.test.js` (modify)

Contract (plugin/scripts/step-announcement.js):

```js
export const ANNOUNCEMENT_KINDS = Object.freeze({
  STEP: 'step', TRANSITION: 'transition', REFUSAL: 'refusal',
})
export class StepAnnouncement {
  static dispatch({ issue, task, tasksTotal, step, attempt, agent, inputs, response, consuming })
  static program({ issue, task, tasksTotal, step, attempt, commands, consuming })
  static transition({ issue, task, tasksTotal, step, discards, state, outcome, exit })
  static refusal({ issue, task, tasksTotal, step, discards, state, outcome, exit, detail })
  text()
}
```

`text()` returns `JSON.stringify` of the announcement plus one newline. `version` and `kind`
open every shape. A dispatch step then carries `run` and `dispatch`; a program step carries
`run` and `commands`; both close with `consuming`. A transition and a refusal carry `state`,
`outcome`, `exit` and `run`, and the refusal closes with `detail`.

`run` nests `issue`, `task`, `tasksTotal`, `step`, and then `attempt` for a step or `discards`
for the other two. `dispatch` nests `agent`, `inputs` and `response`. An absent optional field
never reaches the line. No `agent` key with no agent, no empty `inputs`, no `commands` key on a
dispatch step, no `consuming` key with no argv. `state` and `outcome` come from `RUN_STATES` and
`OUTCOMES`; `step` comes from `STEPS`; every other value raises `MalformedAnnouncement`.

**TDD:** `it('a dispatch announcement prints version kind run and the response and nothing
else')`. Build the judge's announcement for task 1 of 5, attempt 1, with `response` alone.
Expect `text()` to equal the literal line. Then `it('a refusal with no detail is malformed')`.

**Tests:** added to `plugin/__tests__/step-announcement.test.js`: `'a dispatch announcement
prints version kind run and the response and nothing else'`, `'a program step prints its run
and no dispatch key'`, `'a transition prints its state outcome and exit'`, `'a refusal with no
detail is malformed'`, `'an announcement of an undeclared state is malformed'`.

**Verification:** The module's suite proves the four shapes and the literal line. The guard
proves the module still carries no prose.

```bash
cd plugin && npx vitest run __tests__/step-announcement.test.js   # expected: exit 0 — the four shapes render and refuse
cd plugin && npx vitest run __tests__/conforming-modules.test.js   # expected: exit 0 — the module stays conforming
test "$(grep -cE 'static (dispatch|program|transition|refusal)\(' plugin/scripts/step-announcement.js)" -eq 4   # expected: exit 0 — four doors, one per shape
```

### Task 3 — ct-step next answers with the announcement under the flag

**Objective:** `ct-step next` prints one announcement under `--output-format json` and keeps its
prose without the flag.

**Files:** `plugin/scripts/ct-step.mjs` (modify),
`plugin/__tests__/ct-step-announcement-real-process.test.js` (create),
`plugin/__tests__/conforming-modules.test.js` (modify)

Current state (plugin/scripts/ct-step.mjs, lines 136-145):

```js
const out = (msg) => safeWrite(1, msg + '\n')
const err = (msg) => safeWrite(2, msg + '\n')
const die = (msg, code) => { err(msg); process.exit(code) }

const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
```

`arg('--output-format', null)` reads the flag. The value `json` turns the announcement on; any
other value, `true` included, dies with `EXIT.USAGE`. Under the flag a verb other than `next`
dies with `EXIT.USAGE` and the diagnostic `only "ct-step next" answers with an announcement`.
`out` writes nothing once the flag is on, so the prose and the JSON never share stdout.

`nextVerb` builds the announcement on both roads, and prints it under the flag alone. A value
this program cannot announce then reddens the whole existing suite, not one flagged run. The
four dispatch cases build `StepAnnouncement.dispatch` with `AnnouncedResponse.of(run.step, <the
path that case already computed>)` and no other field. Every other step builds
`StepAnnouncement.program` with no `commands` and no `consuming`. The print goes right before
the seal.

**TDD:** `it('the judge step answers with one JSON object carrying its response channel')`. Run
`next --output-format json` at the judge step. Expect the parsed object to equal the literal
announcement, with `response.kind` of `file` at the verdict path. Then `it('ct-step next keeps
its prose when nobody asks for json')`.

**Tests:** added to `plugin/__tests__/ct-step-announcement-real-process.test.js`: `'the judge
step answers with one JSON object carrying its response channel'`, `'ct-step next keeps its
prose when nobody asks for json'`, `'a program step announces its run and no dispatch'`, `'a
verb other than next refuses the flag'`, `'an unknown output format refuses'`.

**Verification:** The new file proves the flag, the refusals and the JSON. The three oracle
suites prove the prose road. The guard proves the new test conforms. The diff proves no `out(`
line went away or changed.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-announcement-real-process.test.js   # expected: exit 0 — the flag answers and refuses
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-oracle.test.js __tests__/ct-step-advice.test.js __tests__/ct-step-slice-judgement.test.js   # expected: exit 0 — the prose road is intact
cd plugin && npx vitest run __tests__/conforming-modules.test.js   # expected: exit 0 — the new test carries its marker and no prose
test -z "$(git diff 35303a16 -- plugin/scripts/ct-step.mjs | grep -E '^-[[:space:]]*out\(')"   # expected: exit 0 — no printed line disappeared
```

### Task 4 — the advisor declares the tool its channel travels through

**Objective:** The advisor's declaration carries `StructuredOutput`, so its answer reaches the
backend.

**Files:** `plugin/agents/ct-advisor.md` (modify), `plugin/scripts/step-contracts.js` (modify),
`plugin/__tests__/step-contracts.test.js` (modify), `plugin/README.md` (modify)

Current state (plugin/scripts/step-contracts.js, lines 503):

```js
// THE ADVISOR (H9, `agents/ct-advisor.md`), with ONE single tool: `Read`. It
```

Current state (plugin/__tests__/step-contracts.test.js, lines 1309-1312):

```js
  it('the advisor cannot touch anything: it only reads', () => {
    expect(ADVISOR_TOOLS).toBe('Read')
    expect(advisorAgentTools()).toBe(ADVISOR_TOOLS)
  })
```

Final text (plugin/agents/ct-advisor.md):

```markdown
tools: Read, StructuredOutput
```

`ADVISOR_TOOLS` becomes `'Read, StructuredOutput'`, and the `tools:` line of the agent matches
it. The comment above the constant keeps its reasoning and loses the claim of one single tool.
The advisor still reaches nothing in the tree, and the new tool carries its answer out. The
cell of `plugin/README.md:156` names both tools in place of `Read` only. The body of
`ct-advisor.md` after the frontmatter stays byte for byte.

**TDD:** `it('the channel of a step and the tools of its agent cannot drift')` — for every step
of `RoleBytes.STEPS` whose first file lives under `agents/`, parse the definition. A
`structured` channel demands `StructuredOutput`, a `file` channel demands `Write`, and `edits`
demands `Edit`. Break the advisor's `tools:` line by hand and watch it fail.

**Tests:** added to `plugin/__tests__/step-contracts.test.js`: `'the channel of a step and the
tools of its agent cannot drift'`. Renamed on purpose: `'the advisor cannot touch anything: it
only reads'` becomes `'the advisor reaches nothing in the tree and answers through the
structured channel'`, and its literal becomes `'Read, StructuredOutput'`.

**Verification:** The contracts suite proves the tie and the new literal. The advice suite
proves `ct-step next` still announces the advisor's own tools. The grep proves the declaration
landed once.

```bash
cd plugin && npx vitest run __tests__/step-contracts.test.js   # expected: exit 0 — the tie and the literal hold
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-advice.test.js   # expected: exit 0 — the announced list is the agent's own
test "$(grep -c 'StructuredOutput' plugin/agents/ct-advisor.md)" -eq 1   # expected: exit 0 — the frontmatter declares it once
```

### Task 5 — the dispatch material carries the kind its step answers through

**Objective:** `RunDispatch` reads the response kind from the plugin's partition and drops the
schema a file channel cannot use.

**Files:** `backend/src/infrastructure/run-dispatch.ts` (modify),
`backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` (modify),
`backend/__tests__/infrastructure/claude-run-calls.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` (modify),
`backend/__tests__/infrastructure/run-driver-real-process.test.ts` (modify)

Current state (backend/src/infrastructure/run-dispatch.ts, lines 378-384):

```ts
  static #response(stdout: string, label: string, command: RunConsumingCommand): RunResponse {
    const announced = RunDispatch.#printed(stdout, label)
    if (command.responsePath === null || command.responsePath !== announced) {
      throw new RunNotUnderstood('the announced response path conflicts with the consuming command')
    }
    return Object.freeze({ kind: 'structured', path: announced })
  }
```

Contract (backend/src/infrastructure/run-dispatch.ts):

```ts
type RunResponse =
  | { readonly kind: 'file', readonly path: string }
  | { readonly kind: 'structured', readonly path: string }
  | { readonly kind: 'edits' }

class RunDispatch {
  static #response(step: string, stdout: string, label: string, command: RunConsumingCommand): RunResponse
}
```

The union of `RunResponse` at line 23 gains the `file` member. `#response` keeps its guard over
the consuming command and takes the kind from `RESPONSE_KIND_OF_STEP[step]` of the new module.
`#defined` takes `schema: object | null` and appends `--json-schema` only with a schema, so
`judge` and `slice-judge` pass `null`. The `contracts` map of `run-driver-mother.ts` drops the
schema argument of those two roles.

**TDD:** `it('every supported role carries its agent, its channel and the schema it needs')` —
the renamed echo test. Expect `file` for `judge` and `slice-judge`, `structured` for
`implement` and `advise`, `edits` for `reconcile`, from a literal table. Expect no
`--json-schema` in the two file roles and one in the two structured roles.

**Tests:** renamed on purpose: `'plugin definitions tools and schemas determine every supported
role'` becomes `'every supported role carries its agent, its channel and the schema it
needs'`. `DispatchRepository.expectedArgv` goes: it recomputed the recipe, so no missing
argument could redden it. `run-driver-real-process.test.ts` swaps its
`toContain(JSON.stringify(VERDICT_SCHEMA))` claims for `not.toContain`.

**Verification:** The typecheck proves the union. The real-process suites prove the kind and
the argv. The grep proves the echo is gone.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the three-member union typechecks
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-dispatch-real-process.test.ts __tests__/infrastructure/claude-run-calls.test.ts   # expected: exit 0 — the channel and the argv hold
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-driver-real-process.test.ts   # expected: exit 0 — the loop still delivers
test -z "$(grep -l 'expectedArgv' backend/__tests__/infrastructure/run-dispatch-real-process.test.ts)"   # expected: exit 0 — the recomputed echo is gone
```

### Task 6 — the backend keeps its hands off the answer the agent wrote

**Objective:** `ClaudeRunCalls` writes the announced path for a structured answer alone, and
names that path in a file errand.

**Files:** `backend/src/infrastructure/claude-run-calls.ts` (modify),
`backend/__tests__/infrastructure/claude-run-calls.test.ts` (modify),
`backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` (modify),
`backend/__tests__/infrastructure/run-driver-real-process.test.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts` (modify)

Current state (backend/src/infrastructure/claude-run-calls.ts, lines 81-84):

```ts
    if (!completion.succeeded) throw new RunNotAdvanced(ClaudeRunCalls.#failureOf(completion))
    if (dispatch.response.kind === 'edits') return
    await this.#installResponse(watch, call, dispatch.response.path)
  }
```

Contract (backend/src/infrastructure/claude-run-calls.ts):

```ts
export class ClaudeRunCalls extends RunCalls {
  static readonly FILE_ERRAND_END = 'Complete this role. Write your answer to the path on the last line of this file. Do not run CT commands or dispatch another agent.'
  static #prompt(dispatch: RunDispatch): string
}
```

`perform` dispatches over the three kinds with no catch-all: `edits` and `file` return, and
`structured` alone installs the response. `#prompt` keeps today's bytes for `structured` and
for `edits`. For `file` it writes `Read the listed files.`, the paths, `FILE_ERRAND_END` and the
response path, one per line.

The offline model executable of `run-driver-mother.ts` answers the same contract. It accepts
the file envelope and writes the verdict JSON to the path of the last line. It also leaves
`structured_output` out of its result event for that role. The loop of
`run-driver-real-process.test.ts` then expects the envelope of the kind each dispatch declares,
and the advisor keeps today's literal in `ct-run-machine-real-process.test.ts`.

**TDD:** `it('a judge that wrote its verdict keeps its own bytes')` — a `file` dispatch, a
stream with no `structured_output`, and the verdict already on the path. Expect those bytes
untouched and no `response.json` in the call directory. Then `it('a file errand names the path
on its last line')`.

**Tests:** added to `backend/__tests__/infrastructure/claude-run-calls.test.ts`: `'a judge that
wrote its verdict keeps its own bytes'`, `'a file errand names the path on its last line'`.
`RunCallMother.dispatch` takes the response kind, and `'one resumed call carries exact plugin
paths tools and binary schema'` keeps its name with the two judges moved to `file`.

**Verification:** The typecheck proves the exhaustive dispatch. The unit suite proves the bytes
and the errand. The two real-process suites prove the loop delivers with a judge that answers
by file. They also prove the advisor still answers through its own channel.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the dispatch over three kinds is exhaustive
cd backend && npx vitest run __tests__/infrastructure/claude-run-calls.test.ts   # expected: exit 0 — the judge's bytes survive
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-driver-real-process.test.ts __tests__/infrastructure/ct-run-machine-real-process.test.ts   # expected: exit 0 — the run delivers and the advice arrives
```

## 8. Global verification

The plugin suite and the backend suite prove the slice end to end. The judge answers with a
file, the advisor answers through its declared tool, and the run still delivers. Read the diff
of `claude-run-calls.ts` with human eyes. Check the body of the `structured` road.

```bash
env -u CT_STATE_DIR npm test --prefix plugin   # expected: exit 0 — the whole plugin suite is green
cd backend && npm run typecheck   # expected: exit 0 — the whole graph is sound
cd backend && env -u CT_STATE_DIR npx vitest run   # expected: exit 0 — the whole backend suite is green
test -z "$(git status --porcelain)"   # expected: exit 0 — every task committed its work
```

## 9. Assumptions

1. The frozen documents say «four kinds» and then name three: `step`, `transition` and
   `refusal`. I read it as four shapes over three `kind` values, because the design prints a
   dispatch step and a program step apart. Provenance: the design's own four JSON examples.
2. `--output-format json` reaches `next` alone in this slice. Provenance: own call. Slice 3
   owns the transition and the refusal, so every other verb would have to print a shape this
   slice does not populate. A refusal with exit 2 says so, rather than prose beside a JSON
   object.
3. `ADVISOR_TOOLS` changes, so the advise step's prose changes by one word. Provenance: own
   call, against the letter of the sixth criterion. The constant is the one the agent declares,
   and `step-contracts.js` says a hand copy of it already drifted once. An announced list that
   is not the agent's own is the defect that comment records.
4. `RESPONSE_KIND_OF_STEP` lives in the new module and the backend imports it. Provenance:
   `plugin/conventions/decisions.md`, which forbids the same partition of a closed vocabulary
   in two places. Without it slice 1 would hand-copy the partition into `run-dispatch.ts`.
5. The errand names the path for a `file` role. Provenance: own call, forced by measurement.
   The headless prompt is `Read the listed files.` plus the paths plus `Return the CLI
   response`, and no input names the verdict path. Without this the judge cannot write the file
   the backend now expects.
6. A call already recorded keeps its prompt, and `ClaudeCalls` refuses a second one with
   different bytes. So a run in flight at a judge call refuses after this lands, and a person
   restarts it. Provenance: `#requireMatchingRequest` in `claude-calls.ts`.
7. The backend writes nothing at all for a `file` answer, not even the call's evidence copy.
   Provenance: `plugin/conventions/simplicity.md` — nothing in `backend/src` reads
   `response.json`, and the design's own reader for that channel is `ct-step verdict`.
8. A missing verdict file stays a discard of `ct-step verdict`, which `readJson` already
   classifies. Provenance: the design's anti-scope, which parks the discard budget.
9. The implementer keeps the structured channel and joins no tie test. Provenance: measured —
   it carries no agent definition, so `--tools` governs it, and #490 crossed that step.
10. «The agents' prompts» of the protected column means the body after the frontmatter, which
    `AgentDefinition.parse` returns as `prompt`. D-8 orders the `tools:` line to change, so the
    protection cannot cover the frontmatter.
11. Task 5 lands before Task 6, and each one leaves the suite green. Provenance: own call.
    After Task 5 the judge's kind is `file` and `ClaudeRunCalls` still installs the response.
    So the verdict still arrives. Task 6 then moves both sides of the channel at once.
12. Every command that launches `ct-step` clears `CT_STATE_DIR` with `env -u`. Provenance:
    measured on this tree, with no change of mine. With that variable present, the plugin fast
    subset failed 38 tests of 8 files, and `run-driver-real-process.test.ts` failed too.
    `env -u CT_STATE_DIR` turns both green. The dispatching session exports that variable, so
    `ct-step` writes its telemetry outside the temporary home each fixture prepares.
