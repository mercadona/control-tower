#!/usr/bin/env node
// HONEST WARNING (T11, fix round 2 — José's decision): the label-based claim
// of this script has NO compare-and-swap. `claimLost()` (scripts/claim.js)
// can only make the claimant with the HIGHER number lose — the lower-numbered
// one never loses by construction — so if two concurrent dispatchers pass
// their collision check before either of them has written, BOTH CAN END UP
// claiming the same shared token. This is not hypothetical: it is reproduced
// deterministically and repeatably with the adversarial harness
// (scripts/experiments/ac6-race2-deterministic.sh — 3/3 rounds in its most
// recent run, and with no exceptions in any of the runs made during its
// development with other parameters), verified against the real state of the
// labels in GitHub, not just by exit code — see task-11-report.md §3 for the
// full detail. The real mitigation TODAY, while the claim keeps living in
// labels, is operational, not code: do NOT launch two dispatchers at once
// against the same repo. This script cannot guarantee mutual exclusion under
// real concurrency; let it be said here without ornament so that whoever
// reads it knows exactly what guarantee they have (none) and does not trust
// the result of an exit 0 further than it deserves. The plan is to migrate
// the lock to a real atomic primitive (test-and-set via `git refs`, already
// validated in the CAS experiment of T9) — until that lands, this is the real
// guarantee: none under concurrency, yes under disciplined sequential use.
import { execFileSync, spawn } from 'node:child_process'
import { writeSync, statSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectCollisions, claimLost } from './claim.js'
import { flattenIssuePages, realIssuesOnly } from './gh-issues.js'
import { parseStrictInt } from './argnum.js'
import { NEVER_IN_A_SLICE_PR, SLICE_REL_PATH } from './state-paths.js'
import { checkPlans } from './plan-contract.js'
import { deliveredRun } from './run-machine.js'
import { extractE2eRuns, E2E_HEADING } from './gh-issue-map.js'
import { controlTowerLogDir } from './run-metrics.js'
import { matchesGo, GO_TOKEN } from './go-response.js'
import { readGoCommitment } from './go-registry.js'
import { gatesFromLabels } from './gates.js'
import { SliceBase, BaseBranch } from './slice-base.js'
import { DeliveryState } from './slice-collection.js'
import { CollectionAction, CollectionOutcome, SliceCollector } from './slice-collector.js'
import { findWorkspaceByCwd } from './cmux.js'
import { BigQueryTable, LoadOutcome } from './bigquery-load.js'
import { SliceHarvest, SliceHarvestOutcome, TelemetryIndex } from './slice-harvest.js'
import { HarvestLedger, LedgerIdentity } from './harvest-ledger.js'

const ctWatchMergePath = join(dirname(fileURLToPath(import.meta.url)), 'ct-watch-merge.mjs')

// ============================================================================
// Finding 4 (interruption/staleness audit): two changes in this file,
// related but independent.
//
// (a) Truncation at ~64 KiB. `console.error(big)` followed IMMEDIATELY by
// `process.exit()` can lose text: `process.stdout`/`process.stderr` are
// ASYNCHRONOUS towards a pipe on POSIX (documented in Node's own docs — the
// same reasoning that already motivated the `writeSync` of `attemptClaim` in
// ct-next.mjs), and `process.exit()` does not wait for an in-flight `write()`
// to finish draining. The `COLLISION: ...` message (a line further down) is
// precisely the one that grows most — a clash against many issues in flight
// at once — and the ATENCIÓN ones saying "release it by hand" are EXACTLY
// what a human needs in full when something went wrong. `dieErr`/`dieOut`/
// `errLine`/`outLine`, further down, replace `console.error`/`console.log`
// in THIS WHOLE file (not only right before exiting): two separate writes to
// the SAME fd keep their order even if one is synchronous and the other was
// not, but if ANY of the writes preceding a `process.exit()` is still in
// flight when it arrives, it is lost all the same — so the only way to be
// sure is that NO write in this file depends on the default asynchronous
// flush.
//
// (b) Widened exit code contract. Before, EVERY failure after the collision
// step (read/write failure, readback failure, lost race) shared the same
// exit 1 — the caller (ct-next.mjs#classifyClaimOutcome) had to TELL APART
// five very different causes by parsing the free TEXT this file prints,
// which is fragile against a future change of wording. Now the exit code on
// its own already distinguishes the three consequences the caller really
// cares about:
//   0 = success (claim confirmed, or --release succeeded) — unchanged.
//   1 = 'skip' — the NORMAL outcome of the protocol: collision detected
//       BEFORE writing anything, or lost race with a SUCCESSFUL revert
//       afterwards (the issue goes back cleanly to status:ready). No
//       mutation stays persisted. Skipping this slice and carrying on with
//       the rest of the batch is correct — no behaviour change from before.
//   2 = usage/config error (invalid argv, withdrawn flags, fixture without
//       --dry-run, malformed test hook) — unchanged.
//   3 = NEW — INFRASTRUCTURE failure with no persistent mutation: the
//       candidate's state could not be read, the claim could not be written,
//       or the readback failed but the revert afterwards succeeded. The
//       issue is left intact (or goes back to status:ready) — it is not a
//       real collision, but neither does it leave anything orphaned. The
//       caller treats this as "carry on with the rest of the batch", just as
//       before, only that now it knows it by the exit code, not by parsing
//       the message.
//   4 = NEW — ORPHAN: the claim was left at status:in-progress with NOBODY
//       working on it (failed revert after losing the race, or failed revert
//       after a readback failure). This demands that a human look at it
//       before ct-next.mjs retries anything else — the caller aborts the
//       WHOLE batch with this code, just as it already did before on seeing
//       this same ATENCIÓN text. With `--collect` this same 4 means the same
//       kind of thing through another door: the HARVEST WAS LEFT HALF DONE
//       (some step mutated and another failed), and the commands that remain
//       are printed separately —never chained with `&&`— so that a human can
//       finish the job.
//   5 = NEW (F22) — the slice's branch INTRODUCES a state file
//       (`.agent/STATE.md` or `.agent/SLICE.md`). Nothing is released: the
//       issue stays at status:in-progress. ct-next.mjs NEVER sees this code —
//       `--release` is invoked by the agent on delivering, not by the claim
//       loop, so it does not go through classifyClaimOutcome.
//   6 = NEW (F-jjponz-1) — the slice's prescriptive plan is missing from the
//       branch, cannot be read, or does not meet the contract
//       (plan-contract.js). It comes out of `--release` (which refuses
//       WITHOUT mutating anything: the issue stays at status:in-progress) and
//       of `--check-plan` (read-only mode so the agent can validate BEFORE
//       committing). Like the 5, classifyClaimOutcome never sees it.
//   9 = NEW (F38) — this slice's `plan` gate is NOT closed by a human: there
//       is no comment carrying the go of THIS dispatch (`-OK <nonce>`), or
//       the go of this dispatch is not registered, or it could not be
//       checked. It comes only out of `--release`, which refuses without
//       mutating anything. Like the 5, the 6, the 7 and the 8,
//       classifyClaimOutcome never sees it.
//  10 = NEW (F20/harvest) — KEPT: `--collect` found the PR merged, but the
//       worktree's tree has uncommitted changes or the local tip of
//       `feat/<n>` is not the `headRefOid` that merged the PR. NOTHING is
//       deleted and the reason is printed. "Merged" is not "nobody is
//       touching that", and deleting a worktree is irreversible: when in
//       doubt it is kept and said out loud. It comes only out of
//       `--collect`; like the 5, the 6 and the 9, classifyClaimOutcome never
//       sees it.
//  11 = NEW (F20/harvest into BigQuery) — `--collect --bq` read the slice's
//       harvest and BigQuery REJECTED the row. NOTHING is deleted (the row
//       travels before deleting precisely for this) and the reason `bq` gave
//       is printed on the error channel. It is a code of ITS OWN and not the
//       10 on purpose: the 10 says that the DISK disagrees with the merged
//       PR and is fixed in the worktree; this one is fixed in the dataset's
//       permissions or schema. A single code for the two causes left the
//       backend projecting the disk one onto both, and its reader staring at
//       a healthy worktree.
//       It comes only out of `--collect`; like the 5, the 6, the 9 and the
//       10, classifyClaimOutcome never sees it.
// The text this file prints does NOT change in content (the same details,
// including the manual `--release`/revert command) — it merely stops being
// the ONLY source of truth for the caller's decision.
// ============================================================================
//
// D5 (collateral finding, sibling of the one in ct-next.mjs) — A BROKEN
// OUTPUT DESTINATION CANNOT CHANGE THIS PROTOCOL'S EXIT CODE.
//
// `writeSync` guarantees the datum is written WHEN IT RETURNS, but it may
// never return (full pipe and blocking descriptor) or throw EPIPE (the reader
// closed). Without this try/catch, that EPIPE came up as an uncaught
// exception and killed the process with exit 1. Verified by construction by
// running `dispatch-check 90 --repo o/r` with the READ end of stdout closed
// (the real case of `dispatch-check ... | head`, or of an agent that invokes
// it from the kickoff and does not consume the output): the claim of #90 was
// written SUCCESSFULLY —`issue edit 90 --add-label status:in-progress` and
// its readback are in gh's log— and the process died with EPIPE at the final
// `dieOut('claimed #90 → in-progress', 0)`, exiting with 1.
//
// And 1 is not just any code in this file: it is 'skip', that is, "collision
// detected in time or race lost with a clean revert — NOTHING was left
// mutated". The caller would read a claim that succeeded as a claim that
// never happened, on the claim protocol's very own exit code contract. A
// message that cannot be delivered is an acceptable limit; a message deciding
// the protocol's outcome is not.
// OUTPUT CHANNEL (F16/H2) — same criterion as ct-next.mjs and ct-groom.mjs,
// written out in full in ct-next.mjs next to its `warn()`:
//
//   STDOUT (`outLine`/`dieOut`) = the PRODUCT. Here, the outcome of the claim
//            protocol: `claimed #N → in-progress`, `released`, `reopened`,
//            `requeued`, and the notes that accompany an outcome that was
//            achieved.
//   STDERR (`errLine`/`dieErr`) = the DIAGNOSTIC. `COLLISION:`, `ATENCIÓN:`,
//            usage errors and every abort.
//
// This file ALREADY met the criterion; it is stated so that the split does
// not have to be inferred. WATCH OUT when adding lines: `writeSync` (further
// down) is NOT a style detail — it is what stops an immediate
// `process.exit()` from eating the message, and what stops a broken
// destination from changing the exit code.
function safeWrite(fd, text) {
  try {
    writeSync(fd, text)
  } catch {
    // Pipe closed or full: the line is lost. It never changes the exit code
    // nor kills the process halfway through the claim protocol.
  }
}
function errLine(msg) { safeWrite(2, msg + '\n') }
function outLine(msg) { safeWrite(1, msg + '\n') }
function dieErr(msg, code) { errLine(msg); process.exit(code) }
function dieOut(msg, code) { outLine(msg); process.exit(code) }

// `arg()` only returns a string when the flag really carries a value: if the
// flag is the last token of argv, or the next token is itself another flag
// (starts with `--`), we return `true` (present-without-value) instead of
// sneaking it in as a value. The call sites explicitly validate
// `typeof === 'string'` before using it — that way a dangling `--repo` never
// reaches `execFileSync`.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
const has = (f) => process.argv.includes(f)
// D4, defect 2 (same pattern as `--cap` in ct-next.mjs, and costlier here):
// `parseInt(process.argv[2], 10)` is a TOLERANT parser — `parseInt('42x',
// 10)` is 42, `parseInt('1e3', 10)` is 1. This number identifies the issue
// that is going to be MUTATED (status:ready → status:in-progress) against a
// real repo: an argument with trailing rubbish silently claimed an issue the
// user had not named. parseStrictInt (scripts/argnum.js) only accepts decimal
// digits; anything else is a usage error, never a "close enough" number.
const issue = parseStrictInt(process.argv[2])
const repo = arg('--repo')
const release = has('--release')
const reopen = has('--reopen')
const requeue = has('--requeue')
const checkPlan = has('--check-plan')
const collect = has('--collect')
const dryRun = has('--dry-run')
// --no-watch-merge: do not launch the merge watcher in this release.
//
// It is asked for by a flow that HAS NO coordinator session, and that is why
// it is not a convenience switch: without it, the watcher does exactly what
// it knows how to do —locate the main checkout's cmux workspace by
// DIRECTORY— and in that flow the only one there is the one running the
// server that dispatched the slice. It would type at a program a paragraph
// meant for an agent, and its log would announce it as delivered: a false
// delivery in writing, which is worse than not warning at all.
//
// It is not detected, it is declared. From here there is no way to tell "that
// tab is a coordinator" from "that tab is a server": both are a cmux
// workspace in the same directory. Whoever dispatches does know, so they say
// so.
//
// It does NOT change any other decision of the release, and in particular it
// does not relax it: the five gates are checked the same and the issue moves
// the same. The only thing lost is the warning, which is precisely what the
// watcher contributes —the MOMENT, not the knowledge— because `/ct-next`
// keeps emitting `cosecha pendiente:` on every run. And in the flow that asks
// for this flag even less is lost: there the one who collects is a clock that
// calls `--collect` on its own, so the warning is not left without a
// recipient, it is left without a function. It is said out loud when
// releasing, for the same reason the failure to launch it is also said: a
// silence here is indistinguishable from a watcher that really is there.
const noWatchMerge = has('--no-watch-merge')
const usage = 'uso: dispatch-check.mjs <issue#> --repo <o/r> [--release | --reopen | --requeue | --check-plan | --collect] [--dry-run] [--no-watch-merge] [--bq <proyecto:dataset.tabla>]'
// --bq <project:dataset.table>: only inside --collect, where to load the slice's harvested
// row after closing cmux, deleting the worktree and the branch. It is validated HERE, next
// to the other flags and before touching `gh`, so that a malformed value exits with 2
// without having read anything from GitHub — the same criterion as the rest of this block.
const bqArg = arg('--bq', null)
if (bqArg === true) dieErr(`--bq inválido: "(sin valor)" — ${usage}`, 2)
const bqTable = bqArg === null ? null : BigQueryTable.parse(bqArg)
if (bqArg !== null && !bqTable) dieErr(`--bq inválido: "${bqArg}" — debe tener la forma proyecto:dataset.tabla (p.ej. mi-proyecto:control_tower.harvest).`, 2)
if (issue === null || issue < 1) {
  dieErr(`<issue#> inválido: ${process.argv[2] === undefined ? '(ausente)' : `"${process.argv[2]}"`} — debe ser un entero >= 1 escrito con dígitos a secas (nada de "42x", "1e3", "4.2", espacios, ni signo "+"/"-": un número aproximado aquí reclamaría un issue que no es el que pediste).\n${usage}`, 2)
}
if (typeof repo !== 'string' || repo.length === 0) { dieErr(usage, 2) }
// The three flags move the SAME label along different edges of the cycle
// (ready → in-progress → in-review → in-progress → … → ready). Passing two
// together has no reasonable interpretation, and silently picking one would
// be guessing which one whoever wrote it meant, on top of a real state
// mutation. `--collect` moves no label —it deletes residue on disk— but it
// falls under the same exclusion for the same reason: it is another whole
// mode of this command, and combining it with one that mutates labels has no
// reasonable interpretation.
{
  const pedidos = [release && '--release', reopen && '--reopen', requeue && '--requeue', checkPlan && '--check-plan', collect && '--collect'].filter(Boolean)
  if (pedidos.length > 1) {
    dieErr(`${pedidos.join(' y ')} son mutuamente excluyentes: --release cierra el slice hacia revisión (in-progress → in-review), --reopen lo devuelve al banco de trabajo tras un rechazo (in-review → in-progress), --requeue lo abandona y lo devuelve a la cola (in-progress → ready) y --collect recoge el residuo en disco de un slice ya mergeado sin tocar ninguna label. Elige uno.\n${usage}`, 2)
  }
}

// CT_CLAIM_TEST_SELF_KILL_SIGNAL — exclusively for tests (external review,
// IMPORTANT: a real Ctrl-C during attemptClaim in ct-next.mjs kills THIS
// process by signal, and the caller needs to tell that apart from a "bug or
// misconfiguration" — see classifyClaimOutcome/the caller in ct-next.mjs).
// Reproducing this deterministically with an EXTERNAL signal would require
// coordinating the PID of a subprocess launched inside ANOTHER subprocess —
// fragile and with the same timing races already seen in finding 1. Sending
// the signal to oneself (the same underlying syscall as an external one,
// indistinguishable to Node) at a deterministic point is the reliable way to
// exercise that path. It is checked here, right after the usage validation —
// before touching `gh` or mutating anything — so that the effect is identical
// to "the user interrupted right at the start".
if (process.env.CT_CLAIM_TEST_SELF_KILL_SIGNAL) {
  process.kill(process.pid, process.env.CT_CLAIM_TEST_SELF_KILL_SIGNAL)
  // The process itself dies here from the signal (default disposition: no
  // handler registered in this file) — nothing after this line gets to run
  // when the variable is set.
}

// --settle-ms/CT_CLAIM_SETTLE_MS NO LONGER EXIST (T11, fix round 2 — see this
// file's header comment for why). If the flag appears in argv, it is
// explicitly REJECTED with exit 2 instead of being ignored silently: someone
// invoking it out of habit (`--settle-ms 2000`, from a script or from muscle
// memory) with a clean exit 0 would be left believing there is a settle wait
// active — exactly the "invites you to trust it" that motivated removing it.
// Ignoring it silently would have reintroduced that false confidence by
// another route.
if (has('--settle-ms') || process.env.CT_CLAIM_SETTLE_MS !== undefined) {
  dieErr('--settle-ms/CT_CLAIM_SETTLE_MS ya no existen: la espera de asentamiento se eliminó a propósito (ver el comentario de cabecera de dispatch-check.mjs y task-11-report.md). Quítalo de la invocación/entorno — no hace nada, y dejarlo puesto invita a creer que sigue activo.', 2)
}

// THERE IS NO SETTLE WAIT IN THIS SCRIPT — it was removed on purpose (T11,
// fix round 2). An earlier version existed with
// --settle-ms/CT_CLAIM_SETTLE_MS (a wait between writing the claim and
// re-reading it, with a 2000ms default), sold as a mitigation of the double
// claim window.
//
// THE REASON FOR REMOVING IT IS NOT "IT WAS PROVEN USELESS" — that is not
// proven, and asserting it would be as imprecise as the original promise. The
// reason is simpler and does not depend on that measurement: a time window
// does not CLOSE a race condition, it only reduces its probability, and we do
// not want to mitigate a real race with a timer, whatever it measures. That
// reason stands on its own.
//
// What was measured (task-11-report.md §5, summary and detail): three skew
// sweeps (500, 3000 and 8000ms) against settle=0 and settle=2000 gave the
// same result at both settle values. A fourth point, skew=1000, DID diverge
// (settle=0 → double claim 3/3; settle=2000 → no double claim 3/3) — but that
// is n=1 (a single round of 3 measured at that point, with no repeat at
// neighbouring points), not conclusive on its own. Taken together, the data
// allow us to assert neither that the settle contributed 0 margin nor that it
// contributed ~2s: the sampling does not reach far enough to settle it, and
// the fine sweep that would settle it has not been completed. The real
// guarantee today is in this file's header comment: none under concurrency.
//
// Synchronous, blocking sleep (no async/await, so as not to restructure the
// whole script into promises): Atomics.wait over a shared buffer is the
// standard way to block Node's main thread for a fixed interval.
function sleepSync(ms) {
  if (!(ms > 0)) return
  const sab = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(sab, 0, 0, ms)
}

// CT_CLAIM_FIXTURE is exclusively for tests. If it is left dangling in the
// environment (a variable a test did not clean up, a wrapper that does not
// unset it) WITHOUT --dry-run, the script must NOT decide with fabricated
// data nor, above all, run real mutations against gh with that invented state
// in the background: it is treated as a usage error and we abort before
// touching gh.
if (process.env.CT_CLAIM_FIXTURE && !dryRun) {
  dieErr('CT_CLAIM_FIXTURE está definido pero falta --dry-run: por seguridad no se decide ni se muta gh real con datos de fixture. Añade --dry-run o limpia la variable de entorno.', 2)
}
// Tied down in the read itself too (defence in depth): `fx` can only be
// non-null when `dryRun` is true.
const fx = (dryRun && process.env.CT_CLAIM_FIXTURE) ? JSON.parse(process.env.CT_CLAIM_FIXTURE) : null

// Explicit maxBuffer (finding 7 of the final review): Node's default for
// execFileSync is 1 MiB. `allOpen()` no longer carries `--limit` (see below),
// so in a repo with a few hundred open issues the JSON can exceed 1 MiB
// easily. Node aborts noisily if it is exceeded (it does not truncate
// silently), but that would make the command unusable against a real repo.
// 20 MiB is generous for thousands of issues without being truly "no limit".
const GH_MAX_BUFFER = 20 * 1024 * 1024
// timeout+killSignal (MINOR, external review: consistency with ct-next.mjs's
// principle that EVERY blocking call to a subprocess must be bounded — this
// file can also be invoked on its own, not only as a subprocess of
// ct-next.mjs, so it needs its own independent bound instead of depending
// only on the timeout the caller imposes on it from outside). Same default
// (10 min) and same cap (24h) as CT_NEXT_CHILD_TIMEOUT_MS in ct-next.mjs,
// with its own environment variable — dispatch-check.mjs imports nothing from
// ct-next.mjs.
const CHILD_TIMEOUT_CAP_MS = 24 * 60 * 60 * 1000
let ghTimeoutMs = 10 * 60 * 1000
const ghTimeoutRaw = process.env.CT_CLAIM_CHILD_TIMEOUT_MS
if (ghTimeoutRaw !== undefined) {
  const n = Number(ghTimeoutRaw)
  if (!Number.isFinite(n) || n <= 0 || n > CHILD_TIMEOUT_CAP_MS) {
    dieErr(`CT_CLAIM_CHILD_TIMEOUT_MS inválido: "${ghTimeoutRaw}" — debe ser un número > 0 y <= ${CHILD_TIMEOUT_CAP_MS}`, 2)
  }
  ghTimeoutMs = n
}
const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: GH_MAX_BUFFER, timeout: ghTimeoutMs, killSignal: 'SIGKILL' })
const labelsOf = (n) => JSON.parse(gh(['issue', 'view', String(n), '--repo', repo, '--json', 'labels', '-q', '[.labels[].name]']))
// Direct listing of open issues via the REST endpoint `gh api
// repos/<repo>/issues` — NEVER the search index (`--search` / `gh search
// issues`), which has indexing latency and might not yet reflect the label
// another runner has just written. Nor `gh issue list --limit 200` (finding 2
// of the final review): that endpoint returns newest first, so a fixed
// `--limit` leaves out precisely the OLD issues — and a colliding
// `in-progress` that falls outside this list makes
// `detectCollisions`/`claimLost` fail OPEN (the lock stops blocking, instead
// of failing closed). Instead we use real pagination (`--paginate --slurp`,
// with no cap), reusing the same PR flattening/filtering helper as
// ct-groom.mjs/ct-next.mjs (scripts/gh-issues.js) — that endpoint also
// returns pull requests. All the collision and tie-breaking logic is still
// entirely client-side in `claim.js`. per_page=100 (re-review): the REST
// default is 30/page; with --paginate they all get fetched anyway, but
// `allOpen()` is called TWICE per claim (collision + readback), so fewer
// pages per call cuts the total round-trips by ~3x. 100 is the maximum this
// endpoint admits.
const allOpen = () => realIssuesOnly(flattenIssuePages(JSON.parse(
  gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=open', '-f', 'per_page=100', '--paginate', '--slurp']))))
  .map((i) => ({ n: i.number, labels: (i.labels || []).map((l) => l.name) }))

const manualReleaseHint = () => `gh issue edit ${issue} --repo ${repo} --add-label status:ready --remove-label status:in-progress`

// setStatus: the only function that mutates an issue's `status:` label — the
// claim (status:ready → status:in-progress), the revert on a lost race, the
// revert on a readback failure, and --release (status:in-progress →
// status:in-review) all four go through here. The plan (a decision José has
// already taken) is to migrate the lock to a real atomic primitive — a create
// of `POST /repos/{owner}/{repo}/git/refs`, already validated in an earlier
// experiment as a real test-and-set: 201 for the winner, 422 "Reference
// already exists" for each loser, over 5 rounds of 8 genuinely concurrent
// attempts — and this extraction reduces that future migration to a single
// point of edit instead of four.
//
// It returns { ok: true } or { ok: false, error }, and it does NOT print nor
// exit the process on its own: what message to show on failure, whether a
// success one is needed, and whether the failure must abort (exit 1) or only
// warn and carry on differ at each of the four call sites (see below and in
// the claim-then-verify) — that decision belongs to each caller, not to
// setStatus. "Return a result" was chosen over a message callback because the
// control flow around each mutation is already different from site to site
// (two of the four sites call process.exit(1) immediately on failure; the
// other two delegate that decision to an outer catch/if that already existed
// before this extraction) — forcing that control flow inside setStatus would
// have been more complex than leaving it where it already was. Same pattern
// as `attemptRevertClaim` in ct-next.mjs: a gh mutation that reports
// success/failure without deciding what to do with that result.
function setStatus(issue, from, to) {
  try {
    gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', to, '--remove-label', from])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e }
  }
}

// ============================================================================
// F22 — THE GATE: A SLICE DOES NOT DELIVER WITH A STATE FILE INSIDE.
//
// `.agent/STATE.md` belongs to the COORDINATOR session. If the slice's branch
// introduces it, the PR's squash leaves main with a slice's state: `task:`
// with the slice's name, `role: slice-agent` and a gate pending on an already
// merged PR. Any new session of the repo hydrates believing it IS that agent.
// It happened three times over a span of 9 slices, and one reached main.
//
// IT REFUSES, it does not warn. A check that only prints is not a check: if
// its result cannot stop the next action, it is decoration — and that is
// exactly how the one that reached main slipped through (it printed `1` and
// the merge carried on).
//
// LIMIT, said out loud: `--release` is invoked by the agent because the
// kickoff asks it to, and the kickoff is a prompt, not a gate. An agent that
// does not call it skips this gate — but then its issue stays at
// status:in-progress, which is visible. This moves the normal case from the
// human's retina to the loop; it does not make it hermetic.
// ============================================================================
// Slice 2 (Capde's notes) — THE DIFF'S BASE IS THE REAL CUT, NOT THE LOCAL
// COPY. An earlier version of this comment claimed that `base:` "is the real
// reference this worktree was cut from". That is false since c3af34c, and
// that lie already cost one run: `base:` is the PR's BRANCH NAME (`main`,
// `develop` — that is where the `--base` of `gh pr create` comes from when
// closing the slice), and the worktree is cut from `origin/<base>`. Resolving
// that name in here points at the LOCAL copy of the branch, which may have
// gone days without a fetch: in the slice 10 run it was 7 commits behind
// origin/main and the plan gate accused of "invented citation" a file that
// had been on the remote all that time.
//
// The real cut travels in `base_sha:` (kickoff.js seeds it as of slice 1: the
// sha of `origin/<base>` at the moment of the cut, in a field no verb or hook
// rewrites; absent —never empty— if it did not resolve). That is why it is
// PREFERRED, verified with `rev-parse --verify --quiet <sha>^{commit}` — the
// `^{commit}` suffix is not decorative: without it, `--verify` accepts ANY
// well-formed 40-hex even if the object does not exist in the repo (checked
// against real git). If the field is not there (seeds older than slice 1) or
// the sha does not resolve (pruned repo, corrupt seed), it falls back to the
// usual chain, INTACT: `base:` → origin/HEAD → origin/main → main → master.
//
// The sha's verification lives HERE and not in the two consumers on purpose:
// they also rev-parse what this function returns, but their failure is
// `known:false` → --release REFUSES (exit 5/6) — which is right for a ref
// that was supposed to resolve. A `base_sha:` that does not resolve must
// refuse nothing: it must fall back, and that can only be decided BEFORE
// choosing what to return. The consumers' rev-parse stays: it still covers
// the fallback chain and it is the one anchoring the "base === HEAD" case.
// RE_40HEX is NO LONGER the guardrail for `base:` (slice 9a, below): its only
// consumer is the contract of the `base_sha:` field, which IS a 40-hex seeded
// by kickoff.js and never a ref name — see its comment in the body of
// sliceBaseRef.
const RE_40HEX = /^[0-9a-f]{40}$/i
// --release queries the base TWICE (F22 cleanliness + F-jjponz-1 plan); the
// warning below comes out ONCE per process, not once per query.
let avisoBaseEsShaEmitido = false
// The SECOND latch, and it is about COST, not noise: `avisoBaseEsShaEmitido`
// is only raised when the warning IS EMITTED, so in the normal case (`base:`
// is a real branch and there is nothing to warn about) it stays false forever
// and the `baseNoEsUnaRama` probe would be paid for AGAIN on the second
// query. With this, the probe is paid once per value of `base:` per process —
// and `base:` comes out of the same file on both queries.
let baseFormaProbada = null

// ============================================================================
// Slice 9(a) — THE GUARDRAIL STOPS COUNTING CHARACTERS.
//
// The slice 2 version demanded the full 40 hex. An agent that "fixes" the
// field with `git rev-parse --short HEAD` puts in 7-12 hex: it breaks
// `gh pr create --base` EXACTLY the same (it demands a branch name), but the
// diff comes out right (git resolves the short sha like any other ref) and
// the guardrail stayed quiet. A tag, a `HEAD~1` or an `origin/main` in that
// field break the same thing and were also passed over in silence.
//
// The real distinction is not the length, it is the NATURE of the value:
// `base:` is the branch name the `--base` of `gh pr create` comes from. So we
// ask what matters, in this order (which is also the CHEAPEST order — the
// normal case costs ONE rev-parse):
//
//   1. does `refs/heads/<base>` exist?           → it is a local branch: STAY
//      QUIET.
//   2. does `refs/remotes/origin/<base>` exist?  → it is a branch of the
//      remote that this clone has never checked out (base `develop` in a
//      clone that only has `main`): it is a LEGITIMATE branch name, STAY
//      QUIET. This probe is defensive and it is not the one that saves that
//      case: `develop^{commit}` does not resolve a remote-only branch either
//      (git looks for `refs/remotes/develop`, not
//      `refs/remotes/origin/develop`), so step 4 would already stay quiet.
//      What the probe adds is telling the truth along the way, instead of
//      staying quiet for having found nothing. The remote is called `origin`
//      bare because the whole dispatcher already does so: the worktree is cut
//      from `origin/<base>` (ct-next.mjs:3506) and the fallback chain further
//      down names `origin/HEAD` and `origin/main`.
//   3. does `<base>^{commit}` resolve?           → it is not a branch and it
//      IS a commit: a sha (full or short), a tag, `HEAD`, `origin/main`… →
//      WARN.
//   4. if it does not resolve either → STAY QUIET. It is neither a branch nor
//      a commit: that breakage is already named by the two consumers in their
//      own voice and with their own exit ("no se pudo resolver `<base>` o
//      HEAD a un commit", exit 5/6), which is more precise than this warning.
//      Duplicating it here would be noise.
//
// Prefixing `refs/heads/`/`refs/remotes/origin/` is not decorative: it makes
// the argument unable to start with `-` and be read by git as an option. Any
// failure (git absent, cwd outside a repo, unreadable .git) is read as "I
// could not check it" and STAYS QUIET: this is a diagnostic, it never aborts
// anything — the F16/H2 split.
// ============================================================================
function refResuelve(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { stdio: 'ignore' })
    return true
  } catch { return false }
}

function baseNoEsUnaRama(base) {
  if (refResuelve(`refs/heads/${base}`)) return false
  if (refResuelve(`refs/remotes/origin/${base}`)) return false
  return refResuelve(`${base}^{commit}`)
}

// Fix round 1 (Important 1) — the parsing of the seed's `base:` field lived
// written twice (here and in nombreDeLaRamaBase(), below): same readFileSync,
// same regex, same quote trimming. `conventions/decisions.md`: if how that
// field is written or quoted changes, BOTH have to be touched at once or they
// diverge silently. A single place that knows how to parse the raw field —
// the file's declared debt exempts it from the style, not from this.
function parseBaseField(seedText) {
  const b = seedText.match(/^base:[ \t]*(.+)$/m)
  return b ? b[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

function campoBaseDeLaSemilla() {
  const seed = readFileSync(join(process.cwd(), SLICE_REL_PATH), 'utf8')
  return parseBaseField(seed)
}

function sliceBaseRef() {
  try {
    const seed = readFileSync(join(process.cwd(), SLICE_REL_PATH), 'utf8')
    const base = parseBaseField(seed)
    // Guardrail against the spontaneous fix observed in the real run: an
    // agent that "fixes" the diff by putting a SHA in `base:`. The diff comes
    // out the same (a sha resolves like any ref), so it does NOT abort — the
    // breakage is in the OTHER consumer of the field: `gh pr create --base`
    // demands a branch name and will fail when closing the slice. Warning via
    // stderr (diagnostic, not product — the F16/H2 split from above).
    if (base && !avisoBaseEsShaEmitido && baseFormaProbada !== base) {
      baseFormaProbada = base
      if (baseNoEsUnaRama(base)) {
        avisoBaseEsShaEmitido = true
        const visible = base.length > 40 ? `${base.slice(0, 40)}…` : base
        errLine(`AVISO: el campo \`base:\` de ${SLICE_REL_PATH} (\`${visible}\`) NO es un nombre de rama: no existe ni como \`refs/heads/\` ni como \`refs/remotes/origin/\`, y sin embargo resuelve a un commit — un SHA (completo o abreviado), un tag, o una ref como \`origin/main\`. Eso ROMPE el \`gh pr create --base\` del cierre del slice (exige un nombre de rama), y no arregla el diff: para medir contra el corte real ya existe \`base_sha:\`, que este check prefiere solo. Devuelve \`base:\` al nombre de la rama del PR (p. ej. \`main\`).`)
      }
    }
    const s = seed.match(/^base_sha:[ \t]*(.+)$/m)
    if (s) {
      const sha = s[1].trim().replace(/^['"]|['"]$/g, '')
      // Only a 40-hex: `base_sha:` is a seeded SHA, never a ref name.
      // Accepting `HEAD~1` or `main` here would let a rewritten seed
      // (SLICE.md is agent-reachable — trap (c) of F22, below) move the
      // diff's base to a ref the agent itself controls. It is not a security
      // boundary (a valid sha can also be written by hand; the base===HEAD
      // case is still caught by the consumers), it is the field's contract.
      if (RE_40HEX.test(sha)) {
        try {
          execFileSync('git', ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { stdio: 'ignore' })
          return sha
        } catch { /* the commit is not in this repo (pruned / corrupt seed): to the fallback */ }
      }
    }
    if (base) return base
  } catch { /* no SLICE.md: worktree of the previous scheme, or a cwd that is not the worktree */ }
  for (const ref of ['origin/HEAD', 'origin/main', 'main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore' })
      return ref
    } catch { /* next */ }
  }
  return ''
}

// ============================================================================
// Branch reconciliation, task 2 — THE MEASURE is not THE CUT.
//
// `sliceBaseRef()` above answers TWO questions that stopped being the same
// one: what to measure what the branch introduces against, and what commit
// the plan's citations were written against (the real cut — `readFileAtBase()`
// below still receives THAT one, it is not touched). As long as the slice's
// branch merges nothing, cut and measure coincide. The moment it merges its
// advanced base (the case this task comes to fix), the cut stays pinned at a
// point before that merge: diffing against it counts as "from the branch"
// every file the merge brought in and the slice never wrote.
//
// `git merge-base HEAD origin/<branch>` does isolate that: it is the commit
// where the slice's history diverged from the base, AFTER any merge the
// branch has made of it. `SliceBase` (scripts/slice-base.js, Task 1) does
// that computation with the remote branch's name — not with the seeded
// `base_sha:`/`base:`, which may be a sha of the cut —, and falls back to the
// cut if there is no remote branch to combine with `origin/` or if the
// merge-base does not resolve. It never leaves anything "unmeasured": the
// worst case is measuring the way it is measured today.
//
// WHICH remote branch it is, and what to do when the seed does not name it,
// is decided by `BaseBranch` (scripts/slice-base.js) and not by this file:
// `ct-step.mjs` asks itself the same question in order to exclude from its
// count what the merge brought in, and the fallback chain lived written twice
// answering differently (here origin/HEAD → origin/main → origin/master;
// there only `base:`). The resolver returns a branch NAME ('main'), not a ref
// ('origin/main'): whoever consumes it prepends `origin/` (that would give
// `origin/origin/HEAD`).
//
// What is NOT unified is the PARSING of the `base:` field — this file uses its
// own regex and `ct-step.mjs` uses `parseStateSafe`: earlier debt and outside
// the scope of this fix.
function nombreDeLaRamaBase() {
  let declarada = null
  try {
    declarada = campoBaseDeLaSemilla()
  } catch { /* no SLICE.md: no declared name, on to the fallback chain */ }
  const resolutor = new BaseBranch({ remoteRefExists: (nombre) => refResuelve(`refs/remotes/origin/${nombre}`) })
  return resolutor.resolve({ declared: declarada })
}

const gitParaSliceBase = (argv) => {
  try {
    return execFileSync('git', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

function referenciaDeMedida(cut) {
  const rama = nombreDeLaRamaBase()
  if (!rama) return cut
  const sliceBase = new SliceBase({ git: gitParaSliceBase })
  return sliceBase.measurementRef({ baseBranch: rama, fallbackRef: cut })
}
// ============================================================================

// F22, fix round 1 (Important + escalated Minor) — THREE ways for this
// function to report "clean" without having really checked anything:
//
//   (a) `diff.relative=true` in the caller's git config, combined with a cwd
//       in a subdirectory: a plain `git diff --name-only` omits the paths
//       OUTSIDE the cwd's subtree, so the `includes(p)` below would never
//       find `.agent/STATE.md` even if it is in the real diff.
//       `--no-relative` disables that explicitly regardless of the caller's
//       config.
//   (b) rename detection enabled (`git diff`'s default, with a similarity
//       heuristic): a branch that RENAMES `.agent/STATE.md` to something else
//       prints only the destination — the deletion of the origin stays hidden
//       inside the rename pair, and `includes('.agent/STATE.md')` does not
//       see it. `--no-renames` forces the deletion and the creation to come
//       out as two independent lines, one of them the exact path being looked
//       for.
//   (c) a `base:` in the seed EQUAL to HEAD. `SLICE.md` is not tracked and it
//       is written by the slice's own agent — it is agent-reachable. With
//       `base === HEAD`, `git diff base...HEAD` is ALWAYS empty by
//       construction: it is not that the branch is clean, it is that nothing
//       was compared. Treating that as "clean" would let an agent (on purpose
//       or through a bug) neutralise the gate by rewriting its own `base:` to
//       the commit where it already committed the contamination. It is
//       treated the same as "the base could not be determined": known:false,
//       never known:true with empty hits.
function stateFilesIntroducedByBranch() {
  const cut = sliceBaseRef()
  if (!cut) {
    return { known: false, why: 'no se pudo determinar la base de esta rama (ni `base_sha:`/`base:` en la semilla, ni origin/HEAD, ni main, ni master)' }
  }
  const measurementRef = referenciaDeMedida(cut)
  let measurementSha, headSha
  try {
    measurementSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${measurementRef}^{commit}`], { encoding: 'utf8' }).trim()
    headSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { encoding: 'utf8' }).trim()
  } catch (e) {
    return { known: false, why: `no se pudo resolver \`${measurementRef}\` o HEAD a un commit: ${e.message}` }
  }
  if (measurementSha === headSha) {
    return { known: false, why: `la referencia de medida (\`${measurementRef}\`) es EL MISMO commit que HEAD (${headSha.slice(0, 12)}) — un diff contra sí mismo sale vacío por construcción, así que eso no es "limpia", es "no comparada"` }
  }
  let out = ''
  try {
    out = execFileSync('git', ['diff', '--no-relative', '--no-renames', '--name-only', `${measurementRef}...HEAD`], { encoding: 'utf8' })
  } catch (e) {
    return { known: false, why: `\`git diff ${measurementRef}...HEAD\` falló: ${e.message}` }
  }
  const touched = out.split('\n').map((l) => l.trim()).filter(Boolean)
  return { known: true, measurementRef, hits: NEVER_IN_A_SLICE_PR.filter((p) => touched.includes(p)) }
}

// F-jjponz-1 — THE SLICE'S PLAN IS A DELIVERABLE, NOT A HABIT.
//
// The kickoff has asked for the plan since F32, but a kickoff is a prompt,
// not a gate (the LIMIT above says so for the whole of --release). As of this
// round the plan has a contract (plan-contract.js) and the release checks it
// with the same doctrine as the state-file check: IT REFUSES, it does not
// warn. Same base git diff (and the same three traps: --no-relative,
// --no-renames, base === HEAD) as stateFilesIntroducedByBranch — but without
// the NEVER_IN_A_SLICE_PR filter, because here we are looking for what the
// branch CONTRIBUTES.
function branchIntroducedFiles() {
  const cut = sliceBaseRef()
  if (!cut) {
    return { known: false, why: 'no se pudo determinar la base de esta rama (ni `base_sha:`/`base:` en la semilla, ni origin/HEAD, ni main, ni master)' }
  }
  let cutSha, headSha
  try {
    cutSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${cut}^{commit}`], { encoding: 'utf8' }).trim()
    headSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { encoding: 'utf8' }).trim()
  } catch (e) {
    return { known: false, why: `no se pudo resolver \`${cut}\` o HEAD a un commit: ${e.message}` }
  }
  // `measurementRef` is where what the branch contributes is MEASURED (Task 2
  // of the branch reconciliation); `cutSha` is where the plan's citations are
  // READ (F-jjponz-3, readFileAtBase below) and it does NOT change: the plan
  // was written against the cut, not against the merge-base. Returning a
  // single `base` for both uses is precisely the defect that reintroduces the
  // false positive `base_sha:` came to fix — hence they are returned
  // separately.
  const measurementRef = referenciaDeMedida(cut)
  let measurementSha
  try {
    measurementSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${measurementRef}^{commit}`], { encoding: 'utf8' }).trim()
  } catch (e) {
    return { known: false, why: `no se pudo resolver \`${measurementRef}\` a un commit: ${e.message}` }
  }
  if (measurementSha === headSha) {
    return { known: false, why: `la referencia de medida (\`${measurementRef}\`) es EL MISMO commit que HEAD (${headSha.slice(0, 12)}) — un diff contra sí mismo sale vacío por construcción` }
  }
  let out = ''
  try {
    out = execFileSync('git', ['diff', '--no-relative', '--no-renames', '--name-only', `${measurementRef}...HEAD`], { encoding: 'utf8' })
  } catch (e) {
    return { known: false, why: `\`git diff ${measurementRef}...HEAD\` falló: ${e.message}` }
  }
  return { known: true, measurementRef, cut: cutSha, files: out.split('\n').map((l) => l.trim()).filter(Boolean) }
}

const readRepoFile = (p) => readFileSync(p, 'utf8')

// F-jjponz-3 — reader of the files CITED by the plan in --release: the
// branch's base, not the tree. `git show <sha>:<path>` resolves the path from
// the repo's root (unlike readFileSync, which resolves it from the cwd), so
// as a bonus this does not depend on the directory it is invoked from. If the
// file is not in the base, it THROWS: the validator turns that into a
// violation that says where it looked, instead of asserting "cited from
// memory" — a file the slice creates is cited with "Current state: does not
// exist.", and confusing the two cases sends you looking for the error where
// it is not. Explicit maxBuffer because execFileSync's default (1 MiB) would
// make the read of a large cited file fail, and that would be read as an
// invalid plan when what is happening is that it could not be checked.
const readFileAtBase = (base) => (p) => {
  try {
    return execFileSync('git', ['show', `${base}:${p}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch {
    throw new Error(`no existe en la base de la rama (${String(base).slice(0, 12)})`)
  }
}

if (checkPlan) {
  // Read-only mode: candidates = the working tree, committed or not — it is
  // the mode for BEFORE committing. It does not touch GitHub, it does not
  // look at labels.
  let candidates = []
  try {
    candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'docs/superpowers/plans'], { encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean)
  } catch (e) {
    dieErr(`--check-plan: no se pudo listar docs/superpowers/plans (${e.message}). Corre esto desde la raíz del worktree del slice.`, 6)
  }
  const result = checkPlans({ issue, candidates, readFile: readRepoFile })
  if (!result.ok) dieErr(`--check-plan: ${result.message}`, result.code)
  dieOut(result.message, 0)
}

// ============================================================================
// THE MERGE WATCHER — so that the harvest does not wait for a message to be
// run.
//
// Gate 3 of the loop is human (closing the gates and merging) and until this
// round merging produced NO mechanical signal at all. The PR was merged, the
// issue was closed, and `.worktrees/<n>` + `feat/<n>` stayed on disk with
// their `claude` alive —thirteen hours in the case that gave rise to F20—
// until the very person who had merged went over to the coordinator's window
// to tell it. The event existed in GitHub; what triggered the harvest was
// someone running a message.
//
// IT IS LAUNCHED HERE, AND NOT IN `/ct-next`, because this is the EXACT
// instant at which there is an open PR waiting for a human merge. Launching
// it at dispatch —next to the `-OK` watcher, which is where it was first
// considered— would put a process asking after a PR that does not yet exist
// for the whole of the implementation.
//
// IT IS LAUNCHED DETACHED (`detached` + `unref`) because it has to survive
// this invocation finishing, and the slice's session being closed: the case
// that motivates all of this is a PR that gets merged hours or days after
// being opened.
//
// IT DOES NOT BREAK THE RELEASE, and this is the rule, not a courtesy: it
// comes AFTER the issue is already at `status:in-review`, and any failure
// here is WARNED about and carries on. The work is already delivered; not
// being able to watch the merge means going back to the earlier mode —warning
// by hand—, not losing the delivery. It is the same criterion as ct-step's
// `git add` of the telemetry: the thermometer is not part of the engine. That
// is why there is also an `error` handler: an ASYNCHRONOUS `spawn` failure
// (EAGAIN, EMFILE) is not seen by the `try/catch`, and with no handler it
// would be an unattended `'error'` that would take this script down —
// turning a CONSUMMATED release into an exit other than 0, that is, into the
// worst possible lie in this file.
//
// THE COORDINATOR'S CWD COMES OUT OF `localSliceArtifacts`, not out of
// `process.cwd()`. This script is invoked from inside the slice's worktree, so
// the cwd is `.worktrees/<n>`; the coordinator lives in the MAIN checkout,
// which is what that function already knows how to get out of `git worktree
// list --porcelain`. If it could not be looked up, a path is NOT invented: it
// warns and launches nothing. A watcher pointing at the wrong directory would
// never find anyone to deliver the warning to, and would announce itself as
// launched on top of that.
//
// CT_WATCH_MERGE_BIN follows the pattern of CT_WATCH_GO_BIN: it changes NO
// decision, only which program is launched. It exists so that the tests can
// check that the watcher is launched with the right arguments without putting
// a real process to poll GitHub for 48 hours.
// ============================================================================
function lanzarVigilanteDelMerge(n) {
  const aviso = (por) => errLine(`aviso: no se ha lanzado el vigilante del merge de #${n} (${por}) — el slice está entregado y el issue está en status:in-review, pero cuando mergees su PR tendrás que recoger la cosecha a mano (o avisar a la coordinadora).`)
  try {
    const disco = localSliceArtifacts(n)
    if (!disco.known) return aviso('no se ha podido averiguar cuál es el checkout principal, así que no se sabe dónde buscar la sesión coordinadora')
    const bin = process.env.CT_WATCH_MERGE_BIN || ctWatchMergePath
    // `spawn(process.execPath, [bin, …])` with a `bin` that does not exist
    // does NOT fail: the executable is always `node`, so the process is born,
    // dies instantly with a module error, and without this check it would
    // announce "watcher launched" with a pid that no longer exists. Same
    // guard, and same reason, as in ct-next.mjs#lanzarVigilanteDelGo.
    if (!existsSync(bin)) return aviso(`el programa del vigilante no existe: ${bin}`)
    const logPath = join(controlTowerLogDir({ configDir: process.env.CLAUDE_CONFIG_DIR || null, home: homedir() }), `watch-merge-${n}.log`)
    const hijo = spawn(process.execPath, [
      bin, '--issue', String(n), '--repo', repo, '--coordinator-cwd', disco.mainRoot, '--log', logPath,
    ], { detached: true, stdio: 'ignore' })
    hijo.on('error', (e) => aviso(`fallo al arrancarlo: ${e.message}`))
    hijo.unref()
    outLine(`vigilante del merge de #${n} lanzado (pid ${hijo.pid}) — cuando mergees el PR, la coordinadora se enterará sola. Log: ${logPath}`)
  } catch (e) {
    aviso(e.message)
  }
}

if (release) {
  const check = stateFilesIntroducedByBranch()
  if (!check.known) {
    dieErr(`no se puede liberar #${issue}: ${check.why}, así que NO se ha podido comprobar si esta rama introduce un fichero de estado (${NEVER_IN_A_SLICE_PR.join(' o ')}). No se afirma que esté limpia — un fichero de estado en el PR deja main con el estado de un slice tras el squash. Comprueba a mano con \`git diff --name-only <base>...HEAD\` y, si está limpio, vuelve a intentarlo desde un cwd donde la base se resuelva.`, 5)
  }
  if (check.hits.length) {
    const lista = check.hits.join(', ')
    // `pathspec` is kept SEPARATE from `lista` on purpose: the prose
    // enumerates with commas, but a `git checkout <base> -- a.md, b.md` puts
    // the comma INSIDE the pathspec and fails ("did not match any file"). The
    // command that is emitted has to be pasteable as-is, and with both files
    // at once is exactly when that is needed most.
    const pathspec = check.hits.join(' ')
    dieErr(`no se libera #${issue}: esta rama INTRODUCE ${lista} respecto a ${check.measurementRef}. Ese fichero es el estado de la sesión coordinadora, no producto de este slice: al mergear con squash, main se quedaría con el estado de este slice y cualquier sesión nueva del repo se hidrataría creyendo que es este agente. Restáuralo y vuelve a intentarlo: \`git checkout ${check.measurementRef} -- ${pathspec}\` y commitea (o \`git rm --cached\` si lo añadiste nuevo). El issue sigue en status:in-progress: no se ha movido nada.`, 5)
  }
  // F-jjponz-1 — the plan, AFTER the state-file check on purpose: the
  // contamination of main (exit 5) is the costliest breakage and its message
  // must win. A missing plan (exit 6) only delays THIS slice.
  const plan = branchIntroducedFiles()
  if (!plan.known) {
    dieErr(`no se puede liberar #${issue}: ${plan.why}, así que NO se ha podido comprobar si la rama trae el plan prescriptivo del slice. No se afirma que falte — comprueba a mano con \`git diff --name-only <base>...HEAD | grep docs/superpowers/plans\` y reintenta desde un cwd donde la base se resuelva.`, 6)
  }
  const planCheck = checkPlans({
    issue,
    candidates: plan.files,
    readFile: readRepoFile,
    readCitedFile: readFileAtBase(plan.cut),
  })
  if (!planCheck.ok) {
    dieErr(`no se libera #${issue}: ${planCheck.message} El issue sigue en status:in-progress: no se ha movido nada.`, planCheck.code)
  }
  // The run's gate (exit 7), AFTER the plan (exit 6) on purpose: with no
  // valid plan no run could have existed, so its message must win. The
  // kickoff orders the implementation to be driven with ct-step, but a prompt
  // is not a gate: this one is. `deliveredRun` (run-machine.js) reads what
  // ct-step persisted on closing cleanly; the file is local to the worktree
  // (gitignored by ct-init), just as the claim lives in labels — it is
  // checked where it is.
  const runRaw = (() => { try { return readFileSync(join('.agent', `run-${issue}.json`), 'utf8') } catch { return null } })()
  const runGate = deliveredRun(runRaw, issue)
  if (!runGate.ok) {
    dieErr(`no se libera #${issue}: ${runGate.why} El issue sigue en status:in-progress: no se ha movido nada.`, 7)
  }
  // F-e2e — THE CORRESPONDENCE. ct-step's machine already prevents delivering
  // a run without passing the e2e (run-machine.js), so this does NOT verify
  // the journey again: it verifies that the delivered run speaks of the
  // SAME runs the issue declares.
  //
  // It exists because the run reads its runs from `.agent/SLICE.md`, which is
  // agent-reachable — this very file already distrusts its `base:` for that
  // reason. An agent that emptied that field would have a "delivered" run
  // without having traversed anything, and the gate of the 7 would let it
  // through. Here it is cross-checked against the ISSUE, which is the source
  // the agent does not control.
  //
  // And the `## E2E` SECTION is what is read (E2E_HEADING/extractE2eRuns,
  // TASK 9, gh-issue-map.js — the SAME function /ct-next uses to seed the
  // worktree: a single parse, so that an exit 8 is never due to a reading
  // discrepancy between the two sides), not the `gate:e2e` label: the two can
  // disagree if someone edits the issue by hand, and the section rules
  // because it is the only one that says WHAT to traverse. A label with no
  // section does not describe work (it is released, with a warning); a
  // section with no label does (it is demanded all the same).
  // No `&& !fx` here: the `CT_CLAIM_FIXTURE` fixture models the shape of the
  // claim (candLabels/openIssues/readback), not the issue's body — there is
  // no fixture datum to cross-check, so this read always goes to the real
  // `gh`. Deliberate, not an oversight: do not "fix" it by adding `fx`
  // without widening the fixture's shape first.
  const bodyRaw = (() => {
    try {
      return gh(['issue', 'view', String(issue), '--repo', repo, '--json', 'body', '-q', '.body'])
    } catch {
      return null
    }
  })()
  if (bodyRaw === null) {
    // "it could not be checked" — NEVER "there are no runs". This repo does
    // not declare clean what it could not look at (the same doctrine as the
    // exits 5/6 above): an issue with real runs whose body could not be read
    // is not indistinguishable from one with none.
    dieErr(`no se libera #${issue}: no se ha podido leer el cuerpo del issue (\`gh issue view --json body\` falló) — no se afirma que no declare recorridos, solo que no se ha podido comprobar. Reintenta cuando \`gh\` responda; el issue sigue en status:in-progress: no se ha movido nada.`, 8)
  }
  const recorridos = extractE2eRuns(bodyRaw)
  // `deliveredRun` returns {ok, why}, not the parsed run — it is re-read
  // here, in a way that cannot THROW on a corrupt file: an invalid JSON is
  // treated as "zero declared runs" (failing towards exit 8, not towards a
  // crash: a gate that blows up is not a gate).
  let run = null
  try { run = JSON.parse(runRaw) } catch { run = null }
  if (recorridos.length) {
    const declarados = new Set(Array.isArray(run?.e2eRuns) ? run.e2eRuns : [])
    const faltan = recorridos.filter((r) => !declarados.has(r))
    if (faltan.length) {
      dieErr(`no se libera #${issue}: el issue declara en "${E2E_HEADING}" ${recorridos.length} recorrido(s), y el run entregado NO cubre ${faltan.length} de ellos: ${faltan.map((r) => `"${r}"`).join(', ')}. El run lee sus recorridos de .agent/SLICE.md, que es agent-reachable — esta puerta cruza contra el ISSUE, que el agente no controla. Completa esos recorridos con ct-step (paso "e2e") y reintenta. El issue sigue en status:in-progress: no se ha movido nada.`, 8)
    }
  } else {
    // Section absent or empty: the label is the only signal left to decide
    // whether to warn. If it cannot be read (gh down), no warning is issued —
    // the warning is a courtesy, not a gate, so it is not worth blocking NOR
    // failing noisily over it.
    let labels = []
    try { labels = labelsOf(issue) } catch { labels = [] }
    if (labels.includes('gate:e2e')) {
      errLine(`aviso: #${issue} lleva la label gate:e2e pero su cuerpo no declara ninguna sección "${E2E_HEADING}" — no hay recorridos que verificar, así que se libera igual, pero conviene revisar si la sección se perdió al editar el issue a mano.`)
    }
  }
  // ==========================================================================
  // F38 — THE GO GATE: THE `plan` GATE DOES NOT CLOSE BY ITSELF.
  //
  // THE DEFECT IT CLOSES. Since #32, answering `-OK` on the issue starts the
  // session: it gave mechanical consequence to a GitHub comment. And the
  // agent has `gh`. Its own limit said so (commands/ct-next.md): "it does not
  // stop the agent itself from writing `-OK` on its own issue". With the
  // `plan` gate implied by default on EVERY slice (gates.js#gatesForType),
  // the result was a gate the gated party could open, leaving on top of that
  // the RECORD of a human review that never happened. Both halves are closed
  // here: the go carries a nonce the agent cannot guess (go-response.js), and
  // it IS A REQUIREMENT to release — before it was not a requirement for
  // anything: an agent could ignore the whole gate and deliver anyway,
  // because the kickoff that orders it to stop is a prompt and not a gate.
  //
  // WHY THIS GATE GOES LAST, and not next to the plan's one (exit 6). The
  // order of this ladder is "which message must win", and a missing go means
  // different things depending on the rest: with the run half done, asking
  // after the go is noise about a slice that has not finished yet; with
  // EVERYTHING green —the plan valid, the tasks committed, the Global green,
  // the e2e covered— a missing go is no longer a "not yet", it is a whole
  // body of work done without permission. That is when this message has to
  // win, and that is where it is.
  //
  // AND IT GOES BEFORE THE WARNING ABOUT THE *UNVERIFIED* ONES for the same
  // reason that warning goes before mutating: if the release is not going to
  // happen, it is noise about a decision already taken.
  //
  // THE THREE WAYS OF NOT BEING ABLE TO ASSERT IT, and none of them releases:
  // with no registered commitment, with the register unreadable, or without
  // being able to read the comments. It is the doctrine of the exits 5/6/8
  // above: this file does not declare clean what it has not been able to look
  // at. The `!plan` waiver on the row DOES release, because then there is no
  // gate to close — and it is read from the labels, which is where the waiver
  // survives the kickoff.
  // ==========================================================================
  const ctHome = { configDir: process.env.CLAUDE_CONFIG_DIR || null, home: homedir() }
  const registro = readGoCommitment({ repo, issue, ...ctHome })
  if (registro.error) {
    dieErr(`no se libera #${issue}: el go de este despacho está registrado en ${registro.path} y NO se ha podido leer (${registro.error}). No se afirma que falte el go, sólo que no se ha podido comprobar. Arréglalo (permisos, o el contenido del fichero) o reemite uno con \`node <plugin>/scripts/ct-go.mjs --issue ${issue} --repo ${repo}\`. El issue sigue en status:in-progress: no se ha movido nada.`, 9)
  }
  if (registro.missing) {
    // With no register, the only way to know whether this slice WAS SUPPOSED
    // to have a `plan` gate is its labels. A read failure here does not
    // release: it would be the same assertion without having looked.
    let labels = null
    try { labels = labelsOf(issue) } catch (e) {
      dieErr(`no se libera #${issue}: el go de este despacho no está registrado (${registro.path} no existe) y tampoco se han podido leer las labels del issue (${e.message}) para saber si este slice lleva el gate \`plan\`. No se afirma que no lo lleve. Reintenta cuando \`gh\` responda. El issue sigue en status:in-progress: no se ha movido nada.`, 9)
    }
    // `gatesFromLabels` returns {gates, declared}: `declared` tells "this
    // issue says it has no `plan` gate" apart from "this issue says nothing
    // about its gates" (it predates gates existing, or it was made by hand).
    // Only the FIRST releases. The second is not a waiver, it is a silence,
    // and a silence does not close a gate — besides being the path an agent
    // would open by deleting its own labels. It is fixed with one command and
    // breaks nothing in flight.
    const declaracion = gatesFromLabels(labels)
    if (!declaracion.declared || declaracion.gates.includes('plan')) {
      const porque = declaracion.declared
        ? 'este slice lleva el gate `plan`'
        : 'las labels de este issue no declaran NINGÚN gate (ni `gate:none`), así que no se puede afirmar que renuncie al `plan` —silencio no es renuncia—'
      dieErr(`no se libera #${issue}: ${porque} y el go de este despacho NO ESTÁ REGISTRADO (${registro.path} no existe), así que no hay nada contra lo que comprobar el \`${GO_TOKEN}\` del issue. Pasa cuando el slice se despachó con una versión anterior a la que trajo el nonce, o cuando ese fichero se borró. Reemite el go con \`node <plugin>/scripts/ct-go.mjs --issue ${issue} --repo ${repo}\`, pide que lo contesten en el issue y vuelve a liberar. El issue sigue en status:in-progress: no se ha movido nada.`, 9)
    }
  } else {
    // THE SAME READ AS THE WATCHER (a plain `--json comments`, with
    // `.comments` parsed here), not a different `-q`: two ways of asking for
    // the same thing are two ways for one of them to return something else
    // one day. It is the reason the e2e gate reuses `extractE2eRuns` instead
    // of re-parsing.
    let comentarios = null
    try {
      const parsed = JSON.parse(gh(['issue', 'view', String(issue), '--repo', repo, '--json', 'comments']))
      comentarios = Array.isArray(parsed?.comments) ? parsed.comments : null
    } catch {
      comentarios = null
    }
    if (!Array.isArray(comentarios)) {
      dieErr(`no se libera #${issue}: no se han podido leer los comentarios del issue (\`gh issue view --json comments\`), así que no se ha podido comprobar el go del gate \`plan\` — no se afirma que falte. Reintenta cuando \`gh\` responda. El issue sigue en status:in-progress: no se ha movido nada.`, 9)
    }
    // NO WINDOW on purpose, unlike the watcher: here any comment on the issue
    // counts, because the nonce already does the work the snapshot of ids did
    // there — a go from an earlier dispatch has a different nonce and does not
    // match by construction.
    const go = comentarios.find((c) => matchesGo(c?.body, registro.commitment))
    if (!go) {
      dieErr(`no se libera #${issue}: el gate \`plan\` no está cerrado — ningún comentario de este issue trae el go de este despacho. Lo cierra una persona contestando \`${GO_TOKEN} <nonce>\` con el nonce que /ct-next imprimió al despachar (no está en tu contexto, ni en el issue, ni en tu worktree: es de quien revisa el plan, a propósito). Si se ha perdido, quien despachó lo reemite con \`node <plugin>/scripts/ct-go.mjs --issue ${issue} --repo ${repo}\`. El issue sigue en status:in-progress: no se ha movido nada.`, 9)
    }
    // WHO gave it, via stderr: the record of who authorised is worth more
    // printed than stored, and it is the only signal that would give away a
    // go granted by the very identity the agent runs as.
    errLine(`gate \`plan\` cerrado: go de este despacho dado por ${go?.author?.login ? `@${go.author.login}` : 'un autor que gh no ha devuelto'}${go?.createdAt ? ` el ${go.createdAt}` : ''}.`)
  }

  // THE *UNVERIFIED* ONES, SAID OUT LOUD. It is the state that releases a
  // slice WITHOUT having checked it —a docker that does not start, an expired
  // credential, the AGENTS.md section left unfilled—, and it delivers on
  // purpose: holding it back would leave the slice at status:in-progress
  // occupying `area:`/`touches:` and a `--cap` slot with nobody working on
  // it, the failure mode F13 and F18 removed. What cannot be is that it is
  // also SILENT: three texts of this branch (run-machine.js#trasElE2e,
  // gates.js#GATES.e2e.issue and §3.7 of the design) promise that --release
  // "says so", and until the final branch review nobody said it — the run
  // only persisted the NAMES of the runs, so this gate did not tell a green
  // slice apart from one with every one of its runs unverified. `ct-step` now
  // persists the verdict of each one (`e2eResults`), and here they are read.
  //
  // It goes AFTER the correspondence gate and BEFORE mutating: if the release
  // is not going to happen, this warning would be noise about a decision
  // already taken. It is read from the run (not from the issue) because the
  // verdict belongs to the run: the issue says nothing about how the
  // journey went. And it gates nothing — it is a diagnostic via stderr, the
  // usual doctrine: stdout is the product, stderr the why.
  const sinVerificar = (Array.isArray(run?.e2eResults) ? run.e2eResults : []).filter((r) => r && r.verdict === 'no-verificado')
  if (sinVerificar.length) {
    const detalle = sinVerificar.map((r) => `"${r.run}" (${r.reason || 'sin motivo declarado en el informe'})`).join('; ')
    errLine(`aviso: #${issue} se libera con ${sinVerificar.length} recorrido(s) que NO se pudieron comprobar: ${detalle}. Un "no-verificado" entrega a propósito (retener el slice por un entorno caído lo dejaría ocupando area:/touches: y una plaza de --cap sin nadie trabajando), pero libera SIN haber verificado eso: léelo antes de mergear. Si el motivo es del entorno, el arreglo va en la sección "## Cómo se atraviesa este repo (e2e)" de AGENTS.md, no en relajar la puerta. El informe completo está en docs/superpowers/e2e/${issue}.md.`)
  }
  if (!dryRun && !fx) {
    const result = setStatus(issue, 'status:in-progress', 'status:in-review')
    if (!result.ok) {
      // --release never goes through classifyClaimOutcome in ct-next.mjs (it
      // is a later step, invoked by the agent itself on finishing the slice,
      // not by the claim loop) — its exit 1 falls outside the widened
      // contract above, unchanged.
      dieErr(`no se pudo liberar #${issue} a in-review: ${result.error.message}. Sigue en status:in-progress; reintenta el --release.`, 1)
    }
    // INSIDE the `!dryRun && !fx`, and that is the decision: with `--dry-run`
    // nothing has been moved, so there is no PR whose merge to wait for, and
    // launching the watcher there would turn a dry run into a 48-hour
    // process. With `fx` (CT_CLAIM_FIXTURE) neither: the fixture models the
    // shape of the claim, not a real repo where there is anything to harvest.
    //
    // And with `--no-watch-merge` neither, but for a reason different from
    // the previous two and one that has to be said out loud: there there IS a
    // PR waiting for a human merge. What there is not is anyone to warn (see
    // the flag's header), so the warning is waived on purpose instead of
    // being delivered to someone who cannot read it.
    if (noWatchMerge) {
      errLine(`aviso: no se ha lanzado el vigilante del merge de #${issue} porque se pidió --no-watch-merge — el slice está entregado y el issue está en status:in-review, pero nadie te avisará cuando mergees su PR: la cosecha la seguirá detectando \`/ct-next\` en su próxima corrida.`)
    } else {
      lanzarVigilanteDelMerge(issue)
    }
  }
  dieOut(`released #${issue} → in-review`, 0)
}

// ============================================================================
// F15/H1 — `--reopen` REOPENED THE WINDOW F13 CLOSED.
//
// F13 separated two accountings that lived in a single label: the CAP
// measures live agents (`in-progress`), the TOKENS measure UNMERGED work
// (`in-progress` + `in-review`). And in the same round it added `--reopen` so
// that a rejected PR could come back into the loop… by sending it to
// `status:ready`.
//
// `ready` does NOT hold tokens. But the rejected slice's unmerged work still
// exists in its branch and in its PR: while someone corrects on top of it, a
// neighbour sharing `area:`/`touches:` could be dispatched branching off a
// `main` that does not contain it — exactly the window F13 came to close,
// reopened by its own return edge. Reproduced by construction with
// `planDispatch` before touching anything: with #7 at `in-review` and
// `area:plan`, candidate #8 that shares that area is skipped and #9 comes
// out; with that same #7 at `ready`, `runningTouches` comes out EMPTY and the
// protection disappears.
//
// THE ROOT: `ready` meant two incompatible things. "It was never started —
// there is nothing on any branch" and "it was started, it was rejected, there
// is unmerged work and it is being redone on top". The first must block
// nobody; the second has to block its neighbours. A single label cannot be
// both.
//
// THE SOLUTION: `--reopen` stops going to `ready`. It goes to
// `status:in-progress`, which is the EXACT INVERSE of `--release`. It is not
// a hack to hold tokens: it is that `in-progress` describes the truth of that
// slice after a rejection, in BOTH accountings at once and without touching a
// single line of dispatch.js:
//   - TOKENS: there is unmerged work in `feat/<n>`. It must hold them. It
//     does.
//   - CAP: there is someone working on it (correcting on top is the normal
//     path after a rejection, and it is what the message below itself
//     recommends). Occupying a concurrency slot is correct, not a side
//     effect.
//   - STALE CLAIM: `stalenessNote` flags an `in-progress` with no worktree,
//     no branch and no session. After a `--reopen` the worktree and the
//     branch are STILL THERE (reopening does not touch the disk), so no false
//     alarm goes off.
//
// WHY NOT THE OTHER TWO ROUTES:
//   - "let `ready` hold tokens": it breaks the normal case — a slice that was
//     never started would go on to block all its area neighbours forever.
//   - "a new state, `status:rejected`": F13's argument still stands (it has
//     to be taught to everything that reads labels), and here it is also
//     superfluous: the state that was needed already existed and is called
//     `in-progress`.
// And it does NOT reintroduce what F13 discarded deliberately (holding the
// claim from the PR until the merge): there the slice spent days at
// `in-progress` with NOBODY working on it, freezing a slot and setting off a
// false orphan-claim alarm on every PR under review. Here the `in-progress`
// is set at the exact moment someone gets back to work on it, and not
// earlier.
//
// WHAT THIS NARROWS, SAID OUT LOUD. Before, `--reopen` left the slice
// dispatchable by `/ct-next`. Not any more: it comes out of the command
// already claimed. That is deliberate (it was dispatchable in name only —
// `/ct-next` refused all the same, because the worktree and the branch
// existed), but it orphans the other path, "start from scratch", which did
// need `ready`. That path now has its own checked edge: `--requeue` (below),
// which demands that nothing of the slice be left on this machine before
// declaring it ready to go back into the queue. The alternative was to leave
// that case in the hands of a hand-written `gh issue edit`, which is exactly
// what `--reopen` exists to avoid having to do.
// ============================================================================

// ============================================================================
// --reopen (F13/H1) — `status:in-review` WAS A TERMINAL STATE.
//
// THE HOLE. `--release` moved `in-progress → in-review` and there was NO
// transition back to `status:ready`. The only paths that returned an issue to
// `ready` were the reverts (lost race, readback failure, interruption) — all
// of them for PROTOCOL FAILURES, none of them for a rejected review. And
// `/ct-next` only dispatches `ready`. Consequence: if you reject a PR at the
// gate, that slice leaves the loop FOREVER, and with it everything that
// depends on it. The case is not exotic: in a typical epic, the slice most
// likely to be rejected at the visual gate tends to be precisely one that
// several others hang off.
//
// WHY AN EXPLICIT TRANSITION AND NOT A NEW STATE ('status:rejected'). A new
// state forces it to be taught to EVERYTHING that reads labels (resolveStatus
// and its precedence, computeReadyCandidates, the collision detection,
// ct-groom, the §9 contract…) and multiplies the combinations that have to be
// reasoned about, in exchange for information the issue itself already keeps
// better than a label: the review thread says why it was rejected. What was
// missing was not a state, it was an EDGE.
//
// WHY HERE AND NOT IN /ct-next. `dispatch-check.mjs` is already the only file
// that mutates `status:` labels (see `setStatus`'s comment), and reopening is
// a HUMAN decision of the gate — just like promoting from backlog to ready.
// The dispatcher must not be able to undo a review verdict on its own.
//
// HOW REOPENING SOMETHING BY ACCIDENT IS AVOIDED (the explicit requirement):
//   1. Its own explicit flag, never invoked by any automatic path: neither
//      /ct-next nor the agent's kickoff ever run it.
//   2. PRECONDITION READ, not assumed: the issue's real state is read and
//      `status:in-review` is demanded. A bare `gh issue edit --add-label
//      ready --remove-label in-review` (what anyone would do by hand) checks
//      NOTHING: on an issue at `in-progress` it would add `ready` leaving TWO
//      status labels at once, which is precisely the ambiguous state
//      resolveStatus exists to survive. Here it is rejected.
//   3. And it is rejected while telling the cases apart: reopening something
//      that is already `ready` is not a user error to be punished, it is a
//      no-op that has to be named.
// ============================================================================

// localSliceArtifacts: what is left ON THIS MACHINE from the slice's previous
// round — the worktree `.worktrees/<n>` and the branch `feat/<n>`. It is
// looked at from the MAIN checkout, not from the cwd: this script can be
// invoked from inside the slice's own worktree (the kickoff does that), and
// there `--show-toplevel` would return the worktree instead of the checkout
// where `.worktrees/` lives. `git worktree list --porcelain` ALWAYS starts
// with the main worktree, and it is portable to old gits (unlike
// `--path-format=absolute --git-common-dir`).
//
// It returns `{ known: false }` if it could not be looked up (there is no
// git, we are not inside a repo, the command fails). "It could not be
// checked" is never translated into "there is nothing": the message below
// says explicitly which of the two things it knows.
function localSliceArtifacts(n) {
  // `cwd` instead of `-C <root>` on purpose: the argv comes out identical to
  // the one ct-next.mjs uses for the same question (`rev-parse --verify
  // --quiet refs/heads/feat/<n>`), which is what allows the two places to be
  // reasoned about as a single query — and what makes the tests' git stub
  // recognise this call without having to teach it a second shape.
  const git = (a, cwd) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000, killSignal: 'SIGKILL', ...(cwd ? { cwd } : {}) })
  let mainRoot
  try {
    const line = git(['worktree', 'list', '--porcelain']).split('\n').find((l) => l.startsWith('worktree '))
    if (!line) return { known: false }
    mainRoot = line.slice('worktree '.length).trim()
    if (!mainRoot) return { known: false }
  } catch {
    return { known: false }
  }
  const worktree = `${mainRoot}/.worktrees/${n}`
  let hasWorktree = false
  try {
    hasWorktree = statSync(worktree).isDirectory()
  } catch {
    hasWorktree = false
  }
  let hasBranch = false
  try {
    // If `mainRoot` no longer exists on disk (worktree list answered from
    // somewhere else, or the directory was deleted between the two calls),
    // spawn fails and we fall back to `false` — which is right: there is no
    // evidence of a branch.
    git(['rev-parse', '--verify', '--quiet', `refs/heads/feat/${n}`], mainRoot)
    hasBranch = true
  } catch {
    hasBranch = false
  }
  return { known: true, mainRoot, worktree, branch: `feat/${n}`, hasWorktree, hasBranch }
}

// reopenDiskNote: what to do with the worktree and the branch that already
// exist from the previous round. Reopening a slice does NOT delete them —and
// it must not: normally rejected work is corrected ON TOP of what is already
// there, not from scratch— but neither can it stay quiet about it, because
// `/ct-next` REFUSES to dispatch a slice whose worktree or branch already
// exist (a precondition, before claiming anything). Without this note,
// reopening would "work" and the next `/ct-next` would fail with a message
// that does not mention the reopening.
function reopenDiskNote(n) {
  const a = localSliceArtifacts(n)
  const requeueCmd = `node <plugin>/scripts/dispatch-check.mjs ${n} --repo ${repo} --requeue`
  if (!a.known) {
    return `No se ha podido comprobar qué queda de la vuelta anterior en esta máquina (no se pudo consultar git desde aquí) — NO lo leas como "no hay nada". Si el worktree .worktrees/${n} o la rama feat/${n} siguen existiendo, sigue trabajando ahí encima; si de verdad quieres empezar de cero, bórralos y devuélvelo a la cola con: ${requeueCmd}`
  }
  if (!a.hasWorktree && !a.hasBranch) {
    return [
      `De la vuelta anterior no queda nada en ${a.mainRoot} (ni worktree .worktrees/${n} ni rama feat/${n}), pero #${n} ha quedado en status:in-progress: retiene sus tokens de área/touches porque su PR sigue sin mergear, y ocupa una plaza de --cap.`,
      `  - Si vas a rehacerlo tú, el estado ya es el correcto: crea el worktree y sigue.`,
      `  - Si lo que quieres es que /ct-next lo despache de cero, devuélvelo a la cola con: ${requeueCmd}`,
      `  OJO: si la rama solo existe en el remoto, el trabajo anterior sigue ahí — recupéralo (o cierra su PR) antes de rehacerlo.`,
    ].join('\n')
  }
  const quedan = [a.hasWorktree ? `el worktree ${a.worktree}` : null, a.hasBranch ? `la rama ${a.branch}` : null].filter(Boolean).join(' y ')
  return [
    `De la vuelta anterior queda ${quedan} en ${a.mainRoot}. NO se ha tocado nada de eso: reabrir mueve el label, no el disco. Tienes dos caminos, y son excluyentes:`,
    `  (a) CORREGIR ENCIMA (lo normal tras un rechazo de revisión, y para lo que #${n} acaba de quedar en status:in-progress): sigue trabajando en ese mismo worktree y esa misma rama, sobre el PR que ya existe. NO invoques /ct-next para #${n}: se negaría a despachar precisamente porque el worktree/la rama ya existen. Cuando vuelvas a dejarlo listo, repite el --release.`,
    `  (b) EMPEZAR DE CERO: borra primero lo anterior (te llevas por delante el trabajo que hubiera, comprueba que está pusheado) y DESPUÉS devuélvelo a la cola, que es lo que hace que /ct-next vuelva a considerarlo:`,
    a.hasWorktree ? `      git -C ${a.mainRoot} worktree remove ${a.worktree}` : null,
    a.hasBranch ? `      git -C ${a.mainRoot} branch -D ${a.branch}` : null,
    `      ${requeueCmd}`,
  ].filter(Boolean).join('\n')
}

if (reopen) {
  // Precondition READ. In dry-run with a fixture the fixture is used; in
  // dry-run WITHOUT a fixture there is no state to read and nothing is
  // mutated, so it is admitted as a rehearsal of the message. `labelsOf` is
  // the same read the collision step uses, and its failure is classified the
  // same way: exit 3 (infrastructure, no mutation).
  let labels = null
  if (fx) {
    labels = fx.candLabels
  } else if (!dryRun) {
    try {
      labels = labelsOf(issue)
    } catch (e) {
      dieErr(`no se pudo leer el estado de #${issue} en ${repo}: ${e.message} — no se reabre nada sin haber comprobado que está en status:in-review.`, 3)
    }
  }
  // The precondition is that the status be EXACTLY `status:in-review`, not
  // that in-review be AMONG its labels. Finding while attacking this very
  // implementation: with `labels.includes(...)`, an issue dragging
  // `status:in-progress` AND `status:in-review` at once (a label edit left
  // half done — the case resolveStatus exists to survive) passed the check,
  // and the `--add-label ready --remove-label in-review` left it at
  // `[status:in-progress, status:ready]`: exactly the ambiguous state the
  // message below warns about, created by the very tool that exists so as not
  // to create it. Verified against that first version: exit 0 and "reopened
  // #9 → ready" on an issue carrying both labels.
  if (labels !== null) {
    const actuales = labels.filter((l) => l.startsWith('status:'))
    const soloInReview = actuales.length === 1 && actuales[0] === 'status:in-review'
    if (!soloInReview) {
      const enQue = actuales.length ? actuales.join(', ') : 'ninguna label status: (o sea, backlog)'
      const yaReady = actuales.length === 1 && actuales[0] === 'status:ready'
      const ambiguo = actuales.length > 1
      const yaInProgress = actuales.length === 1 && actuales[0] === 'status:in-progress'
      dieErr(
        yaReady
          ? `#${issue} ya está en status:ready — no hay nada que reabrir, /ct-next puede despacharlo tal cual. (No se ha tocado ninguna label.)`
          : ambiguo
            ? `#${issue} tiene DOS o más labels de estado a la vez (${enQue}) — probablemente una edición que se quedó a medias. No se ha tocado ninguna: reabrir desde aquí solo quitaría status:in-review y dejaría el resto puesto junto a status:in-progress, o sea el mismo lío con una label más. Arréglalo primero dejando UNA sola, y vuelve a intentarlo.`
            : yaInProgress
              ? `#${issue} ya está en status:in-progress — que es justo donde --reopen lo dejaría: en el banco de trabajo, reteniendo sus tokens. No hay nada que reabrir. (No se ha tocado ninguna label.) Si lo que querías era devolverlo a la cola para que /ct-next lo despache de cero, eso es --requeue, y exige que no quede nada del slice en esta máquina.`
              : `--reopen solo devuelve al banco de trabajo un slice en status:in-review, y #${issue} está en: ${enQue}. No se ha tocado ninguna label — añadir status:in-progress sin quitar el status: que ya tiene dejaría el issue con DOS estados a la vez, que es exactamente el estado ambiguo que el dispatcher tiene que adivinar después. Si de verdad quieres moverlo desde ${enQue}, hazlo a mano y a conciencia: gh issue edit ${issue} --repo ${repo} --add-label status:in-progress --remove-label <la que tenga>.`,
        2
      )
    }
  }
  if (!dryRun && !fx) {
    const result = setStatus(issue, 'status:in-review', 'status:in-progress')
    if (!result.ok) {
      dieErr(`no se pudo reabrir #${issue} a status:in-progress: ${result.error.message}. Sigue en status:in-review; reintenta el --reopen.`, 1)
    }
  }
  outLine(`reopened #${issue} → in-progress (rechazado en revisión: vuelve al banco de trabajo, y sigue reteniendo sus tokens de área/touches porque su trabajo sigue SIN MERGEAR)`)
  outLine(reopenDiskNote(issue))
  process.exit(0)
}

// ============================================================================
// --requeue (F15/H1) — THE OTHER HALF OF THE RETURN EDGE.
//
// `--reopen` leaves the slice at `in-progress` because its work still exists
// unmerged. The opposite path —"I abandon this attempt, let /ct-next dispatch
// it from scratch"— needs `ready`, and `ready` is only true when NO unmerged
// work of that slice is left anywhere. That cannot be assumed: it is checked.
//
// WHAT IT DEMANDS, AND WHAT IT CANNOT DEMAND (said, not hidden):
//   - status EXACTLY `status:in-progress` (the same precondition read as
//     --reopen, the same treatment for the ambiguous two-label case);
//   - that ON THIS MACHINE neither the worktree `.worktrees/<n>` nor the
//     branch `feat/<n>` be left. If they are, it refuses: returning it to the
//     queue would release its tokens while its work is still alive, and on
//     top of that /ct-next would refuse to re-dispatch it anyway over those
//     very artefacts;
//   - if IT COULD NOT BE LOOKED AT, it refuses too. That is the difference
//     between `--reopen` and this one: there the disk note is informative and
//     "I do not know" can be said; here the mutation IS a declaration of
//     absence, and what could not be looked at is not declared absent.
// What it CANNOT check, and that is why it always PRINTS it instead of
// leaving it implicit: the branch on the REMOTE and the open PR. A slice
// whose branch is still pushed and whose PR is still open has unmerged work
// even if this machine is clean; there `ready` lies again. Closing the PR is
// part of the abandonment, and the message says so with the command.
// ============================================================================
if (requeue) {
  let labels = null
  if (fx) {
    labels = fx.candLabels
  } else if (!dryRun) {
    try {
      labels = labelsOf(issue)
    } catch (e) {
      dieErr(`no se pudo leer el estado de #${issue} en ${repo}: ${e.message} — no se devuelve nada a la cola sin haber comprobado que está en status:in-progress.`, 3)
    }
  }
  if (labels !== null) {
    const actuales = labels.filter((l) => l.startsWith('status:'))
    const soloInProgress = actuales.length === 1 && actuales[0] === 'status:in-progress'
    if (!soloInProgress) {
      const enQue = actuales.length ? actuales.join(', ') : 'ninguna label status: (o sea, backlog)'
      const yaReady = actuales.length === 1 && actuales[0] === 'status:ready'
      const ambiguo = actuales.length > 1
      const enReview = actuales.length === 1 && actuales[0] === 'status:in-review'
      dieErr(
        yaReady
          ? `#${issue} ya está en status:ready — no hay nada que devolver a la cola, /ct-next puede despacharlo tal cual. (No se ha tocado ninguna label.)`
          : ambiguo
            ? `#${issue} tiene DOS o más labels de estado a la vez (${enQue}) — probablemente una edición que se quedó a medias. No se ha tocado ninguna: arréglalo primero dejando UNA sola, y vuelve a intentarlo.`
            : enReview
              ? `#${issue} está en status:in-review: su PR sigue abierto sin mergear, así que devolverlo a la cola soltaría sus tokens mientras ese trabajo sigue vivo. No se ha tocado ninguna label. Si la revisión lo rechazó y vas a corregir encima, usa --reopen; si de verdad lo abandonas, cierra antes su PR y reabre primero con --reopen.`
              : `--requeue solo devuelve a la cola un slice en status:in-progress, y #${issue} está en: ${enQue}. No se ha tocado ninguna label — añadir status:ready sin quitar el status: que ya tiene dejaría el issue con DOS estados a la vez, que es exactamente el estado ambiguo que el dispatcher tiene que adivinar después.`,
        2
      )
    }
  }
  // The disk check goes BEFORE mutating. A --requeue that releases the tokens
  // and THEN discovers the branch is still there has already opened the
  // window.
  const a = localSliceArtifacts(issue)
  if (!a.known) {
    dieErr(`no se ha podido comprobar si queda algo de #${issue} en esta máquina (no se pudo consultar git desde aquí), y --requeue DECLARA que no queda trabajo sin mergear de este slice. No se declara ausente lo que no se ha podido mirar: no se ha tocado ninguna label. Corre esto desde dentro del checkout del repo, o comprueba a mano que ni .worktrees/${issue} ni feat/${issue} existen y haz la edición tú.`, 2)
  }
  if (a.hasWorktree || a.hasBranch) {
    const quedan = [a.hasWorktree ? `el worktree ${a.worktree}` : null, a.hasBranch ? `la rama ${a.branch}` : null].filter(Boolean).join(' y ')
    dieErr([
      `#${issue} todavía tiene ${quedan} en ${a.mainRoot}: su trabajo sigue vivo sin mergear, así que devolverlo a status:ready soltaría sus tokens de área/touches y dejaría que un vecino se despachara sobre una base que no lo contiene. No se ha tocado ninguna label.`,
      `Si de verdad lo abandonas, bórralo primero (comprueba antes que no pierdes nada sin pushear) y repite:`,
      a.hasWorktree ? `      git -C ${a.mainRoot} worktree remove ${a.worktree}` : null,
      a.hasBranch ? `      git -C ${a.mainRoot} branch -D ${a.branch}` : null,
      `Si lo que quieres es seguir trabajándolo, no hace falta nada: status:in-progress ya es el estado correcto.`,
    ].filter(Boolean).join('\n'), 2)
  }
  if (!dryRun && !fx) {
    const result = setStatus(issue, 'status:in-progress', 'status:ready')
    if (!result.ok) {
      dieErr(`no se pudo devolver #${issue} a status:ready: ${result.error.message}. Sigue en status:in-progress; reintenta el --requeue.`, 1)
    }
  }
  outLine(`requeued #${issue} → ready (abandonado: suelta sus tokens y vuelve a ser despachable por /ct-next)`)
  outLine(`Comprobado que en ${a.mainRoot} no queda ni el worktree .worktrees/${issue} ni la rama feat/${issue}. Lo que NO se ha comprobado —y no se puede desde aquí— es el REMOTO: si feat/${issue} sigue pusheada o su PR sigue abierto, ese trabajo sigue sin mergear y #${issue} ya no lo está reteniendo. Cierra el PR (\`gh pr close --delete-branch\`) si de verdad lo abandonas.`)
  process.exit(0)
}

// ============================================================================
// --collect (F20/harvest) — THE ONLY SUCCESS PATH IN THIS FILE THAT DELETES
// THINGS ON DISK.
//
// Everything else that deletes a worktree in this plugin is a rollback of a
// failed dispatch (`cleanupOrphanedWorktree` in ct-next.mjs). Here it deletes
// because the slice FINISHED: its PR is merged, the tree is clean and the
// local tip is the commit that landed. Those three conditions are NOT decided
// here — they are decided by `CollectionPolicy`
// (scripts/slice-collection.js) and orchestrated by `SliceCollector`
// (scripts/slice-collector.js), which is the one that reads, decides and runs
// the three steps. This block does what an entrypoint is supposed to do and
// nothing more: wire up the real runners, project the outcome to text and to
// an exit code, and exit. No harvest rule lives in this file.
//
// The object that flows is the REAL one from `localSliceArtifacts(issue)`: if
// one day someone renames one of its keys, this stops compiling the right
// argv and the integration test says so. A `known: false` is exit 3 (it could
// not be looked at), never "there is nothing left".
// ============================================================================
if (collect) {
  const COLLECT_GIT_TIMEOUT_MS = 30_000
  const COLLECT_CMUX_TIMEOUT_MS = 10_000
  const COLLECT_BQ_TIMEOUT_MS = 120_000
  const a = localSliceArtifacts(issue)
  if (!a.known) {
    dieErr(`no se ha podido comprobar qué queda de #${issue} en esta máquina (no se pudo consultar git desde aquí): no se ha tocado nada. Corre esto desde dentro del checkout del repo.`, 3)
  }
  // An exit code other than 0 is DATA, not an exception: the three runners
  // return it in `code` so that the collector decides (and does not translate
  // a read failure into a clean tree).
  const ghRunner = (argv) => {
    try {
      return { code: 0, stdout: gh(argv), stderr: '' }
    } catch (e) {
      return { code: typeof e.status === 'number' ? e.status : 1, stdout: '', stderr: String(e.stderr || e.message || '') }
    }
  }
  const localRunner = (bin, timeoutMs) => (argv) => {
    try {
      return { code: 0, stdout: execFileSync(bin, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL' }), stderr: '' }
    } catch (e) {
      return { code: typeof e.status === 'number' ? e.status : 1, stdout: String(e.stdout || ''), stderr: String(e.stderr || e.message || '') }
    }
  }
  const collector = new SliceCollector({
    gh: ghRunner,
    git: localRunner('git', COLLECT_GIT_TIMEOUT_MS),
    cmux: localRunner('cmux', COLLECT_CMUX_TIMEOUT_MS),
    findWorkspace: (cwd) => findWorkspaceByCwd(cwd),
  })
  // F20/harvest, Task 7 (corrected): with `--bq` and the guard saying
  // HARVEST, the row travels to BigQuery BEFORE `execute()` (below) deletes
  // anything. The rehearsal is done ONCE only, above; both the decision to
  // load into BigQuery and the deletion itself reuse that same `ensayo`, so
  // `--collect --bq` only asks GitHub for the PR once per invocation.
  const espacioTemporal = {
    create: () => mkdtempSync(join(tmpdir(), 'ct-collect-bq-')),
    remove: (directory) => rmSync(directory, { recursive: true, force: true }),
  }
  const lecturaFallida = (c) => `${c.failures[0].read} falló (${c.failures[0].detail})`
  const ensayo = collector.rehearse({ artifacts: a, repo })
  let report = ensayo
  let cargada = ''
  if (!dryRun && ensayo.outcome === CollectionOutcome.WOULD_COLLECT) {
    if (bqTable) {
      const cosecha = new SliceHarvest({ gh: ghRunner }).harvestIssue({ repo, number: issue, index: TelemetryIndex.read({ gh: ghRunner, repo }) })
      if (cosecha.outcome !== SliceHarvestOutcome.COMPLETE) dieErr(`no se pudo leer la cosecha de #${issue}: ${lecturaFallida(cosecha)} — no se ha tocado nada, el siguiente barrido reintenta.`, 3)
      const ledger = new HarvestLedger({ table: bqTable, bq: localRunner('bq', COLLECT_BQ_TIMEOUT_MS), workspace: espacioTemporal, identity: LedgerIdentity.fromEnvironment() }).record({ repo, milestone: cosecha.row.milestone, rows: [cosecha.row] })
      if (ledger.outcome === LoadOutcome.REJECTED) { espacioTemporal.remove(ledger.directory); dieErr(`no se pudo cargar la fila de #${issue} en BigQuery (${bqTable.id}): bq salió con ${ledger.code}: ${ledger.detail} — no se ha borrado nada, el siguiente barrido reintenta.`, 11) }
      cargada = ` ; 1 fila cargada en ${bqTable.id} (harvest_id ${ledger.harvestId})`
    }
    report = collector.execute(ensayo)
  }
  const hechoDe = (command) => {
    if (command.action === CollectionAction.CLOSE_WORKSPACE) return 'cerrada la workspace de cmux'
    if (command.action === CollectionAction.REMOVE_WORKTREE) return `borrado el worktree ${a.worktree}`
    if (command.action === CollectionAction.DELETE_BRANCH) return `borrada la rama ${a.branch}`
    throw new Error(`--collect no sabe nombrar la acción ${command.action}`)
  }
  const esperaPor = (delivery) => {
    if (delivery.state === DeliveryState.NOT_OPENED) return `no hay ninguna PR para la rama ${a.branch}`
    if (delivery.state === DeliveryState.OPEN) return `la PR #${delivery.number} sigue abierta`
    if (delivery.state === DeliveryState.ABANDONED) return `la PR #${delivery.number} se cerró sin mergear`
    throw new Error(`--collect no sabe esperar por el estado ${delivery.state}`)
  }
  // EXHAUSTIVE projection outcome → (channel, text, exit code). A new outcome
  // with no row here throws instead of exiting with an invented code.
  const PROYECCION = {
    [CollectionOutcome.COLLECTED]: { decir: dieOut, code: 0, linea: (r) => `collected #${issue}: ${r.done.map(hechoDe).join(', ')}${cargada}` },
    [CollectionOutcome.WOULD_COLLECT]: { decir: dieOut, code: 0, linea: (r) => `would collect #${issue}: ${r.pending.map((command) => command.line).join(' ; ')}${bqTable ? ` ; y cargaría 1 fila en ${bqTable.id}` : ''}` },
    [CollectionOutcome.NOTHING_LEFT]: { decir: dieOut, code: 0, linea: () => `nothing left for #${issue}: en ${a.mainRoot} ya no queda ni el worktree .worktrees/${issue} ni la rama ${a.branch}` },
    [CollectionOutcome.WAITING]: { decir: dieOut, code: 1, linea: (r) => `waiting on #${issue} (${r.delivery.state}): ${esperaPor(r.delivery)} — no se ha tocado nada` },
    [CollectionOutcome.KEPT_DIRTY_TREE]: { decir: dieOut, code: 10, linea: () => `kept #${issue}: el worktree ${a.worktree} tiene cambios sin commitear — no se ha borrado nada` },
    [CollectionOutcome.KEPT_TIP_NOT_MERGED]: { decir: dieOut, code: 10, linea: (r) => `kept #${issue}: la punta local de ${a.branch} no es el commit que mergeó la PR #${r.delivery.number} (${r.delivery.headRefOid}) — no se ha borrado nada` },
    [CollectionOutcome.NOT_READ]: { decir: dieErr, code: 3, linea: (r) => `no se pudo leer el estado de #${issue}: ${r.read} falló (${r.detail}) — no se ha tocado nada, el siguiente barrido reintenta.` },
    [CollectionOutcome.PARTIAL]: { decir: dieErr, code: 4, linea: (r) => `ATENCIÓN: cosecha a medias de #${issue}: ${r.done.length ? r.done.map(hechoDe).join(', ') : 'no se completó ningún paso'}. Falló: ${r.detail}. Pendiente a mano — ejecuta cada comando por separado: ${r.pending.map((command) => command.line).join(' ; ')}` },
  }
  const proyeccion = PROYECCION[report.outcome]
  if (!proyeccion) throw new Error(`--collect no tiene proyección para el desenlace ${report.outcome}`)
  proyeccion.decir(`${dryRun ? 'dry-run: ' : ''}${proyeccion.linea(report)}`, proyeccion.code)
}
// 1) prior collision. No failure here has mutated anything yet: aborting is
// safe, it leaves no orphan lock. Finding 4: exit 3 (read failure, no
// mutation, no real collision) — formerly exit 1, indistinguishable by code
// from the real COLLISION further down.
let candLabels, open
if (fx) {
  candLabels = fx.candLabels
  open = fx.openIssues
} else {
  try {
    candLabels = labelsOf(issue)
    open = allOpen().filter((i) => i.n !== issue)
  } catch (e) {
    dieErr(`no se pudo leer el estado de #${issue} en ${repo}: ${e.message}`, 3)
  }
}
const collisions = detectCollisions(candLabels, open)
if (collisions.length) {
  // Finding 4: exit 1 — 'skip', the NORMAL outcome of the protocol (no
  // mutation ever got written). No behaviour change.
  // F13/H2: each collider's status travels in the message. Since `in-review`
  // also holds tokens, "clashes with #7" no longer implies there is a live
  // agent on #7 — and the remedy is different (merge the PR, do not wait).
  // Without the status, the two cases are indistinguishable in the output.
  const detalle = collisions.map((c) => `#${c.n}[${c.tokens.join(',')}${c.status ? ` ${c.status}` : ''}]`).join(' ')
  const hayReview = collisions.some((c) => c.status === 'status:in-review')
  const nota = hayReview
    ? ' — los marcados status:in-review tienen su trabajo entregado pero SIN MERGEAR: retienen sus tokens hasta el merge (ramificar ahora daría una base sin ese trabajo) y no hay ningún agente en ellos, así que esperar no sirve: mergea su PR, ciérralo como completed si el PR ya se mergeó, o reábrelo con --reopen si la revisión lo rechazó.'
    : ''
  dieErr(`COLLISION: #${issue} choca con ${detalle}${nota}`, 1)
}

// TEST HOOK — CT_CLAIM_PRECLAIM_DELAY_MS.
//
// What it does: if it is defined, it inserts a synchronous wait right AFTER
// the collision check (step 1, above) has passed clean, and BEFORE writing
// the claim label `status:in-progress` (step 2, below). No other point of the
// script is affected.
//
// Why it exists: the original AC6 (T10) could only observe the falsifiable
// half of the mutual exclusion guarantee — `claimLost()` can only make the
// claimant with the HIGHER number lose, so the lower-numbered one never loses
// by construction. To really exercise the double claim window (T11) you need
// to be able to pause one claimant right between its collision check and its
// write, deterministically — without this hook that window depends on the
// OS's scheduler and fourteen rounds of `--settle-ms 0` did not reach it even
// once, which is absence of evidence, not evidence of absence.
//
// Why it is safe for it to exist outside tests, without tying it to
// --dry-run like CT_CLAIM_FIXTURE: unlike the fixture (which replaces real
// data with fabricated data and therefore COULD make it decide on false
// information), this hook can ONLY add a wait. It does not change what is
// decided (collision/no collision, race won/lost), it does not change what
// gets written to GitHub, it skips no step and reorders nothing. With the
// variable absent (the real production case, and that of every existing test
// that does not set it) the value is exactly 0 and `sleepSync(0)` is a no-op
// — the code path is IDENTICAL to the one before this change. Leaving it
// active by accident in production would degrade latency, never correctness.
//
// A second symmetric hook between the write and the readback is not needed to
// build the harness's interleaving: this hook applied ONLY to the
// lower-numbered claimant (large skew) and none on the higher-numbered one is
// enough — as long as the skew exceeds the higher one's complete cycle (write
// + readback), the higher one completes its decision before the lower one
// writes at all. (An earlier version of this comment existed that pointed at
// --settle-ms/CT_CLAIM_SETTLE_MS as that second control; that mitigation was
// withdrawn in T11 fix round 2 for not being provable to contribute anything
// — see the comment further up, next to `sleepSync`.)
//
// Placement (fix round 1, T11 review): this validation lives HERE, after the
// `if (release) { ...; process.exit(0) }` above, on purpose — not next to the
// definition of `sleepSync`. A `--release` never passes through this point of
// the script, so a malformed CT_CLAIM_PRECLAIM_DELAY_MS (e.g. left dangling
// in the environment by an earlier test session) can never block a
// `--release` with exit 2 and leave an issue stuck at `status:in-progress` —
// the only possible effect of an environment variable whose purpose is "just
// wait" would be exactly that, if it lived before the `release` guard.
//
// Upper cap (60000ms = 1 minute): without it, a value like "1e12" (~31 years)
// is accepted as a valid "number >= 0" and is in practice indistinguishable
// from a hang — the harness that uses this hook never needs more than a few
// seconds of skew, so a value above the cap is, with very high probability,
// an error by whoever invokes it, not a real need.
const PRECLAIM_DELAY_CAP_MS = 60_000
let preclaimDelayMs = 0
const preclaimRaw = process.env.CT_CLAIM_PRECLAIM_DELAY_MS
if (preclaimRaw !== undefined) {
  const n = Number(preclaimRaw)
  if (!Number.isFinite(n) || n < 0 || n > PRECLAIM_DELAY_CAP_MS) {
    dieErr(`CT_CLAIM_PRECLAIM_DELAY_MS inválido: "${preclaimRaw}" — debe ser un número entre 0 y ${PRECLAIM_DELAY_CAP_MS}`, 2)
  }
  preclaimDelayMs = n
}
if (!dryRun && !fx) sleepSync(preclaimDelayMs)

// 2) claim. Finding 4: exit 3 — infrastructure failure, no mutation got to
// persist (the write attempt failed, the issue is still at status:ready).
// Formerly exit 1, indistinguishable from a real COLLISION.
if (!dryRun && !fx) {
  const result = setStatus(issue, 'status:ready', 'status:in-progress')
  if (!result.ok) {
    dieErr(`no se pudo escribir el claim de #${issue}: ${result.error.message}`, 3)
  }
}

// 3) claim-then-verify (re-reads — never the search index — and breaks ties by lower number)
let readback
if (fx) {
  readback = fx.readback
} else {
  try {
    readback = allOpen()
  } catch (e) {
    // We already wrote the claim in step 2: if we cannot re-read now, we do
    // not know whether we won the race. Leaving the label in place would be a
    // silent orphan lock, so we try to revert before exiting with an error —
    // and we say it differently from a normal lost race, because a human
    // needs to know this is an infrastructure failure, not a tie-break.
    // Finding 4: the final exit code depends on whether THAT revert succeeded
    // (3 — infra, no persistent mutation) or failed (4 — a real orphan,
    // demanding human intervention).
    errLine(`no se pudo re-leer el estado tras el claim de #${issue}: ${e.message} — no se puede confirmar la carrera`)
    let revertOk = true
    if (!dryRun) {
      const result = setStatus(issue, 'status:in-progress', 'status:ready')
      if (result.ok) {
        errLine(`#${issue} revertido a status:ready (carrera no confirmada)`)
      } else {
        revertOk = false
        errLine(`ATENCIÓN: #${issue} puede haber quedado bloqueado en status:in-progress (no se pudo revertir: ${result.error.message}). Libéralo a mano con: ${manualReleaseHint()}`)
      }
    }
    process.exit(revertOk ? 3 : 4)
  }
}

if (claimLost(readback, issue)) {
  errLine(`carrera perdida: #${issue} liberado (otro claim menor con token compartido ganó)`) // lost
  // Finding 4: 'skip' (exit 1) if the revert succeeded — a CLEAN lost race,
  // the normal outcome of the protocol (no mutation persists). 'stuck'
  // (exit 4) if the revert ALSO failed — a real orphan.
  let revertOk = true
  if (!dryRun && !fx) {
    const result = setStatus(issue, 'status:in-progress', 'status:ready')
    if (!result.ok) {
      revertOk = false
      errLine(`ATENCIÓN: no se pudo revertir el claim de #${issue} tras perder la carrera (${result.error.message}). Queda bloqueado en status:in-progress — libéralo a mano con: ${manualReleaseHint()}`)
    }
  }
  process.exit(revertOk ? 1 : 4)
}
dieOut(`claimed #${issue} → in-progress`, 0)
