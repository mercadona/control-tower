#!/usr/bin/env node
// ============================================================================
// CT-WATCH-MERGE — the merge watcher, so that the harvest does not wait for
// somebody to remember to tell it about it.
//
// WHAT IT FIXES. Gate 3 of the loop is human: closing the gates and merging. And
// merging produced NO mechanical signal at all. The PR got merged, the issue got
// closed, and `.worktrees/<n>` + `feat/<n>` stayed on disk with their `claude`
// alive —thirteen hours, in the case that gave rise to F20— until the very
// person who had merged walked over to the coordinator's window to tell it. So
// the event existed in GitHub and what fired the harvest was an errand.
//
// This process closes the gap: it polls the PR of the slice's branch and, as
// soon as it sees it merged, it types the line into the coordinator session.
//
// THE SLICE ITSELF LAUNCHES IT, ON DELIVERY. `dispatch-check.mjs --release`
// starts it with `spawn(..., { detached: true }).unref()` right after moving the
// issue to `status:in-review`, which is the EXACT instant at which there is an
// open PR waiting for a human merge. Launching it earlier (at dispatch, next to
// the `-OK` watcher) would mean putting a process to ask about a PR that does
// not exist yet for as long as the implementation lasts.
//
// HOW IT LOCATES THE COORDINATOR: BY ITS DIRECTORY, NOT BY ITS NAME. The `-OK`
// watcher looks for the slice's session by its TITLE, and it can because that
// title is CALCULATED by the loop itself: `dispatch.js#cmuxSessionName` is a
// pure function that `/ct-next` calls to create the workspace and that the
// watcher calls to find it. One derivation, two consumers. And on top of that
// `/ct-next` verifies with its sentinel that that session really started before
// launching anything.
//
// Here there is none of that, and not because a worse option was chosen:
// BECAUSE THERE IS NOTHING TO CHOOSE. The coordinator session is not created by
// the loop — a person opens it in whatever window they feel like. There is no
// title to derive, no creation to verify, no guarantee to lean on. The only
// observable property left is WHERE it runs —the main checkout, the same one
// `git worktree list --porcelain` returns as its first entry— so it is compared
// against `current_directory`.
//
// THE PRECONDITION THAT IMPOSES, AND IT IS A RULE OF USE, NOT A DETAIL: the
// coordinator session has to be a cmux workspace opened IN THE MAIN CHECKOUT of
// the repo it coordinates. If you have it open somewhere else, this process does
// not find it and the warning is lost.
//
// Measured in the field on 2026-08-26 with PR #16 of jjponz/rust-monitoring: the
// merge was seen 34 seconds after it happened, and there was nobody to tell it
// to, because the window of whoever was coordinating was open in ANOTHER repo.
// The watcher did the right thing and said so; the rule was not written down
// anywhere, which is the real defect of that episode.
//
// WHY THE RULE IS ACCEPTED INSTEAD OF MAKING THE ADDRESSING ROBUST. The
// alternative is that the coordinator REGISTERS itself —that on hydrating it
// writes down somewhere which cmux workspace it is— and that this reads that
// register instead of inferring. It is the symmetric half of what the loop
// already does with the slices, and it was discarded on purpose: it would be a
// new piece of state, with its expiry and its "is that still alive?", built for
// ONE single consumer. Decision taken: the inference stays and the rule gets
// written down. If some day there is a second consumer that needs to reach the
// coordinator, the register is what has to be built, and then this block is the
// one that becomes redundant.
//
// AN INHERITED LIMIT, SAID WITHOUT ORNAMENT: to DELIVER the line, this plugin's
// fragile path is used (`cmux send` + `send-key`), and there is no sentinel that
// proves the session received it. The only thing that is known is that the two
// commands returned 0, and that is what the log says — not "the harvest has
// started". It is exactly the same limit ct-watch-go.mjs accepts, for the same
// reason: a real sentinel would demand that the coordinator wrote something,
// that is, depending on the agent the line is delivered to.
//
// THE DELIBERATE DIVERGENCE FROM ct-watch-go.mjs, which is the only one, and is
// no oversight: HERE IT DOES NOT DIE BECAUSE THE TARGET SESSION IS NOT THERE.
//
// That one shuts down as soon as cmux answers that the slice's session does not
// exist, and it is right to: without that session there is nothing to watch, and
// a live process watching it would make it look as if the gate were still
// covered. Here the absence of the coordinator does not mean the same thing,
// because it is not evidence that the work has finished: the merge can still
// arrive.
//
// WHAT THAT DIVERGENCE BUYS, AND WHAT IT DOES NOT — and the distinction is the
// correction of a sentence this block used to say and that the episode of
// 2026-08-26 disproved. It buys surviving an absence WHILE IT WAITS: you close
// the window, you open it again, and the watch is still standing. It does NOT
// buy an absence AT THE INSTANT OF DELIVERING: if there is no coordinator on
// that tick, the warning is lost and that is that. This block used to claim it
// covered "you go to sleep and the merge arrives later", and that is only true
// if the window is where it should be when the merge arrives — that is, it was
// not a coverage, it was the same precondition said as if it were a guarantee.
//
// A LOST WARNING IS NOT A HOLE, and this is the underlying reason why the rule
// is accepted: `/ct-next` already crosses, on EVERY run, the merged issues
// against `.worktrees/` and `git branch --list 'feat/*'` and emits `cosecha
// pendiente:` with the exact commands (F20, dispatch.js#collectFinishedResidue).
// So this watcher contributes no knowledge that does not already exist: it
// contributes the MOMENT. When it fails, it degrades exactly to the old mode
// —you find out on the next `/ct-next`—, not to nobody ever finding out.
//
// What it does do is not pretend: if the merge is seen and there is nobody to
// deliver it to, it says so, it names the rule that was not met, and it exits
// with 1. The warning is lost; it is not dressed up as delivered.
//
// WHAT IT DELIBERATELY DOES NOT HAVE, inherited from ct-watch-go and for its
// reasons:
//
//   - NEITHER A PIDFILE NOR A LIVENESS CHECK. A `--reopen` followed by a second
//     `--release` gives birth to a second watcher; the first one expires. The
//     worst that happens is that the line gets typed twice, which is annoying
//     and nothing more.
//   - NO DELETING ANYTHING. The watcher warns; the coordinator picks up the
//     harvest. It is F20's decision intact: "merged" is not "nobody is touching
//     that" —there may be unpushed changes— and deleting a worktree is
//     irreversible. No success path of this plugin deletes anything, and this
//     one does not either.
//   - NO WATCHING THE ISSUE'S CLOSURE. What frees the tokens is the merge, and
//     what leaves residue on disk is the merge. The issue's closure is its
//     consequence, not a second event worth waiting for separately.
//
// THE LOG IS OPENED BY THIS PROCESS, not by whoever launches it, and it goes
// outside the repo (`~/.claude/control-tower/log/`), next to the telemetry and
// the log of the `-OK` watcher. All three for the same reason written in
// run-metrics.js: so that no `git add` of the slice puts it into the PR. IT
// opens it because, when ct-next opened it on behalf of its watcher, the suite
// ended up creating files in the real $HOME of whoever ran it.
// ============================================================================

import { execFileSync } from 'node:child_process'
import { buildCmuxSendArgv, buildCmuxSendKeyArgv } from './dispatch.js'
import { findWorkspaceByCwd } from './cmux.js'
import { arg, sleep, plazo, openLog } from './watch-common.js'

// A 60-second tick and a 48-hour deadline. The two numbers are different from
// the ones of the `-OK` watcher (30 s / 8 h) because the event is different:
// that one covers a person being asleep, and this one covers a PR waiting for
// review — which, in F33's measurement, is what consumes the most epic clock,
// and is counted in days, not in hours. A slower tick costs nothing: the harvest
// is not urgent to the second, and 48 h at one poll a minute is ~2880 calls to
// `gh` per slice, 60 an hour, against a limit of 5000.
const DEFAULT_POLL_MS = 60_000
const DEFAULT_TIMEOUT_MS = 48 * 60 * 60 * 1000
const GH_TIMEOUT_MS = 30_000
const CMUX_TIMEOUT_MS = 10_000

const issue = arg(process.argv, '--issue')
const repo = arg(process.argv, '--repo')
const coordinatorCwd = arg(process.argv, '--coordinator-cwd')
const logPath = arg(process.argv, '--log')
if (!issue || !repo || !coordinatorCwd) {
  process.stderr.write('usage: ct-watch-merge.mjs --issue N --repo owner/name --coordinator-cwd <path of the main checkout> [--log <path>]\n')
  process.exit(2)
}

const branch = `feat/${issue}`
// `terminar` is the key `openLog` returns; only the local name is English.
const { log, terminar: finish } = openLog(logPath)
const pollMs = plazo('CT_WATCH_MERGE_POLL_MS', DEFAULT_POLL_MS)
const timeoutMs = plazo('CT_WATCH_MERGE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)

// Is there a MERGED PR whose branch is the slice's? Returns the PR, `null` if
// there is none, or `undefined` if it could not be asked — the three are
// different things and nothing follows from the third.
//
// No heuristic is worth anything here and that is why there is none: a slice's
// branch is deterministic, so it is asked about and that is that. `--state
// merged` is filtered by GitHub, not by this file. It is deliberately the
// opposite of what the first version of the metrics harvest did, which deduced
// the PR by scanning `cross-referenced` and tied slices to the wrong PRs (see
// commands/ct-harvest.md).
function readMergedPr() {
  try {
    const raw = execFileSync('gh', [
      'pr', 'list', '--repo', repo, '--head', branch, '--state', 'merged',
      '--json', 'number,mergedAt', '--limit', '1',
    ], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, killSignal: 'SIGKILL',
    })
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const pr = parsed[0]
    return Number.isInteger(pr?.number) ? pr : null
  } catch (e) {
    // A failure of `gh` does NOT end the watch: the network goes down, the token
    // expires and is renewed, GitHub returns a 502. What cannot happen is that a
    // transient failure gets read as "it is not merged" permanently — the watcher
    // would shut down with the work delivered and the harvest uncollected.
    log(`warning: the PR of ${branch} could not be queried (${String(e.message).trim()}) — it is retried on the next tick`)
    return undefined
  }
}

// The lookup lives in scripts/cmux.js, which is the ONLY place in the repo that
// reads `custom_title`/`current_directory` and the only one that knows those
// field names are not a guaranteed schema. It used to be read here raw, and that
// had a concrete consequence that an adversarial review caught: if cmux renames
// that field, no entry matches, this returned "cmux answered and it is not
// there", and the message below —which since the previous round NAMES THE RULE
// and tells the person what they did wrong— turned into a specific, confident
// and false accusation. Making the message more honest made the failure mode
// worse.
//
// `findWorkspaceByCwd` translates that into `consultado: false` (it could not be
// known), which is the branch that already existed here for the "cmux does not
// answer" case and that retries on the next tick. So the guard adds no new path:
// it routes the schema change through the right one of the paths already there.
const consultarCoordinadora = () => {
  const r = findWorkspaceByCwd(coordinatorCwd, { timeoutMs: CMUX_TIMEOUT_MS })
  if (!r.consultado) log('warning: cmux could not be asked (or its answer does not carry the directory field this plugin knows how to read)')
  return r
}

// The line that gets typed into the coordinator. It names the PR, the slice and
// THE TWO ARTEFACTS left on disk, because the warning has to be enough to act
// on: a bare "it is already merged" would leave the person being the message bus
// again, which is the whole problem.
//
// And it says "comprueba que no queda trabajo sin pushear" on purpose: the one
// who deletes is an agent, and what it is missing when it receives this line is
// exactly what F20 refused to assume.
const line = (pr) => `El PR #${pr} del slice #${issue} está mergeado: la cosecha del #${issue} está pendiente. \`.worktrees/${issue}\` y la rama \`${branch}\` siguen en disco. Comprueba que no queda trabajo sin pushear y recógelos.`

log(`watching the merge of ${repo} ${branch} (slice #${issue}) for the coordinator in ${coordinatorCwd} — tick ${pollMs} ms, deadline ${timeoutMs} ms`)

// There is no initial snapshot to take, and that asymmetry with ct-watch-go is
// real, not an oversight. There the window exists because an `-OK` inherited
// from an earlier dispatch would start the work without anybody granting
// permission. Here the event is nobody's answer but a fact of the repository,
// and that fact does not expire: if the slice's branch ALREADY has a merged PR
// on the first poll, the harvest is pending all the same and it has to be said.
// A watcher that kept quiet because of that would be a watcher that keeps quiet
// precisely when there is already residue on disk.
const deadline = Date.now() + timeoutMs

for (;;) {
  const pr = readMergedPr()
  if (pr) {
    log(`${branch} merged in PR #${pr.number}${pr.mergedAt ? ` (${pr.mergedAt})` : ''}`)
    const { consultado, ref } = consultarCoordinadora()
    if (ref) {
      try {
        execFileSync('cmux', buildCmuxSendArgv({ workspace: ref, text: line(pr.number) }), {
          stdio: ['ignore', 'ignore', 'pipe'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
        })
      } catch (e) {
        log(`ERROR: the merge was seen and the text could not be written into the coordinator (${ref}): ${String(e.message).trim()}. Collect the harvest of #${issue} by hand.`)
        finish(1)
      }
      try {
        execFileSync('cmux', buildCmuxSendKeyArgv({ workspace: ref }), {
          stdio: ['ignore', 'ignore', 'pipe'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
        })
      } catch (e) {
        // `send` without `send-key` leaves the text on the edit line WITHOUT
        // executing it (measured in F20/H1), so that is what has to be said and
        // not "it could not be typed": whoever reads it is going to find the
        // line written in the window and has to know that all it is missing is
        // the Enter.
        log(`ERROR: the text was left written on the edit line of the coordinator (${ref}) but the Enter failed: ${String(e.message).trim()}. Go to that window and press Enter.`)
        finish(1)
      }
      // What is known is this and no more: the two commands returned 0. There is
      // no sentinel that proves the coordinator received it and acted (see the
      // header), so the message does not claim the harvest has started.
      log(`line sent to the coordinator (${ref}): \`cmux send\` and \`send-key Enter\` returned 0. There is no way to check from here that the session has processed it. Watch finished.`)
      finish(0)
    }
    if (consultado) {
      // THE RULE is named, not just the fact. The previous message said "no
      // session exists in <cwd>", which is true and useless: whoever reads it
      // cannot deduce from that what they should have done differently. And it
      // says that the harvest is still detected on its own, so that a lost
      // warning does not get read as lost work.
      log(`ERROR: the merge of ${branch} was seen, but cmux says there is no workspace whose directory is ${coordinatorCwd}, so there is nobody to deliver it to.`)
      log(`The rule that was not met: the coordinator session has to be a cmux workspace opened IN ${coordinatorCwd} — this watcher locates it by its directory because there is no session name the loop can derive (the loop does not create it, you open it yourself).`)
      log(`No work has been lost: the next \`/ct-next\` in that checkout will emit \`pending harvest:\` for #${issue} with the exact commands. What has been lost is finding out now.`)
      finish(1)
    }
    // The coordinator could not be ASKED about. Nothing follows from that, and
    // less so with the merge already in hand: it retries on the next tick.
    log(`the merge is seen but cmux could not be asked to locate the coordinator — the delivery is retried on the next tick`)
  }
  if (Date.now() >= deadline) {
    log(`deadline exhausted without seeing any merge of ${branch} in ${repo}. If you already merged it, the harvest of #${issue} is still pending: collect it by hand, or launch this watcher again.`)
    finish(3)
  }
  await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
}
