# #332 — The backend drives the run machine

> **Task-scoped subagents execute this plan.** Each task is one commit.
> Write the test first. The plan closes decisions; the implementer writes bodies.

## 1. Context and goal

Base: `a1e9ee0a5490e0f6856469d8b1cbebe1b6ff23b6`. Branch: `feat/332`.
Issue: https://github.com/mercadona/control-tower/issues/332.
PR #375 supplied durable headless calls. `ContinuePlan` still starts one outer implementation call that conducts the plugin.
This slice makes the backend driver the path for all new admissions.

### Desired end state

- For every new admission, the backend drives the existing plugin oracle after successful plan publication.
- The plugin alone chooses each step, retry, discard and terminal result.
- Each supported model dispatch resumes the original conversation with the plugin's exact prepared files.
- The CLI receives the plugin's response schema and role tools. Judges use the plugin's agent definitions.
- Every call retains available CLI measurements. New projections omit unavailable metrics and label totals as reported totals.
- Legacy call records remain readable. The backend writes no plugin attempt rows.
- Existing legacy records retain compatible recovery and fixes. Restart inspection preserves identity and never replays ambiguous operations.

### Out of scope

The entire `plugin/` tree stays byte-identical. Do not edit machine tables, verb contracts, composers, agents, prompts, bundles or hooks.
Issue #379 owns plugin attempt-row integration. Do not add companion rows or rewrite historical telemetry.

No live model invocation, historical spec edit, issue #370 work, frontend change or activation configuration belongs here.
Keep `.aiplans/backend-run-driver/` local and ignored. Do not add it to task reports or commits.

## 2. Closed decisions (take as given)

The live issue's `Delivery amendment — 2026-09-17` supersedes its original attempt-cost guarantee for this slice.
The user accepted that amendment. Issue #379 holds the deferred plugin work.
The user later prohibited every feature flag or equivalent activation switch in this slice. That instruction supersedes the earlier activation design.
The controlling amendment is https://github.com/mercadona/control-tower/issues/332#issuecomment-5712708423.

| Decision | Exact choice |
|---|---|
| D-1, D-18, D-21, D-24, D-26 | Preserve the interactive entrance, coordinator access, message channels and story hydration. |
| D-2, D-4, D-5 | Preserve ready selection, dependency order, cap and token ownership. This slice starts no next issue. |
| D-3, D-6, D-8, D-14, D-15, D-22, D-23 | Preserve app-owned authorization, publication without a go, frozen-spec publication and human gates. |
| D-7 | The backend driver does not open, edit or merge a PR. |
| D-9, D-16 | Preserve existing session surfaces and record-based discovery. Add no window transport. |
| D-10, D-11, D-12 | New backend files are TypeScript. Import plugin decisions; never copy a transition table. |
| D-13, D-17 | Persist immutable requests and receipts, never a second phase, mutable cursor or run counter. |
| D-19 | One conversation; one resumed call per supported model dispatch. Commands need no model call. |
| D-20 | Preserve the existing post-review fix path after delivery; refuse a fix during an active machine run. |
| D-25 | Relay paths, schemas and agent definitions from plugin material. Refuse an incomplete dispatch rather than invent its context. |
| Amendment | Keep plugin bytes unchanged; persist available backend call measurements; defer attempt-row ingestion to #379. |
| Activation | All new admissions use the machine driver directly. No feature flag, toggle, environment setting or configurable alternate path. |
| Deployment | Deploy the code through the existing entrypoints. Leave `Invocation`, `.env.example` and `Makefile` unchanged. |
| Rollback | Redeploy the prior code revision. First drain or stop and preserve driver work; an older binary cannot safely recover driver-owned records. |
| Ownership | One API process owns a state root. Coalesce one driver promise per conversation. No distributed lock guarantee. |
| Legacy graph | Keep `ContinuePlan`, `HeadlessPlanAgents`, `ClaudePlanCalls`, `ClaudeCalls` and their worker bodies unchanged. |
| New graph | Always admit new work to the machine. Resolve existing recovery/fix ownership from durable provenance, never configuration. |
| Call identity | Keep legacy purpose `implementation` for machine calls; correlate each through request ID `run:<ticket>`. |
| History | New recovery reads machine evidence before legacy call classification. Multiple step calls are not multiple outer implementations. |
| Deadlines | Retain model budgets: 7200000 ms, grace 5000 ms, acceptance 10000 ms and poll 250 ms. |
| Command budget | Inject 7200000 ms into the dedicated oracle runner. Do not retry a mutating verb after an uncertain result. |
| Delivery | The driver ends at the plugin's delivered result. The coordinator owns PR publication and checked release. No delivery model call. |
| Unsupported material | Current E2E lacks a role in `RoleBytes`; slice-agent reconciliation fallbacks lack a prepared role package. Refuse both explicitly. |
| Supported reconciliation | Run plugin-prepared `ct-reconciler` calls and return to the printed consuming verb. Do not infer retry limits. |
| Fix compatibility | After delivered, delegate existing fix calls unchanged. Their legacy errand already asks no agent to run `ct-step`. |
| Metrics | Preserve raw stream and completion. Project reported values with source references; never label resumed totals as own-call spending. |
| Missing values | Omit new metric keys. Preserve legacy nullable completion fields without migration. Measured zero remains zero. |
| Proof | Offline schema fixtures are synthetic protocol tests, not captures or evidence of live CLI enforcement. |
| Launch failures | `RunNotAdvanced` becomes `PlanAgentNotLaunched`; `RunNotUnderstood` becomes `PlanAgentNotNamed`. |
| Recovery failures | `RunNotAdvanced` becomes `PlanRecoveryNotRead`; `RunNotUnderstood` becomes `PlanRecoveryNotUnderstood`. Forbidden continuation uses `PlanRecoveryConflict`. |
| Fix failures | Both driver causes become `PlanAgentNotResumed`. Unexpected defects retain identity at every boundary. |

### Durable evidence contract

Each new admission writes `harness/<conversation>/run/admission.json` before the planner starts, with exact keys `version:1` and `conversation`.
This immutable record identifies execution provenance, not an activation setting. Existing legacy records do not become new admissions.

The manifest has exact keys `version: 1`, `conversation`, `repository`, `issue`, `plan` and `initialPlanSha256`.
The plan path identifies the committed plan. Later plugin-approved plan amendments do not invalidate the initial hash.
An existing unowned machine run or legacy outer implementation prevents adoption. Never reset either.

Each request has exact keys `version: 1`, `previous`, `argv`, `cwd` and `planSha256`.
`previous` is null only for the first request; otherwise it names the prior receipt's ticket.
Each receipt has exact keys `version: 1`, `code`, `stdout`, `stderr`, `beforeRun` and `afterRun`.
Run snapshots are raw file bytes or null. They are evidence, not a backend phase.

The runner exposes no signal field. Do not invent one or interpret its fallback code as a measured plugin exit.

One unbroken chain defines the current leaf. Forks, cycles, dangling links and pending requests refuse execution.
Only the oracle adapter parses this contract. It never resolves an ambiguous command through another invocation.
All verb arguments go through `ToolRunner`, never a shell or an evaluated stdout command.

### Recovery precedence

Read validated establishment evidence before any planner wait or publication. Admission alone does not establish a run.
Absent manifest plus no operations or machine run means `ABSENT`; inconsistent or unreadable evidence refuses, never falls back to publication.
A valid manifest and journal mean `ESTABLISHED`, including an empty journal before the first `next`.
Only the absent path waits for successful planning, publishes, then establishes through `open`.

Established recovery uses that journal without publication, current-tree citation checks, committed-plan checks or initial-hash equality against amended plan content.
The unchanged plugin still validates amendments and consuming verbs. Preserve the original publisher and legacy continuation.

After delivery, actual fix evidence precedes the permanent machine closure in recovery and explicit continuation decisions.
Use `PlanRecovery.from` over actual fix `RecoveryCall` values only, with null proof/cleanup and an injected `nowMs`.
Keep original start times, deadlines and completions. Do not pass machine implementation calls into the legacy single-implementation classifier.
Do not synthesize an outer completion. The existing policy selects the latest fix and rejects ambiguous histories.

Failed, expired, ambiguous or unowned incomplete fixes project uncertain/inspect, preserve diagnostics and stop the review watcher.
Owned incomplete fixes retain observation within their recorded deadline; keep the review watcher stopped until success.
Successful latest fixes permit implementing and review watching. Only no-fix histories use bare machine delivery as the successful projection.

## 3. Reference patterns

Files to imitate:
- `backend/src/application/actions/continue-plan.ts`
- `backend/src/infrastructure/claude-plan-calls.ts`
- `backend/src/infrastructure/headless-files.ts`
- `backend/src/infrastructure/recorded-plan-recovery.ts`
- `backend/__tests__/infrastructure/headless-dispatch-dry-run.test.ts`
- `plugin/scripts/judge-agent-definition.js`
- `plugin/scripts/role-bytes.js`

Rules to obey:
- `AGENTS.md`
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

The exact file scope lives in each task's `**Files:**` list.
All new test files use `.ts`; tests that spawn processes carry `-real-process.test.ts`.
Task evidence lives at `docs/superpowers/evidence/issue-332-<topic>.md`.
The canonical plan and program-produced verdicts remain the committed authority.

| Area | Deliverable | Consumer |
|---|---|---|
| Application | `DriveRun`, `ExecuteRunInstruction` | New plan-agent adapter |
| Domain | `RunMachine`, `RunCalls`, `RunInstruction`, named failures | Driver actions |
| Infrastructure | `RunJournal`, `CtRunMachine`, `ClaudeRunCalls`, `ClaudeRunMeasurements` | Runtime graph and restart inspection |
| Infrastructure | `RunPlanAgents`, `RunPlanRecovery` | Existing start, recovery and fix surfaces |
| Runtime | `ct-api.ts` | Unconditional driver composition and existing-record compatibility |
| Tests and docs | Scoped suites and finite rehearsal dossier | Task judges and reviewer |

## 5. Interfaces

Consumes: `PlanCalls.start`, `PlanCalls.planningFor`, `PlanCalls.wait`, `PlanPublication.publish` and `PlanRecords` from #331.
Consumes: `ClaudeCalls.start`, `startedFor`, `wait`, `completed`, `history` and `owns` without a legacy schema change.
Consumes: actual `ct-step next` output, consuming verbs, `RoleBytes.filesOf`, `AgentDefinition.parse` and exported schemas.

Produces: `DriveRun.execute(params: DriveRunParams): Promise<void>`.
Produces: `ExecuteRunInstruction.execute(params: ExecuteRunInstructionParams): Promise<RunInstruction>`.
Produces: `RunMachine.open(watch: PlanWatch): Promise<RunInstruction>` and `advance(watch, instruction): Promise<RunInstruction>`.
Produces: `RunMachine.establishment(watch: PlanWatch): Promise<RunEstablishmentValue>`, a read-only evidence query.
Produces: `RunCalls.perform(watch: PlanWatch, instruction: RunInstruction): Promise<void>`.

An instruction carries an opaque immutable evidence ticket, not a backend step number.
Adapters own CLI spelling. Domain code sees `call`, `command`, `delivered` or `refused` only.
The evidence ticket points to exact oracle output and the prepared material that the call adapter needs.

## 6. Test strategy

Start outside-in with doubled ports. Test adapters at literal subprocess and filesystem boundaries.
Use real plugin outputs and readers for contract comparisons. Do not replace them with a second model of the plugin.
Use the three existing CLI captures for real measurement values and failures.
Synthetic successful structured responses test internal transport only; label that provenance in the dossier.

Keep failures at their owning layer. The final edge rehearsal covers one successful request, not every failure permutation.
Each task lists its own tests. Never pin whole-suite counts as a control.
For each new mechanism, record one meaningful mutation and its restored result in the final dossier.

## 7. Tasks

### Task 1 — Drive opaque oracle instructions through application ports

**Objective:** Execute only the instruction the oracle returns, with one active driver per conversation.

**Files:** `backend/src/application/actions/drive-run.ts` (create), `backend/src/application/actions/execute-run-instruction.ts` (create), `backend/src/domain/ports/run-machine.ts` (create), `backend/src/domain/ports/run-calls.ts` (create), `backend/src/domain/value-objects/run-instruction.ts` (create), `backend/src/domain/exceptions.ts` (modify), `backend/__tests__/application/drive-run.test.ts` (create).

Contract (backend/src/domain/value-objects/run-instruction.ts):
```ts
export type RunWork =
  | { readonly kind: 'call' | 'command'; readonly ticket: string }
  | { readonly kind: 'delivered' }
  | { readonly kind: 'refused'; readonly detail: string }
export class RunInstruction {
  readonly work: RunWork
  constructor(work: RunWork)
}
```

Contract (backend/src/domain/ports/run-machine.ts):
```ts
export const RunEstablishment: Readonly<{ ABSENT: 'absent'; ESTABLISHED: 'established' }>
export type RunEstablishmentValue = typeof RunEstablishment[keyof typeof RunEstablishment]
```

Freeze the value and reject empty tickets/details. Ports expose §5's exact methods as abstract classes.
Add `RunFailure` under `PlanFailure`, with `RunNotAdvanced` and `RunNotUnderstood` as its two causes.
Keep tool diagnostics and numeric exit codes in their detail.
`DriveRun` receives `calls: PlanCalls`, `publication: PlanPublication`, `machine: RunMachine`, `step: ExecuteRunInstruction`.
Its immutable params contain `watch: PlanWatch` and `planner: StartedPlanCall`.

Coalesce concurrent execute calls by conversation. Query `machine.establishment` first.
Only `ABSENT` waits for successful planning and publishes before `machine.open`; `ESTABLISHED` calls `open` directly.
Loop over returned instructions until delivered; refusals throw `RunNotAdvanced`. Always release the in-memory promise in `finally`.

`ExecuteRunInstruction` receives `machine` and `calls: RunCalls`; its immutable params hold watch and instruction.
For a call, await `perform` before `advance`; for a command, call `advance` directly.
Return terminal instructions unchanged. Do not store a phase, choose a successor or inspect task numbers.

**TDD:** `it('the driver follows oracle instructions without a local step order')` feeds nonstandard instruction order and asserts exact effects.

**Tests:** `'the driver follows oracle instructions without a local step order'`, `'a failed planner or publication starts no machine work'`, `'concurrent continuation shares one driver and releases it after failure'`, `'a refused instruction preserves the oracle detail without another effect'`, `'established continuation reaches the journal without planner wait or publication'`.

The established case injects throwing planner/publication doubles; neither may run. Unreadable establishment also reaches neither collaborator.

**Verification:** Run the application boundary suites and typecheck.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/application/continue-plan.test.ts __tests__/application/drive-run.test.ts
```

### Task 2 — Keep immutable oracle requests and receipts

**Objective:** Preserve exact command evidence and expose uncertain operations without replay.

**Files:** `backend/src/infrastructure/run-journal.ts` (create), `backend/__tests__/infrastructure/run-journal.test.ts` (create).

Contract (backend/src/infrastructure/run-journal.ts):
```ts
export class RunJournal {
  constructor(ports: { files: HeadlessFiles; newId: () => string })
  manifest(watch: PlanWatch): Promise<string | null>
  establish(watch: PlanWatch, text: string): Promise<void>
  entries(watch: PlanWatch): Promise<readonly JournalEntry[]>
  begin(watch: PlanWatch, request: string): Promise<string>
  finish(watch: PlanWatch, ticket: string, receipt: string): Promise<void>
}
```

Use `<stateRoot>/harness/<conversation>/run/manifest.json` and `operations/<uuid>/{request,receipt}.json`.
Reuse `HeadlessFiles`; every publication uses `writeOnce`. On `EEXIST`, accept exact bytes only.
`JournalEntry` lives beside its sole constructor, the journal. Freeze ticket, request text and optional receipt text.
Its receipt union is `absent` or `present` with text; absence never means a successful command.

The journal stores bytes; the oracle adapter owns their JSON contract. Do not store a phase or mutable latest pointer.
`begin` allocates a ticket, publishes its request, then returns. `finish` never rewrites a receipt.

An empty operations directory is valid. A missing request, unexpected filename, non-UUID directory or unreadable entry refuses the read.
Reject paths outside this conversation. Do not touch call directories, plugin metrics or the governed worktree.

Translate filesystem failures to `RunNotAdvanced`; malformed layouts and byte collisions become `RunNotUnderstood`.
Unexpected defects retain identity. Test through a real temporary disk with injected filesystem failures, not a replacement journal.
Register cleanup before writes; use the existing `HeadlessFiles` fixture pattern.

**TDD:** `it('a command request survives a missing receipt without becoming replay permission')` reconstructs the journal over the same disk.

**Tests:** `'a command request survives a missing receipt without becoming replay permission'`, `'immutable journal collisions accept only identical bytes'`, `'journal IO failures differ from malformed layouts and preserve existing bytes'`.

**Verification:** Run durable-record boundaries and typecheck.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/headless-files.test.ts __tests__/infrastructure/run-journal.test.ts
```

### Task 3 — Execute and recover the unchanged oracle protocol

**Objective:** Apply oracle commands with durable receipts and preserve every real exit code.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (create), `backend/__tests__/infrastructure/ct-run-machine.test.ts` (create).

Contract (backend/src/infrastructure/ct-run-machine.ts):
```ts
export class CtRunMachine extends RunMachine {
  constructor(ports: { journal: RunJournal; node: ToolRunner['runWholeOutput'];
    git: ToolRunner['runWholeOutput']; read: (path: string) => Promise<string | null>;
    ctStep: string; dispatchCheck: string; pluginRoot: string })
  establishment(watch: PlanWatch): Promise<RunEstablishmentValue>
  open(watch: PlanWatch): Promise<RunInstruction>
  advance(watch: PlanWatch, instruction: RunInstruction): Promise<RunInstruction>
  inspect(watch: PlanWatch): Promise<RunInspection>
}
```

`RunInspection` is a frozen payload beside its sole constructor. It holds a tagged `absent`, `active`, `delivered` or `uncertain` fact.
Active facts carry the leaf instruction; uncertain facts carry detail. Inspection reads only and executes no command.

Only absent establishment lists committed plans through Git and `planFilesForIssue`, demands exactly one, and runs real `--check-plan`.
Establish §2's manifest after publication, before the first `next`. Refuse a pre-existing machine run without this manifest.
Both `establishment` and `inspect` use the same validated journal reader. Established `open` skips all pre-implementation publication and plan gates.

Read full output with the injected capped runner. Publish the request before execution and the receipt before any further effect.

Parse known output through a boundary model in this module. Import `STEPS` and `RUN_STATES`; never invoke `after`.
For ordinary successful verbs, query `next` again. A reconciliation role announcement becomes a call instruction before another `next`.

A delivered result ends work. Nonzero exits preserve code/stdout/stderr and stop; exit 9 stays the plugin's own refusal.
Unknown output refuses. Do not derive retries or successors from task numbers, counters or a backend table.

Open resumes the journal leaf. A completed call uses its old ticket; a pending command receipt remains uncertain.
`advance` submits the leaf's consuming verb once. Repeated calls read an existing successor receipt rather than repeat its command.
No startup read advances a run. No error becomes successful delivery.

**TDD:** `it('oracle exit nine survives the adapter unchanged')` asserts the real boundary code and zero follow-up effects.

**Tests:** `'oracle exit nine survives the adapter unchanged'`, `'a command request precedes execution and its receipt precedes the next effect'`, `'a pending forked or malformed command chain cannot resume'`, `'a delivered oracle ends the driver without another model call'`, `'established open never repeats current-tree plan validation'`.

The established-open case makes Git plan discovery and `--check-plan` throw if called; the existing journal still supplies its instruction.

**Verification:** Run oracle and existing process boundaries.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/dispatch-check-claims.test.ts __tests__/infrastructure/ct-run-machine.test.ts
```

### Task 4 — Resolve dispatch material from real plugin output

**Objective:** Relay supported role files and refuse dispatches whose material the plugin cannot supply.

**Files:** `backend/src/infrastructure/ct-run-machine.ts` (modify), `backend/src/infrastructure/run-journal.ts` (modify), `backend/src/infrastructure/run-dispatch.ts` (create), `backend/__tests__/infrastructure/run-dispatch-real-process.test.ts` (create).

Contract (backend/src/infrastructure/run-dispatch.ts):
```ts
export class RunDispatch {
  readonly ticket: string
  readonly role: 'implement' | 'judge' | 'advise' | 'slice-judge' | 'reconcile'
  readonly paths: readonly string[]
  readonly argv: readonly string[]
  readonly response: { readonly kind: 'structured'; readonly path: string }
    | { readonly kind: 'edits' }
  constructor(asked: { ticket: string; role: RunDispatch['role']; paths: readonly string[];
    argv: readonly string[]; response: RunDispatch['response'] })
}
```

Add `CtRunMachine.dispatch(watch, ticket): Promise<RunDispatch>`. It parses only the matching recorded oracle output.
Add journal `material(watch,ticket): Promise<string|null>` and `seal(watch,ticket,text): Promise<void>` for `operations/<ticket>/material.json`.
The exact keys are `version:1`, `paths`, `sha256`, `role`, `argv`, `response`; arrays keep oracle order.
Seal before any model launch; reject different bytes or missing files on replay.

Read each printed input path literally. Import `RoleBytes.filesOf`, model/tool constants, schemas and `AgentDefinition.parse`.
Use `REPORT_SCHEMA`, `VERDICT_SCHEMA`, `ADVICE_SCHEMA` and `SLICE_VERDICT_SCHEMA` for their matching roles.
Pass definitions through `toClaudeAgents`; never copy an agent body into backend source.

The declared process copy maps response verbs only: report, verdict, advice and slice-verdict. It contains no successor order.
Reconciliation consumes edits through the printed reconcile verb and has no invented schema.

Keep optional log paths and printed verdict globs; omit only explicit absence markers. Never copy log contents into prompts.
Hash sorted glob matches but retain the original glob in the errand. The backend never calls a package composer itself.
Preserve the actual plugin package: staged diff for tasks, `run.baseSha..HEAD` for the slice.

E2E and slice-agent fallback announcements return refused instructions with the exact unsupported material named.
Unknown role/model/tool/path shapes refuse before launch. Do not repair them with a backend prompt.
The real-process fixture gets output from the unchanged CLI in temporary Git repositories; no live model runs.

**TDD:** `it('real oracle material reaches the dispatch without rewritten bytes')` compares files before and after resolution.

**Tests:** `'real oracle material reaches the dispatch without rewritten bytes'`, `'plugin definitions tools and schemas determine every supported role'`, `'unsupported E2E and slice fallback material starts no call'`, `'a sealed dispatch refuses changed or missing input material'`.

**Verification:** Run the real producer contract and existing plugin boundary tests.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/plugin-contract.test.ts __tests__/infrastructure/run-dispatch-real-process.test.ts
```

### Task 5 — Project available CLI measurements without changing legacy records

**Objective:** Persist reported measurements with their source meaning and omit unproven metrics.

**Files:** `backend/src/infrastructure/claude-run-measurements.ts` (create), `backend/__tests__/infrastructure/claude-run-measurements.test.ts` (create).

Contract (backend/src/infrastructure/claude-run-measurements.ts):
```ts
export class ClaudeRunMeasurements {
  constructor(ports: { files: HeadlessFiles; calls: ClaudeCalls })
  capture(call: StartedPlanCall): Promise<void>
}
```

Write `calls/<call>/measurements-v1.json` under the existing conversation directory. The reviewer reads this per-call evidence.
Use immutable exact-byte publication. Read the descriptor, raw stream and completion; do not change any of them.

The envelope has `version:1`, `conversation`, `callId`, `purpose`, `source`, `reported`, `wallDurationMs` and `diagnostics`.
`source` names stream/completion paths and their SHA-256 digests. Read mode from the actual descriptor.

Project available `total_cost_usd`, `num_turns`, `duration_ms`, `duration_api_ms`, `ttft_ms`, `ttft_stream_ms`, `queued_turn_count` and `result_index`.
Project numeric leaves from `usage`, `modelUsage` and `subagent_stats` without sums or field renames.
Retain accompanying string dimensions in those objects, including model/provider/costBasis and tier.
Retain other numeric CLI leaves in `reported.extra`, keyed by JSON pointer, with `reported-only` scope; exclude model-authored `structured_output`.
Keep all original fields in the stream. Diagnostics name invalid omitted metric paths.

Validate durations/costs as finite nonnegative numbers and counters as nonnegative integers. Omit invalid or absent leaves, not measured zero.
The total projection carries `{value, scope}`; scope is `initial-invocation` or `unverified-resume` from descriptor mode.
Nested reported costs remain reported values, not an extra attributable bill. Add no derived cost, token total or wall/CLI equality.
Legacy null values do not appear as metrics in this new projection.

On absent completion, write nothing yet. On unavailable terminal evidence, retain completion wall time and diagnostics, with no fabricated CLI metrics.
Accept one matching terminal result, including identical repeats; malformed, foreign or conflicting results yield no asserted CLI metrics.
Preserve recognized error measurements. Do not treat error exit zero as success.
Reuse all three committed #331 captures; synthetic invalid variants test omission, never successful resumed billing.

**TDD:** `it('the resumed capture retains reported totals and omits an own-call bill')` pins 1.051838, one turn and 4876 ms.

**Tests:** `'the resumed capture retains reported totals and omits an own-call bill'`, `'all captured measurement groups retain their values and provenance'`, `'missing invalid and conflicting metrics disappear while measured zero survives'`, `'projection publication preserves legacy bytes and accepts identical retries'`.

**Verification:** Run actual capture parsing and projection tests.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/claude-call-result.test.ts __tests__/infrastructure/claude-run-measurements.test.ts
```

### Task 6 — Make one recorded resumed call for each supported dispatch

**Objective:** Enforce role tools and response schemas while the program retains sequence control.

**Files:** `backend/src/infrastructure/claude-run-calls.ts` (create), `backend/__tests__/infrastructure/claude-run-calls.test.ts` (create).

Contract (backend/src/infrastructure/claude-run-calls.ts):
```ts
export class ClaudeRunCalls extends RunCalls {
  constructor(ports: { calls: ClaudeCalls; machine: CtRunMachine;
    measurements: ClaudeRunMeasurements; files: HeadlessFiles; pluginRoot: string })
  perform(watch: PlanWatch, instruction: RunInstruction): Promise<void>
}
```

Resolve the sealed dispatch through `machine.dispatch`. Use `CallInvocation` with purpose `implementation`, cwd from watch and request ID `run:<ticket>`.
The common argv is `-p --output-format stream-json --verbose --permission-mode acceptEdits --plugin-dir <root> --resume <conversation>`.
Append the role argv and `ClaudePlanCalls.OPENING`. Keep normal settings, hooks, denies and authorization intact.

The role argv includes both `--tools` and `--allowedTools` with the plugin's tool set, excluding no declared tool.
Use `--model` from the implementer constant or definition; use `--agents` and `--agent` for defined roles.
Structured roles include `--json-schema` with the exact imported schema. Reconciliation edits have no invented response schema.
No role gains `Agent`, Bash or Write beyond its plugin declaration. Copy no benchmark isolation or session-disabling options.

The file errand lists the prepared paths and `RoleBytes` material paths in order, without their contents.
Its wrapper says only: `Read the listed files. Complete this role. Return the CLI response. Do not run CT commands or dispatch another agent.`
No errand asks for `ct-step`; no backend text replaces the judge rubric or response schema.

Check `startedFor` before start. Reuse completed calls; wait for owned incomplete calls; refuse an unowned incomplete call without another launch.
Capture measurements after completion, including errors, before any consuming verb. Failed execution throws `RunNotAdvanced`.
On successful structured calls, persist raw `structured_output` as immutable `response.json` beside the call, then atomically install it at the printed response path.

Missing or malformed structured output installs JSON null; the plugin's consumer decides its discard. Never use a stale model-written response file.
For edits, only successful completion returns. A projection write failure stops advancement and can retry from existing completion without a model call.
Synthetic schema responses test transport; they are not CLI captures.

**TDD:** `it('one resumed call carries exact plugin paths tools and binary schema')` asserts the full invocation and unchanged input bytes.

**Tests:** `'one resumed call carries exact plugin paths tools and binary schema'`, `'completed dispatch replay makes no second call and replaces stale response bytes'`, `'failed or unowned calls advance no verb and preserve measured evidence'`, `'missing structured output reaches the plugin as a discard input'`.

**Verification:** Run call request and response boundaries.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/claude-plan-calls.test.ts __tests__/infrastructure/claude-run-calls.test.ts
```

### Task 7 — Connect new admissions to the existing plan-agent surface

**Objective:** Start the driver after publication and preserve legacy admissions and safe non-launch recovery.

**Files:** `backend/src/infrastructure/run-plan-agents.ts` (create), `backend/src/infrastructure/run-journal.ts` (modify), `backend/__tests__/infrastructure/run-plan-agents.test.ts` (create).

Contract (backend/src/infrastructure/run-plan-agents.ts):
```ts
export class RunPlanAgents extends PlanAgents {
  constructor(ports: { legacy: PlanAgents;
    records: PlanRecords; calls: PlanCalls; transport: ClaudeCalls;
    driver: DriveRun; machine: CtRunMachine; journal: RunJournal;
    measurements: ClaudeRunMeasurements; newId: () => string; nowMs: () => number;
    stderr: (line: string) => void })
}
```

Add journal `admitted(watch): Promise<boolean>` and `admit(watch): Promise<void>` for §2's immutable admission record.
Every `launch` prepares through `PlanRecords`, admits to the machine, then starts the existing planner with `PlanCalls.start`.
New launches never delegate to the legacy adapter.
Return the same conversation and start supervised continuation. Capture planner measurements before driver execution, even on planner failure.

Preserve definite non-launch proof and checked cleanup semantics from #331. Record `PlanAgentNeverLaunched.proof`; never delete uncertain work.
If admission publication fails, preserve the dispatch record and report the failure. It does not prove a safe cleanup.
Supervisor failures retain repository, issue, conversation, call and diagnostic in stderr. They do not become successful delivery.

For recover/fix, find the exact recorded watch and inspect provenance. Valid legacy records retain original recovery/fix calls and create no driver admission.
Driver records retain their owner. Missing or conflicting provenance refuses; it never selects a legacy launch or migrates an implementation.
Recovery follows §2's establishment and latest-fix precedence; uncertain commands and unowned incomplete calls remain inspect-only.
Explicit driver recovery first restores missing measurement projections from completed history, including completed fixes; GET never performs this write.

After delivery, fixes use the existing `PlanCalls.start(watch,'fix',changes,requestId)` and errand without modification.
Capture their completion before return from supervision. Refuse fixes while the machine is active or uncertain.
Keep direct `resume` refused. Use §2's exact boundary failure mappings.
Concurrent driver and fix requests share the conversation reservation; release it in `finally`.

**TDD:** `it('a machine admission publishes before the first oracle call')` asserts the production bridge effects and original UUID.

**Tests:** `'a machine admission publishes before the first oracle call'`, `'legacy record recovery and fixes retain exact calls without new admission evidence'`, `'restart preserves recorded ownership without migrating a conversation'`, `'non-launch proof and ambiguous launch evidence keep their existing cleanup meanings'`, `'fixes wait for delivery and retain their original errand and measurements'`.

The legacy case pins original argv, errand, UUID and response identity.

**Verification:** Run both plan-agent boundary suites.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/headless-plan-agents.test.ts __tests__/infrastructure/run-plan-agents.test.ts
```

### Task 8 — Project driver recovery from durable facts

**Objective:** Keep restart inspection read-only and recover completed work without duplicate model or verb execution.

**Files:** `backend/src/infrastructure/run-plan-recovery.ts` (create), `backend/src/infrastructure/run-plan-agents.ts` (modify), `backend/__tests__/infrastructure/run-plan-recovery.test.ts` (create).

Contract (backend/src/infrastructure/run-plan-recovery.ts):
```ts
export class RunPlanRecovery {
  constructor(ports: { legacy: RecordedPlanRecovery; records: PlanRecords; calls: PlanCalls; transport: ClaudeCalls;
    machine: CtRunMachine; journal: RunJournal; agents: RunPlanAgents;
    checkouts: CheckoutRegistry; activePlans: ActivePlans; reviews: ReviewWatch; nowMs: () => number })
  recover(): Promise<string | null>
}
```

Expose `RunPlanAgents.owns(watch: PlanWatch): boolean` from its active supervisor reservation.
Read all records, admissions, histories and journal inspections before any active projection changes.
A malformed or unreadable record returns its diagnostic and preserves the previous projection.

For legacy admissions, use `PlanCalls.recoveryFor` and the existing `PlanRecovery` policy without another legacy state machine.
If no admission belongs to the driver, delegate the whole read to `RecordedPlanRecovery.recover`.
For driver admissions before a manifest, preserve planner and definite non-launch recovery semantics.
An owned planner projects planning. A completed successful planner allows explicit continuation; a failed planner stays inspect-only.

After a manifest, multiple `implementation` call records are valid only when their `run:<ticket>` identities match this journal.
Owned driver work projects implementing. Apply §2's latest-fix policy before any delivered projection or explicit continuation.
Unowned unfinished calls, pending commands, inconsistent identities and malformed evidence project uncertain with inspect-only detail.
Completed calls with an unconsumed response permit explicit continuation, not automatic GET-driven execution.

GET recovery never starts a call, publishes metrics, executes a verb or writes run evidence.
Keep original UUIDs and deadlines. No marker reset, replacement conversation, fabricated outer completion or new attempt row.

Stop review watches for uncertain work and incomplete fixes. Start them only for successful legacy or driver evidence under §2's precedence.
Use registration identity so a stopped review loop cannot revive. Forget records that harvest removed.

**TDD:** `it('restart recovers a driver identity without replaying an unowned call')` asserts original records and zero launch/verb effects.

**Tests:** `'restart recovers a driver identity without replaying an unowned call'`, `'completed response recovery consumes once without another model invocation'`, `'mixed legacy and driver histories keep distinct ownership and recovery rules'`, `'GET recovery writes no evidence and cannot revive an obsolete review watcher'`, `'post-delivery fix policy precedes the permanent delivered marker'`.

Pin failed/successful, owned/unowned incomplete, equal-timestamp and exact-deadline fix cases. Assert projection, diagnostic, watcher effects and zero executions.

**Verification:** Run legacy and driver recovery boundaries.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/recorded-plan-recovery.test.ts __tests__/infrastructure/run-plan-recovery.test.ts
```

### Task 9 — Wire unconditional machine admissions with legacy-record compatibility

**Objective:** Route every new admission through the machine and preserve compatible recovery for existing legacy records.

**Files:** `backend/src/infrastructure/ct-api.ts` (modify), `backend/__tests__/infrastructure/run-driver-runtime-real-process.test.ts` (create), `backend/__tests__/infrastructure/ct-api-real-process.test.ts` (modify).

Current state (backend/src/infrastructure/ct-api.ts):
```ts
    const continuation = new ContinuePlan({ calls: planCalls, publication })
    const planAgents = new HeadlessPlanAgents({
      records,
      calls: planCalls,
      continuation,
      newId: randomUUID,
      stderr: (line) => process.stderr.write(line),
    })
```

Keep the original adapters for existing legacy records only. Add the new collaborators beside them; change no legacy method body.
Do not add an activation parameter, environment variable, request field or alternate startup path.

Construct journal, oracle, measurements, model-call adapter, step action, driver and ownership-aware plan-agent wrapper.
Use the existing files, records, transport, publication, clock and process caps. Inject separate oracle and Git runners.
Pass `runWholeOutput` bound to its runner. Model call budgets stay on the existing transport.
Inject `Date.now` into both new wrappers' `nowMs`; preserve recorded fix deadlines.

Wire every start to `RunPlanAgents`, which always admits to the machine. Pass it to recovery, fixes and review delivery too.
Wrap original recovery with `RunPlanRecovery`; use existing server interfaces. Legacy adapters serve only validated existing-record provenance.

With only valid legacy records, original recovery handles the read. Mixed histories retain their original UUIDs and owners without conversion.
Cleanup retains its original action and legacy proof policy. Driver work without proven non-launch is not cleanup-eligible.

Leave `Invocation`, `Makefile`, `.env.example` and `.env` unchanged. Add no dependency or permission expansion.
Test new admissions and existing-record compatibility as distinct scenarios, not configurable modes.
At the real entrypoint, assert original legacy argv/errand/response identity and no new admission during legacy recovery or fixes.
Verify existing Make entrypoints need no activation input; runtime assertions must reach the actual composition graph.

**TDD:** `it('the runtime routes every new admission through the machine driver')` pins planner publication, oracle calls and original conversation identity.

**Tests:** `'the runtime routes every new admission through the machine driver'`, `'legacy record recovery preserves original call argv and response identity'`, `'runtime recovery keeps recorded driver ownership without another launch'`, `'existing entrypoints start without an activation setting'`.

**Verification:** Run unconditional runtime and legacy-record entrypoint boundaries.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/ct-api-real-process.test.ts __tests__/infrastructure/run-driver-runtime-real-process.test.ts
```

### Task 10 — Rehearse the finite producer-consumer matrix

**Objective:** Prove the new driver consumes real oracle outputs through delivery without a live model or plugin edit.

**Files:** `backend/__tests__/infrastructure/run-driver-real-process.test.ts` (create), `backend/__tests__/infrastructure/ct-run-machine-real-process.test.ts` (create), `backend/__tests__/infrastructure/run-recovery-real-process.test.ts` (create), `backend/__tests__/infrastructure/fixtures/run-driver-mother.ts` (create).

No code — this task adds integration tests whose bodies follow the named assertions.

`RunDriverMother` exposes `static ready(): Promise<RunDriverMother>`, `static conflictingBase(): Promise<RunDriverMother>` and `dispose(): Promise<void>`.

Use temporary Git repositories, a local bare origin, plugin seeds and a contract-valid plan.
Never edit run state, counters, verdict tokens or seals. Register cleanup before spawn; kill and await children in `afterEach`.

The happy path uses the mounted API and real collaborators; double only GitHub/model boundaries with exact-request scripts that reject unknown requests.
The model double performs task file effects and returns labelled synthetic schema responses. Task 9 owns legacy compatibility.

Drive the real plugin to delivery; compare emitted paths, consumer inputs, conversation UUIDs and distinct judge call identities.
Assert private measurement files; only plugin verbs write attempt rows.

At the oracle adapter, use real verbs for stale-ticket exit 9, two vetoes/advice and conflict resolution.
A competing real consumer advances the stale ticket. Check third-brief advice bytes, reconciler inputs, staged task diffs and `run.baseSha..HEAD` slice diffs.

The recovery suite establishes through the real initial path, then stops after a completed role, before response consumption.
Two cases rewrite a cited source span or add a permitted uncommitted task-scope amendment. Rebuild collaborators over the same disk.
Explicit recovery consumes the existing response once; a repeated request adds no publication, model launch or duplicate consuming verb.

Produce a delivered journal through real verbs, then persist synthetic failed/successful fix completions in separate cases and rebuild collaborators.
Failure must project uncertain/inspect with the exact diagnostic and stopped watcher. Success must retain implementing and review watching.
Both cases execute zero model calls or verbs. Keep these assertions at the recovery adapter, not HTTP.

**TDD:** `it('a new admission reaches real machine delivery with one conversation')` asserts effects through the production graph.

**Tests:** `'a new admission reaches real machine delivery with one conversation'`, `'a stale oracle ticket returns the real wrong-step exit nine'`, `'two real vetoes produce advice and the third plugin brief'`, `'a real merge conflict uses the prepared reconciler package'`, `'established recovery consumes rewritten citations and dirty scope amendments once'`, `'a later fix result overrides real delivered journal evidence after restart'`.

**Verification:** Run the finite real-process matrix and retained dispatcher rehearsal.
```bash
npm --prefix backend run typecheck
npm --prefix backend test -- __tests__/infrastructure/headless-dispatch-dry-run.test.ts __tests__/infrastructure/run-driver-real-process.test.ts __tests__/infrastructure/ct-run-machine-real-process.test.ts __tests__/infrastructure/run-recovery-real-process.test.ts
```

### Task 11 — Record the amended delivery boundary and rollout evidence

**Objective:** Document unconditional driver deployment, legacy-record compatibility and the deferred work.

**Files:** `backend/API.md` (modify), `backend/conventions/this-repository.md` (modify), `docs/superpowers/evidence/issue-332-run-driver.md` (create).

Final text (docs/superpowers/evidence/issue-332-run-driver.md):
```md
# Issue #332 — Backend run driver evidence

The plugin remains unchanged. Issue #379 owns attempt-row integration.
Reported CLI totals do not establish attributable resumed-call spending.
```

Record actual task commands, revisions, failure-cut tests, mutations and restoration checks. Do not invent a red phase or live acceptance.
Separate real Git/oracle/HTTP evidence from scripted GitHub/model boundaries and synthetic schema responses.
Name the three existing CLI captures and their limits. Include an example of omitted metrics beside preserved legacy null fields.

Document unconditional new admissions and provenance-based legacy recovery/fixes. No activation setting exists.
Deployment of the new code makes the driver the path for all new work through the existing entrypoints.
Monitor oracle refusals, unresolved receipts and per-call reported measurements. Reported totals are not aggregate spending.

Rollback means redeployment of the prior code revision, not a runtime toggle.
First drain or stop and preserve driver work; older binaries lack its recovery contract. Never resume it as a legacy outer implementation.
Preserve durable records during downgrade. No automatic migration or deletion makes that downgrade safe.

Document the driver's delivered endpoint, coordinator-owned PR/release, unchanged post-review fixes and explicit unsupported-material refusals.
Amend only the current backend convention's #332 boundary; leave all dated historical evidence and specs intact.
The local tracking index points to these canonical tasks and remains outside commits and task reports.

**TDD:** No TDD — documentation of behavior that prior tasks already measure.

**Tests:** N/A — retain the existing convention guard; add no test that mirrors documentation prose.

**Verification:** Check the current convention and exact protected tree.
```bash
npm --prefix backend test -- __tests__/conventions-no-restatement.test.ts
git diff --exit-code a1e9ee0a5490e0f6856469d8b1cbebe1b6ff23b6 -- plugin/
git diff --check
```

## 8. Global verification

The baseline already passed. These commands verify the final implementation, not this plan-only commit.

| Amended acceptance criterion | Producer and consumer | Tasks |
|---|---|---|
| Plugin-only sequence | Real oracle output to driver actions | 1, 3, 10 |
| Exact wrong-step exit | Real consuming verb to process adapter | 3, 10 |
| Separate judge calls | Plugin definition to recorded call descriptor | 4, 6, 10 |
| Available measurements with honest omission | Captured CLI stream to private versioned projection | 5, 6, 7 |
| No model conductor | Sealed material to exact call argv and file errand | 4, 6, 9 |
| Verbatim prepared files | Real composers to dispatch consumer | 4, 10 |
| Binary schema option | Imported schemas to literal CLI argv | 4, 6 |
| Plugin judge definition | `AgentDefinition` to `--agents` and `--agent` | 4, 6 |
| Compatible recovery | Immutable records to explicit continuation | 2, 7, 8 |
| Unconditional admission and legacy compatibility | Actual runtime graph and durable record provenance | 7, 9 |

Task controls and the final dossier carry evidence. No table row asserts live CLI success.

```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend test
git diff --exit-code a1e9ee0a5490e0f6856469d8b1cbebe1b6ff23b6 HEAD -- plugin/
git diff --check
```

## 9. Assumptions

1. The accepted issue amendment resolves the earlier B1, B2 and scope findings. The dated frozen spec stays unchanged.
2. The task scope includes backend source/tests, named backend docs and issue evidence; configuration files and the plugin stay unchanged.
3. New admissions always use the driver. Existing legacy records retain compatible recovery/fixes; driver completion means machine delivery, not a PR.
4. Missing E2E or fallback role material invokes D-25's explicit refusal contract. This plan does not promise support the plugin cannot compose.
5. Existing captures establish measurement shapes and errors, not successful resumed billing or live schema enforcement.
6. The parent owns implementation, judges and publication. This amendment stays unstaged for the live task's official report, controls and commit.
7. D-25 describes a task-base review package. Current `ct-step.mjs:826-827,852-874` uses the index for tasks and `run.baseSha` for slice review.
   The accepted plugin freeze preserves that actual behavior. This plan promises no multi-commit task-package guarantee; plugin changes remain deferred.
