# PR 375 corrective brief and evidence

Date: 2026-09-16

Reviewed tip: `be6ac2758d61b95e1998bfb85fbdef6614093f15`

Repair base: `b26554378b437b77362699cef1d867756c559283`

This artifact records the post-review correction applied by the same Sol
session. The authoritative review, amended plan and full corrective brief are
retained under `.agent/run-331/`; this permanent evidence summarizes the closed
correction contract and its observed verification.

## Corrections

- Every headless purpose has an adjacent literal `--allowedTools` grant and its
  original session or resume identity.
- The worker validates the absolute descriptor tuple, derives the configured
  state root from it, and publishes `child-spawn-failed` terminal evidence before
  its matching receipt. Completion or receipt publication failure grants no
  cleanup, and post-spawn errors remain ordinary failures.
- The durable reader accepts only the closed non-launch shapes. It checks output
  and terminal evidence before accepting an absent descriptor, supports an
  allocated but absent pre-worker directory, and bypasses strict history only
  after proof validation.
- Record adapters translate errno-shaped I/O failures while malformed data and
  unrelated implementation defects remain distinct.
- Cleanup separates removal eligibility from fresh absence. It uses Git's quiet
  missing-ref query, complete worktree porcelain, `lstat`, remote branch and PR
  checks before requeue and again before archive.
- `PlanRecovery` retains one typed private selection. Shared request parsing is
  outside either route and only its malformed boundary error becomes HTTP 400.
- The production rehearsal rebuilds collaborators after publication refusal,
  sends real HTTP recovery twice, publishes once, creates one stable resumed
  implementation call, and reads its fixture terminal result.
- The frontend blocks polling and manual reads during mutation, then performs a
  fresh read after accepted, refused or network-unknown outcomes.
- `ToolRunner` preserves genuinely empty stderr only for ordinary integer exits.
  Killed, timed-out or signalled outcomes retain a diagnostic even when the
  child's handler exits with an integer code.

## Mutation Observations

1. Replaced the runner's ordinary-exit predicate with numeric-code-only and ran
   `npm --prefix backend test -- __tests__/infrastructure/tool-runner-real-process.test.ts`.
   `timeout exits keep a diagnostic even when the child exits numerically`
   failed because stderr was empty. The killed/signal predicate was restored and
   the same 11-test file passed.
2. Changed the continuation request ID to
   `implementation:mutated-<planner-call-id>` and ran
   `npm --prefix backend test -- __tests__/infrastructure/headless-dispatch-dry-run.test.ts`.
   The exact descriptor request-ID assertion failed. The stable original identity
   was restored and the rehearsal passed.
3. Removed the mutation read barrier and ran
   `npm --prefix frontend test -- src/pages/home/__tests__/Home.restoreWorkflow.test.tsx -t "polling during"`.
   Both recovery and cleanup cases observed an impermissible GET during POST and
   failed. The barrier was restored and both cases passed.

## Verification

- Backend typecheck passed.
- Full backend suite passed: 110 files, 2,177 tests.
- Focused worker process suite passed: 3 tests. The local executable was the
  running Node binary; the spawn-failure executable was an absolute nonexistent
  path under each temporary fixture root. No Claude process or network call ran.
- Focused real Git/runner suite passed: 3 files, 20 tests. Local Git performed
  worktree/ref/filesystem operations; repository, remote, PR and claim edges
  remained scripted and made no GitHub request.
- Full frontend suite passed: 70 files, 1,350 tests. Existing jsdom canvas
  diagnostics remained visible and non-failing.
- Frontend production build passed with the existing chunk-size advisory.
- `git diff --check` and the exact protected-path comparison passed.

The process fixture permits a 30-second success budget, a 10-second deadline
budget and a nominal 20-second descendant-disappearance observation window.
It still asserts non-success, `SIGTERM`, wall duration of at least 10 seconds and
descendant disappearance. It does not prove an exact 100 ms escalation time.
Production timeout, grace, acceptance and polling values are unchanged.

No live Claude call, GitHub mutation, push, governed-repository action, nested
agent, Orca action or delivered-run mutation occurred. Live Claude permission,
commit and READY behavior remain unverified. Ambiguous legacy evidence remains
inspect-only; resumed attributable cost, issue #332, human apply and merge remain
outside this correction.

## Round-three closure

Source before this batch was
`b23aac684f8a6fdd167d8a1b5283a9265a242d0f`. The following observations are
from 2026-09-16 on Node `v25.9.0` and Git `2.50.1 (Apple Git-155)`.

| Group | Observed closure |
|---|---|
| Cleanup causes | Registration, branch and path presence now produce `PlanCleanupConflict`. Seed and `lstat` errno failures produce `PlanCleanupNotRead`; malformed evidence remains unreadable and sentinel `TypeError` objects escape unchanged. |
| Lost requeue | Only exact `PlanStatusNotRead` and `PlanStatusNotUnderstood` are converted. Both diagnostics use `checked requeue failed: ...; status read failed: ...`; unrelated errors retain object identity. |
| Cleanup cuts | The application fixture now holds explicit claim/artifact state. Proof, initial status, inspection, snapshot, worktree, branch, first absence, release-status, pre-effect requeue, post-effect readback, reappearance and archive retry cases assert retained active evidence and actual claim state. |
| Durable cleanup | Real local Git and `DiskPlanRecords` cover full retirement, branch-removal retry, checked-requeue retry, archive-rename retry and an invalid checkout. Each retry rebuilds records, workspace and action over the same roots; descriptor, proof and snapshot bytes survive until retirement, and successful requeue occurs once. |
| Evidence readers | A valid persisted child-spawn fixture is changed one field at a time for identity, diagnostic, timestamp, exit, signal, measurement, missing terminal, resume mode, generic/unavailable/success terminal and stream contradictions. Real partial directories and persisted planner deadline-minus-one/exact/plus-one cases allocate no replacement identity. |
| Rehearsals and boundaries | Successful normal start and publication recovery are independent production graphs. Both mounted plan-operation routes share the complete invalid-body matrix and send unexpected parser defects to production HTTP 400 `request-failed`. `PlanRecovery`'s execution helper returns the policy value directly. |
| Process teardown | The runner fixture partially wraps native `execFile`, records returned child handles immediately, and uses one async SIGKILL/close helper in the early-abort assertion and `afterEach`. Missing/already-exited handles are not signalled; only `ESRCH` is tolerated. |

The first focused red run had 5 failures and 97 passes. Those failures were the
R1/R2 regression observations: three lost-requeue category/identity assertions,
one cleanup presence category assertion and one seed errno assertion. The same
two files then passed 102 tests after the narrow production changes. Other
round-three tests were coverage additions over already-correct behavior and are
reported as green additions, not invented red phases.

No new mutation sweep ran. The three round-two mutation observations above are
retained as reported provenance. Historical pre-restoration source hashes,
elapsed timings and other unperformed mutations remain unavailable.

Round-three focused results:

- Backend typecheck passed.
- Cleanup/API set: 5 files, 201 tests passed.
- Record/policy set: 4 files, 47 tests passed.
- Rehearsal/route set: 2 files, 9 tests passed.
- Real Git/candidate/runner set: 3 files, 25 tests passed.
- Full backend: 110 files, 2,206 tests passed.
- Full frontend: 70 files, 1,350 tests passed; existing jsdom canvas diagnostics remained non-failing.
- Frontend production build passed with the existing chunk-size advisory.

Production unexpected errors remain HTTP 400 `request-failed` with stderr
diagnostics. Bare route-only Express harnesses retain their default 500 behavior.
No live Claude call, network mutation, GitHub write, push, governed-repository
action, nested agent, Orca action or delivered-run mutation occurred.
