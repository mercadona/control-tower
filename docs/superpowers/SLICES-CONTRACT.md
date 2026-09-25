<!-- ct-init:slices-contract -->
<!-- ct-init:slices-contract-version: 26 -->
## Slices table format (contract with /ct-groom)
`/ct-groom` reads this table from the milestone's spec and creates one GitHub issue
per row — it is the only part of a spec that a program parses. Exact header,
copyable as is:

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal | Repo |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|------|

> **What you write outside the slices table does not reach the agent.** The agent
> that implements a slice does not receive the spec: it receives a start-up
> prompt and the ISSUE BODY, and the issue body is built from these columns and
> nothing else. A requirement written in another section of the spec ("§10",
> "RULE #-2", an introductory paragraph) is invisible to it however forcefully
> it is worded. If the agent has to comply with something, it has to fit in one
> of these columns — and if it fits in none of them, do not count on it being
> complied with.

- **`#`** *(required)*: plain integer (`1`, `2`…) → order of the slice and target
  of `Dep`. Never `S1` nor `**1**` (bold/prefix): the whole row is
  discarded.
- **Slice** *(required)*: short name of the row — it feeds the issue TITLE
  (`#N <Slice>`). Empty, carrying a "no value" marker, or carrying only
  a `#N` reference with no name around it → row discarded (the same
  treatment an empty `Entrega` used to get). If the cell already carries a
  `#N` reference (e.g. an issue created by hand before running
  `/ct-groom`), that reference is extracted separately and does NOT appear in the title.
  That same title is what `/ct-next` re-injects when dispatching: the first
  line of the agent's kickoff and the name of the cmux workspace come from here
  — which is why it should be short and readable, not a sentence.
- **Tipo** *(optional)*: `type:<value>` label of the issue. It also decides which
  **technical reminder** (*addendum*) the agent receives when dispatched
  (`/ct-next` → `kickoff.js`): the values recognised today are `ui`, `backend`,
  `infra`, `bugfix`. A value that is none of those does NOT abort, but
  `/ct-groom` warns on stderr: the agent dispatched for that slice will not
  receive any type addendum, and without that warning it would pass in silence.
  `Tipo` also decides the **default** gates (see `Gate`, just below),
  but it no longer decides them alone: until contract v9 they were the same
  column, and a `backend` slice that needed a visual review had no way
  of asking for one.
- **Gate** *(optional)*: which **human gates** have to be closed before merging
  this slice — the other axis, separate from `Tipo`. Closed vocabulary:
  - `visual` — a human has to SEE the change: before/after screenshot or video
    in the PR;
  - `apply` — nothing is applied against a real environment until a human
    reviews the plan/dry-run;
  - `plan` — before implementing, a human reviews the slice's PLAN: the
    agent publishes it as a comment on the issue and stops until the OK.
    It is implied **by default on every slice**, whatever the `Tipo`
    is; it is waived per row with `!plan` (and the waiver is announced).
  - `e2e` — before merging, someone walks the journeys the slice
    declared in its `E2E` column (see further down) and leaves the report in the PR.
    Unlike the other three, **`e2e` is not written in this column**:
    it is DERIVED from the row carrying some journey in `E2E`. Writing
    `Gate: e2e` by hand **aborts** — the place where an e2e is asked for is the
    `E2E` column, never this one.

  **Nothing needs to be written in the normal case**: `Tipo: ui` implies
  `visual`, `Tipo: infra` implies `apply`, and **every slice** carries `plan` as
  standard. The column is there for the two deviations:
  - **adding** a gate the `Tipo` does not imply — `Tipo: backend` +
    `Gate: visual` (the real case: a migration with a backfill that moves a
    very visible progress bar). `/ct-groom` **announces it on stderr**:
    you are carrying a gate that does not come from your type;
  - **waiving** one it does imply, with a `!` in front: `!visual` on a
    `Tipo: ui` that really does not change anything visible. This is announced too, and
    louder: removing a gate is never silent. (The `!` and not a `-`
    because `-` already means "no value" in every other column.)

  An empty cell or one with a "no value" marker (`–`) means *I have declared
  nothing*, **not** "I waive everything". A value that is not in the vocabulary
  **aborts** (unlike `Tipo`): an unknown gate would produce no label,
  no instruction to the agent, and no line in the issue — it would be a gate that only
  exists in the spec, which is exactly what this column is here to prevent.

  Where it ends up: each resolved gate is written as a **`gate:<token>`** label on the
  issue (and **`gate:none`** when there is none — silence cannot
  mean both "no gates" and "issue older than the gates"), as a
  **`## Gates`** section of the issue body, and as an explicit instruction in the
  agent's prompt. That is why it survives a re-dispatch and a `--reopen`: it is
  read from the issue, not from the spec.
- **Entrega** *(optional)*: text of what the slice delivers → the
  "Descripción" section of the issue body. It no longer feeds the title (that is what
  `Slice` does, see above).
- **Dep**: `#N` (several, comma-separated) pointing at another `#` of this
  same table, or a "no value" marker if it depends on nothing. `S1` does not
  work — use `#1`. It feeds the `merge-after` graph that `/ct-next` respects.
  In the issue body it appears as ``merge-after `#N` `` (in backticks,
  on purpose: a bare `#N` would be turned by GitHub into a link to issue
  number N of this repo, which has nothing to do with it). That `#N` **is always the
  `#` of this table — the ORDER of the slice, never an issue number**;
  `/ct-next` translates it through the `ct-order` marker that each issue carries at
  the end.
  **A dependency always names a slice of the SAME repository.** Both ways of
  crossing **abort**: writing `owner/repo#N`, and a plain `#N` whose row lands
  in another repository (see `Repo`). It is refused at the groom, where you can
  still fix the spec, and not at dispatch, where the work would already be
  claimed: the dispatcher cannot see a merge in another repository from this
  checkout, so it could neither confirm nor deny it. What that costs, said
  plainly: a slice of one repository cannot be ordered after a slice of
  another — express that ordering another way, or do not spread the milestone
  across repositories.
- **Acepta** *(optional)*: comma-separated acceptance criteria →
  the "Acceptance criteria" section of the issue, one per line. **The comma ALWAYS
  separates**: a criterion in EARS ("When the token expires, the system asks for
  login") would be split into two half criteria. If yours carries a comma,
  escape it as `\,` (`When the token expires\, the system asks for login`) or
  rephrase without it. Only the exact sequence `\,` is an escape — a lone
  backslash is kept as is.
- **Protegido** *(optional)*: what is left out of scope → the "Out of
  scope / Protected" section of the issue. Free text in a single piece: here the comma
  separates **nothing**, write normally.
- **Área / Toca** *(optional, comma-separated)*: tokens → labels
  `area:<x>` / `touches:<y>`. The same key used by collision detection
  (`claim.js#tokensOf`) and by serialization (`dispatch.js#SERIALIZING_TOUCHES`):
  reuse the label vocabulary that already exists in this repo, do not invent
  a new one per spec. To see which exists: `gh label list --repo
  <owner/repo>` (and `/ct-groom` tells you, when it runs, which labels it has created
  NEW and which it has reused — if a new one appears that you expected to
  reuse, you have written a synonym). A token cannot contain
  commas: they are discarded when normalising, here `\,` is of no use.
  `migration`/`ci`/`pbxproj` in `Toca` are special — they serialize with each other:
  at most one slice with one of those three unmerged at a time, regardless of
  `Área`. The real scope of that "global" is further down, in "What
  `/ct-next` does with this": it is global **to this repo's issue flow**, which is not
  the same as global to the repo.
- **Señal** *(optional)*: the OBSERVABILITY SIGNAL this slice
  promises — which metric, log or event its production code has to emit
  (e.g. "`backfill_progress` metric with a `status` label").

  IT IS NOT ONE MORE ACCEPTANCE CRITERION. The criteria in `Acepta` are
  functional: they say what the code has to do for the slice to be
  done, and the judge already measures them in its `estado-final` item. The
  signal promises something else: WHAT WILL BE SEEN IN PRODUCTION when the
  slice is deployed — the metric, the log or the event by which
  someone will know, without reading the diff, whether this is working. A signal
  that repeats an acceptance criterion in other words leaves the
  `observabilidad` item measuring what `estado-final` already measured: it adds
  no information. Rule of thumb: if what you write can be
  checked by running the tests, it is an acceptance criterion, not a
  signal.

  Free text in a single piece, like `Protegido`: the comma separates
  nothing. It arrives as the `## Señal de observabilidad` section of the issue
  body, travels to the worktree's `.agent/SLICE.md` on dispatch, and the
  SLICE JUDGE measures it against the accumulated diff (`observabilidad` item):
  that what was promised is emitted by production code, instrumented the way this
  repo already instruments, without unbounded-cardinality labels. If the
  slice has nothing observable to promise, the REASONED EXEMPTION is declared:
  `N/A — <reason>` (the same idiom as the Global verification
  of a plan). An exemption WITHOUT a reason **aborts**: an exemption nobody
  can read is an undeclared signal in disguise. An empty cell
  or one with a "no value" marker means *I have not thought about it* — it
  is not an exemption: the judge measures it as `sin-vara`, and that count travels in
  the milestone's telemetry.
- **E2E** *(optional)*: which journeys have to be walked before merging this
  slice, comma-separated → the `## E2E` section of the issue body, one per
  line (same escaping rule as `Acepta`: a comma inside a
  journey is written `\,`). Declaring something here **derives** the `` `e2e` `` gate
  (see `Gate`, above) — do not write it in `Gate` as well.

  **If the table HAS this column, every row has to decide.** A dash
  (or any other "no value" marker) in a row of a table WITH an
  `E2E` column means what it always means —"I have declared nothing here"—
  but here that **aborts**: with the column present, "nobody thought about it" is not
  a valid option per row. To really say "this slice has nothing
  to walk", write the token **`no`** (or **`n/a`**, which works the same: both
  are the same "it was thought about and there is none"). Declaring a real journey AND
  `no` in the same cell also aborts: a winner is not picked in silence.
  If no slice of the milestone needs e2e, the way out is not to add the column at
  all — that way no row has to decide anything.

- **Repo** *(optional)*: the repository this slice LANDS IN. A milestone has one
  **home repository** — the `--repo` of the groom, where its conversation lives
  and its spec is committed — and N **target repositories**, one per row that
  names another. An empty cell, or one with a "no value" marker, means the home
  repository, which is what every table that does not carry this column gets.

  **One row, one repository**: a cell naming two **aborts**, and so does one that
  is not written `owner/repo` (no backticks, no bold, no spaces). Each target
  repository gets its own milestone with the SAME title, its own labels — only
  the ones its own rows need — and its own issues; a dependency never crosses
  between them (see `Dep`).

"No value" markers (`Dep`/`Acepta`/`Protegido`/`Área`/`Toca`/`Gate`/`Señal`/`Repo`):
`–` `-` `—` `―` `−` `--` or an empty cell — any dash variant works.
`E2E` uses the same set of markers, with the caveat above: they are only
harmless when the column is not present.

### What `/ct-groom` creates is NOT dispatchable yet

Every issue is born with **`status:backlog`**, and `/ct-next` only dispatches
`status:ready`. Promoting them is a **human and deliberate** step — it is the gate
of the loop: you decide what goes in flight and when, the groom never does it for
you. If `/ct-next` answers "there are no dispatchable slices" right after
grooming a whole milestone, this is why:

```
gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:backlog
```

`/ct-groom` reminds you when it finishes how many issues of the milestone are still in backlog.
From then on the `status:` label is moved by `/ct-next` and the flow
(`ready` → `in-progress` → `in-review`, and back to `ready` if the review
rejects the PR — see "Rejecting a PR" further down), not by the spec — which is why
re-grooming never compares it nor reverts it.

### Decisions of yours that depend on how `/ct-groom` is invoked

- **`--milestone "<title>"`** (default `Epic`): one invocation = one milestone,
  which `/ct-groom` creates if it does not exist. The `#` of this table are
  unique **within their milestone**, not within the repo: two different milestones can
  use `#1` without stepping on each other. But if two SPECS are groomed into the
  same milestone (e.g. both left with the default title `Epic`), their orders
  clash and `/ct-next` excludes that whole milestone from the selection, with a
  warning. Give each spec its own milestone title.
- **`--section N`**: OBSOLETE, accepted and ignored (with a warning). It never decided
  what got groomed: the table is located by its **header** (a row with
  columns `Slice` and `Dep`), not by any section number — so if the
  document carries another table with those two columns BEFORE it, that one will be groomed. One
  single slices table per spec. All `--section` did was compose the
  anchor of the link to the spec as `#N`, an anchor that does not exist on GitHub.
- **The link to the spec** written in each issue now comes from the real
  heading you put the table under (`## 9. Slices` → `…/blob/<default
  branch>/path/to/spec.md#9-slices`), and it is **verified** against GitHub before
  writing it. Consequence for you: **push the spec before grooming**. If the
  file is not published on the default branch, the issues are born with a
  text reference with no link (saying why), and `/ct-groom` does not fix it
  in later runs without `--reconcile`.
- **`--project <n>`** *(optional)*: puts each issue in the Project v2 number
  `n` **of the same owner as `--repo`** (a project of another owner is not
  supported) and sets its iteration field named exactly `Sprint` to the
  iteration in force today. If that field does not exist, or no iteration covers
  today's date, `/ct-groom` aborts **without having created anything** — no milestone, no
  labels, no issues. (Until contract v5 this was not true: the project was
  validated after the milestone and the labels, and an abort left them
  created.)

#### What `/ct-groom` guarantees about what it has already touched when it fails

This matters because the natural answer —"an abort halfway leaves the repo
half-done"— is frightening and leads to cleaning up by hand things that must not be cleaned up.

- **Everything `/ct-groom` READS happens before everything it WRITES.** The
  validations —arguments, slices table, spec and its link, listing of issues, of
  labels and of milestones, and (with `--project`) the `Sprint` field with its
  iteration in force— **all** come ahead of the first mutation. If it
  aborts on any of them, **it has created nothing**.
- **What is NOT promised: there is no transaction.** Once it starts writing, the
  order is milestone → labels → issues → adding to the Project. A failure *there*
  in the middle (network, rate limit, auth down, a Ctrl-C) leaves what came before created. There
  is no rollback and none is pretended.
- **You get out of that by running again, not by cleaning up by hand.** `/ct-groom` is
  idempotent by construction: the milestone is reused by title, of the
  labels only the missing ones are created (the ones that already existed are **not** touched,
  neither their colour nor their description), the issues are recognised by their
  `ct-order` marker and are not duplicated, and an issue that was left out of the Project is
  detected and added on the next run.
- **Without `--reconcile`, an issue that already exists is NEVER edited.** The
  drifts are reported and it exits `3`; nothing is written.
- **`--dry-run` mutates nothing, ever** — it does not even create the milestone.

An example that parses as is (verified with `ct-groom.mjs --dry-run`):

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|
| 1 | model | backend | `medications` table | – | AC-1.1 | schema | medication | db, migration | – | – |
| 2 | bar | backend | backfill with visible progress | #1 | AC-2.1 | – | medication | db, migration | visual | `backfill_progress` metric with a `status` label |
| 3 | screen | ui | creation screen | #2 | AC-3.1 | – | medication | app | – | N/A — screen with no new telemetry to promise |

(Row 2 is the case the `Gate` column exists to cover: it is `backend`
on the inside and the most visible thing in the milestone on the outside. Row 3 declares nothing and
gets its `visual` gate all the same, by being `Tipo: ui`. Row 2 also declares
its observability signal and row 3 exempts itself with a reason — with
row 1, the three forms of the `Señal` column in one single example.)

**Fixing the table and grooming again does NOT fix the issues already created.**
Re-running `/ct-groom` does not duplicate them (it recognises them by their
`ct-order` marker), but it does not update them either: it compares title, link to the spec,
labels (`type:`/`area:`/`touches:`/`gate:`; `status:` never) and the
two sections the dispatcher obeys
(`## Dependencias`, `## Acceptance criteria`) against what the table produces
today, **reports** each difference on stderr and exits `3` — but writes nothing
unless it is given `--reconcile` (EXPERIMENTAL: it has corrupted real bodies
in testing, review the issue's diff after using it). An issue whose slice
is no longer in the table is flagged as orphaned and is not touched. If you change something
in a row already groomed, count on reviewing that issue by hand.

**The milestone is NOT in that list, and it is not an oversight.** A groom only looks at
the issues of the milestone you passed it, so a paired issue always has,
by construction, that same milestone: the milestone drift is
unreachable from `/ct-groom` and you will never see it reported. If you move an
issue between milestones on GitHub and run again, what you get is not a
drift warning: depending on where you moved it, either it is ignored for belonging to
another milestone, or `/ct-groom` stops dead with **exit 1** without creating or modifying
anything, or it creates a new issue for that slice, warning that it may be
duplicating it. A practical consequence of that same scope: **the slices table of
each spec can start at `1`** without stepping on the issues of an earlier milestone.
See "The scope of a groom is its milestone, not the repo" in `docs/loop/ct-groom.md` (plugin repo).

Full detail (all the abort conditions, optional columns,
non-fatal warnings, the drift report, its limits, and `--reconcile`):
`docs/loop/ct-groom.md` in the `control-tower-loop` plugin repo (the command `commands/ct-groom.md` kept the invocation and its exit codes).

### What `/ct-next` does with this

What is below is NOT the invocation reference (that is `docs/loop/ct-next.md`,
in the plugin repo): it is what changes how you write the table and how you live
with the loop once there are slices in flight.

- **`Área`/`Toca` do not warn: they BLOCK.** A slice sharing **a single
  token** with an issue in `status:in-progress` **or `status:in-review`**
  is not dispatched — `/ct-next` skips it and tries the next candidate; if none
  is left, it launches nothing and says which issue it clashed with and in which state.
  Choosing the tokens **is** choosing what can fly in parallel: two slices with
  a token in common end up serialized even if they touch different files.
- **A token is held until the MERGE, not until the agent stops.** The
  agent releases its claim when opening the PR (`in-progress` → `in-review`), and that
  frees the **cap** — but not the tokens: until the PR is merged and the
  issue is closed, `main` still does not contain that work, so an area
  neighbour would branch from an incomplete base. Consequence when designing the
  table: **an unmerged PR holds back its area neighbours**, not just its
  dependants. Two slices sharing a token do not overlap even "a little bit".
  And if `/ct-next` tells you it clashes with a `status:in-review`, waiting
  is useless: there is no agent there. Merge the PR — or, if the PR was already
  merged and the issue is still open, close it **as *completed***
  (`gh issue close <n> --reason completed`).
- **"PR merged, issue open" has TWO causes, and the second one deceives.** It is
  the state that blocks a lane forever, so it is worth knowing how to
  diagnose it in full:
  - the PR was missing the `Closes #N` in its body. The kickoff `/ct-next`
    gives each agent asks for it explicitly, but the kickoff is a
    PROMPT, not a gate: **the most likely cause of this case is simply
    that the agent did not put it there** (besides a PR opened by hand, or a body
    edited afterwards). Nothing in the loop checks it;
  - the PR DID carry its `Closes #N`, but it was merged into a branch that **is not
    the repo's default branch**. GitHub **only closes the issue when the
    PR lands on the default branch** — verified against a real repo, not
    deduced from the documentation. It is the case that deceives: you look at the PR, you see the
    `Closes #N` right there, and you discard the correct diagnosis.
  Operational consequence: if you dispatch with `/ct-next --base <other-branch>`,
  **closing each issue when merging its PR is a manual step, always** — the
  `Closes #N` is not going to do it for you. `/ct-next` warns on stderr every time
  you pass it `--base`.
- **`migration`/`ci`/`pbxproj` also serialize GLOBALLY, with a specific
  scope.** They are two different rules acting at once: the one above
  compares tokens, this one does not. A slice with `Toca: migration` and another with
  `Toca: ci` **share no token at all** and still cannot be unmerged
  at the same time, regardless of `Área`. **What "global" really means:
  `/ct-next` only looks at issues of THIS repo with `status:in-progress` or
  `status:in-review`.** Everything that goes outside the issue flow is
  INVISIBLE to this rule: another branch, another track of work, a human
  editing the same migration by hand, a different repo. The serialization is
  global **to this repo's issue flow**, not to the repository nor to the
  project. If you have parallel work outside the loop, this guarantee does not
  cover it and there is nothing in the plugin that could cover it.
- **`merge-after` is checked by looking at HOW the issue was closed.** A
  dependency counts as satisfied if its issue is **closed as
  *completed*** — which is what GitHub does when merging a PR with `Closes #N`.
  An approved PR, an open PR or an issue in `status:in-review` do not
  unblock anything. The two traps of that approximation, said without adornment:
  - an issue closed as ***not planned*** (the right thing for a discarded
    slice) does **not** satisfy the dep and leaves its dependants waiting
    forever. `/ct-next` names it when explaining the blockage: if you see that,
    remove the `merge-after` from the dependant's `## Dependencias` section, or
    reopen the issue and close it as *completed* if its work was indeed done;
  - an issue closed as ***completed*** without anything having been merged **does**
    satisfy the dep, and the dependant will start on top of work that does not exist.
    **This does not require anyone to make a deliberate mistake**: GitHub applies
    the *closing keywords* of **any commit message** that reaches the default
    branch, and **quotes do not protect**. In a real repo, a
    **documentation** commit that only MENTIONED the string `Closes #451` —inside
    a sentence explaining that the kickoff did not carry it— closed that issue as
    *completed*.
    `/ct-next` **warns** (it does not block) when an already satisfied dependency
    turns out to be closed by a **loose commit** that does not belong to any merged
    PR. What it does **not** require is that the closure come from a PR: closing
    the issue by hand is the majority practice (measured: 86 of 97 *completed*
    closures in a real repo have no PR behind them) and it is moreover a step
    **prescribed** right here when dispatching with `--base <other-branch>`.
    Be careful about writing those keywords in any commit, even in
    quotes. The plugin **blocks** the commit when the keyword travels
    in the message (`-m`) of a `git commit` launched from **a session of
    Claude that has this plugin loaded**, against a repo that has this
    section in its `AGENTS.md`. It is a property of the SESSION, not just of the
    repo: a dispatched agent starts with its own account
    (`CLAUDE_CONFIG_DIR`, see `resolveAccount` in `scripts/dispatch.js`), so
    it only carries the gate if the plugin is installed there too.
    And the rule that sums up what is left out, because a list of exceptions
    ages worse than the principle it comes from: **the gate hooks into the
    `Bash` tool, so it covers what CLAUDE executes, never what YOU type**.
    Neither in your terminal, nor with the `!` prefix inside the Claude session
    itself: a `!` does not go through the tool, so no hook sees it. Measured
    in a governed repo, with the SAME message: blocked from the `Bash`
    tool, clean with `!`. What it also **does not see**, and therefore remains
    yours: a `git commit` **without** `-m` (the message is set by the editor), a
    `-F <file>` and an `--amend --no-edit`; nor a **wrapped**
    invocation, where `git` stops being the first token — `sudo git
    commit`, `env FOO=1 git commit`, `command git commit`. With `git -C
    <path> commit -m ...` or `cd <path> && git commit -m ...` the problem is
    not that it does not see it: the gate decides on the repo of THE SESSION's
    directory, never on the one `<path>` points at, and that cuts both
    ways — it can block a commit aimed at a repo it does not govern
    (session inside a governed one, `<path>` outside) and fail to protect one
    aimed at a repo it does govern (session outside, `<path>` inside). For
    whatever escapes, there is still the `/ct-next` warning from up here: that
    catches the EFFECT, the gate catches the CAUSE, and neither of the two catches
    everything.
  When designing the table: the slice many depend on is the **bottleneck**
  of the whole milestone — nothing behind it advances until THAT one is
  merged. If you want a window of parallelism, it has to come out of the
  `Dep` column.
- **A CLOSED issue that keeps its `status:` label does not exist for
  `/ct-next`.** The dispatcher only sweeps **open** issues. A closed one with
  `status:ready` still on it drops out of the dispatch queue, and until now
  it dropped out **without a word**: the next run moved on to the next
  `status:ready` of the repo and explained in detail why *that one* was not
  dispatchable, without mentioning the one that had disappeared. Now an aggregated
  warning comes out —one only, with the numbers grouped by state— because **closing the
  issue and removing its label are two distinct acts and nothing checks the
  second**: the rate measured in a real repo is **10 closed with a live label
  out of every 99**. A `status:in-review` on a closed issue is NOT an anomaly:
  it is the normal end of a slice, and nothing removes that label on closing.
- **A BLOCKED slice keeps its claim, and there is no transition that frees it.**
  If the agent marks `blocked: {reason, unblock}` in its worktree's `.agent/SLICE.md`
  and stops —which is what the kickoff asks of it—, its issue stays in
  `status:in-progress` **holding tokens and a `--cap` slot**
  indefinitely: stale-claim detection does not see it (the worktree and the
  branch DO exist), `--requeue` refuses precisely because of that, and `--release`
  would lie (there is no PR). `/ct-next` **reads** that `SLICE.md` (before F22 it was the
  worktree's `.agent/STATE.md`; today that one is the coordinator's and is **not**
  read) and says so with its reason, but **does not fix it**: getting it out of there is a
  decision of yours (unblocking it, or abandoning it by deleting worktree and branch before
  `--requeue`).
- **One invocation dispatches `--cap` slices; the default is 1.** And the cap is
  **global to the repo, not per invocation**: it also counts what is already in
  flight (`status:in-progress`), so a second `/ct-next --cap 1` with something
  running launches nothing — and says so. A `status:in-review` does **not** occupy cap
  (there is no agent running there), even though it does hold its tokens: they are two
  distinct accountings. A slice reopened with `--reopen` goes back to
  `in-progress` and therefore **does** occupy cap: this time there is someone
  redoing it. Taking advantage of a window of parallelism is an
  explicit act: `/ct-next --cap 2` (or more).
- **The two guarantees above hold for ONE dispatcher at a time.** The claim
  is a GitHub label, with no compare-and-swap: it is reproduced and verified
  that two `/ct-next` launched almost at the same time against the same repo can
  claim the same shared token and both start, skipping both the
  collision rule and the cap. There is no wait or retry that closes that
  gap today. **The mitigation is operational: do not launch two dispatchers at once
  on the same repo.** (Detail and evidence: `docs/loop/ct-next.md`.)
- **`/ct-next` does not scope by milestone.** It accepts `--repo`, `--cap`, `--base` and
  `--dry-run`; **there is no `--milestone`**. It sweeps every open issue of the
  repo and chooses by the lowest `#` of the table, whichever milestone it comes from (that
  `#` is indeed resolved within its own milestone in order to translate `Dep`, but
  the SELECTION is not scoped). With two milestones alive, the `#1` of the second beats
  the `#3` of the first — and if both have a dispatchable `#1`, **which one comes
  out first is undefined**: it depends on the order in which GitHub returns the
  issues. The lever for deciding which milestone advances is the one you already have:
  promote to `status:ready` only the slices you want in flight.
- **`cmux` is required.** It is a terminal workspace manager, external to the
  plugin: each slice is launched as `cmux new-workspace` (a worktree + a
  `claude` session). If `cmux` is not on the PATH, **no** slice can be
  launched — `/ct-next` aborts on the preconditions, before claiming anything.
  `/ct-groom` and `/ct-init` do not need it: it is a requirement of the dispatch only.
- **Interruption and resumption.** A Ctrl-C (SIGINT/SIGTERM) mid-run
  reverts to `status:ready` any claim that had been left half-done before
  exiting. Re-invoking `/ct-next` is **idempotent** by construction: a slice
  already dispatched is in `status:in-progress`, so it is no longer `status:ready`
  and is not chosen again (although it still occupies cap). Each slice uses the branch
  `feat/<n>` and the worktree `.worktrees/<n>` (`<n>` = ISSUE number, not the
  `#` of the table); if either of the two already exists from an earlier run,
  `/ct-next` refuses to dispatch that slice **before** claiming it and prints
  the exact cleanup command.
- **A claim is a label, with no heartbeat: nothing expires it.** If a slice dies
  (session closed, machine powered off, an agent that never ran its
  `--release`), its `status:in-progress` stays put and blocks
  indefinitely everyone sharing its tokens, until someone reverts it
  **by hand**:

  ```
  node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --requeue
  ```

  `--requeue` is the **checked** version of editing by hand: it refuses if
  the worktree `.worktrees/<n>` or the branch `feat/<n>` still exist, because
  then that slice's work is still alive unmerged and releasing its tokens
  would let a neighbour out on a base that does not contain it. If you really
  want to skip that check (you know that work does not matter and you
  prefer to keep the worktree), the raw edit is still there and it
  checks nothing:

  ```
  gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:in-progress
  ```

  `/ct-next` helps as far as it can: if a `status:in-progress` has neither
  worktree, nor branch, nor cmux session **on this machine**, it says so — both
  if it blocks by a shared token and if it is only occupying the `--cap`. But
  it cannot assert that it is abandoned (it could have been claimed from somewhere else), and
  **only whoever is running `/ct-next` at that moment finds out**: there is no
  daemon watching claims between invocations. Check before
  breaking someone else's claim. (This check is NOT done on a
  `status:in-review`: there, having no session open is the normal thing, not an
  anomaly — what blocks is the unmerged PR, not a dead claim.)

### Rejecting a PR at the gate, without taking the slice out of the loop

`status:in-review` is **not** a terminal state, but getting out of it is a
deliberate act of yours: there is no automatic transition back. The complete
cycle of a slice, with who moves each edge:

```
backlog --(you)--> ready --(/ct-next)--> in-progress --(--release)--> in-review
                    ^                        ^                          |
                    |                        +-------(--reopen)---------+
                    +---------(--requeue)----+
```

If you reject a slice's PR, put it back on the workbench with

```
node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --reopen
```

which moves it `in-review` → **`in-progress`** —the exact inverse of
`--release`— **only if it really is in `in-review`** (if not, it refuses without
touching any label). That it ends up in `in-progress` and not in `ready` is **not
a detail**: its work still exists unmerged in `feat/<n>`, so it
**still holds its tokens** from `Área`/`Toca` until the merge. Reopening does **not
unblock its neighbours** — it only says who is redoing it. And it occupies a
`--cap` slot, because this time there is someone working on it.

It deletes nothing from disk: it tells you what is left from the previous round (the worktree
`.worktrees/<n>` and the branch `feat/<n>`) and lets you choose between two
mutually exclusive paths:

- **fixing on top** of what is already there — the normal thing after a rejection: you stay in
  that same worktree and that same PR, and you do **not** invoke `/ct-next` for that
  slice (it would refuse, precisely because the worktree and the branch exist).
  When it is ready again, you repeat the `--release`;
- **starting from scratch** — you delete worktree and branch (check first that you are not
  losing unpushed work), you close its PR, and **only then** do you
  return it to the queue:

  ```
  node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --requeue
  ```

  `--requeue` moves `in-progress` → `ready`, and it is the ONLY transition that
  releases tokens without a merge, so it **checks before declaring it**: it requires
  that on this machine neither `.worktrees/<n>` nor `feat/<n>` is left, and it also refuses
  if it could not look (what has not been seen is not declared absent). What it
  **cannot** check and tells you every time: the branch on the
  remote and the open PR. If they are still there, that work is still unmerged and there is no
  longer anyone holding its area.

`--requeue` also serves the other long-standing case: **breaking a dead
claim** (a `status:in-progress` whose agent no longer exists). It is the checked
version of the manual `gh issue edit` that appears further up.

Without these two edges, a rejected PR left its slice out of the loop **for
ever**, and with it everything that depended on it: `/ct-next` only dispatches
`status:ready`.
- **Each slice in flight has ITS OWN `.agent/SLICE.md`**: the one in its worktree
  (`.worktrees/<n>/.agent/SLICE.md`), seeded on dispatch (before F22 the
  seed went to the worktree's `.agent/STATE.md` — a TRACKED file, and that is
  why slice PRs ended up taking the state to `main`). Two slices at
  once do not step on that file, and neither of them touches any `.agent/STATE.md`: neither
  the main checkout's nor the one its own worktree inherits from the base,
  which is left with a zero diff. `.agent/SLICE.md` is **ignored** by two routes:
  the repo's `.gitignore` (added by `/ct-init`) and the `info/exclude` of git's
  common directory (written by `/ct-next` on each dispatch, and from there it
  covers every worktree). That way it does not enter any commit — and `--release`
  refuses if the branch introduces either of the two state files.
- **Two sessions per repo, with OPPOSITE roles, and each one carries it written
  in its state file (`role` field): the `.agent/STATE.md` of the main
  checkout, the `.agent/SLICE.md` of each worktree.** The one in the **main
  checkout** is the *coordinator*: it grooms, dispatches with `/ct-next`, reviews and
  merges. The one in each `.worktrees/<n>` is the *dispatched* one: it implements that slice
  and **stops** — it does not merge, it does not dispatch the next one. Before, that split only
  existed inside the kickoff that one of the two received, so it was lost
  as soon as that session re-hydrated from its state file. No code checks it:
  it is information for the agent that reads it.
- **What the dispatched agent receives**: a start-up prompt (*kickoff*) with
  the name of the slice, the issue number, the criteria of the
  "Acceptance criteria" section, the reminder to read the "Out of scope /
  Protected" section, the technical addendum of its `Tipo`, **its human gates** (those of
  the `Gate` column, or those its `Tipo` implies), the base branch against which
  it has to open the PR, the order to put **`Closes #N` in the body of that
  PR** (with the why: without that closure, the slice holds its tokens for
  ever and does not unblock its dependants) and the literal command to
  release the claim when finishing; plus the `.agent/SLICE.md` seeded in its
  worktree (which repeats its `role` and its gates, to survive a `/clear`;
  before F22 that seed went to `.agent/STATE.md`, which is the coordinator's)
  and whatever the repo itself gives it on start-up (`AGENTS.md`,
  `CLAUDE.md`, hooks). **It does not receive the
  spec**: it hydrates from the issue. **What did not reach the issue body does not reach
  the agent.** No requirement you make of it from another section of the spec —a
  §10, a "RULE #-2", an introductory paragraph— is going to reach it, however
  forcefully it is worded. What the kickoff **cannot** guarantee is that the agent
  obeys: if a PR appears without its `Closes #N`, the loop does not detect it — you
  will see it as a `status:in-review` that never clears. The same goes for the
  gates: the loop **writes them and shows them** (kickoff, `gate:` label, section
  `## Gates` of the issue), but it **does not prevent merging** a PR with its gate
  unclosed. The one who closes the gate is you.
  **And that is why your pre-merge checks have to be GATES.**
  Verify the EFFECT, never the exit code: if the result of a check cannot
  stop the merge, it is not a check, it is decoration. In the field, a
  state-contamination check printed `1` and the merge went in all the same —
  the default branch had to be fixed afterwards—; the same check,
  turned into a gate, stopped the next one. It holds for everything you look at before
  merging, not just for the gates: if you check it by hand, let the result
  rule.

<sub>This contract is maintained by `/ct-init` (contract v26) and lives in
`docs/superpowers/SLICES-CONTRACT.md` of this repo — or in
`docs/superpowers/CONTRATO-SLICES.md` if the repository was seeded before v24,
where it is kept and updated under that name; `AGENTS.md` only links to it. If the plugin brings a newer version, `/ct-init` warns about it when running;
to adopt it: `bash <plugin>/scripts/ct-init.sh <repo-dir>
--update-slices-contract`, which only replaces it if you have not edited it by hand.</sub>
<!-- /ct-init:slices-contract -->
