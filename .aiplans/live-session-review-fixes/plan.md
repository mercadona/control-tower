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

## Slice 2 — A2: Evidence-based closure retries and current-work eligibility

### Objective and inspected baseline

A1 is accepted at `83304d9d`. This is a closed implementation handoff, not an implementation or a claim of passing tests. Preserve the Slice 1 text and review log as history; the explicit amendments below govern A2. One implementer owns this slice and the shared adapter sequentially.

Read the full A1 adapter, close/recover actions, live-session port, closure value, disk records, registry, close/target/groom routes, startup recovery projection, frontend lifecycle hook and gate panel, and application closure/recovery tests. Also read the lifecycle spec, repository/backend instructions, glossary, and architecture/style/testing conventions. Concrete defects in the accepted baseline:

- `PtyLiveSessions.#exited` revokes authority on any probe error; successful member mismatches also revoke it forever. `#terminateOwned` then waits the combined grace without ever requesting new identity evidence. A transient failure and an actual group replacement have the same terminal state.
- `SessionClosure`/version-1 `closure.json` retain only session and PGID, discarding the anchored identities. Unowned `confirmTermination` knows only ESRCH. `CloseCoordinatingSession.execute` refuses termination retries when the request's session is null, exactly the state startup installs after an interrupted cancellation.
- `CoordinatingSessions.reserve` correctly blocks new sessions during unconfirmed closure. The defect is never reaching truthful completion, not that reservation. `CoordinatingSessionTarget.admitted` and frontend `operationBusy` additionally reject eligible current work during `close-failed`, contrary to spec lines 37–39.
- `/groom-session` opens a new terminal and must remain reserved; `/epic-groom` executes current work and must retain its own eligibility. They are different operations despite the shared word.

### Closed ownership and liveness decisions

#### 1. Classify evidence; do not latch uncertainty as permanent loss

Remove the global irreversible `signalAuthority` boolean. Retain the generation guard and a monotonic `originalGroupGone` fact. Signal permission is a result of each fresh bounded observation, never a reusable boolean. Internally distinguish **verified original members**, **original group gone**, and **unconfirmed**; errors are unconfirmed, not identity replacement. Keep this adapter-specific classification in `pty-live-sessions.ts`.

| Fresh observation | Decision |
|---|---|
| Exact negative-PGID signal-0 returns ESRCH | Latch original group gone; never signal this ownership again |
| Whole valid table contains PID equal to the original PGID with a different start identity from the anchored leader | The original group incarnation is gone; latch that fact and never signal the replacement, even if signal-0 says a group exists |
| Original leader identity still present in its original group | In-memory anchored root may vouch for members under A1's learning rules; before signalling, every current member must also be in the durable checkpoint described below |
| Leader absent, nonempty group, every member matches a retained original PID/start identity | Safe retry of that exact original group; never learn members from this leaderless observation |
| Unknown member, changed child identity, original leader observed in an unexpected group, or group missing in table but probe says present | Unconfirmed; no destructive signal and no closure; retain original evidence for another attempt |
| Inspection reject/timeout/invalid table, or probe EPERM/other error | Retryable uncertainty; preserve anchors and prior identities, emit no pending signal, never assert absence |

The replacement proof is deliberately narrow: on supported POSIX hosts a PID cannot be allocated anew while that numeric ID remains an extant process-group ID. Seeing a **different process at the original leader PID** proves the old group ceased to exist. Inspect the entire table, including that PID when its current PGID differs. Do not infer this proof from a changed child, an unknown member, a missing root, or disappearance of all sampled members. Those observations cannot exclude an unsampled surviving child. The original terminal must have been spawned as group leader (`root PID == PGID`), as the existing node-pty contract assumes; bootstrap must verify this before recording an anchor. This is same-host/same-PID-namespace evidence, not a portable receipt that authorizes signals on another machine.

Proof reference checked during planning: [POSIX.1-2024 fork DESCRIPTION](https://pubs.opengroup.org/onlinepubs/9799919799/functions/fork.html): “The child process ID also shall not match any active process group ID.” A probe error alone supplies no extinction proof; independently valid leader-replacement evidence can still supply it. Never treat incomplete/unparseable process-table output as that evidence.

Identity replacement is permanent for the **replaced identity**, not a reason to poison the remaining original ownership. A later valid snapshot can authorize the still-original group after transient errors or an unknown member disappearing. It cannot replace the original leader anchor or resurrect a gone group. Retain A1's immutable per-PID member identity rule: a conflicting child identity is not overwritten. Historical background results cannot grant signal permission.

For a retained PTY, ordinary absence still requires its exit callback plus ESRCH. Leader-replacement proof independently proves both original leader death and original group extinction and may finish closure without waiting for a delayed PTY callback. Retire that generation, end/clear its watchers exactly once, and ignore subsequent callbacks/output for it. After restart there is no PTY callback to await: ESRCH or the narrow leader-replacement proof confirms extinction. Neither path claims to terminate escaped descendants outside the owned group; that remains outside the existing contract.

Fail immediately after bounded inspection when ownership is unconfirmed; do not spend four seconds polling a state to which no signal was sent. TERM/KILL grace applies only after the corresponding signal. Retry always makes a new observation; no automatic retry loop. Permission denial remains a real possible failure, not a promise that another click will terminate it.

#### 2. Persist original identity evidence, not a newly observed replacement

Add `SessionProcessOwnership` in `backend/src/domain/value-objects/session-process-ownership.ts`: immutable original leader identity and immutable member entries `{ pid, identity }`, using A1's normalized `${pid}:${lstart}` identities. It has application/persistence consumers, so merits a domain value module. `SessionClosure.ownership` is this value or null, defaulting to null for old callers; `closed()` preserves it. Validate positive safe unique PIDs, nonempty canonical identities matching their PID, and an entry for the leader PID matching the immutable root identity. Bind the leader PID to `processGroup` in `SessionClosure`; ownership is forbidden for a null session/group. No command names, user-entered PID, or process-title matching.

Write version **2** closure JSON with exactly the v1 keys plus `ownership`. Its literal shape is:

```json
{"version":2,"conversation":"2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f","target":"6d13bc52-740f-49f8-b128-15e597674f3a","session":"terminal-1","processGroup":4102,"status":"requested","ownership":{"rootIdentity":"4102:Thu Sep 17 22:29:08 2026","members":[{"pid":4102,"identity":"4102:Thu Sep 17 22:29:08 2026"}]}}
```

`ownership: null` explicitly means insufficient durable identity, not permission to adopt the current group. Reader accepts exact v1 shape as ownership-null and exact v2 shape; rejects unknown versions/extra keys/malformed nested evidence, duplicate members and leader contradictions. Sort member entries by PID on write. Keep the original directory, filename, status values and conversation/target/session/PGID binding. Existing v1 CLOSED records remain closed without probing or migration; no bulk rewrite. Downgrade to A1 cannot read v2 and must fail closed; document that compatibility limit.

Extend existing `ConversationRecords.requestClosure` semantics to allow monotonic enrichment of a matching REQUESTED record: null ownership to vouched ownership, or addition of previously absent member PIDs with the same root and all old entries unchanged. Conflicting/removed identities, changed target/session/PGID, and CLOSED-to-REQUESTED transitions are refused. Equal requests are idempotent. Completion requires the exact latest checkpoint, not merely equal PGID. Preserve `Disk.atomicWrite` production wiring; do not replace it with an in-place write. This protects process-crash publication as today, not a new power-loss/fsync guarantee.

Keep synchronous `terminationEvidence` scan-free: copy whatever identities are already retained, including an anchor whose group was subsequently replaced. Add `LiveSessions.prepareTermination(closure): Promise<SessionClosure>` for bounded bootstrap/observation and **non-destructive** checkpoint enrichment. Application sequence:

1. Recall and match durable target. CLOSED remains idempotent. A first request creates scan-free evidence and awaits `requestClosure` before preparation or signals.
2. For a retry, first attempt observational `confirmTermination`; on success go directly to completion. On `SessionTerminationUnconfirmed`, proceed regardless of `params.session === null`.
3. Await `prepareTermination`, then await `requestClosure(prepared)` even when enrichment is a no-op. Only a retained original ownership generation may enrich evidence. An unowned restart attempt returns the same durable checkpoint, never invents or enriches it from the current table.
4. Call `terminate(prepared)`. Its fresh TERM/KILL snapshots must start after checkpoint persistence. No current member absent from that checkpoint may be signalled, even if the background sampler learned it during the write. Refuse this attempt; the next explicit retry can checkpoint safely learned members. Do not add a disk callback to the sampler or write on every scan.
5. After confirmed termination, await `completeClosure(prepared.closed())`, then acknowledge and clear registry/UI. Completion failure retains intent and in-memory confirmed evidence; retry does not send another signal.

Preparation uses A1's pending-bootstrap plus one eligible fresh-bootstrap limit, then at most one fresh membership request. A valid observation unable to establish a root returns existing evidence (possibly null); termination still gets an absence/replacement observation before refusing unanchored destruction. A failed fresh inspection instead rejects this attempt, preserving its durable intent. This permits an exited, unanchored group to close once ESRCH is actually observed rather than becoming permanently stuck before the probe. Termination does not restart the preparation/bootstrap sequence. A first request with no terminal and no recorded group still closes the already-ended session as today; a retry with a null **request** session must never erase a **recorded** session/group.

#### 3. Restart retries act on the durable original identity

`RecoverCoordinatingSession` stays observational: it may confirm and complete pending closure, but never resumes or signals it. Unconfirmed evidence installs the same retained conversation and target in `close-failed`, with no terminal. Keep `ct-api.ts` recovery projection and close-route use of `held.terminal`; no fake `LiveSession`, PTY spawning, watch registration, or terminal listing for recovered ownership.

Explicit retry invokes the same close action using the recorded closure. Extend `PtyLiveSessions.terminate` to support a record not in `#owned`: create/cache a private recovery ownership context keyed by the full conversation/target/session/PGID identity, with the **persisted** root/member anchors. It has no terminal and no periodic sampler interest. Use the existing shared asynchronous sampler for on-demand whole-table observations; generalize its target to retained or recovered ownership rather than launching a second inspector. Keep one physical child, bounded requests, per-generation invalidation, and one termination promise per identity. Do not overwrite a currently retained different ownership with the same session ID or PGID; refuse a conflict before any signal.

Bind a retained generation to its full closure identity when `terminationEvidence` first constructs its receipt; later prepare/terminate/confirm calls must match that binding and compatible original anchors. Recovered contexts accept only matching immutable checkpoints, with confirmed caches keyed by the same full identity. Add this conflict variant to A2-4: another target's receipt cannot borrow a live generation merely by naming its session ID/PGID. Clear recovered sampling interests on failure/completion; retain only bounded-per-closure identity/confirmation state needed for a later explicit retry, never periodic recovery work.

Unowned retries may signal only a nonempty group whose **every** current member matches the durable checkpoint. Even an original live leader does not authorize adopting new children after restart. New evidence can prove extinction or validate the saved ownership; it cannot create ownership. Revalidate separately immediately before TERM and KILL, in the same synchronous continuation as the exact negative-group signal. Signal-0 errors cannot revoke the immutable checkpoint. `confirmTermination` remains non-destructive and uses the same extinction rules, not a call to `terminate` in disguise.

Retain monotonic extinction/confirmation in memory across completion-write retries. An in-flight snapshot or later matching-looking group never revives it. No restart recovery can retain proof that was never durably published: a crash after observing ESRCH but before completion may require a new proof. A still-visible replacement leader with a saved original anchor supplies that proof; a leaderless unknown group does not. Do not disguise the latter as successful closure.

#### 4. Legacy and unavoidable limits have an operable, honest route

Version-1 REQUESTED or v2 ownership-null with no retained owner is **confirmation-only**. Retry always probes again; ESRCH completes it. A matching retained in-memory owner may enrich a legacy record; a restart may not bootstrap ownership from its bare PGID. With no anchor, a different-looking current process is not proof of replacement.

Add `SessionOwnershipUnverifiable` and `SessionTerminationPermissionDenied` to `exceptions.ts`, mapped by the close route to `session-ownership-unverifiable` and `session-termination-permission-denied` (400, existing `{code, detail}` shape). The former covers legacy identity gaps and unknown members; the latter covers signal/probe EPERM or EACCES. Both carry an English diagnostic with target/session/PGID and the reason, never an executable kill command. Inspection errors retain existing termination error codes. Startup unconfirmed failures preserve these subclasses/codes instead of collapsing them in `ct-api.ts`; both can extend `SessionTerminationUnconfirmed` so recovery's existing catch remains effective.

Spanish product copy in `frontend/src/app/product-error.ts` must distinguish: temporary inspection failure (retry), permission denial (resolve OS permissions or end the original session through its owner, then retry), and insufficient original identity (automatic termination is unavailable; close the original terminal if available, otherwise have its owner establish that it ended, then retry verification). Explain that new sessions stay blocked until verification. Preserve the target and a usable `Cerrar sesión` retry for null-terminal recovery; do not suggest deleting `closure.json` or restarting the backend as a cure.

Operational route for unanchored records: original owner ends its known session, or the operator waits for the current numeric group to cease naturally; retry must observe ESRCH. If a reused unrelated group persists, do not kill it to clear this record. A host maintenance restart that removes all old processes, followed by verification while the PGID is absent, is a last-resort external route, not an automatic application action. There is **no guaranteed immediate application-only escape** for legacy records or leaderless unknown groups: the needed historical proof was never saved. Keep current-work gates operable meanwhile. This irreducible restriction is not solved by an abandon/forget endpoint or a checkbox claiming termination.

The new format fixes the common anchored-reuse case; it does not promise every reuse is observable after its new leader exits. The A1 one-second `lstart` collision limit, non-atomic ps/kill window, invisible/missing kernel data, children entirely between samples, and kernel permission denial remain explicit. Stronger guarantees require an OS ownership handle/supervisor and are not part of this bounded change.

#### 5. Separate opening reservation from current-work gates

- Keep `reserve()` and frontend `blocksOpening` unchanged for `closing` and `close-failed`: a new plan and `/groom-session` stay blocked until durable confirmed completion. Do not fix liveness by allowing a second coordinating session.
- In `CoordinatingSessionTarget.admitted`, accept a matching retained target in `IDLE` **or `CLOSE_FAILED`**. Continue to reject `OPENING`, `RECOVERING`, and active `CLOSING`; this short in-flight exclusion avoids dispatching a mutation while its target is being removed. No target/key/spec eligibility is bypassed. After a failure, freeze, groom execution, promotion, and reslicing again apply their own checks, including for recovered ended targets.
- Remove only `operation === 'close-failed'` from frontend `operationBusy`. Existing in-flight opening/closing/recovery controls remain. `EpicGroomPanel`, `useGatePresses`, and `useMergedReslicing` must then allow eligible existing-work actions while `openingBlocked` still blocks opening the groom terminal. Freeze already has separate UI eligibility; exercise it through Home and backend so the two sides agree.
- Keep `stillCurrent` protections after awaited reads. A gate admitted before cancellation may finish its existing side effect; its old result must not replace a new target's UI/registry. Do not introduce a global gate lock or cancel headless work. Existing gate-specific pending/deduplication and stale-result rules remain the authority.
- Successful close alone clears the held target/timeline/error and enables opening; late reads/old close acknowledgements cannot clear a newer target. Closure must leave unrelated terminal input, headless calls, repository files, branch/worktree state, and GitHub issues untouched.

### Explicit amendments to A1 (history remains unchanged)

| A1 invariant/test expectation | A2 replacement |
|---|---|
| Sections 4–5: false `signalAuthority` never recovers; T4/T6 and round-2 R2a retry stay REQUESTED forever | Remove that boolean. Uncertainty can be retried against unchanged original anchors; actual group extinction remains irreversible. Rewrite the identity-revoked retry oracle to discriminate child mismatch/transient error from leader replacement, and assert zero signals to replacements. This is an intentional contract change, not weakening a safety assertion. |
| Confirmation always needs retained PTY exit plus numeric PGID ESRCH | Preserve that normal path; add original-leader replacement proof, and observational extinction without a PTY after restart. Retain the delayed-callback oracle on the ESRCH-only path. |
| `confirmTermination` is ESRCH-only for unowned records; null-session retries unchanged | Confirm may inspect persisted identities; explicit retry may terminate fully matched saved members without a live terminal. Startup itself stays observational. |
| Public port signatures unchanged | Existing signatures remain; add async `prepareTermination`. `terminationEvidence` remains synchronous/scan-free. |
| A1 may learn members during fresh pre-signal validation | Learning still requires retained anchored ownership, but all signalled members must have been checkpointed before the fresh check. No unpersisted member grants restart authority. |
| T5: any changed root makes closure fail | A changed **leader PID identity** proves the old group gone and allows truthful closure without signalling the replacement. Changed child/unknown member remains unconfirmed. |
| T12: confirmed absence never resurrects | Preserve and extend to proven incarnation replacement and recovered ownership. |

A1's output hot path, shared scheduling constants, strict parser, physical-child reap discipline, bounded requests, TERM/KILL freshness, unrelated-target isolation, and healthy real-process oracles are unchanged. New worst-case first-close inspection budget: pending bootstrap + one bootstrap retry + one preparation membership check + TERM check + KILL check = `5 * INSPECTION_REQUEST_TIMEOUT_MS + termGraceMs + killGraceMs`, plus event-loop scheduling. A retry adds at most one confirmation inspection first: `6 * INSPECTION_REQUEST_TIMEOUT_MS + termGraceMs + killGraceMs`. Durable I/O time is separate, as before. Uncertainty refusal does not consume unsent-signal grace.

### Implementation file scope and order

All work is one cohesive Slice 2; these are implementation steps, not separately dispatched slices.

1. Application regressions first: `backend/__tests__/application/close-coordinating-session.test.ts` and `recover-coordinating-session.test.ts`; add the ownership value and extend `session-closure.ts`, `domain/ports/live-sessions.ts`, `domain/ports/conversation-records.ts`, close action and error catalogue. Keep recovery action observational; adjust typed failure handling only as needed.
2. Persistence: `backend/src/infrastructure/disk-conversation-records.ts` and its existing test; exact v1/v2 reader, monotonic checkpoints, preserved atomic writer. Update startup error projection in `ct-api.ts` and close error projection in `coordinating-session-close-route.ts`.
3. Adapter: `backend/src/infrastructure/pty-live-sessions.ts`, its fast tests and existing real-process tests. Reuse the sampler for full-table on-demand recovery, retaining A1 bounds; keep recovered ownership private and unlisted. Update affected test mothers/doubles in existing suites for the new preparation port. No new scheduler, daemon, dependency, persistence per output event, or general-purpose recovery framework.
4. Eligibility and UX: `backend/src/infrastructure/coordinating-session-target.ts`; frontend `src/app/coordinating-session/useCoordinatingSession.ts` and `src/app/product-error.ts`. Existing registry, Home, panel and gate hooks need tests, not a new state model. Only edit them if wiring the specified semantics actually requires it; do not rename unrelated domain vocabulary.
5. Regression/verification and this directory's log. Preserve A1 history and identify amended assertions by the table above. The implementer reports actual red-to-green and command evidence; do not mark this slice complete on planning alone. No flags, delegation, Orca, commits, pushes, or control bypass.

### Decisive regression assertions

Use these exact English names; extend existing suites/mothers. This is a small set of causal scenarios, not a Cartesian matrix. Refusals are tested at their owning layer, application ports doubled, HTTP use cases doubled, and real-process integration is happy-path only. Do not replace an API/application assertion with private-field assertions.

| ID | Test name | Boundary and decisive assertion |
|---|---|---|
| A2-1 | `closure checkpoints original ownership before signals and completion before acknowledgement` | Close application suite: cut initial intent, preparation/checkpoint write, termination, and completion separately. No terminate before both writes; no success before completion. Failed checkpoint keeps the original request and sends nothing; failed completion retries confirmation without a second terminate. Mismatched conversation/target refuses before any mutation; null request session retains recorded PGID. |
| A2-2 | `a failed inspection or exit probe does not poison a later owned close` | PTY fast suite through close action: establish root+child, inject exit-time EPERM and separately a fresh inspection rejection, then restore a table matching the original child and permit probes. First attempt fails truthfully; second sends exact negative-PGID TERM, confirms and persists CLOSED. Child mismatch/unknown member refuses without an unsent four-second grace; removing that member permits a fresh retry. Preserve unrelated writable terminal. |
| A2-3 | `a replaced leader confirms only the old group without signalling its replacement` | PTY fast suite, retained and fresh-adapter durable cases: saved original leader; table contains different identity at leader PID (also variant where its current PGID differs). Probe reports present. Close succeeds, zero TERM/KILL to replacement, original completion only. Late callback/snapshot or later original-looking data cannot revive signals. Changed child and leaderless unknown group instead refuse and remain REQUESTED. Keep delayed PTY callback plus ESRCH-only case pending until exit. |
| A2-4 | `restart closure retries use saved identities without a live terminal` | Application recovery suite: REQUESTED never resumes/signals at startup, returns INTERRUPTED with same target; close application with null session proceeds through preparation/termination after unconfirmed confirmation. PTY adapter with a fresh instance and literal persisted evidence: original surviving members receive exact TERM and separately fresh KILL when needed; every unknown/replaced child prevents that signal. Recovery context never appears in `all`, never spawns a PTY, and duplicate retry joins one termination. Completion allows new reservation; failures retain it. |
| A2-5 | `closure records preserve compatible evidence and reject invented ownership` | Disk suite with literal independently arranged JSON: v1 REQUESTED/CLOSED, v2 null/anchored round-trip, monotonic enrichment, exact completion, conflicting anchor/member/target, malformed/unknown-version refusal. Legacy restart with present group sends nothing and reports unverifiable; later ESRCH permits retry completion. New-format preparation pending/failing write cannot authorize a newly learned member; fresh check after persistence detects replacement. Verify the production atomic-write wiring remains. |
| A2-6 | `the close API can recover a failed null-terminal target and then admit a new plan` | Existing close-route and coordinating-session-route suites through listening server with close/open actions doubled: recovered ended + close-failed target, first refusal literal code/body, retry calls close with null terminal and same identity, successful durable action result clears holding and next open is admitted. Paused close and failed close both refuse new opening (existing 409 contract); duplicate close joins, old target request cannot clear a newer target. Exact permission/unverifiable codes survive GET and startup projection. |
| A2-7 | `failed closure preserves current-work gate eligibility without opening another session` | Existing spec-freeze, epic-groom, epic-promotion and spec-reslicing route suites: matching target in close-failed reaches the gate action with correct root; stale target/missing key never reaches it; gate-specific refusal remains. Active closing still refuses. Groom-session route still refuses new terminal with 409 through reservation. Frontend Home coordinating-session/gate tests: failed closure keeps form and groom opener disabled, eligible freeze/groom/promote/reslicing usable, and each gate's own missing key/unpublished spec/pending state still disables or refuses. Exercise recovered ended state as well as live failed close. |
| A2-8 | `closure retry guidance remains usable until confirmation clears only the old target` | Frontend hook/Home suites: transient, permission and unverifiable Spanish guidance, enabled retry with null terminal, no optimistic cleanup after failure, late poll cannot undo confirmed closure, success clears old state and allows form without backend restart. Preserve unrelated terminal selection/input and current target on stale close reply. |
| A2-9 | `saved ownership closes a surviving real group from a fresh adapter` | `pty-live-sessions-real-process.test.ts`: first adapter starts a controlled group and observes/checkpoints root+child; second adapter (no PTY ownership) closes from that receipt with real default inspection. Verify process-group absence, no resume/spawn on second adapter, and independent terminal still responds. Exercise a deliberate TERM-resistant fixture for real KILL. Own all processes/watchers/timers in failure-safe afterEach. Preserve existing short parent-exit and 1500 ms healthy-close tests. |

Keep A1 T1–T12 except the explicit semantic amendments, all existing durable-write/stale-target/real-process tests, and headless/Git preservation oracles. A2-6 proves route behavior, A2-1/4 prove application ordering/restart decisions, A2-2/3/5 prove actual ownership mechanics; no claim that a mocked route proves kernel termination. Confirm unchanged Git/files/headless port calls in existing closure regression fixtures; do not introduce destructive Git cleanup to make a test pass.

### Exact verification

From `backend/`, run:

```sh
npm run typecheck
npx vitest run __tests__/application/close-coordinating-session.test.ts __tests__/application/recover-coordinating-session.test.ts __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/disk-conversation-records.test.ts __tests__/infrastructure/coordinating-session-close-route.test.ts __tests__/infrastructure/coordinating-session-route.test.ts __tests__/infrastructure/coordinating-sessions.test.ts __tests__/infrastructure/spec-freeze-route.test.ts __tests__/infrastructure/epic-groom-route.test.ts __tests__/infrastructure/epic-promotion-route.test.ts __tests__/infrastructure/spec-reslicing-route.test.ts __tests__/infrastructure/groom-session-route.test.ts
npx vitest run --exclude '**/*-real-process.test.ts'
npx vitest run __tests__/infrastructure/pty-live-sessions-real-process.test.ts __tests__/infrastructure/session-channel-real-process.test.ts
npm test
```

From `frontend/`, run:

```sh
npx vitest run src/app/coordinating-session/useCoordinatingSession.test.ts src/pages/home/__tests__/Home.coordinatingSession.test.tsx src/pages/home/__tests__/Home.specFreeze.test.tsx src/pages/home/__tests__/Home.epicGroom.test.tsx src/pages/home/__tests__/Home.gateSequence.test.tsx src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.test.tsx
npm test
npm run build
```

From repository root: `git diff --check`, `git status --short --branch`, and review `git diff -- backend frontend .aiplans/live-session-review-fixes`. Neither package declares a lint script; frontend build includes typecheck. Record Darwin/Linux real-process results separately, never claim an unavailable platform. Preserve A1 sensitivity checks; additional later clean-checkpoint mutation targets are skipping checkpoint persistence, null-session retry rejection, treating unknown children as replacement proof, restoring irreversible probe-error revocation, and admitting new openings on close failure. Manual mutation sweep remains deferred under the no-commit constraint. Stop and report any refusing control.

### Acceptance and limits

Implementation acceptance requires A2-1–A2-9 plus inherited checks, exact persistence/API payloads, no unverified signals, and demonstrable new-session admission after truthful retry completion. Review the leader-reuse proof, full-table visibility, original/durable identity separation, restart context conflict checks, checkpoint-write races, and amended A1 tests directly. No new abstraction is justified merely to encode the table above.

Residual blocks are explicit: legacy missing evidence, leaderless unknown membership, an unobserved replacement leader, lack of OS permission, and indistinguishable/coarsely timed identities cannot be transformed into proof. They retain honest requested closure and operational guidance, while eligible current work remains usable. The scope fixes avoidable software deadlocks; it does not claim guaranteed termination or safe immediate release in states where the available evidence cannot distinguish an original survivor from an unrelated process.
