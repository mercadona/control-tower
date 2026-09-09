# Judge bench baseline — 9 September 2026

The reference run any change to the rubric is compared against. It replaces
[`judge-bench-linea-base-2026-09.md`](judge-bench-linea-base-2026-09.md), which
measured a `ct-judge.md` that no longer exists: the agent has changed twice since
(#125 rewrote the rules in the positive, #162 added the plan's amendment), so its
sha256 stopped matching and the comparison it offered was against a document
nobody runs any more. How the bench is executed and what each column means is in
[`judge-bench.md`](judge-bench.md); this is only the result and what can and
cannot be concluded from it.

## What was measured, exactly

| | |
|---|---|
| Date | 2026-09-09 |
| Repo commit | `2fe417d` |
| Judged agent | `plugin/agents/ct-judge.md` |
| sha256 of the agent | `42d243b92c099047c607806af6302ca14aefff2783d35721bea99d608df36e56` |
| Runs | `--runs 5` |
| Cases | the three of `plugin/__tests__/fixtures/judge-bench/` |

```
case                       runs  hits       discards  not run  high  medium  low  cost USD
-------------------------  ----  ---------  --------  -------  ----  ------  ---  --------
concurrencia-sin-hallazgo  5     5 (100%)   0 (0%)    0 (0%)   5     0       0    3.8079
tarea-correcta             5     5 (100%)   0 (0%)    0 (0%)   0     0       0    3.5247
test-inexistente-en-verde  5     5 (100%)   0 (0%)    0 (0%)   5     0       0    3.4405
total                      15    15 (100%)  0 (0%)    0 (0%)   10    0       0    10.7731
```

## What this says

**Fifteen out of fifteen, and zero discards.** Every run reached the expected
ruling with the expected findings, and not one verdict was malformed or
self-contradictory — a `PASS` carrying a high finding, a rubric with an item
missing, a file that would not parse. On the three cases the bench carries, this
judge is stable.

**What it does not say.** Three cases are three cases. A 100 % rate here is
evidence that the rubric holds on a concurrency defect it must catch, on a
correct task it must let through, and on a test that does not exist behind a
green suite — not that it holds on everything. The bench measures regression,
not coverage.

## The cost, and the figure to budget

**10.7731 USD**, against the 8.4 the previous baseline told you to budget: **28 %
more**. The cause is the same as the improvement — `ct-judge.md` has grown with
#125 and #162, and a longer prompt is paid for in input tokens on each of the
fifteen judgements. Per judgement it went from 0.5576 USD (min 0.5130, max
0.6065) to roughly 0.72 (min 0.5790, max 0.8573).

**The figure to budget for repeating this bench is 10.8 USD**, and it has to be
counted twice — before and after — every time the rubric is touched.

## Two things about the language migration, recorded here so they are not undone

**`ct-judge.md` was already in English before this run**, and so were
`ct-advisor.md`, `ct-reconciler.md` and `prompts/task-implementer.md`. The
earlier waves of the migration translated them. This run therefore measures the
judge as it stands, not a translation of it: nothing about the agent was changed
for it.

**`judge-dispatch.js` is deliberately left in Spanish.** Its `#promptFor` builds
the line the judge receives — «Juzga la tarea N/M del issue #X…» — and that
constructor is used **by the bench and by nothing else**: the real loop composes
its dispatch in `ct-step.mjs`, which has been English since #184. Translating it
would change the prompt this baseline was measured with, invalidating the
comparison the moment it was written, and would change nothing a person or an
agent sees outside the bench. If a future change does translate it, this baseline
has to be re-run in the same commit.

## What still has no bench, and is not covered by this one

`kickoff.js` (35 lines), `plan-agent-brief.js` (20) and `plugin-yardstick.js`
(10) are still Spanish, and they are prompts: they change what a model does.
They belong to the **implementer** and to the plan agent, and **this bench does
not measure either of them** — it dispatches `ct-judge` against three fixed
cases. Translating them is not covered by the run above, and it needs its own
instrument or an explicit decision to accept the risk unmeasured.
