# #326 — the intermediate gate retires: the review endpoint, its wiring and the implied `plan` gate

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

Today the loop stops twice between a plan and its implementation. The first stop is an endpoint:
`ReviewPlanRoute` (`backend/src/infrastructure/review-plan-route.ts`, `PATH = '/review-plan'`) is
mounted by `ApiServer.#route()` and posts a `-REVIEW <changes>` comment on the plan's issue through
`AskPlanChanges` (`backend/src/application/actions/ask-plan-changes.ts`) and
`GhPlanIssues.askChanges`. A watch reads that comment back: `CtApi.#planReviews` wires `ReviewWatch`
a first time with `ReadChangesAsked` + `ReviewPlan`, `StartPlanRoute` starts it, `ActivePlanRecovery`
restarts it and `ImplementPlanRoute` stops it. While that watch has an undelivered change, or while
`ReadPlanProgress` reads the issue's newest `-REVIEW` as newer than the plan's last commit,
`PlanState.REVIEWING` travels down `GET /plan-events/:issue` as `data: {"state":"reviewing"}` and
`ReviewGatePolicy` makes `POST /implement-plan` refuse with `plan-under-review`. The page mirrors all
of it: `frontend/src/app/review-plan/` posts the changes, `usePlanProgress` carries a `reviewing`
phase and `ImplementPlanAction` renders an `under-review` banner.

The second stop is a label: `gatesForType` (`plugin/scripts/gates.js`, line 149) appends `'plan'` to
every slice of every epic whatever its `Tipo`, so every groom writes a `gate:plan` label and every
kickoff tells the agent to publish its plan and wait for a human `-OK <nonce>`.

D-3 and D-8 retire the review; D-14 retires the implied gate and parks the rest of the go protocol
as debt A-3. This slice does both and leaves the pull request's fix loop — the **second** `ReviewWatch`
wiring, `ReadFixesAsked` and `RequestFixes` — exactly where it is.

### Desired end state

- `POST /review-plan` is no longer routed: the path falls to `Failures.nothingMatched` and answers
  404 `{"code":"not-found","detail":"not found"}`. `ReviewPlanRoute`, `AskPlanChanges`,
  `ReadChangesAsked`, the `ReviewPlan` action, `ReviewGatePolicy` and `CtApi.#planReviews` are gone,
  and so is `frontend/src/app/review-plan/`.
- The plan events vocabulary is `writing` and `ready` only: `PlanStateValue` is
  `'writing' | 'ready'`, `PlanState` declares two constants, and `GET /plan-events/:issue` can emit
  no third `state`. The frontend's own half of that contract (`PlanEvents.types.ts`,
  `usePlanProgress`, `PlanProgress`) declares the same two.
- No slice is born with the plan gate unless its own row asks for it: `gatesForType(type)` returns
  `TYPE_GATES[type] ?? []` and nothing else, so a groom produces no `gate:plan` label and a kickoff
  names no `plan` gate — unless the row's `Gate` column writes `plan`, which still works.
- The pull request fixes still reach the agent through the surviving watch: `CtApi.#pullRequestReviews`
  is untouched, `ReadFixesAsked`, `RequestFixes`, `PlanAgents.fix` and `ReviewWatch.start` /
  `startRecovered` / `stop` all stand, and `pull-request-review-loop.test.ts` still passes unchanged.
- `API.md` no longer documents the retired endpoint: no `## POST /review-plan` section, no
  `reviewing` frame, no `plan-under-review` refusal.
- The observability the slice declared is emitted by this production code through the channels this
  repo already instruments — no new log line is added. A groom prints the labels it creates
  (`ct-groom.mjs`, `new labels … in <repo>: …`, and the `--dry-run` plan's `issues[].labels`), and
  after this slice `gate:plan` is not among them; `PlanEvents.frameFor` writes the stream's only
  `state` field, whose vocabulary is now the two-member `PlanState`.

### Out of scope

- 🚫 `ReadFixesAsked`, `RequestFixes` and the **second** `ReviewWatch` wiring
  (`CtApi.#pullRequestReviews`): they stay byte for byte as they are, `log: new MemoryReviewLog()`
  included. Consequence, declared and not silently taken: `ReviewLog.lastAskedAt` and
  `MemoryReviewLog` survive with no reader once `ReadPlanProgress` stops asking them. That is a
  `conventions/simplicity.md` burden this slice cannot discharge without touching a protected
  wiring, so it is declared here and left to a person, which is what that document asks for.
- 🚫 The go protocol's own modules: `disk-go-registry.ts`, `PlanIssues.answerGo`,
  `GhPlanIssues.GO_TOKEN` / `goArgvFor` / `goBodyFor`, `PlanGoNotAnswered`, `GoNotRecorded`,
  `plugin/scripts/ct-go.mjs`, `ct-watch-go.mjs`, `go-channel.js`, `go-registry.js`,
  `go-response.js` and `dispatch-check.mjs`'s exit-9 ladder. Debt A-3 of the spec retires them in
  later work; here only the **default** dies.
- `GATES.plan` itself stays in the vocabulary with both its texts: a row that writes `Gate: plan`
  still gets the gate. What changes is only that no row gets it without asking.
- `POST /implement-plan` stays routed and keeps minting the go. Slice #6 retires it.
- `cmux-plan-agents.ts` stays; only its `review()` method leaves, with the port method it implements.
  Slice #6 takes cmux out of the backend.
- No new endpoint, no new frontend screen, no change to the workflow stages the page already renders.

## 2. Closed decisions (take as given)

The first twenty-five rows are the epic's frozen decisions, copied from the issue's
`## Decisiones congeladas` section in its own words; the rows after them are this plan's.

| Decision | Value |
|---|---|
| **D-1 · The entrance is a conversation with a real terminal** | the cabin hosts the brainstorming and spec session as an interactive `claude` in a PTY streamed to the page, not a structured chat and not a step left outside the app. |
| **D-2 · The backend automates the coordination between issues and controls the agents' sessions** | `/start-plan` does what `/ct-next` does, inside the backend, with `claude -p`. The backend is a **program**, not a session and not a model: it selects the next issue, checks its dependencies, prepares its execution and chains the work. The sessions do not disappear and neither do the agents that do the work inside a slice — the backend owns and drives them. |
| **D-3 · There is no human gate between the plan and its implementation** | the authorisation is GATE 2 and the earlier gates are respected. |
| **D-4 · The slices run one after another and nobody is asked which is next** | the order was decided once in the slices table and the dispatcher derives the rest. |
| **D-5 · One slice in flight and the relay at the pull request** | the `--cap` frees when the pull request opens while `area:` and `touches:` stay held until the merge, so a merge only holds back what depends on it. |
| **D-6 · Gates 1 and 2 are acts of the app, with its own yardstick** | the freeze and the promotion are buttons the program answers for, never lines the conversation's agent writes. |
| **D-7 · GATE 3 is entirely human and stays on GitHub** | the merge is the only act with a permanent external effect and no program performs it: a person merges on GitHub, and all the app does is notice, by sweeping, so that it can dispatch whatever the merge unblocked. The app never writes to a pull request, there is no merge button anywhere in the cabin, and no automation may acquire one without reopening this decision. |
| **D-8 · The plan review retires and the review is the pull request** | the slice's plan is written by its agent and judged by `ct-judge` against its issue; a person reads it in the diff. |
| **D-9 · A slice has a tab that shows its session and takes a message** | with the implementation headless there is no screen to mirror, so the tab renders the calls' stream and writing is a message into the live conversation. |
| **D-10 · Everything new under `backend/` is TypeScript** | and the plugin stays JavaScript, which is the repository's own rule for what the plugin ships. |
| **D-11 · A yardstick is imported from the plugin, never reimplemented** | `analyzeSpecFreeze` and `analyzeSlicesTable` are the freeze's yardstick and `ct-groom.mjs` is the groom; the backend grows no second opinion about whether a spec is freezable. |
| **D-12 · The conductor is not duplicated** | which step comes next is decided by the run machine behind `ct-step`; the backend owns the process and is not a second automaton. |
| **D-13 · No phase is stored** | every phase is derived from evidence that survives a restart: the spec and its state line, the milestone and its issues, a `status:ready` label, a worktree, a record, a pull request, a closed issue. |
| **D-14 · The `plan` gate stops being implied, and control-tower keeps the two gates it was born with** | `gatesForType` adds `plan` to every slice of every epic whatever its `Tipo`, which is the opposite of D-3. That default is removed. Only `visual` and `apply` survive as human gates. The protocol behind the go is **not** retired in this epic: it is documented as debt in A-3 and retired in later work, so that this one can be built without touching the distributed plugin beyond that single line. |
| **D-15 · The plan is published as a comment on the issue, and nothing waits for an answer** | the comment exists for tracking, which is what the `plan` gate's text used to achieve as a side effect of stopping. The backend posts it after the plan step, because it owns the sequence and already drives `gh`; the agent does not stop and no go is minted, read or expected. |
| **D-16 · cmux leaves the backend** | with the launch headless, recovery reads the records under the state root: the record is the plan in flight and the process being alive is not what makes it recoverable. No module under `backend/src` names cmux, and it stops being probed as an external tool. |
| **D-17 · The record is written once and never mutated** | its absence is the whole of "not prepared", so there is no lock, no revision and no owner pid. |
| **D-18 · There is a coordinating session and it is the boss of all of them** | the entrance conversation does not die at the freeze: it stays as the milestone's coordinator and the human's single interlocutor, the one that orders the start, carries the changes asked on a pull request and unblocks what is stuck, implementations included. What it never does is decide the order or the phase — that is the program's, exactly as in the plugin, where the coordinating session runs `/ct-next` and `ct-next.mjs` is what decides. It commands by invoking the backend's endpoints and the plugin's programs, while the backend owns the processes, makes the call of each step, keeps the record and measures. So there is a session above every other one, and still no model in the critical path of the automatic chain. |
| **D-19 · One conversation per slice, and one call per step of the run machine** | the backend asks `ct-step next`, makes the `claude -p --resume` call of the step that is due, and runs the verb that consumes what the call produced. `run-machine.js` stays the only sequencer: no step order is written in the backend, and a verb out of turn is still the machine's exit 9 rather than a backend decision. Three consequences that are part of the decision: the judge becomes its own call, so it reports its own cost — the argv of `judge-dispatch.js` is the reference shape; the attempt row of `docs/superpowers/metrics/issue-<n>.jsonl` can carry cost and turns, which is what the bet promises and what a subagent cannot report (`ct-step.mjs:53`); and the agent is never again told to ask `ct-step`, so a task's call implements that task with TDD and dispatches no subagent of its own. This is phase 4 of issue #139 and it is a slice of its own. |
| **D-20 · A change asked on a pull request travels through the coordinating session** | you tell the boss and the boss makes it happen: it asks the backend to resume that slice's conversation with the change. The sweep of the pull request's own comments stays as the second channel, for a reviewer who writes on GitHub instead of talking to the cabin. |
| **D-21 · The coordinating session is always in the front, and it is recoverable** | the cabin offers a place to talk to it in **every** phase, and most explicitly once the implementation is running: no phase of the page may hide it, replace it with a progress panel or disable its input. It is the same property the original plugin has for free, where the coordinator's terminal never goes away while slices work. Talking to it must not disturb what is being implemented, which it cannot: the slices' conversations are other sessions and their calls are the backend's. And getting it back is a requirement rather than a convenience — two different losses with two different answers, a page reload replaying what was already said and a backend restart bringing the conversation back by resuming it. A conversation that cannot be resumed is said out loud; the cabin never opens a different one and presents it as the same. |
| **D-24 · The coordinating session can talk to every session it did not launch** | the backend is what spawns and drives them, so the boss is given the other half: it knows which conversations are live and can deliver a message into any of them, and read what came back, asking the backend, which stays the owner of the processes. The plugin already works this way — a coordinator reaches a slice with `cmux send --workspace workspace:97` — and this is the same property without cmux. It is also the mechanism D-20 needs: the change you ask of the boss reaches that slice because the boss can address it by name. |
| **D-25 · The context of every call is composed by the plugin and relayed verbatim, never paraphrased by the backend** | `ct-step next` is already the composer and the dispatch order at once: it writes the task's brief with `task-brief --with-plan-context` (the desired end state, the out of scope and the two yardstick sections, whose authority split the script documents), it appends the plugin's yardstick, the repository's yardstick and, on a third attempt, the advisor's advice inside the brief; it writes the review package with `review-package` on the task's **recorded base** rather than `HEAD~1`, so a multi-commit task stays whole; and it prints whom to dispatch, with which model and which tools and which files. The backend hands over **those paths** and pastes none of that text into a prompt, which is the property `task-brief` exists for — "so the task text never has to be pasted through the controller's context". The role material per step is what `role-bytes.js` declares, the tools and models and package sections are what `step-contracts.js` declares, and the judge travels with the plugin's own definition the way judge-bench composes it (`--agents <json> --agent <name>`), so no judge prompt is ever written in the backend. The answer's schema is imposed by the binary with `--json-schema`, which only exists in `--print` mode and which `step-contracts.js:14-16` records as lost when the conductor stopped being headless: D-19 gets it back, so the verdict, the report, the advice and the e2e stop being asked for in prose. If `ct-step next` asks for a dispatch the backend cannot assemble from what it prepared, the backend refuses instead of improvising a prompt. |
| **D-23 · After the freeze the app publishes the spec, and the groom waits for its merge** | pressing gate 1 commits the state line and then does what a person would do next: push the epic's branch and open its pull request with the design and the spec in it. The groom stays refused until the spec's committed copy is readable on the **default** branch, and what achieves that is the human merging that pull request — not a fourth gate, but D-7 again: the app never merges. The reason the branch is not enough is written in `spec-link.js`: the issue's link resolves against the default branch on purpose, because a feature branch is deleted on merge and the link would rot. Grooming earlier gives every issue a text reference instead of a link, and fixing it afterwards needs `--reconcile`, which the plugin marks experimental. |
| **D-22 · The gates are the human's and no session can trigger them** | the coordinating session commands the backend, but not here: writing `Estado: CONGELADA`, promoting to `status:ready` and anything around the merge are triggered only from the front, by a person's click. There is no endpoint for them that a session can call, and an attempt is refused with an explicit code rather than obeyed. Everything else does travel through the boss: starting work already authorised, asking for changes, unblocking what is stuck. This is the repository's own doctrine — the go the agent cannot write — applied to the coordinator now that it has hands. |
| What "no longer routed" means | the `app.post` and the `app.all` for `ReviewPlanRoute.PATH` leave `ApiServer.#route()`; the path is then caught by `Failures.nothingMatched` and answers 404 `{"code":"not-found","detail":"not found"}` — no 405 and no dedicated refusal |
| Which modules are deleted, not deprecated | `backend/src/infrastructure/review-plan-route.ts`, `backend/src/application/actions/ask-plan-changes.ts`, `backend/src/application/actions/review-plan.ts`, `backend/src/application/queries/read-changes-asked.ts`, `backend/src/domain/policies/review-gate-policy.ts`, `backend/__tests__/reviews-spy.ts` and the whole `frontend/src/app/review-plan/` directory |
| What `PlanState` becomes | `export type PlanStateValue = 'writing' \| 'ready'` and a `PlanState` class with exactly `WRITING` and `READY`; the frontend's `PlanState` in `frontend/src/app/plan-events/PlanEvents.types.ts` becomes the same two members |
| What `ReadPlanProgress` becomes | `new ReadPlanProgress({ planProgress })` — no `reviewLog` collaborator, no `#underReview`, no `#momentOf`; `#stateOf` is `this.planProgress.of({ located, issue, repository })` and nothing else |
| What `ImplementPlanRoute` loses | the `PLAN_UNDER_REVIEW` outcome, `#reviewInFlight`, `#reworking`, and the `reviews`/`readPlanProgress` arguments of `handledBy`; `reviews.stop(...)` goes with Task 4, not with Task 3 |
| What goes with the route in Task 1 | `api-server.ts`: the `ReviewPlanRoute` and `AskPlanChangesAction` imports, the `askPlanChanges` field, its `ApiCollaborators` entry and its constructor parameter. `ct-api.ts`: the `AskPlanChanges` import and its `askPlanChanges:` argument. `refusal-codes.test.ts`: the `review-plan-route.ts` import, the `ReviewRequestOutcome` spread and `ReviewCollapse.CODE` |
| What `SharedOnPurposeAcrossRequestVocabularies.CODES` becomes in Task 1 | exactly `PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT`, `PlanRequestOutcome.UNKNOWN_FIELD`, `PlanRequestOutcome.MALFORMED_REPO` and `ProgressRequestOutcome.MALFORMED_ROOT` — the three `ImplementRequestOutcome` entries it lists today were shared only with the review vocabulary, so they stop repeating |
| What goes in Task 3, file by file | `implement-plan-route.ts`: `#reviewInFlight`, `#reworking`, the `readPlanProgress` parameter of `handledBy` and `#accept`. `api-server.ts`: the `readPlanProgress` collaborator, its field and the `PlanProgressReader` type. `ct-api.ts`: `readPlanProgress` from the `ApiServer` arguments, keeping the local that feeds `#planEvents`. `review-watch.ts`: `refresh()` and its `ReviewInFlight` import. `reviews-spy.ts`: `inFlight`, `refresh`, `withAnUndeliveredChange`, `unreadable`. `ImplementPlan.types.ts`: the `\| { kind: 'under-review' }` member. `client.ts`: `PLAN_UNDER_REVIEW` and the branch that maps it. `ImplementPlanAction.tsx`: `UNDER_REVIEW_TITLE`, `UNDER_REVIEW_DESCRIPTION` and the banner. `ImplementPlanMother.ts`: `planUnderReview` |
| What goes in Task 4, file by file | `ct-api.ts`: `#planReviews` and the `planReviewLog` local. `api-server.ts`: the `reviews` collaborator, its field and the `PlanReviews` type. `start-plan-route.ts`: the `reviews` argument, the `PlanReviewStarts` type and both `reviews.start(...)` calls. `active-plan-recovery.ts`: the `reviews` field and `this.reviews.startRecovered(watch)`. `implement-plan-route.ts`: the `reviews` argument and `reviews.stop(...)`. `plan-agents.ts` and `cmux-plan-agents.ts`: `review()` |
| What `ImplementPlanRoute.handledBy` ends as | `handledBy(implementPlan, pullRequestReviews, activePlans, implementationStarts, stderr)`, in that order |
| What `ReviewWatch` loses | only `refresh()` and its `ReviewInFlight` import. `start`, `startRecovered`, `stop`, `log`, `#note` and the constructor's six named arguments stay exactly as they are, because the second wiring is protected |
| What `gatesForType` becomes | `return typed` — the `Tipo`'s gates and nothing more; `TYPE_GATES` is untouched (`ui: ['visual']`, `infra: ['apply']`) |
| What happens to `!plan` in a row | it becomes an inert waiver, and `ct-groom` already says so out loud ("the waiver does nothing (there was nothing to remove)"). That noise is correct and no code is added to silence it |
| Which `gh` calls disappear | `GhPlanIssues.changesArgvFor` (`issue view --json comments`) and `changesCommentArgvFor` (`issue comment --body -REVIEW …`), with `CHANGES_TOKEN`, `#changesIn`, `#commentsIn`, `#demandRead`, `changesAsked`, `askChanges` and `PlanIssueBody.CHANGES_LINE` |
| Which exceptions disappear | `PlanChangesFailure`, `PlanChangesNotRead`, `PlanChangesNotUnderstood` and `PlanChangesNotAsked` in `backend/src/domain/exceptions.ts`. `ChangeAsked` stays: `GhPullRequests.fixesAsked` is its other producer |
| What the frontend loses | `frontend/src/app/review-plan/`, the `reviewing` phase of `usePlanProgress`, `PlanProgress`'s `onReviewing` prop and `REWORKING_MESSAGE`, `PlanEventsMother.reviewing`, `Home`'s `planReviewing` callback, `ImplementPlanOutcome`'s `{ kind: 'under-review' }` with its banner and `ImplementPlanMother.planUnderReview`, and `'/review-plan'` in `frontend/vite.config.ts` |
| Where the two halves of a contract move together | in one commit. `plan-under-review` leaves the backend and the frontend in Task 3; `reviewing` leaves both in Task 6; the endpoint leaves in Task 1 and its client, with the `ReviewPlanMother` that fed that client's tests, in Task 2 — two consecutive commits of one slice, so no delivery ever carries half of it (`conventions/decisions.md`: a contract that crosses a process boundary is changed on both sides at once) |
| The test commands | `npm --prefix backend run typecheck`, `npm --prefix backend test`, `npm --prefix frontend test`, `npm --prefix plugin test`. Measured on this worktree at `7f35b98` before any task: all four exit 0 |
| Which suite covers the surviving watch | `backend/__tests__/infrastructure/pull-request-review-loop.test.ts`. No task may modify it: if a task needs to, the change is wrong |

## 3. Reference patterns

Files to imitate: `backend/src/infrastructure/external-tools-route.ts` — a route of this API at its
smallest, the shape the surviving routes keep; `backend/src/infrastructure/implement-history-route.ts`
— its `Projection`-backed refusal vocabulary is the shape `ImplementRefusal` keeps once one member
leaves; `backend/src/application/queries/read-implementation-progress.ts` — an application query with
a single port collaborator, which is what `ReadPlanProgress` becomes;
`backend/__tests__/infrastructure/implement-history-route.test.ts` — the outside-in route test with
its doubles, the shape the edited route tests keep;
`frontend/src/app/implement-progress/components/implement-progress/ImplementProgress.tsx` — a
component that renders a state vocabulary with no retired member;
`plugin/__tests__/f21-gate-and-type.test.js` — the suite that owns `TYPE_GATES` and `gatesForType`.

Rules to obey: `AGENTS.md` (English on every surface bar frontend product copy; a repository control
is not an obstacle to route around); `CLAUDE.md` (the same text);
`backend/conventions/this-repository.md` (the backend is TypeScript with no declared-debt exemption,
the `{code, detail}` doctrine, the layout, the exception families, a failing test must not leak a
process); `backend/API.md` (the endpoint contracts this slice edits); `docs/glossary.md` (read before
renaming anything). ct's own eight documents in `plugin/conventions/` travel with every task brief
and are not repeated here.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/infrastructure/review-plan-route.ts` | delete | nothing, after Task 1 | none |
| `backend/src/application/actions/ask-plan-changes.ts` | delete | nothing, after Task 1 | none |
| `backend/src/infrastructure/api-server.ts` | modify | `ct-api.ts` | Current state (Task 1), Contract (Task 4) |
| `backend/src/infrastructure/ct-api.ts` | modify | the real process | Current state (Task 4) |
| `frontend/src/app/review-plan/client.ts`, `client.test.ts`, `ReviewPlan.types.ts` and the four files of `components/ask-plan-changes/` | delete | `Home.tsx`, until Task 2 | none |
| `frontend/src/__scenarios__/ReviewPlanMother.ts` | delete | the deleted review-plan tests | none |
| `frontend/src/pages/home/Home.tsx` | modify | the page | Call site (Tasks 2 and 6) |
| `frontend/vite.config.ts` | modify | the dev server | prose (config, Task 2) |
| `backend/src/infrastructure/implement-plan-route.ts` | modify | `api-server.ts` | Current state + Contract (Task 3) |
| `backend/src/domain/policies/review-gate-policy.ts` | delete | nothing, after Task 3 | none |
| `backend/src/infrastructure/review-watch.ts` | modify | `ct-api.ts` | none (body by TDD) |
| `frontend/src/app/implement-plan/ImplementPlan.types.ts` | modify | `client.ts`, `ImplementPlanAction.tsx` | Current state (Task 3) |
| `frontend/src/app/implement-plan/client.ts` | modify | `ImplementPlanAction.tsx` | none (body by TDD) |
| `frontend/src/app/implement-plan/components/implement-plan-action/ImplementPlanAction.tsx` | modify | `Home.tsx` | none (body by TDD) |
| `frontend/src/__scenarios__/ImplementPlanMother.ts` | modify | the frontend suite | none (body by TDD) |
| `backend/src/application/queries/read-changes-asked.ts` | delete | nothing, after Task 4 | none |
| `backend/src/application/actions/review-plan.ts` | delete | nothing, after Task 4 | none |
| `backend/src/infrastructure/start-plan-route.ts` | modify | `api-server.ts` | none (body by TDD) |
| `backend/src/infrastructure/active-plan-recovery.ts` | modify | `ct-api.ts` | none (body by TDD) |
| `backend/src/domain/ports/plan-agents.ts` | modify | `cmux-plan-agents.ts` | Contract (Task 4) |
| `backend/src/infrastructure/cmux-plan-agents.ts` | modify | `ct-api.ts` | none (body by TDD) |
| `backend/__tests__/reviews-spy.ts` | delete | nothing, after Task 4 | none |
| `backend/src/infrastructure/gh-plan-issues.ts` | modify | `ct-api.ts`, `plan-agent-brief.ts` | Current state (Task 5) |
| `backend/src/domain/ports/plan-issues.ts` | modify | `gh-plan-issues.ts` | Contract (Task 5) |
| `backend/src/domain/exceptions.ts` | modify | the adapters | none (body by TDD) |
| `backend/src/infrastructure/plan-agent-brief.ts` | modify | `start-plan.ts` | none (body by TDD) |
| `backend/src/domain/value-objects/plan-state.ts` | modify | the plan stream | Current state (Task 6) |
| `backend/src/application/queries/read-plan-progress.ts` | modify | `plan-events-route.ts` | Contract (Task 6) |
| `frontend/src/app/plan-events/PlanEvents.types.ts` | modify | `client.ts`, `usePlanProgress.ts` | none (body by TDD) |
| `frontend/src/app/plan-events/usePlanProgress.ts` | modify | `PlanProgress.tsx` | Current state (Task 6) |
| `frontend/src/app/plan-events/components/plan-progress/PlanProgress.tsx` | modify | `Home.tsx` | none (body by TDD) |
| `frontend/src/__scenarios__/PlanEventsMother.ts` | modify | the frontend suite | none (body by TDD) |
| `plugin/scripts/gates.js` | modify | `groom.js`, `kickoff.js`, `ct-next.mjs` | Current state + Contract (Task 7) |
| `backend/API.md` | modify | whoever calls the API | Final text (Task 8) |

## 5. Interfaces

Consumes: N/A — the issue declares no `## Dependencias` section and its `Dep` column is `–`: this
slice is first in the table and depends on nothing already merged.

Produces: `gatesForType(type: string | undefined) => string[]` — the gates a `Tipo` implies, with no
universal default, which slices #4 and #5 read when the cabin grooms an epic.
`PlanStateValue = 'writing' | 'ready'` and `class PlanState { WRITING; READY }` — the closed
vocabulary of `GET /plan-events/:issue`, which slice #2's session channel and slice #9's tab render.
`ReadPlanProgress({ planProgress })` — the plan-progress query with one collaborator.
`ImplementPlanRoute.handledBy(implementPlan, pullRequestReviews, activePlans, implementationStarts, stderr)`
— the signature slice #6 removes wholesale when it retires `POST /implement-plan`.

## 6. Test strategy

Outside-in with the ports doubled, as `backend/conventions/this-repository.md` and the epic context
require. Every task drives its change red first through the suite that already owns the behaviour:
`api-server.test.ts` and `ct-api-real-process.test.ts` for what is mounted, `implement-plan-route.test.ts`
for the refusals, `read-plan-progress.test.ts` and `plan-events-route.test.ts` for the vocabulary,
`gh-plan-issues.test.ts` and `plan-issue-body.test.ts` for the `gh` calls, the plugin's
`gate-plan.test.js` and `f21-gate-and-type.test.js` for the gate.

Deletions are driven red too: a task that removes behaviour first writes the test that pins the
**new** behaviour (a 404 where a 400 was, a two-member vocabulary where a three-member one was) and
only then removes the code, so the suite never loses the assertion without gaining its replacement.
Tests that only exist to pin the retiring behaviour are named for removal in each task's `**Tests:**`.

No task adds a test that requires cmux to be installed or running, and no test spawns a real process,
so no file gains the `-real-process` suffix. `refusal-codes.test.ts` is the guard that two endpoints
never share a `code` by accident: it is edited in Task 1 as the review vocabulary leaves, never
relaxed. `pull-request-review-loop.test.ts` is the guard of the surviving watch and is not
edited by any task.

## 7. Tasks

### Task 1 — the API stops routing `POST /review-plan`

**Objective:** `POST /review-plan` falls to the 404 net, and the route and the action behind it are gone from the backend.

**Files:** `backend/src/infrastructure/review-plan-route.ts` (delete), `backend/src/application/actions/ask-plan-changes.ts` (delete), `backend/src/infrastructure/api-server.ts` (modify), `backend/src/infrastructure/ct-api.ts` (modify), `backend/__tests__/infrastructure/review-plan-route.test.ts` (delete), `backend/__tests__/application/ask-plan-changes.test.ts` (delete), `backend/__tests__/infrastructure/api-server.test.ts` (modify), `backend/__tests__/infrastructure/ct-api-real-process.test.ts` (modify), `backend/__tests__/infrastructure/refusal-codes.test.ts` (modify), `backend/__tests__/infrastructure/external-tools-route.test.ts` (modify), `backend/__tests__/infrastructure/implement-history-route.test.ts` (modify), `backend/__tests__/infrastructure/implement-plan-route.test.ts` (modify), `backend/__tests__/infrastructure/implement-progress-route.test.ts` (modify)

Current state (backend/src/infrastructure/api-server.ts, lines 188-195):

```ts
    app.post(
      ReviewPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      ReviewPlanRoute.handledBy(this.askPlanChanges!, this.activePlans!)
    )
    app.all(ReviewPlanRoute.PATH, ReviewPlanRoute.refuseOtherMethods)
```

§2 says what `api-server.ts`, `ct-api.ts` and `refusal-codes.test.ts` lose with the route, and what
`SharedOnPurposeAcrossRequestVocabularies.CODES` becomes. The four other route tests are there
because each builds a whole `ApiServer` object literal naming `askPlanChanges`, which stops being a
field of `ApiCollaborators`: each loses that one line and nothing else.

**TDD:** `it('review_plan_is_no_longer_routed_and_falls_to_the_last_net')` in `api-server.test.ts` — a `POST /review-plan` with a well-formed body answers 404 and `{ code: 'not-found', detail: 'not found' }`; red today, where the mounted route answers 400.

**Tests:** added: `review_plan_is_no_longer_routed_and_falls_to_the_last_net`, `review_plan_is_no_longer_mounted_in_the_real_process`. Removed: `review_plan_turns_away_a_foreign_browser_origin`, `review_plan_is_mounted_in_the_real_process_and_not_only_in_the_test_server`, and the files `review-plan-route.test.ts` and `ask-plan-changes.test.ts`.

**Verification:** the two modules are untracked, the backend names neither of them, and it stays green.

```bash
test -z "$(git ls-files backend/src/infrastructure/review-plan-route.ts backend/src/application/actions/ask-plan-changes.ts)"
test -z "$(grep -rl ReviewPlanRoute backend/src backend/__tests__)"
test -z "$(grep -rl AskPlanChanges backend/src backend/__tests__)"
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 2 — the page stops calling the retired endpoint

**Objective:** the cabin offers no way to ask for changes on a plan, and the client of the retired endpoint is gone with its mother.

**Files:** `frontend/src/app/review-plan/client.ts` (delete), `frontend/src/app/review-plan/client.test.ts` (delete), `frontend/src/app/review-plan/ReviewPlan.types.ts` (delete), `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.tsx` (delete), `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.test.tsx` (delete), `frontend/src/app/review-plan/components/ask-plan-changes/AskPlanChanges.css` (delete), `frontend/src/app/review-plan/components/ask-plan-changes/index.ts` (delete), `frontend/src/__scenarios__/ReviewPlanMother.ts` (delete), `frontend/src/pages/home/Home.tsx` (modify), `frontend/src/pages/home/__tests__/Home.reviewPlan.test.tsx` (delete), `frontend/src/pages/home/__tests__/Home.implementPlan.test.tsx` (modify), `frontend/vite.config.ts` (modify)

Call site (frontend/src/pages/home/Home.tsx):

```tsx
// before, inside the home__review-action div
<AskPlanChanges plan={workflow.plan} />
<ImplementPlanAction plan={workflow.plan} onImplementationStarted={implementationStarted} />
// after — the import of AskPlanChanges goes with the element
<ImplementPlanAction plan={workflow.plan} onImplementationStarted={implementationStarted} />
```

`ReviewPlanMother.ts` goes with them: its only two callers are the tests deleted here.
Configuration: `frontend/vite.config.ts`'s `API_PATHS` array drops the `'/review-plan'` entry, so the
dev server stops proxying a path the API no longer routes.

**TDD:** `it('should offer only the issue link and the go on a ready plan')` in `Home.implementPlan.test.tsx` — with the plan ready, the review area holds the link `Abrir el plan en GitHub` and the button `Implementar plan`, and `queryByRole('button', { name: 'Pedir cambios' })` is null; red today, where that button is rendered.

**Tests:** added: `should offer only the issue link and the go on a ready plan`. Removed: the files `client.test.ts`, `AskPlanChanges.test.tsx` and `Home.reviewPlan.test.tsx`, whose four cases all pin the button this task removes.

**Verification:** nothing on the page names the component or the path, and the suite stays green.

```bash
test -z "$(git ls-files frontend/src/app/review-plan)"
test -z "$(grep -rl AskPlanChanges frontend/src)"
test -z "$(grep -rl ReviewPlanMother frontend/src)"
test "$(grep -c /review-plan frontend/vite.config.ts)" -eq 0
npm --prefix frontend test
```

### Task 3 — the go stops asking whether the plan is under review

**Objective:** the go is admitted with no plan review consulted, and `plan-under-review` retires on both halves of the wire.

**Files:** `backend/src/infrastructure/implement-plan-route.ts` (modify), `backend/src/infrastructure/api-server.ts` (modify), `backend/src/infrastructure/ct-api.ts` (modify), `backend/src/infrastructure/review-watch.ts` (modify), `backend/src/domain/policies/review-gate-policy.ts` (delete), `backend/__tests__/reviews-spy.ts` (modify), `backend/__tests__/infrastructure/implement-plan-route.test.ts` (modify), `backend/__tests__/infrastructure/review-watch.test.ts` (modify), `frontend/src/app/implement-plan/ImplementPlan.types.ts` (modify), `frontend/src/app/implement-plan/client.ts` (modify), `frontend/src/app/implement-plan/client.test.ts` (modify), `frontend/src/__scenarios__/ImplementPlanMother.ts` (modify), `frontend/src/app/implement-plan/components/implement-plan-action/ImplementPlanAction.tsx` (modify), `frontend/src/app/implement-plan/components/implement-plan-action/ImplementPlanAction.test.tsx` (modify)

Current state (backend/src/infrastructure/implement-plan-route.ts, lines 346-353):

```ts
  static async #reviewInFlight(
    reviews: PlanReviews, readPlanProgress: PlanProgressReader, watch: PlanWatch
  ): Promise<ReviewInFlightValue> {
    return ReviewGatePolicy.of({
      watched: await reviews.refresh(watch),
      reworking: await ImplementPlanRoute.#reworking(readPlanProgress, watch),
    })
  }
```

Contract (backend/src/infrastructure/implement-plan-route.ts):

```ts
export const ImplementRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_AGENT: 'malformed-agent',
  MALFORMED_ISSUE: 'malformed-issue',
  MALFORMED_REPO: 'malformed-repo',
  NO_LIVE_SESSION: 'no-live-planning-session',
  UNCERTAIN_PHASE: 'implementation-phase-uncertain',
} as const)
type PlanReviews = { stop(watched: WatchedIssue): void }
```

§2, row «What goes in Task 3, file by file», says what each loses.

**TDD:** `it('a_plan_whose_progress_nobody_asks_about_still_admits_the_go')` in `implement-plan-route.test.ts` — with no progress reader wired the route answers 202 and `RunningApi.spy.asked` holds the request; red today, where `handledBy` takes one.

**Tests:** added: `a_plan_whose_progress_nobody_asks_about_still_admits_the_go`. Removed on purpose: `the_watch_is_asked_about_the_plan_it_is_watching_and_not_about_the_request`, `a_plan_being_reworked_refuses_the_go_even_though_every_change_was_delivered`, `the_state_is_read_for_the_workspace_the_watch_carries`, `half_a_signal_is_still_a_signal_and_a_plan_read_as_being_reworked_refuses_the_go`, `a_signal_nobody_declared_is_refused_instead_of_read_as_nothing_in_flight`, `every_plan_state_says_whether_it_is_a_review_in_flight`, `a_plan_state_nobody_declared_is_refused_instead_of_admitting_the_go`, the `refresh` cases of `review-watch.test.ts`, the `under-review` cases of `client.test.ts` and `ImplementPlanAction.test.tsx`.

**Verification:** the policy is untracked, nothing names it, the suites are green.

```bash
test -z "$(git ls-files backend/src/domain/policies/review-gate-policy.ts)"
test -z "$(grep -rl ReviewGatePolicy backend/src backend/__tests__)"
test -z "$(grep -rl plan-under-review backend/src frontend/src)"
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend test
```

### Task 4 — the plan's review watch is no longer wired, started or recovered

**Objective:** nothing starts a watch over the plan's issue any more, and the surviving watch is the pull request's.

**Files:** `backend/src/infrastructure/ct-api.ts` (modify), `backend/src/infrastructure/api-server.ts` (modify), `backend/src/infrastructure/start-plan-route.ts` (modify), `backend/src/infrastructure/active-plan-recovery.ts` (modify), `backend/src/infrastructure/implement-plan-route.ts` (modify), `backend/src/domain/ports/plan-agents.ts` (modify), `backend/src/infrastructure/cmux-plan-agents.ts` (modify), `backend/src/application/queries/read-changes-asked.ts` (delete), `backend/src/application/actions/review-plan.ts` (delete), `backend/__tests__/reviews-spy.ts` (delete), `backend/__tests__/application/read-changes-asked.test.ts` (delete), `backend/__tests__/application/review-plan.test.ts` (delete), `backend/__tests__/infrastructure/api-server.test.ts` (modify), `backend/__tests__/infrastructure/active-plan-recovery.test.ts` (modify), `backend/__tests__/infrastructure/implement-plan-route.test.ts` (modify), `backend/__tests__/infrastructure/cmux-plan-agents.test.ts` (modify)

Current state (backend/src/infrastructure/ct-api.ts, lines 309-315):

```ts
  static #planReviews(planIssues: GhPlanIssues, planAgents: CmuxPlanAgents, log: MemoryReviewLog): ReviewWatch {
    const readChangesAsked = new ReadChangesAsked({ planIssues })
    const reviewPlan = new ReviewPlan({ planAgents })

    return new ReviewWatch({
      asked: (watch) => readChangesAsked.execute(new ReadChangesAskedParams(watch)),
      review: (params) => reviewPlan.execute(new ReviewPlanParams(params)),
```

Contract (backend/src/domain/ports/plan-agents.ts):

```ts
export class PlanAgents {
  async launch(briefing: PlanBriefing): Promise<string>
  async resume({ agent, issue, repository }): Promise<void>
  async fix({ agent, issue, repository, changes }): Promise<void>   // review() is gone; the four named arguments keep their types
}
```

§2, row «What goes in Task 4, file by file», says what each file loses.
`CtApi.#pullRequestReviews` is not touched, and `ActivePlanRecovery.#recover` ends that branch with
`this.sessions.remember(watch)` alone.

**TDD:** `it('a_started_plan_leaves_no_watch_over_its_issue')` in `api-server.test.ts` — after a `POST /start-plan` the session is remembered and no collaborator was asked to watch the issue; red today, where `StartPlanRoute` calls `reviews.start`.

**Tests:** added: `a_started_plan_leaves_no_watch_over_its_issue`, `a_recovered_plan_being_written_is_remembered_as_a_session_and_nothing_watches_its_issue`. Removed on purpose: the `RunningApi.reviews.started` assertions, the plan-watch recovery assertions, the `reviews.stopped` assertions, the `review()` cases of `cmux-plan-agents.test.ts`, and the files `read-changes-asked.test.ts` and `review-plan.test.ts`.

**Verification:** the three modules are untracked, nothing builds a plan review, the protected loop is untouched.

```bash
test -z "$(git ls-files backend/src/application/queries/read-changes-asked.ts backend/src/application/actions/review-plan.ts backend/__tests__/reviews-spy.ts)"
test -z "$(grep -rl planReviews backend/src backend/__tests__)"
test -z "$(git diff 7f35b989a8d02bed35a72a0ccf7b1fd53ee34c3f --stat -- backend/__tests__/infrastructure/pull-request-review-loop.test.ts)"
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 5 — nothing asks GitHub for `-REVIEW` any more

**Objective:** the `-REVIEW` token, the two `gh` calls behind it and the exception family they threw leave the backend.

**Files:** `backend/src/infrastructure/gh-plan-issues.ts` (modify), `backend/src/domain/ports/plan-issues.ts` (modify), `backend/src/domain/exceptions.ts` (modify), `backend/src/infrastructure/plan-agent-brief.ts` (modify), `backend/__tests__/infrastructure/gh-plan-issues.test.ts` (modify), `backend/__tests__/infrastructure/plan-issue-body.test.ts` (modify), `backend/__tests__/infrastructure/plan-refusal.test.ts` (modify), `backend/__tests__/infrastructure/plan-agent-brief.test.ts` (modify)

Current state (backend/src/infrastructure/gh-plan-issues.ts, lines 190-196):

```ts
  async changesAsked({ issue, repository }: {
    issue: PlanIssue,
    repository: RepositoryName,
  }): Promise<ChangeAsked[]> {
    const outcome = await this.gh.run(
      GhPlanIssues.changesArgvFor({ issue, repository }), { safeToRepeat: true }
    )
```

Contract (backend/src/domain/ports/plan-issues.ts):

```ts
export class PlanIssues {
  async open({ story, comment, repository }): Promise<PlanIssue>
  async claim({ issue, repository }): Promise<void>
  async requeue({ issue, repository }): Promise<void>
  async answerGo({ issueNumber, repository, nonce }): Promise<void>
  async storyOf({ issueNumber, repository }): Promise<UserStoryKey | UserStoryUrl | null>
  async statusOf({ issueNumber, repository }): Promise<PlanIssueStatusValue>
}
```

`GhPlanIssues` loses `CHANGES_TOKEN`, `changesCommentArgvFor`, `changesArgvFor`, `changesAsked`,
`#changesIn`, `#commentsIn` and `#demandRead`, and `askChanges`; `PlanIssueBody` loses
`CHANGES_LINE` and the line it contributes to the issue body; `plan-agent-brief.ts` drops the two
sentences that end with `${PlanIssueBody.CHANGES_LINE}`. `exceptions.ts` loses `PlanChangesFailure`,
`PlanChangesNotRead`, `PlanChangesNotUnderstood` and `PlanChangesNotAsked`. `ChangeAsked` stays:
`GhPullRequests.fixesAsked` is its other producer and the surviving watch reads it.

**TDD:** `it('the_body_of_a_plan_issue_no_longer_invites_anyone_to_ask_for_changes_on_it')` in `plan-issue-body.test.ts` — the rendered body carries neither `-REVIEW` nor the invitation sentence; red today, where `CHANGES_LINE` is one of its lines.

**Tests:** added: `the_body_of_a_plan_issue_no_longer_invites_anyone_to_ask_for_changes_on_it` (plan-issue-body.test.ts). Removed on purpose: the `changesAsked`/`askChanges` describe blocks of `gh-plan-issues.test.ts` with their `changesAskedFor` and `askChangesRefusalFor` helpers, the four `CHANGES_LINE` assertions and the asking-line case of `plan-issue-body.test.ts`, the `PlanChangesFailure` entries of `plan-refusal.test.ts`, and the `CHANGES_LINE` assertions of `plan-agent-brief.test.ts`.

**Verification:** the token and the exception family are gone from the backend, and the suite stays green.

```bash
test -z "$(grep -rl CHANGES_TOKEN backend/src backend/__tests__)"
test -z "$(grep -rl PlanChangesFailure backend/src backend/__tests__)"
test "$(grep -c -- -REVIEW backend/src/infrastructure/gh-plan-issues.ts)" -eq 0
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 6 — the plan events vocabulary is `writing` and `ready` only

**Objective:** `reviewing` leaves the plan state on both sides of the wire, so the stream can emit nothing but the two surviving frames.

**Files:** `backend/src/domain/value-objects/plan-state.ts` (modify), `backend/src/application/queries/read-plan-progress.ts` (modify), `backend/src/infrastructure/ct-api.ts` (modify), `backend/__tests__/application/read-plan-progress.test.ts` (modify), `backend/__tests__/infrastructure/plan-events-route.test.ts` (modify), `frontend/src/app/plan-events/PlanEvents.types.ts` (modify), `frontend/src/app/plan-events/usePlanProgress.ts` (modify), `frontend/src/app/plan-events/components/plan-progress/PlanProgress.tsx` (modify), `frontend/src/__scenarios__/PlanEventsMother.ts` (modify), `frontend/src/pages/home/Home.tsx` (modify), `frontend/src/app/plan-events/components/plan-progress/PlanProgress.test.tsx` (modify)

Current state (backend/src/domain/value-objects/plan-state.ts, lines 1-7):

```ts
export type PlanStateValue = 'writing' | 'ready' | 'reviewing'

export class PlanState {
  static readonly WRITING = 'writing'
  static readonly READY = 'ready'
  static readonly REVIEWING = 'reviewing'
}
```

Current state (frontend/src/app/plan-events/usePlanProgress.ts, lines 4-11):

```ts
type PlanProgress =
  | { phase: 'connecting' }
  | { phase: 'writing' }
  | { phase: 'ready' }
  | { phase: 'reviewing' }
  | { phase: 'failed'; code: string; detail: string }
  | { phase: 'refused' }
  | { phase: 'unreachable' }
```

Contract (backend/src/application/queries/read-plan-progress.ts):

```ts
export class ReadPlanProgress {
  readonly planProgress: PlanProgress
  constructor({ planProgress }: { planProgress: PlanProgress })
  async execute(params: ReadPlanProgressParams): Promise<{ readonly state: PlanStateValue }>
}
```

`#underReview` and `#momentOf` go with the `reviewLog` collaborator and the `ReviewLog` import, and
`CtApi.#readPlanProgress` loses its `log` parameter. `PlanProgress.tsx` drops `onReviewing`,
`REWORKING_MESSAGE`, the effect that calls it and the line that renders it; `Home.tsx` drops
`planReviewing` and both `onReviewing=` props; `PlanEventsMother` drops `reviewing`.

**TDD:** `it('the_state_of_a_plan_is_one_of_exactly_two_and_reviewing_is_not_one_of_them')` in `read-plan-progress.test.ts` — `Object.values(PlanState)` equals `['writing', 'ready']`; red today, where it holds three.

**Tests:** added: `the_state_of_a_plan_is_one_of_exactly_two_and_reviewing_is_not_one_of_them` (read-plan-progress.test.ts). Removed on purpose: the three `PlanState.REVIEWING` cases of `read-plan-progress.test.ts`, the `reviewing` frame case of `plan-events-route.test.ts`, and `should say the plan is being reworked while a review is in flight`, `should tell its parent when a review starts, so the page can stop offering the go` and `should not tell its parent a review started when the plan is merely ready` (PlanProgress.test.tsx).

**Verification:** no production file on either side of the wire carries the word, the enumeration is the two members, and both suites stay green.

```bash
test -z "$(grep -rl reviewing backend/src frontend/src)"
node --input-type=module -e "const s = await import('./backend/src/domain/value-objects/plan-state.ts'); process.exit(JSON.stringify(Object.values(s.PlanState)) === '[\"writing\",\"ready\"]' ? 0 : 1)"
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend test
```

### Task 7 — no slice is born with the plan gate unless its own row asks for it

**Objective:** `gatesForType` stops appending `plan`: a groom creates no `gate:plan`.

**Files:** `plugin/scripts/gates.js` (modify), `plugin/__tests__/gate-plan.test.js` (modify), `plugin/__tests__/f21-gate-and-type.test.js` (modify), `plugin/__tests__/kickoff.test.js` (modify), `plugin/__tests__/ct-next-watch-go.test.js` (modify), `plugin/__tests__/f38-the-plan-gate-go.test.js` (modify)

Current state (plugin/scripts/gates.js, lines 139-150):

```js
export function gatesForType(type) {
  const typed = TYPE_GATES[typeof type === 'string' ? type.trim() : ''] ?? []
  // F-jjponz-2 — `plan` is implied in EVERY slice, whatever the Tipo may be:
  // the slice's plan always passes through human review before implementing,
  // barring an EXPLICIT per-row waiver (`!plan` in the Gate column, with the
  // same noise as any waiver). It lives here and not in TYPE_GATES on
  // purpose: TYPE_GATES maps the TECHNICAL axis (ui→visual, infra→apply) and
  // this default cuts across every type — putting it in each entry of the map
  // would make it depend on the Tipo existing in the map, and a `Tipo:
  // backend` (with no entry) would lose it.
  return [...typed, 'plan']
}
```

Contract (plugin/scripts/gates.js):

```js
export function gatesForType(type)   // -> TYPE_GATES[trimmed type] ?? [] — the Tipo's gates and no universal default
```

The comment above the `return` is replaced by one recording D-14: no `Tipo` implies `plan`, a row
that wants it writes `plan` in its `Gate` column, and the go protocol behind it is retired in later
work (debt A-3). `GATES.plan`, `TYPE_GATES`, `resolveGates` and `resolveGatesForAgent` are not
touched: a `!plan` in a row becomes an inert waiver, which `ct-groom` already reports out loud.

**TDD:** `it('it is implied in NO slice: a row that wants it writes it in its Gate column')` in `gate-plan.test.js` — `gatesForType('backend')`, `gatesForType('')` and `gatesForType(undefined)` each equal `[]`, `gatesForType('ui')` equals `['visual']`, and `resolveGates('backend', 'plan').gates` still contains `plan`.

**Tests:** added to `gate-plan.test.js`: `it('it is implied in NO slice: a row that wants it writes it in its Gate column')` and `it('`!plan` on a row is now an inert waiver, and it is said out loud')`. Removed from it on purpose: `it('it is implied in EVERY slice, whatever the Type may be — without touching TYPE_GATES')` and `it('`!plan` is a real per-row waiver: it removes the gate and makes noise like every waiver')`. Kept, with their names, and their fixtures corrected: the `gatesForType` expectations of `f21-gate-and-type.test.js`; `a slice that keeps the `plan` gate is still told the human OK opens the machine` in `kickoff.test.js`, whose slice now declares `gates: ['plan'], gatesDeclared: true`; and the dispatched issue of `ct-next-watch-go.test.js`, which now carries a `gate:plan` label.

**Verification:** no `Tipo` yields the label, a row that declares it still does, the suite stays green.

```bash
node --input-type=module -e "const g = await import('./plugin/scripts/gates.js'); const t = ['', 'backend', 'ui', 'infra', undefined]; process.exit(t.some((x) => g.gateLabels(g.resolveGates(x, '').gates).includes('gate:plan')) ? 1 : 0)"
node --input-type=module -e "const g = await import('./plugin/scripts/gates.js'); process.exit(g.resolveGates('backend', 'plan').gates.includes('plan') ? 0 : 1)"
npm --prefix plugin test
```

### Task 8 — `API.md` no longer documents the retired endpoint

**Objective:** the API's own documentation describes the two endpoints as they now answer, and names the review nowhere.

**Files:** `backend/API.md` (modify)

Final text (backend/API.md):

```md
## `GET /plan-events/:issue?repo=owner/name`

Server-sent events. It reports whether the plan is being written or is
committed. The stream stays open until the client disconnects, and polls in the
meantime.

It only serves an issue whose plan **this process** started or recovered. A
restarted backend has forgotten every session it did not recover from cmux.

**200** with `Content-Type: text/event-stream`. Two frame kinds:
```

Final text (backend/API.md):

```md
`state` is `writing` or `ready`. A frame is only sent when the state
**changes**, so expect nothing on the wire while the agent works. An `error`
frame does not close the stream; the next poll may succeed.
```

The `data: {"state":"reviewing"}` frame goes from the example block, and so does the whole paragraph
that begins `` `reviewing` means changes were asked for on the plan ``. In the `POST /implement-plan`
section the `plan-under-review` row leaves the refusals table, and with it the four paragraphs that
explain it — from `` `plan-under-review` answers two different questions `` to the one that ends
`instead of towards a plan nobody can ever implement.` The whole `## POST /review-plan` section and
its `---` separator go. Nothing is added: the retired endpoint gets no farewell note.

**TDD:** No TDD — `API.md` is documentation and this repository pins no assertion over its prose; the predicates below are what measure it.

**Tests:** N/A — no test is added or removed.

**Verification:** the file names neither the path, nor the retired frame, nor the refusal code, and it still documents the seven endpoints that remain.

```bash
test "$(grep -c /review-plan backend/API.md)" -eq 0
test "$(grep -c reviewing backend/API.md)" -eq 0
test "$(grep -c plan-under-review backend/API.md)" -eq 0
test "$(grep -c '^## `' backend/API.md)" -eq 7
```

## 8. Global verification

Every task's own commands have already run. What this block measures once more is the end state the
issue's five acceptance criteria name, plus the two halves of the observability signal: that a groom
of any spec creates no `gate:plan` label (read off `gates.js`, which is what `groom.js#buildLabels`
and `ct-groom.mjs` compute the labels from) and that the plan stream's vocabulary is two members
(read off `PlanState`, which is what `PlanEvents.frameFor` serialises). The last command is the
guard of the surviving watch: its test file has to be identical to the base of the branch.

```bash
test -z "$(grep -rl ReviewPlanRoute backend/src frontend/src)"
node --input-type=module -e "const s = await import('./backend/src/domain/value-objects/plan-state.ts'); process.exit(JSON.stringify(Object.values(s.PlanState)) === '[\"writing\",\"ready\"]' ? 0 : 1)"
node --input-type=module -e "const g = await import('./plugin/scripts/gates.js'); const t = ['', 'backend', 'ui', 'infra', undefined]; process.exit(t.some((x) => g.gateLabels(g.resolveGates(x, '').gates).includes('gate:plan')) ? 1 : 0)"
test -z "$(git diff 7f35b989a8d02bed35a72a0ccf7b1fd53ee34c3f -- backend/__tests__/infrastructure/pull-request-review-loop.test.ts backend/src/application/actions/request-fixes.ts backend/src/application/queries/read-fixes-asked.ts)"
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend test
npm --prefix plugin test
```

## 9. Assumptions

1. **The frontend is inside this slice even though the row's `Toca` column says `plugin`.** The
   acceptance criterion "the plan events vocabulary is `writing` and `ready` only" names a contract
   with two halves, and `conventions/decisions.md` requires both to move together; leaving
   `frontend/src/app/review-plan/` posting to a path the API no longer routes would ship a button
   that 404s. `Área`/`Toca` are the dispatcher's serialisation tokens, not a fence around the files.
   Provenance: own call, from the acceptance criteria and the ct yardstick.
2. **`plan-under-review` retires with the review even though the issue does not name it.** With no
   plan review there is no state in which `POST /implement-plan` could emit it;
   `conventions/simplicity.md` gives a branch no caller. Provenance: own call.
3. **`GhPlanIssues.changesAsked` / `askChanges` and their exception family retire too.** The design
   names `read-changes-asked.ts`; these are the adapter half it reads through, and after Task 4 they
   have no caller. `ChangeAsked` stays because `fixesAsked` produces it. Provenance: own call.
4. **`MemoryReviewLog` and `ReviewLog` survive with no reader.** Removing them would change
   `CtApi.#pullRequestReviews`, which the issue protects. Declared as debt in §1's out of scope,
   which is what `conventions/simplicity.md` asks for when the burden cannot be discharged.
   Provenance: issue, "Out of scope / Protected".
5. **`npm --prefix plugin test` joins the epic's three declared commands.** The epic context lists
   typecheck, backend and frontend; this slice is the only one of the eight that edits
   `plugin/scripts/`, so its suite has to run. Provenance: own call.
6. **The baseline could not be measured by the dispatcher** (`.agent/SLICE.md` says
   `outcome: no-verificado`, because `AGENTS.md` declares no test command). The four suites were run
   by hand on this worktree at `7f35b98` before any task and all four exited 0: backend typecheck,
   60 backend test files, 47 frontend test files, 149 plugin test files. Declaring the command in
   `AGENTS.md` is a repository change nobody asked for here and is left alone. Provenance: own call.
7. **`f38-the-plan-gate-go.test.js` keeps every assertion.** Its fixtures already carry an explicit
   `gate:plan` label, so the protocol it pins is unaffected; only the comment at its lines 84-86,
   which calls that label "the normal case of every slice", stops being true and is corrected.
   Provenance: own call, from debt A-3.
