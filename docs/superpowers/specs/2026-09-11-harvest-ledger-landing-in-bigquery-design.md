# The harvest ledger lands in BigQuery, at last with an address of its own

## Context

`/ct-harvest --bq <project:dataset.table>` has loaded one row per merged slice
into BigQuery since the harvest existed, but no destination was ever decided
for it: `CT_HARVEST_BQ_TABLE` names whatever `project:dataset.table` a
deployment happens to be given, and a `bq load` into a table that does not
exist yet auto-creates it — unpartitioned, unclustered, with no description.
The table has worked as a personal landing spot; it has never worked as a
company dataset another team could read.

`HarvestTable.SCHEMA` (`plugin/scripts/harvest-table.js`) already carries the
cost of every slice: the ready→claim/claim→release/release→merge phases,
reopens, requeues, blocked episodes, PR size, the judge's telemetry, and what
the coding tool spent in tokens. What it did not carry until this slice is
**when** a row was produced in a queryable form, and **who** produced it — the
two things a reader outside this repository needs before it can join this
table against anything else.

## Why a new dataset

A dataset already exists that could consume metrics like these, but writing
into it directly is not safe: the consuming tool's own datasets are managed
by dbt and by a streaming subscription, so a raw landing dataset of our own is
the safe choice. Concretely, two hazards rule out writing straight into a
consumer's dataset:

- **A dbt-managed mart deletes what its manifest does not know about.** A
  scheduled workflow in that consumer's repository deletes, on a regular
  schedule, every table in its mart dataset that is not declared in the dbt
  manifest. A table this repository wrote into by hand would be deleted the
  first time it forgot to also touch that manifest — the workflow does not
  ask, it derives "not ours" from a git-tracked list this repository does not
  own.
- **A subscription-owned dataset has a schema this loop does not control.**
  Some of that consumer's raw tables are created and owned by streaming
  subscription tooling elsewhere: a table's shape there is a function of a
  message schema, not of a `bq mk --schema=...` this loop controls. Writing
  into it would mean this loop's schema is dictated by a system it has no
  relationship with.

Neither shape is wrong for what it was built for. Both are wrong for a raw
landing table this repository owns end to end: its own schema, its own
partitioning decision, its own retention. The company's `<domain>_incoming`
convention names exactly that shape, and this dataset is Control Tower's own
instance of it.

## The reachable chain, for the record

The reason "just write into the consumer's dataset" reads tempting is that a
working chain already exists elsewhere in the company from a raw event to a
queryable mart: a source system publishes an event, a subscription lands it
in a raw incoming dataset, a dbt mart builds a fact table on top of it, and a
downstream tool syncs from that fact table back into its own store.

This slice does not join that chain. It gives Control Tower a landing table
shaped the same way that raw layer is shaped — `<domain>_incoming`, one
dataset per producer — so that a dbt mart could point a `sources.yml` entry
at it the same way it points at other raw incoming datasets today, the day a
consumer wants to read it. Building that mart is not this slice's job; making
the raw table safe and legible enough that someone else could is.

## The landing

- **Dataset**: `<project>:<dataset>`, region `EU`, with labels identifying
  the source and the owning team.
- **Table**: `<project>:<dataset>.<table>`, partitioned by `DAY`
  on `harvested_at`, clustered on `repo, milestone` — the two columns every
  read of this table filters or groups by first.
- **Creation is manual, once**, with the exact `bq mk` commands in
  `docs/loop/ct-harvest.md` ("To BigQuery"). A `bq load` into a table that does
  not exist auto-creates it unpartitioned; partitioning and clustering only
  take effect at `bq mk --table` time, so the harvest's own `bq load` must
  never be the thing that creates this table.
- **Append-only.** Every harvest run inserts a fresh batch of rows, one per
  slice, tagged with its own `harvest_id` and `harvested_at`; nothing is
  overwritten or deleted. A slice harvested twice leaves two rows, and a
  reader takes the latest `harvest_id` per `(repo, issue)`.

### The three new columns, and why

- **`report_date`** (`DATE`, `NULLABLE`) — the first 10 characters of
  `harvested_at`. `harvested_at` is a `TIMESTAMP` with the harvest's exact
  instant; nobody groups a report by an instant. This column exists purely so
  a BigQuery reader can `GROUP BY report_date` without a `DATE()` cast in every
  query, and so a load into a **wrongly named** table (see the one control this
  slice does not touch: the partitioning field must stay `harvested_at`, not
  this one — partitioning on a derived column BigQuery cannot prove is
  monotonic with load time is a worse trade than the convenience it buys).
- **`implementer_email`** (`STRING`, `NULLABLE`) — the slice's step rows each
  carry `actor` (`git config user.email`, sentinel `(sin actor)` when it could
  not be read). This column collapses that column across every step row of the
  slice with the same rule `tool`/`tool_version` already use: one distinct
  value wins, two or more collapse to `(mixed)`, none is `NULL`. It answers
  "who implemented this slice" without a join back to GitHub or to the
  `ct-step` telemetry file.
- **`tool_account_email`** (`STRING`, `NULLABLE`) — which Claude Code account
  ran each step, read from `oauthAccount.emailAddress` in
  `<CLAUDE_CONFIG_DIR-or-HOME>/.claude.json` at `ct-step` time
  (`plugin/scripts/claude-code-account.js`). It exists apart from
  `implementer_email` because they can differ: whoever configured `git`'s
  `user.email` is not necessarily the account the coding tool ran under (a
  shared machine, a dispatched agent). Only Claude Code exposes this today; any
  other tool lands `NULL`, exactly like a tool this loop cannot measure token
  usage for.

Both identity columns reuse `IdentityCollapse` (`plugin/scripts/tool-usage.js`),
extracted out of `ToolUsageTotal`'s existing tool/version rule rather than
writing a third copy of "one value, `(mixed)`, or none."

## How a downstream consumer can read it later

Two shapes are both compatible with what this slice ships, and neither is
built by it:

1. **A `sources.yml` entry in a dbt mart**, the same way an existing mart
   already declares another raw incoming dataset as a source, pointing at
   `<dataset>.<table>` and building a mart on top with its own
   `QUALIFY ROW_NUMBER() OVER (PARTITION BY repo, issue ORDER BY harvested_at
   DESC) = 1` to collapse the append-only ledger into "latest per slice."
2. **A sync command in the downstream tool**, reading the table directly with
   that same `QUALIFY` clause, the way that tool already syncs from its own
   fact tables today.

Either path is the consumer's decision to make and the consumer's code to
write. This slice's job ends at handing over a table that is safe to point
either at.

## Out of scope

- **The per-step telemetry rows** (`docs/superpowers/metrics/issue-<n>.jsonl`)
  are not loaded into BigQuery, only their aggregate per slice. The row-level
  detail stays where it already lives: committed inside each governed
  repository.
- **No dbt mart** is written by this slice. `sources.yml` and any
  `stg_control_tower__slices`-shaped model are a downstream consumer's to
  build when they decide to consume this table.
- **No downstream code changes.** Nothing in any consuming repository is
  touched.
- **No Pub/Sub involvement.** The ledger is loaded by `bq load` from the
  plugin directly; it does not go through a topic or a subscription.
- **No `team` column.** `repo` already tells slices of different repositories
  apart, and a `team` column would need an owner to keep it correct as teams
  and repositories move — a job nobody has signed up for yet.
