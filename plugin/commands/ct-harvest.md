---
description: Harvest of the epic — the real cost of every slice, taken from GitHub's timeline. Zero manual fields. Only reads from GitHub; with --bq it loads the harvest into BigQuery.
---
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-harvest.mjs --repo "<owner/repo>" --milestone "<epic title>" [--json] [--bq <project:dataset.table>]
```

One row per slice (`ready→claim`, `claim→release`, `release→merge`, reopens, requeues, `blocked`, PR size) plus the judge's telemetry per slice and, for every role the loop dispatches to a subagent, how much fixed material it read (`agent_bytes`, `skill_bytes`, `package_bytes`, summarised in the `bytes per role` column). Beside them, what the coding tool spent and how many rounds it cost: the tool and its version, the exact tokens it reported (fresh input, cached input counted once, output and their total) and the judge's `returns` — its vetoes plus the corrections it ordered. Everything comes out of the timeline GitHub writes on its own and of the telemetry the slice left committed; it asks for no field by hand, and a tool that reports no usage lands a status and a `NULL`, never an estimate. **It mutates nothing.** A phase that did not happen prints `—`, never `0`; the summary goes by family (`Tipo`) and every family shows its N. The table or the JSON go to stdout; the reasons and everything about BigQuery, to stderr.

| Exit | Means | What to do |
|---|---|---|
| `0` | Harvest complete | read the table |
| `1` | **Could not be completed**: a `gh` read or the BigQuery load failed | look at the reasons on stderr, fix it and repeat — what is printed is only what is actually known |
| `2` | Bad arguments | fix the invocation |

The `1` never degrades into a `0`: a timeline that could not be read produces a reason and no row, not a row of zeros.

Full reference —the three decisions of the harvest, every telemetry column, the map from cell to BigQuery column—: `docs/loop/ct-harvest.md` in the plugin repo.
