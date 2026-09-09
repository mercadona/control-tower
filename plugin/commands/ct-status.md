---
description: The loop's status report — what is in flight, what it has delivered and what is residue. Read-only.
---
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-status.mjs --repo "<owner/repo>"
```

Run it from the checkout of the repository being looked at (from inside a `.worktrees/<n>` works too). **It mutates nothing**: it names what it finds and the remedy; deleting is your decision. The report goes to stdout; the `warning:` lines to stderr. Pass it on as it is, block by block (`IN FLIGHT`, `DELIVERED, WAITING FOR MERGE`, `DELIVERED, NOT HARVESTED`, `RESIDUE`), keeping each line's tail: «no sign of life» is local to this machine and never accuses when it could not check.

| Exit | Means | What to do |
|---|---|---|
| `0` | Nothing to review: nothing in flight without signs of life, no residue, no half-finished read | nothing |
| `3` | There is something to review: residue, a claim with no live process, orphaned labels, deliveries not harvested | read the report's blocks |
| `1` | **It could not be checked**: a read of `gh`, of the processes or of the disk failed, or the checkout does not talk about the same repository as `--repo` | look at the `warning:` lines, fix the cause and run it again — what is printed is only what IS known |

The `1` never degrades to a `0`: precedence is `1` > `3` > `0`.

Full reference —what each block and each tail means, and why—: `docs/loop/ct-status.md` in the plugin's repository.
