# Live-session review fixes: Developer specification

> Review-facing contract distilled from [plan.md](plan.md). If this matches the intended behavior, you do not need to read the implementation plan; every planned slice carries its tests. Slice 1 is fully specified. Slice 2 awaits a separate Astra planning session. English Gherkin follows this repository's language rule.

## What will happen

- Terminal output stops triggering synchronous process-table scans. One asynchronous sampler serves all live roots, including quiet sessions.
- Fresh identity checks protect each TERM/KILL; T1–T12 and the existing identity, durable-intent, child-process, and retry suites are the non-regression oracles.
- Terminal viewers and HTTP clients can make progress while ownership inspection is pending. Closure still needs confirmed termination; inspection failure is not successful closure.

## Flags and parallel change

| Flag | Purpose | Rollout | End of life |
|---|---|---|---|
| None | Direct A1 implementation, as requested | Slice 1 after verification | Not applicable |

This is one adapter replacement, not a dual-runtime rollout. The expand → verify → switch → contract sequence maps entirely to Slice 1: add controlled asynchronous regression fixtures; verify the bounded sampler and ownership rules; make the uninjected production default asynchronous; remove the synchronous inspector and output-triggered scans. There is no flag-switch stage or permanent legacy implementation.

Watch test evidence for scan counts/concurrency, completion deadlines, exact negative-PGID signals, failed closure remaining REQUESTED, and continued HTTP/SSE progress. No production shadow comparator or telemetry rollout is specified. The safety net is fresh identity validation, monotonic absence, retained close deduplication, and failure before an unverified destructive signal. Worst-case close waits are bounded by `4 * INSPECTION_REQUEST_TIMEOUT_MS + termGraceMs + killGraceMs`, plus event-loop scheduling overhead.

## Final architecture

```text
Before
PTY output / open / evidence / exit / pre-signal checks
  -> PtyLiveSessions -> execFileSync(ps) -> blocked API event loop

After
PTY output -> bounded scrollback + watchers
open -> register ownership + listeners -> asynchronous bootstrap
eligible roots -> one shared periodic sampler -> asynchronous execFile(ps)
durable close intent -> fresh TERM inspection -> exact group TERM
                    -> grace -> fresh KILL inspection -> exact group KILL
PTY exit + signal-0 ESRCH -> confirmed termination -> durable completion
```

Implementation scope:

- `backend/src/infrastructure/pty-live-sessions.ts`
- `backend/__tests__/infrastructure/pty-live-sessions.test.ts`
- `backend/__tests__/infrastructure/claude-conversations.test.ts`
- `backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts`
- `backend/__tests__/infrastructure/session-channel-real-process.test.ts`

Deleted: `execFileSync` import/use, synchronous group-inspector seam and implementation, and process-table scans in output/evidence/exit callbacks. Public live-session signatures and durable-intent ordering are retained. `backend/src/infrastructure/ct-api.ts` exercises the asynchronous default without new wiring.

New adapter conventions: constructor-injected `inspectProcessTable: (signal: AbortSignal) => Promise<string>`, optional monotonic `inspectionNow`, immutable root anchor, per-record generation checks, and one active scan/one pending batch per `PtyLiveSessions` instance. Private supporting types stay in the adapter module.

| Bound | Exact constant/value |
|---|---|
| Periodic delay and minimum start spacing | `INSPECTION_INTERVAL_MS = 100` |
| Inspection child timeout | `INSPECTION_TIMEOUT_MS = 500` |
| Fresh-request deadline | `INSPECTION_REQUEST_TIMEOUT_MS = 1500` |
| Output ceiling | `INSPECTION_MAX_BUFFER_BYTES = 4194304` |
| Parsing yield interval | `INSPECTION_PARSE_BATCH_ROWS = 256` |

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
    And late observations cannot restore revoked authority
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

### Conservative behavior deliberately retained

Changing these outcomes requires the separately approved lifecycle work; do not silently change the contract while removing blocking scans.

```gherkin
Feature: Uncertainty does not grant process ownership
  Scenario: Unobserved surviving members are not adopted (T4, T5)
    Given the original root has exited
    And a current group member has no recorded original identity
    When the session is closed
    Then cancellation refuses to signal that unverified group

  Scenario: Fresh data does not resurrect already revoked authority (T4, T6, T12)
    Given signal authority was already revoked
    When another process observation arrives
    Then the observation does not grant authority again
```

### Equivalence oracles

All inherited PTY tests remain required: output/replay, watcher disconnection, input/resize, original children after root exit, durable-write races, delayed exit callbacks, retry confirmation, completion-write retry, and unrelated terminals. Unit arrangements must await explicit membership observations where they previously relied on output scanning; their outcome assertions remain intact. Existing real-process fixture delays and the healthy-path 1500 ms close assertion are retained.

### Production verification visibility

No shadow comparison is planned. T1/T2/T8 establish the mechanism deterministically, T10 exercises actual child ownership, and T11 checks healthy HTTP/SSE progress. They cannot measure production p99 latency, prove every possible process lineage was sampled, or make separate `ps` and `kill` operations atomic.

## Slices to implementers

| # | Slice | Deliverable | Tests | Verification command |
|---|---|---|---|---|
| 1 | A1: Bounded asynchronous process ownership inspection | Sol implements the adapter and regression fixtures defined in the plan | T1–T12, exact names in plan section “Concrete regression tests and acceptance oracles”, plus inherited tests | `npm run typecheck`, focused commands below, `npm test` |
| 2 | A2: Pending separate Astra planning session | Separate Astra plan required before implementation | Pending | Pending |

Acceptance: the implementation PR's tests must match the plan's tests; compare the test diff with T1–T12. Shared-file ownership is sequential. Slice 2 is not ready for dispatch.

Exact commands from `backend/`:

```sh
npm run typecheck
npx vitest run __tests__/infrastructure/pty-live-sessions.test.ts __tests__/infrastructure/claude-conversations.test.ts __tests__/application/close-coordinating-session.test.ts
npx vitest run --exclude '**/*-real-process.test.ts'
npx vitest run __tests__/infrastructure/pty-live-sessions-real-process.test.ts __tests__/infrastructure/session-channel-real-process.test.ts
npm test
```

Exact commands from the repository root:

```sh
git diff --check
git status --short --branch
git diff -- backend/src/infrastructure/pty-live-sessions.ts backend/__tests__/infrastructure/pty-live-sessions.test.ts backend/__tests__/infrastructure/claude-conversations.test.ts backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts backend/__tests__/infrastructure/session-channel-real-process.test.ts
```

## Deferred changes

- A2: irreversible `signalAuthority` loss, failed-close state blocking eligible current-work gates, and restart/null-session retries with reused PGID. No recovery or UI decisions are approved here.
- Atomic OS ownership/supervisor architecture and exhaustive process-lineage tracking are outside this sampler change.
- Manual mutation sweep requires an authorized committed-clean implementation checkpoint. This session prohibits commits; record the deferred verification instead of creating one.

## Review reservations

- Bootstrap, late snapshot application, fresh pre-signal ordering, and child reaping need direct code review as well as tests.
- An orphan created between observations cannot be verified from sampling alone. The safe outcome is failure, not a broader kill target.
- `lstart` has one-second precision; `ps` and `kill` are not atomic. PGID-reuse regressions test observed identity changes, not absolute immunity to every kernel race.
- Quiet sessions incur bounded background load; inspection deadlines add bounded cancellation latency. Oversized tables fail explicitly at 4 MiB.
- The read-only experiment was Darwin-only. Darwin and Linux real-process results must be recorded before claiming both platforms verified.
- No implementation suite has run during planning. T1–T12 are required future evidence, not claimed passes. No additional unmapped behavior was introduced while distilling this document.
