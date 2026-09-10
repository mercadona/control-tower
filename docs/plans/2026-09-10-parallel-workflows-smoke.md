# Delivery-One Live Smoke Evidence

Issue: https://github.com/mercadona/control-tower/issues/138

Scope: live verification of the backend refresh delivery with the existing
frontend. The delivery-one journey is complete, including correction of the
failures discovered during the run and live re-verification of those corrections.
This is not evidence that the multi-workflow frontend in deliveries two and three
has been implemented.

## Environment

- Application: `http://127.0.0.1:8791`, started by the user inside cmux.
- Application checkout: `/Users/acapdev/orca/workspaces/control-tower-plugin/parallelize`.
- Test repository: `jjponz/repo-pulse`, explicitly authorized by the user.
- Test checkout: `/Users/acapdev/repos/repo-pulse`, clean `main` at `5b2ccb1`.
- Existing worktrees before this run: `35`, `45`, `50`.
- Browser: a fresh headless Google Chrome controlled through Playwright, with
  separate local browser profiles A, B and C. Requests reach the running
  application; no network routes or agent responses are mocked.
- Initial `GET /active-plans`: HTTP 200, `{"plans":[]}`.
- `GET /external-tools`: HTTP 200, `ready: true`; cmux and GitHub answered ready.
  Claude authentication is reported as unknown by the existing probe contract.

## Created test plans

| Profile | Plan issue | Agent | Branch | Worktree | Requested deliverable |
|---|---|---|---|---|---|
| A | [55](https://github.com/jjponz/repo-pulse/issues/55) | `workspace:6` | `feat/55` | `/Users/acapdev/repos/repo-pulse/.worktrees/55` | `docs/verification/ct-138-local-checks.md` |
| B | [56](https://github.com/jjponz/repo-pulse/issues/56) | `workspace:7` | `feat/56` | `/Users/acapdev/repos/repo-pulse/.worktrees/56` | `docs/verification/ct-138-local-configuration.md` |

Both requests are small, disposable documentation tasks. Their request bodies
protect application code, configuration, existing tests, README and AGENTS. Both
explicitly require stopping after publishing the plan and prohibit merging the
resulting pull request.

## Observed journey

1. Opened the served production frontend in profile A. The request form rendered
   with no browser JavaScript errors and no mutation requests on initial load.
2. Filled the form and clicked `Arrancar plan`. The real `POST /start-plan`
   answered HTTP 202 for issue 55, with its agent, branch, worktree and canonical
   root. The frontend advanced to plan review and displayed writing progress.
3. Reloaded profile A. The existing workflow was recovered without another POST;
   its baseline notice and plan identity remained visible.
4. Used the current frontend's restored-state discard action in separate profile B
   to reach a new request form, then started issue 56. Its POST answered HTTP 202.
   Discarding that browser selection did not stop plan 55.
5. Queried `GET /active-plans` after the starts. It returned both plan identities,
   with different agents and worktrees, in the same repository.
6. Opened fresh profile C. The frontend rendered two `Continuar plan` choices,
   one for issue 55 and one for issue 56. There were no browser JavaScript errors
   and no mutation requests.
7. Agent A wrote and committed its plan (`d785061`) and published
   [the first plan comment](https://github.com/jjponz/repo-pulse/issues/55#issuecomment-5616858082)
   at `2026-09-10T10:07:25Z`. The frontend displayed the review actions.
8. Requested a change from profile A through `Pedir cambios`: explicitly state
   that the documented commands are instructions, not evidence of executed or
   passing checks. `POST /review-plan` answered HTTP 202 for issue 55 only.
9. The change request appeared in
   [its GitHub comment](https://github.com/jjponz/repo-pulse/issues/55#issuecomment-5616869101)
   at `2026-09-10T10:08:12Z`. Agent A incorporated it, committed `e1504d5`, and
   [published the revised plan](https://github.com/jjponz/repo-pulse/issues/55#issuecomment-5616884838)
   at `2026-09-10T10:09:21Z`.
10. Reloaded profile A again. It retained issue 55 and showed `Implementar plan`;
    the browser emitted no POST on recovery. The documentation deliverable did
    not yet exist: the agent was still waiting for plan authorization.
11. After explicit human approval, clicked `Implementar plan` for A. The request
    answered HTTP 202 with issue 55 and `workspace:6`. `GET /active-plans` kept
    issue 56 in `planning` with `workspace:7` while A became `implementing`.
12. Observed real progress through `implement`, `controls`, `judge` and `global`.
    Reloading profile A showed task 1 of 1, its actual task name and agent, with
    no repeated POST. The document was committed as `ba984d2`.
13. The initial global predicate failed because it expected two files and omitted
    artifacts produced by the execution machinery. The run was not accepted as
    green on that basis. The agent subsequently broadened the check on its own
    and opened [pull request 57](https://github.com/jjponz/repo-pulse/pull/57).
    The broad exclusion and its green result were rejected in review, as detailed
    below.
14. Posted [review 5165897046](https://github.com/jjponz/repo-pulse/pull/57#pullrequestreview-5165897046)
    with the human-approved exact-path correction. The issue changed to fixing,
    but the instruction initially remained pasted and unsubmitted in Claude.
    The user confirmed that state and pressed Enter once. This intervention is
    part of the evidence, not a successful automatic delivery.
15. The user restarted the backend inside cmux, retaining both agent sessions.
    The listening process changed from 4792 to 91818. The backend recovered A as
    implementing and B as planning with the same agent handles. Both browser
    profiles reloaded without POST requests or JavaScript errors.
16. The restart exposed a history bug: after correction `e00fd8b`, GitHub changed
    issue 55 back to `in-review` at `10:39:15Z`, but the old review reopened it at
    `10:39:21Z`. A fixing issue had yielded an empty historical baseline, so its
    old review appeared new after release. That repetition was not accepted as
    correct recovery.
17. Added regression tests and fixed the backend's recovered history read. Also
    introduced an injected paste-settling interval before Enter for agent
    instructions. The user restarted the corrected backend; the listening process
    became 45196 and stale duplicate input was cleared, without submitting it.
18. After independently verifying the exact five paths and plan contract, returned
    issue 55 to review through the normal `dispatch-check --release --no-watch-merge`
    operation. Six assertions sampled between `10:53:28Z` and `10:54:51Z` confirmed
    `in-review` without an old-review replay, covering more than two watcher cycles.
19. Posted a new long [review 5166201010](https://github.com/jjponz/repo-pulse/pull/57#pullrequestreview-5166201010)
    at `10:56:15Z`. It requested separating phase-global and post-delivery checks,
    retaining all six strict predicates. The instruction marker appeared in the
    agent transcript after automatic submission; no manual Enter was requested or
    needed for this review. The agent committed `91f3502` and returned the same
    pull request to review, observed by `10:59:45Z`.
20. Six further assertions between `11:00:26Z` and `11:01:49Z` confirmed the corrected
    issue remained in review without replay. Final browser reloads showed A in
    review with its pull-request link and B awaiting plan approval, without POST
    requests or JavaScript errors.

## Strict verification of the corrected test plan

The agent's initial broad `docs/superpowers/` exclusion in `e4834a2` did not prove
the approved scope. The later correction explicitly preserves that fact in the
pull-request description; the earlier run's green status is not presented as a
fresh strict verification.

Independently verified the corrected head
`91f3502170c2200d48624889595f260b3e1fc3a0`:

- The diff against `5b2ccb1` consists of exactly five added files: this test plan,
  the requested documentation, the task verdict, the slice verdict and the metrics
  file. No other path is allowed; no broad directory exclusion is used.
- The actual plan reader extracts exactly four phase-global commands. A separate
  fenced block contains the two post-delivery commands. The reader's first-block
  contract keeps those two out of the earlier execution phase.
- Executed all six predicates extracted from the current document: all exited 0.
- An independent exact-set check rejected an extra
  `docs/superpowers/unrelated.md` and a missing required document.
- An input without the slice verdict was accepted by the global-phase predicate
  and rejected by the final predicate.
- `dispatch-check --check-plan` exited 0 with the corrected document.
- The test worktree was clean and the pull request's GitHub Actions check passed:
  [run 34468925538](https://github.com/jjponz/repo-pulse/actions/runs/34468925538).

These are post-delivery verification results. The earlier closed execution record
was not reset or passed off as a newly executed strict run.

## Backend corrections discovered by the live journey

### Historical reviews replayed after recovery during fixes

The recovered watcher used the same status-filtered query as ordinary polling.
While the issue was in progress, that query returned no reviews; after release,
the old review was delivered again. Recovery now uses a history query independent
of issue status, solely to seed already-existing review identifiers. Ordinary
polling remains status-gated. The regression test composes the real query and
watcher and checks both no old-review replay and delivery of a subsequent new review.

### Long instruction pasted without submission

The user observed the correction text sitting in Claude's input. The backend sent
Enter immediately after cmux accepted the paste command. Submission now waits for
the injected settling interval (one second in the application composition) before
sending Enter. Tests model a terminal that accepts a paste before applying it and
exercise implementation, plan review and pull-request correction. The new long
review was subsequently processed automatically in the live session.

This settling interval is not a positive application-level acknowledgement or an
exactly-once guarantee. The live evidence establishes that it resolved the observed
submission failure in this run.

Final automated verification after both fixes: backend type checking and
**1,402 tests in 62 files passed**; frontend **664 tests in 32 files passed** and
production build passed. Both package suites include their style checks. An
independent read-only code review found no remaining actionable issues in the two
fixes before the final live retry.

## Observations

Both starts returned baseline outcome `no-verificado`. The repository declares
build, test and lint commands in AGENTS, but not in the `test: <command>` format
recognized by the baseline reader. The frontend rendered the returned warning
instead of claiming that the repository's tests had passed. No convention file
was changed to alter that observation.

The existing tools banner says `Herramientas necesitan atención` even when the
backend answers `ready: true`, because the Claude row remains `unknown`.
Expanding the details showed ready sessions for the other five tools and the
Claude authentication explanation. This did not prevent either plan start.

Browser screenshots and isolated profile state were captured under
`/var/folders/mr/64ghyy0j0817xzyld10r_0wr0000gp/T/opencode/ct138-*`.
The temporary `ct138-smoke.mjs` driver is in that same directory.

## Final state and handoff

- Issue 55 is in review; test pull request 57 remains open and unmerged at `91f3502`.
- Issue 56 remains in planning at `4f5f0f9`; it was not authorized to implement.
- Both agent sessions and worktrees remain available for inspection.
- The original `repo-pulse` main checkout remains clean at `5b2ccb1`; the pre-existing
  worktrees 35, 45 and 50 remain present.
- Control Tower delivery-one application changes remain local to the feature
  worktree. No Control Tower delivery pull request has been created or merged by
  this verification.

The live delivery-one checkpoint is satisfied with the corrected backend. The
multi-workflow frontend and its later verification remain the next deliveries.
