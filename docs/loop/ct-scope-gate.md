# The scope conformance gate (`ct-scope-gate`)

> Moved out of `plugin/templates/scope-gate.yml` (sub-issue #93). No code ever copied that template —`ct-init` does not vendor it and no hook imports it—, so it travelled in every installation of the plugin without anyone reading it from there. The workflow is installed by hand, and the place for an instruction that is followed by hand is the repository's documentation, not the package that gets distributed. The bundle it runs, `plugin/dist/scope-check.js`, is still built and tracked as it always was (`plugin/scripts/build.mjs`, `plugin/__tests__/dist-coherente-con-fuentes.test.js`).

The content, in full:

```yaml
# Scope conformance gate — Control Tower loop
#
# WHAT IT DOES: fails the PR if it touches files OUTSIDE the scope its epic
# declared in the `Alcance:` line of `## Contexto del epic`.
#
# WHY IT LIVES HERE AND NOT IN THE PLUGIN: the dispatched agent runs with the
# operator's GitHub credentials, so it can fabricate any GitHub artefact — a
# review, an approval, an authorisation comment. Its record is prose nobody
# cross-checks. What it CANNOT falsify without it showing is which files it
# touched. This check judges that fact.
#
# WHY NOT IN `dispatch-check --release`: that one is invoked by the agent
# itself. A guard the suspect runs is not a guard.
#
# HOW IT IS INSTALLED:
#   1. Copy this file to `.github/workflows/ct-scope-gate.yml`.
#   2. Copy the plugin's `dist/scope-check.js` bundle to `.github/ct/scope-check.js`
#      (it is self-contained: it needs neither the plugin nor node_modules in CI).
#   3. Add `ct-scope-gate` as a REQUIRED CHECK in the default branch's
#      protection. Without that step the check shows red but still lets the merge
#      through — and relying on a human to look is exactly the failure this gate
#      comes to close.
#
# TUNE `--exempt` to your repo's own bookkeeping (a ledger, a logbook): files
# YOUR conventions force every slice to touch. The loop's own exemptions
# (`docs/superpowers/plans/**` and `docs/superpowers/specs/**`) already come as
# standard and do not have to be repeated.
name: ct-scope-gate

on:
  pull_request:
    types: [opened, synchronize, reopened, edited]

# Read only: this workflow writes nothing to the repo or to the PR. Its only
# product is its own status (green/red).
permissions:
  contents: read
  pull-requests: read
  issues: read

jobs:
  scope:
    name: ct-scope-gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check that the PR fits inside its epic's scope
        env:
          # `gh` uses this token. With read-only `permissions`, the workflow
          # itself cannot widen its own permissions from the PR.
          GH_TOKEN: ${{ github.token }}
        run: |
          node .github/ct/scope-check.js \
            --repo "${{ github.repository }}" \
            --pr "${{ github.event.pull_request.number }}"
```
