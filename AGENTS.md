<!-- Durable guide for this repository (≤150 lines). Procedures → Skills. -->

# This repository is written in English

Everything. Code, tests, documentation, commit messages, branch names, issues and
pull requests. There is one exemption and it is named below; if what you are
writing is not that exemption, it is English.

This document and `CLAUDE.md` carry the same text on purpose, so that no agent
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
| `## Contexto del epic` | `plugin/scripts/groom.js` `EPIC_CONTEXT_HEADING` |
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
- weakening a test, a gate or an assertion until it stops failing.

**A control that refuses when it should not is a finding, not an obstacle.** Stop,
say what refused and why you believe it is wrong, and let a person decide. A
control that was routed around is worth nothing afterwards: nobody can tell any
more whether it ever protected anything.

This binds whatever the permission mode is. `bypassPermissions` says the human
stopped being asked; it does not say the repository stopped deciding.

### The one control known to be wrong, and the route that is not a workaround

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

The real fix is one argument, `cwd`, on that `subprocess.run`. It lives in a
cached plugin outside this repository, so until it lands, the route above is the
route.

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
- **Anything else:** English.
