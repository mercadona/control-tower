# #331 — The headless dispatcher

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Contracts and literal test names are prescribed here; bodies are
> written test-first. The issue body, its accepted delivery amendment and AGENTS.md govern.

## 1. Context and goal

Inspected on `feat/331` at `e50cbc36e0a2568ff475383aef208575f132b46b`, 2026-09-15.
Scope authority: https://github.com/mercadona/control-tower/issues/331 and the user's
accepted amendment recorded in §9. The linked epic execution spec is not planning input.
Issue #332's description and AC were read only to identify the downstream integration.

`StartPlan` opens a loose issue, claims it, prepares a worktree and calls `PlanAgents.launch`.
`CmuxPlanAgents` launches the planner and waits for a separate `ImplementPlan` action to
resume it. `SliceSeed` incorrectly invents a plan gate. `ActivePlanRecovery` uses live
windows, go and implementation-start registries. These are the paths this slice replaces.
`ct-step` already owns implementation sequencing; planning precedes its first run.

### Desired end state

- `/start-plan` accepts a milestone-only command, selects the next ready slice using the
  plugin's order/dependency/token authority, claims through `dispatch-check`, prepares and
  seeds it, writes its record and launches `claude -p`. The loose request remains supported.
- No source filename or content under `backend/src` names cmux, case-insensitively.
  `/implement-plan` is unrouted; this backend mints no go and reads no approval reply.
- A successful planner call must leave one committed contract-valid plan. The backend
  publishes it to the issue and automatically resumes the same conversation to implement.
- Preparation and call descriptors are immutable and precede their process launch.
  Each completed call retains the CLI's reported total, turns and CLI duration when readable,
  separately from measured wall duration. Resumed cost attribution remains unverified;
  unavailable attributable cost is null, never a fabricated bill or zero.
- Restart discovers plans from records alone, even when no process survives. It never
  silently starts a second conversation or repeats an uncertain call.
- Existing coordinator, groom/re-slicing, loose-story hydration and reopen-before-fix
  behaviour remain usable. The page follows backend evidence without an implementation button.

### Out of scope

Protected: `plugin/scripts/ct-next.mjs`, `plugin/scripts/ct-step.mjs` and
`plugin/scripts/run-machine.js`. No plugin production file changes in this slice.
No backend per-task transition table, attempt-row writer, metrics rewrite or duplicate row.
The backend-driven per-step conductor, separate judge billing, schema enforcement and exact
per-step context relay are #332's integration, not a prerequisite invented for #331.
No automatic dispatch of a subsequent issue, new slice messaging UI, merge automation,
retirement of the distributed go protocol or new PR-writing authority. No feature flag,
as approved in the prior planning context. The issue-183 planning document in the main
checkout `/Users/jponzvan/git/control-tower-plugin` is user work, outside this plan's scope.

## 2. Closed decisions

| Decision | Value |
|---|---|
| D-1 | The entrance remains an interactive `claude` in a PTY streamed to the page. |
| D-2 | The backend selects, prepares and owns headless processes; it does not ask a model which issue is next. |
| D-3 | There is no human gate between the plan and implementation; GATE 2 authorises the milestone work. |
| D-4/D-5 | Plugin order wins; cap is 1, in-review frees the cap but retains area/touches tokens. |
| D-6/D-22 | Freeze, groom and promotion remain page-authorised; starting already ready work requires no gate key. |
| D-7 | Merge stays human on GitHub. No new backend write to an implementation PR. |
| D-8/D-15 | The backend publishes the committed plan as tracking; no reply, go or plan-review stop. |
| D-9/D-24 | Preserve the existing coordinator/session surfaces; later slice-call UI consumes the durable records, not window titles. |
| D-10/D-11 | Backend modules/tests are TypeScript; import plugin decisions and renderers. |
| D-12 | Which step comes next is decided by the run machine behind ct-step; the backend is not a second automaton. |
| D-13 | Derive display phases from evidence; store no phase, revision, lock or owner pid. |
| D-14 | Only existing declared gates bind; no default plan gate is restored and the distributed go protocol is not retired. |
| D-16/D-17 | Recovery starts with state-root records. A preparation record is written once, before launch; absence alone means not prepared. |
| D-18/D-21 | The coordinating conversation remains available and recoverable throughout implementation. |
| D-19 | One conversation per slice now; one backend call per machine step and attempt ingestion arrive in #332 under the accepted amendment. |
| D-20 | PR review requests still reopen the issue before delivering the change to its original conversation. |
| D-23 | Preserve publication-before-groom, exact spec revision comparison and merged re-slicing authorisation. |
| D-25 | #331 uses file-based outer errands. The agent continues to relay ct-step-prepared material; backend per-step relay and JSON schemas arrive in #332. |
| D-26 | Preserve the loose `{id?, user_comment?, repo, path}` input and coordinating-story hydration. `repo_list` stays retired. |

**Interim execution is deliberate.** There are three owned call purposes: `plan`,
`implementation`, `fix`. Planning returns after committing; the backend validates and
publishes, then resumes with the current agent-conducted oracle instruction. That agent
asks `ct-step next` and dispatches the subagents it requests. The backend knows only this
outer bridge; it never parses or advances the run. #332 replaces that instruction and
bridge with program-driven steps. A reported total is not advertised as a task or judge bill.

**Persistence and failure cut:** `PlanRecords.prepare(briefing)` returns a `PlanWatch`
whose `agent` is the minted conversation UUID. Write under the configured state root:
`harness/<UUID>/dispatch.json`, then `calls/<call UUID>/call.json`, `prompt.md`,
`stream.ndjson`, `stderr.log`, `completion.json`. Identity is in the enclosing directory.
The dispatch JSON contains repository, issue number/url, story reference or null, root,
worktree, branch and startedAt. A call descriptor contains conversation, purpose, requestId, cwd,
binary, argv, startedAt, budgetMs and killGraceMs; no environment dump or pid. Descriptor content
is written completely, fsynced and published without replacement (temporary file plus
hard link, with EEXIST read/validate). Completion is a separate immutable file. Streams
are process output, never descriptor mutations. Corruption is distinct from absence.

Before a dispatch record exists, compensate only this invocation's workspace and claim.
After it exists, preserve both on every failure. A lost launch response is uncertain,
not proof that no process ran. Concurrent requests are serialised in memory by repository;
record existence also refuses redispatch after restart. The plugin remains the claim
authority across processes. No claim of filesystem/GitHub transactional atomicity is made.

**Call execution:** a detached Node worker owns each `claude` process group, output files,
deadline and completion even if the API exits. Production constructor data: call budget
7,200,000 ms, kill grace 5,000 ms, worker acceptance timeout 10,000 ms, completion poll
250 ms. These are outer-call operational bounds, not machine retry policy. `claude` argv
uses `-p`, `--output-format stream-json`, `--verbose`, `--permission-mode acceptEdits`,
`--model opus`, `--plugin-dir <installed plugin root>`, and `--session-id UUID` for plan
or `--resume UUID` afterwards. The only prompt argument is `Read the file at $CT_CALL_PROMPT
and do exactly what it says.`; the environment supplies its immutable path. Do not disable
hooks, settings or permission checks. Permission failure remains a recorded failure.
The shared Gh client uses ToolRunner.runWholeOutput for paginated reads, preserving
complete output beyond the ordinary execFile buffer. Remove inherited coordinator prompt/hook identity variables from child environment;
preserve authentication, PATH, configuration and ordinary repository controls.

**Measurements and execution are separate:** completion records code, signal, finishedAt,
wallDurationMs, execution and measurement. Execution is success/error/unavailable; only
validated subtype `success`, `is_error: false` and exit 0 permit continuation. Known errors
never succeed even with a false boolean. Missing/unknown subtype means unavailable execution.
Malformed/foreign/conflicting envelopes invalidate execution and measurements; missing or
invalid numeric telemetry alone does not invalidate otherwise proven execution success.

Measurement.cost preserves `total_cost_usd` as `totalUsd` with attribution `initial-invocation`
for --session-id or `unverified-resume` for --resume. It is the exact received CLI number,
not an invoice. CompletedPlanCall.attributableCostUsd returns that number only for initial
invocations; resumed/unavailable cost returns null. Do not sum resumed totals as spending,
subtract totals or price tokens. Turns and durationMs independently retain num_turns and
duration_ms, or null with diagnostics; wallDurationMs is measured independently. Preserve
valid zeroes and measurements on error results. Missing completion remains uncertainty.
The captures in §9 satisfy B-2; they establish no resumed-call cost guarantee. The user
accepts that limitation and forbids further Claude calls for this work, without exceptions.
All implementation verification uses local fixtures/processes. #332 owns backend step calls
and evidence-based attempt attribution/ingestion; #331 never modifies attempt metrics.

**Fixture inputs (existing evidence, never commands to rerun):** only
`/var/folders/s_/hwck0ts160s4dcj8vs9hwrcm0000gr/T/opencode/ct-331-captures/initial.jsonl`,
`/var/folders/s_/hwck0ts160s4dcj8vs9hwrcm0000gr/T/opencode/ct-331-captures/resumed.jsonl`,
`/var/folders/s_/hwck0ts160s4dcj8vs9hwrcm0000gr/T/opencode/ct-331-captures/turn-limit.jsonl`
are authorised source files. Captured by the coordinator on 2026-09-15 with Claude Code
2.1.272 in that temporary cwd; coordinator reports exit0 for all, with no control skipped.
Initial argv was `claude -p --model sonnet --session-id 1270846b-2e8b-4307-889e-c28758e6b851
--output-format stream-json --verbose --tools "" --max-budget-usd 0.50`, prompt
`Reply CT_CAPTURE_331 only` (empty tools argument as reported by the coordinator).
Resume used that identity via --resume and prompt CT_CAPTURE_RESUMED_331; turn-limit used
--model sonnet --tools Read --max-turns 1 --max-budget-usd 0.50, prompt to read input.txt
and report its token. Full resume/turn-limit argv and verbatim third prompt were not supplied;
record these as reported fragments, never invent command bytes from stdout.

| Input/result line | Subtype | Reported total USD | Turns | CLI duration ms |
|---|---|---|---|---|
| initial.jsonl:10 | success | 0.4208795 | 1 | 7071 |
| resumed.jsonl:9 | error_max_budget_usd | 1.051838 | 1 | 4876 |
| turn-limit.jsonl:12 | error_max_turns | 0.42424649999999997 | 2 | 4784 |

The resumed terminal result has zero usage and duration_api_ms 0; its preceding assistant
event reports nonzero usage, so do not claim no model work occurred. The 0.50 option did
not bound its reported total: preserve the error and 1.051838, without asserting actual
incremental spend or an enforced spending ceiling. Initial/resumed share one session;
turn-limit has another. No resume-success capture exists or is required. Fixtures retain
result fields and replace session IDs with `11111111-1111-4111-8111-111111111111` for the
pair and `22222222-2222-4222-8222-222222222222` for turn-limit; other opaque result IDs
receive deterministic valid pseudonyms. Omit non-result metadata and document omissions.
Apply the same ID substitutions to provenance command fragments. Task 3's provenance
document records these observations and their source/report distinction, never claims a
capture of successful resumption, and contains no private initialization metadata.

**Recovery:** enumerate descriptors before any registry/network/process inquiry. Missing
state-root directory means no plans; unreadable/corrupt/ambiguous records mean inconclusive.
Records identify watches; worktree existence filters harvested work. Completed successful
implementation/fix projects implementing and restarts the PR watch once; live calls owned
by this API project their purpose. Unowned incomplete calls project uncertain, even with
run evidence; no liveness probe or automatic replay. A successful plan with no implementation
descriptor is recovered as uncertain with publication/continuation pending. Discovery alone
does not repeat the bridge. This is restart discovery, not the #332 continuation driver.

## 3. Reference patterns

Files to imitate: `backend/src/application/actions/start-plan.ts`,
`backend/src/application/actions/request-fixes.ts`, `backend/src/infrastructure/dispatch-check-workbench.ts`,
`backend/src/infrastructure/disk-conversation-records.ts`, `backend/src/infrastructure/plan-contract-progress.ts`,
`backend/src/infrastructure/tool-runner.ts`, `backend/src/infrastructure/start-plan-route.ts`,
`backend/src/infrastructure/active-plan-recovery.ts`, `backend/src/infrastructure/work-in-flight.ts`.

Rules to obey: `AGENTS.md`, `CLAUDE.md`, `.agent/conventions-ack.md`,
`backend/conventions/this-repository.md`, `docs/glossary.md`,
`plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/defects.md`,
`plugin/conventions/domain.md`, `plugin/conventions/simplicity.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`.

All eight plugin conventions were read. No agent-local convention declaration exists. CT workflow:
`plugin/skills/writing-plans-prescriptive/SKILL.md` and
`plugin/skills/writing-plans-prescriptive/plan-template.md`.
The merged #330 plan supplies formatting precedent only, never current scope or signatures.

## 4. Inventory

The table indexes production/document contracts; each task's **Files:** list is the exact
editable inventory including every test. `(modify)` includes retirement because the CT
scope parser has no delete action. No wildcard grants scope. Test helpers stay with their
module unless multiple actual consumers justify a shared mother.

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/application/actions/continue-plan.ts` | create | headless agents | Task 1 prose signatures |
| `backend/src/domain/ports/plan-calls.ts` | create | continuation and agents | Task 1 prose signatures |
| `backend/src/domain/ports/plan-publication.ts` | create | continuation | Task 1 prose signature |
| `backend/src/domain/value-objects/plan-call.ts` | create | calls and recovery | Task 1 Contract |
| `backend/src/domain/ports/plan-records.ts` | create | start and recovery | Task 2 Contract |
| `backend/src/infrastructure/disk-plan-records.ts` | create | entrypoint | Task 2 prose signatures |
| `backend/src/infrastructure/headless-files.ts` | create | records and worker | Task 2 Contract |
| `backend/src/infrastructure/claude-call-result.ts` | create | worker | Task 3 Contract |
| `backend/__tests__/infrastructure/fixtures/claude-result-initial.jsonl` | create | parser tests and rehearsal | Task 3 prose |
| `backend/__tests__/infrastructure/fixtures/claude-result-resumed.jsonl` | create | parser tests | Task 3 prose |
| `backend/__tests__/infrastructure/fixtures/claude-result-turn-limit.jsonl` | create | parser tests | Task 3 prose |
| `docs/superpowers/evidence/issue-331-cli-captures.md` | create | fixture provenance | Task 3 prose |
| `backend/src/infrastructure/claude-calls.ts` | create | call adapter and recovery | Task 4 Contract |
| `backend/src/infrastructure/headless-call-worker.ts` | create | call launcher | Task 4 prose |
| `backend/src/infrastructure/plan-agent-brief.ts` | modify | call adapter | Task 5 Current state |
| `backend/src/infrastructure/claude-plan-calls.ts` | create | continuation and agents | Task 5 Contract |
| `backend/src/infrastructure/gh-plan-publication.ts` | create | continuation | Task 6 Contract |
| `backend/src/infrastructure/headless-plan-agents.ts` | create | both start actions and fixes | Task 7 Contract |
| `backend/src/domain/ports/plan-agents.ts` | modify | starts and fixes | Task 7 prose |
| `backend/src/application/actions/request-fixes.ts` | modify | review watch | Task 7 prose |
| `backend/src/infrastructure/review-watch.ts` | modify | recovery | Task 7 prose |
| `backend/src/application/actions/start-milestone-plan.ts` | create | start route | Task 8 Contract |
| `backend/src/domain/ports/dispatch-candidates.ts` | create | milestone action | Task 8 prose signature |
| `backend/src/domain/ports/dispatch-claims.ts` | create | both start actions | Task 8 prose signatures |
| `backend/src/domain/exceptions.ts` | modify | dispatch adapters and route | Task 8 prose |
| `backend/src/infrastructure/start-plan-route.ts` | modify | server | Tasks 8 and 12 prose/Current state |
| `backend/src/infrastructure/gh-dispatch-candidates.ts` | create | milestone action | Task 9 Contract |
| `backend/src/infrastructure/dispatch-check-claims.ts` | create | both start actions | Task 9 Contract |
| `backend/src/infrastructure/git-workspace.ts` | modify | both start actions | Task 10 Current state |
| `backend/src/infrastructure/ct-api.ts` | modify | application entrypoint | Tasks 10 and 15 |
| `backend/src/infrastructure/recorded-plan-recovery.ts` | create | server | Task 11 Contract |
| `backend/src/infrastructure/recorded-call.ts` | create | calls and recovery | Task 11 prose signature |
| `backend/src/infrastructure/active-plans-route.ts` | modify | recovery and page | Task 11 prose signatures |
| `backend/src/infrastructure/api-server.ts` | modify | entrypoint | Tasks 12, 14 and 16 |
| `backend/src/application/actions/start-plan.ts` | modify | loose entrance | Tasks 10 and 15 prose |
| `backend/src/infrastructure/probed-tool-sessions.ts` | modify | external tools query | Task 15 prose |
| `backend/src/infrastructure/cmux-plan-agents.ts` | modify — retire | disconnected adapter | Task 20 prose |
| `backend/src/infrastructure/worktree-plans.ts` | modify — retire | disconnected reader | Task 20 Current state |
| `backend/src/infrastructure/active-plan-recovery.ts` | modify — retire | disconnected recovery | Task 20 prose |
| `frontend/src/pages/home/Home.tsx` | modify | page | Task 21 Current state |
| `frontend/src/__scenarios__/HeadlessPlanMother.ts` | create | Home suites | Task 21 prose |
| `frontend/vite.config.ts` | modify | development server | Task 22 prose |
| `backend/API.md` | modify | API consumer | Task 23 prose |
| `backend/conventions/this-repository.md` | modify | implementer/judge | Task 23 prose |
| `frontend/README.md` | modify | frontend developer | Task 23 prose |
| `docs/superpowers/evidence/issue-331-apply.md` | create | human apply review | Task 23 Final text |

## 5. Interfaces

Consumes: `PlanAgents.launch(PlanBriefing): Promise<string>`, `resume(asked): Promise<void>`,
`fix(asked): Promise<void>`; `Workspace.confirm/prepare/undo`; `PlanWatch`, `PlansInFlight`;
`buildDispatchInput(open, closed)`, `planDispatch(issues, options)`, `mapGhIssue(raw)`,
`buildStateSeed(slice, options)`; `dispatch-check` claim/requeue; and existing `Gh.run`.
The issue declares merge-after slice order 5, not a nonexistent driver dependency.

Produces: `PlanRecords.prepare(briefing): Promise<PlanWatch>`, `find(asked): Promise<PlanWatch|null>`,
`inFlight(): Promise<PlansInFlight>`.
Produces: `PlanCalls.start(watch, purpose, changes, requestId?): Promise<StartedPlanCall>`,
`wait(call): Promise<CompletedPlanCall>`; completion separates execution, reported telemetry
and attributable cost (null for resumes), with CLI and wall durations separately named.
Produces: `PlanPublication.publish(watch): Promise<void>`.
Produces: `ContinuePlan.execute({watch, call}): Promise<void>` and
`HeadlessPlanAgents` implementing the existing `PlanAgents` surface.
Produces: `ClaudeCalls.start(invocation): Promise<StartedPlanCall>` and `wait(call)`;
the low-level invocation carries argv/cwd and identity, so #332 can replace the composer
without changing record-before-spawn or result measurement. No #332 type is presumed present.

## 6. Test strategy

Outside-in with ports doubled, then adapter tests against scripted boundary payloads.
Use named mothers, real values, literal payloads and both failure causes. Real-process
tests use local Node children, carry `-real-process.test.ts` and kill groups in afterEach
even on failure; none needs Claude or a window service. Mutation evidence is the
implementer's responsibility: name the assertion broken, observed red and restored bytes.

Per-task verification commands are exact execution instructions for the future files.
They are not a claim of an observed baseline: the user assigned baseline/global suites
to the coordinator and explicitly prohibited repeating them in architecture. The architect
runs the documented read-only plan checker after each task. `claude --help` was run with
exit 0 and confirms the declared launch flags (prior architect's report, not rerun here).
Result fixtures use the three real CLI captures named in §9; B-2 is satisfied. Task 3
persists sanitized fixtures/provenance before tests; SDK declarations are not captures.
Synthetic malformed variants name their alteration of a real fixture. No further Claude
call is authorised for architecture, implementation, verification or capture collection.
Application/recovery tests may construct domain completions through port doubles to pin
success with unverified attribution; these are domain scenarios, not CLI captures. No
successful resumed wire envelope is invented. Local worker fixtures replay available
captures with declared identity substitutions; error cases stay in their owning tests.

## 7. Tasks

### Task 1 — Continue a completed plan without a human reply

**Objective:** establish the automatic publication-before-implementation bridge through ports.

**Files:** `backend/src/application/actions/continue-plan.ts` (create),
`backend/src/domain/ports/plan-calls.ts` (create),
`backend/src/domain/ports/plan-publication.ts` (create),
`backend/src/domain/value-objects/plan-call.ts` (create),
`backend/__tests__/application/continue-plan.test.ts` (create)

Contract (backend/src/domain/value-objects/plan-call.ts):
```ts
export type PlanCallPurpose = 'plan' | 'implementation' | 'fix'
export class StartedPlanCall {
  constructor(asked: { conversation: string, id: string })
  readonly conversation: string
  readonly id: string
}
export type CallCost =
  | { readonly kind: 'reported', readonly totalUsd: number,
      readonly attribution: 'initial-invocation' | 'unverified-resume' }
  | { readonly kind: 'unavailable', readonly reason: string }
export type CallMeasurement = { readonly cost: CallCost, readonly turns: number | null,
  readonly durationMs: number | null, readonly unavailable: readonly string[] }
export type CallExecution = { readonly kind: 'success' }
  | { readonly kind: 'error' | 'unavailable', readonly diagnostic: string }
export class CompletedPlanCall {
  constructor(asked: { call: StartedPlanCall, code: number | null, signal: string | null,
    finishedAt: string, wallDurationMs: number, execution: CallExecution, measurement: CallMeasurement })
  get succeeded(): boolean
  get attributableCostUsd(): number | null
}
```

Freeze all inputs. Numeric telemetry requires finite nonnegative cost/duration and integer
nonnegative turns; null means unavailable, with field-named diagnostics. succeeded requires
exit 0 and execution success, independent of telemetry. Task 3 validates subtype/is_error.
attributableCostUsd is reported cost only for initial-invocation, otherwise null.
PlanCalls declares `start(watch: PlanWatch, purpose: PlanCallPurpose, changes: string|null):
Promise<StartedPlanCall>` and `wait(call: StartedPlanCall): Promise<CompletedPlanCall>`.
PlanPublication declares `publish(watch: PlanWatch): Promise<void>`.
ContinuePlan's constructor receives `{calls: PlanCalls, publication: PlanPublication}`;
`execute({watch: PlanWatch, call: StartedPlanCall}): Promise<void>` waits for the planner,
requires success, publishes, starts implementation with null changes, then waits for it.
Failure is a rejected existing `PlanAgentNotResumed`; no retry, go or run-state read.

**TDD:** `it('a completed plan is published before implementation starts without a reply')`
uses deferred port answers to prove no implementation call before publication resolves.

**Tests:** 'a completed plan is published before implementation starts without a reply',
'a failed planner never publishes or implements', 'publication failure starts no implementation',
'an error execution never continues despite available measurements',
'proven success continues with unavailable telemetry or unverified resumed cost',
'an interrupted implementation is reported without a retry'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/application/continue-plan.test.ts
```

### Task 2 — Record prepared plans without overwriting evidence

**Objective:** make a complete immutable descriptor the sole preparation/discovery authority.

**Files:** `backend/src/domain/ports/plan-records.ts` (create),
`backend/src/infrastructure/disk-plan-records.ts` (create),
`backend/src/infrastructure/headless-files.ts` (create),
`backend/__tests__/infrastructure/disk-plan-records.test.ts` (create),
`backend/__tests__/infrastructure/headless-files.test.ts` (create)

Contract (backend/src/domain/ports/plan-records.ts):
```ts
export class PlanRecords {
  prepare(briefing: PlanBriefing): Promise<PlanWatch>
  find(asked: { issue: number, repository: RepositoryName }): Promise<PlanWatch | null>
  inFlight(): Promise<PlansInFlight>
}
```

Contract (backend/src/infrastructure/headless-files.ts):
```ts
export class HeadlessFiles {
  constructor(asked: { root: string, fs: typeof import('node:fs/promises'), newId: () => string })
  dispatchPath(conversation: string): string
  callDirectory(call: StartedPlanCall): string
  writeOnce(path: string, text: string): Promise<void>
  read(path: string): Promise<string | null>
  list(path: string): Promise<string[]>
}
```

DiskPlanRecords extends PlanRecords; constructor `{files: HeadlessFiles, newId: () => string,
now: () => string, exists: (path: string) => Promise<boolean>}`. Its boundary model shares
the adapter and validates §2's exact dispatch fields and UUID/path agreement. Construct
PlanWatch/PlanIssue/WorkspaceLocation/RepositoryName/UserStoryReference through their
existing doors. Expose no raw disk JSON to application. Existing record refuses prepare
as PlanAgentNotLaunched; malformed record becomes PlanAgentNotNamed; filesystem write/read
failure becomes PlanAgentNotLaunched with path and original cause. `inFlight` translates
these to PlansInFlight.refused; it never returns a partial confident list.
writeOnce fsyncs temporary content before link, cleans temporary files in finally and
never overwrites on EEXIST. Missing list directory returns []; other errors propagate.
Enumerate descriptors before checking worktree existence. Missing harvested worktrees
are omitted; duplicate repository/issue identities refuse. No process or checkout registry.

**TDD:** `it('a prepared plan is discoverable before any launch')` reads it at the launch
cut point, with no process collaborator available.

**Tests:** 'a prepared plan is discoverable before any launch',
'a second preparation preserves the original descriptor bytes',
'corrupt records and unreadable roots refuse discovery',
'missing roots are empty and harvested worktrees are omitted',
'publication is atomic and never replaces an existing file'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/disk-plan-records.test.ts __tests__/infrastructure/headless-files.test.ts
```

### Task 3 — Separate execution from reported and attributable measurements

**Objective:** parse real results without mistaking resumed totals for call bills.

**Files:** `backend/src/infrastructure/claude-call-result.ts` (create),
`backend/__tests__/infrastructure/claude-call-result.test.ts` (create),
`backend/__tests__/infrastructure/fixtures/claude-result-initial.jsonl` (create),
`backend/__tests__/infrastructure/fixtures/claude-result-resumed.jsonl` (create),
`backend/__tests__/infrastructure/fixtures/claude-result-turn-limit.jsonl` (create),
`docs/superpowers/evidence/issue-331-cli-captures.md` (create)

Contract (backend/src/infrastructure/claude-call-result.ts):
```ts
export class ClaudeCallResult {
  static read(asked: { lines: AsyncIterable<string>, call: StartedPlanCall,
    code: number | null, signal: string | null, finishedAt: string,
    wallDurationMs: number, mode: 'initial' | 'resume' }): Promise<CompletedPlanCall>
}
```

Project type/subtype/session_id/is_error/total_cost_usd/num_turns/duration_ms from result
events; ignore other events. Match session; deduplicate identical results. Foreign/conflicting
results or malformed tails invalidate execution/telemetry with diagnostics. Stream lines,
including unterminated tails. Freeze all values; constructor fields stay publicly readonly.
Only success + is_error false maps execution success; success + true maps error. Recognize
error_during_execution/error_max_turns/error_max_budget_usd/error_max_structured_output_retries
as error even with false. Absent/unknown subtype or nonboolean is_error makes execution
unavailable, retaining readable telemetry. Validate each numeric field independently;
missing/invalid metrics do not veto proven success. mode sets cost attribution per §2.

Sol creates the three fixtures from §9's exact inputs: retain only complete result lines,
omit private init/hook/assistant metadata, consistently pseudonymize IDs, preserve all other
result fields and numeric literals. Record source/date/CLI version, supplied argv, exit0,
redactions and observed cap failure in the provenance document. No further Claude calls.
Use named mother scenarios loading these files. Mutations are labelled synthetic; never
invent a resume-success capture or infer its cost from the initial capture.

**TDD:** `it('a resumed reported total is retained without attributing it to the call')`
asserts 1.051838, unverified-resume, null attributable cost and error despite exit0;
initial is 0.4208795 and successful. Never subtract totals or price usage.

**Tests:** 'a resumed reported total is retained without attributing it to the call',
'both captured errors retain reported totals turns and CLI durations despite exit zero',
'proven success survives unavailable numeric telemetry',
'reported zero differs from absent cost and wall duration is separate',
'foreign conflicting and partial results never report success',
'absent unknown and error subtypes with false never succeed',
'success requires a false boolean and exit zero',
'invalid numeric fields lose only their own measurement',
'unconsumed fields and identical results do not duplicate measurements'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/claude-call-result.test.ts
```

### Task 4 — Supervise recorded calls independently of the API

**Objective:** preserve output and deadlines across API exit with no launch before durable preparation.

**Files:** `backend/src/infrastructure/claude-calls.ts` (create),
`backend/src/infrastructure/headless-call-worker.ts` (create),
`backend/__tests__/infrastructure/claude-calls.test.ts` (create),
`backend/__tests__/infrastructure/claude-calls-real-process.test.ts` (create),
`backend/__tests__/infrastructure/fixtures/headless-child.ts` (create)

Contract (backend/src/infrastructure/claude-calls.ts):
```ts
export class CallInvocation {
  constructor(asked: { conversation: string, purpose: PlanCallPurpose,
    cwd: string, argv: readonly string[], prompt: string })
}
export class ClaudeCalls {
  constructor(ports: { files: HeadlessFiles, binary: string, worker: string,
    spawn: typeof import('node:child_process').spawn, env: NodeJS.ProcessEnv,
    newId: () => string, now: () => string, budgetMs: number,
    killGraceMs: number, acceptanceMs: number, pollMs: number,
    sleep: (ms: number) => Promise<void> })
  start(invocation: CallInvocation): Promise<StartedPlanCall>
  wait(call: StartedPlanCall): Promise<CompletedPlanCall>
  completed(call: StartedPlanCall): Promise<CompletedPlanCall | null>
}
```

Freeze invocation fields. Write prompt.md and call.json once before spawning a detached
Node worker with only the descriptor path in argv. IPC reports actual child spawn acceptance;
timeout/lost IPC is PlanAgentNotLaunched and preserves descriptors, never a retry. The
worker validates the descriptor, opens stream/stderr descriptors, spawns recorded binary/
argv/cwd in its own process group, and writes completion once after close/spawn failure.
SIGTERM at budget then SIGKILL after grace target the group; ESRCH is benign, other signal
errors stay diagnostic. API disconnection closes IPC, not the worker or its timers.
The worker's entrypoint is a class method; import has no execution side effect.
Pass mode to ClaudeCallResult from validated descriptor argv: --session-id is initial,
--resume is resume; exactly one must match the recorded conversation. Persist execution
and per-field measurement separately, preserving unverified attribution and diagnostics.
completed validates stored JSON and reported-cost attribution against descriptor mode;
returns domain values, with null only for absent completion.
wait polls until completion or descriptor deadline plus grace, then refuses uncertainty.
No permission-mode override, no persistent pid and no memory-only result channel.

**TDD:** `it('call and prompt files exist before the first spawn')` inspects both files
inside the spawn double. Real-process tests use the local child fixture, never Claude.

**Tests:** 'call and prompt files exist before the first spawn',
'a failed record write launches nothing', 'spawn and acceptance failures preserve records',
'output and completion survive API exit',
'the surviving deadline terminates the child process group',
'missing completion is uncertain rather than an automatic retry',
'completion round trips resumed totals without inventing attributable cost',
'a resumed descriptor cannot restore initial cost attribution',
'malformed completion differs from absence'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/claude-calls.test.ts __tests__/infrastructure/claude-calls-real-process.test.ts
```

### Task 5 — Compose file-based errands for the interim transport

**Objective:** launch/resume one conversation with the existing oracle errand and no invented approval.

**Files:** `backend/src/infrastructure/plan-agent-brief.ts` (modify),
`backend/src/infrastructure/claude-plan-calls.ts` (create),
`backend/__tests__/infrastructure/plan-agent-brief.test.ts` (modify),
`backend/__tests__/infrastructure/claude-plan-calls.test.ts` (create)

Current state (backend/src/infrastructure/plan-agent-brief.ts):
```ts
  implementationErrandFor({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): string {
```

Contract (backend/src/infrastructure/claude-plan-calls.ts):
```ts
export class ClaudePlanCalls extends PlanCalls {
  constructor(ports: { calls: ClaudeCalls, brief: PlanAgentBrief, pluginRoot: string,
    resumable: (watch: PlanWatch) => Promise<boolean> })
  start(watch: PlanWatch, purpose: PlanCallPurpose, changes: string | null): Promise<StartedPlanCall>
  wait(call: StartedPlanCall): Promise<CompletedPlanCall>
}
```

Translate PlanAgentBrief's entire touched module to English, preserving external headings.
Keep its public constructor/method signatures. errandFor instructs CT prescriptive planning
against the issue, baseline read once, validation and commit, then return; the backend owns
publication and continuation. No comment command, approval polling or nonce instruction.
implementationErrandFor declares work already authorised and retains the existing oracle
consultation, task-scoped dispatch, program commits, PR opening and release instruction.
It must not claim a human just closed plan. fixErrandFor retains existing branch/worktree,
change anchors, release and no-merge semantics. Do not paste the task pipeline into a new prompt.

ClaudePlanCalls dispatches exhaustively by the three purposes and uses those existing
methods. It builds CallInvocation with §2's exact argv and file-based prompt argument.
Plan uses --session-id; implementation/fix first require resumable(watch) and use --resume,
never --continue, --fork-session or --no-session-persistence. Missing conversation raises
PlanAgentNotResumed. Use ClaudeCodeTranscript.read for the concrete resumability callback,
as ClaudeConversations.isResumable does. Fix requires nonempty changes; other purposes null.
No per-step tool/model/schema assembly. The agent-conducted instruction is explicitly interim.

**TDD:** `it('publication is backend owned and implementation never claims a plan approval')`
asserts the changed literal instruction and absence of agent publication/approval instructions.

**Tests:** 'publication is backend owned and implementation never claims a plan approval',
'implementation still follows the ct-step oracle without a backend step table',
'resumes preserve conversation identity and carry only the prompt path',
'a missing conversation is refused rather than reopened',
'fix errands retain the requested anchors and existing pull request'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/plan-agent-brief.test.ts __tests__/infrastructure/claude-plan-calls.test.ts
```

### Task 6 — Publish the committed plan as recoverable tracking

**Objective:** complete issue publication before continuation without reading any approval answer.

**Files:** `backend/src/infrastructure/gh-plan-publication.ts` (create),
`backend/__tests__/infrastructure/gh-plan-publication.test.ts` (create)

Contract (backend/src/infrastructure/gh-plan-publication.ts):
```ts
export class GhPlanPublication extends PlanPublication {
  constructor(ports: { gh: Gh, git: ToolRunner['run'], progress: PlanContractProgress,
    files: HeadlessFiles, digest: (text: string) => string })
  publish(watch: PlanWatch): Promise<void>
}
```

Require `progress.of(watch)` to return PlanState.READY. List committed plan paths with
`git -C <worktree> ls-tree -r --name-only HEAD -- docs/superpowers/plans`; select exactly
one with plugin `planFilesForIssue`. Read with `git -C <worktree> show HEAD:<path>`.
No discovery from model prose and no posting an uncommitted draft. Existing progress
validation is the yardstick, not another backend plan parser. Any command/shape/contract
failure raises PlanProgressNotRead with its actual diagnostic, preventing implementation.

Post with `gh issue comment N --repo owner/name --body-file <file>`, safeToRepeat false.
Body begins `Plan <sha256> — part <n>/<total>` then source path and complete committed
Markdown; split at line boundaries into at most 60,000 UTF-16 units INCLUDING the header.
Split oversized individual lines by Unicode code points; never truncate. Files are under
the dispatch directory's `publication/<hash>/part-<n>.md`, written once. Hash is of the
original committed bytes. No approving replies, nonce or PR API is consulted.

For idempotence list issue comments with `gh api repos/<repo>/issues/N/comments
--paginate --slurp`; project body from every page. Exact full body matching means already
published; a marker alone is insufficient. After an ambiguous failed POST, read back once;
an exact match succeeds, otherwise fail. Do not blindly repeat a non-idempotent write.
On an explicit later retry, already matching parts are omitted. Genuine publication
failure leaves the prepared plan recoverable and starts no implementation.

**TDD:** `it('the committed plan is posted and no approval reply is requested')` asserts
the exact comment body/argv and returns despite a comment list with no human response.

**Tests:** 'the committed plan is posted and no approval reply is requested',
'uncommitted invalid and ambiguous plans are not published',
'already matching parts are not posted again',
'a lost write response is read back rather than blindly retried',
'large plans are published in full without splitting a surrogate pair',
'a marker with different content is not publication evidence'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/gh-plan-publication.test.ts
```

### Task 7 — Own the background bridge and preserve PR fix delivery

**Objective:** own continuation/fixes.

**Files:** `backend/src/infrastructure/headless-plan-agents.ts` (create),
`backend/src/domain/ports/plan-agents.ts` (modify),
`backend/src/application/actions/request-fixes.ts` (modify),
`backend/src/infrastructure/review-watch.ts` (modify),
`backend/src/infrastructure/claude-plan-calls.ts` (modify),
`backend/src/infrastructure/claude-calls.ts` (modify),
`backend/src/infrastructure/headless-call-worker.ts` (modify),
`backend/src/domain/ports/plan-calls.ts` (modify),
`backend/__tests__/infrastructure/headless-plan-agents.test.ts` (create),
`backend/__tests__/infrastructure/claude-calls.test.ts` (modify),
`backend/__tests__/application/request-fixes.test.ts` (modify),
`backend/__tests__/infrastructure/review-watch.test.ts` (modify)

Contract (backend/src/infrastructure/headless-plan-agents.ts):
```ts
export class HeadlessPlanAgents extends PlanAgents {
  constructor(ports: { records: PlanRecords, calls: PlanCalls, continuation: ContinuePlan,
    newId: () => string, stderr: (line: string) => void })
  launch(briefing: PlanBriefing): Promise<string>
  resume(asked: { agent: string, issue: number, repository: RepositoryName }): Promise<void>
  fix(asked: { agent: string, issue: number, repository: RepositoryName,
    changes: string, requestId?: string }): Promise<void>
}
```

launch prepares/starts plan, handles ContinuePlan rejections, returns watch.agent.
Failures log issue/conversation/call/cause; preserve work. resume throws
PlanAgentNotResumed. fix validates identity, supervises wait, returns on acceptance;
never replay failed work.

Optional requestId: PlanAgents.fix, RequestFixesParams/execute, Delivered,
CallInvocation; fourth PlanCalls/ClaudePlanCalls.start argument. ReviewWatch passes
ChangeAsked.id. Align worker; persist null for non-fixes. Direct fixes mint ids;
old adapter may ignore them. ClaudeCalls reuses conversation/requestId without spawning,
even if acceptance is uncertain; new prompt/purpose refuses. Serialise conversation
starts; unfinished records block competitors. New review id means new work, even same text.

ReviewWatch: live.get(key) === attended, not live.has(key), before/after every await
and before note/delivery/attended mutation. Stale catch/finally deletes only its Set.
stop/restart cannot revive sleepers/readers/deliveries. Retain recovery baselining.

**TDD:** `it('launch records before starting and automatically supervises the bridge')`
defers completion past launch return.

**Tests:** 'launch records before starting and automatically supervises the bridge',
'background failures preserve recorded work without an unhandled rejection',
'review retries reuse a recorded request without launching again',
'different review ids remain different requests',
'an old wake after stop and restart cannot poll deliver or delete the new watcher',
'stale baseline read and delivery completions cannot affect a replacement watcher',
'reopening still precedes delivery to the original conversation'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/headless-plan-agents.test.ts __tests__/application/request-fixes.test.ts __tests__/infrastructure/review-watch.test.ts
npm --prefix backend test -- __tests__/infrastructure/claude-calls.test.ts __tests__/infrastructure/claude-calls-real-process.test.ts __tests__/infrastructure/claude-plan-calls.test.ts
```

### Task 8 — Start selected milestone work through application ports

**Objective:** dispatch an existing ready issue without creating one or duplicating eligibility rules.

**Files:** `backend/src/application/actions/start-milestone-plan.ts` (create),
`backend/src/domain/ports/dispatch-candidates.ts` (create),
`backend/src/domain/ports/dispatch-claims.ts` (create),
`backend/src/domain/exceptions.ts` (modify),
`backend/src/infrastructure/start-plan-route.ts` (modify),
`backend/__tests__/application/start-milestone-plan.test.ts` (create),
`backend/__tests__/infrastructure/plan-refusal.test.ts` (modify)

Contract (backend/src/application/actions/start-milestone-plan.ts):
```ts
export class StartMilestonePlanParams {
  constructor(asked: { repository: RepositoryName, root: CheckoutRoot, milestone: string })
}
export class StartMilestonePlan {
  constructor(ports: { candidates: DispatchCandidates, claims: DispatchClaims,
    workspace: Workspace, agents: PlanAgents, records: PlanRecords,
    checkouts: CheckoutRegistry })
  execute(params: StartMilestonePlanParams): Promise<PlanStarted>
}
```

DispatchCandidates declares `next({repository: RepositoryName, milestone: string}):
Promise<PlanIssue>`. DispatchClaims declares `claim(asked): Promise<void>` and
`requeue(asked): Promise<void>`; asked is `{issue: PlanIssue, repository: RepositoryName,
root: CheckoutRoot}`. Application receives real PlanIssue, not raw GitHub JSON or a map.
Add DispatchFailure under PlanFailure with leaves DispatchNotAvailable, DispatchNotRead,
DispatchNotUnderstood; map them explicitly in PlanCollapse to `dispatch-not-available`,
`dispatch-not-read`, `dispatch-not-understood`. Use existing PlanIssueNotClaimed for
claim/requeue failures. Add no model or dependency policy to the action.
Add WorkspaceNotCleaned under WorkspaceNotPrepared, explicitly mapped by PlanCollapse to
`workspace-not-cleaned`; it carries cleanup and original preparation/launch diagnostics.

Confirm root, ask candidate, refuse if records.find already has it, claim, prepare,
launch, remember RegisteredCheckout and return existing PlanStarted (agent/watch/baseline).
Prepare failure requeues only the confirmed claim unless WorkspaceNotCleaned preserves it.
Launch failure checks record existence:
absent means undo then checked requeue; present means preserve everything. If the read is
inconclusive, preserve. Compensation failure propagates with the original failure retained
in its diagnostic. No PlanIssues.open and no speculative launch after a refused port.

**TDD:** `it('selected work is claimed prepared and launched without opening an issue')`
pins each port cut point and the exact selected issue passed onwards.

**Tests:** 'selected work is claimed prepared and launched without opening an issue',
'no eligible issue reaches claim', 'an existing record prevents redispatch',
'unrecorded launch failure compensates workspace then claim',
'recorded or uncertain launch failure preserves work',
'failed undo preserves the claim and reports launch and cleanup diagnostics',
'failed preparation cleanup never requeues its claim'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/application/start-milestone-plan.test.ts __tests__/infrastructure/plan-refusal.test.ts
```

### Task 9 — Reuse the plugin's selection and claim authorities

**Objective:** select by table order and real token/dependency evidence, then use the checked claim edge.

**Files:** `backend/src/infrastructure/gh-dispatch-candidates.ts` (create),
`backend/src/infrastructure/dispatch-check-claims.ts` (create),
`backend/__tests__/infrastructure/gh-dispatch-candidates.test.ts` (create),
`backend/__tests__/infrastructure/dispatch-check-claims.test.ts` (create)

Contract (backend/src/infrastructure/gh-dispatch-candidates.ts):
```ts
export class GhDispatchCandidates extends DispatchCandidates {
  constructor(ports: { gh: Gh })
  next(asked: { repository: RepositoryName, milestone: string }): Promise<PlanIssue>
}
```

Contract (backend/src/infrastructure/dispatch-check-claims.ts):
```ts
export class DispatchCheckClaims extends DispatchClaims {
  constructor(ports: { node: ToolRunner['run'], dispatchCheck: string })
  claim(asked: { issue: PlanIssue, repository: RepositoryName, root: CheckoutRoot }): Promise<void>
  requeue(asked: { issue: PlanIssue, repository: RepositoryName, root: CheckoutRoot }): Promise<void>
}
```

Use `loop-issues.js:60-61,81-102`'s exact paginated REST argv for open and closed reads,
with Gh safeToRepeat true. Import flattenIssuePages/realIssuesOnly; normalise closed
state_reason to stateReason uppercase and retain body/milestone/labels. Do not pass an
async function to synchronous loadIssues. Validate consumed REST keys at this boundary;
both reads must be whole. Feed buildDispatchInput once. Duplicate target milestone order
refuses; filter only ready candidates by target milestone, preserving every repository-wide
in-progress/in-review holder using mapGhIssue even if another milestone has order collisions.
Call planDispatch with `{mergedIssues, depStates, cap: 1}` and return its selected issue.
None raises DispatchNotAvailable with the plugin block reason. Broken payload is
DispatchNotUnderstood; failed read is DispatchNotRead. No independent sort/dependency test.
Refuse explicitly declared plan gates through resolveGatesForAgent before claiming.

Claim argv is `[dispatchCheck, String(issue.number), '--repo', repository.text]` with cwd
root.text; requeue adds `--requeue`, after workspace cleanup. Exit 0 alone succeeds.
Every nonzero exit preserves stdout/stderr/code in PlanIssueNotClaimed, including orphaned
claim exit 4; never retry automatically or replace checked requeue with a label swap.

**TDD:** `it('table order beats issue number while dependencies and outside holders still block')`
uses different order/issue numbers and a holder outside the requested milestone.

**Tests:** 'table order beats issue number while dependencies and outside holders still block',
'in review releases cap but retains tokens', 'not planned closure does not satisfy a dependency',
'partial reads and duplicate target orders refuse', 'explicit plan gates are not bypassed',
'only claim exit zero allows preparation', 'requeue uses the checked edge and preserves refusals'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/gh-dispatch-candidates.test.ts __tests__/infrastructure/dispatch-check-claims.test.ts
```

### Task 10 — Seed both entrances from the actual issue

**Objective:** seed issue data and make workspace compensation checked.

**Files:** `backend/src/infrastructure/git-workspace.ts` (modify),
`backend/src/infrastructure/ct-api.ts` (modify),
`backend/src/application/actions/start-plan.ts` (modify),
`backend/__tests__/application/start-plan.test.ts` (modify),
`backend/__tests__/infrastructure/git-workspace.test.ts` (modify)

Current state (backend/src/infrastructure/git-workspace.ts):
```ts
  static readonly PLAN_GATE = 'plan'
  static readonly GATES =
    `${SliceSeed.PLAN_GATE} — GATE HUMANO pendiente: lo cierra una persona desde la app cuando pide ` +
    'implementar el plan, NO tú. ' +
    'Ojo: la sección "## Gates" del issue describe el carril de /ct-next y aquí no aplica.'
```

Require `gh: Gh` in GitWorkspace; update ct-api/tests, constructing Gh first.
Read `gh issue view N --repo owner/name --json number,title,body,labels,milestone`
safeToRepeat true; validate fields/number, then mapGhIssue.
Set epic to milestone.title or NO_MILESTONE_KEY. Explicit plan labels refuse as
WorkspaceNotPrepared before worktree creation, even beside a waiver.

Declare SeedSlice as `ReturnType<typeof mapGhIssue> & {readonly epic: string}`.
SliceSeed.textFor accepts `{slice: SeedSlice, branch: string, base: string, cut: string,
baseline: BaselineResult}`; delegate to buildStateSeed with baseSha: cut and the one baseline.
Remove PLAN_GATE/GATES/renderState; keep RELATIVE_PATH/EXCLUDE_PATH/EXCLUDE_RULE and
hidden-state checks. Resolve origin's default branch, `git -C <root> fetch origin <base>`,
verify origin/<base>, then worktree add; no overwrite/fallback or second baseline.
Read failure is WorkspaceNotRead; malformed issue output is WorkspaceNotUnderstood.

undo must reject WorkspaceNotCleaned on failed removal; never delete the branch afterwards.
Check branch deletion too. Preserve exit/stdout/stderr and remaining workspace/branch;
never claim rollback of an already successful removal. prepare wraps seed plus cleanup
failures together. Until Task 15, StartPlan must already preserve the claim on this error
and retain launch plus undo diagnostics; requeue only after cleanup succeeds.

**TDD:** `it('the seed preserves the issue gates signal and measured baseline without inventing plan')`
feeds generated text into parseStateSafe and compares actual mapped values with apply present.

**Tests:** 'the seed preserves the issue gates signal and measured baseline without inventing plan',
'a loose issue uses the same authoritative seed',
'the default branch is fetched before cutting the worktree',
'an issue read or fetch failure creates no worktree',
'an explicit plan gate is refused before preparation',
'failed removal rejects without deleting the branch',
'failed branch cleanup rejects with the remaining branch diagnostic',
'failed seed cleanup retains both causes and the loose claim'. removed on purpose:
'a_worktree_git_refuses_to_remove_is_named_with_what_git_said_and_the_branch_is_still_deleted',
'a_branch_git_refuses_to_delete_is_named_with_what_git_said',
'a_cleanup_that_also_fails_after_a_common_dir_refusal_does_not_replace_the_original_failure'
The three checked-cleanup cases above replace them; retain successful undo coverage.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/git-workspace.test.ts
npm --prefix backend test -- __tests__/application/start-plan.test.ts
```

### Task 11 — Recover recorded work without live-session discovery

**Objective:** recover recorded work without replay.

**Files:** `backend/src/infrastructure/recorded-plan-recovery.ts` (create),
`backend/src/infrastructure/recorded-call.ts` (create),
`backend/src/infrastructure/claude-calls.ts` (modify),
`backend/src/infrastructure/active-plans-route.ts` (modify),
`backend/__tests__/infrastructure/recorded-plan-recovery.test.ts` (create)

Contract (backend/src/infrastructure/recorded-plan-recovery.ts):
```ts
export class RecordedPlanRecovery {
  constructor(ports: { records: PlanRecords, calls: ClaudeCalls,
    checkouts: CheckoutRegistry, activePlans: ActivePlans, reviews: ReviewWatch })
  recover(): Promise<string | null>
}
```

RecordedCall is a frozen value in its own module: constructor `{call: StartedPlanCall,
purpose: PlanCallPurpose, startedAt: string, completion: CompletedPlanCall|null}`,
all fields readonly. Add `ClaudeCalls.history(conversation: string): Promise<readonly
RecordedCall[]>` and `owns(call: StartedPlanCall): boolean`; owns uses this API's current
accepted-call map, never pid probing. Complete the strict descriptor/completion reader
once in ClaudeCalls, reused by history and wait. No raw JSON crosses these methods.

Add `ActivePlans.watches(): readonly PlanWatch[]`, `rememberPlanning(watch): void`, and
`forget({issue,repository}): void`; they operate consistently on all three registries.
Recovery coalesces concurrent calls but refreshes on every later request. Enumerate records
first, return their refusal before changing cached watches; then read all histories.
Any corrupt history makes recovery inconclusive. Only after a whole read, replace stale
watches, remember checkouts, project §2's evidence and update ActivePlans. Use the newest
startedAt call; a tie with incompatible evidence is uncertain, never directory-order choice.
Missing or unowned incomplete calls are uncertain. Successful implementation/fix is
implementing; a completed planner alone is uncertain. Owned live plan is planning;
owned implementation/fix is implementing. Failed execution is uncertain with diagnostic;
successful execution with unavailable metrics/unverified cost still projects implementing.
Start/startRecovered review watching once per implementing watch; stop it when forgotten
or uncertain. Existing startRecovered baselines old reviews and must remain intact.
Task 7's registration identity must survive implementing→uncertain→implementing: after
restart, release the old deferred sleep/read and prove no old poll, delivery or cleanup.

**TDD:** `it('restart discovers the original plan with no process or checkout registry')`
uses only on-disk record inputs and asserts the original UUID in the active response.

**Tests:** 'restart discovers the original plan with no process or checkout registry',
'an unowned incomplete call is uncertain and never relaunched',
'a completed planner without continuation stays recoverable',
'later completion refreshes projection without rewriting records',
'successful execution with unverified resumed cost remains implementing',
'repeated recovery starts one review watcher and forgets harvested work',
'uncertainty and renewed implementation cannot revive the stopped review loop',
'corrupt or ambiguous evidence is not an empty successful recovery'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/recorded-plan-recovery.test.ts
```

### Task 12 — Admit milestone commands beside the loose entrance

**Objective:** expose selection of authorised work while preserving the existing loose request and response.

**Files:** `backend/src/infrastructure/start-plan-route.ts` (modify),
`backend/src/infrastructure/api-server.ts` (modify),
`backend/__tests__/infrastructure/start-milestone-plan-route.test.ts` (create),
`backend/__tests__/infrastructure/plan-request.test.ts` (modify),
`backend/__tests__/infrastructure/refusal-codes.test.ts` (modify)

Current state (backend/src/infrastructure/start-plan-route.ts):
```ts
    Answer.send(response, 202, { status: 'started', ...StartPlanRoute.#startedAnswer(started) })
```

Keep that 202 wire shape for both entrances: status,id,repo,issue,agent,branch,worktree,
root,baseline. A milestone call has id null. Preserve PlanRequest's loose parsing and
repo-list-retired refusal. A body with a milestone key must be exactly `{milestone: string}`,
nonblank and trimmed; reject mixed or unknown keys, including repo_list. The boundary
model `MilestonePlanRequest` lives in this route module, owns the validated milestone,
and exposes `static from(raw: string): MilestonePlanRequest`; invalid input throws a
route-local `MalformedMilestonePlan` Error, projected to the explicit malformed code.

Extend handledBy's third optional collaborator object with `{milestone: StartMilestonePlan|null,
coordinating: CoordinatingSessions|null, groom: ReadEpicGroom|null, inFlight: WorkInFlight|null}`.
ApiServer adds optional startMilestonePlan/startsInFlight fields and passes the existing
coordinatingSessions/readEpicGroom. The branch with a milestone must require these services
and a held conversation. Read groom using its existing params; require the same milestone
and GROOMED or AUTHORISED state. Every other current state refuses; no duplicated spec
revision reader, promotion or groom mutation. The candidate adapter still proves readiness.

Codes, all 400: `start-milestone-malformed`, `start-milestone-no-session`,
`start-milestone-mismatch`, `start-milestone-not-dispatchable`, `start-plan-in-progress`.
Reserve repository.text around either start action and release in finally; the shared
reservation prevents loose and milestone starts racing in one backend. No browser gate
key is required here. Protocol origin/JSON/method protections remain.
Use sessions.remember only when the watch is not already implementing/uncertain in the
entrypoint's registry adapter, avoiding a fast background completion adding duplicate phases.

**TDD:** `it('a milestone command dispatches in the held checkout with the original response shape')`
uses a real HTTP server and a doubled action to assert target/root and the literal 202 body.

**Tests:** 'a milestone command dispatches in the held checkout with the original response shape',
'mixed malformed and unknown milestone fields reach no action',
'missing mismatched and unpublished context cannot dispatch',
'a coordinator can start ready work without a browser gate key',
'loose requests and repo list retirement retain their contracts',
'concurrent starts in one repository reach only one action'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/start-milestone-plan-route.test.ts __tests__/infrastructure/plan-request.test.ts __tests__/infrastructure/refusal-codes.test.ts
```

### Task 13 — Retire the obsolete manual-order acceptance scenarios

**Objective:** remove tests whose subject is the manual implementation order being retired.

**Files:** `backend/__tests__/infrastructure/implement-plan-route.test.ts` (modify)

Current state (backend/__tests__/infrastructure/implement-plan-route.test.ts):
```ts
  it('an_accepted_order_answers_that_the_implementation_is_under_way', async () => {
```

Remove exactly the scenarios named below; preserve the remaining tests and helpers for
the following retirement task. Their replacement is the automatic ContinuePlan tests and
the ordinary 404 test in Task 14. This is deliberate contract retirement, not relaxing
an assertion over a surviving endpoint. No production behaviour is changed here.

**TDD:** No TDD — removal of the withdrawn manual-order contract; its replacement bridge
has been pinned outside-in in Task 1.

**Tests:** removed on purpose:
'an_accepted_order_answers_that_the_implementation_is_under_way',
'a_duplicate_order_returns_the_same_answer_and_executes_only_once',
'a_plan_whose_progress_nobody_asks_about_still_admits_the_go',
'the_three_fields_reach_the_use_case_as_domain_values_and_not_as_the_raw_json',
'a_repository_that_is_not_owner_slash_name_is_refused_before_it_can_become_an_argument_of_gh',
'an_agent_handle_with_whitespace_is_refused_before_it_can_become_an_argument_of_cmux',
'an_issue_that_is_not_a_whole_number_from_one_is_refused_and_never_reaches_the_use_case',
'an_issue_of_zero_is_refused_because_the_count_of_whole_numbers_from_one_starts_at_one',
'a_field_nobody_declared_is_named_in_the_refusal_instead_of_being_ignored',
'a_body_that_is_not_a_json_object_is_refused_as_such',
'a_body_over_the_cap_is_refused_with_the_same_answer_start_plan_gives_and_never_reaches_the_use_case',
'a_tool_that_refuses_to_write_in_the_tab_names_the_specific_way_it_refused',
'a_bug_of_ours_is_not_dressed_up_as_the_tool_refusing',
'a_body_with_no_json_content_type_is_refused_before_it_is_read',
'any_method_other_than_post_is_refused_saying_which_one_is_allowed',
'every_refusable_outcome_has_an_answer_so_adding_one_cannot_reach_the_client_as_a_crash',
'an_outcome_with_no_answer_raises_instead_of_being_served_as_a_blank_refusal'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/implement-plan-route.test.ts __tests__/application/continue-plan.test.ts
```

### Task 14 — Unroute manual implementation and finish its test retirement

**Objective:** unroute manual implementation before switching its runtime collaborators.

**Files:** `backend/src/infrastructure/api-server.ts` (modify),
`backend/__tests__/infrastructure/implement-plan-route.test.ts` (modify),
`backend/__tests__/infrastructure/api-server.test.ts` (modify)

Current state (backend/src/infrastructure/api-server.ts):
```ts
    app.all(ImplementPlanRoute.PATH, ImplementPlanRoute.refuseOtherMethods)
```

Remove POST/all-method registrations and the runtime import. Keep optional constructor
fields until Task 16; ct-api still constructs/passes them until Task 15, but no route uses them.
Keep the generic not-found handler. Delete the remaining retired route test file after
removing these last scenarios. The legacy go action/registry and their isolated tests
are disconnected in Task 15; distributed protocol retirement remains separate.
The new HTTP test supplies a throwing implementPlan spy and asserts zero calls as well
as 404 `{code:'not-found',detail:'not found'}` for POST and GET, with ordinary JSON input.

**TDD:** `it('the retired implementation endpoint is not found and cannot mint a go')`
fails against the old registration and passes only with ordinary not-found handling.

**Tests:** 'the retired implementation endpoint is not found and cannot mint a go'; removed on purpose:
'every_way_resuming_an_agent_can_collapse_has_a_refusal_declared_so_adding_one_cannot_reach_the_client_as_a_crash',
'every_way_resuming_an_agent_can_collapse_has_a_code_distinct_from_every_other_one',
'every_way_resuming_an_agent_can_collapse_answers_400_because_the_code_carries_the_distinction_now',
'a_go_nobody_could_record_names_the_specific_way_it_failed_and_keeps_why',
'a_go_the_issue_did_not_take_names_what_gh_said',
'a_family_is_not_a_way_of_collapsing_so_answering_one_raises_instead_of_guessing',
'accepting_the_implementation_starts_watching_the_pull_request_that_does_not_exist_yet',
'the_plan_moves_to_the_implementing_phase_so_the_plan_stream_stops_answering_for_it',
'the_watch_it_starts_is_the_one_the_active_plan_carries_and_not_a_fresh_one',
'an_implementation_of_an_issue_nobody_is_watching_is_refused_and_starts_nothing',
'implementing_the_plan_remains_active_after_its_planning_session_is_forgotten',
'a_successful_transition_writes_its_marker_and_remains_active',
'a_marker_write_failure_keeps_the_accepted_answer_and_reports_a_warning',
'implementing_an_unwatched_plan_is_refused_without_executing_stale_input',
'an_uncertain_plan_is_refused_without_retrying_implementation',
'a_refused_request_to_implement_forgets_no_session',
'a_plan_the_agent_would_not_take_starts_no_pull_request_watch_or_implementation_start'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/api-server.test.ts __tests__/application/continue-plan.test.ts
```

### Task 15 — Wire headless execution and safe loose-start compensation

**Objective:** switch runtime to recorded calls after endpoint retirement.

**Files:** `backend/src/infrastructure/ct-api.ts` (modify),
`backend/src/application/actions/start-plan.ts` (modify),
`backend/src/infrastructure/probed-tool-sessions.ts` (modify),
`backend/__tests__/application/start-plan.test.ts` (modify),
`backend/__tests__/infrastructure/probed-tool-sessions.test.ts` (modify),
`backend/__tests__/infrastructure/api-server.test.ts` (modify),
`backend/__tests__/infrastructure/ct-api-real-process.test.ts` (modify),
`backend/__tests__/infrastructure/pull-request-review-loop.test.ts` (modify)

Current state (backend/src/infrastructure/ct-api.ts):
```ts
    const requestFixes = new RequestFixes({ workbench, planAgents })
```

Keep PR-fix wiring; composition helpers use PlanAgents. Wire HeadlessFiles/DiskPlanRecords/
ClaudeCalls/ClaudePlanCalls/ContinuePlan/HeadlessPlanAgents under Invocation.stateRoot,
with §2 budgets, real spawn/fs/UUID/clock/sleep, worker from import.meta.url, PluginTree root.
Pass defined env entries, removing CT_PHASE_PROMPT, CT_SESSION_HOOKS_URL and inherited
CLAUDE_CODE_SESSION_ID; preserve controls/auth. RecordedPlanRecovery shares records/calls
and active registries. Wire StartMilestonePlan, startsInFlight and coordinator/groom ports;
preserve coordinator recovery, PTY, freeze/groom and re-slicing.

StartPlan requires records: PlanRecords and claims: DispatchClaims; use checked claim/requeue,
preserving issue creation/body/response. Only confirmed records.find absence permits undo
then requeue. Failed undo preserves claim and both causes; keep Task 10's prepare refusal.
Inconclusive reads preserve work. Add both ports to the mother, ct-api helper/constructor
and api-server.test.ts's StartPlanSpy super call.
PlanSessionRegistry wrapper shares activePlans/sessions and never re-adds implementing or
uncertain watches; no second registry.

Task 14 unrouted /implement-plan; legacy fields stay unused until Task 16.
Remove ct-api's implementPlan, implementationStarts AND pullRequestReviews
server arguments together with DiskGoRegistry/DiskImplementationStartRegistry/ImplementPlan/
WorktreePlans/ActivePlanRecovery construction/imports. ReviewWatch remains in recovery.
Remove window queries/constants/probes from ct-api/ProbedToolSessions; retain five tools.
Runtime tests pin POST/GET 404 and no go at the switch.

**TDD:** `it('both entrances use recorded calls and the runtime constructs no go or window client')`
pins composition at launch boundaries and original UUIDs.

**Tests:** 'both entrances use recorded calls and the runtime constructs no go or window client',
'a loose start preserves recorded work after launch failure',
'a loose unrecorded failure uses checked requeue after cleanup',
'a loose failed undo preserves its claim and both diagnostics',
'the runtime switch retains the retired implementation endpoint as not found',
'the external tool list no longer asks a window service',
'PR review delivery reopens then resumes the recorded conversation'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/application/start-plan.test.ts __tests__/infrastructure/probed-tool-sessions.test.ts __tests__/infrastructure/ct-api-real-process.test.ts __tests__/infrastructure/pull-request-review-loop.test.ts
npm --prefix backend test -- __tests__/infrastructure/api-server.test.ts
```

### Task 16 — Remove the retired server dependency surface

**Objective:** leave no unused go/implementation-start constructor path in the HTTP server.

**Files:** `backend/src/infrastructure/api-server.ts` (modify),
`backend/__tests__/infrastructure/api-server.test.ts` (modify),
`backend/__tests__/infrastructure/session-stream-route.test.ts` (modify),
`backend/__tests__/infrastructure/session-channel-real-process.test.ts` (modify),
`backend/__tests__/infrastructure/implement-history-route.test.ts` (modify),
`backend/__tests__/infrastructure/session-input-route.test.ts` (modify),
`backend/__tests__/infrastructure/coordinating-session-route.test.ts` (modify),
`backend/__tests__/infrastructure/session-resize-route.test.ts` (modify),
`backend/__tests__/infrastructure/external-tools-route.test.ts` (modify),
`backend/__tests__/infrastructure/sessions-route.test.ts` (modify),
`backend/__tests__/infrastructure/session-hooks-route.test.ts` (modify),
`backend/__tests__/infrastructure/implement-progress-route.test.ts` (modify)

Current state (backend/src/infrastructure/api-server.ts):
```ts
  implementPlan?: PlanImplementer | null,
```

Remove implementPlan, implementationStarts and pullRequestReviews from ApiCollaborators,
fields, constructor and the now unused type aliases/imports. ReviewWatch still belongs to
the composition graph and RecordedPlanRecovery, not the server's deleted route. Remove
those arguments from the named test factories; ct-api already dropped them in Task 15.
The negative HTTP test retains its literal 404 assertion and drops its obsolete injected
spy: Task 15's runtime test already owns the no-go observation. No out-of-scope test edit.
Convert api-server's recovery mother to RecordedPlanRecovery with record/call inputs;
preserve the existing active-plan response contract assertions. No live-session endpoint,
protocol refusal, origin filter or independent coordinator assertion is removed.

**TDD:** No TDD — constructor-only cleanup following the endpoint retirement; typecheck
and the retained 404/runtime tests measure the removal without duplicating behaviour tests.

**Tests:** N/A — retain existing endpoint assertions; change only construction and the
location of the no-go observation to its real process boundary.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/api-server.test.ts __tests__/infrastructure/session-stream-route.test.ts __tests__/infrastructure/session-input-route.test.ts __tests__/infrastructure/ct-api-real-process.test.ts
```

### Task 17 — Retire window-launch identity and sentinel scenarios

**Objective:** remove obsolete tests of the disconnected window transport, retaining headless equivalents.

**Files:** `backend/__tests__/infrastructure/cmux-plan-agents.test.ts` (modify)

Current state (backend/__tests__/infrastructure/cmux-plan-agents.test.ts):
```ts
  it('a_sentinel_a_previous_attempt_left_on_disk_is_removed_before_the_new_launcher_is_written', async () => {
```

Remove only the named cases. The runtime no longer constructs this adapter. Its remaining
cases stay for the next retirement task; headless record identity and spawn acceptance
are covered by Tasks 2, 4 and 7. Keep assertions on surviving product behaviour.

**TDD:** No TDD — explicit retirement of an unconstructed transport's scenarios.

**Tests:** removed on purpose:
'a_sentinel_a_previous_attempt_left_on_disk_is_removed_before_the_new_launcher_is_written',
'the_window_it_opens_is_cut_in_the_worktree_and_not_where_the_api_happens_to_run',
'the_tab_of_a_plan_with_no_user_story_is_named_after_its_issue_instead_of_the_word_null',
'the_tab_of_a_plan_from_a_github_issue_url_carries_no_slash_the_url_had',
'the_same_issue_number_planned_in_two_repositories_writes_its_launcher_to_a_directory_that_does_not_collide',
'the_same_story_planned_in_two_repositories_opens_a_window_named_so_the_two_do_not_collide',
'the_launcher_it_writes_is_the_one_the_plugin_renders_so_the_two_halves_cannot_drift_apart',
'the_errand_travels_by_disk_and_never_as_keystrokes',
'the_errand_it_writes_is_the_one_the_brief_composed_for_that_issue_and_that_repository',
'the_session_it_opens_names_the_model_so_the_plan_never_rides_on_whatever_the_person_had_selected',
'the_handle_cmux_prints_is_what_comes_back_so_the_caller_can_reach_the_agent_later',
'the_notice_cmux_prints_before_the_handle_does_not_get_mistaken_for_one',
'a_cmux_that_refuses_the_call_arrives_typed_so_the_caller_can_tell_it_from_a_crash',
'cmux_answering_something_unreadable_is_told_apart_from_cmux_refusing_the_call',
'both_ways_of_failing_share_a_type_so_a_caller_that_does_not_care_can_catch_one_thing',
'the_resent_line_goes_to_the_handle_cmux_answered_because_send_refuses_a_title',
'a_line_that_lands_after_the_resend_is_still_a_launch_and_not_a_refusal'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/cmux-plan-agents.test.ts __tests__/infrastructure/claude-calls.test.ts
```

### Task 18 — Retire window resend and typed-resume scenarios

**Objective:** finish retiring the window adapter's test suite without carrying dead helpers.

**Files:** `backend/__tests__/infrastructure/cmux-plan-agents.test.ts` (modify)

Current state (backend/__tests__/infrastructure/cmux-plan-agents.test.ts):
```ts
  it('the_budget_the_policy_carries_is_the_one_that_is_spent_and_not_one_the_adapter_picked', async () => {
```

Remove the remaining named tests and delete the now empty suite/helpers. Call budgets,
resumption identity, explicit failures and fix delivery are covered by the new transport
and application tests. PTY line resend is retired, not emulated by a Node fixture.

**TDD:** No TDD — test removal for the disconnected transport; no new runtime rule.

**Tests:** removed on purpose:
'the_budget_the_policy_carries_is_the_one_that_is_spent_and_not_one_the_adapter_picked',
'a_sentinel_that_never_shows_up_is_reported_instead_of_being_called_a_launch',
'a_sentinel_that_says_the_binary_was_missing_names_the_binary_and_not_the_window',
'a_shell_that_landed_somewhere_else_is_reported_because_the_window_title_would_not_show_it',
'a_shell_that_reached_the_very_same_directory_through_a_symlink_is_not_reported_as_the_wrong_one',
'every_launch_step_the_policy_can_answer_has_a_move_so_a_fourth_one_cannot_pass_for_keep_probing',
'a_launch_step_nobody_declared_a_move_for_raises_instead_of_being_taken_for_keep_probing',
'a_second_sourcing_starts_nothing_because_the_line_gets_resent_when_the_pty_eats_it',
'a_budget_with_no_resends_gives_up_where_the_first_send_runs_out',
'it_types_the_errand_on_the_handle_it_was_given_and_then_presses_enter',
'the_errand_it_types_is_the_one_the_brief_composed_for_that_issue',
'a_cmux_that_refuses_to_write_arrives_typed_so_the_boundary_can_tell_it_from_a_crash',
'an_enter_that_never_lands_is_reported_because_the_line_is_sitting_there_unrun',
'it_types_the_fix_errand_on_the_handle_it_was_given_and_then_presses_enter',
'the_errand_it_types_is_the_one_the_brief_composed_for_those_changes',
'a_fix_that_could_not_be_typed_travels_out_typed',
'an_enter_that_failed_travels_out_typed_because_the_errand_sits_unrun'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/claude-plan-calls.test.ts __tests__/infrastructure/headless-plan-agents.test.ts
```

### Task 19 — Retire live-window recovery scenarios

**Objective:** remove the obsolete session-discovery suite now replaced by record-only recovery.

**Files:** `backend/__tests__/infrastructure/worktree-plans.test.ts` (modify)

Current state (backend/__tests__/infrastructure/worktree-plans.test.ts):
```ts
  it('the_identity_of_a_plan_in_flight_comes_from_git_and_the_session_only_names_its_agent', async () => {
```

Delete this suite and its private helpers. The record reader/recovery suites cover identity,
missing versus unreadable evidence and unavailable processes. Session-title/directory matching
is withdrawn; its fixtures must not be retained as a second recovery implementation.

**TDD:** No TDD — retirement; Tasks 2 and 11 pin the replacement discovery contract.

**Tests:** removed on purpose:
'the_identity_of_a_plan_in_flight_comes_from_git_and_the_session_only_names_its_agent',
'a_worktree_with_no_live_session_is_left_out_the_same_way_it_is_left_out_today',
'a_session_that_hides_its_directory_does_not_lend_its_agent_while_another_one_shows_its_own',
'a_session_sitting_somewhere_else_does_not_lend_its_agent_to_this_worktree',
'sessions_that_could_not_be_listed_is_not_the_same_as_no_plans_in_flight',
'when_cmux_could_not_be_asked_its_own_words_reach_the_error_channel',
'the_reason_written_on_the_error_channel_is_the_same_one_the_caller_is_handed',
'when_no_session_exposes_its_directory_the_error_channel_says_that_is_why',
'when_the_checkout_registry_cannot_be_read_the_error_channel_says_that_is_why',
'the_story_it_could_not_read_leaves_the_plan_recovered_without_one',
'a_checkout_that_cannot_be_surveyed_does_not_take_the_other_checkouts_with_it',
'a_worktree_the_dispatcher_opened_is_not_adopted_as_a_plan_of_this_backend',
'a_session_whose_ref_is_not_a_handle_names_no_agent',
'sessions_that_all_hide_their_directory_is_not_the_same_as_no_plans_in_flight',
'a_plan_in_flight_is_recovered_even_when_the_registry_has_never_been_written',
'a_session_the_dispatcher_opened_does_not_put_its_checkout_on_the_list_to_survey',
'a_checkout_registry_that_could_not_be_read_is_not_the_same_as_no_checkouts',
'a_session_sitting_in_the_same_place_through_a_symlink_still_names_its_agent',
'a_session_that_names_the_logical_path_while_git_names_the_physical_one_still_names_its_agent',
'the_checkout_a_session_names_is_surveyed_by_the_path_git_itself_uses',
'an_entry_that_is_not_an_object_does_not_take_the_whole_recovery_down_with_it',
'a_failure_of_another_kind_of_domain_is_not_swallowed_as_this_checkout_having_no_plans',
'a_failure_that_is_not_the_ones_this_reader_degrades_travels_out_instead_of_passing_for_nothing'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/disk-plan-records.test.ts __tests__/infrastructure/recorded-plan-recovery.test.ts
```

### Task 20 — Remove the disconnected window source and legacy recovery

**Objective:** ensure no backend source filename or content names the retired transport.

**Files:** `backend/src/infrastructure/cmux-plan-agents.ts` (modify),
`backend/src/infrastructure/worktree-plans.ts` (modify),
`backend/src/infrastructure/active-plan-recovery.ts` (modify),
`backend/__tests__/infrastructure/active-plan-recovery.test.ts` (modify),
`backend/__tests__/infrastructure/cmux-contract-real-process.test.ts` (modify),
`backend/__tests__/infrastructure/no-window-titles-parsed.test.ts` (modify)

Current state (backend/src/infrastructure/worktree-plans.ts):
```ts
import { CmuxPlanAgents } from './cmux-plan-agents.ts'
```

Delete the three disconnected source modules and the two obsolete suites. Replace the
old source census with a recursive case-insensitive path AND content assertion over
backend/src. Exercise that census on a temporary offending file in the test fixture to
prove it sees both dimensions; it must not mutate real source. Remaining coordinator
and records code stays covered by its own suites.

**TDD:** `it('no backend source path or content names the retired window transport')`
is red before deletion and green only with no match in either dimension.

**Tests:** 'no backend source path or content names the retired window transport'; removed on purpose:
'the_only_module_that_names_a_cmux_workspace_is_the_one_that_opens_it',
'a_session_sitting_in_the_worktree_is_found_by_both_and_named_by_the_same_handle',
'when_no_session_shows_its_directory_neither_of_them_says_there_is_none',
'a_session_that_shows_a_different_directory_is_answered_as_absent_by_both',
'a_plan_with_no_go_and_no_implementation_marker_recovers_as_planning',
'a_recovered_plan_being_written_is_remembered_as_a_session_and_nothing_watches_its_issue',
'a_valid_go_without_an_implementation_marker_recovers_as_uncertain',
'a_go_that_predates_the_implementation_marker_registry_recovers_as_implementing_when_the_run_file_shows_work_underway',
'a_go_whose_run_file_cannot_be_read_stays_uncertain_instead_of_being_assumed_clean',
'a_go_whose_worktree_exists_but_has_no_run_file_yet_stays_uncertain_instead_of_being_assumed_clean',
'a_go_whose_run_file_explicitly_says_starting_stays_uncertain_instead_of_being_assumed_clean',
'a_plan_with_a_matching_marker_recovers_as_implementing_and_starts_no_new_session',
'a_plan_that_was_already_implementing_gets_its_pull_request_watched_again',
'a_go_whose_run_file_shows_work_underway_gets_its_pull_request_watched_too',
'a_plan_that_never_started_implementing_gets_no_pull_request_watch',
'a_marker_whose_story_differs_is_still_this_plan_because_the_title_of_an_issue_can_be_renamed',
'keeps_a_plan_with_a_marker_path_that_is_a_directory_in_planning',
'keeps_a_plan_with_an_unreadable_marker_in_planning_without_stopping_startup',
'the_checkout_of_a_plan_it_recovered_goes_back_to_the_registry_as_the_pair_the_dispatcher_can_look_up',
'two_recoveries_at_once_run_the_recovery_only_once',
'a_second_sequential_recovery_remembers_no_extra_session',
'recovers_nothing_and_hands_over_the_reason_when_the_plans_in_flight_could_not_be_listed'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/no-window-titles-parsed.test.ts __tests__/infrastructure/recorded-plan-recovery.test.ts
```

### Task 21 — Follow automatic progress without a go button

**Objective:** update the page from active-plan evidence while keeping the coordinator usable.

**Files:** `frontend/src/pages/home/Home.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.implementPlan.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.layout.test.tsx` (modify),
`frontend/src/__scenarios__/HeadlessPlanMother.ts` (create)

Current state (frontend/src/pages/home/Home.tsx):
```tsx
import { ImplementPlanAction } from 'app/implement-plan/components/implement-plan-action'
```

Remove action renders/import/callback; preserve issue link, coordinator/GateSequence,
layout, keyboard and old-plan isolation. Poll ActivePlansClient every 2,000 ms while a
coordinator is held with no selection (even after initial empty discovery), and throughout
selected/candidate active lifetime: planning, ready, implementing AND uncertain. Fresh
work reconciles too; remove the non-restored early return. One candidate is adopted,
multiple stay selectable. Keep ready snapshots readable; only backend evidence implements.
Never overlap polls/retries. Capture mounted/request generation, coordinator and workflow
identity before awaiting; reject obsolete responses on switch, new start, discard/unmount.
Discard adds a repo/issue/agent tombstone for this mount, filtering every later discovery;
invalidate pending callbacks too. Uncertainty blocks launch for fresh AND restored work,
including implementing→uncertain; recovery gating must not depend on restoredRef alone.
Keep polling to observe later evidence. No POST /implement-plan. Render Spanish automatic
progress/record-recovery copy. HeadlessPlanMother names empty/planning/implementing/uncertain
wire responses and deferred changes for these suites.

**TDD:** `it('a ready plan follows backend implementation without posting an order')`
sees a later implementing response, preserved UUID and no mutation request.

**Tests:** 'a ready plan follows backend implementation without posting an order',
'uncertain recorded work offers no duplicate launch',
'an initially empty held coordinator discovers a later dispatched plan',
'fresh and restored implementing work both become uncertain and block launch',
'late discovery cannot replace a newer workflow or coordinator',
'the coordinator remains writable during automatic progress',
'polling stops on unmount and cannot readopt a discarded plan'; removed on purpose:
'should offer to implement the plan only once it is ready',
'keeps a ready plan in review with its issue link until implementation succeeds',
'should offer only the issue link and the go on a ready plan',
'should send exactly the payload the backend contract declares',
'should say the implementation started and name the agent',
'should show the backend refusal text as it came and keep offering the button',
'should show the backend refusal text as it came for a malformed repo',
'should say the backend is unreachable when the network fails',
'should keep the button disabled while the request is in flight'.

**Verification:**
```bash
npm --prefix frontend test -- src/pages/home/__tests__/Home.implementPlan.test.tsx src/pages/home/__tests__/Home.restoreWorkflow.test.tsx src/pages/home/__tests__/Home.layout.test.tsx
npm --prefix frontend run build
```

### Task 22 — Remove the unused manual-implementation client

**Objective:** retire the component, client and fixtures after Home stops consuming them.

**Files:** `frontend/src/app/implement-plan/client.ts` (modify),
`frontend/src/app/implement-plan/client.test.ts` (modify),
`frontend/src/app/implement-plan/ImplementPlan.types.ts` (modify),
`frontend/src/app/implement-plan/components/implement-plan-action/ImplementPlanAction.tsx` (modify),
`frontend/src/app/implement-plan/components/implement-plan-action/ImplementPlanAction.test.tsx` (modify),
`frontend/src/app/implement-plan/components/implement-plan-action/ImplementPlanAction.css` (modify),
`frontend/src/app/implement-plan/components/implement-plan-action/index.ts` (modify),
`frontend/src/__scenarios__/ImplementPlanMother.ts` (modify),
`frontend/vite.config.ts` (modify)

Current state (frontend/src/app/implement-plan/client.test.ts):
```ts
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
```

Delete the eight retired modules above. Remove the /implement-plan dev proxy entry in
vite.config.ts; all surviving proxies remain. The new HeadlessPlanMother replaces the
old mother in Home's suites, so no stale import or copied manual-order client survives.
The backend's ordinary 404 is asserted against the backend itself, not Vite's SPA fallback.

**TDD:** No TDD — dead-client retirement; automatic progress and absence of the button
are already pinned by Home's new tests.

**Tests:** removed on purpose:
'should report a stale agent handle by code, not by status',
'should report an uncertain implementation phase by code, not by status',
'should keep other refusals generic, carrying only their detail',
'should notify its parent once only after the implementation is accepted',
'should present an accepted implementation as active information',
'should not notify its parent when the backend refuses the implementation',
'should tell the person to get a fresh agent when the remembered one is stale',
'should refuse an automatic retry when implementation phase is uncertain',
'should not notify its parent when the backend is unreachable'.

**Verification:**
```bash
npm --prefix frontend test -- src/pages/home/__tests__/Home.implementPlan.test.tsx src/pages/home/__tests__/Home.restoreWorkflow.test.tsx src/pages/home/__tests__/Home.layout.test.tsx
npm --prefix frontend run build
```

### Task 23 — Rehearse accepted continuation and document the delivery boundary

**Objective:** rehearse selection, recorded acceptance, publication and restart without new model calls.

**Files:** `backend/__tests__/infrastructure/headless-dispatch-dry-run.test.ts` (create),
`docs/superpowers/evidence/issue-331-apply.md` (create),
`backend/API.md` (modify), `backend/conventions/this-repository.md` (modify),
`frontend/README.md` (modify)

Final text (docs/superpowers/evidence/issue-331-apply.md):
```md
# Issue #331 — Apply evidence

The apply gate remains a human decision. This dossier records an isolated rehearsal
of the headless dispatcher using scripted external boundaries.
```

Use one happy-path HTTP request through the real route/action/adapters to the scripted
GitHub/git/process boundaries. No fake driver decides the plan/publication/implementation
order: ContinuePlan and both call adapters run. Capture intended argv, issue selection,
seed and descriptor-before-spawn ordering, complete comment body and final 202 identity.
Replay Task 3's initial-success fixture for planning; accept implementation at the scripted
spawn boundary with completion deferred. Assert both descriptors and planner reported total,
CLI duration and independently measured wall duration. Recreate recovery with no owned
process: the same UUID is uncertain without another spawn. End at accepted continuation,
not a claim of successful implementation. Teardown releases the scripted close event and
drains supervised waits. Real-process lifecycle is Task 4's; error parsing is Task 3's.
Seed a pre-existing attempt telemetry file and assert it remains byte-identical: no
headless bill is appended as another task attempt. Reject any unlisted external command.
Use Task 3's committed fixture/provenance files, never the temporary source directory at
test runtime. No fabricated resume-success fixture or new Claude call. No real claim,
worktree, issue comment or PR is created.

After executing the rehearsal and lifecycle tests, fill the dossier with the actual
commands/results, revision, temporary-root evidence, failure-cut tests already run and
the unavailable/resumed-unverified cost limitation. Cite all three real captures and the
observed 0.50 budget failure. Never mark apply closed or claim a live rollout.
Update API docs with both start bodies and existing 202 envelope, new refusals, unrouted
manual endpoint, record layout, no automatic uncertain replay and same-conversation fixes.
Update the local vocabulary for headless plan agents and the five probed tools, distinguish
legacy distributed go from this backend, and document the #332 handoff including CLI
duration versus wall duration, raw reported total versus null resumed attributable cost,
and the prohibition on deriving costs by subtraction/token pricing. Frontend README retains
the coordinating session. Do not translate dated specs or restate the travelling yardstick.

**TDD:** `it('the isolated dispatcher records publishes accepts continuation and recovers its identity')`
asserts the real bridge trace through acceptance and unchanged attempt metrics.

**Tests:** 'the isolated dispatcher records publishes accepts continuation and recovers its identity'.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/headless-dispatch-dry-run.test.ts __tests__/conventions-no-restatement.test.ts
```

## 8. Global verification

Run by the coordinator/implementation workflow after all tasks, not as architecture baseline.
Every command must exit 0; no assertion pins a suite-wide number of tests.

| Acceptance requirement | Verification evidence |
|---|---|
| Ordered ready selection, claim and seed | Tasks 8–10 and the real bridge rehearsal |
| No window transport in backend/src | Task 20 path/content census and Task 15 runtime |
| Unrouted manual endpoint and no go | Tasks 1, 14–16 |
| Publication before automatic continuation | Tasks 1, 5–7 and 23 |
| Immutable records before launch | Tasks 2 and 4, including real-process cut points |
| Reported telemetry, unverified resumed cost and honest absence | Tasks 1, 3–4, 11 and 23; no attempt-row modification |
| Records-only restart discovery | Tasks 2, 11 and 23 |
| Loose entrance, PR fixes and coordinator preserved | Tasks 7, 12, 15, 21 and retained coordinator/groom suites |

```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend test
git diff --exit-code "$(git merge-base origin/main HEAD)" HEAD -- plugin/scripts/ct-next.mjs plugin/scripts/ct-step.mjs plugin/scripts/run-machine.js
git diff --check
```

## 9. Assumptions

**Task 7 correction (2026-09-16):** the user/coordinator reports the three-suite
call regression command now recorded in Task 7 produced 4 failures and 17 passes.
Source inspection confirms Task 7 already requires nullable review requestId, separate
from the call-directory UUID, but omitted Task 4's claude-calls.test.ts from its edit
scope and regression verification. Add that file and retain all prior files/tests/commands;
compact only Task 7 wording to retain its 3500-character budget. This is missing test
scope, not new behaviour. Identity expectations change; corruption/operational failure,
immutable conflicts and no-replay guarantees remain. Precise fixture/error decisions are
in `.agent/run-331/task-7-correction-guidance.md`. The reported test run is not an
architect-run pass. Validate using this worktree's original-cut e50cbc3 contract and
base-backed citations; this predates main's newer STE validator (the user reports #370
reconciliation). No newer-STE final validation is claimed; original citations remain.

1. **Accepted amendment:** this correction request reports user approval of #331 call-record
   telemetry and interim agent-conducted implementation, with #332 owning backend step
   calls and attempt attribution. It also reports that the live issue body is amended
   and #332 has a linked handoff comment. Those are coordinator/user-provided facts, not
   GitHub writes or independent live verification by this architect. The earlier proposal
   is https://github.com/mercadona/control-tower/issues/331#issuecomment-5684076273.
   No verbatim human approval wording is asserted.
2. **Architect's delivery-boundary summary, not a human quotation:** #331 preserves reported
   totals, turns and CLI duration, with independent wall duration and explicit unavailable
   fields. Resumed attributable cost is null with unverified attribution; the per-resume
   cost guarantee remains pending by accepted limitation. Its implementation/fix call may conduct the existing
   ct-step oracle and its subagents. #332 owns backend-driven per-step calls, exact
   per-step D-19/D-25 context/schema guarantees, and attribution/ingestion of call cost,
   turns and CLI duration into existing attempt rows. No duplicate attempt row or
   rewrite of append-only telemetry is introduced. The protected #331 files stay intact.
3. **Former B-1, resolved by scope:** `ct-step.mjs:497-518,1257-1272,2194` has no external
   call-measurement input. `run-metrics.js:418-443,481-509` counts a companion implement
   row as an extra attempt. The prior architect reported a read-only probe where both counts became 2.
   #331 now writes neither row. Missing plan verb/JSON output were not blockers:
   `ct-step.mjs:233-240,544-598` already supports planning-before-run and oracle relay.
4. **Measurement limitation accepted in this correction request:** the user selected no
   more Claude calls and explicitly left the guarantee of cost per resume pending. Store
   the received total with its scope explicit, never invented attribution. A terminal result
   belongs to an invocation's output file; that does not prove its cost covers that invocation
   alone. Preserve CLI-reported turns/duration without equating them to wall time. No
   incremental bill, task bill or separately measured judge bill is claimed for resumes.
   No subtraction of totals, token pricing, inferred zero or extra capture call repairs this.
5. **Restart limitation:** record discovery is required; automatic replay of a lost bridge
   or uncertain call is not. Recovery exposes uncertainty rather than making a second launch.
6. **Session roles:** this request confirms Astra architecture and Sol implementation later;
   the prior plan names `openai/gpt-5.6-sol`. This request assigns only plan correction. This does not change
   the product's requested Claude transport/model. No claim that this task tool selected
   a model it cannot select, and no nested architect subagents.
7. **Workflow prerequisite:** `.agent/SLICE.md` is absent. The coordinator supplies its
   real seed and baseline; no state is fabricated by architecture. The issue explicitly
   waives the plan gate and retains apply. Plan publication needs no approval reply.
8. **Verification provenance:** the user reports baseline passes: backend typecheck,
   backend 1,990 tests/94 files, frontend 1,287 tests/67 files. These were not rerun by this
   architect; task/global commands remain future implementation verification. Suite counts
   are historical observations, never predicates. Plan-check results come from actual runs.
9. **B-2 — satisfied by supplied captures and declared limitation:** the coordinator supplied
   the three exact files listed in §2, and this architect read only those authorised capture
   files with the dedicated reader. Their terminal results establish initial success and
   two recognized errors. CLI version/date/cwd/commands and exit0 are coordinator-reported;
   the result numbers/subtypes/usage are observed in stdout. Stdout is not independent proof
   of process exit or complete invocation argv. Long metadata/result lines were truncated
   in the reader display; Task 3 must copy complete source result lines, not the displayed
   excerpts. Sanitize IDs and omit private non-result metadata as prescribed in §2.
   The resumed result has total 1.051838 and zero terminal usage, but its assistant event
   has nonzero usage. This neither proves a per-call bill nor permits claiming zero work.
   The 0.50 option failed to bound the reported total; exact incremental spend is unverified.
   Turn-limit reports num_turns 2 with a limit of 1; preserve it rather than clamp it.
   No successful-resume capture was obtained; none is required to execute this amended
   plan, and none may be fabricated or sought with another Claude call. Sol persists the
   available captures and provenance in Task 3, then uses them offline. B-2 no longer
   blocks implementation; unverified resumed-cost attribution is an accepted limitation,
   not a fulfilled numeric guarantee. No fixture, production file or run state was created
   in this architecture correction, and the further-call prohibition has no exceptions.
10. **Live-issue amendment for the coordinator (architect-drafted, not posted here):**

    #331 preserves each owned call's exact CLI-reported total_cost_usd, reported num_turns
    and duration_ms, separately from measured wall duration and execution outcome. For
    resumed calls, cost attribution is explicitly unverified and attributable call cost is
    unavailable (null); the guarantee of cost per resume remains pending. Reported totals
    must not be treated as incremental bills, summed as call spending, differenced or
    replaced by token-price estimates. A proven successful execution may continue despite
    unavailable telemetry; recognized error results never succeed merely because exit is 0.
    The existing initial-success, resumed-budget-error and turn-limit captures are sufficient
    fixture evidence. The observed 0.50 budget option did not bound the resumed reported
    total of 1.051838; no hard spending-cap guarantee is claimed. No further Claude calls
    are authorised for this work. #331 retains interim agent-conducted implementation and
    writes no attempt rows; #332 owns backend step calls and evidence-based attempt attribution.

### Source-verified seeding and execution prerequisites

The public seed API is `buildStateSeed` in `plugin/scripts/kickoff.js:425-578`, fed by
`mapGhIssue` in `plugin/scripts/gh-issue-map.js:818-914`. Its baseline is a BaselineResult;
its exclusion is `excludeContentWith`/SLICE_REL_PATH in `plugin/scripts/state-paths.js`.
There is no standalone public seed-only CLI in the inspected tree. ct-next performs
seeding inside its dispatcher/transport path; do not invoke that path for this direct
coordination session or invent a `--seed-only` flag.

The user reports the amendment and baseline are already complete. The earlier architect
reported origin/HEAD as origin/main and merge-base `e50cbc36e0a2568ff475383aef208575f132b46b`;
confirm before future seeding if the branch changes. This correction verified worktree
`/Users/jponzvan/git/control-tower-plugin/.worktrees/331`, with no `.agent/SLICE.md` present.
Supply the coordinator's captured baseline JSON in the command-local
environment variable CT_SEED_BASELINE_JSON, with its measured outcome, command and
summary; this is input to the rendering command below, not a new plugin setting.
The command emits the authoritative seed to stdout and writes no state:

`gh issue view 331 --repo mercadona/control-tower --json number,title,body,labels,milestone | node --input-type=module -e 'import {mapGhIssue,NO_MILESTONE_KEY} from "./plugin/scripts/gh-issue-map.js"; import {buildStateSeed} from "./plugin/scripts/kickoff.js"; import {BaselineResult,BaselineOutcome} from "./plugin/scripts/baseline.js"; let text=""; for await (const chunk of process.stdin) text+=chunk; const raw=JSON.parse(text); const measured=JSON.parse(process.env.CT_SEED_BASELINE_JSON); if(raw.number!==331 || !Object.values(BaselineOutcome).includes(measured.outcome) || typeof measured.summary!=="string") throw new Error("issue identity or measured baseline is missing"); process.stdout.write(buildStateSeed({...mapGhIssue(raw),epic:raw.milestone?.title || NO_MILESTONE_KEY},{branch:"feat/331",base:"main",baseSha:"e50cbc36e0a2568ff475383aef208575f132b46b",baseline:new BaselineResult(measured)}));'`

The prior architect reported exercising the renderer/exclusion helper with a synthetic
issue and explicitly unverified baseline: exit 0, correct issue/base/gates, no files written.
The live rendering command above is source-verified, not executed with a fabricated
baseline. The coordinator writes its exact output to `.agent/SLICE.md` using an authorised
file edit, and adds only the exclusion helper's missing rule to the git common directory's
info/exclude. Preserve existing exclusion content. `git rev-parse --git-common-dir`
now returns `/Users/jponzvan/git/control-tower-plugin/.git`; the old relative `.git`
assumption predates the worktree move. Resolve exclusions through this actual common
directory, never `.worktrees/331/.git/info/exclude`. No exclusion was edited here.
`git check-ignore --quiet .agent/SLICE.md` is the
post-seeding predicate; confirm the seed carries apply, the amended signal and real
baseline, with no invented plan gate. Do not seed or amend `.agent/STATE.md` for this task.

Plan validation is read-only and does not need a seed or issue mutation:
`node plugin/scripts/dispatch-check.mjs 331 --repo mercadona/control-tower --check-plan`.
It reads working-tree plans, including untracked ones (`dispatch-check.mjs:793-806`).
The coordinator synchronises scope for implementation/judgement; the structural checker
does not adjudicate the amendment or verify billing attribution. The corrections ran the checker while
editing; it caught A4 overflows in Tasks 7, 10, 11 and the runtime task (now 15). Wording was shortened while retaining
decisions and tests. B-2 is satisfied by named captures, not by the structural checker;
the resumed-cost limitation remains explicit even after a pass.

After the coordinator commits the validated plan, publishes it for
tracking and supplies the legitimate seed, the first execution command is
`node plugin/scripts/ct-step.mjs next --plan docs/superpowers/plans/2026-09-15-issue-331-the-headless-dispatcher.md --issue 331`.
This is mutating: ct-step requires SLICE.md (`:191-195`), creates the run (`:349-364`) and
prepares/seals dispatch inputs (`:544-719`). It was not run in architecture. Plan commit
must precede it because run.baseSha records HEAD when the run is born (`:233-240`).
The coordinator dispatches directly using the printed brief/rubric/report paths and
invokes the printed consuming verb, then asks next again. It owns the selected model
assignment and authorisation for program-generated commits; the architect creates no
nested agents. The issue's !plan waiver requires no reply wait; apply remains human.
Any actual conflicting permission/control refusal stops the workflow without a bypass.
