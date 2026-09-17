# PR 375 apply-feedback implementation report

Date: 2026-09-16

Repair base: `b26554378b437b77362699cef1d867756c559283`

## Outcome

The repair preserves the original plan identity from durable evidence and adds
bounded supervision of its original Claude calls. It does not open replacement
conversations, replay completed implementation or fix calls, infer non-launch
from absence, force-remove workspaces, or mutate inspect-only evidence.

The control plane now distinguishes four recovery actions:

- `observe` waits for the original planner only inside its immutable recorded
  deadline;
- `continue` resumes publication and implementation after a successful original
  planner call;
- `cleanup` retires a dispatch only after immutable definite non-launch proof,
  checked workspace removal and checked issue requeue;
- `inspect` exposes a diagnostic while authorizing no mutation.

Repository-scoped work exclusion is shared by starts, recovery and cleanup.
Reservation release occurs on success and on every mapped or unexpected failure.
Operational collaborator failures remain distinct from malformed durable
evidence. The route adapters map only exact dedicated recovery and cleanup error
constructors; bare family roots and unknown subclasses remain unexpected 500
errors.

## Delivered slices

1. `d586129` - authorized headless calls and exposed recovery guidance.
2. `8b239cc` - recovered the original headless continuation.
3. `ed03b3c` - recorded immutable definite initial non-launch proof.
4. `b410448` - retired proven unused dispatches safely and idempotently.
5. `d4e9bd3` - exposed checked recovery and cleanup through the API.
6. The final frontend slice exposes typed recovery metadata, exact POST clients,
   Spanish recovery controls, POST-then-GET reconciliation, duplicate-action
   suppression, and generation guards against late replies. Inspect remains a
   GET-only path, and neither recovery action calls `/start-plan`.

## HTTP and UI contract

`GET /active-plans` discriminates ordinary planning/implementing records from
uncertain records. Every uncertain record carries a diagnostic and one typed
recovery action with its detail. `POST /recover-plan` accepts observation or
continuation of the exact repo/issue/agent identity and returns `202` after
supervision is registered. `POST /cleanup-plan` accepts checked retirement of
the exact identity and returns `200` only after cleanup completes.

Both mutation endpoints require an exact JSON body, reject foreign origins and
oversized requests, share the repository work reservation, and map protocol and
known domain refusals to stable HTTP 400 codes. The UI renders `Recuperar trabajo`
for observation/continuation and `Limpiar arranque fallido` for cleanup, keeps
the coordinating surface mounted, disables a mutation while pending, and reads
active plans again after acceptance.

## Durable evidence

- `pr-375-apply-feedback-plan.md` is a byte-for-byte copy of
  `.agent/run-331/apply-feedback-plan.md` at completion. Both have SHA-1
  `4195c940d04037553d623d89b1e5ab8b97c542d6`.
- `pr-375-apply-feedback-analysis.md` is a byte-for-byte copy of
  `.agent/run-331/apply-feedback-analysis.md` at completion. Both have SHA-1
  `4b27d389c8cc026177c1e70f0ad899d470d0ae90`.

## Verification

- Task 6 focused frontend contract: 4 files, 76 tests passed.
- Final focused Home regression run: 2 files, 45 tests passed.
- Full frontend suite: 70 files, 1,347 tests passed.
- Frontend production build: TypeScript and Vite passed; Vite reported only its
  existing chunk-size advisory.
- Backend typecheck: passed.
- Full backend suite: 109 files, 2,142 tests passed.
- The first full backend attempt had one pre-fixture PID timing failure in
  `claude-calls-real-process.test.ts`; its immediate isolated rerun passed 2/2,
  and the subsequent full backend rerun passed 2,142/2,142.
- `git diff --check`: passed.
- The exact protected comparison against the repair base for `ct-next.mjs`,
  `ct-step.mjs`, `run-machine.js`, the canonical
  `2026-09-15-issue-331-the-headless-dispatcher.md` plan,
  `docs/superpowers/metrics/issue-331.jsonl` and
  `docs/superpowers/verdicts` produced no output.

The declared-test audit found all behavioral cuts. Four declarations are not
literal runtime titles and are recorded as naming revisions rather than claimed
as exact matches: Task 5 split the combined identity and foreign-origin titles
per route, extended the cleanup-retirement title with projection refresh, and
Task 6 parameterizes malformed recovery metadata by invalid case. The tests and
their assertions were retained; no missing case is reported as a literal match.

Frontend jsdom reports its existing unimplemented canvas diagnostic while the
tests pass. No live Claude call was made. Consequently the production fixture
graph and recovery behavior are verified, but a real permission smoke remains
explicitly unverified.

## Preservation

The repair did not change the original issue plan, historical run JSON,
historical verdicts, counters, metrics, `ct-next.mjs`, `ct-step.mjs`, or
`run-machine.js`. It did not perform GitHub writes, pushes, PR actions, governed
repository actions, nested-agent work, or delivered-run mutation.

## Correction Batch

The independent review of `b26554378b437b77362699cef1d867756c559283..be6ac2758d61b95e1998bfb85fbdef6614093f15`
superseded the earlier claims that every behavioral cut and the production
recovery graph were already proven. The same Sol session corrected all ten
findings without amending those six commits.

- The actual worker entrypoint derives the configured state root from its
  validated descriptor path and publishes one typed `child-spawn-failed`
  completion before the matching receipt. The durable reader accepts only the
  closed coherent shapes and handles valid prompt-only preparation directly.
- Recovery keeps operational I/O, malformed evidence and unrelated defects
  distinct. `PlanRecovery` now retains a typed private selection, and both
  mutation routes consume one shared request model that catches only malformed
  boundary input.
- Cleanup separates pre-removal eligibility from fresh absence. It uses real
  quiet Git missing-ref semantics, validates complete porcelain, checks the
  filesystem with `lstat`, confirms remote/PR absence, checks all absence facts
  before requeue and again before archive, and keeps archive last.
- The production rehearsal now starts with an operational publication refusal,
  rebuilds recovery collaborators over the durable files, sends real HTTP
  `POST /recover-plan`, publishes once and creates one stable original-session
  implementation descriptor.
- The page blocks timer/manual GETs throughout a recovery or cleanup POST and
  performs exactly one fresh GET after the answer. Both endpoint races are
  covered with a deferred POST and timer advancement.

Correction verification retained the historical counts above as provenance.
After the post-shutdown audit, the worker/record group passed 45 tests, the
cleanup group passed 125 tests, the refusal group passed 118 tests, the real
Git/runner group passed 20 tests, the worker real-process file passed 3 tests,
the production HTTP recovery rehearsal passed, and the focused frontend group
passed 79 tests. Backend typecheck passed. The fresh full backend suite passed
110 files and 2,177 tests; the fresh full frontend suite passed 70 files and
1,350 tests; the frontend production build passed with its existing chunk-size
advisory. `git diff --check` and the protected-path comparison passed.

Three performed mutation cuts are recorded in
`pr-375-apply-feedback-corrections.md`: removing timeout classification,
changing the stable implementation request identity, and removing the frontend
mutation read barrier each failed its owning assertion before source restoration.

No live Claude call was made. The local nonexistent-binary fixture proves OS
spawn/evidence behavior, not Claude permissions. Unknown legacy evidence remains
inspect-only; resumed attributable cost remains unavailable; issue #332,
human apply and merge ownership are unchanged.

## Round 3 correction result

The finite addendum after `b23aac684f8a6fdd167d8a1b5283a9265a242d0f`
closed the remaining refusal, durability and test-integrity findings without
changing the public wire shapes or production budgets.

Cleanup now owns presence conflicts and errno reads, and lost-requeue status
reconciliation preserves operational versus malformed evidence plus both
diagnostics. Explicit stateful action cuts and rebuilt real-Git retries verify
partial work, archive-last ordering and single successful requeue. Persisted
terminal, partial-directory and planner-deadline fixtures exercise the real
readers. Normal start and HTTP recovery are separate production rehearsals, both
routes share the full request matrix, the policy helper returns `PlanRecovery`
directly, and runner teardown no longer depends on the timeout under test.

The observed R1/R2 red run failed 5 of 102 tests before the production fix; its
green rerun passed all 102. Coverage additions over already-correct behavior had
no fabricated red phase. No new mutation sweep ran, and only the three earlier
reported mutations remain mutation evidence.

Fresh verification passed backend typecheck; focused groups of 201, 47, 9 and
25 tests; the full backend suite with 110 files and 2,206 tests; the full
frontend suite with 70 files and 1,350 tests; and the frontend production build.
Node was `v25.9.0`; Git was `2.50.1 (Apple Git-155)`.

## Independent-review completion

The review of `7ee2ed0f9578ade3f31e71865423f8791219ccc7`
showed that the round-three result above overstated several verification seams.
This appendix supersedes the blanket closure at lines 153-176 while preserving
the historical report.

The completion is test-only. Real workspace, disk-record and lost-requeue errors
now flow through mounted production HTTP routing. Cleanup assertions measure
every cut's actual artifacts, snapshot, claim and exact requests, including the
distinct successful-requeue/readback failure. Named record-I/O failures preserve
bytes and unexpected identity. Four durable scenarios use real claim/status
adapters and connect cleanup state to real candidate selection and subsequent
preparation. Start and recovery fixtures are independently seeded and all
restarted supervisors drain. Planner deadline outcomes, all individual missing
fields, native numeric termination, early-abort teardown and bounded synchronous
Git complete the finite matrix.

Focused verification passed groups of 50, 79 and 30 tests. Backend typecheck and
the full backend suite with 110 files and 2,217 tests passed. The full frontend
suite with 70 files and 1,350 tests and the frontend production build passed.
`git diff --check` and the protected-path comparison passed. No new mutation or
red-first claim is made, and production unexpected failures remain HTTP 400
`request-failed`; only bare route harnesses retain their default 500 behavior.

## Round-four completion

The review of `a3854aa5312e45d966654a4115972532f7b40291`
identified three remaining test-only corrections. This appendix supersedes the
earlier complete-drain, complete-preservation and complete-consumer wording.

Every HTTP-created supervisor now has a cleanup obligation before its request.
Actual agent return marks registration and stderr settlement marks completion;
cleanup begins all finalizers, releases all waits and drains every registered
supervisor before root removal, even when one operation fails. The retained
normal two-barrier assertion is joined by a sentinel abort case that observes
both completions while the root exists. Distinct `DiskPlanRecords` regressions
for proof-write `ENOSPC` and exact existence-reader bug identity are restored.
The remaining proof-listing, immutable-readback and three archive operation
errors now cross the real HTTP consumer with exact response and state oracles;
archive attempt is distinguished from forbidden retirement. HTTP sentinel
identity is asserted with `toBe`.

Focused verification passed 103 tests across the three owning files, followed by
a 79-test API rerun. Backend typecheck and the full backend suite with 110 files
and 2,220 tests passed. The full frontend suite with 70 files and 1,350 tests and
the production build passed. No production file changed and no new mutation or
red-first result is claimed.

## Post-round-four F4 result

The review of `0ad8e0eaacf528eacc6dd8b61340373cf89f9e51` identified one remaining
test-teardown risk: a supervisor that failed before implementation acceptance
completed through stderr while its finalizer still waited only for acceptance.
Finalizers now race actual completion against readiness under the existing
one-second bound. The new fourth rehearsal refuses restarted publication before
any implementation descriptor or acceptance, then proves actual completion
while the root exists and successful teardown only after that drain. The prior
normal, recovery and sentinel-abort rehearsals remain intact.

The focused rehearsal passed 4 tests and the combined F4/N1/F1 command passed
104 tests. Backend typecheck and all 2,221 backend tests passed. The first full
frontend run had one unrelated `Home.specFreeze` visibility failure; its isolated
rerun and a fresh complete run passed, with the latter reporting 70 files and
1,350 tests. The frontend production build passed. No production file, budget,
mutation claim or red-first claim changed.
