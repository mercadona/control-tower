# PR 375 — Apply feedback architecture evidence

## Scope and authority

Analysis date: 2026-09-16. Checkout: `/Users/jponzvan/git/control-tower-plugin/.worktrees/331`.
Repair base: `b26554378b437b77362699cef1d867756c559283`; `git rev-parse HEAD` returned that exact value.
Initial `git status --short` returned no tracked changes. All source paths below refer to this checkout.

I read the current AGENTS.md, the CT receiving-code-review, writing-plans-prescriptive and subagent-driven-development skills, the plan template, all eight plugin convention documents, backend conventions, frontend README conventions, and the live issue through `gh issue view 331 --repo mercadona/control-tower --json body,url,title`.
The live issue confirms the delivery amendment, the no-further-Claude-call limit, the open human apply gate and the protected plugin files.
The assignment explicitly supplies the no-feature-flag decision and completed Project enrollment. I made no GitHub mutation.

The original run remains delivered. `.agent/SLICE.md` still contains its old dispatch seed; that does not authorize a run reset.
This supplement is post-PR review work, not tasks 24 onward. #370 is development-run recovery and supplies no product dependency.
#332 still owns backend-driven per-step execution, schemas, context and attempt attribution.

## Classification summary

| Report | Classification | Evidence-based conclusion |
|---|---|---|
| Headless Bash authorization | **Partial** | The missing explicit grant is confirmed. Actual Bash denial in this environment is unverified and depends on inherited settings. The reported unconditional failure is too strong. |
| Publication/restart recovery has no actionable caller | **Confirmed, with one factual correction** | Production recovery only projects records. No recovery POST reaches continuation. `HeadlessPlanAgents.resume()` refuses; it does not launch work. |
| Failed worker acceptance strands dispatch resources | **Confirmed, with a safety qualification** | Definite non-launch and ambiguous acceptance both retain resources, with no retirement path. Missing acknowledgement alone must retain them. |

## 1. Explicit headless authorization is absent

### Source evidence and causal trace

- `backend/src/infrastructure/claude-plan-calls.ts:58-68` assembles `-p`, stream JSON, verbosity, `--permission-mode acceptEdits`, model, plugin and session identity. It passes no `--allowedTools`.
- `backend/src/infrastructure/claude-conversations.ts:15` defines that permission mode. Its interactive PTY argv also uses `acceptEdits`; do not confuse this backend entrance with the distributed plugin.
- `plugin/scripts/ct-next.mjs:2559-2571` does construct the historical interactive command with a permission-bypass flag. That fact does not authorize copying it.
- `backend/src/infrastructure/headless-call-worker.ts:91-99` inherits settings through the normal environment and starts Claude with ignored stdin. No human can answer an interactive permission question there.
- `backend/src/infrastructure/plan-agent-brief.ts:35-48` asks for issue hydration, contract validation and a commit. These need shell operations, not merely Edit/Write.
- `backend/src/infrastructure/plan-contract-progress.ts:46-64` returns WRITING for an unmet contract or uncommitted plan. `gh-plan-publication.ts:36-50` refuses publication unless the plan is READY and exactly one committed plan exists.

Failure trace under settings that do not already allow the needed Bash commands: prepare descriptor → Claude can edit a plan → Bash permission blocks validation or commit → no committed READY plan → publication refuses → supervised continuation logs a failure → the record remains uncertain.
An error CLI result also stops continuation even if its process exit is zero. That existing protection must stay.

### What current tests measure

`backend/__tests__/infrastructure/claude-plan-calls.test.ts:15-44,102-124` doubles the call adapter and asserts the current argv, including its omission.
`backend/__tests__/infrastructure/claude-calls-real-process.test.ts:22-55` uses `process.execPath` as its binary. It proves process survival and deadlines, not Claude permissions.
`docs/superpowers/evidence/issue-331-apply.md:12-21` explicitly scripts git, GitHub and worker boundaries.
`docs/superpowers/evidence/issue-331-cli-captures.md:7-17` shows that the initial capture used `--tools ""`; the other complete commands are unavailable.
Those captures cannot prove plan creation, commit, READY, or successful resumed authorization.

### Repair and verification limit

Give headless calls an explicit `--allowedTools` contract for `Read,Glob,Grep,Edit,Write,Bash,Skill,Agent`, for plan, implementation and fix calls.
Keep `acceptEdits`, normal setting sources, plugin loading and hooks. This is a deliberate Bash tool grant for the already-authorized agent-conducted loop, which must run repository-specific verification commands.
It is not a claim that a shell allowlist is a sandbox. Existing deny rules and hook refusals remain authoritative; do not alter them or retry around them.
Do not add `--tools` restrictions that remove existing machine-required tools, or new version-specific permission flags.

Focused regression: assert the literal grant and unchanged identity/settings behavior at the call boundary for all three purposes.
The user has chosen to keep the no-live-Claude restriction. The permission smoke remains explicitly unverified, not a prerequisite that stops implementation or fixture verification.
The evidence gap includes real read/edit/verification/commit/READY behavior and explicit deny/hook-refusal cases. An argv assertion or fake binary cannot close it.

Read-only CLI inspection in this session returned Claude Code **2.1.273**. `claude --help` lists `--allowedTools`, `acceptEdits`, settings sources and permission controls.
Help proves syntax availability, not deny precedence or runtime success. No live Claude/model call occurred.

## 2. Product recovery projects uncertainty but cannot repair it

### Source evidence and causal trace

- `continue-plan.ts:27-32` waits for the planner, publishes, then starts implementation. The implementation has no request ID.
- `headless-plan-agents.ts:33-38,74-80` attaches this continuation only to the launch path and sends asynchronous failure to stderr.
- `headless-plan-agents.ts:40-48` always throws from direct `resume()`.
- `recorded-plan-recovery.ts:64-106` reads records and refreshes active projections. It has no continuation collaborator.
- `recorded-plan-recovery.ts:132-155` marks an unowned incomplete call uncertain. `:168-181` marks a successful planner uncertain because publication and continuation remain pending.
- `ct-api.ts:518-539,635-654,686` constructs the continuation and recovery as separate graphs; startup invokes only the projector.
- `active-plans-route.ts:143-155` calls that same projector on GET.
- `frontend/src/pages/home/Home.tsx:119-128,293-297,374-385` makes the visible retry call GET again. It cannot publish or attach a continuation.

Publication failure: successful durable planner → GitHub failure → no implementation descriptor → supervisor ends → every GET projects the same uncertainty.
Restart during plan: the detached worker survives → API loses its supervisor and in-memory accepted map → GET sees an unowned incomplete call → later completion can appear, but successful planning still has no continuation caller.
Restart during implementation: later completion can repair the projection. Recovery must observe that call, not resume a second implementation while it survives.

### Existing protection and the retry trap

`gh-plan-publication.ts:56-81,105-126` stores hash-addressed comment parts, reads all comment pages, and rechecks after an ambiguous post result.
Reuse this idempotence. Concurrent publication before either request sees the other's comment is still unsafe: serialize continuation before publication, not only before process start.
`claude-calls.ts:404-415` serializes starts within one API process. `:461-493` blocks unfinished competitors and matches non-null request IDs.
After implementation finishes, a new implementation with a null request ID can launch again. A recovery endpoint alone would expose this duplication.
Use stable identity `implementation:<planner-call-id>` and recognize an existing legacy implementation whose request ID is null.
Retain the existing implementation call before testing transcript availability; an existing call needs observation, not a new resumability test.

### Why tests miss the defect

`continue-plan.test.ts:193-202` proves publication failure starts no implementation, then stops.
`recorded-plan-recovery.test.ts:299-318` calls a successful planner “recoverable” but asserts only uncertainty.
Its fixture forbids spawn, IDs, clocks and polling at `:97-110`; it tests a read-only projector deliberately.
The Home retry tests replace successive GET answers with better state. They do not demonstrate a backend operation that causes that transition.

### Repair

Keep GET read-only. Add a coordinator/page POST that validates repository, issue and original conversation from disk, then attaches one supervisor.
Reuse `HeadlessPlanAgents` and `ContinuePlan`; do not turn the projector into a second conductor.
An incomplete original planner remains uncertain while a bounded wait observes its recorded completion and original deadline.
A successful planner retries idempotent publication and creates at most one implementation call.
Any existing implementation, including legacy descriptors, takes precedence: observe its recorded result and do not publish or launch again.
Corrupt or conflicting history, a failed planner, a failed implementation, an absent transcript for a genuinely new resume, and an expired incomplete call get explicit diagnostic refusals.
No automatic fresh call for failed execution: a coordinator must inspect and supply a specific repair through the existing PR fix mechanism where applicable.
No hidden deadline reset, made-up completion or ownership PID.

Focused regressions: publication retry across a rebuilt adapter graph; concurrent original supervision and POST; completed legacy implementation; accepted-but-unacknowledged worker; restart while planner runs; transcript missing only after publication; an existing implementation with missing transcript; expired incomplete and corrupt evidence.

## 3. Definite non-launch needs checked cleanup and retirement

### Source evidence and causal trace

- `headless-plan-agents.ts:33-36` writes the dispatch before asking the call adapter to start.
- `disk-plan-records.ts:165-190` writes `dispatch.json` exactly once.
- `claude-calls.ts:454-458` writes the prompt and call descriptor before spawn.
- `claude-calls.ts:638-674` uses the same exception family for synchronous spawn failure, worker error, exit before acknowledgement and acceptance timeout.
- `headless-call-worker.ts:91-123` spawns Claude before acknowledgement. IPC loss can therefore conceal a surviving Claude process.
- `start-milestone-plan.ts:100-121` and `start-plan.ts:167-185` compensate only when the dispatch cannot be found. They preserve work on an inconclusive read.
- `gh-dispatch-candidates.ts:203-213` imports the plugin's selection and passes cap 1. The preserved in-progress claim occupies that cap.

Definite failure trace: claim → worktree and seed → immutable dispatch → immutable call → synchronous worker spawn refusal → dispatch exists → compensation does nothing → cap remains occupied.
Ambiguous trace: claim → worker and child start → acknowledgement lost → timeout → the same preservation occurs, correctly.

### Two additional failure cuts

1. `disk-plan-records.ts:193-206` hides descriptors whose worktree disappeared, but `prepare()` uses all descriptors through `#descriptors()`.
   Manual worktree removal can make the UI empty while the old descriptor still blocks future preparation.
2. `headless-call-worker.ts:153-159,179-217` can publish completion after escalation even when signalling failed or a group still exists.
   Diagnostics go into measurement unavailability at `:237-249`; completion does not certify that all processes disappeared.
   Neither completion nor elapsed time is enough to authorize destructive cleanup.

`git-workspace.ts:291-304` checks each removal result and stops before branch deletion if worktree removal fails.
Its existing removal commands use force at `:176-181`, so the new cleanup path needs a verified untouched-workspace precondition and non-forcing worktree removal.
`dispatch-check-claims.ts:20-51` already owns checked claim/requeue invocation.
`plugin/scripts/dispatch-check.mjs:1408-1463` demands only in-progress and no local worktree or branch. It refuses already-ready and does not inspect remote work.
Cleanup must handle a lost successful requeue reply through fresh evidence, not by interpreting refusal text or editing labels itself.
`backend/src/infrastructure/gh-plan-issues.ts:166-196,253-263` already supplies an exact status reader and rejects multiple status labels.
The cleanup action can reuse `PlanIssues.statusOf` around `DispatchClaims.requeue`; no new command runner or unchecked label mutation is needed.

### Why tests miss the defect

`claude-calls.test.ts:323-364` deliberately groups spawn failure and acceptance timeout under preservation; its retry asserts an unfinished-call refusal.
`start-milestone-plan.test.ts:276-312` and `start-plan.test.ts:622-682` separately test unrecorded compensation and recorded preservation.
They have no positive proof of non-launch and no test that reaches a cleanup caller, releases cap, archives evidence and prepares the issue again.

### Repair

Record a separate immutable non-launch receipt only at a boundary that can prove no initial child started.
Valid sources: failure before any worker spawn attempt, synchronous worker-spawn failure, an OS spawn error before a worker spawn event, or the worker's own initial child-spawn failure.
Do not infer proof from generic error strings, an exit before acknowledgement, missing files, a deadline, an absent PID or an unavailable completion.
New call descriptors remain immutable. Old uncertain records without proof remain uncertain.

A separate cleanup POST uses that proof, verifies unchanged seeded HEAD, canonical worktree/branch, clean tracked and untracked files, no remote branch and no PR, then records its pre-cleanup evidence.
The seed reader comes from `plugin/scripts/state.js`; the backend must not invent another seed parser.
It performs checked workspace removal, checked branch removal, plugin requeue, then atomic evidence-directory retirement outside active `harness/`.
On any cut, keep the descriptor, proof, snapshot and claim where the failed step leaves them. Never report complete cleanup prematurely.
Use repository-level exclusion shared with starts and recovery; a second process sharing the state root is outside the current single-API deployment contract.
Receipt and snapshot fields describe events and verified facts, not phase, revision or process ownership.

The retirement location is `retired-harness/<conversation>/`; move the whole directory without changing bytes.
Archive only after successful checked requeue, or after fresh exact-ready status and absent local artifacts prove that its desired postcondition already exists.
An archive failure after requeue leaves ready plus an active blocking descriptor: retry retirement, not redispatch or claim mutation.
When a cleanup snapshot exists, recovery must keep the item visible even if the worktree is gone.

Focused regressions: proof survives an API restart; timeout never creates proof; partial removal retry; dirty/new commits/remote work refusal; requeue failure; lost successful requeue answer; archive failure; archived retry never touches a newer dispatch; cap-1 selection and preparation succeed after retirement.

## Operator outcomes

| Evidence | Permitted next act |
|---|---|
| Successful planner, no implementation | POST recovery; retry publication and attach one implementation. |
| Incomplete call before its recorded deadline | POST recovery to observe it; GET for fresh state. Never launch a competitor. |
| Incomplete call past its deadline, or uncertain process group | Preserve all evidence. Operator inspects worker logs and actual process identity. No cleanup/relaunch override in this repair. |
| Failed completed execution | Display diagnostic and call identity. Inspect and repair the actual failure; use the existing PR fix delivery for an applicable reviewed PR. |
| Missing transcript for a new resume | Restore the original transcript from a legitimate backup, then retry. Never substitute a conversation. |
| Definite initial non-launch and untouched workspace | POST cleanup; retry the exact failed cleanup step through that endpoint. |
| Cleanup cannot read evidence or finds changed work | Keep claim/evidence. Restore access or preserve/reconcile the unexpected work manually, then repeat the check. |
| Old stranded record with no non-launch proof | Human incident review must establish quiescence and preserve work. Do not manufacture a receipt from elapsed time or a guessed PID. |

For inconclusive legacy incidents, the recommended resolution is an explicit human incident decision after process inspection, not a new automatic abandonment mechanism.
This limitation is honest: the old record lacks the fact an automated destructive repair would need.

## Verification performed and deferred

- `git status --short`: initially clean.
- `git rev-parse HEAD`: exact repair base above.
- Live issue read: succeeded; no GitHub writes.
- `claude --version && claude --help`: exit 0, version 2.1.273, help only.
- `npm --prefix backend run typecheck`: exit 0. The inspected tsconfig has `noEmit: true` and no incremental output.
- I did not run Vitest: fixtures and caches write beyond the two permitted scratch artifacts. The plan marks these commands as implementation checks, not observations.
- No live permission smoke, model invocation, real governed-repository write, cleanup, test edit, run-state edit, commit or push occurred.
- Structural validation and extraction passed; the exact results follow below.

### Final structural validation

The validation process imported the real `validatePlan` and `planFilesForIssue` from `plugin/scripts/plan-contract.js`, and `extractTasks` from `plugin/scripts/plan-tasks.js`.
It read the scratch plan with `readFileSync`. Its `readFile` callback used `git show b26554378b437b77362699cef1d867756c559283:<path>` for each reference and current-state citation.
It did not use the parent checkout, change the validator, or call dispatch/release/run commands.

Final plan SHA-256 after the Task 5 correction: `3f2bd98babb02b6e556fdd277e678cd55a3212261f156a8c66668cc0aa20258c`.

```json
{
  "base": "b26554378b437b77362699cef1d867756c559283",
  "validatePlan": { "ok": true, "violations": [] },
  "extractTasks": { "tasks": 6, "problems": [], "testsAdded": 40, "testsRemoved": 0, "globalCommands": 4 },
  "missingModifyPathsAtBase": [],
  "discoverableIssuePlans": [
    "docs/superpowers/plans/2026-09-15-issue-331-the-headless-dispatcher.md"
  ],
  "exitCode": 0
}
```

All six TDD names and command blocks extracted. The final task test-name counts are 4, 6, 5, 7, 12 and 6.
The real validator accepted the normal 3500-character task limit, block taxonomy, line budgets, literal citation and Simplified Technical English checks.
Initial validation caught paragraph/wording issues and one 3544-character task. I corrected the prose and removed duplicate wording; I did not change any control.
I also corrected the test-list quoting after extraction initially returned empty test-name arrays. Final extraction measures the declared tests, not merely the headings.

`planFilesForIssue(331, [canonicalPlan, supplementalEvidencePlan])` returned only the canonical plan. The recommended evidence filename creates no second issue execution plan.

Before Sol began implementation, the following read-only check exited zero with no output. Current Task 5 work is listed separately below.

```bash
git diff --exit-code b26554378b437b77362699cef1d867756c559283 -- plugin/scripts/ct-next.mjs plugin/scripts/ct-step.mjs plugin/scripts/run-machine.js docs/superpowers/plans/2026-09-15-issue-331-the-headless-dispatcher.md docs/superpowers/metrics/issue-331.jsonl docs/superpowers/verdicts
git status --short
git diff --check
```

The two architecture artifacts live in ignored scratch space, so a clean tracked status does not mean they are absent.
No production or test implementation occurred in the architecture sessions. Sol's later implementation is recorded separately below; architecture validation does not certify it.

### Execution decisions and limits

1. The user keeps the no-live-Claude restriction. Sol proceeds with implementation and fixture verification; live permission smoke remains explicitly unverified. No live-call authorization request is a prerequisite to begin or finish those tasks. Apply remains human-owned.
2. The repair assumes one API owner for a state root. If simultaneous API owners are a product requirement, stop for a scope decision; in-memory exclusion cannot prove cross-process serialization.
3. Old ambiguous records have no durable non-launch proof. A human must inspect those incidents. The repair must not convert their missing evidence into a cleanup grant.
4. Sol must run the prescribed fixture suites, preserve their assertions, and report actual results. This architecture session's typecheck and structural validation are not those results.

## Execution handoff

One fresh Sol session implements this post-review supplement with CT TDD and the receiving-code-review workflow. One fresh clean Astra session judges the repair.
Use the CT execution workflow's manual path for these tightly coupled repairs; do not dispatch nested task agents or modify the delivered run ledger.
Keep per-task red/green and mutation evidence in the supplemental implementation report. Judge spec compliance and code quality independently of Sol's self-review.
Give the judge both `b265543..repair-tip` and whole-PR context. Do not instruct the judge to dismiss plan-mandated findings.

Recommend permanent artifacts under `docs/superpowers/evidence/pr-375-apply-feedback-plan.md` and `docs/superpowers/evidence/pr-375-apply-feedback-analysis.md`.
Sol can add an implementation report beside them. The original canonical issue plan, task verdicts, metrics and delivered run remain intact.
The no-live-Claude restriction remains in force. Smoke stays unverified and does not block implementation. Apply and merge remain human-owned.

## Coordinator preflight — scenario, documentation and discovery scope

The follow-up user instruction keeps the no-live-Claude restriction and asks for a complete six-task handoff. This preflight changes only the two architecture artifacts.

### Frontend payloads and callers

- `frontend/src/__scenarios__/HeadlessPlanMother.ts:38-40,46-62` constructs uncertain payloads without diagnostic or recovery metadata. Task 6 now includes this path explicitly.
- `frontend/src/pages/home/__tests__/Home.implementPlan.test.tsx:55-72` consumes that uncertain mother and pins the uncertainty banner and absence of duplicate launch controls. Task 6 includes this caller and strengthens its no-automatic-mutation assertion.
- `frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx:24-35` has another local uncertain payload builder. The existing scope already included this file; the plan now explicitly covers that builder as well as the shared mother.
- `Home.restoreWorkflow.test.tsx:451-466` proves a read-only retry with two GETs and restored event subscription. The plan preserves this test by retaining inspect-only `Reintentar recuperación`; the new eligible POST scenarios are separate tests.
- `frontend/src/app/active-plans/client.test.ts:52-56` also builds an uncertain payload directly. It remains in scope for strict valid/invalid metadata cases and tests through the shared mother.
- `frontend/src/pages/home/__tests__/Home.layout.test.tsx:49-57` uses only `HeadlessPlanMother.implementing()`. Its payload stays unchanged, and its test is an explicit focused verification target rather than an edit target.
- `Home.implementProgress.test.tsx`, `Home.implementHistory.test.tsx` and `Home.sessions.test.tsx` also consume implementing payloads. The full frontend suite protects these unchanged consumers.
- `frontend/src/pages/home/__tests__/helpers.tsx:62-71` already forwards requests, and the restore file has a local request-aware stub. The new mutation cases can use strict request-keyed doubles locally; no helper scope expansion or permissive response fallback is needed.

The shared mother's existing `uncertain()` stays a valid inspect-only scenario. Three new named scenarios distinguish observation, continuation and definite non-launch.
The client rejects missing metadata, unknown recovery actions and malformed details. Sol must repair the fixtures, not loosen the wire reader or remove existing tests.

### Documentation and limits

Task 6 now explicitly includes `backend/API.md` and `frontend/README.md`.
`backend/API.md:365-420` describes the old read-only recovery and omits the new endpoints, recovery metadata, partial-cleanup visibility and retirement evidence.
The update must document both POST contracts, accepted versus completed recovery, all endpoint refusals and shared protocol refusals, coordinator access, identity, deadlines, idempotence and cleanup cuts.
`frontend/README.md:12-22,109-128,291-299` describes endpoint consumption, the persistent session drawer and the proxy inventory. The update must cover the new Spanish actions and both proxy paths while retaining those behaviors.
Both documents must state that ambiguous legacy records remain inspect-only, that cleanup needs proof, and that not every unknown incident automatically clears.
The documents and implementation report must distinguish fixture verification from the unverified live smoke; the latter does not block implementation under the user's decision.

### Coordinator discovery: an update is necessary and bounded

`backend/src/domain/value-objects/phase-prompt.ts:29-60` composes brainstorming and groom prompts from role, gate and idea/spec instructions. It has no API discovery instruction or API-documentation path.
The searched plugin brainstorming/groom skill documentation does not supply these backend endpoints either. Adding API documentation alone would not put the capability in the coordinator's prompt.

The existing runtime address is already available: `backend/src/infrastructure/claude-conversations.ts:13-17,59-85,91-100` passes the prompt file on start and injects `CT_SESSION_HOOKS_URL` on both start and resume.
Its URL comes from the actual listening port in `ct-api.ts`; the coordinator can use its origin, rather than assume port 8787 or a local copy of this project's API document.

Task 1 therefore appends one literal `PhasePrompt.RECOVERY_CAPABILITIES` instruction to both factories. It names only GET active plans and the two repair POSTs, their identities/actions and refusal limits.
It grants no gate authority, introduces no API or environment variable, and changes no interactive argv.

The exact prompt consumers are all in the task scope:
- `backend/__tests__/application/open-coordinating-session.test.ts:181-210,247-274` pins full prompt text and freeze/idea adjacency.
- `backend/__tests__/application/open-groom-session.test.ts:149-161` pins the groom prompt.
- `backend/__tests__/infrastructure/disk-conversation-records.test.ts:17-22,46-54` pins the recorded prompt bytes.

Append after existing content so hydration order and existing gate assertions remain true. New outside-in assertions cover each phase's discovery text and limits.
`backend/src/application/actions/recover-coordinating-session.ts:88-104` resumes the existing conversation without a fresh prompt; `ClaudeConversations.resume()` confirms that behavior.
Already-running or resumed coordinators therefore do not learn this text automatically. The API documentation must include the bounded instruction for an operator to send through the existing session terminal.
The plan does not rewrite historical prompt files, silently replace a conversation, or invent a discovery endpoint to conceal that limit.

### Preflight validation result

The final preflight used the real `validatePlan`, `extractTasks` and `planFilesForIssue` APIs with source reads pinned to `b26554378b437b77362699cef1d867756c559283`.
The full JSON result appeared directly in session output, without a pipe, filter or hidden result file.
It returned `ok: true`, no violations, six tasks, 34 added test names, no removed tests and no extraction problems. All modify paths exist at the repair base.
The normal task and block budgets still pass. The supplemental filename still leaves only the original canonical issue plan discoverable.
The protected/history diff check, `git diff --check` and tracked status check all exited zero with no output.
This preflight ran no test suite, live CLI/model call, implementation, cleanup, GitHub mutation or run-state operation. Only the two existing scratch architecture artifacts changed.

## Task 5 correction — refusal projection and exhaustive ownership

### Current implementation evidence

The coordinator requested this narrow correction after Sol completed Tasks 1-4. I read `.agent/run-331/apply-feedback-progress.md` without changing it.
Its completed commits are `d586129`, `8b239cc`, `ed03b3c` and `b410448`; HEAD is now `b410448d9d09cceb0b1e0b7a4fb371ef5a1a5a45` with Task 5 source/tests in progress.
Those tracked modifications and untracked route files are Sol's work. I did not edit or discard them.
The progress file reports a failing start-refusal reflection guard after the fast suite. I inspected its cause; I did not rerun that suite.
The repair plan still validates against the original `b26554378b437b77362699cef1d867756c559283` base, not the partial implementation.

### The start subtype cannot leave the start census

Current `backend/src/domain/exceptions.ts:38-49` declares `PlanAgentNeverLaunched` under `PlanAgentNotLaunched`, with a `PlanNonLaunch` argument and `proof.diagnostic` as its message.
`backend/src/infrastructure/claude-calls.ts:435-470,656-717` constructs that subtype at definite pre-worker and worker-spawn failure cuts.
`backend/src/infrastructure/headless-plan-agents.ts:40-55` persists the receipt and rethrows the same error when that write succeeds. A failed receipt write instead becomes ordinary `PlanAgentNotLaunched`.

The subtype therefore reaches both production start boundaries:
- Loose: `start-plan.ts:113-118,167-177` retains the failure and returns it in `PlanNotStarted`; `start-plan-route.ts:561-563` invokes `PlanCollapse.of` on that actual cause.
- Milestone: `start-milestone-plan.ts:100-110` rethrows it when the dispatch exists; `start-plan-route.ts:514-516` invokes the same projection.

`start-plan-route.ts:380-382` looks up `cause.constructor` exactly. The registered parent at `:345` cannot project its new subclass.
Removing the subtype from the test would hide a real request failure behind the API's unexpected-error response.

The chosen correction is an explicit exact-constructor entry with HTTP 400, `plan-agent-never-launched`, and unchanged message detail.
Its distinct code preserves `plan-refusal.test.ts:69-73` and the global uniqueness assertion. It also tells definite non-launch apart from the broader uncertain launch failure.
The subtype and proof constructor stay unchanged. The response does not expose proof or authorize cleanup; the dedicated cleanup path still checks durable evidence.

### The registry key must describe identity, not construction

`start-plan-route.ts:326` requires `new (reason: string): PlanFailure`; `:388-390` constructs every registry member with `'x'` to discover its code.
That signature is false for the new proof-bearing subtype. A cast, a fake proof or a string overload would hide the mismatch.

Use `type PlanFailureClass = { readonly name: string; readonly prototype: PlanFailure }` for the registry key.
Keep `PlanCollapse.of` and `Projection` exact. `declaredCodes()` calls each registered projector with one valid `new PlanFailure('x')` message probe rather than constructing its key.
Every current `PlanCollapseOf` handler consumes only `message`, including the checkout-specific formatter. This change needs no new factory or registry framework.
Return one code per registered entry; do not deduplicate the result to make uniqueness pass.
Tests must also project a real `PlanAgentNeverLaunched` with real proof and verify that an undeclared subclass still raises.

### Partition only the two dedicated families, with replacement coverage

`plan-refusal.test.ts:41-66` currently reflects exported subclasses after excluding named family roots and established non-start families.
`PlanRecoveryFailure` and `PlanCleanupFailure` belong to their own endpoints. Add these two roots to `FAMILIES`, and exclude descendants by prototype ancestry from the start census.
Keep `PlanAgentNeverLaunched` in that census. Do not add individual new leaves to a suppression list or exclude names by prefix.

Current `recover-plan-route.ts:105-109` and `cleanup-plan-route.ts:64-68` check three leaves and map every remaining family member to `failed`.
Their `declaredCodes()` methods enumerate outcome constants, not exception coverage.
The current route tests cover request validation, acceptance, exclusion and origins, but do not reflect the exception families or exercise every leaf's response.
That is insufficient replacement coverage for removing these families from the start census.

Give each dedicated route an exact-constructor `Projection` for its four leaves and `declaredFailures()` from the same registry.
In each route test, reflect every exported descendant of its family and compare the dedicated entries exactly. Root classes are not leaves.
Use real HTTP with action doubles for all four literal code/detail answers. An unregistered descendant, even one under a known leaf, must not inherit an answer.
Bare family and unknown-subclass cases must reach the unexpected-error path, with reservations released and no successful projection refresh.
Existing planned application refusals remain HTTP 400. The draft's 404/409/422/503 answers do not supersede that contract; preserve protocol-specific refusals separately.

### Other typed causes actually crossing these boundaries

`cleanup-plan.ts:47-65,101-103` directly calls record and status ports. It does not wrap every failure in `PlanCleanupFailure`.
`disk-plan-records.ts:244-297,382-399` can throw `PlanAgentNotLaunched` or `PlanAgentNotNamed`; the existing status port can throw `PlanStatusNotRead` or `PlanStatusNotUnderstood`.
Register exactly these known collaborator constructors at the cleanup boundary: operational causes map to `cleanup-plan-failed`, unreadable causes to `cleanup-plan-unreadable`.
These classes retain their existing census ownership. The dedicated-family reflection compares only the dedicated portion of the route registry; separate HTTP cases cover the collaborators.
Multiple constructors can legitimately project to one endpoint decision code. The global guard still lists that wire code once and receives no new sharing exemption.

`HeadlessPlanAgents.recover():75-80` currently wraps every record lookup failure as `PlanRecoveryNotRead`, losing malformed evidence's distinction.
`ClaudePlanCalls.recoveryFor():109-114` separates the known record causes but then wraps unrelated errors too.
The correction names the two known conversions, keeps already-typed recovery errors, and rethrows unrelated causes. Do not solve exhaustiveness with a generic family or Error fallback.

### Exact Sol continuation instructions

1. Continue the current Task 5. Preserve the completed Tasks 1-4, their commits and recorded evidence.
2. In `start-plan-route.ts`, register the proof-bearing subtype under `plan-agent-never-launched`, use an identity-only key type, and enumerate codes without constructing keys.
3. In `plan-refusal.test.ts`, partition only recovery/cleanup roots and descendants; retain start exhaustiveness, uniqueness, unknown-type rejection and a real proof-bearing projection case.
4. Add loose-start HTTP coverage in the already-scoped `api-server.test.ts` and milestone coverage in `start-milestone-plan-route.test.ts`. Assert the exact 400/code/detail response, not `request-failed`.
5. Replace both dedicated route fallbacks with exact registrations, add family reflection plus leaf/root/unknown HTTP checks, and project only the concrete shared collaborator causes described above.
6. Preserve the operational/unreadable distinction in the current recovery callers. Keep unrelated errors outside declared refusals.
7. Run typecheck, the six focused refusal/start/route suites named in Task 5, and the backend fast suite. Report actual red/green results; do not suppress a remaining guard.
8. Task 6 documents the new start code beside the two repair endpoints. It must not suggest that the code alone permits cleanup.

The newly authorized Task 5 paths are `backend/src/infrastructure/start-plan-route.ts`, `backend/__tests__/infrastructure/plan-refusal.test.ts`, and `backend/__tests__/infrastructure/start-milestone-plan-route.test.ts`.
Both dedicated routes and their tests, both recovery callers, the API-server tests and the global code guard were already in Task 5 scope.
Shared decisions moved into §2 so the correction retains six tasks without dropping the policy contract or prior verification requirements.
This architecture correction changes only the two scratch artifacts; it performs no implementation, test execution, commit, state mutation, GitHub write or live Claude call.

### Correction validation

The actual `validatePlan` result is `{"ok":true,"violations":[]}` against the original repair base.
`extractTasks` returns six tasks, no problems, 40 added regression names, no removed tests and all four global commands.
Task 5 measures **3210 characters**, within the unchanged 3500-character limit. All task/block budgets pass.
All modify paths exist at `b26554378b437b77362699cef1d867756c559283`; the evidence filename leaves only the original issue plan discoverable.
The complete validation and extraction JSON appeared directly in session output. No filter or result-log file was used.

The protected/history diff against `b26554378b437b77362699cef1d867756c559283` exited zero.
The final status listing still contains Sol's original Task 5 modifications and untracked files; no source or test path was changed by this architecture correction.
I did not run typecheck or tests on the partial implementation. Those checks and their actual results belong to Sol's correction handoff.
