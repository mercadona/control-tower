# #592 — Focused implementation view

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

`frontend/src/pages/home/Home.tsx` has two branches. `FocusedMode.of`
(`frontend/src/pages/home/FocusedMode.ts`) gives the focused branch only while the coordinating
session is live and no plan of its story runs. Else `Home` draws the classic view: flow nav,
slice cards, gate sequence, drawer, column resizer, task history, and plan adoption and restore
with `WorkflowSnapshotStorage`. In step 4 the focused branch shows the terminal in the centre
(`CentredSession`), not the slices.

Slice #1 (#604) gave the backend two routes. `GET /milestone-progress` answers one line per
issue of the held session's milestone. `POST /coordinating-session/reopen` reopens a session
that ended by itself. The frontend calls neither yet.

The issue asks for one page. With a session held (live, ended or unresumable), the page is the
focused view through the four steps. Step 4 shows the milestone in flight as a compact list.
With no session held, the page is only the start form. The classic view goes, with every
module, style, mirror, fixture and README section that only it used.

### Desired end state

- Page tests pin the boards I1 to I6. With no session held, the page shows only the start form.
- A running line shows its step, `Tarea X de Y` and a time in step that ticks each second.
- A running line expands into its tasks, the judge's finding, the last tool and the last message.
- A line that needs the person says what happened and carries exactly one action.
- The notice `El repositorio ya estaba en rojo antes de empezar.` shows only when some baseline was red.
- `Hablar con la sesión` opens the terminal in a panel over the list.
- An ended session shows `Reabrir la sesión` in every step, with the copy of D-8a for its step.
- With every issue delivered, the page shows `Milestone completado` and `Cerrar la sesión y volver al inicio`.
- No module, style, mirror, fixture or README section stays that only removed code used.

### Out of scope

- 🚫 `backend/`: this slice does not touch it, `backend/API.md` included.
- 🚫 `frontend/src/app/work-progress/contract.ts` stays, because
  `backend/__tests__/infrastructure/work-progress-contract.test.ts` imports it. The type files it
  imports stay with it.
- 🚫 `Cancelar la sesión` keeps its current behaviour.
- 🚫 Steps 1 to 3 change only by the ended-session notice.
- The routes the page stops to call stay in the backend until slice #3 removes them.

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
| D-12 · One backend read | `GET /milestone-progress reads the held coordinating session's milestone (same source as /epic-groom) through query ReadMilestoneProgress returning value object MilestoneProgress of SliceLines.` |
| D-13 · Reopen action | `POST /coordinating-session/reopen resumes with claude --resume <id> when the transcript exists, and otherwise opens a new conversation with the prompt of the story's step.` |
| `D-14 · The classic view is deleted, not reshaped` | `the drawer, flow nav, slice cards, gate sequence, plan adoption and restore, column resizer, today's task history and the mirrors only they used go, per the inventory of #583.` |
| D-17 · No feature flag | `the change is implemented directly.` |
| Poll of the milestone | `MilestonePolling.INTERVAL_MS = 3000`; `MilestonePolling.REVIEW_INTERVAL_MS = 15000` while any issue has step `delivered`, `in-review` or `fixing`. The poll waits for the previous answer. |
| When the page reads the milestone | only while the focused view is at step `implementation`. |
| Held session | `live`, `ended` and `unresumable` all hold the page in the focused view. `ended` and `unresumable` both show the reopen notice. |
| Step label of a line | `STEP_LABELS[step]` from `app/implement-progress/ImplementProgress.types.ts`; step `planning` reads `Preparando el plan`; an unknown step reads its raw value. |
| Time in step | `mm:ss` from `step_started_at` to now, minutes not capped at 59; no time when `step_started_at` is null. |
| One action per line that needs the person | attention `veto`, `partial` and `unreadable` → `Hablar con la sesión`; `uncertain` → one recovery button, whose label follows its action. |
| Recovery of an uncertain line | `SliceRecovery.run` finds the agent in `GET /active-plans`, then recovers; see Task 6. |
| No terminal | while the session is not live, every `Hablar con la sesión` button shows disabled. |
| Test doubles | fetch doubles answer by path, never by call order. |

## 3. Reference patterns

Files to imitate:

- `frontend/src/app/epic-groom/client.ts` — a client that checks the wire shape and maps snake_case to camelCase.
- `frontend/src/app/work-progress/useWorkProgress.ts` — a poll that waits for its answer and slows down in review.
- `frontend/src/app/focused-session/components/gate-band/GateBand.tsx` — a component of the focused view.
- `frontend/src/app/slice-session/components/slice-session/SliceSession.tsx` — the veto and recovery copy to port.
- `frontend/src/pages/home/__tests__/Home.focusedSession.test.tsx` — a page test with a fetch double by path.
- `frontend/src/__scenarios__/EpicGroomMother.ts` — a shared Object Mother.

Rules to obey:

- `.agent/conventions.md`
- `CLAUDE.md`
- `docs/language.md`

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `frontend/src/app/milestone-progress/MilestoneProgress.types.ts` | create | client, hook, components | Contract |
| `frontend/src/app/milestone-progress/client.ts` | create | `useMilestoneProgress` | Contract |
| `frontend/src/app/milestone-progress/client.test.ts` | create | vitest | none (body by TDD) |
| `frontend/src/__scenarios__/MilestoneProgressMother.ts` | create | client and page tests | Contract |
| `frontend/src/app/coordinating-session/client.ts` | modify | `useCoordinatingSession` | Contract |
| `frontend/src/app/coordinating-session/useCoordinatingSession.ts` | modify | `Home`, `FocusedSession` | Current state |
| `frontend/src/app/coordinating-session/client.test.ts` | modify | vitest | none (body by TDD) |
| `frontend/src/app/coordinating-session/useCoordinatingSession.test.ts` | modify | vitest | none (body by TDD) |
| `frontend/src/app/product-error.ts` | modify | the reopen notice | prose |
| `frontend/src/pages/home/Home.tsx` | modify | `main.tsx` | Call site |
| `frontend/src/pages/home/FocusedMode.ts` | modify | `Home` | Current state, Contract |
| `frontend/src/pages/home/Home.css` | modify | `Home` | prose |
| `frontend/src/pages/home/__tests__/*` | modify / delete | vitest | prose |
| `frontend/src/app/focused-session/components/focused-session/FocusedSession.tsx` | modify | `Home` | Current state |
| `frontend/src/app/milestone-progress/MilestonePolling.ts` | create | `useMilestoneProgress` | Contract |
| `frontend/src/app/milestone-progress/useMilestoneProgress.ts` | create | `Home` | Contract |
| `frontend/src/app/milestone-progress/ElapsedTime.ts` | create | line components | Contract |
| `frontend/src/app/milestone-progress/useSecondTick.ts` | create | line components | Contract |
| `frontend/src/app/milestone-progress/components/milestone-board/*` | create | `FocusedSession` | Contract |
| `frontend/src/app/milestone-progress/components/slice-line-row/*` | create | `MilestoneBoard` | Contract |
| `frontend/src/app/milestone-progress/SliceRecovery.ts` | create | `SliceLineRow` | Contract |
| `frontend/src/app/focused-session/components/session-panel/*` | create | `FocusedSession` | Contract |
| `frontend/src/app/focused-session/components/session-ended-notice/*` | create | `FocusedSession` | Contract |
| `frontend/src/app/focused-session/components/focused-session-header/FocusedSessionHeader.tsx` | modify | `FocusedSession` | Current state |
| `frontend/vite.config.ts` | modify | the dev server | Current state |
| dead modules, mirrors, mothers | delete | nobody | prose |
| `frontend/README.md`, `README.md` | modify | people | Final text |

## 5. Interfaces

Consumes, from slice #1 (`merge-after #1`):

- `GET /milestone-progress` → `{status:'none'}`, `{status:'no-milestone', target}` or `{status:'milestone', target, milestone, delivered, total, issues}`.
- each issue: `number`, `url`, `title`, `state`, `step`, `task`, `total_tasks`, `step_started_at`, `last_tool` (`{name, argument}` or null), `last_text`, `pull_request` (`{number, url}` or null), `attention`, `baseline_red`, `tasks`.
- `attention`: `{kind:'veto', task, findings, verdict}`, `{kind:'uncertain', action, detail}`, `{kind:'partial', detail}`, `{kind:'unreadable', detail}` or null.
- each task: `number`, `name`, `status` (`pending`, `running`, `done`, `stopped`), `ruling`, `findings`.
- `POST /coordinating-session/reopen`, no body, header `x-coordinating-target` → `202` with `status`, `step`, `target`, `conversation`, `repo`, `story`, `root`, `session`. Refusals: `400 coordinating-session-busy`, `409 coordinating-session-not-ended`, `409 coordinating-session-close-failed`.

Produces: N/A — the page is the last consumer. Slice #3 removes backend routes that this slice leaves without a reader.

## 6. Test strategy

Page tests in `frontend/src/pages/home/__tests__/Home.implementation.test.tsx` pin the boards. They
render `Home` and double `fetch` by path, the way `Home.focusedSession.test.tsx` does. The answers
come from `MilestoneProgressMother`, `CoordinatingSessionMother`, `SpecFreezeMother` and
`EpicGroomMother`. A ticking time uses `vi.useFakeTimers({ shouldAdvanceTime: true })` and
`vi.setSystemTime`. The client gets its own test at the wire boundary. The hook gets its reopen
case in `useCoordinatingSession.test.ts`.

Tests of deleted modules go with them. A test of a module that stays keeps passing. Run from
`frontend/`: `npx vitest run --maxWorkers=4` and `npm run build`. There is no linter: never run
`npx eslint`.

## 7. Tasks

### Task 1 — The milestone progress client

**Objective:** `MilestoneProgressClient.read()` turns the answer of `GET /milestone-progress` into a checked camelCase value.

**Files:** `frontend/src/app/milestone-progress/MilestoneProgress.types.ts` (create), `frontend/src/app/milestone-progress/client.ts` (create), `frontend/src/app/milestone-progress/client.test.ts` (create), `frontend/src/__scenarios__/MilestoneProgressMother.ts` (create)

Contract (frontend/src/app/milestone-progress/MilestoneProgress.types.ts):

```ts
export type SliceLineState = 'pending' | 'running' | 'needs-person' | 'delivered'
export type SliceTaskStatus = 'pending' | 'running' | 'done' | 'stopped'
export type SliceAttention =
  | { kind: 'veto'; task: number | null; findings: string | null; verdict: string | null }
  | { kind: 'uncertain'; action: RecoveryAction; detail: string }
  | { kind: 'partial'; detail: string } | { kind: 'unreadable'; detail: string }
export type SliceTask = { number: number; name: string | null; status: SliceTaskStatus; ruling: string | null; findings: string | null }
export type SliceLine = {
  number: number; url: string; title: string; state: SliceLineState; step: string | null
  task: number | null; totalTasks: number | null; stepStartedAt: string | null
  lastTool: { name: string; argument: string | null } | null; lastText: string | null
  pullRequest: { number: number; url: string } | null; attention: SliceAttention | null
  baselineRed: boolean; tasks: SliceTask[]
}
export type MilestoneProgressOutcome =
  | { kind: 'none' } | { kind: 'no-milestone'; target: string }
  | { kind: 'milestone'; target: string; milestone: string; delivered: number; total: number; issues: SliceLine[] }
  | { kind: 'unavailable' }
```

Contract (frontend/src/app/milestone-progress/client.ts):

```ts
export class MilestoneProgressClient {
  static readonly PATH = '/milestone-progress'
  static read(): Promise<MilestoneProgressOutcome>
}
```

`RecoveryAction` comes from `app/active-plans/ActivePlan.types`. A network failure, a non-2xx
answer or a shape that does not check gives `{kind:'unavailable'}`. `MilestoneProgressMother`
exports `answer(issues, milestone?)`, `none()`, and the issue factories `pending(n)`,
`running(n, overrides?)`, `delivered(n)`, `vetoed(n)`, `uncertain(n, action)`, `partial(n)`,
`unreadable(n)`. Each gives a `{status, body}` pair or a wire issue in snake_case.

**TDD:** `it('reads a milestone with a running issue into camelCase')` asserts `totalTasks`,
`stepStartedAt`, `lastTool` and `baselineRed` of the issue. Its twin
`it('an issue with an unknown state makes the read unavailable')` asserts `{kind:'unavailable'}`.

**Tests:** added: `it('reads a milestone with a running issue into camelCase')`,
`it('an issue with an unknown state makes the read unavailable')`,
`it('reads none and no-milestone')`, `it('a refused read is unavailable')`,
`it('a network failure is unavailable')`.

**Verification:** the new client tests and the build pass.

```bash
cd frontend && npx vitest run src/app/milestone-progress/client.test.ts --maxWorkers=4   # expected: exit 0 — the client tests pass
cd frontend && npm run build   # expected: exit 0 — the types compile
```

### Task 2 — The hook reopens an ended session

**Objective:** `useCoordinatingSession().reopen()` posts the held target to `/coordinating-session/reopen` and adopts the reopened session.

**Files:** `frontend/src/app/coordinating-session/client.ts` (modify), `frontend/src/app/coordinating-session/useCoordinatingSession.ts` (modify), `frontend/src/app/coordinating-session/client.test.ts` (modify), `frontend/src/app/coordinating-session/useCoordinatingSession.test.ts` (modify), `frontend/src/app/product-error.ts` (modify)

Current state (frontend/src/app/coordinating-session/useCoordinatingSession.ts, lines 50-52):

```ts
  open: (submission: StartPlanSubmission) => Promise<OpenOutcome>
  openGroom: (key: string, target: string) => Promise<GroomSessionOutcome>
  close: () => Promise<CloseOutcome | null>
```

Contract (frontend/src/app/coordinating-session/client.ts):

```ts
const reopen = async (target: string): Promise<OpenOutcome>
```

`reopen` sends `POST /coordinating-session/reopen` with the header `x-coordinating-target` and no
body. A `202` goes through `openedIn` into `{kind:'opened'}`. A `{code, detail}` refusal gives
`{kind:'refused', code, error: productError(code, detail)}`. The export object adds `reopen`.

`CoordinatingLifecycle` adds `reopen: () => Promise<OpenOutcome>`. The hook runs it through
`runOpening` with the target of `heldRef.current`. With no held session it answers the
`BLOCKED_OPENING` refusal. `product-error.ts` adds two entries:
`'coordinating-session-not-ended': 'La sesión coordinadora sigue viva: no hace falta reabrirla.'` and
`'coordinating-session-close-failed': 'El cierre de la sesión coordinadora falló. Termina de cerrarla antes de reabrirla.'`.

**TDD:** `it('reopen posts the held target and adopts the session it answers')` asserts the
request header and `opened.session`. Its twin
`it('reopen with no held session sends nothing')` asserts no call to the reopen path.

**Tests:** added: `it('reopen posts the held target and adopts the session it answers')`,
`it('reopen with no held session sends nothing')`,
`it('reopen reads a refusal as product copy')` in `client.test.ts`.

**Verification:** the two test files and the build pass.

```bash
cd frontend && npx vitest run src/app/coordinating-session --maxWorkers=4   # expected: exit 0 — client and hook tests pass
cd frontend && npm run build   # expected: exit 0 — the new member compiles
```

### Task 3 — The page is the start form or the focused view

**Objective:** `Home` renders the focused view for every held session and only the start form otherwise, with the classic branch gone.

**Files:** `frontend/src/pages/home/Home.tsx` (modify), `frontend/src/pages/home/FocusedMode.ts` (modify), `frontend/src/pages/home/Home.css` (modify), `frontend/src/app/focused-session/components/focused-session/FocusedSession.tsx` (modify), `frontend/src/pages/home/__tests__/helpers.tsx` (modify), the `Home.*` tests named below (delete or modify)

Current state (frontend/src/pages/home/FocusedMode.ts, lines 9-11):

```ts
type FocusedModeOf =
  | { kind: 'focused'; live: LiveRead; terminal: LiveSession }
  | { kind: 'today' }
```

Contract (frontend/src/pages/home/FocusedMode.ts):

```ts
type HeldRead = Extract<CoordinatingSessionRead, { kind: 'live' | 'ended' | 'unresumable' }>
type FocusedModeOf = { kind: 'focused'; held: HeldRead; terminal: LiveSession | null } | { kind: 'start' }
export class FocusedMode {
  static of({ read, opened }: { read: CoordinatingSessionRead; opened: OpenedCoordinatingSession | null }): FocusedModeOf
}
```

`terminal` is `opened.session` for a live read, else null. `FocusedMode.claims` goes.
`FocusedSession` takes `terminal: LiveSession | null` and draws `CentredSession` only when it is
not null. Its `dispatched` prop goes, and `GateBand` gets `0`.

Call site (frontend/src/pages/home/Home.tsx):

```tsx
if (focusedMode.kind === 'focused') return <FocusedSession held={focusedMode.held} terminal={focusedMode.terminal} … />
return (<div className="home"><Navigation navbar={<ToolsNavbar />} topBar={<TopBar productName="Control Tower" />}>
  <main className="home__start">{brainstormingRecovery}<StartPlanForm … /></main></Navigation></div>)
```

`Home` keeps `useCoordinatingSession`, `useSpecFreeze(target)` and
`useEpicGroom(isSessionLive, target, isSessionLive)`. Everything else in `Home` goes: the
workflow and active-plan state, the reconciliation, `recovery`, breadcrumbs, `GateSequence`,
drawer and resizer. `Home.css` keeps `.home` and adds `.home__start`.

Delete `Home.{restoreWorkflow,slicesInFlight,sliceSession,implementPlan,implementProgress,implementHistory,workProgress,restartRecovery,baseline,layout,columnWidth,sessionsCollapse,gateSequence,navigation,sessions}.test.tsx`.
Trim the cases of the classic view out of `Home.startPlan`, `Home.focusedSession`,
`Home.epicGroom`, `Home.specFreeze` and `Home.coordinatingSession`. `Home.shell.test.ts` keeps
its first three cases. `helpers.tsx` loses `openRestored`, `backendRecovering`,
`selectSliceDetail`, `activePlanFor`, `backendUnreachable` and `editable`.

**TDD:** `it('with no session held the page shows only the start form')` asserts the `Ticket`
field and no `Pasos de la sesión` navigation. Its twin
`it('an ended session keeps the page in the focused view')` asserts the step heading.

**Tests:** added in `Home.implementation.test.tsx`: the two above. Removed on purpose: the
fifteen files above and the trimmed cases, which pin the classic view.

**Verification:** the page tests and the build pass.

```bash
cd frontend && npx vitest run src/pages/home --maxWorkers=4   # expected: exit 0 — page tests pass
cd frontend && npm run build   # expected: exit 0 — the page compiles
test ! -e frontend/src/pages/home/__tests__/Home.slicesInFlight.test.tsx   # expected: exit 0 — the classic tests are gone
```

### Task 4 — Step 4 shows the milestone as a compact list

**Objective:** at step 4 the centre lists every issue, and a running line shows step, task and a ticking time.

**Files:** `frontend/src/app/milestone-progress/` (create `MilestonePolling.ts`, `useMilestoneProgress.ts`, `ElapsedTime.ts`, `useSecondTick.ts`). `frontend/src/app/milestone-progress/components/milestone-board/` (create `MilestoneBoard.tsx`, `MilestoneBoard.css`, `index.ts`). `frontend/src/app/milestone-progress/components/slice-line-row/` (create `SliceLineRow.tsx`, `SliceLineRow.css`, `index.ts`). `frontend/src/app/focused-session/components/focused-session/FocusedSession.tsx` (modify). `frontend/src/pages/home/Home.tsx` (modify), `frontend/vite.config.ts` (modify). `frontend/src/pages/home/__tests__/Home.implementation.test.tsx` (modify).

Current state (frontend/src/app/focused-session/components/focused-session/FocusedSession.tsx):

```tsx
    <CentredSession session={terminal} />
```

Contract (frontend/src/app/milestone-progress/MilestonePolling.ts):

```ts
export class MilestonePolling {
  static readonly INTERVAL_MS = 3000
  static readonly REVIEW_INTERVAL_MS = 15000
  static readonly REVIEW_STEPS: readonly string[] = ['delivered', 'in-review', 'fixing']
  static intervalFor(read: MilestoneProgressOutcome): number
}
export const useMilestoneProgress = (enabled: boolean): MilestoneProgressOutcome | null
export class ElapsedTime { static since(startedAt: string, now: number): string }
export const useSecondTick = (): number
type MilestoneBoardProps = { progress: MilestoneProgressOutcome | null; onTalk: (() => void) | null; repo: string; story: string; onReread: () => void; onClose: () => void }
type SliceLineRowProps = { line: SliceLine; now: number; onTalk: (() => void) | null; repo: string; onReread: () => void }
```

Each export lives in the file of its name. A null read means none arrived yet. The hook also
returns `reread()`. `Home` calls it with `stage.step === 'implementation'`.

`FocusedSession` draws `MilestoneBoard` at step 4 in
place of `CentredSession`. The board is a region `Issues del milestone`, with the text
`${delivered} de ${total} entregadas`.

A running line reads
`${label} · Tarea ${task} de ${totalTasks} · ${mm:ss}`. It drops the task part when `task` is
null. A pending line reads `Pendiente`. A delivered line reads `Entregada` with a link
`Pull request #N`. `vite.config.ts`: `API_PATHS` adds `'/milestone-progress'`.

**TDD:** `it('a running line shows its step, Tarea X de Y and a time in step that ticks')` sets
the clock 65 s after `step_started_at`. It asserts `01:05`, then `01:06` one second later.

**Tests:** added: that case, `it('lists pending, running and delivered issues under Issues del milestone')`,
`it('the milestone is read again after 15 seconds while an issue is in review')`.

**Verification:** the page tests and the build pass.

```bash
cd frontend && npx vitest run src/pages/home/__tests__/Home.implementation.test.tsx --maxWorkers=4   # expected: exit 0 — board cases pass
cd frontend && npm run build   # expected: exit 0 — board compiles
```

### Task 5 — A running line expands into its tasks and the live activity

**Objective:** a running line opens into its tasks, the judge's finding, the last tool and the last message.

**Files:** `frontend/src/app/milestone-progress/components/slice-line-row/SliceLineRow.tsx` (modify), `frontend/src/app/milestone-progress/components/slice-line-row/SliceLineRow.css` (modify), `frontend/src/pages/home/__tests__/Home.implementation.test.tsx` (modify)

No code — the props of Task 4 do not change; the copy below is the whole decision.

A running line carries a button `Ver tareas`, with `aria-expanded`. Once open, the button reads
`Ocultar tareas`. The list shows one item per task: `Tarea N · <name>`, then its status.

`done` reads `Hecha`, `running` reads the step label with its time, `pending` reads
`Pendiente`, and `stopped` reads `Detenida`. A task with `findings` adds
`Lo que encontró el juez: <findings>`. Under the list, a status box reads
`El agente está trabajando · mm:ss en este paso`. It adds `Última herramienta: <name> · <argument>`
when there is a last tool, and `Último mensaje: «<text>»` when there is a last text.

**TDD:** `it('a running line expands into its tasks, the judge finding, the last tool and the last message')`
asserts `Hecha`, `Lo que encontró el juez:`, `Última herramienta: Edit · src/a.ts` and `Último mensaje: «ready»`.

**Tests:** added: that case, and `it('a line starts closed and closes again')`.

**Verification:** the page tests pass.

```bash
cd frontend && npx vitest run src/pages/home/__tests__/Home.implementation.test.tsx --maxWorkers=4   # expected: exit 0 — expansion cases pass
```

### Task 6 — What needs the person, and the red-baseline notice

**Objective:** a line that needs the person gets one action, and a red baseline gets a notice.

**Files:** `frontend/src/app/milestone-progress/SliceRecovery.ts` (create), `frontend/src/app/milestone-progress/components/slice-line-row/SliceLineRow.tsx` (modify), `frontend/src/app/milestone-progress/components/milestone-board/MilestoneBoard.tsx` (modify), `frontend/src/pages/home/__tests__/Home.implementation.test.tsx` (modify)

Contract (frontend/src/app/milestone-progress/SliceRecovery.ts):

```ts
export class SliceRecovery {
  static readonly NOT_FOUND = 'El backend ya no informa de este trabajo.'
  static readonly LABELS: Readonly<Record<RecoveryAction, string>> = {
    observe: 'Recuperar trabajo', continue: 'Recuperar trabajo',
    cleanup: 'Limpiar arranque fallido', inspect: 'Reintentar recuperación',
  }
  static run(asked: { repo: string; issue: number; action: RecoveryAction }): Promise<RecoveryOutcome>
}
```

`run` reads `ActivePlansClient.get()`. It picks the plan with `phase === 'uncertain'`, the same
repo and the same issue number. It calls `ActivePlansClient.cleanup` for `cleanup`, else
`ActivePlansClient.recover`. No such plan gives `{kind:'refused', code:'slice-recovery-not-found', detail: NOT_FOUND}`.
The row calls `onReread` after the outcome, and shows a refusal detail under the button.

The copy per attention:

- `veto`: `El juez cerró este slice`, `Lo que encontró el juez: <findings>`, `Habla con la sesión coordinadora para decidir qué hacer.`
- `uncertain`: `No se puede confirmar el estado`, then its `detail`.
- `partial`: `Implementación terminada; publicación sin confirmar`, then its `detail`.
- `unreadable`: `No se puede leer el trabajo de este slice`, then its `detail`.

The board shows a warning `Banner` above the list when some line has `baselineRed`. Its title is
`El repositorio ya estaba en rojo antes de empezar.` and its description is
`Un slice puede fallar por algo que no ha tocado.`

**TDD:** `it.each` over `veto`, `partial`, `unreadable` and `uncertain`:
`it('a slice that needs the person shows what happened and exactly one action')`. It asserts one
button in the line. `it('the red-baseline notice shows only when some baseline was red')` asserts
the notice with one red line and no notice with none.

**Tests:** added: those two, and `it('the recovery button recovers the plan with its agent')`.

**Verification:** the page tests pass.

```bash
cd frontend && npx vitest run src/pages/home/__tests__/Home.implementation.test.tsx --maxWorkers=4   # expected: exit 0 — attention cases pass
cd frontend && npm run build   # expected: exit 0 — recovery compiles
```

### Task 7 — Hablar con la sesión opens the terminal over the list

**Objective:** `Hablar con la sesión` opens the coordinating terminal in a panel over the list, and the panel closes again.

**Files:** `frontend/src/app/focused-session/components/session-panel/SessionPanel.tsx` (create), `frontend/src/app/focused-session/components/session-panel/SessionPanel.css` (create), `frontend/src/app/focused-session/components/session-panel/index.ts` (create), `frontend/src/app/focused-session/components/focused-session-header/FocusedSessionHeader.tsx` (modify), `frontend/src/app/focused-session/components/focused-session/FocusedSession.tsx` (modify), `frontend/src/pages/home/__tests__/Home.implementation.test.tsx` (modify)

Current state (frontend/src/app/focused-session/components/focused-session-header/FocusedSessionHeader.tsx, lines 23-25):

```tsx
      <Button variant="secondary" disabled={closing} onClick={onCancel}>
        {closing ? 'Cancelando…' : 'Cancelar la sesión'}
      </Button>
```

Contract (frontend/src/app/focused-session/components/session-panel/SessionPanel.tsx):

```tsx
type SessionPanelProps = { session: LiveSession; onClose: () => void }
const SessionPanel = ({ session, onClose }: SessionPanelProps) => JSX.Element
```

The panel is `role="dialog"` with `aria-label="Sesión coordinadora"`. It holds a button
`Volver a la lista` and `CentredSession`. Its CSS lays it over the board with `position: absolute`.
`FocusedSession` keeps `talking` state. At step 4 it gives the header
`onTalk` and each row `onTalk`, both null when `terminal` is null. The header draws
`Hablar con la sesión` before `Cancelar la sesión` when `onTalk` is not undefined.

**TDD:** `it('Hablar con la sesión opens the terminal in a panel over the list')` asserts the
dialog `Sesión coordinadora` with the session region inside, and the list still in the page.

**Tests:** added: that case, and `it('Volver a la lista closes the panel')`.

**Verification:** the page tests pass.

```bash
cd frontend && npx vitest run src/pages/home/__tests__/Home.implementation.test.tsx --maxWorkers=4   # expected: exit 0 — panel cases pass
```

### Task 8 — An ended session offers Reabrir la sesión in every step

**Objective:** an ended or unresumable session shows the closed notice with `Reabrir la sesión` and the copy of its step.

**Files:** `frontend/src/app/focused-session/components/session-ended-notice/SessionEndedNotice.tsx` (create), `frontend/src/app/focused-session/components/session-ended-notice/index.ts` (create), `frontend/src/app/focused-session/components/focused-session/FocusedSession.tsx` (modify), `frontend/src/pages/home/__tests__/Home.implementation.test.tsx` (modify)

Contract (frontend/src/app/focused-session/components/session-ended-notice/SessionEndedNotice.tsx):

```tsx
const TITLE = 'La sesión coordinadora se ha cerrado'
const IN_IMPLEMENTATION = 'Los slices siguen en marcha. Reábrela para volver a hablar con ellos; conserva lo que ya se habló.'
const BEFORE_IMPLEMENTATION = 'Reábrela para seguir; conserva lo que ya se habló.'
const REOPEN = 'Reabrir la sesión'
type SessionEndedNoticeProps = { step: SessionStep; busy: boolean; onReopen: () => Promise<OpenOutcome> }
```

`FocusedSession` draws the notice under the header when `held.kind` is `ended` or
`unresumable`. The button shows disabled while `busy` (`lifecycle.operationBusy`) is true or
the press runs. A refused outcome shows its `error` in an error `Banner` under the notice.

**TDD:** `it.each` over the four steps:
`it('an ended session shows Reabrir la sesión with the copy of its step')`. Step 4 asserts
`IN_IMPLEMENTATION`; steps 1 to 3 assert `BEFORE_IMPLEMENTATION`.

**Tests:** added: that case, and `it('Reabrir la sesión posts the held target')`.

**Verification:** the page tests pass.

```bash
cd frontend && npx vitest run src/pages/home/__tests__/Home.implementation.test.tsx --maxWorkers=4   # expected: exit 0 — reopen cases pass
```

### Task 9 — Every issue delivered shows Milestone completado

**Objective:** with every issue delivered the board shows `Milestone completado` and one action that closes the session.

**Files:** `frontend/src/app/milestone-progress/components/milestone-board/MilestoneBoard.tsx` (modify), `frontend/src/pages/home/__tests__/Home.implementation.test.tsx` (modify)

No code — `MilestoneBoardProps.onClose` exists since Task 4; the copy below is the decision.

When `total > 0` and `delivered === total`, the board draws in place of the list: a heading
`Milestone completado`, the text `Las ${total} issues están entregadas y mergeadas`, the text
`${story} está terminado.` and one button `Cerrar la sesión y volver al inicio`. The button
calls `lifecycle.close()`, the same close as `Cancelar la sesión`.

**TDD:** `it('every issue delivered shows Milestone completado and Cerrar la sesión y volver al inicio')`
asserts the heading and the button. Its twin with one issue still running asserts no heading.

**Tests:** added: that case, its twin
`it('one issue not delivered keeps the list')`, and
`it('Cerrar la sesión y volver al inicio gives the start form back')`.

**Verification:** the page tests pass.

```bash
cd frontend && npx vitest run src/pages/home/__tests__/Home.implementation.test.tsx --maxWorkers=4   # expected: exit 0 — completed cases pass
```

### Task 10 — Remove what only the classic view used

**Objective:** no module, style, mirror or fixture stays that only removed code used.

**Files:** delete `frontend/src/app/workflow-snapshot/`, `frontend/src/app/slice-session/`, `frontend/src/app/gate-sequence/`, `frontend/src/app/implement-history/`, `frontend/src/app/sessions/components/sessions-panel/`, `frontend/src/app/sessions/useLiveSessions.ts`, `frontend/src/app/sessions/useLiveSessions.test.ts`, `frontend/src/app/coordinating-session/components/`, `frontend/src/pages/home/components/`, `frontend/src/pages/home/useSessionsColumnWidth.ts`, `frontend/src/pages/home/useSessionsColumnCollapse.ts`, `frontend/src/pages/home/useSessionsColumnCollapse.test.ts`. Also delete in `frontend/src/app/work-progress/` the files `WorkDetails.tsx`, `WorkDetails.css`, `WorkDetails.test.tsx`, `useWorkConclusion.ts`, `useWorkConclusion.test.ts`, `useWorkProgress.ts`, `useWorkProgress.test.ts`, `client.ts` and `presentation.ts`. Delete the component folders under `frontend/src/app/implement-progress/components/` and `frontend/src/app/planning-progress/components/`. In `frontend/src/system-ui/`, delete the folders `breadcrumbs`, `drawer`, `collapsable-card`, `tabs`, `panel`, `text-area` and `workflow-step`, with their tests. Delete the mothers `HeadlessPlanMother.ts`, `SliceSessionMother.ts`, `RestartedBackendMother.ts` and `ImplementHistoryMother.ts`. Modify `frontend/vite.config.ts`, `frontend/src/app/sessions/client.ts`, `frontend/src/app/coordinating-session/useCoordinatingSession.ts`, `frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.tsx`, `frontend/src/app/start-plan/StartPlan.types.ts`, `frontend/src/system-ui/top-bar/TopBar.tsx`, the rest of `frontend/src/__scenarios__/`.

Current state (frontend/vite.config.ts, lines 8-8):

```ts
const API_PATHS = ['/recover-plan', '/cleanup-plan', '/work-progress', '/implement-history', '/active-plans', '/external-tools', '/sessions', '/slices', '/coordinating-session', '/groom-session', '/session-hooks', '/spec-freeze', '/spec-reslicing', '/epic-groom', '/epic-promotion']
```

`API_PATHS` loses `/work-progress`, `/implement-history` and `/slices`. `SessionsClient.list` and
`closedSessionIds` go.

`StartPlanForm` loses `isLocked`, `request`, `isMutationBlocked`, the locked
summary, `MUTATION_BLOCKED_HELP` and `.start-plan-form__summary*`. `TopBar` loses `breadcrumbs` and
`actions`. `STEP_SHORT_LABELS` goes. Each type that loses its last reader goes. A type
`contract.ts` imports stays.

Amendment (additions only, this task's Files line, made while implementing): `HeadlessPlanMother.ts`
is modified, not deleted — `active-plans/client.test.ts` and `Home.implementation.test.tsx`'s Task 6
recovery tests still call `.empty`, `.uncertain`, `.awaitingObservation`, `.awaitingContinuation`,
`.unlaunched`, `.uncertainAmong` and `.agentFor`; only the members `useAutomaticSliceSelection.test.ts`
alone used are pruned. `frontend/src/app/active-plans/client.ts` also needed `isRecord`, `isRequest`
and `isPlanForRequest` moved in from the deleted `workflow-snapshot/validation.ts`, its only other
importer, following the module-that-was-already-there idiom already in that file. Also modified as
the unavoidable companions of the listed changes: `frontend/src/app/sessions/client.test.ts` and
`frontend/src/app/sessions/Sessions.types.ts` (the `SessionsClient.list` removal), `frontend/src/app/coordinating-session/useCoordinatingSession.test.ts`
(the `closedSessionIds` removal), `frontend/src/pages/home/Home.tsx` (drops the `isLocked` prop
`StartPlanForm` no longer declares), `frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.css`
and `StartPlanForm.test.tsx`, `frontend/src/system-ui/top-bar/TopBar.css`, and
`frontend/src/app/implement-progress/ImplementProgress.types.ts` (the `STEP_SHORT_LABELS` removal).

**TDD:** No TDD — deletion only; the suite and the build prove that nothing kept used them.

**Tests:** removed on purpose: the tests inside every deleted folder and file above.

**Verification:** the suite and the build pass, and the deleted paths are gone.

```bash
cd frontend && npx vitest run --maxWorkers=4   # expected: exit 0 — the kept tests pass
cd frontend && npm run build   # expected: exit 0 — nothing kept imports a deleted module
test ! -e frontend/src/app/slice-session   # expected: exit 0 — slice cards are gone
test ! -e frontend/src/system-ui/drawer   # expected: exit 0 — the drawer mirror is gone
test ! -e frontend/src/app/workflow-snapshot   # expected: exit 0 — restore is gone
test -e frontend/src/app/work-progress/contract.ts   # expected: exit 0 — the backend contract test keeps its import
test -z "$(grep -rl 'ColumnResizer\|WorkflowSnapshotStorage\|GateSequence' frontend/src)"   # expected: exit 0 — no reader is left
```

### Task 11 — The READMEs describe the focused view only

**Objective:** `frontend/README.md` and `README.md` describe the focused view through step 4 and nothing of the classic view.

**Files:** `frontend/README.md` (modify), `README.md` (modify)

In `frontend/README.md`, remove the paragraphs about the two-stage flow, restore and automatic
selection. Remove the drawer and right column, `app/active-plans` and `Descartar estado`, and
the slice cards and handoff. Remove `useWorkConclusion`, the active-plan read barrier, the column
resizer, and the entries of the deleted mirrors. The paragraph that opens with
`**The focused view.**` gets the text below. In `README.md` §5, the line
`The main screen has two stages: **Solicitud → Implementación**.` becomes
`While a coordinating session is held, the main screen is the focused view through four steps.`
The `Implementación (one progress view per slice)` line of §5.1 becomes
`Implementación (one compact list of the milestone's issues)`.

Final text (frontend/README.md):

```md
**The focused view.** While a coordinating session is held — live, ended or
unresumable — `Home` renders `FocusedSession` (`app/focused-session`); with no
session held it renders only the start form. The view holds a header with the
step, the story and repository, **Cancelar la sesión**, and the four steps; the
band of the gate that asks for something; and the centre. In steps 1 to 3 the
centre is the session. In step 4 it is `MilestoneBoard` (`app/milestone-progress`),
one line per issue from `GET /milestone-progress`, polled every 3 s, or 15 s
while an issue is in review. **Hablar con la sesión** opens the terminal in a
panel over the list. A session that ended shows **Reabrir la sesión**, which
calls `POST /coordinating-session/reopen`.
```

**TDD:** No TDD — documentation only.

**Tests:** N/A — documentation only.

**Verification:** the removed words are gone from both READMEs.

```bash
test "$(grep -c 'Descartar estado' frontend/README.md)" -eq 0   # expected: exit 0 — restore is not described
test "$(grep -c 'column resizer' frontend/README.md)" -eq 0   # expected: exit 0 — the resizer is not described
test "$(grep -c 'MilestoneBoard' frontend/README.md)" -eq 1   # expected: exit 0 — the focused view is described
test "$(grep -c 'two stages' README.md)" -eq 0   # expected: exit 0 — the root README drops the classic flow
```

## 8. Global verification

The whole frontend suite and the build pass on the last commit. The deleted modules are gone.

```bash
cd frontend && npx vitest run --maxWorkers=4   # expected: exit 0 — every kept test passes
cd frontend && npm run build   # expected: exit 0 — the page builds
test -e frontend/src/app/work-progress/contract.ts   # expected: exit 0 — the backend contract import holds
test -z "$(git diff --name-only origin/main -- backend)"   # expected: exit 0 — backend untouched
```

A person then opens the page with a held session at step 4. They look at boards I1 to I6 against
the mockups. The pull request carries the screenshots for the `visual` gate.

## 9. Assumptions

1. `unresumable` counts as a session that ended by itself: the backend reopens any held session
   that is not live. Provenance: `backend/API.md` and own call.
2. The uncertain attention carries no agent, and `backend/` is out of scope. So `SliceRecovery`
   reads `GET /active-plans` once at press time to find the agent. `/active-plans` and
   `ActivePlansClient.get` stay. Provenance: own call.
3. The partial and unreadable copy reuses existing words: `Implementación terminada; publicación sin confirmar`
   from `ImplementProgress.tsx`, and a new title for unreadable. Their one action is
   `Hablar con la sesión`. Provenance: issue ("What slice #1 left") and own call.
4. With no live terminal, `Hablar con la sesión` shows disabled. The notice above offers
   `Reabrir la sesión`. Provenance: own call.
5. The mockup row `Cierre del slice` stays out: no acceptance criterion asks for it. Provenance:
   own call.
6. `Hablar con la sesión` appears in the header only at step 4. Steps 1 to 3 keep the terminal in
   the centre. Provenance: issue (steps 1 to 3 change only by the notice).
7. The completed board replaces the list. Provenance: design board I6 and own call.
8. `Volver a la lista` is the label that closes the panel. Provenance: own call.
9. `ImplementHistoryMother.ts` goes with `app/implement-history/`, which only `Home` used.
   Provenance: inventory of #583 and own call.
10. The mockups sit behind an artifact link that this session cannot open. The copy comes from the
    issue and `docs/superpowers/specs/mercadona__control-tower-585-design.md`. Provenance: own call.
