---
description: The rehearsal before a merge — would each open pull request still be green on the main it will land on, and would any two of them still be green on top of each other? Read-only.
---
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-premerge.mjs --repo "<owner/repo>" [--base <branch>] [--no-pairs]
```

Run it from the main checkout of that repository, before merging anything. **It mutates nothing anybody else can see**: it never rebases a pushed branch, never pushes, never merges and never touches the ruleset. Every measurement happens in a throwaway worktree under the system temp directory, removed even when a suite fails.

It answers two questions. The first — *does this pull request still hold on the current `main`?* — GitHub also answers, slowly, after a full CI run. The second is the one **no CI asks**: whichever of two pull requests lands second sits on a tree its own run never saw. Pass `--no-pairs` when only one is going in and you want the fast half.

| Exit | Means | What to do |
|---|---|---|
| `0` | Everything open holds, alone and in every pair | merge in any order |
| `3` | There is something to review: one would break, or two do not hold together, or one does not rebase | read the lines that are not `holds` |
| `1` | **It could not be measured**: an install or a read failed | fix the cause and run it again — what is printed is only what IS known |

The `1` never degrades to a `0`, the same precedence `/ct-status` and `/ct-groom` use.

Two behaviours worth knowing before you read a red. A suite that fails is **run again by itself** before being reported, because the `*-real-process` family times out under load; if it passes the second time the line says `holds` and still names what failed first, as a flake, rather than hiding it as a pass. And a worktree with no `node_modules` of its own is installed before anything is measured — otherwise the check that the built plugin matches its sources comes back red for a reason that is not the change.

Which suites run is not decided here: it is `plugin/scripts/changed-packages.js`, the same object the `changes` job of the CI workflow asks. One rule, two callers.
