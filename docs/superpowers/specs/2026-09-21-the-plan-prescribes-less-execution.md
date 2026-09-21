# The plan prescribes less — Execution spec

**Handoff origen:** `docs/superpowers/specs/2026-09-21-the-plan-prescribes-less-design.md`
**Fecha de congelación:** 2026-09-21
**Estado:** CONGELADA

## Hipótesis del experimento

**The bet:** the plan prescribes more than the issue already carries frozen,
and that excess is not paid back in defects avoided. Measured over 9 slices, 99
tasks and 150 judge passes: the `Contract` block produces 17 of the 18
`contrato` findings and 17 of the 60 `high` findings, and the tasks that carry
one object at the same rate as the tasks that do not — 33% against 33%, over 66
and 33 tasks. Cutting the prescription lowers the clock two ways: the
implementer's brief shrinks, and the rules that exist only because the plan
declared them stop ordering re-implementations, which are 33% of the slice
clock.

**How we will know it failed:** by substitution. `contrato` goes to near zero
by construction and that proves nothing. The measure is the **total** `high`
findings per task, whose baseline is **0,61** (60 over 99 tasks). If the next
slices hold near 0,61 with `contrato` at zero, the block was manufacturing its
own findings and the bet holds. If `objetivo` rises and fills the gap, the
prescription was doing real work and the cut comes back. Both numbers are
already harvested per slice — `findings_high` and `findings_by_rule` in
`run-metrics.js`, over `tasks_total` — so the comparison needs no new
instrument.

**Anti-scope — what this milestone does NOT do:**

- The rubric. The nine items stay nine, and what the judge looks at does not
  move.
- The cadence. One judge pass per task stays, because the measurement says it
  is not where the clock is.
- ct's yardstick: 41.663 bytes, 70% of the implementer's brief, a filter inert
  at 8 documents of 8, and 2 vetoes of 32. It is the largest block left on the
  table and this milestone does not touch it.
- `ct-slice-judge`, the retry budgets and `advise`.
- The stopwatch. `duration_ms` stays empty for the four agent steps and
  `tool_duration_status` stays `unsupported`.
- Plans already written and merged. They are not rewritten.
- The exemption of removal tasks, measured at 11 tasks with 0 objections and
  worth about 1,6% of the clock.
- Raising the 3500-character task budget, and any change to how a slice is cut
  into commits.

## Decisiones congeladas

- **D-1 · What this milestone cuts** — the plan's prescription per task. Not
  the judge's cadence, not the rubric, and not the pasted yardstick.
  *(Procedencia: hablada — «es que creo que el problema es que no hace falta que el plan sea ya tan detallado, ya que la issue viene de un brainstorming previo, y nose si estamos haciendo de más».)*
- **D-2 · The cost the milestone lowers is the clock** — not tokens and not
  context. *(Procedencia: hablada — «El reloj: el slice tarda demasiado».)*
- **D-3 · Less detail per task is not fewer, bigger tasks** — the 3500-character
  budget stays, and one task stays one commit. Bigger tasks were measured at
  18,4 → 27,7 min by size tercile, and 18,5 against 63,2 min inside slices #331
  and #332, with no fall in the objection rate. *(Procedencia: deducida de D-2.)*
- **D-4 · The `Contract` block narrows to what cannot be derived** — a constant,
  a format string, a set of flags, a magic value, an enum an external contract
  fixes, a threshold. Out go the function signature, the interface, the type
  alias, the class shape and the error class's members, which the failing test
  names and the compiler checks. *(Procedencia: hablada — approved as design section 2.1 with «si».)*
- **D-5 · `## 2. Closed decisions` travels by reference** — §2 carries a
  decision only when a task of this slice names the file, the symbol or the
  command that the decision binds. The rest stay in the issue's own
  `## Decisiones congeladas`, which the plan cites by issue number. The epic's
  block is byte for byte the same in every issue of a milestone, measured at
  12.740 bytes and md5 `0bab7e35596bf8215684706325320b49` across #329 and #330.
  *(Procedencia: hablada — approved as design section 2.2 with «si».)*
- **D-6 · What stays in the task** — `**TDD:**` with its literal test name and
  assertion, and `**Verification:**` with its predicates. `asercion-tdd` fired
  5 times in 150 passes, and `**Verification:**` is what `controls` measures.
  *(Procedencia: hablada — approved as design section 2.3 with «si».)*
- **D-7 · The instrument is the substitution test** — total `high` findings per
  task against the 0,61 baseline, with `contrato` expected at zero.
  *(Procedencia: hablada — approved as design section 3 with «continua».)*
- **D-8 · The experiment declares two limits instead of hiding them** — the
  clock is not instrumented, so the only clock is the `written_at`
  reconstruction, valid as a before-and-after comparison and not as an absolute
  measure; and two slices of 25-30 tasks against a 33% baseline detect a large
  regression and not a small one. *(Procedencia: hablada — approved as design section 3 with «continua».)*
- **D-9 · No new instrument is built** — the harvest already aggregates
  `verdicts`, `fails`, `findings_by_rule`, `findings_high` and `brief_bytes`
  per slice, and every row carries `tasks_total`. *(Procedencia: deducida de D-1.)*
- **D-10 · Issue #429 is answered and not implemented as it is written** — three
  of its four candidates are refuted by the measurement, and its hypothesis
  about where defects cluster is false. *(Procedencia: deducida de D-1 y D-2.)*

## Enfoque técnico

Two slices, serialized, both inside `plugin/`.

The heart is `plugin/skills/ct-writing-plans-prescriptive/SKILL.md`, which
states the block taxonomy and its budgets, and
`plugin/scripts/plan-contract.js`, which enforces them with `--check-plan`. The
skill states the rule and the validator refuses the plan that breaks it: a rule
written in the skill alone reaches the plan agent as advice, and this
repository already learnt what a gate nobody enforces is worth. So both cuts
land in the same pair of files, and that is why they are one slice and not two.

The second slice is documentation. #429 asked for a decision taken with
evidence, and the evidence is what the design document carries. The repository
needs the answer where the next reader of the cadence question looks, which is
the skill and the issue, not a spec nobody opens again.

The order matters for the experiment and not for the code: the baseline is the
history already harvested, so nothing has to be measured before the change
lands. The first slice to merge starts the comparison window.

## Contexto del milestone

- Stack: the plugin is Node ESM JavaScript under `plugin/scripts/`, with tests
  in `plugin/__tests__/` run by `node --test`. The skills are markdown under
  `plugin/skills/`.
- Everything written to the repository is English. Frontend product copy is
  Spanish, and this milestone touches no frontend.
- `plan-contract.js` is the gate of the plan. A rule this milestone adds to the
  skill is refused by `--check-plan` as well, or it is advice and not a rule.
- The ten parsed Spanish headings of the plan template are a contract. This
  milestone changes what a section carries, never the spelling of its heading.
- No feature flag is required in this repository.
- The measures this milestone is judged by are already harvested:
  `findings_high`, `findings_by_rule` and `tasks_total` per slice.

## Tabla de slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Repo |
|---|-------|------|---------|-----|--------|-----------|------|------|------|------|
| 1 | The plan prescribes less | backend | The `Contract` block admits only what cannot be derived, and §2 carries only the decisions this slice's tasks name; `--check-plan` refuses a plan that breaks either | – | A `Contract` block declaring a function signature\, an interface\, a type alias or a class shape is refused by `--check-plan` with a message naming the line, A `Contract` block declaring a constant\, a format string\, a flag set or a threshold passes, A §2 decision no task of the plan names is refused with its line, The skill states both rules with the two lists that decide them | The nine rubric items, the judge's cadence, the 3500-character task budget, ct's yardstick and its `Applies to:` filter | plugin | plan-contract | – | – |
| 2 | The cadence question is answered | backend | The measurement that settles #429 is written where the next reader looks, with the substitution test and its 0,61 baseline | #1 | The skill states that one judge pass per task stays and why\, with the measured share of the clock, The stopping rule names the total `high` per task and its 0\,61 baseline, #429 is closed citing the three refuted candidates | The rubric, the cadence itself, ct's yardstick | plugin | docs | – | – |

## Decisiones aparcadas (BLOCKED)

| ID | Fila | Qué falta decidir | Opciones vistas | Estado |
|----|------|-------------------|-----------------|--------|
| A-1 | – | Whether ct's yardstick stops travelling pasted whole into the implementer's brief. It is 41.663 bytes, 70% of the brief, its `Applies to:` filter admits 8 documents of 8 in 158 of 163 briefs, and it carried a finding in only 2 of the 32 vetoes | Make the filter real; stop pasting and travel by path as the judge already does; leave it | Parked — measured and out of this milestone's scope by D-1 |
| A-2 | – | Whether removal tasks stop paying a judge pass. 11 tasks, 11 passes, 0 objections, 0 `high`, 0 red controls, including 8 inside slices whose base rate was 81% | Exempt them; leave the cadence uniform | Parked — worth about 1,6% of the clock, which does not pay a milestone |
| A-3 | – | Whether the loop times its four agent steps. `duration_ms` is empty for 163 `implement`, 150 `judge`, 9 `slice-judge` and 5 `advise`, and `tool_duration_status` is `unsupported` in 506 of 506 rows | Populate `tool_active_duration_ms`; populate the program's own `duration_ms`; leave the `written_at` reconstruction | Parked — the milestone runs on the reconstruction, with the limit declared in D-8 |

## Registro de cierre (evidencia)

| Slice | specReviewedSha | codeReviewedSha | uiScreenshot | Gate cerrado con |
|-------|-----------------|-----------------|--------------|------------------|
