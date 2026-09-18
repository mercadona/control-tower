# Active sessions show their terminal and can be cancelled

## Approval and scope

The user approved this combined design on 2026-09-17 for:

- https://github.com/mercadona/control-tower/issues/390
- https://github.com/mercadona/control-tower/issues/392

Both issues are assigned to the user and are In Progress in Project 16.
The workspace is `.worktrees/390`, branch `feat/390`, created from local main
after `git pull --ff-only origin main`, at `75aad4f`.

The requested workflow is Astra planning, Sol implementation, and independent
Astra judging, without Orca. Feature flags are opt-in in this repository;
the user requested this behavior directly.

## Approved observable behavior

### No active session

The page offers the form for starting a session.

### An active coordinating session

- The session's existing interactive terminal is visible and selected
  automatically, including after a page reload. The page opens its sessions
  panel when it discovers the active session.
- The terminal header offers `Cancelar la sesión`.
- The person can interact with the terminal normally, including answering
  Claude's questions. Waiting for an answer still counts as a live session.
- The new-session form and actions that open another session are disabled.
  The form retains any values already entered. A visible explanation
  identifies the active session/repository.
- Block duplicate openings immediately when an opening starts, across the
  form and groom entry point, without waiting for the next polling cycle.
- Actions that advance the current work, such as freezing, grooming, and
  authorizing, retain their own eligibility conditions. The user explicitly
  chose blocking new sessions rather than blocking every gate action.

### Cancelling the active session

- Clicking `Cancelar la sesión` requests actual process termination from
  the backend. The button shows `Cancelando…` while cancellation is pending.
- New sessions remain blocked until termination is confirmed.
- After confirmed closure, remove that session's tab, displayed timeline,
  and associated stale gate state. Refresh the page's view of session state
  and allow a new session without restarting the backend.
- Persist the cancellation so restarting the backend does not automatically
  resume the cancelled conversation.
- Preserve produced files and git changes. The issues specify that closing
  a terminal does not clean branches, worktrees, or GitHub issues.
- If closure fails, show an actionable error and retain the visible session
  so the person can retry. Do not represent an unconfirmed termination as
  success or enable another session prematurely.

### Already ended or broken sessions

Offer `Cerrar sesión` to remove the session's remaining page state even if
its terminal is no longer alive. Clearing the session must also prevent
stale state from returning on the next poll or backend restart.

## Technical facts that the plan must account for

- The backend already refuses a second live/opening coordinating session.
  Preserve that authoritative control while improving frontend behavior.
- `StartPlanForm` already blocks submit when its live-session prop is true,
  but its fields do not use that prop. `EpicGroomPanel` does not currently
  consume coordinating-session occupancy.
- `useCoordinatingSession` polls every two seconds. Successful openings also
  need immediate local state propagation; refreshing must not allow stale
  reads to undo a known opening or closure.
- `useSessionsColumnCollapse` defaults to collapsed. `SessionsPanel` selects
  a session after an opening callback, but restored sessions need the same
  visible, selected terminal behavior.
- `/sessions` is read-only; `LiveSessions` and `PtyLiveSessions` have no close
  operation. Closing a browser subscription only disconnects its viewer.
- `CoordinatingSessions` retains ended state and its timeline, while
  `RecoverCoordinatingSession` resumes the recorded conversation whenever
  Claude considers it resumable. Intentional closure needs durable semantics.
- The cancellation must address the intended session identity. A late request
  or notification for a previous session must not terminate or clear a newer
  session. Owned subprocess termination, bounded waits, and errors require
  observable evidence rather than deleting a UI entry optimistically.

## Verification expectations

- Test from application/HTTP/UI boundaries using repository conventions.
- Demonstrate active-session detection on reload, terminal selection and
  expansion, all new-session entry points blocked, and current-work actions
  retaining their eligibility.
- Demonstrate cancellation pending, confirmed exit and cleanup, failed
  closure/retry, and already-ended cleanup.
- Cover stale identity/race behavior and backend restart after cancellation.
- Exercise termination against owned real processes with bounded teardown;
  ordinary automated tests must not depend on a live Claude account.
- Preserve meaningful real-process tests and ensure every spawned child has
  reliable cleanup even when an assertion fails.
- Run applicable frontend and backend typechecking, lint/build checks, and
  suites from the directories and scripts declared in this repository.
- Record actual results and limitations; do not claim full acceptance from
  a disabled button alone or from a cancelled browser subscription.

## Handoff

Create an implementation plan under `.aiplans/live-session-lifecycle/` and
maintain implementation evidence there. This is an approved design for two
existing issues, not a new milestone/groom workflow. The plan may split
backend and frontend work into cohesive slices while retaining one owner of
shared files. Use English for implementation, tests, and documentation, and
Spanish for rendered product copy. Commit, push, and PR actions require the
user's authorization for this delivery.
