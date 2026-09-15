# #348 — A milestone has a home repository and N target repositories

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

Today an epic governs one repository, and every piece of the loop assumes it. `/ct-groom` takes
one `--repo`, creates one milestone, one set of labels and every issue there
(`plugin/scripts/ct-groom.mjs`). The slices table of a spec has no column that could say
otherwise (`plugin/scripts/slices.js#analyzeSlicesTable` reads `#`, `Slice`, `Tipo`, `Entrega`,
`Dep`, `Acepta`, `Protegido`, `Área`, `Toca`, `Gate`, `Señal`, `E2E`). `/ct-next`, `/ct-status`
and `/ct-harvest` each take one `--repo` too, and the registry of checkouts
(`backend/src/infrastructure/disk-checkout-registry.ts`) stores bare paths with no record of
which repository each one holds — the `{repo, path}` pair exists only as a request field of
`/start-plan` (`PlanTarget`), spent and forgotten.

Issue #348 replaces the one-repository rule rather than relaxing it: a milestone has **one home
repository**, where its conversation lives and its spec is committed, and **N target
repositories**, where its slices land. One row, one repository: a slice never spans two. What
the plugin has to grow is the `Repo` column, a groom that creates the milestone, the labels and
the issues in each target repository, a dispatcher that refuses what it cannot reach, and a
harvest and a status report that say which repository each slice landed in.

### Desired end state

- A slices table row with no `Repo` cell (or with a "no value" marker) belongs to the
  milestone's home repository, which is `--repo`.
- A row that names one repository gets its issue there, with that repository's own milestone
  and labels; a row that names two aborts with exit 2 naming the row.
- A dependency names a slice of the same milestone **in the same repository**. Both ways of
  crossing — the `owner/repo#N` spelling, and a bare `#N` pointing at a row that lands in
  another repository — abort with exit 2 naming the row, the repositories and why.
- Each target repository's milestone carries the reach in its description
  (an html comment marker, `ct-repos:` with the repositories behind it), which is how
  `/ct-next`, `/ct-status` and
  `/ct-harvest` learn a milestone reaches further than the repository they were asked about.
- The registry of checkouts answers "where is `owner/repo` checked out on this machine": it
  stores the `{repo, path}` pair, and paths registered before it did keep serving the in-flight
  sweep without answering that question.
- `/ct-next` resolves every target repository of the reach against that registry before
  dispatching: a repository with no registered checkout, or with a stale one, has its slices
  refused by name, with what is missing, and the run exits 1.
- `/ct-harvest` harvests every repository of the reach into one ledger with the repository as a
  column, one row per slice, and BigQuery's `repo` column names the repository the slice landed
  in.
- `/ct-status` declares its scope in its header: the repository it covers, the repositories of
  the milestone it does not, and whether each of those has a registered checkout.
- The slices contract seeded by `/ct-init` is v25 and documents the `Repo` column and the
  same-repository dependency rule; `docs/loop/ct-groom.md` says the same.

### Out of scope

- 🚫 Waiting on a merge in another repository. Nothing anywhere builds it: crossing
  repositories is refused at the groom, where a human can still fix the spec, and no code
  waits, polls or asks about a merge it cannot see from the home checkout.
- 🚫 Dispatching into another repository's checkout from one `/ct-next` run. The reach is read
  and reported per repository; the dispatch of a repository's slices stays a run standing in
  that repository's checkout.
- 🚫 Crossing one repository's issues with another repository's worktrees inside `/ct-status`.
- 🚫 The coordinating session: one milestone still has one conversation and it lives in the
  home repository.
- 🚫 The freeze, its yardstick and the gates; the `ct-order` marker, the `status:`
  ladder and the `gate:` labels; the name of the milestone `start-in-correct-loop`.
- 🚫 Renaming «epic» to «milestone» (issue #346, still open): nothing here renames anything.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Where a row's repository comes from | the `Repo` column of the slices table; empty or a "no value" marker means the home repository, which is `--repo` |
| A dependency that crosses repositories | refused at the groom, exit 2, naming the row, both repositories and why. Both spellings: `owner/repo#N`, and a bare `#N` whose row lands elsewhere |
| A row naming two repositories | refused at the groom, exit 2, naming the row |
| Nothing waits across repositories | no mechanism is built to wait on, poll or ask about a merge in another repository |
| How the reach survives the groom | an html comment marker, `ct-repos:` followed by the repositories, inside each target repository's milestone description, home first, targets in the table's first-appearance order |
| How a checkout is registered | the registry stores the `{repo, path}` pair, written only for a path already confirmed to hold that repository; legacy bare paths stay under `roots` and answer "not registered" |
| How a checkout is trusted at read time | re-confirmed against the disk on every read, with three answers and never a crash: `confirmed`, `not-registered`, `stale` (with what was found instead) |
| What the harvest reports | ONE ledger with the repository as a column — the column already exists in the BigQuery schema; what changes is that it names the repository the slice landed in instead of the one the harvest was asked about |
| What `/ct-status` shows | the repository it was asked about, whole and as today, plus a scope header naming the milestone's other target repositories and each one's checkout state |
| The exit code of a refused target repository in `/ct-next` | 1, the code that already means "a human has to look at this; retrying blindly does not help" |
| The language of the new column | `Repo`, one word, the same in both languages, next to `Dep` in the table's header |
| Slices contract version | 25 |

## 3. Reference patterns

Files to imitate: `plugin/scripts/harvest-ledger.js` and `plugin/scripts/slice-harvest.js` (a
new plugin module: classes with static methods, zero prose, zero loose functions),
`plugin/__tests__/harvest-table.test.js` (its test file, same rules),
`plugin/scripts/go-registry.js` (a registry file read with three answers: value, missing,
unreadable), `plugin/scripts/gates.js` (a raw cell resolved by a pure module, never by the
parser), `backend/src/domain/value-objects/plan-target.ts` (a two-field immutable value
object), `backend/src/infrastructure/disk-checkout-registry.ts` (the registry adapter),
`plugin/__tests__/ct-groom-dryrun.test.js` (the groom exercised end to end against the fake
`gh`).

Rules to obey: `CLAUDE.md` (English everywhere written into the repo; the parsed Spanish
headings and the contract values that do not move), `plugin/conventions/style.md` (a new module
is born conforming: no prose, no loose function), `plugin/conventions/architecture.md` (one
concept per module; a new type carries the burden of proof),
`plugin/conventions/decisions.md` (a rule lives in one place; the two halves of a contract that
crosses a process boundary are measured by a test that compares them),
`plugin/conventions/simplicity.md` (a field answers to a caller that exists),
`plugin/conventions/boundaries.md`, `plugin/conventions/testing.md`,
`backend/conventions/this-repository.md` (the backend is TypeScript and `.ts`),
`plugin/__tests__/conforming-modules.test.js` (the list every new module joins).

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/slices.js` | modify | ct-groom.mjs | Current state |
| `plugin/scripts/milestone-repos.js` | create | ct-groom.mjs, ct-next.mjs, ct-status.mjs, ct-harvest.mjs | Contract |
| `plugin/scripts/checkout-registry.js` | create | ct-next.mjs, ct-status.mjs | Contract |
| `plugin/scripts/dispatch.js` | modify | ct-next.mjs, ct-status.mjs, checkout-registry.js | Contract |
| `plugin/scripts/ct-groom.mjs` | modify | /ct-groom, the backend's groom | Current state |
| `plugin/scripts/groom.js` | modify | ct-groom.mjs | Current state |
| `plugin/scripts/ct-next.mjs` | modify | /ct-next | Current state |
| `plugin/scripts/ct-harvest.mjs` | modify | /ct-harvest | Current state |
| `plugin/scripts/ct-status.mjs` | modify | /ct-status | Current state |
| `plugin/scripts/ct-init.sh` | modify | every governed repository | prose (the block) |
| `plugin/templates/_TEMPLATE-execution-spec.md` | modify | whoever writes a spec | Final text |
| `docs/loop/ct-groom.md` | modify | whoever writes a spec | Final text |
| `plugin/commands/ct-groom.md` | modify | the slash command | Final text |
| `backend/src/domain/value-objects/registered-checkout.ts` | create | the registry, worktree-plans | Contract |
| `backend/src/domain/ports/checkout-registry.ts` | modify | start-plan, worktree-plans | Contract |
| `backend/src/infrastructure/disk-checkout-registry.ts` | modify | ct-api | Current state |
| `backend/src/application/actions/start-plan.ts` | modify | the start-plan route | Current state |
| `backend/src/infrastructure/active-plan-recovery.ts` | modify | ct-api | Current state |
| `backend/src/infrastructure/worktree-plans.ts` | modify | the active-plans route | Current state |
| `backend/src/domain/value-objects/groom-plan.ts` | modify | the epic-groom route | Current state |
| `backend/src/infrastructure/ct-groom-epic.ts` | modify | the groom action | Current state |
| `frontend/src/app/epic-groom/EpicGroom.types.ts` | modify | the groom panel | Contract |
| `frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx` | modify | gate 2 | Call site |

## 5. Interfaces

Consumes: nothing from another slice. The issue declares no `## Dependencias` section.

Produces, for #331 (the headless dispatcher) and #333 (the chain that does not stop):
`MilestoneRepos.of({ slices, homeRepo })` → `{ assignments, targets, refusals }`;
`MilestoneRepos.reachMarkerFor({ home, targets })` and `MilestoneRepos.reachIn(description)`;
`MilestoneRepos.crossRepoDeps({ slices, assignments })`;
`CheckoutRegistry.read({ configDir, home })` → `{ entries }` | `{ missing }` | `{ error }`;
`CheckoutRegistry.resolve({ repo, entries, remoteOf })` → `{ state, path, found }` with
`state` one of `confirmed` / `not-registered` / `stale`;
`repoOfRemoteUrl(url)` in `plugin/scripts/dispatch.js`;
`RegisteredCheckout { repository: RepositoryName | null, root: CheckoutRoot }` in the backend.

## 6. Test strategy

The plugin's pure modules are tested without a network or a disk, as `slices.js`/`gates.js`
already are: `npm --prefix plugin test -- __tests__/<file>`. The three commands are exercised
end to end against the fake `gh` of `plugin/__tests__/fixtures/fake-gh-bin` and the fake `git`
of `fake-git-bin`, in the test files that already drive each of them
(`ct-groom-dryrun.test.js`, `ct-next-preconditions.test.js`, `ct-harvest-real-process.test.js`,
`ct-status.test.js`) — new behaviour of an existing command goes to that command's existing
file, which is not bound by the born-conforming list; new modules get a conforming file of
their own and join `BornConforming.PATHS`.

The registry file is a contract between the backend (which writes it) and the plugin (which
reads it), so `plugin/conventions/decisions.md` demands a test that compares the two halves:
`backend/__tests__/infrastructure/disk-checkout-registry.test.ts` writes with the adapter and
reads back with `plugin/scripts/checkout-registry.js` — the same cross-package import
`backend/src/infrastructure/worktree-plans.ts` already makes of `plugin/scripts/cmux.js`.

The backend is verified with `npm --prefix backend run typecheck` and `npm --prefix backend
test`, the frontend with `npm --prefix frontend test`, and the whole plugin suite with
`npm --prefix plugin test` (about ten minutes; `npm --prefix plugin run test:fast` while
iterating).

## 7. Tasks

### Task 1 — The `Repo` column and the raw `Dep` cell reach the report

**Objective:** `analyzeSlicesTable` delivers the `Repo` cell and the raw `Dep` cell of every
row, and says whether the table carries the column, deciding nothing about either.

**Files:** `plugin/scripts/slices.js` (modify), `plugin/__tests__/slices.test.js` (modify)

This parser knows nothing about repositories, exactly as it knows nothing about gates or
signals: it delivers reliable cells and `plugin/scripts/milestone-repos.js` (Task 2) decides.
`iRepo = col('repo')` collides with no existing heading — "repo" is not a substring of
`#`/`slice`/`tipo`/`entrega`/`dep`/`acepta`/`protegido`/`área`/`toca`/`gate`/`señal`/`e2e`, nor
is any of those a substring of "repo" — and it stays OUT of `missingOptionalColumns`, for the
same reason as `Gate` and `E2E`: the consequence of its absence is that every row lands in the
home repository, which is exactly today's behaviour, and a warning that fires on every spec
that does not use the feature is the noise that trains people to ignore the others.
`repoColumnPresent` is exposed instead, like `gateColumnPresent`. `depCell` travels raw
because the crossing spelling (`owner/repo#5`) is invisible in `deps`: `DEP_RE` extracts `5`
from it and the row would pass for a same-repository dependency on slice 5.

Current state (plugin/scripts/slices.js, lines 453-457):

```js
    const depCell = (cells[iDep] || '').trim()
    const deps = []
    let m
    DEP_RE.lastIndex = 0
    while ((m = DEP_RE.exec(depCell)) !== null) deps.push(parseInt(m[1], 10))
```

Contract (plugin/scripts/slices.js):

```js
// every slice of the report gains two fields, raw and untouched:
//   repo: (cells[iRepo] || '').trim()
//   depCell
// and the report gains, beside gateColumnPresent/e2eColumnPresent:
//   repoColumnPresent: iRepo !== -1
// present in BOTH returns, the early "no table" one included.
```

**TDD:** red first with
`it('the Repo cell travels raw and the column is reported present even with every cell empty')`
— a table with `| Repo |` in its header and `–` in every row parses with
`repoColumnPresent === true` and `slices[0].repo === '–'`; its boundary pair is
`it('a table with no Repo column reports it absent and never as a missing optional column')` —
`repoColumnPresent === false` and `missingOptionalColumns` does not contain `Repo`.

**Tests:** added to `__tests__/slices.test.js`: the two above,
`the Dep cell travels raw beside the numbers it yielded`,
`a Repo cell naming a repository travels verbatim, case included`.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/slices.test.js   # expected: exit 0
test "$(grep -c "missingOptionalColumns.push('Repo')" plugin/scripts/slices.js)" -eq 0   # expected: exit 0 — never a missing optional column
```

### Task 2 — `MilestoneRepos`: which repository a row lands in, and what a dependency may name

**Objective:** one pure module answers which repository every row of a slices table lands in,
which repositories a milestone reaches, and every dependency that crosses one.

**Files:** `plugin/scripts/milestone-repos.js` (create),
`plugin/__tests__/milestone-repos.test.js` (create),
`plugin/__tests__/conforming-modules.test.js` (modify)

A new module, born conforming (`plugin/conventions/style.md`): no prose, no loose function, and
both paths join `BornConforming.PATHS`. It carries one concept — a milestone's repositories —
and its four consumers are the four commands. The reach marker's render and parse live together
here, because they are the two halves of one contract and split across two files they drift
(`plugin/conventions/decisions.md`). `targets` is home-first and then first-appearance order, so
the marker is deterministic and a re-groom rewrites nothing. The repository slug is validated
with `parseRepoSlug` (`plugin/scripts/dispatch.js`), the same shape check `--repo` already gets.

Contract (plugin/scripts/milestone-repos.js):

```js
export class MilestoneRepos {
  static REFUSALS = { SEVERAL: 'several', MALFORMED: 'malformed' }
  static MARKER = /<!-- ct-repos:([^>]*) -->/
  static SEPARATOR = ','
  static of({ slices, homeRepo })
  static crossRepoDeps({ slices, assignments })
  static namedRepoDeps(slices)
  static reachMarkerFor({ home, targets })
  static reachIn(description)
}
```

`of` answers `{ assignments: Map(n -> repo), targets: string[], refusals: [{ n, kind, raw }] }`;
a row whose cell is empty or a "no value" marker is assigned `homeRepo`. `crossRepoDeps`
answers `[{ n, repo, dep, depRepo }]` for every `#N` whose row lands in another repository.
`namedRepoDeps` answers `[{ n, raw, repo }]` for every `owner/repo#N` written in a `Dep` cell.
`reachMarkerFor` answers the marker line; `reachIn` answers `{ home, targets }` or `null`.

**TDD:** red first with
`it('a row with no repository lands in the home repository and adds no target')` — one row with
`–`, `homeRepo` `o/home`, `assignments.get(1) === 'o/home'` and `targets` exactly `['o/home']`;
its boundary pair is `it('two repositories in one cell is refused and one is not')` — a cell
`o/a, o/b` yields one refusal of kind `several` for that row, and `o/a` yields none.

**Tests:** in `__tests__/milestone-repos.test.js`: the two above, plus
`a cell that is not owner/repo is refused as malformed naming the row`,
`targets are home first and then the order the table names them`,
`a dependency on a row of another repository is answered with both repositories`,
`a dependency inside the same repository is not answered`,
`the owner/repo#N spelling is answered even though DEP_RE already took its number`,
`the reach marker renders home first and parses back to the same value`,
`a description with no marker reads as no reach`. In `conforming-modules.test.js`: the two new
paths are named by the list.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/milestone-repos.test.js __tests__/conforming-modules.test.js   # expected: exit 0
test -z "$(grep -n '^\s*//' plugin/scripts/milestone-repos.js)"   # expected: exit 0 — born conforming, no prose
```

### Task 3 — The groom refuses what a human can still fix in the spec

**Objective:** `/ct-groom` aborts with exit 2, before touching GitHub and also under
`--dry-run`, on a row naming two repositories, a malformed repository, and any dependency that
crosses repositories.

**Files:** `plugin/scripts/ct-groom.mjs` (modify),
`plugin/__tests__/ct-groom-dryrun.test.js` (modify)

The three join `hardErrors`, which already aggregates every class of breakage into one single
exit 2 so that whoever fixes the spec fixes it in one pass. They are computed from the report
and `MilestoneRepos`, before the plan is built, which is what makes the refusal land where a
human is still looking at the spec instead of at a dispatch. The dependency refusal names both
repositories and says what it costs: a slice in one repository cannot be ordered after a slice
in another.

Current state (plugin/scripts/ct-groom.mjs, lines 431-434):

```js
if (hardErrors.length) {
  for (const msg of hardErrors) console.error(msg)
  process.exit(2)
}
```

Contract (plugin/scripts/ct-groom.mjs):

```js
// homeRepo is `repo` (the --repo of this run). Under --dry-run with no --repo it is
// the literal '<owner/repo>' already used by blockerRepoRef, so the refusals read the
// same in a dry run that named no repository.
const { assignments, targets, refusals } = MilestoneRepos.of({ slices: report.slices, homeRepo })
```

**TDD:** red first with
`it('a row naming two repositories aborts with exit 2 naming the row')` — a spec whose row 2
carries `o/a, o/b` exits 2 and stderr names `#2` and both repositories; its boundary pair is
`it('a row naming one repository does not abort')` — the same spec with `o/a` alone exits 0.
Then `it('a dependency on a row of another repository aborts naming both repositories')` and
`it('the owner/repo#N spelling aborts even when its number exists in the table')`.

**Tests:** added to `__tests__/ct-groom-dryrun.test.js`: the four above, plus
`a malformed Repo cell aborts naming the row and the cell`, and
`the refusal says a slice cannot be ordered after a slice of another repository`.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/ct-groom-dryrun.test.js   # expected: exit 0
test "$(grep -c 'MilestoneRepos' plugin/scripts/ct-groom.mjs)" -ge 2   # expected: exit 0 — imported and used
```

### Task 4 — The groom reads GitHub once per target repository

**Objective:** the groom's reads — issues, labels and milestones — happen once per target
repository, and every issue of the plan says which repository it lands in.

**Files:** `plugin/scripts/ct-groom.mjs` (modify), `plugin/scripts/groom.js` (modify),
`plugin/__tests__/ct-groom-dryrun.test.js` (modify)

`existingIssues` and `existingLabelNames` become `Map(repo -> value)`, one entry per target
repository, filled by the same two calls the single-repository run makes today — so a milestone
that reaches one repository makes exactly the same calls, in the same order, as before. A read
that fails for one repository is reported naming that repository and aborts, the criterion the
surrounding code already applies: a listing treated as "this repository has no issues" would
duplicate every issue of it. `groomPlan` takes `repoOf` and each plan issue carries `repo`,
which is what the reconcile entries, the writes of Task 5 and the dry run's JSON read.

Current state (plugin/scripts/ct-groom.mjs, lines 935-936):

```js
let existingLabelNames = null
if (typeof repo === 'string') {
```

Contract (plugin/scripts/groom.js):

```js
export function groomPlan(slices, { milestone, specRef, epicContext, epicContextReason,
  frozenDecisions, frozenDecisionsReason, repoOf })
// each issue of plan.issues gains: repo: repoOf(s.n)
// repoOf is required: a plan with no repository per issue cannot be written anywhere.
```

Contract (plugin/scripts/ct-groom.mjs):

```js
// the dry run's stdout gains, beside repo (the home) and project:
//   targets: string[]         home first, then the order the table names them
//   issues[].repo            the repository that issue lands in
```

**TDD:** red first with
`it('the dry run says which repository each issue lands in')` — a spec whose row 2 carries
`o/other` prints `issues[1].repo === 'o/other'` and `issues[0].repo === 'o/home'`; its boundary
pair is `it('a spec with no Repo column prints every issue in the home repository')` — every
`issues[].repo` equals `--repo` and `targets` has exactly one entry.

**Tests:** added to `__tests__/ct-groom-dryrun.test.js`: the two above,
`the issues and the labels of every target repository are listed, each one named in the argv`,
`a listing that fails for the second repository aborts naming that repository`,
`targets is home first and then the table's order`. In `__tests__/ct-groom-reconcile.test.js`:
`an existing issue is matched inside its own repository, never across repositories`.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/ct-groom-dryrun.test.js __tests__/ct-groom-reconcile.test.js   # expected: exit 0
npm --prefix plugin test -- __tests__/f26-inherited-context.test.js __tests__/ct-groom-decisions.test.js   # expected: exit 0 — groomPlan's other callers
```

### Task 5 — The groom writes into each target repository

**Objective:** the milestone, the labels, the issues and the project items are created in the
repository each row names, and a single-repository milestone writes exactly what it wrote
before.

**Files:** `plugin/scripts/ct-groom.mjs` (modify),
`plugin/__tests__/ct-groom-dryrun.test.js` (modify)

Every write already names its repository through a flag (`--repo`) or a path
(`repos/<repo>/milestones`); what changes is which value goes in. The labels a repository needs
are the ones its own issues carry plus `LOOP_STATUS_LABELS`, so a repository that receives one
`type:ui` row does not get the labels of a row that landed elsewhere. The milestone is resolved
per repository and by title — the same title in every one of them, which is what lets
`/ct-harvest` and `/ct-next` find it — and the project item's URL is built from the issue's own
repository. The project's items are listed once, as today: they belong to the project, not to a
repository, and `hasProjectItem` already takes the repository as an argument.

Current state (plugin/scripts/ct-groom.mjs, lines 1521-1523):

```js
for (const l of newLabels) {
  gh(['label', 'create', l, '--repo', repo, '--force'])
}
```

Contract (plugin/scripts/ct-groom.mjs):

```js
// per target repository, in the order of `targets`:
//   gh api repos/<target>/milestones           (list, then create if absent)
//   gh label create <l> --repo <target> --force   only the ones that repository lacks
//   gh issue create --repo <target> --milestone <the same title>
//   gh issue edit <n> --repo <target>          --reconcile, inside its own repository
//   https://github.com/<target>/issues/<n>     the project item's URL
```

**TDD:** red first with
`it('an issue of a row naming another repository is created there, with that repository milestone')`
— the argv log carries `issue create --repo o/other` and a `repos/o/other/milestones` call; its
boundary pair is
`it('a milestone that reaches one repository makes the same calls it made before')` — the argv
log names `o/home` and no other repository.

**Tests:** added to `__tests__/ct-groom-dryrun.test.js`: the two above,
`the labels created in a repository are only the ones its own issues carry`,
`the project item is added with the url of the issue's own repository`.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/ct-groom-dryrun.test.js __tests__/ct-groom-labels-gate.test.js __tests__/ct-groom-status-vocabulary.test.js   # expected: exit 0
test -z "$(grep -n "'--repo', repo," plugin/scripts/ct-groom.mjs)"   # expected: exit 0 — no write left naming the home repository by default
```

### Task 6 — The reach travels in each milestone's description

**Objective:** the groom writes the milestone's home repository and its target repositories
into the description of every milestone it creates or finds, and touches nothing else in it.

**Files:** `plugin/scripts/ct-groom.mjs` (modify),
`plugin/__tests__/ct-groom-dryrun.test.js` (modify)

This is the channel through which the reach survives the groom: `/ct-next`, `/ct-status` and
`/ct-harvest` receive the milestone inside the issue payload they already read, so they learn
the reach without one extra call. The marker is rewritten in place and whatever a human wrote
around it is kept, the same treatment `ct-init` gives its seeded blocks. A milestone that
reaches only its home repository gets the marker too: silence would mean both "one repository"
and "groomed before this existed", and telling those apart is what lets the readers stay quiet
instead of guessing.

Current state (plugin/scripts/ct-groom.mjs, lines 1503-1508):

```js
let msNumber = allMilestones.find((m) => m.title === milestone)?.number
if (!msNumber) {
  const created = JSON.parse(gh(['api', `repos/${repo}/milestones`, '-f', `title=${milestone}`]))
  msNumber = created.number
  console.log(`milestone created: ${milestone} (#${msNumber})`)
} else console.log(`milestone already exists: ${milestone} (#${msNumber})`)
```

Contract (plugin/scripts/ct-groom.mjs):

```js
// the description is written with the marker MilestoneRepos.reachMarkerFor({ home, targets }):
//   gh api repos/<target>/milestones -f title=<t> -f description=<the marker>     (create)
//   gh api repos/<target>/milestones/<n> --method PATCH -f description=<merged>   (update)
// the update is skipped when the description already carries that exact marker, and its
// failure aborts with exit 1 before a single issue is created.
```

**TDD:** red first with
`it('the milestone is created with the reach in its description')` — the argv of the creation
carries `description=` with the home repository first and the other target behind it; its
boundary pair is
`it('an existing milestone whose description already carries the reach is not patched')` — no
`--method PATCH` call in the argv log.

**Tests:** added to `__tests__/ct-groom-dryrun.test.js`: the two above,
`an existing milestone with a human description keeps it and gains the marker`,
`a milestone that reaches only its home repository carries the marker all the same`,
`the dry run prints what it would write into the description and patches nothing`.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/ct-groom-dryrun.test.js   # expected: exit 0
test "$(grep -c 'reachMarkerFor' plugin/scripts/ct-groom.mjs)" -ge 1   # expected: exit 0
```

### Task 7 — `CheckoutRegistry`: where each repository is checked out, and whether it still is

**Objective:** one module reads the registry of checkouts and answers, for a repository, the
path that holds it — with three answers and never a crash.

**Files:** `plugin/scripts/checkout-registry.js` (create),
`plugin/__tests__/checkout-registry.test.js` (create), `plugin/scripts/dispatch.js` (modify),
`plugin/scripts/ct-next.mjs` (modify), `plugin/scripts/ct-status.mjs` (modify),
`plugin/__tests__/conforming-modules.test.js` (modify)

Born conforming, both paths in `BornConforming.PATHS`. The file lives under
`controlTowerDir` (`plugin/scripts/run-metrics.js`), the directory the backend's
`Invocation.stateRoot` also resolves to: that is what makes one registry serve both halves.
`read` gives the three answers `readGoCommitment` already established — an unreadable registry
is not an empty one. `resolve` re-confirms against the disk, because a registered path can be
moved or re-pointed after it was written, and `stale` names what it found instead:
`not-registered` and `stale` are fixed differently. `repoOfRemoteUrl` moves to `dispatch.js`,
beside `parseRepoSlug`, and its two copies (`ct-next.mjs#ensureRepoIdentity`,
`ct-status.mjs#identityReason`) call it.

Current state (plugin/scripts/ct-next.mjs, lines 1541-1541):

```js
  const m = originUrl.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/)
```

Contract (plugin/scripts/checkout-registry.js):

```js
export class CheckoutRegistry {
  static FILE = 'checkouts.json'
  static STATES = { CONFIRMED: 'confirmed', NOT_REGISTERED: 'not-registered', STALE: 'stale' }
  static path({ configDir, home })
  static read({ configDir, home })
  static entriesIn(parsed)
  static resolve({ repo, entries, remoteOf })
}
```

`read` answers `{ entries, path }`, `{ missing: true, path }` or `{ error, path }`;
`entriesIn` answers `[{ repo, path }]`, reading the `checkouts` list and the legacy `roots`
list, whose entries come back with `repo: null`. `resolve` answers
`{ state, path, found }`: `found` carries what the path holds when `state` is `stale`.
`remoteOf(path)` is injected and answers `{ url }` or `{ error }`.

Contract (plugin/scripts/dispatch.js):

```js
export function repoOfRemoteUrl(url)   // 'owner/name', or null if it is not a GitHub remote
```

**TDD:** red first with
`it('a repository with no entry answers not-registered and never a path')` — an empty registry
and `o/a` answers `state === 'not-registered'`; its boundary pair is
`it('an entry whose path holds another repository answers stale naming what it found')` —
`remoteOf` answering `o/b` for the path registered for `o/a` yields `state === 'stale'` and
`found === 'o/b'`.

**Tests:** in `__tests__/checkout-registry.test.js`: the two above,
`a confirmed entry answers its path`, `a legacy roots path answers not-registered`,
`an unreadable registry is not an empty one`, `a missing registry is an answer, not an error`,
`repoOfRemoteUrl reads ssh, https and a trailing .git`; in `conforming-modules.test.js`, the
two new paths.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/checkout-registry.test.js __tests__/conforming-modules.test.js   # expected: exit 0
test "$(grep -c 'repoOfRemoteUrl' plugin/scripts/ct-status.mjs)" -ge 1   # expected: exit 0 — it calls the shared one
```

### Task 8 — The registry remembers which repository each checkout holds

**Objective:** the backend registers the `{repo, path}` pair it has already confirmed, and the
paths registered before it did keep serving the in-flight sweep.

**Files:** `backend/src/domain/value-objects/registered-checkout.ts` (create),
`backend/src/domain/ports/checkout-registry.ts` (modify),
`backend/src/infrastructure/disk-checkout-registry.ts` (modify),
`backend/src/application/actions/start-plan.ts` (modify),
`backend/src/infrastructure/active-plan-recovery.ts` (modify),
`backend/src/infrastructure/worktree-plans.ts` (modify),
`backend/__tests__/infrastructure/disk-checkout-registry.test.ts` (modify),
`backend/__tests__/infrastructure/worktree-plans.test.ts` (modify)

The pair is written only where it has already been confirmed: `StartPlan` remembers after
`Workspace#confirm` has vouched for the path, and `ActivePlanRecovery` after recovering a watch
that carries both halves. So the registry never records a pair nobody checked, and the plugin's
re-confirmation (Task 7) is about time passing, not about trust in the writer. The legacy
`roots` list is read and written back untouched: without it, this machine's registry loses the
paths that feed `WorktreePlans#inFlight` and the Home view stops seeing plans that are really
in flight. A path that arrives with its repository leaves `roots` in the same write.

Current state (backend/src/infrastructure/disk-checkout-registry.ts, lines 39-41):

```ts
  static #contentFor(roots: CheckoutRoot[]): string {
    return `${JSON.stringify({ roots: roots.map((root) => root.text) }, null, 2)}\n`
  }
```

Contract (backend/src/domain/value-objects/registered-checkout.ts):

```ts
export class RegisteredCheckout {
  readonly repository: RepositoryName | null
  readonly root: CheckoutRoot
  constructor({ repository, root }: { repository: RepositoryName | null, root: CheckoutRoot })
  holds(repository: RepositoryName): boolean
}
```

Contract (backend/src/domain/ports/checkout-registry.ts):

```ts
export class CheckoutRegistry {
  remember(checkout: RegisteredCheckout): void
  known(): RegisteredCheckout[] | null
}
```

The file written carries `checkouts` (the pairs) and `roots` (the legacy paths, which is every
path with no repository).

**TDD:** red first with
`it('a remembered checkout is written with the repository that holds it')` — the file parses to
`checkouts` carrying `{ repo: 'o/a', path: '/p' }`; its boundary pair is
`it('a legacy roots path survives a write and comes back with no repository')` — a registry
file carrying only `roots` gains a `checkouts` entry and keeps its path under `roots`, and
`known()` answers both, the legacy one with `repository === null`.

**Tests:** in `disk-checkout-registry.test.ts`: the two above,
`the same repository registered twice is not duplicated`,
`a path registered without a repository is upgraded when it arrives with one`,
`what the plugin reads back is what this adapter wrote` (importing
`plugin/scripts/checkout-registry.js`, the measured copy of a contract that crosses the
process boundary). In `worktree-plans.test.ts`: `the sweep surveys a legacy path all the same`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test   # expected: exit 0
test "$(grep -c 'checkout-registry.js' backend/__tests__/infrastructure/disk-checkout-registry.test.ts)" -ge 1   # expected: exit 0 — the two halves are compared
```

### Task 9 — The dispatcher refuses the repository it cannot reach

**Objective:** `/ct-next` resolves every target repository of the milestone's reach against the
registry, refuses by name the slices of one with no checkout or a stale one, and exits 1.

**Files:** `plugin/scripts/ct-next.mjs` (modify),
`plugin/__tests__/ct-next-preconditions.test.js` (modify)

The reach comes from the milestone the issues already carry, so no new call is made. This run
dispatches the slices of the repository whose checkout it stands in — a dispatch is a
`git worktree add` and a cmux session in one checkout, and this run has exactly one. What it
gains is that it stops behaving as if that were the whole milestone: for every other target
repository it says whether its slices can be dispatched at all. `not-registered` and `stale`
are refusals and exit 1, the code that already means "a human has to look at this; retrying
blindly does not help" — registering a checkout does not resolve with time. `confirmed` is not
a refusal: it names the path and the command to run there. A milestone whose reach is one
repository prints nothing and its exit code does not move.

Current state (plugin/scripts/ct-next.mjs, lines 3790-3791):

```js
let finalExitCode = 0
// D5, finding H: under --dry-run the preconditions summary goes AT THE END,
```

Contract (plugin/scripts/ct-next.mjs):

```js
// one line per target repository other than --repo, on stderr, before the batch:
//   refused (not-registered): names the repository, that no checkout of it is registered,
//     and that its slices cannot be dispatched until one is
//   refused (stale): names the repository, the registered path and what it holds instead
//   handed over (confirmed): names the repository, its path and `/ct-next --repo <it>`
// finalExitCode = 1 if any refusal, on the real run and under --dry-run alike.
```

**TDD:** red first with
`it('a target repository with no registered checkout has its slices refused by name and exits 1')`
— the milestone description declares `o/other`, the registry has no entry for it, stderr names
`o/other` and what is missing, and the exit code is 1; its boundary pair is
`it('a target repository with a confirmed checkout is handed over, not refused, and the exit code does not move')`.

**Tests:** added to `__tests__/ct-next-preconditions.test.js`: the two above,
`a registered path that holds another repository is refused as stale naming what it holds`,
`a milestone whose reach is one repository prints nothing about the reach`,
`an unreadable registry refuses every target repository without claiming any is missing`.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/ct-next-preconditions.test.js __tests__/ct-next-dryrun.test.js __tests__/ct-next-exit-code-contract.test.js   # expected: exit 0
npm --prefix plugin test -- __tests__/ct-next-honest-messages.test.js   # expected: exit 0 — no message asserts what it did not look at
```

### Task 10 — The harvest is one ledger with the repository as a column

**Objective:** `/ct-harvest` harvests every repository of the milestone's reach and every row
names the repository the slice landed in, in the table and in BigQuery.

**Files:** `plugin/scripts/ct-harvest.mjs` (modify),
`plugin/scripts/slice-harvest.js` (modify), `plugin/scripts/harvest-table.js` (modify),
`plugin/__tests__/slice-harvest.test.js` (modify),
`plugin/__tests__/harvest-table.test.js` (modify),
`plugin/__tests__/ct-harvest-real-process.test.js` (modify)

One ledger, not one per repository: the harvest's unit is the milestone, and a milestone's cost
is one question. The `repo` column already exists in the schema
(`HarvestTable`, `REQUIRED`), so nothing migrates — what changes is that its value comes from
the row and falls back to the run's identity, which also makes the row's key honest, because an
issue number is unique per repository and not per milestone. The reach is read from the
milestone the issues already carry; every other repository of it is listed with the same
milestone title, and a listing that fails is a reason and exit 1, never a repository harvested
as empty. Rows sort by repository and then by issue.

Current state (plugin/scripts/ct-harvest.mjs, lines 229-232):

```js
  console.log(`# repo: ${repo} · slices: ${rows.length}`)
  console.log('')
  console.log('| Issue | Slice | Tipo | Gate | ready→claim | claim→release | release→merge | reopens | requeues | blocked | PR |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|')
```

Contract (plugin/scripts/harvest-table.js):

```js
// the repo column's valueOf reads the ROW first and the identity second:
//   new HarvestColumn({ name: 'repo', type: STRING, mode: REQUIRED, valueOf: <row.repo ?? identity.repo> })
```

Contract (plugin/scripts/ct-harvest.mjs):

```js
// every row carries `repo` (SliceHarvest#harvest already receives it), the header becomes
//   # home: <repo> · repos: <every repository harvested> · slices: <n>
// and the table gains a leading `Repo` column. --json keeps `filas`/`motivos`.
```

**TDD:** red first with `it('a row keeps the repository it was harvested from')` — `harvest`
called with `o/other` answers a row whose `repo` is `o/other`; its boundary pair is
`it('the repo column of the schema reads the row before the identity')` — a row with `o/other`
and an identity of `o/home` writes `o/other`.

**Tests:** in `slice-harvest.test.js` and `harvest-table.test.js`: the two above. In
`ct-harvest-real-process.test.js`: `the milestone of every repository of the reach is listed`,
`a repository whose listing fails is a reason and exit 1, never an empty harvest`,
`the table's rows are ordered by repository and then by issue`.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/slice-harvest.test.js __tests__/harvest-table.test.js __tests__/ct-harvest-real-process.test.js __tests__/ct-harvest-schema.test.js   # expected: exit 0
test "$(node plugin/scripts/ct-harvest.mjs --schema | grep -c '"name": "repo"')" -eq 1   # expected: exit 0 — one repo column, unchanged schema
```

### Task 11 — The status report declares its scope

**Objective:** `/ct-status` says which repository it covers, which repositories of the
milestone it does not, and whether each of those has a registered checkout.

**Files:** `plugin/scripts/ct-status.mjs` (modify),
`plugin/__tests__/ct-status.test.js` (modify)

This report crosses one repository's issues with one checkout's worktrees, branches and
processes, and its own header calls crossing the wrong pair the worst failure it can have. It
does not learn to cross another repository's issues with this checkout: what it learns is to
stop implying that the repository it was asked about is the whole milestone. The scope goes in
the report's first line, where scope belongs, and not into a `warning:` — a warning that fires
on every multi-repository milestone for ever is the noise `plugin/conventions/simplicity.md`
forbids, so the exit code does not move either.

Current state (plugin/scripts/ct-status.mjs, lines 528-530):

```js
if (!lines.length && !unchecked.length) {
  lines.push('loop at rest: nothing in flight, nothing to harvest, no residue.')
}
```

Contract (plugin/scripts/ct-status.mjs):

```js
// first line of the report, only when the reach names a repository other than --repo:
//   scope: <repo> — this milestone also reaches <o/a> (checkout <path>) and <o/b>
//   (no checkout registered); this report says nothing about them: /ct-status --repo <o/a>
// and the at-rest line becomes "loop at rest in <repo>: …" whenever that line is printed.
```

**TDD:** red first with
`it('the report names the repositories of the milestone it does not cover')` — a milestone
description declaring `o/other` puts `o/other` and `/ct-status --repo o/other` in the first
line; its boundary pair is
`it('a milestone that reaches one repository prints no scope line and the exit code does not move')`.

**Tests:** added to `__tests__/ct-status.test.js`: the two above,
`the scope line says whether each repository has a registered checkout`,
`the at-rest line names the repository it is at rest in`.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/ct-status.test.js   # expected: exit 0
test "$(grep -c 'loop at rest:' plugin/scripts/ct-status.mjs)" -eq 0   # expected: exit 0 — the line names its repository now
```

### Task 12 — Gate 2 shows which repository each issue lands in

**Objective:** the plan the TL authorises at gate 2 says, for every issue that does not land in
the home repository, where it lands.

**Files:** `backend/src/domain/value-objects/groom-plan.ts` (modify),
`backend/src/infrastructure/ct-groom-epic.ts` (modify),
`backend/src/infrastructure/epic-groom-route.ts` (modify),
`frontend/src/app/epic-groom/EpicGroom.types.ts` (modify),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx` (modify),
`backend/__tests__/infrastructure/ct-groom-epic.test.ts` (modify),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.test.tsx` (modify)

The field earns its reader here: a gate that authorises work across repositories has to show
which ones. The door owns its check (`plugin/conventions/boundaries.md`): an issue printed by a
plugin that does not carry `repo` is read as the repository the groom was asked about, which is
what that plugin meant, so no new failure mode enters. The repository joins the plan's
canonical text, because a plan whose row lands elsewhere is a different plan and the gate key
must not survive that change. The row's copy is Spanish, like the rest of the panel.

Current state (backend/src/domain/value-objects/groom-plan.ts, lines 33-36):

```ts
  static #canonicalIssueText(issue: GroomPlanIssue): string {
    return [String(issue.order), issue.title, issue.labels.join(GroomPlan.#LABEL_SEPARATOR)]
      .join(GroomPlan.#FIELD_SEPARATOR)
  }
```

Contract (frontend/src/app/epic-groom/EpicGroom.types.ts):

```ts
export type GroomPlanIssue = { order: number; title: string; labels: string[]; repo: string }
```

Call site (frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx):

```tsx
const planItem = (issue: GroomPlanIssue, home: string): string =>
  issue.repo === home ? `#${issue.order} · ${issue.title}` : `#${issue.order} · ${issue.title} · ${issue.repo}`
```

**TDD:** red first with
`it('an issue printed with no repo is read as the repository the groom was asked about')` in
`ct-groom-epic.test.ts`; its boundary pair is
`it('muestra el repositorio de la fila que no cae en el repositorio de casa')` in
`EpicGroomPanel.test.tsx` — the row of an issue with another repository shows it, and a row of
the home repository shows no repository at all.

**Tests:** the two above, plus in `ct-groom-epic.test.ts`
`the repository joins the plan's canonical text`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test   # expected: exit 0
npm --prefix frontend test   # expected: exit 0
```

### Task 13 — The contract, the template and the references say the same thing

**Objective:** the slices contract seeded into every governed repository is v25 with the `Repo`
column and the same-repository dependency rule, and the template and the references agree.

**Files:** `plugin/scripts/ct-init.sh` (modify),
`plugin/templates/_TEMPLATE-execution-spec.md` (modify), `docs/loop/ct-groom.md` (modify),
`plugin/commands/ct-groom.md` (modify), `plugin/__tests__/ct-init.test.js` (modify)

Bumping the contract is three moves in one commit, and its own suite goes red if one is
forgotten: `SLICES_CONTRACT_VERSION=25`, the block's own version line, and the sha256 of the
new block ADDED to `SLICES_PRISTINE_HASHES` — never replacing an entry, or a repository seeded
with v24 stops being recognised. The template's table gains the column so that a spec written
from it parses with the column present, and `docs/loop/ct-groom.md` documents it in the same
words, which `ct-init.test.js` already checks for the `Señal` column and will now check for
this one too.

Final text (docs/loop/ct-groom.md):

```md
`Repo` *(optional)*: the repository this slice lands in. Empty, or a "no value" marker, means
the milestone's **home repository** (the `--repo` of the groom). One row, one repository: a
cell naming two **aborts**. A dependency always names a slice of the **same** repository —
`owner/repo#N`, and a `#N` whose row lands in another repository, both **abort** at the groom,
where you can still fix the spec. It costs what it says: a slice of one repository cannot be
ordered after a slice of another.
```

**TDD:** red first with
`it('the contract documents the Repo column and the same-repository dependency rule, and ct-groom.md says the same')`
in `ct-init.test.js` — both files carry the rule; its boundary pair is the suite's own
`it('the hash of the block seeded TODAY is recorded in SLICES_PRISTINE_HASHES')`, which goes
red until the new hash is added.

**Tests:** added to `__tests__/ct-init.test.js`: the one above. Already existing and expected
to go red first: the recorded-hash test, `the seeded contract declares its version`, and
`the seeded template passes /ct-groom's freeze gates and its table parses with the contract in force`.

**Verification:**

```bash
npm --prefix plugin test -- __tests__/ct-init.test.js __tests__/ct-init-dispatch-contract.test.js   # expected: exit 0
test "$(grep -c 'slices-contract-version: 25' plugin/scripts/ct-init.sh)" -eq 1   # expected: exit 0
test "$(grep -c '9962d000dbfc62db370c61ad8015321cc73eb336ad8e8ac0567fa9a4ef414b8c' plugin/scripts/ct-init.sh)" -eq 1   # expected: exit 0 — v24's hash is still recorded
```

## 8. Global verification

The three suites whole, the plugin's bundle guard included, plus the two properties no single
task owns: a spec with no `Repo` column grooms exactly as it groomed before (the dry run's
plan, the labels and the argv are the ones the existing tests already pin), and a spec with one
travels end to end — groom, reach in the milestone, refusal in the dispatcher, harvest with the
repository per row.

```bash
npm --prefix plugin test   # expected: exit 0 — every test file of the plugin
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test   # expected: exit 0
npm --prefix frontend test   # expected: exit 0
test "$(git diff --stat origin/main -- plugin/scripts/gates.js plugin/scripts/kickoff.js | wc -l)" -eq 0   # expected: exit 0 — the gates and the kickoff are untouched
test -z "$(git status --porcelain)"   # expected: exit 0 — every task committed
```

## 9. Assumptions

1. **A dependency never crosses repositories, and the refusal is at the groom.** The issue's
   acceptance criteria say the dispatcher «resolves it against that repository and waits for
   that merge»; the issue's own «what has to be settled» section leaves that open, and the TL
   closed it the other way: half-allowing it is worse than not allowing it, so the crossing is
   refused where a human can still fix the spec and nothing waits anywhere. Provenance: the
   TL's ruling, which supersedes that criterion. Recorded in the pull request as the rule it is,
   with what it costs.
2. **`/ct-next` does not dispatch into another repository's checkout.** A dispatch is a
   `git worktree add`, a seeded `.agent/SLICE.md` and a cmux session in one checkout; the brief
   asks the dispatcher to «read and report per repository», which is what it does, and the
   refusal of a repository it cannot reach is the acceptance criterion. Provenance: own call,
   from the brief's wording and the shape of `ensureRepoIdentity`.
3. **`/ct-status` does not cross repositories.** Half of that report is a local checkout, and
   crossing one repository's issues with another's worktrees is the manufactured finding its
   own header calls the worst failure it can have. It declares its scope instead. Provenance:
   own call, written down in the pull request as decision 3.
4. **The reach lives in the milestone's description.** It is the one place per repository that
   every reader already receives (the milestone travels inside the issue payload) and that the
   groom already owns. Provenance: own call.
5. **The milestone has the same title in every target repository.** It is what lets a reader
   find it without being told; the groom writes it and `/ct-harvest` looks it up by title.
   Provenance: repo convention (one invocation = one `--milestone` = one epic).
6. **The `Repo` column is optional and its absence warns about nothing.** The consequence is
   today's behaviour, and a warning on every spec that does not use it is the noise the
   conventions forbid. Provenance: repo convention (`Gate`/`E2E` are treated the same way).
7. **Nothing is renamed.** Issue #346 (`epic` → `milestone`) is still open; this slice writes
   `milestone` in the new prose it adds and leaves every existing identifier alone. Provenance:
   issue #348's sequencing section and the brief.
