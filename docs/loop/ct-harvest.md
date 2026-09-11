# `/ct-harvest` — reference and design

> Text moved wholesale from `plugin/commands/ct-harvest.md` (sub-issue #93). The command keeps the invocation, the exit-code table and a link to this document.

The invocation:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-harvest.mjs --repo "<owner/repo>" --milestone "<epic title>" [--json] [--bq <project:dataset.table>]
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-harvest.mjs --schema
```


It answers: **how much did each slice of this epic cost, according to what GitHub already wrote on its own?** One row per slice with `ready→claim`, `claim→release`, `release→merge`, reopens, requeues, `blocked` episodes and PR size.

**It is harvested, not captured.** Zero manual fields, not a single one. Everything comes out of the timeline GitHub writes every time the loop moves a label. The one by-hand datum of the measure —the **minutes of human intervention**— lives in the epic's outcome and this command **deliberately does not ask for it**: the moment a harvester admits one manual field it turns into a form, and a form is exactly how `docs/medicion-slices.md` died (2 rows, the key column at «no medido»).

**It was written after the first real dispatch, not before.** The decisions in `scripts/harvest.js` come from having harvested menoplus's epic `#602` by hand (2026-08-12/13). Not one of them was deduced in a vacuum, and the two that matter most came out of data an invented fixture would never have had.

**It mutates nothing.** No labels, no issues, no PRs. Same as `/ct-status`.

## The three decisions that govern the harvest

**1 · The ladder is derived from the `labeled` events alone.** The pair (`unlabeled` of the old status, `labeled` of the new one) arrives **tied to the second**, and the order between the two **is not stable across issues**: in `#659` the `labeled status:ready` precedes its `unlabeled status:backlog`; in `#660`, minutes later and through the same API, the order is the opposite. Reading the `unlabeled` events to decide «which status am I leaving» injects pure noise into the dependent variable.

The exception —which is not an exception— is `status:blocked`: the ladder is a **state machine**, where each `labeled` marks the entry into a rung and the `unlabeled` is redundant; `blocked` is an **interval**, and the end of an interval is marked only by the removal of the label.

**2 · A phase that did not happen is worth `null`, never `0`.** A slice that never reached `in-review` did not take zero seconds to get there: **it did not get there**. With the small N this measure is always going to have, an invented zero moves the mean more than the real datum it replaces. In the table it prints `—`.

**3 · Who closed the issue is told by GitHub, not by a heuristic.** The first version deduced the PR by scanning the `cross-referenced` events and keeping the last merged one. Against the real epic it tied `#659` to PR `#665` and `#660` to `#666`, when the right ones were `#663` and `#665` — because every PR of a slice cites the previous one, so the old issue accumulates references from **later** PRs and «the last merged one» rewards exactly the wrong ones. **The table came out green and lied.** Today it reads `closedByPullRequestsReferences`, which is the field GitHub publishes for this.

## It is reported by family, never aggregated

Honesty rule from §6 of the pre-registration, inherited from the lesson of POSTCONDBENCH's FDR 0,08–0,31: the summary is grouped by `Tipo` and **every family shows its N**. Below N=3 the line says so out loud (`← N insuficiente: describe, no promedia`) instead of printing a mean that will be read as if it meant something.

For the same reason `type` and `gate` travel **inside each row**, in `--json` too: if the family does not travel with the datum, the dishonest aggregate is the path of least resistance for whoever reads the harvest.

## The judge's telemetry, per slice

Besides the cost, the harvest reads what the slice itself left committed in `docs/superpowers/metrics/issue-<n>.jsonl` and works out, **per slice**, how many rubric items came back **`sin-vara`** (the judge had a subject to look at and nothing to measure it with), **how many findings there were per rule**, **how those findings are distributed by severity** (`high/medium/low`), **how many of the verdicts were a veto** and the two halves of the **`vara ct`** column: how many of its documents ended up cited along the rubric's run, and how many findings cite them. Until now the first of these columns travelled in the pull request and **nobody read it**: the number existed on disk and you had to open the `jsonl` files by hand.

**The severity says whether the finding hurt, and `findings_by_rule` does not say it.** Three `alcance` findings can be three vetoes or three notes in the margin, and the per-rule column counts them the same. The distribution goes in a single cell and in the order in which it is decided: a **high** VETOES —the verdict's contract does not admit a `PASS` with a high, so a high implies `FAIL`—, a **medium** buys a paid round trip to the implementer, a **low** is only noted down. Next to it, the `Verdicts` cell notes **how many of them were a veto**: `verdicts` says how many times it judged, and that note how many times the judge stopped. A clean slice notes nothing.

Both measures have been living in every row of `issue-<n>.jsonl` since `verdictMeasures` exists —`findings_high`, `findings_medium`, `findings_low` and `ruling`—, and the aggregate threw them away: they were on disk and nobody read them, exactly the same gap `rubric_sin_vara` had before this table existed.

**The two halves of `vara ct` are read together, and in that order.** `5 docs · 0 findings` slice after slice is the case to watch: either the code really did conform, or the yardstick is being named as decoration — and with a single figure those two readings are the same number. They are not two columns that have to add up to the same thing: they measure the input (it arrived and was used) and the effect (it caught something).

They replace `patrones-ct`, which counted only findings of the `patrones` item on the argument that it is the only one that measures against the yardsticks. The run of slice #7 of `rust-monitoring` refuted that by measuring: the ct yardstick came out cited twice under `decisiones-cerradas`, and the mutation rule of `conventions/testing.md` was answered under `test-desiderata`. A finding that the yardstick produced and that got filed under another item was invisible, so the column measured **where the finding was filed** and not **what produced it**.

The citation is detected in **two** ways. By the SHAPE of the path (`conventions/<something>.md`, with no slash and no letter in front), which does not depend on today's names: a renamed document or a brand new one also counts — that is how `defects.md` got counted the day `code.md` was split, without touching any of this. And by the bare NAME (`style.md`), against `PluginYardstick.FILES`, because a name with no prefix has no shape to give it away and the only good list is the one that defines which documents travel.

The second one came in by measuring: in slice #8 of `rust-monitoring` the judge of task 5 discussed the five documents by their bare name and the column counted **zero**. It was measuring the shape of the citation and not the use.

In both ways, the REPO yardstick's `docs/conventions/style.md` —which contains both substrings— never counts as ct: neither `conventions/` nor the name may come preceded by a slash.

The same telemetry additionally brings, for every attempt of the `implement` step, whether the ct yardstick **arrived** at the task's brief and **how much it weighed**: how many `## Vara de ct: conventions/` headers the brief left on disk carries (`brief_vara_ct_docs`) and its size in bytes (`brief_bytes`). It is what closes a silent deviation: today the plugin aborts if the documents are missing from the PLUGIN, but nothing checked that the brief had TAKEN them along — if `escribirBrief` breaks, everything stays green and the judge silently measures against the repo's yardstick alone. The table's `brief` column adds up the two numbers of every `implement` attempt the slice left written (`N docs · M B`).

It is read from GitHub, like everything else: there is no checkout to assume.

**Nine things this block never passes off as a zero:**

- **`(no telemetry)`** — that slice has no file: nobody measured.
- **`—` in `sin-vara`** — the slice has a file, but no verdict carried the column (telemetry older than `rubric_sin_vara`). The cell additionally shows how many verdicts are «no column».
- **`—` in `high/medium/low`** — the slice has a file, but no verdict carried the three severities (telemetry older than this measure). `0/0/0` would assert a distribution nobody measured. The three are required TOGETHER: a row missing a single one is counted as wholly old, because the distribution is only read added up and half a measure describes nothing.
- **`—` in `vara ct`** — the slice has a file, but no verdict carried the `rubric_vara_ct_docs`/`findings_vara_ct` columns (telemetry older than this measure, or from the `findings_patrones_vara_ct` they replaced). It is a tolerance INDEPENDENT of `sin-vara`'s: a row can carry one column and not the other, each with its own birth date in the telemetry. Both halves are required to print the cell: half a cell would invite reading the gap as a zero.
- **`—` in `brief`** — the slice has a file, but no `implement` attempt carried `brief_vara_ct_docs`/`brief_bytes` (telemetry older than this measure, or an attempt in which the brief could not be read at the time). A zero here would assert a brief with no yardstick that nobody could measure.
- **`—` in `bytes per role`** — the slice has a file, but no dispatched role carried `agent_bytes`/`skill_bytes`/`package_bytes` (telemetry older than this measure). The three are required TOGETHER, like the severities: the question that motivates the column is their sum, and half a measure does not answer it.
- **`—` in `returns`** — the slice has a file, but no `judge` attempt in it RULED (only discarded attempts, or telemetry with no judge row at all). A `0+0=0 of 0` would assert a judge that never sent anything back, when what happened is that no attempt reached a verdict.
- **`—` in `tool` and `tokens`** — the slice has a file, but no attempt carried the normalized tool usage (telemetry older than this measure). `(unsupported)`, `(not-read)` or `(unmeasured)` in `tokens` are not the same case: the attempt DID carry the contract and the tool reported no usable usage. Nothing is ever estimated from the size of the text.
- **the directory could not be listed** — not a single number is printed, and it is said out loud. **It does not drop the exit to `1`**: the cause is almost always that that repo has no telemetry, and a permanent `1` on those epics would teach people to ignore the exit code. A **file** that the listing did name and could not be read IS an incomplete harvest: reason and exit `1`.

The unreadable lines of a `jsonl` are counted and said out loud; they neither throw away the file nor change the exit — a corrupt row from three weeks ago is not fixed by repeating the command.

## What the tool spent, and how many times the judge sent the work back

Two more columns, and they exist for one question: **comparing two coding tools on the same loop.** The raw size of the pull request (`additions`, `deletions`, `changed_files`) says how much was written; these say what writing it cost and how many rounds it took.

**`tool` names whose cost it is.** Without the tool and its version, every figure aggregates tools that share nothing, and the mean that comes out describes no tool at all. It is read out of the runtime that wrote the row, not asked for: `claude-code` and its version. Two tools in the same slice —an epic split across machines— are declared `(mixed)` instead of one of them being picked in silence.

**`tokens` is the exact usage the tool reported.** Four figures, and the total is the sum of the three that do not overlap: fresh input, cached input (the cache read plus the cache creation, counted ONCE) and output. The evidence is the runtime's own per-request usage; **nothing is estimated from the bytes of a prompt.** A tool that reports no usage lands its status and a `NULL`, which is why `(unsupported)` exists as a printed value.

**`claim→release` is NOT the tool's active time.** It is the wall clock of the slice's lifecycle, and it includes the night the slice spent waiting. The active duration the tool reports travels apart, in `tool_active_duration_ms` — and for a Claude Code session it is `NULL` with `tool_duration_status = 'unsupported'`: the session transcript records the usage of every call and **not** how long each one took. The column is there for the tool that does report it; it is not filled in by subtracting timestamps.

**`returns` is the judge's, and it is not `verdicts_fail`.** A task goes back to the implementer in two ways, and both cost a round: the judge **vetoes** it (`outcome: failed`) or it **orders corrections** (`outcome: corrections-ordered`). `returns` is their sum, printed over the attempts that RULED — `1+1=2 of 4`. `verdicts_fail` is a different figure and is left as it was: it counts every `FAIL` ruling in the file, the **slice** judge's included, and the slice judge sends nothing back to anybody. Discarded attempts —a judge that wrote no verdict— are in neither figure: counting them would put into the denominator calls that never ruled.

**The evidence travels in the pull request, the transcript does not.** Every row carries the request ids of the usage it claimed (`tool_usage_evidence`), and an id already claimed by an earlier row of the slice is never attributed again. That is what makes the measure re-harvestable years later **from the repository alone** —the transcript is private to the machine that ran the loop— and what stops a resumed session, or a transcript that repeats a request across entries, from adding up twice.

## To BigQuery, with the `bq` CLI

`--bq <project:dataset.table>` loads the harvest into that table when it finishes, with the `bq` you already have authenticated (like `gh`): a `bq load` of an NDJSON, one row per slice and harvest, with `harvest_id` and `harvested_at`. Every run is **appended** as a snapshot; nothing is overwritten. The schema travels in the plugin, and a new column from a later version is added on its own (`ALLOW_FIELD_ADDITION`).

**The ledger lands at `<project>:<dataset>.<table>`.** That is the destination `CT_HARVEST_BQ_TABLE` names for the automatic harvest, and the one to pass to `--bq` by hand. It follows the company's `<domain>_incoming` raw convention, and it is its own dataset because writing into a consuming tool's own datasets is not safe: those are managed by dbt and by a streaming subscription, so a raw landing dataset of our own is the safe choice. See `docs/superpowers/specs/2026-09-11-harvest-ledger-landing-in-bigquery-design.md` for the full design.

**The dataset and the table are created ONCE, by hand, before the first load.** A `bq load` into a table that does not exist would create it unpartitioned — the table's whole point is being partitioned by `harvested_at` and clustered by `repo, milestone`, and neither of those survives an auto-create. Run once, after merge:

```sh
bq --project_id=<project> mk --dataset --location=EU \
  --description="Control Tower raw landing. One row per merged slice per harvest." \
  --label=source:control-tower \
  <project>:<dataset>

node plugin/scripts/ct-harvest.mjs --schema > /tmp/slices.schema.json
bq --project_id=<project> mk --table \
  --time_partitioning_type=DAY --time_partitioning_field=harvested_at \
  --clustering_fields=repo,milestone \
  --description="Harvest ledger. Append-only. Take the latest harvest_id per (repo, issue). NULL means not measured." \
  --schema=/tmp/slices.schema.json \
  <project>:<dataset>.<table>
```

The dataset and its permissions belong to whoever owns the project, not to the command.

**Reading it.** Filter by `harvested_at` (when the harvest ran) or `report_date` (the day it covers, `DATE`, derived from `harvested_at`). The table is append-only: a slice re-harvested twice leaves two rows, so take the **latest `harvest_id` per `(repo, issue)`** — `QUALIFY ROW_NUMBER() OVER (PARTITION BY repo, issue ORDER BY harvested_at DESC) = 1`. And `NULL` is not `0`: every gap this document names above (a phase that never happened, telemetry older than a column, a role nobody dispatched) lands `NULL` in BigQuery too, never an invented zero.

**Only a complete harvest is loaded.** With unfinished reads `bq` is not invoked: the harvest is redone from GitHub, so nothing is lost. **No `—` of the report arrives as a `0`: the rule belongs to the COLUMN, not to the cell**, and a combined cell hands out one `NULL` per column that composes it — the map is below. If `bq` fails, the reason carries the code, the diagnosis, the directory with the files and the exact command to retry by hand. Everything about BigQuery goes to stderr: stdout is still the table or the JSON. Without the flag, nothing changes.

**From the cell to the column.** One to one: every `—` of a phase is a `NULL` in its `*_seconds`, and a slice with no PR leaves `pr`, `additions`, `deletions`, `changed_files`, `reviews` and `review_comments` at `NULL`; the `*` of `release→merge` is not a column, it is `merge_source = 'issue-closed'`. `report_date` is not a cell of the report: it is `DATE(harvested_at)`, added at the row's projection so a BigQuery reader can filter by day without parsing the timestamp. `implementer_email` collapses the `actor` of every step row of the slice the same way `tool` does (one value, `(mixed)` for two or more, `NULL` for none), and `tool_account_email` collapses the Claude Code OAuth account of every step the same way. Combined, in the telemetry: `Verdicts` is `verdicts`, `verdicts_fail` and `rubric_sin_vara_legacy`; `sin-vara` is `rubric_sin_vara`; `high/medium/low` are `findings_high`, `findings_medium`, `findings_low` and `findings_severity_legacy`; `Findings by rule` is `findings_by_rule` (a repeated record of `{rule, findings}`, which goes `[]` and not `NULL` when there are no verdicts or there is no file); `vara ct` are `rubric_vara_ct_docs`, `findings_vara_ct`, `rubric_vara_ct_docs_legacy` and `findings_vara_ct_legacy`; `brief` are `brief_vara_ct_docs`, `brief_bytes`, `brief_legacy` and `brief_attempts`; `bytes per role` are `agent_bytes`, `skill_bytes`, `package_bytes`, `role_bytes_legacy` and `role_bytes_attempts`; `returns` are `judge_vetoes`, `judge_corrections_ordered`, `judge_returns` and `judge_attempts`; `tool` are `tool`, `tool_version` and `tool_account_email`; `tokens` are `tool_input_tokens`, `tool_cached_input_tokens`, `tool_output_tokens`, `tool_total_tokens`, `tool_usage_status`, `tool_usage_attempts`, `tool_usage_measured` and `tool_usage_gaps`, with `tool_duration_status` and `tool_active_duration_ms` beside them. With a `telemetry_status` other than `ok`, every count goes `NULL`.

**Every one of those columns is additive and `NULLABLE`, on purpose.** Telemetry written before this measure stays valid: it lands `NULL` with `tool_usage_status = 'absent'`, which is not the same row as one whose tool measured a real zero — that one lands `0`.

**Half a cell can be a number and the other half a `NULL`.** The report requires BOTH halves to print `vara ct` or `brief` —the why is above, in «The judge's telemetry, per slice»—, but the table does not join them: a `—` in `vara ct` can be, in the row, `rubric_vara_ct_docs` with a number and `findings_vara_ct` at `NULL`, or the other way round. Every column says what was measured of it, which is more than the cell said.

This command loads a whole epic after the fact. The load of each slice as it is collected is done by the automatic harvest: `dispatch-check <n> --repo <o/r> --collect --bq <table>`, which the backend invokes every minute when it starts with `CT_HARVEST_BQ_TABLE`.

## The exit codes

| Code | Means | What to do |
|---|---|---|
| `0` | harvest complete | read the table |
| `1` | **could not be completed**: a `gh` read or the BigQuery load failed | look at the reasons on stderr, fix it and repeat — what is printed is only what is actually known |
| `2` | bad arguments | fix the invocation |

**The `1` never degrades into a `0`**, the same rule as `/ct-status` and `/ct-groom`. A partial harvest **is not a cheap epic**: a table with gaps that gets read as «this slice had no review», when what happened is that the read failed, is an invented datum coming in through the back door of a pre-registration that forbids exactly that. **A timeline that could not be read does not produce a row of zeros: it produces a reason and no row.**

## Details

- **`*` in `release→merge`** marks that that cell was measured against the **closing of the issue** and not against the merge of a PR. It goes in the cell itself, not in a footnote: a footnote does not travel when someone copies the table.
- **Two PRs closing one and the same issue** is said out loud as a reason (and drops the exit to `1`) instead of picking one in silence.
- **`--json`** emits `{repo, milestone, filas, motivos, telemetry}` with the seconds raw, to paste into the epic's outcome without translating anything. The fifth key is the read of the telemetry DIRECTORY (`{dir, status: ok|no-leido, why}`), distinct from the `telemetry` each row carries inside.
- **`--json`** carries each slice's telemetry INSIDE its row (`telemetry.status`: `ok` / `sin-fichero` / `no-leido`), for the same reason `type` and `gate` travel inside.
- The duration format (`1m03`, `2h06m17`, `9h41m23`) is the same one with which dispatch 1's outcome was written by hand, so that harvested table and written table can be compared without converting anything.
