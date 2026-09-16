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
