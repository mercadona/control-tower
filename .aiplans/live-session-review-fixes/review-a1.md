# Independent Astra judgment — A1

Latest judgment: **round 3 — APPROVE**, recorded below under “Final scoped A1 rejudgment”. All previously raised A1 findings are resolved. **Ready for the coordinator's A1 commit.** Slice completion remains the coordinator's responsibility; A2 remains pending. Earlier judgments are retained below as history.

## Verdict: REQUEST_CHANGES

Reviewed on Darwin, 2026-09-17, against HEAD `a1d22004bb43cbe79553baf6ab292470e822224e` and its five-file working-tree diff. A1 only. A2 remains pending its separate cycle. Slice 1 remains **IN PROGRESS**, including after any subsequent approval until the coordinator's authorized completion/commit step.

Read `AGENTS.md`, `backend/conventions/this-repository.md`, the binding architecture/style/testing conventions, the complete `plan.md`, `for_developers.md`, and `implementation_log.md`. Inspected implementation and actual test assertions, including inherited tests; the existence of all twelve prescribed names is not acceptance evidence for all prescribed variants.

The replacement removes the blocking mechanism and has substantial correct safety machinery. Nevertheless, one required absence transition is missing and several central acceptance oracles are absent or ineffective. Passing counts do not close those gaps.

## Findings

### R1 — P2: Background group absence never receives the required ESRCH confirmation

**Location:** `backend/src/infrastructure/pty-live-sessions.ts:459–473`, particularly the empty-group path at line 472; invoked for background results at `597–605`.

For an anchored ownership record, a successful whole table lacking its group reaches `#membersMatch(opened, emptyMap)`, which returns true. No signal-0 probe occurs, no absence is latched, and periodic sampling continues. The ESRCH confirmation implemented in `#applyFreshSnapshot` is reached only by foreground close work. This omits the background observation behavior specified in plan section 3 and loses an available, stronger safety fact while a PTY exit callback is delayed.

**Reproduced:** anchor root 4101; make its group absent and provide a successful background table containing only unrelated PID 9999; restore a table carrying 4101 with the same observable start identity; close. Output was:

```text
after absent background {"scans":2,"calls":[]}
after reappearance [{"pid":-4101,"signal":"SIGTERM"},{"pid":-4101,"signal":0}]
```

The reproduction deliberately models indistinguishable same-second reuse. It does **not** claim the sampler can eliminate that general OS limitation. Here, however, the implementation had a whole observation interval during which ESRCH could have retired authority, and never asked. A changed start identity would still be refused by the existing matching guards.

**Impact:** misses monotonic absence evidence, permits avoidable later signalling when identities look unchanged, and leaves sampling active after an absence that should have ended eligibility.

**Minimal fix:** handle an empty group explicitly in background observation: probe the exact negative PGID; only ESRCH latches absence, revokes authority, and removes membership interest. A present group, EPERM, or unexpected probe error must retain prior background evidence without learning members or confirming absence. Preserve foreground failure for table/probe disagreement. Add deterministic background ESRCH, present, and EPERM variants, including delayed exit and a later matching-looking result.

### R2 — P2: Freshness, generation, and shared-work tests omit the races they promise

**Locations:** `backend/__tests__/infrastructure/pty-live-sessions.test.ts:1099–1233`, `1327–1412`.

- T2 opens 20 roots and checks two scan counts, but never proves evidence for those roots, learns a child created after bootstrap, records start spacing, or observes the schedule after the slow scan completes.
- T3 resolves bootstrap before constructing the close operation (`1139–1140`). There is no inspection active when close requests freshness. Reusing a currently running scan could pass this test. It also does not exercise synchronous evidence construction with unresolved bootstrap.
- T4 releases the old result **before** creating the replacement and **before** retirement (`1186–1191`). ESRCH has already provided successful-closure evidence. It does not demonstrate that unanchored exit with a surviving group fails closed, or that a result delivered after retirement cannot affect replacement ownership. The anchored pre-exit snapshot learning a previously unknown child after exit is absent.
- T5 plus inherited tests cover root replacement between TERM and KILL and delayed exit, but not the complete before-TERM replacement, same-PID changed-child, and unknown-member-after-exit variants. The inherited positive child case starts with the child already in bootstrap, so it cannot substitute for late historical learning.
- T9 exercises two matching groups admitted together. There is no third request after scan start, no asymmetric mismatch, and no expiry/retirement of one requester while another still needs the scan.
- T12 does release a late result after confirmed absence, but does not retry TERM, call confirmation after reuse, or keep a real replacement terminal writable.

**Impact:** core protections could regress while every prescribed name remains green. These are explicitly mandatory A1 cases, not new A2 recovery semantics.

**Minimal fix:** extend these boundary tests with controlled scan-start/release barriers and virtual inspection time. Make assertions distinguish the forbidden timeline from the permitted one: no signal after releasing the pre-request scan, exact negative signal only after the next scan, child evidence acquired only by the late anchored observation, unchanged replacement behavior, and independent outcomes for shared requesters. Use the full variant matrix below as the completion checklist.

### R3 — P2: Timeout, failure, reap, and parser-yield acceptance is largely untested

**Locations:** `backend/__tests__/infrastructure/pty-live-sessions.test.ts:1235–1324`.

T6 supplies only five malformed-output values. It calls the adapter directly, so it cannot assert that durable closure remains REQUESTED. There are no inspection throw/reject/ENOENT/EPERM/maxBuffer variants, foreground table/probe disagreement, hung-request close, transient failure after anchoring, or normal/worst-case virtual deadline assertions. Existing signal EPERM tests are not inspection/probe EPERM tests.

T7 aborts an unanchored bootstrap on root exit and advances time with no close requester and no replacement work. It does not prove request expiry, restart after retirement, sharing when only one root exits, anchored late completion, or one physical slot under timeout with other work queued.

T8 asserts the correct execFile request but neither emits terminal output nor closes anything. `find(session.id)` before and after the callback is independent of whether parsing succeeded or the child-close event released the slot. The heartbeat at `1314–1324` is checked after a real 5 ms timer: it would also run if all parsing were synchronous. There is no assertion that it runs **before parse-dependent completion**, and no malformed/default callback-error/abort/buffer variant or early-callback-before-close concurrency oracle.

**Impact:** the production default's most important resource guarantee and fail-closed behavior lack the executable evidence required by the plan. A parser that rejects every table could pass T8; a synchronous parser could also pass its heartbeat assertion.

**Minimal fix:** add the specified parameterized failure cases through the real close use case, assert REQUESTED/no destructive signal and bounded settlement, and exercise both callback/close orders at the execFile seam. Queue another operation after an early error callback and prove it cannot spawn until child close. Make parser progress observable at a later destructive-signal/ownership boundary and require a scheduled heartbeat before that boundary for a multi-batch table. Independently check successful exact-group TERM/KILL using the uninjected default. Add the transient-failure and no-authority-resurrection variants without implementing A2 recovery.

### R4 — P2: T11 does not prove HTTP/SSE progress during the flood

**Location:** `backend/__tests__/infrastructure/session-channel-real-process.test.ts:255–280`.

The list request is launched concurrently with typing, before any flood-start acknowledgment. It may complete before output starts. Conversely, it may complete after all output finishes and still meet the 3-second deadline. No assertion establishes an HTTP response or an output SSE frame before completion. The only frame read before typing is the initial subscription frame. The final substring search asserts an ordered subsequence, not exact reassembled numbered data; duplicated or interspersed numbered output can pass.

**Impact:** the integration test can pass with all flood data buffered until completion, or with the HTTP response delayed until after completion. It does not protect its claimed overlap behavior.

**Minimal fix:** introduce an explicit started/continue handshake in the real terminal fixture. After receiving numbered output, issue and observe the HTTP request while completion remains blocked; require an actual numbered SSE frame before releasing completion. Extract the marked numbered stream and compare it exactly with the expected 120 chunks. Keep bounded deadlines as failure budgets, not as substitutes for ordering assertions.

### R5 — P2: New asynchronous fixture lifetimes are not all cleaned up

**Locations:** `backend/__tests__/infrastructure/claude-conversations.test.ts:19–24,81–93`; `backend/__tests__/infrastructure/session-channel-real-process.test.ts:206–209,265–280`.

The conversation double discards `onExit`; there is no `afterEach`. Each successfully opened fake session now starts the recurring asynchronous sampler and remains eligible indefinitely. `unref()` permits worker exit but does not stop timers or release their captured adapter while that worker lives. The plan explicitly required exit/cancellation teardown when adding this inspector seam.

The new channel test also cancels its stream only at the successful end. `Echo.through` starts a 30-second timeout and a reader immediately; if the HTTP/deadline/assertion path fails before `streamed` is awaited, cleanup closes the server while that promise has no rejection handler. Server connection shutdown is not explicit reader/task cancellation, and `Deadline.within` does not cancel the losing operation.

**Impact:** work survives fixture completion; failed integration runs can leave pending reads/timers or secondary unhandled rejections, obscuring the original failure.

**Minimal fix:** retain exit listeners in conversation terminals and emit exits from `afterEach`. Register stream readers and outstanding operations at creation, cancel/drain them during failure-safe teardown, and clear the Echo deadline on cancellation. Ensure terminal cleanup still runs if server or reader cleanup fails. No production shutdown API is needed.

## Complete T1–T12 assertion audit

“Partial” means useful assertions exist but the prescribed variants are not all established.

| ID | Actual evidence | Missing or ineffective evidence |
|---|---|---|
| T1 — Partial | Two watchers receive exactly 100 chunks and replay matches before bootstrap release; one scan is observed; rejected bootstrap and a post-exit output callback do not crash. | Scheduling is never advanced after the flood to expose queued output-triggered work. `replay.printed` is an immutable returned string, so rechecking it after exit does not test changed scrollback. No live output delivery after a failed inspection is checked. |
| T2 — Partial | 20 sessions share bootstrap; periodic second scan; no overlap while that scan is held. | All roots acquiring usable evidence; minimum 100 ms start spacing; one future batch under pressure; silent child born after bootstrap; successful verified-child-only close; no catch-up burst after slow completion. Uses real 5/120/150 ms sleeps rather than the planned controlled inspection clock. |
| T3 — Partial | Real CloseCoordinatingSession and paused durable intent; no signal before release; duplicate calls yield one exact TERM. | Evidence during unresolved bootstrap; pre-existing active scan excluded from fresh TERM authorization. |
| T4 — Partial | Exit before bootstrap, confirmed absence, later result, replacement remains listed. | Surviving unanchored group refusal; late result after retirement/replacement; anchored pre-exit snapshot contributes new child evidence after exit; false authority cannot be restored by a late valid-looking snapshot. |
| T5 — Partial, inherited coverage included | Root replaced between TERM/KILL; delayed callback; inherited exact groups/unrelated writable session; verified child receives TERM/KILL. | Root replacement before first TERM after a successful anchor; child start identity changed under same PID; unknown member after root exit. Positive child setup relies on a 5 ms wait, not an explicit observation barrier. |
| T6 — Partial | Empty string, malformed row, PID zero, missing start, duplicate PID cause SessionNotTerminated/no destructive signal. | Throw/reject/ENOENT/EPERM/timeout/overflow; unsafe PID/invalid PGID and additional invalid start variants; REQUESTED/not CLOSED at real close boundary; table-missing/probe-present and EPERM disagreement; transient anchored failure retains evidence; revoked authority remains revoked; normal and worst-case virtual close bounds. |
| T7 — Partial | Unanchored exit aborts the active double; no later starts over 5 seconds; max active remains one. | Outstanding request deadline on hung double, queued subsequent requester, shared work surviving one exit, last anchored root/retirement cleanup, late result ignored, opening again resumes sampling, timer cleanup assertion. |
| T8 — Partial | Correct async binary/argv/options including locale, timeout, SIGKILL, buffer and signal; callback and close can be separately delivered. | Parsed ownership or signal outcome, output before callback, exact owned group only, malformed/default failure variants, reap-held slot under early callback, parser heartbeat before completion. |
| T9 — Partial | Two matching closes share one fresh table and send exact separate negative-PGID TERM signals. | Third post-start requester waits for next batch; expiry/retirement isolation; mismatch cannot affect the other group. |
| T10 — Substantially satisfied | Real silent child; target-group observation wrapper; parent exit requested after two group observations; child/group absence; unrelated terminal remains writable; default-inspector inherited real cases preserved. | The wrapper checks at least two target-group members, not explicitly root inclusion, and resolves before adapter parsing finishes. In this controlled fixture the root has not been asked to exit and has only one child, so the corrected barrier is materially meaningful. Prefer explicit root inclusion and evidence-application ordering for precision. |
| T11 — Partial | Real uninjected production default, 120 numbered chunks, concurrent promises, bounded happy-path completion and ordered subsequence. | Actual start/finish ordering for HTTP/SSE progress; exact output equality; failure-safe reader/task cleanup. |
| T12 — Partial, inherited coverage included | Pending result released after ESRCH and retirement; no KILL; inherited tests separately pin no signalling on reused-group retries. | Combined pending-result/reuse scenario does not retry/confirm closure or demonstrate replacement writability. |

## Production-code audit: safeguards present and boundaries of this judgment

- `#received` only trims scrollback and sends bytes (`311–314`); no per-chunk inspection or dirty flag. `terminationEvidence` is synchronous and does not inspect (`230–250`). Exit has no synchronous ps call (`316–336`).
- Production uses asynchronous `execFile`, fixed timeout/buffer, C locale, AbortSignal, no shell, and requires both callback and child close before settling (`735–769`). A 500 ms controller timer also bounds parsing/ignores late aborted results. No replacement scan starts while the inspector promise is unsettled (`554–595`). These are code-review conclusions; R3 describes missing regression evidence.
- Pending work is keyed by ownership object; active and pending batches are separate. Private request call sites are bootstrap and the deduplicated sequential close path, so waiter Sets do not create a public per-caller unbounded queue. Periodic sampling is shared, not per-session, and start spacing uses the separate monotonic clock. There is no active-scan reuse in the inspected request code.
- Root anchoring checks retained object, observed exit, authority and absence. The anchor is immutable once set. Anchored pre-exit observations can learn historical children; fresh checks are still required. Rootless groups require every member's stored PID/start identity. No broad name matching or positive-PID destruction was introduced.
- TERM and KILL each await a newly requested scan, then check authority/generation/absence and signal in one synchronous continuation (`358–375`). Polls use cheap probes; destructive targets are negated exactly once. Exit plus absence still gates owned confirmation; unowned confirmation remains observational.
- Empty/duplicate/malformed tables reject as a whole before distribution. Missing-table foreground groups require ESRCH and otherwise fail closed. The corresponding background absence branch is missing (R1).
- Active anchored historical work can survive natural exit until bounded completion, as designed. One start timer can remain scheduled after its final pending entry is canceled; it subsequently no-ops. This is a small timer-cleanup discrepancy, not an overlapping-child finding. Tests should assert cleanup when repairing T7.

## Independently executed verification

Working directory for these commands: `/Users/jponzvan/git/control-tower-plugin/.worktrees/390/backend`.

```sh
npm run typecheck && npx vitest run __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/claude-conversations.test.ts __tests__/application/close-coordinating-session.test.ts
npx vitest run __tests__/infrastructure/pty-live-sessions-real-process.test.ts __tests__/infrastructure/session-channel-real-process.test.ts
```

Results: typecheck passed; focused **51/51 passed** (3.57 s); real-process **12/12 passed** (6.48 s). No control refused. The implementer's fast 2,281 and full 2,336 passes remain reported evidence, not independent reruns; no new concern required repeating those broad suites.

Repository-root commands:

```sh
git status --short && git rev-parse HEAD && git diff --stat a1d22004
git diff a1d22004 -- backend/src/infrastructure/pty-live-sessions.ts backend/__tests__/infrastructure/pty-live-sessions.test.ts backend/__tests__/infrastructure/claude-conversations.test.ts backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts backend/__tests__/infrastructure/session-channel-real-process.test.ts
git diff --check && git status --short --branch
```

Whitespace check passed; the five intended implementation/test files are modified. Planning files are ignored by the repository, so their absence from normal status is expected.

### Exact R1 reproduction command

Run from `backend/`. All signals and terminals are doubles; it does not signal a real process or edit a file.

```sh
node --input-type=module -e 'import {PtyLiveSessions} from "./src/infrastructure/pty-live-sessions.ts"; import {ConversationId} from "./src/domain/value-objects/conversation-id.ts"; const wait=ms=>new Promise(r=>setTimeout(r,ms)); let exit; let present=true; let scans=0; const calls=[]; let table="4101 4101 Thu Sep 17 22:29:08 2026\n"; const sessions=new PtyLiveSessions({spawn:()=>({pid:4101,onData(){},onExit(fn){exit=fn},write(){},resize(){}}),newId:()=>"original",stderr(){},signal(pid,signal){calls.push({pid,signal}); if(!present)throw Object.assign(new Error("absent"),{code:"ESRCH"}); if(signal==="SIGTERM"){present=false;exit()}},sleep:wait,now:Date.now,termGraceMs:10,killGraceMs:10,pollMs:1,inspectProcessTable:async()=>{scans++;return table}}); const session=sessions.open(PtyLiveSessions.loginShell("/bin/sh","/tmp",{})); await wait(40); present=false; table="9999 9999 Thu Sep 17 22:29:08 2026\n"; await wait(120); console.log("after absent background",JSON.stringify({scans,calls})); present=true; table="4101 4101 Thu Sep 17 22:29:08 2026\n"; const keepAlive=setTimeout(()=>{},2000); try {await sessions.terminate(sessions.terminationEvidence({conversation:new ConversationId("2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f"),target:"6d13bc52-740f-49f8-b128-15e597674f3a",session}));console.log("after reappearance",JSON.stringify(calls))}finally{clearTimeout(keepAlive);if(present){present=false;exit()}}'
```

An initial exploratory invocation used invalid target `"target"` and stopped at SessionClosure UUID validation before termination; the corrected command above produced the stated full result. The observation before that fixture error also showed two scans and zero probes. This was a reproduction-fixture error, not a product failure.

### Exact independent hung-inspector bound check

```sh
node --input-type=module -e 'import assert from "node:assert/strict"; import {PtyLiveSessions} from "./src/infrastructure/pty-live-sessions.ts"; import {ConversationId} from "./src/domain/value-objects/conversation-id.ts"; let exit; let scans=0; let inspectionSignal; const destructive=[]; const sessions=new PtyLiveSessions({spawn:()=>({pid:4101,onData(){},onExit(fn){exit=fn},write(){},resize(){}}),newId:()=>"original",stderr(){},signal(pid,signal){if(signal!==0)destructive.push({pid,signal})},sleep:ms=>new Promise(r=>setTimeout(r,ms)),now:Date.now,termGraceMs:10,killGraceMs:10,pollMs:1,inspectProcessTable:signal=>{scans++;inspectionSignal=signal;return new Promise(()=>{})}}); const session=sessions.open(PtyLiveSessions.loginShell("/bin/sh","/tmp",{})); const closure=sessions.terminationEvidence({conversation:new ConversationId("2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f"),target:"6d13bc52-740f-49f8-b128-15e597674f3a",session}); const start=Date.now(); const keepAlive=setTimeout(()=>{},4000); try{await assert.rejects(sessions.terminate(closure),{name:"SessionNotTerminated"}); assert.equal(scans,1); assert.equal(inspectionSignal.aborted,true); assert.deepEqual(destructive,[]); console.log(JSON.stringify({elapsedMs:Date.now()-start,scans,aborted:inspectionSignal.aborted,destructive}));}finally{exit();clearTimeout(keepAlive)}'
```

Passed: `{"elapsedMs":3008,"scans":1,"aborted":true,"destructive":[]}`. This checks pending bootstrap plus one eligible fresh-bootstrap deadline against an abort-ignoring operation. It does not replace the missing virtual-time TERM/KILL, shared-request, or actual child-close boundary cases.

## Remaining limits and disposition

Linux is unverified. No claim of atomic process ownership: ps and kill remain separate kernel operations, lstart has one-second precision, and a child created and orphaned entirely between observations cannot safely be adopted. Refusing unverified termination is correct. Those accepted limits do not justify omitting the ESRCH opportunity in R1 or the planned regression variants.

Manual mutation sweep remains deferred until an authorized committed-clean checkpoint. No production/test files were edited by this judge; no flags, delegation, Orca, commits, or pushes were used. Only this review and an appended log entry were written. Repair R1–R5, rerun the affected focused checks, and return A1 for judgment; A2 remains a separate pending cycle.

## Superseding A1 rejudgment — round 2, 2026-09-17

### Verdict: REQUEST_CHANGES

This section supersedes the first verdict's open-finding inventory, not its historical record. Reviewed the current complete five-file diff against the unchanged HEAD `a1d22004bb43cbe79553baf6ab292470e822224e`, the updated implementation log, and the actual assertions against R1–R5. A1 only; A2 remains excluded. Slice 1 remains **IN PROGRESS**.

The production absence defect is repaired. Freshness, historical membership, parser-yield, and integration evidence are materially stronger. No additional production correctness defect was confirmed in this round. Approval is still blocked by narrow, previously requested A1 acceptance oracles: some new tests cannot detect the failure their names imply, and the prescribed cancellation/deadline scenarios remain incomplete.

### Disposition of the five original findings

| Finding | Round-2 disposition | Inspected evidence |
|---|---|---|
| R1 — Background ESRCH | **Resolved** | `pty-live-sessions.ts:466–475` probes a missing anchored group, latches ESRCH only, revokes authority, and removes membership interest. Present/error probes retain evidence. New cases at test lines `1170–1220` cover absent/present/EPERM. Independent reproduction below confirms that same-observable-identity reappearance cannot signal, and PTY exit is still required. |
| R2 — Races and shared work | **Substantially resolved; residual below** | T3 now excludes a scan already running at durable-intent release (`1283–1341`). New surviving-unanchored, anchored historical-child, post-retirement replacement, and before-TERM identity variants (`1364–1506`) exercise the required distinctions. T9 separates the post-start third request and asymmetric mismatch (`1905–1962`). T12 now retries, confirms, and writes to replacement (`1964–2016`). Shared-request cancellation and identity-revocation retry remain missing. |
| R3 — Failures, reaping, deadlines | **Substantially resolved; two residuals below** | T6 now exercises real close records and multiple failures (`1548–1624`); transient anchored retry is explicit (`1626–1672`). An unreaped operation blocks later starts and requests expire (`1719–1759`). The default positive path proves output delivery, parsing before signalling, heartbeat before a parse-dependent probe, exact TERM/KILL targets (`1761–1835`), and both callback/close ordering cases. The default failure cases still lack a close outcome, and timeout assertions cover only the bootstrap path. |
| R4 — T11 causal progress | **Resolved** | `session-channel-real-process.test.ts:266–309` receives exact first-half numbered SSE data and a pause marker, makes the HTTP request while completion is blocked, then releases completion and compares the entire numbered payload exactly. This establishes the requested causal ordering. |
| R5 — Fixture cleanup | **Resolved for the reported leaks** | Conversation terminals retain listeners and exit in afterEach (`claude-conversations.test.ts:19–40,125–127`). SSE readers register centrally, are canceled before server shutdown, and terminal cleanup is in finally. T11 awaits each read through Deadline immediately and cancels in finally, removing the earlier detached unhandled read promise. |

### Remaining finding R2 — P2: cancellation and revoked-authority retry are not exercised at the shared-close boundary

**Locations:** `backend/__tests__/infrastructure/pty-live-sessions.test.ts:1692–1717,1905–1962`.

The new T9 proves asymmetric identity validation and a third request waiting for a later scan. It does not retire or expire one requester **while another close requester still needs the active scan**. The first close is retired only after its table has completed. The new shared-root test exits an unanchored root during bootstrap; this exercises `#cancelUnanchoredBootstrap`, not the `#cancelInterest` retirement path or a foreground waiter's deadline cleanup.

Likewise, T9 feeds the original-looking table at line 1956 after the second group's mismatch, but never retries termination of that second session. That group is no longer an eligible background target, so including its row in another session's table is not an observable check that revoked authority stays revoked. T12 covers absence retirement, which is a different state transition.

**Impact:** canceling one owned record could incorrectly abort a shared close, or a later close retry could regain identity-revoked authority, without these new assertions failing. Both cases were explicitly required in the original T4/T6/T9 contract and R2/R3 review; restoring authority is not authorized A2 work.

**Minimal completion:**

1. Anchor two records and arrange a scan shared by A's periodic membership interest and B's fresh close request. Observe exit plus ESRCH for A, then terminate/retire A through the existing confirmed-exit short circuit while B still waits. Assert the scan is not aborted, release the matching table, and assert B sends only its own exact signal. Alternatively, stagger fresh waiters behind an occupied slot so one request expires while the other's active scan can still complete within its execution/request budgets; assert the survivor succeeds without cross-session cancellation. Do not attempt to force retirement through `confirmTermination` while that same record already has a pending termination: the public implementation intentionally awaits that termination. Bootstrap-only cancellation does not exercise either of these distinct cleanup paths.
2. After identity mismatch revokes one record's authority, retry its close with original-looking inspection data available. Assert SessionNotTerminated, no new destructive signal, and durable REQUESTED. Keep the other session usable. Do not implement authority recovery.

### Remaining finding R3a — P2: default failure tests prove slot retention, not rejection of errored output

**Location:** `backend/__tests__/infrastructure/pty-live-sessions.test.ts:1837–1875`.

The four parameterized cases open sessions but never request termination. Consequently `destructive === []` is true even if invalid bootstrap data were accepted. They then advance 2,000 ms before child close, past the 500 ms controller timeout and the request deadline. Error cases also carry empty stdout. Thus ignoring the exec error would still be rejected by empty-table parsing or cancellation; the test cannot detect improper acceptance of otherwise valid stdout accompanying an exec failure. The malformed-output case is likewise masked by cancellation before completion, even if malformed parsing were weakened.

These are useful **physical-slot retention** tests and should stay. They do not discharge the additional default-inspector fail-closed oracle in T8/R3. T6's injected inspector bypasses `#inspectProcessTable`, so it cannot cover losing an error in that production callback wrapper.

**Impact:** a regression that discards a maxBuffer/exec error and consumes its partial but parseable stdout is not protected by the current default-seam error assertions.

**Minimal completion:** add a separate default-seam close test with a valid bootstrap, durable REQUESTED, and a fresh pre-TERM exec callback carrying an error **and valid-looking owned-group stdout**. Deliver child close before 500 ms, then assert bounded SessionNotTerminated, REQUESTED, and zero destructive signals. Parameterize relevant callback errors. Add malformed stdout with a null exec error and timely child close. Keep the existing late-close tests as the separate reaping oracle. The negative outcome must depend on the callback error/parser refusal, not a previously fired abort.

### Remaining finding R3b — P2: the bound assertion measures clock advancement and omits foreground timeout stages

**Locations:** `backend/__tests__/infrastructure/pty-live-sessions.test.ts:1719–1759`, especially `1742–1747`; related T6 block `1548–1624`.

The test advances virtual time by exactly 3,000 ms and then compares the current clock with the start. That equality is fixed by `advanceTimersByTimeAsync(3_000)`, not the operation's settlement time. Awaiting the rejection does establish settlement by 3,000 ms, which is useful, but it does not prove the claimed exact completion time. The only exercised waits are pending bootstrap plus a failed fresh bootstrap behind an already exit-aborted operation. There is no live-root 500 ms execution-abort assertion, no pre-TERM or pre-KILL timeout case, and no normal/full queued-close virtual timeline establishing that each grace begins after its signal. Comparing this bootstrap-only result to `4 * REQUEST_TIMEOUT + 20` does not exercise the plan's worst-case close sequence.

The only foreground missing-table case uses a successful signal-0 probe (`1618–1623`); background EPERM and an inspector rejecting EPERM are not a foreground signal-0 EPERM case.

**Impact:** an omitted inspection execution abort, an unbounded fresh escalation wait, or an incorrectly shortened process grace can remain outside the promised regression evidence. This is the still-open deadline/probe portion of original R3, not a new performance threshold.

**Minimal completion:**

- Record virtual time in the close promise's settlement handler and assert pending state before the intended boundary. Check AbortSignal at the execution deadline while the root is still eligible.
- Exercise hung fresh TERM and fresh KILL separately after successful anchoring; assert REQUESTED, bounded rejection, and no pending destructive signal (KILL case may have exactly the already-authorized TERM).
- Add the planned normal close and delayed/queued bootstrap–TERM–KILL timeline, using controlled releases and signal timestamps to verify the total bound and full post-signal graces. It need not attain the conservative 6,000 ms ceiling; it must exercise the stages it claims to bound.
- Add missing-table plus foreground signal-0 EPERM, asserting no false CLOSED and no destructive signal.

### Audit of introduced production changes and completed evidence

- `#learnMembers` at `525–534` first checks every already-observed PID/start pair, then adds only unseen PIDs. A conflict cannot partially teach new members. Both background and fresh paths revoke rather than silently replacing an identity. The added same-PID changed-child refusal now genuinely exercises this conservative behavior. This does not establish new A2 recovery semantics.
- `#clearUnusedStartTimer` checks the whole pending map before cancellation (`731–735`), so removing one session's interest does not clear scheduling needed by another. Its call sites cover request expiry, unanchored cancellation, retirement, and background-interest removal. Active child-slot release remains tied to inspector settlement, not these pending timers.
- The ESRCH change does not treat EPERM or table absence alone as absence. The independent check additionally confirms it does not optimistically close before PTY exit.
- T2 now demonstrates anchored evidence distributed to all 20 roots through their missing-group probes, silent child learning after bootstrap, one physical operation, and successful child-only close with unrelated writability. T1 delivers live output after failure. T10 now explicitly requires both the target root and a child in each counted observation; existing 200 ms fixtures and the healthy 1,500 ms close assertion remain unchanged.
- The revised T8 heartbeat is meaningful: signal-0 is observed only after whole-table parsing, and it records the heartbeat state at that boundary. Without the parse yield, that observation would precede the scheduled immediate. This resolves the earlier false-positive heartbeat finding.
- Production TERM/KILL fresh-request ordering, synchronous last-check-and-signal continuations, strict exact-group targeting, and monotonic absence remain intact. Sampling and default execution remain bounded and asynchronous. No A2 files or behavior-recovery implementation appeared in the diff.

### Independent round-2 verification and commands

From `backend/`:

```sh
npm run typecheck && npx vitest run __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/claude-conversations.test.ts __tests__/application/close-coordinating-session.test.ts
npx vitest run __tests__/infrastructure/pty-live-sessions-real-process.test.ts __tests__/infrastructure/session-channel-real-process.test.ts
```

Typecheck passed; focused **68/68 passed**, 3.87 s; real-process **12/12 passed**, 5.49 s, on Darwin. The reported fast **2,298** and full **2,353** passes were read in the log; those broad suites were not redundantly rerun. The log's initial full-suite process-pressure failures and unchanged successful rerun are retained as reported history, not independently diagnosed findings.

From the repository root:

```sh
git status --short --branch && git rev-parse HEAD && git diff --stat a1d22004 && git diff a1d22004 -- backend/src/infrastructure/pty-live-sessions.ts
git diff a1d22004 -- backend/__tests__/infrastructure/claude-conversations.test.ts backend/__tests__/infrastructure/session-channel-real-process.test.ts backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts
git diff a1d22004 -- backend/__tests__/infrastructure/pty-live-sessions.test.ts
git diff --check && git status --short --branch
```

Whitespace passed; only the same five production/test files are modified in tracked status. The judge changed only planning review/log files.

#### Exact independent R1 regression check

Run from `backend/`. All process interactions are doubles; no real process is signalled.

```sh
node --input-type=module -e 'import assert from "node:assert/strict"; import {PtyLiveSessions} from "./src/infrastructure/pty-live-sessions.ts"; import {ConversationId} from "./src/domain/value-objects/conversation-id.ts"; const wait=ms=>new Promise(r=>setTimeout(r,ms)); let exit; let present=true; let scans=0; const calls=[]; let table="4101 4101 Thu Sep 17 22:29:08 2026\n"; const sessions=new PtyLiveSessions({spawn:()=>({pid:4101,onData(){},onExit(fn){exit=fn},write(){},resize(){}}),newId:()=>"original",stderr(){},signal(pid,signal){calls.push({pid,signal});if(!present)throw Object.assign(new Error("absent"),{code:"ESRCH"})},sleep:wait,now:Date.now,termGraceMs:10,killGraceMs:10,pollMs:1,inspectProcessTable:async()=>{scans++;return table}}); const session=sessions.open(PtyLiveSessions.loginShell("/bin/sh","/tmp",{})); const keepAlive=setTimeout(()=>{},2500); try{await wait(40);present=false;table="9999 9999 Thu Sep 17 22:29:08 2026\n";await wait(150);assert.equal(scans,2);assert.deepEqual(calls,[{pid:-4101,signal:0}]);present=true;table="4101 4101 Thu Sep 17 22:29:08 2026\n";const evidence=sessions.terminationEvidence({conversation:new ConversationId("2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f"),target:"6d13bc52-740f-49f8-b128-15e597674f3a",session});await assert.rejects(sessions.terminate(evidence),{name:"SessionNotTerminated"});assert.deepEqual(calls,[{pid:-4101,signal:0}]);exit();await sessions.terminate(evidence);await sessions.confirmTermination(evidence);await wait(120);assert.equal(scans,2);console.log(JSON.stringify({scans,calls,noSignalOnMatchingReappearance:true,exitStillRequired:true,confirmationAfterExit:true}))}finally{exit();clearTimeout(keepAlive)}'
```

Passed:

```json
{"scans":2,"calls":[{"pid":-4101,"signal":0}],"noSignalOnMatchingReappearance":true,"exitStillRequired":true,"confirmationAfterExit":true}
```

### Round-2 disposition

Complete the three residual evidence findings above, preserving the repaired production behavior and existing positive assertions, then request A1 rejudgment. These are continuations of R2/R3 and the original A1 test contract; no A2 expansion is requested. Linux, mutation-sweep deferral, and non-atomic ps/kill and sampling limitations remain as previously recorded. No production/test edits, commits, pushes, delegation, Orca, or control bypass occurred in this review; no repository control refused.

## Final scoped A1 rejudgment — round 3, 2026-09-17

### Verdict: APPROVE — ready for the coordinator's A1 commit

This verdict supersedes the earlier REQUEST_CHANGES dispositions. **No remaining blocking A1 findings.** Slice 1 remains **IN PROGRESS** until the coordinator performs the authorized commit/completion step. A2 remains pending and was not reviewed or authorized by this judgment.

Read the updated implementation log and inspected the actual new assertions in `backend/__tests__/infrastructure/pty-live-sessions.test.ts` against the round-2 residuals. Confirmed that the production adapter and the other three previously reviewed files are unchanged from round 2 by their blob hashes. The final round adds evidence rather than changing the implementation under review.

### Resolution of the final residuals

| Residual | Actual assertions and conclusion |
|---|---|
| R2 / R2a — Shared interest retirement | Test lines `2246–2286` anchor two records, admit the second close before the scheduled shared scan, retire the first root through observed exit plus ESRCH while that scan remains active, assert its AbortSignal stays un-aborted, and release the table. The second close succeeds with exactly `SIGTERM` to `-4102`. This reaches retirement cleanup while another foreground waiter still needs the scan. **Resolved.** |
| R2 / R2a — Identity-revoked retry | Lines `2288–2338` revoke authority with a fresh identity mismatch, retain durable REQUESTED, deliver original-looking later data while another root remains sampled, and actually retry the revoked close. The retry rejects with no destructive signal, leaves REQUESTED, and the unrelated terminal remains writable. This is now an observable retry oracle rather than unused rows in another session's snapshot. **Resolved.** |
| R3a — Timely default failures | Lines `2104–2158` use the uninjected default at the execFile seam, establish valid bootstrap ownership, call the real close use case, and deliver error-plus-usable-stdout or malformed stdout with child close before timeout. They record rejection settlement, assert settlement before 500 ms and `aborted: false`, require SessionNotTerminated/REQUESTED, and assert no destructive signal. Rejection can no longer be explained by empty error output, an already fired abort, or the absence of a close request. The separate late-close slot-retention tests remain. **Resolved.** |
| R3b — Execution and request deadlines | Lines `1719–1736` observe no execution abort at 499 ms and abort at 500 ms while the root stays live. Lines `1738–1814` independently exercise hung fresh TERM and fresh KILL checks, bounded rejection, REQUESTED, and exactly the permitted destructive-signal history. Lines `1941–1985` record the promise rejection's actual timestamp, require it still pending at 2,999 ms, and establish settlement at 3,000 ms with one physical scan and later restart. **Resolved.** |
| R3b — Normal closure and grace boundaries | Lines `1816–1853` prove immediate confirmation after TERM without entering KILL grace. Lines `1855–1908` hold the group through TERM, require a separate fresh KILL observation, and assert signal timestamps and the full 30 ms TERM plus 40 ms post-KILL grace before delayed exit confirmation. Together with the independently bounded bootstrap/fresh-request stages and the reviewed sequential control flow, these establish the scoped close-bound behavior. **Resolved.** |
| R3b — Foreground probe EPERM | Lines `1910–1939` deliver a valid whole table missing the owned group while signal-0 throws EPERM. The real close rejects as SessionNotTerminated, remains durably REQUESTED, and sends no destructive signal. This exercises the probe path, not merely an inspector throwing the same error code. **Resolved.** |

R1, R4, and R5 remain resolved on the unchanged code and integration fixtures examined in round 2. Earlier checks of per-chunk inspection removal, fresh TERM/KILL evidence, historical-child and generation guards, exact negative-PGID targeting, child-close slot ownership, strict parsing, causal HTTP/SSE progress, and cleanup retain their prior evidence. The acceptance assessment includes the inherited tests and the additional boundary cases, not just the twelve prescribed test names.

### Independent final verification

Executed from `/Users/jponzvan/git/control-tower-plugin/.worktrees/390/backend`:

```sh
npm run typecheck && npx vitest run __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/claude-conversations.test.ts __tests__/infrastructure/pty-live-sessions-real-process.test.ts __tests__/infrastructure/session-channel-real-process.test.ts
```

**Passed:** typecheck; **4/4 test files, 89/89 tests**, 5.14 s, on Darwin. This includes the unchanged real-process cases and the new residual-completion assertions. No broad suite rerun was needed for this test-only round; prior full-suite results remain separately recorded rather than presented as a new run.

Executed from the repository root:

```sh
git status --short --branch && git diff --stat a1d22004 && git diff a1d22004 -- backend/src/infrastructure/pty-live-sessions.ts
git hash-object backend/src/infrastructure/pty-live-sessions.ts backend/__tests__/infrastructure/claude-conversations.test.ts backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts backend/__tests__/infrastructure/session-channel-real-process.test.ts && git diff --check && git status --short --branch
```

`git diff --check` passed. Hashes match the round-2 reviewed versions:

```text
f31abf6236b1138cf2962ecc033353fd062a5691  backend/src/infrastructure/pty-live-sessions.ts
9739fea0d15f4b9b22ee3f3402b25693adba8570  backend/__tests__/infrastructure/claude-conversations.test.ts
797983ed8295a08bfe52f9cc143a95a9cf760024  backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts
f30f07bcfa2141484b35d85a6263a930adbafd02  backend/__tests__/infrastructure/session-channel-real-process.test.ts
```

### Final handoff

**A1 is approved and ready for the coordinator's A1 commit.** The judge has not marked the slice complete and has not committed or pushed. Only this review and the implementation log were edited by the judge; no production/test edits, delegation, Orca, or control bypass occurred. No repository control refused.

The already declared limits remain: Darwin verification only; Linux unclaimed; manual mutation sweep deferred to an authorized committed-clean checkpoint; ps/kill are non-atomic, lstart precision is one second, and sampling cannot establish ownership for every child created and orphaned between observations. This approval does not expand those claims or enter A2.
