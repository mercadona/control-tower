#!/usr/bin/env bash
# ct-init: bootstrap of a repo for the Control Tower loop. Idempotent.
set -euo pipefail
TARGET="${1:?uso: ct-init.sh <dir-repo> [--update-slices-contract] [--force]}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shift || true

# F6, minor 6: until now, any correction of the slices contract stayed inside
# the plugin — `ct-init` detects the section between its markers and does not
# touch it (correct by default: it may carry the user's hand edits), so no
# already bootstrapped repo ever received it except by copying and pasting.
# `--update-slices-contract` is the explicit route:
#   - NEVER by default (a normal run only WARNS that the section is of an
#     earlier version, and how to update it).
#   - Never destructive blindly: it only replaces the section if its content
#     matches, byte for byte, some version this very script has generated
#     (SLICES_PRISTINE_HASHES). What it does not recognise is NOT overwritten:
#     `--force` is needed, and it warns when doing it.
#     F9: "I do not recognise it" is NOT the same as "you have edited it by
#     hand", and the script no longer says it as if it were. A block that is
#     not in the list may be a user edit or a version of the contract whose
#     hash this ct-init does not carry on record, and from here there is no way
#     to tell them apart — so the message offers both readings instead of
#     picking the one that blames the user. And "the hash could not be
#     computed" (a machine with neither `shasum` nor `sha256sum`) is a third
#     state with a message of its own: nothing was compared there.
UPDATE_SLICES_CONTRACT=0
FORCE=0
for opt in "$@"; do
  case "$opt" in
    --update-slices-contract) UPDATE_SLICES_CONTRACT=1 ;;
    --force) FORCE=1 ;;
    *) echo "opción no reconocida: $opt (uso: ct-init.sh <dir-repo> [--update-slices-contract] [--force])" >&2; exit 2 ;;
  esac
done

mkdir -p "$TARGET/.agent"
if [ ! -f "$TARGET/.agent/STATE.md" ]; then
  cp "$HERE/skills/state-template/STATE.template.md" "$TARGET/.agent/STATE.md"
  echo "creado $TARGET/.agent/STATE.md"
elif grep -qE '^[[:space:]]*blocked[[:space:]]*:' "$TARGET/.agent/STATE.md"; then
  echo "STATE.md ya existe, no se pisa"
else
  # F7: a STATE.md from before the `blocked` field still works (the hook reads
  # it as NOT blocked, which is the correct default reading), but whoever has
  # one will never find out that there is now a way to say "this cannot go on"
  # other than writing prose in `next_action` — the very mistake that started
  # all of this. It is said ONCE, here, where the repo is being looked at on
  # purpose. The file is not touched: rewriting the STATE.md of a live repo
  # from a scaffolder would be worse than the problem.
  echo "STATE.md ya existe, no se pisa — pero no declara el campo \`blocked\`, así que se lee como NO bloqueado. Si el trabajo de este repo se queda alguna vez bloqueado, añádelo a mano al frontmatter en vez de explicarlo dentro de \`next_action\`: blocked: {reason: \"por qué no se puede continuar\", unblock: \"qué haría falta\"} — el hook de SessionStart lo anuncia y suspende el next_action en toda sesión nueva."
fi

# .agent/conventions.md (§3.3, docs/prompt-juez-lo-que-queda.md): the
# conventions are a property of the REPO, not of the epic — before, they were
# re-derived in the §3 of every slice plan, and nothing guaranteed that slice 14
# cited the same paths as slice 3. It is seeded here, once and only once per
# repo, with the same idiom as STATE.md above: create it if it does not exist,
# do not overwrite it if it does. The human confirmation is the moment somebody
# runs `/ct-init` —no fourth gate is added to the product's three— and `ct-step`
# reads it straight from this file in every task brief, with no agent in
# between.
CONVENTIONS_MD="$TARGET/.agent/conventions.md"
if [ ! -f "$CONVENTIONS_MD" ]; then
  cat > "$CONVENTIONS_MD" <<'EOF'
# La vara de este repo — los documentos de reglas del código

<!-- Lo lee ct-step DIRECTO y lo pega en el brief de cada tarea: el
     implementador escribe con esto delante y el juez bloquea citándolo.
     Es una propiedad del REPO, no de ningún epic: se declara UNA vez aquí,
     no en el §3 de cada plan de slice.
     OJO: no es .agent/conventions-ack.md (acuses de señales de colisión de
     protocolo del loop) — este fichero declara CÓMO se escribe código aquí. -->

Rules to obey (una ruta por línea, entre backticks; tiene que poder leerse):

- (ninguna declarada todavía — sustituye esta línea al declarar la primera)

Skills (nombre de skill, no ruta):

- (ninguna)
EOF
  echo "creado $CONVENTIONS_MD"
else
  echo "conventions.md ya existe, no se pisa"
fi

# The execution spec's template. The flow after this bootstrap is
# brainstorming -> design doc -> execution spec, and skills/brainstorming/SKILL.md
# orders the spec to be written «from the repo's `_TEMPLATE-execution-spec.md`»:
# without this, that step is left with no source and the spec has to be written
# guessing at its sections.
#
# The destination is `docs/superpowers/specs/` because it is the folder the
# plugin ALREADY declares as the spec's home in code that runs —
# LOOP_ARTIFACT_PATTERNS (scripts/scope.js) exempts `docs/superpowers/specs/**`
# precisely because «the brainstorming skill writes the design doc and the
# execution spec here». It is also the path docs/loop/README.md documents.
#
# It is NOT added to the .gitignore, unlike .agent/SLICE.md: the template is an
# artefact of the repo that the skill reads, and it gets committed.
SPEC_TEMPLATE_DIR="$TARGET/docs/superpowers/specs"
SPEC_TEMPLATE="$SPEC_TEMPLATE_DIR/_TEMPLATE-execution-spec.md"
if [ ! -f "$SPEC_TEMPLATE" ]; then
  mkdir -p "$SPEC_TEMPLATE_DIR"
  cp "$HERE/templates/_TEMPLATE-execution-spec.md" "$SPEC_TEMPLATE"
  echo "creado $SPEC_TEMPLATE"
else
  # Same doctrine as STATE.md and as the contract section in AGENTS.md: a
  # template that is already present may carry the repo's edits (sections of its
  # own, invariants of its own) and a scaffolder does not overwrite them on its
  # own initiative.
  echo "_TEMPLATE-execution-spec.md ya existe, no se pisa"
fi

GITIGNORE="$TARGET/.gitignore"
touch "$GITIGNORE"
# It normalises a trailing newline BEFORE touching anything else: if the file
# already has content but does not end in `\n` (e.g.
# `printf 'node_modules/' > .gitignore`, with no trailing newline), a bash `>>`
# concatenates the new line onto the SAME line as the last one — it corrupts the
# user's previous rule (`node_modules/` stops being ignored, in THEIR repo, not
# in ours!) and, on top of that, `.worktrees/` does not really end up ignored
# either, which is precisely what the line below comes to guarantee. `tail -c1 |
# wc -l` is the robust idiom for detecting "it ends in \n": looking directly at
# `$(tail -c1 ...)` does not work, because command substitution always trims
# trailing newlines, so a file that DOES end in \n would be indistinguishable
# from an empty one.
if [ -s "$GITIGNORE" ] && [ "$(tail -c1 "$GITIGNORE" | wc -l)" -eq 0 ]; then
  echo >> "$GITIGNORE"
fi
# .worktrees/: ct-next.mjs writes every slice worktree into
# <repoRoot>/.worktrees/<n>, inside the checkout itself. If the target repo does
# not ignore it, a `git add -A` in the main checkout swallows a whole nested
# working tree, and a `git clean -fdx` destroys live worktrees. Idempotent: it
# only adds the line if it is not there already (an exact whole-line grep), just
# as the rest of this script does not overwrite what already exists.
if ! grep -qxF '.worktrees/' "$GITIGNORE"; then
  echo '.worktrees/' >> "$GITIGNORE"
  echo "añadido .worktrees/ a $GITIGNORE"
else
  echo ".worktrees/ ya está en $GITIGNORE, no se duplica"
fi

# .agent/SLICE.md (F22): /ct-next seeds the slice's state there, inside the
# worktree. That file is LIVE, LOCAL state of a dispatched session, never a
# product: if git sees it, an agent's `git add -A` puts it into their PR and the
# squash leaves main with a slice's state —and any new session of the repo
# hydrates believing it IS that agent—. It happened three times over a period of
# 9 slices before this line existed.
#
# /ct-next also writes the same rule into .git/info/exclude on every dispatch,
# to cover the repos that do not re-run ct-init. This is the long route: it gets
# committed, whoever clones sees it, and it explains why it is there.
#
# Idempotent by exact line, just like the .worktrees/ block above.
if ! grep -qxF '.agent/SLICE.md' "$GITIGNORE"; then
  echo '.agent/SLICE.md' >> "$GITIGNORE"
  echo "añadido .agent/SLICE.md a $GITIGNORE"
else
  echo ".agent/SLICE.md ya está en $GITIGNORE, no se duplica"
fi

# D-4 — ct-step's run state, and its working folder (briefs, logs of the
# checks, review packages). Same reason as the line above and one more: these
# files are the INTERNAL loop of a slice inside its worktree and they live less
# long than the worktree does. What lives on GitHub is the SLICE's status, and
# throughout the whole run the issue does not change status.
#
# The folder also carries each task's diffs, which are the same content as the
# commit: seeing them show up as new files in the PR is pure noise.
for regla in '.agent/run-*.json' '.agent/run-*/'; do
  if ! grep -qxF "$regla" "$GITIGNORE"; then
    echo "$regla" >> "$GITIGNORE"
    echo "añadido $regla a $GITIGNORE"
  else
    echo "$regla ya está en $GITIGNORE, no se duplica"
  fi
done

AGENTS_MD="$TARGET/AGENTS.md"
if [ ! -f "$AGENTS_MD" ]; then
  cat > "$AGENTS_MD" <<'EOF'
# AGENTS.md
<!-- Guía durable del repo (≤150 líneas). Procedimientos → Skills. -->
## Project overview
## Setup commands
## Build, test & lint
## Code style & conventions
## Project layout
## Workflow: 1 issue = 1 slice = 1 session
## Commit & PR rules
## Security & data handling
## Do NOT touch
## Gotchas
## Skills (load on demand)
EOF
  echo "creado $AGENTS_MD"
else
  echo "AGENTS.md ya existe, no se pisa"
fi

# The "Formato de la tabla de slices" section (F2 — the contract with
# /ct-groom): until now that contract (which columns it requires, which "no
# value" markers it accepts, what each one generates) lived only in
# commands/ct-groom.md — a file read by whoever RUNS groom, never by whoever
# WRITES the spec, almost always in another session and another repo. It is
# seeded here, in the target repo's AGENTS.md, which whoever drafts specs does
# read.
#
# The SAME block for both cases (a file just created above, or one that already
# existed without the section) — a single `if`, without duplicating the template
# in two places that could diverge over time. Detection: a greppable HTML
# comment (`<!-- ct-init:slices-contract -->`), the same idiom as
# `<!-- ct-order:N -->` in groom.js — it does not render, it does not collide
# with the user's headings. `grep -qxF` (whole line, not a substring) instead of
# `grep -qF`: it reduces (though it does not eliminate altogether — a code fence
# with the line pasted in verbatim would still give a false positive, a far-
# fetched case that does not deserve more effort) the risk that the marker
# quoted inside somebody else's code block (indented, or part of a longer line)
# counts as "it is already there".
#
# F2 review, point 2: checking ONLY the opening marker is not enough — if
# somebody deletes the opening one but leaves the heading/body/closing one (or
# the other way round), the `grep -qF` of the missing one finds nothing, the
# script believes the section is not there, and ADDS A WHOLE SECOND COPY in
# silence: two headings, an orphan marker, exit 0. The THREE traces (opening,
# closing, heading) are checked separately:
#   - opening AND closing present → a complete section, it is not touched (the
#     normal case).
#   - ANY partial trace (one or two of the three, but not all three) → it is not
#     safe to decide for the user what happened here; a warning goes to stderr
#     and nothing is added — better an AGENTS.md the user understands and has to
#     fix by hand than a section duplicated in silence.
#   - no trace at all → the complete section is added (the "it does not exist
#     yet" case).
SLICES_MARKER_OPEN='<!-- ct-init:slices-contract -->'
SLICES_MARKER_CLOSE='<!-- /ct-init:slices-contract -->'
SLICES_HEADING='## Formato de la tabla de slices (contrato con /ct-groom)'
# F30 — the OLD heading is still recognised, and it is never emitted.
#
# Up to v15 the section was called «tabla de slices». The number was a fossil: it
# never located anything (`/ct-groom` finds the table by its `Slice`+`Dep`
# columns,
# and the `--section N` flag is obsolete and ignored), and it dragged along the
# false idea that the table is the ninth item of a big document.
#
# Changing the heading and nothing else would have an edge to it: the detection
# of a COMPLETE section only looks at the two markers, so nothing happens there
# — but the "partial remains" branch does look at the heading, and an AGENTS.md
# with the old heading and no markers would stop being recognised and would
# receive a WHOLE SECOND copy of the section. It is exactly the failure the F2
# review documented and closed. Same remedy as the one SLICES_PRISTINE_HASHES
# already uses (an entry is added, never replaced) and as the two literal forms
# of `## Acceptance criteria` in reconcile.js: a CLOSED set of recognised
# headings, only one of them emitted.
SLICES_HEADING_LEGACY='## Formato de la tabla §9 (contrato con /ct-groom)'
# SLICES_CONTRACT_VERSION (F6): the version of the block's CONTENT. It travels
# on a line of its own right behind the opening marker, not inside it: the
# opening marker is kept identical to the one it has always been so that a repo
# bootstrapped before F6 (with no version line, "v1") goes on being recognised
# by the same old `grep -qxF`, with no migration at all.
# F10 raises it from 3 to 4. The number does NOT measure the size of the change:
# it measures "is the text this repo has the one this plugin ships?", and it is
# the ONLY lever that makes a corrected contract reach an already bootstrapped
# repo. Checked by running it before deciding: with a repo seeded by F11's v3
# (an intact block, a registered hash), leaving the number at 3 makes BOTH the
# normal run AND `--update-slices-contract` answer "contrato v3, al día" —
# `found_version -eq SLICES_CONTRACT_VERSION` and `block_status=pristine`, so it
# does not even enter the "the content is not mine" branch. There is NO path at
# all by which that repo receives the new text: it stays for ever saying that
# `--section` feeds the link's anchor (a flag that is now ignored) and without
# the line about "push the spec before grooming", which is what decides whether
# its issues are born with a link or without one. With 4, that same repo gets
# the out-of-date warning and `--update-slices-contract` replaces it cleanly,
# with no `--force` and without accusing anybody — which is exactly the
# mechanism F9 built.
#
# F18 raises it from 7 to 8. What changes is not the wording: the v7 TOOK AS
# IMPOSSIBLE something that happens on its own, and KEPT QUIET about two states
# in which the loop gets stuck without saying anything. A repo bootstrapped with
# the v7 cannot deduce any of them:
#   - the v7 said that closing an issue as *completed* without having merged
#     anything "no se detecta — haría falta cruzar el grafo de PRs" and that it
#     was "un caso que requiere una acción errónea deliberada". Both halves were
#     false and both are measured, not assumed: GitHub applies the closing
#     keywords of ANY commit message that reaches the default branch (a
#     DOCUMENTATION commit that only MENTIONED `Closes #451`, in quotes, closed
#     that issue in a production repo), and a single GraphQL query with aliases
#     resolves 97 issues in 2.8 s. A repo with the v7 goes on believing that ill
#     intent is required, which is precisely what stops anyone from suspecting
#     the accident when it happens;
#   - the v7 said nowhere that a CLOSED issue that keeps its `status:` label
#     disappears from the dispatcher (which only sweeps open ones). The measured
#     rate is 10 out of 99 closed. Without this, the natural reaction to "my
#     slice no longer comes up" is to look for the failure in the dispatcher;
#   - nor that an agent that declares itself BLOCKED leaves its claim in place
#     for ever, with no transition of the loop that releases it. It is a
#     deadlock with a name of its own and the v7 left it unnamed;
#   - and a fourth one, found by applying to the rest of the text the same lens
#     that falsified the first: the v7 said that the cause "al PR le faltaba el
#     `Closes #N`" "solo aparece con PRs abiertos a mano, o si alguien edita el
#     cuerpo después", because the kickoff asks for it. The kickoff is a PROMPT,
#     not a gate — the v7 itself admits it two paragraphs further down ("lo que
#     el kickoff no puede garantizar es que el agente obedezca"). The most
#     likely cause was missing from the list, and it was precisely the one an
#     honest diagnosis has to look at first.
#
# F17 raises it from 6 to 7. The two things that change are new facts about the
# CLOSING of the issue, and a repo bootstrapped with the v6 cannot deduce either:
#   - the kickoff now requires `Closes #N` in the body of the PR (before it
#     asked for nothing, and that is why the state "PR merged, issue open" was
#     the NORMAL outcome of a well-done slice: tokens held for ever and not a
#     single dependent unblocked). The enumeration of "what the dispatched agent
#     receives" kept quiet about it, so it described a kickoff that no longer
#     exists;
#   - the v6 attributed that state to ONE single cause ("al PR le faltaba
#     `Closes #N`"). There is a second one, verified against a real repo: a PR
#     that DOES carry its `Closes #N` but is merged into a branch that is not
#     the default one does not close the issue either. That is the one that
#     deceives — you look at the PR, you see the `Closes`, and you discard the
#     good diagnosis. With `--base <another-branch>`, closing the issue on
#     merging is ALWAYS a manual step.
#
# F15 raises it from 5 to 6, and for the same reason as F13: the v5 text
# DESCRIBES BADLY two things a bootstrapped repo cannot correct on its own.
#   - it said that `--reopen` leaves the slice in `status:ready` ("it becomes
#     dispatchable again"). Not any more: it leaves it in `status:in-progress`,
#     because `ready` does not hold tokens and that work is still unmerged. A
#     repo with the v5 would go on waiting for /ct-next to dispatch it by
#     itself, and believing on top of that that its area had been freed;
#   - it said NOTHING about the order in which /ct-groom validates and mutates.
#     Two independent readings of the v5 deduced —correctly, back then— that an
#     abort could leave milestone and labels half done. That is NO longer true
#     (the order was fixed), but the silence made the correct deduction be the
#     frightening one, and now the guarantee exists and it has to be said.
#
# F13 raised it from 4 to 5, and the bump was MANDATORY there more than in any
# earlier round: what changes is not the wording, it is that the v4 text
# PROMISED guarantees the code does not give. It said that
# migration/ci/pbxproj serialise "across the whole repo" (the code only looks at
# issues of this repo with status: in-progress/in-review — everything that goes
# outside the issue flow is invisible), that "merge-after means MERGED" (the
# code looks at how the issue was closed, which is not the same thing in either
# direction), and it said nothing at all about a rejected PR leaving its slice
# outside the loop for ever. A repo bootstrapped with the v4 is stuck with those
# three things until this number goes up; it is the only lever that exists for
# reaching it.
#
# F22 raises it from 10 to 11 for the SAME reason as F13, and with the same
# aggravating factor: the v10 did not describe the flow badly, it described
# badly WHERE the agent writes. It said that the slice's state lives in its
# worktree's `.agent/STATE.md` and that `/ct-next` reads it from there. Both
# halves are false as of F22: the seed goes to `.agent/SLICE.md` (ignored) and
# the dispatcher REFUSES to read the worktree's STATE.md, because that one is
# the coordinator's, frozen at the base. And this is not an obsolete comment: it
# is an INSTRUCTION to an agent. A slice that follows its repo's AGENTS.md
# instead of its kickoff would write its `blocked:` into the file nobody reads
# —the claim stays hanging for ever, which is precisely the F18 failure this
# loop already fixed once— and, if it goes as far as committing it, the
# `--release` gate rejects it with exit 5. A repo bootstrapped with the v10 is
# stuck with that false instruction until this number goes up.
#
# F23 raises it from 11 to 12 for the SAME reason as F13 and F22: the v11 did
# not describe the flow badly, it PROMISED a comparison the code can no longer
# make. It said that re-grooming compares "title, link to the spec, milestone,
# labels…" against today's table. Ever since the matching by `ct-order` is
# bounded to the run's milestone, a matched issue always has that milestone by
# construction: a milestone divergence is unreachable from /ct-groom. Whoever
# read the v11 deduced "if I move an issue to another milestone and run again,
# it reports it to me", and what they get today is either an exit 1 from one of
# the two gates, or a new issue (a duplicated epic, if the link to the spec does
# not match either). A repo bootstrapped with the v11 is stuck with that false
# promise until this number goes up.
#
# F27 raises it from 12 to 13, and by the same criterion as ever: the v12 does
# not describe the flow badly, it KEEPS QUIET about two things that now exist.
# (a) It does not say that the pre-merge checks have to be gates — the most
# useful rule of the field period, which came out of a merge that went in with
# the check printing `1`. (b) It says «watch out for writing those keywords in
# any commit» as if nothing protected you, when the plugin already blocks the
# majority case, and it does not say which are the four that escape it. A repo
# with the v12 cannot deduce either of the two, and the second is worse than
# silence: it reads «watch out yourself» where there already is a gate, and it
# does not know where there is NOT one.
#
# F27 raises it from 13 to 14 by the same criterion, over its own text: the v13
# PROMISED a coverage the code does not give, and KEPT QUIET about two real
# blind spots. It said that the plugin blocks the commit «in a repo that has
# this section in its AGENTS.md», as if the repo were enough. False: the gate is
# brought by Claude's SESSION (the hook is installed by the loaded plugin, not
# by the repo), and a dispatched agent starts up with an account of its own
# (`CLAUDE_CONFIG_DIR`) — if that account does not have the plugin installed,
# there is no gate, even though the repo carries the whole section. A repo with
# the v13 reads «this section is enough» and has no way of suspecting that the
# coverage depends on where the agent started up. And the v13 enumerated four
# blind spots —with no `-m`, `-F`, `--amend --no-edit`, outside Claude— but not
# the other two, measured with the same parser: a commit that **points at
# another repo** (`git -C <path> commit`, `cd <path> && git commit`, which the
# gate checks against the SESSION's repo and not against `<path>`) and a
# **wrapped** invocation (`sudo git commit`, `env FOO=1 git commit`, `command
# git commit`, where `git` stops being the first token and the parser does not
# recognise the commit). A repo with the v13 is left believing that those two
# cases ARE covered, until this number goes up.
#
# The contract goes from 18 to 20 in a single move, because TWO different
# columns landed in parallel and both of them claimed the v19: the `Señal`
# (the juez-lo-que-queda branch, already in main) and the `E2E` (the
# e2e-al-cierre-del-slice branch). The v19 ended up published with the `Señal`
# block; this block brings both, so it needs a number of its own. Both reasons
# still hold and are kept whole — they document different defects:
#
# Slice 10 (juez-lo-que-queda), the v19: the v18 cannot deduce that the `Señal`
# column exists (the observability signal the slice promises, and which the
# slice judge measures against the accumulated diff with its `observabilidad`
# item), nor that an exemption is written `N/A — <razón>` (and that with no
# reason the groom aborts), nor that a cell with no value is measured as
# `sin-vara` in the epic's telemetry. A repo with the v18 would declare signals
# in the spec's prose —invisible to the agent and to the judge— or would never
# declare them at all, without knowing that the sin-vara count is measuring it.
#
# Task 5 of "e2e al cierre del slice", the v20: the `e2e` gate (gates.js#GATES)
# and the `E2E` column that derives it (gates.js#resolveE2e, slices.js#iE2e) had
# been in the code since earlier rounds of that same feature, but neither the
# v18 nor the v19 named them: a repo bootstrapped with either of the two could
# not deduce that there is an optional `E2E` column, that if the table brings it
# EVERY row has to decide (a dash is not enough — it means "not declared", and
# with the column present that aborts), that the token for "nothing to traverse"
# is `no`, nor that the `e2e` gate is not written by hand in `Gate`: it is
# DERIVED from `E2E` bringing some journey. The v20 says all four things. The
# same task also seeds, outside this block, the `## Cómo se atraviesa este repo
# (e2e)` section of AGENTS.md: the kickoff of the `e2e` gate (gates.js) sends
# the agent to that exact section in order to know HOW this repo is brought up,
# and without it there is none.
#
# The contract goes from 20 to 21 because of a clarification of the text, not
# because of a new piece of functionality: the `E2E` bullet now names the TWO
# tokens that count as "not applicable" (`no` and `n/a`, the ones
# E2E_NONE_TOKENS accepts), where before it named only one. An earlier pass
# applied that change inside the seeded block but registered a SECOND v20 hash
# instead of raising the number, reasoning that a clarification of the text is
# not a change of contract. That reason is contradicted by the doctrine of this
# very comment further up: the number does not measure the size of the change,
# it measures whether the text the repo has is the one the plugin ships, and it
# is the ONLY lever that makes a corrected contract reach an already
# bootstrapped repo. With the number stuck at 20, a repo seeded with the first
# v20 block has `found_version -eq SLICES_CONTRACT_VERSION` and
# `block_status=pristine`: the normal run prints "contrato v20, al día" and not
# even `--update-slices-contract` enters the "the content is not mine" branch.
# There is no path at all by which that repo receives the clarification of the
# second token.
#
# The contract goes from 21 to 22 because of the SECOND race of this ledger, a
# carbon copy of the one between the two v19s: Slice 4 of "apuntes de Capde"
# (PR #36) raised its own v20 —the `Señal` v19 plus the paragraph "la señal no
# es un criterio de aceptación más"— while main, in parallel, was publishing
# ANOTHER v20 (the merge of `Señal`+`E2E`) and then the v21. That v20 of the
# branch was never published in main, but its commit is reachable in the merge's
# history and its ref was installable, so its hash stays in the ledger (the same
# doctrine as the second v19); its paragraph is re-seated on top of the v21
# block with a number of its own. The underlying reason does not change: the v21
# describes the `Señal` column but does not say when it is worth anything. A
# repo with the v21 can declare as its signal a paraphrase of an acceptance
# criterion —the failure mode observed in a real run— and then the slice judge's
# `observabilidad` item measures what `estado-final` already measured: the
# column gets filled in, the judge scores it, and nobody learns anything about
# what is going to happen in production. The v22 says it: the signal is not one
# more acceptance criterion.
#
# The contract goes from 22 to 23 because of two things a repo with the v22
# cannot deduce, and by the same criterion as ever: the number does not measure
# the size of the change, it measures whether the text the repo has is the one
# the plugin ships.
#   - the v22 says that it is itself «this section» of `AGENTS.md`. It is not
#     any more: since #93 the contract lives in
#     `docs/superpowers/CONTRATO-SLICES.md` and what is left in `AGENTS.md` is a
#     short section that links to it. A repo with the v22 sends whoever writes a
#     spec to the wrong file, and its footnote describes an update that no
#     longer happens where it says;
#   - the v22 refers three times to `commands/ct-groom.md` and
#     `commands/ct-next.md` «in the plugin» for the detail. Those two files were
#     left with the invocation and their table of exit codes: the long reference
#     is in `docs/loop/ct-groom.md` and `docs/loop/ct-next.md` of the plugin's
#     repo. The v22's three citations point today at a file that no longer
#     contains what it promises, which is the worst form of a reference: it
#     looks alive.
SLICES_CONTRACT_VERSION=23
SLICES_VERSION_LINE_RE='<!-- ct-init:slices-contract-version: [0-9]\{1,\} -->'
# SLICES_PRISTINE_HASHES: the sha256 of the COMPLETE block (opening marker to
# closing marker, both included) exactly as each version of this script emitted
# it. It is what makes it possible to tell "untouched but out of date" apart
# from "edited by hand" without keeping the whole historical text: if the block
# in the AGENTS.md matches one of these, nobody has touched it and it can be
# replaced without losing anything.
#
# F9: until now there were TWO hashes here — the current block's and the last
# previous variant's. But the block's content changed NINE different times while
# nominally being "v1" (the version line did not exist until F6), so eight of
# those nine variants were unrecognisable: a repo bootstrapped with plugin
# 0.5.1, with the block intact byte for byte, received a "you have edited it by
# hand" and `--update-slices-contract` refused to update it. ALL of them are
# registered.
#
# The criterion (F9): one hash for every DIFFERENT block any commit reachable
# from `main` has emitted, not only the ones that coincide with a version bump
# of the plugin. Two reasons, both checked in this repo:
#   - the repo has no tags: a Claude Code plugin is installed by cloning a git
#     ref, so any commit of main could have been the HEAD somebody installed —
#     "only the published versions" describes nothing real here;
#   - and it would not be enough anyway: FIVE different blocks coexisted under
#     the same `plugin.json` 0.6.0, and two commits (9c6c8cf and d4a5ca8) emit
#     the SAME block under different versions. The correspondence
#     published-version ↔ block content does not exist.
# The list is derived from the history (see the test "every block ct-init ever
# emitted in the history is registered"), not from memory.
#
# A block can really exist and NOT be in main's history, because its PR landed
# as a squash — the case of the v17, told on its own line further down. Blocks
# in that situation live byte for byte as a fixture in __tests__/fixtures/ and
# are declared in SQUASHED_BLOCK_FIXTURES (__tests__/ct-init.test.js), which is
# what the self-watch tests join to git's history. And telling it here is not
# enough: a comment is believed, not checked. What holds that entry up are THREE
# tests over the fixture —that it hashes to the registered hash, that there are
# no fixtures outside the list, and that the hash went into this file in a
# commit that did not yet bring the fixture (its provenance, that is, that
# whoever added the file did not invent it).
#
# Format: one hash per line, followed by the provenance (only the first field is
# compared). When the block changes, the new hash has to be ADDED — never to
# replace an old one: without it, the repos seeded with that variant become
# unrecognisable again. The two self-watch tests at the end of
# __tests__/ct-init.test.js fail if either of the two things is forgotten.
SLICES_PRISTINE_HASHES='
fcbc6afa3d90780dd05f9b3c62d8512ad8a0dda98bd2b6087a293088fcdb87b4  v1, 47 líneas — 9c6c8cf/d4a5ca8 (plugin 0.3.0–0.4.0)
7170dd1d5fedbe5482dd74ebe4ed8fdf989e7fd44eed65e7ffdb6614e7b2662a  v1, 57 líneas — 2faa2a8 (plugin 0.5.0)
53bd74b26ee8b331ad7d3e224dd81f0b7e51931ac751f5bfe019d19fe45e815c  v1, 60 líneas — 3475033 (plugin 0.5.1)
8c02c9e458589f1acabd48697d6a207e7308a9af80a5dfa3c7f944504f3e6a57  v1, 68 líneas — 896de17 (plugin 0.6.0)
f6da7d5dcc4ae0c2a0c71990ac9a71fe8092af0b71440c2ea946f1514377216f  v1, 70 líneas — 1ae5eee (plugin 0.6.0)
9628a6dc082694506dfb0911d5309308e82078b2bb62a28671ebef344a562932  v1, 73 líneas — 7ef5f4f (plugin 0.6.0)
c90554b809bc6af4f50613e75f160b0b0859ffce3412aeb44d10bef2d9da3e0a  v1, 77 líneas — 2b633ed (plugin 0.6.0)
7de20667a7c30a869cfcc1e56577de90e3214c4356c48ded040bf4dc0977159e  v1, 87 líneas — b968286 (plugin 0.6.0–0.8.0)
5d90ba2f8203469cc1aad5a189b2c25003d5223d13f920e4bbbe9e2320c3e9cb  v2, 134 líneas — 40adf2c (plugin 0.9.0–0.10.0)
8aaa19edfc9b57419972c509f4b558c6084d2a691592561a2b3d180ae59cfcc8  v3, 213 líneas — F11 (sección "Qué hace /ct-next con esto")
02247741819714164c8f45fbc42dcf26d11c7df58df6b81fae040b038fcf93c4  v4, 221 líneas — F10 (--section obsoleto, enlace al spec verificado)
cd59702d2c5d3a73b67ad235908b83bdc42c9da41996b14a33fba0749e359961  v5, 289 líneas — F13 (in-review retiene tokens, --reopen, alcance real de la serialización)
8de58db92770e9b8737280e024f0a7dae199b4a0dca2b7a535e631637c824fea  v6, 364 líneas — F15 (--reopen va a in-progress, --requeue, garantías de orden de /ct-groom)
8730d7be044a7ba8009d263947c57c56eb6558639cc506d22c460fcc6f9bacb9  v7, 385 líneas — F17 (el kickoff pide Closes #N; las DOS causas de "PR mergeado, issue abierto")
cef9a97a07edc8c403a37ffc846df74422c4d7d1d5aad02d90001a477b2ef811  v8, 419 líneas — F18 (el cierre accidental por commit; el residuo de labels sobre cerrados; el claim bloqueado; la causa que el kickoff no garantiza)
0050a5b1a216063a58beabb1237d08b0753f5390a3c82edcf8ae5c3526491485  v9, 427 líneas — F20 (las DOS sesiones por repo y su campo `role`: coordinadora vs. despachada)
ca63463cecb38df02011c5d079fd278488aa560bfb4ab5d0c7e95531d51e82e9  v10, 482 líneas — F21 (la columna Gate: el gate humano deja de ser un efecto colateral del Tipo)
6b799d34aa589c52cded8801aed641807e3d6591ae372fdd9973d6ebbb1d4d3d  v11, 493 líneas — F22 (el estado del slice vive en .agent/SLICE.md, ignorado; el STATE.md del worktree es el de la coordinadora y no se lee)
f1e9f868952d34a80bc7d15b50c0fce99cf375ebd3b1a76a37c6fdfa7b83e035  v12, 505 líneas — F23 (el milestone ya no puede divergir: el emparejado por ct-order está acotado al epic de la corrida)
8ffbc5d943295835c0cf0dbfd20941b280b99b997124b0337d88da6bf267a086  v13, 521 líneas — F27 (las comprobaciones previas al merge son puertas; la puerta de closing keywords y sus límites)
3896ed5610c6967510d6ad0ef83a18ef5eb6244a2015fd9af3b813bc8ba177b0  v14, 534 líneas — F27 (la puerta es propiedad de la sesión con el plugin cargado, no sólo del repo; con -C/cd a otro repo juzga el repo equivocado, no es ciega, y sus invocaciones envueltas sí lo son)
82a0391f7bffdd86a9b6506fa8db5c8866003129e2065b28a5e3bbe228a1a400  v15, 540 líneas — F28 (la puerta cubre lo que ejecuta Claude por su tool Bash, nunca lo que teclea el humano: ni su terminal ni el prefijo ! de la propia sesión)
bb8e3298fe9b587b929ab58fbf96f76909463a1cea292fa110878d4ba293f38e  v16, 540 líneas — F30 (la sección deja de llamarse "tabla §9" y pasa a "tabla de slices": el número era un fósil, groom localiza la tabla por sus columnas Slice+Dep y --section está obsoleto)
4d6eebf4ea94b7197879d30293dc4719d82399b7feeb7711829c28a1dcaa7f1c  v17, 543 líneas — F-jjponz-1 (el gate `plan` entra en el vocabulario: revisión humana del plan del slice antes de implementar, siempre opt-in). NO ALCANZABLE DESDE main: la PR #27 se mergeó con squash (529d2f4, v16 -> v18 de un salto) y se llevó el commit que emitía este bloque (ac48fa3, rama jjponz/prescriptive-plans). Se pusheó, así que hay repos bootstrapeados con él; se guarda byte a byte en __tests__/fixtures/slices-contract-v17.md, que es lo que justifica este hash ante el guardián
9a45d3acdc0d5a776affb390ba890b90b86d77e2a5712626a839a93d7462bfba  v18, 544 líneas — F-jjponz-2 (el gate `plan` pasa a estar implicado por defecto en TODO slice; renuncia por fila con `!plan`)
9cdc355576fd1e7bbf69771a8c597c236f33ba31e37c32d998d3282a76e20f77  v19, 562 líneas — Slice 10 juez-lo-que-queda (la columna Señal: la señal de observabilidad por slice, con exención razonada N/A — <razón>)
388f8a82528e7402e45a3384094c7ab43b18d6fdfb5652affa4e9b6b6c2b2dc4  v19, 567 líneas — tarea 5 de "e2e al cierre del slice" (la columna E2E y el gate `e2e` entran en el contrato; v19 nunca publicado, la rama se mergeó como v20)
b0eb79ab8fd89f83ce7159e9c2a9c32812ee35b76ad6f4c78c2829c9d9891c0b  v20, 585 líneas — merge de las dos ramas anteriores (las columnas Señal y E2E conviven en el mismo bloque)
530e94eca9e7a0ab676f64a82a97f895ca5c9549478dc9f222f5fcffe8586878  v20, 586 líneas — review del merge (el bullet E2E nombra los DOS tokens de "no aplica": `no` y `n/a`, los que acepta E2E_NONE_TOKENS). Mismo v20: es una aclaración del texto, no un cambio de contrato
86a73c49d2b8ed904f5aaddb86b71536b160a17dfa281b2886729ea82fba9221  v21, 586 líneas — la aclaración de los DOS tokens de "no aplica" sube de número: el v20 la dejó sin bump y ningún repo bootstrapeado con el v20 anterior podía recibirla
40440bc510e0832695cbd73bc5912cb5bba8c16d89cb0cde0249b64b043dbafe  v20, 575 líneas — Slice 4 apuntes de Capde (la señal no es un criterio de aceptación más: promete lo que se verá en producción, que los criterios funcionales no cubren; v20 nunca publicado, main ya tenía otro v20 y la rama se re-sentó como v22)
65e788421d42aaf40a33d9dadcd563762503637dd2ff5ab2d352abc2263e96f6  v22, 599 líneas — merge con main tras la segunda carrera de números (el bloque v21 de main + el párrafo del Slice 4: la señal no es un criterio de aceptación más)
6b7ec30ff95a331542932b199b3b5d2f171e197c61efee0fce0c36fd5def2b6c  v23, 600 líneas — #93 (el contrato deja de ser una sección de AGENTS.md y pasa a docs/superpowers/CONTRATO-SLICES.md; sus tres referencias al detalle apuntan a docs/loop/, no a commands/)
'

# emit_slices_contract: the block, in a single place (both the "it does not
# exist, it gets added" path and the "--update-slices-contract" one use it).
emit_slices_contract() {
  cat <<'EOF'
<!-- ct-init:slices-contract -->
<!-- ct-init:slices-contract-version: 23 -->
## Formato de la tabla de slices (contrato con /ct-groom)
`/ct-groom` lee esta tabla del spec del epic y crea un issue de GitHub por
fila — es la única parte de un spec que un programa parsea. Cabecera exacta,
copiable tal cual:

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|

> **Lo que escribas fuera de la tabla de slices no llega al agente.** El agente que
> implementa un slice no recibe el spec: recibe un prompt de arranque y el
> CUERPO DEL ISSUE, y el cuerpo del issue se construye con estas columnas y
> nada más. Una exigencia escrita en otra sección del spec ("§10", "REGLA
> #-2", un párrafo de introducción) es invisible para él por muy contundente
> que esté redactada. Si algo tiene que cumplirlo el agente, tiene que caber
> en una de estas columnas — y si no cabe en ninguna, no cuentes con que se
> cumpla.

- **`#`** *(obligatoria)*: entero puro (`1`, `2`…) → orden del slice y target
  de `Dep`. Nunca `S1` ni `**1**` (negrita/prefijo): la fila entera se
  descarta.
- **Slice** *(obligatoria)*: nombre corto de la fila — alimenta el TÍTULO del
  issue (`#N <Slice>`). Vacía, con marcador de "sin valor", o que solo trae
  una referencia `#N` sin ningún nombre alrededor → fila descartada (mismo
  trato que antes tenía una `Entrega` vacía). Si la celda ya trae una
  referencia `#N` (p.ej. un issue creado a mano antes de correr
  `/ct-groom`), esa referencia se extrae aparte y NO aparece en el título.
  Ese mismo título es lo que `/ct-next` reinyecta al despachar: la primera
  línea del kickoff del agente y el nombre del workspace cmux salen de aquí
  — por eso conviene que sea corto y legible, no una frase.
- **Tipo** *(opcional)*: label `type:<valor>` del issue. Además decide qué
  **recordatorio técnico** (*addendum*) recibe el agente al despachar
  (`/ct-next` → `kickoff.js`): valores reconocidos hoy son `ui`, `backend`,
  `infra`, `bugfix`. Un valor que no sea ninguno de esos NO aborta, pero
  `/ct-groom` avisa por stderr: el agente despachado para ese slice no
  recibirá ningún addendum de tipo, y sin ese aviso pasaría en silencio.
  `Tipo` decide también los gates **por defecto** (ver `Gate`, justo debajo),
  pero ya no los decide en exclusiva: hasta el contrato v9 eran la misma
  columna, y un slice `backend` que necesitaba revisión visual no tenía forma
  de pedirla.
- **Gate** *(opcional)*: qué **gates humanos** hay que cerrar antes de mergear
  este slice — el otro eje, separado del `Tipo`. Vocabulario cerrado:
  - `visual` — un humano tiene que VER el cambio: captura/vídeo del
    antes/después en el PR;
  - `apply` — nada se aplica contra un entorno real hasta que un humano
    revise el plan/dry-run;
  - `plan` — antes de implementar, un humano revisa el PLAN del slice: el
    agente lo publica como comentario del issue y se detiene hasta el OK.
    Está implicado **por defecto en todos los slices**, venga el `Tipo` que
    venga; se renuncia por fila con `!plan` (y la renuncia se anuncia).
  - `e2e` — antes de mergear, alguien atraviesa los recorridos que el slice
    declaró en su columna `E2E` (ver más abajo) y deja el informe en el PR.
    A diferencia de los otros tres, **`e2e` no se escribe en esta columna**:
    se DERIVA de que la fila traiga algún recorrido en `E2E`. Escribir
    `Gate: e2e` a mano **aborta** — el sitio donde se pide un e2e es la
    columna `E2E`, nunca ésta.

  **No hace falta escribir nada en el caso normal**: `Tipo: ui` implica
  `visual`, `Tipo: infra` implica `apply`, y **todo slice** lleva `plan` de
  serie. La columna sirve para las dos desviaciones:
  - **añadir** un gate que el `Tipo` no implica — `Tipo: backend` +
    `Gate: visual` (el caso real: una migración con backfill que mueve una
    barra de progreso muy visible). `/ct-groom` lo **anuncia por stderr**:
    llevas un gate que no viene de tu tipo;
  - **renunciar** a uno que sí implica, con un `!` delante: `!visual` sobre un
    `Tipo: ui` que de verdad no cambia nada visible. También se anuncia, y en
    voz más alta: quitar un gate nunca es silencioso. (El `!` y no un `-`
    porque `-` ya significa "sin valor" en todas las demás columnas.)

  Celda vacía o con marcador de "sin valor" (`–`) significa *no he declarado
  nada*, **no** "renuncio a todo". Un valor que no esté en el vocabulario
  **aborta** (a diferencia de `Tipo`): un gate desconocido no produciría label,
  ni instrucción al agente, ni línea en el issue — sería un gate que solo
  existe en el spec, que es justo lo que esta columna viene a impedir.

  A dónde llega: cada gate resuelto se escribe como label **`gate:<token>`** del
  issue (y **`gate:none`** cuando no hay ninguno — el silencio no puede
  significar a la vez "sin gates" y "issue anterior a los gates"), como sección
  **`## Gates`** del cuerpo del issue, y como instrucción explícita en el
  prompt del agente. Por eso sobrevive a un redespacho y a un `--reopen`: se
  lee del issue, no del spec.
- **Entrega** *(opcional)*: texto de qué entrega el slice → sección
  "Descripción" del cuerpo del issue. Ya NO alimenta el título (eso lo hace
  `Slice`, ver arriba).
- **Dep**: `#N` (varias, separadas por coma) apuntando a otro `#` de esta
  misma tabla, o marcador de "sin valor" si no depende de nada. `S1` no
  sirve — usa `#1`. Alimenta el grafo `merge-after` que respeta `/ct-next`.
  En el cuerpo del issue aparece como ``merge-after `#N` `` (entre backticks,
  a propósito: un `#N` desnudo lo convertiría GitHub en un enlace al issue
  número N de este repo, que no tiene nada que ver). Ese `#N` **siempre es el
  `#` de esta tabla — el ORDEN del slice, nunca un número de issue**;
  `/ct-next` lo traduce por el marcador `ct-order` que cada issue lleva al
  final.
- **Acepta** *(opcional)*: criterios de aceptación separados por coma →
  sección "Acceptance criteria" del issue, uno por línea. **La coma separa
  SIEMPRE**: un criterio en EARS ("Cuando caduca el token, el sistema pide
  login") se partiría en dos criterios a medias. Si el tuyo lleva coma,
  escápala como `\,` (`Cuando caduca el token\, el sistema pide login`) o
  reformula sin ella. Solo la secuencia exacta `\,` es un escape — una barra
  invertida suelta se conserva tal cual.
- **Protegido** *(opcional)*: qué queda fuera de alcance → sección "Out of
  scope / Protected" del issue. Texto libre de una sola pieza: aquí la coma
  **no** separa nada, escribe con normalidad.
- **Área / Toca** *(opcionales, separadas por coma)*: tokens → labels
  `area:<x>` / `touches:<y>`. Misma clave que usan la detección de colisión
  (`claim.js#tokensOf`) y la serialización (`dispatch.js#SERIALIZING_TOUCHES`):
  reutiliza el vocabulario de labels que ya exista en este repo, no inventes
  uno nuevo por spec. Para ver cuál existe: `gh label list --repo
  <owner/repo>` (y `/ct-groom` te dice, al correr, qué labels ha creado
  NUEVAS y cuáles ha reutilizado — si aparece una nueva que esperabas
  reutilizar, es que has escrito un sinónimo). Un token no puede contener
  comas: se descartan al normalizar, aquí `\,` no sirve de nada.
  `migration`/`ci`/`pbxproj` en `Toca` son especiales — serializan entre sí:
  como mucho un slice con uno de esos tres sin mergear a la vez, sin importar
  `Área`. El alcance real de ese "global" está más abajo, en "Qué hace
  `/ct-next` con esto": es global **al flujo de issues de este repo**, que no
  es lo mismo que global al repo.
- **Señal** *(opcional)*: la SEÑAL DE OBSERVABILIDAD que este slice
  promete — qué métrica, log o evento tiene que emitir su código de
  producción (p.ej. "métrica `backfill_progress` con label `estado`").

  NO ES UN CRITERIO DE ACEPTACIÓN MÁS. Los criterios de `Acepta` son
  funcionales: dicen qué tiene que hacer el código para que el slice
  esté hecho, y el juez ya los mide en su ítem `estado-final`. La
  señal promete otra cosa: QUÉ SE VA A VER EN PRODUCCIÓN cuando el
  slice esté desplegado — la métrica, el log o el evento por el que
  alguien sabrá, sin leer el diff, si esto está funcionando. Una señal
  que repite un criterio de aceptación con otras palabras deja al ítem
  `observabilidad` midiendo lo que `estado-final` ya midió: no añade
  ninguna información. Regla práctica: si lo que escribes se puede
  comprobar corriendo los tests, es un criterio de aceptación, no una
  señal.

  Texto libre de una sola pieza, como `Protegido`: la coma no separa
  nada. Llega como sección `## Señal de observabilidad` del cuerpo del
  issue, viaja al `.agent/SLICE.md` del worktree en el despacho, y el
  JUEZ DE SLICE la mide contra el diff acumulado (ítem `observabilidad`):
  que lo prometido lo emita código de producción, instrumentado como ya
  instrumenta este repo, sin labels de cardinalidad ilimitada. Si el
  slice no tiene nada observable que prometer, se declara la EXENCIÓN
  RAZONADA: `N/A — <razón>` (el mismo idioma que la Global verification
  de un plan). Una exención SIN razón **aborta**: una exención que nadie
  puede leer es una señal sin declarar disfrazada de decisión. Celda
  vacía o con marcador de "sin valor" significa *no lo he pensado* — no
  es una exención: el juez lo mide como `sin-vara`, y esa cuenta viaja en
  la telemetría del epic.
- **E2E** *(opcional)*: qué recorridos hay que atravesar antes de mergear este
  slice, separados por coma → sección `## E2E` del cuerpo del issue, uno por
  línea (mismo criterio de escape que `Acepta`: una coma dentro de un
  recorrido se escribe `\,`). Declarar aquí algo **deriva** el gate `` `e2e` ``
  (ver `Gate`, arriba) — no lo escribas también en `Gate`.

  **Si la tabla TIENE esta columna, cada fila tiene que decidir.** Un guion
  (o cualquier otro marcador de "sin valor") en una fila de una tabla CON
  columna `E2E` significa lo mismo de siempre —"no he declarado nada aquí"—
  pero aquí eso **aborta**: con la columna presente, "nadie lo pensó" no es
  una opción válida por fila. Para decir de verdad "este slice no tiene nada
  que atravesar", escribe el token **`no`** (o **`n/a`**, que vale igual: los
  dos son el mismo "se pensó y no hay"). Declarar un recorrido real Y
  `no` en la misma celda también aborta: no se elige un ganador en silencio.
  Si ningún slice del epic necesita e2e, la salida es no añadir la columna en
  absoluto — así ninguna fila tiene que decidir nada.

Marcadores de "sin valor" (`Dep`/`Acepta`/`Protegido`/`Área`/`Toca`/`Gate`/`Señal`):
`–` `-` `—` `―` `−` `--` o celda vacía — cualquier variante de guion vale.
`E2E` usa el mismo conjunto de marcadores, con la salvedad de arriba: solo son
inocuos cuando la columna no está presente.

### Lo que crea `/ct-groom` NO es despachable todavía

Todos los issues nacen con **`status:backlog`**, y `/ct-next` solo despacha
`status:ready`. Promoverlos es un paso **humano y deliberado** — es el gate
del loop: tú decides qué entra en vuelo y cuándo, el groom nunca lo hace por
ti. Si `/ct-next` responde "no hay slices despachables" justo después de
groomear un epic entero, es esto:

```
gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:backlog
```

`/ct-groom` recuerda al terminar cuántos issues del epic siguen en backlog.
De ahí en adelante el label `status:` lo mueven `/ct-next` y el flujo
(`ready` → `in-progress` → `in-review`, y de vuelta a `ready` si la revisión
rechaza el PR — ver "Rechazar un PR" más abajo), no el spec — por eso
re-groomear nunca lo compara ni lo revierte.

### Decisiones tuyas que dependen de cómo se invoque `/ct-groom`

- **`--milestone "<título>"`** (por defecto `Epic`): una invocación = un epic
  = un milestone, que `/ct-groom` crea si no existe. Los `#` de esta tabla son
  únicos **dentro de su milestone**, no del repo: dos epics distintos pueden
  usar `#1` sin pisarse. Pero si dos epics comparten milestone (p.ej. ambos
  con el título por defecto `Epic`), sus órdenes chocan y `/ct-next` excluye
  ese epic entero de la selección, avisando. Dale a cada epic su propio
  título de milestone.
- **`--section N`**: OBSOLETO, se acepta y se ignora (avisando). Nunca decidió
  qué se groomeaba: la tabla se localiza por su **cabecera** (una fila con
  columnas `Slice` y `Dep`), no por ningún número de sección — así que si el
  documento trae ANTES otra tabla con esas dos columnas, se groomeará esa. Una
  sola tabla de slices por spec. Lo único que hacía `--section` era componer el
  ancla del enlace al spec como `#N`, un ancla que en GitHub no existe.
- **El enlace al spec** que se escribe en cada issue sale ahora del encabezado
  real bajo el que pongas la tabla (`## 9. Slices` → `…/blob/<rama por
  defecto>/ruta/al/spec.md#9-slices`), y se **verifica** contra GitHub antes de
  escribirlo. Consecuencia para ti: **empuja el spec antes de groomear**. Si el
  fichero no está publicado en la rama por defecto, los issues nacen con una
  referencia de texto sin enlace (diciendo por qué), y `/ct-groom` no lo corrige
  en corridas posteriores sin `--reconcile`.
- **`--project <n>`** *(opcional)*: mete cada issue en el Project v2 número
  `n` **del mismo owner que `--repo`** (un project de otro owner no está
  soportado) y le fija el campo de iteración llamado exactamente `Sprint` a la
  iteración vigente hoy. Si no existe ese campo, o ninguna iteración cubre la
  fecha de hoy, `/ct-groom` aborta **sin haber creado nada** — ni milestone, ni
  labels, ni issues. (Hasta el contrato v5 esto no era cierto: el project se
  validaba después del milestone y de las labels, y un abort las dejaba
  creadas.)

#### Qué garantiza `/ct-groom` sobre lo que ya ha tocado cuando falla

Esto importa porque la respuesta natural —"un abort a mitad deja el repo a
medias"— asusta y lleva a limpiar a mano cosas que no hay que limpiar.

- **Todo lo que `/ct-groom` LEE ocurre antes de todo lo que ESCRIBE.** Las
  validaciones —argumentos, tabla de slices, spec y su enlace, listado de issues, de
  labels y de milestones, y (con `--project`) el campo `Sprint` con su
  iteración vigente— van **todas** por delante de la primera mutación. Si
  aborta por cualquiera de ellas, **no ha creado nada**.
- **Lo que NO se promete: no hay transacción.** Una vez empieza a escribir, el
  orden es milestone → labels → issues → alta en el Project. Un fallo *ahí* en
  medio (red, rate limit, auth caída, un Ctrl-C) deja creado lo anterior. No
  hay rollback y no se finge que lo haya.
- **De eso se sale volviendo a correr, no limpiando a mano.** `/ct-groom` es
  idempotente por construcción: el milestone se reutiliza por título, de las
  labels solo se crean las que faltan (las que ya existían **no** se tocan,
  ni su color ni su descripción), los issues se reconocen por su marcador
  `ct-order` y no se duplican, y un issue que quedó fuera del Project se
  detecta y se añade en la siguiente corrida.
- **Sin `--reconcile`, un issue que ya existe NUNCA se edita.** Las
  divergencias se reportan y se sale `3`; nada se escribe.
- **`--dry-run` no muta nada, nunca** — ni siquiera crea el milestone.

Ejemplo que parsea tal cual (verificado con `ct-groom.mjs --dry-run`):

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|
| 1 | modelo | backend | tabla `medicamentos` | – | AC-1.1 | schema | medicacion | db, migration | – | – |
| 2 | barra | backend | backfill con progreso visible | #1 | AC-2.1 | – | medicacion | db, migration | visual | métrica `backfill_progress` con label `estado` |
| 3 | pantalla | ui | pantalla de alta | #2 | AC-3.1 | – | medicacion | app | – | N/A — pantalla sin telemetría nueva que prometer |

(La fila 2 es el caso que la columna `Gate` existe para cubrir: es `backend`
por dentro y lo más visible del epic por fuera. La fila 3 no declara nada y
recibe su gate `visual` igualmente, por ser `Tipo: ui`. La fila 2 declara
además su señal de observabilidad y la fila 3 se exime con razón — con la
fila 1, las tres formas de la columna `Señal` en un mismo ejemplo.)

**Arreglar la tabla y volver a groomear NO arregla los issues ya creados.**
Re-ejecutar `/ct-groom` no los duplica (los reconoce por su marcador
`ct-order`), pero tampoco los actualiza: compara título, enlace al spec,
labels (`type:`/`area:`/`touches:`/`gate:`; `status:` nunca) y las
dos secciones que el dispatcher obedece
(`## Dependencias`, `## Acceptance criteria`) contra lo que la tabla produce
hoy, **reporta** cada diferencia por stderr y sale `3` — pero no escribe nada
salvo que se le pase `--reconcile` (EXPERIMENTAL: ha corrompido bodies reales
en pruebas, revisa el diff del issue después de usarlo). Un issue cuyo slice
ya no está en la tabla se avisa como huérfano y no se toca. Si cambias algo
en una fila ya groomeada, cuenta con revisar ese issue a mano.

**El milestone NO está en esa lista, y no es un olvido.** Un groom sólo mira
los issues del milestone que le has pasado, así que un issue emparejado tiene
siempre, por construcción, ese mismo milestone: la divergencia de milestone es
inalcanzable desde `/ct-groom` y nunca la vas a ver reportada. Si mueves un
issue de milestone en GitHub y vuelves a correr, lo que obtienes no es un
aviso de divergencia: según a dónde lo hayas movido, o se ignora por ser de
otro epic, o `/ct-groom` se para en seco con **exit 1** sin crear ni modificar
nada, o crea un issue nuevo para ese slice avisando de que puede estar
duplicándolo. Consecuencia práctica de ese mismo alcance: **la tabla de slices de
cada spec puede empezar en `1`** sin pisar los issues de un epic anterior.
Ver "El alcance de un groom es su epic, no el repo" en `docs/loop/ct-groom.md` (repo del plugin).

Detalle completo (todas las condiciones de abort, columnas opcionales,
avisos no fatales, el reporte de divergencia, sus límites, y `--reconcile`):
`docs/loop/ct-groom.md` en el repo del plugin `control-tower-loop` (el comando `commands/ct-groom.md` se quedó con la invocación y sus códigos de salida).

### Qué hace `/ct-next` con esto

Lo de abajo NO es la referencia de invocación (esa es `docs/loop/ct-next.md`,
en el repo del plugin): es lo que cambia cómo escribes la tabla y cómo convives
con el loop una vez hay slices en vuelo.

- **`Área`/`Toca` no avisan: BLOQUEAN.** Un slice que comparta **un solo
  token** con un issue en `status:in-progress` **o `status:in-review`**
  no se despacha — `/ct-next` lo salta y prueba el siguiente candidato; si no
  queda ninguno, no lanza nada y dice contra qué issue chocó y en qué estado.
  Elegir los tokens **es** elegir qué puede volar en paralelo: dos slices con
  un token en común quedan serializados aunque toquen ficheros distintos.
- **Un token se retiene hasta el MERGE, no hasta que el agente pare.** El
  agente libera su claim al abrir el PR (`in-progress` → `in-review`), y eso
  suelta el **cap** — pero no los tokens: hasta que el PR se mergea y el
  issue se cierra, `main` todavía no contiene ese trabajo, así que un vecino
  de área ramificaría de una base incompleta. Consecuencia al diseñar la
  tabla: **un PR sin mergear frena a sus vecinos de área**, no solo a sus
  dependientes. Dos slices que comparten token no se solapan ni "un poquito".
  Y si `/ct-next` te dice que choca con un `status:in-review`, esperar no
  sirve de nada: ahí no hay ningún agente. Mergea el PR — o, si el PR ya se
  mergeó y el issue sigue abierto, ciérralo **como *completed***
  (`gh issue close <n> --reason completed`).
- **"PR mergeado, issue abierto" tiene DOS causas, y la segunda engaña.** Es
  el estado que tapa un carril para siempre, así que conviene saber
  diagnosticarlo entero:
  - al PR le faltaba el `Closes #N` en el cuerpo. El kickoff que `/ct-next`
    le da a cada agente lo pide explícitamente, pero el kickoff es un
    PROMPT, no un gate: **la causa más probable de este caso es simplemente
    que el agente no lo puso** (además de un PR abierto a mano, o un cuerpo
    editado después). Nada del loop lo comprueba;
  - el PR SÍ llevaba su `Closes #N`, pero se mergeó en una rama que **no es
    la rama por defecto** del repo. GitHub **solo cierra el issue cuando el
    PR entra en la rama por defecto** — verificado contra un repo real, no
    deducido de la documentación. Es el caso que engaña: miras el PR, ves el
    `Closes #N` ahí puesto, y descartas el diagnóstico correcto.
  Consecuencia operativa: si despachas con `/ct-next --base <otra-rama>`,
  **cerrar cada issue al mergear su PR es un paso a mano, siempre** — el
  `Closes #N` no lo va a hacer por ti. `/ct-next` lo avisa por stderr cada vez
  que le pasas `--base`.
- **`migration`/`ci`/`pbxproj` serializan además GLOBALMENTE, con un alcance
  concreto.** Son dos reglas distintas actuando a la vez: la de arriba
  compara tokens, esta no. Un slice con `Toca: migration` y otro con
  `Toca: ci` **no comparten ningún token** y aun así no pueden estar sin
  mergear a la vez, sin importar `Área`. **Qué significa "global" de verdad:
  `/ct-next` solo mira issues de ESTE repo con `status:in-progress` o
  `status:in-review`.** Todo lo que va por fuera del flujo de issues es
  INVISIBLE para esta regla: otra rama, otro track de trabajo, un humano
  editando la misma migración a mano, un repo distinto. La serialización es
  global **al flujo de issues de este repo**, no al repositorio ni al
  proyecto. Si tienes trabajo en paralelo fuera del loop, esta garantía no lo
  cubre y no hay nada en el plugin que pueda cubrirlo.
- **`merge-after` se comprueba mirando CÓMO se cerró el issue.** Una
  dependencia cuenta como satisfecha si su issue está **cerrado como
  *completed*** — que es lo que GitHub hace al mergear un PR con `Closes #N`.
  Un PR aprobado, un PR abierto o un issue en `status:in-review` no
  desbloquean nada. Las dos trampas de esa aproximación, dichas sin adornos:
  - un issue cerrado como ***not planned*** (lo correcto para un slice
    descartado) **no** satisface la dep y deja a sus dependientes esperando
    para siempre. `/ct-next` lo nombra al explicar el bloqueo: si ves eso,
    quita el `merge-after` de la sección `## Dependencias` del dependiente, o
    reabre el issue y ciérralo como *completed* si su trabajo sí se hizo;
  - un issue cerrado como ***completed*** sin que se haya mergeado nada **sí**
    satisface la dep, y el dependiente saldrá sobre trabajo que no existe.
    **Esto no requiere que nadie se equivoque a propósito**: GitHub aplica las
    *closing keywords* de **cualquier mensaje de commit** que llegue a la rama
    por defecto, y **las comillas no protegen**. En un repo real, un commit de
    **documentación** que solo MENCIONABA la cadena `Closes #451` —dentro de
    una frase que explicaba que el kickoff no la llevaba— cerró ese issue como
    *completed*.
    `/ct-next` **avisa** (no bloquea) cuando una dependencia ya satisfecha
    consta cerrada por un **commit suelto** que no pertenece a ningún PR
    mergeado. Lo que **no** exige es que el cierre venga de un PR: cerrar el
    issue a mano es la práctica mayoritaria (medido: 86 de 97 cierres
    *completed* de un repo real no tienen ningún PR detrás) y además es un paso
    **prescrito** aquí mismo cuando se despacha con `--base <otra-rama>`.
    Cuidado con escribir esas keywords en cualquier commit, aunque sea
    entrecomillándolas. El plugin **bloquea** el commit cuando la keyword viaja
    en el mensaje (`-m`) de un `git commit` lanzado desde **una sesión de
    Claude que tenga este plugin cargado**, contra un repo que tenga esta
    sección en su `AGENTS.md`. Es una propiedad de la SESIÓN, no sólo del
    repo: un agente despachado arranca con su propia cuenta
    (`CLAUDE_CONFIG_DIR`, ver `resolveAccount` en `scripts/dispatch.js`), así
    que sólo lleva la puerta si el plugin está instalado también ahí.
    Y la regla que resume qué queda fuera, porque una lista de excepciones
    envejece peor que el principio del que salen: **la puerta engancha en el
    tool `Bash`, así que cubre lo que ejecuta CLAUDE, nunca lo que tecleas
    TÚ**. Ni en tu terminal, ni con el prefijo `!` dentro de la propia sesión
    de Claude: un `!` no pasa por el tool, así que ningún hook lo ve. Medido
    en un repo gobernado, con el MISMO mensaje: bloqueado desde el tool
    `Bash`, limpio con `!`. Lo que además **no ve**, y por tanto sigue siendo
    tuyo: un `git commit` **sin** `-m` (el mensaje lo pone el editor), un
    `-F <fichero>` y un `--amend --no-edit`; ni una invocación
    **envuelta**, donde `git` deja de ser el primer token — `sudo git
    commit`, `env FOO=1 git commit`, `command git commit`. Con `git -C
    <ruta> commit -m ...` o `cd <ruta> && git commit -m ...` el problema no
    es que no la vea: la puerta decide sobre el repo del directorio de LA
    SESIÓN, nunca sobre el que señala `<ruta>`, y eso corta en los dos
    sentidos — puede bloquear un commit dirigido a un repo que no gobierna
    (sesión dentro de uno gobernado, `<ruta>` fuera) y no proteger uno
    dirigido a un repo que sí gobierna (sesión fuera, `<ruta>` dentro). Para
    lo que se escape sigue estando el aviso de `/ct-next` de aquí arriba: eso
    caza el EFECTO, la puerta caza la CAUSA, y ninguno de los dos lo caza
    todo.
  Al diseñar la tabla: el slice del que dependen muchos es el **cuello de
  botella** del epic entero — nada detrás de él avanza hasta que ESE se
  mergee. Si quieres una ventana de paralelismo, tiene que salir de la
  columna `Dep`.
- **Un issue CERRADO que conserva su label `status:` no existe para
  `/ct-next`.** El dispatcher solo barre issues **abiertos**. Un cerrado con
  `status:ready` todavía puesta se cae de la cola de despacho, y hasta ahora
  se caía **sin una palabra**: la corrida siguiente pasaba al siguiente
  `status:ready` del repo y explicaba con detalle por qué *ése* no era
  despachable, sin mencionar el que había desaparecido. Ahora sale un aviso
  agregado —uno solo, con los números agrupados por estado— porque **cerrar el
  issue y quitarle su label son dos actos distintos y nada comprueba el
  segundo**: la tasa medida en un repo real es de **10 cerrados con label viva
  de cada 99**. Un `status:in-review` sobre un issue cerrado NO es anomalía:
  es el final normal de un slice, y nada le quita esa label al cerrar.
- **Un slice BLOQUEADO retiene su claim, y no hay transición que lo suelte.**
  Si el agente marca `blocked: {reason, unblock}` en el `.agent/SLICE.md` de su
  worktree y para —que es lo que el kickoff le pide—, su issue se queda en
  `status:in-progress` **reteniendo tokens y una plaza de `--cap`**
  indefinidamente: la detección de claims rancios no lo ve (el worktree y la
  rama SÍ existen), `--requeue` se niega precisamente por eso, y `--release`
  mentiría (no hay PR). `/ct-next` **lee** ese `SLICE.md` (antes de F22 era el
  `.agent/STATE.md` del worktree; hoy ése es el de la coordinadora y **no** se
  lee) y lo dice con su motivo, pero **no lo arregla**: sacarlo de ahí es una
  decisión tuya (desbloquearlo, o abandonarlo borrando worktree y rama antes
  de `--requeue`).
- **Una invocación despacha `--cap` slices; por defecto es 1.** Y el cap es
  **global al repo, no por invocación**: cuenta también lo que ya está en
  vuelo (`status:in-progress`), así que un segundo `/ct-next --cap 1` con algo
  corriendo no lanza nada — y lo dice. Un `status:in-review` **no** ocupa cap
  (no hay ningún agente corriendo ahí), aunque sí retenga sus tokens: son dos
  contabilidades distintas. Un slice reabierto con `--reopen` vuelve a
  `in-progress` y por tanto **sí** ocupa cap: esta vez hay alguien
  rehaciéndolo. Aprovechar una ventana de paralelismo es un acto
  explícito: `/ct-next --cap 2` (o más).
- **Las dos garantías de arriba valen para UN dispatcher a la vez.** El claim
  es un label de GitHub, sin compare-and-swap: está reproducido y verificado
  que dos `/ct-next` lanzados casi a la vez contra el mismo repo pueden
  reclamar el mismo token compartido y arrancar los dos, saltándose tanto la
  regla de colisión como el cap. No hay espera ni reintento que cierre ese
  hueco hoy. **La mitigación es operativa: no lances dos dispatchers a la vez
  sobre el mismo repo.** (Detalle y evidencia: `docs/loop/ct-next.md`.)
- **`/ct-next` no acota por epic.** Acepta `--repo`, `--cap`, `--base` y
  `--dry-run`; **no hay `--milestone`**. Barre todos los issues abiertos del
  repo y elige por el `#` más bajo de la tabla, venga del epic que venga (ese
  `#` sí se resuelve dentro de su propio milestone para traducir `Dep`, pero
  la SELECCIÓN no se acota). Con dos epics vivos, el `#1` del segundo le gana
  al `#3` del primero — y si los dos tienen un `#1` despachable, **cuál sale
  primero no está definido**: depende del orden en que GitHub devuelva los
  issues. La palanca para decidir qué epic avanza es la que ya tienes:
  promover a `status:ready` solo los slices que quieras en vuelo.
- **Hace falta `cmux`.** Es un gestor de workspaces de terminal, externo al
  plugin: cada slice se lanza como `cmux new-workspace` (un worktree + una
  sesión de `claude`). Si `cmux` no está en el PATH, **ningún** slice puede
  lanzarse — `/ct-next` aborta en las precondiciones, antes de reclamar nada.
  `/ct-groom` y `/ct-init` no lo necesitan: es requisito solo del dispatch.
- **Interrupción y reanudación.** Un Ctrl-C (SIGINT/SIGTERM) a media corrida
  revierte a `status:ready` el claim que hubiera quedado a medias antes de
  salir. Re-invocar `/ct-next` es **idempotente** por construcción: un slice
  ya despachado está en `status:in-progress`, así que ya no es `status:ready`
  y no se vuelve a elegir (aunque sigue ocupando cap). Cada slice usa la rama
  `feat/<n>` y el worktree `.worktrees/<n>` (`<n>` = número de ISSUE, no el
  `#` de la tabla); si alguno de los dos ya existe de una corrida anterior,
  `/ct-next` se niega a despachar ese slice **antes** de reclamarlo e imprime
  el comando de limpieza exacto.
- **Un claim es un label, sin heartbeat: nada lo caduca.** Si un slice muere
  (sesión cerrada, máquina apagada, un agente que nunca ejecutó su
  `--release`), su `status:in-progress` se queda puesto y bloquea
  indefinidamente a todos los que compartan sus tokens, hasta que alguien lo
  revierta **a mano**:

  ```
  node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --requeue
  ```

  `--requeue` es la versión **comprobada** de la edición a mano: se niega si
  el worktree `.worktrees/<n>` o la rama `feat/<n>` siguen existiendo, porque
  entonces el trabajo de ese slice sigue vivo sin mergear y soltar sus tokens
  dejaría salir a un vecino sobre una base que no lo contiene. Si de verdad
  quieres saltarte esa comprobación (sabes que ese trabajo no importa y
  prefieres conservar el worktree), la edición cruda sigue estando y no
  comprueba nada:

  ```
  gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:in-progress
  ```

  `/ct-next` ayuda hasta donde puede: si un `status:in-progress` no tiene ni
  worktree, ni rama, ni sesión de cmux **en esta máquina**, lo dice — tanto
  si bloquea por token compartido como si solo está ocupando el `--cap`. Pero
  no puede afirmar que esté abandonado (pudo reclamarse desde otro sitio), y
  **solo se entera quien esté corriendo `/ct-next` en ese momento**: no hay
  ningún demonio vigilando claims entre invocaciones. Comprueba antes de
  romper un claim ajeno. (Esta comprobación NO se hace sobre un
  `status:in-review`: ahí no tener sesión abierta es lo normal, no una
  anomalía — lo que bloquea es el PR sin mergear, no un claim muerto.)

### Rechazar un PR en el gate, sin sacar el slice del loop

`status:in-review` **no** es un estado terminal, pero salir de él es un acto
deliberado tuyo: no hay ninguna transición automática de vuelta. El ciclo
completo de un slice, con quién mueve cada arista:

```
backlog --(tú)--> ready --(/ct-next)--> in-progress --(--release)--> in-review
                    ^                        ^                          |
                    |                        +-------(--reopen)---------+
                    +---------(--requeue)----+
```

Si rechazas el PR de un slice, devuélvelo al banco de trabajo con

```
node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --reopen
```

que lo mueve `in-review` → **`in-progress`** —el inverso exacto de
`--release`— **solo si de verdad está en `in-review`** (si no, se niega sin
tocar ninguna label). Que quede en `in-progress` y no en `ready` **no es un
detalle**: su trabajo sigue existiendo sin mergear en `feat/<n>`, así que
**sigue reteniendo sus tokens** de `Área`/`Toca` hasta el merge. Reabrir **no
desbloquea a sus vecinos** — solo dice quién lo está rehaciendo. Y ocupa una
plaza de `--cap`, porque esta vez sí hay alguien trabajándolo.

No borra nada del disco: te dice qué queda de la vuelta anterior (el worktree
`.worktrees/<n>` y la rama `feat/<n>`) y te deja elegir entre dos caminos
excluyentes:

- **corregir encima** de lo que ya hay — lo normal tras un rechazo: sigues en
  ese mismo worktree y ese mismo PR, y **no** invocas `/ct-next` para ese
  slice (se negaría, precisamente porque el worktree y la rama existen).
  Cuando vuelva a estar listo, repites el `--release`;
- **empezar de cero** — borras worktree y rama (comprueba antes que no
  pierdes trabajo sin pushear), cierras su PR, y **solo entonces** lo
  devuelves a la cola:

  ```
  node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --requeue
  ```

  `--requeue` mueve `in-progress` → `ready`, y es la ÚNICA transición que
  suelta tokens sin un merge, así que **comprueba antes de declararlo**: exige
  que en esta máquina no quede ni `.worktrees/<n>` ni `feat/<n>`, y se niega
  también si no ha podido mirarlo (no se declara ausente lo que no se ha
  visto). Lo que **no** puede comprobar y te dice cada vez: la rama en el
  remoto y el PR abierto. Si siguen ahí, ese trabajo sigue sin mergear y ya no
  hay nadie reteniendo su área.

`--requeue` sirve además para el otro caso de siempre: **romper un claim
muerto** (un `status:in-progress` cuyo agente ya no existe). Es la versión
comprobada del `gh issue edit` a mano que aparece más arriba.

Sin estas dos aristas, un PR rechazado dejaba su slice fuera del loop **para
siempre**, y con él todo lo que dependiera de él: `/ct-next` solo despacha
`status:ready`.
- **Cada slice en vuelo tiene SU `.agent/SLICE.md`**: el de su worktree
  (`.worktrees/<n>/.agent/SLICE.md`), sembrado al despachar (antes de F22 la
  semilla iba al `.agent/STATE.md` del worktree — un fichero TRACKEADO, y por
  eso los PRs de slice acababan llevándose el estado a `main`). Dos slices a
  la vez no se pisan ese fichero, y ninguno toca ningún `.agent/STATE.md`: ni
  el del checkout principal ni el que su propio worktree hereda de la base,
  que se queda a cero diff. `.agent/SLICE.md` está **ignorado** por dos vías:
  el `.gitignore` del repo (lo añade `/ct-init`) y el `info/exclude` del
  directorio común de git (lo escribe `/ct-next` en cada despacho, y desde ahí
  cubre a todos los worktrees). Así no entra en ningún commit — y `--release`
  se niega si la rama introduce cualquiera de los dos ficheros de estado.
- **Dos sesiones por repo, con papeles OPUESTOS, y cada una lo lleva escrito
  en su fichero de estado (campo `role`): el `.agent/STATE.md` del checkout
  principal, el `.agent/SLICE.md` de cada worktree.** La del **checkout
  principal** es la *coordinadora*: groomea, despacha con `/ct-next`, revisa y
  mergea. La de cada `.worktrees/<n>` es la *despachada*: implementa ese slice
  y **para** — no mergea, no despacha el siguiente. Antes ese reparto solo
  existía dentro del kickoff que recibía una de las dos, así que se perdía en
  cuanto esa sesión se re-hidrataba de su fichero de estado. Ningún código lo
  comprueba: es información para el agente que lo lee.
- **Qué recibe el agente despachado**: un prompt de arranque (*kickoff*) con
  el nombre del slice, el número de issue, los criterios de la sección
  "Acceptance criteria", el aviso de leer la sección "Out of scope /
  Protected", el addendum técnico de su `Tipo`, **sus gates humanos** (los de
  la columna `Gate`, o los que implique su `Tipo`), la rama base contra la que
  tiene que abrir el PR, la orden de poner **`Closes #N` en el cuerpo de ese
  PR** (con el porqué: sin ese cierre, el slice retiene sus tokens para
  siempre y no desbloquea a sus dependientes) y el comando literal para
  liberar el claim al terminar; más el `.agent/SLICE.md` sembrado en su
  worktree (que repite su `role` y sus gates, para sobrevivir a un `/clear`;
  antes de F22 esa semilla iba al `.agent/STATE.md`, que es el de la
  coordinadora) y lo que el propio repo le dé al arrancar (`AGENTS.md`,
  `CLAUDE.md`, hooks). **No recibe el
  spec**: se hidrata del issue. **Lo que no llegó al cuerpo del issue no llega
  al agente.** Ninguna exigencia que le hagas desde otra sección del spec —una
  §10, una "REGLA #-2", un párrafo de introducción— le va a llegar, por muy
  contundente que esté redactada. Lo que el kickoff **no** puede garantizar es que el agente
  obedezca: si un PR aparece sin su `Closes #N`, el loop no lo detecta — lo
  verás como un `status:in-review` que no se despeja. Lo mismo vale para los
  gates: el loop los **escribe y los enseña** (kickoff, label `gate:`, sección
  `## Gates` del issue), pero **no impide mergear** un PR con su gate sin
  cerrar. El que cierra el gate eres tú.
  **Y por eso tus comprobaciones previas al merge tienen que ser PUERTAS.**
  Verifica el EFECTO, nunca el exit code: si el resultado de una comprobación no
  puede detener el merge, no es una comprobación, es decoración. En campo, una
  comprobación de contaminación del estado imprimió `1` y el merge entró igual —
  hubo que arreglar la rama por defecto a posteriori—; la misma comprobación,
  convertida en puerta, paró el siguiente. Vale para todo lo que mires antes de
  mergear, no sólo para los gates: si lo compruebas a mano, que el resultado
  mande.

<sub>Este contrato lo mantiene `/ct-init` (contrato v23) y vive en
`docs/superpowers/CONTRATO-SLICES.md` de este repo; `AGENTS.md` solo enlaza a
él. Si el plugin trae una versión más nueva, `/ct-init` lo avisa al correr;
para adoptarla: `bash <plugin>/scripts/ct-init.sh <dir-repo>
--update-slices-contract`, que solo lo reemplaza si no lo has editado a mano.</sub>
<!-- /ct-init:slices-contract -->
EOF
}

# emit_e2e_howto: the body of the traversal section, in a single place — same
# reason as emit_slices_contract above. With no version and no pristine hash
# (see the comment next to E2E_MARKER_OPEN, further down, where it is used):
# this is a TEMPLATE, not a contract of the plugin's.
emit_e2e_howto() {
  cat <<'EOF'
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
EOF
}

# sha256_of: the file's hash, with whichever binary is there (macOS brings
# `shasum`, most Linuxes `sha256sum`). If there is neither, it returns empty and
# the caller treats the block as "unverifiable" — never as "intact".
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else echo ''; fi
}

# F9, a case that was not accounted for: an AGENTS.md with CRLF line endings (a
# repo edited on Windows, a file put through a tool that converts them,
# `core.autocrlf`…) carried a `\r` stuck to the end of EVERY line, the markers
# included. `grep -qxF '<!-- ct-init:slices-contract -->'` found NEITHER the
# opening marker, NOR the closing one, NOR the heading, so the script concluded
# "this section does not exist yet" and ADDED a whole second copy of the 134
# lines at the end of the file — in silence, exit 0, and skipping on the way the
# partial-trace guard of d4a5ca8, which exists precisely so that that cannot
# happen. Every line comparison from here on ignores a trailing `\r`.
#
# has_line: is that EXACT line in the file, with or without a trailing `\r`?
# With awk and not with `grep -qE '…\r?$'` because the text looked for is
# literal and some of it carries parentheses (the heading), which in an ERE
# would mean something else; and not with `tr -d '\r' | grep -qxF` so as not to
# bring in a new dependency: if `tr` were missing, this would answer "it is not
# there" and we would be duplicating the section all over again.
has_line() {
  awk -v want="$1" '
    { line = $0; sub(/\r$/, "", line) }
    line == want { found = 1; exit }
    END { exit !found }
  ' "$2"
}

# extract_slices_block: the block exactly as it is TODAY in the AGENTS.md, from
# the opening marker to the closing one, both included. It is printed NORMALISED
# (with no `\r`): that way the hash of a block that is intact but has CRLF line
# endings matches the registered one — which is the truth ("nobody has touched
# this text") instead of an "I do not recognise it" caused by the line
# endings.
extract_slices_block() {
  awk -v om="$SLICES_MARKER_OPEN" -v cm="$SLICES_MARKER_CLOSE" '
    { line = $0; sub(/\r$/, "", line) }
    line == om { f = 1 }
    f { print line }
    f && line == cm { exit }
  ' "$1"
}

# slices_block_is_crlf: does the block that is there use CRLF? It decides with
# which line endings it gets rewritten, so as not to leave a file with half its
# lines in one format and half in another.
slices_block_is_crlf() {
  awk -v om="$SLICES_MARKER_OPEN" -v cm="$SLICES_MARKER_CLOSE" '
    { line = $0; sub(/\r$/, "", line) }
    line == om { f = 1 }
    f && line != $0 { crlf = 1 }
    f && line == cm { exit }
    END { exit !crlf }
  ' "$1"
}

# file_is_crlf: same criterion as slices_block_is_crlf but over the WHOLE file
# instead of a block bounded by markers — the seeding of the e2e section uses it
# (it has no previous block to start from: the first time it is added there is
# nothing to read between its own markers yet). The first line with a `\r` is
# enough: an AGENTS.md does not mix line-ending styles halfway through the file
# unless something has already corrupted it, a case this script does not claim
# to fix.
file_is_crlf() {
  awk '
    { line = $0; sub(/\r$/, "", line) }
    line != $0 { found = 1; exit }
    END { exit !found }
  ' "$1"
}

# replace_slices_block: it replaces the whole block (markers included) with the
# current version, leaving EVERYTHING before and after it intact — the user's
# AGENTS.md is not regenerated, only this section is spliced in.
# It takes the file as a parameter (#93): the contract now lives in its own file
# of the governed repo, and this very function is the one that replaces, inside
# an AGENTS.md bootstrapped earlier, the old block with the short section.
# `$2` is the name of the function that emits the replacement text.
replace_slices_block() {
  local target emitter newblock outfile
  target="$1"; emitter="${2:-emit_slices_contract}"
  newblock="$(mktemp)"; outfile="$(mktemp)"
  if slices_block_is_crlf "$target"; then
    "$emitter" | awk '{ printf "%s\r\n", $0 }' > "$newblock"
  else
    "$emitter" > "$newblock"
  fi
  awk -v nf="$newblock" -v om="$SLICES_MARKER_OPEN" -v cm="$SLICES_MARKER_CLOSE" '
    { line = $0; sub(/\r$/, "", line) }
    line == om && !done { inb = 1; while ((getline l < nf) > 0) print l; close(nf); done = 1; next }
    inb && line == cm { inb = 0; next }
    inb { next }
    { print }
  ' "$target" > "$outfile"
  mv "$outfile" "$target"
  rm -f "$newblock"
}

# slices_block_hash: the sha256 of the block that is there, or empty if this
# machine has nothing with which to compute it. It is kept in a global because
# the messages cite it: a hash we do not recognise is precisely the datum needed
# in order to register it (and so that whoever reports it does not have to
# explain anything else).
SLICES_BLOCK_HASH=''
compute_slices_block_hash() {
  local blockfile
  blockfile="$(mktemp)"
  extract_slices_block "$1" > "$blockfile"
  SLICES_BLOCK_HASH="$(sha256_of "$blockfile")"
  rm -f "$blockfile"
}

# slices_block_status: `pristine` | `unknown` | `unverifiable`. Three states,
# not two (F9): "it matches no known hash" and "the hash could not be computed"
# are different things, and collapsing them into a single `return 1` was what
# made a machine with neither `shasum` nor `sha256sum` accuse the user of having
# edited a section that was intact.
# It reads SLICES_BLOCK_HASH; compute_slices_block_hash has to be called first
# from the parent shell (this one is used inside `$(...)`, and whatever it
# assigned there would stay in the subshell).
slices_block_status() {
  if [ -z "$SLICES_BLOCK_HASH" ]; then echo unverifiable; return; fi
  # One hash per line, with the provenance behind it: only field 1 is compared.
  if printf '%s\n' "$SLICES_PRISTINE_HASHES" |
     awk -v h="$SLICES_BLOCK_HASH" '$1 == h { found = 1 } END { exit !found }'; then
    echo pristine
  else
    echo unknown
  fi
}

# ---------------------------------------------------------------------------
# #93 — THE CONTRACT COMES OUT OF AGENTS.md AND GETS A FILE OF ITS OWN.
#
# The block is ~39 KB of the ~40 KB the seeded AGENTS.md weighed, and it is read
# by whoever WRITES a spec: once per epic, deliberately. The AGENTS.md, on the
# other hand, is read by every agent as it hydrates, every session, all the time
# — and there those 39 KB compete for attention with the twenty lines that do
# govern what that agent is going to do. It is split in two:
#
#   - `docs/superpowers/CONTRATO-SLICES.md`: the block, byte for byte the same
#     one that used to be inserted into AGENTS.md —markers, version line and
#     body—, with the SAME machinery of version, pristine hashes,
#     `--update-slices-contract` and `--force`. Its being identical is not
#     convenience: it is what makes the ledger of historical hashes go on
#     recognising a block seeded by any earlier version, and what keeps
#     `conventions.js`'s pruning and `vara.js`'s discount seeing it by its
#     markers with no new rule. The file IS the block and nothing else.
#   - `AGENTS.md`: a short section (`<!-- ct-init:loop -->`) with what an agent
#     needs —the repo's commands, where the yardstick is, that a slice's state
#     is `.agent/SLICE.md`— and a link to the contract.
#
# The migration of a repo bootstrapped earlier: its AGENTS.md carries the
# contract inside. It is not touched by default (it may carry edits of its own,
# the same doctrine as ever); it is WARNED about, and
# `--update-slices-contract` replaces the block with the short section if it was
# unedited.
CONTRATO_DIR="$TARGET/docs/superpowers"
CONTRATO_MD="$CONTRATO_DIR/CONTRATO-SLICES.md"
LOOP_MARKER_OPEN='<!-- ct-init:loop -->'
LOOP_MARKER_CLOSE='<!-- /ct-init:loop -->'

# emit_loop_section: the ~20 lines of the loop an agent does read. With no
# version and no pristine hash, for the same reason as the e2e traversal
# section: it brings gaps the repo HAS to fill in (the commands), so detecting
# "the text changed" would be detecting correct use.
emit_loop_section() {
  cat <<'EOF'
<!-- ct-init:loop -->
## Control Tower loop

Este repo lo gobierna el loop Control Tower: **un issue = un slice = una sesión**.

- **Comandos de este repo** (rellénalos una vez): build `…` · test `…` · lint `…`.
- **La vara de este repo** —los documentos de reglas del código que `ct-step`
  pega en el brief de cada tarea— se declara en `.agent/conventions.md`. La vara
  de ct viaja con el plugin y manda donde las dos hablen de lo mismo; donde ct
  calla, la del repo obliga entera.
- **El estado de un slice despachado es `.agent/SLICE.md`**, el de SU worktree
  (ignorado por git, nunca producto). `.agent/STATE.md` es el de la sesión
  coordinadora del checkout principal y un slice no lo toca. Si te quedas
  parado, escribe `blocked: {reason, unblock}` en tu `SLICE.md` y PARA.
- **Cada slice trabaja en `.worktrees/<n>` sobre `feat/<n>`**, y su claim
  (`status:ready` → `status:in-progress`) lo hace `/ct-next` en código: no
  muevas esas labels a mano. Al abrir el PR, `Closes #N` en el cuerpo.
- **Lo que no llega al cuerpo del issue no llega al agente**: no recibe el spec.
- **El formato de la tabla de slices —el contrato con `/ct-groom`— está en
  [`docs/superpowers/CONTRATO-SLICES.md`](docs/superpowers/CONTRATO-SLICES.md)**:
  qué columnas lee, qué genera cada una y qué hace `/ct-next` con ellas. Es lo
  que lee quien escribe un spec para este repo. Lo mantiene `/ct-init`, lleva su
  propia versión y no se edita a mano.
- **Cómo se levanta este repo** para atravesarlo de punta a punta: la sección
  «Cómo se atraviesa este repo (e2e)», más abajo. Rellénala una vez.
<!-- /ct-init:loop -->
EOF
}

# --- The contract, in its own file -----------------------------------------
mkdir -p "$CONTRATO_DIR"
if [ ! -f "$CONTRATO_MD" ]; then
  emit_slices_contract > "$CONTRATO_MD"
  echo "creado $CONTRATO_MD (contrato /ct-groom v$SLICES_CONTRACT_VERSION)"
else
  contrato_open=0; has_line "$SLICES_MARKER_OPEN" "$CONTRATO_MD" && contrato_open=1 || true
  contrato_close=0; has_line "$SLICES_MARKER_CLOSE" "$CONTRATO_MD" && contrato_close=1 || true
  if [ "$contrato_open" -eq 1 ] && [ "$contrato_close" -eq 1 ]; then
    found_version="$(extract_slices_block "$CONTRATO_MD" | grep -o "$SLICES_VERSION_LINE_RE" | head -n1 | grep -o '[0-9]\{1,\}' || true)"
    [ -z "$found_version" ] && found_version=1
    compute_slices_block_hash "$CONTRATO_MD"
    block_status="$(slices_block_status)"
    hash_note="hash del bloque presente: ${SLICES_BLOCK_HASH:-no calculable en esta máquina}"
    if [ "$found_version" -gt "$SLICES_CONTRACT_VERSION" ]; then
      echo "aviso: el contrato de slices de $CONTRATO_MD es del contrato v$found_version, y este plugin solo llega a la v$SLICES_CONTRACT_VERSION — lo sembró una versión más nueva del plugin. No se toca (degradarlo sería perder lo que ya tienes). Si /ct-groom no se comporta como describe ese fichero, el desactualizado es el plugin: actualízalo." >&2
    elif [ "$found_version" -eq "$SLICES_CONTRACT_VERSION" ]; then
      if [ "$UPDATE_SLICES_CONTRACT" -eq 1 ] && [ "$block_status" = unknown ]; then
        if [ "$FORCE" -eq 1 ]; then
          replace_slices_block "$CONTRATO_MD"
          echo "aviso: el contrato de slices de $CONTRATO_MD ya declaraba v$found_version pero su contenido no coincidía con el que trae este plugin ($hash_note); se ha reemplazado por el actual porque lo pediste con --force. Si había ediciones tuyas en ese fichero, ya no están." >&2
        else
          echo "aviso: el contrato de slices de $CONTRATO_MD ya declara la v$found_version (la actual), así que no hay actualización de versión que hacer, pero su contenido NO es el que emite este plugin ($hash_note). Puede ser una edición tuya, o una variante distinta que se publicó con el mismo número de versión. No se toca nada; con --force se reemplazaría por el bloque v$SLICES_CONTRACT_VERSION de este plugin." >&2
        fi
      else
        echo "contrato de slices ya está en $CONTRATO_MD (contrato v$found_version, al día), no se duplica"
      fi
    elif [ "$UPDATE_SLICES_CONTRACT" -eq 1 ]; then
      if [ "$block_status" = pristine ]; then
        replace_slices_block "$CONTRATO_MD"
        echo "contrato de slices actualizado en $CONTRATO_MD: contrato v$found_version → v$SLICES_CONTRACT_VERSION (estaba sin editar)"
      elif [ "$block_status" = unverifiable ] && [ "$FORCE" -eq 0 ]; then
        echo "aviso: no se ha podido comprobar si el contrato de slices de $CONTRATO_MD sigue tal cual lo dejó ct-init: esta máquina no tiene ni \`shasum\` ni \`sha256sum\`, y esa comprobación es lo único que impide pisar ediciones tuyas. No se toca nada — el bloque puede estar perfectamente intacto, simplemente no se sabe. Instala uno de los dos (coreutils trae \`sha256sum\`; \`shasum\` viene con perl) y repite, o pasa --force si te consta que ese fichero no lo has editado." >&2
        exit 3
      elif [ "$FORCE" -eq 1 ]; then
        replace_slices_block "$CONTRATO_MD"
        if [ "$block_status" = unverifiable ]; then
          echo "aviso: el contrato de slices de $CONTRATO_MD se ha sobrescrito con el contrato v$SLICES_CONTRACT_VERSION porque lo pediste con --force, SIN haber podido comprobar si estaba sin editar (esta máquina no tiene \`shasum\` ni \`sha256sum\`). Si había ediciones tuyas, ya no están: recupéralas del control de versiones." >&2
        else
          echo "aviso: el contrato de slices de $CONTRATO_MD no coincidía con ninguna versión que este ct-init sepa reconocer ($hash_note) y se ha sobrescrito con el contrato v$SLICES_CONTRACT_VERSION porque lo pediste con --force. Si había ediciones tuyas, ya no están: recupéralas del control de versiones." >&2
        fi
      else
        echo "aviso: el contrato de slices de $CONTRATO_MD es del contrato v$found_version (el actual es v$SLICES_CONTRACT_VERSION), pero su contenido no coincide con ninguno de los bloques que este ct-init sabe reconocer ($hash_note). Eso puede ser (a) una edición a mano, o (b) un bloque intacto sembrado por una versión del plugin cuyo hash este ct-init no lleva registrado — desde aquí NO hay forma de distinguirlas, así que no se toca nada por si es (a). Para salir de dudas, mira el historial de $CONTRATO_MD (\`git log -p -- docs/superpowers/CONTRATO-SLICES.md\`): si no se ha tocado desde que se creó, es (b) — repórtalo con ese hash para que quede registrado, y mientras tanto pasa --force junto a --update-slices-contract para adoptar el contrato v$SLICES_CONTRACT_VERSION (si SÍ había ediciones tuyas, se pierden)." >&2
        exit 3
      fi
    else
      case "$block_status" in
        pristine) update_note="Está exactamente como lo dejó ct-init, así que actualizarlo no pierde nada:" ;;
        unverifiable) update_note="No se ha podido comprobar si está sin editar (esta máquina no tiene ni \`shasum\` ni \`sha256sum\`), así que la actualización se negará hasta que lo instales:" ;;
        *) update_note="Su contenido no coincide con ningún bloque que este ct-init reconozca ($hash_note) — puede ser una edición tuya o una versión que no tiene registrada, así que la actualización se negará sin --force:" ;;
      esac
      echo "aviso: el contrato de slices de $CONTRATO_MD es del contrato v$found_version, y este plugin trae la v$SLICES_CONTRACT_VERSION — no se toca nada por defecto. $update_note bash $HERE/scripts/ct-init.sh $TARGET --update-slices-contract" >&2
    fi
  else
    echo "aviso: $CONTRATO_MD existe pero no lleva los marcadores del contrato ($SLICES_MARKER_OPEN … $SLICES_MARKER_CLOSE); no se toca nada para no pisar lo que sea que haya ahí. Si querías el contrato de este plugin, mueve ese fichero y vuelve a correr /ct-init." >&2
  fi
fi

# --- AGENTS.md: the short section, and the migration of the old contract ---
has_open=0; has_line "$SLICES_MARKER_OPEN" "$AGENTS_MD" && has_open=1 || true
has_close=0; has_line "$SLICES_MARKER_CLOSE" "$AGENTS_MD" && has_close=1 || true
has_heading=0
has_line "$SLICES_HEADING" "$AGENTS_MD" && has_heading=1 || true
# F30: the old heading counts as a trace. Otherwise, an AGENTS.md with the
# section as it was before the renaming and with no markers would stop being
# recognised and would receive a whole second copy (the failure the F2 review
# closed).
has_line "$SLICES_HEADING_LEGACY" "$AGENTS_MD" && has_heading=1 || true
if [ "$has_open" -eq 1 ] && [ "$has_close" -eq 1 ]; then
  # An AGENTS.md bootstrapped BEFORE #93: it carries the whole contract inside.
  # It is not touched by default —it may carry edits of its own, the same
  # doctrine as ever— but neither is it kept quiet about: it is ~39 KB that
  # every agent of this repo re-reads on every session and that are already
  # there, whole, in their own file.
  found_version="$(extract_slices_block "$AGENTS_MD" | grep -o "$SLICES_VERSION_LINE_RE" | head -n1 | grep -o '[0-9]\{1,\}' || true)"
  [ -z "$found_version" ] && found_version=1 # no version line = the original contract (pre-F6)
  compute_slices_block_hash "$AGENTS_MD"
  block_status="$(slices_block_status)"
  hash_note="hash del bloque presente: ${SLICES_BLOCK_HASH:-no calculable en esta máquina}"
  if [ "$UPDATE_SLICES_CONTRACT" -eq 1 ] && [ "$block_status" = pristine ]; then
    replace_slices_block "$AGENTS_MD" emit_loop_section
    echo "el contrato de slices sale de $AGENTS_MD (estaba sin editar, contrato v$found_version): vive ahora en $CONTRATO_MD y en su sitio queda la sección corta del loop, que enlaza a él. El resto del fichero no se ha tocado."
  elif [ "$UPDATE_SLICES_CONTRACT" -eq 1 ] && [ "$FORCE" -eq 1 ]; then
    replace_slices_block "$AGENTS_MD" emit_loop_section
    echo "aviso: el contrato de slices que llevaba $AGENTS_MD se ha sustituido por la sección corta del loop porque lo pediste con --force, sin haber podido dar por bueno su contenido ($hash_note). El contrato vive ahora en $CONTRATO_MD. Si había ediciones tuyas en ese bloque, ya no están: recupéralas del control de versiones." >&2
  elif [ "$UPDATE_SLICES_CONTRACT" -eq 1 ] && [ "$block_status" = unverifiable ]; then
    echo "aviso: no se ha podido comprobar si la sección del contrato de slices de $AGENTS_MD sigue tal cual la dejó ct-init: esta máquina no tiene ni \`shasum\` ni \`sha256sum\`, y esa comprobación es lo único que impide pisar ediciones tuyas. No se toca nada — el bloque puede estar perfectamente intacto, simplemente no se sabe. Instala uno de los dos (coreutils trae \`sha256sum\`; \`shasum\` viene con perl) y repite, o pasa --force si te consta que esa sección no la has editado." >&2
    exit 3
  elif [ "$UPDATE_SLICES_CONTRACT" -eq 1 ]; then
    echo "aviso: la sección del contrato de slices de $AGENTS_MD (contrato v$found_version) no coincide con ninguno de los bloques que este ct-init sabe reconocer ($hash_note), así que no se saca de ahí. Eso puede ser (a) una edición a mano de esa sección, o (b) un bloque intacto sembrado por una versión del plugin cuyo hash este ct-init no lleva registrado — desde aquí NO hay forma de distinguirlas, así que no se toca nada por si es (a). Para salir de dudas, mira el historial de $AGENTS_MD (\`git log -p -- AGENTS.md\`): si esa sección no se ha tocado desde que se creó, es (b) — repórtalo con ese hash para que quede registrado, y mientras tanto pasa --force junto a --update-slices-contract para sustituirla por la sección corta (si SÍ había ediciones tuyas, se pierden)." >&2
    exit 3
  else
    case "$block_status" in
      pristine) update_note="Está exactamente como la dejó ct-init, así que sacarla no pierde nada:" ;;
      unverifiable) update_note="No se ha podido comprobar si está sin editar (esta máquina no tiene ni \`shasum\` ni \`sha256sum\`), así que la sustitución se negará hasta que lo instales:" ;;
      *) update_note="Su contenido no coincide con ningún bloque que este ct-init reconozca ($hash_note) — puede ser una edición tuya o una versión que no tiene registrada, así que la sustitución se negará sin --force:" ;;
    esac
    echo "aviso: $AGENTS_MD todavía lleva DENTRO el contrato de la tabla de slices (contrato v$found_version). Desde esta versión el contrato vive en su propio fichero, $CONTRATO_MD —ya sembrado, con la versión de este plugin— y en AGENTS.md basta con la sección corta que enlaza a él: lo que hay ahí dentro son decenas de KB que cada agente de este repo relee en cada sesión sin necesitarlos. No se toca nada por defecto. $update_note bash $HERE/scripts/ct-init.sh $TARGET --update-slices-contract" >&2
  fi
elif [ "$has_open" -eq 1 ] || [ "$has_close" -eq 1 ] || [ "$has_heading" -eq 1 ]; then
  echo "aviso: $AGENTS_MD parece tener restos parciales de la sección del contrato de slices (contrato /ct-groom) — falta el marcador de apertura, el de cierre, o ambos no acompañan al heading; no se añade nada para no duplicar contenido. Revisa $AGENTS_MD a mano: si la sección sigue siendo válida, complétala con '$SLICES_MARKER_OPEN' antes del heading y '$SLICES_MARKER_CLOSE' al final." >&2
fi

# The loop's short section. It is added if it is missing, with the same idiom as
# the rest of this script's seedings (a trailing newline made sure of before the
# `>>`, CRLF if the file is already CRLF). It is not added when the AGENTS.md
# still carries the whole contract inside: there the short section would be a
# second copy of the same information, and that case already has its warning
# above, with its remedy.
if has_line "$LOOP_MARKER_OPEN" "$AGENTS_MD"; then
  echo "sección del loop ya está en $AGENTS_MD, no se duplica"
elif has_line "$SLICES_MARKER_OPEN" "$AGENTS_MD"; then
  : # the old contract is still inside; the warning above says how to get out of there
else
  loop_crlf=0
  if [ -s "$AGENTS_MD" ] && file_is_crlf "$AGENTS_MD"; then loop_crlf=1; fi
  if [ -s "$AGENTS_MD" ] && [ "$(tail -c1 "$AGENTS_MD" | wc -l)" -eq 0 ]; then
    if [ "$loop_crlf" -eq 1 ]; then printf '\r\n' >> "$AGENTS_MD"; else echo >> "$AGENTS_MD"; fi
  fi
  if [ "$loop_crlf" -eq 1 ]; then printf '\r\n' >> "$AGENTS_MD"; else echo >> "$AGENTS_MD"; fi
  if [ "$loop_crlf" -eq 1 ]; then
    emit_loop_section | awk '{ printf "%s\r\n", $0 }' >> "$AGENTS_MD"
  else
    emit_loop_section >> "$AGENTS_MD"
  fi
  echo "añadida sección del loop (enlaza al contrato de slices) a $AGENTS_MD"
fi

# The "Cómo se atraviesa este repo (e2e)" section — task 5 of "e2e al cierre
# del slice". The `e2e` gate (gates.js) sends the dispatched agent to read HERE,
# by its exact heading, how this repo is brought up: the plugin governs other
# people's repos and has no way of knowing (in a Rust library it may be `cargo
# run --example` and a port; in an app with staging, a browser and a few flags).
# The repo's owner declares it, just as they already declare build/test/lint in
# the sections above — which is why it is seeded EMPTY, as a template.
#
# It reuses the idiom of the contract block above (a greppable HTML marker, a
# `has_line` tolerant of CRLF) but, ON PURPOSE, it carries neither a version
# number nor a hash in SLICES_PRISTINE_HASHES. Those two exist in order to
# resolve the same question in the block above: "has the user touched something
# they were not supposed to touch?" — and there a hash that does not match is
# the correct alarm signal. Here the question makes no sense: this section is a
# TEMPLATE the user HAS to fill in, so detecting "the text changed" would be
# detecting correct use and treating it as tampering — the plugin would stop
# recognising it precisely when it is being used properly. Same mechanism,
# opposite purpose: here the simple rule "if the opening marker is already
# there, nothing is touched" is enough, with no version to raise and no content
# to compare.
E2E_MARKER_OPEN='<!-- ct-init:e2e-howto -->'
E2E_MARKER_CLOSE='<!-- /ct-init:e2e-howto -->'

if has_line "$E2E_MARKER_OPEN" "$AGENTS_MD"; then
  echo "sección de travesía e2e ya está en $AGENTS_MD, no se duplica"
else
  # Just like replace_slices_block: if the AGENTS.md is already CRLF,
  # EVERYTHING that gets added (the extra newline, the blank line, and the
  # block) is written with the same line endings — no leaving the file with half
  # of it in one format and half in another.
  e2e_crlf=0
  if [ -s "$AGENTS_MD" ] && file_is_crlf "$AGENTS_MD"; then e2e_crlf=1; fi
  newline() { if [ "$e2e_crlf" -eq 1 ]; then printf '\r\n' >> "$AGENTS_MD"; else echo >> "$AGENTS_MD"; fi; }
  # Same idiom as the two seedings above: make sure of the trailing newline
  # BEFORE the `>>`, so as not to merge this section with the last line of what
  # the user (or the previous seeding of this very run) already had.
  if [ -s "$AGENTS_MD" ] && [ "$(tail -c1 "$AGENTS_MD" | wc -l)" -eq 0 ]; then
    newline
  fi
  newline
  if [ "$e2e_crlf" -eq 1 ]; then
    emit_e2e_howto | awk '{ printf "%s\r\n", $0 }' >> "$AGENTS_MD"
  else
    emit_e2e_howto >> "$AGENTS_MD"
  fi
  echo "añadida sección de travesía e2e a $AGENTS_MD"
fi

# §3.12 (docs/prompt-juez-lo-que-queda.md): `reference-paths` proves that what
# §3 cited EXISTS, but nothing proved that EVERYTHING relevant was cited — a
# `docs/conventions/` that is indeed in the repo passed the validator clean by
# omission. This sweep is deterministic and offline and its only product is a
# LIST: it does not write in .agent/conventions.md, it declares nothing and it
# adds no human gate — the confirmation is the one that already exists, the
# person who is running /ct-init. It goes over STDOUT and not over stderr on
# purpose: it is not an alarm about a conflict, it is material for a decision,
# just like the "creado ..." lines. (And there is a test that requires the
# second run not to write a single "aviso" over stderr.)
VARA_STATUS=0
VARA_OUT=''
if command -v node >/dev/null 2>&1; then
  VARA_OUT="$(node "$HERE/scripts/detect-vara.mjs" "$TARGET" 2>/dev/null)" || VARA_STATUS=$?
else
  VARA_STATUS=127
fi
if [ "$VARA_STATUS" -ne 0 ]; then
  echo "no se ha podido barrer este repo en busca de candidatos a la vara (.agent/conventions.md): la comprobación necesita \`node\` y no se ha podido ejecutar (estado $VARA_STATUS). NO lo leas como \"este repo no tiene convenciones escritas\": no se ha mirado." >&2
elif [ -n "$VARA_OUT" ]; then
  printf '%s\n' "$VARA_OUT"
fi

# F11, part B: until now ct-init bootstrapped ON TOP OF whatever conventions
# the repo already had, without finding out. The real case (menoplus): the repo
# already brought `scripts/dispatch-check.sh` with its line in AGENTS.md
# ordering it to be run, and a `git worktree add .claude/worktrees/<slug>`
# convention with a hook watching over it. The plugin brings ITS OWN
# dispatch-check.mjs and uses `.worktrees/<n>`/`feat/<n>`, and this section was
# written right beside the one that was already there: the AGENTS.md ended up
# contradicting itself in two places, and two claim protocols were left
# operating over the same label space with nobody arbitrating. That cannot
# happen IN SILENCE again.
#
# It WARNS; it does not abort and it changes nothing: the decision (which of the
# two rules) is the user's and there is none ct-init can take for them without
# breaking something. That is also why it goes on exiting 0 — the bootstrap has
# done its job.
#
# The detection lives in node (scripts/conventions.js, pure logic + tests) and
# not here, so that ct-next.mjs can use EXACTLY the same one and the two
# warnings cannot diverge. If node is not there, or the scan fails, it is said:
# a silence here would be indistinguishable from "a clean repo", and that is
# precisely the false negative that costs a deadlock.
CONV_STATUS=0
CONV_OUT=''
if command -v node >/dev/null 2>&1; then
  CONV_OUT="$(node "$HERE/scripts/detect-conventions.mjs" "$TARGET" 2>/dev/null)" || CONV_STATUS=$?
else
  CONV_STATUS=127
fi
if [ "$CONV_STATUS" -ne 0 ]; then
  echo "aviso: no se ha podido comprobar si este repo ya tiene convenciones propias (claim, worktrees, fichero de estado) que choquen con las del loop — la comprobación necesita \`node\` y no se ha podido ejecutar (estado $CONV_STATUS). NO lo leas como \"no hay ninguna\": no se ha mirado. Si este repo ya traía su propio script de claim o su propia ruta de worktrees, revísalo a mano antes de correr /ct-next." >&2
elif [ -n "$CONV_OUT" ]; then
  printf '%s\n' "$CONV_OUT" >&2
fi
