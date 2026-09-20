<!-- Durable guide for this repository (≤150 lines). Procedures → Skills. -->

# This repository is written in English

Everything. Code, tests, documentation, commit messages, branch names, issues and
pull requests. There is one exemption and it is named below; if what you are
writing is not that exemption, it is English.

This document and `AGENTS.md` carry the same text on purpose, so that no agent
reaches this repository through one of them and misses the rule.

## The rule, surface by surface

| Surface | Language |
|---|---|
| File and module names, types, functions, methods, variables, parameters, constants | English |
| Test names — `describe`, `it`, `test` | English |
| Error messages, log lines, diagnostics, anything a program prints | English |
| Comments and docstrings, where the yardstick allows any at all | English |
| Documentation, `README.md`, `Makefile`, CI workflow comments | English |
| Commit messages and branch names | English |
| GitHub issues and pull requests — title, body and comments | English |
| Agent prompts, skills, slash commands, seeded templates | English |
| **Frontend product copy** | **Spanish** |
| Values fixed by an external contract | Whatever that contract spells |

## The one exemption: what a person reads in the product

`plugin/conventions/style.md` already draws this line and this repository keeps
it exactly where it is:

> This does not cover text an end user reads. Product copy, labels, and any
> message surfaced in a user-facing interface are not this document's business:
> their language is the product's decision, not this rule's.

Control Tower's interface is read by Spanish-speaking engineers. The strings in
`frontend/src/` that reach the screen — field labels, banners, progress text,
error copy — stay in Spanish until the product decides otherwise. That decision
is not a style decision and no agent takes it while translating.

The exemption is narrow. It covers **what renders**, not the code around it: the
component's name, its props, its test names, its `__scenarios__` mothers and any
message that only ever reaches a log are all English.

## The second exemption: values fixed by a contract

A string that an external system decides keeps that system's spelling. The GitHub
labels of the loop's ladder (`status:backlog`, `status:ready`,
`status:in-progress`, `status:in-review`, `status:blocked`, `status:rejected`,
`gate:none`) are already English and do not move. Neither do the block markers
`ct-init` writes into governed repositories (`<!-- ct-init:slices-contract -->`),
the YAML keys of `.agent/STATE.md`, or the paths that code validates against —
`docs/superpowers/plans` is checked by `plan-contract-progress.ts` and read by
`task-brief.test.js`; it is a contract, not a name you are free to translate.

### The parsed headings — Spanish, and contract until a coordinated change

Ten markdown headings are anchors the code locates sections by. They read as
prose and they are still Spanish, and they are contract anyway:

| Heading | Pinned at |
|---|---|
| `## Contexto del epic` written, `## Contexto del milestone` read too | `plugin/scripts/milestone-context.js` `MilestoneContextHeading` |
| `## Contexto heredado` | `plugin/scripts/groom.js` `INHERITED_CONTEXT_HEADING` |
| `## Decisiones congeladas` | `plugin/scripts/groom.js` `FROZEN_DECISIONS_HEADING` |
| `## Dependencias` | `plugin/scripts/gh-issue-map.js` `DEPS_HEADING` |
| `## Acceptance criteria (EARS, 1:1 con tests)` | `backend/src/infrastructure/gh-plan-issues.ts` `AC_HEADING` |
| `## Descripción`, `## Hipótesis`, `## Señal de observabilidad`, the judge's telemetry heading, `## Current State` with its dispatched-slice subtitle | literals in `plugin/scripts` and `backend/src` |

Each lives in three places at once: the constant, the body of every live GitHub
issue, and every governed repository's spec. Translating one is a coordinated
change of all three in a single move — otherwise `/ct-groom --reconcile` stops
finding the section and dispatch breaks. **Until that change happens they stay
Spanish everywhere, issues and pull requests included.**

#### The first row is the one that already moved, and how

Issue #346 renamed the milestone's context heading without touching a single
issue or spec, and the shape it used is the shape any of the other nine would
have to use. It is a **dual read with a deferred write**:

- what is **read** accepts **both** `## Contexto del epic` and
  `## Contexto del milestone` — a body or a spec carrying either is found,
  hydrated from, and reports **no drift for the spelling alone**. That is what
  leaves the already groomed issues and the frozen specs where they are;
- what is **written** into an issue is still `## Contexto del epic`. See the
  rule below: this is not indecision, it is the only spelling that is safe to
  write today;
- `--reconcile` brings the section's **content** up to date under whichever
  spelling it finds, and leaves that spelling as it is. It writes
  `MilestoneContextHeading.WRITTEN` only when inserting the section from
  scratch;
- **both spellings in one body is a finding**, never a silent choice between
  them. Every reader here takes the first occurrence, so the text under the
  other one would be read by nobody while looking to a human like context that
  is honoured. In a spec it comes out as the malformed reason, which authorises
  touching nothing; in an issue it comes out as a note naming both.

#### The rule a rename of any of these ten has to obey

**No issue may be written with a heading that the gate installed where it will
be checked cannot read.** A reader inside this repository is updated by
merging. A reader **vendored into somebody else's repository is not**:
`plugin/scripts/build.mjs` bundles `scope.js` into `plugin/dist/scope-check.js`
and `ct-init` seeds that bundle into each governed repository, where it runs in
that repository's own CI with no plugin installed. A copy seeded before #346
recognises `## Contexto del epic` and nothing else, so writing the new spelling
fails the scope gate of every new issue in a repository we cannot fix by
merging — and it fails for a reason that has nothing to do with the work,
because the gate cannot find the section that declares the scope.

**The switch, and who checks what.** The flip is one line —
`WRITTEN: MILESTONE_HEADING` in `plugin/scripts/milestone-context.js` — and
every writer follows it. Before flipping it, confirm that every governed
repository has re-vendored a `dist/scope-check.js` that accepts both spellings
(the one this repository ships does). The list of governed repositories is not
in this tree, so that is a person's check, not a grep's;
`plugin/__tests__/milestone-context.test.js` pins what is written today so the
flip cannot happen by accident.

**Retiring `## Contexto del epic` is a third decision**, later than the flip and
different from it: it needs evidence that no live issue and no spec a
`/ct-groom --reconcile` could still touch carries it. Both spellings live in
`plugin/scripts/milestone-context.js` and nowhere else — `groom.js` re-exports
them, `gh-issue-map.js` reads which one an issue carries so the kickoff can name
the section the dispatched agent will actually find, and `scope.js` reads them
inside the vendored gate. Whoever retires the spelling does it there, once, and
the four readers follow.

The plan's own sections (`## 7. Tasks`, `## 8. Global verification`,
`**Objective:**`, `**Files:**`, `**TDD:**`, `**Tests:**`, `**Verification:**`)
are already English and are not affected.

## This repository does not take the declared-debt exemption for language

`plugin/conventions/style.md` grants one exemption in the whole travelling
yardstick: a module that was already there and does not conform is the
repository's **declared debt**, and what you add to it may follow the style of
its host — *"half a migration reads worse than none."*

That clause exists for the repositories Control Tower governs, which arrive with
their own history. **It does not shelter this one.** The precedent is
`backend/conventions/this-repository.md`, which already refuses the same
exemption for `backend/`; this document extends the refusal to the whole
repository and to the language rule specifically.

The yardstick's other two rules — no prose in the code, and no free function at
module level — keep their exemption here. They are a different piece of work.

While Spanish modules remain, they are debt being paid down, not licence: a diff
that touches one leaves it in English, and a new module is born in English with
no exemption to claim.

## The vocabulary is decided, not improvised

`docs/glossary.md` maps every Spanish domain term this repository still carries to
the English term already in use somewhere in the tree. It is extraction, not
invention: the English vocabulary is established in
`backend/conventions/this-repository.md`, in the eight English documents of
`plugin/conventions/`, and in the script filenames that already carry it —
`plugin-yardstick.js`, `harvest.js`, `dispatch.js`, `reconcile.js`, `scope.js`,
`claim.js`, `step-contracts.js`.

Read it before you rename anything. A term translated two ways is worse than a
term left in Spanish, because the second is visibly debt and the first looks
finished.

## The historical record is not translated

`docs/superpowers/plans/` and `docs/superpowers/specs/` hold dated plans and
design documents, and `docs/prompt-*.md` holds the prompts of sessions that
already happened. They are the minutes of decisions already taken. Translating
them would rewrite what was actually written at the time, so they stay in
Spanish and keep their filenames.

**New** plans, specs and documents are written in English. The rule binds
forward, and the same applies to git history: past commit messages stay as they
were written and nothing here rewrites them.

## Feature flags are opt-in in this repository

The user has disabled the `flag-discipline` default for this project. Do not
invoke that skill or require a feature flag for a development or behavior change.
Implement changes directly unless the user explicitly requests a feature flag.
This is a repository-local instruction; it does not change other projects or
the conventions the plugin distributes to governed repositories.

## Start every issue in the Project

Before editing files or running an implementation command for a GitHub issue,
add its canonical URL to Project 16 and set its item status to `In Progress`:

```sh
gh project item-add 16 --owner mercadona --url "<issue URL>" --format json
gh project item-edit 16 --owner mercadona --url "<issue URL>" --field "Status" --value "In Progress" --format json
```

The add is safe if the auto-add workflow already added the item. If either
command fails, stop before implementation and report the Project error.

## A repository control is not an obstacle to route around

The hooks, the branch protections, the CI gates and the permission prompts are
this repository's controls. An agent working here does not disable one, does not
pass a flag that skips one, and does not shape a command so that one stops
looking.

Named, because these are the forms it actually takes:

- `--no-verify` on a commit or a push;
- `git -c core.hooksPath=…`, or any invocation that moves the hooks aside;
- editing, renaming or deleting a hook to get a command through;
- `--force` past a protection that refused;
- `--admin` on a merge, or any other way of stepping over the ruleset of `main`;
- weakening a test, a gate or an assertion until it stops failing.

**A control that refuses when it should not is a finding, not an obstacle.** Stop,
say what refused and why you believe it is wrong, and let a person decide. A
control that was routed around is worth nothing afterwards: nobody can tell any
more whether it ever protected anything.

This binds whatever the permission mode is. `bypassPermissions` says the human
stopped being asked; it does not say the repository stopped deciding.

### What stands between a change and `main`, exactly

The gate is the CI and nothing else. `main` carries a ruleset that requires the
`ci` check green with the branch up to date, asks for no approval, and has no
bypass actor. A merge waits for a test run, not for a person.

It reads that way because the gate before it could not be satisfied. It asked
for one approval; the person who writes almost everything here cannot approve
their own pull request; and the ruleset carried an `always` bypass for
repository admins. So every merge went through `--admin`, no status check was
ever required underneath, and the control protected nothing while looking like
it did. **A gate nobody can pass is not a strict gate. It is an absent one with
a sign on it**, and this document said the sign was real.

Two consequences an agent works under. `--admin` no longer gets past anything:
it is refused with *Repository rule violations found*, which was watched
happening on a pull request opened for no other purpose. And a branch has to be
up to date with `main` before it merges, so a pull request that went green
against an older `main` is measured again on the tree it will actually land on.

`ci` is the one required check on purpose. It is the aggregator that counts a
skipped job as a pass and fails when the job that decides what to run did not
succeed; requiring `backend` or `frontend` directly would block every pull
request that does not touch them.

When the CI is stuck and something has to land anyway, the route is to change
the ruleset — visibly, leaving a record of who opened it and when — and never
to find a flag that steps over it.

### The control that was wrong, and the route that was not a workaround

Kept because the reasoning is the part that travels, not the fault. What follows
describes the version that was wrong, in the present tense it was written in.

`branch-protection.py` resolves the current branch by running `git rev-parse`
with no `cwd`, so it inherits the working directory of the session that invoked
it. A session sitting in the main checkout on `main` therefore has every push
refused as if it targeted `main` — including the push of a feature branch from a
worktree, which is exactly what the hook exists to allow.

The legitimate answer is to make the session's own working directory the
worktree, so the hook resolves the branch that is really being pushed. That is
not a workaround: it makes the hook see the truth instead of hiding it. An agent
whose working directory is pinned elsewhere — a subagent, for instance — cannot
do that, and hands the push back instead of getting past the hook another way.
**That paragraph is not history.** It is what any agent does with any control it
cannot legitimately satisfy, and the fix below does not retire it.

The fix was one argument, `cwd`, on that `subprocess.run`. It landed in
`mercadona/skills#553` and was confirmed here on the push of a feature branch
from a main checkout sitting on that branch. The hook lives in a cached plugin
outside this repository, so a machine that has not pulled it still runs the old
one: check the first push of a session rather than assuming the fix is there.

## The title of a pull request is the message that reaches main

This repository merges by squash and nothing else: `allow_merge_commit` and
`allow_rebase_merge` are both off, `squash_merge_commit_title` is `PR_TITLE` and
`squash_merge_commit_message` is `PR_BODY`. So the commit that lands on `main`
carries the pull request's title as its subject and its body as its body. What
you wrote in the branch never arrives.

**That title carries a conventional-commit type**, because release-please reads
the subject of every commit on `main` to decide whether there is anything to
release. `release-please-config.json` declares which types it recognises:

| Type | Where it lands |
|---|---|
| `feat`, `fix`, `perf`, `refactor`, `revert`, `docs` | A section of the changelog |
| `test`, `chore`, `build`, `ci`, `style` | Recognised, hidden from the changelog |

A subject with no type is not an error anywhere. It is simply invisible: nothing
is added to the changelog, no version rises, and the release pull request stays
where it was.

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

## What to do when you are unsure

- **Is this string read by a person using the product?** If yes, Spanish. If it
  only ever reaches a log, a test name or another program, English.
- **Is this value decided by GitHub, git, the filesystem or a seeded contract?**
  If yes, leave the spelling alone.
- **Is this a new module or test under `backend/`?** The backend is TypeScript
  and every module there is `.ts`; `backend/conventions/this-repository.md`
  holds the rule and what erasable syntax allows.
- **Is there already an English word for this in the tree?** Use that one. Check
  `docs/glossary.md` first, then grep `plugin/conventions/`.
- **Did a hook, a gate or a protection just refuse me?** Stop and report it.
  Never disable it, skip it, or command your way past it.
- **Am I writing the title of a pull request?** It carries a
  conventional-commit type, because that title becomes the commit on `main` and
  release-please reads it. The prose stays; the type goes in front.
- **Anything else:** English.
