# PTY validation findings during the in-process migration

Date: 2026-09-18. Branch: `feat/418-in-process-command-tests`, based on `c67db23c`.

## Finding

The native PTY failures are intermittent and strongly associated with host contention. They do not require the CtApi refactor to fail: the native suite imports `PtyLiveSessions` directly, and its production dependency graph has not changed. The exact five-file verification that originally failed subsequently passed all 54 cases before any PTY fixture change. This is evidence against a deterministic CtApi wiring regression, not evidence that repeated runs are an acceptable substitute for a reliable gate.

There are two separate timing mechanisms:

1. `Printed.until` allows 3000 ms for terminal output. The old fixtures launched the developer's configured login shell with the entire inherited environment. Startup files therefore participated in a test about PTY output, input and resizing. Before adjustment the first test took 2809 ms in isolation and 2745 ms in the passing combined run, close to its output deadline.
2. `PtyLiveSessions.INSPECTION_TIMEOUT_MS` is **500 ms in production**, covering the process-table operation and parsing. Failure to establish fresh ownership is a real refusal to signal an unverified process group. Increasing Vitest's test timeout cannot fix that refusal.

The parent-exit fixtures also contained a separate scheduling race: `EXITING_PARENT` exited 200 ms after its child announced readiness, regardless of whether bootstrap/preparation had captured both identities. A slow inspection could therefore encounter an already-exited root before the test's intended ownership precondition existed. The original failed run did not retain its process-table snapshots, so its exact missing identity cannot be reconstructed retrospectively.

## Host observations

- 10 physical/logical CPUs, 16 GiB memory.
- Load averages observed between 28 and 55 while investigating.
- Sample at 13:16: 0.52% CPU idle, approximately 15 GiB used, 11 GiB wired, 148 MiB unused.
- Sample at 13:17: 8131 swap-ins and 11756 swap-outs during the one-second sampling interval.
- Another worktree (`.worktrees/332`) was running real-process tests. Several other agent/application processes were active. None was stopped or modified.
- Eight sequential invocations of the same `/bin/ps -axo pid=,pgid=,lstart=` command took **171, 217, 183, 408, 399, 314, 495 and 274 ms**, returning 643–660 process rows. All eight commands succeeded. The 495 ms sample leaves almost no room inside the adapter's 500 ms overall bound for its parsing/yield phases.

## Fixture corrections

Only `backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts` changes for this investigation:

- The three shell/terminal mechanism cases use a real `/bin/sh -i` and a minimal PATH, independent of user login startup files. Configured-shell selection and login argv remain asserted in `pty-live-sessions.test.ts`.
- Parent-exit scenarios send an explicit stdin exit request at the required cut point instead of using the 200 ms timer.
- Each parent/child scenario asserts that the real checkpoint contains both identities before requesting the parent exit.
- The durable-intent scenario establishes that ownership before pausing the write, and releases its write barrier in `finally`. The action deliberately writes initial intent before `prepareTermination`; expecting that first write to contain a prepared checkpoint without arranging one was incorrect.

All original outcome assertions remain. No test is excluded, no retry is added, and no test or production timeout is increased. `backend/src/infrastructure/pty-live-sessions.ts` has no diff.

## Verification history

All commands run in `backend/` under Node `v24.21.0`, with the default Vitest parallelism and existing timeout settings.

| Run | Result | Meaning |
|---|---|---|
| Unchanged native suite alone, 13:16 | 10/10 passed, 9.49 s test duration | Original failures are not deterministic. |
| Original five-file selection, 13:17 | 54/54 passed, 16.65 s elapsed | CtApi composition, executable edges, plan events, native PTYs and detached calls pass together before fixture changes. |
| Six-file selection including PTY unit suite, 13:22 | 124 passed, 7 failed | Six native cases encountered the production inspection bound; one new fixture precondition exposed the initial-intent ordering mistake described above. The 77 PTY unit cases and new CtApi cases passed. |
| Corrected native fixtures alone, 13:24 | 10/10 passed, 7.74 s test duration | The explicit-exit and isolated-shell fixtures preserve the real mechanism scenarios. |

Typecheck passed before the six-file selection; whitespace validation passed. The initial-intent fixture was then corrected and the complete native file passed, rather than dropping the additional ownership assertion.

## Remaining verification condition

The fixture races are addressed, but a host where a real ownership inspection exceeds 500 ms can still make the native success cases fail. That is the adapter refusing unverifiable termination as designed, not a reason to weaken its identity checks. A clean combined/full-backend run under representative host load is still required before marking Slice 2 complete. The passing isolated native run is diagnostic evidence, not a replacement for that integrated check.

### Integrated verification completed

At 13:47 the one-minute host load had fallen to 10.37. The complete backend suite, with default parallelism and unchanged timeouts, passed **2397/2397 cases, zero skipped**. Its summed file duration was **89.228 s**, with an observed report span of **22.155 s**. The API family accounts for **27 cases across two files and 5.286 s**, against **19 cases / 42.290 s** in the valid baseline. This full run clears the integration blocker; the earlier failed runs remain part of the evidence above.
