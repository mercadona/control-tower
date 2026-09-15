# {{#<issue> — what this slice delivers}}

> **Task-scoped subagents execute this plan.** They arrive with no context. They decide
> nothing. Each task carries the state of what it changes, copied exactly from the repo, and
> the contracts it obeys and the commands that verify it.

> You write the bodies. You write the test first. This document decided the names, the
> signatures, the constants and the test names. If a decision is not clear, follow the issue
> body and AGENTS.md.

## 1. Context and goal

{{Current state of the code this slice touches, with real paths and symbols. What the issue
asks for, in one paragraph.}}

### Desired end state

{{Concrete list of what exists once every task finishes — mirror the issue's acceptance
criteria.}}

### Out of scope

{{What this slice deliberately does not do — start from the issue's "Out of scope /
Protected" section. If nothing: N/A — <reason>.}}

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| {{decision}} | {{an order: one value, stated}} |

## 3. Reference patterns

{{The yardstick of this repo for this slice, in two lists. This section alone tells the
implementer how this repo writes code, and tells the judge what to block on. So `--check-plan`
greps every path you name here. A path that is not in the repo fails the plan.}}

Files to imitate: {{real files whose shape the implementer copies — same role, same layer. Or
N/A — <reason>.}}

Rules to obey: {{If the repo declares one, start from `.agent/conventions.md`. Then list this
repo's own convention documents by path — `AGENTS.md`, `CLAUDE.md`, a file under
`docs/conventions/`, `CONTRIBUTING`. Add any skill the issue's milestone context section names. A
skill is not a path, so `--check-plan` does not check it against the disk. Or N/A — this repo
declares none.}}

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| {{path}} | create / modify | {{who}} | Contract / Call site / Current state / Final text / prose (config) / none (body by TDD) |

## 5. Interfaces

Consumes: {{the interface the issue declares for its dependency — names and signatures inline,
in prose; or N/A — no dependencies. If you must quote it from the repo, quote it inside the task
that consumes it, with `Current state (path, lines A-B):`.}}

Produces: {{what later slices rely on — one exported name and signature per line, in prose. The
task that creates the file carries the block, and its task brief includes it. Or N/A —
<reason>.}}

## 6. Test strategy

{{What gets tested and how, following AGENTS.md commands. If a task carries no tests, say so
here with the reason, so the implementer knows it is deliberate.}}

## 7. Tasks

### Task 1 — {{name}}

**Objective:** {{one sentence: the observable behavior this commit delivers}}

**Files:** {{exact paths between backticks, each marked (create) or (modify)}}

Current state (path/to/file.ext, lines A-B):

{{ONLY the stretch that changes, max 12 lines, copied verbatim from the repo — the validator
greps it.}}

Contract (path/to/file.ext):

{{Max 25 lines: types, interfaces, exact signatures, typed errors, and constants the implementer
cannot derive (formats, flags, magic values). Declarations only: you write the bodies test-first.}}

Call site (path/to/consumer.ext):

{{Max 10 lines, before -> after: how the call reads in the consumer once you finish this task —
route, handler, component usage.}}

Final text (path/to/doc.md):

{{Max 12 lines, text artifacts only (.md/.txt/.rst/.adoc): the exact replacement wording, and
only claims you verified against the repo. Code and configuration travel by their own labels.}}

{{Configuration (tsconfig, package.json, CI workflows, lockfiles) travels as prose with the
value inline. A task whose work carries no block says so with the exact line:
No code — <reason>. Blocks add up to 30 lines per task, and each task fits on ONE A4 page:
3500 characters. If a task does not fit, the task is two: one task is one commit.}}

**TDD:** {{red first: literal test name and the assertion that pins the boundary → minimal green
| No TDD — <reason>}}

**Tests:** {{added: named one by one / removed on purpose: named one by one | N/A — <reason>}}

**Verification:** {{Say what the commands prove. The commands go in the fenced block below, one
to a line, and you ran them already. A program executes that block, so it carries commands
only, and `--check-plan` refuses a task with none.}}

```bash
{{command}}   # {{expected: exit 0 — the comment says what exit 0 will mean here}}
```

{{The program scores this block by exit code alone, so every command is a predicate: its exit
code is the claim. Put any assertion about a count, a line, or output inside `test`. For
example: `test "$(… | grep -c 'x')" -eq 2`, `test "$(wc -l < f)" -le 150`, or
`test -z "$(git status --porcelain)"`.

Keep the claim in the command, not in the comment. `grep -c` exits 0 when it finds at least one
match and 1 when it finds none. So a check like `grep -c … # expected: 0` turns green exactly
when it should turn red. `--check-plan` rejects a command whose exit code cannot prove its
claim.}}

### Task 2 — {{name}}

**Objective:** {{...}}

**Files:** {{...}}

{{Same four block roles, same budgets.}}

**TDD:** {{... | No TDD — <reason>}}

**Tests:** {{... | N/A — <reason>}}

**Verification:** {{...}}

```bash
{{command}}   # {{expected: exit 0 — a predicate, as in Task 1}}
```

## 8. Global verification

{{This validates the slice end-to-end once you commit the last task. `ct-step global` runs it
right after that commit. So the commands go in a fenced block. Each command is a predicate that
exits 0, the same rule as a task's **Verification:** block.

Prose before and after the block is welcome: what to start, what to look at with human eyes. A
slice with nothing to run end-to-end — pure documentation or configuration — has no block. It
uses the exact line `N/A — <reason>` in place of one. `--check-plan` rejects a §8 that has only
prose.}}

```bash
{{command}}   # {{expected: exit 0 — a predicate, as in every task}}
```

## 9. Assumptions

{{Numbered: every ambiguity you resolved on your own, what you decided, and its provenance
(issue / milestone context / repo convention / own call).}}
