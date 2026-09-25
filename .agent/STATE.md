---
task: ""
# role: who you are in the loop. There are TWO live sessions per repo with
# opposite roles, and until F20 the split was only written inside the kickoff
# one of them received — it was lost the moment that session re-hydrated.
#   - This file is the MAIN CHECKOUT's: whoever works here is the COORDINATOR
#     session (runs /ct-groom and /ct-next, reviews and merges PRs).
#   - Every dispatched slice has its own at .worktrees/<n>/.agent/SLICE.md
#     (F22 — it used to be STATE.md, which is the coordinator's, not the
#     slice's), with role: slice-agent — it implements that slice and stops.
# No code decides anything with this field: it is for the agent that reads it.
role: "coordinador (checkout principal): groomeas, despachas con /ct-next, revisas y mergeas. NO implementas slices aquí — eso pasa en .worktrees/<n>."
status: not_started
branch: ""
base: main
# last_commit: this slice's last WORK commit. The Stop hook blocks the end of
# the turn if there is unrecorded work above it — but a commit that only
# touches this file does NOT count, so committing the STATE.md update does not
# leave you behind again.
last_commit: ""
github_issue: null
you_are_here: ""
next_action: ""
# blocked: null = NOT blocked. If the work cannot continue (a decision stopped
# it, the plan turned out to be false, something external is missing), do NOT
# write it as prose inside next_action: put it here. The SessionStart hook
# announces it when any session of this repo starts and SUSPENDS the
# next_action.
#   blocked: {reason: "why it cannot continue", unblock: "what it would take to lift it", since: "2026-07-25"}
# Lifting it means deleting the field (or setting it back to null): a
# deliberate decision.
blocked: null
# verify: the PENDING check that validates this work WHEN IT IS DONE — never a
# fact already checked, even if it is worded in the present tense.
verify: ""
tasks: []
---
## Current State
(empty)
## Immediate Next Steps
## Decisions Made
## Gotchas/Constraints
## Critical Files
