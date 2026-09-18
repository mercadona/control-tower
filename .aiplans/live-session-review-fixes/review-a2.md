# Independent Astra judgment: A2 / PR #413

Date: 2026-09-18. Worktree: `feat/390`. Accepted baseline: `83304d9d`.

Latest verdict: **APPROVE**, under “Final scoped A2 judgment — round 3” below. Earlier findings and verification failures are retained as review history and were resolved before coordinator acceptance.

## Verdict: REQUEST_CHANGES

Slice 2 remains **EN PROGRESO**. The coordinator owns completion. The normal retry and fresh-adapter termination paths work, but A2 does not yet meet its approved identity, extinction, diagnostic, and regression-evidence contract.

Independent results: backend typecheck passed; backend focused **229/229** passed; Darwin real-process **13/13** passed. Frontend focused **76/77** passed, with the new A2-8 test failing; the same test failed in isolation. Four read-only, double-based Node commands reproduced five concrete adapter/value defects described below. Broad suites were not rerun.

## Scope and method

- Read `AGENTS.md`, backend conventions, travelling architecture/style/testing conventions, the complete review-fixes plan including Slice 2 and its explicit A1 amendments, `for_developers.md`, the implementation log, and `docs/superpowers/specs/2026-09-17-live-session-lifecycle-design.md`.
- Reviewed the actual tracked diff from `83304d9d`, not a summary of Sol's implementation. Also read the new untracked `backend/src/domain/value-objects/session-process-ownership.ts`, which ordinary `git diff` omits. Reviewed surrounding closure, recovery, persistence, sampler, route, and frontend gate/lifecycle code and actual test bodies.
- Issues #390/#392 were already In Progress in Project 16, as supplied by the coordinator. This judgment makes no implementation or Project transition.
- No production/test edits, delegation, Orca, flags, commits, pushes, mutation sweep, or control bypass. The judge writes only this review and an appended log entry. No hook, permission prompt, or repository protection refused a command. Test failures are reported without weakening assertions.
- The amendments are accepted scope: removing irreversible uncertainty, adding persisted identity retry, and using narrow leader replacement as extinction proof are intentional. A1's former blanket mismatch-refusal expectations are not imposed on A2.

## Findings

### R1 — P1: Background leader-replacement evidence is discarded instead of latching extinction

**Locations:** `backend/src/infrastructure/pty-live-sessions.ts:498–520`, `806–830`.

`#inspectionSucceeded` computes a full-table `leaderIdentity`/`leaderProcessGroup`, but passes only the group to `#applyObservation`. That method ignores a changed leader. Removing `signalAuthority` removed the old mismatch revocation without replacing this branch with the approved monotonic `originalGroupGone` transition. Replacement proof is applied only during preparation, termination, or confirmation.

**Reproduced:** bootstrap the original leader; complete a background snapshot showing a different identity at the leader PID; then supply original-looking data to an explicit terminate. The adapter sends `SIGTERM` to `-4101`. Output from command B:

```text
completed replacement background observation; scans: 2
signals after already observed leader replacement: [{"pid":-4101,"signal":"SIGTERM"}]
```

**Impact:** already-observed extinction is forgotten, and later data can restore destructive authority. This violates Slice 2's monotonic extinction rule and the explicit extension of T12. This is not a demand for atomic ps/kill immunity: the evidence had already been observed and successfully parsed by this adapter.

**Minimal fix:** apply the whole snapshot's narrow leader-replacement proof to every eligible anchored retained observation, behind generation/abort guards. Latch original-group extinction, end the original generation, and remove sampling interests without signalling the replacement. Do not convert child mismatch or unknown members into extinction. Add same-PGID and different-current-PGID background variants followed by original-looking data, late callbacks, and an explicit retry.

### R2 — P1: Recovered confirmation can borrow another checkpoint's root and falsely confirm the offered receipt

**Locations:** `backend/src/infrastructure/pty-live-sessions.ts:311–323`, `485–487`, `615–621`, `670–683`.

`#matchingContext` returns an existing recovered context without `#requireMatchingContext`. Even the latter checks only the root, not the immutable member checkpoint. `#isConfirmed` checks only the conversation/target/session/PGID key and ignores the saved ownership entirely.

**Reproduced:** first confirm receipt A with root identity `4101:...22:29:08...`; it correctly remains unconfirmed while that root is present. Then offer receipt B with the same full key but root identity `4101:...22:29:10...`, while the table contains precisely B's still-live root. Confirmation reuses A's context, interprets B's live root as A's replacement, and reports B confirmed. A subsequent terminate of B returns cached success. Command A prints:

```text
original confirmation: SessionTerminationUnconfirmed
conflicting recovered receipt: CONFIRMED although its own root is present
conflicting receipt cached: terminate returned success
```

**Impact:** confirmation can attest to the wrong process incarnation and authorize durable CLOSED for an offered checkpoint whose own group remains present. This is an internal receipt/persistence-contract failure; it is not a claim that the HTTP endpoint accepts user-entered process identities.

**Minimal fix:** validate immutable checkpoint compatibility on every recovered lookup, including confirm and confirmed-cache short circuits. Recovered contexts must accept only their matching saved checkpoint; retained contexts may accept only the approved compatible original evidence/enrichment. Reject conflicting member entries as well as roots, and validate before changing a binding. Keep full conversation/target/session/PGID binding and safe completion-write retry. Add the prescribed other-target/retained-owner refusal plus recovered root/member/null conflicts and conflicting confirmed-cache calls. Successful closure of A must never be evidence that B was closed.

### R3 — P2: Noncanonical PID prefixes are accepted and become false leader-replacement proof

**Location:** `backend/src/domain/value-objects/session-process-ownership.ts:35–42`, `54–60`; consumed by `pty-live-sessions.ts:586–588` and the v2 disk reader.

The identity parser accepts `04101:Thu Sep 17 22:29:08 2026`, converts the prefix to numeric 4101, and accepts it for member PID/process group 4101. A1's process-table identity is canonical `4101:...`. Comparing these strings then treats the same process as a replacement.

**Reproduced:** command D supplies that leading-zero receipt and a table showing `4101 4101 Thu Sep 17 22:29:08 2026`; signal-0 reports present. `confirmTermination` succeeds, with no extinction observation:

```text
noncanonical PID prefix: accepted and CONFIRMED despite the same process still present; signals: [{"pid":-4101,"signal":0}]
```

**Impact:** malformed durable evidence is accepted and can falsely clear an extant group. The approved reader must reject noncanonical identities rather than infer replacement from spelling differences.

**Minimal fix:** require the textual PID prefix to equal `String(pid)` (and keep canonical identity validation aligned with the sampler's normalization). Add an independently arranged literal v2 JSON leading-zero case through `DiskConversationRecords.recallClosure`, asserting refusal and no close authority. No migration or process-title matching is needed.

### R4 — P2: Replacement proof does not finish a previously broken PTY generation

**Locations:** `backend/src/infrastructure/pty-live-sessions.ts:333–337`, `543–548`, `365–370`, `691–698`.

`#wentAway` sets `ended = true` after write/resize failure without establishing root exit. Later `#endRetained` returns immediately on `ended`, so a valid replacement proof neither establishes `rootExited` nor notifies/clears the remaining watchers. Preparation latches `originalGroupGone`, but terminate then refuses until the delayed PTY exit is observed.

**Reproduced:** command C anchors a root, registers a watcher, makes terminal write throw EBADF, then prepares closure against an actual changed-leader snapshot without an exit callback. Terminate refuses with `SessionOwnershipUnverifiable`; watcher-ended count remains zero.

**Impact:** a state with sufficient replacement proof still produces a failed closure, and watcher finalization can be skipped. A subsequent confirm can succeed if replacement evidence remains visible, but that does not repair the missing first-close transition or skipped watcher notification. If the replacement leader disappears, the already established proof should still suffice.

**Minimal fix:** separate proof of original-root death from whether a terminal was previously marked unusable. Establish root exit monotonically on replacement proof and finalize/clear watchers exactly once even for an already-`ended` terminal. Test broken write/resize plus delayed/absent callback, subsequent output, and replacement proof followed by the replacement disappearing.

### R5 — P2: Confirmation loses permission diagnostics and skips independent replacement proof on EPERM

**Locations:** `backend/src/infrastructure/pty-live-sessions.ts:443–459`, `700–710`, `953–965`; projection at `backend/src/infrastructure/ct-api.ts:443–451`.

`#groupAbsent` already translates EPERM/EACCES to `SessionTerminationPermissionDenied`, which has no native `code`. `#confirmOwned` catches it and `#throwProbeFailure` tests only the native `code`, then wraps it as generic `SessionTerminationUnconfirmed`. Startup therefore cannot preserve the intended permission-specific code. It also exits before obtaining the independently valid leader-replacement evidence that the approved plan explicitly permits despite probe errors.

**Reproduced:** command A gives confirmation an anchored receipt, a signal-0 EPERM, and a valid table containing a replacement leader in another PGID. It reports generic `SessionTerminationUnconfirmed` and performs **zero scans**.

**Impact:** restart recovery shows temporary-retry guidance instead of the permission-repair route, and observational startup misses an available safe extinction proof. Explicit close may subsequently obtain proof, but that does not make the startup behavior or diagnostic correct. Several new diagnostics also omit the actual target/session: `#refuseUnverified` says “target ownership” without the target UUID, while send/probe failures name only PGID.

**Minimal fix:** retain the typed permission failure; when an anchor exists, permit one bounded observational replacement check before returning that failure. If proof does not establish extinction, return the original permission-specific error with target/session/PGID and reason. Preserve post-signal bounded grace handling for transient Darwin reap-time EPERM; persistent denial must remain a typed failure and must never mean absence. Add adapter → recovery-failure and startup-projection assertions, plus deterministic transient/persistent post-signal EPERM and EACCES cases. Existing route tests injecting an already-typed exception do not cover this conversion.

### R6 — P2: Required causal A2 regressions are incomplete, and the new frontend retry oracle fails

**Locations:** `backend/__tests__/application/close-coordinating-session.test.ts:167–222`; `backend/__tests__/infrastructure/pty-live-sessions.test.ts:2344–2471`; `backend/__tests__/infrastructure/disk-conversation-records.test.ts:280–350`; `backend/__tests__/infrastructure/spec-freeze-route.test.ts:432–446`; `frontend/src/pages/home/__tests__/Home.coordinatingSession.test.ts:183–229`.

The A2 names exist, but several required assertions do not. Most notably:

1. A2-1 releases the initial write, cuts preparation, then sets `requestCut = null` before the checkpoint write. It never holds that second write to prove terminate cannot run while persistence is pending. The synchronous second-write rejection is valuable but not that ordering oracle. Add a separate checkpoint-write barrier, plus the actual learned-member-during-write case at the adapter boundary.
2. The named A2-2 test switches from the close action to direct adapter calls after the first failure. Its final child retry does not persist CLOSED; it does not independently prove the required exit-probe-failure → failed close → explicit close retry → durable completion sequence. Keep the inherited root-only transient retry and add the distinct child/exit-probe and changed-child recovery cases.
3. A2-4 lacks the explicit retained-owner/other-target conflict and recovered checkpoint conflicts. Its saved-group happy path uses unchanged immediate tables: it does not demonstrate independently fresh KILL evidence rejecting a newly unknown/replaced child after TERM. Add controlled recovered snapshots and mixed retained/recovered sampler/resource variants, preserving one physical scan.
4. A2-5's “conflicting” request is performed after the record is already CLOSED. The CLOSED guard alone satisfies the assertion; removal of member/root conflict checks for REQUESTED records would not fail that test. Arrange literal REQUESTED checkpoints independently; assert removed/changed root/member, target/session/PGID conflicts, exact-latest completion refusal, equal-request idempotency, nested malformed evidence, and no writes on refusal. Preserve literal v1/v2 boundary assertions instead of deriving all expected JSON from the ownership value under test.
5. A2-6 finishes by calling `reserve()` directly; it does not issue the promised next open HTTP request. It covers close/GET literal error bodies well, but does not cover real adapter permission-error startup projection. Add the missing close/open route sequence with doubled actions, paused/failed-close opening refusal, and startup error projection at its owning seam.
6. A2-7 adds only a live failed-close freeze route case. There are no failed-close scenarios in groom, promotion, reslicing, or groom-session route suites, nor Home gate scenarios proving all eligible existing actions remain usable for live and recovered-ended failures while opening stays blocked. Existing generic key/spec/pending cases and the hook's `operationBusy === false` assertion are useful but not the specified connected behavior.
7. A2-8 fails at line 217 in both independent commands: permission text is found while the drawer is still collapsed, and the immediate accessible-role query cannot find `Cerrar sesión`. `useSessionsColumnCollapse` reveals the target in an effect (`:30–34`); finding text is not a barrier for accessible controls. Await the actual visible retry control, keep the assertion, and then exercise both clicks. Add controlled stale-poll/error replacement and newer-target close-reply variants; the new test's fixed backend answer and single target do not prove those dimensions.

**Impact:** the reported green totals cannot substitute for the required safety/liveness oracles, and the frontend result is not independently green. These are the plan's named causal scenarios, not a request for a Cartesian matrix or broader architecture.

**Minimal fix:** complete these boundary assertions and R1–R5 regressions, then rerun the affected focused checks. Preserve assertions for unknown children, delayed PTY callback on the ESRCH-only path, unrelated terminals, and durable completion. Do not solve failures by accepting false closure or removing the failing retry test.

## A2-1–A2-9 audit of actual assertions

| ID | Evidence actually present | Judgment / missing required variant |
|---|---|---|
| A2-1 | Application cuts initial intent, preparation, terminate, and completion; second-write rejection sends nothing; completion retry confirms without another terminate; null request session retains the recorded PGID. | Partial. No separately pending checkpoint-write cut; mismatch coverage is a different target, not the full requested variant set. R6. |
| A2-2 | Inherited `pty-live-sessions.test.ts:1671–1719` proves transient inspection retry through close to CLOSED. New `:2344–2414` proves uncheckpointed member refusal without advancing grace, exit-time EPERM does not poison direct child termination, and another terminal remains writable. | Partial. Named scenario does not complete its records after child retry; changed-child disappearance/retry and deterministic separated exit-probe scenarios absent. |
| A2-3 | `:779–839` closes a retained original after replacement without signalling it; fresh adapter accepts replacement leader under another PGID; `:749–776` covers delayed callback before KILL. | Partial. R1/R4 fail monotonic/finalization variants. Repeated recovered terminate uses the same replacement table, not later original-looking data. Existing ESRCH-only delayed callback refusal remains meaningful (`:619–652`, `:1014–1054`). |
| A2-4 | Recovery test `:217–240` remains observational/INTERRUPTED; application null-terminal retry proceeds. New adapter `:2417–2471` proves duplicate termination joins, exact TERM/KILL, no spawn/listing, and unknown-child refusal. | Partial. Recovery test was renamed but still uses ownership-null evidence. Required identity conflicts, changed-child escalation, and recovered freshness/resource variants are absent. R2/R6. |
| A2-5 | v1 REQUESTED/CLOSED reads; v2 null/root/member writes; monotonic additions; exact-key/version and some malformed-member checks. Production still uses atomic rename. Direct adapter test refuses a member absent from its checkpoint. | Partial. Conflict after CLOSED masks REQUESTED conflict logic; no paused checkpoint enrichment race, no independently arranged exact-latest completion conflict, and noncanonical receipt falsely confirms (R3). Legacy present → later ESRCH explicit retry lacks the prescribed complete scenario. |
| A2-6 | Listening close/GET route asserts literal permission/unverifiable errors; failed null-terminal close is retryable; success clears registry; reservation then succeeds; inherited duplicate and stale target tests remain. | Partial. Actual next open HTTP request and startup diagnostic projection missing; R5 demonstrates why injected errors are insufficient. |
| A2-7 | Failed-close freeze reaches correct root; stale target refuses; reservation stays blocked. Hook separates `blocksOpening` from `operationBusy`; generic panel tests preserve independent gating. | Partial. Other routes and Home live/recovered gate-specific cases absent. Code inspection supports intended shared admission behavior, but the required connected evidence is incomplete. |
| A2-8 | Existing hook tests explicitly reject pre-mutation stale reads and prevent resurrection after confirmed close. New Home scenario arranges permission → identity refusal → success, retaining disabled opening and null-terminal retry. | Fails independently before the first click (`:217`). Stale newer-target close reply and controlled stale diagnostic poll are not established by this new test. |
| A2-9 | Real `:382–405` checkpoints root+child, terminates through a fresh adapter with default inspector, proves parent/child/group absence, no second-adapter spawn/listing, and unrelated terminal echo. Fixture parent and child resist TERM; cleanup is registered in afterEach. | Pass for the specified integration happy path on Darwin. No Linux claim. No claim this tests disk publication or hostile receipt input. |

## Preserved behavior and limits

- `CloseCoordinatingSession.execute` correctly orders initial intent → preparation → awaited checkpoint → terminate → awaited completion. Null request session no longer blocks a retry that retains durable session/PGID. CLOSED is idempotent. Recovery remains observational and does not resume requested closure.
- `#signalDecision` requires every current member in both original evidence and the offered checkpoint; an original root after restart does not grant permission to adopt unsaved children. Child mismatch, leaderless unknown membership, and legacy missing anchors remain fail-closed. No new abandon/delete/optimistic-success route was added.
- Ordinary retained absence still requires PTY exit; existing delayed-callback tests retain that oracle. Confirmed absence and normal completion-write retries remain latched. R1/R2/R4 identify the new gaps, not a blanket rejection of the design.
- Shared sampler constants, asynchronous default exec, callback-plus-child-close release, strict whole-table parsing, batched parser yield, separate fresh TERM/KILL requests, negative-PGID targeting, no output-triggered scan, and generation guards remain. Inherited tests exercise execution/request deadlines, delayed reap, failed default stdout, shared-interest retirement, and fresh pre-KILL validation. The full A2 first-close/retry budget and recovered mixed-interest variants are not newly demonstrated by changing a real-time failure assertion to `5 * timeout`.
- v2 records are sorted/frozen through the ownership value; sequential disk enrichment preserves prior entries, and completion compares the exact checkpoint. `ct-api.ts:605–610` still supplies `Disk.atomicWrite`; `:161–169` writes a unique temporary file then renames it. This is process-crash publication, not a new fsync/power-loss guarantee. No unrequested multi-process persistence-lock redesign is required by this judgment.
- Shared backend target admission allows only IDLE/CLOSE_FAILED, with target/key/spec/pending checks retained. Frontend `operationBusy` no longer includes close-failed, while `blocksOpening` still does. Existing-work gates and groom-terminal opening stay distinct. The diff adds no Git cleanup, headless cancellation, issue mutation, or unrelated terminal termination; unrelated-terminal tests remain green.
- Frontend mutation generations and closed-target suppression remain; explicit-close error retention addresses an older poll overwriting a fresh refusal. Acceptance still needs the controlled assertions above, rather than assuming a single-target fixed response proves all stale-result behavior.
- POSIX leader-PID reuse is the approved narrow proof and applies only to the same host/PID namespace. One-second lstart precision, non-atomic ps/kill, invisible or missed kernel data, children entirely between samples, unknown leaderless groups, legacy anchor gaps, and permission denial remain acknowledged limits. The review requests neither a supervisor nor guaranteed immediate application-only clearance for those states.
- A1 cannot read v2 on downgrade; fail-closed compatibility is documented. Linux and clean-checkpoint mutation verification remain unavailable/deferred, not passed.

## Independent commands and results

Repository root:

```sh
git status --short && git diff --stat 83304d9d && git diff --name-only 83304d9d
git diff 83304d9d -- backend/src frontend/src/app
git diff 83304d9d -- backend/__tests__ frontend/src/pages
git diff --check && git status --short --branch
```

The initial status had the implementation's existing modified files and untracked ownership module. Whitespace passed. Full outputs of the two large diff commands were inspected with the read tool when truncated by the harness. Planning documents were read completely, including all A1 amendments.

From `backend/`:

```sh
npm run typecheck && npx vitest run __tests__/application/close-coordinating-session.test.ts __tests__/application/recover-coordinating-session.test.ts __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/disk-conversation-records.test.ts __tests__/infrastructure/coordinating-session-close-route.test.ts __tests__/infrastructure/coordinating-session-route.test.ts __tests__/infrastructure/coordinating-sessions.test.ts __tests__/infrastructure/spec-freeze-route.test.ts __tests__/infrastructure/epic-groom-route.test.ts __tests__/infrastructure/epic-promotion-route.test.ts __tests__/infrastructure/spec-reslicing-route.test.ts __tests__/infrastructure/groom-session-route.test.ts
npx vitest run __tests__/infrastructure/pty-live-sessions-real-process.test.ts __tests__/infrastructure/session-channel-real-process.test.ts
```

Typecheck passed. Focused: **12 files / 229 tests passed**, 7.64 s. Expected deliberately injected route-error stderr was non-failing. Real: **2 files / 13 tests passed**, 6.19 s, Darwin.

From `frontend/`:

```sh
npx vitest run src/app/coordinating-session/useCoordinatingSession.test.ts src/pages/home/__tests__/Home.coordinatingSession.test.tsx src/pages/home/__tests__/Home.specFreeze.test.tsx src/pages/home/__tests__/Home.epicGroom.test.tsx src/pages/home/__tests__/Home.gateSequence.test.tsx src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.test.tsx
npx vitest run src/pages/home/__tests__/Home.coordinatingSession.test.tsx -t 'closure retry guidance remains usable until confirmation clears only the old target'
```

Focused: **5 files passed / 1 failed; 76 tests passed / 1 failed**, 3.60 s. Isolated: **1 failed / 12 skipped**, 1.90 s. Both fail at `Home.coordinatingSession.test.ts:217`, missing accessible `Cerrar sesión`; DOM shows `drawer--collapsed`. Canvas diagnostics in the focused run were separate from this assertion failure.

Sol's backend fast **2313**, full **2369**, frontend full **1439**, and build-pass results remain implementer-reported evidence. They were not redundantly rerun or represented as independent passes.

## Executed reproduction commands

All four ran from `backend/` using production imports, injected process-table/signal/PTY doubles, and no filesystem writes or real destructive signals. Timers were cleared and retained fake terminal exit callbacks invoked in `finally` where relevant. These are reproductions, not edits to repository tests.

### Command A — permission projection and conflicting recovered confirmation

```sh
node --input-type=module <<'NODE'
import { PtyLiveSessions } from './src/infrastructure/pty-live-sessions.ts'
import { SessionClosure } from './src/domain/value-objects/session-closure.ts'
import { SessionProcessOwnership } from './src/domain/value-objects/session-process-ownership.ts'
import { ConversationId } from './src/domain/value-objects/conversation-id.ts'
const keepAlive = setInterval(() => {}, 1000)
const root = '4101:Thu Sep 17 22:29:08 2026'
const replacement = '4101:Thu Sep 17 22:29:10 2026'
const receipt = (identity = root) => new SessionClosure({ conversation: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'), target: '6d13bc52-740f-49f8-b128-15e597674f3a', session: 'saved', processGroup: 4101, status: 'requested', ownership: new SessionProcessOwnership({rootIdentity: identity, members: [{pid: 4101, identity}]}) })
const adapter = (overrides = {}) => new PtyLiveSessions({spawn: () => {throw Error('unexpected spawn')}, newId: () => 'saved', stderr: () => {}, signal: () => {}, sleep: async () => {}, now: () => 0, termGraceMs: 0, killGraceMs: 0, pollMs: 1, inspectProcessTable: async () => '4101 4101 Thu Sep 17 22:29:08 2026\n', ...overrides})
try {
  let scans = 0
  const denied = adapter({ signal: () => {throw Object.assign(Error('denied'), {code: 'EPERM'})}, inspectProcessTable: async () => { scans++; return '4101 9999 Thu Sep 17 22:29:10 2026\n' } })
  try { await denied.confirmTermination(receipt()) } catch (error) { console.log('permission confirmation:', error.constructor.name, 'scans:', scans, 'message:', error.message) }
  let table = '4101 4101 Thu Sep 17 22:29:08 2026\n'
  const recovered = adapter({inspectProcessTable: async () => table})
  try { await recovered.confirmTermination(receipt()) } catch (error) { console.log('original confirmation:', error.constructor.name) }
  table = '4101 4101 Thu Sep 17 22:29:10 2026\n'
  await recovered.confirmTermination(receipt(replacement))
  console.log('conflicting recovered receipt: CONFIRMED although its own root is present')
  await recovered.terminate(receipt(replacement))
  console.log('conflicting receipt cached: terminate returned success')
} finally { clearInterval(keepAlive) }
NODE
```

### Command B — forgotten background replacement proof

```sh
node --input-type=module <<'NODE'
import { PtyLiveSessions } from './src/infrastructure/pty-live-sessions.ts'
import { ConversationId } from './src/domain/value-objects/conversation-id.ts'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const conversation = new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
let onExit, scans = 0, absent = false
let table = '4101 4101 Thu Sep 17 22:29:08 2026\n'
const signals = []
const sessions = new PtyLiveSessions({spawn: () => ({pid: 4101, onData() {}, onExit(callback) {onExit = callback}, write() {}, resize() {}}), newId: () => 'saved', stderr() {}, signal(pid, signal) { if (signal !== 0) {signals.push({pid, signal}); absent = true; onExit()} if (absent) throw Object.assign(Error('gone'), {code: 'ESRCH'}) }, sleep: pause, now: Date.now, termGraceMs: 10, killGraceMs: 10, pollMs: 1, inspectProcessTable: async () => {scans++; return table}})
const session = sessions.open(PtyLiveSessions.loginShell('/bin/sh', '/tmp', {}))
try {
  while (scans < 1) await pause(5)
  await pause(5)
  const receipt = sessions.terminationEvidence({conversation, target: '6d13bc52-740f-49f8-b128-15e597674f3a', session})
  table = '4101 4101 Thu Sep 17 22:29:10 2026\n'
  while (scans < 2) await pause(5)
  await pause(5)
  console.log('completed replacement background observation; scans:', scans)
  table = '4101 4101 Thu Sep 17 22:29:08 2026\n'
  const keeper = setInterval(() => {}, 1000)
  try { await sessions.terminate(receipt) } finally {clearInterval(keeper)}
  console.log('signals after already observed leader replacement:', JSON.stringify(signals))
} finally {absent = true; onExit()}
NODE
```

### Command C — broken PTY plus replacement proof

```sh
node --input-type=module <<'NODE'
import { PtyLiveSessions } from './src/infrastructure/pty-live-sessions.ts'
import { ConversationId } from './src/domain/value-objects/conversation-id.ts'
const keeper = setInterval(() => {}, 1000)
let exit, scans = 0
let table = '4101 4101 Thu Sep 17 22:29:08 2026\n'
const signals = []
const sessions = new PtyLiveSessions({spawn: () => ({pid: 4101, onData() {}, onExit(callback) {exit = callback}, write() {throw Error('EBADF')}, resize() {}}), newId: () => 'saved', stderr() {}, signal(pid, signal) {signals.push({pid, signal})}, sleep: async () => {}, now: () => 0, termGraceMs: 0, killGraceMs: 0, pollMs: 1, inspectProcessTable: async () => {scans++; return table}})
try {
  const session = sessions.open(PtyLiveSessions.loginShell('/bin/sh', '/tmp', {}))
  while (scans < 1) await new Promise(resolve => setTimeout(resolve, 5))
  await new Promise(resolve => setTimeout(resolve, 5))
  const receipt = sessions.terminationEvidence({conversation: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'), target: '6d13bc52-740f-49f8-b128-15e597674f3a', session})
  let ended = 0
  sessions.watch({session, onBytes() {}, onEnded() {ended++}})
  try {sessions.write({session, text: 'test'})} catch {}
  table = '4101 4101 Thu Sep 17 22:29:10 2026\n'
  const prepared = await sessions.prepareTermination(receipt)
  try {await sessions.terminate(prepared)} catch (error) {console.log('replacement after broken PTY:', error.constructor.name, error.message)}
  console.log('watchers ended after replacement proof:', ended)
} finally {exit(); clearInterval(keeper)}
NODE
```

### Command D — noncanonical persisted identity

```sh
node --input-type=module <<'NODE'
import { PtyLiveSessions } from './src/infrastructure/pty-live-sessions.ts'
import { SessionClosure } from './src/domain/value-objects/session-closure.ts'
import { SessionProcessOwnership } from './src/domain/value-objects/session-process-ownership.ts'
import { ConversationId } from './src/domain/value-objects/conversation-id.ts'
const keeper = setInterval(() => {}, 1000)
try {
  const identity = '04101:Thu Sep 17 22:29:08 2026'
  const closure = new SessionClosure({conversation: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'), target: '6d13bc52-740f-49f8-b128-15e597674f3a', session: 'saved', processGroup: 4101, status: 'requested', ownership: new SessionProcessOwnership({rootIdentity: identity, members: [{pid: 4101, identity}]})})
  const signals = []
  const sessions = new PtyLiveSessions({spawn() {throw Error('unexpected spawn')}, newId: () => 'unused', stderr() {}, signal(pid, signal) {signals.push({pid, signal})}, sleep: async () => {}, now: () => 0, termGraceMs: 0, killGraceMs: 0, pollMs: 1, inspectProcessTable: async () => '4101 4101 Thu Sep 17 22:29:08 2026\n'})
  await sessions.confirmTermination(closure)
  console.log('noncanonical PID prefix: accepted and CONFIRMED despite the same process still present; signals:', JSON.stringify(signals))
} finally {clearInterval(keeper)}
NODE
```

## Acceptance handback

Resolve R1–R5, complete the missing causal assertions in R6, and obtain a green focused frontend run. Rejudge the changed boundaries against these reproductions and the original A2 contract. Keep Slice 2 **EN PROGRESO** until coordinator completion. The residual legacy/unknown-membership limitations remain honest and are not themselves reasons to reject the approved scope.

## Superseding A2 rejudgment — round 2, 2026-09-18

### Verdict: REQUEST_CHANGES — two narrow remaining items

This section supersedes the first judgment's active findings; all preceding text remains review history. **R1–R4 are resolved. R5's permission classification and replacement-proof defects are resolved, with one contextual diagnostic path still incomplete. R6 is substantially addressed, with the explicitly requested checkpoint-write/member-learning race still missing.** Slice 2 remains **EN PROGRESO**, with completion reserved for the coordinator.

Independent verification is now green: backend typecheck, **239/239** focused backend tests, **87/87** focused frontend tests, and **13/13** Darwin real-process tests. The formerly failing Home retry case passes as part of the focused run. No broad suite or isolated repeat was needed after that pass.

### Remaining R5a — P2: Pre-signal absence-probe denial still lacks target/session context

**Current locations:** `backend/src/infrastructure/pty-live-sessions.ts:583–584`, `1023–1034`; compare the contextual translation at `:767–773`.

The confirmation and post-signal grace paths now call the contextual permission translator correctly. The pre-signal decision does not: when a valid table lacks the owned PGID, `#signalDecision` calls `#groupAbsent` directly. EPERM/EACCES escapes with the low-level PGID-only diagnostic. This is the same missing-context portion of R5, not a new diagnostic requirement.

**Independently reproduced:** saved anchored receipt, valid process table containing only another group, and signal-0 EPERM. `terminate` refuses safely, but the message is:

```text
SessionTerminationPermissionDenied process group 4101 inspection permission denied: Error: denied
```

It names neither target `6d13bc52-740f-49f8-b128-15e597674f3a` nor session `saved`. The close route forwards this message as `detail`, so this foreground refusal does not meet the approved target/session/PGID diagnostic contract. The error class and Spanish guidance are correct; no unsafe signal or false closure was observed in this case.

**Minimal fix:** translate that foreground probe failure using the available closure context, as confirmation and grace already do. Keep the cheap/background probe helper independent of closure data. Extend the existing foreground absence-probe test (`pty-live-sessions.test.ts:2194–2226`) to assert the permission subclass and target/session/PGID/reason for EPERM/EACCES, while preserving no destructive signal and REQUESTED status. No extra recovery framework or retry policy is needed.

### Remaining R6a — P2: The pending checkpoint-write/member-learning race is still not asserted

**Current locations:** `backend/__tests__/application/close-coordinating-session.test.ts:169–190`; `backend/__tests__/infrastructure/pty-live-sessions.test.ts:341–355`, `1547–1609`, `2619–2628`.

The application now has a real separate `checkpointCut`: it proves terminate is not called while the second write is pending. The adapter's existing direct test prepares a checkpoint, introduces member 5001, and proves that checkpoint cannot authorize it. Both assertions are useful and are credited.

Neither assertion executes the specifically requested race: a second checkpoint write held pending while a successful anchored background observation learns a new child, then release of that write followed by the mandatory fresh TERM observation. The adapter `ClosureRecords` double still has one `requestRelease` that is resolved for the initial intent; its T3 path uses only the original root throughout. The direct test at `:2619` never writes its prepared checkpoint through the close action. The immutable snapshot and disk-ordering interaction named in the original R6 request is consequently still missing from the delivered regression suite.

**Impact:** current production code appears to maintain the correct separation, but the approved race oracle is not delivered. This is a regression-evidence finding, not a claim that a new unsafe signal has been reproduced.

**Minimal completion:** one controlled adapter test through the existing close action and doubled records: hold the second write; complete an anchored background snapshot learning a child absent from that pending immutable checkpoint; assert no destructive signals during the write; release it; serve a fresh table containing that child; assert refusal, durable REQUESTED, and zero TERM/KILL. Then explicitly retry, persist the monotonic enriched checkpoint, and prove exact-group closure succeeds. This is the single already-requested causal scenario, not a request to multiply route or Home test combinations.

### Resolved findings and assertions actually inspected

| Finding | Current evidence and resolution |
|---|---|
| R1 | `#applyObservation(:507–520)` receives the full snapshot, latches replacement, finalizes the original PTY, and removes periodic interest behind the retained-generation guard. The regression at `pty-live-sessions.test.ts:845–886` covers same-PGID and different-current-PGID replacement, stops later scans, and sends no destructive signal. Independent re-execution also changed the table back to original-looking data before terminate/confirm: zero destructive signals and one finalization. **Resolved.** |
| R2 | `#matchingContext(:631–639)` validates recovered contexts; `#requireContextCheckpoint(:711–723)` compares the entire saved checkpoint including null; retained compatibility checks root plus all offered members before binding; `#isConfirmed(:491–496)` validates the exact checkpoint before cached success. Tests `:938–998` refuse recovered root/member/null conflicts without additional inspection, refuse conflicting confirmed receipts, reject another target borrowing a bound retained owner, and keep the legitimate retained receipt usable. Independent original-root/changed-root confirmation and cache reproductions now refuse the conflicting receipt. **Resolved.** |
| R3 | `SessionProcessOwnership.pidOf(:35–42)` rejects leading-zero PID prefixes and noncanonical day/hour spelling. The literal malformed v2 ownership case at `disk-conversation-records.test.ts:433–443` reaches the real reader; independent construction of the former `04101:` receipt now throws before inspection. **Resolved.** |
| R4 | `#endRetained(:758–765)` establishes root exit even for a previously unusable terminal, then clears watchers. Tests `pty-live-sessions.test.ts:888–935` separately break write and resize, prove replacement closure, deliver late bytes and callbacks, remove the replacement leader, and assert exactly one ended notification per terminal and no delivered late bytes or destructive signal. Independent broken-PTY replay agrees. **Resolved.** |
| R5 core | `#confirmOwned(:444–479)` retains probe failure while checking independent replacement proof; `#throwProbeFailure(:767–773)` preserves typed permission failures. Tests `:1000–1069` establish one replacement scan despite EPERM, contextual typed refusal for unchanged ownership, transient reap-time EPERM success without KILL, and persistent EPERM/EACCES failure after exactly the TERM grace. The independent reproduction confirms these paths. **Resolved except R5a above.** |
| R6 ordering/retry | Separate application checkpoint-write barrier now blocks terminate. The named adapter retry now uses `close.execute` for the denied child close and subsequent permitted retry, and asserts durable CLOSED plus the unrelated terminal remaining writable (`:2630–2649`). The inherited transient root-inspection retry also remains. **Resolved except R6a above.** |
| R6 persistence/restart | REQUESTED checkpoints are independently supplied to the disk reader rather than produced by the adapter under test. Equal requests do not write; removed members, changed root/member/target/session/PGID refuse; completion against an older subset refuses; final no-write assertions pin the refusals (`disk-conversation-records.test.ts:345–392`). Recovered escalation introduces an unknown child during TERM grace and asserts no KILL (`pty-live-sessions.test.ts:2706–2727`). Mixed retained preparation/recovered termination share one physical scan (`:2730–2774`). These now exercise the missing causal boundaries. |
| R6 routes/gates | A pending close receives an actual next-open HTTP 409; a completed null-terminal close is followed by actual open HTTP 202 and one open action call. Added groom/promotion/reslicing failed-close route tests assert correct action/root; groom-terminal opening remains 409 without action invocation. Existing target/key/spec/pending refusal tests remain; no new Cartesian matrix is required. Home tests exercise live and recovered-ended failed-close freeze/groom/promotion/reslicing eligibility, disabled form, and disabled groom opener where offered. |
| R6 frontend retry/staleness | The Home retry test awaits the accessible close control and retains both clicks/error/disabled-form/confirmed-cleanup assertions. It passes independently in the focused suite. The new hook test holds an old poll and an explicit refusal separately, then proves the fresh identity diagnostic is not replaced by the persisted permission error. Another test rejects a mismatched close identity and reconciles the newer target/diagnostic without clearing it. Existing stale-before-close and closed-target suppression tests remain. |

### Production recovery seam and atomic wiring

Read the complete new `backend/src/infrastructure/coordinating-session-recovery.ts`, not just its test. It extracts the existing startup projection's NONE, UNRESUMABLE, INTERRUPTED, and LIVE branches. INTERRUPTED preserves the saved target, ended/null-session state, and reserved failed-close operation; the typed permission/unverifiable projections precede the generic fallback. This module adds no resume, signal, inspection, disk write, or executable-server import.

`ct-api.ts:672–674` invokes **this same production seam** on `await recoverCoordinatingSession.execute()`; there is no duplicate private projection left behind. `coordinating-sessions.test.ts:171–198` asserts its permission code/detail. `recover-coordinating-session.test.ts:241–249` proves the application retains the typed failure instance in INTERRUPTED without completing closure. Together with the adapter test this covers the conversion at each owning boundary, without a refusal integration test importing the executable server.

`ct-api.ts:536–540` still constructs `DiskConversationRecords` with `write: Disk.atomicWrite`. `Disk.atomicWrite(:150–158)` still writes a unique temporary file then atomically renames it and cleans the temporary path. Its implementation is unchanged in the actual baseline diff. Recovery extraction has not changed closure publication, completion-before-acknowledgement, or the process-crash versus fsync/power-loss guarantee.

### Independent round-2 commands and outcomes

From the repository root:

```sh
git status --short && git diff --stat 83304d9d
git diff 83304d9d -- backend/src/infrastructure/ct-api.ts backend/__tests__ frontend/src
git diff 83304d9d -- backend/src/infrastructure/pty-live-sessions.ts backend/src/infrastructure/disk-conversation-records.ts backend/src/application/actions/close-coordinating-session.ts backend/src/domain
git diff --check && git hash-object backend/src/infrastructure/pty-live-sessions.ts backend/src/domain/value-objects/session-process-ownership.ts backend/src/infrastructure/coordinating-session-recovery.ts backend/src/infrastructure/ct-api.ts
```

Both new untracked modules were read directly. Reviewed blob hashes, in the last command's order:

```text
a9e9f510bf135ade77d425fdd97cfb19aa1dafc9
d2c777872080c783a670b9eb2c89e74bed4f2303
1e7ecd896c65c5e46f8e0afafc326690902b6b0f
bac1ff5a598da73789ff6eafb76405141ad280b1
```

From `backend/`:

```sh
npm run typecheck && npx vitest run __tests__/application/close-coordinating-session.test.ts __tests__/application/recover-coordinating-session.test.ts __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/disk-conversation-records.test.ts __tests__/infrastructure/coordinating-session-close-route.test.ts __tests__/infrastructure/coordinating-session-route.test.ts __tests__/infrastructure/coordinating-sessions.test.ts __tests__/infrastructure/spec-freeze-route.test.ts __tests__/infrastructure/epic-groom-route.test.ts __tests__/infrastructure/epic-promotion-route.test.ts __tests__/infrastructure/spec-reslicing-route.test.ts __tests__/infrastructure/groom-session-route.test.ts
npx vitest run __tests__/infrastructure/pty-live-sessions-real-process.test.ts __tests__/infrastructure/session-channel-real-process.test.ts
```

Typecheck passed. Focused **239/239**, 12 files, 8.29 s. Real-process **13/13**, 2 files, 6.14 s. Expected injected route stderr did not fail tests.

From `frontend/`:

```sh
npx vitest run src/app/coordinating-session/useCoordinatingSession.test.ts src/pages/home/__tests__/Home.coordinatingSession.test.tsx src/pages/home/__tests__/Home.specFreeze.test.tsx src/pages/home/__tests__/Home.epicGroom.test.tsx src/pages/home/__tests__/Home.gateSequence.test.tsx src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.test.tsx
```

Focused **87/87**, 6 files, 3.75 s, including the previously failing test. One existing jsdom canvas diagnostic was non-failing. No reason arose to rerun the broad suites or build: backend fast **2326**, full **2382**, frontend full **1449**, build, and isolated-case pass remain Sol's reported results.

Two `node --input-type=module` heredoc commands additionally used production imports and signal/PTY/process-table doubles. They reconstructed the original A–D scenarios with `node:assert/strict`: R2 conflict and cache calls must reject; R3 construction must throw; R5 proof must complete in one scan while unchanged EACCES remains typed/contextual; R1/R4 must send no destructive signal, finalize once, and deliver no late bytes. Both commands completed successfully, with these outputs:

```text
R2: conflicting recovered and cached receipts refused
R3: noncanonical receipt rejected
R5: EPERM plus independent replacement proof confirmed in one scan
R5: unchanged group preserves typed, contextual permission diagnostic
pre-signal missing-table diagnostic: SessionTerminationPermissionDenied process group 4101 inspection permission denied: Error: denied
R1: background replacement stayed gone across original-looking data; zero destructive signals
R4: broken PTY finalized exactly once; late data/callback ignored
```

The minimal remaining R5a reproduction, equivalent to the last case of the first executed command, is:

```sh
node --input-type=module <<'NODE'
import { PtyLiveSessions } from './src/infrastructure/pty-live-sessions.ts'
import { SessionClosure } from './src/domain/value-objects/session-closure.ts'
import { SessionProcessOwnership } from './src/domain/value-objects/session-process-ownership.ts'
import { ConversationId } from './src/domain/value-objects/conversation-id.ts'
const keep = setInterval(() => {}, 1000)
try {
  const root = '4101:Thu Sep 17 22:29:08 2026'
  const receipt = new SessionClosure({
    conversation: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    target: '6d13bc52-740f-49f8-b128-15e597674f3a', session: 'saved',
    processGroup: 4101, status: 'requested',
    ownership: new SessionProcessOwnership({ rootIdentity: root, members: [{ pid: 4101, identity: root }] }),
  })
  const sessions = new PtyLiveSessions({
    spawn() { throw Error('unexpected spawn') }, newId: () => 'saved', stderr() {},
    signal() { throw Object.assign(Error('denied'), { code: 'EPERM' }) },
    sleep: async () => {}, now: () => 0, termGraceMs: 0, killGraceMs: 0, pollMs: 1,
    inspectProcessTable: async () => '9999 9999 Thu Sep 17 22:29:08 2026\n',
  })
  try { await sessions.terminate(receipt) }
  catch (error) { console.log(error.constructor.name, error.message) }
} finally { clearInterval(keep) }
NODE
```

### Scoped handback

Finish **R5a's foreground diagnostic context and R6a's one checkpoint race regression**, then rejudge those changes. R1–R4 and the resolved portions of R5/R6 do not need to be reopened absent a relevant change or failure. No new architectural or platform requirements are introduced. Existing Linux, clean-checkpoint mutation, same-host identity, sampling, non-atomic ps/kill, and honest legacy/unknown-member limitations remain as previously recorded. The judge changed only review/log documentation and used no delegation, Orca, commit, push, or control bypass.

## Final scoped A2 judgment — round 3, 2026-09-18

### Final superseding verdict: APPROVE — ready for the dedicated A2 commit

**R5a and R6a are resolved. All previously raised A2 findings are now resolved.** This supersedes both earlier REQUEST_CHANGES judgments while preserving them as history. Slice 2 remains **EN PROGRESO** until the coordinator performs the authorized completion/commit step. The judge has not committed anything.

Scope of this final pass: the two residuals and regression risk from the actual final edits. Previously resolved behavior was not reopened into a new checklist.

### R5a: Contextual foreground permission refusal — resolved

`backend/src/infrastructure/pty-live-sessions.ts:583–596` now catches failure from the pre-signal absence probe and invokes the existing closure-aware `#throwProbeFailure`. EPERM/EACCES retain their permission-specific class and target/session/PGID/reason. The successful-absence latch and present-but-missing-table refusal remain unchanged; no await is introduced between fresh validation and destructive signalling. Background probes still require no closure context.

The actual parameterized assertions at `backend/__tests__/infrastructure/pty-live-sessions.test.ts:2310–2349` exercise both EPERM and EACCES through the real close action and adapter after bootstrap/preparation. They assert `SessionTerminationPermissionDenied`, the actual target, actual session ID, group 4101, original OS reason, durable REQUESTED, and an empty destructive-signal list. These assertions cover the previously reproduced missing-context path, not merely an injected route error. Both passed independently.

### R6a: Pending checkpoint write and background child learning — resolved

Read the complete causal test at `backend/__tests__/infrastructure/pty-live-sessions.test.ts:1624–1725` and the modified records double at `:341–373`.

The test now establishes all requested transitions:

1. Bootstrap and preparation observe only the anchored original root, then the **second** `requestClosure` is paused before its checkpoint is published.
2. A separate periodic snapshot learns child 5001 while that write remains blocked. The test asserts `requestCount === 2`, scan-free retained evidence containing root plus child, and zero destructive signals (`:1655–1670`). This proves learning actually happened during the cut.
3. Releasing the immutable root-only checkpoint is followed by a separately controlled fresh TERM observation containing both members. The first close refuses with `SessionOwnershipUnverifiable`, keeps the root-only checkpoint REQUESTED, and sends no TERM/KILL (`:1672–1685`).
4. An explicit close-action retry separately confirms, prepares enriched evidence, and requests fresh TERM inspection. **Inside the signal callback**, the test asserts the root-plus-child checkpoint is already REQUESTED on the records boundary (`:1699–1705`).
5. The final assertions require CLOSED with enriched evidence, exactly one SIGTERM to `-4101`, and no SIGKILL (`:1714–1724`).

The records double preserves its prior asynchronous `requestRelease` yield for later writes while adding a second-write barrier; it does not publish the second checkpoint before that barrier resolves. Running the entire affected adapter/application suites also checks the inherited ordering cases affected by this double change. No production persistence or sampler scheduling change was needed for this regression.

### Regression review and independent evidence

The final production change is the foreground probe's contextual error translation; the sampler, receipt compatibility, finalization, and signal targeting reviewed in round 2 retain their behavior. The new ownership value, recovery seam, entrypoint, and frontend lifecycle hook retain their prior reviewed content hashes. In particular, the production recovery invocation and atomic-write wiring remain as accepted in round 2.

Independent command from `backend/`:

```sh
npm run typecheck && npx vitest run __tests__/infrastructure/pty-live-sessions.test.ts __tests__/application/close-coordinating-session.test.ts
```

**PASS:** typecheck; **2 test files / 80 tests**, 9.01 seconds. This includes both contextual permission variants, the complete checkpoint race/retry, and inherited adapter/application regressions. `git diff --check` also passed before and after documentation updates.

Repository inspection commands:

```sh
git status --short && git diff 83304d9d -- backend/src/infrastructure/pty-live-sessions.ts
git hash-object backend/src/domain/value-objects/session-process-ownership.ts backend/src/infrastructure/coordinating-session-recovery.ts backend/src/infrastructure/ct-api.ts frontend/src/app/coordinating-session/useCoordinatingSession.ts && git diff --check
git hash-object backend/src/infrastructure/pty-live-sessions.ts backend/__tests__/infrastructure/pty-live-sessions.test.ts backend/__tests__/application/close-coordinating-session.test.ts && git diff --check
```

Reviewed final hashes:

| File | Git content hash |
|---|---|
| `backend/src/infrastructure/pty-live-sessions.ts` | `4fa97735fdc7abbeac6a523397aadd5e201a7d19` |
| `backend/__tests__/infrastructure/pty-live-sessions.test.ts` | `9efaf2f463973c3fcb2400b4ca590c341d3b50b2` |
| `backend/__tests__/application/close-coordinating-session.test.ts` | `1b77fc3ad43f9c6abd7bc7d8f74ebf620fdf9e74` |
| `backend/src/domain/value-objects/session-process-ownership.ts` | `d2c777872080c783a670b9eb2c89e74bed4f2303` |
| `backend/src/infrastructure/coordinating-session-recovery.ts` | `1e7ecd896c65c5e46f8e0afafc326690902b6b0f` |
| `backend/src/infrastructure/ct-api.ts` | `bac1ff5a598da73789ff6eafb76405141ad280b1` |
| `frontend/src/app/coordinating-session/useCoordinatingSession.ts` | `3c01cad1b9823d29b30c873815ac3247db7db989` |

An initial attempt to run `git diff a9e9f510bf135ade77d425fdd97cfb19aa1dafc9 -- backend/src/infrastructure/pty-live-sessions.ts` failed with `bad object`: the prior `git hash-object` invocation recorded a content hash without storing its object. No comparison result is claimed from that failed command. The actual baseline diff and current source were reviewed against the previously recorded source, and unchanged modules were checked by their hashes.

Sol's final focused **241**, real-process **13**, fast **2328**, full **2384**, and prior unchanged frontend **1449/build** remain implementer-reported results. No concern justified repeating broad or frontend suites in this scoped pass. Prior independent round-2 focused/frontend/real results remain recorded above.

No new findings. No production/test edits, commits, pushes, delegation, Orca, flags, or control bypass by the judge. No repository control refused. Existing Linux, clean-checkpoint mutation, same-host identity, sampling, and non-atomic inspection/signal qualifications remain unchanged. **A2 is ready for the coordinator's dedicated commit.**
