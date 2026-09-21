# `ct-step` answers with a contract — Execution spec

Status: **FROZEN** (2026-09-21). Design: `2026-09-21-ct-step-answers-with-a-contract-design.md`.
Issue: [#496](https://github.com/mercadona/control-tower/issues/496).
Absorbs: [#493](https://github.com/mercadona/control-tower/issues/493).

## Hipótesis del experimento

**If `ct-step` answers the backend with one structured value per invocation,
rendered into the prose a human reads instead of being parsed back out of it,
then the headless loop stops breaking on a reworded sentence, a refusal reaches
the user classified instead of as pasted stderr, and the verdict channel that
#493 is open for closes as a consequence rather than as a patch.**

Falsifiable three ways, and each slice below carries the measurement:

1. The seventeen prose matchers in the backend (thirteen distinct labels, four
   announcement sentences) and the four regexes reach **zero**. If any survives,
   the swap did not happen and a second copy is still being maintained.
   Corrected from "nineteen (fourteen labels, five sentences)": slice 5's
   architect counted them and the count was verified — the earlier labels figure
   included two sentinels and a prefix no matcher receives, and the fifth
   "sentence" was the reconciler's `String.includes` match, not one of
   `#requireAnnouncement`'s.
2. The judge's verdict survives the round trip. Today it is overwritten with
   `null` seven times out of seven. If it does not survive, the declared
   response channel did not deliver.
3. A non-zero `ct-step` exit reaches `GET /active-plans` as a `state` and an
   `outcome`, not as `ct-step exited N; stdout: …`. If the diagnostic is still
   bytes, the classification did not arrive.

## Decisiones congeladas

- **D-1 · The structure is the source and the prose is rendered from it** —
  printed under `--output-format json`. Not "JSON as well as prose" and not
  "JSON instead of prose": one value per invocation, rendered two ways.
  Rendering buys the property a test cannot — the prose cannot say anything the
  announcement does not carry. 
  *(Procedencia: deducida — two renderings tied by a test is the failure six modules of this repository already document by name: `JUDGE_TOOLS`, `VERDICT_RULES`, `PACKAGE_SECTIONS`, `SLICE_PACKAGE_SECTIONS`, `cmux.js`, `dispatch.js`, `repo-walk.js`, `repo-yardstick.js`, `run-metrics.js`, `scope.js`.)*
- **D-2 · The contract lives in a new pure module** —
  `plugin/scripts/step-announcement.js`, imported by `ct-step.mjs` and by the
  backend. Not inside `step-contracts.js`, which holds the contract's *values*
  and not the shape of the conversation. 
  *(Procedencia: deducida de D-1 — the crossing already exists and is load-bearing: `ct-run-machine.ts:4` imports `RUN_STATES` and `STEPS` from `plugin/scripts/run-machine.js`.)*
- **D-3 · `dispatch-gate.js` and `dispatch-guard.js` are out of scope** —
  neither parses `ct-step`'s stdout. They are a `PreToolUse` hook over a
  session's tool calls and merely quote the words `"ct-step next"` inside a
  message they print. One fewer side to move, which is why this can be a swap
  and not a migration. 
  *(Procedencia: medida — `dispatch-gate.js:60`, `dispatch-guard.js:145`, the only two hits in either file.)*
- **D-4 · A refusal publishes the `state` and `outcome` that already decide its
  exit code** — nothing new is invented, only published.
  *(Procedencia: deducida — `exitCodeOf(state, step, outcome)` (`ct-step.mjs:2716-2747`) already computes the code from `RUN_STATES` and `OUTCOMES`, both exported at `run-machine.js:85-107`.)*
- **D-5 · The announcement carries what is decided at runtime and nothing that
  is a static function of the step** — the agent's model and tool list stay in
  the markdown the backend already reads; the JSON schema stays in
  `step-contracts.js`, which both sides import; the `(none)` and
  `(N/A declared)` sentinels die, because an absent optional input is simply not
  in the array. 
  *(Procedencia: deducida de D-1 — today the tool list travels inside a sentence the backend greps while also composing it from the definition, which is two derivations of one fact tied by prose.)*
- **D-6 · `response.kind` has three values, `file`, `structured` and `edits`** —
  because the three roles genuinely differ, not for symmetry.
  *(Procedencia: medida — judge and slice judge declare `Write` and their rubrics order them to write the file; the advisor declares `Read` only (`step-contracts.js:516`); the reconciler answers with the tree.)*
- **D-7 · For `kind: "file"` the backend reads the path and writes nothing** —
  and no guarantee is lost, because `ct-step verdict` validates against
  `VERDICT_RULES` and binds the package's `review_token`.
  *(Procedencia: medida — `#installResponse` (`claude-run-calls.ts:98-119`) overwrites unconditionally today, which is how the judge's `PASS` became the literal bytes `null` seven times out of seven.)*
- **D-8 · For `kind: "structured"` the agent declares `StructuredOutput` in its
  `tools`** — the schema alone is not enough: `--agent` makes the agent's
  declared tools the whole tool set, so a `--json-schema` with no tool to travel
  through is silently ignored.
  
  *(Procedencia: medida — controlled pair in the same session, one variable: with it, `result.structured_output` carries the answer; without it, absent and the JSON lands in `result`. A third probe showed the agent declaration alone decides: present in `--agents` but absent from `--tools` it still arrives, with no `permission_denials`.)*
- **D-9 · The flag is spelled `--output-format json`** — not a third spelling.
  *(Procedencia: deducida — `judge-dispatch.js:65` already passes exactly that to `claude`, and it is the CLI's own flag.)*
- **D-10 · The announcement carries `version: 1`** — the installed plugin is a
  cache outside this repository, so a machine that has not pulled runs an older
  `ct-step`: a version field makes that recognisable instead of mysteriously
  unparsed. 
  *(Procedencia: deducida — precedent in `RunJournal.#VERSION` and `RunManifest.text()`.)*
- **D-11 · Slice 1 delivers the response channel before the rest of the
  material** — the first field of a new contract should be the one that is
  currently broken, so the contract earns its keep in its first slice and the
  loop's judge is unblocked by it. 
  *(Procedencia: deducida de D-6 y D-7, con el bloqueo del e2e de #490 como urgencia — the author chose the contract over the standalone transport patch: «si siempre devuelve structured output, no debo de tener este problema mas».)*
- **D-12 · Slice 1 declares the whole shape of the module while using only
  `response`** — all four kinds and every field. It is what makes slices 2, 3
  and 4 parallel: three slices extending a module whose shape was invented one
  slice earlier each invent their own corner and meet in the reconcile; three
  slices filling an API already closed do not. 
  *(Procedencia: hablada — «cuantas se pueden paralelizar?».)*

## Enfoque técnico

- The plugin is Node ESM JavaScript under `plugin/scripts/`, tested with
  `node --test` in `plugin/__tests__/`. `step-announcement.js` is pure: no disk,
  no process, no `git`.
- The backend is TypeScript under `backend/src/`, every module `.ts`
  (`backend/conventions/this-repository.md`), tested with `vitest` in
  `backend/__tests__/`.
- Backend and plugin are in the **same repository**, so a contract moves on both
  sides inside one slice. That is the affordance this whole plan rests on: no
  slice leaves one side speaking a shape the other does not read.
- `backend/__tests__/infrastructure/run-dispatch-real-process.test.ts:538`
  asserts the composed argv by **recomputing it with the production recipe**
  (`DispatchRepository.expectedArgv`, lines 253-278). It is tautological: it
  cannot fail for a missing argument. Every slice that touches the argv replaces
  that echo with an assertion on the outcome.
- **Slices 2, 3 and 4 run in parallel after 1**; 5 closes. Critical path: three
  slices deep, not five. What meets where, so whoever reconciles is not
  surprised: no backend file is shared by 2 and 3 or by 2 and 4; 3 and 4 both
  edit two different branches of `OracleBoundary.read`'s switch, and 2 and 4 two
  different `case`s of `nextVerb`'s. The one genuinely shared file is
  `step-announcement.js`, which is why D-12 makes slice 1 close its shape first.
- Everything written to the repository is English. This plan touches no frontend
  product copy.
- No feature flag is required in this repository.

## Contexto del milestone

- The loop's headless road is `ct-api` → `ct-step` → a `claude -p` call per
  agent step. `ct-step` is the oracle: the backend runs it and obeys what it
  says.
- The session-driven road reads the same stdout as **human instructions**. It
  keeps doing so, byte for byte, because the prose is rendered from the same
  value and nothing asks for the flag.
- `.agent/run-<issue>.json` is the run's state and is not touched by this plan.
- The ten parsed Spanish headings of the plan template, the `.agent/STATE.md`
  keys and the GitHub labels are contract and keep their spelling.
- The verdicts of every task are committed under
  `docs/superpowers/verdicts/issue-<n>-task-*.json`; the slice judge receives
  them as the one glob input.

## Tabla de slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Repo |
|---|-------|------|---------|-----|--------|-----------|------|------|------|------|
| 1 | The announcement is born declaring the response channel | backend | `step-announcement.js` exists\, `ct-step --output-format json` prints the step announcement\, and the backend honours `response.kind` instead of overwriting every answer | – | `ct-step next --output-format json` at the judge step prints one JSON object with `version`\, `kind`\, `run` and `dispatch.response`, A `response.kind` of `file` leaves the path the agent wrote untouched and `ct-step verdict` reads that file, A `response.kind` of `structured` writes the call's `structured_output` to the path and its agent declares `StructuredOutput`, A real-process test spawns `claude -p` with the composed argv and asserts `structured_output` arrives for the advisor and is not needed by the judge, `step-announcement.js` declares all four kinds — `step`\, `transition`\, `refusal` — and every field of each\, so slices 2 to 4 fill a closed API instead of extending one, The default output of `ct-step next` is byte-identical to today except the advisor's announced tool list\, which moves because its declaration moved | The prose of every `out()` line, `.agent/run-<issue>.json`, `VERDICT_RULES` and the `review_token` binding, the agents' prompts | plugin, api | ct-step | e2e | – |
| 2 | The dispatch material stops being prose | backend | The announcement carries the agent\, the inputs by role and the consuming argv\, the prose is rendered from it\, and the thirteen labels and four announcement sentences are gone from the backend | #1 | The announcement of every dispatch step carries `dispatch.agent`\, `dispatch.inputs[]` with `role` and `kind`\, and `consuming.argv`, `RunDispatch.#printed`\, `#literal`\, `#optionalLiteral`\, `#glob` and `#requireAnnouncement` no longer exist, The slice judge's committed verdicts travel as one `kind: "glob"` input and the `(none)` and `(N/A declared)` sentinels are gone, A reworded `out()` line does not change the announcement\, asserted by rendering the prose from a fixed announcement | The agent definitions as the single home of model and tools, the schemas in `step-contracts.js`, what each prose line says | plugin, api | ct-step | – | – |
| 3 | A refusal arrives classified | backend | Every verb prints its transition or refusal as part of the announcement\, and a non-zero exit reaches the backend as a `state` and an `outcome` instead of pasted bytes | #1 | A refusal carries `state`\, `outcome`\, `exit` and `detail`\, and the four regexes no longer exist, `GET /active-plans` reports a spent discard budget distinguishably from red controls and from a wrong environment, The `([a-z0-9-]+)` versus `([a-z-]+)` divergence is gone because neither pattern remains | The thirteen `EXIT` codes and the ten `RUN_STATES` and their meanings, the frontend | plugin, api | ct-step | – | – |
| 4 | The program steps and the e2e speak it too | backend | `controls`\, `commit`\, `reconcile`\, `global` and `e2e` announce their commands and their consuming argv | #1 | The announcement of every program step carries `commands[]` and `consuming.argv`, `OracleBoundary.#plainCommand` and the reconciler's prose branch read fields | The e2e journeys and their `AGENTS.md` sections, the commit message composition and its closing-keyword guard | plugin, api | ct-step | – | – |
| 5 | The scraping is gone | backend | `RunConsumingCommand` and the last prose matcher are deleted\, and the sum of the four slices is asserted where no per-slice judge can see it | #2, #3, #4 | A grep for the thirteen distinct labels\, the four announcement sentences and the four regexes over `backend/src` returns nothing, `RunConsumingCommand` no longer exists — it could not be deleted earlier because the `When it comes back:` line feeds every step family, `ct-step` with no flag prints byte-identically to `35303a16` for all nine steps | The prose itself, the announcement's shape as slice 1 closed it | plugin, api | ct-step | – | – |

## Decisiones aparcadas (BLOCKED)

| ID | Fila | Qué falta decidir | Opciones vistas | Estado |
|----|------|-------------------|-----------------|--------|
| A-1 | 3 | What the page offers for a refusal that cannot be re-inspected. `Reintentar recuperación` (`Home.tsx:492`) re-derives the phase from the same immutable receipt and lands on the identical banner — for every refusal, not only the verdict one | Drop the retry and offer `Limpiar`; drop the retry and only explain; make the retry re-dispatch the step, which rewrites evidence | Parked by the author on 2026-09-21. Slice 3 publishes the classification it needs; the frontend change is its own issue |
| A-2 | – | Whether an absent structured answer should consume a discard at all. Seven opus dispatches, $24.15 and ~17 minutes went to a closed channel before `MAX_DISCARDS` stopped it, and no retry could ever have fixed it | Refuse a wiring failure on the first go; keep the uniform budget | Parked — once the channel is declared the absence should not happen, so this is insurance, not the fix |
| A-3 | – | Whether the prose road keeps a second reader at all. Nothing in the repository parses `ct-step`'s stdout once the backend stops, so the prose becomes purely human | Leave it as prose forever; eventually derive the session road from the announcement too | Parked — no cost either way until something wants to read it again |

## Registro de cierre (evidencia)

| Slice | specReviewedSha | codeReviewedSha | uiScreenshot | Gate cerrado con |
|-------|-----------------|-----------------|--------------|------------------|
| 1 | – | – | – | – |
| 2 | – | – | – | – |
| 3 | – | – | – | – |
| 4 | – | – | – | – |
