# `/ct-status` — reference and design

> Text moved verbatim from `plugin/commands/ct-status.md` (sub-issue #93). The command keeps the invocation, the table of exit codes and a link to this document.

The invocation:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-status.mjs --repo "<owner/repo>"
```


It answers in one go the question the coordinator used to answer by hand every time, crossing `pgrep` + `lsof` + `gh issue view` + `gh pr list` + `git worktree list` + `git rev-list`: **what state is the loop in right now?**

**It runs from the checkout of the repo being looked at.** The issues come out of `--repo`; the worktrees, the branches and the processes come out of the checkout. The command **checks that the two halves are talking about the same repository** (the checkout's `origin` against `--repo`) before looking at anything local: if they do not match, or if it cannot be verified —a checkout with no `origin`, for instance—, it invents nothing, it warns and it exits with `1`. Without that check, asking about another repo produced three findings that did not exist, including an accusation of abandonment. It does not matter which directory you invoke it from: **from inside a `.worktrees/<n>` it works too**, because it resolves the main checkout, not the worktree you happen to be standing in.

**It mutates nothing.** Neither labels, nor worktrees, nor branches: there is not a single write anywhere along the way, and there is a test that checks it by looking at the real argv `gh` was called with (not the absence of errors — a command can mutate and exit 0 quite happily). That is the property that lets you invoke it without a second thought, and the one that allows an external watcher to call it in a loop. Everything it finds it **names**; deleting the worktree of somebody who is still working is irreversible, so that one you decide yourself.

**No read carries `--limit`.** Everything paginates. It is the defect that gave rise to this command: a hand-rolled check with `gh issue list --state closed --limit 60` over 99 closed issues reported **6 cases when there were 10**, and the fallback also printed "(ninguno — limpio)".

## The three exit codes

| Code | Means | What to do |
|---|---|---|
| `0` | nothing to review: nothing in flight without signs of life, no residue, no half-done read | nothing |
| `3` | there is something to review: residue, a claim with no live process, orphaned labels, deliveries left unharvested | read the blocks of the report (below) |
| `1` | **it could not be checked**: a read of `gh`, of the processes or of the disk failed | look at the `warning:` lines on stderr, fix the cause and run it again — the report that has been printed is only what is known |

The same three-state convention as `/ct-groom`, so there is no new vocabulary to learn.

**The `1` never degrades into a `0`.** The precedence is `1` > `3` > `0`, never the other way round: if something could not be checked, the result is `1` even if everything else is impeccable. An incomplete read **is not** a loop at rest, and whoever receives the signal has to be able to tell them apart — a `0` over truncated data is exactly the failure this command comes to eliminate. That is why the "loop en reposo" line is only printed when nothing is left unchecked, and that is why a worktree on disk is not accused of being an orphan if the issue read failed. Mind the exact reason, which is not "then nothing is known": with a partial read, the issues that **did** arrive still explain their worktrees, and the report says so. What cannot be concluded is that **nobody claims** the others, because an issue that did not arrive might claim them — and accusing them would be inventing the finding. The warning names only the ones that none of the reads that did work explains.

**A partial finding does not hide the rest.** If the process read fails but the issue read goes fine, what is known is reported, what is not is warned about, and it exits with `1`. The report goes via **stdout** (it is the product); the warnings, via **stderr**, like the rest of the plugin.

**Empty blocks are not printed.** A loop at rest produces two lines, not three headings with "(ninguno)".

## What to do about each block

**`EN VUELO`** — the issues at `status:in-progress`, with their signals: worktree, branch, and whether there is a process working inside the worktree.

- `proceso ✓` — somebody is working. There is nothing to do.
- `← arrancando` — there is no process yet, but the claim has only just been set (below the start-up window, 15 s by default: the same budget as `/ct-next`'s sentinel, and it is read from the same `CT_NEXT_LAUNCH_TIMEOUT_MS` variable). Right after a dispatch, `cmux` is still typing the command. It is not a finding: look again in a few seconds.
- `← SIN SEÑAL DE VIDA` — there is a claim, the claim is not recent, and there is no process working in that worktree. It is the case no other signal of the loop detects: on dying, an agent leaves worktree, branch and `cmux` window in place, so everything else keeps saying "alive". Look at that slice's `cmux` window; if there really is nobody there, the manual remedy is to return the claim to the queue —`gh issue edit <n> --repo <o/r> --add-label status:ready --remove-label status:in-progress`, the same command `/ct-next` prints when it has to revert a claim by hand— and to clean up worktree and branch if you are going to start from scratch. (`dispatch-check --reopen` is **no** use here: it demands `status:in-review`, and this is at `status:in-progress`.)
- `proceso ?` — it could not be checked. Read the warning: nobody is being accused of anything.

**`ENTREGADO, ESPERANDO MERGE`** — the issues at `status:in-review`: finished work whose PR has not been merged yet. It is **informative and does not count as a finding**: it does not alter the exit code, and its worktree is not residue (it is there on purpose). It is here because the command answers three questions —what is in flight, **what it has delivered**, what is residue— and this is the second one. The only thing to do with this block is to merge the PRs; remember that an `in-review` **holds the `area:`/`touches:` tokens until the merge**, so it holds back its area neighbours. Not to be confused with the block below: this one is what is waiting for a merge, that one is what has already been merged and left leftovers behind. The two can come out at once.

And one rule this report cannot apply for you: **whatever you check before merging has to be able to stop the merge.** This command prints; it blocks nothing. If you use it as a step before a merge, the one who decides is you — and a check whose result does not stop the next action is decoration, not a check.

**`ENTREGADO, SIN COSECHAR`** — slices already closed as completed that still leave `.worktrees/<n>` or `feat/<n>` on disk. They take up space and, above all, the worktree **blocks the redispatch of that number**. Once you confirm there is nothing left to rescue: `git worktree remove .worktrees/<n>` and `git branch -d feat/<n>`.

**`RESIDUO`** — two different things, and the report tells them apart because the remedy is not the same:

- `#N cerrado, pero conserva status:…` — the label survived the issue's closure. Closing the issue and removing its label are two separate acts and nothing checks the second, so this piles up on its own (measured in a real repo: 10 out of 99 closed issues). Remove it with `gh issue edit <n> --repo <o/r> --remove-label status:<x>`.
- `.worktrees/<n> su issue #N sigue abierto (status:…) y no está en vuelo` — the issue is **alive**, but nobody is working on it (it is not `in-progress`) nor has it delivered (it is not `in-review`; those go to their own block): typically a `ready` or a `blocked` that left a worktree behind from an earlier round. It comes out named because as long as it exists, `/ct-next` refuses to dispatch that number.
- `.worktrees/<n> ningún issue lo reclama` — there is neither an open issue with that number nor any delivered one on record that left it behind: an abandoned worktree, a requeued one, or one from an issue closed without a merge. This one is the clear candidate for `git worktree remove`.

**Before deleting, read the tail of the line.** When the process check could be made, each worktree in the block says whether somebody is working inside **right now** (`OJO: hay un proceso trabajando dentro ahora mismo (pid N), no lo borres`) or whether there is not. If the check failed, the line **says nothing** about processes — silence there means "it is not known", never "there is nobody".

## What «sin señal de vida» means exactly

That **on this machine** there is no `claude` process whose working directory is inside `.worktrees/<n>`: your user's processes are listed (`ps -u <uid> -o pid=,comm=`), the ones invoked through a path whose last segment is exactly `claude` are filtered, and a single call to `lsof` reads the `cwd` of all of them in one go.

It identifies by **the invoked path**, not by the process name, and that has consequences worth knowing. The native installer leaves `~/.local/bin/claude` as a symlink to `~/.local/share/claude/versions/<version>`, so the process name the system sees **is the version number** (measured: `ps -o ucomm=` returns `2.1.221`), not `claude`. And the desktop app falls outside by that same criterion, with no special rules: its executable is `Claude` with a capital and its helpers are `Claude Helper` — an open window is not an agent working in a worktree.

Three points to bear in mind before acting on that warning:

1. **It is local, and only local.** The command cannot assert that nobody is working that slice on **another machine**, nor inside a container, nor under another system user. It says what it sees from here. If that repo's loop is dispatched from more than one place, "sin señal de vida" means "nobody is working on it *here*".
2. **It warns, it never reverts.** It does not remove the claim, it does not delete the worktree, it does not touch the branch. The decision —and its consequences— are yours.
3. **When it cannot be checked, nobody is accused.** If `ps` or `lsof` are missing, fail, hang (both calls carry a time cap) or return something unreadable, the report says **"no se pudo comprobar"** and exits with `1`; never "dead". The same goes for the claim's age: if the issue's timeline cannot be read, that slice is not declared abandoned — it is said that it is not known when its claim dates from. Accusing a healthy slice of abandonment because a tool is missing would be this command's worst possible failure.

The claim's age comes out of the issue's **timeline** (the most recent `labeled` event for `status:in-progress`), not out of the issue's `updated_at`: that one changes with any edit —a comment, another label—, so a recent comment would make a three-hour-old claim pass for "arrancando".
