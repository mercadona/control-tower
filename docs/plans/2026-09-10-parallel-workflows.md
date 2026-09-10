# Parallel Workflows Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a person create, select, recover and follow several independent user-story plans without losing another plan's context, preserving a working application after every delivery.

**Architecture:** Each plan remains an independent consistency boundary identified by repository and plan issue. A frontend application controller owns a collection and selection, with injected clients and storage; existing backend routes retain their wire contracts while discovery becomes repeatable and conservative about absence. The collection is a read/presentation model, not a multi-plan aggregate.

**Tech Stack:** Node.js 24, TypeScript, existing Express routes, React 19, Vitest, Testing Library and Vite. Existing cmux, GitHub and worktree adapters remain the execution foundation.

Issue: https://github.com/mercadona/control-tower/issues/138

Design: [approved scope and delivery design](2026-09-10-parallel-workflows-design.md).

Planning baseline: `4007888`, branch `alcaptar/parallelize`.
Project registration: issue added to Project 16 and status set to `In Progress`
successfully on 2026-09-10. This document records planned checks, not passing runs.

## 1. Execution rules

- Scope is `backend/`, `frontend/` and these planning documents. The plugin is
  consumed through existing interfaces; no plugin implementation change belongs
  to this issue.
- Read root `AGENTS.md`, `docs/glossary.md` and
  `backend/conventions/this-repository.md` before implementation.
- All new backend files and tests are TypeScript. Existing JavaScript owners may
  receive focused functional changes without an unrelated migration.
- Code, test names and documentation are English; rendered product copy is Spanish.
- Use @superpowers:test-driven-development for behavior changes. Run each focused
  test first and confirm the intended assertion fails, then implement and rerun.
- Group fixture setup in scenario mothers or shared typed fixtures. Test through
  application behavior or endpoint boundaries, not private-map contents alone.
- Preserve existing assertions about side effects, uncertainty and per-plan
  identity. Replace an obsolete single-selection expectation only with the
  stronger approved multi-workflow behavior and retain its original safety claim.
- Each task below is a 1-3 hour implementation unit, with explicit small steps.
  If one exceeds that budget, split its implementation checkpoints before editing.
- Do not commit, push, open or merge pull requests without the user's explicit
  instruction. The delivery boundaries below are the intended commit/review units,
  not permission to publish them.
- If a repository control refuses, stop and report it; do not bypass the control.

## 2. Delivery boundaries and compatibility

| Delivery | Tasks | Working behavior at merge | Compatibility requirement |
|---|---|---|---|
| 1. Reliable backend discovery | 1-4 | Current frontend completes its full single-plan journey; lists can be refreshed safely | Existing request bodies, response shapes, phase enums and refusal codes still work |
| 2. Multi-workflow workspace | 5-9 | Several plans can be created, selected, acted on and recovered; list refresh is explicit | Old snapshots migrate; rollback keeps the collection; old backend responses remain readable |
| 3. Automatic overview | 10-12 | All active rows receive state/attention updates automatically | Delivery-two behavior remains usable when a refresh fails |

Merge in order and verify each boundary before starting the next delivery. Do not
ship a frontend split where the form can create several plans but only one can be
recovered. Do not remove the legacy storage mirror in this issue.

### Frozen wire contract

```json
{"plans":[{"phase":"planning","request":{"id":"ABC-123","repo":"owner/name","path":"/repo"},"plan":{"id":"ABC-123","repo":"owner/name","issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},"agent":"workspace:4","branch":"feat/7","worktree":"/repo/.worktrees/7"}}]}
```

Keep `phase` restricted to `planning`, `implementing`, `uncertain` on this route.
The frontend's `ready`, pending submission, inactive and connection states belong
to its presentation model. Preserve single-target `/start-plan` and the backend's
existing `repo_list` behavior, including partial results. The new screen sends
independent single-target requests for independent stories.

## 3. Verification commands

Run commands with the indicated working directory, using the tool's `workdir`
parameter. Node.js 24.12 or later is required. If dependencies are absent, verify
the package directory and run `npm ci` there before the first baseline check.

| Working directory | Command | Expected outcome |
|---|---|---|
| `backend/` | `npm run typecheck` | No type errors |
| `backend/` | `npm test` | All tests pass, including yardstick and migration boundary |
| `frontend/` | `npm test` | All tests pass, including yardstick and existing Home journeys |
| `frontend/` | `npm run build` | Type checking and production build succeed |
| repository root | `git diff --check` | No whitespace errors |

There is no separate `lint` package script. The backend and frontend yardstick
suites are the repository's style checks and are included in `npm test`.
Run focused suites during implementation and this full set once at each delivery
boundary. Record pre-existing failures before editing rather than claiming a
green baseline. Required GitHub checks must also pass before any requested merge.

## 4. Delivery one: reliable backend discovery

### Task 1: Characterize the existing public contracts

**Files:**
- Create: `backend/__tests__/infrastructure/parallel-workflows-contract.test.ts`
- Create: `backend/__tests__/fixtures/parallel-workflows.ts`
- Modify: `frontend/src/app/active-plans/client.test.ts`
- Modify: `backend/API.md` only if characterization finds a relevant documentation mismatch

**Steps:**
1. Run the section 3 baseline and record its results before production changes.
2. Build a shared typed fixture using the real `ApiServer`, `StartPlan`, session
   registries and route wiring, with external ports replaced by controlled fakes.
   Use explicit deferred operations rather than sleeps to order concurrent calls.
3. Characterize two plan starts in the same repository, distinct agent handles,
   individual implementation authorization, and the exact existing list envelope.
   Include issue number 7 in two repositories and issues 7 and 8 in one repository.
4. Characterize current frontend parsing of every phase, null story references and
   missing optional `root`/`baseline`; unrelated optional fields must not break it.
5. Run `npx vitest run __tests__/infrastructure/parallel-workflows-contract.test.ts`
   in `backend/` and `npx vitest run src/app/active-plans/client.test.ts` in
   `frontend/`. These characterization checks should pass before refactoring.

**Evidence:** Requests for B reach only B's agent and list entries round-trip
through the existing frontend validator. This is the compatibility fixture reused
at the first delivery boundary.

### Task 2: Make discovery explicit about incomplete evidence

**Files:**
- Modify: `backend/src/infrastructure/worktree-plans.js`
- Modify: `backend/src/domain/value-objects/plans-in-flight.ts` only if the existing listed/refused result needs additional internal evidence
- Create: `backend/__tests__/infrastructure/worktree-plans-refresh.test.ts`
- Modify: `backend/__tests__/fixtures/parallel-workflows.ts`

**Steps:**
1. Add failing boundary tests: a checkout survey failure, a relevant session with
   unknown directory, and an unreadable registry must not produce an authoritative
   empty list. A successfully surveyed checkout with no attending session can.
2. Run `npx vitest run __tests__/infrastructure/worktree-plans-refresh.test.ts`;
   expect the failed-survey assertion to fail against today's empty-list behavior.
3. Stage the discovered watches. Use the existing refused result when discovery
   cannot establish a complete inventory. Preserve the tool reason for the route.
   A failing story lookup may still return a watch with null story: it is metadata,
   not absence evidence.
4. Supply known watch metadata to discovery so unchanged plans do not cause a
   GitHub story lookup on every refresh. Keep session/worktree discovery fresh;
   do not cache a session's existence using this metadata optimization.
5. Run `npm run typecheck` then
   `npx vitest run __tests__/infrastructure/worktree-plans.test.js __tests__/infrastructure/worktree-plans-refresh.test.ts`.

**Evidence:** A failed tool query and a confirmed empty inventory are different
observable outcomes; neither partial directory data nor metadata failure deletes
a plan.

### Task 3: Repeat reconciliation without losing concurrent changes

**Files:**
- Modify: `backend/src/infrastructure/active-plan-recovery.js`
- Modify: `backend/src/infrastructure/active-plans-route.js`
- Modify: `backend/src/infrastructure/implement-plan-route.js`
- Modify: `backend/src/infrastructure/plan-events-route.js`
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Create: `backend/__tests__/infrastructure/active-plan-refresh.test.ts`
- Modify: `backend/__tests__/fixtures/parallel-workflows.ts`

**Steps:**
1. Add failing tests for a second conclusive discovery adding B, removing a
   confirmed absent A, resolving an uncertain phase, and replacing a changed
   agent handle. Keep the wire phases and field names unchanged.
2. Add deferred interleavings: start B while discovery waits; authorize A while
   discovery waits; reject a discovery after it has observed only part of the
   inventory. Neither newer state nor the last valid registry may be lost.
3. Run `npx vitest run __tests__/infrastructure/active-plan-refresh.test.ts` and
   confirm that repeated discovery fails with the current `conclusive` latch.
4. Replace the permanent latch with an injected clock/freshness interval and the
   existing shared in-flight promise. Use 15 seconds at composition. Failures are
   retryable on the next call and do not mark the failed inventory fresh.
5. Add explicit registry snapshot and conditional removal/replacement operations.
   The predicate for changing an existing entry is:

   ```ts
   const unchanged = current !== null &&
     current.watch === captured.watch && current.phase === captured.phase
   ```

   Only entries captured before discovery and still unchanged may be removed or
   replaced by that result. An already implementing session must not regress to
   planning because its marker write is still pending. An uncertain session may
   progress when new positive evidence appears.
6. Preserve unchanged watchers. For changed/removed sessions stop both watcher
   families before starting the appropriate recovered watcher. Return the current
   registry after applying the staged refresh, not the raw discovery snapshot.
7. Run `npm run typecheck` then
   `npx vitest run __tests__/infrastructure/active-plan-recovery.test.js __tests__/infrastructure/active-plan-refresh.test.ts __tests__/infrastructure/parallel-workflows-contract.test.ts`.

**Evidence:** An older inventory cannot overwrite a newer start or authorization.
An inconclusive refresh returns `active-plans-recovery-inconclusive` while retaining
the previous records internally. Existing clients still understand every response.

### Task 4: Prevent replaced watchers from resuming

**Files:**
- Modify: `backend/src/infrastructure/review-watch.js`
- Create: `backend/__tests__/infrastructure/review-watch-replacement.test.ts`
- Modify: `backend/__tests__/fixtures/parallel-workflows.ts`
- Modify: `backend/API.md`

**Steps:**
1. Add a failing test that suspends old A's read, replaces A's session, then resolves
   the old read. Assert no command reaches old A and the replacement remains active.
   Repeat with a delayed rejection and a stop followed by a restart of the same key.
2. Run `npx vitest run __tests__/infrastructure/review-watch-replacement.test.ts`.
3. Compare watcher identity at every continuation and cleanup, rather than checking
   only `live.has(key)`. The existing attended set can act as the generation token:

   ```js
   #isCurrent(key, attended) {
     return this.live.get(key) === attended
   }
   ```

   Guard after awaited reads and before delivering an action; an obsolete loop's
   catch handler must not delete the replacement. Keep attended comments intact
   for an unchanged watcher. Stop cannot retract a command already sent, so tests
   distinguish an in-flight command from a newly issued obsolete one.
4. Run
   `npx vitest run __tests__/infrastructure/review-watch.test.js __tests__/infrastructure/review-watch-replacement.test.ts`.
5. Document refresh freshness, conservative failure handling and live-session
   meaning in `API.md`. Run all section 3 commands.
6. Perform the delivery-one smoke journey in section 8 using the current frontend.

**Release checkpoint:** Delivery one is complete only when the original frontend
still creates, reviews, implements and recovers a plan. It does not introduce new
wire phases, automatically retry starts or change plugin behavior.

## 5. Delivery two: a usable multi-workflow workspace

### Task 5: Add collection persistence with a legacy mirror

**Files:**
- Create: `frontend/src/app/workflows/Workflow.types.ts`
- Create: `frontend/src/app/workflows/WorkflowKey.ts`
- Create: `frontend/src/app/workflows/storage.ts`
- Create: `frontend/src/app/workflows/storage.test.ts`
- Create: `frontend/src/__scenarios__/WorkflowMother.ts`
- Reuse: `frontend/src/app/workflow-snapshot/storage.ts`
- Reuse: `frontend/src/app/workflow-snapshot/validation.ts`

**Steps:**
1. Add migration tests for legacy versions 1 and 2, planning/ready/implementing,
   canonical roots, baseline notices and free-text requests. Add rollback followed
   by upgrade, storage failures and a malformed collection entry alongside a valid
   entry. Preserve valid entries and do not overwrite unreadable data on load.
2. Run `npx vitest run src/app/workflows/storage.test.ts`; expect the missing
   collection adapter to fail before implementation.
3. Define a stable plan key separate from a local submission key. One concrete
   identity implementation is:

   ```ts
   export class WorkflowKey {
     static forPlan(repo: string, issue: number): string {
       return `${repo}#${issue}`
     }

     static forSubmission(id: string): string {
       return `request:${id}`
     }
   }
   ```

4. Implement an injected storage adapter with `load`/`save`, using
   `control-tower.workflows`, version 1. Persist `selectedKey`, the new-request
   draft, each request/plan snapshot and each review draft. Persist pending
   request identifiers and their pre-submission plan keys, not promises or timers.
5. Read the old single-workflow key when initializing the collection. On every
   successful collection save, mirror the selected confirmed workflow using the
   existing version-2 serializer. Keep storage failure handling independent of
   successful in-memory updates.
6. On upgrade after rollback, union a distinct legacy plan into the collection.
   Do not replace an existing collection entry's drafts with the legacy snapshot.
   Treat reloaded pending submissions as unresolved until recovery identifies a
   plan; do not POST them again.
7. Run
   `npx vitest run src/app/workflows/storage.test.ts src/app/workflow-snapshot/storage.test.ts`.

**Evidence:** Downgrading to the old screen cannot delete the collection. Upgrading
again retains A and B and imports a distinct C created while using the old screen.

### Task 6: Own selection and pending submissions above the detail

**Files:**
- Create: `frontend/src/app/workflows/WorkflowWorkspace.ts`
- Create: `frontend/src/app/workflows/WorkflowWorkspace.test.ts`
- Create: `frontend/src/app/workflows/useWorkflowWorkspace.ts`
- Modify: `frontend/src/app/workflows/Workflow.types.ts`
- Modify: `frontend/src/__scenarios__/WorkflowMother.ts`

**Steps:**
1. Add failing behavior tests for selecting A/B/new request, starting B while A's
   response is deferred, and two responses arriving in reverse order. Assert the
   selected key and each request's state through the public workspace snapshot.
2. Run `npx vitest run src/app/workflows/WorkflowWorkspace.test.ts`.
3. Implement a workspace application controller with injected start/list/review/
   implement clients, storage and request-identifier supplier. Expose subscribe,
   snapshot and user actions; provide a thin React subscription hook. The
   collection owns each pending promise's target independently of the mounted
   detail or selected row.
4. The minimal public actions are `select`, `newRequest`, `updateRequestDraft`,
   `submitRequest`, `updateReviewDraft`, `askChanges`, `implement` and `refresh`.
   All per-plan actions accept the stable key. Each async action captures a
   monotonically changing operation generation for its target; ignore answers
   belonging to an obsolete generation, not answers merely hidden by selection.
5. Preserve submitted input while preparing. A known refusal affects that request
   alone. A transport or malformed-response failure produces an unresolved
   submission, not permission to repeat it automatically. Disable duplicate
   submits for that pending row; a different request remains available.
6. Reconcile by stable plan identity and current backend agent handle. Preserve
   request text, baseline and drafts when the backend omits them. Keep missing
   plans visible but inactive, with actions unavailable and explicit recovery.
7. Run the focused tests and storage tests together.

**Evidence:** Switching selection cannot cancel a request or route its result to
another plan. Two workflows do not share an error, sending flag or review draft.

### Task 7: Render a permanent list and a selected detail

**Files:**
- Modify: `frontend/src/pages/home/Home.tsx`
- Modify: `frontend/src/pages/home/Home.css`
- Create: `frontend/src/app/workflows/components/workflow-list/WorkflowList.tsx`
- Create: `frontend/src/app/workflows/components/workflow-list/WorkflowList.css`
- Create: `frontend/src/app/workflows/components/workflow-detail/WorkflowDetail.tsx`
- Create: `frontend/src/pages/home/__tests__/Home.parallelWorkflows.test.tsx`
- Modify: `frontend/src/pages/home/__tests__/helpers.tsx`
- Modify: `frontend/src/pages/home/__tests__/Home.implementPlan.test.tsx`

**Steps:**
1. Add a rendered journey: start A, choose `Nuevo plan` while A is planning, start
   B in the same repository, and switch A -> B -> A. Assert both rows remain and
   each selected detail shows its own issue and agent. Include keyboard selection.
2. Run `npx vitest run src/pages/home/__tests__/Home.parallelWorkflows.test.tsx`.
3. Compose the controller and concrete adapters at `Home`. Extract the current
   three stages into `WorkflowDetail`. Render list, new-request selection and
   selected detail independently. Keep existing tool status, baseline notices,
   issue links and implementation progress presentation.
4. Use stable row keys; never identify a row by original ticket alone. Render
   preparing and unresolved submissions as selectable rows before issue creation.
   Keep the selected row visible and accessible in a narrow layout too.
5. Replace the old `Arrancar otro plan` reset behavior with selecting a new request.
   Retain its assertion that starting a new request does not send a POST until the
   person submits. Its new assertion is that prior work remains recoverable.
6. Run
   `npx vitest run src/pages/home/__tests__/Home.parallelWorkflows.test.tsx src/pages/home/__tests__/Home.implementPlan.test.tsx src/pages/home/__tests__/Home.baseline.test.tsx`.

**Evidence:** The list never disappears merely because a person selects a plan,
edits a new request or starts implementation.

### Task 8: Preserve drafts and action identity across selection

**Files:**
- Modify: `frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.tsx`
- Modify: `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.tsx`
- Modify: `frontend/src/app/implement-plan/components/implement-plan-action/ImplementPlanAction.tsx`
- Modify: `frontend/src/app/workflows/WorkflowWorkspace.ts`
- Modify: `frontend/src/app/workflows/components/workflow-detail/WorkflowDetail.tsx`
- Modify: `frontend/src/pages/home/__tests__/Home.parallelWorkflows.test.tsx`
- Modify: `frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.test.tsx`
- Modify: `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.test.tsx`
- Modify: `frontend/src/app/implement-plan/components/implement-plan-action/ImplementPlanAction.test.tsx`

**Steps:**
1. Add rendered tests for a draft on A surviving B selection and reload; a delayed
   review answer for A while B is selected; and implementation B targeting B's
   latest backend agent handle. Keep the original single-plan action tests.
2. Run `npx vitest run src/pages/home/__tests__/Home.parallelWorkflows.test.tsx`.
3. Move draft ownership and sending outcomes into the workspace; make the three
   components render controlled values and invoke injected callbacks. A successful
   review clears only the submitted target's draft and only if its generation is
   current. Selection changes do not implicitly clear errors or confirmation copy.
4. Use one detail observer for the selected plan in this delivery. Its result
   callback captures the plan key and generation. Switching selection stops the
   old detail observation and cannot apply its late result to the new selection.
5. Run
   `npx vitest run src/app/start-plan src/app/review-plan src/app/implement-plan src/pages/home/__tests__/Home.parallelWorkflows.test.tsx src/pages/home/__tests__/Home.reviewPlan.test.tsx`.

**Evidence:** Existing form validation remains intact, including free-text-only
requests and baseline feedback. Drafts and asynchronous action responses are
owned by their original workflow.

### Task 9: Recover the collection and ambiguous starts

**Files:**
- Modify: `frontend/src/app/workflows/WorkflowWorkspace.ts`
- Modify: `frontend/src/app/active-plans/client.ts`
- Modify: `frontend/src/app/start-plan/client.ts`
- Modify: `frontend/src/app/start-plan/client.test.ts`
- Modify: `frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx`
- Modify: `frontend/src/pages/home/__tests__/Home.startPlan.test.tsx`
- Modify: `frontend/src/pages/home/__tests__/Home.parallelWorkflows.test.tsx`
- Modify: `frontend/src/__scenarios__/WorkflowMother.ts`
- Modify: `frontend/README.md`

**Steps:**
1. Add recovery journeys for two saved plans, a saved plan plus a newly discovered
   plan, changed session handles, no-longer-active plans and an inconclusive list.
   Assert backend phases win while local descriptions, baseline and drafts survive.
2. Add unresolved-start tests for two free-text requests in one repository, several
   matching recovered plans, and invalid successful start responses. Never match
   with `find` on `id + repo + path` alone. Preserve existing network-failure tests.
3. Run
   `npx vitest run src/pages/home/__tests__/Home.restoreWorkflow.test.tsx src/pages/home/__tests__/Home.startPlan.test.tsx src/pages/home/__tests__/Home.parallelWorkflows.test.tsx src/app/start-plan/client.test.ts`.
4. Validate start response identity and required fields before attaching a plan.
   Recover an uncertain request automatically only when a conclusive before/after
   inventory yields one unambiguous matching new plan and no competing unresolved
   submission could claim it. Otherwise present explicit candidate selection;
   never replay the POST or assume null story references identify the same request.
5. Add a manual `Actualizar` list action. Failed refresh retains rows and shows the
   existing recovery explanation. Shared backend-discovery uncertainty blocks
   mutations until confirmation; a per-plan operation failure affects only its row.
6. Verify old wire payloads from task 1 still load. Document new-workflow navigation,
   inactive/unresolved meaning and storage compatibility in `frontend/README.md`.
7. Run all section 3 commands and the delivery-two smoke journey in section 8.

**Release checkpoint:** Ship tasks 5-9 together. Collection creation, drafts,
recovery and compatibility must all work before exposing the multi-plan screen.
The user can manually refresh the list until delivery three adds automation.

## 6. Delivery three: automatic overview

### Task 10: Share per-plan observations between list and detail

**Files:**
- Create: `frontend/src/app/workflows/WorkflowObservations.ts`
- Create: `frontend/src/app/workflows/WorkflowObservations.test.ts`
- Modify: `frontend/src/app/workflows/WorkflowWorkspace.ts`
- Modify: `frontend/src/app/workflows/Workflow.types.ts`
- Modify: `frontend/src/app/workflows/components/workflow-detail/WorkflowDetail.tsx`
- Modify: `frontend/src/app/plan-events/components/plan-progress/PlanProgress.tsx`
- Modify: `frontend/src/app/plan-events/components/plan-progress/PlanProgress.test.tsx`
- Modify: `frontend/src/app/implement-progress/components/implement-progress/ImplementProgress.tsx`
- Modify: `frontend/src/app/implement-progress/components/implement-progress/ImplementProgress.test.tsx`
- Modify: `frontend/src/app/plan-events/usePlanProgress.ts`
- Modify: `frontend/src/app/plan-events/usePlanProgress.test.ts`
- Modify: `frontend/src/app/implement-progress/useImplementProgress.ts`
- Modify: `frontend/src/app/implement-progress/useImplementProgress.test.ts`
- Reuse: `frontend/src/app/plan-events/client.ts`
- Reuse: `frontend/src/app/implement-progress/client.ts`

**Steps:**
1. Add fake-timer tests for two planning subscriptions, two independent non-
   overlapping implementation polls and one shared observation when selecting a
   row. Assert transitions to implementation close the matching planning stream.
2. Run `npx vitest run src/app/workflows/WorkflowObservations.test.ts`.
3. Move active observations into an injected owner keyed by stable identity plus
   session generation. Reuse existing event parsing, state mapping and intervals.
   Pass observed state into list/detail; do not leave a second polling hook mounted
   inside the detail. Adapt the existing hooks to subscribe to the shared owner,
   retaining their state vocabularies and lifecycle regression tests rather than
   keeping duplicate timers or replacing their coverage with weaker assertions.
4. Add planning-ready, implementation-review, fixing, failed-read and disconnected
   results to each row's last observation. A failure from A does not overwrite B
   or stop B's observer. An unreadable run is not evidence of success or inactivity.
5. Run
   `npx vitest run src/app/workflows/WorkflowObservations.test.ts src/app/plan-events src/app/implement-progress src/pages/home/__tests__/Home.planEvents.test.tsx src/pages/home/__tests__/Home.implementProgress.test.tsx`.

### Task 11: Refresh the list without overlapping requests

**Files:**
- Modify: `frontend/src/app/workflows/WorkflowObservations.ts`
- Modify: `frontend/src/app/workflows/useWorkflowWorkspace.ts`
- Modify: `frontend/src/app/workflows/WorkflowObservations.test.ts`
- Modify: `frontend/src/pages/home/__tests__/Home.parallelWorkflows.test.tsx`

**Steps:**
1. Add tests for a delayed list request, manual refresh during an automatic one,
   hidden/visible transitions, unmount, session replacement and React StrictMode.
   Assert exactly one owned request/subscription per target and no POST retries.
2. Run `npx vitest run src/app/workflows/WorkflowObservations.test.ts`.
3. Schedule the next list refresh 15 seconds after the preceding request settles;
   share its in-flight promise with manual refresh. Keep existing per-plan
   implementation intervals. Pause automatic observation when the page is hidden
   and refresh on visibility return, using injected lifecycle/timer adapters.
4. Invalidate obsolete callbacks when a session disappears or is replaced. Retain
   inactive rows and last observations; stop their observers without stopping an
   unrelated live plan. Never call `/external-tools` from this refresh loop.
5. Run
   `npx vitest run src/app/workflows/WorkflowObservations.test.ts src/pages/home/__tests__/Home.parallelWorkflows.test.tsx`.

### Task 12: Render attention states and verify the final journey

**Files:**
- Modify: `frontend/src/app/workflows/components/workflow-list/WorkflowList.tsx`
- Modify: `frontend/src/app/workflows/components/workflow-list/WorkflowList.css`
- Modify: `frontend/src/pages/home/__tests__/Home.parallelWorkflows.test.tsx`
- Modify: `frontend/README.md`
- Modify: `backend/API.md` if the verified refresh timing differs from delivery one

**Steps:**
1. Add a rendered journey with A implementing, B ready for plan approval and C
   waiting for pull-request review. Assert Spanish attention copy, issue identity
   and the correct selected detail. Include inactive and disconnected rows.
2. Run `npx vitest run src/pages/home/__tests__/Home.parallelWorkflows.test.tsx`.
3. Render row summaries from shared observations. Use text as well as color. Keep
   list order stable across state updates so selection and keyboard focus do not
   move underneath a person. Display last-known state with its connection warning
   instead of inventing a terminal success state.
4. Document automatic refresh, visibility behavior and the preserved manual refresh
   action. Run all section 3 checks and all section 8 smoke journeys.

**Release checkpoint:** The issue is complete when both plans keep progressing,
attention is visible without selecting each row, and all compatibility journeys
pass on the actual delivery revision.

## 7. Compatibility matrix and rollback

| Backend | Frontend | Required behavior |
|---|---|---|
| Current | Current | Baseline single-plan journey remains documented and tested |
| Delivery 1 | Current | Same controls, fields and phases; recovery can now refresh |
| Delivery 1 | Delivery 2 | Multi-plan creation, selection, actions and manual recovery |
| Delivery 1 | Delivery 3 | Automatic observation plus all delivery-two behavior |
| Current | Delivery 2/3 | Existing wire responses still parse; current backend discovery limitations remain, and missing optional data does not crash the screen |

Reverting a frontend delivery must not issue stop commands or delete the new
collection key. The old screen can read its mirrored selected workflow. Returning
to the new screen must recover the collection and any distinct legacy plan.

Reverting the backend restores its old discovery behavior without a browser data
migration. The new screen remains able to use existing routes; reliable removal
and repeat discovery require delivery one and are not claimed on an old backend.

Record exact revisions, automated results and smoke observations at each delivery
boundary. Run the unchanged old frontend client tests against delivery-one backend
response fixtures as well as the real route contract tests. Do not silently replace
the compatibility payloads with shapes that only the new client understands.

## 8. Manual smoke journeys at release boundaries

Use a dedicated fixture repository and two independent test stories. These steps
create real worktrees, issues and agent sessions; perform them only as part of
authorized implementation verification, not while merely writing this plan.

### Every delivery: existing single-plan journey

1. Start a plan from a ticket or free-text request and verify the baseline notice.
2. Wait for the plan, request a change, and confirm the intended agent receives it.
3. Authorize implementation once; verify progress and its pull-request link.
4. Reload while planning and while implementing; confirm no start or authorization
   is repeated and the backend's current session is used.
5. Check external-tool status remains available from the top bar.

### Delivery two and three: independent work

1. Start A, create B while A is preparing, and select either without losing the other.
2. Use the same repository for both; confirm separate plan issues, worktrees and agents.
3. Leave a review draft on A, switch to B, return to A and reload; verify the draft.
4. Authorize B and confirm only B transitions. Keep A available for plan review.
5. Restart the backend with both sessions alive; recover both and verify handles.
6. Interrupt a start response; verify an unresolved row and no automatic duplicate.
7. Remove one fixture session, refresh and verify an inactive row rather than a
   completed label. The remaining plan must still work.
8. Load a legacy snapshot, upgrade, roll back to the old frontend, create a distinct
   plan there and upgrade again; verify the saved collection and new legacy plan.

### Delivery three: observation lifecycle

1. Keep A selected while B becomes ready; verify B's attention state appears.
2. Hide and show the page; verify observation resumes without duplicate requests.
3. Fail a progress read for A; verify B continues updating and A remains identifiable.
4. Fail list discovery; verify the previous rows remain with an uncertainty message.

## 9. Handoff

Execution of delivery one started on 2026-09-10. The initial baseline passed:
1,343 backend tests, backend type checking, 663 frontend tests and the frontend
production build. Implementation verification is recorded separately below.
Execute tasks in order,
report evidence at each delivery checkpoint and retain the user requirement that
every merged intermediate version must remain usable. Publishing or merging any
delivery requires an explicit user instruction.

### Delivery-one execution evidence, 2026-09-10

- Implemented repeat discovery with injected 15-second freshness, shared in-flight
  reads, staged phase decisions and conditional registry updates.
- Preserved partial discovery evidence while marking it inconclusive; retained
  live handles that cannot be matched after directory or title changes.
- Protected sessions throughout pending implementation actions, including marker
  persistence, so an older action cannot overwrite a newly discovered agent.
- Invalidated replaced review watcher generations, including late reads, failures
  and recovered baselines.
- Added four typed backend suites and a shared fixture, plus frontend compatibility
  coverage for a mixed-phase list without new required fields.
- Observed new behavioral assertions fail before each production correction.
- Independent review reproduced two additional races/absence cases. Added failing
  regression tests, fixed both, and obtained a read-only follow-up confirmation.
- Final full backend run: **60 test files, 1,391 tests passed**; type checking passed.
- Final full frontend run: **32 test files, 664 tests passed**; production build
  and its TypeScript check passed. The built application asset names match the
  baseline build because no frontend runtime code changed in this delivery.
- Yardstick style checks passed as part of both full suites. `git diff --check`
  passed. Local runtime: Node.js `v26.8.2`.

The user selected `jjponz/repo-pulse` at `/Users/acapdev/repos/repo-pulse` and
started the application from cmux on port 8791. The live browser journey has now
created plans 55 and 56, recovered both choices, and requested and observed a
published revision of plan 55. See the
[live smoke evidence](2026-09-10-parallel-workflows-smoke.md).

The live checkpoint is now complete: A was authorized and implemented, B stayed in
planning, the browser and restarted backend recovered both sessions, and the same
test pull request completed a correction round. The generated test plan's invalid
global check was corrected through review and verified independently; its earlier
green result is not used as strict-scope evidence.

Two additional backend fixes were required by the live smoke:

- `ReadFixesAskedParams.includeHistory` and the recovered watcher's injected
  baseline query prevent an old review from being replayed after a restart during
  corrections. Normal polling remains status-gated.
- `CmuxPlanAgents` waits on the injected one-second settling interval between
  pasting an instruction and Enter. A new long review was delivered automatically
  after this fix; the earlier review had required manual Enter.

Both fixes have failing-before/passing-after regressions and an independent
read-only review. Final verification: **1,402 backend tests in 62 files**, backend
type checking, **664 frontend tests in 32 files**, and frontend build passed.
Final test pull request: `jjponz/repo-pulse#57`, open and unmerged at `91f3502`, with
its GitHub Actions check passing. See the live evidence for timings, negative
scope checks and artifact locations. Delivery-one changes are ready for their
integration review; deliveries two and three have not started.
