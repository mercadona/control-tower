# PR 375 — Repair headless authorization and recovery

> Task-scoped subagents execute this plan in the normal CT workflow. This post-review supplement uses one fresh Sol session and one clean Astra judge.
> Use CT receiving-code-review and TDD. Use the manual execution path for these coupled tasks. Do not extend the delivered run.

## 1. Context and goal

The repair base is `b26554378b437b77362699cef1d867756c559283` in `.worktrees/331`.
`ClaudePlanCalls` lacks explicit shell authorization. `RecordedPlanRecovery` projects evidence but cannot attach continuation.
Definite non-launch leaves a dispatch that blocks cleanup and later preparation.
The companion analysis gives source locations, causal traces and verification limits.

### Desired end state

- Headless plan, implementation and fix calls carry explicit tool grants and retain repository controls.
- A page or coordinator can attach recovery to the original conversation.
- Publication retry creates no duplicate comments or implementation calls.
- Proven non-launch has checked cleanup and evidence retirement.
- Ambiguous work retains its claim and evidence.

### Out of scope

Keep `plugin/scripts/ct-next.mjs`, `plugin/scripts/ct-step.mjs` and `plugin/scripts/run-machine.js` unchanged.
Keep the original plan, delivered run, verdicts, counters and attempt metrics unchanged.
Do not use #370, add a run machine, or implement #332 step attribution.
Do not add permission bypasses, reset budgets, guess cost, or create replacement conversations.
Keep gate 1, gate 2, apply and merge human-owned. Keep loose starts, milestone starts, PR fixes and the session drawer.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Feature flag | None; the coordinating user already chose this for #331. |
| Live verification | The user keeps the no-live-Claude restriction. Smoke remains unverified and does not block implementation or fixture verification. |
| Permission contract | Keep `acceptEdits`. Add one `--allowedTools` value: `Read,Glob,Grep,Edit,Write,Bash,Skill,Agent`. |
| Authorization scope | Bash supports repository-specific checks and the existing agent-conducted loop. Normal settings, denies, hooks and plugin loading retain authority. |
| Forbidden permission changes | No bypass mode, bare mode, safe mode, setting-source suppression, hook override, or retry around a refusal. |
| Recovery entry | `POST /recover-plan` accepts exactly `{repo, issue, agent}`. It resumes supervision, not a new conversation. |
| Cleanup entry | `POST /cleanup-plan` accepts exactly `{repo, issue, agent}`. It only retires proven initial non-launch. |
| Route authority | Use existing origin and JSON checks. Allow originless coordinator requests. Neither route uses or mints a human gate key. |
| Route answers | Recovery returns 202 with `{agent}`. Cleanup returns 200 with `{agent}` only after retirement. Refusals use `{code, detail}`. |
| Refusal codes | Use endpoint prefixes `recover-plan-` and `cleanup-plan-` with `invalid-request`, `not-found`, `conflict`, `failed`, `unreadable`. |
| Recovery policy | Observe incomplete calls within their original deadline. Refuse expired, corrupt, conflicting or failed evidence. Never infer a new phase. |
| Continuation identity | Use request ID `implementation:<planner-call-id>`. Recognize the sole legacy implementation with a null request ID. |
| Continuation ordering | Read an existing implementation before publication or transcript checks. If one exists, observe it without another launch. |
| Concurrency | One API owns a state root. Share repository exclusion with starts and both POSTs. Single-flight continuation includes publication and acceptance. |
| Recovery supervision | POST returns after evidence checks and supervisor registration. The supervisor retains its wait after HTTP disconnect. GET remains read-only. |
| Failure display | The page renders the diagnostic and original conversation. A failed call needs inspection; recovery never silently repeats model work. |
| Non-launch proof | Write immutable `harness/<agent>/non-launch.json` only for a proven initial non-launch. Missing proof means uncertain. |
| Proof schema | Exact keys: `conversation`, `callId`, `source`, `diagnostic`, `observedAt`. `callId` is null only before call allocation. |
| Proof sources | `before-worker`, `worker-spawn`, `child-spawn`. Each source asserts no initial Claude child started; it never describes a timeout. |
| Cleanup evidence | Write immutable `cleanup-evidence.json` before removal. Exact keys: `conversation`, `baseSha`, `branch`, `worktree`, `checkedAt`. |
| Cleanup safety | Validate canonical identity, unchanged seed base, clean worktree, no remote branch and no PR before removal. Refuse inconclusive reads. |
| Cleanup ordering | Check proof and workspace, record evidence, remove worktree and branch, call checked plugin requeue, then retire the evidence directory. |
| Retirement | Atomically rename the whole directory to `retired-harness/<agent>`. Never overwrite another archive or change descriptor bytes. |
| Partial cleanup | Keep active records visible without a worktree when cleanup evidence exists. Retry through the same endpoint and original identity. |
| Requeue replay | After a lost answer, fresh exact-ready status plus absent local artifacts permits retirement. Do not edit labels outside the plugin. |
| Legacy uncertainty | Ambiguous legacy records stay inspect-only. No receipt synthesis or cleanup override exists; a human must inspect inconclusive incidents. |
| Telemetry | Keep CLI totals and wall duration distinct. Resumed attributable cost remains null. No hidden budget reset or attempt-row write. |

### Contract details

`PlanRecords.recorded(agent): Promise<PlanWatch | null>` reads active identity without a worktree-existence filter.
`PlanRecords.retired(agent): Promise<PlanWatch | null>` reads archived identity. Both validate the full dispatch before any action.
`find` must still return an active cleanup record after partial removal, so milestone starts cannot pass its precheck.
`prepare` must ignore archives and retain its active-descriptor collision check.

`UnusedWorkspace` is an immutable value in `backend/src/domain/value-objects/unused-workspace.ts`.
Its constructor takes `{watch: PlanWatch, baseSha: string, checkedAt: string}` and validates a 40-hex base and ISO time.
The record adapter maps this value to the cleanup schema. Reuse the existing snapshot rather than overwrite its time on retry.
`PlanRecords.cleanupEvidence(watch): Promise<UnusedWorkspace | null>` reads that snapshot.
`PlanRecords.recordCleanupEvidence(evidence): Promise<void>` publishes it once.

`Workspace.inspectUnlaunched(watch, previous): Promise<UnusedWorkspace>` checks current facts; `previous` is `UnusedWorkspace | null`.
`CleanupPlan` stores that evidence, then calls `Workspace.undoUnlaunched(evidence): Promise<void>`.
This keeps snapshot storage outside the git adapter. No new constructor dependency enters `GitWorkspace`.

Reuse `PlanIssues.statusOf` for exact status reads and `DispatchClaims.requeue` for the checked mutation.
The existing status reader rejects multiple status labels. Do not use `PlanIssues.requeue`, which lacks checked workspace preconditions.

`CleanupPlan` reads status before removal and accepts only ready or in-progress. Other statuses refuse cleanup.
After removal, read status again. In-progress calls checked requeue once; ready needs fresh local-artifact absence before retirement.

If the checked call fails, preserve its diagnostic and read status. Only exact-ready plus fresh artifact absence proves the desired effect.
If that read fails or answers another status, stop and preserve the original failure. Never retry a refused mutation blindly.

Fresh workspace checks use git worktree porcelain, exact branch identity, the plugin seed parser, HEAD, full status and `git ls-remote`.
Check PRs with `gh pr list --state all --head <branch> --json number --limit 1`; any returned PR prevents cleanup.
An absent worktree on retry needs the snapshot plus exact branch-tip equality before branch deletion.
Refuse changed paths, foreign worktrees, remote branch existence, unknown seed data, dirty or untracked files, and unreadable results.
Recheck the destructive preconditions immediately before removal. A failed removal never falls back to a stronger command.

The shared evidence decision lives in `PlanRecovery` under `backend/src/domain/policies/plan-recovery.ts`.
It consumes call facts, proof, cleanup evidence and an injected current time. It returns an immutable decision with action and detail.
Call facts carry original identity, purpose, start time, recorded deadline and completion. The policy never performs I/O.

`PlanCalls.recoveryFor(watch): Promise<PlanRecovery>` supplies that decision from adapter reads.
Both the projector and `HeadlessPlanAgents.recover` use it. Keep one decision, not two matching conditionals.
`ClaudeCalls.deadlineOf(call): Promise<number>` reads the immutable descriptor deadline for this caller.
Inject `nowMs: () => number` into `ClaudePlanCalls`; production passes `Date.now`, and tests control that clock.

Read non-launch proof before history that might contain partial preparation. Validate any partial directory against the receipt's call identity.
Only `before-worker` permits an absent descriptor. Every source refuses an extra call, successful execution or contradictory stream evidence.

Generic history-read failure never proves non-launch. Share receipt conversion between `DiskPlanRecords` and the worker through its boundary model.
`PlanRecords.nonLaunch` validates those facts before it returns proof. Cleanup and recovery reuse that validation, not independent proof rules.

`NonLaunchRecord` lives in `backend/src/infrastructure/non-launch-record.ts` because two adapters consume its format.
Its static methods are `read(text: string): PlanNonLaunch` and `text(proof: PlanNonLaunch): string`.

Decision precedence is: corrupt/conflicting evidence, valid non-launch, existing implementation, failed planner, incomplete planner, successful planner, absent evidence.
Corrupt/conflicting, failed and absent evidence answer `inspect`. Valid non-launch answers `cleanup`.
An incomplete implementation answers `observe` only before its recorded deadline. A completed implementation answers `inspect`, never `continue`.

An incomplete planner answers `observe` only before its recorded deadline. A successful planner without implementation answers `continue`.
After supervisor registration, call results remain evidence; a failed result never becomes successful because telemetry exists.

Include the target call in `observe` and `continue` decisions. `HeadlessPlanAgents` observes implementation/fix calls with its existing success waiter.
Only the planner goes through `ContinuePlan`. A later fix takes precedence over a completed implementation; never replay a completed fix.
Refuse conflicting unfinished calls and timestamp ties rather than select one silently. A read-only refresh can still discover late completion.

Add error families `PlanRecoveryFailure` and `PlanCleanupFailure` under `PlanFailure`.
Task 2 declares both families so later tasks can use them without a forward dependency.
Use `PlanRecoveryNotFound`, `PlanRecoveryConflict`, `PlanRecoveryNotRead` and `PlanRecoveryNotUnderstood` for recovery.
Use `PlanCleanupNotFound`, `PlanCleanupConflict`, `PlanCleanupNotRead` and `PlanCleanupNotUnderstood` for cleanup.
Map these suffixes to `not-found`, `conflict`, `failed` and `unreadable` under the endpoint's prefix.

Map existing collaborator failures by their cause family, not their message. Invalid wire input reaches no action.

### Task 5 correction: refusal ownership and constructor safety

Apply this correction to Sol's current Task 5. Preserve Tasks 1-4, their commits and their recorded completion evidence.
The original repair base remains `b26554378b437b77362699cef1d867756c559283`. Current implementation evidence is not a replacement validation base.

Keep `PlanAgentNeverLaunched extends PlanAgentNotLaunched` and its proof constructor unchanged.
It reaches `PlanCollapse` through both loose failure results and thrown milestone failures. It belongs in the start-refusal census.
Register its exact constructor with HTTP 400, code `plan-agent-never-launched`, and the original `cause.message` as detail.

Keep `plan-agent-not-launched` for its parent. A distinct code preserves the existing uniqueness guarantee and distinguishes definite from uncertain launch failure.
The new code never grants cleanup; the cleanup endpoint still checks durable proof. Do not serialize proof into the start response.

Change only `PlanFailureClass`'s key contract to `{ readonly name: string; readonly prototype: PlanFailure }`.
Keep exact-constructor dispatch in `PlanCollapse.of`. Do not walk prototypes or alias every subtype to its parent.
`declaredCodes()` enumerates registered projectors and invokes each with one valid `new PlanFailure('x')` message probe.

It must not instantiate registered constructors. Existing `PlanCollapseOf` handlers consume only `message`; keep that contract and every existing formatter.
Return one code per registry entry without deduplication. Retain the existing uniqueness and undeclared-family assertions.

In `plan-refusal.test.ts`, add only the two dedicated family roots to `FAMILIES`.
Exclude their descendants through `prototype instanceof PlanRecoveryFailure` and `prototype instanceof PlanCleanupFailure` from the start census.
Do not exclude `PlanAgentNeverLaunched`, match name prefixes, or maintain a leaf-name suppression list.
Retain the exact equality between the reflected start census and `PlanCollapse.declaredFailures()`.
Verify the proof-bearing subtype with a real `PlanNonLaunch` mother and its literal 400/code/detail result.
Also assert that an unregistered subclass of `PlanAgentNotLaunched` still raises; parent registration does not cover it.

Each dedicated route declares an exact-constructor `Projection` for its four family leaves, using the existing `projection.ts` unchanged.
Expose `RecoverPlanRoute.declaredFailures(): string[]` and `CleanupPlanRoute.declaredFailures(): string[]` from those registries for the guards.
Map `NotFound`, `Conflict`, `NotRead` and `NotUnderstood` explicitly to the four §2 codes. Remove the default-to-failed branch.

Bare family roots and unregistered descendants must raise, not become `failed`. Keep the existing narrow request/error boundaries.

Each dedicated route test reflects every exported descendant of its family, excluding only that root.
Compare that census to the registry's dedicated-family entries. Enumerate literal expected payloads for all four leaves through real HTTP and action doubles.
Assert HTTP 400, exact endpoint code and unchanged detail. Assert root and unknown-subclass failures reach the unexpected-error path, not a declared refusal.

Keep reservation release, no projection after action failure, protocol refusals and existing request validation assertions.
The cross-route code guard still checks unique codes; do not add a sharing exemption for the new start code.

The cleanup action also propagates existing record and status errors before its dedicated family can answer.
Register exact `PlanAgentNotLaunched` and `PlanStatusNotRead` constructors as `cleanup-plan-failed` in the cleanup boundary.
Register exact `PlanAgentNotNamed` and `PlanStatusNotUnderstood` constructors as `cleanup-plan-unreadable` there.
Keep these shared collaborator classes in their existing census; they are not new dedicated family members.
Check their HTTP payloads separately. Different constructors can share an endpoint decision code; global code enumeration lists each wire code once.

In recovery adapters, preserve `PlanAgentNotNamed` as `PlanRecoveryNotUnderstood` and `PlanAgentNotLaunched` as `PlanRecoveryNotRead`.
Keep already-typed recovery errors. Rethrow unrelated causes rather than wrap every exception as a read failure.
This preserves §2's operational/unreadable distinction without a generic `PlanFailure` or `Error` fallback at either route.
Retain the planned HTTP 400 application-refusal contract; current draft 404/409/422/503 projections are not authority to change it.

The `PlanRecovery` policy contract remains unchanged. Its immutable `decision` is `Readonly<RecoveryDecision>`.
`RecoveryDecision` carries `{action: 'observe' | 'continue', detail: string, call: StartedPlanCall}` or `{action: 'cleanup' | 'inspect', detail: string}`.
`RecoveryCall` carries `call: StartedPlanCall`, `purpose: PlanCallPurpose`, `startedAt: string`, `deadlineMs: number`, and `completion: CompletedPlanCall | null`.
`PlanRecovery.from(facts): PlanRecovery` takes `calls: readonly RecoveryCall[]`, `proof: PlanNonLaunch | null`, `cleanup: UnusedWorkspace | null`, and `nowMs: number`.

Task 5 still wires both actions into `ct-api.ts` and `ApiServer`, shares repository reservations, and releases them in finally.
Inject records into `ClaudePlanCalls` and plan calls into the projector. Use `recoveryFor` for projection and mutation eligibility.
Uncertain output carries `recovery: {action, detail}`; partial cleanup remains visible without a worktree. Refresh projection after operations.
Keep the production-collaborator HTTP rehearsal with exact scripted external requests.

### Caller and documentation contracts

Task 6 keeps `HeadlessPlanMother.uncertain()` as a valid inspect-only payload with diagnostic and `recovery: {action: 'inspect', detail}`.
Add named scenarios `awaitingObservation()`, `awaitingContinuation()` and `unlaunched()` for the other actions. Keep planning and implementing payloads unchanged.
Use these scenarios in client and Home tests. Update the restore test's local `activePlan('uncertain')` payload too.
Missing recovery metadata, unknown actions and non-string details must fail GET validation; do not add a permissive fallback.

Keep `No se puede confirmar el estado de implementación` as the uncertainty banner title.
Keep `Reintentar recuperación` as the inspect-only GET refresh, alongside the diagnostic. The new actionable cases use POST.
Preserve the existing retry test's two GETs, identity and event-stream assertions. Add POST tests rather than replace that read-only scenario.
Strengthen `Home.implementPlan.test.tsx` to forbid automatic recovery and cleanup POSTs for the inspect-only mother.

`Home.layout.test.tsx` uses only `implementing()`. Run it unchanged, together with implementation progress, history and session tests in the full frontend suite.
The existing Home helpers already forward explicit requests. Keep mutation doubles local and keyed by request; do not broaden shared fallback answers.

Task 6 updates `backend/API.md` with both endpoint sections, exact bodies, 202/200 answers, all ten prefixed refusal codes and shared protocol refusals.
Also document `plan-agent-never-launched` in the start-plan refusal table, without any automatic-cleanup promise.
Document application refusals as HTTP 400, coordinator access without a gate key, and the original conversation identity checks.
Update `GET /active-plans` with mandatory uncertain metadata, partial-cleanup visibility, and the new immutable receipts and retirement directory.
Document single-API exclusion, recorded deadlines, idempotence, inspect-only legacy uncertainty and missing-transcript refusals. Acceptance does not mean completed recovery.

Task 6 updates `frontend/README.md` with Spanish actions, POST-then-GET behavior, inspect-only refresh, local discard and unchanged drawer/session behavior.
Document both proxy paths and link to `backend/API.md` for wire details. Correct affected endpoint/proxy inventories against the actual routes.
Both documents state that no-live-Claude remains in force and smoke remains unverified. Neither promises that every unknown incident clears automatically.

`PhasePrompt` currently declares roles and gates but no API discovery instruction. Task 1 appends `RECOVERY_CAPABILITIES` after existing content in both factories.
Use the existing `CT_SESSION_HOOKS_URL` origin; never assume port 8787 or a documentation file in the governed checkout.
Keep every existing gate sentence and hydration-order assertion. Update exact prompt expectations in both opening tests and the disk-record test.

Assert the literal discovery instruction through each opening action, not only equality with its new constant. Keep existing tests and their assertions.

Existing resumed coordinators retain their old transcript and do not reread a new phase prompt.
Document the recovery instruction in `backend/API.md` so an operator can send it through the existing session terminal without a replacement conversation.
Do not rewrite stored prompts, change resume argv, or add a capability-discovery endpoint.

## 3. Reference patterns

Files to imitate:
- `backend/src/infrastructure/start-plan-route.ts`
- `backend/src/infrastructure/dispatch-check-claims.ts`
- `backend/src/infrastructure/headless-files.ts`
- `backend/src/application/actions/continue-plan.ts`
- `frontend/src/app/active-plans/client.ts`

Rules to obey:
- `AGENTS.md`
- `backend/conventions/this-repository.md`
- `frontend/README.md`
- `plugin/conventions/architecture.md`
- `plugin/conventions/boundaries.md`
- `plugin/conventions/decisions.md`
- `plugin/conventions/defects.md`
- `plugin/conventions/domain.md`
- `plugin/conventions/simplicity.md`
- `plugin/conventions/style.md`
- `plugin/conventions/testing.md`
- `plugin/skills/receiving-code-review/SKILL.md`
- `plugin/skills/writing-plans-prescriptive/SKILL.md`
- `plugin/skills/subagent-driven-development/SKILL.md`

## 4. Inventory

Each task's Files marker is its exact allowed path list. No wildcard grants scope.

| Task | Action | Consumed by | Block in §7 |
|---|---|---|---|
| 1 | Declare tool grants and recovery discovery | Worker and coordinator | Current state / Contract |
| 2 | Extend call lookup and continuation; add recovery action | Recovery POST | Contract |
| 3 | Add durable non-launch proof | Cleanup action | Contract |
| 4 | Add checked cleanup and retirement | Cleanup POST | Contract |
| 5 | Wire both actions through production routes | Page and coordinator | Contract |
| 6 | Add caller, scenarios, API documentation and evidence | Human and clean judge | Contract |

## 5. Interfaces

Consumes: `ContinuePlan.execute(params)`, `PlanCalls.start/wait`, immutable dispatch and call records, and existing publication idempotence.
Consumes: plugin `parseStateSafe`, `DispatchClaims.requeue`, `Workspace.undo`, `WorkInFlight`, and existing start route protection.
Produces: `PlanAgents.recover({agent, issue, repository}): Promise<void>` for the recovery action.
Produces: `RecoverPlan.execute(params): Promise<void>` and `CleanupPlan.execute(params): Promise<void>` for the two POSTs.
Produces: `PlanRecords.archive(watch): Promise<void>` for evidence retirement.

The task contracts define the other port additions. Keep parameter objects beside their actions and exceptions in the existing catalogue.

## 6. Test strategy

Use outside-in TDD. Double ports in action tests and external systems in adapter tests.
Use real HTTP for route tests with action doubles. Add one recovery happy-path rehearsal through production collaborators.
Measure cuts at their owning layer. Keep all unrelated assertions and existing preservation tests.

Any new subprocess test uses `-real-process.test.ts` and unconditional child cleanup.
Mutation evidence must show that removal of identity, proof, ordering and idempotence checks makes the focused assertions fail.
Do not run live Claude from the suite. An argv assertion and a Node fixture cannot prove Claude permissions.

## 7. Tasks

### Task 1 — Declare tool grants and recovery discovery

**Objective:** Declare headless tool grants and coordinator recovery capabilities while repository controls retain authority.

**Files:** `backend/src/infrastructure/claude-plan-calls.ts` (modify), `backend/__tests__/infrastructure/claude-plan-calls.test.ts` (modify).
`backend/src/domain/value-objects/phase-prompt.ts` (modify), `backend/__tests__/application/open-coordinating-session.test.ts` (modify), `backend/__tests__/application/open-groom-session.test.ts` (modify), `backend/__tests__/infrastructure/disk-conversation-records.test.ts` (modify).

Current state (backend/src/infrastructure/claude-plan-calls.ts, lines 60-67):
```ts
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', ClaudeConversations.PERMISSION_MODE,
      '--model', ClaudeConversations.MODEL,
      '--plugin-dir', this.pluginRoot,
      mode === 'resume' ? '--resume' : '--session-id', conversation,
      ClaudePlanCalls.OPENING,
```

Add the §2 grant as `ClaudePlanCalls.ALLOWED_TOOLS`. Keep normal setting sources and the exact conversation options.
Do not change interactive coordinator argv. Preserve inherited denies and hooks; do not rewrite settings.

Contract (backend/src/domain/value-objects/phase-prompt.ts):
```ts
static readonly RECOVERY_CAPABILITIES =
  'For recovery of already-authorized work, use the origin of $CT_SESSION_HOOKS_URL as the backend URL. '
  + 'Read GET /active-plans and preserve each returned repo, issue number and agent identity. '
  + 'For observe or continue, POST /recover-plan with exactly {repo, issue, agent} as JSON; '
  + 'for cleanup, POST /cleanup-plan with the same identity. Read GET /active-plans again after an answer. '
  + 'Inspect means read the diagnostic and refresh only; never force cleanup or launch replacement work. '
  + 'Recovery acceptance is not completion. Respect refusals; gates 1 and 2 and merge remain human-owned.'
```

Append this instruction in both factories as §2 specifies. It discovers only the two repair endpoints and the existing read endpoint.

**TDD:** `it('headless tools are explicitly authorized for every call purpose')` asserts the literal grant for plan, implementation and fix.

**Tests:** Added: `'headless tools are explicitly authorized for every call purpose'`, `'headless authorization preserves settings hooks and conversation identity'`, `'brainstorming explains recovery without granting human gates'`, `'groom explains recovery without granting human gates'`. Removed: none.

**Verification:** Typecheck already passed at the repair base. Run the focused test after the change; runtime permissions remain unverified.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/claude-plan-calls.test.ts
npm --prefix backend test -- __tests__/application/open-coordinating-session.test.ts __tests__/application/open-groom-session.test.ts __tests__/infrastructure/disk-conversation-records.test.ts
```

### Task 2 — Attach recovery to the original continuation

**Objective:** Recover successful or incomplete planning without duplicate publication or implementation calls.

**Files:** `backend/src/domain/ports/plan-agents.ts` (modify), `backend/src/domain/ports/plan-calls.ts` (modify), `backend/src/application/actions/continue-plan.ts` (modify), `backend/src/application/actions/recover-plan.ts` (create), `backend/src/infrastructure/headless-plan-agents.ts` (modify), `backend/src/infrastructure/claude-plan-calls.ts` (modify).
`backend/src/infrastructure/claude-calls.ts` (modify), `backend/__tests__/application/continue-plan.test.ts` (modify), `backend/__tests__/application/recover-plan.test.ts` (create), `backend/__tests__/infrastructure/headless-plan-agents.test.ts` (modify), `backend/__tests__/infrastructure/claude-plan-calls.test.ts` (modify).
`backend/src/domain/exceptions.ts` (modify).

Contract (backend/src/domain/ports/plan-calls.ts):
```ts
planningFor(watch: PlanWatch): Promise<StartedPlanCall>
implementationFor(watch: PlanWatch): Promise<StartedPlanCall | null>
```

`RecoverPlan` depends on `PlanAgents`; immutable `RecoverPlanParams` carries agent, issue and repository.
`HeadlessPlanAgents.recover` finds the disk record, checks identity, and asks `planningFor` before supervisor registration.
The adapter reads real history. Refuse multiple planners, multiple implementations, failed calls, malformed evidence and incompatible unfinished calls.
Reject absent planning evidence. For an incomplete planner, retain its original deadline and do not claim process ownership.

`ContinuePlan` shares one in-memory promise per conversation across launch and recovery. Hold it through publication and implementation acceptance.
Check `implementationFor` first; existing legacy or current calls need no publication, new launch or transcript check.
Otherwise wait for successful planning, publish, then use `implementation:<planner-call-id>` as the start request ID.
The call adapter recognizes that stable ID before transcript checks. Keep unfinished-call exclusion and PR fix request IDs.

POST never waits for the entire model call. Keep asynchronous diagnostics and refresh evidence through the existing projector.

**TDD:** `it('publication recovery resumes the original conversation exactly once')` retries publication across a rebuilt graph and asserts one implementation.

**Tests:** Added: `'publication recovery resumes the original conversation exactly once'`, `'concurrent supervisors share publication'`, `'legacy implementation prevents another launch'`, `'restart observes the original planner deadline'`, `'failed ambiguous or expired calls cannot relaunch'`, `'existing implementation needs no transcript'`. Removed: none.

**Verification:** Run the focused recovery contracts and typecheck. These tests are implementation checks, not architecture-session results.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/application/continue-plan.test.ts __tests__/application/recover-plan.test.ts __tests__/infrastructure/headless-plan-agents.test.ts __tests__/infrastructure/claude-plan-calls.test.ts
```

### Task 3 — Preserve proof of definite initial non-launch

**Objective:** Distinguish proven initial non-launch from lost acceptance and preserve immutable descriptors.

**Files:** `backend/src/domain/exceptions.ts` (modify), `backend/src/domain/value-objects/plan-non-launch.ts` (create), `backend/src/domain/ports/plan-records.ts` (modify), `backend/src/infrastructure/disk-plan-records.ts` (modify), `backend/src/infrastructure/claude-calls.ts` (modify), `backend/src/infrastructure/headless-call-worker.ts` (modify).
`backend/src/infrastructure/headless-plan-agents.ts` (modify), `backend/__tests__/infrastructure/claude-calls.test.ts` (modify), `backend/__tests__/infrastructure/disk-plan-records.test.ts` (modify), `backend/__tests__/infrastructure/headless-plan-agents.test.ts` (modify), `backend/src/infrastructure/non-launch-record.ts` (create).

Contract (backend/src/domain/ports/plan-records.ts):
```ts
recordNonLaunch(watch: PlanWatch, proof: PlanNonLaunch): Promise<void>
nonLaunch(watch: PlanWatch): Promise<PlanNonLaunch | null>
```

`PlanNonLaunch` is immutable. Its validated facts match the §2 proof schema; its source uses the closed vocabulary there.
Add `PlanAgentNeverLaunched` under `PlanAgentNotLaunched`; it carries the proof, not a parsed diagnostic string.
Emit it only before any worker spawn attempt or from a definite OS worker-spawn failure before the spawn event.
Keep malformed-descriptor exceptions distinct; do not convert their existing assertions into operational failures.

`HeadlessPlanAgents.launch` records that proof for the newly prepared initial dispatch, then preserves the failure.
The worker writes the same receipt on a definite initial Claude child-spawn failure. Use existing atomic write-once semantics.
Record no proof for implementation/fix failure, lost IPC, timeout, exit-before-acknowledgement, or failed process-group signals.
A proof-write failure leaves the dispatch uncertain and retains both diagnostics. Never fabricate completion to unblock the adapter.

Cleanup will validate the receipt against all call history. Evidence conflicts mean unreadable data, never positive proof.

**TDD:** `it('definite initial non-launch survives restart as proof')` reads the receipt through a new record adapter.

**Tests:** Added: `'definite initial non-launch survives restart as proof'`, `'acceptance loss never authorizes cleanup'`, `'child spawn refusal records only initial non-launch'`, `'proof write failure preserves uncertainty'`, `'conflicting proof is not a launch outcome'`. Removed: none.

**Verification:** Run proof and worker boundary tests. Existing record-preservation assertions must remain true.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/claude-calls.test.ts __tests__/infrastructure/disk-plan-records.test.ts __tests__/infrastructure/headless-plan-agents.test.ts
```

### Task 4 — Clean and retire only proven unused dispatches

**Objective:** Free a proven unused dispatch through checked cleanup while each failure retains recoverable evidence.

**Files:** `backend/src/application/actions/cleanup-plan.ts` (create), `backend/src/domain/ports/plan-records.ts` (modify), `backend/src/domain/ports/workspace.ts` (modify), `backend/src/infrastructure/disk-plan-records.ts` (modify), `backend/src/infrastructure/git-workspace.ts` (modify).
`backend/src/infrastructure/recorded-plan-recovery.ts` (modify), `backend/__tests__/application/cleanup-plan.test.ts` (create), `backend/__tests__/infrastructure/disk-plan-records.test.ts` (modify), `backend/__tests__/infrastructure/git-workspace.test.ts` (modify), `backend/__tests__/infrastructure/recorded-plan-recovery.test.ts` (modify).
`backend/src/domain/value-objects/unused-workspace.ts` (create).

Contract (backend/src/domain/ports/workspace.ts):
```ts
inspectUnlaunched(watch: PlanWatch, previous: UnusedWorkspace | null): Promise<UnusedWorkspace>
undoUnlaunched(evidence: UnusedWorkspace): Promise<void>
```

`CleanupPlanParams` carries agent, issue and repository. The action uses records, workspace, claims and plan issues.
Look up immutable identity even when the worktree is absent. An archived identity returns success without any claim mutation.
Check non-launch proof against history: no other call or successful spawn evidence may exist.

Use the §2 inspection and snapshot contracts. Keep existing `undo` behavior for preparation compensation.
Use non-forcing worktree removal and the existing checked branch removal only after proof that HEAD equals the seeded base.
On retry, use the immutable snapshot and fresh git evidence. Absent worktree alone cannot authorize branch deletion.

Use §2's existing status reader and checked requeue. Exact-ready permits retirement only with fresh absence of both local artifacts.
Then call `PlanRecords.archive(watch)`. Failures retain evidence and never claim a release that did not occur.

Keep cleanup records visible in recovery after partial removal. Preserve normal harvest disappearance behavior for other records.

**TDD:** `it('non-launch cleanup orders workspace requeue and retirement')` cuts each effect and asserts the remaining claim and evidence.

**Tests:** Added: `'non-launch cleanup orders workspace requeue and retirement'`, `'partial cleanup resumes from verified facts'`, `'changed or remote work prevents cleanup'`, `'lost requeue success does not repeat label writes'`, `'archive failure blocks redispatch'`, `'retired cleanup cannot affect a newer dispatch'`, `'retirement frees cap and permits preparation'`. Removed: none.

**Verification:** Run cleanup and related adapter tests. No real governed workspace may serve as a fixture.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/application/cleanup-plan.test.ts __tests__/infrastructure/disk-plan-records.test.ts __tests__/infrastructure/git-workspace.test.ts __tests__/infrastructure/dispatch-check-claims.test.ts __tests__/infrastructure/recorded-plan-recovery.test.ts
```

### Task 5 — Wire recovery and cleanup into the real API

**Objective:** Give the page and coordinator usable endpoints with shared exclusion and explicit refusals.

**Files:** `backend/src/infrastructure/recover-plan-route.ts` (create), `backend/src/infrastructure/cleanup-plan-route.ts` (create), `backend/src/infrastructure/api-server.ts` (modify), `backend/src/infrastructure/ct-api.ts` (modify), `backend/src/infrastructure/active-plans-route.ts` (modify), `backend/src/infrastructure/recorded-plan-recovery.ts` (modify).
`backend/src/domain/exceptions.ts` (modify), `backend/__tests__/infrastructure/recover-plan-route.test.ts` (create), `backend/__tests__/infrastructure/cleanup-plan-route.test.ts` (create), `backend/__tests__/infrastructure/refusal-codes.test.ts` (modify), `backend/__tests__/infrastructure/headless-dispatch-dry-run.test.ts` (modify).
`backend/src/domain/policies/plan-recovery.ts` (create), `backend/src/domain/ports/plan-calls.ts` (modify), `backend/src/infrastructure/claude-plan-calls.ts` (modify), `backend/src/infrastructure/headless-plan-agents.ts` (modify), `backend/__tests__/infrastructure/claude-plan-calls.test.ts` (modify).
`backend/src/infrastructure/claude-calls.ts` (modify), `backend/__tests__/infrastructure/api-server.test.ts` (modify), `backend/__tests__/infrastructure/recorded-plan-recovery.test.ts` (modify), `backend/__tests__/infrastructure/headless-plan-agents.test.ts` (modify).
`backend/src/infrastructure/start-plan-route.ts` (modify), `backend/__tests__/infrastructure/plan-refusal.test.ts` (modify), `backend/__tests__/infrastructure/start-milestone-plan-route.test.ts` (modify).

Contract (backend/src/infrastructure/start-plan-route.ts):
```ts
type PlanFailureClass = { readonly name: string; readonly prototype: PlanFailure }
```

Implement §2's policy, wiring and refusal correction. Preserve all existing guards and tests.

**TDD:** `it('coordinator recovery reaches the production continuation')` proves a successful planner reaches publication and one implementation descriptor.

**Tests:** Added: `'coordinator recovery reaches the production continuation'`, `'recovery and cleanup validate identity before action'`, `'foreign origins cannot recover or clean'`, `'start recovery and cleanup share repository exclusion'`, `'cleanup answers only after retirement'`, `'fix recovery observes the recorded call'`.
Added: `'definite non-launch keeps its start refusal'`, `'loose start exposes definite non-launch'`, `'milestone start exposes definite non-launch'`, `'recovery family has exhaustive refusals'`, `'cleanup family has exhaustive refusals'`, `'cleanup collaborator causes retain their refusal kind'`. Removed: none.

**Verification:** Run route, refusal catalogue and production-wiring checks.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/plan-refusal.test.ts __tests__/infrastructure/refusal-codes.test.ts __tests__/infrastructure/recover-plan-route.test.ts __tests__/infrastructure/cleanup-plan-route.test.ts __tests__/infrastructure/api-server.test.ts __tests__/infrastructure/start-milestone-plan-route.test.ts
npm --prefix backend test -- --exclude '**/*-real-process.test.ts'
```

### Task 6 — Expose actionable recovery and deliver the review evidence

**Objective:** Let the user recover or clean eligible work while uncertainty and the coordinator remain visible.

**Files:** `frontend/src/app/active-plans/ActivePlan.types.ts` (modify), `frontend/src/app/active-plans/client.ts` (modify), `frontend/src/app/active-plans/client.test.ts` (modify), `frontend/src/pages/home/Home.tsx` (modify), `frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx` (modify), `frontend/vite.config.ts` (modify).
`frontend/src/__scenarios__/HeadlessPlanMother.ts` (modify), `frontend/src/pages/home/__tests__/Home.implementPlan.test.tsx` (modify), `backend/API.md` (modify), `frontend/README.md` (modify).
`docs/superpowers/evidence/pr-375-apply-feedback-plan.md` (create), `docs/superpowers/evidence/pr-375-apply-feedback-analysis.md` (create), `docs/superpowers/evidence/pr-375-apply-feedback-implementation.md` (create).

Contract (frontend/src/app/active-plans/ActivePlan.types.ts):
```ts
type RecoveryAction = 'observe' | 'continue' | 'cleanup' | 'inspect'
type RecoveryOutcome =
  | { kind: 'accepted'; agent: string }
  | { kind: 'refused'; code: string; detail: string }
  | { kind: 'unavailable' }
```

Add `ActivePlansClient.recover(plan)` and `cleanup(plan)` with exact identity and validated replies.
Implement §2's scenario, GET-validation and documentation contracts. Preserve every existing test and all unrelated assertions.
Map `observe` and `continue` to `Recuperar trabajo`; map `cleanup` to `Limpiar arranque fallido`.
For `inspect`, show the diagnostic, original identity and read-only refresh. Never send a mutation automatically.

Keep network retry as GET. Recovery presses call POST then GET, never start-plan.
Disable duplicate presses; preserve generation guards, workflow identity and drawer/session mounts. Discard clears only page state.

Add both proxy paths and document wire contracts, actions, refusals and limits in `backend/API.md` and `frontend/README.md`.
Copy both architecture artifacts into the evidence paths. Report red/green checks, mutations, failure cuts, revisions and unverified smoke.

Give the clean Astra judge the repair diff and whole-PR context for independent spec and quality verdicts.

**TDD:** `it('uncertain recovery invokes the action without starting another plan')` asserts POST then GET and unchanged coordinator identity.

**Tests:** Added: `'uncertain recovery invokes the action without starting another plan'`, `'proven non-launch exposes checked cleanup'`, `'inspection never launches or cleans'`, `'late recovery cannot replace the selected workflow'`, `'uncertain scenarios satisfy the recovery wire contract'`, `'malformed recovery metadata is refused'`. Removed: none.

**Verification:** Run the frontend recovery tests and all issue-required checks before handoff.
```bash
npm --prefix frontend test -- src/app/active-plans/client.test.ts src/pages/home/__tests__/Home.restoreWorkflow.test.tsx src/pages/home/__tests__/Home.implementPlan.test.tsx src/pages/home/__tests__/Home.layout.test.tsx
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend test
```

## 8. Global verification

Run these checks from this worktree after all tasks. They must exit zero.
```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend test
git diff --exit-code b26554378b437b77362699cef1d867756c559283 -- plugin/scripts/ct-next.mjs plugin/scripts/ct-step.mjs plugin/scripts/run-machine.js docs/superpowers/plans/2026-09-15-issue-331-the-headless-dispatcher.md docs/superpowers/metrics/issue-331.jsonl docs/superpowers/verdicts
```

Inspect the recovery UI with scripted boundaries. Confirm Spanish actions, diagnostics, original identity and the live coordinator drawer.
The clean Astra judge checks every failure cut and the production graph. A green fixture rehearsal does not close apply.

The user keeps the no-live-Claude restriction. Smoke remains unverified; it does not block implementation or fixture verification.
Keep apply open until the human decides.

## 9. Assumptions

1. The live issue and assignment authorize this repair without a feature flag. They preserve #332, human gates and the original run.
2. The current deployment has one API owner per state root. Stop for a scope decision if simultaneous owners must share it.
3. Operator inspection handles legacy incomplete calls with no trustworthy non-launch proof. No automatic process-kill or evidence-forgery mechanism belongs here.
4. The user keeps the no-live-Claude restriction. Permission smoke remains explicitly unverified and is not an implementation prerequisite.
5. The assignment limits architecture writes to two scratch artifacts. Vitest creates fixtures and caches, so its commands above await Sol's implementation session.
6. Architecture typecheck passed. Plan validation uses the real APIs with source reads from the exact repair base; the analysis records results.
7. The template's normal per-task agent flow yields to the explicit one-Sol, one-Astra post-review handoff. Do not alter run state.
