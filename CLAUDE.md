<!-- Durable guide for this repository (≤150 lines). Procedures → Skills. -->

# This repository is written in English

Everything. Code, tests, docs, commit messages, branch names, issues and pull
requests. Two exemptions are named below; if what you write is not one of them,
it is English. This document and `AGENTS.md` carry the same text on purpose, so
no agent reaches this repository through one and misses the rule.

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

The last row covers GitHub labels, the markers `ct-init` writes, the keys of
`.agent/STATE.md`, the paths code validates against, and ten parsed markdown
headings that are Spanish **and contract** until a coordinated change moves all
three of their homes at once.

No declared-debt exemption here: a diff that touches a Spanish module leaves it
in English. `docs/glossary.md` decides the vocabulary — read it before renaming.
Dated plans, specs and `docs/prompt-*.md` are minutes of decisions already taken
and are not translated; new ones are written in English.

**All of that in full, with the ten headings, the rename protocol and the one
rename that already happened: `docs/language.md`.**

## Feature flags are opt-in in this repository

The `flag-discipline` default is off here: do not invoke that skill and do not
require a feature flag for a development or behaviour change. Implement directly
unless the user asks for a flag. Repository-local — it changes nothing for other
projects, nor the conventions the plugin distributes to governed repositories.

## Start every issue in the Project

Before editing files or running an implementation command for a GitHub issue, it
goes into Project 16 with its item at `In Progress`, and it moves to `In Review`
and `Done` as its pull request does. If the Project refuses, stop before
implementation and report it rather than working outside the board.

**The commands, and why the obvious one fails: `docs/project-16.md`.**

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
say what refused and why you believe it is wrong, and let a person decide: one
that was routed around is worth nothing afterwards, because nobody can tell any
more whether it ever protected anything. This binds whatever the permission mode
is. `bypassPermissions` says the human stopped being asked;
it does not say the repository stopped deciding.

### What stands between a change and `main`, exactly

The gate is the CI and nothing else. `main` carries a ruleset that requires the
`ci` check green, merges through a merge queue, asks for no approval, and has
no bypass actor. A merge waits for a test run, not for a person.

It reads that way because the gate before it could not be satisfied: an approval
nobody could give their own pull request, an `always` bypass for admins, and no
required check underneath. Every merge went through `--admin`, and the control
protected nothing while looking like it did. **A gate nobody can pass is not a
strict gate. It is an absent one with a sign on it**, and this was the sign.

`--admin` no longer gets past anything: it is refused with *Repository rule
violations found*, watched happening on a pull request opened to test it. A
merge goes through the queue, which builds each entry on top of `main` and of the
entries ahead of it and runs `ci` there, so one green against an older `main` is
measured again on the tree it will land on. The branch itself does not have to be
up to date: that rule made every move of `main` re-run the pull request's own CI
before the queue measured the same thing again, and the queue already gives what
it gave. `ci` is the one required check
because it is the aggregator that counts a skipped job as a pass and fails when
the job deciding what to run did not — requiring `backend` or `frontend` would
block every pull request that does not touch them.

When the CI is stuck and something has to land, the route is to change the
ruleset — visibly, leaving a record of who opened it and when — and never to
find a flag that steps over it.

### The control that was wrong, and the route that was not a workaround

Fixed, and kept because the reasoning travels. In the version that was wrong,
`branch-protection.py`
resolves the current branch by running `git rev-parse` with no `cwd`, so a
session sitting in the main checkout on `main` had every push refused as if it
targeted `main` — including a feature branch pushed from a worktree, which is
what the hook exists to allow. The answer was to make the session's working
directory the worktree, so the hook resolves the branch really being pushed:
that is not a workaround, it makes the hook see the truth. An agent whose
working directory is pinned elsewhere — a subagent — cannot do that, and
hands the push back instead of getting past the hook another way. **That last
sentence is not history**: it is what any agent does with any control it cannot
legitimately satisfy.

The fix was one argument, `cwd`, in `mercadona/skills#553`. The hook lives in a
cached plugin outside this repository, so a machine that has not pulled it still
runs the old one: check the first push of a session.

## The title of a pull request is the message that reaches main

This repository merges by squash and nothing else, with the title as the commit
subject and the body as the body. **What you wrote in the branch never
arrives**, so the title is the message.

**That title carries a conventional-commit type**, because release-please reads
the subject of every commit on `main` to decide whether there is anything to
release. A subject with no type is not an error anywhere — it is simply
invisible, and nothing is released.

**The types, why an untyped title is worse than it sounds, and what the rule
does not claim: `docs/pull-request-titles.md`.**

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

<!-- ct-init:loop -->
## Control Tower loop

This repo is governed by the Control Tower loop: **one issue = one slice = one session**.

- **This repo's commands**: build `make build-plugin build-frontend` · test `make test-all`, and `npx tsc -p tsconfig.json` in `backend/` · lint: none; do not run `npx eslint`, it installs itself and rewrites `package.json`.
- **This repo's yardstick** —the documents of code rules that `ct-step`
  pastes into every task's brief— is declared in `.agent/conventions.md`. ct's
  own yardstick travels with the plugin and rules where the two say the same
  thing; where ct says nothing, the repo's yardstick rules in full.
- **A dispatched slice's state is `.agent/SLICE.md`**, its OWN worktree's
  (ignored by git, never product). `.agent/STATE.md` is the main checkout's
  coordinating session's, and a slice does not touch it. If you get stuck,
  write `blocked: {reason, unblock}` in your `SLICE.md` and STOP.
- **Each slice works in `.worktrees/<n>` on `feat/<n>`**, and its claim
  (`status:ready` → `status:in-progress`) is done by `/ct-next` in code: do not
  move those labels by hand. When opening the PR, put `Closes #N` in the body.
- **What does not reach the issue's body does not reach the agent**: it does not receive the spec.
- **The slices table format —the contract with `/ct-groom`— lives in
  [`docs/superpowers/SLICES-CONTRACT.md`](docs/superpowers/SLICES-CONTRACT.md)**:
  which columns it reads, what each one generates, and what `/ct-next` does with them. It is
  what whoever writes a spec for this repo reads. `/ct-init` maintains it, it carries its
  own version, and it is not edited by hand.
- **How to bring this repo up** to walk it end to end: the section
  «Cómo se atraviesa este repo (e2e)», below. Fill it in once.
<!-- /ct-init:loop -->

<!-- ct-init:e2e-howto -->
## Cómo se atraviesa este repo (e2e)

<!-- Rellena esto UNA vez. Lo lee el agente de un slice cuya fila declara
     recorridos en la columna E2E de la tabla de slices. Si está sin
     rellenar, el agente marca sus recorridos como "no-verificado" y NO se
     inventa cómo levantar el repo. -->

- Levantar:
- Listo cuando:
- Plazo:              (opcional; por defecto 60 segundos)
- Tirar:
- Herramientas:
- Fuera de límites:
<!-- /ct-init:e2e-howto -->
