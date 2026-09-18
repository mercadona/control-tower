# #423 — a change asked while a slice implements reaches its conversation

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`RunPlanAgents.fix` refuses a change while the driver still implements a slice. Two gates
refuse it. The first gate is the reservation. `launch` claims the conversation and the claim
only lifts once the whole drive finishes. So `#claim` throws `PlanAgentNotResumed` with
`already has supervised work`.

The second gate is the inspection the issue quotes. It throws
`RunNotAdvanced` for every machine fact other than `delivered`. `SliceMessageRoute` collapses
both into `slice-message-not-delivered`.

A `claude -p` call takes no keystrokes while it runs. So the backend holds the change and hands
it over at the boundary of the next step of the run machine. This slice builds that hold and
that boundary. The hold lives in the run journal, beside the admission and the operations chain
that `RunJournal` already writes once. The boundary lives at the top of `DriveRun`'s loop.

### Desired end state

- `RunPlanAgents.fix` holds a change when the machine fact is `unstarted` or `active`, and
  answers without a refusal.
- `DriveRun` delivers every held change into the slice's conversation before it runs the next
  instruction.
- A held change outlives a restart of the API process, because the journal keeps it on disk.
- A change asked after delivery still starts a `fix` call the same way it does today.

### Out of scope

- `plugin/scripts/dispatch-check.mjs` and the whole `plugin/` tree.
- The pull request comment channel, which needs no change.
- `RunPlanRecovery`, for the reason in `## 9. Assumptions`.
- `backend/API.md`, which documents no `POST /slices/:issue/message` today.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Where a held change waits | `<state root>/harness/<conversation>/run/messages/<ticket>/` |
| What marks it as held | `message.json`, written once, with `version`, `askedAt` and `text` |
| What marks it as delivered | `delivery.json`, written once, with `version` and `call` |
| What pending means | `message.json` exists and `delivery.json` does not exist |
| Why nothing mutates | `HeadlessFiles.writeOnce`, the idiom of `admission.json` and `receipt.json` (D-17) |
| Order of delivery | by `askedAt` first, then by ticket; `randomUUID` does not sort |
| Which module holds it | `RunJournal`, the run's one immutable record; it implements `SliceMessages` |
| Where the drain runs | top of `DriveRun`'s loop, before `this.step.execute` |
| Who drains | `DeliverHeldMessages`, a use case `DriveRun` invokes, as it invokes the step |
| How the change reaches the agent | `calls.start(watch, 'fix', text, 'message:<ticket>')`, the existing errand |
| Machine facts that hold | `unstarted` and `active` |
| Machine facts that still refuse | `absent` and `uncertain` |
| Machine fact that stays unchanged | `delivered` |

## 3. Reference patterns

Files to imitate: `backend/src/domain/ports/run-machine.ts` shows an abstract port.
`backend/src/domain/value-objects/run-instruction.ts` shows a frozen value object.
`backend/src/application/actions/execute-run-instruction.ts` shows a use case `DriveRun`
invokes. `backend/src/infrastructure/run-journal.ts` shows the write-once idiom and its path
guards.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/style.md`,
`plugin/conventions/testing.md`, `plugin/conventions/domain.md`,
`plugin/conventions/boundaries.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/value-objects/held-message.ts` | create | the journal, the drain | Contract |
| `backend/src/domain/ports/slice-messages.ts` | create | the drain, the journal | Contract |
| `backend/src/infrastructure/run-journal.ts` | modify | `RunPlanAgents`, the drain | Current state, Contract |
| `backend/src/domain/ports/call-measurements.ts` | create | the drain | Contract |
| `backend/src/infrastructure/claude-run-measurements.ts` | modify | the drain | Current state |
| `backend/src/application/actions/deliver-held-messages.ts` | create | `DriveRun` | Contract |
| `backend/src/application/actions/drive-run.ts` | modify | `RunPlanAgents` | Current state |
| `backend/src/infrastructure/ct-api.ts` | modify | the entrypoint | Call site |
| `backend/src/infrastructure/run-plan-agents.ts` | modify | `RequestFixes` | Current state |
| `backend/conventions/this-repository.md` | modify | every diff here | Final text |

## 5. Interfaces

Consumes: `PlanCalls.start(watch, purpose, changes, requestId)` and `PlanCalls.wait(call)`,
which `ClaudePlanCalls` already implements; `HeadlessFiles.writeOnce(path, text)`.

Produces: `SliceMessages.hold(watch, text): Promise<string>`,
`SliceMessages.pending(watch): Promise<readonly HeldMessage[]>`,
`SliceMessages.settle(watch, ticket, call): Promise<void>`,
`HeldMessage` with `ticket`, `askedAt` and `text`,
`CallMeasurements.capture(call): Promise<void>`,
`DeliverHeldMessages.execute(params): Promise<void>` with `DeliverHeldMessagesParams`.

## 6. Test strategy

Every task carries its tests. `run-journal.test.ts` covers the hold, the listing and the
settlement, and a second journal over one state root proves the restart. A new
`deliver-held-messages.test.ts` covers the drain against port doubles. `drive-run.test.ts`
covers the boundary with a trace of the order. `run-plan-agents.test.ts` covers the four
machine facts at the door of `fix`. The suite runs from `backend/`, as
`backend/conventions/this-repository.md` states.

## 7. Tasks

### Task 1 — the run journal holds a change and settles it

**Objective:** The run journal writes a held change once, lists what stays pending and marks a
delivery.

**Files:** `backend/src/domain/value-objects/held-message.ts` (create),
`backend/src/domain/ports/slice-messages.ts` (create),
`backend/src/infrastructure/run-journal.ts` (modify),
`backend/src/infrastructure/ct-api.ts` (modify)

Current state (backend/src/infrastructure/run-journal.ts, lines 34-40):

```ts
  readonly files: HeadlessFiles
  readonly newId: () => string

  constructor(ports: { files: HeadlessFiles, newId: () => string }) {
    this.files = ports.files
    this.newId = ports.newId
  }
```

Contract (backend/src/domain/value-objects/held-message.ts):

```ts
export class HeldMessage {
  readonly ticket: string
  readonly askedAt: string
  readonly text: string

  constructor(asked: { ticket: string, askedAt: string, text: string })
}
```

Contract (backend/src/domain/ports/slice-messages.ts):

```ts
export abstract class SliceMessages {
  abstract hold(watch: PlanWatch, text: string): Promise<string>
  abstract pending(watch: PlanWatch): Promise<readonly HeldMessage[]>
  abstract settle(watch: PlanWatch, ticket: string, call: string): Promise<void>
}
```

Contract (backend/src/infrastructure/run-journal.ts):

```ts
export class RunJournal extends SliceMessages {
  static readonly #MESSAGES = 'messages'
  static readonly #MESSAGE = 'message.json'
  static readonly #DELIVERY = 'delivery.json'
  constructor(ports: { files: HeadlessFiles, newId: () => string, now: () => string })
}
```

`hold` mints a ticket with `newId`, stamps `askedAt` with `now` and writes
`{"version":1,"askedAt":…,"text":…}` through the private `#publish`. `settle` writes
`{"version":1,"call":…}`. `pending` reads the `messages` directory with the private `#list`,
skips a ticket that already has `delivery.json` and sorts by `askedAt`, then by ticket. A
malformed record raises `RunNotUnderstood`, as the admission does. `ct-api.ts` adds
`now: () => new Date().toISOString()` to the `new RunJournal({…})` at line 510.

**TDD:** `it('a held change stays pending until its delivery is settled')` — hold two
changes. Expect `pending` to list both in `askedAt` order. Settle the first one. Expect
`pending` to list only the second. Then `it('a held change outlives the journal that wrote
it')` — a second `RunJournal` over the same state root lists what the first one held.

**Tests:** added to `backend/__tests__/infrastructure/run-journal.test.ts`: `it('a held change
stays pending until its delivery is settled')`, `it('a held change outlives the journal that
wrote it')`, `it('a malformed held change is not understood')`.

**Verification:** The typecheck proves the port and the journal agree. The journal suite proves
the hold, the order, the settlement and the restart. The count pins three new tests in that
module.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the new port and value object typecheck
cd backend && npx vitest run __tests__/infrastructure/run-journal.test.ts   # expected: exit 0 — the journal holds, lists and settles
test "$(grep -c "it('a held change" backend/__tests__/infrastructure/run-journal.test.ts)" -eq 2   # expected: exit 0 — both held-change tests exist
```

### Task 2 — a use case delivers every held change

**Objective:** `DeliverHeldMessages` starts a `fix` call per held change, waits for it and
settles it.

**Files:** `backend/src/domain/ports/call-measurements.ts` (create),
`backend/src/application/actions/deliver-held-messages.ts` (create),
`backend/src/infrastructure/claude-run-measurements.ts` (modify)

Current state (backend/src/infrastructure/claude-run-measurements.ts, lines 304-315):

```ts
export class ClaudeRunMeasurements {
```

Contract (backend/src/domain/ports/call-measurements.ts):

```ts
export abstract class CallMeasurements {
  abstract capture(call: StartedPlanCall): Promise<void>
}
```

Contract (backend/src/application/actions/deliver-held-messages.ts):

```ts
export class DeliverHeldMessagesParams {
  readonly watch: PlanWatch
  constructor(asked: { watch: PlanWatch })
}

export class DeliverHeldMessages {
  static readonly REQUEST_PREFIX = 'message:'
  constructor(ports: {
    messages: SliceMessages,
    calls: PlanCalls,
    measurements: CallMeasurements,
  })
  execute(params: DeliverHeldMessagesParams): Promise<void>
}
```

`execute` reads `messages.pending(params.watch)` and walks it in order. Per held change it
calls `calls.start(watch, 'fix', message.text, `${DeliverHeldMessages.REQUEST_PREFIX}${message.ticket}`)`,
then `calls.wait(call)`, then `measurements.capture(call)`, then
`messages.settle(watch, message.ticket, call.id)`. A call that did not succeed raises
`PlanAgentNotResumed` with the diagnostic, the shape `DriveRun.#requireSuccess` already uses,
and the walk stops there. `ClaudeRunMeasurements` extends `CallMeasurements` and keeps its
body.

**TDD:** `it('every held change reaches the conversation in order and settles')` — two held
changes, expect the trace `start:message:a`, `wait`, `settle:a`, `start:message:b`, `wait`,
`settle:b`. Then `it('a change that did not succeed leaves the rest held')` — expect
`PlanAgentNotResumed` and expect the second change to stay pending.

**Tests:** added to `backend/__tests__/application/deliver-held-messages.test.ts`: `it('every
held change reaches the conversation in order and settles')`, `it('a change that did not
succeed leaves the rest held')`, `it('a watch with nothing held starts no call')`.

**Verification:** The typecheck proves the use case depends on ports alone. Its own suite
proves the order, the settlement and the stop.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the use case names ports only
cd backend && npx vitest run __tests__/application/deliver-held-messages.test.ts   # expected: exit 0 — the drain delivers, settles and stops
test -z "$(grep -l 'infrastructure' backend/src/application/actions/deliver-held-messages.ts)"   # expected: exit 0 — the use case imports no adapter
```

### Task 3 — the driver drains at the boundary of the next step

**Objective:** `DriveRun` delivers every held change before it runs each instruction of the run
machine.

**Files:** `backend/src/application/actions/drive-run.ts` (modify),
`backend/src/infrastructure/ct-api.ts` (modify)

Current state (backend/src/application/actions/drive-run.ts, lines 66-71):

```ts
    let instruction = await this.machine.open(params.watch)
    while (true) {
      instruction = await this.step.execute(new ExecuteRunInstructionParams({
        watch: params.watch,
        instruction,
      }))
```

Call site (backend/src/infrastructure/ct-api.ts):

```ts
    const driver = new DriveRun({
      calls: planCalls,
      publication,
      machine,
      step: new ExecuteRunInstruction({ machine, calls: runCalls }),
      messages: new DeliverHeldMessages({ messages: journal, calls: planCalls, measurements }),
    })
```

`DriveRun`'s constructor takes `messages: DeliverHeldMessages` beside `step`, and keeps it as a
field. The loop awaits `this.messages.execute(new DeliverHeldMessagesParams({ watch:
params.watch }))` as its first line, before `this.step.execute`. The drain runs on the first
turn too, so a change held during publication reaches the agent before the first instruction.

**TDD:** `it('every held change is handed over before the next instruction runs')` — a drain
double and a step double share one trace. Expect `drain`, `step:1`, `drain`, `step:2`, `drain`,
`step:3` for a run of three instructions. Then `it('a drain that refuses stops the run')` —
expect the driver to raise what the drain raised. Expect no later step.

**Tests:** added to `backend/__tests__/application/drive-run.test.ts`: `it('every held change is
handed over before the next instruction runs')`, `it('a drain that refuses stops the run')`.

**Verification:** The typecheck proves the wiring. The driver suite proves the order and the
stop. The whole application suite proves no other caller of `DriveRun` broke.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the driver and the entrypoint agree
cd backend && npx vitest run __tests__/application/drive-run.test.ts   # expected: exit 0 — the drain runs before every step
cd backend && npx vitest run __tests__/application   # expected: exit 0 — no other use case broke
```

### Task 4 — a change asked in flight is held rather than refused

**Objective:** `RunPlanAgents.fix` holds a change in flight instead of a refusal, and keeps
every other answer.

**Files:** `backend/src/infrastructure/run-plan-agents.ts` (modify)

Current state (backend/src/infrastructure/run-plan-agents.ts, lines 157-166):

```ts
    if (provenance === RunProvenance.LEGACY) return this.legacy.fix(asked)
    if (!this.#claim(watch)) {
      throw new PlanAgentNotResumed(`conversation ${JSON.stringify(watch.agent)} already has supervised work`)
    }
    let handedOff = false
    try {
      const inspection = await this.machine.inspect(watch)
      if (inspection.fact.kind !== 'delivered') {
        throw new RunNotAdvanced(`conversation ${JSON.stringify(watch.agent)} has not been delivered`)
      }
```

`fix` reads the inspection before it claims the conversation, because the claim is the first
gate and an in-flight slice always holds one. The order becomes: resolve the watch, resolve the
provenance, delegate a legacy watch, inspect. On `unstarted` or `active`, `fix` awaits
`this.journal.hold(watch, asked.changes)` and returns, with no claim and no call. On `absent`
or `uncertain`, `fix` throws `RunNotAdvanced` with the fact's own kind inside the message. On
`delivered`, `fix` claims and continues down the body that exists today, unchanged. The
`catch` still routes every cause through `#throwFixFailure`.

**TDD:** `it('a change asked while the run is active is held')` — an inspection of `active`, a
claimed conversation, expect no throw and expect the journal to hold the text. Then `it('a
change asked while the run is absent is still refused')` — expect `PlanAgentNotResumed` whose
message names `absent`. Then `it('a change asked after delivery still starts a fix call')` —
the path of today, unchanged.

**Tests:** added to `backend/__tests__/infrastructure/run-plan-agents.test.ts`: `it('a change
asked while the run is active is held')`, `it('a change asked while the run is unstarted is
held')`, `it('a change asked while the run is absent is still refused')`.

**Verification:** The typecheck proves the door. Its own suite proves the four facts. The
infrastructure suite proves the route and the recovery still read what they read.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the door typechecks
cd backend && npx vitest run __tests__/infrastructure/run-plan-agents.test.ts   # expected: exit 0 — held, refused and delivered all answer
cd backend && npx vitest run __tests__/infrastructure/slice-message-route.test.ts __tests__/infrastructure/run-plan-recovery.test.ts   # expected: exit 0 — the route and the recovery are untouched
```

### Task 5 — the vocabulary names a held change

**Objective:** `backend/conventions/this-repository.md` names the held change in its ubiquitous
language table.

**Files:** `backend/conventions/this-repository.md` (modify)

Final text (backend/conventions/this-repository.md):

```markdown
| **Held change** | One change a person asked of a slice that still implements, written once under `harness/<conversation>/run/messages/<ticket>/` and delivered at the boundary of the next step of the run machine. `message.json` records it and `delivery.json` closes it; the absence of the second is the whole of *pending*, so nothing mutates and a restart of the API process loses none of them |
```

The row goes straight after the **Change asked** row. The two are the same act through two
channels: one on a pull request, one in flight.

**TDD:** No TDD — the deliverable is the wording of a convention document.

**Tests:** N/A — `backend/__tests__/conventions-no-restatement.test.ts` already guards this
file and runs unchanged.

**Verification:** The guard proves the row restates no travelling rule. The grep proves the row
landed.

```bash
cd backend && npx vitest run __tests__/conventions-no-restatement.test.ts   # expected: exit 0 — the row restates nothing the plugin already says
test "$(grep -c '\*\*Held change\*\*' backend/conventions/this-repository.md)" -eq 1   # expected: exit 0 — the row exists exactly once
```

## 8. Global verification

The typecheck and the fast suite prove the slice end to end. A change asked in flight lands in
the journal. The driver hands it over at the boundary. The delivered path answers as it did
before. Read the diff of `run-plan-agents.ts` with human eyes. Check that the `delivered`
branch kept its body.

```bash
cd backend && npm run typecheck   # expected: exit 0 — the whole graph is sound
cd backend && npx vitest run --exclude '**/*-real-process.test.ts'   # expected: exit 0 — the fast suite is green
test -z "$(git status --porcelain)"   # expected: exit 0 — every task committed its work
```

## 9. Assumptions

1. The window opens for `unstarted` and `active` alone, and stays shut for `absent`. Provenance:
   the issue says *while a slice is still implementing*, and `absent` is the planner's window. A
   change held while the planner fails would wait for a boundary that never arrives.
2. `RunPlanRecovery` keeps its body. Provenance: own call. An unfinished call after a restart
   already lands in `UNCERTAIN` whatever its purpose, and the held change stays on disk. So the
   slice loses nothing. A clause for the `message:` prefix would only reword a diagnostic.
3. `RunJournal` implements `SliceMessages` instead of a second adapter over the same directory.
   Provenance: `plugin/conventions/architecture.md`, which defaults new behaviour to a method on
   a type that already exists. The journal is the run's one immutable record.
4. The drain captures a measurement through a new `CallMeasurements` port. Provenance: own call.
   `RunPlanAgents.#completeFix` captures one for the delivered path, and a drain with no capture
   would lose the cost of a real `claude -p` call.
5. `backend/API.md` documents no `POST /slices/:issue/message`, so this slice adds no row to it.
   Provenance: the repository, checked with a grep of that file.
6. The ticket of a held change is a `randomUUID`, as the journal's operations tickets are, and
   `askedAt` carries the order. Provenance: `RunJournal.begin`, which mints its ticket the same
   way.
