---
name: writing-plans-prescriptive
description: Use when dispatched for a Control Tower slice, before touching production code — turns the issue into a prescriptive plan that closes every decision, leaves the bodies to TDD, and passes plan-contract validation
---

# Writing Plans (Prescriptive)

## Overview

The implementer is a task-scoped subagent: it arrives with zero context, it decides nothing,
and it writes code test-first. Your job is **smart plan, cheap execution** — close every
**decision** (names, signatures, typed errors, non-derivable constants, test names, exact
commands) and hand every **body** to TDD.

That split makes the plan a **knowledge checkpoint**: cheap to read, cheap to redo from scratch
if the first attempt fails. A plan carrying a module's final content is code, not a checkpoint,
and costs twice. One real slice plan reached 73.868 characters, 65% of its lines inside code
blocks, too big for one issue comment; five of its commits fixed defects that had travelled
inside it: a leaked temp directory, a bare `catch` that swallowed git failures, a type export
leaking author emails, a doc line asserting something false, and four test vectors that missed
the threshold they pinned. Code written blind, with no compiler and nothing executed, arrives
with unseen defects: the human `plan` gate had 74k characters to read, and at that size an OK
is an act of faith.

**Announce at start:** "I'm using the writing-plans-prescriptive skill to write the slice plan."

This skill is the Control Tower port of crear-plan-detallado. Four things
are non-negotiable and machine-checked by `plan-contract.js`: the fixed structure, the
**literality rule** (every quoted current state exists verbatim in the repo), the
**block taxonomy** below, and the **language** of the prose.

## Input: the issue is the frozen spec

You were dispatched for exactly one issue: its body carries everything you may plan from — the
acceptance criteria (EARS), "Out of scope / Protected", "Contexto del epic" (or "del milestone") and
"Contexto heredado", "Dependencias" naming the interface this slice consumes, and "Decisiones
congeladas" — decisions you **must respect**, copied to `## 2. Closed decisions`. The execution
spec stays out of reach on purpose: the issue is the whole input.

**Zero questions.** No human sits in this session. Every ambiguity goes to `## 9. Assumptions`
with its provenance (issue / milestone context / repo convention / your call). If something blocks
planning, set the `blocked` field in `.agent/SLICE.md` and stop: a blocker travels as that
field, the one thing a guess cannot do.

## What a code block carries

`## 3. Reference patterns` carries this repo's yardstick in two lists — an analogous file shows
the shape, a convention document states the rule, and the rule holds alone too. Start from
`.agent/conventions.md` when declared — it keeps slice 14 and slice 3 citing the same yardstick
— then check `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING`, `docs/conventions/` and the project
skills. List, **by path**, only entries bearing on this slice under `Rules to obey:`: the
program pastes the whole file into every task brief, so an omitted entry still reaches the
judge. If the repo declares none, say `N/A — <reason>`: a path outside the repo fails the plan.

**A second yardstick sits outside this section: ct's own.** The plugin's `conventions/` files,
at the absolute path the kickoff gives, **take precedence over this repo's, rule by rule, not
by topic**: where the two conflict, ct's wins; where this repo speaks and ct's is silent, this
repo's rule binds in full. Read them before writing the plan, since the program pastes them
into every task brief, so a plan that contradicts them produces tasks the judge blocks. Your
kickoff explains splitting `**Files:**` between `(create)` and `(modify)`.

Every code block declares its **role** on the line above it; the validator enforces labels and
budgets:

| Label above the block | What goes inside | Budget |
|---|---|---|
| `Current state (path[, lines A-B]):` | the span that changes, copied **verbatim** from the file | 12 lines |
| `Contract (path):` | types, interfaces, exact signatures, typed errors, and constants the implementer cannot derive (a format string, a set of flags, a magic value) — **declarations only** | 25 lines |
| `Call site (path):` | how the call reads in the consumer once this task is done: route, handler, component usage, before → after | 10 lines |
| `Final text (path.md):` | the exact replacement wording, only where the literal text IS the deliverable — `.md`, `.txt`, `.rst`, `.adoc` | 12 lines |

A task adds up to **30** lines across its blocks; command blocks (```bash, or any right after
`**Verification:**`) are exempt — they carry commands, and content that matters travels as
`Contract (path):`, which is why the validator reads a heredoc as a file sneaking in.

**Each task fits on one A4 page: 3500 characters, about 50 lines.** The task is the unit: a
human reads it in one sitting at the gate, and the implementer gets it as the task brief. The
plan has no ceiling — a plan with twelve tasks is a badly cut slice, fixed where a human sits,
when the spec is frozen.

If a task does not fit, keep the decision prose and cut the blocks to just the decisions. If it
still does not fit, **the task is two**: one task is one commit, and splitting a commit is
yours to do. Splitting the slice is not — a human cut it, so two commits' worth stays two
tasks.

Three things travel without a block:

- **A function body** travels as its signature plus the failing test: the implementer writes it
  with the compiler and real API in front, catching a leaked temp directory or bare `catch`
  before it ships.
- **A test file** travels as a name and an assertion — see below.
- **Configuration** travels as prose with the value inline — see below.

Blocks live **inside a `### Task N` section** — the task is what travels. `ct-step` hands each
implementer its **task brief** (`scripts/task-brief --with-plan-context PLAN_FILE N`): the task
plus `### Desired end state`, `### Out of scope`, `## 2. Closed decisions` and `## 3. Reference
patterns`, its **yardstick** — where they contradict the task, they win, so §2's decisions and
§3's rules both reach the implementer. `## 5. Interfaces` stays behind too: name signatures
there in prose, and put the block in the task that creates the file.

Every citation comes from the file in front of you — the validator greps the repo and accepts
matches. A `Current state` citation is one **contiguous** span, copied byte for byte. If it
contains code fences, quote around them as several smaller citations: a nested fence
desynchronises the parser.

## Configuration travels as prose

`tsconfig`, `package.json`, CI workflows, lockfiles, `.gitignore`, `Dockerfile`: state the
change in prose, value inline. For example — *`server/package.json`: the `build` script becomes
`tsc --noEmit -p tsconfig.json && tsc -p tsconfig.build.json`; `server/tsconfig.json` adds
`"noEmit": true` and moves `rootDir`/`outDir` to a new `tsconfig.build.json` that excludes
`src/**/*.test.ts`.* Three lines of prose replaced 75 lines of JSON in a real plan, same
information. That task's `**Verification:**` (run the build, expect exit 0) proves more than
pasted config.

## Tests: the name and the assertion

A test travels as two things, inline: `**TDD:**` carries its literal name and the assertion
pinning the behaviour; `**Tests:**` lists every test added or deliberately removed, by name.
The body — arrange, fixtures, helpers — is the implementer's, written red first.

Pin the **boundary**: one case at the limit, one just past it. A real plan wrote four cases for
an "80% of authors" threshold and none pinned it, so mutating 80 to 70 left the whole suite
green. Say what must stay unbreakable:
*`it('concentration is the smallest number of authors that adds up to 80%')` — a case exactly at
80 and one just below.*

Citing an existing assertion to change it is a `Current state` citation over the test file —
allowed, through the literality check.

## Text you dictate must be true

Verify each claim in a `Final text` block against the repo first: a real plan dictated "the
analysis is the ONLY code that runs git" while its own fixture helper also ran git, and the
false line shipped. The same rule covers `**Verification:**`: run the command first, record
what you saw, and write the claim as a **predicate** — the program scores only the exit code. A
real plan shipped `git diff HEAD -- AGENTS.md | grep -c 'marker'   # expected: 0` past this gate
and a human one: `grep -c` exits 0 on any match, so that control went green in the exact case
it existed to forbid. The predicate form is `test "$(… | grep -c 'marker')" -eq 0`, with **one
file per `grep -c`**: two files print `file:count` per line, so `test` exits 2 on a
non-integer, red forever regardless of the code. For "nothing is left in these files" use
`test -z "$(grep -l 'm' a.ts b.ts)"`, where the empty list *is* the claim. `--check-plan`
rejects both, and any other command it can prove cannot measure its own claim.

**Cite the files your slice rewrites, normally.** `--check-plan` reads the working tree (nothing
implemented yet); `--release` reads the **base of the branch** — the state the plan was written
against. A citation of a file your tasks later rewrite keeps validating after the work lands.
Never relabel a `Current state (path):` block as prose to dodge the gate: that removes it from
the one check proving the plan describes the real repo.

## The plan uses Simplified Technical English

The plan is the whole brief of a subagent with no context. A long passive sentence hides who
does what — the one thing this reader needs. So the plan's prose follows ASD-STE100, measured
by `--check-plan`. Six sub-rules fire, under the rule name `ste`:

| Sub-rule | What fails |
|---|---|
| `length` | A sentence carries more words than its limit |
| `paragraph` | A paragraph carries more than 6 sentences |
| `passive` | A form of `be` stands before a past participle |
| `gerund` | An `-ing` word opens a sentence, or follows a preposition |
| `word` | A word of the non-approved list appears. The message names the replacement |
| `one-sentence` | `**Objective:**` carries more than one sentence |

**Two limits, by position.** A task-marker paragraph, and every paragraph of `## 8. Global
verification`, gets 20 words per sentence; everywhere else, 25. The gate removes the marker
before it counts.

**What the gate never measures.** A whole code block — citations, contracts, commands. A
backticked span, a path or a URL counts as one word.

**A test name goes inside backticks.** `**TDD:**` carries a literal name such as
`it('the header is read before the body')`. That name belongs to the test, and inside backticks
the gate leaves it alone. Outside them it fires `passive` for a name you cannot reword.

The four lists live in `scripts/plan-language.js`: the 48 non-approved words with their
replacement, the irregular participles, the words that end in `-ed` and are not participles, and
the words that end in `-ing` and are not verb forms. If the gate refuses a word this repository
needs, add it to the exception, and say so in `## 9. Assumptions`.

## Structure

The 9 sections are fixed, in order, with those names; one that does not apply keeps its
heading, with `N/A — <reason>`.

Tasks live under `## 7. Tasks` as `### Task N — <name>`, numbered from 1, consecutively.
**One task = one commit.** Each task carries: `**Objective:**` (one sentence), `**Files:**`
(exact paths, with create/modify), its labelled blocks (at least one, or the exact line
`No code — <reason>` for prose-config or documentation tasks), `**TDD:**` (the failing test
first, with its literal name and assertion, or `No TDD — <reason>`), `**Tests:**` (added /
deliberately removed, named one by one), and `**Verification:**` (exact commands, already run,
and their output) — **the commands go in a fenced block right after the marker, one per line,
each one a predicate**, for the reason above.

**No control may pin the number of tests in the whole suite.** A `grep -c '52 passed'` is a
proxy, and it breaks the moment the judge demands one more assertion: the stale number then
needs fixing in every later task that repeated it. Worse, it blocks what
`conventions/testing.md` requires: with the total nailed shut, there is no room for the
assertion that document demands, so a branch ships untested to keep a control green. Count the
task's own tests instead, by module name; `--check-plan` rejects the suite total.

Every name in the plan resolves: a value where a `TBD` would go, the concrete handling instead
of "add error handling", the decision spelled out instead of "similar to Task 3", and a task
that defines each symbol the plan mentions. **Decisions are closed here; bodies are written
there.**

`## 5. Interfaces` is prose: `Consumes` names the interface the issue's "Dependencias" section
declares — or, failing that, its description — and `Produces` names what later slices rely on,
one exported name and signature per line. The block that creates the file lives in its task,
since that is what the task brief carries.

## Examples

All four come from one real slice: a git-history analysis module in a Node/TypeScript
monorepo, 1.271 lines across 22 A4 pages, with five commits fixing defects that had travelled
inside it.

**1. A new module with logic — `server/src/analysis/git.ts`.** `Contract
(server/src/analysis/git.ts):`, about ten lines, nobody can derive or invent; it survived byte
for byte:

- the format string `'%x00%H%x1f%aI%x1f%aE'` — `%aE` applies `.mailmap`, `%ae` does not;
- the flag list `--no-merges --no-renames --root --name-only`;
- `type CodigoErrorAnalisis = 'no-es-repo-git' | 'git-ha-fallado'` and its error class's shape;
- `interface Historial { headSha: string | null; commits: Commit[] }`;
- three signatures: `leerHistorial(repo): Promise<Historial>`,
  `leerHeadSha(repo): Promise<string | null>` (null when there is no HEAD),
  `parsearHistorial(salida: string): Commit[]`.

`parsearHistorial`'s body stays with the implementer: the format above, plus the test
`it('reads the git log format with NUL and US separators')`, determines it. Keep the diagnostic
line too — *a `.mailmap` test returning the raw email means the format used `%ae`, not `%aE`*
(contract, not body). Replaced 113 lines: 84% rewritten, two defects survived in the pasted
part.

**2. A test helper — `server/src/testing/repo-fixture.ts`.** Four signatures (`CommitFixture`,
`RepoFixture`, `crearRepoFixture(opciones?)`, `commitsSinMerges(ruta)`), plus one line of
closed decisions: *dates pinned with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, repo created under
`mkdtempSync(tmpdir())`, `limpiar()` removes it, fixtures only.* Replaced 106 lines of helper
plus 43 of its test — 84% and 77% rewritten — and leaked a temp directory on failure when
pasted.

**3. Configuration — `server/tsconfig.json` and `server/package.json`.** The prose above
replaced 75 lines of JSON across two blocks.

**4. `## 5. Interfaces` and its task — `index.ts`.** §5 names the surface in prose
(`walkHistory(repo, ventana, opciones?) => Promise<Analisis>`, `leerHeadSha`, `ErrorAnalisis`,
`VENTANAS`, and the exported types); the `Contract (server/src/analysis/index.ts):` block lives
in the task that creates the file — the only text the implementer reads. Replaced 34 lines in
§5, 40 in the task: a 42-line file.

## The steps, in order

**Create one todo per step and check them off as you go.** The labels and the budgets are easy
to hold for Task 1 and easy to lose by Task 6; step 5 is what keeps them in view.

1. Read `.agent/SLICE.md` and the issue: acceptance criteria, "Out of scope / Protected",
   "Contexto del epic", "Contexto heredado", "Dependencias".
2. Read the files this slice touches, one analogous file, this repo's convention documents, and
   the documents of `conventions/`. `--check-plan` reads §3's paths, not §4's — `(create)` rows
   can be unwritten. §4 names the files touched; the last is ct's yardstick, at kickoff's path.
3. Copy `plan-template.md`, next to this skill, and save it straight away as
   `docs/superpowers/plans/YYYY-MM-DD-issue-<n>-<slug>.md`, where `<n>` is `github_issue` in
   `.agent/SLICE.md`. The `issue-<n>-` segment is how the release gate finds the plan — keep it.
4. Fill §1 to §6.
5. **One task at a time: write it, then run `--check-plan` before starting the next.** A
   violation caught now costs one task to fix; at the end it costs the whole plan.
6. Fill §8 and §9.
7. Run `dispatch-check <n> --repo <o/r> --check-plan` until exit 0. `--release` runs the same
   check later and refuses without a valid committed plan.
8. Commit the plan as the branch's first commit: it travels in the PR and gets reviewed with
   the code.
9. Post the plan as an issue comment and STOP until a human replies OK — the `plan` gate, in the
   `gates` field of `.agent/SLICE.md` unless the spec waived it for this row with `!plan`. A
   human closes it.

## Execution handoff

With the plan committed and the `plan` gate closed, continue with
control-tower-loop:subagent-driven-development: its "Have implementation plan?" diamond finds
the plan and dispatches a fresh subagent per task, starting with none of your context.
