# Live-session review fixes: Developer specification

> Review-facing contract distilled from [plan.md](plan.md). If this matches the intended behavior, you do not need to read the implementation plan; every slice carries its tests. A1 is accepted at `83304d9d`; A2 is planned below. English Gherkin follows this repository's language rule.

## What will happen

- Terminal output stops triggering synchronous process-table scans. One asynchronous sampler serves all live roots, including quiet sessions.
- Fresh identity checks and durable ownership checkpoints protect each TERM/KILL, including explicit restart retries without a terminal. T1–T12 (with declared A2 amendments) and A2-1–A2-9 are the oracles.
- Failed closure retains usable retry and eligible current-work gates. New sessions remain blocked until truthful durable completion; proven leader replacement can confirm the old group gone without signalling the replacement.

## Flags and parallel change

| Flag | Purpose | Rollout | End of life |
|---|---|---|---|
| None | Direct A1/A2 implementation, as requested | Sequential slices after verification | Not applicable |

This is one adapter replacement, not a dual-runtime rollout. The expand → verify → switch → contract sequence maps entirely to Slice 1: add controlled asynchronous regression fixtures; verify the bounded sampler and ownership rules; make the uninjected production default asynchronous; remove the synchronous inspector and output-triggered scans. There is no flag-switch stage or permanent legacy implementation.

A2 expands the closure reader to v1/v2, verifies durable checkpoint/retry behavior, switches writes to v2, and removes irreversible uncertainty plus failed-close gate blocking. Keep the v1 reader; no bulk migration. A1 cannot read new v2 records on downgrade and fails closed. No new dependency or supervisor.

Watch scan concurrency, exact negative-PGID targets, checkpoint-before-signals, completion-before-acknowledgement, HTTP/SSE progress, and gate eligibility. No production shadow comparator is specified. A2 inspection/grace bounds are `5 * INSPECTION_REQUEST_TIMEOUT_MS + termGraceMs + killGraceMs` for first close and `6 * INSPECTION_REQUEST_TIMEOUT_MS + termGraceMs + killGraceMs` for retry, plus scheduling; durable I/O is separate. Unsent signals consume no grace.

## Final architecture

```text
Before
PTY output / open / evidence / exit / pre-signal checks
  -> PtyLiveSessions -> execFileSync(ps) -> blocked API event loop

After
PTY output -> bounded scrollback + watchers
open -> register ownership + listeners -> asynchronous bootstrap
eligible roots -> one shared periodic sampler -> asynchronous execFile(ps)
durable close intent -> prepare/checkpoint original identities -> fresh TERM inspection -> exact group TERM
                    -> grace -> fresh KILL inspection -> exact group KILL
PTY exit + ESRCH OR proven leader replacement -> confirmed termination -> durable completion
restart -> observational recovery -> explicit retry using saved members -> same bounded sampler
close-failed -> opening remains reserved; current-work gates apply their own eligibility
```

Deleted by A1: synchronous inspection and output-triggered scans. A2 removes permanent `signalAuthority` revocation and adds async `prepareTermination`; synchronous `terminationEvidence` stays scan-free. A2 additionally touches the closure/ownership values, ports, close action, disk records, error catalogue, close/startup projections, target admission, frontend lifecycle hook and product errors. Exact paths and boundary tests are in the plan's Slice 2 file scope.

New adapter conventions: constructor-injected `inspectProcessTable: (signal: AbortSignal) => Promise<string>`, optional monotonic `inspectionNow`, immutable root anchor, per-record generation checks, and one active scan/one pending batch per `PtyLiveSessions` instance. Private supporting types stay in the adapter module.

Unchanged bounds: `INSPECTION_INTERVAL_MS = 100`, `INSPECTION_TIMEOUT_MS = 500`, `INSPECTION_REQUEST_TIMEOUT_MS = 1500`, `INSPECTION_MAX_BUFFER_BYTES = 4194304`, `INSPECTION_PARSE_BATCH_ROWS = 256`.

Default external request: `/bin/ps`, `['-axo', 'pid=,pgid=,lstart=']`, UTF-8, `LC_ALL: 'C'`, `SIGKILL` timeout cancellation, and AbortSignal. Reject malformed/partial tables. Child-slot release waits for exec result and child `close`, not merely the early abort callback. No per-session periodic timer and no output dirty flag.

## Guaranteed behavior

### Functional behavior

```gherkin
Feature: Responsive live terminal delivery
  Scenario: Output remains available during ownership inspection (T1, T8)
    Given ownership inspection has not completed
    When a terminal emits 100 chunks
    Then both viewers receive every chunk in order before inspection completes
    And a later viewer can replay the bounded scrollback
    And output adds no process inspection requests

  Scenario: Quiet sessions share bounded inspection (T2, T10)
    Given multiple sessions include a silent child under an owned root
    When background observations capture the child with its anchored root
    And that root subsequently exits
    Then closing that session can terminate the verified child
    And inspection uses at most one subprocess at a time across the sessions
    And another terminal remains writable

Feature: Exact and durable cancellation
  Scenario: Cancellation waits for durable intent and fresh ownership evidence (T3)
    Given the close intent write is pending
    When ownership inspection is also pending
    Then no destructive signal is sent
    When the intent write completes
    Then TERM requires a scan started after its fresh inspection request
    And duplicate termination requests send TERM only once

  Scenario Outline: Identity changes prevent unrelated process termination (T4, T5, T12)
    Given a session originally owned a process group
    When <change> occurs
    Then the old session cannot signal the replacement group
    And late observations cannot revive ownership of a group proven gone
    Examples:
      | change |
      | ownership is retired before an inspection completes |
      | the root exits before initial ownership can be established |
      | an identity changes before TERM |
      | an identity changes between TERM and KILL |
      | absence is confirmed before the PGID is reused |

  Scenario: Freshness is checked independently before escalation (T5)
    Given TERM did not finish the original session
    When the TERM grace period ends
    Then KILL requires a separately requested fresh matching process table
    And the signal addresses only the exact owned negative PGID

Feature: Bounded failures and resource ownership
  Scenario Outline: Unusable inspection results cannot confirm closure (T6, T8)
    Given a session closure is requested
    When inspection produces <failure>
    Then no unverified destructive signal is sent
    And closure remains requested rather than closed
    And the caller receives a bounded failure
    Examples:
      | failure |
      | a thrown or rejected execution error |
      | ENOENT or EPERM |
      | a timeout or buffer overflow |
      | a malformed or empty process table |
      | duplicate or invalid process identity fields |
      | a missing group while signal-0 still reports it present |

  Scenario: Concurrent closures retain separate authority (T9)
    Given two session closures are waiting before a scan starts
    When they share that process-table observation
    Then each is validated against its own original identities
    And failure or retirement of one does not cancel the other's inspection
    And a later request waits for a later scan

  Scenario: Inspection resources end with their ownership interests (T7)
    Given no eligible roots or outstanding inspection interests remain
    Then periodic scans stop and their timers are cleared
    And late aborted results cannot change session ownership
    And an unreaped inspection never permits overlapping replacement scans
    When another session opens
    Then bounded sampling can resume once the physical slot is available

Feature: End-to-end progress
  Scenario: The API serves terminal viewers during noisy output (T11)
    Given a real terminal is emitting a paced output stream
    When a client requests the session list and reads SSE
    Then an HTTP response and an SSE frame arrive before output finishes
    And reassembled terminal data remains ordered
```

### A2 recovery and current-work behavior

```gherkin
Feature: Truthful retry without reopening the conversation
  Scenario: Checkpoint persistence orders cancellation (A2-1, A2-5)
    Given cancellation intent is recorded
    When original ownership is prepared for termination
    Then its checkpoint is persisted before fresh destructive-signal checks
    And completion is persisted before success is acknowledged
    And write failure cannot enable another session

  Scenario: Uncertainty can be retried (A2-2)
    Given an inspection or exit probe failed
    When a retry verifies the original members and permissions allow termination
    Then the original group is terminated and closure completes
    And unknown or changed children are never signalled

  Scenario: A reused leader proves the original group gone (A2-3)
    Given the original leader identity was retained
    When a different process now has the original leader PID
    Then closure can complete without signalling that replacement
    And later observations cannot revive the old ownership

  Scenario: Restart retains useful closure retry (A2-4, A2-6, A2-9)
    Given a requested closure has saved original member identities
    When the backend restarts with surviving original members
    Then startup neither resumes nor signals the conversation
    When the person retries closure without a terminal
    Then only a freshly verified group entirely matching saved members may be signalled
    And confirmed completion permits another plan

Feature: Current work survives a failed cancellation
  Scenario: Existing gates keep their eligibility (A2-7)
    Given closing the retained target failed
    Then eligible freeze groom promotion and reslicing actions remain usable
    And their target key spec and pending-action checks still apply
    And a new plan or groom terminal remains blocked
    And an actively pending close still excludes gate dispatch

  Scenario: Errors explain the available recovery route (A2-5, A2-8)
    Given closure is unconfirmed due to temporary failure permissions or missing original identity
    Then Spanish guidance distinguishes retry from required operator action
    And retry remains available even without a terminal
    And failure does not optimistically remove the target
    And a stale response cannot clear a newer target
```

### Conservative behavior deliberately retained

A2 deliberately changes the old blanket non-recovery rule. The following safety limits remain; changing them requires a separate ownership architecture decision.

```gherkin
Feature: Uncertainty does not grant process ownership
  Scenario: Unobserved surviving members are not adopted (T4, T5, A2-3, A2-4)
    Given the original root has exited
    And a current group member has no recorded original identity
    When the session is closed
    Then cancellation refuses to signal that unverified group

  Scenario: Legacy evidence cannot invent ownership (A2-5)
    Given a restarted requested closure has only a numeric PGID
    Then the backend cannot signal that group or claim it is a replacement
    When a retry observes actual group absence
    Then closure can complete
    But an unrelated persistent group is never killed to release the reservation
```

### Equivalence oracles

Inherited output/replay, resource/freshness, unrelated-terminal, durable-write, stale-target, headless/Git preservation, and healthy 1500 ms real-process assertions remain. A2 intentionally amends A1 T4/T5/T6 and round-2 R2a: transient uncertainty can recover, changed leader identity can prove extinction, and restart retry can use durable ownership. T12's non-resurrection expands to proven replacement. ESRCH-only retained closure still waits for PTY exit. See the explicit amendment table; do not quietly delete refusal assertions.

## Slices to implementers

| # | Slice | Deliverable | Tests | Verification command |
|---|---|---|---|---|
| 1 | A1: Bounded asynchronous process ownership inspection | Sol implements the adapter and regression fixtures defined in the plan | T1–T12, exact names in plan section “Concrete regression tests and acceptance oracles”, plus inherited tests | `npm run typecheck`, focused commands below, `npm test` |
| 2 | A2: Evidence-based closure retries and current-work eligibility | v2 checkpoint compatibility, original-identity retry after restart, truthful replacement confirmation, eligible gates | A2-1–A2-9, exact names and boundary assertions in Slice 2 | Backend commands below; frontend focused command in plan, `npm test`, `npm run build` from `frontend/` |

Acceptance: compare the implementation test diff with T1–T12 and the explicit A2 amendments plus A2-1–A2-9. Shared-file ownership is sequential. Slice 2 is ready for implementation handoff; this document does not claim implementation acceptance.

Exact commands from `backend/`:

```sh
npm run typecheck
npx vitest run __tests__/application/close-coordinating-session.test.ts __tests__/application/recover-coordinating-session.test.ts __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/disk-conversation-records.test.ts __tests__/infrastructure/coordinating-session-close-route.test.ts __tests__/infrastructure/coordinating-session-route.test.ts __tests__/infrastructure/coordinating-sessions.test.ts __tests__/infrastructure/spec-freeze-route.test.ts __tests__/infrastructure/epic-groom-route.test.ts __tests__/infrastructure/epic-promotion-route.test.ts __tests__/infrastructure/spec-reslicing-route.test.ts __tests__/infrastructure/groom-session-route.test.ts
npx vitest run --exclude '**/*-real-process.test.ts'
npx vitest run __tests__/infrastructure/pty-live-sessions-real-process.test.ts __tests__/infrastructure/session-channel-real-process.test.ts
npm test
```

Exact commands from the repository root:

```sh
git diff --check
git status --short --branch
git diff -- backend frontend .aiplans/live-session-review-fixes
```

## Deferred changes

- Atomic OS ownership/supervisor architecture and exhaustive process-lineage tracking are outside this sampler change.
- Manual mutation sweep requires an authorized committed-clean implementation checkpoint. This session prohibits commits; record the deferred verification instead of creating one.

## Review reservations

- Bootstrap, late snapshot application, fresh pre-signal ordering, and child reaping need direct code review as well as tests.
- An orphan created between observations cannot be verified from sampling alone. The safe outcome is failure, not a broader kill target.
- `lstart` has one-second precision; `ps` and `kill` are not atomic. PGID-reuse regressions test observed identity changes, not absolute immunity to every kernel race.
- Quiet sessions incur bounded background load; inspection deadlines add bounded cancellation latency. Oversized tables fail explicitly at 4 MiB.
- The read-only experiment was Darwin-only. Darwin and Linux real-process results must be recorded before claiming both platforms verified.
- Legacy missing anchors, leaderless unknown members, or replacement leaders that disappear before inspection may still prevent proof. The honest route is owner-assisted termination/permission repair or later genuine absence, then retry; host maintenance can remove old groups but is not an automatic action. No guaranteed immediate application-only escape is promised, and deleting `closure.json` is not the route. Current work stays usable.
- Review the POSIX leader-reuse proof, full-table handling, checkpoint races and restart context identity conflicts directly. Records belong to one host/PID namespace; lstart is not an atomic OS handle. New-format completion lost before durable write may require fresh proof after a crash.
- No implementation suite ran during A2 planning. A1 evidence is recorded in the log; A2-1–A2-9 remain required future evidence. No additional unmapped behavior was introduced while distilling this document.
