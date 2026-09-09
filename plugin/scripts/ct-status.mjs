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

const usage = 'usage: ct-status.mjs --repo <owner/repo>'
const repo = arg('--repo')
if (repo === true) {
  console.error(`invalid --repo: "(no value)" — ${usage}`)
  process.exit(2)
}
if (typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }
// The shape of `--repo`: the same criterion (and the same function) as
// /ct-next, so that a `--repo menoplus` does not die with a 404 without
// explaining that the problem was the shape of the argument.
if (!parseRepoSlug(repo)) {
  console.error(`invalid --repo: "${repo}" — it has to have the form owner/repo (e.g. josemerca/control-tower), with exactly one slash and neither half empty.`)
  process.exit(2)
}

// VENTANA_ARRANQUE_MS: below this claim age, a slice with no process is
// reported as «starting up», not as «NO SIGN OF LIFE». Right after a dispatch,
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
const DEFAULT_START_UP_WINDOW_MS = 15000
const START_UP_WINDOW_CAP_MS = 600_000
let startUpWindowMs = DEFAULT_START_UP_WINDOW_MS
const windowRaw = process.env.CT_NEXT_LAUNCH_TIMEOUT_MS
if (windowRaw !== undefined && windowRaw !== '') {
  const n = Number(windowRaw)
  if (!Number.isFinite(n) || n < 0 || n > START_UP_WINDOW_CAP_MS) {
    console.error(`warning: CT_NEXT_LAUNCH_TIMEOUT_MS is invalid ("${windowRaw}", it has to be a number between 0 and ${START_UP_WINDOW_CAP_MS}) — the default value of ${DEFAULT_START_UP_WINDOW_MS} ms is used instead to decide which claim is too recent to be waiting for a process.`)
  } else {
    startUpWindowMs = n
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
    const detail = (e && e.stderr ? String(e.stderr).trim() : '') || (e && e.message) || 'error desconocido'
    throw new Error(detail)
  }
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' })

// motivos: everything that could NOT be checked. It is the only thing that
// decides the exit 1, so nothing that lands here can end up in a report that
// reads as «nada que revisar».
const reasons = []

// ---------------------------------------------------------------- issues ---
// `loadIssues` ALWAYS attempts both reads and returns what went well
// together with the reasons for what did not: a shared module does not decide
// on its caller's behalf, and this caller wants to report what it does know
// instead of aborting. It used to throw, and throwing when the second read
// failed threw away the first —which was already whole in memory—: the report
// came out EMPTY under a «what is above is only what it did manage to
// check» that had nothing above it. Each reason names which of the two
// reads failed.
//
// `issuesLeidos` demands BOTH. This is not over-zealousness: with only the open
// ones there is no knowing which worktree an already delivered slice left
// behind, and with only the closed ones there is no knowing which one is in
// flight — in either case, the crossing that decides "orphan" would manufacture
// findings. What could be read still feeds its own block of the report.
const { abiertos: open, cerrados: closed, motivos: issueReasons } = loadIssues({ repo, gh })
const issuesRead = issueReasons.length === 0
reasons.push(...issueReasons)

const mapped = open.map(mapGhIssue)
const inProgress = mapped.filter((i) => i.status === 'in-progress').map((i) => ({ n: i.n, nombre: i.name }))
// enRevision: DELIVERED work waiting for a merge. It is the second of §3.2's
// three questions («qué está en vuelo, qué ha entregado, qué es residuo») and
// until now the command did not answer it: its worktrees fell into RESIDUO and
// fired an exit 3 over a perfectly healthy loop. See the `enRevision` comment
// in loop-state.js for why it is neither residue nor harvest.
const inReview = mapped.filter((i) => i.status === 'in-review').map((i) => ({ n: i.n, nombre: i.name }))
const merged = filterMergedIssues(closed)
const closedWithStatus = closedWithLiveStatus(closed)
// statusAbiertoPorNumero: so that the TRUTH can be told about a worktree that
// no in-flight or delivered issue explains — see the render's residue block. It
// costs no extra call: it comes out of the issues already read.
const openStatusByNumber = new Map(mapped.map((i) => [String(i.n), i.status]))

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
const detailOf = (e) => (e && e.stderr ? String(e.stderr).trim() : '') || (e && e.message) || 'unknown error'

function identityReason(root, expected) {
  let originUrl
  try {
    originUrl = git(['-C', root, 'remote', 'get-url', 'origin']).trim()
  } catch (e) {
    // With no `origin` remote there is NOTHING to compare. It is treated as
    // "not verifiable" —never as "go ahead"—, the same criterion as
    // ct-next.mjs: a local repo with no origin is a legitimate environment, and
    // that is why this degrades to exit 1 with its reason instead of taking the
    // command down.
    return `could not verify that ${root} is the checkout of ${expected}: it has no "origin" remote (${detailOf(e)})`
  }
  const m = originUrl.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (!m) return `could not read the "origin" remote of ${root} ("${originUrl}") as a GitHub owner/repo, so it could not be verified that it is the checkout of ${expected}`
  const real = `${m[1]}/${m[2]}`
  if (real.toLowerCase() !== expected.toLowerCase()) {
    return `${root} is the checkout of ${real}, not of ${expected}, and crossing one repo's issues with another's worktrees produces findings that do not exist`
  }
  return null
}

let repoRoot = null
// motivoCheckout: why the local half is not usable. It travels as `procesos`'s
// `motivo` (see further down) instead of being pushed to `motivos` separately,
// so that the same cause does not produce two different warnings.
let checkoutReason = null
try {
  const line = git(['worktree', 'list', '--porcelain']).split('\n').find((l) => l.startsWith('worktree '))
  if (!line) throw new Error('`git worktree list --porcelain` returned no entry at all')
  repoRoot = line.slice('worktree '.length).trim()
} catch (e) {
  checkoutReason = `could not resolve the root of the main checkout (${detailOf(e)})`
}
if (repoRoot) checkoutReason = identityReason(repoRoot, repo)
const checkoutChecked = repoRoot !== null && checkoutReason === null
if (checkoutReason) checkoutReason += ': this report says nothing about worktrees, branches or processes'

// worktreesEnDisco / ramasEnDisco: a read failure NEVER translates into «no
// hay». That `.worktrees/` does not exist is a legitimate answer (no dispatch
// has created anything yet); any other error is a read that could not be made,
// and it goes into `motivos`.
//
// `worktreesLeidos`/`ramasLeidas` tell the two apart for the render: without
// them, an empty array caused by a FAILURE was indistinguishable from an empty
// array caused by «no hay nada», and the in-flight block printed
// `worktree ✗ branch ✗` at the same time as the `warning:` said it had not been
// possible to look. Reproduced with `.worktrees/` under `chmod 000`. An
// `ENOENT` is a completed read: the directory does not exist, and that answers
// the question.
let worktreesOnDisk = []
let branchesOnDisk = []
let worktreesRead = false
let branchesRead = false
if (checkoutChecked) {
  try {
    worktreesOnDisk = readdirSync(join(repoRoot, '.worktrees'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    worktreesRead = true
  } catch (e) {
    if (e && e.code === 'ENOENT') { worktreesOnDisk = []; worktreesRead = true }
    else reasons.push(`could not list ${join(repoRoot, '.worktrees')} (${e.code || e.message}): this report says nothing about worktrees on disk`)
  }
  try {
    // --format instead of parsing `git branch`'s decorated output: without it,
    // the current branch arrives with a "* " in front and none would match
    // `feat/N`.
    branchesOnDisk = git(['-C', repoRoot, 'branch', '--list', 'feat/*', '--format=%(refname:short)'])
      .split('\n').map((s) => s.trim()).filter(Boolean)
    branchesRead = true
  } catch (e) {
    reasons.push(`could not list the feat/* branches (${(e.stderr ? String(e.stderr).trim() : '') || e.message}): this report says nothing about branches on disk`)
  }
}

// ---------------------------------------------------------- sign of life ---
// The only signal that answers «is somebody working NOW?» instead of «is there
// any trace left?». It returns `comprobado: false` with its reason when `ps` or
// `lsof` are missing, fail or hang (both calls carry a time cap); the composer
// turns that into `vivo: null` for everybody, never into «dead». `pgrep` no
// longer takes part: see the `liveSliceProcesses` comment in
// scripts/liveness.js for why it was rejected.
const processes = checkoutChecked
  ? liveSliceProcesses(repoRoot)
  : { porSlice: new Map(), comprobado: false, motivo: checkoutReason }

// ------------------------------------------------- the age of each claim ---
// Out of the issue's TIMELINE: the most recent `labeled` event for
// `status:in-progress`. The issue's `updated_at` will not do (and it would come
// for free in the payload already read): it changes with any edit —a comment,
// another label— so a recent comment would make a three-hour-old claim pass for
// «starting up». And labels carry no date in the REST payload.
//
// One call per IN-FLIGHT issue, and «in flight» is bounded by the dispatcher's
// cap. `--paginate` without `--slurp`: over an endpoint that returns an array,
// gh merges the pages into a single array.
const claimAgeMs = new Map()
// motivosEdad: why the age of one particular claim could not be read. It is
// kept aside because the composer knows THAT it is missing, but only here is it
// known WHY — see the substitution further down.
const ageReasons = new Map()
const now = Date.now()
for (const { n } of inProgress) {
  let events
  try {
    events = JSON.parse(gh(['api', `repos/${repo}/issues/${n}/timeline`, '--paginate']))
  } catch (e) {
    claimAgeMs.set(n, null)
    ageReasons.set(n, `#${n}: the issue's timeline could not be read, so how long its claim has been on is not known (${e.message})`)
    continue
  }
  const marks = (Array.isArray(events) ? events : [])
    .filter((ev) => ev && ev.event === 'labeled' && ev.label && ev.label.name === 'status:in-progress')
    .map((ev) => Date.parse(ev.created_at))
    .filter((t) => Number.isFinite(t))
  // The LAST `labeled`, not the first: a slice reopened with `--reopen` goes
  // back to `status:in-progress`, and the age that matters is the current
  // claim's, not that of the first one in its history.
  claimAgeMs.set(n, marks.length ? now - Math.max(...marks) : null)
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
const state = buildState({
  enProgreso: inProgress,
  enRevision: inReview,
  mergeados: merged,
  cerradosConStatus: closedWithStatus,
  worktreesEnDisco: worktreesOnDisk,
  sePuedeAtribuirWorktree: issuesRead,
  ramasEnDisco: branchesOnDisk,
  procesos: processes,
  edadClaimMs: claimAgeMs,
  ventanaArranqueMs: startUpWindowMs,
})

// The ones left UNEXPLAINED, using the same criterion as the composer
// (`worktreesExplicados` comes out of it, it is not recomputed here: two copies
// of the criterion would drift, and the first victim would be this very
// warning).
if (!issuesRead) {
  const explained = new Set(state.worktreesExplicados)
  const notCrossed = worktreesOnDisk.filter((w) => !explained.has(w))
  if (notCrossed.length) {
    reasons.push(`there are ${notCrossed.length} directory(ies) in .worktrees/ (${notCrossed.join(', ')}) that none of the issues that could be read explains, and with the list of issues incomplete it cannot be decided whether they are residue: this report accuses none of them`)
  }
}

// The composer emits a generic reason («#N: no se pudo determinar la
// antigüedad del claim») for every slice with no life and no age. When the
// failure was a READ failure, the exact cause is known here, so its reason is
// REPLACED by the concrete one instead of accumulating: two lines on stderr
// about the same issue for a single cause read as two different problems.
const citedNumber = (m) => {
  const x = /^#(\d+):/.exec(m)
  return x ? Number(x[1]) : null
}
const unchecked = [
  ...reasons,
  ...state.sinComprobar.filter((m) => !ageReasons.has(citedNumber(m))),
  ...ageReasons.values(),
]

// ---------------------------------------------------------------- report ---
const ALIVE = { true: '✓', false: '✗', null: '?' }
// marca: `✓` / `✗` only when the read that answers that question could be
// completed; `?` when it could not. The same three-state alphabet as `VIVO`,
// and for the same reason: «there is none» and «it could not be looked at» are
// not the same thing.
const mark = (wasRead, present) => (wasRead ? (present ? '✓' : '✗') : '?')
function formatAge(ms) {
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
function processSuffix(w) {
  if (!processes.comprobado) return ''
  const pid = processes.porSlice.get(String(w))
  return pid
    ? ` — CAREFUL: there is a process working inside right now (pid ${pid}), do not delete it`
    : ' — and right now there is no process working inside'
}

const lines = []
// Empty blocks are NOT printed: a loop at rest produces a short report, not
// three headings with «(ninguno)». The fallback that printed «(ninguno —
// limpio)» over truncated data is the bug that gives all of this its name.
if (state.enVuelo.length) {
  lines.push(`IN FLIGHT (${state.enVuelo.length})`)
  for (const s of state.enVuelo) {
    lines.push(`  #${s.n}  ${s.nombre}`)
    if (!checkoutChecked) {
      // `hasWorktree`/`hasBranch` are `false` here because nothing was looked
      // at, not because they are not there: printing `worktree ✗` would be
      // asserting what has not been checked, which is the same defect this
      // command is after.
      lines.push('        worktree ?  branch ?  process ?  ← no checkout has been looked at (see the warnings)')
    } else {
      // `?`, not `✗`, when the corresponding read could not be completed:
      // asserting that there is none of what could not be looked at is the same
      // defect this command is after, and the inconsistency was internal —the
      // `else` above already prints `worktree ?` for this very reason. A `✓` can
      // only come from a read that really happened, so the mark of doubt never
      // degrades a positive signal.
      const signals = [`worktree ${mark(worktreesRead, s.hasWorktree)}`, `branch ${mark(branchesRead, s.hasBranch)}`, `process ${ALIVE[String(s.vivo)]}`]
      if (s.pid) signals.push(`pid ${s.pid}`)
      let note = ''
      if (s.vivo === null) note = '  ← it could not be checked whether anybody is working (see the warnings)'
      else if (s.arrancando) note = '  ← starting up: the claim is more recent than the start-up window, there is no process to wait for yet'
      else if (s.vivo === false && s.edadMs !== null) note = '  ← NO SIGN OF LIFE'
      else if (s.vivo === false) note = '  ← no process, and with no idea how old the claim is: nobody is accused (see the warnings)'
      lines.push(`        ${signals.join('  ')}${note}`)
    }
    if (s.edadMs !== null) lines.push(`        claim put on ${formatAge(s.edadMs)} ago`)
  }
}

// An informative block: it does NOT count as a finding (`hayHallazgos` does
// not look at it), so a healthy loop with three open PRs comes out with 0
// again. Different from the harvest block just below, which is what is ALREADY
// MERGED and left remains on disk — the two can appear at once.
if (state.enRevision.length) {
  if (lines.length) lines.push('')
  lines.push(`DELIVERED, WAITING FOR MERGE (${state.enRevision.length})`)
  for (const r of state.enRevision) {
    lines.push(`  #${r.n}  ${r.nombre} — status:in-review`)
  }
}

if (state.cosecha.length) {
  if (lines.length) lines.push('')
  lines.push(`DELIVERED, NOT HARVESTED (${state.cosecha.length})`)
  for (const c of state.cosecha) {
    const remaining = [c.hasWorktree ? `worktree .worktrees/${c.n}` : null, c.hasBranch ? `branch feat/${c.n}` : null].filter(Boolean)
    // «closed as completed», not «merged»: the only thing observable
    // without crossing with the PR graph is the issue's `stateReason` (see
    // filterMergedIssues in gh-issue-map.js). Closing by hand as completed
    // counts just the same, and saying «mergeado» would be asserting something
    // that has not been checked.
    lines.push(`  #${c.n}  closed as completed, and still left on disk: ${remaining.join(' and ')}`)
  }
}

const residueTotal = state.residuo.labels.length + state.residuo.worktreesHuerfanos.length
if (residueTotal) {
  if (lines.length) lines.push('')
  lines.push(`RESIDUE (${residueTotal})`)
  for (const r of state.residuo.labels) {
    lines.push(`  #${r.n}  closed, but it still keeps ${r.statusLabels.map((l) => `status:${l}`).join(' and ')}`)
  }
  for (const w of state.residuo.worktreesHuerfanos) {
    // THE SENTENCE. §6 of the spec proposed «sin issue vivo que lo reclame»,
    // and that sentence is FALSE when the issue is OPEN in a state that is not
    // `status:in-progress` (e.g. `ready`, `blocked`): neither `enProgreso` nor
    // `mergeados` explains it, so it falls in here — with its issue alive. They
    // are different situations with different remedies, and telling them apart
    // costs no call at all: it comes out of the open issues that were already
    // read.
    const status = openStatusByNumber.get(w)
    if (status) lines.push(`  .worktrees/${w}  its issue #${w} is still open (status:${status}) and is not in flight${processSuffix(w)}`)
    else if (/^\d+$/.test(w)) lines.push(`  .worktrees/${w}  no issue claims it: there is none open with that number, and none delivered that left it behind${processSuffix(w)}`)
    else lines.push(`  .worktrees/${w}  it does not correspond to the number of any issue${processSuffix(w)}`)
  }
  // The note is about worktrees, so it only appears when there is one: with
  // label residue alone it would talk about something that is not in the
  // report. Spotted by running the command for real against a repo with real
  // residue.
  if (state.residuo.worktreesHuerfanos.length) {
    lines.push('  (while a .worktrees/<n> exists, /ct-next refuses to dispatch #<n> — this command names it, it never deletes it)')
  }
}

// The at-rest line ONLY when there is nothing left to check. Asserting that
// there is nothing, having left a read half-done, is literally the bug of §3.2
// of the field feedback.
if (!lines.length && !unchecked.length) {
  lines.push('loop at rest: nothing in flight, nothing to harvest, no residue.')
}

// Channel: the report is the PRODUCT and goes on stdout; the reasons for what
// could not be checked are diagnostics and go on stderr like the rest of the
// plugin's `warning:`/`warning:`. The warnings are written BEFORE the report on purpose:
// they qualify everything that comes below.
for (const m of unchecked) console.error(`warning: ${m}`)

// The exit code is decided by the composer's `hayHallazgos`, not by this
// count: the number is only for the human, and computing it here cannot change
// the signal an external watcher receives.
const howMany = state.enVuelo.filter((s) => s.vivo === false && !s.arrancando && s.edadMs !== null).length
  + state.cosecha.length + residueTotal
if (unchecked.length) {
  // «warning(s)», not «lectura(s) sin completar»: the count is the count of
  // `warning:` lines that have just come out on stderr, and not all of them are
  // reads. The warning about the worktrees that no issue read explains is not a
  // failed read —the disk read went fine— so counting it as one made it say
  // «2 lectura(s)» where ONE had failed. Counting warnings is exact and, on top
  // of that, whoever reads it can verify it by counting the lines above.
  lines.push(`exit 1 — ${unchecked.length} warning(s): what is above is only what it did manage to check`)
} else if (state.hayHallazgos) {
  lines.push(`exit 3 — ${howMany} thing(s) to review`)
} else {
  lines.push('exit 0 — nothing to review')
}
console.log(lines.join('\n'))

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
process.exitCode = unchecked.length ? 1 : (state.hayHallazgos ? 3 : 0)
