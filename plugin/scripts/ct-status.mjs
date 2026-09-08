#!/usr/bin/env node
// /ct-status — WHAT QUESTION IT ANSWERS: «¿en qué estado está el loop ahora
// mismo?», whole and in a single call. Three buckets, grouped by what has to be
// done with them, not by the kind of datum they come from:
//
//   EN VUELO             which slices are claimed, and whether somebody is
//                        really working on them (a `claude` process inside the
//                        worktree) or it only looks that way (worktree and
//                        branch on disk).
//   ENTREGADO, SIN COSECHAR  which already closed slices leave a worktree or a
//                        branch behind.
//   RESIDUO              live `status:` labels on closed issues, and worktrees
//                        no issue claims.
//
// Before this command the coordinator put it together by hand EVERY TIME,
// crossing pgrep + lsof + gh issue view + gh pr list + git worktree list + git
// rev-list. That already cost one measured error: one of those checks used `gh
// issue list --state closed --limit 60` over 99 closed issues and reported 6
// cases when there were 10 — with a fallback that also printed «(ninguno —
// limpio)». That is why NO read here carries a `--limit`: everything paginates.
//
// IT MUTATES NOTHING. Not labels, not worktrees, not branches: it only reads.
// It is the property that lets you invoke it without a second thought —and the
// one that lets an external watcher invoke it in a loop— so it is tied down by
// a test that looks at the REAL argv `gh` was called with
// (__tests__/ct-status.test.js), not at the mere absence of errors. Naming and
// not deleting is deliberate and comes from `collectFinishedResidue`
// (dispatch.js): deleting the worktree of somebody who is still working is
// irreversible.
//
// THE 1 NEVER DEGRADES TO 0, and this is the command's hard rule. The three
// codes are the same ones /ct-groom uses: 0 = nothing to review, 3 = there is
// something to review, 1 = it could not be checked. The precedence is 1 > 3 > 0
// — never the other way round — because an incomplete read is NOT a loop at
// rest, and whoever receives the signal has to be able to tell them apart: the
// bug that started all of this was exactly a report that said «limpio» about
// truncated data. Hence two concrete behaviours of this file: the «loop en
// reposo» line is only printed when NOTHING is left unchecked, and a worktree
// on disk is not accused of being an orphan if the issue read failed — not
// because nothing is known then (with a partial read, the issues that did
// arrive still explain their worktrees), but because an issue that did NOT
// arrive could claim it, and accusing it would be inventing the finding.
//
// A partial finding does not hide the rest either: if the process read fails
// but the issue read goes well, what is known is reported, what is not is
// warned about, and it exits with 1.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadIssues } from './loop-issues.js'
import { liveSliceProcesses } from './liveness.js'
import { buildState } from './loop-state.js'
import { mapGhIssue, filterMergedIssues, closedWithLiveStatus } from './gh-issue-map.js'
import { parseRepoSlug } from './dispatch.js'

// A hardened `arg()`: the SAME one as in
// ct-next.mjs/ct-groom.mjs/dispatch-check.mjs, word for word and for the same
// measured reason. It only returns a string when the flag really carries a
// value; if the flag is argv's last token, or the next token is itself another
// flag (it starts with `--`), it returns `true` (present-without-value) instead
// of smuggling it in as a value. The naive version (`process.argv[i + 1]` as
// is) made a dangling `--milestone` create a milestone on GitHub literally
// titled "true", and a `--project` with no value turn into `1`
// (`Number(true) === 1`). There are no mutations to corrupt here, but a
// dangling `--repo` would indeed reach `gh api repos/true/issues` and produce a
// report about a repo that does not exist: the call site further down rejects
// it explicitly, just like its siblings.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}

const usage = 'uso: ct-status.mjs --repo <owner/repo>'
const repo = arg('--repo')
if (repo === true) {
  console.error(`--repo inválido: "(sin valor)" — ${usage}`)
  process.exit(2)
}
if (typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }
// The shape of `--repo`: the same criterion (and the same function) as
// /ct-next, so that a `--repo menoplus` does not die with a 404 without
// explaining that the problem was the shape of the argument.
if (!parseRepoSlug(repo)) {
  console.error(`--repo inválido: "${repo}" — debe tener la forma owner/repo (p.ej. josemerca/control-tower), con exactamente una barra y ambas mitades no vacías.`)
  process.exit(2)
}

// VENTANA_ARRANQUE_MS: below this claim age, a slice with no process is
// reported as «arrancando», not as «sin señal de vida». Right after a dispatch,
// cmux is typing the command and `claude` has not started up yet; without this
// window, looking at the state in that gap would accuse a perfectly healthy
// slice of abandonment. The value is the budget of /ct-next's start-up sentinel
// (DEFAULT_LAUNCH_SENTINEL_TIMEOUT_MS, ct-next.mjs) and is read from the SAME
// environment variable, with the same cap: if somebody raises it for the
// dispatcher, this report has to move with it or it would say «muerto» about
// slices the dispatcher is still waiting for. The difference with /ct-next is
// what is done in the face of a value that cannot be understood: the dispatcher
// aborts with exit 2 (it is about to mutate things), and here, where it only
// reads, it warns and carries on with the default — closing down the report
// because of a badly set variable would be worse than reporting it.
const VENTANA_ARRANQUE_DEFECTO_MS = 15000
const VENTANA_ARRANQUE_TOPE_MS = 600_000
let ventanaArranqueMs = VENTANA_ARRANQUE_DEFECTO_MS
const ventanaRaw = process.env.CT_NEXT_LAUNCH_TIMEOUT_MS
if (ventanaRaw !== undefined && ventanaRaw !== '') {
  const n = Number(ventanaRaw)
  if (!Number.isFinite(n) || n < 0 || n > VENTANA_ARRANQUE_TOPE_MS) {
    console.error(`aviso: CT_NEXT_LAUNCH_TIMEOUT_MS inválido ("${ventanaRaw}", debe ser un número entre 0 y ${VENTANA_ARRANQUE_TOPE_MS}) — se usa el valor por defecto de ${VENTANA_ARRANQUE_DEFECTO_MS} ms para decidir qué claim es demasiado reciente como para esperar un proceso.`)
  } else {
    ventanaArranqueMs = n
  }
}

// maxBuffer: execFileSync's default is 1 MiB and there is no `--limit` here to
// bound the answer (on purpose) — a repo with a few hundred issues with a full
// body exceeds it easily. Same value as ct-next.mjs/ct-groom.mjs.
// timeout+killSignal: a hung `gh` (a half-working network, an auth that does
// not answer) cannot leave this command waiting forever.
const GH_MAX_BUFFER = 20 * 1024 * 1024
const CHILD_TIMEOUT_MS = 10 * 60 * 1000

// The child's stderr goes to `pipe`, not to `inherit` as in ct-next.mjs: here
// `gh`'s message is not just loose diagnostics, it is the REASON that travels
// inside `sinComprobar` all the way into the report. And that text is preferred
// over Node's `e.message` ("Command failed: gh api repos/…" with the whole argv
// inside), which buries the real reason under two hundred characters of command
// line.
const gh = (a) => {
  try {
    return execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GH_MAX_BUFFER, timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' })
  } catch (e) {
    const detalle = (e && e.stderr ? String(e.stderr).trim() : '') || (e && e.message) || 'error desconocido'
    throw new Error(detalle)
  }
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' })

// motivos: everything that could NOT be checked. It is the only thing that
// decides the exit 1, so nothing that lands here can end up in a report that
// reads as «nada que revisar».
const motivos = []

// ---------------------------------------------------------------- issues ---
// `loadIssues` ALWAYS attempts both reads and returns what went well
// together with the reasons for what did not: a shared module does not decide
// on its caller's behalf, and this caller wants to report what it does know
// instead of aborting. It used to throw, and throwing when the second read
// failed threw away the first —which was already whole in memory—: the report
// came out EMPTY under a «lo de arriba es sólo lo que sí se ha podido
// comprobar» that had nothing above it. Each reason names which of the two
// reads failed.
//
// `issuesLeidos` demands BOTH. This is not over-zealousness: with only the open
// ones there is no knowing which worktree an already delivered slice left
// behind, and with only the closed ones there is no knowing which one is in
// flight — in either case, the crossing that decides "orphan" would manufacture
// findings. What could be read still feeds its own block of the report.
const { abiertos, cerrados, motivos: motivosIssues } = loadIssues({ repo, gh })
const issuesLeidos = motivosIssues.length === 0
motivos.push(...motivosIssues)

const mapeados = abiertos.map(mapGhIssue)
const enProgreso = mapeados.filter((i) => i.status === 'in-progress').map((i) => ({ n: i.n, nombre: i.name }))
// enRevision: DELIVERED work waiting for a merge. It is the second of §3.2's
// three questions («qué está en vuelo, qué ha entregado, qué es residuo») and
// until now the command did not answer it: its worktrees fell into RESIDUO and
// fired an exit 3 over a perfectly healthy loop. See the `enRevision` comment
// in loop-state.js for why it is neither residue nor harvest.
const enRevision = mapeados.filter((i) => i.status === 'in-review').map((i) => ({ n: i.n, nombre: i.name }))
const mergeados = filterMergedIssues(cerrados)
const cerradosConStatus = closedWithLiveStatus(cerrados)
// statusAbiertoPorNumero: so that the TRUTH can be told about a worktree that
// no in-flight or delivered issue explains — see the render's residue block. It
// costs no extra call: it comes out of the issues already read.
const statusAbiertoPorNumero = new Map(mapeados.map((i) => [String(i.n), i.status]))

// ---------------------------------------------------------- the checkout ---
// The LOCAL half of this report —worktrees, branches, processes— comes out of
// a checkout; the remote half comes out of `--repo`. Crossing them without
// checking that they talk about the SAME repository does not produce an
// incomplete report: it produces MANUFACTURED findings. Measured, with this
// check disabled and a checkout of `o/r` with three worktrees and a 3 h old
// claim: `--repo otro/repo` gave 3 findings with zero warnings and exit 3 — one
// of them the accusation of abandonment that §4 of the design calls «el peor
// fallo posible de este comando», and two worktrees marked as candidates for a
// `git worktree remove`. That this command writes nothing protects against
// nothing: the human writes, on its say-so.
//
// And the root has to be the MAIN CHECKOUT's, not `git rev-parse
// --show-toplevel`'s. Invoked from inside `.worktrees/7`, `--show-toplevel`
// returns that very worktree: there is no `.worktrees/` in there (everything
// comes out `worktree ✗`) and the prefix with which `liveSliceProcesses` maps
// each `cwd` to a slice comes out wrong (everything comes out `proceso ✗`) —
// the report denies the very directory you are standing in. `git worktree list
// --porcelain` ALWAYS lists the main checkout first.
//
// Unlike /ct-next (`ensureRepoIdentity`, which aborts with exit 1 because it is
// about to create branches and worktrees), nothing is aborted here: a check
// that cannot be made is exactly a `sinComprobar` with exit 1. Which half is
// not trustworthy is said, and the other one keeps being reported.
const detalleDe = (e) => (e && e.stderr ? String(e.stderr).trim() : '') || (e && e.message) || 'error desconocido'

function motivoDeIdentidad(root, esperado) {
  let originUrl
  try {
    originUrl = git(['-C', root, 'remote', 'get-url', 'origin']).trim()
  } catch (e) {
    // With no `origin` remote there is NOTHING to compare. It is treated as
    // "not verifiable" —never as "go ahead"—, the same criterion as
    // ct-next.mjs: a local repo with no origin is a legitimate environment, and
    // that is why this degrades to exit 1 with its reason instead of taking the
    // command down.
    return `no se pudo verificar que ${root} sea el checkout de ${esperado}: no tiene remote "origin" (${detalleDe(e)})`
  }
  const m = originUrl.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (!m) return `no se pudo interpretar el remote "origin" de ${root} ("${originUrl}") como un repo de GitHub owner/repo, así que no se pudo verificar que sea el checkout de ${esperado}`
  const real = `${m[1]}/${m[2]}`
  if (real.toLowerCase() !== esperado.toLowerCase()) {
    return `${root} es el checkout de ${real}, no de ${esperado}, y cruzar los issues de un repo con los worktrees de otro produce hallazgos que no existen`
  }
  return null
}

let repoRoot = null
// motivoCheckout: why the local half is not usable. It travels as `procesos`'s
// `motivo` (see further down) instead of being pushed to `motivos` separately,
// so that the same cause does not produce two different warnings.
let motivoCheckout = null
try {
  const linea = git(['worktree', 'list', '--porcelain']).split('\n').find((l) => l.startsWith('worktree '))
  if (!linea) throw new Error('`git worktree list --porcelain` no devolvió ninguna entrada')
  repoRoot = linea.slice('worktree '.length).trim()
} catch (e) {
  motivoCheckout = `no se pudo resolver la raíz del checkout principal (${detalleDe(e)})`
}
if (repoRoot) motivoCheckout = motivoDeIdentidad(repoRoot, repo)
const checkoutComprobado = repoRoot !== null && motivoCheckout === null
if (motivoCheckout) motivoCheckout += ': este informe no dice nada sobre worktrees, ramas ni procesos'

// worktreesEnDisco / ramasEnDisco: a read failure NEVER translates into «no
// hay». That `.worktrees/` does not exist is a legitimate answer (no dispatch
// has created anything yet); any other error is a read that could not be made,
// and it goes into `motivos`.
//
// `worktreesLeidos`/`ramasLeidas` tell the two apart for the render: without
// them, an empty array caused by a FAILURE was indistinguishable from an empty
// array caused by «no hay nada», and the in-flight block printed
// `worktree ✗ rama ✗` at the same time as the `aviso:` said it had not been
// possible to look. Reproduced with `.worktrees/` under `chmod 000`. An
// `ENOENT` is a completed read: the directory does not exist, and that answers
// the question.
let worktreesEnDisco = []
let ramasEnDisco = []
let worktreesLeidos = false
let ramasLeidas = false
if (checkoutComprobado) {
  try {
    worktreesEnDisco = readdirSync(join(repoRoot, '.worktrees'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    worktreesLeidos = true
  } catch (e) {
    if (e && e.code === 'ENOENT') { worktreesEnDisco = []; worktreesLeidos = true }
    else motivos.push(`no se pudo listar ${join(repoRoot, '.worktrees')} (${e.code || e.message}): este informe no dice nada sobre worktrees en disco`)
  }
  try {
    // --format instead of parsing `git branch`'s decorated output: without it,
    // the current branch arrives with a "* " in front and none would match
    // `feat/N`.
    ramasEnDisco = git(['-C', repoRoot, 'branch', '--list', 'feat/*', '--format=%(refname:short)'])
      .split('\n').map((s) => s.trim()).filter(Boolean)
    ramasLeidas = true
  } catch (e) {
    motivos.push(`no se pudieron listar las ramas feat/* (${(e.stderr ? String(e.stderr).trim() : '') || e.message}): este informe no dice nada sobre ramas en disco`)
  }
}

// ---------------------------------------------------------- sign of life ---
// The only signal that answers «is somebody working NOW?» instead of «is there
// any trace left?». It returns `comprobado: false` with its reason when `ps` or
// `lsof` are missing, fail or hang (both calls carry a time cap); the composer
// turns that into `vivo: null` for everybody, never into «dead». `pgrep` no
// longer takes part: see the `liveSliceProcesses` comment in
// scripts/liveness.js for why it was rejected.
const procesos = checkoutComprobado
  ? liveSliceProcesses(repoRoot)
  : { porSlice: new Map(), comprobado: false, motivo: motivoCheckout }

// ------------------------------------------------- the age of each claim ---
// Out of the issue's TIMELINE: the most recent `labeled` event for
// `status:in-progress`. The issue's `updated_at` will not do (and it would come
// for free in the payload already read): it changes with any edit —a comment,
// another label— so a recent comment would make a three-hour-old claim pass for
// «arrancando». And labels carry no date in the REST payload.
//
// One call per IN-FLIGHT issue, and «in flight» is bounded by the dispatcher's
// cap. `--paginate` without `--slurp`: over an endpoint that returns an array,
// gh merges the pages into a single array.
const edadClaimMs = new Map()
// motivosEdad: why the age of one particular claim could not be read. It is
// kept aside because the composer knows THAT it is missing, but only here is it
// known WHY — see the substitution further down.
const motivosEdad = new Map()
const ahora = Date.now()
for (const { n } of enProgreso) {
  let eventos
  try {
    eventos = JSON.parse(gh(['api', `repos/${repo}/issues/${n}/timeline`, '--paginate']))
  } catch (e) {
    edadClaimMs.set(n, null)
    motivosEdad.set(n, `#${n}: no se pudo leer el timeline del issue, así que no se sabe cuánto lleva puesto su claim (${e.message})`)
    continue
  }
  const marcas = (Array.isArray(eventos) ? eventos : [])
    .filter((ev) => ev && ev.event === 'labeled' && ev.label && ev.label.name === 'status:in-progress')
    .map((ev) => Date.parse(ev.created_at))
    .filter((t) => Number.isFinite(t))
  // The LAST `labeled`, not the first: a slice reopened with `--reopen` goes
  // back to `status:in-progress`, and the age that matters is the current
  // claim's, not that of the first one in its history.
  edadClaimMs.set(n, marcas.length ? ahora - Math.max(...marcas) : null)
}

// ----------------------------------------------------------- composition ---
// With an incomplete list of issues a worktree CAN still be attributed —with
// the issues that did arrive—; what CANNOT be done is to conclude that nobody
// claims it, because an issue that did not arrive could claim it. Accusing the
// ones that do not show up of being orphans would be manufacturing the finding
// — exactly the class of confident assertion over incomplete data this command
// exists to eliminate. Which ones were left unexplained is said, and the run
// goes on.
//
// What is turned off is the residue CONCLUSION (`sePuedeAtribuirWorktree`),
// not the list nor the attribution: the worktrees an issue that was read does
// claim are still attributed, and that is why the warning further down can keep
// quiet about them. `worktreesEnDisco` used to be emptied right here, and that
// protected too much: the same datum feeds the `hasWorktree` of the EN VUELO
// block, which is a DISK read and does not depend on GitHub. The report
// contradicted itself in two consecutive lines —the warning named
// `.worktrees/7` and the block said `worktree ✗` about #7— and it was the same
// class of false assertion the `?` mark further down came to kill, coming in
// through another door. It was unreachable while `loadIssues` threw (with no
// issues there was no in-flight block to print); the partial report made it
// reachable.
//
// AND MIND THE WORDING, which is where the same defect reappeared one round
// later: a PARTIAL read does not leave the report blind. If the open ones were
// read and the closed ones were not, `enProgreso` DOES explain worktrees, and
// so does the harvest in the symmetric case. The warning said «no se han
// cruzado con nada» about ALL the directories on disk, and that sentence became
// false the moment the real list started feeding the blocks: it asserted on
// stderr the opposite of what the report itself printed two lines below. That
// is why the warning is emitted AFTER composing, and only about the ones that
// really were left unexplained. If all of them were explained there is nothing
// to warn about —and the exit is still 1 all the same, because the reason for
// the read that failed has been in `motivos` since the issues were read; that
// is never lost.
const estado = buildState({
  enProgreso,
  enRevision,
  mergeados,
  cerradosConStatus,
  worktreesEnDisco,
  sePuedeAtribuirWorktree: issuesLeidos,
  ramasEnDisco,
  procesos,
  edadClaimMs,
  ventanaArranqueMs,
})

// The ones left UNEXPLAINED, using the same criterion as the composer
// (`worktreesExplicados` comes out of it, it is not recomputed here: two copies
// of the criterion would drift, and the first victim would be this very
// warning).
if (!issuesLeidos) {
  const explicados = new Set(estado.worktreesExplicados)
  const sinCruzar = worktreesEnDisco.filter((w) => !explicados.has(w))
  if (sinCruzar.length) {
    motivos.push(`hay ${sinCruzar.length} directorio(s) en .worktrees/ (${sinCruzar.join(', ')}) que no explica ninguno de los issues que sí se pudieron leer, y con la lista de issues incompleta no se puede decidir si son residuo: este informe no acusa a ninguno`)
  }
}

// The composer emits a generic reason («#N: no se pudo determinar la
// antigüedad del claim») for every slice with no life and no age. When the
// failure was a READ failure, the exact cause is known here, so its reason is
// REPLACED by the concrete one instead of accumulating: two lines on stderr
// about the same issue for a single cause read as two different problems.
const numeroCitado = (m) => {
  const x = /^#(\d+):/.exec(m)
  return x ? Number(x[1]) : null
}
const sinComprobar = [
  ...motivos,
  ...estado.sinComprobar.filter((m) => !motivosEdad.has(numeroCitado(m))),
  ...motivosEdad.values(),
]

// ---------------------------------------------------------------- report ---
const VIVO = { true: '✓', false: '✗', null: '?' }
// marca: `✓` / `✗` only when the read that answers that question could be
// completed; `?` when it could not. The same three-state alphabet as `VIVO`,
// and for the same reason: «there is none» and «it could not be looked at» are
// not the same thing.
const marca = (leido, hay) => (leido ? (hay ? '✓' : '✗') : '?')
function formatearEdad(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 90) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} d`
}

// sufijoDeProceso: whether somebody is working RIGHT NOW inside that worktree,
// and only if that could be checked. The first version of this block said
// «nadie lo está trabajando ahora» without looking at `procesos.porSlice`
// —which is already in memory— and the sentence came out just the same with a
// live `claude` inside the directory, and just the same too when the process
// check had FAILED (the warning on stderr and the assertion on stdout, at
// once). It is exactly the conflation §1.1 of the design exists to break
// —«there are artefacts» versus «somebody is working now»— reintroduced in
// prose, and it contradicts §4: when it cannot be checked, nobody is accused.
// When it is not known, this function says NOTHING.
function sufijoDeProceso(w) {
  if (!procesos.comprobado) return ''
  const pid = procesos.porSlice.get(String(w))
  return pid
    ? ` — OJO: hay un proceso trabajando dentro ahora mismo (pid ${pid}), no lo borres`
    : ' — y ahora mismo no hay ningún proceso trabajando dentro'
}

const lineas = []
// Empty blocks are NOT printed: a loop at rest produces a short report, not
// three headings with «(ninguno)». The fallback that printed «(ninguno —
// limpio)» over truncated data is the bug that gives all of this its name.
if (estado.enVuelo.length) {
  lineas.push(`EN VUELO (${estado.enVuelo.length})`)
  for (const s of estado.enVuelo) {
    lineas.push(`  #${s.n}  ${s.nombre}`)
    if (!checkoutComprobado) {
      // `hasWorktree`/`hasBranch` are `false` here because nothing was looked
      // at, not because they are not there: printing `worktree ✗` would be
      // asserting what has not been checked, which is the same defect this
      // command is after.
      lineas.push('        worktree ?  rama ?  proceso ?  ← no se ha mirado ningún checkout (ver los avisos)')
    } else {
      // `?`, not `✗`, when the corresponding read could not be completed:
      // asserting that there is none of what could not be looked at is the same
      // defect this command is after, and the inconsistency was internal —the
      // `else` above already prints `worktree ?` for this very reason. A `✓` can
      // only come from a read that really happened, so the mark of doubt never
      // degrades a positive signal.
      const señales = [`worktree ${marca(worktreesLeidos, s.hasWorktree)}`, `rama ${marca(ramasLeidas, s.hasBranch)}`, `proceso ${VIVO[String(s.vivo)]}`]
      if (s.pid) señales.push(`pid ${s.pid}`)
      let nota = ''
      if (s.vivo === null) nota = '  ← no se pudo comprobar si hay alguien trabajando (ver los avisos)'
      else if (s.arrancando) nota = '  ← arrancando: el claim es más reciente que la ventana de arranque, todavía no hay proceso que esperar'
      else if (s.vivo === false && s.edadMs !== null) nota = '  ← SIN SEÑAL DE VIDA'
      else if (s.vivo === false) nota = '  ← sin proceso, y sin saber de cuándo es el claim: no se acusa (ver los avisos)'
      lineas.push(`        ${señales.join('  ')}${nota}`)
    }
    if (s.edadMs !== null) lineas.push(`        claim puesto hace ${formatearEdad(s.edadMs)}`)
  }
}

// An informative block: it does NOT count as a finding (`hayHallazgos` does
// not look at it), so a healthy loop with three open PRs comes out with 0
// again. Different from the harvest block just below, which is what is ALREADY
// MERGED and left remains on disk — the two can appear at once.
if (estado.enRevision.length) {
  if (lineas.length) lineas.push('')
  lineas.push(`ENTREGADO, ESPERANDO MERGE (${estado.enRevision.length})`)
  for (const r of estado.enRevision) {
    lineas.push(`  #${r.n}  ${r.nombre} — status:in-review`)
  }
}

if (estado.cosecha.length) {
  if (lineas.length) lineas.push('')
  lineas.push(`ENTREGADO, SIN COSECHAR (${estado.cosecha.length})`)
  for (const c of estado.cosecha) {
    const queda = [c.hasWorktree ? `worktree .worktrees/${c.n}` : null, c.hasBranch ? `rama feat/${c.n}` : null].filter(Boolean)
    // «cerrado como completado», not «mergeado»: the only thing observable
    // without crossing with the PR graph is the issue's `stateReason` (see
    // filterMergedIssues in gh-issue-map.js). Closing by hand as completed
    // counts just the same, and saying «mergeado» would be asserting something
    // that has not been checked.
    lineas.push(`  #${c.n}  cerrado como completado, y todavía queda en disco: ${queda.join(' y ')}`)
  }
}

const residuoTotal = estado.residuo.labels.length + estado.residuo.worktreesHuerfanos.length
if (residuoTotal) {
  if (lineas.length) lineas.push('')
  lineas.push(`RESIDUO (${residuoTotal})`)
  for (const r of estado.residuo.labels) {
    lineas.push(`  #${r.n}  cerrado, pero conserva ${r.statusLabels.map((l) => `status:${l}`).join(' y ')}`)
  }
  for (const w of estado.residuo.worktreesHuerfanos) {
    // THE SENTENCE. §6 of the spec proposed «sin issue vivo que lo reclame»,
    // and that sentence is FALSE when the issue is OPEN in a state that is not
    // `status:in-progress` (e.g. `ready`, `blocked`): neither `enProgreso` nor
    // `mergeados` explains it, so it falls in here — with its issue alive. They
    // are different situations with different remedies, and telling them apart
    // costs no call at all: it comes out of the open issues that were already
    // read.
    const status = statusAbiertoPorNumero.get(w)
    if (status) lineas.push(`  .worktrees/${w}  su issue #${w} sigue abierto (status:${status}) y no está en vuelo${sufijoDeProceso(w)}`)
    else if (/^\d+$/.test(w)) lineas.push(`  .worktrees/${w}  ningún issue lo reclama: no hay ninguno abierto con ese número, ni ninguno entregado que lo dejara atrás${sufijoDeProceso(w)}`)
    else lineas.push(`  .worktrees/${w}  no corresponde al número de ningún issue${sufijoDeProceso(w)}`)
  }
  // The note is about worktrees, so it only appears when there is one: with
  // label residue alone it would talk about something that is not in the
  // report. Spotted by running the command for real against a repo with real
  // residue.
  if (estado.residuo.worktreesHuerfanos.length) {
    lineas.push('  (mientras un .worktrees/<n> exista, /ct-next se niega a despachar #<n> — este comando lo nombra, nunca lo borra)')
  }
}

// The at-rest line ONLY when there is nothing left to check. Asserting that
// there is nothing, having left a read half-done, is literally the bug of §3.2
// of the field feedback.
if (!lineas.length && !sinComprobar.length) {
  lineas.push('loop en reposo: nada en vuelo, nada por cosechar, nada de residuo.')
}

// Channel: the report is the PRODUCT and goes on stdout; the reasons for what
// could not be checked are diagnostics and go on stderr like the rest of the
// plugin's `aviso:`. The warnings are written BEFORE the report on purpose:
// they qualify everything that comes below.
for (const m of sinComprobar) console.error(`aviso: ${m}`)

// The exit code is decided by the composer's `hayHallazgos`, not by this
// count: the number is only for the human, and computing it here cannot change
// the signal an external watcher receives.
const cuantos = estado.enVuelo.filter((s) => s.vivo === false && !s.arrancando && s.edadMs !== null).length
  + estado.cosecha.length + residuoTotal
if (sinComprobar.length) {
  // «aviso(s)», not «lectura(s) sin completar»: the count is the count of
  // `aviso:` lines that have just come out on stderr, and not all of them are
  // reads. The warning about the worktrees that no issue read explains is not a
  // failed read —the disk read went fine— so counting it as one made it say
  // «2 lectura(s)» where ONE had failed. Counting warnings is exact and, on top
  // of that, whoever reads it can verify it by counting the lines above.
  lineas.push(`exit 1 — ${sinComprobar.length} aviso(s): lo de arriba es sólo lo que sí se ha podido comprobar`)
} else if (estado.hayHallazgos) {
  lineas.push(`exit 3 — hay ${cuantos} cosa(s) que revisar`)
} else {
  lineas.push('exit 0 — nada que revisar')
}
console.log(lineas.join('\n'))

// `process.exitCode` and NOT `process.exit(code)` — the same lesson already
// written twice in this repo (ct-next.mjs, next to its `finalExitCode`, and the
// header of __tests__/fixtures/fake-gh-bin/gh). `process.stdout` is
// ASYNCHRONOUS towards a pipe on POSIX, so `process.exit()` kills the process
// without waiting for what has already been written to be flushed. Measured
// with a report of 4003 findings: 195,095 bytes to a file, and 65,536 down a
// pipe —cut off mid-line, leaving no trace. The exit code survived, so the
// machine signal was not lying; the command's PRODUCT was, read through
// `| less`, `| tee`, a cmux capture or any parent that captures stdout. It is
// the §3.2 bug again through another mechanism. Setting the code and letting
// the process finish on its own keeps the same exit code and flushes the output
// as well; nothing keeps the event loop alive at this point. The aborts above
// (exit 2 for a badly set `--repo`) do use `process.exit()`, with the same
// criterion as ct-next.mjs: they are one line through console.error and there
// is no report to flush.
process.exitCode = sinComprobar.length ? 1 : (estado.hayHallazgos ? 3 : 0)
