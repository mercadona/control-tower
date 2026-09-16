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
