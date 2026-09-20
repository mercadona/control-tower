<!-- Moved out of `CLAUDE.md` and `AGENTS.md` so those fit the 150 lines they
ask for. Nothing here was rewritten: the sections below are the text those two
documents carried, word for word. The rule itself, and the table of which
surface speaks which language, stay there. -->

# The language rule, in full

## The one exemption: what a person reads in the product

`plugin/conventions/style.md` already draws this line and this repository keeps
it exactly where it is:

> This does not cover text an end user reads. Product copy, labels, and any
> message surfaced in a user-facing interface are not this document's business:
> their language is the product's decision, not this rule's.

Control Tower's interface is read by Spanish-speaking engineers. The strings in
`frontend/src/` that reach the screen — field labels, banners, progress text,
error copy — stay in Spanish until the product decides otherwise. That decision
is not a style decision and no agent takes it while translating.

The exemption is narrow. It covers **what renders**, not the code around it: the
component's name, its props, its test names, its `__scenarios__` mothers and any
message that only ever reaches a log are all English.

## The second exemption: values fixed by a contract

A string that an external system decides keeps that system's spelling. The GitHub
labels of the loop's ladder (`status:backlog`, `status:ready`,
`status:in-progress`, `status:in-review`, `status:blocked`, `status:rejected`,
`gate:none`) are already English and do not move. Neither do the block markers
`ct-init` writes into governed repositories (`<!-- ct-init:slices-contract -->`),
the YAML keys of `.agent/STATE.md`, or the paths that code validates against —
`docs/superpowers/plans` is checked by `plan-contract-progress.ts` and read by
`task-brief.test.js`; it is a contract, not a name you are free to translate.

### The parsed headings — Spanish, and contract until a coordinated change

Ten markdown headings are anchors the code locates sections by. They read as
prose and they are still Spanish, and they are contract anyway:

| Heading | Pinned at |
|---|---|
| `## Contexto del epic` written, `## Contexto del milestone` read too | `plugin/scripts/milestone-context.js` `MilestoneContextHeading` |
| `## Contexto heredado` | `plugin/scripts/groom.js` `INHERITED_CONTEXT_HEADING` |
| `## Decisiones congeladas` | `plugin/scripts/groom.js` `FROZEN_DECISIONS_HEADING` |
| `## Dependencias` | `plugin/scripts/gh-issue-map.js` `DEPS_HEADING` |
| `## Acceptance criteria (EARS, 1:1 con tests)` | `backend/src/infrastructure/gh-plan-issues.ts` `AC_HEADING` |
| `## Descripción`, `## Hipótesis`, `## Señal de observabilidad`, the judge's telemetry heading, `## Current State` with its dispatched-slice subtitle | literals in `plugin/scripts` and `backend/src` |

Each lives in three places at once: the constant, the body of every live GitHub
issue, and every governed repository's spec. Translating one is a coordinated
change of all three in a single move — otherwise `/ct-groom --reconcile` stops
finding the section and dispatch breaks. **Until that change happens they stay
Spanish everywhere, issues and pull requests included.**

#### The first row is the one that already moved, and how

Issue #346 renamed the milestone's context heading without touching a single
issue or spec, and the shape it used is the shape any of the other nine would
have to use. It is a **dual read with a deferred write**:

- what is **read** accepts **both** `## Contexto del epic` and
  `## Contexto del milestone` — a body or a spec carrying either is found,
  hydrated from, and reports **no drift for the spelling alone**. That is what
  leaves the already groomed issues and the frozen specs where they are;
- what is **written** into an issue is still `## Contexto del epic`. See the
  rule below: this is not indecision, it is the only spelling that is safe to
  write today;
- `--reconcile` brings the section's **content** up to date under whichever
  spelling it finds, and leaves that spelling as it is. It writes
  `MilestoneContextHeading.WRITTEN` only when inserting the section from
  scratch;
- **both spellings in one body is a finding**, never a silent choice between
  them. Every reader here takes the first occurrence, so the text under the
  other one would be read by nobody while looking to a human like context that
  is honoured. In a spec it comes out as the malformed reason, which authorises
  touching nothing; in an issue it comes out as a note naming both.

#### The rule a rename of any of these ten has to obey

**No issue may be written with a heading that the gate installed where it will
be checked cannot read.** A reader inside this repository is updated by
merging. A reader **vendored into somebody else's repository is not**:
`plugin/scripts/build.mjs` bundles `scope.js` into `plugin/dist/scope-check.js`
and `ct-init` seeds that bundle into each governed repository, where it runs in
that repository's own CI with no plugin installed. A copy seeded before #346
recognises `## Contexto del epic` and nothing else, so writing the new spelling
fails the scope gate of every new issue in a repository we cannot fix by
merging — and it fails for a reason that has nothing to do with the work,
because the gate cannot find the section that declares the scope.

**The switch, and who checks what.** The flip is one line —
`WRITTEN: MILESTONE_HEADING` in `plugin/scripts/milestone-context.js` — and
every writer follows it. Before flipping it, confirm that every governed
repository has re-vendored a `dist/scope-check.js` that accepts both spellings
(the one this repository ships does). The list of governed repositories is not
in this tree, so that is a person's check, not a grep's;
`plugin/__tests__/milestone-context.test.js` pins what is written today so the
flip cannot happen by accident.

**Retiring `## Contexto del epic` is a third decision**, later than the flip and
different from it: it needs evidence that no live issue and no spec a
`/ct-groom --reconcile` could still touch carries it. Both spellings live in
`plugin/scripts/milestone-context.js` and nowhere else — `groom.js` re-exports
them, `gh-issue-map.js` reads which one an issue carries so the kickoff can name
the section the dispatched agent will actually find, and `scope.js` reads them
inside the vendored gate. Whoever retires the spelling does it there, once, and
the four readers follow.

The plan's own sections (`## 7. Tasks`, `## 8. Global verification`,
`**Objective:**`, `**Files:**`, `**TDD:**`, `**Tests:**`, `**Verification:**`)
are already English and are not affected.

## This repository does not take the declared-debt exemption for language

`plugin/conventions/style.md` grants one exemption in the whole travelling
yardstick: a module that was already there and does not conform is the
repository's **declared debt**, and what you add to it may follow the style of
its host — *"half a migration reads worse than none."*

That clause exists for the repositories Control Tower governs, which arrive with
their own history. **It does not shelter this one.** The precedent is
`backend/conventions/this-repository.md`, which already refuses the same
exemption for `backend/`; this document extends the refusal to the whole
repository and to the language rule specifically.

The yardstick's other two rules — no prose in the code, and no free function at
module level — keep their exemption here. They are a different piece of work.

While Spanish modules remain, they are debt being paid down, not licence: a diff
that touches one leaves it in English, and a new module is born in English with
no exemption to claim.

## The vocabulary is decided, not improvised

`docs/glossary.md` maps every Spanish domain term this repository still carries to
the English term already in use somewhere in the tree. It is extraction, not
invention: the English vocabulary is established in
`backend/conventions/this-repository.md`, in the eight English documents of
`plugin/conventions/`, and in the script filenames that already carry it —
`plugin-yardstick.js`, `harvest.js`, `dispatch.js`, `reconcile.js`, `scope.js`,
`claim.js`, `step-contracts.js`.

Read it before you rename anything. A term translated two ways is worse than a
term left in Spanish, because the second is visibly debt and the first looks
finished.

## The historical record is not translated

`docs/superpowers/plans/` and `docs/superpowers/specs/` hold dated plans and
design documents, and `docs/prompt-*.md` holds the prompts of sessions that
already happened. They are the minutes of decisions already taken. Translating
them would rewrite what was actually written at the time, so they stay in
Spanish and keep their filenames.

**New** plans, specs and documents are written in English. The rule binds
forward, and the same applies to git history: past commit messages stay as they
were written and nothing here rewrites them.
