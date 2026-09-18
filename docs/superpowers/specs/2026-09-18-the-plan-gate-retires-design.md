# The plan gate retires and the chain dispatches everything unblocked

## Approval and scope

Brainstormed and approved by the user on 2026-09-18, on `main` at `be432b69`
(the eight slices of the previous epic merged). Branch
`feat/the-plan-gate-retires`, created from local main after
`git pull --ff-only`.

This is **A-3**, the parked decision of row 1 of
`2026-09-11-the-loop-enters-through-brainstorming-execution.md`: *"the
retirement of the whole go protocol, whose default this epic removes"*. That
epic retired only the default, deliberately, so that it would not touch the
distributed plugin beyond one line. This one retires the rest.

It also raises what that retirement makes visible: the dispatch cap. With a
human OK gone from every slice, one slice at a time is the only thing left
holding the chain back.

## What is already gone, and what is still standing

Issue #326 (row 1 of the epic) retired the intermediate gate: `POST
/review-plan` is no longer routed, the plan events vocabulary is `writing` and
`ready` only, and `gatesForType` no longer implies `plan` in any slice. A slice
carries the plan gate today only if its own row writes `plan` in the `Gate`
column.

What survives, measured on `be432b69`:

| Piece | Where |
|---|---|
| The protocol itself | `go-response.js`, `go-registry.js`, `go-channel.js`, `ct-go.mjs`, `ct-watch-go.mjs` |
| Who mints it | `ct-next.mjs:751` draws the nonce, `:3906` launches the watcher |
| Its teeth | `dispatch-check.mjs:990-1080`, the exit-9 ladder |
| The vocabulary | `gates.js:93-105` (`GATES.plan`) and the branch at `kickoff.js:389` |
| The backend | `go-registry.ts`, `disk-go-registry.ts`, `plan-issues.ts#answerGo`, `implement-plan.ts` and its unrouted route |

16 production files, 19 test files, 148 assertions naming the nonce, the go or
the label.

## Four technical facts the plan must account for

**The exit-9 gate bites an issue with no gate labels at all.**
`dispatch-check.mjs:1049` — "silence is not a waiver": an issue whose labels
declare nothing (hand-made, never groomed) does not release without a
registered go. The groom always writes at least `gate:none`, so the trap only
reaches hand-made issues, but it is live.

**The protocol is not vendored.** `plugin/dist/` carries `scope-check`,
`dispatch-guard`, `commit-keyword-guard`, `session-start` and `stop`, and none
of them names the go. So this is not a coordinated change like the milestone
heading of #346: it is retired here and governed repositories receive it by
updating the plugin.

**`parseGateCell` validates the token after stripping the `!`**
(`gates.js:213-216`), so removing `plan` from the vocabulary would turn every
`!plan` into an unknown token — and an unknown token in the `Gate` column is a
hard error of `/ct-groom` (`ct-groom.mjs:329`). The execution spec of the
previous epic writes `!plan` in nine places.

**Exit 9 means nothing to the backend or to the run machine.** No module under
`backend/src`, `ct-step.mjs` or `run-machine.js` reads it. Deleting it unwinds
no state.

## The decisions

**The `plan` token is retired, not deleted and not kept.** `GATES` keeps three
(`visual`, `apply`, `e2e`) and a `RETIRED_GATES` list appears beside it.
`parseGateCell` gains a fourth bucket, `retired`, and the `!` is ignored there:
`plan` and `!plan` both produce nothing. `/ct-groom` reports it once, next to
where it already reports inert waivers (`ct-groom.mjs:659`), and does not
abort. It is the shape of #346 — read tolerantly, write nothing — and it leaves
every spec written before the retirement groomable.

A consequence comes free: `gate:` labels are in the reconcile's
`ownedLabelPrefixes`, so a live issue carrying `gate:plan` loses the label on
the first `/ct-groom --reconcile` with no new code, because `gateLabels` stops
producing it.

**The cap goes away entirely: everything unblocked is dispatched.**
`planDispatch` gains `UNCAPPED = null`; with it, `remainingCap` is `null`,
`selectNext` never cuts by number, and `explainNoSelection` cannot reach its
`cap-full` branch — which would be a lie when there is no cap. A `blockReason`
without a cap can only be unmerged deps or a token collision, which is exactly
what should be readable when the chain stops. `/ct-next --cap N` is untouched.

**The batch is selected in one read, not by insisting.** The port returns the
whole batch and `selectNext` resolves the collisions inside it, accumulating
`claimedTouches` as it selects (`dispatch.js:75-79`). A relay that instead
called a singular port in a loop would do N+1 reads per sweep and would depend
on each claim landing before the next read — correctness that depends on time,
in place of a pure function that already exists and is already tested.

**The cabin paints one panel per live slice.** The chooser of `Home.tsx:543`
retires. Leaving it would mean removing the human OK from the plan and, in the
same move, making the page ask for a human click to know which slice is
talking.

## Two properties that were already written and become visible

**The brake reaches the merge, not the pull request.** `planDispatch` uses two
sets on purpose (note F13/H2 in `dispatch.js`): `inFlight` (`in-progress` only)
decided the cap, and `tokenHolders` (`in-progress` plus `in-review`) decides
the tokens. A slice with its pull request open keeps holding its `touches`
until it is merged. "The rest go as they get merged" needs no implementing: it
is the behaviour already there, invisible because with a cap of 1 nothing ever
reached it.

**`StartPlanResult` is already plural** (`started`, `failed`). The plural axis
today is repositories rather than slices, but the shape of the contract carries
the batch without inventing anything.

## What the retirement leaves uncovered, said plainly

With the plan gate retired there is **no human lever between the dispatch and
the pull request**. The plan is published as a comment on the issue and is read,
not answered; the machine implements; the pull request opens; and command
returns there. The message box of `SliceSession` is not a mid-flight
correction: it enters through `PlanAgents.fix`, the path a pull request review
already uses, and D-60 of the #333 plan refuses a message that arrives before
the run delivers.

The compensating controls are the ones already in place: the per-task judge,
the slice judge over the accumulated diff, `--release` with its exits 5/6/8,
and the merge, which stays a human act.

## The risk of an uncapped chain

With no number, a milestone of eight independent slices is eight `claude -p`
processes with eight worktrees alive. The only thing moderating it is the
`touches` guard, and `SERIALIZING_TOUCHES` serializes three tokens only
(`migration`, `ci`, `pbxproj`).

Measured against the epic just delivered, its deps were a chain
(#2→#3→#4→#5→#6→#7→#8), so even uncapped it would have gone one at a time. An
uncapped chain only bites on a wide milestone, and the day it bites the fix is
one line: `cap: UNCAPPED` becomes `cap: 4`.

## Handoff

Execution spec: `docs/superpowers/specs/2026-09-18-the-plan-gate-retires-execution.md`.
