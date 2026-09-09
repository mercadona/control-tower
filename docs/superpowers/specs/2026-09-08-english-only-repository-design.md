# An English-only repository

## The problem, stated precisely

This repository is bilingual, and not by decision. `plugin/conventions/style.md`
already carries a section titled **"Code is written in English"** that binds file
and module names, types, functions, variables, constants, errors, **test names**
and diagnostic messages, and lists as an antipattern *"an identifier in a
language other than English that is not contract data."*

Every Spanish identifier in the tree survives that rule through one clause of the
same document — the **declared debt** exemption:

> A module that was already there and does not conform is the repository's
> declared debt (...) half a migration reads worse than none.

So the work is not *adding* a rule. It is **paying that debt**, and widening the
rule to the surfaces it never covered: prose, documentation, commit messages,
branch names, issues and pull requests.

## What is actually Spanish

Measured on `b77c76e`, excluding `node_modules/` and `plugin/dist/`.

| Area | State |
|---|---|
| `plugin/conventions/` (8 files), `backend/conventions/` | already English |
| `backend/src/` | 67 of 71 English |
| `frontend/src/` | 74 of 93 English |
| `plugin/skills/` | 37 of 47 English |
| `plugin/scripts/` | **63 of 79 Spanish** — 37K LOC |
| `plugin/__tests__/` | **159 of 193 Spanish** — 52K LOC |
| `docs/` | **66 of 66 Spanish** — 32K LOC |
| `plugin/commands/` (5), `README.md`, `Makefile` | Spanish |

Plus roughly 2,670 Spanish test names across 113 test files, about 30 Spanish
filenames outside `docs/` and about 45 inside it.

The baseline this migration must not break: **5,465 tests across 205 files, all
green**.

## Four couplings that shape the scope

These are not cosmetic, and each one decides part of the sequence below.

1. **`plugin/__tests__` imports `plugin/scripts` by name — 178 times.** Renaming
   `vara.js` breaks its tests. A script and its tests move in the same commit.
2. **`ct-init.sh` seeds artefacts into other repositories** and carries a ledger
   of sha256 hashes of every version of the slices-contract block it has ever
   emitted. One seeded artefact is named `docs/superpowers/CONTRATO-SLICES.md`.
   The block markers are already English (`<!-- ct-init:slices-contract -->`), so
   only the block's content, its version and its hash change.
3. **The judge's prompts are measured.** `docs/judge-bench-linea-base-2026-09.md`
   fixes an N=5 run against the sha256 of `plugin/agents/ct-judge.md`.
   Translating that file changes the model's prompt, not a format: it is a
   behavioural change and it must be re-measured.
4. **Some `docs/` paths are contract.** `plan-contract-progress.js` validates
   against `docs/superpowers/plans`, and `task-brief.test.js` reads a plan from
   there. Those paths are not free names and do not move.

## The rule

Written in full in both `AGENTS.md` and `CLAUDE.md` at the repository root.

**`plugin/conventions/style.md` is not modified**, and that is a decision worth
stating. That document is the *travelling* yardstick: it binds the diffs of every
repository Control Tower governs. Its declared-debt exemption exists for those
repositories, which arrive with their own history — removing it there would
oblige every governed repository to migrate its legacy code as the price of being
governed.

The exemption is refused **in this repository's own document** instead, which is
the pattern already established: `backend/conventions/this-repository.md` carries
a section titled *"No declared debt"* that refuses the same exemption for
`backend/`. `AGENTS.md` extends that refusal to the whole repository, for the
language rule specifically. The yardstick's other two rules — no prose in the
code, and no free function at module level — keep their exemption here; they are
a different piece of work.

| Surface | Rule |
|---|---|
| Code, tests, file and module names | English |
| Prose: documentation, README, CI comments | English |
| Commit messages, branch names | English |
| Issues and pull requests: title, body, comments | English |
| Agent prompts, skills, commands | English |
| **Frontend product copy** | **Spanish — explicitly exempt** |
| Values fixed by an external contract | Kept as that contract spells them |

The frontend exemption is the one `style.md` already grants: *"This does not
cover text an end user reads (...) their language is the product's decision, not
this rule's."* Control Tower's interface is read by Spanish-speaking engineers,
and translating it is a product decision nobody has taken.

## The glossary

`docs/glossary.md`. It is **extraction, not invention**: the
English vocabulary is already established in this repository, in
`backend/conventions/this-repository.md` (its *Ubiquitous language* table), in
the eight English documents of `plugin/conventions/`, and in the twenty-two
script filenames that already carry it (`plugin-yardstick.js`, `harvest.js`,
`dispatch.js`, `reconcile.js`, `scope.js`, `claim.js`, `step-contracts.js`).

It lives at `docs/glossary.md`, not in `plugin/conventions/`: the mapping
"vara → yardstick" is a migration aid meaningful only in this repository, and it
is written to be deleted the day no term in its left column survives in the tree.

The migration is half-done in the tree and the glossary is what finishes it
consistently: `vara.js` and `plugin-yardstick.js` sit side by side today, and
"vara" appears about 700 times.

The terms that carry the weight, by frequency:

| Spanish | English | Occurrences |
|---|---|---|
| estado | state / status | 968 |
| rama | branch | 960 |
| tarea | task | 915 |
| aviso | warning | 741 |
| vara | yardstick | 700 |
| juez | judge | 637 |
| veredicto | verdict | 568 |
| control | check | 525 |
| paso | step | 514 |
| señal | signal | 513 |
| corrida | run | 447 |
| prosa | prose | 364 |
| salida | output | 338 |
| alcance | scope | 328 |
| marcador | marker | 322 |
| hallazgo | finding | 281 |
| despacho | dispatch | 265 |
| cierre | closure | 240 |
| entrada | input | 207 |
| intento | attempt | 199 |
| rúbrica | rubric | 180 |
| cosecha | harvest | 163 |
| fuente | source | 149 |
| arranque | start-up | 113 |

`estado` splits: **state** where it is the loop's own record (`.agent/STATE.md`),
**status** where it is the issue's rung on the ladder (`status:in-progress`),
which is already an external contract and does not move.

## The sequence

Each pull request is green on its own and rebuilds `plugin/dist/` in the same
change. Branched off `main`, never off `ci/cada-check-solo-si-tocan-lo-suyo`,
which carries the open pull request #155.

| # | Pull request | Touches | Risk |
|---|---|---|---|
| 1 | **The rule** | `AGENTS.md`, `CLAUDE.md`, `docs/glossary.md` | none |
| 2 | Agent-facing surface | `commands/`, `prompts/`, `templates/`, `skills/` (10), `hooks/` + `dist` | low |
| 3–11 | One per loop stage | init · groom · dispatch · step · judge-runner · reconcile · go/watch · harvest · status — **script and its tests together** | medium |
| 12 | Remainders | `backend` (4 src + 23 tests), `frontend` (tests and mothers, **not the UI**) | low |
| 13 | Living docs | `docs/loop/*` + regenerated HTML/PDF, `judge-bench.md`, `medicion-slices.md`, `README.md`, `Makefile` | low |
| 14 | **`ct-init` contract** | Block translated, version 23 → 24, new hash appended to the ledger, `CONTRATO-SLICES.md` → `SLICES-CONTRACT.md` with the old name still recognised | **outside this repo** |
| 15 | **The judge** | `ct-judge.md`, `ct-slice-judge.md` + an N=5 run published beside the baseline | **behavioural** |
| 16 | GitHub | The 17 open issues | none |

## How each change is verified

The safety net already exists and it is a good one.

- `make test-all` green. This is what proves a rename did not break an import.
- `npm run build --prefix plugin` and `dist/` committed in the **same** change;
  CI's `dist` job compares against a clean rebuild and fails on three distinct
  kinds of drift.
- A glossary grep over the diff: no Spanish term from the glossary survives
  inside the area that pull request declares migrated.

What the tests cannot catch, and why two pieces are separated:

- The **contract block** is compared against itself. Its guard is the hash ledger
  in `ct-init.sh`, which is why the version must be bumped rather than the hash
  replaced.
- The **judge's fixtures** are prose the model reads. Their guard is the bench,
  which is why translating `ct-judge.md` ends in a measured run, not in a green
  suite.

## What this explicitly does not do

- **No git history rewrite.** Past commit messages stay as written; the rule
  binds from here forward.
- **No translation of the dated record**: 16 plans, 23 specs and 9 session
  prompts under `docs/`. They are the minutes of decisions already taken.
  Translating them would rewrite what happened. They keep a note saying so.
- **No closed issues, no merged pull requests, and nothing in the
  `josemerca/control-tower-plugin` fork** (16 issues, 120 pull requests).
- **No frontend product copy.**

## Honest cost

Around 90K LOC of Spanish in `plugin/` alone. Pull requests 3 to 11 are careful
translation, not a `sed` run: the tests are the net for identifiers, but prose
carries the reasoning this repository writes its arguments in, and a mechanical
sweep would flatten it. This is not one session's work.
