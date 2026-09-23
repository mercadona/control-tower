# #521 — the coordinating session grants the round

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow this plan
> and `AGENTS.md`.

## 1. Context and goal

#517 landed on 2026-09-22 as `22559dbb`. It persists `closed: blocked-judge` in the run file,
carries the judge findings into the refusal announcement, and sends one line to the
coordinating session through `SessionClosureAnnouncements`. The way back in stayed outside the
backend. That line ends *"Do not run it yourself."* It asks a person to type `ct-step reopen`
inside the slice worktree.

Three facts make that half unusable. `ct-step` resolves the repository from its own cwd at
`ct-step.mjs:225`. It resolves the run file under that root at `:253`. So the command only works
inside the slice worktree. The announced line names neither that path nor the plan. And
`DriveRun.#drive` already threw `RunNotAdvanced` at `drive-run.ts:108-110`, so a lifted run file
waits at `step: implement` with nobody on it.

This slice moves the grant inside the backend. The coordinating session asks the person what to
change and posts their words to `POST /slices/:issue/another-round`. The action inspects the run
first, journals `ct-step reopen` off the last command, and puts a driver back on the run.

### Desired end state

- `POST /slices/:issue/another-round` takes `{repo, agent, instruction}` and answers `202` with
  `{"status":"granted"}`.
- The action refuses with `409` unless the run stands `uncertain` with a `blocked-judge`
  closure, and it journals nothing then.
- `CtRunMachine.anotherRound` runs `reopen … --output-format json` as the successor of the last
  command, in the worktree.
- `ct-step reopen` under `--output-format json` announces a transition to `open`, and the oracle
  answers `next` with no new branch.
- `RunPlanAgents.anotherRound` ends in `#resumeIfNobodyDrives`, so the run carries on with
  nobody clicking anything.
- `SessionClosureAnnouncements.lineFor` names the call and drops *"Do not run it yourself."*
- `PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO` reaches the brainstorming prompt and the groom
  prompt.
- The backend typecheck stays green, and so does every suite the tasks name.

### Out of scope

- The five sibling closures, and the closure that shares the state with a spent discard budget.
- Any override that commits past a veto. The person grants another round, never a way round the
  judge.
- #518, the attempt counter a reopen rewinds. #517 declared it and it stays open.
- The page. It gains no button, and the frontend keeps every byte it has.
- `ct-step reopen` by hand. A person who debugs the loop keeps that verb.
- The `PlanAgents` port. `anotherRound` hangs off `RunPlanAgents` alone, beside `provenance` and
  `owns`.
- `backend/API.md`. It documents no `/slices/:issue/held-change` either, so this slice follows
  #517 and leaves that gap to whoever closes both.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| The route | `POST /slices/:issue/another-round` with `{repo, agent, instruction}` |
| Its answer on success | `202` and the body `{"status":"granted"}` |
| Its module | `backend/src/infrastructure/another-round-route.ts`, a module of its own |
| The guard | `machine.inspect(watch)` must answer `uncertain` with a closure whose state reads `blocked-judge` |
| The guard refusal | `409`, code `another-round-not-granted`, and nothing reaches the journal |
| The failure | `AnotherRoundNotGranted`, one class, straight off `PlanFailure` |
| The machine method | `CtRunMachine.anotherRound(watch, instruction)` |
| What it runs | `reopen --plan <plan> --issue <n> --instruction <text> --output-format json` |
| Where it hangs | off the **last** command, with `cwd: watch.located.path` |
| The plugin half | `ct-step reopen` prints `StepAnnouncement.transition` with `state: RUN_STATES.OPEN` |
| The oracle | no new effect kind and no new branch: `#closure` already answers `next` for a transition to `OPEN` |
| The action | `RunPlanAgents.anotherRound`, the shape of `fix`, and it ends in `#resumeIfNobodyDrives` |
| The port | untouched: `PlanAgents` gains no method |
| The announced line | it names the POST and drops *"Do not run it yourself."* |
| The prompt constant | `PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO`, in `brainstorming` and in `groom` |
| The scope | `BLOCKED_JUDGE` alone, and only the veto |
| The feature flag | none; the `flag-discipline` default of this repository is off |

## 3. Reference patterns

Files to imitate: `backend/src/infrastructure/slice-message-route.ts` is the route this one
copies, with `backend/__tests__/infrastructure/slice-message-route.test.ts` beside it and
`backend/__tests__/servers.ts` for the listening server.
`backend/src/infrastructure/run-plan-agents.ts` holds `fix`, whose shape the new action follows,
and `backend/__tests__/infrastructure/run-plan-agents.test.ts` holds `MachineDouble` and
`AgentMother`. `backend/src/infrastructure/ct-run-machine.ts` holds `#execute` and `#runnerArgv`,
and `backend/__tests__/infrastructure/ct-run-machine.test.ts` holds `OracleMother` and
`OracleFixture`. `backend/src/infrastructure/session-closure-announcements.ts` and
`backend/src/domain/value-objects/phase-prompt.ts` carry the two texts, with
`backend/__tests__/infrastructure/session-closure-announcements.test.ts` and
`backend/__tests__/application/phase-prompt.test.ts`. `plugin/scripts/ct-step.mjs` announces a
closure from a top-level block at `:351-356`, `plugin/scripts/step-announcement.js` declares
`transition`, and `plugin/__tests__/ct-step-reopen.test.js` drives the verb.

Two censuses decide what a new refusal owes them:
`backend/__tests__/infrastructure/refusal-codes.test.ts` and
`backend/__tests__/infrastructure/plan-refusal.test.ts`. Two guards measure every module this
slice adds: `backend/__tests__/yardstick.test.ts` and
`plugin/__tests__/conforming-modules.test.js`.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/decisions.md`,
`plugin/conventions/defects.md`, `plugin/conventions/domain.md`, `docs/glossary.md`,
`docs/language.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/ct-step.mjs` | modify | the loop and the backend oracle | Current state / Contract |
| `plugin/__tests__/ct-step-reopen.test.js` | modify | the plugin suite | none (body by TDD) |
| `backend/src/infrastructure/ct-run-machine.ts` | modify | `run-plan-agents.ts`, `ct-api.ts` | Current state / Contract |
| `backend/__tests__/infrastructure/ct-run-machine.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/src/infrastructure/another-round-route.ts` | create | `api-server.ts` | Contract |
| `backend/src/domain/exceptions.ts` | modify | the route and the action | Contract |
| `backend/__tests__/infrastructure/another-round-route.test.ts` | create | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/refusal-codes.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/plan-refusal.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/src/infrastructure/run-plan-agents.ts` | modify | `ct-api.ts` | Current state / Contract |
| `backend/src/infrastructure/api-server.ts` | modify | `ct-api.ts` | none (prose) |
| `backend/src/infrastructure/ct-api.ts` | modify | the running API | Call site |
| `backend/__tests__/infrastructure/run-plan-agents.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/src/infrastructure/session-closure-announcements.ts` | modify | `drive-run.ts` | Current state / Contract |
| `backend/__tests__/infrastructure/session-closure-announcements.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/src/domain/value-objects/phase-prompt.ts` | modify | the two session actions | Current state / Contract |
| `backend/__tests__/application/phase-prompt.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/application/open-coordinating-session.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/application/open-groom-session.test.ts` | modify | the backend suite | none (body by TDD) |
| `backend/__tests__/infrastructure/disk-conversation-records.test.ts` | modify | the backend suite | none (body by TDD) |
| `plugin/conventions/style.md` | read | ct's yardstick, at the kickoff path | none |

## 5. Interfaces

Consumes: `StepAnnouncement.transition({ issue, task, tasksTotal, step, discards, state, outcome,
exit })` from `plugin/scripts/step-announcement.js`, with `RUN_STATES` and `OUTCOMES` from
`plugin/scripts/run-machine.js`. `RunInspection` and `RunInstruction`, which
`backend/src/infrastructure/run-plan-agents.ts` already imports. `RepositoryName.isWellFormed`
and `ConversationId.isWellFormed`, the two checks `slice-message-route.ts` uses. `Answer`,
`JsonBody`, `Refusal` from `backend/src/infrastructure/http.ts` and `Projection` from
`backend/src/infrastructure/projection.ts`.

Produces: `AnotherRoundRoute`, `AnotherRoundOutcome`, `AnotherRoundCollapse` and the type
`AnotherRoundAsked`, all from `backend/src/infrastructure/another-round-route.ts`.
`AnotherRoundNotGranted` from `backend/src/domain/exceptions.ts`.
`CtRunMachine.anotherRound(watch: PlanWatch, instruction: string): Promise<RunInstruction>`.
`RunPlanAgents.anotherRound(asked): Promise<void>` and `RunPlanAgents.BLOCKED_JUDGE`.
`PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO`.

## 6. Test strategy

Every backend task drives its change with the commands of `backend/package.json`:
`npm run typecheck` and `npx vitest run` over the files it touches. The suites this slice names
run in about three seconds together, so each task names its own files and never a whole package.
`env -u CT_STATE_DIR` goes in front of every `npx vitest run`, the way the plans of #496 already
write it.

The plugin has a fast subset, `npm run test:fast`, which #520 derived from the spawn detection.
It skips every file that launches a real process, and `plugin/__tests__/ct-step-reopen.test.js`
is one of those. So task 1 names that file directly, which costs about 55 seconds and is the
narrowest command that measures the verb at all.

The route follows the controller row of `plugin/conventions/testing.md`. A real server listens
through `backend/__tests__/servers.ts` and a real client posts. The assertion reads the status
and the literal body. Every refusal case also asserts that the action recorded nothing, because
a refusal never reaches a double.

This plan keeps the machine and the action apart on purpose. `ct-run-machine.test.ts` drives the
real `CtRunMachine` over a scripted oracle, so it measures the journal chain and the argv.
`run-plan-agents.test.ts` drives the action over `MachineDouble`, so it measures the guard and
the resume with nothing spawned.

What stays unmeasured: the end-to-end journey from a live coordinating session to a running
implementer. No harness in this repository starts a session and a run together, and #517 left
that boundary in the same place.

## 7. Tasks

### Task 1 — the reopen verb announces the transition to open

**Objective:** `ct-step reopen` under `--output-format json` announces a transition that leaves
the run open.

**Files:** `plugin/scripts/ct-step.mjs` (modify), `plugin/__tests__/ct-step-reopen.test.js`
(modify)

Current state (plugin/scripts/ct-step.mjs, lines 389-391):

```js
      writeFileSync(stateFile, JSON.stringify(run, null, 2) + '\n')
      out(`run reopened at task ${run.task} of issue ${issue}: the implementer gets another round, and the judge will look again. Ask for the step with "ct-step next".`)
      process.exit(EXIT.OK)
```

Contract (plugin/scripts/ct-step.mjs):

```js
      if (announcing) {
        safeWrite(1, StepAnnouncement.transition({
          issue, task: run.task, tasksTotal: run.tasksTotal, step: run.step, discards: run.discards,
          state: RUN_STATES.OPEN, outcome: OUTCOMES.DONE, exit: EXIT.OK,
        }).text())
      }
```

The block goes between the write and the `out` line, where the `DELIVERED` gate puts its own at
`:351-356`. Line 384 already reassigned `run`, so `run.step` reads `implement` here. The prose
line stays: under the flag `out` writes nothing, and without the flag a person still reads the
sentence.

**TDD:** `it('under the output format flag it announces a transition that leaves the run open')`
reads the last stdout line. It expects `kind` `transition`, `state` `open`, `outcome` `done` and
`exit` `0`. The boundary beside it is
`it('without the flag the stdout stays the prose a person reads')`. That one expects
`run reopened at task 1 of issue 7` and no `{"version"`.

**Tests:** added, in `plugin/__tests__/ct-step-reopen.test.js`:
`'under the output format flag it announces a transition that leaves the run open'`,
`'without the flag the stdout stays the prose a person reads'`. Removed on purpose: none.

**Verification:** The file drives the verb both ways against the real `ct-step`. The suite that
pins every announcement shape stays green.

```bash
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-reopen.test.js   # expected: exit 0 — the verb announces and still prints prose
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/step-announcement.test.js __tests__/conforming-modules.test.js   # expected: exit 0 — the shape and the yardstick
test "$(grep -c 'RUN_STATES.OPEN' plugin/scripts/ct-step.mjs)" -ge 2   # expected: exit 0 — a second block names the open state
```

### Task 2 — the machine grants the round off the last command

**Objective:** `CtRunMachine.anotherRound` journals the reopen verb as the successor of the last
command.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (modify),
`backend/__tests__/infrastructure/ct-run-machine.test.ts` (modify)

Current state (backend/src/infrastructure/ct-run-machine.ts, lines 660-666):

```ts
  #nextArgv(manifest: RunManifest): readonly string[] {
    return this.#runnerArgv(['next', '--plan', manifest.plan, '--issue', String(manifest.issue)])
  }

  #runnerArgv(argv: readonly string[]): readonly string[] {
    return Object.freeze([this.ctStep, ...argv, '--output-format', 'json'])
  }
```

Contract (backend/src/infrastructure/ct-run-machine.ts):

```ts
  async anotherRound(watch: PlanWatch, instruction: string): Promise<RunInstruction>
  #reopenArgv(manifest: RunManifest, instruction: string): readonly string[]
```

`anotherRound` reads `#state(watch)`. With no manifest it throws
`RunNotUnderstood('another round has no run manifest')`. With no command it throws
`RunNotUnderstood('another round has no command to grant from')`. Otherwise it answers
`#execute(watch, manifest, last.ticket, this.#reopenArgv(manifest, instruction))`, where `last`
is the final element of `state.commands`.

`#reopenArgv` answers `this.#runnerArgv(['reopen', '--plan', manifest.plan, '--issue',
String(manifest.issue), '--instruction', instruction])`. So one method appends the flag, and no
second copy of it exists.

**TDD:** `it('the grant runs the reopen verb as the successor of the last command')` arranges a
chain whose last command carries a `blocked-judge` refusal. It answers the reopen argv with
`OracleMother.openTransition()` and the next argv with the implement announcement. It expects
`fixture.asked` to hold both argvs in that order. Two boundaries follow:
`it('a reopen the plugin does not know leaves a refusal the grant can hang off')` and
`it('a run with no command at all refuses the grant instead of forking the chain')`. The first
answers exit 2 with no announcement and expects a `refused` work.

**Tests:** added, in `backend/__tests__/infrastructure/ct-run-machine.test.ts`, under a new
`describe('CtRunMachine grants another round (#521)')`: the three names above. `OracleMother`
gains `judgeRefusal()`, a refusal announcement with `state` `blocked-judge`, `outcome` `failed`
and `exit` `1`, and `reopenArgv(instruction)`. Removed on purpose: none.

**Verification:** The grant journals off the last command and the oracle carries on. The module
still explains itself with names.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — the grant journals and the oracle answers next
cd backend && npm run typecheck   # expected: exit 0 — the new method resolves
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/yardstick.test.ts   # expected: exit 0 — no prose and no loose function
```

### Task 3 — the route and the failure it answers

**Objective:** The API declares `POST /slices/:issue/another-round` and a refusal for every way
it can fail.

**Files:** `backend/src/infrastructure/another-round-route.ts` (create),
`backend/src/domain/exceptions.ts` (modify),
`backend/__tests__/infrastructure/another-round-route.test.ts` (create),
`backend/__tests__/infrastructure/refusal-codes.test.ts` (modify),
`backend/__tests__/infrastructure/plan-refusal.test.ts` (modify)

Contract (backend/src/infrastructure/another-round-route.ts):

```ts
export const AnotherRoundOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_ISSUE: 'another-round-malformed-issue',
  MALFORMED_AGENT: 'another-round-malformed-agent',
  MALFORMED_INSTRUCTION: 'another-round-malformed-instruction',
} as const)
export type AnotherRoundAsked = (asked: {
  agent: string, issue: number, repository: RepositoryName, instruction: string,
}) => Promise<void>
export class AnotherRoundCollapse {
  static of(cause: Error): Refusal
  static declaredFailures(): string[]
  static declaredCodes(): string[]
}
export class AnotherRoundRoute {
  static readonly PATH = '/slices/:issue/another-round'
  static readonly STATUS = 'granted'
  static handledBy(grant: AnotherRoundAsked): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

`backend/src/domain/exceptions.ts` gains one line:
`export class AnotherRoundNotGranted extends PlanFailure {}`. The request reads like
`SliceMessageRequest`, with a third field `instruction` that must be a non-empty string.
`AnotherRoundCollapse` projects two failures: `AnotherRoundNotGranted` to `409` and
`another-round-not-granted`, `PlanAgentNotResumed` to `400` and `another-round-not-delivered`.
Both keep `cause.message` as the detail.

Two censuses grow. `refusal-codes.test.ts` adds `AnotherRoundOutcome` to
`RequestVocabularies.codes()` and the collapse codes to `EveryCodeTheApiEmits.values()`.
`plan-refusal.test.ts` adds `ANSWERED_BY_THE_ANOTHER_ROUND_ROUTE`, out of
`AnotherRoundCollapse.declaredFailures()`, to `startingAPlan`. Task 4 mounts the route.

**TDD:** `it('a granted round answers with the granted status and hands the words to the action')`
expects `202`, `{status: 'granted'}` and one recorded ask. Then
`it('an unknown field, an empty instruction and a malformed issue each refuse with their own code')`,
which also expects the action untouched. Then
`it('a run the judge did not close refuses with conflict and its own code')` and
`it('a conversation that is not the record of that issue refuses as not delivered')`. Last,
`it('the other methods of the path answer with an allow header')`.

**Tests:** added, in `backend/__tests__/infrastructure/another-round-route.test.ts`: the five
names above. Removed on purpose: none.

**Verification:** The route answers its status and every refusal.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/another-round-route.test.ts   # expected: exit 0 — the 202 and every refusal
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/refusal-codes.test.ts __tests__/infrastructure/plan-refusal.test.ts __tests__/yardstick.test.ts   # expected: exit 0 — both censuses and the yardstick
cd backend && npm run typecheck   # expected: exit 0 — the new module resolves
```

### Task 4 — the action inspects, grants and puts a driver back on the run

**Objective:** A granted round moves the run with nobody clicking anything.

**Files:** `backend/src/infrastructure/run-plan-agents.ts` (modify),
`backend/src/infrastructure/api-server.ts` (modify), `backend/src/infrastructure/ct-api.ts`
(modify), `backend/__tests__/infrastructure/run-plan-agents.test.ts` (modify)

Current state (backend/src/infrastructure/run-plan-agents.ts, lines 194-195):

```ts
      const inspection = await this.machine.inspect(watch)
      if (inspection.fact.kind === 'unstarted' || inspection.fact.kind === 'active') {
```

Contract (backend/src/infrastructure/run-plan-agents.ts):

```ts
  static readonly BLOCKED_JUDGE = 'blocked-judge'
  async anotherRound(asked: {
    agent: string, issue: number, repository: RepositoryName, instruction: string,
  }): Promise<void>
  static #throwAnotherRoundFailure(cause: unknown): never
```

Call site (backend/src/infrastructure/ct-api.ts):

```ts
      sliceHeldChange: (changed) => planAgents.hold(changed),
      anotherRound: (asked) => planAgents.anotherRound(asked),
```

`anotherRound` follows `fix`. It resolves the watch with `#fixWatch`, so a conversation that is
not the record throws `PlanAgentNotResumed`. It reads `provenance`, and a `LEGACY` run throws
`AnotherRoundNotGranted`. Then it inspects. The fact must read `uncertain` with a closure whose
`state` equals `RunPlanAgents.BLOCKED_JUDGE`. Anything else throws `AnotherRoundNotGranted`,
which names the kind the run stands at, and nothing reaches the journal.

Past the guard it calls `this.machine.anotherRound(watch, asked.instruction)`. A `refused` work
throws `AnotherRoundNotGranted` with the refusal detail, so a `202` only ever means the round
really opened. Otherwise it awaits `#resumeIfNobodyDrives(watch)`.
`#throwAnotherRoundFailure` rethrows an `AnotherRoundNotGranted`. It wraps `RunNotAdvanced`,
`RunNotUnderstood`, `PlanRecoveryConflict`, `PlanAgentNotLaunched` and `PlanAgentNotNamed`.
Anything else travels on.

`api-server.ts` mounts the route the way it mounts `SliceHeldChangeRoute` at `:333-340`. Six
edits: the import, the collaborator `anotherRound?: AnotherRoundAsked | null`, the field, the
constructor line, the `app.post` and the `app.all`.

**TDD:** `it('a granted round lifts the run and puts a driver back on it')` arranges
`MachineDouble` with an `uncertain` inspection whose closure state reads `blocked-judge`. It
expects the double to record the instruction and `agents.owns(watch)` to answer `true`. Two
boundaries follow: `it('a run nobody closed at the judge is refused before anything is journaled')`
and `it('a reopen the plugin refused is never reported as a granted round')`.

**Tests:** added, in `backend/__tests__/infrastructure/run-plan-agents.test.ts`: the three names
above. `MachineDouble` gains `anotherRoundAnswer`, the `RunInstruction` it returns, and
`anotherRoundAsked`, which records every instruction. Removed on purpose: none.

**Verification:** The guard, the grant and the resume hold, and the API mounts the route.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/run-plan-agents.test.ts   # expected: exit 0 — the guard, the grant and the resume
cd backend && npm run typecheck   # expected: exit 0 — the collaborator and the action resolve
test "$(grep -c 'AnotherRoundRoute' backend/src/infrastructure/api-server.ts)" -ge 3   # expected: exit 0 — the API mounts the route
```

### Task 5 — the announced line names the call instead of forbidding it

**Objective:** The line the coordinating session gets names the call that grants the round.

**Files:** `backend/src/infrastructure/session-closure-announcements.ts` (modify),
`backend/__tests__/infrastructure/session-closure-announcements.test.ts` (modify)

Current state (backend/src/infrastructure/session-closure-announcements.ts, lines 18-21):

```ts
    return `The judge vetoed ${which} of ${repository.text}#${issue} three times and the run is `
      + `closed at blocked-judge.${found}${where} Tell the person what failed and that another round is `
      + `granted by ct-step's \`reopen\` verb, which takes --plan with the run's plan, --issue ${issue} and `
      + '--instruction with what to change. Do not run it yourself.'
```

Contract (backend/src/infrastructure/session-closure-announcements.ts):

```ts
    return `The judge vetoed ${which} of ${repository.text}#${issue} three times and the run is `
      + `closed at blocked-judge.${found}${where} Tell the person what the judge found, ask them what `
      + `to change, and send THEIR words with POST /slices/${issue}/another-round `
      + '{repo, agent, instruction}. The instruction is theirs: you do not invent it.'
```

Nothing else in the module moves. `#flat`, `found`, `where` and `which` keep their bodies, and
the line stays one line.

**TDD:** `it('names_the_call_that_grants_the_round_and_the_three_fields_it_takes')` expects
`POST /slices/973/another-round` and `{repo, agent, instruction}`.
`it('asks_the_session_to_put_the_question_to_the_person_instead_of_handing_over_a_command')`
expects `Tell the person what the judge found` and `ask them what to change`.
`it('says_the_instruction_is_the_persons_so_the_session_does_not_invent_one')` expects
`The instruction is theirs: you do not invent it.`
`it('no_longer_forbids_the_session_from_acting_because_acting_is_now_its_job')` expects the line
to carry neither `Do not run it yourself` nor `ct-step`.

**Tests:** added, in `backend/__tests__/infrastructure/session-closure-announcements.test.ts`:
the four names above. Removed on purpose:
`'tells_the_session_to_pass_it_on_and_names_the_verb_and_the_flags_that_grant_another_round'`
and `'does_not_hand_over_a_command_to_paste_because_ct_step_refuses_a_reopen_without_its_plan'`,
whose subject leaves the line with this task.

**Verification:** The line names the call, and the sentence that forbade acting is out. The one
caller of the announcer still passes it on.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/session-closure-announcements.test.ts   # expected: exit 0 — the line names the call
test "$(grep -c 'Do not run it yourself' backend/src/infrastructure/session-closure-announcements.ts)" -eq 0   # expected: exit 0 — the forbidding sentence is out
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/application/drive-run.test.ts   # expected: exit 0 — the caller still announces a veto
```

### Task 6 — the coordinating session prompt carries the capability

**Objective:** Every coordinating session knows it can grant another round.

**Files:** `backend/src/domain/value-objects/phase-prompt.ts` (modify),
`backend/__tests__/application/phase-prompt.test.ts` (modify),
`backend/__tests__/application/open-coordinating-session.test.ts` (modify),
`backend/__tests__/application/open-groom-session.test.ts` (modify),
`backend/__tests__/infrastructure/disk-conversation-records.test.ts` (modify)

Current state (backend/src/domain/value-objects/phase-prompt.ts, lines 55-58):

```ts
      ...PhasePrompt.#idea({ story, comment }),
      PhasePrompt.CHANGE_TO_A_SLICE,
      PhasePrompt.RECOVERY_CAPABILITIES,
    ].join('\n'))
```

Contract (backend/src/domain/value-objects/phase-prompt.ts):

```ts
  static readonly ANOTHER_ROUND_AFTER_A_VETO =
    "When a slice's run closes at blocked-judge, the judge has vetoed the same task three times and the "
    + "run waits on a decision that is the person's. Read GET /active-plans for the repo, the issue and "
    + 'the agent, tell the person what the judge found, and ask them what to change. Send their words '
    + 'with POST /slices/<issue>/another-round and {repo, agent, instruction}: the backend grants the '
    + "round and the run carries on by itself. The instruction is the person's: you do not invent it, "
    + 'you do not widen the task, and you do not grant a round nobody asked for. There is no limit on '
    + 'rounds; the limit is the person.'
```

The constant sits beside `CHANGE_TO_A_SLICE` and `RECOVERY_CAPABILITIES`. Both `brainstorming`
and `groom` name it between those two. Three suites pin the whole prompt text as a list. Each of
them gains the same line in the same place. That is `open-coordinating-session.test.ts` twice,
`open-groom-session.test.ts` once and `disk-conversation-records.test.ts` once.

**TDD:** `it('reaches_the_coordinating_session_in_both_phases_because_a_veto_lands_in_either')`
expects both prompts to carry the constant.
`it('names_the_closure_the_call_and_the_three_fields_the_backend_reads')` expects
`blocked-judge`, `POST /slices/<issue>/another-round` and `{repo, agent, instruction}`.
`it('keeps_the_decision_with_the_person_so_no_session_grants_a_round_nobody_asked_for')` expects
`you do not invent it` and `you do not grant a round nobody asked for`.

**Tests:** added, in `backend/__tests__/application/phase-prompt.test.ts`: the three names above.
Removed on purpose: none. The existing
`'travels_as_one_line_because_that_is_how_it_reaches_the_terminal'` covers the new line too.

**Verification:** The constant reaches both prompts and every suite that pins one. The graph
typechecks.

```bash
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/application/phase-prompt.test.ts __tests__/application/open-coordinating-session.test.ts __tests__/application/open-groom-session.test.ts __tests__/infrastructure/disk-conversation-records.test.ts   # expected: exit 0 — the constant reaches both prompts and their readers
test "$(grep -c 'ANOTHER_ROUND_AFTER_A_VETO' backend/src/domain/value-objects/phase-prompt.ts)" -eq 3   # expected: exit 0 — declared once and named in both phases
cd backend && npm run typecheck   # expected: exit 0 — the graph is sound
```

## 8. Global verification

The seven commands below measure the slice end to end. I ran all seven on `4617239e`, the tip of
this branch. The typecheck and the four suite commands exited 0. The three greps exited 1, and
that is the state this slice changes.

The first grep counts the sentence that forbids acting, which reads 1 today. The second counts
the prompt constant, which reads 0. The third counts the mount of the route, which reads 0.

Read the diff of `ct-step.mjs` with human eyes. Check that no `out()` line moved a byte.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the whole graph is sound
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/another-round-route.test.ts __tests__/infrastructure/run-plan-agents.test.ts __tests__/infrastructure/ct-run-machine.test.ts   # expected: exit 0 — the route, the action and the machine
cd backend && env -u CT_STATE_DIR npx vitest run __tests__/infrastructure/session-closure-announcements.test.ts __tests__/application/phase-prompt.test.ts __tests__/infrastructure/refusal-codes.test.ts __tests__/infrastructure/plan-refusal.test.ts __tests__/yardstick.test.ts   # expected: exit 0 — the texts, the censuses and the yardstick
cd plugin && env -u CT_STATE_DIR npx vitest run __tests__/ct-step-reopen.test.js __tests__/conforming-modules.test.js   # expected: exit 0 — the verb and the plugin yardstick
test "$(grep -c 'Do not run it yourself' backend/src/infrastructure/session-closure-announcements.ts)" -eq 0   # expected: exit 0 — the line no longer forbids acting
test "$(grep -c 'ANOTHER_ROUND_AFTER_A_VETO' backend/src/domain/value-objects/phase-prompt.ts)" -eq 3   # expected: exit 0 — declared once and named in both phases
test "$(grep -c 'AnotherRoundRoute' backend/src/infrastructure/api-server.ts)" -ge 3   # expected: exit 0 — the API mounts the route
```

## 9. Assumptions

1. **The action hangs off `RunPlanAgents` and not off the `PlanAgents` port.** Provenance: my
   own call, from the repo. The design table calls it a port method, and the port is the natural
   home of `launch`, `resume`, `recover`, `hold` and `fix`. But `provenance` and `owns` already
   sit on `RunPlanAgents` alone, and `ct-api.ts` holds the concrete class. And
   `__tests__/domain/ports.test.ts` would demand a `must implement anotherRound(` refusal from a
   port nothing else implements. The narrow home costs one import and buys no fake method.
2. **`AnotherRoundNotGranted` extends `PlanFailure` with no family of its own.** Provenance: my
   own call, measured against `plan-refusal.test.ts`. That census demands a `PlanCollapse` entry
   for every `PlanFailure` subclass outside its `FAMILIES` list and outside the slice-message
   route's answers. A one-member family would need a row in `FAMILIES` too. The
   `ANSWERED_BY_THE_ANOTHER_ROUND_ROUTE` exclusion follows the precedent the same file already
   set for the slice-message route.
3. **A refusal from `ct-step` answers 409 rather than 202.** Provenance: my own call. The design
   failure table covers a stale plugin with no `reopen` verb. It leaves a journaled command and
   a run that reads uncertain, and it never calls that a grant. So the action throws and the
   route answers 409, which keeps the promise of a 202 honest.
4. **The grant awaits the spawn inside the request.** Provenance: the design, which puts
   `#resumeIfNobodyDrives` after the act. `CtRunMachine.anotherRound` runs `reopen` and then
   `next` before the route answers. Both are short, and `fix` already awaits `journal.hold` the
   same way.
5. **`backend/API.md` gains no section.** Provenance: my own call, measured in the file.
   `POST /slices/:issue/held-change` has no section there either, so this slice matches #517 and
   leaves the whole gap to one later diff.
6. **Task 3 lands a route the API does not mount yet.** Provenance: my own call. The mount needs
   `planAgents.anotherRound`, which task 4 writes. One commit with an unmounted module costs
   less than one commit that carries the route, the action and the wiring. The task text says
   which commit closes it.
7. **The three shared refusal codes need no census row.** Provenance: I read
   `Repeats.within`, which reports each repeated code once.
   `body-not-a-json-object`, `unknown-field` and `malformed-repo` already sit in
   `SharedOnPurposeAcrossRequestVocabularies.CODES`, so a third vocabulary that spells them
   changes nothing there.
8. **No end-to-end harness measures the whole arrow.** Provenance: my own search of the repo.
   Nothing starts a live coordinating session and a run together. So the journey from the
   announced line to a dispatched implementer stays covered in two halves.
