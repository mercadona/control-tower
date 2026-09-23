# Provider-neutral measured agent calls implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make measurement an invariant of every backend-managed headless agent invocation, through a provider-neutral wrapper rather than explicit capture calls in each role.

**Architecture:** A `MeasuredAgentCalls` decorator implements the same execution contract as its injected executor. Provider adapters execute calls and translate their evidence into common measurements; an injected store persists those measurements. The existing durable call identity, detached execution, recovery rules and cost-attribution safeguards remain authoritative.

**Tech Stack:** TypeScript with erasable syntax, Node.js, Vitest, local immutable files.

## Approved intent

- The wrapper must not depend on Claude, its command arguments, its stream format or its filesystem conventions.
- Claude Code is the current executor beneath the wrapper, not the implementation of the wrapper itself.
- A future OpenCode executor must reuse the wrapper without changing it.
- All role callers receive the wrapped executor. They do not separately request measurement.
- The measured unit is one headless agent invocation. It may contain multiple model requests and tool calls.
- This change covers backend-managed headless calls, including legacy continuation and recovery. Interactive coordinating sessions and internally dispatched subagents are different execution boundaries, not independently covered calls.
- Harvest, BigQuery delivery and plugin attempt metrics are a later task.

## Repository prerequisites

Read `AGENTS.md`, `backend/conventions/this-repository.md`, `docs/glossary.md`, and `plugin/conventions/{architecture,boundaries,style,testing}.md` before implementation.

The current workspace is already on `alcaptar/metrics`. Preserve unrelated changes. If implementation is attached to a GitHub issue, add it to Project 16 and set `In Progress` before editing implementation files, using `docs/project-16.md`. Stop if the Project refuses.

Run backend commands from `backend/`. `package.json` declares `typecheck` and `test`, but no standalone lint command. Do not invent one or treat type checking as linting. Commits, pushes and pull requests require an explicit user request.

## Existing seams and constraints

| Existing module | Relevant responsibility |
| --- | --- |
| `backend/src/infrastructure/claude-calls.ts` | Durable invocation identity, deduplication, worker launch, completion reads, history and ownership |
| `backend/src/infrastructure/headless-call-worker.ts` | Detached child supervision, terminal result and durable wall duration |
| `backend/src/infrastructure/claude-call-result.ts` | Claude result parsing and basic measurements |
| `backend/src/infrastructure/claude-run-measurements.ts` | Detailed Claude projection and immutable `measurements-v1.json` publication |
| `backend/src/infrastructure/claude-plan-calls.ts` | Planning/fix invocation preparation and access to call history |
| `backend/src/infrastructure/claude-run-calls.ts` | Role invocation preparation, execution and response installation |
| `backend/src/infrastructure/run-plan-agents.ts` | Driver supervision, recovery and several explicit capture sites |
| `backend/src/application/actions/deliver-held-messages.ts` | Another explicit capture site |
| `backend/src/infrastructure/headless-plan-agents.ts` | Legacy planning/fix paths without equivalent detailed capture |
| `backend/src/application/actions/continue-plan.ts` | Legacy continuation without equivalent detailed capture |
| `backend/src/infrastructure/ct-api.ts` | Production composition of both driver and legacy paths |

`ClaudeCalls.wait()` and `completed()` currently return execution evidence without guaranteeing detailed capture. `history()` is also used during recovery. Covering only `wait()` would leave other terminal observations unmeasured.

The worker already measures wall duration from persisted timestamps. A wrapper timer around `wait()` would measure observation latency, not invocation duration, and would be wrong after a restart. Reuse the executor's durable times instead of adding a second clock for the same measurement.

`ClaudeRunMeasurements.capture()` currently reads completion through `ClaudeCalls`. Injecting a decorated executor back into this component would create a recursive capture path. Break that dependency by passing already-read completion evidence into the provider reader.

## Dependency and ownership design

### Aggregate boundary

One invocation is identified by the existing `(conversation, callId)` pair. The durable descriptor and terminal completion own its lifecycle. Measurements are a projection of this evidence, not another execution state machine. Reading or retrying measurement must never relaunch work.

### Ports and value objects

- `AgentCalls`: execution lifecycle consumed by the decorator and role adapters. Retain split start, wait, completion and history operations; do not collapse them into a blocking `call()`.
- `AgentCallMeasurements`: provider-neutral, immutable normalized measurements and their availability/attribution. Reuse existing call identity and completion values where they already express the required meaning.
- `AgentMeasurementReader`: returns those values for a completed call. Claude parsing lives behind this port.
- `AgentMeasurementStore`: records a measurement by invocation identity, with immutable write-or-match semantics.
- `MeasuredAgentCalls`: delegates execution, obtains provider-neutral measurements and ensures their persistence before exposing a known terminal completion.

Keep ports free of `CallDescriptor`, `HeadlessFiles`, process handles and infrastructure imports. Invocation preparation must stay in provider adapters: a port that requires Claude flags or a Claude response schema is not provider-neutral. If an execution-only request type is needed, define its semantic input and response requirements as a value object, with command construction on the adapter side. Do not implement a provider registry or OpenCode adapter in this change.

### Measurements contract

The common record carries invocation identity, provider, purpose, recorded start/end, wall duration, execution outcome, available token counts, available models, reported cost with attribution, and diagnostics. Role/work identifiers are carried when known, not inferred from conversation text.

Represent unknown measurements explicitly. Preserve reported zero. Distinguish input, output, cache-read and cache-creation tokens; do not manufacture a total when their overlap is unproven. Preserve `unverified-resume` cost attribution and never difference resumed totals or estimate prices.

Claude's detailed `reported` keys and source hashes remain provider-specific evidence. Existing `measurements-v1.json` files are immutable and must remain readable; do not overwrite them with a changed schema. Store the common contract separately as `agent-measurements-v1.json` beside existing call evidence, with an explicit schema version. This separates the common contract from retained provider evidence without rewriting historical files.

### Completion and failure semantics

| Observation | Required effect |
| --- | --- |
| Successful completed invocation | Persist available measurements before returning completion |
| Completed invocation with execution error | Persist available measurements, preserving the execution error |
| Recorded timeout or child-spawn failure | Persist the recorded failure and known duration; unavailable consumption stays unavailable |
| Malformed or absent provider result with valid completion | Persist execution evidence and diagnostics rather than inventing usage |
| No completion yet | Do not create a terminal measurement |
| Deadline passed but launch/completion is uncertain | Preserve uncertainty; do not synthesize a timeout or relaunch |
| Same completion observed again or concurrently | Same durable record, never double-counting or overwriting different evidence |
| Backend restart after completion but before capture | Recovery through the wrapped history/completion path publishes missing measurements without starting another agent |
| Store refuses publication | Surface the recording failure; keep execution evidence and retry recording, not execution |
| Start fails before a durable invocation exists | Preserve the original launch failure; do not invent an executed call |

The guarantee is attached to durable terminal observation, including restart reconciliation. A backend that is down cannot immediately project a worker's newly published completion; it catches up when it resumes. Existing worker evidence closes this gap without introducing another daemon.

## Task 1: Pin lifecycle coverage through the common execution boundary

**Files:**
- Create: `backend/__tests__/infrastructure/measured-agent-calls.test.ts`
- Create: `backend/src/domain/ports/agent-calls.ts`
- Create: `backend/src/infrastructure/measured-agent-calls.ts`
- Reuse: `backend/src/domain/value-objects/plan-call.ts`

1. Define the execution contract from the operations actual consumers need, retaining asynchronous launch and observation. Keep provider-specific launch preparation outside this contract.
2. Add named scenario mothers and port doubles for completed success, completed failure, unfinished and recovered calls. The fake executor must have no Claude stream, command or filesystem dependency.
3. Add failing tests asserting that observing completion through `wait`, `completed`, and `history` records a measurement before exposing completion. Assert that unfinished calls remain unfinished and unrecorded.
4. Run `npx vitest run __tests__/infrastructure/measured-agent-calls.test.ts` and observe failure for missing behavior, not an unrelated fixture error.
5. Implement delegation and the single terminal-observation path. Forward ownership and request identity faithfully; never introduce retry of agent execution.
6. Run the focused suite and `npm run typecheck`.

## Task 2: Separate provider measurement reading from common persistence

**Files:**
- Create: `backend/src/domain/value-objects/agent-call-measurements.ts`
- Create: `backend/src/domain/ports/agent-measurement-reader.ts`
- Create: `backend/src/domain/ports/agent-measurement-store.ts`
- Create: `backend/src/infrastructure/disk-agent-measurements.ts`
- Modify: `backend/src/infrastructure/claude-run-measurements.ts`
- Modify: `backend/__tests__/infrastructure/claude-run-measurements.test.ts`
- Create: `backend/__tests__/infrastructure/disk-agent-measurements.test.ts`

1. Extract the provider reader from existing capture without changing the historical Claude projection. Pass completion evidence to it; it must not call the decorated lifecycle recursively.
2. Add boundary tests using the existing captured fixtures `claude-result-{initial,resumed,turn-limit}.jsonl`. Assert literal normalized values, provider identity, missing versus zero, and resumed-cost attribution.
3. Run the focused tests and observe the new assertions fail.
4. Implement translation into the common value object and immutable common-file persistence using `HeadlessFiles.writeOnce`. Retain current source validation and provider-specific evidence.
5. Test duplicate/concurrent publication and conflicting evidence with real temporary files. Do not use a fake filesystem to prove filesystem atomicity.
6. Run `npx vitest run __tests__/infrastructure/claude-run-measurements.test.ts __tests__/infrastructure/disk-agent-measurements.test.ts` and `npm run typecheck`.

## Task 3: Connect the Claude executor without leaking its protocol

**Files:**
- Modify: `backend/src/infrastructure/claude-calls.ts`
- Modify: `backend/src/infrastructure/claude-plan-calls.ts`
- Modify: `backend/src/infrastructure/claude-run-calls.ts`
- Modify: `backend/src/infrastructure/recorded-call.ts` if its neutral history value moves to the domain
- Modify: `backend/__tests__/infrastructure/claude-calls.test.ts`
- Modify: `backend/__tests__/infrastructure/claude-plan-calls.test.ts`
- Modify: `backend/__tests__/infrastructure/claude-run-calls.test.ts`

1. Adapt the current executor to the common lifecycle contract. Keep `CallDescriptor`, stored-completion codecs and Claude argument validation at the infrastructure boundary.
2. Add a failing happy-path boundary test proving an existing role receives its result and both its common measurement and provider evidence are durable without a role-level capture call.
3. Preserve request deduplication, same-conversation serialization, worker acceptance and non-launch proof semantics.
4. Keep structured-response installation and response-path containment in the role adapter; neither belongs in the measurement wrapper.
5. Run the three focused suites above and `npm run typecheck`.

## Task 4: Cover failures and crash recovery without replay

**Files:**
- Modify: `backend/__tests__/infrastructure/measured-agent-calls.test.ts`
- Modify: `backend/__tests__/infrastructure/claude-calls-real-process.test.ts`
- Modify: `backend/src/infrastructure/measured-agent-calls.ts`
- Modify: `backend/src/infrastructure/run-plan-agents.ts`
- Inspect: `backend/src/infrastructure/headless-call-worker.ts`

1. Add distinct tests for recorded execution failure, child-spawn failure, malformed result, uncertain completion, and measurement-store refusal.
2. Add recovery coverage using a completed on-disk call with no common measurement and a newly constructed backend-side observer. Assert one measurement and no new launch.
3. Add concurrent and repeated observation coverage. Assert idempotent durable output rather than requiring the reader to run only once in memory.
4. Run the relevant focused tests and observe each new behavior fail before implementing it.
5. Implement recovery reconciliation through the same terminal-observation path. Preserve original execution facts when measurement fails; a recording error is not proof that the agent never executed.
6. Run the focused suites and `npm run typecheck`. Every real child must be cleaned up in `afterEach`.

## Task 5: Wire every headless path and remove caller-owned capture

**Files:**
- Modify: `backend/src/infrastructure/ct-api.ts`
- Modify: `backend/src/infrastructure/run-plan-agents.ts`
- Modify: `backend/src/infrastructure/claude-run-calls.ts`
- Modify: `backend/src/application/actions/deliver-held-messages.ts`
- Inspect/update consumers: `backend/src/infrastructure/{headless-plan-agents,recorded-plan-recovery,stream-planning-activities}.ts`
- Inspect/update consumers: `backend/src/application/actions/{continue-plan,drive-run}.ts`
- Update existing tests and mothers affected by constructor changes

1. Construct the provider executor, measurement reader and disk store once in `ct-api.ts`; inject the decorated lifecycle into planning, role execution, legacy continuation and recovery.
2. Add happy-path composition coverage proving both new and legacy execution leave common measurements. Reuse existing scenario mothers instead of copying their setup.
3. Remove explicit `measurements.capture(...)` calls and measurement dependencies from the role/application callers only after their paths are covered by the decorator.
4. Remove the obsolete `CallMeasurements` port if it has no remaining consumer. Retain provider evidence production behind the provider boundary.
5. Audit call start, wait, completion and history sites. No role may receive the raw executor merely to avoid the measured path; infrastructure diagnostics may inspect raw evidence without executing work.
6. Run `npm run typecheck` and `npx vitest run --exclude '**/*-real-process.test.ts'`.

## Task 6: Verify the boundary and document the guarantee

**Files:**
- Modify: `backend/conventions/this-repository.md`
- Modify: `backend/API.md` only where execution/history documentation describes measurement guarantees

1. Document the common wrapper, invocation grain, common file location, provider evidence, cost attribution and recovery behavior. Explicitly distinguish headless coverage from interactive sessions and nested model requests.
2. Review production imports: the wrapper may depend on execution/measurement ports and common values, but must not import Claude codecs, descriptors or filesystem helpers.
3. Prove provider independence through the provider-neutral fake executor in the wrapper suite. A second production provider is unnecessary to establish this property.
4. Verify new assertions fail when their protected behavior is removed, then restore and verify the production tree. Follow repository rules for any mutation sweep; do not create commits without authorization.
5. Run `npm run typecheck` followed by `npm test` from `backend/`. Check for newly available lint scripts before reporting validation; currently none is declared.
6. Run `git diff --check` and inspect the complete diff. Report actual checks, remaining coverage boundaries and any blocked verification without claiming unrun checks passed.

## Acceptance checklist

- [x] A role executes through the wrapper without invoking measurement separately.
- [x] The wrapper has no dependency on Claude or provider-specific output formats.
- [x] A provider-neutral executor double exercises the same wrapper and common schema.
- [x] Planning, implementation roles, corrections, held messages and legacy continuation are wired through it.
- [x] Completed failures retain available measurements and their original execution outcome.
- [x] Recovery fills missing common measurements without replaying calls.
- [x] Repeated/concurrent observation cannot create multiple durable records for one invocation.
- [x] Unknown values and resumed-cost uncertainty are preserved.
- [x] Existing immutable call and provider-evidence files are not rewritten.
- [x] No harvest or BigQuery behavior is changed.
- [x] Type checking and the full backend suite pass; verification results are recorded accurately.

## Implementation decisions

- `AgentCalls<Invocation, Descriptor>` keeps provider-specific preparation opaque
  to the decorator. No new universal command vocabulary is needed to reuse the
  wrapper with another executor. The domain port imports neither provider types
  nor infrastructure modules.
- `RecordedCall` moved to `domain/value-objects` because the common lifecycle
  consumes its history value. Existing completion and call identity values are
  reused.
- `ClaudeRunMeasurements.read(completed)` validates durable evidence and retains
  the existing provider projection; `DiskAgentMeasurements` owns the common
  immutable record. The obsolete explicit-capture port was removed.
- Caller-level capture-spy assertions moved to wrapper behavior and durable-file
  assertions. Real-process coverage checks production composition, legacy fixes,
  restart recovery, timeouts and child-spawn failure.
- `backend-best-practices` could not be loaded in this environment. Repository
  backend conventions and `test-desiderata` guided the implementation and review.
- No manual mutation sweep is claimed: repository rules require a committed
  clean tree for that procedure, and committing has not been authorized. New
  capture, normalization, persistence and evidence-validation behavior was checked
  through observed failing tests before its implementation.

## Verification results

- `npm run typecheck`: passed.
- `npm test`: 3,088 tests passed across 151 files, including real-process tests.
- No standalone lint script is declared in `backend/package.json`.
- An earlier full run failed the census because two removed paths remained in
  Git's index. After the user authorized staging the implementation, the census
  passed without changing its assertions.
- The earlier run also timed out waiting for the interactive-session fixture's
  launch. That test passed in isolation and in the subsequent complete suite.
  Its cause was not established, and neither its code nor its timeout was changed.
- Implementation and documentation changes are staged; no commit was created.

## Adversarial review follow-up

The initial implementation was committed as `2c149a9d`. Its independent review
requested four corrections: validating model metadata, retaining the functional
role, projecting measurement errors through planning progress, and guarding the
measurement value's invariants.

The corrections extend existing types and adapters. Functional roles travel in
the optional `role` field of `call.json`; historical descriptors retain their
previous projection. No cache, service, registry or additional metadata file was
introduced. The follow-up judge returned PASS with all four findings resolved.

Follow-up verification: `npm run typecheck` passed and `npm test` passed all
3,125 tests across 151 files. The judge assessed source and tests by reading;
the parent session ran these checks independently.

## Approved simplification during pull-request review

The user approved retiring the duplicated provider projection and simplifying
result interpretation. This supersedes the earlier decision to keep generating
`measurements-v1.json`: existing files remain untouched, and only the common
`agent-measurements-v1.json` is generated. Raw process output remains in
`stream.ndjson`.

`ClaudeResultEnvelope`, extracted from the existing completion reader, is shared
by completion recording and metrics reading. It explicitly reads cost, turns,
duration, the four token counts and model names. Recursive metric discovery,
field-name heuristics, intermediate value/scope wrapping, source hashes and
provider-projection publication are removed. The metrics reader trusts the
completed value delivered by its execution port instead of rereading and
revalidating that completion file. Call identity and source-result consistency
checks remain at the descriptor and stream boundaries.

Tests for the retired projection are replaced by assertions on common metrics,
read-only extraction, preservation of historical files, consumed-field validation
and unchanged execution evidence. The completion reader's behavioral tests remain
in place. This introduces no cache, background process or additional storage.

Simplification verification: `npm run typecheck` passed; the fast backend subset
passed 3,043 tests, and `npm test` passed all 3,143 tests across 151 files.
The independent follow-up judge returned PASS, confirming the read-only reader,
single metrics output and shared explicit result parser against the amended scope.

## Further review: shared file publication and descriptor validation

The user approved consolidating immutable write-or-match behavior in the existing
`HeadlessFiles` adapter and removing immediate duplicate validation in
`CallDescriptor.from` and its constructor. The file operation reports accepted
publication or a content conflict; each caller retains its own error translation.
Descriptor decoding still checks the object shape, while field validation now
happens once in the constructor. Tests preserve malformed-input rejection through
both direct preparation and disk decoding.

Productive structured-response handling remains separate from measurement
extraction. The `agentic-skills` reference shares an outer response envelope but
consumes its structured response and its spending through different operations.
Changing the metrics capture trigger requires a separate decision: the current
recovery routine is also used by active-plan queries, so startup reconciliation
must be distinguished from observation before making history reads side-effect-free.

Verification of the publication and validation cleanup: `npm run typecheck` passed;
`npm test` passed 3,155 tests across 151 files.

## Approved capture lifecycle

The user approved separating capture from observation. `AgentCalls.wait` completes
execution through the measured wrapper; explicit `recover` reconciles terminal
records without launching or waiting for agents. `completed` and `history` are
read-only observations. Role execution goes through `wait` even when its process
has already finished, while unfinished unowned calls remain refused.

Startup calls `RunPlanRecovery.restoreCalls` before listening and reports a failed
restoration on stderr. Explicit plan recovery requests call restoration as well.
The existing active-plan projection routine does not restore measurements, so
repeated active-plan and planning-progress requests do not run the reader/store.
This supersedes the earlier terminal-observation capture guarantee. Recovery uses
existing durable records, with no cache, extra worker or new storage.

Capture-lifecycle verification: `npm run typecheck` passed. The full backend run
passed 3,155 of 3,159 tests; four real-process cases in
`ct-run-machine-real-process.test.ts` and `run-recovery-real-process.test.ts`
failed at the `CT_STATE_DIR` consistency control before exercising their intended
behavior. A separately running backend uses another state directory. The user
explicitly chose to keep that backend running and proceed without rerunning those
four cases. The control and test assertions were not bypassed or weakened, and
this run is not recorded as fully passing. The independent read-only judge returned
PASS for the current implementation; that review does not replace the blocked
verification.
