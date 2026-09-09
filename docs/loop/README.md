# The loop document — source and derivatives

Reference document for Control Tower's development cycle: the 16 steps, the 3
human gates, the state machine of a slice, and the exact format of the 11
artefacts that travel between steps.

## The files

| File | What it is | Edited by hand? |
|---|---|---|
| `loop.body.html` | **The source.** HTML fragment (no `<html>`/`<head>`/`<body>`) — it is also what gets published as an Artifact, and that is why it cannot carry them | **yes, it is the only one that gets edited** |
| `build.mjs` | The generator of the two derivatives | yes |
| `control-tower-loop.html` | Derivative: self-contained page, a single file, with no network dependencies | **no** — it is regenerated |
| `control-tower-loop.pdf` | Derivative: 29 A4 pages, for sharing and printing | **no** — it is regenerated |

The derivatives are **tracked**, the same criterion as `dist/` in this repo:
every change to `loop.body.html` has to carry them rebuilt **in the same
commit**, or an old version ships while the source already says something else.

## Rebuilding

```bash
node docs/loop/build.mjs          # HTML + PDF   (~14 s)
node docs/loop/build.mjs --html   # HTML only    (needs no browser)
```

The PDF is printed with Chrome/Brave/Chromium/Edge in headless mode. If none is
installed, the HTML is still generated and the script says so — it does not emit
half a PDF.

**Why the script waits for the file and not for the browser:** measured on this
machine, `--print-to-pdf` leaves the complete PDF on disk after ~2 s but the
process stays alive for a good two minutes (it wakes the updater, which inherits
the descriptors). Waiting for the process to exit gave an `ETIMEDOUT` over a
perfectly written PDF — a failure reported over a success. Now the file's size
is polled until it stops growing, and then the browser is killed.

The print stylesheet lives in `build.mjs`, not in the source: the source is
published as a web page and is never printed, so mixing them would force whoever
only edits content to read pagination rules.

## The Artifact

The same source is published as a private page on claude.ai:

<https://claude.ai/code/artifact/d06f6ba2-d67a-4c23-a113-15c782690759>

To update it without changing the URL, you have to publish **passing that URL**
explicitly: publishing without it creates a new artifact instead of updating the
one that has already been shared.

## The per-command references

Since sub-issue #93 each `plugin/commands/*.md` keeps only what the model needs
when invoking the command —the invocation, a table of exit codes and a link
here— and the long prose (the mechanisms, their limits and the history of the
decisions, rounds F5…F38) lives in this directory, one file per command, moved
whole and unsummarised:

| Command | Reference |
|---|---|
| `/ct-init` | [`ct-init.md`](ct-init.md) |
| `/ct-groom` | [`ct-groom.md`](ct-groom.md) |
| `/ct-next` | [`ct-next.md`](ct-next.md) |
| `/ct-status` | [`ct-status.md`](ct-status.md) |
| `/ct-harvest` | [`ct-harvest.md`](ct-harvest.md) |

They are documents of this repo, not of the plugin: they do not ship and they
are not loaded into any session's context. `__tests__/ct-init.test.js` reads
`ct-groom.md` to check that the rule for the `Señal` column says the same thing
here, in the seeded contract and in the slice judge.

## Provenance of the content

Every format on the page comes from the source that emits it, not from a
second-hand description:

- the `commands/*.md` and, since #93, their long references in this directory
  (`ct-init`, `ct-groom`, `ct-next`, `ct-status`, `ct-harvest`);
- the skills forked from `skills/` (`brainstorming`, `writing-plans`,
  `finishing-a-development-branch`, `subagent-driven-development`) and `skills/FORK.md`;
- `scripts/groom.js` — `buildIssueTitle`, `buildLabels`, `buildIssueBody`;
- `scripts/kickoff.js` — `renderKickoff`, `buildStateSeed`, `ADDENDA`;
- `scripts/ct-init.sh` — the slices table contract (v16 when the document was
  written; since #93 it is seeded into
  `docs/superpowers/CONTRATO-SLICES.md` of the target repo, not into `AGENTS.md`);
- `skills/state-template/STATE.template.md`;
- `hooks/hooks.json`;
- `templates/_TEMPLATE-execution-spec.md` — the execution spec template.
  It already travels with the plugin: `ct-init` seeds it into
  `docs/superpowers/specs/_TEMPLATE-execution-spec.md` of the target repo, which
  is where `skills/brainstorming/SKILL.md` looks for it. It used to live loose in
  menoplus, and step 8 of brainstorming was left without a source in any other
  repo.

**When any of those sources changes, this document goes stale and nothing checks
it.** There is no test watching it; it is a document, not code.
