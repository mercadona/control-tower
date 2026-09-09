#!/usr/bin/env node
// /ct-harvest — WHAT QUESTION IT ANSWERS: «how much did each slice of this
// epic cost, according to what GitHub already wrote on its own?». It emits one
// row per slice with the dependent variables of the pre-registration (§6 of the
// F32 handoff): ready→claim, claim→release, release→merge, reopens, requeues,
// blocked episodes, PR size and review comments.
//
// IT IS HARVESTED, NOT CAPTURED. Zero manual fields. Not one. The only by-hand
// datum in the whole measure —the minutes of human intervention— lives in the
// epic's outcome and is NOT asked for here: the moment a harvester admits one
// manual field it turns into a form, and a form is exactly how
// docs/medicion-slices.md died (2 rows, the key column at «no medido»).
//
// IT WAS WRITTEN AFTER DISPATCH 1, on purpose and by order of the handoff. The
// three decisions of scripts/harvest.js come from having harvested menoplus's
// epic #602 by hand (2026-08-12/13); not one of them was deduced before having
// data in front of us. What this command automates is work that was already
// done once by hand, not work that is imagined.
//
// IT MUTATES NOTHING. No labels, no issues, no PRs: it only reads. Same as
// /ct-status, and tied down by the same kind of test over the real argv `gh` is
// called with — not by the mere absence of errors.
//
// THE 1 NEVER DEGRADES INTO A 0, the same hard rule as /ct-status and
// /ct-groom: 0 = complete harvest, 1 = some read could not be completed. A
// partial harvest is NOT a cheap epic, and whoever receives the signal has to
// be able to tell them apart: a table with gaps that gets read as «this slice
// had no review» when what happened is that the read failed would be an
// invented datum coming in through the back door of a pre-registration that
// forbids exactly that.
//
// IT ALSO READS THE JUDGE'S TELEMETRY that the slice itself left committed in
// docs/superpowers/metrics/issue-<n>.jsonl. Since 1422c67 every verdict emits
// `rubric_sin_vara` (how many rubric items were walked without the input to
// measure them with) and `findings_by_rule`, and until now NOBODY READ THEM:
// the column existed on disk and the question that motivated all of that —«is
// the yardstick arriving?»— was answered by opening jsonl files by hand (§3.4
// of the handoff docs/prompt-juez-lo-que-queda.md).
//
// It is read from GitHub and not from disk, like everything else in this
// command: there is no checkout to assume, and a directory absent in the wrong
// cwd would come out as «zero sin-vara», which is the invented zero this file
// forbids.
//
// AND THE TWO READS CARRY DIFFERENT WEIGHT. The directory LISTING failing does
// NOT drop the exit to 1: the cause is almost always that that repo has no
// telemetry (every epic older than 1422c67), and a permanent exit 1 on those
// epics teaches people to ignore the exit code, which is exactly the signal the
// «the 1 never degrades into a 0» rule protects. What is paid in exchange is
// printing NOT A SINGLE NUMBER in that case and saying out loud that it is not
// known. A FILE that the listing did name and could not be read, on the other
// hand, is a genuinely incomplete harvest: reason and exit 1.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatDuration } from './harvest.js'
import { parseRepoSlug } from './dispatch.js'
import { METRICS_REPO_DIR } from './run-metrics.js'
import { BigQueryTable, LoadOutcome } from './bigquery-load.js'
import { HarvestLedger, LedgerIdentity } from './harvest-ledger.js'
import { IndexOutcome, SliceHarvest, SliceRead, TelemetryIndex } from './slice-harvest.js'

// Hardened `arg()`: the SAME one as ct-next.mjs/ct-groom.mjs/ct-status.mjs,
// word for word and for the same measured reason — a dangling flag cannot
// sneak the next flag in as its value.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}

const usage = 'uso: ct-harvest.mjs --repo <owner/repo> --milestone <título> [--json] [--bq <proyecto:dataset.tabla>]'

const repo = arg('--repo')
if (repo === true) { console.error(`--repo inválido: "(sin valor)" — ${usage}`); process.exit(2) }
if (typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }
if (!parseRepoSlug(repo)) {
  console.error(`--repo inválido: "${repo}" — debe tener la forma owner/repo (p.ej. josemerca/control-tower), con exactamente una barra y ambas mitades no vacías.`)
  process.exit(2)
}

const milestone = arg('--milestone')
if (milestone === true) { console.error(`--milestone inválido: "(sin valor)" — ${usage}`); process.exit(2) }
if (typeof milestone !== 'string' || milestone.length === 0) { console.error(usage); process.exit(2) }

const bqArg = arg('--bq', null)
if (bqArg === true) { console.error(`--bq inválido: "(sin valor)" — ${usage}`); process.exit(2) }
const bqTable = bqArg === null ? null : BigQueryTable.parse(bqArg)
if (bqArg !== null && !bqTable) {
  console.error(`--bq inválido: "${bqArg}" — debe tener la forma proyecto:dataset.tabla (p.ej. mi-proyecto:control_tower.harvest).`)
  process.exit(2)
}

const asJson = process.argv.includes('--json')

const GH_MAX_BUFFER = 20 * 1024 * 1024
const CHILD_TIMEOUT_MS = 10 * 60 * 1000

const gh = (a) => {
  try {
    return execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GH_MAX_BUFFER, timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' })
  } catch (e) {
    const detail = (e && e.stderr ? String(e.stderr).trim() : '') || (e && e.message) || 'error desconocido'
    throw new Error(detail)
  }
}

// `bqRunner`: traced from `localRunner` in dispatch-check.mjs. The adapter
// (BigQueryLoad) receives the runner with the cap ALREADY in place — it does
// not choose the timeout itself, whoever builds it here chooses it.
const bqRunner = (a) => {
  try {
    return { code: 0, stdout: execFileSync('bq', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' }), stderr: '' }
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}

// reasons: everything that could NOT be harvested. It is the only thing that decides the exit 1.
const reasons = []

// The epic's issues, open AND closed. Via the GraphQL of `gh issue list`
// because we need to filter by milestone and bring `closedAt`, which the REST
// endpoint does not expose under that name.
//
// WITHOUT a `--limit` bounded to a small number: that endpoint returns newest
// first, so a low cap leaves out precisely the OLD slices — the first ones of
// the epic, which are the ones it matters most to measure. It is the same
// mistake that already cost a false report in this repo (see the header of
// ct-status.mjs).
let issues = []
try {
  issues = JSON.parse(gh([
    'issue', 'list', '--repo', repo, '--milestone', milestone, '--state', 'all',
    '--limit', '1000',
    // closedByPullRequestsReferences: it is GitHub that says which PR closed
    // each issue. Deducing it from the timeline already produced a green and
    // wrong table (see closingPrNumbers in harvest.js).
    '--json', 'number,title,state,closedAt,labels,milestone,closedByPullRequestsReferences',
  ]))
} catch (e) {
  reasons.push(`no se pudieron listar los issues del milestone "${milestone}" en ${repo}: ${e.message}`)
}

// `ghRunner`: the same `gh` as above but with the `{ code, stdout, stderr }`
// shape that SliceHarvest and TelemetryIndex expect of their injected
// dependency — the adapter does not know there is an `execFileSync` behind it
// that throws.
const ghRunner = (a) => {
  try {
    return { code: 0, stdout: gh(a), stderr: '' }
  } catch (e) {
    return { code: 1, stdout: '', stderr: e.message }
  }
}

// The directory listing: ONE call that decides what is there, BEFORE
// harvesting any slice. The absence of a file is deduced from a listing that
// WAS read, never from interpreting the stderr of a 404 — this repo parses HTTP
// codes nowhere and it does not start here. The listing failing does NOT drop
// the exit to 1: the cause is almost always that this repo has no telemetry
// (every epic older than 1422c67).
const index = TelemetryIndex.read({ gh: ghRunner, repo })
const telemetryDir = index.outcome === IndexOutcome.NOT_READ
  ? { status: 'no-leido', why: index.detail }
  : { status: 'ok', why: null }

// reasonFor: reproduces the usual three texts according to which read failed. A
// `read` this command does not expect throws instead of getting lost in a
// generic text.
function reasonFor(n, f) {
  if (f.read === SliceRead.TIMELINE) return `no se pudo leer el timeline del issue #${n}: ${f.detail}`
  if (f.read === SliceRead.PULL_REQUEST) return `no se pudieron leer los datos del ${f.subject} (issue #${n}): ${f.detail}`
  if (f.read === SliceRead.TELEMETRY_FILE) return `no se pudo leer la telemetría ${f.subject} (issue #${n}): ${f.detail}`
  throw new Error(`ct-harvest.mjs no sabe redactar un motivo para la lectura "${f.read}"`)
}

const rows = []
const harvester = new SliceHarvest({ gh: ghRunner })
for (const issue of issues) {
  const report = harvester.harvest({ repo, issue, index })
  // Two PRs closing the same issue is rare: it is said out loud and the first
  // one is harvested, instead of picking in silence and losing the finding.
  if (report.closers.length > 1) reasons.push(`el issue #${issue.number} lo cierran ${report.closers.length} PRs (${report.closers.map((n) => `#${n}`).join(', ')}); la fila cosecha solo el #${report.closers[0]}`)
  for (const f of report.failures) reasons.push(reasonFor(issue.number, f))
  if (report.row) rows.push(report.row)
}

rows.sort((a, b) => (a.issue ?? 0) - (b.issue ?? 0))

if (bqTable && reasons.length) console.error(`BigQuery: no se carga — la cosecha está incompleta (${reasons.length} lectura(s) sin completar)`)
else if (bqTable && !rows.length) console.error('BigQuery: nada que cargar — el milestone no tiene slices')
else if (bqTable) {
  const ledger = new HarvestLedger({ table: bqTable, bq: bqRunner, workspace: { create: () => mkdtempSync(join(tmpdir(), 'ct-harvest-bq-')), remove: (d) => rmSync(d, { recursive: true, force: true }) }, identity: LedgerIdentity.fromEnvironment() })
  const report = ledger.record({ repo, milestone, rows })
  // EXHAUSTIVE projection of the outcome: a `LoadOutcome` with no key here
  // throws (calling `undefined` as a function), it never falls into a silent
  // catch-all.
  const BQ_PROJECTION = {
    [LoadOutcome.LOADED]: () => console.error(`BigQuery: ${report.rowCount} filas cargadas en ${report.table.id} (harvest_id ${report.harvestId})`),
    [LoadOutcome.REJECTED]: () => reasons.push(`no se pudo cargar en BigQuery (${report.table.id}): bq salió con ${report.code}: ${report.detail}. Los ficheros quedan en ${report.directory}; reintenta a mano: ${report.retryCommand}`),
  }
  BQ_PROJECTION[report.outcome]()
}

if (asJson) {
  console.log(JSON.stringify({ repo, milestone, filas: rows, motivos: reasons, telemetry: { dir: METRICS_REPO_DIR, status: telemetryDir.status, why: telemetryDir.why } }, null, 2))
} else {
  console.log(`# Cosecha — ${milestone}`)
  console.log(`# repo: ${repo} · slices: ${rows.length}`)
  console.log('')
  console.log('| Issue | Slice | Tipo | Gate | ready→claim | claim→release | release→merge | reopens | requeues | blocked | PR |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const f of rows) {
    // The `*` marks that release→merge was measured against the CLOSING OF THE
    // ISSUE and not against the merge of a PR. It is marked in the cell itself,
    // not in a footnote: a footnote does not travel when someone copies the
    // table.
    const mark = f.mergeSource === 'issue-closed' ? '*' : ''
    const pr = f.pr ? `#${f.pr} +${f.additions}/−${f.deletions} ${f.changedFiles}f` : '—'
    console.log(`| #${f.issue} | ${f.title ?? '—'} | ${f.type ?? '—'} | ${f.gate ?? '—'} | ${formatDuration(f.readyToClaim)} | ${formatDuration(f.claimToRelease)} | ${formatDuration(f.releaseToMerge)}${mark} | ${f.reopens} | ${f.requeues} | ${f.blocked.length} | ${pr} |`)
  }
  console.log('')
  // It is reported BY FAMILY (`Tipo`), never aggregated — honesty rule of §6,
  // taken from the lesson of POSTCONDBENCH's FDR 0,08–0,31. And with each
  // family's N in plain sight: a family of 1 is not a mean, and whoever reads
  // this has to see it without asking.
  const families = new Map()
  for (const f of rows) {
    const k = f.type ?? '(sin type:)'
    if (!families.has(k)) families.set(k, [])
    families.get(k).push(f)
  }
  console.log('## Por familia (Tipo) — nunca agregado')
  for (const [type, fs] of families) {
    const measurable = fs.filter((f) => f.claimToRelease !== null)
    const mean = measurable.length ? Math.round(measurable.reduce((a, f) => a + f.claimToRelease, 0) / measurable.length) : null
    const warning = fs.length < 3 ? '  ← N insuficiente: describe, no promedia' : ''
    console.log(`- **${type}** · N=${fs.length} · claim→release ${formatDuration(mean)}${warning}`)
  }
  if (rows.some((f) => f.mergeSource === 'issue-closed')) {
    console.log('')
    console.log('`*` release→merge medido contra el cierre del issue, no contra el merge de un PR.')
  }
  console.log('')
  console.log('## Telemetría del juez — sólo lo que el repo trae escrito')
  console.log('')
  if (telemetryDir.status === 'no-leido') {
    console.log(`no se pudo listar \`${METRICS_REPO_DIR}\` en ${repo} (${telemetryDir.why}). Puede que este repo no tenga telemetría del juez o que la lectura fallara: **no se cuenta nada**, y el hueco NO es un cero.`)
  } else {
    console.log('| Issue | Slice | Veredictos | sin-vara | Hallazgos por regla | alta/media/baja | vara ct | brief | bytes por papel |')
    console.log('|---|---|---|---|---|---|---|---|---|')
    for (const f of rows) {
      const t = f.telemetry
      let verdicts = '—'
      let withoutYardstick = '—'
      let byRule = '—'
      // THE CT YARDSTICK, in its two halves and a single column: how many of
      // its documents ended up cited along the rubric's run, and how many
      // findings cite them. Combined like the brief's `N docs · MB`, because
      // they are two numbers of the same measure and a column for each would
      // widen the table without adding a question.
      //
      // They are read TOGETHER and in that order: `5 docs` with `0 hallazgos`
      // slice after slice is the case to watch —either the code conformed, or
      // the yardstick is being named as decoration—, and that reading is
      // impossible with a single figure. It replaces `patrones-ct`, which only
      // looked at findings of the `patrones` item and for that reason missed
      // the two that slice #7 filed under `decisiones-cerradas`.
      let ctYardstick = '—'
      // Whether the ct yardstick reached the brief of the `implement` step,
      // and how much it weighed — added up over ALL the `implement` attempts
      // the slice left written. Combined into a single column, like the `#pr
      // +a/-d Nf` of the cost table above: they are two numbers of the same
      // measure.
      let brief = '—'
      // #92 — WHAT THE FIXED MATERIAL COST, in one cell and three numbers:
      // the file of the dispatched agent, the skills its prompt orders it to
      // load and the package it received, added up over all the roles of the
      // slice. Together for the same reason as `vara ct`: they are the same
      // measure, and the question that motivated the column (how much fixed
      // material is saved per slice) is their sum, not each one on its own.
      let bytesPerRole = '—'
      // THE SEVERITY, in one cell and in the order in which it is decided: a
      // high VETOES —the verdict's contract does not admit a PASS with a high—,
      // a medium buys a paid round trip to the implementer, a low is only noted
      // down. The three together for the same reason as `vara ct`: they are the
      // same distribution and a column per severity would widen the table
      // without adding a question.
      let severities = '—'
      if (t.status === 'sin-fichero') byRule = '(sin telemetría)'
      else if (t.status === 'no-leido') byRule = '(no se pudo leer)'
      else {
        // The cell's two notes fit together, separated by a comma: how many of
        // those verdicts were a VETO, and how many come from old telemetry.
        // They are only noted if there is something to note — a clean slice is
        // read at a glance, which is what the column is for.
        const notes = []
        if (t.fails > 0) notes.push(`${t.fails} ${t.fails === 1 ? 'veto' : 'vetos'}`)
        if (t.legacy > 0) notes.push(`${t.legacy} sin columna`)
        verdicts = notes.length ? `${t.verdicts} (${notes.join(', ')})` : String(t.verdicts)
        // Same rule as everything else in this table: measuredSeverities === 0
        // prints «—» and never `0/0/0`, which would assert a distribution
        // nobody measured.
        if (t.measuredSeverities > 0) {
          severities = `${t.findingsHigh}/${t.findingsMedium}/${t.findingsLow}`
          if (t.legacySeverities > 0) severities += ` (${t.legacySeverities} sin columna)`
        }
        // measured === 0 prints «—» and NEVER «0»: no verdict of this slice
        // carried the column, so a zero would assert a measure that was never
        // taken.
        withoutYardstick = t.measured > 0 ? String(t.rubricSinVara) : '—'
        const entries = Object.entries(t.findingsByRule).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        byRule = t.verdicts === 0 ? '(sin veredictos)' : (entries.length ? entries.map(([r, n]) => `${r} ${n}`).join(' · ') : '(ninguno)')
        // Same rule as `sin-vara`: measured* === 0 prints «—», never «0» — no
        // verdict of this slice carried the column. BOTH measures are required
        // to print the cell: half a cell with the other half blank would invite
        // reading the gap as a zero, which is exactly what this rule exists to
        // prevent.
        if (t.measuredVaraCtDocs > 0 && t.measuredFindingsVaraCt > 0) {
          ctYardstick = `${t.varaCtDocs} docs · ${t.findingsVaraCt} hallazgos`
          if (t.legacyVaraCtDocs > 0) ctYardstick += ` (${t.legacyVaraCtDocs} sin columna)`
        }
        // The same rule again: briefMeasured === 0 prints «—» — no `implement`
        // attempt of this slice carried both columns, so a zero would assert a
        // brief with no yardstick that nobody could measure.
        if (t.briefMeasured > 0) {
          brief = `${t.briefVaraCtDocs} docs · ${t.briefBytes}B`
          if (t.briefLegacy > 0) brief += ` (${t.briefLegacy} sin columna)`
        }
        // And the same one again: roleMeasured === 0 prints «—» and never
        // three zeros, which would assert dispatched roles with no material.
        if (t.roleMeasured > 0) {
          bytesPerRole = `agente ${t.agentBytes}B · skills ${t.skillBytes}B · paquete ${t.packageBytes}B`
          if (t.roleLegacy > 0) bytesPerRole += ` (${t.roleLegacy} sin columna)`
        }
      }
      console.log(`| #${f.issue} | ${f.title ?? '—'} | ${verdicts} | ${withoutYardstick} | ${byRule} | ${severities} | ${ctYardstick} | ${brief} | ${bytesPerRole} |`)
    }
    console.log('')
    if (rows.some((f) => f.telemetry.status === 'ok' && f.telemetry.verdicts > 0 && f.telemetry.measured === 0)) {
      console.log('`—` en `sin-vara`: ningún veredicto de ese slice traía la columna (telemetría anterior a `rubric_sin_vara`). No es un cero.')
    }
    if (rows.some((f) => f.telemetry.status === 'ok' && f.telemetry.verdicts > 0 && f.telemetry.measuredSeverities === 0)) {
      console.log('`—` en `alta/media/baja`: ningún veredicto de ese slice traía las severidades `findings_high`/`findings_medium`/`findings_low` (telemetría anterior a esta medida). No es un cero.')
    }
    if (rows.some((f) => f.telemetry.status === 'ok' && f.telemetry.verdicts > 0 && (f.telemetry.measuredVaraCtDocs === 0 || f.telemetry.measuredFindingsVaraCt === 0))) {
      console.log('`—` en `vara ct`: ningún veredicto de ese slice traía las columnas `rubric_vara_ct_docs`/`findings_vara_ct` (telemetría anterior a esta medida, o de la columna `findings_patrones_vara_ct` que sustituyeron). No es un cero.')
    }
    if (rows.some((f) => f.telemetry.status === 'ok' && f.telemetry.briefAttempts > 0 && f.telemetry.briefMeasured === 0)) {
      console.log('`—` en `brief`: ningún intento de `implement` de ese slice traía `brief_vara_ct_docs`/`brief_bytes` (telemetría anterior a esta medida, o el brief no se pudo leer en su momento). No es un cero.')
    }
    if (rows.some((f) => f.telemetry.status === 'ok' && f.telemetry.roleAttempts > 0 && f.telemetry.roleMeasured === 0)) {
      console.log('`—` en `bytes por papel`: ningún papel despachado de ese slice traía `agent_bytes`/`skill_bytes`/`package_bytes` (telemetría anterior a esta medida). No es un cero.')
    }
    if (rows.some((f) => f.telemetry.status === 'sin-fichero')) {
      console.log(`\`(sin telemetría)\`: el repo no trae \`${METRICS_REPO_DIR}/issue-<n>.jsonl\` para ese slice. Nadie midió — no es un cero.`)
    }
    for (const f of rows.filter((x) => x.telemetry.status === 'ok' && x.telemetry.malformed > 0)) {
      console.log(`\`${f.telemetry.path}\`: ${f.telemetry.malformed} línea(s) ilegibles, no se cuentan (el resto sí).`)
    }
  }
}

if (reasons.length) {
  console.error('')
  console.error(`${reasons.length} lectura(s) sin completar — la cosecha está INCOMPLETA:`)
  for (const m of reasons) console.error(`  - ${m}`)
  process.exit(1)
}
process.exit(0)
