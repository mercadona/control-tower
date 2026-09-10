# Parallel Workflows Design

Issue: https://github.com/mercadona/control-tower/issues/138

Status: the user approved the product scope and architecture in conversation.
The user additionally requires every intermediate pull request to preserve a
working application. The delivery details below make that requirement explicit.

## Goal

Manage several independent user stories from one application, including stories
in the same repository. Each story has its own plan, worktree, agent, review
actions and progress. A persistent work list and a selected detail replace the
single-workflow screen.

## Existing foundation

- `StartPlan` opens a plan issue, prepares a worktree and launches a cmux agent.
- `PlanSessions`, `ActivePlans` and `ReviewWatch` distinguish plans by repository
  and plan issue number.
- The backend already exposes per-plan review, implementation and progress routes.
- `Home` has one workflow and one browser snapshot. Starting another plan during
  implementation discards that snapshot but does not stop the previous agent.
- Recovery offers a temporary choice between multiple plans, then discards the list.
- `ActivePlanRecovery` stops discovering after its first conclusive result.
- `WorktreePlans` currently treats a failed checkout survey as an empty result for
  that checkout. That result cannot safely justify removing an active plan.

## Product behavior

The work list remains visible while the person opens a new request, reviews a
plan or follows implementation. Each row identifies the story when available,
repository, plan issue and last observed state. A recovered free-text request
without its original description falls back to the plan issue number.

Selecting another row preserves review drafts, request drafts and in-flight
actions. Starting a request immediately adds a local preparing row. It does not
prevent starting a different request or returning to an existing plan. A response
updates the row that initiated it, regardless of what is selected when it arrives.

The selected detail reuses the existing three-stage workflow. A new request is a
separate selection, not a reset of the collection. The selected row and drafts
survive reload. Stored execution states require backend confirmation before they
authorize actions.

## Ownership and boundaries

### Aggregates and identity

A plan is the consistency boundary. There is no aggregate containing all plans;
the list is a read projection of independent plans. Preserve the current domain
layout rather than introducing an aggregate framework for this feature.

Reuse `RepositoryName`, `PlanIssue`, `CheckoutRoot`, `WorkspaceLocation` and
`PlanWatch`. The stable key is repository plus plan issue number. The original
story reference is display/context data, and the agent handle identifies the
current session, not the stable plan.

Before a plan issue exists, use a browser-generated local request identifier.
It is a presentation identifier and is not passed off as backend idempotency.
Pending requests also retain the backend plan keys observed before submission.

### Dependency flow

```text
React components -> workflow application controller -> client/storage ports
                                                   -> browser adapters

HTTP routes -> application/domain behavior -> workspace/agent/progress ports
                                          -> existing infrastructure adapters
```

The frontend composition point supplies clients, storage, identifiers and timers.
The backend entrypoint supplies discovery, clocks and existing adapters. Domain
decisions do not read browser globals, invoke cmux or execute GitHub commands.
Boundary values are validated using the repository's TypeScript conventions.

### State ownership

The backend owns live sessions, implementation authorization and observed
execution phases. The frontend owns selection, drafts, pending submissions and
last-observed presentation state. Every asynchronous callback carries a plan key
or local request identifier and an operation generation.

A transport failure is not a failed launch: the request may already have caused
side effects. Recovery must never select the first request-shaped match. Match
only an unambiguous newly observed plan; if identity remains ambiguous, keep the
request unresolved and offer an explicit choice of candidates. Automatic POST
retries are not introduced.

## Backend reconciliation

Continue serving `{plans: [...]}` with the existing `planning`, `implementing`
and `uncertain` phase vocabulary and existing refusal codes. Refresh discovery on
subsequent list requests with an injected short freshness interval and a shared
in-flight discovery promise.

Stage discovery before applying changes. A failed survey, incomplete relevant
session directory information or unreadable registry does not establish absence.
An inconclusive refresh preserves the previous registry and answers the existing
recovery refusal; the next request can retry. Metadata reads may degrade to the
known story or a null story, but cannot erase locally retained descriptions.

On a conclusive refresh, add newly discovered plans, re-evaluate uncertain plans,
replace changed sessions and remove confirmed absent sessions. Preserve watchers
for unchanged sessions, including their already-attended review comments.
Replacing or stopping a watcher invalidates its generation so an old asynchronous
loop cannot resume or stop its replacement.

Capture the known plans before discovery. Apply removals and replacements only
when the corresponding current watch and phase still match that snapshot. A plan
started or authorized while discovery was waiting must survive an older result.
Do not hold a global lock around worktree preparation or implementation.

Absence means that no live session was confirmed, not that implementation
succeeded. The frontend retains the row with a Spanish inactive-state explanation.
This feature does not infer a successful merge from a missing session or run file.

## Browser persistence and rollback

Add `control-tower.workflows` with a versioned collection format. Read the existing
`control-tower.workflow` versions 1 and 2 when no collection exists, preserving the
stored plan, canonical root, baseline and request text. Validate both formats.

During these deliveries, save the collection and maintain a version-2 snapshot of
the selected confirmed workflow under the old key. The old frontend can still
read one plan, while its writes or removals cannot delete the collection. On
return to the new frontend, merge a distinct legacy plan created during rollback
without overwriting newer collection data for the same identity. Reconcile all
execution phases with the backend rather than trusting either storage version.

Do not remove compatibility reads or the legacy mirror in these deliveries.
An unavailable storage adapter leaves the in-memory workspace usable. Reloaded
preparing rows become unresolved requests to recover; promises are never stored.

## Observation and resource ownership

Delivery two supports explicit list refresh and detailed observation of the
selected plan. Delivery three adds automatic list refresh and attention summaries
for all known active plans.

Use one workspace-level subscription per planning plan and one non-overlapping
polling loop per implementing plan. Detail and list consume the same observations.
Use the existing implementation intervals of 3 seconds while working and 15
seconds awaiting review, and a 15-second list refresh interval. Inject timers.
Stop automatic background observation while the document is hidden and refresh
when visible again. Stop all observation on unmount or confirmed session removal.
Do not periodically probe external-tool credentials.

## Deliveries

1. **Reliable backend discovery.** Existing frontend works against the updated
   backend with the same endpoint contracts. Repeated recovery does not duplicate
   review delivery or lose newly started plans.
2. **Multi-workflow frontend.** Creation, selection, per-plan actions, persistence,
   migration and manual recovery ship together as a usable screen. Existing
   baseline notices, tool status and implementation detail remain available.
3. **Automatic overview.** Add background refresh and per-plan attention summaries
   to the already usable multi-workflow screen.

Integrate in that order. Each pull request is releasable at its own boundary and
does not require the next pull request to repair functionality. Internal tasks
may be smaller than a pull request. Backend and frontend version skew must remain
readable; an older backend cannot provide discovery improvements it never had.

## Verification criteria

- Two plans in one repository and equal issue numbers in different repositories
  remain distinct through preparation, review, implementation and reload.
- A delayed answer for A never overwrites selection, phase, errors or drafts of B.
- Requesting changes or implementation for B targets B alone.
- Single-plan creation, baseline display, review changes, authorization, progress
  and pull-request links remain functional at each delivery boundary.
- Old browser snapshots migrate, and rollback followed by upgrade preserves the
  collection and imports distinct plans created by the old frontend.
- Backend discovery failures retain evidence; confirmed absence never renders as
  successful completion.
- Repeated refresh and React StrictMode do not multiply watchers or requests.
- Every delivery passes backend type checking and tests, frontend tests and
  build, including the yardstick suites used as repository style checks.

Implementation steps: [parallel workflows plan](2026-09-10-parallel-workflows.md).
