# Measuring dispatched slices

Two data points per slice. Nothing more. They are the ones that decide whether the dispatcher survives.

**Death criterion (José, 2026-07-30):** after 5 slices, if the human intervention per slice
is not LOWER than doing the same work by hand in a normal session, the dispatcher is retired.
`/ct-groom` survives separately (it depends on neither cmux nor dispatch).

| # | Type | Date | Min. human intervention | Half state by hand? | What |
|---|------|-------|--------------------------|------------------------|-----|
| 451 | `type:ui` | 2026-07-29 | **not measured** (the slice went through before this table existed) | **yes** | Issue CLOSED and PR #461 merged, but the `status:in-review` label is still hanging on the issue. Verified 2026-07-30 via `gh issue list`. |
| 452 | `type:backend` `touches:migration` | in flight (since 29-Jul ~20:27) | pending | pending | See note below. |

## Checklist for the gate on #452's pull request

José's decision (2026-07-30): **the in-flight session is not interrupted**; the conventions
warning is checked at the gate. When reviewing the pull request:

- [ ] The call site that passes `today` to `weekly_cycle` uses `today_madrid()`, **not** `date.today()`.
      It is the exact point where the bug from PR #419 re-enters, and it was not written yet at 11:00.
- [ ] This slice's gate **is not visual, it is about data**: the §7.4 backfill runs over real
      data. If it fails on deploy day, users see their plan empty and it looks like data loss.
      A green CI does not cover that.
- [ ] The pull request body carries `Closes #452` (it is the only thing that closes the issue and frees its tokens).
- [ ] `.agent/STATE.md` reflects the real work before merging (today it says `not_started`).

## Notes

### #451 — what was not measured is not invented
The slice was completed and merged on 29-Jul, before this record existed. The minutes of
human intervention **were not recorded**; they are not estimated here. N=1 without the data point
that matters. The only thing verifiable after the fact is the half state: the orphaned label.

### #452 — IN FLIGHT (verified 2026-07-30 ~11:00), not stopped
We went to dispatch it assuming `status:ready` with no worktree and no branch. **What is actually there is a live slice:**
- the `status:in-progress` label, worktree `.worktrees/452`, local branch `feat/452`
- 5 commits, the last one `f6bdab95` at **10:42 today** (weekly cycle, `plan_adoption` table +
  backfill, ON DELETE CASCADE fix, 2 logbook entries)
- **live `claude` process**: PID 35635 with `cwd = .worktrees/452` (`lsof -d cwd`)

In other words: dispatching #452 **already worked** — the F20/F21 fix had been operational since
the afternoon of 29-Jul. This session's start-up prompt described the snapshot of 29-Jul 17:46 (commits
`bca683e1`/`ae8946d5`, José's cleanup by hand); between that hour and now the slice was dispatched and
advanced two tasks, **and that dispatch was recorded in no STATE.md at all**.

**A data point of the loop, not an anecdote:** the worktree's `.agent/STATE.md` still says `status: not_started`
/ "slice recién despachado, sin trabajo aún" on top of 5 backend commits. STATE.md is the
hydration of the next session — lying like that, any session arriving afterwards (or a
human reading it) concludes that nothing has been done. It is the number one candidate for a gate, noted in
[backlog-congelado.md](backlog-congelado.md).

**Conventions (authorised exception):** the agent applied `JSON` instead of `JSONB` on its own and
documented it (`src/plan/infrastructure/models.py:4-5`). The `weekly_cycle.py` domain receives `today`
as a parameter and documents that it does not call `date.today()` — correct. **But the call site that will
pass it that `today` (the §5.2 endpoint) is not written yet**: that is where the
off-by-one from PR #419 would come in. The worktree has its own copy of AGENTS.md frozen at the moment the branch
was created, so the addition made today on `main` **is invisible to it**. Open risk, pending José's decision.

### Label residue in menoplus, measured by the dispatcher itself (2026-07-30)
The `--dry-run` over `menoplus-app/menoplus` reports **5 CLOSED issues that still keep a live
`status:` label**, invisible to `/ct-next` (which only sweeps open ones):
- `#161, #157, #156` in `status:ready` — they fell out of the dispatch queue with no warning
- `#245, #155` in `status:in-progress` — claims that were never released; their worktree and branch may
  still be on disk
- (+5 in `status:in-review`, which is a slice's normal ending, and `#158` in `status:blocked`, inert)

This **predates the loop** — they are from the earlier era, not half-cleanups of these slices. It is recorded
because it quantifies the phenomenon that does reach the new slices: #451 ended up the same way. Closing an issue
and taking its label off are two distinct acts and nothing checks the second.

### Launch validation (2026-07-30, sandbox — not a production slice)
`ct-next --repo josemerca/ct-loop-sandbox --cap 1` over issue #2. Dry-run exit 0 and real
launch exit 0. Verified in the process table, not through the window: PID 39682
(`/Users/jpereag/.local/bin/claude … --dangerously-skip-permissions <kickoff #2>`) with
`cwd = /Users/jpereag/Documents/ct-loop-sandbox/.worktrees/2` via `lsof -d cwd`. A single `claude`
launched — the F20/F21 idempotency guard held against the resend.

Half state this validation leaves behind (to be cleaned when José says so): worktree
`ct-loop-sandbox/.worktrees/2`, branch `feat/2`, and the sandbox's issue #2 in `status:in-progress`.
