<!-- Moved out of `CLAUDE.md` and `AGENTS.md` so those fit the 150 lines they
ask for. Nothing here was rewritten. The rule — a pull request title carries a
conventional-commit type, because that title becomes the commit on `main` —
stays there. -->

# Why the title of a pull request carries a type

This repository merges by squash and nothing else: `allow_merge_commit` and
`allow_rebase_merge` are both off, `squash_merge_commit_title` is `PR_TITLE` and
`squash_merge_commit_message` is `PR_BODY`. So the commit that lands on `main`
carries the pull request's title as its subject and its body as its body.

`release-please-config.json` declares which types it recognises:

| Type | Where it lands |
|---|---|
| `feat`, `fix`, `perf`, `refactor`, `revert`, `docs` | A section of the changelog |
| `test`, `chore`, `build`, `ci`, `style` | Recognised, hidden from the changelog |

### Why an invisible commit is worse than it sounds

The plugin's cache is keyed by version. A session executes
`~/.claude/plugins/cache/control-tower/control-tower-loop/<version>`, so while
`plugin/.claude-plugin/plugin.json` says the same number, nothing is re-fetched
and **no change under `plugin/` reaches anybody**.

That is not hypothetical. Measured on 2026-09-17: ten days and 274 commits
after `plugin-v0.57.0`, one of twenty subjects carried a type, so no version had
been published and every session was still running the plugin of ten days
before — including a `ct-init` that had been merged and had never run anywhere.

### The prose is not the price

The type is a prefix. It does not replace the sentence this repository asks a
subject to be, and the sentences that landed before the rule read the same with
one in front:

```
feat: gate 2 offers the review of the slicing before the groom
fix: the coordinating session is handed the resolved claude directory
refactor: the backend stops opening the login shell nobody asked for
```

A subject still says what changed and it is still English. It just also says
which kind of change it is, to the one reader that cannot infer it.

### What this rule does not claim

Nothing enforces it today. `commit-keyword-guard` is a `PreToolUse` hook on
`Bash` and it guards closing keywords in a commit command, which is neither the
title of a pull request nor this question. Whether a check should refuse an
untyped title, and where that check would live, is open.

---

The whole path a change takes from a merge to somebody else's session — the
release pull request, the run that waits to be approved, and why your own
machine may not be able to tell you any of it: `docs/loop/publishing.md`.
