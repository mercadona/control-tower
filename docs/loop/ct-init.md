# `/ct-init` — reference and design

> Text moved whole from `plugin/commands/ct-init.md` (sub-issue #93). The command keeps the invocation, the table of exit codes, the instructions to the agent as a list, and a link to this document.
>
> **Update (#93):** the text below describes the slices table contract as a section of `AGENTS.md`. From this round on, the contract lives in `docs/superpowers/CONTRATO-SLICES.md` of the governed repository (`/ct-init` writes and versions it, with the same doctrine of version, «pristine» hashes, `--update-slices-contract` and `--force` described here) and `AGENTS.md` keeps a short section —the same `<!-- ct-init:slices-contract -->` markers, which are the governed-repository signal the commit gate reads— that links to the contract. An `AGENTS.md` bootstrapped earlier keeps the whole contract until `--update-slices-contract` is run, which replaces the section with the short one if it was unedited.

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
**This is the moment of human confirmation**: the scaffolder prints, on STDOUT, a deterministic block that begins with the literal `Candidatos a la vara de este repo (barrido determinista — PROPONE, no declara):` — it is the §3.12 sweep (docs/prompt-juez-lo-que-queda.md), not a printout of yours.
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
the whole file); and any HTML comment **inside** `## Contexto del epic` travels
verbatim into the body of every issue of the epic (`readEpicContext` does not
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

Lastly, if the repository is not registered in `control-tower/tower/workspaces.*.yaml`, say so; do not register it yourself.
