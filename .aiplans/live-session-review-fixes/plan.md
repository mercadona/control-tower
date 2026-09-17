# Plan: Live-session review fixes

PR: https://github.com/mercadona/control-tower/pull/413. Workspace: `.worktrees/390`, branch `feat/390`. Issues #390 and #392 were placed In Progress in Project 16 by the coordinator before this session. This is the Astra planning handoff to Sol; implementation is not included. Only this directory is edited by this planning session. No feature flags.

## Slice 1 — A1: Bounded asynchronous process ownership inspection

### Objective and evidence

Remove blocking process-table inspection from the live-session adapter while retaining exact negative-PGID signalling, child ownership evidence, fresh identity validation before each destructive signal, and confirmation requiring both PTY exit and group absence.

Inspected sources:

- `backend/src/infrastructure/pty-live-sessions.ts`: `open` scans synchronously (115–120); `terminationEvidence` scans (193); `#received` scans on every chunk (265–271); `#exited` can scan (274–287); TERM/KILL checks scan (396–437). `#inspectProcessGroup` calls `execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,lstart='])` (467–476).
- `backend/src/infrastructure/ct-api.ts:576–584` supplies no inspector, so production uses that synchronous default.
- `backend/__tests__/infrastructure/pty-live-sessions.test.ts`: `Cabin.opening` supplies an immediate map inspector, hiding subprocess cost. Existing tests cover identity replacement, delayed PTY exit, durable-write races, retries, exact groups, and verified surviving children.
- `backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts`: real TERM/KILL, independent terminals, and surviving children; the exiting-parent fixture gives its child approximately 200 ms before parent exit.
- `backend/src/application/actions/close-coordinating-session.ts`: durable intent is awaited before `terminate`; `terminationEvidence` is synchronous by domain contract. Preserve this ordering and signature.
- `docs/superpowers/specs/2026-09-17-live-session-lifecycle-design.md`: actual bounded owned-process termination, failure/retry, unrelated work preserved, and no optimistic successful closure (43–55, 81–98). Its descriptions of pre-implementation APIs are historical, not today's implementation.
- `AGENTS.md`, `backend/conventions/this-repository.md`, and `plugin/conventions/{architecture,style,testing}.md` bind this work: English, erasable TypeScript, constructor seams, outside-in assertions, and process cleanup in `afterEach`.

Read-only Darwin experiment on 2026-09-17: three asynchronous executions of the same `ps` command took 39, 30, and 32 ms; 524–527 rows, 21,484–21,607 bytes. This corroborates cost, not a production latency benchmark. Captured own-process row: `11517 11517 Thu Sep 17 22:29:08 2026    `. Use that capture's shape, with explicitly substituted IDs, for literal parser fixtures. Linux has not been exercised in this session.

### Closed design decisions

#### 1. Keep the public live-session protocol synchronous where it already is

- `open`, `watch`, `write`, `resize`, `all`, `find`, and `terminationEvidence` keep their signatures. `terminate` and `confirmTermination` remain asynchronous.
- `open` spawns, constructs retained ownership with an initially empty identity map, registers both terminal listeners, and registers an asynchronous bootstrap request before returning. It performs no synchronous process inspection. Register ownership/listeners before initiating inspection; a synchronous throw from an injected inspector must become a handled rejection.
- `#received` only updates bounded scrollback and delivers bytes. It neither requests inspection nor marks a dirty flag. One chunk and 100,000 chunks have identical inspection scheduling.
- `terminationEvidence` validates retained session ownership and builds the existing evidence value only. It does not wait, scan, or signal. Fresh inspection happens inside `terminate`, after durable intent was written.

#### 2. One shared sampler per `PtyLiveSessions` instance

Replace the optional synchronous `inspectProcessGroup` seam with optional `inspectProcessTable: (signal: AbortSignal) => Promise<string>`. It returns raw `ps` stdout; grouping/parsing remains real in adapter tests. The production default calls asynchronous `execFile`, never `execFileSync`, `spawnSync`, or a synchronous wrapper hidden inside a Promise.

Keep the sampler and its private supporting types in `pty-live-sessions.ts`: this is adapter-specific ownership machinery with one consumer, not a new public domain port. Do not introduce a dependency or a general task scheduler. `ct-api.ts` continues to use the production default.

Named production constants (not environment flags):

| Constant | Value | Meaning |
|---|---:|---|
| `INSPECTION_INTERVAL_MS` | 100 | Background delay after a completed scan, and minimum spacing between scan starts |
| `INSPECTION_TIMEOUT_MS` | 500 | Child-process execution timeout |
| `INSPECTION_REQUEST_TIMEOUT_MS` | 1500 | End-to-end fresh-request deadline, including queueing and parsing |
| `INSPECTION_MAX_BUFFER_BYTES` | 4,194,304 | Maximum stdout/stderr buffers passed to `execFile` |
| `INSPECTION_PARSE_BATCH_ROWS` | 256 | Yield between parsing batches with `setImmediate` |

Default command: `/bin/ps`, argv `['-axo', 'pid=,pgid=,lstart=']`, options `{ encoding: 'utf8', timeout: 500, killSignal: 'SIGKILL', maxBuffer: 4194304, env: { ...process.env, LC_ALL: 'C' }, signal }`. Never spawn a shell or signal the PTY to cancel an inspection. The inspection child is independent of the target group. The default retains the returned ChildProcess and settles its inspector promise only after both the exec result and child `close` event have been observed (including spawn failure). Abort can invoke an error callback before the child is reaped; that callback alone must not release the physical slot. Request deadlines reject independently of this child lifecycle.

Use a monotonic inspection clock (`performance.now`, optionally constructor-injected as `inspectionNow`) and normal cancellable timers. Keep the existing `now`/`sleep` termination seams separate: their immediate fake sleeps must not start a background busy loop. Tests use Vitest fake timers for inspection scheduling and a controlled asynchronous process-table double. No test-only public flush method.

Scheduling algorithm:

1. Maintain one active scan and one pending batch. A pending batch is a set of session-generation requests, not one queue entry per output event or per caller. Track scan sequence numbers and start times. A request arriving after a scan started goes into the next batch; it cannot consume that active scan as its fresh answer. Requests pending before the next start share that scan.
2. A scan parses the whole table once into immutable-by-convention group maps. Distribute only the relevant groups to registered ownership records. Clone retained maps; never retain a mutable map supplied by a double.
3. While any root is eligible for membership sampling, schedule one background scan 100 ms after completion. Pending bootstrap/close work can run earlier, respecting the 100 ms minimum between starts. Never use `setInterval`, overlapping scans, catch-up ticks, or a timer per session. Silent sessions are sampled too. Approximate normal cost is one system scan every 130–140 ms, shared across sessions, rather than one per output chunk.
4. At most one child exists and one future batch is queued, irrespective of session count. Pending request bookkeeping is O(number of owned sessions); duplicate termination callers use existing `owned.termination`. There is no per-caller unbounded queue.
5. Every fresh request has a 1500 ms deadline; expiry rejects its wait and removes its interest. No caller can wait forever on a hung test double or child. A stalled active scan is aborted at its execution timeout. Discard any result after abort/deadline/generation invalidation. Retain the physical child slot until the actual exec callback settles; never spawn replacements alongside an unreaped timed-out child. If an injected operation ignores abort and never settles, new requests also expire instead of launching more work.
6. Clear timers and pending membership interests when no eligible roots remain. Natural exit stops periodic sampling for that root; retain interest in an already-started anchored snapshot until its bounded completion so historical child evidence is not lost. Retained exited ownership otherwise gets on-demand close checks only. `#retire` cancels that session's interests. Shared work needed by other sessions continues. If no interest remains, abort an active child. Background timers are `unref()`ed; all completion/rejection handlers remain attached. A later `open` restarts sampling. No new server-wide shutdown API is required.

#### 3. Parse failures are not absence

Blank trailing lines are allowed. Every nonblank row must have positive safe PID, nonnegative safe PGID (system rows can have PGID zero), and a C-locale `lstart` value matching the captured five-field weekday/month/day/time/year form. Normalize surrounding whitespace; identity remains `${pid}:${normalizedStart}`. Reject malformed rows, unsafe numbers, duplicate PIDs, missing start values, and conflicting rows for the entire snapshot. A truncated/overflow/error result never contributes partial identities. Truly empty stdout is an invalid table, not proof that every process vanished.

Parse at most 256 rows before yielding so a buffer near the 4 MiB ceiling does not monopolize the event loop. Check cancellation/deadlines between batches. A successful table lacking the target PGID is a membership observation, but mark durable in-memory `groupAbsenceConfirmed` only when the existing exact `signal(-pgid, 0)` probe returns ESRCH. EPERM and unexpected probe errors are not absence. If the group is missing from the table but signal-0 says it exists, foreground inspection fails closed with `SessionNotTerminated`; background sampling retains prior evidence without learning members or confirming absence. T6 covers this disagreement as well as EPERM.

#### 4. Bootstrap and membership evidence

Each ownership record retains its object identity as a generation token, its immutable first root identity once established, its sampled member identities, and its bootstrap outcome. Root-exit observation and confirmed absence are monotonic facts.

- The first successful snapshot can anchor ownership only if it was requested after this terminal was registered, the record is still the exact retained object, no root-exit callback or confirmed absence has occurred by application time, and the root PID is present in its expected PGID. A missing root never bootstraps ownership from children alone.
- A failed or root-missing bootstrap leaves identity unestablished. It may try again on the next bounded background cycle while the root has not exited; this establishes first evidence, never restores previously revoked authority. Close can request one fresh bootstrap if the first attempt failed and the root still has no exit observation. If that request cannot establish the root, reject `SessionNotTerminated`; do not signal on `signalAuthority === true` alone.
- Once anchored, a successful snapshot containing that same root identity may learn current group members. Never overwrite the root anchor with a different start identity. Preserve the current rule that only an anchored live root can vouch for new members.
- If the root is absent, a nonempty group is verified only when **every** current PID/start identity was already recorded. Do not use `some`, PID-only matching, process names, command substrings, or positive-PID tree killing.
- An anchored-root snapshot started before the root-exit callback may still contribute child evidence after that callback, provided it contains the original root identity, the ownership object is still retained, and authority/absence has not been revoked/confirmed. This is historical membership evidence only; it never authorizes a signal without another fresh inspection. A first bootstrap completing after observed root exit is discarded.
- Background inspection failure after bootstrap keeps the last evidence and does not fabricate a successful observation. Successful mismatch retains existing conservative authority revocation. This does not re-enable an already false `signalAuthority`.

#### 5. Exit and close ordering

`#exited` must synchronously mark root exit, remove the live listing, notify watchers once, clear watchers, and log exit. Keep the cheap signal-0 absence check and its existing conservative error behavior; remove the synchronous member inspection. Identity validation for remaining members is deferred to the mandatory fresh pre-signal check. This changes when the existing check runs, not the rule granting authority. Do not initiate a detached identity check that races the close operation to change authority.

`#terminateOwned` follows this closed sequence:

1. Preserve confirmed-closure short circuits and exact session/PGID matching. Retain the one-promise-per-session close deduplication.
2. Await the already pending bootstrap, bounded by its request deadline. If needed and eligible, obtain one fresh bootstrap as above. If the root exited before bootstrap and the group is absent, existing exit-plus-absence confirmation can still succeed; otherwise unanchored ownership fails closed.
3. Obtain a **new** snapshot whose scan starts after the pre-TERM request. Apply the identity rules; immediately before sending, recheck record identity, `signalAuthority`, and `groupAbsenceConfirmed`. Make the last validation and `#send(pgid, 'SIGTERM')` part of the same synchronous continuation with no intervening `await`. `#send` itself continues to accept a positive PGID and negate it exactly once when invoking `signal`.
4. Preserve the existing TERM polling grace, using only cheap signal-0 probes and PTY-exit state. Polls do not launch process-table scans. Once absence is confirmed, no later scan can restore authority even if that PGID exists again.
5. Before KILL obtain a separate fresh snapshot requested **after** the TERM grace. Never reuse the TERM snapshot or a background cache. Revalidate and signal in the same continuation, then preserve the KILL polling grace.
6. Inspection timeout/failure rejects as `SessionNotTerminated`, retains ownership and durable requested evidence, and never emits the pending destructive signal. Clear `owned.termination` in the existing `finally`. Background failures are caught; foreground errors reach the close operation. Avoid per-chunk or periodic repeated error logging.
7. `confirmTermination` continues to require PTY exit plus ESRCH for owned groups and remains observational for unowned restart evidence. Do not add destructive signals or alter null-session retry handling.

Total wait bound: at most two bootstrap waits (pending attempt plus one eligible fresh attempt), one fresh TERM check, and one fresh KILL check: `4 * INSPECTION_REQUEST_TIMEOUT_MS + termGraceMs + killGraceMs`, plus event-loop scheduling overhead. Usually bootstrap is already complete, leaving two inspection waits. Each grace starts after its corresponding signal, preserving time afforded to the processes. Test both the normal and worst-case bound with virtual time. Real-process success paths retain their existing 1500 ms assertion; do not loosen that healthy-path oracle to the worst-case failure bound.

### Races, safety limits, and rejected shortcuts

| Case | Required decision |
|---|---|
| Output flood while a scan is pending or failing | Bytes and replay proceed; no additional inspection requests |
| Quiet child created after open | Shared periodic sampling can learn it while the anchored root exists |
| Close starts during background scan | Request the next scan, not a completed or in-flight cached answer |
| Exit during bootstrap | No initial identity adoption after observed exit; absent group can still confirm closure |
| Exit during anchored scan | Retain eligible historical member evidence; fresh close check still required |
| Retirement or replacement while scan is pending | Result cannot mutate the retired record or another session with the same PID |
| Group disappears during TERM wait, then PGID reused | Absence latch blocks KILL and later signalling for the old ownership |
| Identity replaced before TERM/KILL, including delayed exit callback | Refuse the signal even when the exit callback has not arrived |
| Two sessions close concurrently | Shared fresh batches, separate ownership validation and negative PGID signals; no cross-session cancellation |
| Failure, timeout, overflow, malformed output | No partial evidence, no false absence, no unhandled rejection, bounded close failure |
| Slow/unreaped inspection child | Keep one physical slot; callers time out rather than create a process storm |

Do not merely debounce output (misses silent children), wrap synchronous `ps` in `Promise.resolve` (still blocks), launch async `ps` per chunk (process storm), or authorize destruction from a TTL cache (stale ownership).

Safety limitation: `ps` and `kill(-pgid)` are separate kernel operations, and `lstart` has one-second precision. This plan preserves and strengthens the existing observed-identity PGID reuse checks, but cannot claim atomic immunity to reuse between observation and signal or indistinguishable same-second PID reuse. An OS ownership handle/supervisor would be a separate architecture decision. Likewise, a child created and orphaned entirely between samples cannot safely be adopted. Refuse unverified termination rather than widen the kill target. The 100 ms sampler improves quiet-child coverage but does not promise exhaustive lineage tracking. These limits must be explicit in the handoff and judgment.

### Implementation file scope and sequence for Sol

All implementation belongs to this single slice; the numbered steps below are not additional slices.

1. Add regression cases at the existing adapter/application boundaries, then implement the asynchronous table seam, parser, and shared sampler in `backend/src/infrastructure/pty-live-sessions.ts`. Remove `execFileSync`, the synchronous group inspector, and output/evidence member sampling. Keep supporting types private to this adapter.
2. Wire bootstrap, lifecycle invalidation, and fresh TERM/KILL checks as specified. Preserve domain and application signatures and durable intent ordering; `ct-api.ts` requires no wiring change because its default is the production path under test.
3. Update `backend/__tests__/infrastructure/pty-live-sessions.test.ts` mothers to emit literal raw process-table captures asynchronously, control snapshot release by session/scenario, and use fake inspection time. Existing tests that assumed `prints('child ready')` synchronously captured identities must explicitly release a bootstrap/background observation before exiting the root. Keep their outcome and signal assertions; never delete or weaken them.
4. In `backend/__tests__/infrastructure/claude-conversations.test.ts`, inject a bounded async process-table double for fake PIDs so the fast suite does not invoke real `ps` or leave a background sampler running. Use fixture teardown to emit exit/cancel timers; do the same for new PTY unit fixtures.
5. Extend `backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts` and `backend/__tests__/infrastructure/session-channel-real-process.test.ts` as below. Every child, server, stream reader, timer, and watcher is cleaned up in `afterEach`, including failures. Keep existing default-inspector real tests. No real Claude account is needed.
6. Record verification and limits in this directory's `implementation_log.md`; only mark Slice 1 complete after the required checks. Respect the session's no-commit/no-push restriction. A2 implementation is not authorized by this slice.

### Concrete regression tests and acceptance oracles

Use these exact English test names. Parameterize the listed failure/race variants where useful. Existing regression tests remain additional oracles.

| ID | Test name | Location and assertions |
|---|---|---|
| T1 | `terminal output and replay do not wait for process inspection` | PTY adapter test: hold bootstrap unresolved, deliver 100 chunks, assert both watchers get all chunks in order and replay contains them before release; advance scheduling and assert chunk count adds zero scans. Include failed inspection and buffered output after root exit. |
| T2 | `quiet sessions share bounded nonoverlapping process inspections` | PTY adapter: open 20 distinct groups; at most one active scan, one queued batch, no starts less than 100 ms apart; all roots get evidence. Create a silent child after bootstrap, release a later periodic snapshot, exit root, and successfully close that verified child only. A slow scan creates no catch-up burst. |
| T3 | `close waits for fresh ownership evidence after durable intent` | Use real `CloseCoordinatingSession` with paused `ClosureRecords` and adapter: evidence construction returns while bootstrap waits; no destructive signals before intent release; a scan already running at close request cannot authorize TERM; resolve the next valid scan, observe exact TERM target. Concurrent duplicate close calls send TERM once. |
| T4 | `pending inspection results cannot adopt exited or retired ownership` | PTY adapter: initial snapshot released after root exit does not bootstrap; a late result after retirement cannot touch replacement session with reused PID; an already-anchored pre-exit snapshot can retain original child evidence for a subsequent fresh close. No stale result restores false authority. |
| T5 | `each destructive signal requires a fresh matching process group` | PTY adapter, variants: identity replacement before TERM, between TERM and KILL, delayed root-exit callback, different child identity under same PID, and unknown member after root exit. Assert no forbidden signal; valid original child gets exact negative-group TERM then KILL. Different session remains writable. |
| T6 | `inspection failures bound closure without signalling unverified processes` | PTY adapter, variants: throw, reject, ENOENT, EPERM, timeout, maxBuffer overflow, malformed row, empty stdout, duplicate PID, invalid PID/PGID/start. Assert `SessionNotTerminated`, durable REQUESTED remains, no false CLOSED or destructive signal, no unhandled rejection; request completion within configured worst-case virtual bound. Prior anchored identity survives a transient inspection rejection; no automatic resurrection of revoked authority. |
| T7 | `retiring the last sampled root releases inspection resources` | PTY adapter: root exit/retirement clears periodic timers and pending interest; no later starts; shared scan survives one of two roots exiting; late callback after abort ignored; new session restarts sampling. Include an abort-ignoring never-settling double: requests expire and physical concurrency remains one. |
| T8 | `the default inspector executes bounded asynchronous ps and validates its output` | PTY adapter cut at `node:child_process.execFile` with Vitest module mock: omit inspector injection, assert exact binary/argv/options including signal, timeout and buffer; opening and output return before exec callback; feed captured rows plus other groups and assert only owned group signalled. Parameterize malformed output, timeout/abort late callback, buffer failure; assert parser yields between batches with a scheduled heartbeat. No real subprocess in this fast test. |
| T9 | `concurrent closes share inspection work without sharing signal authority` | PTY adapter: two closes admitted before a scan starts consume that one table; a third request after start waits for next batch; expiry/retirement of one does not cancel the other's work; mismatch in one group does not grant or revoke the other's authority. |
| T10 | `a silently sampled surviving child can be closed after its root exits` | Real-process PTY suite: parent creates child without output announcing creation; hold parent alive for at least two completed successful observations using an observation wrapper around the real async inspector, then request parent exit via input; after its exit, close and verify child and group absent, other terminal writable. Wrapper returns real table unchanged. Use explicit barriers/deadlines, not a sleep as proof of observation. |
| T11 | `HTTP and SSE progress while noisy terminal ownership is inspected` | Session-channel real-process suite: real PTY emits paced numbered chunks (100 or more) while `/sessions` requests and SSE reads overlap. Require an HTTP response and SSE frame before flood completion, exact ordered terminal data after frame reassembly, no inspector injection, and bounded test completion. Use handshake barriers rather than an absolute millisecond performance threshold. Cleanup even if response/frame never arrives. |
| T12 | `confirmed absence prevents later inspection from reviving a reused group` | Extend existing absence-during-TERM oracle with a pending valid-looking snapshot released after ESRCH and a replacement group. Assert zero KILL/retry TERM, retained original closure confirmation semantics, and replacement still writable. |

T11 is an integration happy-path oracle, not proof of production p99 latency. T1/T2/T8 deterministically prove removal of the per-chunk blocking mechanism. T10 is additional to all existing real-process tests, including the existing short exiting-parent fixture; do not extend that fixture's 200 ms delay to conceal a regression.

### Exact verification commands

Run from `backend/` (tool workdir, not repository root), in this order:

```sh
npm run typecheck
npx vitest run __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/claude-conversations.test.ts __tests__/application/close-coordinating-session.test.ts
npx vitest run --exclude '**/*-real-process.test.ts'
npx vitest run __tests__/infrastructure/pty-live-sessions-real-process.test.ts __tests__/infrastructure/session-channel-real-process.test.ts
npm test
```

From the repository root, inspect intended changes and whitespace:

```sh
git diff --check
git status --short --branch
git diff -- backend/src/infrastructure/pty-live-sessions.ts backend/__tests__/infrastructure/pty-live-sessions.test.ts backend/__tests__/infrastructure/claude-conversations.test.ts backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts backend/__tests__/infrastructure/session-channel-real-process.test.ts
```

There is no backend lint/build script in `backend/package.json`; typecheck and the declared suites are the required backend checks. No frontend verification is required for A1-only code. Run the real-process commands on Darwin and Linux before claiming both are supported; record an unavailable platform honestly, not as a pass. A refusing hook/control is a stop-and-report finding, never a reason to bypass it.

New assertions must demonstrate the intended red-to-green behavior. Repository mutation sweeps require a committed clean tree first, while this session prohibits commits; record that constraint and defer the manual mutation sweep until a coordinator supplies an authorized clean checkpoint. Do not create a commit to satisfy that prerequisite. Suggested subsequent sensitivity checks: restore scan-on-output (T1/T2/T8), reuse active scan for TERM (T3), omit KILL freshness (T5), drop generation guard (T4), accept partial/empty output as absence (T6/T8), remove timeout cleanup (T7), restore authority after ESRCH (T12).

### Acceptance and risk review

Sol must deliver all T1–T12, preserve existing test outcomes, and report actual command results. Review code specifically at bootstrap acceptance, snapshot request/start ordering, pre-signal continuations, deadline cleanup, and negative-PGID targeting. All new code paths, including the uninjected production default, need executable evidence. No green suite should be described as proving atomic process ownership.

Background load becomes bounded but nonzero for quiet sessions. The fixed 4 MiB ceiling deliberately makes oversized tables an explicit failure, not a partial ownership view. Inspection deadlines add bounded cancellation latency beyond process grace periods. CPU starvation elsewhere can delay all JavaScript deadlines; this plan removes A1's synchronous scan source, not every source of event-loop delay. Sampling cannot guarantee children whose entire parent overlap fits between observations. These are review reservations, not permission to weaken safety or hide a failing inherited real-process test.

## Slice 2 — A2: Pending separate Astra planning session

Status: pending. No implementation decisions or tests are approved for this slice yet.

The separate Astra session will inspect and plan A2's irreversible loss of `signalAuthority`, close-failed state blocking eligible current-work gates, and restart retries with null sessions and reused PGIDs. It must reconcile its design with Slice 1's asynchronous inspection contract before Sol edits shared files. This plan does not authorize recovery of revoked authority, frontend gate changes, or altered restart/null-session retry semantics. Sequential ownership of `pty-live-sessions.ts` is required; do not implement both slices concurrently.
