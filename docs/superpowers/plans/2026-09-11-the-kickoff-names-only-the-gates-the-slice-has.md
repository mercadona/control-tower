# The kickoff names only the gates the slice has

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them.

## 1. Context and goal

Two defects, both of them a promise the system makes and does not keep.

**One.** `renderKickoff` (`plugin/scripts/kickoff.js`) joins an array of lines. Line 276 is an
UNCONDITIONAL element of that array and it opens with *"Con el plan commiteado y el gate 'plan'
con OK humano…"*. The gates the slice really carries travel SEPARATELY, in `...gateLines` (line
278), built at line 169 out of `renderGateKickoffLines(resolveGatesForAgent(slice))`. So a slice
whose gates leave `plan` out is still told to wait for a human OK that nobody will give: nothing
blocks it mechanically (`run-machine.js` has no go step, and `dispatch-check --release` demands
the go only when the issue carries the `plan` label), but the dispatched agent is told to stop.
Measured today with `node plugin/scripts/ct-next.mjs --repo mercadona/control-tower --cap 1
--dry-run`: issue #326 is seeded `gates: ninguno` and its kickoff still carries the sentence.
The epic groomed as milestone `start-in-correct-loop` makes that the normal case, not the
exception.

**Two.** That same dry-run prints an `ATTENTION` block from `plugin/scripts/conventions.js`: the
`claim` signal, with three pieces of evidence (`README.md:8`, and lines 59 and 66 of
`backend/conventions/this-repository.md`). The decision is already taken here and it is the
scanner's option (c) — the backend decides WHEN, the plugin's dispatch-check performs the act —
it has simply never been written down where the scanner reads acknowledgements.

### Desired end state

- A slice whose resolved gates leave `plan` out receives the run-machine sequence with no human
  OK named in it; a slice that carries the `plan` gate receives exactly the sentence it receives
  today.
- The run-machine sequence itself — ct-step next, report, controls, judge, verdict, commit,
  reconcile, global, slice-verdict, back to `next` until "run delivered" — reaches the agent
  word for word in both branches, out of ONE piece of text.
- The repository acknowledges the `claim` signal, so the dry-run above prints no `ATTENTION`
  block and prints instead the one-line `note: [claim] silenced by …`.
- `npm test --prefix plugin` stays green, with no existing assertion weakened.

### Out of scope

The go protocol is not retired (declared debt A-3 of the frozen spec, 17 production files). The
defaults of `plugin/scripts/gates.js` are not touched (that is slice 1 of the epic, issue #326).
`run-machine.js`, `ct-step.mjs`, `dispatch-check.mjs` and `ct-next.mjs` are not touched. The
`worktrees`, `estado` and `residuo-status` signals are not acknowledged: only `claim` is decided.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Language of the kickoff prose | The new and edited kickoff sentences stay in SPANISH, like their twenty neighbours. The surgical option was chosen over translating the module; the language debt is accepted as it is. Test names, identifiers, this plan and the commit messages are English. |
| Scope | Exactly the two items above. Nothing else is touched. |
| The surviving job | The run-machine sequence of today's line 276 keeps reaching the agent verbatim in both branches. Only the promise of a human OK on the `plan` gate is conditional. |
| Where the question is asked | `resolveGatesForAgent(slice)` is called ONCE in `renderKickoff` and its array is asked `gates.includes('plan')`. The gate set is not resolved a second time. |
| Wording, gate present | `Con el plan commiteado y el gate 'plan' con OK humano, la secuencia de la implementación la dicta la máquina.` (unchanged, byte for byte) |
| Wording, gate absent | `Con el plan commiteado, la secuencia de la implementación la dicta la máquina y arranca ahí mismo.` |
| The acknowledgement | One `claim:` line in `.agent/conventions-ack.md`, dated 2026-09-11, with the reason short enough to read inside the dispatcher's note; the long version goes as prose below it. |

## 3. Reference patterns

Files to imitate: `plugin/scripts/kickoff.js` itself — its conditional lines already have the
shape this change needs (`parseSignalCell(slice.senal || '').kind === 'senal' ? … : ''` compares
against a bare member of a closed vocabulary owned by another module, and `renderStateGates`
turns a resolved gate set into the text one reader needs). `plugin/scripts/gates.js` owns the
vocabulary and `resolveGatesForAgent`. For the test, `plugin/__tests__/f21-gate-and-type.test.js`
is the file that already builds slices with `gates`/`gatesDeclared` by hand.

Rules to obey:
- `plugin/conventions/simplicity.md` — the burden of proof is on what is added. One branch, one
  question, no new export, no second resolution of the gate set.
- `plugin/conventions/decisions.md` — the run-machine sequence is one decision and lives in one
  place; two branches must not each carry their own copy of it.
- `plugin/conventions/testing.md` — a test only goes in if it adds a distinct dimension, and its
  name is the sentence.
- `plugin/conventions/style.md` — code, identifiers and test names in English. Its no-prose and
  no-free-function rules keep their exemption in this host module.
- `CLAUDE.md` — this repository refuses the declared-debt exemption for LANGUAGE, and the human
  has closed that question for this diff in §2: the kickoff prose stays Spanish.
- `docs/glossary.md` — read it before renaming anything.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/kickoff.js` | modify | `plugin/scripts/ct-next.mjs` (the dispatcher) | Current state / Contract / Call site |
| `plugin/__tests__/kickoff.test.js` | modify | vitest | none (bodies by TDD) |
| `.agent/conventions-ack.md` | create | `plugin/scripts/conventions.js` via `conventions-io.js`, read by ct-next and ct-init | Final text |
| `plugin/__tests__/conventions-ack-of-this-repository.test.js` | create | vitest | none (bodies by TDD) |

## 5. Interfaces

Consumes: `resolveGatesForAgent(slice)` and `renderGateKickoffLines(gates)` from
`plugin/scripts/gates.js` — the first returns the slice's gates as an array of tokens in
canonical order (`visual`, `apply`, `plan`, `e2e`), the second turns that array into the kickoff
lines. `parseAcks(content)` and `detectConventions({ docs, files, acks })` from
`plugin/scripts/conventions.js`, and `readRepoDocs(root)` from
`plugin/scripts/conventions-io.js`, for the acknowledgement test.

Produces: nothing new is exported. `renderRunMachineLine` is module-private in `kickoff.js`, and
`renderKickoff`'s signature does not change.

## 6. Test strategy

Everything runs with vitest from `plugin/`: `npx vitest run --root plugin <file>`. Task 1 drives
the pair red first in `plugin/__tests__/kickoff.test.js` — one slice with the `plan` gate and one
without, which is the boundary the branch cuts at — plus a third test that pins that the two
branches hand over to the SAME run-machine text, so nobody satisfies the pair by copying the
sequence into both arms. Task 2 pins this repository's own acknowledgement through the very
pipeline the dispatcher runs, because the failure it guards against is silent: a line edited into
a shape `parseAcks` no longer understands brings the warning back and nobody is told.

No existing assertion is weakened, and none has to change: the only test that quotes this
sentence is `plugin/__tests__/prompts-en-positivo.test.js:141`, whose reference slice is
`type: 'backend'` with no declared gates and therefore keeps the `plan` gate and the branch it
asserts.

## 7. Tasks

### Task 1 — The run-machine line names the human OK only when the slice carries the `plan` gate

**Objective:** A dispatched slice is told to wait for the go on the `plan` gate only when that
gate is among its resolved gates, and the run-machine sequence reaches it either way.

**Files:** `plugin/scripts/kickoff.js` (modify), `plugin/__tests__/kickoff.test.js` (modify)

Current state (plugin/scripts/kickoff.js, line 169):

```js
  const gateLines = renderGateKickoffLines(resolveGatesForAgent(slice))
```

Current state (plugin/scripts/kickoff.js, line 276):

```js
    `Con el plan commiteado y el gate 'plan' con OK humano, la secuencia de la implementación la dicta la máquina.
```

Contract (plugin/scripts/kickoff.js):

```js
function renderRunMachineLine(gates, ctStepPath, issueNumber)

gates.includes('plan')
  ? "Con el plan commiteado y el gate 'plan' con OK humano, la secuencia de la implementación la dicta la máquina."
  : 'Con el plan commiteado, la secuencia de la implementación la dicta la máquina y arranca ahí mismo.'
```

The function returns the chosen opening, a space, and then the REST of today's line 276 — from
`Pregunta el paso con` to the closing `hasta "run delivered".` — moved into it unchanged, with
its `${ctStepPath}` and `${slice.n}` interpolations preserved as `ctStepPath` and `issueNumber`.
That text exists once, outside the branch. It goes next to `renderStateGates`, in the module's
own style.

Call site (plugin/scripts/kickoff.js):

```js
// before
  const gateLines = renderGateKickoffLines(resolveGatesForAgent(slice))
    `Con el plan commiteado y el gate 'plan' con OK humano, …`,
// after
  const gates = resolveGatesForAgent(slice)
  const gateLines = renderGateKickoffLines(gates)
    renderRunMachineLine(gates, ctStepPath, slice.n),
```

**TDD:** red first with
`it('a slice whose gates leave out `plan` is not told to wait for a human OK')`: build
`{ ...SLICE, gates: [], gatesDeclared: true }` and assert the kickoff contains
`'la secuencia de la implementación la dicta la máquina y arranca ahí mismo'` and does not match
`/OK humano/`. It fails today because the sentence is unconditional.

**Tests:** added to `plugin/__tests__/kickoff.test.js`:
``it('a slice whose gates leave out `plan` is not told to wait for a human OK')``;
``it('a slice that keeps the `plan` gate is still told the human OK opens the machine')`` —
`{ ...SLICE, gates: ['visual'], gatesDeclared: true }` on one side and plain `SLICE` (which falls
back to the Tipo and keeps `plan`) on the other, asserting
`"Con el plan commiteado y el gate 'plan' con OK humano"` verbatim;
`it('both openings hand over to the same run-machine sequence, word for word')` — take the line
containing `la dicta la máquina` from each of the two kickoffs, cut each at `Pregunta el paso con`
and assert the two tails are identical and carry `ct-step slice-verdict`. Removed: none.

**Verification:** the first command drives the new tests; the second proves the neighbours that
read this sentence, the gate vocabulary and the go gate are untouched.

```bash
npx vitest run --root plugin __tests__/kickoff.test.js   # expected: exit 0 — the three new tests and the 30 that were already there
npx vitest run --root plugin __tests__/prompts-en-positivo.test.js __tests__/f21-gate-and-type.test.js __tests__/gate-plan.test.js __tests__/f38-the-plan-gate-go.test.js __tests__/dispatch-gate.test.js   # expected: exit 0 — no neighbour had to change
```

### Task 2 — The repository acknowledges the `claim` signal it already decided

**Objective:** A dispatch of this repository stops printing the `ATTENTION` block about a rival
claim protocol and prints the one-line note that says the signal was decided.

**Files:** `.agent/conventions-ack.md` (create),
`plugin/__tests__/conventions-ack-of-this-repository.test.js` (create)

Final text (.agent/conventions-ack.md):

```markdown
# Conventions of this repository already decided

claim: 2026-09-11 — decision (c): the backend decides WHEN, the plugin's `dispatch-check.mjs` performs the act, and this repository keeps no claim script of its own.

The scanner (`plugin/scripts/conventions.js`) cites `README.md:8` and lines 59 and 66 of
`backend/conventions/this-repository.md`, where `dispatch-check --collect` and `--reopen` are
named beside a duty — the shape a repository's own claim order has. What those lines describe
is the single protocol of the line above: the backend decides when a slice is claimed,
released, harvested or reopened, and the plugin performs it. There is no second protocol to
arbitrate with, so that documentation stays exactly as it is.

Format: one line per signal, `<signal>: YYYY-MM-DD — <reason>`; the valid signals are `claim`, `worktrees`, `estado` and `residuo-status`. Everything else here is read as prose.
```

Write it exactly like that. The acknowledgement is ONE line and must stay one line: `parseAcks`
reads line by line, and no prose line may begin with a word one edit away from `claim`,
`worktrees`, `estado` or `residuo-status`, or it is reported as a broken acknowledgement. The
file is committable — `.gitignore` covers only `.agent/SLICE.md`, `.agent/run-*.json` and
`.agent/run-*/`. The `.agent/` directory does not exist yet and is created by this task.

**TDD:** red first with
`it('this repository acknowledges the claim signal, so a dispatch prints no ATTENTION about it')`
in the new test file: run the dispatcher's own pipeline — `readRepoDocs` over the repository root
(reached as `join(here, '..', '..')`, the precedent being the LICENSE comparison in
`plugin/__tests__/distribution-boundary.test.js`), `parseAcks` over the acknowledgement file,
`detectConventions({ docs, files: [], acks })` — and assert that `problems` is `[]` and that the
finding whose `id` is `claim` comes back with a truthy `silenced`. It fails today because the
file does not exist.

**Tests:** added: the single test above, in
`plugin/__tests__/conventions-ack-of-this-repository.test.js`. Removed: none.

**Verification:** the first command is the new test; the second is the real dispatcher, and its
exit code carries the claim — zero occurrences of `ATTENTION` in what a dry-run prints. Measured
before the change: the count is 1. Measured with the file above in place: 0.

```bash
npx vitest run --root plugin __tests__/conventions-ack-of-this-repository.test.js   # expected: exit 0
test "$(node plugin/scripts/ct-next.mjs --repo mercadona/control-tower --cap 1 --dry-run 2>&1 | grep -c 'ATTENTION')" -eq 0   # expected: exit 0 — no live conventions warning is left
```

## 8. Global verification

The whole plugin suite, and then the dispatcher itself: that it prints no `ATTENTION` block, and
that what it prints instead is the note saying the `claim` signal was silenced — the second
predicate is what tells "the signal was decided" apart from "the signal stopped being detected".
The baseline of this branch was 148 files and 4029 tests, about 233 s; the three tests of Task 1
and the one of Task 2 are added to it.

```bash
npm test --prefix plugin   # expected: exit 0 — the whole plugin suite green
test "$(node plugin/scripts/ct-next.mjs --repo mercadona/control-tower --cap 1 --dry-run 2>&1 | grep -c 'ATTENTION')" -eq 0   # expected: exit 0 — the live warning is gone
test -n "$(node plugin/scripts/ct-next.mjs --repo mercadona/control-tower --cap 1 --dry-run 2>&1 | grep 'note: \[claim\] silenced')"   # expected: exit 0 — and it is gone because it was acknowledged
```

## 9. Assumptions

1. **The question is asked as `gates.includes('plan')`, with the bare token.** Provenance: own
   call, with a precedent in the same file — line 239 already compares against `'senal'`, a
   member of a closed vocabulary owned by `groom.js`. Exporting a `PLAN_GATE` constant from
   `gates.js` would be tidier but touches the file that slice 1 of the epic (issue #326) is
   about to rewrite, and the decision "which slices carry the `plan` gate" still lives in one
   place: `resolveGatesForAgent`. The kickoff asks for the answer, it does not derive it.
2. **The branch without the gate says nothing about waiting.** Provenance: own call, under
   `plugin/conventions/simplicity.md` and the #99 positive-prompt criterion that
   `plugin/__tests__/prompts-en-positivo.test.js` pins. An explicit "do not wait" would be a
   negation aimed at the model, and the skill that writes the plan already conditions its own
   stop on the `gates` field of the seeded state file.
3. **The acknowledgement covers `claim` only.** Provenance: the errand. The `residuo-status`
   warning about closed issues keeping a live `status:` label goes on printing; it is a different
   decision and nobody has taken it.
4. **The reason inside the `claim:` line is short on purpose.** Provenance: own call, measured —
   the dispatcher prints the whole reason inside its note on every run, so the long version goes
   below the line as prose, where the parser ignores it.
5. **No `issue-<n>-` fragment in this plan's filename.** Provenance: the coordinator — this
   change has no GitHub issue, and that is how this repository's own plans are named.

## Findings

Nothing here blocks implementation; it is what the coordinator asked to be told.

- **No test has to be weakened, and none has to change.** Every file named in the errand was
  read. `plugin/__tests__/prompts-en-positivo.test.js:141` is the only assertion in the tree
  that quotes this sentence, and its reference slice keeps the `plan` gate, so it stays on the
  unchanged branch — and its negation threshold (25, measured 19) does not move, because the
  gate-present opening is unchanged byte for byte. `gate-plan.test.js`, `f38-the-plan-gate-go.test.js`
  and `dispatch-gate.test.js` assert over `GATES`/`gatesForType`/the release door, never over
  this line. In `f21-gate-and-type.test.js` two kickoff tests (lines 353 and 360) use slices with
  NO `plan` gate and will start taking the new branch; both were checked assertion by assertion
  and keep passing (`/human/` matches `GATE HUMANO \`visual\``).
- **The `residuo-status` warning goes on printing** on every dry-run (6 closed issues keeping a
  live `status:` label). It is a different signal and a different decision; acknowledging it was
  not in the errand's scope.
- **The dispatcher echoes the acknowledgement's whole reason** inside its `note:` line on every
  run. That is why the `claim:` line is short and the argument lives as prose below it.
- **`.agent/` does not exist in this repository yet.** This is the first file to live there, and
  it is tracked: `.gitignore` covers only `.agent/SLICE.md`, `.agent/run-*.json` and
  `.agent/run-*/`, and `plugin/__tests__/f22-slice-state.test.js:104` asserts on purpose that
  the acknowledgement is not among the files a slice PR must never carry.
