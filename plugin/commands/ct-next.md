---
description: Dispatcher — launches the next ready slice (§9 order, merged deps) in a worktree + cmux
---
Dry first, to see what it would launch:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-next.mjs --repo "<owner/repo>" --cap 1 --dry-run
```
If the plan looks right, launch it for real:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-next.mjs --repo "<owner/repo>" --cap 1
```

It only dispatches issues in `status:ready`; `/ct-groom` creates them in `status:backlog` and promoting them is a human step. **stdout is the product** (the plan, the selection, the reason for blocking with its remedy) and **stderr the diagnostics** (`aviso:`, `ATENCIÓN:`). What it prints already carries the remedy: pass it on as it is, do not summarise it.

| Exit | Means | What to do |
|---|---|---|
| `0` | Progress (something was launched), or nothing selectable and it already explained why | carry on as normal |
| `1` | Something broke or was left half-done: an unmet precondition, an orphaned issue in `status:in-progress`, an unverified launch | stop and let a human look at it; **look at the cmux session before deleting anything**; the output lists the exact commands |
| `2` | Usage or static-configuration error (flags, `CT_AGENT_BIN`) | fix the invocation |
| `3` | Batch selected, zero launches and nothing half-done (claim race lost against another dispatcher) | retry later; it is not an alarm |
| `130` / `143` | Interrupted (SIGINT / SIGTERM); a half-done claim reverts itself | nothing |

When dispatching a slice with the `plan` gate it prints the go (`GO de #N: contesta exactamente -OK <nonce>`), which the human writes as a comment on the issue; `dispatch-check --release` refuses without it (exit 9). The other transitions —`--reopen`, `--requeue`, `--collect`— live in `scripts/dispatch-check.mjs` and print their own remedy.

Do not launch two `/ct-next` at once against the same repo: the claim is a label with no compare-and-swap.

Full reference —every mechanism, its limits and the history of the decisions—: `docs/loop/ct-next.md` in the plugin's repo.
