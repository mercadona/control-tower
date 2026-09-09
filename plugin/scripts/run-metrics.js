// ============================================================================
// RUN-METRICS — one row per ATTEMPT OF A STEP OF A TASK.
//
// The finest granularity the program already knows effortlessly. Aggregating
// upwards —per task, per plan, per epic— is an addition; undoing an aggregation
// is nothing at all, so the fine grain is stored and the adding happens on
// reading.
//
// A PURE module: it composes the row and decides where it goes. It does not
// write. The one that writes is `ct-step.mjs`, and it does so swallowing the
// exception on purpose (see further down).
//
// ---------------------------------------------------------------------------
// THE IDENTITY FIELDS THAT ARE NOT OBVIOUS
//
// `plan_sha256`. The plan is called `…/YYYY-MM-DD-issue-<n>-<slug>.md` and that
// `issue-<n>-` is exactly how the `--release` gate finds it: the issue number IS
// the parent plan's identity and there is no need to invent one. What it does
// not cover is that a plan GETS REWRITTEN —after the gate, or after a rejection
// in review—, and then two runs against two versions of the same file are
// indistinguishable precisely where they are going to be looked at most: the
// before and after of changing a plan. The content hash is besides the idiom the
// repo already uses for this very class of problem
// (`SLICES_PRISTINE_HASHES`).
//
// `attempt`. It is a DIMENSION of the row, not an aggregate counter. Without it
// there is no measuring how many times the judge vetoed nor how many round trips
// each task cost, and that is precisely the datum that decides whether this
// experiment is worth it. `agentic-skills` solves it with counters per closed
// slice because there the unit is the slice; here the unit is the task, so the
// row per attempt comes free out of the counter the machine already keeps.
//
// `plugin_version`. The same argument as `plan_sha256`, applied to the LOOP
// instead of to the plan: a rewritten `ct-step` makes two runs incomparable. And
// it gets rewritten more than any plan —every round of this experiment touches
// it—, so without the plugin's version two rows of two different loops aggregate
// as if they measured the same mechanism, and the improvement (or the worsening)
// that separates them reads as noise. The field run that motivates this field
// was done with 0.36.1; without the field, that figure lives only in the memory
// of whoever was there.
//
// `actor`. Today it does not matter and it IS GOING TO STOP NOT MATTERING. Every
// row lives on the disk of whoever wrote it, so the actor is implicit and
// redundant; as soon as the rows travel inside the pull request, rows from two
// different machines will be mixed in a single file and with no actor there is
// no knowing whose the cost is — which is the datum this file gets opened for.
//
// ---------------------------------------------------------------------------
// ONE FIELD THAT WENT AWAY: `session`. It was in the list, worth `null` in ALL
// the rows, because with `ct-step` the calls to the model are subagents of the
// session and there is no conversation identifier to collect — its only writer
// passed it `null` flat out. A column that is always null is not a pending
// datum: it is training for whoever reads the file to learn to skip columns, and
// the one next to it gets skipped right after. It comes back the day headless
// calls return an identifier to put inside; adding a field to this list costs
// one line, and promising a dimension the mechanism cannot give costs the trust
// in the rest of the row.
//
// ---------------------------------------------------------------------------
// AND THE ABSENCE IS DECLARED, NOT FILLED IN: an issue with no milestone is
// noted `(sin milestone)` with the constant that already exists, never empty. It
// is the same rule that stopped `ct-next` from silently assuming `main` when it
// did not know the base — a gap in a metric reads as a zero, and a zero is an
// assertion.
//
// The two new fields follow that rule with a sentinel of their own and not with
// `null`, and the reason is that they are what gets GROUPED BY: asking «how much
// did it cost with 0.36.1» or «how much has this actor spent» over a column with
// nulls melts into one and the same group the rows that did not carry the datum
// and the ones that carried it empty. The sentinel keeps the column's type and
// says out loud that there was no datum there.
// ============================================================================

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { NO_MILESTONE_KEY } from './gh-issue-map.js'
import { YardstickCitation } from './yardstick-citation.js'

// The identity fields of §10.1 of the spec, in order: where and against what
// (repo, epic, issue, plan and its hash), which step (task, step, attempt) and
// with what machinery and whose (plugin version, actor). `session` is not there:
// see the header.
export const IDENTITY_FIELDS = Object.freeze([
  'repo', 'epic', 'issue', 'plan', 'plan_sha256',
  'task', 'task_name', 'tasks_total', 'step', 'attempt',
  'plugin_version', 'actor',
])

// The absence sentinels of the two fields that get grouped by. They are exported
// so that whoever writes rows or reads them does not type the string again: a
// badly copied sentinel splits the column into two groups nobody knows are the
// same one.
export const NO_VERSION_KEY = '(sin versión)'
export const NO_ACTOR_KEY = '(sin actor)'

export const planSha256 = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')

// THE MACHINE DESTINATION, which is no longer the only one. Here goes this
// account's running total —every repo, every epic—, under CLAUDE_CONFIG_DIR when
// there is one, which is where the rest of its state lives.
//
// The reason for it being the only one was "so that no `git add` of the slice
// takes the telemetry inside the pull request". The reason is still good; the
// conclusion is not: the first run in somebody else's repo left the rows on the
// disk of whoever dispatched and nowhere else, while the verdict of the same run
// did travel. So `ct-step` additionally writes a copy INSIDE the repo and stages
// it itself, after the checks. What the reason forbade was an implementer's
// `git add` dragging it along, not it travelling.
// The folder, apart from the row: since this round there is a second tenant that
// is not telemetry —the log of the `-OK` watcher, which runs detached and
// without it would be undebuggable— and the two things go to the same place for
// the same reason. It is extracted instead of duplicating the `join`, and
// `metricsPath` is still the one that decides the extension of ITS OWN.
export function controlTowerDir({ configDir = null, home = null } = {}) {
  return join(configDir || join(home || homedir(), '.claude'), 'control-tower')
}

// `log/` is ONE tenant of the folder, not the folder. Since F38 there is a
// second one that is not a trace but STATE —the go's commitment
// (go-registry.js)—, and mixing it in with the logs would make «delete the log,
// it takes up space» leave a slice in flight unreleased. It is separated at the
// level above, and that is why the root's `join` is extracted instead of
// duplicated.
export function controlTowerLogDir(opts = {}) {
  return join(controlTowerDir(opts), 'log')
}

export function metricsPath(concept, { configDir = null, home = null } = {}) {
  return join(controlTowerLogDir({ configDir, home }), `${concept}.jsonl`)
}

// THE PATH INSIDE THE REPO, in a single constant and not in two: `ct-step
// commit` writes it and `/ct-harvest` reads it. Copied by hand in both places, a
// rename leaves the reader looking at a directory that no longer exists and the
// report says «sin telemetría» of an epic that does have it — the same gap read
// as a zero that the rest of this file exists against. In POSIX on purpose (not
// `join`): it is at once a `git add` pathspec and a path of GitHub's contents
// API, and both speak with forward slashes.
export const METRICS_REPO_DIR = 'docs/superpowers/metrics'
export const metricsRepoRelPath = (issue) => `${METRICS_REPO_DIR}/issue-${issue}.jsonl`

// The row. `measures` are the step's measurements —the state of the checks with
// the path of their log, the verdict with its count by severity, cost, turns and
// duration of the call, the size of the judged diff— and they travel apart from
// the identity so that adding a new measurement cannot break a key.
export function metricRow(identity, measures = {}, { now }) {
  const row = {}
  for (const field of IDENTITY_FIELDS) row[field] = normalize(field, identity[field])
  row.written_at = now
  return { ...row, ...measures }
}

// The empty is treated as the absence in the three fields with a sentinel
// (`value ||` and not `??`): an `epic: ''`, a version that came out empty from
// reading the manifest or an actor the environment could not supply are the same
// gap as not carrying them, and telling them apart would create a phantom group
// named with the empty string.
function normalize(field, value) {
  if (field === 'epic') return value || NO_MILESTONE_KEY
  if (field === 'plugin_version') return value || NO_VERSION_KEY
  if (field === 'actor') return value || NO_ACTOR_KEY
  if (value === undefined) return null
  return value
}

export const metricLine = (row) => JSON.stringify(row) + '\n'

// RECOGNISING A CITATION OF THE YARDSTICK lives in
// `scripts/yardstick-citation.js` and not here. It was here for two rounds and
// it was a new concept fattening up inside an old file —three loose constants
// and two free functions, which is literally the shape `conventions/style.md`
// describes as «a type waiting to be born»— and inheriting along the way this
// module's style exemption. This file composes telemetry ROWS; parsing prose to
// recognise citations is another matter (`conventions/architecture.md`: one
// concept per module). The argument for WHY two forms of citation are accepted
// is in §10 of the design: that module is born conformant, so it carries no
// prose inside.

// The verdict's count by severity, which is what makes it possible to read "how
// many vetoes" without loading the findings again.
//
// `findings_by_rule` is added alongside, it replaces nothing: one counter for
// every VERDICT_RULES rule that appears in THIS verdict (not all of them at
// zero, because an absent rule contributes nothing to the count). It is the
// datum that says whether the judge's rubric is well calibrated —which rule
// vetoes most, which never vetoes— and it is only trustworthy because the `rule`
// enum is closed: without that, every judge would invent its own vocabulary and
// the count would be noise.
export function verdictMeasures(verdict) {
  const findings = verdict?.findings || []
  const findingsByRule = {}
  for (const f of findings) findingsByRule[f.rule] = (findingsByRule[f.rule] || 0) + 1
  return {
    ruling: verdict?.ruling ?? null,
    findings_total: findings.length,
    findings_high: findings.filter((f) => f.severity === 'high').length,
    findings_medium: findings.filter((f) => f.severity === 'medium').length,
    findings_low: findings.filter((f) => f.severity === 'low').length,
    findings_by_rule: findingsByRule,
    // How many rubric items were walked WITHOUT the input to measure them
    // with. It is the only class of `outcome` that gets counted: `conforme` and
    // `no-aplica` are the rubric working, and they are already deducible from
    // the total. A run with this column high is a judge that said PASS blind,
    // which is exactly what could not be seen reading rust-monitoring's
    // verdicts by hand.
    rubric_sin_vara: (verdict?.rubric || []).filter((step) => step.outcome === 'sin-vara').length,
    // TWO columns, and they are two OPPOSITE questions the previous one mixed
    // into one. `findings_patrones_vara_ct` —the one these two replace— only
    // looked at findings of the `patrones` item, with the argument that it is
    // the only one that measures against the yardsticks. The run of slice #7 of
    // rust-monitoring refuted that by measuring: the ct yardstick showed up
    // cited twice under `decisiones-cerradas`, and the mutation rule of
    // `conventions/testing.md` was answered under `test-desiderata`. A finding
    // the yardstick produced but that got filed under another item was
    // INVISIBLE, so the column measured where the finding was filed and not what
    // produced it.
    //
    //   `rubric_vara_ct_docs` — HOW MANY of the documents got used at all,
    //     counted over the `result` of ALL the items. It is "they read it". The
    //     ceiling is the number of documents the yardstick declares
    //     (`PluginYardstick.FILES.length`), except in a task that does not open
    //     a new module: there `architecture.md` does not travel in its brief and
    //     what is reachable is one less. A number below what is reachable says
    //     which one is surplus or which one is not being looked at. This is the
    //     gap that cost #7: `conventions/code.md` was cited for its style rules
    //     and not one of its four defect rules was asked about, which led to
    //     splitting it into `style.md` and `defects.md` — with the old column
    //     that could not be seen.
    //   `findings_vara_ct`     — how many findings cite it, under ANY rule.
    //     It is "it caught something", and it is the only proof that the
    //     yardstick pays for its transport.
    //
    // Both go in because they separate what could not be separated: "they read
    // it and it caught nothing" can be a diff that conformed or a judge that
    // named it for decoration, and with a single number the two readings are the
    // same figure. They are not two columns that have to add up to the same
    // thing —the reproach that sank the previous one—: they measure the input
    // and the effect.
    rubric_vara_ct_docs: [...new Set(
      (verdict?.rubric || []).flatMap((step) => YardstickCitation.documentsIn(step?.result))
    )].length,
    findings_vara_ct: findings.filter((f) => YardstickCitation.cites(f.evidence)).length,
  }
}

// ---------------------------------------------------------------------------
// THE READER OF WHAT `verdictMeasures` WROTE. It lives glued to it on purpose:
// as long as the row's writer and reader are in the same file, a renamed field
// cannot end up written in one place and read in another.
//
// Which hole it comes out of: `rubric_sin_vara` had been travelling in the pull
// request since `1422c67` and NOBODY READ IT (§3.4 of the handoff). The column
// existed on disk and §2 —«is the yardstick arriving?»— was answered by opening
// `jsonl` files by hand.
//
// IT IS ADDED UP ON READING, which is what this module's header promises: the
// row is per ATTEMPT, and two judge attempts over the same task are two rows
// that add up. That is why `verdicts` is returned too: a 3 out of 12 verdicts
// and a 3 out of 3 are not the same repo, and whoever reads the figure has to
// see the N without asking.
//
// THE THREE TOLERANCES, and not one of them is cosmetic:
//
//  1. `legacy` — a verdict row WITHOUT `rubric_sin_vara` is telemetry older than
//     the column (PR #11 of jjponz/rust-monitoring left 15 rows like that). It
//     does NOT count as a zero: a zero would assert that the judge had its
//     yardstick, and what happened is that nobody measured it. If no verdict
//     carries it, `rubricSinVara` comes out `null` and whoever paints the table
//     is forbidden from printing `0`.
//  2. `malformed` — a line that is not JSON, or that is JSON and is not an
//     object, gets counted and the walk goes on. Throwing away the whole file
//     over one broken line would lose the good ones, and making it lower the
//     exit would be asking for a «fix it and repeat» of something written three
//     weeks ago that cannot be redone.
//  3. A verdict is a row with `ruling`, NOT a row of the `judge` step:
//     `ct-step` writes discarded-judge rows (`outcome: 'discarded'`) with no
//     measurement at all, and counting them would inflate the denominator of the
//     figure this aggregate exists to make legible.
//
// And `findings_by_rule` is added up AS IT COMES, without crossing it with
// VERDICT_RULES: a rule withdrawn from the rubric has to keep showing up in the
// old telemetry. Filtering against today's enum would erase history in
// silence.
export function aggregateVerdictMeasures(text) {
  let rows = 0
  let malformed = 0
  let verdicts = 0
  let fails = 0
  let measured = 0
  let legacy = 0
  let withoutYardstick = 0
  // THE SEVERITY, with twin counters of its own for the same reason as the
  // yardstick's: it was born after `rubric_sin_vara` and a row can carry the one
  // and not the others. The three go TOGETHER —a row missing a single one is old
  // in its entirety—, because the breakdown is only read added up: two highs and
  // one low from one row, with another's medium lost, describes nothing.
  let measuredSeverities = 0
  let legacySeverities = 0
  let high = 0
  let medium = 0
  let low = 0
  // Counters TWIN to `measured`/`legacy`, but for the two columns of the ct
  // yardstick and not for `rubric_sin_vara`: they are different measurements,
  // each with its own date of birth in the telemetry, so a row can carry the one
  // and not the other. Melting them into the same counters would confuse "this
  // row is old for measurement A" with "it is old for measurement B".
  //
  // One pair per column and not a shared one, for the same reason:
  // `rubric_vara_ct_docs` and `findings_vara_ct` are born together today, but
  // the one they replaced (`findings_patrones_vara_ct`) proved that one column
  // gets withdrawn and the other stays. Sharing counters would force untangling
  // them on that day.
  let measuredCtYardstickDocs = 0
  let legacyCtYardstickDocs = 0
  let ctYardstickDocs = 0
  let measuredFindingsCtYardstick = 0
  let legacyFindingsCtYardstick = 0
  let findingsCtYardstick = 0
  const findingsByRule = {}
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() === '') continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      malformed += 1
      continue
    }
    if (row === null || typeof row !== 'object' || Array.isArray(row)) { malformed += 1; continue }
    rows += 1
    if (!Object.hasOwn(row, 'ruling')) continue
    verdicts += 1
    // `FAIL` and not `!== 'PASS'`: the vocabulary is closed by `readVerdict`,
    // and counting as a veto a ruling this loop does not know how to write would
    // be guessing.
    if (row.ruling === 'FAIL') fails += 1
    const severities = [row.findings_high, row.findings_medium, row.findings_low]
    if (severities.every((count) => Number.isInteger(count) && count >= 0)) {
      measuredSeverities += 1
      high += row.findings_high
      medium += row.findings_medium
      low += row.findings_low
    } else {
      legacySeverities += 1
    }
    const n = row.rubric_sin_vara
    if (Number.isInteger(n) && n >= 0) { measured += 1; withoutYardstick += n } else { legacy += 1 }
    const d = row.rubric_vara_ct_docs
    if (Number.isInteger(d) && d >= 0) { measuredCtYardstickDocs += 1; ctYardstickDocs += d } else { legacyCtYardstickDocs += 1 }
    const h = row.findings_vara_ct
    if (Number.isInteger(h) && h >= 0) { measuredFindingsCtYardstick += 1; findingsCtYardstick += h } else { legacyFindingsCtYardstick += 1 }
    const byRule = row.findings_by_rule
    if (byRule && typeof byRule === 'object' && !Array.isArray(byRule)) {
      for (const [rule, count] of Object.entries(byRule)) {
        if (Number.isInteger(count) && count > 0) findingsByRule[rule] = (findingsByRule[rule] || 0) + count
      }
    }
  }
  return {
    rows, malformed, verdicts, fails, measured, legacy, rubricSinVara: measured ? withoutYardstick : null, findingsByRule,
    measuredVaraCtDocs: measuredCtYardstickDocs, legacyVaraCtDocs: legacyCtYardstickDocs,
    varaCtDocs: measuredCtYardstickDocs ? ctYardstickDocs : null,
    measuredFindingsVaraCt: measuredFindingsCtYardstick, legacyFindingsVaraCt: legacyFindingsCtYardstick,
    findingsVaraCt: measuredFindingsCtYardstick ? findingsCtYardstick : null,
    measuredSeverities, legacySeverities,
    findingsHigh: measuredSeverities ? high : null,
    findingsMedium: measuredSeverities ? medium : null,
    findingsLow: measuredSeverities ? low : null,
  }
}

// ---------------------------------------------------------------------------
// WHETHER THE YARDSTICK ARRIVED, AND HOW MUCH IT WEIGHED. Today `ct-step.mjs`
// aborts if the `conventions/` documents are missing from the PLUGIN, but
// nothing checked that a task's brief had TAKEN them with it: if somebody
// touches `writeBrief` and breaks the pasting, everything stays green and the
// judge silently measures only against the repo's yardstick. This is the
// mechanism that closes that silent drift.
//
// PURE ON PURPOSE, like the rest of the file: it does not read disk. It counts
// over the CONTENT `ct-step.mjs` already read from the brief that is on disk —
// the single source of truth, and not a datum dragged along from `writeBrief`
// (which runs in an EARLIER invocation of the process, with nothing in memory to
// pass). The one that decides `null` when the brief cannot be read is
// `ct-step.mjs`: a zero here would assert a brief with no yardstick, and what
// would have happened is that it could not be looked at.
//
// It counts headings, not bytes of a list: `## Vara de ct: conventions/` is
// exactly what `PluginYardstick.composeSection`
// (scripts/plugin-yardstick.js) writes for each document, and counting them
// —instead of comparing against `PluginYardstick.FILES.length`— is what let the
// fifth document (`defects.md`, on splitting `code.md`) be counted without
// touching this function. And so it was verified: it did not have to be
// touched.
export function briefCtYardstickMeasures(briefContent) {
  const text = String(briefContent ?? '')
  const docs = (text.match(/^## Vara de ct: conventions\//gm) || []).length
  return { brief_vara_ct_docs: docs, brief_bytes: Buffer.byteLength(text, 'utf8') }
}

// ---------------------------------------------------------------------------
// THE READER OF WHAT `briefCtYardstickMeasures` WRITES in the row of the `implement`
// step. It is a SIBLING aggregator of `aggregateVerdictMeasures`, not the same
// one: those rows carry no `ruling` —`ct-step.mjs` writes them in `reportVerb`,
// before any verdict exists— so the verdict aggregator ignores them by design
// (tolerance nº3 up above) and there is no need to touch it. Without an
// aggregator of its own, `brief_vara_ct_docs` and `brief_bytes` would have
// travelled in the pull request with nobody to read them — the same hole
// `rubric_sin_vara` already paid for (§3.4 of the handoff).
//
// THE SAME `measured`/`legacy` RULE as `rubric_sin_vara`, traced exactly: a row
// of the `implement` step without the two fields —telemetry older than this
// measurement, or an attempt in which the brief could not be read at the time—
// does NOT count as a zero. Only what was measured gets added up, and if no
// attempt carries the column the aggregate is `null`.
export function aggregateBriefMeasures(text) {
  let briefAttempts = 0
  let briefMeasured = 0
  let briefLegacy = 0
  let docs = 0
  let bytes = 0
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() === '') continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    if (row.step !== 'implement') continue
    briefAttempts += 1
    const d = row.brief_vara_ct_docs
    const b = row.brief_bytes
    if (Number.isInteger(d) && d >= 0 && Number.isInteger(b) && b >= 0) {
      briefMeasured += 1
      docs += d
      bytes += b
    } else {
      briefLegacy += 1
    }
  }
  return {
    briefAttempts, briefMeasured, briefLegacy,
    briefVaraCtDocs: briefMeasured ? docs : null,
    briefBytes: briefMeasured ? bytes : null,
  }
}

// ---------------------------------------------------------------------------
// THE READER OF WHAT `RoleBytes` WRITES (scripts/role-bytes.js) in the rows of
// the four steps that dispatch to a subagent. Third sibling of the two
// aggregators up above, and for the same reason the second one had: a column
// that travels in the pull request with nobody reading it gets answered by
// opening `jsonl` files by hand, which is exactly the hole `rubric_sin_vara`
// paid for.
//
// THE QUESTION IT ANSWERS: how much FIXED material —the agent's file and the
// skills its prompt orders it to load— and how much VARIABLE material —the brief
// or the package— this slice read in total. The three columns are added up at
// once and not separately because the comparison that motivates the measurement
// (`brief_bytes + agent_bytes + skill_bytes` before and after) is one sum, not
// three.
//
// WHO COUNTS AS AN ATTEMPT, and why it is not "every row of those four steps":
//
//  1. A row with the three fields whole is a MEASURED role, whichever step it
//     comes from. A `skill_bytes` at zero is a measurement —the slice judge
//     loads no skill— and not an absence.
//  2. A row of `implement`, or a judge one WITH `ruling`, without the three
//     fields is a role that ran and that nobody measured: telemetry older than
//     this measurement. It counts as old, never as a zero.
//  3. EVERYTHING ELSE STAYS OUT. A discarded judge never got to judge (the same
//     tolerance nº3 of `aggregateVerdictMeasures`) and a `reconcile` round with
//     no package written dispatched nobody: counting them as old would put into
//     the denominator calls to the model that were never made, and the figure
//     that comes out of dividing by it is precisely the one this column exists
//     to make legible.
export function aggregateRoleBytesMeasures(text) {
  let roleAttempts = 0
  let roleMeasured = 0
  let roleLegacy = 0
  let agentBytes = 0
  let skillBytes = 0
  let packageBytes = 0
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() === '') continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    const measurements = [row.agent_bytes, row.skill_bytes, row.package_bytes]
    if (measurements.every((count) => Number.isInteger(count) && count >= 0)) {
      roleAttempts += 1
      roleMeasured += 1
      agentBytes += row.agent_bytes
      skillBytes += row.skill_bytes
      packageBytes += row.package_bytes
      continue
    }
    if (row.step === 'implement' || Object.hasOwn(row, 'ruling')) {
      roleAttempts += 1
      roleLegacy += 1
    }
  }
  return {
    roleAttempts, roleMeasured, roleLegacy,
    agentBytes: roleMeasured ? agentBytes : null,
    skillBytes: roleMeasured ? skillBytes : null,
    packageBytes: roleMeasured ? packageBytes : null,
  }
}
