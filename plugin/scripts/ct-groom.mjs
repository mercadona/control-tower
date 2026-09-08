#!/usr/bin/env node
// OUTPUT CHANNEL (F16/H2) — the criterion is common to the THREE executables of
// the plugin (ct-next.mjs, ct-groom.mjs, dispatch-check.mjs) and it is written
// out in full in ct-next.mjs, next to its `warn()`:
//
//   STDOUT = the PRODUCT. Here: the plan's JSON under --dry-run, and the record
//            of what was really created/reconciled (milestone, issues, project).
//   STDERR = the DIAGNOSIS. `aviso:`, `recordatorio:`, the drift report, and
//            every abort.
//
// This file ALREADY met the criterion (it is the one that served as the
// reference when it was discovered that ct-next.mjs sent its warnings through
// stdout). It is said here so that the next person who adds an output line
// knows which channel it goes to without having to infer it from the
// neighbourhood.
import { readFileSync, realpathSync } from 'node:fs'
import { resolve as resolvePath, relative as relativePath } from 'node:path'
import { execFileSync } from 'node:child_process'
import { analyzeSlicesTable, isNoValueCell } from './slices.js'
// parseSignalCell (Slice 10): the SAME classifier with which groom.js decides
// what it renders — here it is used to abort BEFORE any render or mutation when
// a row declares an exemption with no reason.
import { groomPlan, readEpicContext, readFrozenDecisions, EPIC_CONTEXT_HEADING, FROZEN_DECISIONS_HEADING, analyzeSpecFreeze, HYPOTHESIS_REASONS, parseSignalCell, LOOP_STATUS_LABELS } from './groom.js'
// F10: from "the path I was given in argv + --section" to an absolute URL
// verified against GitHub (or to an honest reference with no link, saying why).
// See scripts/spec-link.js for the three decisions it takes and why it takes
// them the way it does.
import { resolveSpecRef } from './spec-link.js'
import { flattenPages, realIssuesOnly, findByMarker, partitionByEpic, epicTitleOf, GROOM_ISSUES_QUERY, normalizeGraphqlIssues } from './gh-issues.js'
import { pickCurrentIteration, hasProjectItem } from './project-fields.js'
import { parseStrictInt } from './argnum.js'
// extractOrder (F5, important 4): to detect orphan issues — an issue with a
// ct-order:N marker whose slice N is no longer in the current §9 table.
// resolveStatus (F6, serious 2): the SAME criterion with which the dispatcher
// decides which status an issue is in (including the precedence when there is
// more than one `status:` label, and the "with no status: label at all =
// backlog") — it is what makes true, and not a guess, the reminder of "nobody
// is going to dispatch this yet" that this script prints at the end.
import { extractOrder, resolveStatus, extractSpecLink, specTarget } from './gh-issue-map.js'
// F5: the pure reconciliation layer — it decides WHAT counts as a divergence
// between an existing issue and what the plan produces today, HOW it is
// reported, and HOW it is translated into the `gh issue edit`/`--body` flags to
// apply it. See scripts/reconcile.js for the full justification of every
// decision (what is compared, what is excluded on purpose, and why).
import { diffIssue, hasDrift, formatDrift, buildReconcileEditArgs, buildReconcileBody, reconcileGaps, hasReconcileGap } from './reconcile.js'
// ADDENDA (F3): the single source of truth of which "Tipo" values have a
// kickoff addendum — see the unrecognized "Tipo" warning further down.
import { ADDENDA } from './kickoff.js'
// F21: the human gates, separated from the technical `Tipo`. `resolveGates` is
// the single source of truth of which gates a slice has and of everything that
// has to be said out loud about them (a gate the Tipo does not imply, a waiver,
// an inert waiver, a token that does not exist).
import { GATES, TYPE_GATES, resolveGates, resolveE2e, parseGateCell } from './gates.js'

// `arg()` only returns a string when the flag really carries a value: if the
// flag is the last token of argv, or the next token is itself another flag
// (starting with `--`), we return `true` (present-with-no-value) instead of
// sneaking it in as a value. Same pattern as dispatch-check.mjs/ct-next.mjs —
// a fix from the final review (finding 3): the previous version of this `arg()`
// took `process.argv[i + 1]` literally, without checking that it was a real
// value. Verified live against the sandbox: `--milestone` as the last token of
// argv made `milestone` the boolean `true`, and a real run then CREATED a
// milestone in GitHub literally titled "true" and hooked all the epic's issues
// onto it; `--milestone --dry-run` ate the `--dry-run` as if it were the
// milestone's value; `--project` with no value turned into `1` in the dry-run's
// JSON (`Number(true) === 1`). The milestone/project call sites further down,
// on top of this hardening of `arg()` itself, explicitly validate that the
// value received is not `true` (present-with-no-value) before using it.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
const has = (flag) => process.argv.includes(flag)

const specFile = process.argv[2]
if (!specFile || specFile.startsWith('--')) { console.error('uso: ct-groom.mjs <spec> --repo <o/r> [--milestone t] [--project n] [--dry-run]'); process.exit(2) }
const repo = arg('--repo')
const milestone = arg('--milestone', 'Epic')
const project = arg('--project')
const dryRun = has('--dry-run')
// F5: opt-in, NEVER by default — an existing issue may have been edited on
// purpose, carry discussion, or be closed; the default behaviour is to detect
// and report divergence, never to touch anything unless it is explicitly asked
// for (see the reconciliation block further down).
const reconcileFlag = has('--reconcile')
// Product decision (review round 5): --reconcile is marked EXPERIMENTAL. Five
// rounds of review, each one finding a NEW way of corrupting a real body (code
// fences with the wrong length/character, multi-line HTML comments, headings
// that are not a literal "## ", duplicated sections) are evidence that the
// relationship between "markdown a human can really write" and "what the
// scanner covers" is not yet fully known. This feature's DETECTION half
// (everything above, without --reconcile) never writes anything — it is safe by
// construction. The APPLICATION half does write into the user's real data, so
// the warning is printed as soon as the flag is known to be present — BEFORE
// any validation or mutation, with or without --dry-run (the warning is about
// the flag's RISK, not about whether this particular run gets as far as
// mutating anything) — and it NEVER appears without the flag: the default
// behaviour (detect, report, exit 3) neither changes nor gains new warnings.
if (reconcileFlag) {
  console.error('aviso: --reconcile es EXPERIMENTAL — en las pruebas de esta feature ha corrompido bodies de issues reales de cuatro formas distintas ya encontradas y arregladas (vallas de código con el carácter/longitud de cierre equivocados, comentarios HTML multilínea, encabezados que no son "## " literal, secciones duplicadas que no se pueden resolver solas) — revisa el diff del issue en GitHub después de cada corrida, no confíes en el mensaje "reconciliado" a ciegas.')
}

// Explicit validation: with the hardened `arg()` above, a dangling
// `--milestone` (the last token, or followed by another flag) returns `true`
// instead of sneaking the next flag in as a value — but it is still the call
// site's responsibility to reject it rather than letting it flow towards `gh`
// as if it were a real milestone title.
if (milestone === true || typeof milestone !== 'string' || milestone.length === 0) {
  console.error(`--milestone requiere un valor: recibido "${milestone === true ? '(sin valor)' : milestone}"`)
  process.exit(2)
}
// --section: OBSOLETE since F10, and it is said out loud instead of being
// accepted in silence.
//
// It never served to locate anything: the §9 table is found by its COLUMN
// HEADER ("Slice" + "Dep"), not by any section number — that has always been so
// (see slices.js#analyzeSlicesTable), and the very contract /ct-init seeds
// already admitted it. The only thing `--section N` did was compose the spec
// link's anchor as "#N"… an anchor that does not exist in GitHub: the real
// heading "## 9. Slices" has the id "9-slices". Which is to say the flag's only
// job was to produce a broken link.
//
// F6 had put a call-site validation on it (rejecting a dangling `--section`,
// which rendered "spec.md#true") — correct for what the flag did back then, but
// now it would mean demanding a value for something that is not used. The flag
// is accepted in any form, ignored, and warned about: whoever has the command
// written into a script, an alias or a slash command (commands/ct-groom.md
// carried it) does not see their invocation break all at once, but neither are
// they left believing it still decides anything.
if (process.argv.includes('--section')) {
  console.error('aviso: --section está obsoleto y se IGNORA — el ancla del enlace al spec sale ahora del encabezado real bajo el que vive la tabla (p.ej. "## 9. Slices" → "#9-slices"), y la tabla se localiza, como siempre, por su cabecera de columnas ("Slice" + "Dep"), no por ningún número de sección. Puedes quitarlo de la invocación.')
}
// Same criterion for --project: if the flag was passed but with no real numeric
// value, we abort instead of letting `Number(true) === 1` decide silently which
// Project v2 to operate against.
// D4 (review of the numeric arguments of the whole plugin): `Number(...)` is
// faithful with trailing garbage (`Number('7x')` is NaN, it was rejected
// properly), but it accepted values that are NOT integers — `--project 2.9`
// passed `Number.isFinite(...) && > 0` and travelled as it was to
// `gh project view 2.9`, which fails late and confusingly. parseStrictInt
// demands bare decimal digits, the same criterion as `--cap` in ct-next.mjs and
// as dispatch-check.mjs's `<issue#>`.
// `projectNum` (not `project`) is what the WHOLE later path uses — the dry run,
// `gh project view/item-add/item-list`, and the `if (...)` guards. Validating
// one value and using another is the same defect this batch fixes elsewhere:
// `--project +7` passed the validation and then called `gh project view +7`.
const projectNum = typeof project === 'string' ? parseStrictInt(project) : null
if (project !== undefined && (projectNum === null || projectNum <= 0)) {
  console.error(`--project inválido: "${project === true ? '(sin valor)' : project}" — debe ser un entero positivo en dígitos decimales a secas (sin signo "+"/"-", sin espacios, sin punto ni exponente)`)
  process.exit(2)
}
// --repo: a dangling `--repo` (hardened arg()) gives `true`, not a string — the
// `if (!repo)` further down does not detect it because `true` is truthy. Less
// dangerous than milestone/project (it ends up in `gh api repos/true/...`, 404,
// aborting before mutating anything), but inconsistent with ct-next.mjs/
// dispatch-check.mjs, which already validate `typeof !== 'string'` instead of a
// falsy-only check. We do not demand --repo here (it is still optional under
// --dry-run, see further down): we only reject the "the flag was passed but
// with no real value" case.
if (repo !== undefined && typeof repo !== 'string') {
  console.error('--repo inválido: "(sin valor)" — usa --repo <owner/repo>')
  process.exit(2)
}

let specMd
try {
  specMd = readFileSync(specFile, 'utf8')
} catch (e) {
  console.error(`no se pudo leer el spec: ${specFile} (${e.code || e.message})`)
  process.exit(2)
}
// F1 (incident report): a real spec, written by somebody who had not read
// commands/ct-groom.md, produced a §9 table that parseSlices() turned into 0
// slices — in total silence. `/ct-groom --dry-run` printed `{"issues": [], ...}`
// and exited 0; a real run would have created the milestone, zero issues, and
// reported success. `analyzeSlicesTable` (unlike `parseSlices`, which still
// returns only `Slice[]` so as not to break the contract other modules/tests
// depend on) brings the complete report of what could and what could NOT be
// parsed, and why. Every check below runs BEFORE `--dry-run` and BEFORE any
// GitHub mutation — a dry run that validates less than the real run is a trap.
const report = analyzeSlicesTable(specMd)

// Usability improvement (review round 2): with several defects at once,
// aborting at the FIRST one found forces up to eight executions to see them
// all — the same treadmill of "fix one, run again, discover the next" that
// turned the em dash into a trap. Each check below already aggregates ALL the
// rows of its own class (not just the first); here ALL the classes that fire
// are aggregated too, and they are printed together before a single
// `process.exit(2)`.
const hardErrors = []

// F32 — the freeze gate (see groom.js#analyzeSpecFreeze): it runs over the
// WHOLE spec, before any mutation and also under --dry-run (the same doctrine
// as F1: a dry run that validates less than the real run is a trap). It is
// aggregated into hardErrors like everything else — freeze breakages and table
// breakages are reported TOGETHER, one single exit 2.
const freeze = analyzeSpecFreeze(specMd)
if (freeze.clarifications.length) {
  const first = freeze.clarifications[0]
  hardErrors.push(`el spec tiene ${freeze.clarifications.length} marcador(es) "[NEEDS CLARIFICATION" sin resolver (ejemplo, línea ${first.line}: "${first.raw}") — se admiten mientras el spec está en DRAFT, pero groom solo acepta specs CONGELADOS y congelar con uno pendiente es inválido: resuélvelo con quien decide, o apárcalo en "## Decisiones aparcadas", y vuelve a intentarlo`)
}
if (freeze.hypothesis === HYPOTHESIS_REASONS.ABSENT) {
  hardErrors.push('el spec no tiene sección "## Hipótesis" — sin apuesta falsable no es un epic y no entra por groom: añade "## Hipótesis del experimento" con la apuesta del epic (su calidad la juzga el humano en la congelación; groom solo mira que exista). El trabajo sin apuesta (mantenimiento, bugfixes) va como issues sueltos, no por groom')
} else if (freeze.hypothesis === HYPOTHESIS_REASONS.EMPTY) {
  hardErrors.push('la sección "## Hipótesis" del spec está vacía — escribe la apuesta falsable del epic bajo esa cabecera (un comentario de plantilla que sobrevive no cuenta como apuesta) y vuelve a intentarlo')
}

if (!report.tableFound) {
  // It tells "there is no markdown table in the spec at all" apart from "there
  // are table(s), but none with a Slice/Dep header" (F1 review): they are
  // different causes with different fixes, and the detector itself already
  // knows which of the two happened (report.pipeRowsFound).
  if (report.pipeRowsFound) {
    hardErrors.push('se encontraron filas de tabla markdown en el spec, pero ninguna cabecera con columnas "Slice" y "Dep" — añade (o corrige) la fila de cabecera de la tabla §9 con esas columnas (p.ej. "| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |")')
  } else {
    hardErrors.push('no se encontró ninguna tabla markdown (ninguna línea empieza por "|") en el spec — añade la tabla §9 de slices bajo su sección (ver commands/ct-groom.md)')
  }
} else if (report.missingRequiredColumns.length) {
  // F3: "Entrega" came off this list — it is no longer mandatory (the issue's
  // title now comes from "Slice"; "Entrega" became an optional description in
  // the body, see OPTIONAL_COLUMN_CONSEQUENCE further down). "Slice" cannot be
  // missing as a column without the whole table ceasing to be recognized as
  // the §9 table (see the comment in slices.js#analyzeSlicesTable), so "#" is
  // left as the only real case of this branch.
  for (const missing of report.missingRequiredColumns) {
    if (missing === '#') {
      hardErrors.push('la tabla §9 no tiene columna "#" — sin ella no hay orden de slice ni se pueden resolver las dependencias (merge-after); añade una columna de cabecera "#" con un entero puro por fila (1, 2, 3…)')
    }
  }
} else {
  // The checks below here are at ROW level, and they only make sense if the
  // header is already structurally valid (if "#" were missing as a column,
  // every row would inherit that problem derivatively — e.g. they would all
  // turn up in skippedRows with the value "" — and showing that next to the
  // absent-column message would be noise, not new signal).

  // Point 3 of the F1 review: a blank line (or any other one without "|")
  // halfway through the table truncated the scan silently — the later rows
  // vanished, half the epic got created all the same, and the process exited
  // successfully. analyzeSlicesTable no longer truncates (it scans the whole
  // block up to the next markdown heading, or up to a new table's header), but
  // it reports the gap so that it gets fixed instead of being let through.
  if (report.rowsAfterGap.length) {
    const first = report.rowsAfterGap[0]
    hardErrors.push(`${report.rowsAfterGap.length} fila(s) de datos de la tabla §9 aparecen después de una interrupción (línea en blanco, o una línea sin "|") dentro del bloque de la tabla (ejemplo: "${first.raw}") — la tabla debe ser un único bloque markdown contiguo, sin líneas en blanco entre las filas; une las filas en un solo bloque y vuelve a intentarlo`)
  }
  if (report.skippedRows.length) {
    const first = report.skippedRows[0]
    hardErrors.push(`${report.skippedRows.length} fila(s) de la tabla §9 tienen "#" que no es un entero a secas (ejemplo: "${first.value}") — "#" debe ser un entero puro como "1", nunca "S1" ni "**1**"; corrige esas filas (quita cualquier letra o negrita) y vuelve a intentarlo`)
  }
  // Point 4 of the F1 review (and points a/b of review round 2): only the
  // HEADER was validated, never the cells — a row with an empty "Slice" (or
  // with a "no value" marker such as "–"), or with a number of cells different
  // from the header's (fewer, or more because of an unescaped "|"), parsed all
  // the same and produced an issue titled a bare "#N" (or with shifted
  // columns), with no AC and no deps, exit 0. F3: the required one went from
  // "Entrega" to "Slice" — the issue's title now comes from there.
  if (report.invalidRows.length) {
    const first = report.invalidRows[0]
    hardErrors.push(`${report.invalidRows.length} fila(s) de la tabla §9 están incompletas (ejemplo, slice #${first.n}: ${first.reason}) — sin "Slice" no hay título de issue; completa esas filas con todas las columnas de la cabecera y vuelve a intentarlo`)
  }
  if (report.totalDataRows === 0) {
    hardErrors.push('la tabla §9 no tiene ninguna fila de datos — añade al menos una fila con "#" y "Slice"')
  }
  // F2 (flagged after verifying F1 against the real spec): a "Dep" cell with
  // content (that is not a "no dependencies" marker — "-"/"–"/"—"/etc., see
  // isNoValueCell in slices.js) out of which no "#N" was extracted — e.g. "S1"
  // instead of "#1" — is MORE serious than the 0-rows case above: it does not
  // break the order index, so the row parses all the same, the groom exits 0,
  // creates milestone and issues… but with no `merge-after` line at all. The
  // dependency graph is erased silently while everything appears to work —
  // /ct-next would dispatch a dependent slice without waiting for the merge of
  // the one it depended on. Same criterion as the rows with a malformed "#":
  // abort hard, naming how many rows, one offending value, the correct format,
  // AND (CRITICAL 1 of the review: the missing half) what to write if there
  // really are no dependencies.
  if (report.malformedDepRows.length) {
    const first = report.malformedDepRows[0]
    hardErrors.push(`${report.malformedDepRows.length} fila(s) de la tabla §9 tienen "Dep" con contenido pero sin ninguna dependencia reconocible (ejemplo, slice #${first.n}: "${first.raw}") — el formato es #N (p.ej. "#1", "#2, #3"), no "S1"; si no hay dependencias, escribe "–"; corrige esas filas y vuelve a intentarlo`)
  }
  // Point 5 of the F1 review: the deps were not checked against the slices that
  // really exist in the table. "#99" in a 2-slice table, or "#3" on slice 3
  // itself (a self-reference, never legitimate), parsed with no problem and
  // would reach GitHub as `merge-after` — a wrong graph written into the issues
  // (the dispatcher does end up reporting it as deps-unmet, so it is not
  // entirely silent, but it is still a wrong graph that did not need writing).
  // ==========================================================================
  // F21 — THE `Gate` COLUMN. Two abort conditions, and both are deliberately
  // HARD (not warnings) for the same reason, which is different from the one
  // that applies to `Tipo`:
  //
  //   - an unknown `Tipo` is still a legitimate label for a human (`type:ios`
  //     is understandable), and the only thing lost is an addendum. That is why
  //     it warns and carries on.
  //   - an unknown `Gate` produces NOTHING: no label, no line in the kickoff,
  //     no line in the issue's body. Writing `Gate: seguridad` and having the
  //     groom carry on silently would leave the author convinced that they have
  //     put a gate where there is none — which is EXACTLY the breakage this
  //     round closes, reintroduced through the next door along. And accepting
  //     it by emitting the label anyway would be worse: a `gate:seguridad` that
  //     nobody knows how to close, and that the kickoff cannot explain to the
  //     agent.
  //
  // This NARROWS what the system accepts, so it creates a new category of
  // rejection — and that category needs a voice of its own: both messages name
  // the WHOLE vocabulary (derived from `GATES`, not from a list repeated here)
  // and the waiver syntax, so that the remedy is in the message itself. They go
  // into `hardErrors`, that is to say BEFORE the first mutation: a spec with a
  // badly written gate creates no milestone, no labels and no issues.
  const unknownGateRows = []
  const contradictoryGateRows = []
  for (const s of report.slices) {
    const g = resolveGates(s.type, s.gate)
    for (const u of g.unknown) unknownGateRows.push({ n: s.n, token: u })
    for (const c of g.contradictions) contradictoryGateRows.push({ n: s.n, token: c })
  }
  if (unknownGateRows.length) {
    const first = unknownGateRows[0]
    hardErrors.push(`${unknownGateRows.length} valor(es) de la columna "Gate" de la tabla §9 no son ningún gate conocido (ejemplo, slice #${first.n}: "${first.token}") — los gates que este plugin sabe explicarle al agente y escribir en el issue son: ${Object.keys(GATES).join(', ')}. Un gate que no está en esa lista no produce label, ni línea de kickoff, ni nada en el cuerpo del issue: sería un gate que solo existe en el spec. Para RENUNCIAR a un gate que implica el "Tipo" del slice, escribe "!<gate>" (p.ej. "!visual"); para no declarar nada, deja la celda vacía o con "–". Si de verdad hace falta un gate nuevo, se añade a scripts/gates.js con su texto para el agente y para el issue`)
  }
  if (contradictoryGateRows.length) {
    const first = contradictoryGateRows[0]
    hardErrors.push(`${contradictoryGateRows.length} fila(s) de la tabla §9 piden y renuncian al MISMO gate en la columna "Gate" (ejemplo, slice #${first.n}: "${first.token}" y "!${first.token}") — no se elige un ganador en silencio sobre un gate humano: deja solo uno de los dos y vuelve a intentarlo`)
  }

  // ==========================================================================
  // Slice 10 — THE `Señal` COLUMN: an exemption with no reason aborts HARD, by
  // the exact precedent of the unknown Gate — what cannot be read cannot slip
  // through in silence. A bare `N/A` exemption is not "I declare nothing" (the
  // empty cell or the "–" is there for that): it is a DECISION to exempt the
  // slice from promising a signal, and a decision with no legible reason is an
  // undeclared signal dressed up as a decision — the human who grooms cannot
  // approve it and the slice judge cannot cite it as not-applicable. It goes
  // into `hardErrors`, that is, BEFORE the first mutation and also under
  // --dry-run.
  const signalWithoutReasonRows = []
  for (const s of report.slices) {
    if (parseSignalCell(s.senal).kind === 'exencion-sin-razon') {
      signalWithoutReasonRows.push({ n: s.n, raw: s.senal })
    }
  }
  if (signalWithoutReasonRows.length) {
    const first = signalWithoutReasonRows[0]
    hardErrors.push(`${signalWithoutReasonRows.length} fila(s) de la tabla de slices declaran en "Señal" una exención sin razón (ejemplo, slice #${first.n}: "${first.raw}") — una exención de señal se escribe "N/A — <razón>": la razón es lo que un humano aprueba en el groom y lo que el juez de slice cita como no-aplica. Si lo que quieres es no declarar nada, deja la celda vacía o con "–"; corrige esas filas y vuelve a intentarlo`)
  }

  // The FIVE abort conditions of the E2E column. All of them share their shape
  // with the two of `Gate` (above) and with the same criterion: /ct-groom
  // validates EVERYTHING before writing anything, and --dry-run checks exactly
  // the same.
  //
  // The fifth one (`e2eWaivedWithRunsRows`) arrived with the final branch
  // review, and corrects an earlier judgement of that same review that was
  // FALSE. It had been accepted that `Gate: !e2e` over a row with runs was a
  // legitimate configuration that it was enough to warn about out loud
  // (`e2eWaivedAdvisory`, already deleted) because it "gave up the work".
  // With the whole chain run against that cell, it gives up NOTHING
  // mechanical: the `## E2E` section is still emitted into the issue
  // (groom.js#buildIssueBody looks at the runs, not at the gates), the kickoff
  // still names them, /ct-next still seeds them into `.agent/SLICE.md`,
  // `ct-step` still enters `STEPS.E2E` and `--release` still demands the
  // correspondence. The ONLY thing that is lost is the label — that is, the
  // signal for the human.
  //
  // A waiver that waives nothing is a contradiction between two cells of the
  // same row, which is exactly what the other four refuse to resolve in
  // silence. And it does not leave the author without a way out: the way to
  // say "this slice has no e2e" ALREADY EXISTS and it is the cell — you write
  // `no`. So `!e2e` is redundant at best and false at worst.
  //
  // Review round 2 (finding 2): the first three versions of these messages
  // only named the row ("slice #N"), never what had been written in the cell —
  // unlike the two of `Gate` above, which do cite the literal token. "slice #5
  // has a problem" sends the author off to look for it; citing the cell puts
  // it in front of them. `quoteCell` normalises the empty case (never printing
  // a bare "") because an empty cell and one with whitespace in it are
  // indistinguishable at a glance unless you say so explicitly.
  const quoteCell = (raw) => {
    const trimmed = String(raw ?? '').trim()
    return trimmed ? `"${trimmed}"` : '(vacía)'
  }
  const e2eUndeclaredRows = []
  const e2eContradictoryRows = []
  const e2eGateWithoutRunsRows = []
  const e2eWaivedWithRunsRows = []
  for (const s of report.slices) {
    const r = resolveE2e(s.e2e)
    // A decision is only demanded if the COLUMN exists: a spec older than this
    // round does not have it, and there "not declared" is the correct state of
    // all of its rows. The column being present is the commitment; absent,
    // there is nothing to reproach.
    if (report.e2eColumnPresent && !r.declared) e2eUndeclaredRows.push({ n: s.n, cell: s.e2e })
    if (r.contradiction) e2eContradictoryRows.push({ n: s.n, cell: s.e2e })
    if (parseGateCell(s.gate).add.includes('e2e') && r.runs.length === 0) e2eGateWithoutRunsRows.push({ n: s.n, none: r.none, gateCell: s.gate, e2eCell: s.e2e })
    if (parseGateCell(s.gate).waive.includes('e2e') && r.runs.length > 0) e2eWaivedWithRunsRows.push({ n: s.n, gateCell: s.gate, e2eCell: s.e2e })
  }
  if (e2eUndeclaredRows.length) {
    const first = e2eUndeclaredRows[0]
    hardErrors.push(`${e2eUndeclaredRows.length} fila(s) de la tabla §9 tienen la columna "E2E" sin declarar (ejemplo, slice #${first.n}: ${quoteCell(first.cell)}) — esta tabla TIENE columna "E2E", así que cada fila tiene que decidir: escribe el recorrido a atravesar, o "no" si este slice no tiene nada que atravesar. Un guion ahí significa "no he declarado nada" (el mismo significado que en Dep/Acepta/Protegido/Área/Toca), y con eso no se distingue "se pensó y no hay" de "nadie rellenó la columna" — que es justo la ambigüedad que el token "no" existe para quitar. Si este epic no usa e2e en absoluto, quita la columna entera`)
  }
  if (e2eContradictoryRows.length) {
    const first = e2eContradictoryRows[0]
    hardErrors.push(`${e2eContradictoryRows.length} fila(s) de la tabla §9 dicen "no" Y declaran un recorrido en la MISMA celda "E2E" (ejemplo, slice #${first.n}: ${quoteCell(first.cell)}) — no se elige un ganador en silencio: deja el recorrido, o deja el "no", y vuelve a intentarlo`)
  }
  if (e2eGateWithoutRunsRows.length) {
    const first = e2eGateWithoutRunsRows[0]
    hardErrors.push(`${e2eGateWithoutRunsRows.length} fila(s) de la tabla §9 declaran el gate "e2e" en la columna "Gate" pero su celda "E2E" ${first.none ? 'dice "no"' : 'está sin declarar'} (ejemplo, slice #${first.n}: Gate=${quoteCell(first.gateCell)}, E2E=${quoteCell(first.e2eCell)}) — nadie sabría qué atravesar. El gate "e2e" no se escribe a mano: se DERIVA de que la columna "E2E" traiga un recorrido. Quita el "e2e" de la columna "Gate" y escribe el recorrido en "E2E"`)
  }
  if (e2eWaivedWithRunsRows.length) {
    const first = e2eWaivedWithRunsRows[0]
    hardErrors.push(`${e2eWaivedWithRunsRows.length} fila(s) de la tabla §9 renuncian al gate "e2e" en la columna "Gate" pero su celda "E2E" declara recorridos (ejemplo, slice #${first.n}: Gate=${quoteCell(first.gateCell)}, E2E=${quoteCell(first.e2eCell)}) — esa renuncia no renuncia a nada: la sección "## E2E" del issue se emite igual, el kickoff nombra los recorridos igual, /ct-next los siembra igual en ".agent/SLICE.md", "ct-step" sigue exigiendo el paso "e2e" para entregar el run y "dispatch-check --release" sigue exigiendo la correspondencia. Lo único que se pierde es la label "gate:e2e", o sea la señal para quien revisa. Para retirar el e2e de esa fila escribe "no" en su celda "E2E": el gate se DERIVA de esa celda y no se puede renunciar desde la columna "Gate". Quita el "!e2e" de "Gate"`)
  }

  if (report.invalidDepRefs.length) {
    const first = report.invalidDepRefs[0]
    const example = first.reason === 'self'
      ? `slice #${first.n} depende de sí mismo (#${first.dep})`
      : `slice #${first.n} depende de #${first.dep}, que no existe en la tabla`
    hardErrors.push(`${report.invalidDepRefs.length} referencia(s) de "Dep" en la tabla §9 apuntan a un slice que no existe o a sí mismas (ejemplo: ${example}) — cada "#N" en Dep debe apuntar a un "#" que exista en la tabla y sea distinto del propio slice; corrige esas filas y vuelve a intentarlo`)
  }
}

if (hardErrors.length) {
  for (const msg of hardErrors) console.error(msg)
  process.exit(2)
}

// Absent optional columns (Tipo/Acepta/Protegido/Área/Toca): they degrade the
// issue that gets created (with no type: label, no AC, no explicit Protegido,
// or with the collision/serialisation machinery inert for these slices) but
// they do not prevent creating reasonable issues — a warning goes to stderr
// and it carries on, it does not abort.
const OPTIONAL_COLUMN_CONSEQUENCE = {
  Tipo: 'los issues se crearán sin label "type:"',
  // F3: "Entrega" joins this list — it is no longer mandatory (the title
  // comes out of "Slice"), so its absence degrades instead of aborting, just
  // like Tipo/Acepta/Protegido/Área/Toca.
  Entrega: 'los issues se crearán sin sección "Descripción" en el cuerpo',
  Acepta: 'los issues se crearán sin criterios de aceptación',
  Protegido: 'los issues se crearán sin sección "Protegido" explícita',
  'Área': 'la maquinaria de colisión (claim.js#tokensOf) queda inerte para todos los slices de este epic',
  Toca: 'la serialización de touches (dispatch.js#SERIALIZING_TOUCHES) queda inerte para todos los slices de este epic',
  // Slice 10: unlike `Gate` (whose absence degrades nothing, which is why it
  // is NOT on this list), the absence of `Señal` degrades something
  // measurable — the slice judge's third item comes out sin-vara across the
  // whole epic, and that count travels in the telemetry (rubric_sin_vara).
  'Señal': 'los issues se crearán sin sección "## Señal de observabilidad" — el juez de slice medirá su ítem observabilidad como sin-vara en todos los slices de este epic',
}
for (const col of report.missingOptionalColumns) {
  console.error(`aviso: la tabla §9 no tiene columna "${col}" — ${OPTIONAL_COLUMN_CONSEQUENCE[col] || 'se omite esa información en los issues'}`)
}

// F5 (review, point 2): the spec is authoritative over a label prefix
// (`type:`/`area:`/`touches:`) ONLY if the §9 table carries the column that
// feeds it (Tipo/Área/Toca) — without the column, the spec has NO opinion at
// all about that prefix, and claiming one anyway would report as "left over" a
// label a human put on by hand on their own account (noise that trains you to
// ignore the rest of the divergence report, see reconcile.js). It is derived
// from `report.missingOptionalColumns` (already computed above for the absent
// column warning) instead of keeping a second check — a single source of truth
// for "which columns this table carries".
const ownedLabelPrefixes = []
if (!report.missingOptionalColumns.includes('Tipo')) ownedLabelPrefixes.push('type:')
if (!report.missingOptionalColumns.includes('Área')) ownedLabelPrefixes.push('area:')
if (!report.missingOptionalColumns.includes('Toca')) ownedLabelPrefixes.push('touches:')
// F21 — `gate:` follows the same rule, with a double source: the spec has an
// opinion about a slice's gates if it carries the `Gate` column (an explicit
// declaration) OR if it carries the `Tipo` column (the gates the type implies —
// gates.js#TYPE_GATES). With neither of the two, the spec produces no `gate:`
// label at all and must not claim authority over one a human put on by hand.
// With either of the two it does: an issue that keeps a `gate:visual` the spec
// no longer produces is a real divergence, and one of the ones that matter — it
// is a human gate somebody is going to expect and nobody is going to ask for
// (or the other way round).
if (report.gateColumnPresent || !report.missingOptionalColumns.includes('Tipo')) ownedLabelPrefixes.push('gate:')
// F3: "Tipo" decides, on top of the "type:<value>" label, which addendum the
// dispatched agent receives — kickoff.js#renderKickoff does
// `ADDENDA[slice.type] || ''` silently, so a value that is not a key of
// ADDENDA (e.g. "ios"/"swift" for what is really a UI slice, instead of "ui")
// leaves the agent WITHOUT the corresponding addendum — serious in particular
// for "ui", whose addendum imposes the mandatory screenshot gate — with
// nothing at all flagging it. It warns, it does not abort: the value is still
// a legitimate "type:" label even with no addendum (e.g. a new type that has
// deliberately not been added to ADDENDA yet).
//
// KNOWN_TYPES is derived from `Object.keys(ADDENDA)` (kickoff.js) instead of
// keeping a second hardcoded list here: ADDENDA remains the ONLY source of
// truth for which types have an addendum — adding a new one there (or
// correcting the name of an existing one) shows up in this warning without
// touching this file, so the two lists cannot diverge.
const KNOWN_TYPES = Object.keys(ADDENDA)
for (const s of report.slices) {
  // F3 review, finding 1: a "no value" marker in "Tipo" ("–", "-", "—", etc.
  // — isNoValueCell, the SAME criterion Dep/Acepta/Protegido/Área/Toca already
  // use) means "no type", not an unknown value. Without this check, this
  // warning accused of a typo an author who wrote exactly the marker the
  // contract itself teaches you to use in every other column ("check whether
  // it is a typo" over a "–" is noise, not signal). buildLabels (groom.js)
  // already treats this same marker as "no type:" — coherent with that.
  if (s.type && !isNoValueCell(s.type) && !KNOWN_TYPES.includes(s.type)) {
    // F21: this warning now names the SECOND consequence, which did not exist
    // until this round and is worse than the first. A `Tipo` with a typo in it
    // (`UI` instead of `ui`, `ios` instead of `ui`) is not only left without
    // an addendum: it is also left without the GATES that type would imply —
    // the comparison is exact in gates.js#TYPE_GATES too. Keeping quiet about
    // the "gate" half of the consequence would reintroduce into this warning
    // the very problem the `Gate` column comes to close. It says which gate
    // would be the lost one when the value resembles a type that does imply
    // some.
    const gateNote = Object.keys(TYPE_GATES).length
      ? ` — y tampoco los gates humanos que un Tipo reconocido implicaría (${Object.entries(TYPE_GATES).map(([t, gs]) => `${t}→${gs.join('/')}`).join(', ')}): si este slice necesita alguno, decláralo en la columna "Gate"`
      : ''
    console.error(`aviso: valor "${s.type}" en columna Tipo (slice #${s.n}) no es ninguno de los tipos reconocidos por el dispatcher (${KNOWN_TYPES.join(', ')}) — el agente despachado para este slice no recibirá ningún addendum de tipo (ver scripts/kickoff.js#ADDENDA)${gateNote}; revisa si es un error tipográfico o si falta añadir su addendum`)
  }
}
// ============================================================================
// F21 — THE GATES, SAID OUT LOUD. The remit was not just "that a gate can be
// declared": it was that the system SAY IT. Whoever grooms has to see, without
// going looking for it, that a slice carries a gate that does not come from its
// `Tipo` —and above all that a slice has had one TAKEN AWAY—, because both
// things are decisions about what gets checked before merging and neither of
// them must be able to slip through a spec diff without anyone reading it.
//
// The four warnings go to stderr and do NOT abort: all four describe legitimate
// (or harmless) configurations, unlike the two hardErrors further up. It only
// speaks when there is something to say — a slice whose gates come straight out
// of its `Tipo` (the massively most common case) prints nothing, which is what
// keeps the ones that do come out useful.
// ============================================================================
// e2eAddedAdvisory (task "e2e at the close of the slice", addition 2): the
// generic message of `g.added` says "it is deliberate (that is what the "Gate"
// column is for)" — FALSE for `e2e`, which is not declared there: it is DERIVED
// from the row carrying runs in the "E2E" column, and writing it by hand in
// "Gate" is one of the four aborts the E2E column already built (see
// e2eGateWithoutRunsRows, above). A warning that sends the author to the wrong
// column is worse than no warning, so this text names "E2E" and never "Gate".
//
// Why it lives in a function and is called from TWO places: `e2e` is never
// implied by any `Tipo` (it does not live in TYPE_GATES), so `resolveGates`
// classifies it as "implied" (silent, just like a Tipo gate) instead of
// "added" in the normal case (a row with runs, with nothing written by hand in
// "Gate") — and therefore the `g.added` loop, below, never sees it in that
// case, which is the only one that occurs in practice (the other, "Gate: e2e"
// by hand, already aborts before getting here). Without the second trigger,
// passing `s.e2e` to `resolveGates` (addition 1) would change nothing visible:
// the gate would still reach the issue through the labels and the groom report
// would still not mention it — exactly the leak F21 closed for "Gate",
// reopened for "E2E".
function e2eAddedAdvisory(n) {
  return `aviso: el slice #${n} lleva el gate "e2e" porque su fila declara recorridos en la columna "E2E" (no en "Gate": ese gate no se declara ahí, se DERIVA) — se dice en voz alta porque cambia lo que hay que comprobar antes de mergear: el issue llevará la label "gate:e2e", el agente despachado recibirá la instrucción, y quien revise el PR tiene que cerrarlo`
}

// e2eRedundantAdvisory / e2eInertWaiverAdvisory (review of addition 2,
// findings 1 and 2): the same "it is deliberate (that is what the Gate column
// is for)" / "its Tipo does not imply that gate" are FALSE for `e2e` in
// `redundant`/`inertWaivers`, for exactly the reason that already closed
// `added` — and in the case of `redundant`, the review found that a row with
// `Gate: e2e` PLUS real runs prints both `e2eAddedAdvisory` (correct) and the
// generic `redundant` message (which says "its Tipo already implies" the
// gate): two contradictory claims about the SAME gate, three lines of stderr
// apart. Neither of the two classifications depends on the `Tipo` for `e2e` —
// they depend on whether the row declares runs in "E2E", so both texts name
// that column.
//
// There was a third one, `e2eWaivedAdvisory`, for `g.waived`. It was deleted
// along with the fifth abort (above): `waived` only contains `e2e` when the row
// declares runs —that is the definition of `waived`: waiving something IMPLIED,
// and `e2e` is only implied by runs— and that case no longer gets here, because
// it aborts. Besides being unreachable, its text claimed two false things
// ("those runs will NOT be asked of the agent" and "nobody will walk through
// them before merging"): the waiver did not remove the work, only the label.
//
// `e2eInertWaiverAdvisory` DOES survive, and not out of inertia:
// `inertWaivers` is the waiving of a gate that is NOT implied, that is, `!e2e`
// over a row WITHOUT runs (cell "no", or the column absent). That does not
// abort —there is no contradiction: there was no e2e to remove— and its text
// already said exactly that.
function e2eRedundantAdvisory(n, gateCell) {
  return `aviso: el slice #${n} declara el gate "e2e" (celda "Gate": "${gateCell}"), pero su fila YA lo lleva porque declara recorridos en la columna "E2E" — es redundante, no un error: el resultado es el mismo con la celda "Gate" vacía`
}
function e2eInertWaiverAdvisory(n) {
  return `aviso: el slice #${n} renuncia al gate "e2e" con "!e2e" en la columna "Gate", pero su fila no declara recorridos en la columna "E2E": la renuncia no hace nada (no había nada que quitar). Se dice para que no te quedes con la idea de haber retirado un gate que nunca estuvo`
}

for (const s of report.slices) {
  const g = resolveGates(s.type, s.gate, s.e2e)
  const typeRef = s.type && !isNoValueCell(s.type) ? `"${s.type}"` : '(sin Tipo)'
  for (const gate of g.added) {
    if (gate === 'e2e') { console.error(e2eAddedAdvisory(s.n)); continue }
    console.error(`aviso: el slice #${s.n} declara el gate "${gate}", que su Tipo ${typeRef} no implica — es deliberado (para eso está la columna "Gate"), y se dice en voz alta porque cambia lo que hay que comprobar antes de mergear: el issue llevará la label "gate:${gate}", el agente despachado recibirá la instrucción, y quien revise el PR tiene que cerrarlo`)
  }
  // The REAL case (see the comment of `e2eAddedAdvisory`): with runs and with
  // nothing written by hand in "Gate", `e2e` comes out in `implied`, not in
  // `added`. `g.added.includes('e2e')` is unreachable in a run that gets past
  // the hardErrors (see above), but it is checked anyway so as not to announce
  // the same gate twice if it ever stopped being unreachable.
  if (g.implied.includes('e2e') && !g.added.includes('e2e')) console.error(e2eAddedAdvisory(s.n))
  // `e2e` cannot appear here: `waived` implies declared runs, and that row
  // aborts before getting here (the fifth abort). No special branch, then — the
  // generic message talks about the `Tipo`, and for `e2e` it would be false,
  // but there is no run that reaches it.
  for (const gate of g.waived) {
    console.error(`aviso: el slice #${s.n} RENUNCIA al gate "${gate}" que implica su Tipo ${typeRef} (celda "Gate": "${s.gate}") — ese gate NO se le pedirá al agente, no aparecerá como label del issue y nadie lo comprobará antes de mergear. Si no era eso lo que querías, quita el "!" de esa celda`)
  }
  for (const gate of g.inertWaivers) {
    if (gate === 'e2e') { console.error(e2eInertWaiverAdvisory(s.n)); continue }
    console.error(`aviso: el slice #${s.n} renuncia al gate "${gate}", pero su Tipo ${typeRef} no implica ese gate: la renuncia no hace nada (no había nada que quitar). Se dice para que no te quedes con la idea de haber retirado un gate que nunca estuvo`)
  }
  for (const gate of g.redundant) {
    if (gate === 'e2e') { console.error(e2eRedundantAdvisory(s.n, s.gate)); continue }
    console.error(`aviso: el slice #${s.n} declara el gate "${gate}", que su Tipo ${typeRef} ya implica — es redundante, no un error: el resultado es el mismo con la celda "Gate" vacía`)
  }
}

// Values of Área/Toca carrying THE OTHER column's prefix (e.g. "area:x"
// inside Toca): the value was tolerated (it was not discarded), but it is
// probably a column slip — a warning goes out so the author can check.
for (const w of report.prefixWarnings) {
  console.error(`aviso: valor "${w.raw}" en columna ${w.column} (slice #${w.n}) trae el prefijo "${w.otherPrefix}:" de la otra columna — se ha usado el valor igualmente, revisa si está en la columna correcta`)
}
// Point 6 of the F1 review: a value of Área/Toca that, once the
// prefix/markup is stripped and it is normalised, comes out empty (e.g.
// "area:" with nothing behind it, or "???" with no label-safe character at
// all) used to be discarded without warning — the same collision/serialisation
// inertia as the absent-column warning above, but per cell. Coherent with that
// same standard: it warns, it does not abort (the rest of the slice is still
// valid).
for (const w of report.emptyTokenWarnings) {
  const labelPrefix = w.column === 'Área' ? 'area:' : 'touches:'
  console.error(`aviso: valor "${w.raw}" en columna ${w.column} (slice #${w.n}) queda vacío tras normalizar — no se genera ninguna label "${labelPrefix}" para ese valor, la maquinaria de colisión/serialización queda inerte para ese slice`)
}

// F10 — the link to the spec. It is resolved HERE, once per run (the path and
// the section are the same for every slice), and BEFORE the --dry-run branch:
// the preview has to show the SAME body the real run would write, its warnings
// included. It is the same rule F1 fixed for the validation of the table and F5
// for the detection of divergence — a dry-run that reports less than the real
// run is a trap.
//
// `runForSpecLink` keeps stderr at 'pipe' (not 'inherit', unlike `gh()`
// further down): ALL of the failures here are foreseen cases this script
// translates into a legible warning of its own (the spec is not in a repo, it
// has no remote, it has not been pushed…), so also letting git/gh's raw error
// out would only add noise to something that is already being explained.
const SPEC_LINK_MAX_BUFFER = 20 * 1024 * 1024
const runForSpecLink = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: SPEC_LINK_MAX_BUFFER }).trim()
// realpathSync: `git -C <dir> rev-parse --show-toplevel` returns the root with
// symbolic links already resolved, so without resolving the spec too the
// subtraction of paths would say "outside the repo" for anyone working under a
// symlink (on macOS, /tmp -> /private/tmp makes it fire daily). If the realpath
// fails (the file deleted between the readFileSync above and this), it carries
// on with the bare absolute path: resolveSpecRef degrades on its own.
let specAbsPath
try { specAbsPath = realpathSync(resolvePath(specFile)) } catch { specAbsPath = resolvePath(specFile) }
const { ref: specRef, warnings: specLinkWarnings } = resolveSpecRef({
  specFile: specAbsPath,
  displayPath: specFile,
  heading: report.sectionHeading,
  run: runForSpecLink,
  relativize: (root, file) => relativePath(root, file),
})
for (const w of specLinkWarnings) console.error(w)

// The epic's shared context: a section of the spec, outside the slices table,
// whose text travels identically into the body of every issue. Its warnings are
// printed here, alongside those of the link to the spec, and they NEVER abort:
// a spec without that section is a valid spec, and blocking a whole groom over
// a malformed optional section would be disproportionate. The remedy travels
// inside the warning.
const { content: epicContext, reason: epicContextReason, warnings: epicContextWarnings } = readEpicContext(specMd)
for (const w of epicContextWarnings) console.error(w)

// Frozen decisions: the same treatment as the epic context — it is read from
// the spec by its heading and its warnings are printed here, never aborting (a
// spec without the section is valid; the remedy travels inside the warning).
const { content: frozenDecisions, reason: frozenDecisionsReason, warnings: frozenDecisionsWarnings } = readFrozenDecisions(specMd)
for (const w of frozenDecisionsWarnings) console.error(w)

const slices = report.slices
// groomPlan throws if there are duplicated slice orders in the §9 table
// (T14/W-A): it is caught here and reported with the same convention as the
// rest of this wrapper's validation errors (a non-existent spec, an invalid
// --milestone/--project/--repo) — a clean message on console.error + exit(2),
// never the raw stack trace of an uncaught exception.
let plan
try {
  plan = groomPlan(slices, { milestone, specRef, epicContext, epicContextReason, frozenDecisions, frozenDecisionsReason })
} catch (e) {
  console.error(e.message)
  process.exit(2)
}

// An explicit maxBuffer (finding 7 of the final review): Node's default for
// execFileSync is 1 MiB. The listing further down (GraphQL, ONLY issues and
// ONLY the fields that get used — see GROOM_ISSUES_QUERY) paginates over every
// issue in the repo and still fits in here comfortably: by not bringing PRs nor
// the complete REST object, the payload is a fraction of what it was. This
// listing used to be the REST `repos/<repo>/issues` with ALL the PRs and
// complete bodies, and in a large, active repo (thousands of issues+PRs) it
// overflowed 20 MiB → ENOBUFS and the groom died before creating anything.
// 20 MiB is still generous without being truly "unlimited" (a real runaway
// would still abort).
//
// GH_MAX_BUFFER is a SAFETY LIMIT shared by every gh() call, not a feature. The
// risk of overflow does not disappear: it MOVES from "PRs + issue bodies" to
// "issue bodies alone at scale". If one day the legitimate bodies of a repo's
// issues exceed 20 MiB, that is a separate design problem (paginate and process
// page by page without accumulating), not something to be papered over by
// raising this number.
const GH_MAX_BUFFER = 20 * 1024 * 1024
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: GH_MAX_BUFFER }).trim()

// F5 — divergence detection (existence-only → real content). Until now,
// everything below here lived AFTER the --dry-run exit: a dry-run never even
// got as far as looking at whether the issues that already exist still matched
// what the plan produces today. That is exactly the same trap F1 already closed
// for the validation of the table ("a dry-run that validates less than the real
// run is a trap") — it applies just the same here: the issue fetch (a read,
// mutating nothing) moves up to BEFORE the --dry-run branch, so that the
// divergence report is identical whether or not it really runs. It is only
// attempted if there is a real `--repo` (a string): in a dry-run with no
// --repo there is nothing to compare against, so the long-standing behaviour is
// preserved (it only prints the plan, it never touches `gh`).
// fieldDriftCategories: the categories that travel through `gh issue edit`
// FLAGS (buildReconcileEditArgs) — title/milestone/labels. They have no
// giving-up branch: if they diverge, they get applied. Descripción/Protegido/
// Gates deliberately do NOT appear here or below: --reconcile never touches
// them (see buildReconcileBody in scripts/reconcile.js), so they do not belong
// to "what has been written".
function fieldDriftCategories(diff) {
  const cats = []
  if (diff.title) cats.push('título')
  if (diff.milestone) cats.push('milestone')
  if (diff.labels.missing.length || diff.labels.extra.length) cats.push('labels')
  return cats
}

// appliedCategories: what has really been WRITTEN into this issue — flags +
// body. It is the only list that may appear in the "reconciliado" line, which
// goes to stdout, the channel this script reserves for what has happened.
//
// Second wave of the final branch review: that line used "what DIVERGES"
// (title/milestone/link/labels/deps/ac/epic context, without looking at any
// giving-up), so it announced on stdout the rewriting of a section the code had
// just refused to touch and that stderr reported as not rewritten in the same
// run. The --dry-run preview already used `bodyDriftCategories`; now both
// routes answer the same question.
//
// The epic context CAN appear (--reconcile rewrites it) even though it does NOT
// count towards the exit code: they are two different questions, and confusing
// them is what left this line ending in a bare colon when that was the only
// category.
//
// Only for messages aimed at a human — never for deciding what to really call;
// buildReconcileEditArgs/buildReconcileBody decide that.
function appliedCategories(diff, bodyResult) {
  return [...fieldDriftCategories(diff), ...bodyDriftCategories(diff, bodyResult)]
}

// bodyDriftCategories: of the categories that travel through `--body` (the
// ones buildReconcileBody splices: link to the spec, AC, dependencies and epic
// context), which ones have really been APPLIED into this body — not which
// ones diverge. The difference matters because the --dry-run preview names this
// list: a category that diverges but whose section could not be located
// (unresolvedAc/unresolvedDeps/unresolvedEpicContext) is not in the new body,
// and naming it would be announcing a write that does not happen. Before, the
// preview wrote a FIXED list ("dependencias/criterios de aceptación") that was
// false the moment what changed was something else.
//
// The link to the spec has no giving-up branch: if the line does not exist,
// buildReconcileBody prepends it at the top of the body.
function bodyDriftCategories(diff, bodyResult) {
  const cats = []
  if (diff.specLink) cats.push('enlace al spec')
  if ((diff.deps.missing.length || diff.deps.extra.length) && !bodyResult.unresolvedDeps) cats.push('dependencias')
  if ((diff.ac.missing.length || diff.ac.extra.length) && !bodyResult.unresolvedAc) cats.push('criterios de aceptación')
  if (diff.epicContextDiffers && !bodyResult.unresolvedEpicContext) cats.push('contexto del epic')
  if (diff.frozenDecisionsDiffers && !bodyResult.unresolvedFrozenDecisions) cats.push('decisiones congeladas')
  if (diff.e2eDiffers && !bodyResult.unresolvedE2e) cats.push('recorridos de e2e')
  return cats
}

// EPIC_CONTEXT_SURRENDERS: why buildReconcileBody could not rewrite
// "## Contexto del epic", in the words that are of use to whoever reads the
// report. It is reported as a `nota:` and it NEVER moves the exit code (§4.4 of
// the design): this section cannot produce a 3, not by diverging, not
// duplicated, not by giving up. That it gave up in SILENCE was the only
// indefensible part — AC and Dependencias have been giving up out loud since
// review round 4.
const EPIC_CONTEXT_SURRENDERS = {
  'sin-ancla': 'no existe la sección en el issue, y tampoco ninguna de las dos cabeceras que sirven de ancla para ponerla en su sitio ("## Contexto heredado" o, en su defecto, "## Acceptance criteria"); añade a mano una de ellas y vuelve a correr',
  'ancla-duplicada': 'no existe la sección en el issue y su ancla ("## Acceptance criteria") aparece más de una vez, así que insertarla ahí podría escribir dentro de texto ajeno; deja una sola copia del ancla y vuelve a correr',
  duplicada: 'aparece más de una vez en el body y no hay forma de saber cuál copia es la del plugin — una puede ser texto pegado dentro de "## Contexto heredado", que no se toca nunca; deja una sola copia y vuelve a correr',
  'seccion-sin-cerrar': 'la sección del issue tiene una valla de código (```) o un comentario HTML (<!--) SIN CERRAR, así que no se sabe dónde termina: reescribirla se llevaría por delante todo lo que venga detrás en el cuerpo (contexto heredado, criterios, gates, protegido y el marcador ct-order). Cierra el delimitador en el issue y vuelve a correr',
  'texto-sin-cerrar': 'el texto que trae el spec tiene una valla de código (```) o un comentario HTML (<!--) SIN CERRAR, y escribirlo en el cuerpo dejaría el issue en ese mismo estado. Ciérralo en el spec y vuelve a correr',
  'en-heredado': 'el spec ya no trae contexto del epic, y la única copia de esta sección en el body queda por detrás de la cabecera "## Contexto heredado", dentro de la zona que pertenece a la sesión coordinadora y que no se toca nunca. No se retira nada; si esa copia sobra, quítala tú',
  // Here NOTHING is claimed about whose the text is, unlike 'en-heredado':
  // without a locatable "## Acceptance criteria" there is no way of knowing
  // where the coordinator session's zone ends, and therefore no way of knowing
  // whether that copy falls inside it. All that is known is that it cannot be
  // touched safely.
  'zona-sin-fin': 'no se puede saber dónde termina "## Contexto heredado" en este body: su cabecera está, pero "## Acceptance criteria" —la cabecera que la sigue siempre, y que marca el final de esa zona— no aparece exactamente una vez. Sin ese límite no se distingue qué hay por detrás que sea del issue y qué escribió la sesión coordinadora, así que esta sección no se reescribe ni se retira. Restaura (o desduplica) "## Acceptance criteria" y vuelve a correr',
}

// FROZEN_DECISIONS_SURRENDERS: why buildReconcileBody could not rewrite
// "## Decisiones congeladas". A mirror of EPIC_CONTEXT_SURRENDERS, with the
// same anchors ("## Contexto heredado" or, failing that, "## Acceptance
// criteria"). It is reported as a nota: and it NEVER moves the exit code.
const FROZEN_DECISIONS_SURRENDERS = {
  'sin-ancla': 'no existe la sección en el issue, y tampoco ninguna de las dos cabeceras que sirven de ancla para ponerla en su sitio ("## Contexto heredado" o, en su defecto, "## Acceptance criteria"); añade a mano una de ellas y vuelve a correr',
  'ancla-duplicada': 'no existe la sección en el issue y su ancla ("## Acceptance criteria") aparece más de una vez, así que insertarla ahí podría escribir dentro de texto ajeno; deja una sola copia del ancla y vuelve a correr',
  duplicada: 'aparece más de una vez en el body y no hay forma de saber cuál copia es la del plugin — una puede ser texto pegado dentro de "## Contexto heredado", que no se toca nunca; deja una sola copia y vuelve a correr',
  'seccion-sin-cerrar': 'la sección del issue tiene una valla de código (```) o un comentario HTML (<!--) SIN CERRAR, así que no se sabe dónde termina: reescribirla se llevaría por delante todo lo que venga detrás en el cuerpo. Cierra el delimitador en el issue y vuelve a correr',
  'texto-sin-cerrar': 'el texto que trae el spec tiene una valla de código (```) o un comentario HTML (<!--) SIN CERRAR, y escribirlo en el cuerpo dejaría el issue en ese mismo estado. Ciérralo en el spec y vuelve a correr',
  'en-heredado': 'el spec ya no trae decisiones congeladas, y la única copia de esta sección en el body queda por detrás de la cabecera "## Contexto heredado", dentro de la zona que pertenece a la sesión coordinadora y que no se toca nunca. No se retira nada; si esa copia sobra, quítala tú',
  'zona-sin-fin': 'no se puede saber dónde termina "## Contexto heredado" en este body: su cabecera está, pero "## Acceptance criteria" —la cabecera que la sigue siempre— no aparece exactamente una vez. Sin ese límite esta sección no se reescribe ni se retira. Restaura (o desduplica) "## Acceptance criteria" y vuelve a correr',
}

// describeGaps (review round 3, Critical 2): it names which categories, OF THE
// ONES THAT REALLY DIVERGE, --reconcile could not (or will not be able to)
// apply — never "prose only" when what it really is is AC/deps with no locatable
// section: that was exactly the bug that made it exit 0 over a real machine
// divergence. `gaps.duplicates` (review round 5, Important 3): a duplicated
// "machine" section — --reconcile does not decide which copy is the right one,
// so it cannot apply anything there either; without naming it here, this very
// divergence exited 0 in silence under --reconcile.
//
// GAP_REASONS (final branch review, C2): the exact reason is decided by
// buildReconcileBody (`unresolvedReasons`/`unresolvedE2e`), not by this file.
// There used to be a single sentence per category —"the section was not
// found"— that was true for the original case and stopped being true the
// moment the other two appeared: a DUPLICATED section is found all right (the
// problem is that there are two and neither can be pointed at as the plugin's),
// and an insertion with no anchor does not talk about the missing section but
// about the one that ought to serve as the reference.
const GAP_REASONS = {
  ac: {
    'sin-seccion': 'no se encontró la sección "## Acceptance criteria" en el body',
    duplicada: 'la sección "## Acceptance criteria" aparece más de una vez y no hay forma de saber cuál copia es la del plugin — puede ser texto pegado dentro de "## Contexto heredado"',
  },
  deps: {
    'sin-seccion': 'no se encontró la sección "## Dependencias" en el body',
    duplicada: 'la sección "## Dependencias" aparece más de una vez y no hay forma de saber cuál copia es la del plugin — puede ser texto pegado dentro de "## Contexto heredado"',
    'sin-ancla': 'no existe la sección "## Dependencias" y tampoco "## Out of scope / Protected", que es el único ancla seguro para insertarla',
    'ancla-duplicada': 'no existe la sección "## Dependencias" y su ancla ("## Out of scope / Protected") aparece más de una vez, así que insertarla ahí podría escribir dentro de texto ajeno',
    'en-heredado': 'la única "## Dependencias" del body está DENTRO de "## Contexto heredado" — es texto pegado por la sesión coordinadora, que no se toca nunca, así que no es la sección del issue. Tampoco se añade una segunda copia más abajo: el dispatcher lee la PRIMERA, o sea la de ella. Saca ese bloque de la sección heredada (o quítale la cabecera) y vuelve a correr',
    'ancla-en-heredado': 'no existe la sección "## Dependencias" y la única "## Out of scope / Protected" del body está DENTRO de "## Contexto heredado", así que anclar la inserción ahí escribiría dentro del texto de la sesión coordinadora',
    'zona-sin-fin': 'no se puede saber dónde termina "## Contexto heredado" en este body: su cabecera está, pero "## Acceptance criteria" —la cabecera que la sigue siempre, y que marca el final de esa zona— no aparece exactamente una vez. Sin ese límite no se distingue qué hay por detrás que sea del issue y qué escribió la sesión coordinadora, así que no se escribe nada ahí. Restaura (o desduplica) "## Acceptance criteria" y vuelve a correr',
  },
  // The "## E2E" section gives up for the same causes as "## Dependencias"
  // (the same insertion anchor, the same forbidden zone), so the vocabulary of
  // reasons is the same. What changes is the CONSEQUENCE that gets named: out
  // of this section come the runs /ct-next seeds and the ones --release
  // demands, so "it could not be written" means the slice is going to walk
  // through something else (or nothing), not a cosmetic mismatch.
  e2e: {
    'sin-seccion': 'no se encontró la sección "## E2E" en el body y tampoco "## Out of scope / Protected", que es el único ancla seguro para insertarla',
    duplicada: 'la sección "## E2E" aparece más de una vez y no hay forma de saber cuál copia es la del plugin — puede ser texto pegado dentro de "## Contexto heredado"',
    'sin-ancla': 'no existe la sección "## E2E" y tampoco "## Out of scope / Protected", que es el único ancla seguro para insertarla',
    'ancla-duplicada': 'no existe la sección "## E2E" y su ancla ("## Out of scope / Protected") aparece más de una vez, así que insertarla ahí podría escribir dentro de texto ajeno',
    'en-heredado': 'la única "## E2E" del body está DENTRO de "## Contexto heredado" — es texto pegado por la sesión coordinadora, que no se toca nunca. Tampoco se añade una segunda copia más abajo: /ct-next y --release leen la PRIMERA, o sea la de ella. Saca ese bloque de la sección heredada (o quítale la cabecera) y vuelve a correr',
    'ancla-en-heredado': 'no existe la sección "## E2E" y la única "## Out of scope / Protected" del body está DENTRO de "## Contexto heredado", así que anclar la inserción ahí escribiría dentro del texto de la sesión coordinadora',
    'zona-sin-fin': 'no se puede saber dónde termina "## Contexto heredado" en este body: su cabecera está, pero "## Acceptance criteria" —la cabecera que la sigue siempre, y que marca el final de esa zona— no aparece exactamente una vez. Sin ese límite no se distingue qué hay por detrás que sea del issue y qué escribió la sesión coordinadora, así que no se escribe nada ahí. Restaura (o desduplica) "## Acceptance criteria" y vuelve a correr',
  },
}
function describeGaps(gaps, bodyResult) {
  const reasons = bodyResult.unresolvedReasons || {}
  const parts = []
  if (gaps.ac) parts.push(`criterios de aceptación (${GAP_REASONS.ac[reasons.ac] ?? GAP_REASONS.ac['sin-seccion']})`)
  if (gaps.deps) parts.push(`dependencias (${GAP_REASONS.deps[reasons.deps] ?? GAP_REASONS.deps['sin-seccion']})`)
  if (gaps.e2e) parts.push(`recorridos de e2e (${GAP_REASONS.e2e[bodyResult.unresolvedE2e] ?? GAP_REASONS.e2e['sin-seccion']})`)
  if (gaps.duplicates) parts.push('secciones duplicadas (## Dependencias/## Acceptance criteria — --reconcile no decide cuál copia es la correcta: une o borra la sobrante a mano)')
  return parts.join(' y ')
}

let existingIssues = null
// inEpic (F23): the issues of THIS run's epic — those of the milestone whose
// title is the `--milestone` argument. It is the list the `ct-order` markers
// are paired against and orphans are detected against. It lives as a module
// variable (and not inside the reading block where it is computed) for ONE
// reason only, and it is worth saying it honestly: the creation loop, much
// further down and outside that block, still registers every freshly created
// issue there. That registration protects nothing today — see the comment
// beside the `push` further down, which explains why it has no readers.
//
// Why the pairing is scoped (§2 of the field feedback, measured in
// production): /ct-groom numbers the slices 1..N PER EPIC and writes that
// number into `<!-- ct-order:N -->`, so the marker is NOT unique across the
// repo — the §9 contract promises so explicitly ("unique within their
// milestone, not within the repo"). Looking for it across the whole repo did
// two things, both of them false: it paired a new §9 table starting at 1,2,3
// with the issues of an earlier, CLOSED epic (reporting their different
// milestone as "divergence", and with --reconcile it would have dragged them
// into the new milestone), and it declared orphans the issues of any other
// epic in the repo.
let inEpic = null
let reconcileEntries = [] // [{ iss, found, diff, bodyResult, gaps }] — found/diff/bodyResult/gaps are null if the issue does not exist yet
let anyUnresolvedDrift = false
// anyReconcileGapRemains (review round 3, Critical 2): true if ANY entry has a
// real AC/Dependencias divergence that --reconcile could not apply (a section
// that cannot be located — see reconcile.js#reconcileGaps).
// title/milestone/labels/link-to-the-spec NEVER produce a gap: they always
// resolve via flags or a single-line splice, without depending on locating any
// section. It is used for the exit code of the real run WITH --reconcile
// (further down) — without --reconcile, `anyUnresolvedDrift` is enough on its
// own.
let anyReconcileGapRemains = false
// anyOrphans (F5, important 4): an issue with a ct-order:N marker whose slice
// N is no longer in the current §9 table — before, it was never mentioned at
// all (reconcileEntries is built by walking plan.issues, which only knows
// today's slices), exit 0, total silence. It is detected separately, by walking
// ALL the existing issues (not only the ones that match some slice of today's)
// and comparing their order against the orders the §9 table still declares.
let anyOrphans = false
// existingLabelNames (F6, minor 5): the labels the repo ALREADY has. Two
// reasons, neither of them cosmetic:
//   1. The contract asks you to "reuse the label vocabulary that already exists
//      in this repo, do not invent a new one per spec" — and until now nobody
//      could check what that vocabulary was, nor see afterwards what had ended
//      up being invented: `gh label create --force` does not tell creating
//      apart from updating, and printed nothing.
//   2. `--force` over a label that ALREADY exists REWRITES it (colour and
//      description included, with the ones gh assigns by default). By creating
//      only the ones that are missing, a label the repo had already looked
//      after stops changing colour on every groom.
let existingLabelNames = null
if (typeof repo === 'string') {
  try {
    // Listing via GraphQL (only issues, never PRs; only the fields that get
    // used) — see GROOM_ISSUES_QUERY. It replaces the REST
    // `repos/<repo>/issues` that brought ALL the repo's PRs with their complete
    // bodies and overflowed the buffer in large repos (ENOBUFS). The same set
    // of issues `realIssuesOnly` produced over REST; realIssuesOnly is kept as
    // a safety net (harmless: GraphQL does not return PRs).
    const [owner, name] = repo.split('/')
    const pages = JSON.parse(gh(['api', 'graphql', '--paginate', '--slurp', '-f', `query=${GROOM_ISSUES_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`]))
    existingIssues = realIssuesOnly(normalizeGraphqlIssues(pages))
  } catch (e) {
    console.error(`no se pudo listar issues de ${repo}: ${e.message}`)
    process.exit(1)
  }
  try {
    const rawLabels = JSON.parse(gh(['api', `repos/${repo}/labels`, '--method', 'GET', '--paginate', '--slurp']))
    existingLabelNames = new Set(flattenPages(rawLabels).map((l) => l && l.name).filter(Boolean))
  } catch (e) {
    // The same criterion as the issue/milestone listing: a read failure is NOT
    // degraded into "the repo has no labels at all" — that would lead to
    // rewriting existing labels with --force and to reporting as "new" labels
    // that did exist. It aborts with a clear message.
    console.error(`no se pudieron listar las labels de ${repo}: ${e.message}`)
    process.exit(1)
  }
  const knownOrders = new Set(plan.issues.map((i) => i.order))
  const partition = partitionByEpic(existingIssues, milestone)
  inEpic = partition.inEpic

  // F23 — the gates of the per-epic scope. They go HERE, between the issue
  // listing and everything else, because this point is ahead of the script's
  // first mutation (the creation of the milestone, much further down): a check
  // that cannot stop the next action is decoration, and one that aborts after
  // creating the milestone leaves rubbish in GitHub — the same reason the
  // listing was placed where it is.
  //
  // Both gates are computed IN FULL and reported TOGETHER before a single
  // exit: naming only the first blocker says "remove that one and it goes
  // through", and that is false when there is more than one.
  //
  // Exit code 1, by the precedent of this very file: 1 is "I read an
  // inconsistent state, I am NOT carrying on" (see the abort of the project's
  // item listing); 2 is an argv/spec validation error; 3 is "there was
  // divergence but the work got done", and here nothing gets done.
  const blockers = []
  const blockerRepoRef = typeof repo === 'string' ? repo : '<owner/repo>'

  // Gate A — issues with NO milestone. No epic can be attributed to them, so
  // both possible readings do damage: pairing one would rewrite somebody
  // else's issue; ignoring it would create a duplicate of the slice that is
  // ours. It only blocks if its order COLLIDES with today's §9 table — a
  // marker that competes with nothing prevents nothing, but it does not keep
  // quiet either (the same criterion as NO_MILESTONE_KEY in gh-issue-map.js: a
  // shared bucket with a warning, never invisible).
  const withoutMilestoneBlockers = []
  for (const i of partition.sinMilestone) {
    const order = extractOrder(i.body)
    if (order == null) continue
    if (knownOrders.has(order)) {
      withoutMilestoneBlockers.push(`  #${i.number}  ct-order:${order}`)
    } else {
      console.error(`aviso: issue #${i.number} lleva el marcador ct-order:${order} y no tiene milestone — no puedo decidir a qué epic pertenece, así que queda fuera de este groom. No colisiona con la tabla §9 de este spec, por eso no bloquea; asígnale su milestone para que deje de aparecer: gh issue edit ${i.number} --repo ${blockerRepoRef} --milestone "<el suyo>"`)
    }
  }
  if (withoutMilestoneBlockers.length) {
    blockers.push({
      headline: 'estos issues llevan un marcador ct-order que colisiona con la tabla §9 de este spec, pero NO tienen milestone — no puedo decidir si son de este epic o de otro:',
      lines: withoutMilestoneBlockers,
      remedy: `asígnales su milestone y vuelve a correr: gh issue edit <n> --repo ${blockerRepoRef} --milestone "<el suyo>"`,
    })
  }

  // Gate B — the SAME epic under ANOTHER title. A risk the per-epic scoping
  // itself introduces, not one that already existed: while the pairing was
  // global, a `--milestone` with a typo in it (or an epic renamed in GitHub)
  // still found its issues by marker and at worst reported divergence. Scoped,
  // that very same run sees ZERO issues in its epic and recreates the whole
  // epic duplicated under a new milestone, with exit 0 — a command that gives
  // no error and does not do what it looks like it does.
  //
  // The signal that tells it apart from a different epic reusing numbers is
  // the link to the spec, which every groomed issue carries in its body
  // (groom.js#renderSpecLink). The same order + the SAME document = the same
  // epic under another name. A different document = two legitimate epics
  // sharing the order number, which is EXACTLY what F23 comes to enable: it
  // does not fire.
  //
  // The link's TARGET is compared (specTarget), not the whole line: the line
  // starts with "> Slice `#N` del epic. " and that prefix changed format in
  // F6, so comparing the whole thing would fail against any earlier issue.
  //
  // When the target is missing on either side, or differs, the gate does NOT
  // fire — it fails OPEN. The price has to be stated in full, because it is
  // not the status quo: if the epic had been renamed and its issues carry the
  // link in another shape (groomed before F10, or with the degraded shape
  // "— sin enlace: <motivo>"), `inEpic` comes out empty and this run recreates
  // the WHOLE epic duplicated with exit 0. Before F23, the global pairing
  // found them by marker and reported divergence with exit 3, creating
  // nothing: the false negative gives nothing back, it opens a hole that did
  // not exist before. It is accepted in exchange for not bricking the normal
  // case — a false positive would stop dead two different epics reusing order
  // numbers, which is exactly what F23 comes to enable. What is done is not to
  // keep quiet about it: every discard from this bucket that could end in a
  // duplicated epic —that is, one of a slice that does not yet have an issue
  // in this epic— emits a warning on stderr (further down, in the `continue`
  // itself), non-blocking.
  const specTargetByOrder = new Map(plan.issues.map((i) => [i.order, specTarget(i.specLink)]))
  const otherEpicBlockers = []
  const otherEpicWarnings = []
  for (const i of partition.otrosEpics) {
    const order = extractOrder(i.body)
    if (order == null || !knownOrders.has(order)) continue
    const theirs = specTarget(extractSpecLink(i.body))
    const ours = specTargetByOrder.get(order)
    if (theirs === null || ours === null || theirs !== ours) {
      // The warning of the fail-open. It closes the asymmetry with gate A,
      // which does name on stderr the milestone-less issues that do NOT block:
      // this bucket is exactly the one a duplicated epic with exit 0 comes out
      // of (see the comment above), so discarding it in silence is the one
      // thing that cannot be done. It does not block, it does not change the
      // exit code, and it does not alter when the gate fires.
      //
      // Scoped to the slices that do NOT already have an issue in THIS epic,
      // with the same predicate the pairing further down uses
      // (`findByMarker(inEpic, marker)`): duplication can only occur if the
      // slice is going to be created, and if it already has an issue here the
      // pairing finds it and the creation is skipped — there is nothing to
      // duplicate, so the warning would come out on every run without
      // describing any loss and with nothing the human could do to silence it.
      // The same criterion, in this very file, as the closed-issue filter of
      // `backlogPendingCount`: a warning that cannot be satisfied is a warning
      // that teaches you to ignore the rest. The scoping loses no dangerous
      // case — it covers exactly the set in which duplication is possible.
      if (findByMarker(inEpic, `<!-- ct-order:${order} -->`)) continue
      const reason = theirs === null
        ? 'pero su body no lleva ninguna línea de enlace al spec con la que compararlo'
        : (ours === null
          ? 'pero este spec no ha producido ningún enlace con el que compararlo'
          : 'pero su enlace al spec no coincide con el de este spec')
      // It accumulates instead of being printed here: the warnings are emitted
      // AFTER the exit of the blockers (further down), because each of them
      // claims this groom is going to create that slice — and in a run that
      // stops dead nothing gets created. Nothing is lost: the next run, now
      // unblocked, computes them all over again just the same.
      otherEpicWarnings.push(`aviso: el slice #${order} de este spec tiene un issue en otro milestone con el mismo ct-order (#${i.number}, "${epicTitleOf(i)}"), ${reason} — así que lo trato como otro epic y ${dryRun ? 'crearía' : 'crearé'} un issue nuevo para el slice #${order} en "${milestone}". Si en realidad es el mismo epic renombrado, esto va a duplicarlo: compruébalo antes de seguir.`)
      continue
    }
    otherEpicBlockers.push(`  #${i.number}  ct-order:${order}  milestone: "${epicTitleOf(i)}"`)
  }
  if (otherEpicBlockers.length) {
    blockers.push({
      headline: 'estos slices ya tienen un issue en OTRO milestone que apunta al MISMO spec — parece este mismo epic bajo otro título, no un epic distinto:',
      lines: otherEpicBlockers,
      remedy: `este spec pide --milestone "${milestone}". Si renombraste el epic, usa su título real; si es un epic nuevo de verdad, su tabla §9 no debería apuntar al mismo spec que el anterior.`,
    })
  }

  if (blockers.length) {
    for (const { headline, lines, remedy } of blockers) {
      console.error(headline)
      for (const line of lines) console.error(line)
      console.error(remedy)
    }
    console.error('/ct-groom NO continúa: no se ha creado ni modificado nada.')
    process.exit(1)
  }
  for (const warning of otherEpicWarnings) console.error(warning)

  for (const i of inEpic) {
    const order = extractOrder(i.body)
    if (order != null && !knownOrders.has(order)) {
      console.error(`aviso: issue #${i.number} lleva el marcador ct-order:${order}, pero el slice #${order} ya no está en la tabla §9 del spec — issue huérfano del epic "${milestone}" (¿se eliminó el slice sin cerrar/renumerar su issue?); revísalo a mano`)
      anyOrphans = true
    }
  }
  reconcileEntries = plan.issues.map((iss) => {
    const marker = `<!-- ct-order:${iss.order} -->`
    const found = findByMarker(inEpic, marker)
    if (!found) return { iss, found: null, diff: null, bodyResult: null, gaps: null }
    // F23: `diff.milestone` is UNREACHABLE from here ever since the pairing is
    // scoped per epic — `found` comes out of `inEpic`, and only issues whose
    // milestone is exactly the one passed to diffIssue as `wantedMilestone`
    // enter `inEpic` (`partitionByEpic` sorts them by EXACT title against
    // `milestone`, and `plan.milestone` is that same value — see groomPlan in
    // groom.js). With that, the danger the field feedback's §2 flagged in
    // capitals disappears BY CONSTRUCTION: a --reconcile that, on top of
    // rewriting the body, dragged a closed issue from another epic into the new
    // milestone. The comparison is NOT deleted from reconcile.js: that module
    // is pure, shared and tested, and it is still the right repair for any
    // caller that hands it an issue from another scope. What can no longer
    // happen is THIS call-site doing it.
    const diff = diffIssue(found, iss, plan.milestone, ownedLabelPrefixes)
    // bodyResult is pure (it does not touch `gh`, it mutates nothing) — safe
    // to compute always, with or without --reconcile, with or without
    // --dry-run: it is the only way of knowing, BEFORE anyone asks for anything
    // to be applied, whether an AC/Dependencias divergence would even be
    // applicable (Critical 2) — and, since the final branch review, whether
    // there is anything to write into the body even when none of what diverges
    // counts towards the exit code (C1: the epic context).
    const bodyResult = buildReconcileBody(found.body, iss)
    const gaps = reconcileGaps(diff, bodyResult)
    return { iss, found, diff, bodyResult, gaps }
  })
  // The divergence report is ALWAYS printed on stderr (the same channel as the
  // rest of this script's "aviso:") as soon as it is known — before the
  // --dry-run branch, so that it is IDENTICAL in the preview and in the real
  // run. Silence here means "the spec and the issues agree": formatDrift
  // returns [] when there is nothing to report (see scripts/reconcile.js).
  for (const { found, diff, bodyResult, gaps } of reconcileEntries) {
    if (!found) continue
    for (const line of formatDrift(diff)) console.error(line)
    if (hasReconcileGap(gaps)) {
      console.error(`aviso: slice #${diff.order} (issue #${found.number}) — --reconcile no puede aplicar del todo esta divergencia: ${describeGaps(gaps, bodyResult)}; revísala a mano en GitHub`)
    }
    // The epic context giving up travels separately and as a `nota:`: it does
    // not enter `reconcileGaps` because this section never counts towards the
    // exit code (§4.4), but keeping quiet about it not having been applied
    // would be claiming by omission that it was. It is only said when there
    // really was something to write.
    if (bodyResult.unresolvedEpicContext && diff.epicContextDiffers) {
      console.error(`nota: slice #${diff.order} (issue #${found.number}) — --reconcile NO ha reescrito la sección "${EPIC_CONTEXT_HEADING}": ${EPIC_CONTEXT_SURRENDERS[bodyResult.unresolvedEpicContext]} (no cuenta para el exit code)`)
    }
    if (bodyResult.unresolvedFrozenDecisions && diff.frozenDecisionsDiffers) {
      console.error(`nota: slice #${diff.order} (issue #${found.number}) — --reconcile NO ha reescrito la sección "${FROZEN_DECISIONS_HEADING}": ${FROZEN_DECISIONS_SURRENDERS[bodyResult.unresolvedFrozenDecisions]} (no cuenta para el exit code)`)
    }
    if (hasDrift(diff)) anyUnresolvedDrift = true
    if (hasReconcileGap(gaps)) anyReconcileGapRemains = true
  }
  // --reconcile under --dry-run: it NEVER mutates (neither here nor in the
  // real branch further down) — it only makes explicit what a real run with
  // --reconcile would apply, so that the preview does not keep quiet about
  // information that would act. The reconciled --body (if something that
  // travels through it diverges) is NOT printed in full — it would be a long
  // block of text — it is named by category, like the rest of this block's
  // messages aimed at a human. The "gap" warning (if there is one) was already
  // printed above — it is not repeated here.
  if (reconcileFlag && dryRun) {
    for (const { found, diff, bodyResult } of reconcileEntries) {
      // "is there anything to write?" is NOT "does this count towards the exit
      // code?". `hasDrift` answers the second (it deliberately excludes the
      // epic context, §4.4 of the design), and gating the write with it made
      // F26's primary scenario —the author edits the section of the spec and
      // runs again— compute the new body and throw it away. The first question
      // is answered by `bodyResult.body !== null`.
      if (!found || !(hasDrift(diff) || bodyResult.body !== null)) continue
      const fieldArgs = buildReconcileEditArgs(diff)
      if (fieldArgs.length || bodyResult.body !== null) {
        const bodyCats = bodyDriftCategories(diff, bodyResult)
        const bodyNote = bodyResult.body !== null ? ` --body <actualizado: ${bodyCats.join(', ')}>` : ''
        console.error(`--reconcile aplicaría: gh issue edit ${found.number} --repo ${repo} ${fieldArgs.join(' ')}${bodyNote}`.trim())
      }
    }
  }
}

// F6, minor 5 — labels: what gets reused and what gets invented. It is
// computed BEFORE the --dry-run branch (the same information in the preview
// and in the real run, just like the divergence report). `newLabels` falls back
// to "all of them" when there is no --repo to consult: with no repo it cannot
// be claimed that any of them exists.
// The labels this repo has to HAVE: the ones the issues carry, plus the
// complete `status:` vocabulary (LOOP_STATUS_LABELS). The second is not a
// cosmetic addition: an issue is born in `status:backlog` and the other three
// of the vocabulary are written later with `gh issue edit --add-label`, which
// CANNOT create them (it resolves name -> id; an absent name resolves to null
// and fails). Without this, in a freshly bootstrapped repo the first step after
// the groom —the human promotion to `status:ready`— blew up, and the claim
// behind it died with exit 3 saying «reintenta más tarde». See
// groom.js#LOOP_STATUS_LABELS.
const wantedLabels = [...new Set([...plan.issues.flatMap((i) => i.labels), ...LOOP_STATUS_LABELS])]
const reusedLabels = existingLabelNames ? wantedLabels.filter((l) => existingLabelNames.has(l)) : []
const newLabels = existingLabelNames ? wantedLabels.filter((l) => !existingLabelNames.has(l)) : wantedLabels
const LABEL_VOCAB_HINT = `revisa si alguna es un sinónimo de una que ya existe (\`gh label list --repo ${typeof repo === 'string' ? repo : '<owner/repo>'}\`): la detección de colisión (area:/touches:) solo funciona si todos los specs del repo usan el MISMO vocabulario`
// It speaks ONLY when there is something to check — inventing new vocabulary.
// If the plan creates no label at all, there is nothing to tell apart and the
// silence goes on meaning what it meant (the same criterion as F5's divergence
// report: silence = nothing to decide). With no --repo nothing can be claimed
// about what exists, so nothing is said either.
function labelReportLine(verb) {
  if (!existingLabelNames || !newLabels.length) return null
  const reusedPart = reusedLabels.length ? ` (las demás ya existían y se reutilizan tal cual, sin tocarlas: ${reusedLabels.join(', ')})` : ''
  return `labels ${verb} nuevas en ${repo}: ${newLabels.join(', ')}${reusedPart} — ${LABEL_VOCAB_HINT}`
}
// F6, serious 2 — the groom creates issues in `status:backlog`
// (groom.js#buildLabels) and the dispatcher only looks at `status:ready`:
// running /ct-groom and then /ct-next straight away produced "no hay slices
// despachables" over freshly created issues, with nothing explaining why. The
// reminder is anchored to the REAL STATE of the issues (resolveStatus, the
// dispatcher's own criterion), not to "I have just created something": an epic
// already promoted in full generates no noise at all, and an epic whose issues
// are still in backlog says so even when this run created nothing.
function backlogPendingCount() {
  if (!reconcileEntries.length) return plan.issues.length // with no --repo there are no issues to consult: all of them would be created in backlog
  return reconcileEntries.filter(({ found }) => {
    if (!found) return true // it will be created in this run, and buildLabels puts status:backlog on it
    // A CLOSED issue is not pending promotion: it is done. Without this
    // filter, a finished epic (closed issues nobody gave the status label back
    // to) would drag the reminder along for ever on every re-groom — a warning
    // that cannot be satisfied is a warning that teaches you to ignore the
    // rest.
    if (found.state === 'closed') return false
    const names = (found.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
    return resolveStatus(names).status === 'backlog'
  }).length
}
function printBacklogReminder() {
  const pending = backlogPendingCount()
  if (!pending) return
  const repoRef = typeof repo === 'string' ? repo : '<owner/repo>'
  console.error(`recordatorio: ${pending} issue(s) de este epic ${dryRun ? 'quedarían' : 'quedan'} en status:backlog — /ct-next NO despacha nada que no lleve status:ready. Promoverlos es un paso humano deliberado (es el gate del loop: decides tú qué entra en vuelo): gh issue edit <n> --repo ${repoRef} --add-label status:ready --remove-label status:backlog`)
}

if (dryRun) {
  // F6's two messages go to stderr, BEFORE the plan: stdout has to go on being
  // pure, parseable JSON (several tests, and any real pipeline, depend on
  // that).
  const labelLine = labelReportLine('que se crearían')
  if (labelLine) console.error(labelLine)
  printBacklogReminder()
  console.log(JSON.stringify({ ...plan, repo: typeof repo === 'string' ? repo : null, project: projectNum }, null, 2))
  // Exit code (F5): 3 for "divergence detected, not reconciled" —
  // deliberately DIFFERENT from 0 (the spec and the issues agree: real
  // silence, nothing to decide) and from 2 (a validation error: the §9 table
  // itself is unusable, and reporting anything makes no sense). A non-zero exit
  // here would be as bad as the silence this feature corrects, but in the
  // opposite direction: it would train any script that only looks at "did it
  // exit 2, abort everything?" to treat a merely informative divergence as if
  // the §9 table were broken. 3 makes it clear, for whoever reads the exit code
  // instead of the text, that "there is no error, but there is something to
  // check" is a third state, not a variant of "all fine" nor of "all broken".
  //
  // Under --dry-run this holds ALWAYS (with or without --reconcile): a dry-run
  // never really resolves anything, so any detected divergence is still
  // unresolved when it finishes — 3 is the honest reading, not an accidental
  // consequence. --dry-run and the real run WITHOUT --reconcile share the same
  // 3 over the same divergence FOR PARITY (the same condition, the same
  // signal) — NOT because chaining `groom --dry-run && groom` should go on
  // working: with `&&`, a 3 cuts the chain exactly when there is divergence
  // --reconcile could apply, so that chaining would never get as far as running
  // the real run. Whoever wants "check, and if there is something to fix, apply
  // it" has to check the exit code explicitly (`; if [ $? -eq 3 ]; then …`),
  // not depend on `&&`.
  process.exit((anyUnresolvedDrift || anyOrphans) ? 3 : 0)
}

if (!repo) { console.error('--repo requerido fuera de --dry-run'); process.exit(2) }

// Project v2 + Sprint (T9): introspection at runtime, no IDs are hardcoded.
// Every call below was tried by hand against a real Project v2 (a sandbox)
// before being wired in here; see task-9-report.md for the verified
// queries/mutations and their real responses.
const PROJECT_FIELDS_QUERY = `
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      fields(first: 50) {
        totalCount
        nodes {
          ... on ProjectV2IterationField {
            id
            name
            configuration {
              iterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
}`

const SET_ITEM_ITERATION_MUTATION = `
mutation($project: ID!, $item: ID!, $field: ID!, $iteration: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project
    itemId: $item
    fieldId: $field
    value: { iterationId: $iteration }
  }) {
    projectV2Item { id }
  }
}`

// It is resolved once per execution (not per issue): the current
// owner/projectId/fieldId/iterationId are the same for every slice of this
// batch. If the fetch fails, or the project has no iteration field called
// "Sprint", or no iteration covers today's date, we abort — the same criterion
// as milestones/issues further up: there is no benign case to be treated as
// "carry on without a Sprint".
let projectMeta = null
function ensureProjectMeta() {
  if (projectMeta) return projectMeta
  // TODO: it assumes the Project v2 lives under the same owner as --repo. An
  // organisation project over a repo belonging to another owner (or the other
  // way round) would need an explicit --project-owner; not covered yet.
  const owner = repo.split('/')[0]
  let view
  try {
    view = JSON.parse(gh(['project', 'view', String(projectNum), '--owner', owner, '--format', 'json']))
  } catch (e) {
    console.error(`no se pudo leer el project ${project} (owner ${owner}): ${e.message}`)
    process.exit(1)
  }
  const projectId = view.id

  let fieldsRaw
  try {
    fieldsRaw = JSON.parse(gh(['api', 'graphql', '-f', `query=${PROJECT_FIELDS_QUERY}`, '-f', `id=${projectId}`]))
  } catch (e) {
    console.error(`no se pudieron leer los campos del project ${project}: ${e.message}`)
    process.exit(1)
  }
  const nodes = fieldsRaw?.data?.node?.fields?.nodes || []
  const sprintField = nodes.find((n) => n && n.name === 'Sprint')
  if (!sprintField) {
    // F18/H6 — "it did not come back in the response" is NOT "it does not
    // exist". `fields(first: 50)` is a BOUNDED read: a project with more than
    // 50 fields may have its Sprint field outside the first page, and the
    // long-standing message would claim, with total composure, that the project
    // does not have it. `totalCount` (asked for in the same query, at zero
    // cost) tells the two things apart.
    const totalFields = fieldsRaw?.data?.node?.fields?.totalCount
    if (Number.isInteger(totalFields) && totalFields > nodes.length) {
      console.error(`no se ha podido comprobar si el project ${project} tiene un campo de iteración "Sprint": la consulta solo trajo ${nodes.length} de sus ${totalFields} campos (lectura acotada a 50 por página). NO se afirma que no exista — no se ha visto entero. Reduce el número de campos del project, o repórtalo para que la consulta pagine.`)
      process.exit(1)
    }
    console.error(`el project ${project} no tiene un campo de iteración llamado "Sprint" — créalo antes de usar --project`)
    process.exit(1)
  }
  const today = new Date().toISOString()
  const current = pickCurrentIteration(sprintField.configuration?.iterations, today)
  if (!current) {
    console.error(`el campo Sprint del project ${project} no tiene una iteración vigente para hoy (${today.slice(0, 10)})`)
    process.exit(1)
  }
  projectMeta = { owner, projectId, fieldId: sprintField.id, iterationId: current.id, iterationTitle: current.title }
  return projectMeta
}

// it adds an issue (new or pre-existing, identified by its URL) to the Project
// v2 and pins its Sprint to the current iteration. It is called both for issues
// created in this run and, further down, for pre-existing issues that are
// missing their project item (see hasProjectItem): registering the issue and
// registering it in the project are two decoupled network calls (unlike the
// labels, which travel inside `gh issue create` and cannot be left half-done),
// so an interruption between the two would leave the issue outside the project
// for ever if it were not re-checked on every run.
function addToProjectWithSprint(issueUrl, order) {
  const meta = ensureProjectMeta()
  let item
  try {
    item = JSON.parse(gh(['project', 'item-add', String(projectNum), '--owner', meta.owner, '--url', issueUrl, '--format', 'json']))
  } catch (e) {
    console.error(`no se pudo añadir el issue orden #${order} al project ${project}: ${e.message}`)
    process.exit(1)
  }
  try {
    gh(['api', 'graphql', '-f', `query=${SET_ITEM_ITERATION_MUTATION}`,
      '-f', `project=${meta.projectId}`, '-f', `item=${item.id}`,
      '-f', `field=${meta.fieldId}`, '-f', `iteration=${meta.iterationId}`])
  } catch (e) {
    console.error(`no se pudo fijar el Sprint del issue orden #${order} en el project ${project}: ${e.message}`)
    process.exit(1)
  }
  console.log(`issue orden #${order} añadido al project ${project}, sprint=${meta.iterationTitle}`)
}

// ============================================================================
// F15/H2 — ALL OF THE PROJECT VALIDATION, BEFORE THE FIRST MUTATION.
//
// `ensureProjectMeta()` is lazy: it used to be resolved on the FIRST call to
// `addToProjectWithSprint`, or in the item listing further down. With the
// listing placed after the milestone and the labels, an abort over "the project
// has no Sprint field" or "no iteration covers today" happened with the
// milestone ALREADY CREATED and the labels ALREADY CREATED. Verified by
// construction against the unfixed code, with a `gh` stub that records the argv
// of every call: the log came out as
//   api .../milestones --method GET …   (listing)
//   api .../milestones -f title=Epic    (CREATION)
//   label create type:backend …         (CREATION ×4)
//   project view 5 --owner o …          (this is where it fails and aborts)
// and stdout already said "milestone creado: Epic (#1)". That is: the half-done
// rubbish the documentation neither promised nor denied was REAL.
//
// The project block (validation + item listing) is moved up WHOLE, ahead of the
// milestone. Both are reads, and both abort with exit 1: leaving them where
// they were meant that any project failure —a rate limit while listing items
// included— paid the same price.
//
// THE GUARANTEE THIS CREATES, and which can now genuinely be written into the
// contract: everything /ct-groom READS happens before everything /ct-groom
// WRITES. If it aborts over validation (the §9 table, the spec, the repo, an
// illegible milestone, a project with no Sprint, an expired iteration), it has
// created nothing. What is NOT promised: once it starts writing there is no
// transaction — a failure halfway through leaves what has already been created,
// and the way out of that is running again, which is idempotent by
// construction (the milestone by title, only the labels that are missing, the
// issues by their `ct-order` marker).
// ============================================================================
// Items already present in the Project v2 — they are listed once per run (just
// like milestones/existingIssues below) so as to be able to detect
// pre-existing issues that, because of an earlier interruption, are missing
// their project item (see hasProjectItem in project-fields.js).
//
// F18/H6 — THIS WAS THE PLUGIN'S LAST FIXED CAP WITH NO TRUNCATION DETECTION,
// AND THE LESSON WAS ALREADY WRITTEN RIGHT NEXT TO IT. `ct-next.mjs#loadIssues`
// explains that `gh issue list --limit N` is not used because "a fixed `--limit`
// leaves out exactly the OLD issues", and a few lines further down, in this very
// file, the issue enumeration says that a fixed cap "would reintroduce the same
// failure through truncation". Here, by contrast, the cap had been RAISED from
// 30 to 200 —moving the trap further away instead of removing it— and
// `existingProjectItems` was treated as complete whatever happened.
//
// The consequence is not a poor message: `hasProjectItem` (project-fields.js)
// returns `false` for items that DO exist, so /ct-groom adds them again and the
// Project ends up with DUPLICATES, in silence.
//
// It is fixed without paginating and without extra calls in the normal case:
// `gh project item-list --format json` returns `{items, totalCount}` (verified
// against gh 2.86 over a real project: `--limit 2` over 3 items returned
// `items.length = 2, totalCount = 3`). If the cap trimmed, the query is repeated
// asking for exactly what GitHub itself says is there. If it still comes back
// short, it ABORTS: carrying on would mean duplicating items, and that is
// exactly the damage this block exists to prevent. And if `totalCount` does not
// come back (a version of gh that does not expose it), a warning goes out
// saying that truncation could not be ruled out — it is never accepted in
// silence.
const PROJECT_ITEMS_PAGE = 200
let existingProjectItems = []
if (projectNum) {
  ensureProjectMeta()
  const listItems = (limit) => JSON.parse(gh(['project', 'item-list', String(projectNum), '--owner', projectMeta.owner, '--limit', String(limit), '--format', 'json']))
  try {
    let itemsRaw = listItems(PROJECT_ITEMS_PAGE)
    let total = itemsRaw.totalCount
    if (Number.isInteger(total) && (itemsRaw.items || []).length < total) {
      itemsRaw = listItems(total)
      total = Number.isInteger(itemsRaw.totalCount) ? itemsRaw.totalCount : total
      if ((itemsRaw.items || []).length < total) {
        console.error(`el project ${project} tiene ${total} items y solo se han podido leer ${(itemsRaw.items || []).length}: /ct-groom NO continúa. Con una lista incompleta, los items que no vinieron se tratarían como inexistentes y se volverían a añadir — duplicados en el Project, en silencio.`)
        process.exit(1)
      }
    } else if (!Number.isInteger(total)) {
      console.error(`aviso: esta versión de \`gh project item-list\` no devuelve \`totalCount\`, así que NO se ha podido descartar que la lista de items del project ${project} venga truncada en ${PROJECT_ITEMS_PAGE}. Si el project tiene más items que eso, los que falten se tratarán como inexistentes y se añadirán otra vez (duplicados).`)
    }
    existingProjectItems = itemsRaw.items || []
  } catch (e) {
    console.error(`no se pudieron listar los items del project ${project}: ${e.message}`)
    process.exit(1)
  }
}

// an idempotent milestone — the filtering by title is done in JS, not inside a
// jq filter: a title with a `"` or a `\` in it would break the jq program if it
// were interpolated there. We bring back the complete list (paginated, all
// states: the endpoint filters to "open" by default and a closed milestone with
// the same title would cause a duplicate) and compare in memory. If the fetch
// fails (auth, network, rate limit) we abort — we do NOT treat it as "it does
// not exist", or we would end up creating a duplicate milestone.
let allMilestones
try {
  allMilestones = JSON.parse(gh(['api', `repos/${repo}/milestones`, '--method', 'GET', '-f', 'state=all', '--paginate']))
} catch (e) {
  console.error(`no se pudo listar milestones de ${repo}: ${e.message}`)
  process.exit(1)
}
let msNumber = allMilestones.find((m) => m.title === milestone)?.number
if (!msNumber) {
  const created = JSON.parse(gh(['api', `repos/${repo}/milestones`, '-f', `title=${milestone}`]))
  msNumber = created.number
  console.log(`milestone creado: ${milestone} (#${msNumber})`)
} else console.log(`milestone ya existe: ${milestone} (#${msNumber})`)

// the labels that are missing. Any gh failure here is real (auth, network,
// rate limit) and must abort the script instead of leaving issues without their
// labels.
//
// F6 (minor 5): only the ones the repo does NOT already have get created
// (`newLabels`, computed above against the real label listing). Before, `gh
// label create --force` was called for ALL of them on every run — and `--force`
// over an existing label rewrites it with gh's default colour/description, so a
// groom could change the colour of the repo's labels nobody asked it to touch.
// `--force` is kept in the creation in case another run created it between the
// listing and this call (a benign race): with --force that is not an error,
// without it the whole run would abort.
for (const l of newLabels) {
  gh(['label', 'create', l, '--repo', repo, '--force'])
}
{
  // The report goes AFTER creating them: saying "creadas" before `gh` has
  // really created them would be claiming something a later failure would
  // contradict.
  const line = labelReportLine('creadas')
  if (line) console.error(line)
}

// issues idempotent by their ct-order marker. We do NOT use `gh issue list
// --search`: GitHub's search tokenises on spaces and treats a leading `-` as an
// exclusion qualifier, so the marker `<!-- ct-order:N -->` does no reliable
// substring matching, and the search index has latency for freshly created
// issues (a false negative → a duplicate; a false positive → a slice that
// should have been created gets skipped in silence). Instead, we enumerate ALL
// the issues, with real pagination (`--paginate`, with no `--limit` cap) over
// the REST endpoint — a fixed `--limit` would leave out old issues carrying a
// marker in a large repo, reintroducing the same failure through truncation
// instead of through latency. That endpoint also returns pull requests and,
// without `--slurp`, `--paginate` would concatenate several loose JSON
// documents that would break the `JSON.parse`; see scripts/gh-issues.js for the
// detail and the pure tests of that filtering/flattening. We compare the marker
// as a literal substring of the body in JS — the same pattern as the milestone
// fix. A fetch failure aborts. F5: this fetch (and the computation of
// `reconcileEntries`) already happened FURTHER UP, before the --dry-run branch
// — it is not repeated here, `existingIssues`/`reconcileEntries` are just
// reused.

for (const { iss, found, diff, bodyResult } of reconcileEntries) {
  if (found) {
    console.log(`issue orden #${iss.order} ya existe (#${found.number}), no se duplica`)
    // F5: the divergence detection (and its report on stderr, the "gap"
    // warning included if --reconcile cannot apply something) already happened
    // BEFORE the --dry-run branch, so it is identical in the preview and in the
    // real run — all that is left here is, optionally, to APPLY what can be
    // applied. The same criterion as the --dry-run preview, and for the same
    // reason: the question "is there anything to write?"
    // (`bodyResult.body !== null`) is different from "does this count towards
    // the exit code?" (`hasDrift`, which deliberately excludes the epic context
    // — §4.4). With only one of the two, a run whose only divergence was that
    // section computed the new body, threw it away, exited 0 and still reported
    // that it had been rewritten.
    if (reconcileFlag && (hasDrift(diff) || bodyResult.body !== null)) {
      const fieldArgs = buildReconcileEditArgs(diff) // title/milestone/labels, via flags (the link to the spec lives in bodyResult.body, see below — it is a one-line splice, not a flag)
      const allArgs = bodyResult.body !== null ? [...fieldArgs, '--body', bodyResult.body] : fieldArgs
      // allArgs can only come out empty here if there is no new body to write
      // and NOTHING that diverges could be translated into a real mutation —
      // today, only when the ONLY divergence is of AC/Dependencias and its
      // section could not be located (gaps.ac/gaps.deps, see the warning
      // already printed above). There is no `gh` call to make in that case.
      if (allArgs.length > 0) {
        // The same criterion as the rest of this file's mutations (labels,
        // milestone, project): a `gh` failure here is NEVER benign — auth,
        // network, rate limit, or the closed issue rejecting the edit for some
        // reason we cannot anticipate. We abort with a clear message instead of
        // carrying on blind with the rest of the slices, which could leave only
        // SOME issues reconciled with no clear record of which.
        try {
          gh(['issue', 'edit', String(found.number), '--repo', repo, ...allArgs])
        } catch (e) {
          console.error(`no se pudo reconciliar el issue #${found.number} (orden #${iss.order}): ${e.message}`)
          process.exit(1)
        }
        // The reconciled --body is not printed in full (it can be a long block
        // of text) — it is named by category, just like the --dry-run preview,
        // and with the SAME list: what has been written, not what diverges. A
        // category whose section could not be located is already reported as a
        // `nota:` on stderr; naming it here would be contradicting ourselves.
        console.log(`issue #${found.number} reconciliado (orden #${iss.order}): ${appliedCategories(diff, bodyResult).join(', ')}`)
      }
    }
    if (projectNum && !hasProjectItem(existingProjectItems, repo, found.number)) {
      console.log(`issue #${found.number} no estaba en el project ${project} (hueco de una corrida anterior interrumpida) — añadiéndolo ahora`)
      addToProjectWithSprint(`https://github.com/${repo}/issues/${found.number}`, iss.order)
    }
    continue
  }
  const num = gh(['issue', 'create', '--repo', repo, '--title', iss.title, '--body', iss.body,
    '--milestone', milestone, ...iss.labels.flatMap((l) => ['--label', l])])
  console.log(`issue creado orden #${iss.order}: ${num}`)
  // F23: it is pushed into `inEpic` because that is the list the marker is
  // paired against. Today this registration has NO readers: `findByMarker` is
  // invoked once (above), inside the `plan.issues.map` that builds
  // `reconcileEntries` in one go, long before this loop. It is kept for
  // coherence with that list, not because it protects against anything: a
  // duplicated order in the §9 table is already cut off by
  // groom.js#findDuplicateOrders before getting here.
  inEpic.push({ number: null, body: iss.body })
  if (projectNum) addToProjectWithSprint(num, iss.order)
}

// F6, serious 2: the last thing that gets read after a real run is what is
// missing for this to be dispatchable — see printBacklogReminder further up.
printBacklogReminder()

// F5: exit code of the real run — the same three-state criterion as under
// --dry-run (see the comment beside that branch's `process.exit`):
// - without --reconcile: 3 if `anyUnresolvedDrift` (any category) or
//   `anyOrphans` was still standing, 0 if not.
// - with --reconcile: any `gh issue edit` failure already aborted with exit(1)
//   further up (it never carries on blind), so getting this far means that
//   title/milestone/link-to-the-spec/labels/deps/ac were applied successfully
//   wherever they diverged AND wherever they could be located. The only things
//   that can still be unresolved are: (a) a real AC/deps gap
//   (`anyReconcileGapRemains` — Critical 2, the warning above already explained
//   why) or (b) an orphan issue (`anyOrphans` — --reconcile does not touch
//   them, there is no "spec" to reconcile them against). Descripción/Protegido
//   NEVER appear here (see hasDrift/reconcileGaps): anchoring the exit code to
//   prose that gets edited routinely would leave the process at 3 for ever with
//   no --reconcile able to resolve it (review round 3, point 6).
process.exit(((reconcileFlag ? anyReconcileGapRemains : anyUnresolvedDrift) || anyOrphans) ? 3 : 0)
