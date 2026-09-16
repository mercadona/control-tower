# The scope conformance gate (`ct-scope-gate`)

> Moved out of `plugin/templates/scope-gate.yml` (sub-issue #93) because no code
> ever copied that template, and moved back into one (sub-issue #376) because now
> something does. The workflow lives at
> `plugin/templates/ct-scope-gate.workflow.yml` and that file is the only copy:
> `/ct-init` vendors it, and this document describes it instead of repeating it.
> A second copy inside a fenced block here is a copy free to drift from the one
> anybody actually installs.

## What it judges

It fails the pull request if it touches files **outside** the scope its milestone
declared in the `Alcance:` line of the milestone's context section.

The reason it runs in CI and not in the plugin is in the template's own header,
and it is worth repeating here: the dispatched agent runs with the operator's
GitHub credentials, so it can fabricate any GitHub artefact — a review, an
approval, an authorisation comment. What it cannot falsify without it showing is
which files it touched. And the reason it is not part of
`dispatch-check --release` is that the agent invokes that one itself. A guard the
suspect runs is not a guard.

## How it is installed

`/ct-init` puts both files in place, in the repository it bootstraps:

| Path | From |
|---|---|
| `.github/workflows/ct-scope-gate.yml` | `plugin/templates/ct-scope-gate.workflow.yml` |
| `.github/ct/scope-check.js` | `plugin/dist/scope-check.js` |

Both are **committed** in that repository. A workflow only runs from a committed
file, and the bundle is built self-contained on purpose — in CI it needs neither
the plugin nor `node_modules`.

Neither is overwritten if it is already there. The bundle gets one check the rest
of the scaffolding does not: its bytes are compared against the copy the plugin
ships, and a difference is reported. It is a generated file, so a difference
means the repository's copy is from another version, not that somebody edited it.
That matters because of #346: a bundle vendored before it recognises
`## Contexto del epic` and nothing else, so it fails the gate of every new issue
over a section it cannot find, and no merge in this repository fixes it. Updating
it is `/ct-init --force`.

## The one step left to a person

Add `ct-scope-gate` as a **required check** in the default branch's protection.

Without it the check shows red and still lets the merge through, and relying on
somebody to look is exactly the failure this gate comes to close. It is not
automated on purpose: it needs admin rights over the repository, and a scaffolder
does not change a branch protection on its own.

## Tuning it

`--exempt` takes the files your own conventions force every slice to touch — a
ledger, a logbook. The loop's own exemptions,
`docs/superpowers/plans/**` and `docs/superpowers/specs/**`, already come as
standard and do not have to be repeated.
