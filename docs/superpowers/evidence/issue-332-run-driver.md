# Issue #332 — Backend run driver evidence

The plugin remains unchanged. Issue #379 owns attempt-row integration.
Reported CLI totals do not establish attributable resumed-call spending.

## Delivery boundary

Revision `d860ff88` wires `RunPlanAgents` and `RunPlanRecovery` into the existing
API entrypoint. Every new loose or milestone admission now writes
`harness/<conversation>/run/admission.json` and follows the machine driver. There
is no feature flag, toggle, environment variable, activation endpoint or
configurable alternate path. Existing records are classified from durable
provenance; they are not converted into new admissions.

The backend preserves one conversation. Each supported model dispatch is one
recorded resumed call with purpose `implementation` and request id
`run:<ticket>`. The unchanged plugin remains the only sequencer: real `ct-step`
output selects calls, commands, retries, discards, reconciliation and delivery.
The backend relays the printed paths in producer order, hashes their bytes, and
uses plugin-owned `RoleBytes`, response schemas, tool declarations and parsed
`AgentDefinition` values. Commands run through `ToolRunner`, not through a model
or an evaluated shell string.

Supported model material is finite: implementer, task judge, advisor, slice
judge and `ct-reconciler`. The current E2E dispatch has no `RoleBytes` role, and
slice-agent reconciliation fallbacks have no prepared role package. Both refuse
explicitly. Ambiguous consuming commands, a wrong plan/issue/path, duplicate
commands, changed sealed bytes and missing inputs also refuse instead of
inventing context.

The machine endpoint is the plugin's `delivered` result. The driver does not
open, edit or merge a pull request and makes no delivery model call. The parent
coordinator owns pull-request publication and checked release. Existing
post-review fixes remain on their old errand after positive legacy or delivered
driver provenance; active machine work refuses a concurrent fix.

## Durable evidence and restart

The durable files are:

```text
harness/<conversation>/run/admission.json
harness/<conversation>/run/manifest.json
harness/<conversation>/run/operations/<ticket>/request.json
harness/<conversation>/run/operations/<ticket>/receipt.json
harness/<conversation>/run/operations/<ticket>/material.json
harness/<conversation>/calls/<call>/measurements-v1.json
```

Admission has exact keys `version: 1` and `conversation`. The manifest has
`version`, `conversation`, `repository`, `issue`, `plan` and
`initialPlanSha256`. A request has `version`, `previous`, `argv`, `cwd` and
`planSha256`; `previous` is null only for the first request and otherwise names
the prior receipt ticket. A receipt has `version`, `code`, `stdout`, `stderr`,
`beforeRun` and `afterRun`. The run snapshots are raw bytes or null. Material is
an immutable seal over the exact prepared paths, byte hashes, role, argv and
response contract. These records are evidence, not a mutable phase, run counter
or copied transition table.

One unbroken request/receipt chain identifies the leaf. A fork, cycle, dangling
link, pending request, conflicting immutable write or unexplained run file is
ambiguous and refuses execution. A mutating verb is not retried after an
uncertain result. A validated manifest with no request and no plugin run file is
`unstarted` and can be continued explicitly; an empty journal with a real run
file is uncertain. Established recovery uses the journal without republishing
or requiring the initial hash to match later plugin-approved plan amendments.

Positive legacy proof requires no admission, manifest or operations, exactly one
initial planner with null request id, and exactly one resumed outer
implementation with request id `implementation:<planner-call-id>`. Fix records
may accompany that pair but do not prove ownership. A `run:` request, unknown
implementation id, mixed ownership, mismatched cwd or identity, planner-only,
fix-only or no-call history refuses legacy delegation. Unowned unfinished calls
project `uncertain`/`inspect`, preserve their bytes and identity, stop review
watching and never replay automatically. Driver implementation calls are not
fed into the legacy single-outer-implementation classifier.

## Measurements

`measurements-v1.json` is written only after completion evidence exists. It
retains source path and SHA-256 for `stream.ndjson` and `completion.json`, the
independent wall duration, diagnostics, and available finite nonnegative CLI
measurements. Missing values and invalid values are omitted; measured zero is
retained. Recognized direct values include `total_cost_usd`, `num_turns`, CLI
durations, TTFT values, queue count and result index. Valid numeric leaves from
`usage`, `modelUsage`, `subagent_stats` and other reported containers retain
their source shape. Structured output is not treated as a metric.

An initial total is scoped `initial-invocation`; a resumed total is scoped
`unverified-resume`; other CLI values are `reported-only`. The raw total is not
an incremental bill for that call, is not differenced against an earlier total,
is not aggregate spending, and is not evidence of invoice or budget enforcement.
Existing legacy completion records and `/implement-history` rows remain
unchanged and nullable. For example, an old row may still carry
`"duration_ms": null` and `"tool_total_tokens": null`, while a new private
measurement omits an unavailable CLI key entirely.

The three committed historical captures are documented in
`docs/superpowers/evidence/issue-331-cli-captures.md`:

- `claude-result-initial.jsonl`: successful initial result, reported total
  `0.4208795`, one turn and CLI duration 7071 ms.
- `claude-result-resumed.jsonl`: resumed `error_max_budget_usd`, reported total
  `1.051838`, one turn and CLI duration 4876 ms. It reports zero terminal usage,
  but an omitted assistant event had nonzero usage. No complete resumed command
  was supplied and this is not a successful-resume capture.
- `claude-result-turn-limit.jsonl`: `error_max_turns`, reported total
  `0.42424649999999997`, two turns and CLI duration 4784 ms. Its complete prompt
  and command were not supplied.

All three are reduced to one pseudonymized result line. They establish retained
shapes and error values only. They establish no live permission behavior,
successful resumed billing, schema enforcement, acceptance behavior or billing
ceiling. Synthetic structured responses in tests are protocol fixtures, not
additional captures.

## Revisions and controls

The committed task revisions and their final task controls are:

| Task | Revision | Exact focused command after `npm --prefix backend run typecheck` | Result |
|---|---|---|---|
| 1 | `184645cf` | `npm --prefix backend test -- __tests__/application/continue-plan.test.ts __tests__/application/drive-run.test.ts` | 21 passed |
| 2 | `0faa7385` | `npm --prefix backend test -- __tests__/infrastructure/headless-files.test.ts __tests__/infrastructure/run-journal.test.ts` | 6 passed |
| 3 | `835a96fe` | `npm --prefix backend test -- __tests__/infrastructure/dispatch-check-claims.test.ts __tests__/infrastructure/ct-run-machine.test.ts` | 9 passed |
| 4 | `58ec5d1b` | `npm --prefix backend test -- __tests__/infrastructure/plugin-contract.test.ts __tests__/infrastructure/run-dispatch-real-process.test.ts` | 30 passed |
| 5 | `32f47398` | `npm --prefix backend test -- __tests__/infrastructure/claude-call-result.test.ts __tests__/infrastructure/claude-run-measurements.test.ts` | 13 passed |
| 6 | `059ebdc4` | `npm --prefix backend test -- __tests__/infrastructure/claude-plan-calls.test.ts __tests__/infrastructure/claude-run-calls.test.ts` | 17 passed |
| 7 | `f94153f0` | `npm --prefix backend test -- __tests__/infrastructure/headless-plan-agents.test.ts __tests__/infrastructure/run-plan-agents.test.ts`; `npm --prefix backend test -- __tests__/infrastructure/claude-calls.test.ts __tests__/infrastructure/ct-run-machine.test.ts __tests__/infrastructure/plan-refusal.test.ts` | 20 and 55 passed |
| 8 | `658a9c89` | `npm --prefix backend test -- __tests__/infrastructure/recorded-plan-recovery.test.ts __tests__/infrastructure/run-plan-recovery.test.ts` | 43 passed on final attempt |
| 9 | `d860ff88` | `npm --prefix backend test -- __tests__/infrastructure/ct-api-real-process.test.ts __tests__/infrastructure/run-driver-runtime-real-process.test.ts` | 22 passed |
| 10 | `048a83b3` | `npm --prefix backend test -- __tests__/infrastructure/headless-dispatch-dry-run.test.ts __tests__/infrastructure/run-driver-real-process.test.ts __tests__/infrastructure/ct-run-machine-real-process.test.ts __tests__/infrastructure/run-recovery-real-process.test.ts` | 10 passed |

The source for this table is the corresponding final
`.agent/run-332/task-*-controls-*.log`, task reports, committed
`docs/superpowers/metrics/issue-332.jsonl`, and the Git history. Task 7 also
recorded a 2,322-test full backend pass before its final narrow correction; task
8 recorded a final 2,360-test pass in 118 files. Those historical runs are not
rerun or promoted to the final slice gate here.

## Failure cuts and restoration

The history is intentionally not rewritten. Early reports are claims from that
attempt, not proof that every attempt was correct. The independent verdicts and
control logs retain these corrected cuts:

- Tasks 1, 2, 3 and 5 each failed an independent judge before their final PASS.
  Task 3 and task 5 also retain unreadable-verdict discards caused by invalid
  JSON; the subsequent readable failures and fixes remain visible.
- Task 4 failed three judges. A human explicitly authorized one audited fourth
  attempt. The local recovery tool revision was
  `7dcc19b6f98c4c066dca9f449c764091723f6351`; it was neither modified nor
  published. The final correction rejects cross-verb consuming-command
  ambiguity before sealing and independently passed.
- Task 7 failed once, then passed after provenance, untouched-establishment,
  recovery and internal-refusal corrections.
- Task 8 failed four judges and had one failed control run. A human explicitly
  authorized audited attempt 5 with the same local, unpublished `7dcc19b`
  recovery revision. The final correction restored planner/fix matrices,
  disk-backed no-replay proof, ownership-policy precedence, watcher registration
  identity and real supervisor ownership; a fresh independent judge passed.
- Task 9 failed once, then passed after its restart assertion observed the exact
  durable uncertain/inspect result and its real legacy fix path.
- Task 10 failed judge attempts 1 and 3; attempt 2 controls exposed a fixture
  race. Attempt 4 independently passed after consumer-bound package capture,
  exact GitHub request refusal and owned child drainage were corrected.

Meaningful performed mutation/restoration evidence includes: task 2 changed a
missing receipt into a present one; task 3 changed stale-controls exit 9 to 1;
task 4 hashed path text instead of file bytes and later allowed contradictory
consuming verbs; task 5 changed resumed attribution and exercised invalid metric
shapes; task 6 removed measurement capture; task 7 removed admission
publication; task 8 disabled journal-ticket duplication detection; task 9
selected the legacy recovery adapter; task 10 removed the prepared consumer
package. Each named owning assertion failed and the final reports record the
restored green result. Task 1 records a restored mutation failure but does not
retain enough detail to claim a more specific mutation here.

## Finite rehearsal

Task 10's final four-file real-process matrix independently passed at revision
`048a83b3`. It mounts the actual API, uses temporary Git repositories and a local
bare origin, runs the real CT oracle and consuming verbs, and reaches actual
plugin delivery in one conversation. It verifies separate recorded role calls,
exact schemas, tools, agent definitions, producer paths and consumer captures;
the complete metrics attempt-step stream; a competing consumer's stale exit 9;
advice and reconciliation; restart after completed work with no republication or
relaunch; and later-fix precedence. GitHub and model boundaries are finite local
scripts that reject unlisted requests. Model effects and structured responses
are explicitly synthetic. This proves the backend/API/CT/Git delivery graph and
its consumers, not live Claude acceptance, permission mode, schema enforcement,
billing, GitHub service availability or production deployment.

## Deployment and remaining work

Deploy the new revision through the existing entrypoints. Monitor oracle
refusals, pending or unresolved receipts, call diagnostics and each call's
reported measurements. Do not sum reported totals as spend.

Rollback is code redeployment only. First stop new admissions and drain or
preserve all driver-owned work for a compatible binary. An older binary lacks
the admission, journal and provenance recovery contract and must not adopt those
records as a legacy outer implementation. Preserve the state root. No automatic
migration, deletion or runtime switch makes a downgrade safe.

Issue #379 owns plugin ingestion of backend call measurements into attempt rows.
Until then the plugin remains byte-identical and existing attempt telemetry is
not rewritten.

The parent has not yet run the plan's global final checks or final whole-slice
judge. Their result is future evidence and is not claimed here.
