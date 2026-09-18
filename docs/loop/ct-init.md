# `/ct-init` — reference and design

> Text moved whole from `plugin/commands/ct-init.md` (sub-issue #93). The command keeps the invocation, the table of exit codes, the instructions to the agent as a list, and a link to this document.
>
> **Update (#93):** the text below describes the slices table contract as a section of `AGENTS.md`. From this round on, the contract lives in its own file of the governed repository (`/ct-init` writes and versions it, with the same doctrine of version, «pristine» hashes, `--update-slices-contract` and `--force` described here) and `AGENTS.md` keeps a short section —the same `<!-- ct-init:slices-contract -->` markers, which are the governed-repository signal the commit gate reads— that links to the contract. **The filename (#188):** a fresh repository gets `docs/superpowers/SLICES-CONTRACT.md`; a repository that already carries the legacy `docs/superpowers/CONTRATO-SLICES.md` keeps that name, recognised and updated in place, never renamed. An `AGENTS.md` bootstrapped earlier keeps the whole contract until `--update-slices-contract` is run, which replaces the section with the short one if it was unedited.

The invocation:

```
bash ${CLAUDE_PLUGIN_ROOT}/scripts/ct-init.sh "$(pwd)"
```

Then fill in `AGENTS.md` with the repository's real commands (build, test, lint,
CI): for that, do explore the repository.

`AGENTS.md` already carries (the scaffolder creates it or adds it by itself) a
section **"Formato de la tabla §9 (contrato con /ct-groom)"**, delimited by
`<!-- ct-init:slices-contract --> ... <!-- /ct-init:slices-contract -->`.
It is the contract whoever writes specs for this repository needs — **do not
duplicate it, do not rewrite it, do not summarise it in another section**, even
if exploring the repository makes you think it is missing or that you would word
it differently. If the user has edited it by hand, respect it exactly as it is.

The section carries its own version
(`<!-- ct-init:slices-contract-version: N -->`). If the repository was already
bootstrapped with an earlier version, the scaffolder **warns on stderr** and
touches nothing: adopting the new one is an explicit decision of the user's, not
a side effect of running `/ct-init`. If they ask you to, run it with
`--update-slices-contract`: it only replaces the section if its content matches,
byte for byte, one of the blocks `ct-init` knows it emitted (it has them all
recorded by hash). If it does **not** recognise it, it exits with exit 3 and does
**not** assert that the user edited it: it may be a hand edit or an untouched
block from a version of the plugin that this `ct-init` does not have on record,
and from there the two cannot be told apart. If that happens, **pass the warning
on to the user exactly as it is, hash included** — do not translate it into "you
edited it" nor assume which of the two it is. `--force` replaces it all the same;
**never pass it on your own initiative**, and only after the user confirms that
that section carries no work of theirs.

The scaffolder also creates `.agent/conventions.md` — the repository's
yardstick: the documents of code rules, which `ct-step` pastes into every task's
brief.
**This is the moment of human confirmation**: the scaffolder prints, on STDOUT, a deterministic block that begins with the literal `Yardstick candidates for this repo (deterministic sweep — it PROPOSES, it does not declare):` — it is the §3.12 sweep (docs/prompt-juez-lo-que-queda.md), not a printout of yours.
**Pass that list on to the user exactly as it is**, with its reasons and its
`[skeleton: headings only]` marks. If, exploring the repository, you see a
candidate the sweep did not bring, you may propose it too, but **saying that it
is yours and not the sweep's**. Write in the file ONLY what the user confirms —
do not fill it in on your own initiative, and if they confirm nothing, leave it
with its placeholder: the diff is measured against ct's yardstick alone, and the
repository's adds nothing. If the scaffolder says that **the sweep could not be
run** (no `node`), say that too: that case is not "there are no conventions
here", it is "nobody has looked". A candidate marked as a skeleton, declared
today, is worse than not declaring it: it gives the judge an empty document that
DOES count as the repository's yardstick, instead of letting the diff be measured
against ct's alone. Propose it all the same, but tell the user that half of it
too. It is not `.agent/conventions-ack.md` (those are acknowledgements of the
loop's protocol collision signals, see further down); this file declares how code
is written in this repository.

Two lines get added to `.gitignore`, both idempotent: `.worktrees/` (slice worktrees live inside the checkout, and without that line a `git add -A` swallows a whole working tree) and `.agent/SLICE.md` (the state of a dispatched session, which is live and local state, never product — see F22 in `commands/ct-next.md`).

The scaffolder also seeds
`docs/superpowers/specs/_TEMPLATE-execution-spec.md`, the execution spec
template — the one the brainstorming skill needs in step 8, and which until now
did not travel with the plugin. It is idempotent: if it already exists, it is not
trodden on (it may carry sections of the repository's own). It is **not** added to
`.gitignore`: it is an artefact of the repository that the skill reads, and it is
committed. The path is not decorative — it is the one `LOOP_ARTIFACT_PATTERNS`
(`scripts/scope.js`) exempts from the scope gate precisely because brainstorming
writes the design doc and the execution spec there. Watch out, when editing it,
for two things `/ct-groom` itself punishes and that reading does not reveal:
writing the literal clarification marker (with its bracket) anywhere in the file,
comments included, brings the groom down with exit 2 (`analyzeSpecFreeze` greps
the whole file); and any HTML comment **inside** `## Contexto del milestone` travels
verbatim into the body of every issue of the milestone (`readEpicContext` does not
discard it).

In `.agent/STATE.md`, by contrast, **confine yourself to describing the
bootstrap**:

- `task`: `"Bootstrap Control Tower loop (ct-init)"`
- `you_are_here`: what the scaffolder created and what was already there.
- `next_action`: **leave it at `"(sin slice asignado)"`**.
- `blocked`: **leave it at `null`**. A bootstrap blocks nothing.
- `verify`: leave it empty. When it does get filled in, it is always the **pending** check that validates the work on finishing — never the assertion of something already checked.

**Do NOT go looking for pending work to fill in `next_action`.** It is a scaffolder, not a planner. The real `next_action` is seeded by `/ct-next` in the worktree's `.agent/SLICE.md` when it dispatches a slice (F22 — it used to be the worktree's `STATE.md`, which is the coordinator's and not the slice's), or written by whoever starts one by hand. If you point here at some pending item you find around the repository, the SessionStart hook will hydrate **every** future session of that repository believing that is what comes next — even when it has nothing to do with what is about to be done.

When that `next_action` **expires** (the work can no longer be done: it was
stopped by a decision, the plan turned out to be false, something from outside is
missing), the way to say so is **not** to rewrite the field with the word
"BLOQUEADO" and the reasons in prose —only somebody who reads it properly
understands that— but the `blocked` field of the frontmatter:

```yaml
blocked: {reason: "por qué no se puede continuar", unblock: "qué haría falta para levantarlo", since: "2026-07-25"}
```

With that set, the SessionStart hook opens **every** new session of that
repository with a prominent warning and declares the `next_action` SUSPENDED,
instead of injecting it as the next thing to do. Lifting it (deleting the field
or going back to `null`) is an explicit human decision: if you come across a
blocked STATE.md, do not lift it on your own initiative. A STATE.md that does not
carry the field is read as **not blocked** (every one older than this is); what
does get announced as "not known" is a frontmatter that cannot be parsed.

**If the scaffolder warns about conventions of the repository's own** (an
`ATTENTION: this repo already had conventions of its own...` block on stderr, with
`[claim]`, `[worktrees]` and/or `[estado]` items), **pass it on to the user
whole, with the evidence and the decision**. Do not resolve it yourself: it means
the repository already came with its own claim protocol, its own worktrees path
or its own state file on the ground the loop is about to occupy, and choosing
which one rules is a decision of theirs. If instead it says that **it could not be
checked** (no `node`), say that too: that case is NOT "there are none", it is
"nobody has looked".

**The warning has a way out, and passing that on is part of passing it on
(F14).** If the user has already taken the decision and is not going to change it
—the commonest one: «the plugin's claim rules, and the repository's script stays
documented for work done by hand outside the loop»—, the way to make that signal
stop warning **without deleting correct documentation** is to write it in
`.agent/conventions-ack.md`, one line per signal:

```
claim: 2026-07-28 — manda el claim del plugin; scripts/dispatch-check.sh se queda para trabajo a mano fuera del loop
```

It silences **that** signal and only that one; the rest keep warning, and on
later runs a one-line note remains saying that it is silenced and since when
(«decided not to look at this» and «there is nothing here» are not the same
thing). All three things are needed —signal, date and reason—; a line that does
not parse is reported and silences **nothing**. Do not write the acknowledgement
yourself: the decision is the user's, you tell them the way out exists.

## What is contract in the texts `/ct-init` seeds

A later round moves the texts below out of `ct-init.sh` and into template
files, and translates their prose to English (CLAUDE.md's rule for new
modules). Some strings inside them are anchors: code outside `ct-init.sh`
locates a section, or asserts a governed repository, by matching them
literally. **Those do not move in a translation.** Same doctrine as CLAUDE.md's
table of ten parsed headings: renaming one of these is a coordinated change of
every reader and every seeded repository at once, not a wording choice.

| Anchor | Read by | Pinned by |
|---|---|---|
| `## Build, test & lint` | `plugin/scripts/baseline.js:88` | `baseline.test.js:19`, `ct-next-baseline.test.js:54`, `baseline-real-process.test.js:16` |
| `## Cómo se atraviesa este repo (e2e)` | `plugin/scripts/gates.js:118`, `plugin/scripts/ct-step.mjs:682`, `plugin/scripts/dispatch-check.mjs:1104` | `e2e-agents-md.test.js:46,64,75` |
| `ninguna declarada todavía` (no backticks in this seed line, on purpose — see `declaredIn` in `repo-yardstick.js`) | the yardstick sweep (`plugin/scripts/detect-yardstick.mjs`, via `declaredIn`) | `yardstick-candidates.test.js:335,348`, `ct-init-conventions-seed.test.js:51` |
| `Rules to obey` | not read by production code — `declaredIn` matches any backtick path in the file regardless of heading. Kept as its own row because a test fixture reproduces it literally | `yardstick-candidates.test.js:351` |
| `## Slices table format (contract with /ct-groom)`, and its two closed-set legacy spellings `## Formato de la tabla §9 (contrato con /ct-groom)` and `## Formato de la tabla de slices (contrato con /ct-groom)` | `ct-init.sh` itself (`SLICES_HEADING`, `SLICES_HEADING_LEGACY`, `SLICES_HEADING_LEGACY_ES`, `plugin/scripts/ct-init.sh:362,380,385`), to tell a partial migration remnant from a fully-migrated `AGENTS.md` | `ct-init.test.js:891,922,934,946,958,1215` |
| the three `<!-- ct-init:... -->` marker pairs (`slices-contract`, `loop`, `e2e-howto`) | `plugin/scripts/repo-yardstick.js`'s `withoutCtInitBlocks`/`looksLikeSkeleton` (all three, to discount them when judging a freshly seeded `AGENTS.md`); `plugin/scripts/governed-repo.js`'s `probeGovernedRepo` (the first two only — `CONTRACT_MARKER` and `LOOP_MARKER`, its `GOVERNED_MARKERS`), consumed by `plugin/hooks/commit-keyword-guard.js` to decide whether the closing-keyword gate applies at all | `f27-closing-keywords.test.js:460-465`, `yardstick-candidates.test.js:206` |

**A correction against an earlier draft of this table:** the marker pairs are
not read by `plugin/scripts/scope.js` — that script does not import
`governed-repo.js` at all. The real second reader is
`plugin/hooks/commit-keyword-guard.js`, which calls `probeGovernedRepo` to
decide whether a commit needs a closing keyword in the first place.

The plan's own sections (`## 7. Tasks`, `## 8. Global verification`,
`**Objective:**`, `**Files:**`, `**TDD:**`, `**Tests:**`, `**Verification:**`)
and the ten headings CLAUDE.md already tracks (`## Contexto del epic` /
`## Contexto del milestone`, `## Contexto heredado`, `## Decisiones
congeladas`, `## Dependencias`, `## Acceptance criteria (EARS, 1:1 con
tests)`, `## Descripción`, `## Hipótesis`, `## Señal de observabilidad`, the
judge's telemetry heading, `## Current State`) are not affected by this table:
they are contract already, tracked there.

## `.claude/settings.json` — why the repository declares the plugin

Until #376 the plugin was only ever enabled on the machine of whoever ran
`/plugin install`, which writes to `~/.claude/settings.json`. Nothing travelled
with the repository, so a fresh clone of a bootstrapped repository got no
commands, no skills, no agents and no hooks — and that was indistinguishable
from a repository nobody had bootstrapped.

`/ct-init` now writes the file into the target repository. The rest of the
plugin is **not** copied in with it, and that is deliberate: a dispatched agent
does not only read files. `ct-next.mjs` resolves absolute paths to
`ct-step.mjs`, `dispatch-check.mjs` and `conventions/` from wherever the plugin
is installed and types them into the agent's terminal, and the kickoff names the
skill `control-tower-loop:writing-plans-prescriptive`, which only resolves when
the plugin is loaded. Copying the skills in would not finish that job; it would
take the whole tree into every governed repository, kept in step by hand.

### The version pin

`enabledPlugins` holds a boolean and pins no release. The pin is the
marketplace's `ref`, and it reaches the plugin's code because the marketplace
entry's `source` is `./plugin`, inside the same checkout. The ref is
`plugin-v<version>`, the tag release-please already creates, so a governed
repository records in a committed file exactly which release it runs.

Its one edge is honest: the tag is created **after** the version bump lands, so
a `/ct-init` run from an unreleased commit writes a ref that does not resolve
and the install fails naming the tag. That beats no ref, which floats every
governed repository onto `main` and records nothing.

### What is created, what is reported, what is never touched

Per leaf key, not per file:

| Key | Absent | Present with another value |
|---|---|---|
| the marketplace entry | created | reported |
| its `source.ref` | **filled in** | reported, with both releases named |
| `enabledPlugins[…]` | created | reported |
| `permissions.allow`, `permissions.deny` | created | additive union, never a removal |
| anything else | — | untouched |

A missing `ref` is an absent leaf key, so it is filled in; a `ref` naming
another release is a decision, so it is reported. That distinction is the
upgrade path: moving a repository is one line, and a person moves it.

### The deny list is a speed bump, not a boundary

`Bash(git:*)` would auto-allow the invocations `CLAUDE.md` forbids, so the
allowance arrives with them denied. Two things to be clear about:

- The `:*` shorthand is only read as "anything after this" at the **end** of a
  pattern. In the middle, the colon is a literal character and the rule matches
  no real command. `Bash(git push *--force*)` is the working shape;
  `Bash(git push:*--force*)` matches nothing.
- Bash rules match the **text** of a command. `git -C . push --force`,
  `/usr/bin/git push --force` and `sh -c '…'` all get past them. The documented
  mechanism for enforcement that holds is a `PreToolUse` hook, which this plugin
  already uses for the commit-keyword guard. The deny rules are worth having,
  and they are not the guard.

### The gate directory is pinned as ESM

`plugin/dist/scope-check.js` is an ESM bundle vendored as `.js`, so the format
node parses it with is decided by the **receiving** repository's nearest
`package.json`. A target declaring `"type": "commonjs"` makes node read it as
CommonJS and it dies on its first `import` — a required check red on every pull
request, correct ones included. `/ct-init` writes `.github/ct/package.json` with
`"type": "module"`: nearer than the repository's own, and the vendored path
stays the one the workflow names. A `package.json` already there saying
something else is reported, never rewritten.
