# `ct-step` answers with a contract — Design

Issue: [#496](https://github.com/mercadona/control-tower/issues/496).
Absorbs: [#493](https://github.com/mercadona/control-tower/issues/493).
Measured on `35303a16`, from the run of #490, agent
`5a0f68a0-5323-4e46-8422-a21f637b5f76`.

## What the issue asked, and what the measurement answered

#496 left four decisions open. Three are closed below by measurement; the
fourth dissolved when it was measured.

**D-3 dissolved — `dispatch-gate.js` and `dispatch-guard.js` do not read
`ct-step`'s stdout.** They are a `PreToolUse` hook over a *session's* tool
calls, and the only reason they matched the grep is that they quote the words
`"ct-step next"` inside a message they print
(`dispatch-gate.js:60`, `dispatch-guard.js:145`). Neither parses a line of it.
The consumers of the prose are exactly two: the backend, and the human road of
the session-driven loop. That is one fewer side to move, and it is why this
design can be a swap rather than a migration.

**D-1 closed — the structure is the source and the prose is rendered from it,
printed under `--output-format json`.** Not "JSON as well as prose", and not
"JSON instead of prose": one value per invocation, rendered two ways.

The alternative — two renderings tied by a test — is the failure this repository
has already paid for by its own account, and it says so in writing in six
modules: `JUDGE_TOOLS` (`step-contracts.js:400-435`), `VERDICT_RULES`,
`PACKAGE_SECTIONS`, `SLICE_PACKAGE_SECTIONS`, plus `cmux.js`, `dispatch.js`,
`repo-walk.js`, `repo-yardstick.js`, `run-metrics.js` and `scope.js`, each
carrying a comment naming a divergence that already happened. Writing one more
copy of the same strings and tying it to the others with a test would be doing
the thing the issue exists to stop.

Rendering the prose *from* the announcement buys a property a test cannot: the
prose **cannot say anything the announcement does not carry**. A reworded
sentence cannot change what the backend reads, because the backend does not read
sentences; and a field added to the announcement cannot be forgotten in the
prose, because the prose is generated. `docs/language.md` governs this
repository's prose and expects it to be editable — today a reworded `out()` line
silently kills a headless run.

The flag spelling is `--output-format json`, which is what
`judge-dispatch.js:65` already passes to `claude` and what the CLI itself uses.
Not a third spelling.

**D-2 closed — the contract lives in a new pure module,
`plugin/scripts/step-announcement.js`**, imported by `ct-step.mjs` and by the
backend. The crossing already exists and is load-bearing: `ct-run-machine.ts:4`
imports `RUN_STATES` and `STEPS` from `plugin/scripts/run-machine.js`. Not
inside `step-contracts.js`: that module holds the *values* of the contract (tool
lists, rubrics, schemas, headings) and is pure by design; this one holds the
*shape of the conversation*. Same discipline, different subject.

**D-4 closed — a refusal carries the state and the outcome that already decide
its exit code.** Nothing new has to be invented: `exitCodeOf(state, step,
outcome)` (`ct-step.mjs:2716-2747`) already computes the code from
`RUN_STATES` and `OUTCOMES`, both exported enums (`run-machine.js:85-107`).
The refusal publishes the inputs of that function instead of only its output.

## The finding this design acts on

`ct-step`'s prose is not a rendering of a structure. It **is** the structure, and
the backend keeps a second, hand-made copy of it: thirteen distinct literal
labels, passed as fifteen arguments, matched as exact line prefixes
(`RunDispatch.#printed`, `run-dispatch.ts:370-376`), four announcement sentences
each required to appear as exactly one whole line byte for byte
(`#requireAnnouncement`, `run-dispatch.ts:386-390`), and four regexes. Seventeen
matchers, counted and verified — the reconciler's `DISPATCH ct-reconciler` is a
`String.includes` match of its own, not one of those four sentences.

The duplication is not theoretical. The same `step:` line is parsed by two
patterns that disagree on the alphabet — `([a-z0-9-]+)` at
`ct-run-machine.ts:328` and `([a-z-]+)` at `run-dispatch.ts:173`. No current
`STEPS` value carries a digit, so **this one is latent, not live**. It is the
proof that the two copies drift when nobody is looking at both.

## The design

### What the announcement carries, and what it deliberately does not

One JSON object per invocation, on stdout, nothing else. Four kinds.

A dispatch step:

```json
{"version": 1, "kind": "step",
 "run": {"issue": 490, "task": 1, "tasksTotal": 5, "step": "judge", "attempt": 1},
 "dispatch": {
   "agent": "ct-judge",
   "inputs": [{"role": "package", "kind": "literal", "path": ".agent/run-490/task-1-review.diff"},
              {"role": "brief", "kind": "literal", "path": ".agent/run-490/task-1-judge-brief.md"},
              {"role": "controls-log", "kind": "literal", "path": ".agent/run-490/task-1-controls-1.log"}],
   "response": {"kind": "file", "path": ".agent/run-490/task-1-verdict.json"}},
 "consuming": {"argv": ["verdict", ".agent/run-490/task-1-verdict.json",
                        "--plan", "docs/superpowers/plans/…md", "--issue", "490"]}}
```

A program step:

```json
{"version": 1, "kind": "step",
 "run": {"issue": 490, "task": 1, "tasksTotal": 5, "step": "controls", "attempt": 1},
 "commands": ["npx vitest run plugin/__tests__/plan-contract.test.js"],
 "consuming": {"argv": ["controls", "--plan", "docs/superpowers/plans/…md", "--issue", "490"]}}
```

A transition, printed by every verb that leaves the run open:

```json
{"version": 1, "kind": "transition", "state": "open", "outcome": "done", "exit": 0,
 "run": {"issue": 490, "task": 1, "tasksTotal": 5, "step": "judge", "discards": 0}}
```

A refusal, printed by every verb that closes the run in failure:

```json
{"version": 1, "kind": "refusal", "state": "blocked-judge", "outcome": "discarded", "exit": 3,
 "run": {"issue": 490, "task": 1, "tasksTotal": 5, "step": "judge", "discards": 6},
 "detail": "6 discards in this run: it stops instead of going on asking for answers that cannot be read"}
```

**The announcement carries what is decided at runtime, and nothing that is a
static function of the step.** That is the rule that keeps it from becoming a
new duplication:

- The agent's **model and tool list do not travel.** Their single home is the
  agent's markdown, which the backend already reads itself
  (`RunDispatch.#definition`). Today the tool list travels *inside a sentence*
  and the backend greps it while also composing it from the definition — two
  derivations of one fact, tied by prose. The announcement names the agent and
  stops there.
- The **JSON schema does not travel** either. It is a function of the step
  (`judge`→`VERDICT_SCHEMA`, `advise`→`ADVICE_SCHEMA`, …), both sides import it
  from `step-contracts.js`, and putting it on stdout would be a third copy.
- The **optional-input sentinels die.** `(none)` and `(N/A declared)` exist
  because a prose line has to say something; an absent optional input is simply
  not in the `inputs` array.
- `version: 1`, with the precedent of `RunJournal.#VERSION` and
  `RunManifest.text()`. The installed plugin is a cache outside this repository,
  so a machine that has not pulled runs an older `ct-step`: a version field
  makes that recognisable instead of mysteriously unparsed.

The thirteen labels collapse into eight `role` names — `package`, `brief`, `rubric`,
`plan`, `controls-log`, `global-log`, `verdicts`, `reconciliation-package` — and
`kind` distinguishes the one input that is a glob, not a path
(`RunDispatch.#glob`, the slice judge's committed verdicts).

### The response channel is declared, and that is why #493 is inside this design

Today `ClaudeRunCalls.#installResponse` (`claude-run-calls.ts:98-119`)
**unconditionally overwrites** the announced path with the call's
`structured_output`. That is how the judge's `PASS` became the literal bytes
`null`: the judge has `Write`, its rubric orders it to write the verdict there,
it did, and the backend wrote over it.

The measurement, a controlled pair in the same session minutes apart, one
variable — `StructuredOutput` in the agent's declared `tools`:

| agent `tools` | `init.tools` | `result.structured_output` |
|---|---|---|
| …`, StructuredOutput` | carries it | `{"ruling":"PASS"}` |
| without it | does not | **absent** — the JSON lands in `result` |

A third probe: the **agent declaration alone** decides. `StructuredOutput` in
`--agents` but absent from `--tools`/`--allowedTools` still arrives, with no
`permission_denials`. And `--json-schema` has been passed since #417
(`run-dispatch.ts:313`), so #493's candidate 1 was already implemented — which
is why that issue's diagnosis does not hold and its candidate 2 (parse `result`)
would have given up the schema check for nothing.

The design does not patch this. It makes the channel a **declared field** with
three kinds, because the three roles genuinely differ:

| Role | `tools` | `response.kind` | What the backend does |
|---|---|---|---|
| `judge`, `slice-judge` | have `Write` | `file` | **reads** the path; writes nothing |
| `advise` | `Read` only (`step-contracts.js:516`) | `structured` | writes `structured_output` there, and declares `StructuredOutput` on the agent |
| `reconcile` | has `Edit` | `edits` | nothing; the tree is the answer |

The judges stop depending on the structured channel **at all**, which is
strictly better than making it work for them: their verdict is a file they wrote
and `ct-step verdict` validates it against `VERDICT_RULES` and binds it to the
package's `review_token`, so no guarantee is lost by the backend keeping its
hands off. The advisor cannot write a file by design — its single `Read` exists
so that the step whose whole point is a clean tree cannot dirty one — so it is
the one role that needs the tool declared.

Cost of the current blindness, from the #490 run: **seven opus dispatches to a
closed channel, $24.15 and ~17 minutes** of wall clock (session cumulative
$11.89 after the implementer → $36.04 after the seventh judge). An absent
`structured_output` is not a judgement a retry can fix, and it consumed the whole
discard budget before `MAX_DISCARDS` stopped it.

### A refusal arrives classified

`OracleBoundary.read` (`ct-run-machine.ts:300-303`) has nothing but bytes when
`ct-step` exits non-zero, so it produces
`ct-step exited ${code}; stdout: …; stderr: …`. That string becomes the
`uncertain` phase's diagnostic and the page prints it verbatim. Observed:

```
ct-step exited 3; stdout: "verdict discarded: the judge did not return
structured_output\n"; stderr: "6 discards in this run: it stops instead of
going on asking for answers that cannot be read\n"
```

With `state` and `outcome` on the refusal, the backend can tell a spent discard
budget (`blocked-judge` + `discarded`) from a judge's veto (`blocked-judge` +
`corrections-ordered`) from red controls (`blocked-controls` + `failed`) from
unmeasurable ones (`+ indeterminate`) from a wrong environment (`precondition`).
Thirteen `EXIT` codes and ten `RUN_STATES` are already there; only their
publication is missing.

This design **supplies that classification and stops there.** It does not touch
the frontend — see the anti-scope.

## What retires

- `RunDispatch.#printed`, `#literal`, `#optionalLiteral`, `#glob`,
  `#requireAnnouncement` and the thirteen distinct label constants.
- The four announcement sentences as a machine contract, and the `includes` match
  over `DISPATCH ct-reconciler`. They stay as prose, rendered from the announcement.
- The four regexes, and with them the `([a-z0-9-]+)` / `([a-z-]+)` divergence.
- `RunConsumingCommand`'s prose parsing and its two-space `#PREFIX`.
- The `(none)` and `(N/A declared)` sentinels.
- `#installResponse`'s unconditional overwrite, for the two roles that write
  their own answer.
- The `--json-schema` argument for `judge` and `slice-judge`, which no longer
  have anything to say through it.

## Anti-scope

- **The button.** `Reintentar recuperación` (`Home.tsx:492`) re-derives the
  phase from the same immutable receipt and lands on the identical banner, and
  it will keep doing so for every refusal that is not re-inspectable — a red
  control, a refused commit. Closing the verdict channel removes today's cause,
  not the dead end. The classification this design publishes is its input; the
  frontend work is a separate issue, parked below.
- **The discard budget.** Nothing here makes an absent answer stop consuming a
  discard. Once the channel is declared the absence should not happen; making
  the budget refuse a wiring failure on the first go is a different change.
- **The prose itself.** No `out()` line is reworded for its own sake. Lines move
  from being typed to being rendered; what they say is what they said.
- **`plan-contract.js`, the rubrics, the yardstick and the agent prompts.** Not
  touched.
- **The bench.** `judge-dispatch.js` composes its own argv and reads the verdict
  from the file already (`judge-bench.test.js:403`). Unaffected, and it stays
  that way.
