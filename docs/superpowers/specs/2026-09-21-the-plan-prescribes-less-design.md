# The plan prescribes less — Design

**Issue:** [#429](https://github.com/mercadona/control-tower/issues/429) —
*Review writing-plans-prescriptive's task granularity: the judge runs between
every task and nothing says that cadence is right*

**Date:** 2026-09-21

## What the issue asked, and what the measurement answered

Issue #429 asked whether one judge pass per task is the right frequency. It
named four candidates and asked for a measurement first. The measurement
refutes three of the four candidates, and it moves the answer out of the run
machine and into the plan skill — which is where the issue itself said the fix
would belong if the granularity, and not the cadence, turned out to be the
defect.

The issue has no comments. Its body is the whole input.

### Where the measurement came from

The issue expected the journals on disk. Two survive (`run-370` in its
worktree, and `issue-332` under the state root). Two sources the issue does not
name hold the whole history:

- `docs/superpowers/metrics/issue-<n>.jsonl`, committed in this repository:
  9 slices, 99 tasks, **150 judge passes**, each with its `ruling`,
  `findings_by_rule`, severity counts, `brief_bytes` and `written_at`.
- `~/.claude/control-tower/log/ct-step.jsonl`: 12 slices and 171 passes,
  including `jjponz/repo-pulse` and `jjponz/rust-monitoring`.

Every number below comes from the committed metrics unless stated.

### What a pass costs

| step | hours | share of the slice clock |
|---|---|---|
| `implement` | 32,4 | 63% |
| `judge` | 14,5 | **28%** |
| `controls` | 2,1 | 4% |
| the rest | 2,4 | 5% |

**17,1 h — 33% of the total clock — is the retry loop**: the second-and-later
judge passes and the re-implementations they order. A task that draws an
objection costs 1,9x the clock of one that does not (29,7 min against
15,9 min, medians). 33 tasks of 99 eat half the clock.

The clock above is reconstructed from `written_at` deltas, with each step
capped at one hour so that a human's absence does not count as work. It is not
a direct measurement: `duration_ms` is empty for all 163 `implement`, all 150
`judge`, all 9 `slice-judge` and all 5 `advise` rows, and
`tool_duration_status` is `unsupported` in 506 of 506 rows
(`claude-code-usage.js:120` sets it by hand). The loop times the steps the
program runs itself and does not time the four steps that are the clock.

### What the cadence catches

| | passes | `high` findings | dominant rules |
|---|---|---|---|
| FAIL (vetoes, orders a re-implement) | 32 | 60 | `contrato` 18, `objetivo` 16 |
| corrections-ordered (re-implements too) | 10 | **0** | **`patrones` 12 of 15** |
| clean PASS | 99 | 0 | `patrones` 21 |

`contrato` and `objetivo` carry the vetoes. `patrones` is the noisy rule: 46
findings, 33 of them (72%) on passes that did not veto, and zero `high`
outside the FAILs.

### The four candidates of the issue, against the measurement

1. **Fewer, bigger tasks — refuted.** Bigger tasks cost more clock (18,4 →
   27,7 min by size tercile; 18,5 against 63,2 min inside slices #331 and
   #332) and they do not object less.
2. **The judge over a group of tasks — not supported.** It attacks the 14,5 h
   of first passes and enlarges the blast radius of a FAIL, where a third of
   the clock already goes.
3. **The pass gets cheaper, which is #111 — already spent.** #111 closed on
   2026-09-18 at 19:04 through PR #446, five hours after #429 was written. The
   issue also states that each pass re-reads a 60 KB brief: measured, the
   judge's `package_bytes` median is 29.472, and the 60 KB belongs to the
   implementer. The package is about 7 k tokens against a pass of 2,0 M, so
   the package was never where the cost was.
4. **Nothing changes — partly supported, and not the whole answer.**

### The hypothesis of #429 about where defects cluster is false

The issue supposes that the `high` findings land on the tasks that create a
contract, and that the always-PASS tasks are the mechanical follow-ups.

| cut | n | objected | `high` |
|---|---|---|---|
| task declares a `Contract` block | 66 | 33% | 36 |
| task declares none | 33 | 33% | 24 |
| task 1 of the slice | 9 | 33% | 2 |
| tasks 2..N | 90 | 33% | 58 |
| first / middle / last third | 37 / 33 / 29 | 38% / 27% / 34% | 20 / 23 / 17 |

No signal on any axis. Task size does not predict it either: the apparent
effect disappears once the 11 removal tasks come out (32% / 45% / 34% by
tercile, and inside the hard slices it inverts — 92% for the smaller half
against 69% for the larger).

### The one class with a perfect record

| class | tasks | passes | objected | `high` | `controls` red |
|---|---|---|---|---|---|
| removal tasks (`retire` / `remove` / `unroute`) | 11 | 11 | **0** | **0** | **0** |
| everything else | 88 | 139 | 38% | 60 | 21% |

Eight of the eleven sit inside #331 and #332, where the base rate was 81%. By
chance that is p ≈ 2·10⁻⁶. The class is real, and it is 11% of the tasks whose
passes are the cheap ones: exempting it saves about 1,6% of the clock. It is
hygiene, not a clock fix, and this milestone does not spend itself on it.

## The finding this design acts on

**The plan prescribes more than the issue already froze, and the excess is not
paid back in defects avoided.**

Three measurements carry it.

**1. The plan is not what makes the brief big.**

| | bytes | share |
|---|---|---|
| ct's yardstick, pasted whole | 41.663 | **70%** |
| everything the plan contributes (§2 + §3 + desired end state + out of scope + the task) | 18.188 | 30% |
| — of that, the task itself | ~3.300 | 5,5% |
| median implementer brief | 59.851 | |

The `Applies to:` filter that #94 added to trim that yardstick is inert: 8
documents of 8 in 158 of 163 briefs. The yardstick almost never vetoes —
**2 of the 32 FAILs** carried a yardstick finding, and 24 of the 32 cited no
document at all.

**2. The decisions are written three times.** The `## Decisiones congeladas`
block of issue #329 and that of #330 are byte for byte the same (md5
`0bab7e35596bf8215684706325320b49`, 12.740 bytes): the groom pastes the epic's
decisions whole into every issue of the milestone. The plan agent then rewrites
them into `## 2. Closed decisions` (4.076 and 4.414 bytes — there it does
filter, about 3x). The program then pastes §2 into the brief of every task, and
it is read again on every attempt and on every judge pass.
`decisiones-cerradas` fires 5 times in 150 passes.

**3. The `Contract` block manufactures its own vetoes.**

```
`contrato`  17 findings on tasks that declared a Contract block
`contrato`   1 finding  on tasks that declared none
```

17 of the 60 `high` findings exist because the block exists, and the tasks that
carry it object at exactly the same rate as the tasks that do not (33% and 33%,
over 66 and 33 tasks).

**The honest caveat:** tasks that declare a contract may be intrinsically
harder, and without the block they might object more through other rules.
Observational data cannot rule that out. What exists is the flat 33% / 33%.

## The design

### The bet

The plan prescribes more than the issue already carries frozen, and that excess
is not paid back in defects avoided. Cutting it lowers the clock two ways: the
brief shrinks, and the rules that exist only because the plan declared them
(`contrato`, and part of `patrones`) stop producing vetoes that order
re-implementations — which are 33% of the clock.

**This is an experiment, not a fix.** Nobody has run the loop with a light
plan. The hypothesis can be false and the instrument has to be able to say so.

### One distinction the issue gets wrong

*Less detail per task* is **not** *fewer, bigger tasks*. The second is refuted
above. The cut goes to what the plan says about the task, not to how the slice
is cut into commits. One task stays one commit, and the 3500-character budget
stays as it is.

### What comes out of the task

**The `Contract` block narrows to what cannot be derived.** Today it holds 25
lines of "types, interfaces, exact signatures, typed errors and constants". Of
those, what the implementer cannot derive is the constant: the
`'%x00%H%x1f%aI%x1f%aE'` of the skill's own example, where `%aE` applies
`.mailmap` and `%ae` does not. Signatures and interfaces it derives from the
failing test and from the compiler in front of it.

The line runs between two lists, and neither is a matter of judgement:

- **Stays:** a constant the implementer cannot compute — a format string, a
  set of flags, a magic value, an enum whose members an external contract
  fixes, a threshold.
- **Goes:** a function signature, an interface, a type alias, a class shape,
  an error class's members. Each of those the failing test names and the
  compiler checks.

**`## 2. Closed decisions` travels by reference.** The epic's decisions are
already in the issue, byte for byte the same in every issue of the milestone.
§2 carries a decision only when a task of this slice names the file, the symbol
or the command that the decision binds; the rest travel as the issue's own
`## Decisiones congeladas`, which the plan cites by its issue number.

### What stays, and why

- **`**TDD:**` with the literal test name and its assertion.** It is what makes
  the implementer write red first, and `asercion-tdd` fired 5 times in 150
  passes: cheap and quiet.
- **`**Verification:**`.** Predicates already run, and what `controls`
  measures.
- **The 3500-character budget and one task = one commit.** For the reason
  above.
- **The nine rubric items.** What the judge looks at does not move.

### The instrument

No new telemetry is needed: `ruling`, `findings_by_rule`, `findings_high`,
`brief_bytes` and `written_at` are already written per pass.

| baseline (9 slices, 99 tasks, 150 passes) | |
|---|---|
| tasks that object | 33% (33/99) |
| passes per task | 1,52 |
| `high` findings | 60 — 0,61 per task |
| `contrato` findings | 18 |
| implementer brief | 59.851 bytes |
| clean / objected task clock | 15,9 / 29,7 min |

**The failure mode to watch is substitution.** `contrato` goes to near zero by
construction, and that proves nothing. The question is what the **total**
`high` findings per task do. If they stay near 0,61 with `contrato` at zero,
the block was manufacturing its own findings and the bet holds. If `objetivo`
rises and fills the gap, the prescription was doing real work and the cut comes
back.

### Two limits declared, not hidden

- **The clock is not instrumented.** The `written_at` reconstruction is the
  only clock there is. It works as a before-and-after comparison because the
  method is the same on both sides; it is not an absolute measure of how long
  one call lasts.
- **The power is low.** Two slices are about 25-30 tasks. Against a 33%
  baseline that detects a large regression and does not detect a small one.
  The experiment can say "this broke". It cannot say "nothing broke".

### Anti-scope

- **The rubric.** Nine items stay nine.
- **The cadence.** One pass per task stays. The measurement says it is not
  where the clock is, and that is how #429 gets answered.
- **ct's yardstick — 41.663 bytes, 70% of the brief, an inert filter at 8 of 8,
  and 2 vetoes of 32.** It is the largest block left on the table and this
  milestone does not touch it. Named here so it does not get lost.
- **`ct-slice-judge`, the retry budgets and `advise`.** Untouched; #370 closed
  its part.
- **The stopwatch.** Not built.
- **Plans already written and merged.** Not rewritten.
- **The removal-task exemption.** Real, measured, and worth about 1,6% of the
  clock. Not this milestone.
