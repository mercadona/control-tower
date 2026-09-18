# #333 — The chain that does not stop

> **Task-scoped subagents execute this plan.** Each task is one commit.
> Write the test first. The plan closes decisions; the implementer writes bodies.

## 1. Context and goal

Base: `d72051a99ae672b47d4e09e8ff3a9bbadaaddc80`. Branch: `feat/333-the-chain-that-does-not-stop`.
Issue: https://github.com/mercadona/control-tower/issues/333.

Today one POST to `/start-plan` with a `milestone` body starts one slice. `StartMilestonePlan` asks
`GhDispatchCandidates`, which asks the plugin's `planDispatch`, and the plugin picks. When that slice
opens its pull request the chain stops: the plugin frees its cap, and nothing asks it again. The
`HarvestClock` sweep already surveys every registered checkout each 60 seconds and collects what a
merge left behind. This slice makes that same sweep ask the plugin again, and gives the slice a panel
that takes a message for its own conversation.

### Desired end state

- Each sweep relays one dispatch for every checkout the registry holds.
- An open pull request frees the plugin's cap, so the next sweep starts the next admissible slice.
- A merge that a person makes on GitHub unblocks its dependants, and the next sweep starts one.
- No caller names the issue: `planDispatch` picks it, and the backend keeps no second opinion.
- The relay derives the milestone from the frozen epic spec on disk, never from a stored phase.
- The slice's panel shows its own stream and takes a message for its own conversation.
- One endpoint carries that message, and the recorded conversation of that issue receives it.

### Out of scope

- `plugin/scripts/dispatch-check.mjs`, which the issue protects. The whole `plugin/` tree stays byte-identical.
- The first slice of an epic stays the boss's order. The relay only continues a chain the app already started.
- No merge button, no write to a pull request, no new gate. D-7 and D-22 stay as they are.
- The pull request comment channel stays as it is. `ReviewWatch` needs no change.
- The implementation history stays in the side pane. This slice moves no existing panel.
- A tablist for several slices at once. The cap keeps one slice in flight.

## 2. Closed decisions (take as given)

| Decision | Exact choice |
|---|---|
| D-4 | No caller names the next slice. The relay passes a milestone, never an issue number. |
| D-5 | The plugin's own cap and token rules decide. `collectInFlight` frees at the pull request. |
| D-7 | The sweep notices a merge. The app writes nothing to a pull request. |
| D-9 | The slice's panel renders its stream and takes a message. |
| D-11, D-12 | The backend imports the plugin's selection. It grows no second opinion about order. |
| D-13, D-17 | The relay derives the milestone from the frozen spec. It stores no phase and no cursor. |
| D-16 | No module this slice adds names cmux. No new test needs cmux. |
| D-19 | The message reaches the slice through `PlanAgents.fix`, the path `ReviewWatch` already uses. |
| D-20, D-24 | One endpoint delivers a change to the recorded conversation of one issue. |
| D-22 | The relay triggers no gate. It starts work a person already authorised with `status:ready`. |
| Entrance | The relay reads only checkouts `CheckoutRegistry.known()` holds. |
| Silence | `DispatchNotAvailable` is the ordinary answer. The relay writes no line for it. |
| Failures | Every other `PlanFailure` becomes one stderr line, and the next sweep tries again. |
| Reservation | The relay and `/start-plan` share one `WorkInFlight`, so two starts never overlap. |
| Milestone | `EpicSpec.title()` of the most recent frozen spec is the milestone. |
| Draft | An unfrozen spec, or one with no title, carries no milestone. The relay returns. |
| Order | The sweep harvests a checkout first, then relays. A failed survey reaches no relay. |
| Endpoint | `POST /slices/:issue/message` takes `repo`, `agent` and `text`, and nothing else. |
| Identity | `PlanAgents.fix` already refuses an agent that is not the record of that issue. |
| Before delivery | A message that arrives before the run delivers refuses. The panel shows that detail. |
| Codes | Three new codes carry the `slice-message-` prefix. Three shared codes stay as they are. |
| Copy | The panel's strings reach a person, so they are Spanish. Every name is English. |
| Flags | No feature flag, no environment switch, no configurable alternate path. |

## 3. Reference patterns

Files to imitate:
- `backend/src/infrastructure/harvest-clock.ts`
- `backend/src/infrastructure/review-watch.ts`
- `backend/src/infrastructure/session-input-route.ts`
- `backend/__tests__/infrastructure/harvest-clock.test.ts`
- `backend/__tests__/infrastructure/gh-dispatch-candidates.test.ts`
- `frontend/src/app/implement-progress/components/implement-progress/ImplementProgress.tsx`
- `frontend/src/__scenarios__/CoordinatingSessionMother.ts`

Rules to obey:
- `AGENTS.md`
- `CLAUDE.md`
- `backend/conventions/this-repository.md`
- `plugin/conventions/architecture.md`
- `plugin/conventions/boundaries.md`
- `plugin/conventions/decisions.md`
- `plugin/conventions/defects.md`
- `plugin/conventions/domain.md`
- `plugin/conventions/simplicity.md`
- `plugin/conventions/style.md`
- `plugin/conventions/testing.md`

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/infrastructure/dispatch-relay.ts` | create | the sweep | Contract |
| `backend/src/infrastructure/harvest-clock.ts` | modify | `ct-api.ts` | Current state + Contract |
| `backend/src/infrastructure/slice-message-route.ts` | create | `api-server.ts` | Contract |
| `backend/src/infrastructure/api-server.ts` | modify | `ct-api.ts` | Call site |
| `backend/src/infrastructure/ct-api.ts` | modify | the entrypoint | Current state |
| `backend/__tests__/infrastructure/refusal-codes.test.ts` | modify | the code guard | prose |
| `frontend/src/app/slice-session/client.ts` | create | the panel | Contract |
| `frontend/src/app/slice-session/components/slice-session/SliceSession.tsx` | create | `Home.tsx` | Contract |
| `frontend/src/__scenarios__/SliceSessionMother.ts` | create | the panel tests | none (body by TDD) |
| `frontend/src/pages/home/Home.tsx` | modify | the page | Current state + Call site |

Every new backend module and test is `.ts`. Every new frontend module is `.ts` or `.tsx`.
No new test spawns a process, so no new file carries the `-real-process` suffix.

## 5. Interfaces

Consumes: `StartMilestonePlan.execute(params: StartMilestonePlanParams): Promise<PlanStarted>`.
Consumes: `EpicSpecs.mostRecent(root: CheckoutRoot): Promise<EpicSpec | null>`, plus `EpicSpec.isFrozen()` and `EpicSpec.title()`.
Consumes: `WorkInFlight.reserve(key: string): ReservationValue` and `release(key: string): void`.
Consumes: `RequestFixes.execute(params: RequestFixesParams): Promise<void>`, which calls `Workbench.reopen` and `PlanAgents.fix`.
Consumes: `GhDispatchCandidates.next({ repository, milestone }): Promise<PlanIssue>`, the plugin's own choice.

Produces: `DispatchRelay.relay(root: CheckoutRoot, repository: RepositoryName): Promise<void>`.
Produces: `RelayLine.dispatched(started)`, `RelayLine.refused(repository, failure)` and `RelayLine.SILENT`.
Produces: `HarvestClock`'s new `relay: CheckoutRelayed` port.
Produces: `SliceMessageRoute.PATH`, `SliceMessageOutcome` and `SliceMessageCollapse.declaredCodes()`.
Produces: `SliceSessionClient.send(asked)` and the `SliceSession` component.

## 6. Test strategy

Tests are outside-in with the ports doubled, as `harvest-clock.test.ts` doubles its four ports.
Task 3 is the exception: it drives the real plugin selection through the real sweep, and doubles only
`Gh` and the workspace side. That is where the two GitHub states live, an open pull request and a
merged dependency, so the cap rule stays the plugin's.

The frontend tests stub `fetch` and read their bodies from a mother, as `ImplementProgress.test.tsx` does.
Each task names its own tests. No control counts the suite's total.

## 7. Tasks

### Task 1 — Relay one dispatch for a swept checkout

**Objective:** The relay starts the next admissible slice of one checkout and names no issue.

**Files:** `backend/src/infrastructure/dispatch-relay.ts` (create), `backend/__tests__/infrastructure/dispatch-relay.test.ts` (create).

Contract (backend/src/infrastructure/dispatch-relay.ts):
```ts
export type EpicSpecRead = (root: CheckoutRoot) => Promise<EpicSpec | null>
export type MilestoneDispatched = (asked: {
  repository: RepositoryName, root: CheckoutRoot, milestone: string,
}) => Promise<PlanStarted>

export class RelayLine {
  static readonly SILENT = null
  static dispatched(started: PlanStarted): string
  static refused(repository: RepositoryName, failure: PlanFailure): string
}

export class DispatchRelay {
  constructor(ports: {
    spec: EpicSpecRead, dispatch: MilestoneDispatched,
    inFlight: WorkInFlight, stderr: (line: string) => void,
  })
  relay(root: CheckoutRoot, repository: RepositoryName): Promise<void>
}
```

The relay reads the checkout's most recent epic spec. A null spec, an unfrozen spec or a null title
carries no milestone, so the relay returns and writes nothing.

It reserves `repository.text` in `inFlight` before the dispatch, and releases it in `finally`. A
reservation that `/start-plan` holds answers `Reservation.IN_PROGRESS`, and the relay returns without
a word and without a release.

`DispatchNotAvailable` names a full cap, unmet dependencies or nothing ready, so it takes
`RelayLine.SILENT`. Every other `PlanFailure` takes one `RelayLine.refused` line. Anything else
propagates, the way `HarvestClock` propagates what is not a `PlanFailure`.

The relay passes the milestone and no issue number. `RelayLine.dispatched` names the repository, the
issue and the conversation, as `SweepLine` names its own facts.

**TDD:** `it('the relay dispatches the milestone of the frozen spec and names no issue')` — the recorded dispatch carries the spec title, the root and the repository, and no issue field.

**Tests:** `'the relay dispatches the milestone of the frozen spec and names no issue'`, `'a draft spec, a null spec and a titleless spec all dispatch nothing'`, `'a full cap stays silent while a read failure writes one line'`, `'a reservation another start holds stops the relay and survives it'`, `'the reservation goes back after a failed dispatch'`.

**Verification:** Run the new relay suite and the typecheck.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/dispatch-relay.test.ts
```

### Task 2 — The sweep relays after it harvests

**Objective:** Each surveyed checkout of a sweep reaches the relay once, after its harvest.

**Files:** `backend/src/infrastructure/harvest-clock.ts` (modify), `backend/__tests__/infrastructure/harvest-clock.test.ts` (modify).

Current state (backend/src/infrastructure/harvest-clock.ts, lines 117-119):
```ts
    for (const prepared of checkout.prepared) {
      await this.#collect(prepared, checkout.repository)
    }
```

Contract (backend/src/infrastructure/harvest-clock.ts):
```ts
export type CheckoutRelayed = (root: CheckoutRoot, repository: RepositoryName) => Promise<void>
```

`HarvestClock`'s constructor takes `relay: CheckoutRelayed` beside `harvest`, and keeps it as a
readonly field. `#sweepCheckout` awaits `this.relay(root, checkout.repository)` after the loop above.

A survey that fails still returns first, because without a survey the repository has no name. The
clock keeps its own prose for the harvest and adds none for the relay. Task 1 gave the relay its
lines, and two reporters for one fact drift apart.

`start` and `sweep` keep their bodies. The clock stays the only loop, and the relay stays one call
per checkout per sweep.

**TDD:** `it('the sweep relays once for each surveyed checkout after its harvest')` — the trace records harvest before relay for two checkouts.

**Tests:** `'the sweep relays once for each surveyed checkout after its harvest'`, `'a checkout whose survey fails reaches no relay'`, `'a checkout with no prepared workspace still reaches the relay'`.

**Verification:** Run the clock suite and the typecheck.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/harvest-clock.test.ts
```

### Task 3 — The plugin alone picks what the sweep dispatches

**Objective:** A sweep over the real plugin selection dispatches what a pull request or a merge freed.

**Files:** `backend/__tests__/infrastructure/dispatch-relay-sweep.test.ts` (create).

No code — this task adds the test that crosses the real plugin selection with the real sweep.

The suite builds the real `HarvestClock`, `DispatchRelay`, `StartMilestonePlan` and
`GhDispatchCandidates`. It doubles `Gh` with a script of exact argv, and doubles the workspace, the
claims, the records and the agents. The epic spec double answers one frozen spec whose title is the
milestone.

The first case gives the swept slice `status:in-review` with an open pull request, and the next slice
`status:ready` with its dependency merged. The plugin frees the cap at the pull request, so the sweep
dispatches that next slice. The second case leaves every open slice `status:ready` and closes the
dependency of one, so the sweep dispatches the slice that merge unblocked.

The third case reads the whole trace: no double receives an issue number, and the dispatched issue is
the one `planDispatch` selected. That is the proof of D-4 and of D-11 together.

A `gh` double refuses an argv it does not know. So a second opinion inside the backend fails the
suite and stays visible.

**TDD:** `it('an open pull request frees the cap and the sweep dispatches the next slice')` — the agent launch carries the issue the plugin selected, and the sweep runs once.

**Tests:** `'an open pull request frees the cap and the sweep dispatches the next slice'`, `'a merged dependency makes the sweep dispatch what it unblocked'`, `'no caller of the sweep names the issue the plugin selected'`, `'a sweep with nothing admissible launches no agent and writes no line'`.

**Verification:** Run the plugin selection boundary and the new sweep suite.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/gh-dispatch-candidates.test.ts __tests__/infrastructure/dispatch-relay-sweep.test.ts
```

### Task 4 — One endpoint delivers a change to a slice's conversation

**Objective:** A posted message reaches the recorded conversation of that issue through `PlanAgents.fix`.

**Files:** `backend/src/infrastructure/slice-message-route.ts` (create), `backend/src/infrastructure/api-server.ts` (modify), `backend/__tests__/infrastructure/slice-message-route.test.ts` (create), `backend/__tests__/infrastructure/refusal-codes.test.ts` (modify).

Contract (backend/src/infrastructure/slice-message-route.ts):
```ts
export const SliceMessageOutcome: Readonly<{
  ACCEPTED: 'accepted', BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field', MALFORMED_REPO: 'malformed-repo',
  MALFORMED_ISSUE: 'slice-message-malformed-issue',
  MALFORMED_AGENT: 'slice-message-malformed-agent',
  MALFORMED_TEXT: 'slice-message-malformed-text',
}>
export type SliceChangeAsked = (asked: {
  agent: string, issue: number, repository: RepositoryName, changes: string,
}) => Promise<void>
export class SliceMessageCollapse {
  static of(cause: Error): Refusal
  static declaredCodes(): string[]
}
export class SliceMessageRoute {
  static readonly PATH = '/slices/:issue/message'
  static readonly METHOD = 'POST'
  static readonly ISSUE_PARAMETER = 'issue'
  static handledBy(fixes: SliceChangeAsked): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

The three known fields are `repo`, `agent` and `text`. Any other field takes `UNKNOWN_FIELD`, as
`SessionInputRequest` does. The issue comes from the path and takes the `^[1-9][0-9]*$` shape
`EventsRequest` already uses. Empty text takes `MALFORMED_TEXT`.

`SliceMessageCollapse` maps `PlanAgentNotResumed` to `slice-message-not-delivered`, `SliceNotReopened`
to `slice-message-not-reopened` and `ReopenNotUnderstood` to `slice-message-reopen-not-understood`.
A run that has not delivered reaches that same code, because `RunPlanAgents.fix` maps its own refusal
to `PlanAgentNotResumed`. Success answers 202 with `{"status":"delivered"}`.

`refusal-codes.test.ts` adds `SliceMessageOutcome` to `RequestVocabularies.codes()` and
`SliceMessageCollapse.declaredCodes()` to `EveryCodeTheApiEmits.values()`. The shared list stays as it
is: the three reused codes already sit in it.

Call site (backend/src/infrastructure/api-server.ts):
```ts
    app.post(
      SliceMessageRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      SliceMessageRoute.handledBy(this.sliceMessage!)
    )
    app.all(SliceMessageRoute.PATH, SliceMessageRoute.refuseOtherMethods)
```

`ApiCollaborators` takes `sliceMessage?: SliceChangeAsked | null`.

**TDD:** `it('a posted message reaches the recorded conversation of that issue')` — the fix call carries the agent, the issue, the repository and the exact text.

**Tests:** `'a posted message reaches the recorded conversation of that issue'`, `'an unknown field, an empty text and a malformed issue each refuse with their own code'`, `'a conversation that is not the record of that issue refuses as not delivered'`, `'the other methods of the path answer with an allow header'`.

**Verification:** Run the new route suite and the code guard.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/slice-message-route.test.ts __tests__/infrastructure/refusal-codes.test.ts
```

### Task 5 — The runtime sweeps with the relay and mounts the endpoint

**Objective:** The real composition wires the relay into the sweep and the message endpoint into the server.

**Files:** `backend/src/infrastructure/ct-api.ts` (modify), `backend/__tests__/infrastructure/ct-api-real-process.test.ts` (modify).

Current state (backend/src/infrastructure/ct-api.ts):
```ts
    return new HarvestClock({
      checkouts: () => checkouts.known()?.map((checkout) => checkout.root) ?? null,
      survey: (root) => surveyWorkspaces.execute(new SurveyWorkspacesParams({ root })),
      harvest: (prepared, repository) =>
        harvestDelivery.execute(new HarvestDeliveryParams({ prepared, repository })),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_SWEEPS),
      stderr: (line) => process.stderr.write(line),
    })
```

Current state (backend/src/infrastructure/ct-api.ts):
```ts
      startMilestonePlan,
      startsInFlight: new WorkInFlight(),
```

`run` keeps one `const startsInFlight = new WorkInFlight()` and passes it to the server and to the
relay. `#harvestClock` takes one more parameter, `relay: DispatchRelay`, and passes
`relay: (root, repository) => relay.relay(root, repository)` to the clock.

`run` builds the relay with `spec: (root) => epicSpecs.mostRecent(root)` and with a `dispatch` that
calls `startMilestonePlan.execute(new StartMilestonePlanParams(asked))`. The call at the end of `run`
hands the built relay to `#harvestClock`.

`run` also builds `requestFixes` itself and hands it to `#pullRequestReviews` and to the server as
`sliceMessage`. So the pull request channel and the coordinating session channel use one object.

Nothing else moves: `Invocation`, the `Makefile` and `.env.example` stay as they are, and the clock
still starts last.

**TDD:** `it('the runtime sweeps every registered checkout and mounts the slice message path')` — the started API answers the path, and one sweep of a draft spec dispatches nothing.

**Tests:** `'the runtime sweeps every registered checkout and mounts the slice message path'`, `'the mounted path refuses another method with an allow header'`.

**Verification:** Run the entrypoint suite and the dispatcher rehearsal.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/ct-api-real-process.test.ts __tests__/infrastructure/headless-dispatch-dry-run.test.ts
```

### Task 6 — The slice panel shows its stream and takes a message

**Objective:** The panel renders the slice's step and delivers a typed message to its conversation.

**Files:** `frontend/src/app/slice-session/SliceSession.types.ts` (create), `frontend/src/app/slice-session/client.ts` (create), `frontend/src/app/slice-session/components/slice-session/SliceSession.tsx` (create), `frontend/src/app/slice-session/components/slice-session/SliceSession.css` (create), `frontend/src/app/slice-session/components/slice-session/index.ts` (create), `frontend/src/app/slice-session/components/slice-session/SliceSession.test.tsx` (create), `frontend/src/__scenarios__/SliceSessionMother.ts` (create).

Contract (frontend/src/app/slice-session/SliceSession.types.ts):
```ts
type SliceMessageOutcome =
  | { kind: 'delivered' }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }

type SliceMessageAsked = { issue: number; repo: string; agent: string; text: string }

export type { SliceMessageAsked, SliceMessageOutcome }
```

Contract (frontend/src/app/slice-session/components/slice-session/SliceSession.tsx):
```tsx
type SliceSessionProps = { issue: number; root: string; repo: string; agent: string }
```

`SliceSessionClient.send(asked)` posts `{ repo, agent, text }` to `/slices/${issue}/message`, the way
`app/sessions/client.ts` posts its own input. A 202 answers `delivered`, a refusal body answers
`refused` with its code and detail, and a throw answers `backend-unreachable`.

The panel renders `<ImplementProgress issue root repo />` for the stream, so the step, the task and
the pull request keep the shape they have today. Under it the panel renders a textarea and a button.

The strings a person reads are Spanish. The panel label is `Slice #<issue>` and the field label is
`Pedir un cambio a esta conversación`. The button says `Enviar`, the success line says
`Cambio entregado a la conversación del slice`, and the unreachable line says
`No se pudo contactar con el backend`. A refusal shows its own detail in an error `Banner`.

An empty text disables the button, so no request leaves. A refused delivery keeps the typed text, and
a delivered one clears it.

**TDD:** `it('shows the step of the slice and delivers a typed message to its conversation')` — the request body carries the exact text, and the success line appears.

**Tests:** `'shows the step of the slice and delivers a typed message to its conversation'`, `'an empty message reaches no endpoint'`, `'a refused delivery keeps the text and shows the reason'`, `'an unreachable backend says so instead of claiming delivery'`.

**Verification:** Run the new panel suite and the progress suite it renders.
```bash
npm --prefix frontend test -- src/app/slice-session src/app/implement-progress
```

### Task 7 — The implementation stage renders the slice panel

**Objective:** The page shows the slice panel in place of the bare progress section.

**Files:** `frontend/src/pages/home/Home.tsx` (modify), `frontend/src/pages/home/__tests__/Home.sliceSession.test.tsx` (create).

Current state (frontend/src/pages/home/Home.tsx):
```tsx
              {restoredIsConfirmed && (
                <ImplementProgress
                  key={`${workflow.plan.repo}:${workflow.plan.issue.number}`}
                  issue={workflow.plan.issue.number}
                  root={workflow.plan.root ?? workflow.request.path}
                  repo={workflow.plan.repo}
                />
              )}
```

Call site (frontend/src/pages/home/Home.tsx):
```tsx
              {restoredIsConfirmed && (
                <SliceSession
                  key={`${workflow.plan.repo}:${workflow.plan.issue.number}`}
                  issue={workflow.plan.issue.number}
                  root={workflow.plan.root ?? workflow.request.path}
                  repo={workflow.plan.repo}
                  agent={workflow.plan.agent}
                />
              )}
```

The import of `ImplementProgress` leaves `Home.tsx`, because the panel owns it now. The side pane
keeps `ImplementHistory` exactly where it is, and the coordinating session keeps its drawer: D-21
forbids a phase that hides the boss.

`Home.implementProgress.test.tsx` keeps passing without a change, because the panel renders the same
progress section inside. That suite is part of this task's verification for that reason.

**TDD:** `it('the implementation stage renders the slice panel with the recorded conversation')` — the panel appears with the agent of the restored workflow, and the message field appears with it.

**Tests:** `'the implementation stage renders the slice panel with the recorded conversation'`, `'the coordinating session drawer stays visible while the slice panel shows'`.

**Verification:** Run the page suites the change touches.
```bash
npm --prefix frontend test -- src/pages/home/__tests__/Home.sliceSession.test.tsx src/pages/home/__tests__/Home.implementProgress.test.tsx
```

## 8. Global verification

The baseline passed on the base commit. These commands verify the finished slice.

| Acceptance criterion | Producer and consumer | Tasks |
|---|---|---|
| The sweep dispatches at the pull request | Real plugin choice to real relay | 1, 2, 3 |
| A merge dispatches what it unblocked | Closed issue to real relay | 1, 3 |
| Nobody names the next slice | Sweep trace to plugin choice | 1, 3, 5 |
| The panel streams and takes a message | Progress and message endpoints to panel | 4, 6, 7 |
| A change reaches that slice's conversation | Endpoint to `PlanAgents.fix` | 4, 5 |

The `visual` gate stays for a person. The pull request carries a before and after of the
implementation stage. Before: the bare progress section. After: the slice panel with its message field.

To reproduce it, start the API with `make api` and open the page. Restore a plan in its
implementation stage. Type a change in the slice panel.

```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend test
git diff --exit-code d72051a99ae672b47d4e09e8ff3a9bbadaaddc80 HEAD -- plugin/
git diff --check
```

## 9. Assumptions

1. The relay reads only registered checkouts, so the first slice of an epic stays a person's order
   through `/start-plan`. Provenance: D-22 names asking for a start as the boss's act, and
   `CheckoutRegistry.remember` runs inside `StartMilestonePlan` and `StartPlan`.
2. The milestone comes from `EpicSpec.title()` of the most recent frozen spec, which is the same
   derivation `ReadEpicGroom` performs. Provenance: own call, so the sweep needs no groom run and no
   stored milestone. D-13 forbids the stored one.
3. `ReadEpicGroom` stays out of the relay because it runs `ct-groom --dry-run` and several GitHub
   reads. Every 60 seconds that cost buys nothing: the plugin already refuses a milestone that has
   no ready slice. Provenance: own call.
4. `GhDispatchCandidates.next` reads two GitHub issue lists per sweep, and `GitWorkspace.prepare`
   fetches the base. A sweep of 60 seconds carries that cost, which the harvest already pays.
   Provenance: own call on the measured interval `CtApi.#SECONDS_BETWEEN_SWEEPS`.
5. The message endpoint takes the agent from its caller, and `PlanAgents.fix` refuses an agent that
   is not the record of that issue. Provenance: `RunPlanAgents` already checks it, so this slice adds
   no second check.
6. `RequestFixes` reopens the issue before the fix, so a change asked in review returns the slice to
   `status:in-progress` and the cap holds again. Provenance: repo convention, the existing
   `ReviewWatch` path.
7. The panel follows one slice, the one the page holds. The cap keeps one slice in flight, so a
   tablist of several waits for the work that lifts the cap. Provenance: D-5.
8. `ImplementPlanRoute` stays unmounted and untouched. Its codes stay in the guard, so the new codes
   avoid `malformed-agent`, `malformed-issue` and `malformed-text`. Provenance: repo convention,
   `refusal-codes.test.ts`.
9. `RunPlanAgents.fix` refuses until its run inspection says delivered, and maps that refusal to
   `PlanAgentNotResumed`. So a change asked during the implementation reaches the panel as
   `slice-message-not-delivered` with the run's own detail. D-24 promises a message into any live
   conversation, and slice #7 shipped only this narrower path. This slice widens nothing there.
   Provenance: `backend/src/infrastructure/run-plan-agents.ts`, and D-20 in the issue.
