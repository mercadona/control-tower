# #591 — Milestone progress read

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

The page reads each slice with `GET /work-progress/:issue` and `GET /implement-history/:issue`,
one poll per slice, and it needs the agent of each slice first. `ReadEpicGroom`
(`backend/src/application/queries/read-epic-groom.ts`) already finds the milestone of the held
coordinating session. `EpicSpecs.of` gives the spec, `spec.title()` names the milestone, and
`EpicIssues.listOf` lists its issues with `isOpen`. `WorkInventory.find(issue, repository)`
tells the phase of one slice without its agent.

`StreamPlanningActivities` (`backend/src/infrastructure/stream-planning-activities.ts`) reads
the stream of the one `plan` call. The `implementation` calls write the same `stream.ndjson`,
but `implementationFor` in `claude-plan-calls.ts` throws when there is more than one. The
baseline lives only in the `baseline:` field of `.agent/SLICE.md` in the slice worktree.
`RecoverCoordinatingSession` resumes a conversation with `Conversations.resume` only at backend
start.

The issue asks for two routes. `GET /milestone-progress` answers one line per issue of the held
session's milestone. `POST /coordinating-session/reopen` resumes an ended coordinating session
by its identifier. When the transcript is gone, it opens a new conversation with the prompt of
the story's step.

### Desired end state

- `GET /milestone-progress` answers one line for each issue in the states `pending`,
  `running`, vetoed, uncertain and `delivered`. Test doubles prove it.
- Each line carries the state, the step, task X of Y and the start of the current step. It
  also carries the last tool, the last text, the pull request and the attention. It ends with
  baseline red and the tasks with the judge's findings.
- The current implementation call is the `implementation` call with the latest `startedAt`.
- `POST /coordinating-session/reopen` resumes by identifier when the transcript exists. Else it
  opens a new conversation with the prompt of the current step, and step 4 gets a new
  implementation prompt.
- The backend deduces that step itself. A draft spec gives brainstorming. A frozen spec that
  gate 2 did not authorise gives groom. An authorised milestone gives implementation.
- `backend/src/domain/**` and `backend/src/application/**` import neither GitHub nor the disk.
- `backend/API.md` documents both routes.

### Out of scope

- 🚫 `frontend/`: this slice does not touch it.
- Nothing goes away in this slice: `/work-progress`, `/implement-history` and `/active-plans`
  keep their answers as today.
- A session that a person closed with `POST /coordinating-session/close` leaves no held session,
  so reopen does not reach it. That case stays as today.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 · Span of step 4 | `implementation goes from the first slice started to the last merge; the focused view keeps its header and four steps, with step 4 in progress.` |
| D-2 · Only the milestone in flight | `while a milestone is in flight the page shows only that milestone; slices of other stories do not appear and no other story is started until it ends.` |
| D-3 · The centre is a compact list | `every issue of the milestone (pending, running, delivered) on one line: number, title, step, task X of Y, time in the current step and pull request link, under "Issues del milestone" with "X de N entregadas".` |
| D-4 · A line expands | `into its tasks with their status, what the judge found, and the agent's last tool and last message, so the page never looks frozen.` |
| D-5 · Needs the person | `a slice that needs the person is marked with what happened and the one action that fits it: "Hablar con la sesión" for a judge veto, the single recovery button for an uncertain state.` |
| D-6 · Baseline notice | `"El repositorio ya estaba en rojo antes de empezar…" appears only when some slice's baseline was red.` |
| D-7 · Session panel | `"Hablar con la sesión" opens the coordinating session's terminal in a panel over the list.` |
| D-8 · Reopen | `a session that ended by itself shows "La sesión coordinadora se ha cerrado" and "Reabrir la sesión" in every step; reopening resumes the same conversation by its identifier and, only when that is impossible, opens a new one with the prompt of the current step.` |
| D-8a · Ended-session copy per step | `in step 4 the notice says "Los slices siguen en marcha. Reábrela para volver a hablar con ellos; conserva lo que ya se habló."; in steps 1 to 3 it says "Reábrela para seguir; conserva lo que ya se habló."` |
| D-9 · Completed | `with every issue delivered: "Milestone completado" and one action, "Cerrar la sesión y volver al inicio".` |
| D-10 · Cancel unchanged | `"Cancelar la sesión" stays as today; after it the page is the start form and running slices are not shown.` |
| D-11 · No leftover | `everything the person cannot act on and does not need is removed, with every piece of code, test, fixture, field, route and doc left without a reader.` |
| D-12 · One backend read | `GET /milestone-progress reads the held coordinating session's milestone (same source as /epic-groom) through query ReadMilestoneProgress returning value object MilestoneProgress of SliceLines, composed from existing ports plus two new ones: the current implementation call's activity and the slice's baseline.` |
| D-13 · Reopen action | `POST /coordinating-session/reopen (action ReopenCoordinatingSession) resumes with claude --resume <id> when the transcript exists, and otherwise opens a new conversation with the prompt of the story's step, a new implementation prompt for step 4.` |
| D-13a · The backend deduces the step for the reopen prompt | `spec not frozen: brainstorming; frozen but not authorized: groom; gate 2 authorized: implementation.` |
| D-14 · `The classic view is deleted, not reshaped` | `the drawer, flow nav, slice cards, gate sequence, plan adoption and restore, column resizer, today's task history and the mirrors only they used go, per the inventory of #583.` |
| D-15 · Backend cleanup | `/work-progress, /implement-history, GET /sessions, POST /start-plan, GET /slices/:issue/escalation and the page-only fields of /active-plans go with their tests and docs, per the inventory of #584.` |
| D-16 · Three slices in order | `the backend read and reopen, then the focused implementation view, then the backend cleanup; once groomed, #582, #583 and #584 are closed as superseded, pointing to the new issues.` |
| D-17 · No feature flag | `the change is implemented directly.` |
| Milestone source | `ReadMilestoneProgress` reads `EpicSpecs` and `EpicIssues` itself, the same ports `ReadEpicGroom` reads. It does not call `ReadEpicGroom`, because that query runs `ct-groom` on an authorised milestone. |
| Line state | issue closed or work `finished` → `delivered`; `WorkNotFound` on an open issue → `pending`; `planning` or `implementing` → `running`; `uncertain` → `needs-person`. |
| Attention of a veto | `veto`, for an `uncertain` work whose `refusal.state` is `'blocked-judge'` |
| Attention of an uncertain work | `uncertain` with the recovery action, for any other `uncertain` work |
| Attention of a partial read | `partial`, for an `implementing` read that meets a `PlanFailure` or a `partial` delivery; the line state stays `running` |
| Step start | the later of the current call's `startedAt` and the last history entry's `writtenAt`. For the plan step: `nowMs() - runningMs` while the plan call runs, else null. |
| Unreadable activity | a `PlanFailure` from `PlanningActivities` or `ImplementationActivities` leaves `lastToolCall` and `lastText` null. It never fails the read. |
| Other read failures | any other `PlanFailure` fails the whole read; the route answers it as `400 milestone-progress-not-read`. A listing with `exhausted: false` throws `EpicIssuesNotRead` with the listing's reason. |
| Reopen admission | only a held session in state `ended` or `unresumable` reopens; `live` answers `409 coordinating-session-not-ended`. |

## 3. Reference patterns

Files to imitate:

- `backend/src/application/queries/read-work-progress.ts` — a query that composes ports and
  turns a `PlanFailure` into a reading.
- `backend/src/infrastructure/disk-slice-escalations.ts` — an adapter that reads
  `.agent/SLICE.md` in a slice worktree.
- `backend/src/infrastructure/stream-planning-activities.ts` — the stream reader.
- `backend/src/application/actions/open-groom-session.ts` — an action that opens a
  conversation with a phase prompt.
- `backend/src/infrastructure/epic-groom-route.ts` — a read of the held session.
- `backend/src/infrastructure/groom-session-route.ts` — a route that reserves, opens and
  remembers the held session.

Rules to obey:

- `.agent/conventions.md`
- `CLAUDE.md`
- `docs/language.md`
- `backend/conventions/this-repository.md`

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/ports/slice-baselines.ts` | create | `ReadMilestoneProgress` | Contract |
| `backend/src/infrastructure/disk-slice-baselines.ts` | create | `ct-api.ts` | Contract |
| `backend/src/domain/exceptions.ts` | modify | the two new adapters | Contract |
| `backend/__tests__/infrastructure/disk-slice-baselines.test.ts` | create | vitest | none (body by TDD) |
| `backend/src/domain/ports/implementation-activities.ts` | create | `ReadMilestoneProgress` | Contract |
| `backend/src/domain/value-objects/implementation-activity.ts` | create | the port and the query | Contract |
| `backend/src/infrastructure/stream-implementation-activities.ts` | create | `ct-api.ts` | Contract |
| `backend/src/infrastructure/stream-planning-activities.ts` | modify | the new stream reader | Current state |
| `backend/__tests__/infrastructure/stream-implementation-activities.test.ts` | create | vitest | none (body by TDD) |
| `backend/src/domain/value-objects/slice-line.ts` | create | the query and the route | Contract |
| `backend/src/domain/value-objects/milestone-progress.ts` | create | the query and the route | Contract |
| `backend/src/domain/value-objects/slice-task.ts` | create | `SliceLine` | Contract |
| `backend/src/application/queries/read-milestone-progress.ts` | create | the route | Contract |
| `backend/__tests__/application/read-milestone-progress.test.ts` | create | vitest | none (body by TDD) |
| `backend/__tests__/milestone-progress-mother.ts` | create | the query and route tests | none (body by TDD) |
| `backend/src/infrastructure/milestone-progress-route.ts` | create | `api-server.ts` | Contract |
| `backend/__tests__/infrastructure/milestone-progress-route.test.ts` | create | vitest | none (body by TDD) |
| `backend/src/infrastructure/api-server.ts` | modify | `ct-api.ts` | Current state, Call site |
| `backend/src/infrastructure/ct-api.ts` | modify | the process | Current state |
| `backend/__tests__/infrastructure/refusal-codes.test.ts` | modify | vitest | prose |
| `backend/src/domain/value-objects/phase-prompt.ts` | modify | the reopen action | Contract |
| `backend/src/domain/policies/story-step.ts` | create | the reopen action | Contract |
| `backend/src/application/actions/reopen-coordinating-session.ts` | create | the reopen route | Contract |
| `backend/__tests__/application/reopen-coordinating-session.test.ts` | create | vitest | none (body by TDD) |
| `backend/src/infrastructure/coordinating-session-reopen-route.ts` | create | `api-server.ts` | Contract |
| `backend/__tests__/infrastructure/coordinating-session-reopen-route.test.ts` | create | vitest | none (body by TDD) |
| `backend/__tests__/domain/layer-imports.test.ts` | create | vitest | none (body by TDD) |
| `backend/API.md` | modify | people, the next slice | Final text |
| `/Users/acapdev/repos/control-tower-install/plugin/conventions/` | read | every task | none |

## 5. Interfaces

Consumes: N/A — this is slice #1 of the milestone and the issue declares no dependency.

Produces, for the focused implementation view of the next slice:

- `GET /milestone-progress` → `{ status: 'none' }`, `{ status: 'no-milestone', target }`, or
  `{ status: 'milestone', target, milestone, delivered, total, issues }`.
- each entry of `issues`: `number`, `url`, `title`, `state`, `step`, `task`, `total_tasks`,
  `step_started_at`, `last_tool`, `last_text`, `pull_request`, `attention`, `baseline_red`,
  `tasks`.
- `POST /coordinating-session/reopen` with the `x-coordinating-target` header → `202` with
  `status` (`resumed` or `opened`), `step`, `target`, `conversation`, `repo`, `story`, `root`,
  `session`.
- `ReadMilestoneProgress.execute(params: ReadMilestoneProgressParams): Promise<MilestoneProgressRead>`.
- `ReopenCoordinatingSession.execute(params: ReopenCoordinatingSessionParams): Promise<CoordinatingSessionReopened>`.

## 6. Test strategy

Each use case is a black box, with its ports doubled at construction
(`plugin/conventions/testing.md`). The assertion is on what each port received and what the use
case returned. The domain objects get no tests of their own; the query and the action reach
them.

Each adapter test cuts right before the disk. A `read` double answers by path, with contents
copied from a real `.agent/SLICE.md` or a real `stream.ndjson`, and the test names that capture.

Each route test runs a real listening server with a real client, and doubles the use case. The
test of a refused request also asserts that the use case got no call. Doubles answer by the
question, never by call order. Shared objects come from
`backend/__tests__/milestone-progress-mother.ts` and the mothers already there.

Run the checks from `backend/`: `npx tsc -p tsconfig.json` and `npx vitest run --maxWorkers=4`.
A "CT_STATE_DIR disagreement" failure in a real-process test comes from a backend that runs on
the machine, not from the diff.

## 7. Tasks

### Task 1 — The slice baseline port and its disk adapter

**Objective:** `DiskSliceBaselines` tells whether the baseline in a slice's `.agent/SLICE.md` was red.

**Files:** `backend/src/domain/ports/slice-baselines.ts` (create), `backend/src/infrastructure/disk-slice-baselines.ts` (create), `backend/src/domain/exceptions.ts` (modify), `backend/__tests__/infrastructure/disk-slice-baselines.test.ts` (create)

Contract (backend/src/domain/ports/slice-baselines.ts):

```ts
export abstract class SliceBaselines {
  abstract isRed(asked: { root: CheckoutRoot, issue: number }): Promise<boolean>
}
```

Contract (backend/src/infrastructure/disk-slice-baselines.ts):

```ts
export class DiskSliceBaselines extends SliceBaselines {
  readonly read: (path: string) => Promise<string | null>
  constructor({ read }: { read: (path: string) => Promise<string | null> })
}
```

Contract (backend/src/domain/exceptions.ts):

```ts
export class SliceBaselineFailure extends PlanFailure {}
export class SliceBaselineNotRead extends SliceBaselineFailure {}
export class SliceBaselineNotUnderstood extends SliceBaselineFailure {}
```

The path is `DiskSliceEscalations.stateFileFor(root.text, issue)`. A `null` read answers
`false`: a pending slice has no worktree. The frontmatter goes through `parseStateSafe`. The
answer is `meta.baseline?.outcome === BaselineOutcome.RED`, both from `plugin/scripts/`. A
`read` that throws becomes `SliceBaselineNotRead`. A parse `error` becomes
`SliceBaselineNotUnderstood`.

**TDD:** `it('a baseline whose outcome is rojo is red')` asserts `true`. Its twin
`it('a baseline whose outcome is no-verificado is not red')` asserts `false`, the case next to
the boundary.

**Tests:** added: `it('a baseline whose outcome is rojo is red')`,
`it('a baseline whose outcome is no-verificado is not red')`,
`it('a slice with no state file is not red')`,
`it('a state file that cannot be read is told apart from one that cannot be understood')`.

**Verification:** the typecheck and the four tests of the new module pass.

```bash
cd backend && npx tsc -p tsconfig.json   # expected: exit 0 — the graph is sound
cd backend && npx vitest run __tests__/infrastructure/disk-slice-baselines.test.ts --maxWorkers=4   # expected: exit 0 — the four tests pass
```

### Task 2 — The activity of the current implementation call

**Objective:** `StreamImplementationActivities` answers the start, last tool and last text of the latest `implementation` call.

**Files:** `backend/src/domain/ports/implementation-activities.ts` (create), `backend/src/domain/value-objects/implementation-activity.ts` (create), `backend/src/infrastructure/stream-implementation-activities.ts` (create), `backend/src/infrastructure/stream-planning-activities.ts` (modify), `backend/src/domain/exceptions.ts` (modify), `backend/__tests__/infrastructure/stream-implementation-activities.test.ts` (create)

Contract (backend/src/domain/ports/implementation-activities.ts):

```ts
export abstract class ImplementationActivities {
  abstract of(watch: PlanWatch): Promise<ImplementationActivity | null>
}
```

Contract (backend/src/domain/value-objects/implementation-activity.ts):

```ts
export class ImplementationActivity {
  readonly startedAt: string
  readonly lastToolCall: PlanningToolCall | null
  readonly lastText: string | null
  constructor(asked: { startedAt: string, lastToolCall: PlanningToolCall | null, lastText: string | null })
}
```

Contract (backend/src/infrastructure/stream-implementation-activities.ts):

```ts
export class StreamImplementationActivities extends ImplementationActivities {
  readonly calls: AgentCalls<CallInvocation, CallDescriptor>
  readonly files: HeadlessFiles
  constructor(ports: { calls: AgentCalls<CallInvocation, CallDescriptor>, files: HeadlessFiles })
}
```

`exceptions.ts` adds `ImplementationActivityFailure extends PlanFailure` and
`ImplementationActivityNotRead extends ImplementationActivityFailure`.

The adapter reads `calls.history(watch.agent)` and keeps the records with purpose
`implementation`. It picks the one with the latest `Date.parse(startedAt)`, and answers `null`
when there is none. It reads `join(files.callDirectory(record.call), CallDescriptor.STREAM)`. A
`null` text gives null tool and text. Each line goes through `StreamLine.apply` on a
`StreamCursors.empty()` cursor. A `files.read` that throws becomes
`ImplementationActivityNotRead`.

Current state (backend/src/infrastructure/stream-planning-activities.ts, lines 19-19):

```ts
class StreamCursors {
```

Current state (backend/src/infrastructure/stream-planning-activities.ts, lines 63-63):

```ts
class StreamLine {
```

Both classes become `export class`; nothing else there changes.

**TDD:** `it('the current implementation call is the one started last among implementation calls')`.
Its history holds a `plan` call started after all of them and two `implementation` calls. The
array lists the later one first. The answer carries the later call's `startedAt` and its last
text.

**Tests:** added:
`it('the current implementation call is the one started last among implementation calls')`,
`it('a conversation with no implementation call has no implementation activity')`,
`it('the last tool and the last text come from the stream of the current call')`,
`it('a stream that cannot be read is an implementation activity not read')`.

**Verification:** the typecheck and both stream test modules pass.

```bash
cd backend && npx tsc -p tsconfig.json   # expected: exit 0 — the graph is sound
cd backend && npx vitest run __tests__/infrastructure/stream-implementation-activities.test.ts __tests__/infrastructure/stream-planning-activities.test.ts --maxWorkers=4   # expected: exit 0
```

### Task 3 — One line per issue of the milestone

**Objective:** `ReadMilestoneProgress` answers pending, running and delivered lines for the issues of a milestone.

**Files:** `backend/src/domain/value-objects/slice-line.ts` (create), `backend/src/domain/value-objects/milestone-progress.ts` (create), `backend/src/application/queries/read-milestone-progress.ts` (create), `backend/__tests__/milestone-progress-mother.ts` (create), `backend/__tests__/application/read-milestone-progress.test.ts` (create)

Contract (backend/src/domain/value-objects/slice-line.ts):

```ts
export const SliceLineState = Object.freeze({
  PENDING: 'pending', RUNNING: 'running', NEEDS_PERSON: 'needs-person', DELIVERED: 'delivered',
} as const)
export type SliceLineStateValue = (typeof SliceLineState)[keyof typeof SliceLineState]
export class SliceLine {
  static readonly PLAN_STEP = 'planning'
  readonly issue: EpicIssue
  readonly state: SliceLineStateValue
  readonly step: string | null
  readonly task: number | null
  readonly totalTasks: number | null
  readonly stepStartedAt: string | null
  readonly lastToolCall: PlanningToolCall | null
  readonly lastText: string | null
  readonly pullRequest: { readonly number: number, readonly url: string } | null
  readonly baselineRed: boolean
}
```

Contract (backend/src/domain/value-objects/milestone-progress.ts):

```ts
export class MilestoneProgress {
  readonly milestone: string
  readonly lines: readonly SliceLine[]
  delivered(): number
}
```

Each constructor takes one object with the same field names and freezes it.
`read-milestone-progress.ts` declares `ReadMilestoneProgressParams` with `root`, `repository`
and `story`, and `MilestoneProgressRead` with `progress: MilestoneProgress | null`. The
constructor of `ReadMilestoneProgress` takes, by name: `specs: EpicSpecs`,
`issues: EpicIssues`, `inventory: WorkInventory`,
`implementation: Pick<ReadImplementationProgress, 'execute'>`, `planning: PlanningActivities`,
`activities: ImplementationActivities`, `history: ImplementationHistory`,
`baselines: SliceBaselines`, `nowMs: () => number`.

A missing or draft spec answers `progress: null`. The milestone is `spec.title()`, and the
lines keep the order of the listing. `WorkNotFound` from `inventory.find` means no work.

Apply §2 for the line state, the step start and an unreadable activity. `task`, `totalTasks`
and `pullRequest` come from the `ImplementationState`. Only `running` and `needs-person` lines
ask `baselines.isRed`. Here an `uncertain` work gives `needs-person` with its `execution` step.

**TDD:** `it('an open issue with no recorded work is a pending line')` asserts `state`
`pending`, `step` null and `baselineRed` false.

**Tests:** added: `it('an open issue with no recorded work is a pending line')`,
`it('a closed issue is a delivered line with the pull request of its harvest')`,
`it('an implementing slice answers its step, task X of Y and its current call start')`,
`it('a history entry later than the current call starts the current step')`,
`it('a slice with a red baseline answers baseline red')`,
`it('an activity that cannot be read leaves the line without last tool and last text')`,
`it('a draft spec answers no milestone and reads no issue')`.

**Verification:** the typecheck and the query tests pass.

```bash
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run __tests__/application/read-milestone-progress.test.ts --maxWorkers=4   # expected: exit 0
```

### Task 4 — What needs the person, and the tasks of a line

**Objective:** a vetoed, an uncertain and a partial line answer their attention, and every implementing line answers its tasks.

**Files:** `backend/src/domain/value-objects/slice-task.ts` (create), `backend/src/domain/value-objects/slice-line.ts` (modify), `backend/src/application/queries/read-milestone-progress.ts` (modify), `backend/__tests__/milestone-progress-mother.ts` (modify), `backend/__tests__/application/read-milestone-progress.test.ts` (modify)

Contract (backend/src/domain/value-objects/slice-task.ts):

```ts
export const SliceTaskStatus = Object.freeze({
  PENDING: 'pending', RUNNING: 'running', DONE: 'done', STOPPED: 'stopped',
} as const)
export type SliceTaskStatusValue = (typeof SliceTaskStatus)[keyof typeof SliceTaskStatus]
export class SliceTask {
  readonly number: number
  readonly name: string | null
  readonly status: SliceTaskStatusValue
  readonly ruling: string | null
  readonly findings: string | null
  static listOf(asked: {
    state: ImplementationState | null, entries: readonly ImplementationHistoryEntry[], veto: RunClosure | null,
  }): readonly SliceTask[]
}
```

Contract (backend/src/domain/value-objects/slice-line.ts):

```ts
export type SliceAttention =
  | { readonly kind: 'veto', readonly task: number | null, readonly findings: string | null, readonly verdict: string | null }
  | { readonly kind: 'uncertain', readonly action: 'observe' | 'continue' | 'cleanup' | 'inspect', readonly detail: string }
  | { readonly kind: 'partial', readonly detail: string }
```

`SliceLine` adds `readonly attention: SliceAttention | null` and `readonly tasks: readonly SliceTask[]`.

`listOf` answers one task for each number from 1 to `state.totalTasks`, and none when that is
null. Task `n` is `stopped` when `veto.task` is `n`. Else it is `running` when `n` is
`state.task`. It is `done` below `state.task`, or when `state.task` is null past `starting`.
Any other task is `pending`.

The name is the latest `taskName` in the entries of task `n`, else
`state.name` for the current task. The ruling is the latest non-null `ruling` of task `n`. Only
a stopped task carries `findings`, from `veto.findings`.

The query sets `veto` when `refusal.state` is `DriveRun.BLOCKED_JUDGE`. It catches a
`PlanFailure` from `implementation.execute` as a `partial` attention with no state. A
`delivery.kind` of `unavailable` gives `partial` with its `detail`.

**TDD:** `it('the tasks below the current one are done, the current one runs and the rest wait')`
has task 2 of 3 current. It asserts `done`, `running`, `pending`, the two sides of the boundary.

**Tests:** added:
`it('the tasks below the current one are done, the current one runs and the rest wait')`,
`it('a vetoed slice needs the person and its stopped task carries the judge findings')`,
`it('an uncertain slice needs the person with its one recovery action')`,
`it('an implementation read that fails leaves a running line with a partial attention')`,
`it('pending and delivered lines carry no attention and no tasks')`.

**Verification:** the typecheck and the query tests pass.

```bash
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run __tests__/application/read-milestone-progress.test.ts --maxWorkers=4   # expected: exit 0
```

### Task 5 — The route GET /milestone-progress

**Objective:** `GET /milestone-progress` answers the held session's milestone progress in snake case.

**Files:** `backend/src/infrastructure/milestone-progress-route.ts` (create), `backend/src/infrastructure/api-server.ts` (modify), `backend/src/infrastructure/ct-api.ts` (modify), `backend/__tests__/infrastructure/milestone-progress-route.test.ts` (create), `backend/__tests__/infrastructure/refusal-codes.test.ts` (modify)

Contract (backend/src/infrastructure/milestone-progress-route.ts):

```ts
export const MilestoneProgressOutcome = Object.freeze({ NOT_READ: 'milestone-progress-not-read' } as const)
export class MilestoneProgressRoute {
  static readonly PATH = '/milestone-progress'
  static readonly METHODS = 'GET'
  static reading(held: CoordinatingSessions, read: Pick<ReadMilestoneProgress, 'execute'>): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

`reading` follows `EpicGroomRoute.reading`: no held checkout, or one replaced during the read,
answers `200 { status: 'none' }`. A null `progress` answers `{ status: 'no-milestone', target }`.
Else it answers `{ status: 'milestone', target, milestone, delivered, total, issues }`.

Each issue is `{ number, url, title, state, step, task, total_tasks, step_started_at,
last_tool, last_text, pull_request, attention, baseline_red, tasks }`. `last_tool` is
`{ name, argument }` or null, and `attention` keeps its `kind` and fields. Each task is
`{ number, name, status, ruling, findings }`. A `PlanFailure` answers `400` with code
`milestone-progress-not-read` and its message.

`ApiServer` takes `readMilestoneProgress?: Pick<ReadMilestoneProgress, 'execute'> | null` and
mounts it next to `EpicGroomRoute`. `refusal-codes.test.ts` adds
`...Object.values(MilestoneProgressOutcome)` to `RequestVocabularies.codes()`.

Call site (backend/src/infrastructure/api-server.ts):

```ts
app.get(MilestoneProgressRoute.PATH, Browsers.turnAwayForeign,
  MilestoneProgressRoute.reading(this.coordinatingSessions!, this.readMilestoneProgress!))
app.all(MilestoneProgressRoute.PATH, MilestoneProgressRoute.refuseOtherMethods)
```

Current state (backend/src/infrastructure/ct-api.ts, lines 741-742):

```ts
      workProgress: new ReadWorkProgress({
        inventory: new InspectedWorkInventory({ inspection: recovery, plans: activePlans, records, delivery: runDelivery }),
```

That `InspectedWorkInventory` becomes `const workInventory` above `const server`, for both
reads. `ReadMilestoneProgress` also gets `epicSpecs`, `epicIssues`, `implementProgress`,
`planningActivities`, `metricsFileHistory`, `new StreamImplementationActivities({ calls, files })`,
`new DiskSliceBaselines({ read: Disk.read })` and `Date.now`.

**TDD:** `it('a held session with a milestone answers one line per issue in snake case')`
asserts the literal body for one pending and one vetoed line.

**Tests:** added:
`it('a held session with a milestone answers one line per issue in snake case')`,
`it('no held session answers none and the read gets no call')`,
`it('a read that fails answers milestone-progress-not-read')`,
`it('a method other than GET is refused')`.

**Verification:** the typecheck and both test modules pass.

```bash
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run __tests__/infrastructure/milestone-progress-route.test.ts __tests__/infrastructure/refusal-codes.test.ts --maxWorkers=4   # expected: exit 0
```

### Task 6 — Reopen resumes by identifier, or opens the conversation of the story's step

**Objective:** `ReopenCoordinatingSession` resumes a resumable conversation and else opens a new one with the brainstorming or groom prompt.

**Files:** `backend/src/domain/policies/story-step.ts` (create), `backend/src/application/actions/reopen-coordinating-session.ts` (create), `backend/__tests__/application/reopen-coordinating-session.test.ts` (create)

Contract (backend/src/domain/policies/story-step.ts):

```ts
export const StoryStep = Object.freeze({
  BRAINSTORMING: 'brainstorming', GROOM: 'groom', IMPLEMENTATION: 'implementation',
} as const)
export type StoryStepValue = (typeof StoryStep)[keyof typeof StoryStep]
export class StoryStepPolicy {
  static of(asked: { spec: EpicSpec | null, listing: EpicIssuesListing | null }): StoryStepValue
}
```

Contract (backend/src/application/actions/reopen-coordinating-session.ts):

```ts
export const Reopening = Object.freeze({ RESUMED: 'resumed', OPENED: 'opened' } as const)
export type ReopeningValue = (typeof Reopening)[keyof typeof Reopening]
export class ReopenCoordinatingSessionParams { readonly conversation: CoordinatingConversation }
export class CoordinatingSessionReopened {
  readonly outcome: ReopeningValue
  readonly step: StoryStepValue | null
  readonly conversation: CoordinatingConversation
  readonly session: LiveSession
  readonly timeline: readonly SessionTimelineEvent[]
}
```

`ReopenCoordinatingSession` takes, by name: `conversations: Conversations`,
`sessionHooks: SessionHooks`, `records: ConversationRecords`, `specs: EpicSpecs`,
`issues: EpicIssues`, `userStories: UserStories`, `newId: () => string`, `now: () => string`.

When `conversations.isResumable(conversation)` holds, the action installs the hooks on the root
and calls `conversations.resume(conversation)`. It appends a `TimelineEventKind.RESUMED` event,
the way `RecoverCoordinatingSession` does. It answers `RESUMED`, `step: null`, and the recalled
timeline with that event.

Else it reads the spec, and lists the milestone `spec.title()` only for a frozen spec.
`StoryStepPolicy.of` picks the step. It mints a new `CoordinatingConversation` with the same
repository, root and story, and prepares the prompt of the step. It installs the hooks, starts
the conversation, and answers `OPENED` with the step.

The policy: a null or draft spec gives `BRAINSTORMING`. An exhausted, non-empty listing with no
`isPromotable()` issue gives `IMPLEMENTATION`. Anything else gives `GROOM`. The brainstorming step uses
`PhasePrompt.brainstorming` with `userStories.detail(story)`, and groom uses `PhasePrompt.groom`.

**TDD:** `it('a conversation whose transcript exists resumes by its identifier')` asserts that
`resume` got the same conversation id, and that `mint` and `start` got no call.

**Tests:** added:
`it('a conversation whose transcript exists resumes by its identifier')`,
`it('a draft spec reopens as a new conversation with the brainstorming prompt')`,
`it('a frozen spec whose milestone holds a backlog issue reopens with the groom prompt')`,
`it('a frozen spec with no issue yet reopens with the groom prompt')`.

**Verification:** the typecheck and the action tests pass.

```bash
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run __tests__/application/reopen-coordinating-session.test.ts --maxWorkers=4   # expected: exit 0
```

### Task 7 — The implementation prompt for step 4

**Objective:** a reopen of an authorised milestone opens a new conversation with the implementation prompt.

**Files:** `backend/src/domain/value-objects/phase-prompt.ts` (modify), `backend/src/application/actions/reopen-coordinating-session.ts` (modify), `backend/__tests__/application/reopen-coordinating-session.test.ts` (modify)

Contract (backend/src/domain/value-objects/phase-prompt.ts):

```ts
static readonly SLICES_ARE_NOT_YOURS =
  'The slices of this milestone run by themselves: you start none, you implement none and you merge none. '
  + 'When the person asks how a slice goes, read GET /active-plans and tell them what it answers.'
static implementation({ milestone, repository, root }: {
  milestone: string, repository: RepositoryName, root: CheckoutRoot,
}): PhasePrompt
```

`implementation` joins with `'\n'`, in this order: `#roleOf({ repository, root })`, then
`` `Follow the implementation of the milestone "${milestone}" with the person.` ``, then
`SLICES_ARE_NOT_YOURS`, `CHANGE_TO_A_SLICE`, `ANOTHER_ROUND_AFTER_A_VETO` and
`RECOVERY_CAPABILITIES`. The action uses it for `StoryStep.IMPLEMENTATION`, with
`milestone: spec.title()!`.

**TDD:** `it('a milestone with every issue authorised reopens with the implementation prompt')`
holds one issue at `status:ready`. It asserts that `records.prepare` got the text of
`PhasePrompt.implementation`. The Task 6 backlog case is the other side of the boundary.

**Tests:** added:
`it('a milestone with every issue authorised reopens with the implementation prompt')`,
`it('the implementation prompt names the milestone and keeps the slices out of the session hands')`.

**Verification:** the typecheck and the action tests pass.

```bash
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run __tests__/application/reopen-coordinating-session.test.ts --maxWorkers=4   # expected: exit 0
```

### Task 8 — The route POST /coordinating-session/reopen

**Objective:** `POST /coordinating-session/reopen` reopens an ended held session and remembers it live under a new target.

**Files:** `backend/src/infrastructure/coordinating-session-reopen-route.ts` (create), `backend/src/infrastructure/api-server.ts` (modify), `backend/src/infrastructure/ct-api.ts` (modify), `backend/__tests__/infrastructure/coordinating-session-reopen-route.test.ts` (create), `backend/__tests__/infrastructure/refusal-codes.test.ts` (modify)

Contract (backend/src/infrastructure/coordinating-session-reopen-route.ts):

```ts
export const CoordinatingSessionReopenOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  NOT_ENDED: 'coordinating-session-not-ended',
  REOPENING: 'coordinating-session-reopening',
} as const)
export class CoordinatingSessionReopenRoute {
  static readonly PATH = '/coordinating-session/reopen'
  static readonly METHODS = 'POST'
  static reopening(held: CoordinatingSessions, reopen: Pick<ReopenCoordinatingSession, 'execute'>): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

The handler follows `GroomSessionRoute.opening` without the gate key.
`CoordinatingSessionTarget.admitted` reads the `x-coordinating-target` header. A `live` holding
answers `409 coordinating-session-not-ended`. A `held.reserve()` other than `RESERVED` answers
`409 coordinating-session-reopening`. A throw calls `held.release()`, and a `PlanFailure`
answers `PlanCollapse.of(cause)`.

On success, `held.remember` takes a `HeldCoordinatingSession` with `held.mintTarget()`, state
`live`, the answered conversation and session, and `SessionAttention.working()`, with the
answered timeline. The route answers `202` with `status` (the outcome), `step`, `target`,
`conversation`, `repo`, `story`, `root` and `session: { id, name }`.

`ApiServer` takes `reopenCoordinatingSession?: Pick<ReopenCoordinatingSession, 'execute'> | null`
and mounts the route next to `CoordinatingSessionCloseRoute`, with `Browsers.turnAwayForeign`.
`ct-api.ts` builds it from `claudeConversations`, `sessionHooks`, `conversationRecords`,
`epicSpecs`, `epicIssues`, `userStories`, `randomUUID` and `() => new Date().toISOString()`.
`refusal-codes.test.ts` adds `...Object.values(CoordinatingSessionReopenOutcome)`.

**TDD:** `it('an ended session reopens and the page gets the new target and the session')`
asserts `202`, the literal body, and a held session that is `live` under the new target.

**Tests:** added:
`it('an ended session reopens and the page gets the new target and the session')`,
`it('a live session is refused as not ended and the reopen gets no call')`,
`it('a stale target is refused and the reopen gets no call')`,
`it('a reopen that fails frees the next press')`,
`it('a method other than POST is refused')`.

**Verification:** the typecheck and both test modules pass.

```bash
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run __tests__/infrastructure/coordinating-session-reopen-route.test.ts __tests__/infrastructure/refusal-codes.test.ts --maxWorkers=4   # expected: exit 0
```

### Task 9 — Domain and application know neither GitHub nor the disk

**Objective:** a test fails when a module of `backend/src/domain` or `backend/src/application` imports `node:`, the infrastructure or GitHub.

**Files:** `backend/__tests__/domain/layer-imports.test.ts` (create)

No code — the task adds one test module and changes no production module.

The census walks every `.ts` file under the two directories and reads each `from '…'`
specifier. A forbidden specifier starts with `node:`, holds `/infrastructure/`, or names a
module whose file name starts with `gh`. The census must also prove that it reads imports.

**TDD:** `it('no module of the domain or the application imports node, the infrastructure or GitHub')`
asserts an empty list of offences. Its twin feeds the matcher `'node:fs'` and
`'../../infrastructure/gh-epic-issues.ts'`, and asserts that both offend.

**Tests:** added:
`it('no module of the domain or the application imports node, the infrastructure or GitHub')`,
`it('the matcher tells a disk import and a GitHub import apart from a port import')`,
`it('the census reads the imports of read-milestone-progress.ts')`.

**Verification:** the new test module passes.

```bash
cd backend && npx vitest run __tests__/domain/layer-imports.test.ts --maxWorkers=4   # expected: exit 0
```

### Task 10 — backend/API.md documents both routes

**Objective:** `backend/API.md` documents `GET /milestone-progress` and `POST /coordinating-session/reopen`.

**Files:** `backend/API.md` (modify)

Current state (backend/API.md, lines 1150-1150):

```md
## `POST /groom-session`
```

Current state (backend/API.md, lines 1944-1944):

```md
## `POST /slices/:issue/message`
```

The reopen section goes right before the groom section, and the progress section right before
the message section. Each new section ends with a blank line and the `---` line that the file
puts between sections.

Final text (backend/API.md):

```md
## `POST /coordinating-session/reopen`

Reopens the held coordinating session after it ended by itself. The request carries no body and
the `x-coordinating-target` header of the held session. When the conversation's transcript
exists, it resumes that conversation with `claude --resume <id>`. Otherwise it opens a new one
with the prompt of the story's step: `brainstorming` for a draft spec, `groom` for a frozen spec
that gate 2 did not authorise, `implementation` for an authorised milestone. It answers `202`
with `status` (`resumed` or `opened`), `step`, `target`, `conversation`, `repo`, `story`, `root`
and `session`. A live session answers `409 coordinating-session-not-ended`, and a reopen already
under way answers `409 coordinating-session-reopening`.
```

Final text (backend/API.md):

```md
## `GET /milestone-progress`

One read of the held coordinating session's milestone, from the spec and issues `GET /epic-groom`
reads. No held session answers `{"status":"none"}`, and no frozen spec answers `no-milestone`.
Else it answers `status` `milestone`, `target`, `milestone`, `delivered`, `total` and `issues`.
Each issue carries `number`, `url`, `title`, `state` (`pending`, `running`, `needs-person`,
`delivered`), `step`, `task`, `total_tasks`, `step_started_at`, `last_tool`, `last_text`,
`pull_request`, `attention` (`veto`, `uncertain`, `partial` or null), `baseline_red` and
`tasks`. Each task carries `number`, `name`, `status`, `ruling` and `findings`. A read that
fails answers `400 milestone-progress-not-read`.
```

**TDD:** No TDD — documentation only; the route tests of Tasks 5 and 8 pin each claim.

**Tests:** N/A — no test changes.

**Verification:** each heading appears once in the file.

```bash
test "$(grep -c '^## `GET /milestone-progress`$' backend/API.md)" -eq 1   # expected: exit 0 — the progress section exists once
test "$(grep -c '^## `POST /coordinating-session/reopen`$' backend/API.md)" -eq 1   # expected: exit 0 — the reopen section exists once
```

## 8. Global verification

The whole backend suite and the typecheck pass once the last task lands.

```bash
cd backend && npx tsc -p tsconfig.json   # expected: exit 0
cd backend && npx vitest run --maxWorkers=4   # expected: exit 0
```

## 9. Assumptions

1. The milestone read does not call `ReadEpicGroom`: on an authorised milestone that query runs
   `ct-groom` at every poll. It reads the same two ports instead. Provenance: own call, on the
   issue's "same source as `/epic-groom`".
2. A `partial` read keeps the line `running`: the person has nothing to press for it. The
   attention still says it. Provenance: own call; the issue lists partial delivery under
   attention, not under state.
3. The per-task status comes from the order of the tasks, and a task name from the history. The
   judge's findings text exists only in the closure of a vetoed run. So only a stopped task
   carries `findings`, and a finished task carries the `ruling` of its last judge entry.
   Provenance: the facts section of #582.
4. The plan step starts at `nowMs() - runningMs`, because `PlanningActivity` carries no start.
   Provenance: own call.
5. Reopen does not ask for the gate key: it is no gate, and the target header already binds it
   to the held session. Provenance: own call, on `POST /coordinating-session/close`.
6. The two routes get no row in the table of frontend clients in `backend/API.md`. No frontend
   client exists yet, and `frontend/` is out of scope. The next slice adds the
   rows. Provenance: issue "Out of scope / Protected".
7. `backend/` has no `node_modules` in this worktree, so the commands of §7 and §8 ran nowhere
   before this plan. Each one is the command of the issue's milestone context. Provenance:
   milestone context.
