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
SLICES_HEADING='## Slices table format (contract with /ct-groom)'
# F30 / #188 — the OLD headings are still recognised, and they are never emitted.
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
# #188 — and the Spanish spelling of the CURRENT heading, seeded from v16 to v23.
# A repo bootstrapped in that window carries it, and the same edge the F30 block
# above describes applies unchanged: without this line, an AGENTS.md with that
# heading and no markers stops being recognised and receives a whole second copy.
SLICES_HEADING_LEGACY_ES='## Formato de la tabla de slices (contrato con /ct-groom)'
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
SLICES_CONTRACT_VERSION=24
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
9962d000dbfc62db370c61ad8015321cc73eb336ad8e8ac0567fa9a4ef414b8c  v24, 601 lines — #188 (the contract is translated into English; the parsed column names, the headings the code locates sections by and every value compared as data stay exactly as they were)
'

# emit_slices_contract: the block, in a single place (both the "it does not
# exist, it gets added" path and the "--update-slices-contract" one use it).
emit_slices_contract() {
  cat <<'EOF'
<!-- ct-init:slices-contract -->
<!-- ct-init:slices-contract-version: 24 -->
## Slices table format (contract with /ct-groom)
`/ct-groom` reads this table from the epic's spec and creates one GitHub issue
per row — it is the only part of a spec that a program parses. Exact header,
copyable as is:

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|

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
  the epic's telemetry.
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
  If no slice of the epic needs e2e, the way out is not to add the column at
  all — that way no row has to decide anything.

"No value" markers (`Dep`/`Acepta`/`Protegido`/`Área`/`Toca`/`Gate`/`Señal`):
`–` `-` `—` `―` `−` `--` or an empty cell — any dash variant works.
`E2E` uses the same set of markers, with the caveat above: they are only
harmless when the column is not present.

### What `/ct-groom` creates is NOT dispatchable yet

Every issue is born with **`status:backlog`**, and `/ct-next` only dispatches
`status:ready`. Promoting them is a **human and deliberate** step — it is the gate
of the loop: you decide what goes in flight and when, the groom never does it for
you. If `/ct-next` answers "there are no dispatchable slices" right after
grooming a whole epic, this is why:

```
gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:backlog
```

`/ct-groom` reminds you when it finishes how many issues of the epic are still in backlog.
From then on the `status:` label is moved by `/ct-next` and the flow
(`ready` → `in-progress` → `in-review`, and back to `ready` if the review
rejects the PR — see "Rejecting a PR" further down), not by the spec — which is why
re-grooming never compares it nor reverts it.

### Decisions of yours that depend on how `/ct-groom` is invoked

- **`--milestone "<title>"`** (default `Epic`): one invocation = one epic
  = one milestone, which `/ct-groom` creates if it does not exist. The `#` of this table are
  unique **within their milestone**, not within the repo: two different epics can
  use `#1` without stepping on each other. But if two epics share a milestone (e.g. both
  with the default title `Epic`), their orders clash and `/ct-next` excludes
  that whole epic from the selection, with a warning. Give each epic its own
  milestone title.
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
on the inside and the most visible thing in the epic on the outside. Row 3 declares nothing and
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
another epic, or `/ct-groom` stops dead with **exit 1** without creating or modifying
anything, or it creates a new issue for that slice, warning that it may be
duplicating it. A practical consequence of that same scope: **the slices table of
each spec can start at `1`** without stepping on the issues of an earlier epic.
See "The scope of a groom is its epic, not the repo" in `docs/loop/ct-groom.md` (plugin repo).

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
  of the whole epic — nothing behind it advances until THAT one is
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
- **`/ct-next` does not scope by epic.** It accepts `--repo`, `--cap`, `--base` and
  `--dry-run`; **there is no `--milestone`**. It sweeps every open issue of the
  repo and chooses by the lowest `#` of the table, whichever epic it comes from (that
  `#` is indeed resolved within its own milestone in order to translate `Dep`, but
  the SELECTION is not scoped). With two epics alive, the `#1` of the second beats
  the `#3` of the first — and if both have a dispatchable `#1`, **which one comes
  out first is undefined**: it depends on the order in which GitHub returns the
  issues. The lever for deciding which epic advances is the one you already have:
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

<sub>This contract is maintained by `/ct-init` (contract v24) and lives in
`docs/superpowers/SLICES-CONTRACT.md` of this repo — or in
`docs/superpowers/CONTRATO-SLICES.md` if the repository was seeded before v24,
where it is kept and updated under that name; `AGENTS.md` only links to it. If the plugin brings a newer version, `/ct-init` warns about it when running;
to adopt it: `bash <plugin>/scripts/ct-init.sh <repo-dir>
--update-slices-contract`, which only replaces it if you have not edited it by hand.</sub>
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
#     `conventions.js`'s pruning and `repo-yardstick.js`'s discount seeing it by its
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
# #188 — the file is emitted as SLICES-CONTRACT.md, and a repo that already
# carries the Spanish name goes on being recognised AT THAT NAME. It is not
# renamed for them: a rename is a move of a file this script does not own (it
# may be linked from their own docs, cited in a review, open in somebody's
# editor), and the doctrine here has always been that ct-init edits what it
# seeded and warns about the rest. Same shape as SLICES_HEADING_LEGACY: a closed
# set of recognised names, only one of them emitted.
CONTRATO_MD_LEGACY="$CONTRATO_DIR/CONTRATO-SLICES.md"
if [ -f "$CONTRATO_MD_LEGACY" ]; then
  CONTRATO_MD="$CONTRATO_MD_LEGACY"
else
  CONTRATO_MD="$CONTRATO_DIR/SLICES-CONTRACT.md"
fi
LOOP_MARKER_OPEN='<!-- ct-init:loop -->'
LOOP_MARKER_CLOSE='<!-- /ct-init:loop -->'

# emit_loop_section: the ~20 lines of the loop an agent does read. With no
# version and no pristine hash, for the same reason as the e2e traversal
# section: it brings gaps the repo HAS to fill in (the commands), so detecting
# "the text changed" would be detecting correct use.
emit_loop_section() {
  # #188: everything in this heredoc is literal on purpose — nothing here should
  # expand by accident — so the one value that differs per repository (the
  # contract's filename, English for a fresh repo and Spanish for one seeded
  # before v24) is substituted afterwards instead of unquoting the document.
  emit_loop_section_body | sed "s|CONTRATO_BASENAME_PLACEHOLDER|$(basename "$CONTRATO_MD")|g"
}

emit_loop_section_body() {
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
  [`docs/superpowers/CONTRATO_BASENAME_PLACEHOLDER`](docs/superpowers/CONTRATO_BASENAME_PLACEHOLDER)**:
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
has_line "$SLICES_HEADING_LEGACY_ES" "$AGENTS_MD" && has_heading=1 || true
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
YARDSTICK_STATUS=0
YARDSTICK_OUT=''
if command -v node >/dev/null 2>&1; then
  YARDSTICK_OUT="$(node "$HERE/scripts/detect-yardstick.mjs" "$TARGET" 2>/dev/null)" || YARDSTICK_STATUS=$?
else
  YARDSTICK_STATUS=127
fi
if [ "$YARDSTICK_STATUS" -ne 0 ]; then
  echo "could not sweep this repo for yardstick candidates (.agent/conventions.md): the check needs \`node\` and could not be run (status $YARDSTICK_STATUS). Do NOT read it as \"this repo has no written conventions\": nobody looked." >&2
elif [ -n "$YARDSTICK_OUT" ]; then
  printf '%s\n' "$YARDSTICK_OUT"
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
