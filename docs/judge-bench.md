# The judge's bench

The judge is the only point of the loop where the model decides something the program cannot
check. The first three incidents of the catalogue are judges that approved incorrect work, and
until now the only way to say whether a change to the rubric improved anything was to read
verdicts by hand. This bench turns «the judge seems better» into a hit rate and a cost.

**It is not part of `npm test`.** What does go into the suite is the runner —with the `claude`
executor doubled— and the coherence of the cases. Against the model it is run by hand, before
and after touching an agent.

## Running it

```bash
node plugin/scripts/judge-bench.mjs --agent plugin/agents/ct-judge.md --runs 5
```

| Flag | What it does |
|---|---|
| `--agent <ruta>` | The file of the agent to measure. Its frontmatter gives the model and the tools, and its body gives the prompt: the bench never inherits the model of whoever launches it. Mandatory |
| `--runs N` | How many times each case is judged. 5 by default |
| `--case <nombre>` | A single case, by the name of its directory |
| `--dry-run` | Prepares the directories and prints the `claude` commands it would launch, without launching any |
| `--budget-usd <n>` | Spending cap per run (`--max-budget-usd`). 3 by default |
| `--cases <dir>` | Another directory of cases. `plugin/__tests__/fixtures/judge-bench/` by default |

Exit codes: `0` every run hits, `1` some run does not, `2` usage, `3` precondition (the agent
cannot be read, a case is corrupt, `claude` is not on the PATH).

The output is a table with one row per case and one total row: runs, hit rate, schema discard
rate, runs that never got to execute, the severity distribution of the findings and the summed
cost from `total_cost_usd`. Below it, one line per run that did not hit, with the reason and the
directory where its brief, its package and its verdict were left.

A run falls into one of four classes, and the difference matters:

- **hit** — the `ruling` is the expected one and there is a finding under every rule the case
  demands.
- **miss** — the judge judged and got it wrong: another `ruling`, or the right `ruling` for the
  wrong rule. The second counts as a miss on purpose: the loop's telemetry counts findings by
  rule, and a FAIL for `alcance` over a defect of `asercion-tdd` is not the same judge.
- **discard** — the verdict does not pass `VERDICT_SCHEMA` (the same `readVerdict` that
  `ct-step verdict` applies, not a copy), or it carries a `review_token` that is not the
  package's. **Not carrying it** is not a discard, exactly as on the real path: that field is
  written by the program and `ct-judge.md` tells the judge not to copy it. In a real run a
  discard costs a paid round; here it is a column.
- **not executed** — `claude` never got to answer (authentication, quota, spending cap). It is
  not a datum about the judge and it is not mixed in with the other three.

## Comparing two versions of the agent

The bench measures an agent file, not the installed one, so two versions are compared by
pointing it at each:

```bash
git show HEAD:plugin/agents/ct-judge.md > /tmp/ct-judge-antes.md
node plugin/scripts/judge-bench.mjs --agent /tmp/ct-judge-antes.md   --runs 5 | tee /tmp/antes.txt
node plugin/scripts/judge-bench.mjs --agent plugin/agents/ct-judge.md --runs 5 | tee /tmp/despues.txt
```

What gets compared, and in this order:

1. **The hit rate per case.** It is the answer to the question. With `--runs 5` the resolution is
   20 points: 4/5 and 5/5 are not distinguishable with that N, so an improvement of a single run
   is not an improvement.
2. **The discard rate.** A longer rubric that raises the hit rate and triples the discards is
   more expensive than it looks: every discard is a paid round, and six of them kill the run.
3. **The severity distribution over the correct case.** The `medium`s of a correct task are
   defensive vetoes: each one sends the implementer to a paid round with no defect to fix. Their
   going down is an improvement even if the hit rate does not move.
4. **The cost.** The judge runs with fable once per task and per retry; a longer preamble is paid
   on every one of them. The recorded baselines predate that and are opus-priced.

Save both outputs next to the agent's change. A rate without the run that produced it is an
opinion.

## The baseline

It is in [`judge-bench-linea-base-2026-09.md`](judge-bench-linea-base-2026-09.md): `--runs 5`
over `ct-judge.md` at commit `c5b3659`, 15 hits out of 15, zero discards, 8.3644 USD. It is the
run against which any change to the rubric is compared, and the document also says what **cannot**
be concluded from it: with the bench at the ceiling, it serves as a guardrail against regression
and not as a yardstick for improvement.

### The run of #99: the rubric in the positive

`--runs 5` over the `ct-judge.md` rewritten in the positive (sha256 `432eb0fb…`, commit
`17b13c3`): 15 hits out of 15, zero discards, zero severities over `tarea-correcta` and 8.8829
USD — 6.2 % more per judgement. The comparison of the two tables, with what can and what cannot
be concluded from them, is in
[`judge-bench-99-rubrica-en-positivo.md`](judge-bench-99-rubrica-en-positivo.md). It is also the
example of how a change to the rubric is documented: the two tables together and the sha256 of
the agent that produced each one.

### The previous run, of N=1

`--agent plugin/agents/ct-judge.md --runs 1`, plugin 0.56.0, 2026-09-05:

```
caso                       runs  aciertos  descartes  no ejecutados  high  medium  low  coste USD
-------------------------  ----  --------  ---------  -------------  ----  ------  ---  ---------
concurrencia-sin-hallazgo  1     1 (100%)  0 (0%)     0 (0%)         1     0       0    0.7061
tarea-correcta             1     1 (100%)  0 (0%)     0 (0%)         0     0       0    0.5249
test-inexistente-en-verde  1     1 (100%)  0 (0%)     0 (0%)         1     0       0    0.5256
total                      3     3 (100%)  0 (0%)     0 (0%)         2     0       0    1.7566
```

What it says, and what it does not. With N=1 per case this is **not** a hit rate: it is a run
that came out well and a bound on cost — of the order of 0.6 USD per judgement. The sum of
«about 3 USD for the whole bench with `--runs 5`» that this document used to carry was wrong by
a factor of three: `--runs 5` is five judgements **per case**, fifteen calls, 8.4 USD.

## Adding a case

A case is a directory under `plugin/__tests__/fixtures/judge-bench/<nombre>/` with four pieces:

| Piece | What it is |
|---|---|
| `brief.md` | The task's brief exactly as `task-brief --with-plan-context` composes it: `### Desired end state`, `### Out of scope`, `## 2. Closed decisions`, `## 3. Reference patterns` and the task with its markers `**Objective:**`, `**Files:**`, `**TDD:**`, `**Tests:**` and `**Verification:**`. ct's yardstick is **not** written here: the bench pastes it at the end, read from the plugin's `conventions/` directory, exactly as `ct-step` does |
| `package.md` | The review package that `escribirPaquete` writes: the header `# Review package: task N/M of issue #I (staged, not yet committed)`, the line `Review token: <sha256 del diff>`, and the sections `## Files changed`, `## Rutas tocadas` and `## Diff` |
| `expected.json` | `{"ruling": "PASS"\|"FAIL", "must_find": ["<regla>"...], "incident": "…"}`. `must_find` only admits rules from `VERDICT_RULES`; `incident` explains which defect of judgement the case measures and is for whoever reads it, not for the program |
| `repo/` | The working tree the judge will be able to open: the state the implementer left it in, with the files the package declares as touched already applied. The judge reads the diff but also opens files, and a case without a tree leaves it measuring over half of one |

The way to build it without writing a diff by hand: set up a temporary repo with the previous
state, commit it, apply the case's changes, `git add -A`, and take `git diff --cached --stat` and
`git diff --cached -U10` from there. The token is `reviewToken(diff)` from
`plugin/scripts/step-contracts.js` — and the bench re-checks it when loading the case: a
`package.md` whose token is not the sha256 of its own `## Diff` section is a corrupt case and
aborts with exit 3, because the judge would discard that verdict for a reason that is not the one
the case wanted to measure.

**A case measures a defect of judgement, not a defect of code.** Before writing it, answer: which
mechanical check of the loop lets this through? If a check catches it, it is not the judge's
business. The initial three pass that test: the `it.todo` leaves `node --test` green and the grep
of `ct-step controls` finds the test's name; the claim's race passes the sequential test the diff
itself brings; and the correct task has nothing to catch.

After creating the directory, add the case's own check to
`plugin/__tests__/judge-bench.test.js` —the `the bench cases on disk` block— so that the piece
the case measures is tied down by a test and not by the memory of whoever wrote it.
