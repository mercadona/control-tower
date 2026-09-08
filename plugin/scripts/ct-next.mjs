#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, accessSync, constants as fsConstants, writeSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, join, isAbsolute, delimiter as pathDelimiter } from 'node:path'
import { planDispatch, parseRepoSlug, buildCmuxArgv, buildCmuxSendArgv, buildCmuxSendKeyArgv, cmuxSessionName, collectFinishedResidue, formatFinishedResidueWarning } from './dispatch.js'
import { renderKickoff, buildStateSeed, AGENT_BIN } from './kickoff.js'
import { Baseline, BaselineOutcome, BaselineResult, ShellBaselineRunner } from './baseline.js'
import { parseStrictInt } from './argnum.js'
import { resolveGatesForAgent } from './gates.js'
import { GO_TOKEN, newGoNonce, goCommitment, goBody } from './go-response.js'
import { writeGoCommitment } from './go-registry.js'
import { emitGoNonce } from './go-channel.js'
import { controlTowerLogDir } from './run-metrics.js'
import { listCmuxWorkspaces, CMUX_QUERY_TIMEOUT_MS } from './cmux.js'
import { shQuote } from './shquote.js'
import {
  buildLauncherScript, buildTypedCommand, parseSentinel, sameDir,
  LAUNCHER_FILENAME, SENTINEL_FILENAME,
} from './launch-sentinel.js'
import { buildDispatchInput, NO_MILESTONE_KEY } from './gh-issue-map.js'
import { parseStateSafe, readBlocked } from './state.js'
import { SLICE_REL_PATH, excludeContentWith } from './state-paths.js'
import {
  planClosureProbe, buildClosureQuery, parseClosureProbe,
  formatSuspectClosureWarnings, formatMergedButOpenWarnings, formatClosureCoverageNote,
} from './gh-closure.js'
import { loadIssues } from './loop-issues.js'
import { detectConventions, formatFindings } from './conventions.js'
import { readRepoDocs, readAck, ACK_PATH } from './conventions-io.js'
import { PluginYardstick } from './plugin-yardstick.js'
import { assessLocalLiveness } from './liveness.js'

// W-C: dispatch-check.mjs implements the complete claim protocol (collision +
// write + claim-then-verify) and is already tested on its own, but until now
// nothing in the plugin invoked it — no issue ever reached status:in-progress
// in the real loop, so the `runningTouches` that W-B depends on (for the cap
// and for the collision with in-flight work) was always empty. The path is
// ALWAYS resolved relative to this file's own location (import.meta.url, THIS
// module's real URL) — never a fixed absolute path and never a shell string —
// because dispatch-check.mjs lives next to ct-next.mjs inside the plugin, no
// matter where it is installed.
const dispatchCheckPath = join(dirname(fileURLToPath(import.meta.url)), 'dispatch-check.mjs')
// The same resolution for ct-step.mjs: the kickoff interpolates the real
// absolute path, never the ${CLAUDE_PLUGIN_ROOT} token (which, in a plain-text
// prompt, nobody substitutes).
const ctStepPath = join(dirname(fileURLToPath(import.meta.url)), 'ct-step.mjs')
// The same resolution as its two siblings, and for the same reason: the
// kickoff is plain text and the ${CLAUDE_PLUGIN_ROOT} token does not exist
// there. The agent that writes the plan has to be able to open the yardstick's
// documents by their path.
const conventionsDir = join(dirname(fileURLToPath(import.meta.url)), '..', PluginYardstick.DIRECTORY)
// The `-OK` watcher: it is launched detached after dispatching a slice with
// the `plan` gate. See lanzarVigilanteDelGo.
const ctWatchGoPath = join(dirname(fileURLToPath(import.meta.url)), 'ct-watch-go.mjs')

// ============================================================================
// D5, finding F (second half) — THE OUTPUT'S DESTINATION BREAKING CANNOT
// CHANGE EITHER WHAT IS DECIDED OR THE EXIT CODE.
//
// `process.stdout`/`process.stderr` towards a pipe emit an 'error' event
// (EPIPE) when the reader closes — `ct-next | head`, a `/loop` that stops
// reading, a cmux session that closes mid-run. Without a handler, that event
// comes up as an uncaught exception and KILLS the process at the exact point
// where it tried to print. Verified by construction with stdout's read end
// closed: the `console.log` of "lanzado #90" —after the claim, the worktree
// and the cmux launch, that is, with ALL the work already done and done well—
// threw EPIPE and the run ended with exit 1 and a stack dump, as if the
// dispatch had failed.
//
// This script's exit code describes what happened to the WORK (it was
// dispatched, it was not dispatched, something was left half-done), never
// whether the caller's terminal was still listening. Losing log lines towards
// a destination that no longer accepts them is a real and acceptable limit
// —there is nowhere to deliver them— and it is written down here; turning it
// into a dispatch failure is not.
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})
// ============================================================================

// Fix round 1 (W-C's review), finding 2 — IMPORTANT: Node exits with 1
// (MODULE_NOT_FOUND) when the file it is asked to run does not exist — the
// SAME code dispatch-check.mjs uses for "collision/lost race" (see the exit
// code contract in its header). Without this guard, an absent or renamed
// dispatch-check.mjs (a badly installed or incomplete plugin) would make
// attemptClaim() classify it as an EXPECTED outcome of the protocol: EVERY
// slice of the batch would be skipped ("saltando #N…") and the process would
// end with exit 0 without having dispatched anything — a silent no-op, on top
// of contradicting the "unexpected failure" message below (which already
// claims to cover this case). It is checked ONCE at start-up, before touching
// `gh` or creating anything.
if (!existsSync(dispatchCheckPath)) {
  console.error(`no se encontró dispatch-check.mjs en ${dispatchCheckPath} — el plugin parece estar incompleto o mal instalado (¿se movió/borró el fichero?). Abortando antes de intentar ningún claim: sin él, cada slice se leería en falso como "colisión" y la tanda entera terminaría en un no-op silencioso.`)
  process.exit(1)
}

// ============================================================================
// Finding 1 (audit, interruption/staleness hardening round): SIGINT/SIGTERM
// after a confirmed claim. Before this change there was not a SINGLE signal
// handler in this file — a Ctrl-C during a slow `git worktree add` (a big
// repo) left the issue claimed (status:in-progress) FOREVER: no revert, no
// worktree, no agent, not even a message. The auditor's reproduction (a real
// dispatch-check that writes the label and exits 0, a fake `git` that hangs on
// `worktree add`, SIGINT after 3s) confirms exactly this: EXIT=130 and the
// orphaned claim.
//
// TWO EMPIRICAL FINDINGS that determine the design (verified by construction,
// not assumed — see this task's report for the exact experiment):
//
//   (a) A `process.on('SIGINT', fn)` handler NEVER runs while the main thread
//       is blocked inside a synchronous call to a child
//       (execFileSync/spawnSync) — neither during the block, nor even AFTER
//       that block ends (verified: a hung child that ignores the signal, with
//       the signal sent only to the node process, leaves the callback
//       UNEXECUTED even long after spawnSync's own timeout unblocks it).
//       spawn_sync.cc's synchronous loop lives outside libuv's event loop; the
//       JS callback is only processed when the event loop regains control.
//   (b) A 100% synchronous script (with no real `await`) NEVER gives the event
//       loop that opportunity either — verified with a purely-JS 8s busy loop:
//       the handler never runs, neither during the loop nor after it ends,
//       because the process reaches its end (and its `process.exit()`) without
//       having yielded control to the event loop even once. A synchronous
//       `Atomics.wait` (the pattern dispatch-check.mjs already uses for its own
//       test hook) has EXACTLY the same problem — it is not a real yield.
//
// Direct consequence: installing a handler WITHOUT also introducing real yield
// points (an `await` over a genuine timer, `setTimeout`, NEVER
// `Atomics.wait`) would be WORSE than installing nothing — it would change the
// default disposition from "the kernel kills the process instantly" (which
// today produces the auditor's immediate EXIT=130, with no cleanup but with no
// hang either) to "the signal is queued and never processed", that is, a
// silent, indefinite hang instead of an instant death — the scenario the brief
// itself warns about explicitly ("a handler that hangs itself would be worse
// than none").
//
// Also verified (same experiment, with a real yield via
// `await new Promise(r => setTimeout(r, 0))`): with a real yield point placed
// right after a safe checkpoint, an ALREADY pending signal is processed with a
// latency of a handful of milliseconds — there is no perceptible cost on the
// happy path (none of this runs while the process is blocked inside
// `git worktree add`/`gh`/dispatch-check: those are still synchronous, and
// that is where the design's second leg comes in).
//
// DESIGN (two independent defences, neither of which is enough on its own):
//
//   1. Real yield points (`await sleep(ms)`, below) at the dispatch loop's two
//      safe checkpoints: right before attempting a new claim (so as not to
//      start one more claim if a stop has already been asked for), and right
//      AFTER confirming a claim and BEFORE creating its worktree (the exact
//      window the finding describes: "the claim was written, the worktree does
//      not exist yet"). This catches a real signal in the common case: the
//      process is not blocked at THAT exact instant.
//   2. A time bound (`timeout`+`killSignal:'SIGKILL'`) on EVERY blocking call
//      to a subprocess this script could end up waiting on indefinitely
//      (dispatch-check.mjs, `git worktree add/remove`, `git branch -D`, and
//      `gh()` itself): if a child is genuinely stuck and the signal only
//      reaches this process (never the child — the most adverse case, and the
//      one the auditor reproduces), NO JS handler can rescue us (finding (a)
//      above) — the only real way out is for the call itself to give up. When
//      it expires, the child is killed (SIGKILL: a truly stuck child may be
//      ignoring SIGTERM) and the resulting exception falls into the ALREADY
//      EXISTING catch at each site (which already reverts the claim) — without
//      this change, that catch would never be reached.
//
// AN HONEST LIMIT that remains, documented and not solved by this change: if
// the signal arrives EXACTLY in the micro-window between the process resuming
// after an `await sleep(...)` and the next `execFileSync` starting, it can
// lose the race and the process can enter the blocking call anyway — in that
// case it is defence 2 (the time bound) that acts, not defence 1. There is no
// way to close that micro-window with pure JS against a child that may not
// cooperate; the goal here is to bound it (milliseconds, not seconds) and to
// guarantee that, in the worst case, the hang has a ceiling, never "forever".
//
// AN EXPLICIT UX REGRESSION (external review, IMPORTANT — not discovered by
// me, and not "solved": only honestly declared, because the design has no way
// of avoiding it entirely without a much bigger rewrite). Before installing
// ANY handler, a Ctrl-C against a genuinely hung `git worktree add` died
// INSTANTLY (the kernel's default disposition, EXIT=130, with no cleanup but
// also with no wait). With the handler installed, that same scenario now
// behaves like this: the user presses Ctrl-C (once, or several times — while
// the process is still blocked inside the synchronous call, ANY signal is, in
// practice, a no-op: there is no handler that can run, see finding (a) above),
// NOTHING visible happens — no message, no exit — until `childTimeoutMs` is
// reached (10 minutes by default), at which point the existing catch finally
// reverts the claim and the process ends. That is: "dies instantly, with no
// cleanup" is traded for "takes up to 10 minutes to exit, but cleans up
// properly" — a terminal held for several minutes with NO sign of life is, in
// itself, the scenario finding 1 describes (a divergence between what the user
// believes — "this is not responding, something is wrong" — and what the
// system is really doing — "it is waiting, and it will clean up at the end").
// There is no code mitigation for the total absence of feedback while the main
// thread is genuinely blocked: that would require converting the risky calls
// (such as `git worktree add`) to asynchronous `spawn` with the child
// registered so it can be killed DIRECTLY as soon as the signal is processed
// (instead of waiting for its own timeout) — a major restructuring, outside
// the scope taken on in this round. What DID change for the better, without
// ambiguity: before, that same Ctrl-C never reverted the claim (it was left
// orphaned forever); now it does, however late.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// D5 (a finding collateral to C, it was not in the brief) — `sleep(0)` IS NOT
// A RELIABLE YIELD POINT FOR A SIGNAL, and the loop's two checkpoints depended
// on it alone.
//
// The design above takes for granted that an `await sleep(ms)` gives the event
// loop "the opportunity to process an already-pending signal". That is true
// sometimes, not always: libuv dispatches signals in the POLL phase (the
// signal handler's self-pipe is a watcher of that phase), and the TIMERS phase
// —where a `setTimeout` resolves— runs BEFORE poll in the same turn of the
// loop. If the timer has already expired when the loop enters timers, the
// `await`'s continuation runs WITHOUT the pending signal having been
// dispatched yet.
//
// Measured, not assumed (same experiment, 8 rounds, signal sent to the process
// while it was blocked inside an `execFileSync` with a child that ignores the
// signal): after the FIRST `await sleep(0)` the handler still had not run in 2
// of 8 rounds — and in those two it had run after the second. With
// `setImmediate` (the CHECK phase, immediately AFTER poll) the handler had
// already run in 8 out of 8. At the PRODUCTION value
// (CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS absent, that is 0) that meant that ~1 in
// every 4 Ctrl-C arriving during `dispatch-check` slipped through the
// post-claim checkpoint and the loop went on creating the worktree and
// launching the agent — exactly the gap the checkpoint exists to close.
//
// `yieldToSignals()` crosses the poll phase on purpose. It is used AFTER each
// checkpoint's `sleep(...)` (not in its place: the sleep is still what widens
// the window deterministically for the tests) and one last time at the end of
// the process (finding C).
function yieldToSignals() {
  return new Promise((resolve) => setImmediate(resolve))
}

// CT_NEXT_CHILD_TIMEOUT_MS: the time bound for dispatch-check.mjs, `git
// worktree add/remove`, `git branch -D` and `gh()` (see the reasoning above,
// defence 2). Generous by default (10 minutes): plenty for a listing of
// thousands of issues or a worktree against a big repo, without really being
// "no limit" — a real hang (this finding's scenario) is still bounded.
// Configurable for tests (they need to be able to exercise the timeout without
// really waiting 10 minutes); the same validation pattern (a finite number,
// > 0, with a ceiling to catch a typo like "1e12") as
// CT_CLAIM_PRECLAIM_DELAY_MS in dispatch-check.mjs.
const DEFAULT_CHILD_TIMEOUT_MS = 10 * 60 * 1000
const CHILD_TIMEOUT_CAP_MS = 24 * 60 * 60 * 1000
let childTimeoutMs = DEFAULT_CHILD_TIMEOUT_MS
const childTimeoutRaw = process.env.CT_NEXT_CHILD_TIMEOUT_MS
if (childTimeoutRaw !== undefined) {
  const n = Number(childTimeoutRaw)
  if (!Number.isFinite(n) || n <= 0 || n > CHILD_TIMEOUT_CAP_MS) {
    console.error(`CT_NEXT_CHILD_TIMEOUT_MS inválido: "${childTimeoutRaw}" — debe ser un número > 0 y <= ${CHILD_TIMEOUT_CAP_MS}`)
    process.exit(2)
  }
  childTimeoutMs = n
}

// CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE — for tests only: it limits WHICH child
// CT_NEXT_CHILD_TIMEOUT_MS is applied to. Every other one carries on with the
// production default (DEFAULT_CHILD_TIMEOUT_MS).
//
// F8 — why it was needed. Two tests exercise the time bound with a SHORT value
// (800 ms and 1000 ms) because nobody is going to wait ten minutes for it to
// fire. With a GLOBAL bound, that value had to satisfy two things at once: be
// LONGER than every legitimate step of the run (reading the issues, resolving
// the base branch, claiming) and SHORTER than the simulated hang. That is not
// a property of the code: it is a property of how busy the machine is.
//
// Measured, not assumed: with another vitest suite running at the same time,
// in 2 of 6 runs against an untouched main, the LEGITIMATE `dispatch-check` of
// the "hung git worktree add" test took more than 800 ms, so the bound fired
// on the WRONG child — the test failed looking for "no se pudo crear el
// worktree" in an output that talked about dispatch-check, and along the way
// left orphaned `gh` grandchildren writing into the temporary directory the
// `afterEach` was deleting (ENOTEMPTY).
//
// Bounding the SCOPE removes the race by construction instead of widening it:
// the only child that can exhaust the short bound is the one the test hangs on
// purpose. Zero dependence on the wall clock.
//
// It is validated with the same criterion as the self-signal hooks (finding G,
// below): the set of scopes is CLOSED and any other value aborts with exit 2
// before touching anything. A typo here cannot silently leave the PRODUCTION
// bound (10 min) where a test believed it had set one of 800 ms — the test
// would end up waiting ten minutes for a simulated hang, or worse, passing
// without exercising anything.
const CHILD_TIMEOUT_SCOPES = ['dispatch-check', 'worktree-add']
let childTimeoutScope = null
const childTimeoutScopeRaw = process.env.CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE
if (childTimeoutScopeRaw !== undefined && childTimeoutScopeRaw !== '') {
  if (!CHILD_TIMEOUT_SCOPES.includes(childTimeoutScopeRaw)) {
    console.error(`CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE inválido: "${childTimeoutScopeRaw}" — debe ser uno de: ${CHILD_TIMEOUT_SCOPES.join(', ')}. Es un hook exclusivo de tests que restringe CT_NEXT_CHILD_TIMEOUT_MS a un solo subproceso; con un valor que no se reconoce, la cota corta no se aplicaría a NINGUNO y el resto usaría el default de ${DEFAULT_CHILD_TIMEOUT_MS}ms sin decirlo. Abortando antes de tocar nada.`)
    process.exit(2)
  }
  childTimeoutScope = childTimeoutScopeRaw
}
// childTimeoutFor(step): the bound each blocking call gets. With no scope set
// (production and the vast majority of the tests) it always returns
// `childTimeoutMs`, exactly as before F8. With a scope set, only the named
// step receives the configured bound. `step` is omitted in the calls that are
// not scopable.
const childTimeoutFor = (step = null) => (
  childTimeoutScope === null || childTimeoutScope === step ? childTimeoutMs : DEFAULT_CHILD_TIMEOUT_MS
)

// CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS — for tests only: it deterministically
// widens (instead of depending on the OS scheduler) the real window between
// "claim confirmed" and "worktree created" — normally just a handful of JS
// instructions — so that a signal can be sent INSIDE it reproducibly. With the
// variable absent (production, and every test that does not set it) the value
// is 0: the checkpoint still exists (it still yields control to the event loop
// once, see the reasoning above), but with no added wait. It changes neither
// what is decided nor what is written — it only widens a window that already
// exists in its own right. Same pattern and same safety criterion as
// CT_CLAIM_PRECLAIM_DELAY_MS in dispatch-check.mjs.
const TEST_DELAY_CAP_MS = 60_000
let testDelayAfterClaimMs = 0
const testDelayRaw = process.env.CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS
if (testDelayRaw !== undefined) {
  const n = Number(testDelayRaw)
  if (!Number.isFinite(n) || n < 0 || n > TEST_DELAY_CAP_MS) {
    console.error(`CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS inválido: "${testDelayRaw}" — debe ser un número entre 0 y ${TEST_DELAY_CAP_MS}`)
    process.exit(2)
  }
  testDelayAfterClaimMs = n
}

// ============================================================================
// F19/H1 — HOW LONG THE START-UP SENTINEL IS WAITED FOR.
//
// The sentinel (see scripts/launch-sentinel.js) is written by the login shell
// cmux opens, so the delay that has to be absorbed is NOT that of starting the
// agent: it is that of starting THE SHELL (zsh + oh-my-zsh + nvm + whatever
// the user has in their rc) plus the time cmux takes to type the text. On the
// happy path the wait ends as soon as the file appears —typically a few
// hundred milliseconds— not when the bound runs out: this does NOT add 8
// seconds to every dispatch.
//
// The bound exists because a sentinel that does not appear HAS to be
// distinguished from one that has not appeared yet, and only time separates
// them. Waiting forever would turn a slow shell into a hung dispatcher;
// cutting too early would turn a slow shell into a false alarm. 8 s is
// deliberately generous for a shell start-up (which on a healthy machine is a
// fraction of a second) and deliberately short for a human watching the
// output.
//
// Raising this bound is the right answer if a legitimately slow repo/machine
// produces false «could not confirm» reports; lowering it to 0 does NOT
// disable the check (there is no switch for that, on purpose: it would be
// reintroducing the lie), it only makes it uselessly strict.
//
// ============================================================================
// F20/H1 — THE 8000 ms, NOW MEASURED. AND WHAT THE MEASUREMENT DISMANTLED.
//
// F19 chose 8000 ms without measuring anything, and its own failure message
// suggested raising them «if your login shell really takes that long». F20
// measured them against this machine's REAL cmux and zsh, launching and
// closing test workspaces (never against a working repo):
//
//   - A login shell that starts clean runs the typed line at ~723 ms from
//     `cmux new-workspace` returning.
//   - A later resend runs ~250–400 ms after being sent.
//   - And the fact that changes everything: in 6 consecutive launches with
//     F19's mechanism as it was, the sentinel appeared 0 TIMES. The cause,
//     read off the session's screen, is the same one as always:
//
//         [oh-my-zsh] Would you like to update? [Y/n]
//         … >  '/…/launch.sh'
//         zsh: permission denied: /…/launch.sh
//
//     The one-character `read` of oh-my-zsh's prompt ate the `.` of
//     `. '/…/launch.sh'`, and what was left was an attempt to EXECUTE the
//     launcher (which is not executable, on purpose — see the `mode: 0o600` in
//     the dispatch loop — so it dies there instead of starting an agent with
//     no aliases).
//
// The operational conclusion: waiting longer was NEVER going to fix it. 8000
// ms is ten times the shell's real start-up; the problem is not slowness, it
// is a lost character. That is why the bound stops being «the only thing that
// is done» and becomes the TOTAL BUDGET, split into attempts: it waits a
// while, and if the sentinel is not there, it RESENDS the line to the same
// session.
//
// The three numbers, and why:
//   - `LAUNCH_ATTEMPT_MS` = 2500 → 3.5x the measured start-up (723 ms). Short
//     enough for the resend to arrive soon; long enough not to resend on top
//     of a shell that is simply slow.
//   - the total budget, `CT_NEXT_LAUNCH_TIMEOUT_MS`, DOES go up: from 8000 to
//     15000. And the reason is exactly the opposite of the one F19 rejected.
//     With a single wait, more time bought nothing (the lost character does
//     not come back); with resends, every extra 2500 ms is ONE MORE ATTEMPT.
//     The measurement that asks for it: the path validated end-to-end against
//     the real cmux with this very code (launcher with a guard, `send` +
//     `send-key`) started 5 out of 5 with ONE resend, at ~2.9 s — but
//     repeating the measurement with the machine loaded (the plugin's whole
//     suite running in parallel) took TWO resends, ~6.8–7.0 s, and 1 in 3 went
//     past the 8000. 15000 gives six attempts and ~2x margin over the worst
//     measured case; the cost is that a genuinely dead launch takes 15 s to
//     declare itself, ONCE. On the happy path it costs nothing: the wait ends
//     as soon as the sentinel appears.
//   - a budget SMALLER than one attempt (the tests that set 400 ms) simply
//     means there are no resends, and the behaviour is F19's.
const DEFAULT_LAUNCH_SENTINEL_TIMEOUT_MS = 15000
const LAUNCH_SENTINEL_TIMEOUT_CAP_MS = 600_000
const LAUNCH_SENTINEL_POLL_MS = 100
const LAUNCH_ATTEMPT_MS = 2500
let launchSentinelTimeoutMs = DEFAULT_LAUNCH_SENTINEL_TIMEOUT_MS
const launchTimeoutRaw = process.env.CT_NEXT_LAUNCH_TIMEOUT_MS
if (launchTimeoutRaw !== undefined && launchTimeoutRaw !== '') {
  const n = Number(launchTimeoutRaw)
  if (!Number.isFinite(n) || n < 0 || n > LAUNCH_SENTINEL_TIMEOUT_CAP_MS) {
    console.error(`CT_NEXT_LAUNCH_TIMEOUT_MS inválido: "${launchTimeoutRaw}" — debe ser un número entre 0 y ${LAUNCH_SENTINEL_TIMEOUT_CAP_MS}. Es la cota que se espera al centinela de arranque de cada slice (ver scripts/launch-sentinel.js); con un valor que no se entiende no se puede decidir si un centinela ausente es «no llegó a correr» o «todavía no». Abortando antes de tocar nada.`)
    process.exit(2)
  }
  launchSentinelTimeoutMs = n
}

// ============================================================================
// D5, finding G — THE SELF-SIGNAL HOOKS ARE VALIDATED HERE, BEFORE TOUCHING
// ANYTHING.
//
// `CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM` and
// `CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT` reach a
// `process.kill(process.pid, <value>)` raw, in the middle of the loop.
// `process.kill` THROWS `ERR_UNKNOWN_SIGNAL` with a signal name it does not
// recognise, and the first of those two sites is INSIDE the dangerous window:
// claim already written, worktree not yet. Verified by construction with
// `CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM=pepe`: `claimed #90 → in-progress` in
// the output, not a single revert in `gh`'s log, an ERR_UNKNOWN_SIGNAL trace,
// and the issue orphaned in status:in-progress.
//
// They are test hooks, yes — but they live in the PRODUCTION script and are
// read from the environment, which is exactly where a value with a typo comes
// from. They are validated with the same criterion as the other two variables
// above (a known shape → carry on; anything else → exit 2 before reading a
// single issue), and against the EXACT set of signals this script handles:
// installing a hook for a signal with no handler would not test what it says
// it tests.
//
// This is NOT, and does not claim to be, the complete safety net: any other
// unexpected `throw` in that same window would leave the issue just as
// orphaned. That part is solved at the root below (see `bailOutOnCrash`).
const HANDLED_SIGNALS = ['SIGINT', 'SIGTERM']
for (const varName of ['CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM', 'CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT']) {
  const raw = process.env[varName]
  if (raw === undefined || raw === '') continue
  if (!HANDLED_SIGNALS.includes(raw)) {
    console.error(`${varName} inválido: "${raw}" — debe ser una de las señales que este script maneja (${HANDLED_SIGNALS.join(', ')}). Es un hook exclusivo de tests que se autoenvía la señal en mitad del despacho; con un valor que Node no reconoce, "process.kill" lanza ERR_UNKNOWN_SIGNAL justo entre el claim y el worktree y deja el issue huérfano. Abortando antes de tocar nada.`)
    process.exit(2)
  }
}
// ============================================================================

// `arg()` only returns a string when the flag really carries a value: if the
// flag is argv's last token, or the next token is itself another flag (it
// starts with `--`), we return `true` (present-without-value) instead of
// slipping it in as a value. Same pattern as dispatch-check.mjs — ct-groom.mjs
// now copies it too (a fix from the final review: it had the un-hardened
// `arg()`, see ct-groom.mjs) — a dangling `--repo` never reaches
// `execFileSync` as a real value.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
const has = (f) => process.argv.includes(f)

// formatReason: translates the `blockReason` planDispatch returns
// (scripts/dispatch.js, pure logic tested without network) into a message for
// the human, for the causes that are NOT "cap full" (see formatBlockReason for
// that one). W-B (§8): before there was a single generic message ("nada ready
// con deps mergeadas y sin colisión") for four very different causes with
// different remedies — it forced you to guess. This wrapper only formats text;
// the DECISION about which the cause is was already taken by planDispatch.
// Extracted from formatBlockReason (fix Minor 1 of the review) so it can also
// be reused inside the "cap full" message, when raising --cap would not be
// enough either (see below).
// ============================================================================
// Finding 2 (interruption/staleness audit): without this, the "collision with
// in-flight work" message ALWAYS says "wait for it to finish" — an assertion
// that is only true if something really is running. Nothing in the dispatch
// ever crossed an issue in status:in-progress against local evidence that
// SOMETHING is really working on it — an orphaned claim (left that way by an
// interruption, see finding 1, or by any other cause: a `gh` that failed
// half-way, a human who killed the process by hand) is indistinguishable from
// real work by reading the labels alone, and the user has no way of knowing
// from /ct-next's output.
//
// THE SIGNALS THAT ARE TRUSTED, and why (all of them purely LOCAL — to this
// machine and this checkout — never network, except the local query to cmux
// over its Unix socket):
//   - `<repoRoot>/.worktrees/<n>` exists as a directory.
//   - the branch `feat/<n>` exists in THIS local checkout.
//   - a LIVE cmux session (in any window of this cmux, queried READ-ONLY via
//     `cmux list-windows` + `cmux workspace list --json` — NEVER
//     `new-workspace`: nothing is launched) whose title contains `#<n>` as a
//     whole token (word boundary: `#41` must not match `#410`).
//
// HOW A FALSE "this is abandoned" IS AVOIDED — the brief's explicit risk: it
// would lead somebody to break the claim of an agent that IS working, which is
// worse than the current silence: "no local evidence" is the CONJUNCTION of
// the three absences. It is enough for ONE single signal to indicate life (the
// worktree, the branch, or a cmux session with that number) for NOTHING to be
// said about staleness and the original message to be left intact.
//
// And even when all three are absent, the message NEVER asserts "abandoned"
// without qualification: these signals are only about THIS MACHINE — the same
// claim could have been made from another machine, or from another session of
// this very cmux that has since closed without releasing the label; this check
// cannot see that. The message limits itself to saying what is known (local
// absence) and what is not known (whether it is still alive somewhere else) —
// never "wait for it to finish" when there is no local basis for asserting it.
//
// If the cmux query itself fails (not installed, daemon down, timeout) it is
// treated as NOT CONCLUSIVE, never as "there is no session": a failed query is
// not evidence of absence, and asserting staleness with a third of the
// evidence unchecked would be exactly the kind of unverified assertion this
// task asks us to stop making.
// queryAllCmuxWorkspaces: a read-only query shared by finding 2 (staleness: is
// there a live session for an in-flight issue?) and finding 3 (is the session
// we HAVE JUST launched really in the directory we asked for? — see
// verifyCmuxLaunch, below).
//
// THE WALK AND ITS SCHEMA GUARD NOW LIVE IN scripts/cmux.js, and what remains
// here is what really is ct-next's: the fixture guard. It was extracted
// because the same query was copied into both watchers WITHOUT the guard
// —three copies and only this one right—, so the long comment explaining why
// `custom_title`/`current_directory` are not a guaranteed schema is in that
// module, which is the only place that reads them. Nothing has been relaxed
// here: it returns exactly the same, `{title, cwd, cwdKnown, ref}` or `null`.
function queryAllCmuxWorkspaces() {
  // CT_NEXT_FIXTURE (`fx`) promises NEVER to touch anything real — see that
  // variable's header comment, further up in this file ("nothing real is
  // decided or launched with fixture data"). Without this guard, a --dry-run
  // with a fixture that collides (`formatReason`, the 'collision' case) would
  // fire a real call to `cmux list-windows` — read-only, but real, and exactly
  // the kind of leak that comment exists to prevent. Verified by construction:
  // two existing tests (ct-next-dryrun.test.js, collision by token and by
  // serialisation) use `run()` — with no stubbed PATH — precisely because
  // until now nothing on the fixture path touched a real subprocess; without
  // this guard they would start invoking the REAL `cmux` of whichever machine
  // runs the tests. In fixture mode, the query is treated as "not conclusive"
  // — just as when cmux is unavailable — never as "there is no session".
  //
  // It is NOT delegated to cmux.js: that module knows nothing about fixtures,
  // and must not. The guard has to be BEFORE the call, not inside it.
  if (fx) return null
  return listCmuxWorkspaces({ timeoutMs: CMUX_QUERY_TIMEOUT_MS })
}

function queryCmuxWorkspaceTitles() {
  const all = queryAllCmuxWorkspaces()
  if (all === null) return null
  return all.map((w) => w.title)
}

function stalenessNote(n, liveness) {
  if (liveness.hasWorktree || liveness.hasBranch || liveness.hasCmuxWorkspace) return null
  if (!liveness.cmuxChecked) {
    return `no se encontró worktree ni rama local para #${n}, y no se pudo consultar cmux para confirmar si sigue habiendo una sesión activa (¿cmux no instalado, o el daemon no responde?) — no se puede descartar que el trabajo siga en curso en otro sitio; verifica a mano antes de asumir nada.`
  }
  return `no se encontró worktree, rama local, ni sesión cmux para #${n} EN ESTA MÁQUINA — el claim puede estar huérfano (interrumpido a medias, o reclamado desde otra máquina/sesión que ya no sigue aquí). Esta comprobación es solo local: no puede confirmar que nadie lo esté trabajando en otro sitio, así que tampoco afirmamos que esté abandonado — pero "espera a que termine" ya no es una afirmación segura con lo que se ve desde aquí. Verifica a mano antes de tocar el label.`
}

// stalenessCtxFor: a lazy, memoised helper for formatReason/formatBlockReason
// — the cmux query (list-windows + workspace list for each window) only fires
// the FIRST time it is really needed (a blocking reason of collision), never
// in the 'none-ready'/'deps-unmet'/cap-full-with-a-slot cases, so as not to
// pay that cost (bounded to CMUX_QUERY_TIMEOUT_MS, but still a real call to a
// subprocess) on the common path.
function stalenessCtxFor() {
  let cmuxTitlesCache
  let queried = false
  // Memoised AND lazy: the thunk is passed to assessLocalLiveness, which only
  // invokes it if neither the worktree nor the branch exists (see its
  // comment). One query per run at most, zero if no issue needs it.
  const getCmuxTitles = () => {
    if (!queried) {
      cmuxTitlesCache = queryCmuxWorkspaceTitles()
      queried = true
    }
    return cmuxTitlesCache
  }
  return {
    stalenessNoteFor(n) {
      return stalenessNote(n, assessLocalLiveness(n, getCmuxTitles, { repoRoot, timeoutMs: childTimeoutFor() }))
    },
  }
}
// ============================================================================

// Finding 3 (audit): cmux's command form is
// `/bin/zsh -lc '{ cd -- '\''<cwd>'\'' 2>/dev/null || [ ! -d '\''<cwd>'\'' ]; }
// && ...'` — it TOLERATES a non-existent cwd and starts the agent in the login
// shell's default directory anyway, exiting with 0. ct-next.mjs printed
// "lanzado #N en <wt>" based ONLY on `new-workspace` returning exit 0 — that
// is, it inferred "it is running in the right place" from "the command did not
// fail", which is exactly what this finding says CANNOT be inferred.
//
// verifyCmuxLaunch reuses the SAME read-only query as finding 2
// (queryAllCmuxWorkspaces — `list-windows` + `workspace list --json`, never
// `new-workspace`) to check, AFTER `new-workspace` has already returned
// success, whether a session exists with the exact title that was asked for
// and, if it does, whether its `current_directory` matches the expected
// worktree. This is the MOST that can be verified without launching anything
// new: it says nothing about whether the agent INSIDE that session is doing
// anything useful, but it does distinguish, with real evidence, "it is in the
// right directory" from "cmux accepted the command but ended up somewhere
// else" — which is precisely the lie this finding asks us to stop telling.
//
// Four states, not three (D5, finding B):
//   'confirmed'    → the session exists with the requested title AND its
//                    directory matches. The only way to assert "it is where we
//                    told it to be".
//   'wrong-cwd'    → the session exists and cmux DID give us a directory, and
//                    it is NOT the one requested. Positive evidence of a
//                    problem.
//   'cwd-unknown'  → the session exists with the requested title, but cmux
//                    exposed no readable directory for it (field absent,
//                    renamed, or of another type). We know MORE than with
//                    'unverifiable' (the session exists) and LESS than with
//                    'confirmed' (the directory could not be checked) — and it
//                    is certainly not 'wrong-cwd': there is no evidence at all
//                    that it is in the wrong place.
//   'not-found'    → cmux answered, with a recognised schema, and there is no
//                    session with that title.
//   'unverifiable' → the query to cmux could not be completed at all.
function verifyCmuxLaunch(expectedTitle, expectedCwd) {
  const all = queryAllCmuxWorkspaces()
  if (all === null) return { status: 'unverifiable' }
  const match = all.find((w) => w.title === expectedTitle)
  if (!match) return { status: 'not-found' }
  if (!match.cwdKnown) return { status: 'cwd-unknown' }
  if (match.cwd === expectedCwd) return { status: 'confirmed' }
  return { status: 'wrong-cwd', actualCwd: match.cwd }
}

// ============================================================================
// F19/H1 — THE WAIT FOR THE SENTINEL, AND THE FIVE VERDICTS THAT COME OUT OF
// IT.
//
// `verifyCmuxLaunch` (above) answers «does the window exist?». This piece
// answers the question that really mattered and that nobody was asking: «did
// the command get EXECUTED?». See scripts/launch-sentinel.js's header for the
// complete field finding.
//
// The states, and what evidence holds each one up:
//   'ran'          → the sentinel exists, it parses, `$PWD` matches the
//                    worktree and `claude` resolved in that shell. It is the
//                    ONLY way to assert that the command ran.
//   'wrong-cwd'    → the command ran, but in ANOTHER directory. Positive
//                    evidence of a problem: the agent may be touching the
//                    wrong repo.
//   'no-claude'    → the command ran and `claude` does NOT resolve in that
//                    shell. Certainty that there will be no agent: the
//                    script's next line dies with "command not found". It is
//                    the only verdict with NEGATIVE certainty, and that is why
//                    it is the only one that authorises undoing the claim (see
//                    the dispatch loop).
//   'garbled'      → the file exists but it is not a sentinel of this format.
//                    Nothing is guessed: it is said.
//   'never'        → it did not appear within the bound. This is NOT the same
//                    as 'no-claude': here we do not know whether the command
//                    never ran (the field case) or whether the shell is still
//                    starting. Without knowing, we CANNOT say «launched», and
//                    we ALSO cannot revert the claim: a revert with an agent
//                    that starts three seconds late is worse than the residue.
// ============================================================================
// THE `-OK` WATCHER — one single go, and on the issue.
//
// The `plan` gate orders the agent to publish its plan as a comment on the
// issue and STOP until a human answers. Until this round nobody read that
// answer: work resumed when the person went to the cmux window and pushed the
// session by hand. Which means the permission was given twice and the one that
// counted was not the one that stays written.
//
// It is launched DETACHED (`detached` + `unref`) because it has to survive
// this coordinator session being closed. If it only lived while somebody was
// watching, it would be no use for the case that motivates all of this: in
// F33's measurement, 54% of an epic's clock was a gate asked for at night,
// waiting for somebody to wake up.
//
// ONLY IF THE SLICE CARRIES THE `plan` GATE. A slice that opted out (`!plan` in
// the §9 table) does not stop to wait for anybody, so there is nothing to watch
// and a process polling GitHub for eight hours for nothing is worse than its
// absence.
//
// AND ONLY IF THE SLICE COUNTED AS LAUNCHED. The watcher's only handle is the
// session's TITLE, so on the two paths that do not count —'not-found' (cmux
// answered and there is no session with that title) and 'wrong-cwd' (there is
// one, but in another directory, and the slice is noted in
// `unverifiedLaunches`)— launching it was announcing «the session starts on
// its own» in the very run that has just said that session cannot be located.
// An adversarial review caught it, and the repo has a whole test file against
// this class of message (`ct-next-honest-messages.test.js`).
//
// IT DOES NOT BREAK THE DISPATCH. It goes after the claim is resolved and the
// slice counted as launched, and any failure here is WARNED about and carries
// on: the work is already under way, and not being able to watch the go means
// going back to the old mode —pushing by hand—, not losing the slice. It is
// the same rule as the telemetry's `git add` in ct-step: the thermometer is not
// part of the engine. That is why there is also an `error` handler: an
// ASYNCHRONOUS `spawn` failure (EAGAIN, EMFILE) is not seen by the
// `try/catch`, and with no handler it would be an unattended `'error'` that
// would bring the whole of ct-next down — losing the batch's summary and its
// exit code.
//
// THE LOG IS OPENED BY THE WATCHER, not by this function. When it was opened
// here, the suite created directories and files in the real `$HOME` of whoever
// ran it (the tests substitute the BINARY, not the disk) — exactly what
// `__tests__/fixtures/hermetic-env.js` exists to prevent—, and on top of that
// a descriptor was left unclosed per slice. Here only the path is computed, so
// it can be said and passed along.
//
// CT_WATCH_GO_BIN follows the CT_ACCOUNT_*_DIR pattern: it changes NO decision,
// only which program is launched. It exists so that the tests can check that
// the watcher is launched with the right arguments without putting a real
// process to poll GitHub for eight hours.
// ============================================================================
function lanzarVigilanteDelGo(slice, sessionName) {
  // The gates come out of the slice exactly as the issue mapped it:
  // `resolveGatesForAgent` only looks at `gatesDeclared`/`gates`/`type`, and
  // the normalisation `sliceForKickoff` does is of `ac`/`issue`/`epic`. This
  // way it does not force the `plans` object to be widened.
  if (!resolveGatesForAgent(slice).includes('plan')) return
  const aviso = (por) => console.error(`  aviso: no se ha lanzado el vigilante del ${GO_TOKEN} de #${slice.n} (${por}) — el slice está lanzado y el gate sigue en pie, pero tendrás que empujar su sesión a mano tras dar el go.`)
  try {
    const bin = process.env.CT_WATCH_GO_BIN || ctWatchGoPath
    // `spawn(process.execPath, [bin, …])` with a `bin` that does not exist
    // does NOT fail: the executable is always `node`, so the process is born,
    // dies instantly with a module error, and without this check «watcher
    // launched» was announced with a pid that no longer existed. It is the
    // same class of defect F19/H1 closed in the dispatch —«cmux returned 0» is
    // not «the command ran»— with even weaker evidence: here the only thing
    // checked would be that `node` exists.
    if (!existsSync(bin)) return aviso(`el programa del vigilante no existe: ${bin}`)
    // THE NONCE IS DRAWN HERE AND NOWHERE ELSE (F38). This is the only process
    // of the loop that runs in the session of whoever dispatches, so it is the
    // only one that can hand them the nonce without writing it somewhere the
    // agent reads. It is registered BEFORE launching the watcher: if the
    // registration fails nothing is watched, because a watcher with no
    // registered commitment would be a go that starts the work and that
    // `--release` will not be able to honour afterwards.
    const nonce = newGoNonce(randomBytes(4))
    const goHash = goCommitment(nonce)
    const ctHome = { configDir: process.env.CLAUDE_CONFIG_DIR || null, home: homedir() }
    try {
      writeGoCommitment({ repo, issue: slice.n, commitment: goHash, ...ctHome })
    } catch (e) {
      return aviso(`no se ha podido registrar el go de este despacho (${e.message}) — sin registro, \`dispatch-check --release\` se negará (exit 9) porque no podrá comprobar el go. Registra uno con \`node <plugin>/scripts/ct-go.mjs --issue ${slice.n} --repo ${repo} --session ${JSON.stringify(sessionName)}\` y dale el go que imprima`)
    }
    const logPath = join(controlTowerLogDir({ configDir: process.env.CLAUDE_CONFIG_DIR || null, home: homedir() }), `watch-go-${slice.n}.log`)
    const hijo = spawn(process.execPath, [
      bin, '--issue', String(slice.n), '--repo', repo, '--session', sessionName, '--go-hash', goHash, '--log', logPath,
    ], { detached: true, stdio: 'ignore' })
    hijo.on('error', (e) => aviso(`fallo al arrancarlo: ${e.message}`))
    hijo.unref()
    console.log(`  vigilante del ${GO_TOKEN} de #${slice.n} lanzado (pid ${hijo.pid}) — cuando contestes el go en el issue, la sesión arranca sola. Log: ${logPath}`)
    emitGoNonce(slice.n, nonce)
  } catch (e) {
    aviso(e.message)
  }
}

async function waitForLaunchSentinel(sentinelPath, expectedCwd, budgetMs = launchSentinelTimeoutMs) {
  const deadline = Date.now() + budgetMs
  // An ASYNCHRONOUS loop (not a synchronous `Atomics.wait` like the stubs'):
  // every turn yields control to the event loop, so a Ctrl-C during the wait
  // is dispatched instead of staying pending until the end of the batch — the
  // same criterion as D5's checkpoints.
  for (;;) {
    let raw = null
    try {
      raw = readFileSync(sentinelPath, 'utf8')
    } catch {
      raw = null // ENOENT is the normal case while the shell starts up.
    }
    if (raw !== null) {
      const parsed = parseSentinel(raw)
      if (parsed) {
        const realpathOf = (p) => { try { return realpathSync(p) } catch { return null } }
        if (!parsed.claudeResolved) return { status: 'no-claude', cwd: parsed.cwd, waitedMs: budgetMs - Math.max(0, deadline - Date.now()) }
        if (!sameDir(parsed.cwd, expectedCwd, realpathOf)) return { status: 'wrong-cwd', cwd: parsed.cwd }
        return { status: 'ran', cwd: parsed.cwd }
      }
      // A HALF-written sentinel is indistinguishable from a corrupt one in a
      // single read, and the single-call `printf` makes it very unlikely — but
      // not impossible. While there is budget left it retries; if the budget
      // runs out with the file there and unparsed, that is 'garbled' and it is
      // said.
      if (Date.now() >= deadline) return { status: 'garbled', raw: raw.slice(0, 200) }
    }
    if (Date.now() >= deadline) return { status: 'never' }
    await sleep(LAUNCH_SENTINEL_POLL_MS)
  }
}

// ============================================================================
// F20/H1 — THE RESEND: THE ONLY THING THAT, MEASURED, TURNS 0/6 INTO 5/5.
//
// The full measurement is in the block of constants above. The summary: with
// F19's mechanism as it was, six consecutive launches against the real cmux
// gave ZERO sentinels (oh-my-zsh's prompt ate the `.`). With this resend —same
// line, same session, after waiting one attempt— five out of five started, all
// on the second attempt, and the agent was launched ONCE in each (counted on
// disk by the launcher itself).
//
// What is sent and what is NOT:
//   - EXACTLY the same line (`. '<launcher>'`) plus an Enter is sent. No
//     Ctrl-C, no Escape, no other "cleanup" key: cmux already sent Enter with
//     the first typing, so the corrupted line already ran (and dies in
//     "permission denied", because the launcher is not executable). Sending
//     signals blindly to a session that COULD have a live agent is exactly the
//     irreversible damage this round avoids.
//   - Before each resend the sentinel is looked at again. And if both lines
//     did arrive anyway, the launcher's idempotency guard means only the first
//     launches the agent.
//
// When it does NOT resend, and it says why:
//   - if there is no budget left (a short `CT_NEXT_LAUNCH_TIMEOUT_MS`);
//   - if the verdict is already CONCLUSIVE ('ran', 'no-claude', 'wrong-cwd'):
//     resending there would clarify nothing and could duplicate;
//   - if the session cannot be located by its title, or cmux gives no `ref`
//     for it. That is NOT swallowed: it travels in `retypeProblem` and comes
//     out in the message, because «the resend could not be addressed» and «it
//     was resent and it did not help» lead you to look in different places.
//
// Returns `{ ...verdict, retypes, retypeProblem }`.
async function awaitLaunchSentinelWithRetypes({ sentinelPath, expectedCwd, title, typedCommand }) {
  const totalDeadline = Date.now() + launchSentinelTimeoutMs
  let retypes = 0
  let retypeProblem = null
  for (;;) {
    const remaining = Math.max(0, totalDeadline - Date.now())
    const verdict = await waitForLaunchSentinel(sentinelPath, expectedCwd, Math.min(LAUNCH_ATTEMPT_MS, remaining))
    if (verdict.status !== 'never') return { ...verdict, retypes, retypeProblem }
    if (Date.now() >= totalDeadline) return { ...verdict, retypes, retypeProblem }
    // Locating the session by its title is the only way of addressing the
    // resend: `cmux send` needs a handle, and the one we have is the name we
    // gave it ourselves.
    const all = queryAllCmuxWorkspaces()
    const match = all === null ? null : all.find((w) => w.title === title)
    if (all === null) {
      retypeProblem = 'no se pudo consultar cmux para localizar la sesión y reenviarle la línea (¿daemon caído?)'
      return { ...(await waitForLaunchSentinel(sentinelPath, expectedCwd, Math.max(0, totalDeadline - Date.now()))), retypes, retypeProblem }
    }
    if (!match || !match.ref) {
      retypeProblem = match
        ? `la sesión "${title}" existe pero cmux no expuso un handle (\`ref\`) para ella, así que no se le pudo reenviar la línea`
        : `no se encontró ninguna sesión de cmux titulada "${title}" a la que reenviar la línea`
      return { ...(await waitForLaunchSentinel(sentinelPath, expectedCwd, Math.max(0, totalDeadline - Date.now()))), retypes, retypeProblem }
    }
    try {
      execFileSync('cmux', buildCmuxSendArgv({ workspace: match.ref, text: typedCommand }), {
        stdio: ['ignore', 'ignore', 'ignore'], timeout: CMUX_QUERY_TIMEOUT_MS, killSignal: 'SIGKILL',
      })
      execFileSync('cmux', buildCmuxSendKeyArgv({ workspace: match.ref }), {
        stdio: ['ignore', 'ignore', 'ignore'], timeout: CMUX_QUERY_TIMEOUT_MS, killSignal: 'SIGKILL',
      })
      retypes++
    } catch (e) {
      retypeProblem = `el reenvío de la línea a la sesión "${title}" (${match.ref}) falló: ${e.message}`
      return { ...(await waitForLaunchSentinel(sentinelPath, expectedCwd, Math.max(0, totalDeadline - Date.now()))), retypes, retypeProblem }
    }
  }
}

// retypeNote: the sentence that accompanies a launch that needed resends. It
// is said WHENEVER there was one, on the happy path too: a dispatch that
// started on the third attempt started fine, but that machine's login shell is
// eating what is typed at it, and that is exactly the fact that stopped
// existing when the problem became recoverable.
function retypeNote(retypes, retypeProblem) {
  const partes = []
  if (retypes > 0) {
    partes.push(`hizo falta REENVIAR la línea ${retypes} ${retypes === 1 ? 'vez' : 'veces'} a esa sesión: el primer tecleo de cmux no llegó a ejecutarse (el arranque del shell de login se come caracteres — un prompt de oh-my-zsh, un \`read\` en el rc). El agente se lanzó una sola vez: el script de arranque no relanza nada si su centinela ya existe.`)
  }
  if (retypeProblem) partes.push(`Además, ${retypeProblem}.`)
  return partes.length ? ` ${partes.join(' ')}` : ''
}

// stateReasonLabel (F13/H4): what the closure reason GitHub returns is called
// in the user's language. `null` (an issue closed before GitHub had
// `state_reason`, or without it) is NOT translated to "not planned": it is
// said that there is no record of it.
function stateReasonLabel(sr) {
  if (sr === 'NOT_PLANNED') return 'cerrado como "not planned"'
  if (sr === 'REOPENED') return 'cerrado con motivo "reopened"'
  if (sr == null) return 'cerrado sin motivo de cierre registrado'
  return `cerrado con motivo "${sr}"`
}

// ============================================================================
// F16/H1 — THE MEASURE OF A BLOCKING MESSAGE IS NOT WHETHER IT IS TRUE, IT IS
// WHETHER IT LEADS TO DOING SOMETHING USEFUL.
//
// The field finding: five issues occupied the global serialising lane and the
// dispatcher named one. Every sentence was literally true, and even so the
// whole message was a wrong instruction — a reasonable reader deduces "I
// remove that one and it goes", resolves it, runs again, and finds themselves
// just as blocked. Four times running.
//
// The rule that comes out of that, and which applies to EVERY explanation in
// this file: if discovering the N blockers would take repeating the cycle N
// times, they have to be said all at once. With the opposite care: forty
// issues listed are not actionable either. When the list grows, what is needed
// in order to DECIDE is the count (is it a wall or a pebble?), not the forty
// names — so a sample is listed and the total is NEVER kept quiet.
const MAX_BLOQUEANTES_LISTADOS = 8

// refsAcotadas: "#1, #2, #3" or "#1, …, #8 y 22 más". The total always comes out.
function refsAcotadas(ns) {
  const shown = ns.slice(0, MAX_BLOQUEANTES_LISTADOS).map((n) => `#${n}`)
  const rest = ns.length - shown.length
  return rest > 0 ? `${shown.join(', ')} y ${rest} más` : shown.join(', ')
}

// detalleDeHolders: the same capping, for --dry-run's inventories ("En
// vuelo", "Sin mergear, reteniendo tokens"). Before, they were dumped WHOLE:
// with thirty slices in review at the end of an epic, those two lines were a
// wall that pushed the very message explaining the block off the screen. The
// count goes in the line's own label, so trimming the enumeration does not
// hide the size of the problem.
function detalleDeHolders(holders) {
  const shown = holders
    .slice(0, MAX_BLOQUEANTES_LISTADOS)
    .map((i) => `#${i.n} [${((i.touches || []).length ? i.touches.map((t) => `touches:${t}`).join(', ') : 'sin touches')}]`)
  const rest = holders.length - shown.length
  return rest > 0 ? `${shown.join(', ')} … y ${rest} más` : shown.join(', ')
}

// motivoDeBloqueante: why THIS issue prevents the candidate from being
// dispatched. The two reasons are not mutually exclusive (a holder can share a
// token AND occupy the lane with a different token), so both are said when
// both apply — it is exactly the case in which resolving "the token" leaves
// the user hitting the lane on the next turn.
// The explanation of WHAT the serialising lane is is said ONCE, in the header
// note — not stuck to every line. Repeated five times (the real case that gave
// rise to this) it pushes off the screen the only thing that has to be read:
// the numbers and the count.
function motivoDeBloqueante(b, candN) {
  const partes = []
  if (b.sharedTokens.length) {
    partes.push(`retiene ${b.sharedTokens.map((t) => `'${t}'`).join(', ')}, que #${candN} también toca`)
  }
  if (b.laneTokens.length) {
    partes.push(`ocupa el carril serializante con ${b.laneTokens.map((t) => `touches:${t}`).join(', ')}`)
  }
  const estado = b.status ? `status:${b.status}` : 'estado desconocido'
  return `  - #${b.n} (${estado}) — ${partes.join('; y además ')}`
}

// formatColisionMultiple: the message when TWO OR MORE block. It is not the
// one-blocker message repeated N times: a candidate's list of blockers is a
// CONJUNCTION (they all have to be cleared), and that has to be said on the
// first line, before any detail — it is the part that changes what somebody is
// going to do next.
//
// The remedy is grouped by STATUS and not by blocker, because the remedy
// depends on the status and not on the issue: the `in-review` ones are cleared
// by merging (there is no agent to wait for), the `in-progress` ones are
// cleared by waiting (and there the stale-claim note does make sense). A lane
// with four in-review and one in-progress needs BOTH instructions, and the old
// message could only give one.
function formatColisionMultiple(reason, ctx) {
  const blockers = reason.blockers
  const candN = reason.issue
  const lineas = blockers.slice(0, MAX_BLOQUEANTES_LISTADOS).map((b) => motivoDeBloqueante(b, candN))
  const ocultos = blockers.length - lineas.length
  if (ocultos > 0) {
    lineas.push(`  … y ${ocultos} más (no se listan todos: para decidir aquí lo que cuenta es que son ${blockers.length}, no cuáles)`)
  }

  const enReview = blockers.filter((b) => b.status === 'in-review').map((b) => b.n)
  const enCurso = blockers.filter((b) => b.status === 'in-progress').map((b) => b.n)
  const sinEstado = blockers.filter((b) => b.status !== 'in-review' && b.status !== 'in-progress').map((b) => b.n)

  const remedios = []
  if (enReview.length) {
    remedios.push(`${enReview.length} en status:in-review (${refsAcotadas(enReview)}): trabajo entregado pero SIN MERGEAR, sin ningún agente detrás — esperar no sirve de nada. Lo único que suelta esos tokens es el MERGE de su PR (o cerrar el issue como completed si el PR ya se mergeó y nadie lo cerró porque le faltaba el "Closes #<n>"). \`--reopen\` NO suelta nada: deja el slice en status:in-progress reteniendo estos mismos tokens hasta que su trabajo se mergee.`)
  }
  if (enCurso.length) {
    remedios.push(`${enCurso.length} en status:in-progress (${refsAcotadas(enCurso)}): ahí sí hay (o debería haber) un agente vivo, y esperar es el remedio correcto.`)
  }
  if (sinEstado.length) {
    remedios.push(`${sinEstado.length} sin estado conocido (${refsAcotadas(sinEstado)}): compruébalos a mano.`)
  }

  // The stale-claim note ONLY for those that say they have a live agent (or
  // say nothing): in an in-review, having no worktree/branch/session is the
  // NORMAL thing and asking for it would turn every PR in review into a false
  // alarm — the same criterion the single-blocker case already applied. It is
  // capped at the same number as the list so as not to fire forty queries to
  // git/cmux for one message.
  const notas = ctx
    ? [...enCurso, ...sinEstado].slice(0, MAX_BLOQUEANTES_LISTADOS).map((n) => ctx.stalenessNoteFor(n)).filter(Boolean)
    : []
  const cola = notas.length ? `\nATENCIÓN, alguno de esos claims puede estar muerto: ${notas.join(' ')}` : ''

  // The lane note only appears if somebody blocks BY lane: if every blocker
  // shares a literal token, explaining the lane is noise.
  const hayCarril = blockers.some((b) => b.laneTokens.length)
  const notaCarril = hayCarril
    ? ` El carril serializante (migration/ci/pbxproj) es GLOBAL: basta con que #${candN} toque uno cualquiera de esos tres para chocar con TODO el que tenga otro, sin compartir token con nadie.`
    : ''

  return `#${candN} está ready con deps mergeadas, pero NO basta con desbloquear uno: ${blockers.length} issues retienen a la vez lo que necesita, y hasta que salgan TODOS seguirá sin poder despacharse — resolver uno solo te devolvería justo aquí en la vuelta siguiente, con otro nombre distinto.${notaCarril}\n${lineas.join('\n')}\nQué hace falta, por grupos: ${remedios.join(' ')}${cola}`
}

function formatReason(reason, ctx) {
  switch (reason?.reason) {
    case 'none-ready': {
      // F13: the message kept quiet about the slices stopped in
      // `status:in-review`. At the end of an epic that is the NORMAL state
      // —everything delivered, nothing merged— and "there is nothing to
      // dispatch yet" paints it as if nothing had been started. Besides, since
      // F13/H2 those issues RETAIN their tokens: they are the reason the next
      // thing does not come out, not a detail.
      // F16/H1, through the same lens: "there is nothing to dispatch YET" is
      // an instruction to WAIT, and with the whole epic in `status:backlog`
      // there is nothing to wait for — promoting backlog → ready is the loop's
      // HUMAN gate (ct-groom even reminds you of it when a groom finishes).
      // Nobody is going to open that gate if the dispatcher says it is not
      // time yet. Verified without fixing: three issues in backlog and ZERO
      // open issues produced the same text word for word, and their remedies
      // are opposite.
      const inReview = reason.inReview || []
      const backlog = reason.backlog || []
      const inProgress = reason.inProgress || []
      const total = reason.total
      // The prefix is kept literal in every branch: it is what keeps the
      // cause recognisable at a glance (and what W-B's pre-existing tests
      // pin down).
      const cabeza = 'No hay ningún issue en status:ready'
      if (total === 0) {
        return `${cabeza} — de hecho no hay NINGÚN issue abierto en este repo. Eso no es "el loop está al día", es "no hay nada que mirar": o el epic todavía no se ha groomeado (\`/ct-groom <spec> --repo <owner/repo>\`), o --repo apunta a un repo distinto del que crees. Comprueba las dos cosas antes de darlo por terminado.`
      }
      const partes = []
      if (backlog.length) {
        partes.push(`Hay ${backlog.length} en status:backlog (${refsAcotadas(backlog)}): eso NO se desbloquea esperando. Promover backlog → ready es el gate humano del loop —decides tú qué entra en vuelo— y hasta que lo abras no habrá nada que despachar: \`gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:backlog\`.`)
      }
      if (inReview.length) {
        partes.push(`Hay ${inReview.length} en status:in-review (${refsAcotadas(inReview)}): su trabajo está entregado pero SIN MERGEAR, así que ni desbloquea a sus dependientes (merge-after exige el merge) ni suelta sus tokens de área/touches. Mergea sus PRs (o, si un PR ya se mergeó y el issue sigue abierto, ciérralo como completed) — y si alguno se rechazó en revisión y vas a corregir encima, devuélvelo al banco de trabajo con \`node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --reopen\` (queda en status:in-progress: SIGUE reteniendo sus tokens, porque su trabajo sigue sin mergear — reabrir no desbloquea a sus vecinos, solo dice quién lo está rehaciendo).`)
      }
      if (inProgress.length) {
        partes.push(`Hay ${inProgress.length} en status:in-progress (${refsAcotadas(inProgress)}): con agente vivo, ahí sí toca esperar.`)
      }
      if (!partes.length) {
        // Neither backlog, nor in-review, nor in-progress, and yet there are
        // open issues: they are outside the loop. Say so, instead of letting
        // the short sentence read as "there is no work left".
        return `${cabeza}, y ninguno de los ${total} issue(s) abiertos está en ningún otro estado del loop (backlog/in-progress/in-review): están FUERA del loop, probablemente sin ninguna label \`status:\` — /ct-next no los ve. Si alguno debería despacharse, etiquétalo; si no, no hay nada que hacer aquí.`
      }
      return `${cabeza}. ${partes.join(' ')}`
    }
    case 'deps-unmet': {
      // D1 finding 2/5: two VERY different causes used to end up in the same
      // generic message ("falta mergear #X"), one of them printing the string
      // "#null" outright — instructing you to wait for something that does not
      // exist and is never going to be merged.
      //   - `malformed` (finding 2): the issue's "## Dependencias" section
      //     exists but no "merge-after #N" was recognised — almost certainly a
      //     human rewrite. The gate's state is UNKNOWN, not "no dependencies"
      //     (unmetDeps arrives empty on purpose from dispatch.js — see its
      //     comment).
      //   - a dependency that translated to `null` (finding 5,
      //     gh-issue-map.js#buildDispatchInput): the declared order
      //     corresponds to NO existing issue (neither open nor closed, nor in
      //     the issue's own epic) — it is never going to resolve itself by
      //     waiting, the data has to be fixed.
      const list = reason.blocked.map((b) => {
        if (b.malformed) {
          return `#${b.n} (la sección "## Dependencias" existe pero no se reconoció ningún "merge-after #N" en su contenido — probablemente reescrita a mano; tratado como NO despachable hasta que se corrija el texto, nunca como "sin dependencias")`
        }
        //   - F13/H4: a dependency whose issue is CLOSED but NOT as
        //     "completed" (typically "not planned", which is the correct thing
        //     for a discarded slice). `filterMergedIssues` only counts
        //     'COMPLETED', so that dep is NEVER going to satisfy itself — but
        //     the message said "falta mergear #7" just as if the work were
        //     still under way, and the dependant waited forever in silence.
        //     Now the real state is named along with the remedy, which here is
        //     NOT to wait but to decide: drop the dep, or reopen and close as
        //     completed if the work really was done.
        const depStates = reason.depStates || {}
        const deps = b.unmetDeps.map((d) => {
          if (d == null) {
            return 'una dependencia declarada contra un orden que no corresponde a ningún issue existente (¿"merge-after" a un slice que no existe, o que aún no se groomeó?) — nunca se resolverá sola con esperar; corrige el "merge-after" o el "ct-order" del issue referenciado'
          }
          if (Object.prototype.hasOwnProperty.call(depStates, d)) {
            return `#${d}, que está ${stateReasonLabel(depStates[d])} — una dep solo cuenta como satisfecha si su issue está cerrado como "completed", así que ESTA NO SE VA A SATISFACER NUNCA por sí sola: quita el "merge-after #<orden>" de la sección "## Dependencias" de #${b.n} si el slice se descartó, o reabre #${d} y ciérralo como completed si su trabajo sí se hizo`
          }
          return `#${d}`
        })
        return `#${b.n} (falta mergear ${deps.join(', ')})`
      }).join('; ')
      // The closing line CANNOT say "wait for them to be merged" when NONE of
      // the pending deps can be merged any more. Observed in a real run
      // against the sandbox: the detail said "ESTA NO SE VA A SATISFACER
      // NUNCA" and the closing line, three words later, "espera a que se
      // mergeen esas dependencias" — the message contradicted itself and the
      // last sentence is the one that sticks. `waitable` is true only if there
      // is at least one dep that really can be satisfied by waiting: an issue
      // still open (neither translated to null, nor closed without completing,
      // nor with an unreadable deps section).
      const depStatesTail = reason.depStates || {}
      const waitable = reason.blocked.some((b) => !b.malformed && (b.unmetDeps || []).some(
        (d) => d != null && !Object.prototype.hasOwnProperty.call(depStatesTail, d)
      ))
      const tail = waitable
        ? 'espera a que se mergeen esas dependencias, o corrige el issue si el bloqueo es por datos, no por trabajo pendiente.'
        : 'esperar NO va a desbloquear nada aquí: ninguna de esas dependencias puede satisfacerse sola. Corrige los issues como se indica arriba.'
      return `Hay slice(s) en status:ready pero con dependencias sin mergear o sin resolver: ${list} — ${tail}`
    }
    case 'collision': {
      // F13/H2 — TWO DIFFERENT BLOCKS UNDER THE SAME NAME. Ever since
      // `status:in-review` retains tokens (dispatch.js#collectTokenHolders),
      // "it collides with in-flight work" can mean two things with two
      // opposite remedies:
      //   - against an `in-progress`: there is (or should be) a live agent.
      //     "Wait for it to finish" is correct advice, and the staleness note
      //     serves to say when it is NOT.
      //   - against an `in-review`: there is NO agent. The work is delivered
      //     and waiting to be merged. "Wait for it to finish" would be absurd
      //     — what has to be done is merge the PR (or close the issue if the
      //     PR was merged already and nobody closed it, or reopen the slice if
      //     the review rejected it).
      //
      // And the staleness note is NOT asked for on an `in-review` (see
      // `holderStatus` below): that check looks for a worktree/branch/cmux
      // session, and on an already-delivered slice their absence is NORMAL,
      // not an anomaly. Asking for it there would turn every PR in review into
      // a false "orphaned claim" alarm — exactly the false positive staleness
      // detection was designed not to produce.
      //
      // `withIssueStatus` can be `null` when the caller did not supply the
      // status (old unit calls): in that case the previous behaviour is kept
      // (staleness note included) instead of asserting a status that is not
      // known.
      // F16/H1: if TWO OR MORE block, no message that names only one can be
      // honest — it goes down the branch that says them all. With ONE, the
      // usual message is kept word for word: adding "they all have to be
      // cleared" when "all" is one would be noise, and the F13/staleness tests
      // pin that literal text.
      // `blockers` may be missing in old unit calls to this function (which
      // only knew the attribution of one issue): in that case exactly the
      // previous behaviour is kept.
      if ((reason.blockers || []).length > 1) return formatColisionMultiple(reason, ctx)
      const holderStatus = reason.withIssueStatus ?? null
      const inReviewHolder = holderStatus === 'in-review'
      // Finding 2: `ctx?.stalenessNoteFor(reason.withIssue)` only does
      // something when `ctx` is supplied (always, from the real call site
      // below) — it is left optional so that this function's unit tests can
      // still call it with no context, without blowing up.
      const note = (ctx && !inReviewHolder) ? ctx.stalenessNoteFor(reason.withIssue) : null
      // The remedy for the in-review case, in a single place: the same text
      // serves both the token collision and the serialising one.
      const reviewHint = `#${reason.withIssue} está en status:in-review: su trabajo está entregado pero SIN MERGEAR, así que retiene sus tokens hasta el merge — ramificar ahora de la base te daría un árbol que todavía no lo contiene. NO hay ningún agente trabajándolo: esperar no sirve de nada. Mergea su PR; si su PR YA se mergeó y el issue sigue abierto (el PR no llevaba "Closes #${reason.withIssue}"), ciérralo como completed; si la revisión lo rechazó, \`node <plugin>/scripts/dispatch-check.mjs ${reason.withIssue} --repo <owner/repo> --reopen\` lo devuelve al banco de trabajo — OJO: eso NO te desbloquea, porque #${reason.withIssue} se queda en status:in-progress reteniendo estos mismos tokens hasta que su trabajo se mergee. Lo único que desbloquea es el merge (o abandonar #${reason.withIssue} del todo: borrar su rama y \`--requeue\`).`
      // "in flight" is only said of the `in-progress` case, where it is
      // literally true. For `in-review` the phrase would be false (nothing is
      // flying: it is parked waiting for a merge) — what is said instead is
      // "work delivered without merging".
      if (reason.kind === 'serializing') {
        if (inReviewHolder) {
          return `#${reason.issue} está ready con deps mergeadas, pero no se puede serializar: su touches:${reason.token} entra en el mismo grupo serializante (migration/ci/pbxproj) que touches:${reason.runningToken}, retenido por #${reason.withIssue} (status:in-review) — ${reviewHint}`
        }
        const base = `#${reason.issue} está ready con deps mergeadas, pero no se puede serializar: su touches:${reason.token} entra en el mismo grupo serializante (migration/ci/pbxproj) que touches:${reason.runningToken}, ya en vuelo en #${reason.withIssue}`
        return note ? `${base} — ${note}` : `${base} — espera a que termine.`
      }
      if (inReviewHolder) {
        return `#${reason.issue} está ready con deps mergeadas, pero colisiona con trabajo entregado sin mergear: comparte el token '${reason.token}' con #${reason.withIssue} (status:in-review) — ${reviewHint}`
      }
      const base = `#${reason.issue} está ready con deps mergeadas, pero colisiona con trabajo en vuelo: comparte el token '${reason.token}' con #${reason.withIssue} (status:in-progress)`
      return note ? `${base} — ${note}` : `${base} — espera a que termine, o resuelve el token.`
    }
    default:
      // Should not be reachable (see the reasoning in dispatch.js#explainNoSelection),
      // but we never silently print "undefined" on an unexpected input.
      return 'No hay slices despachables (nada ready con deps mergeadas y sin colisión).'
  }
}

function formatBlockReason(reason, cap, ctx) {
  if (reason?.reason === 'cap-full') {
    // The listing of exactly which issues are in flight can already be seen,
    // under --dry-run, in the "En vuelo" line printed just before (further
    // down); here all that is needed is the count and the cap, so that the
    // message is self-sufficient in the real run too (without --dry-run).
    const base = `El cap (${cap}) ya está copado por trabajo en vuelo: ${reason.inFlightCount} slice(s) en status:in-progress`
    // Minor 1 fix from the review: without `wouldDispatchIfCapAllowed`, this
    // message ALWAYS suggested "raise --cap", even when the candidate that
    // would be freed up would still be blocked by another cause (unmerged
    // deps, or a collision with what is already in flight) — raising the cap
    // in that case would change nothing, and asserting that it would is worse
    // than saying nothing.
    // F13/H3 — A DEAD CLAIM THAT OCCUPIES THE CAP WAS COMPLETELY INVISIBLE.
    // Stale-claim detection (round D3) was only consulted from the
    // 'collision' case: if the dead issue shares NO token with the candidate
    // but DOES occupy the only cap slot, the message was "raise --cap, or
    // wait for one of them to finish" — sending you to wait for an agent that
    // no longer exists, without a single hint. Verified against the unfixed
    // code with a fixture of #5 in-progress (no worktree, no branch, no cmux)
    // and #6 ready with different touches: the output contained no mention of
    // staleness at all.
    //
    // Now EVERY issue occupying the cap is crossed against the same local
    // evidence (worktree / branch / cmux session). Same cautions as in the
    // 'collision' case, because it is literally the same function: ONE signal
    // of life is enough for nothing to be said, and even with none,
    // "abandoned" is never asserted (the check is only about this machine).
    //
    // What this does NOT solve, and it is worth not pretending otherwise:
    // only whoever is running `/ct-next` at that moment finds out. There is
    // no daemon, no heartbeat, nothing watching the claims between
    // invocations — a claim that died at 3 AM stays dead until somebody
    // invokes the dispatcher. That is a limitation of the design (the claim is
    // a label), not a gap in this message, and it is said as such in the §9
    // contract ct-init seeds.
    const notes = ctx
      ? (reason.inFlight || []).map((i) => ({ n: i.n, note: ctx.stalenessNoteFor(i.n) })).filter((x) => x.note)
      : []
    const stale = notes.length
      ? ` ATENCIÓN, el cap puede estar copado por un claim muerto: ${notes.map((x) => x.note).join(' ')}`
      : ''
    if (reason.wouldDispatchIfCapAllowed) {
      return `${base} — sube --cap, o espera a que termine alguno.${stale}`
    }
    return `${base} — aunque subieras --cap no bastaría todavía: ${formatReason(reason.blockedEvenWithCap, ctx)}${stale}`
  }
  return formatReason(reason, ctx)
}

const usage = 'uso: ct-next.mjs --repo <o/r> [--cap N] [--base <rama>] [--dry-run]'
const repo = arg('--repo')
const capArg = arg('--cap', '1')
const baseArg = arg('--base')
const dryRun = has('--dry-run')

if (typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }
// The shape of `--repo` (D4, review of the value-carrying arguments): the rest
// of the script assumes `owner/repo` in several places at once (the identity
// guard against the remote, the account map, the URL of `gh api
// repos/<repo>/issues`). Before, any non-empty string got through: `--repo
// menoplus` reached `gh` and died with a 404 without explaining that the
// problem was the shape of the argument, and `repo.split('/').pop()` produced
// a "repo name" that was the whole slug.
if (!parseRepoSlug(repo)) {
  console.error(`--repo inválido: "${repo}" — debe tener la forma owner/repo (p.ej. josemerca/control-tower), con exactamente una barra y ambas mitades no vacías.`)
  process.exit(2)
}
// D4, defect 2: `parseInt(capArg, 10)` silently accepted a value DIFFERENT
// from the one the user wrote — `--cap 1e3` dispatched 1, `--cap 3perros`
// dispatched 3, `--cap 2.9` dispatched 2 (verified by construction against the
// unfixed code, all three without a single line of warning). See
// scripts/argnum.js for why each shape is rejected. The range and the "is not
// an integer" are distinguished in the message on purpose: they are two
// different errors with two different corrections.
const cap = typeof capArg === 'string' ? parseStrictInt(capArg) : null
if (capArg === true || cap === null) {
  console.error(`--cap inválido: "${capArg === true ? '(sin valor)' : capArg}" — debe ser un entero en dígitos decimales a secas (nada de "1e3", "2.9", "3perros", espacios, ni signo "+"/"-": antes se aceptaban en silencio con un valor distinto del pedido, y el signo se aceptaba pese a que este mismo mensaje decía lo contrario).`)
  process.exit(2)
}
if (cap < 1) {
  console.error(`--cap inválido: "${capArg}" — debe ser >= 1 (un cap de ${cap} no despacharía nada).`)
  process.exit(2)
}
// --base <branch>: same validation pattern as --repo/--cap (`arg()` already
// returns `true`, not a string, when the flag is the last token or is followed
// by another flag) — a dangling `--base` must never slip through to `git
// worktree add`/the seeded SLICE.md as the literal string "true".
// Round 1 fix, Minor 1 (W-D review): just like --repo (`repo.length === 0`),
// an EMPTY string is rejected here too — without this, `--base ''` passes the
// `typeof` check and slips all the way to `git worktree add … ''`, where it
// fails late with an internal git error instead of with the exit 2 and clear
// message that every other misplaced-flag case does have.
if (baseArg !== undefined && (typeof baseArg !== 'string' || baseArg.length === 0)) {
  console.error(`--base inválido: "${baseArg === true ? '(sin valor)' : baseArg}" — falta el nombre de la rama (¿--base al final de la línea, seguido de otro flag, o con un valor vacío?)`)
  process.exit(2)
}

// CT_NEXT_FIXTURE is for tests only (see
// __tests__/ct-next-dryrun.test.js). Same pattern as T7 (dispatch-check.mjs)
// for the same danger: if it is left dangling in the environment WITHOUT
// --dry-run, the script must NOT decide with fabricated data nor, above all,
// create a real worktree / seed SLICE.md / launch cmux with that invented
// state. It is treated as a usage error and we abort BEFORE touching gh or the
// filesystem.
if (process.env.CT_NEXT_FIXTURE && !dryRun) {
  console.error('CT_NEXT_FIXTURE está definido pero falta --dry-run: por seguridad no se decide ni se lanza nada real con datos de fixture. Añade --dry-run o limpia la variable de entorno.')
  process.exit(2)
}
// Tied down in the read itself too (defence in depth): `fx` can only be
// non-null when `dryRun` is true.
const fx = (dryRun && process.env.CT_NEXT_FIXTURE) ? JSON.parse(process.env.CT_NEXT_FIXTURE) : null

// ============================================================================
// F16/H2 — THE CHANNEL CRITERION, ONE AND THE SAME FOR THE PLUGIN'S THREE
// EXECUTABLES (ct-next.mjs, ct-groom.mjs, dispatch-check.mjs).
//
//   STDOUT = the PRODUCT. What the command produced or decided, and that
//            somebody might want to capture, redirect or parse: the dispatch
//            plan (`git worktree add …`, the kickoff, the `cmux` line), the
//            selection, the block reason, the record of what was launched. In
//            ct-groom, the plan's JSON and the minutes of what was created; in
//            dispatch-check, the result of the claim protocol
//            (`claimed #N → in-progress`).
//   STDERR = the DIAGNOSIS. Everything aimed at the human ABOUT the run, not
//            the result of the run: `aviso:`, `recordatorio:`, `ATENCIÓN:`,
//            and any abort message.
//
// WHAT WAS BROKEN, verified in the field: `warn()` emitted
// `console.log(\`aviso: …\`)` — to stdout — while ct-groom.mjs's equivalent
// warnings go through `console.error`. A run of /ct-next with warnings on the
// screen left 0 BYTES on stderr. Two real consequences, not theoretical ones:
// the diagnosis got mixed into the output somebody might capture (`/ct-next
// --dry-run > plan.txt` carried the warnings off inside the plan), and anyone
// capturing stderr expecting the warnings —because that is how /ct-groom
// works— received nothing.
//
// WHAT THIS CHANGE CANNOT BREAK, and does not break:
//   - D5: a broken output destination (`ct-next | head` → EPIPE) NEVER decides
//     the protocol's outcome. `console.error` goes to the same
//     `process.stderr` that already has its `on('error')` handler installed at
//     the top of this file (next to stdout's), so an EPIPE on a warning is
//     swallowed just as before. The exit code still describes what happened to
//     the WORK. There are tests that pin it
//     (ct-next-exit-code-contract.test.js).
//   - The truncation to 64 KiB: the 'exit' handler's recap still uses
//     `writeSync(2, …)` — it is still the only write that happens INSIDE an
//     'exit', where anything asynchronous never makes it out. This change does
//     not touch it; in fact warning and recap now share an fd, which is the
//     coherent thing.
//
// D4 — accumulated warnings. A warning is something that does NOT stop you
// carrying on but that the human has to see: it is printed at the moment (so
// that it appears in the context where it happens) AND accumulated, so that a
// --dry-run can be closed by explicitly saying it exited 0 IN SPITE OF N
// warnings. Without that recap, three warnings in the middle of forty lines of
// plan and an exit 0 at the end read, quite rightly, as "all good".
const warnings = []
function warn(msg) {
  warnings.push(msg)
  console.error(`aviso: ${msg}`)
}
// The recap lives in an 'exit' handler and not at the end of the file on
// purpose: this script ends in MANY different `process.exit()`s (a block with
// no selection, preconditions, a stuck claim, a signal…), and a recap placed
// "at the end" would only be printed on the happy path — precisely the one
// where it is least needed. `writeSync` and not console.log because inside an
// 'exit' handler only SYNCHRONOUS writes make it out (the same reason, already
// documented in attemptClaim, why process.stdout is asynchronous towards a
// pipe on POSIX).
process.on('exit', (code) => {
  if (!warnings.length) return
  const lines = warnings.map((w, i) => `  ${i + 1}. ${w}`).join('\n')
  const what = dryRun ? 'este --dry-run' : 'esta corrida'
  const nuance = code === 0
    ? 'un exit 0 aquí significa "no se ha roto nada", NO "todo es como esperas" — lee los avisos antes de darlo por bueno'
    : 'los avisos siguen siendo relevantes, además del fallo que provocó ese exit code'
  try {
    writeSync(2, `\n${what} terminó con exit ${code} A PESAR de ${warnings.length} aviso(s); ${nuance}:\n${lines}\n`)
  } catch {
    // stderr closed (e.g. the caller's pipe no longer exists): a recap that
    // cannot be written must not turn a clean exit into a crash.
  }
})

// F35 — this is where Claude's ACCOUNT used to be resolved (ACCOUNT_MAP ->
// CLAUDE_CONFIG_DIR + the wrapper's binary), with its validation of the map at
// start-up and four warnings: account resolved, fallback with no pattern,
// conflict between patterns, and reclassification with respect to the old map.
// All of it gone: the loop no longer evaluates which account does what. What
// remains is ONE executable name, which is the only thing the launcher needs
// for its `command -v` (see launch-sentinel.js).
const agentBin = AGENT_BIN

// findInPath: is there an executable with this name in THIS process's PATH?
// It is resolved by READING the filesystem (existsSync + X_OK), never by
// running the binary nor by asking it for its version: `cmux` in particular
// must NEVER be run to check that it is there (launching a real workspace is
// exactly what a --dry-run promises not to do). Returns the path found, or
// null.
function findInPath(name) {
  const raw = process.env.PATH || ''
  for (const dir of raw.split(pathDelimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    try {
      if (!statSync(candidate).isFile()) continue
      accessSync(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // does not exist, is not a file, or is not executable: next directory.
    }
  }
  return null
}
// ============================================================================

// Explicit maxBuffer (finding 7 of the final review): Node's default for
// execFileSync is 1 MiB, and the enumerations below no longer carry `--limit`
// (see finding 2) — a repo with a few hundred issues, each with its body, can
// exceed 1 MiB of JSON easily. Node aborts noisily if it is exceeded (it does
// not truncate silently), so the danger is not data corruption but the command
// becoming unusable against a real repo. 20 MiB is generous for thousands of
// issues/PRs with a full body without really being "no limit" (a genuine
// runaway would still abort).
const GH_MAX_BUFFER = 20 * 1024 * 1024
// timeout+killSignal (finding 1): see the big comment block further up,
// defence 2 — without this, a hung `gh` (a half-fallen network, an auth that
// does not answer) would block this script indefinitely, and no signal handler
// could rescue it if the signal only reaches this process.
const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: GH_MAX_BUFFER, timeout: childTimeoutFor(), killSignal: 'SIGKILL' })

// detectDefaultBranch (W-D): before this change, ct-next.mjs blindly assumed
// "main" both in `git worktree add ... main` and in the `base: 'main'` of the
// seeded SLICE.md. In a repo whose real default branch is different (e.g.
// "master", or any other convention) that failed confusingly (worktree add
// against a branch that does not exist), or worse, seeded a SLICE.md with a
// `base` that lies about the real branch.
//
// It is resolved via `gh repo view --json defaultBranchRef`: that is the
// authoritative source (the default branch as it is configured on GitHub NOW),
// not a local copy that can go stale if the default branch changed after the
// clone — the same reason the rest of this file (and dispatch-check.mjs)
// prefer the live REST endpoint to a local index/cache (`gh search`/`gh issue
// list`). Alternatives considered and discarded: `git symbolic-ref
// refs/remotes/origin/HEAD` is purely local (no network) but only exists if
// somebody ran `git remote set-head origin -a` (not always true after a clone)
// and can go stale without warning; `git remote show origin` IS authoritative
// but does a full fetch of the remote's refs just to read one line of text to
// parse, slower than a targeted JSON call. ct-next.mjs ALREADY requires the
// network for `gh` on the real path (readDispatchInput), so this does not add a new
// dependency.
//
// If it cannot be determined (gh down, no network, a repo with no readable
// default branch), we abort with a clear message pointing at `--base` as the
// way out — we NEVER silently assume "main": that is exactly the bug being
// fixed.
function detectDefaultBranch(repoSlug) {
  let out
  try {
    out = gh(['repo', 'view', repoSlug, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name']).trim()
  } catch (e) {
    console.error(`no se pudo determinar la rama por defecto de ${repoSlug}: ${e.message}. Usa --base <rama> para indicarla explícitamente si ya sabes cuál es.`)
    process.exit(1)
  }
  // Round 1 fix, Minor 3 (W-D review): besides the empty string
  // (`.defaultBranchRef` absent/null in the JSON), we also reject the literal
  // "null" — if `.defaultBranchRef.name` did not exist and `-q` (jq) emitted
  // it as the string "null" instead of an empty string, this guard would let
  // it through as if it were a real branch name.
  if (!out || out === 'null') {
    console.error(`no se pudo determinar la rama por defecto de ${repoSlug}: "gh repo view" no devolvió ningún nombre de rama utilizable (salida: ${JSON.stringify(out)}). Usa --base <rama> para indicarla explícitamente.`)
    process.exit(1)
  }
  return out
}

// THE BASE COMES FROM THE REMOTE, NOT FROM THE LOCAL COPY (Step 1 of the spec
// of the first run in somebody else's repo, 20 Aug 2026).
//
// This used to be `verifyBaseExistsLocally`: it checked that the resolved name
// existed IN THE CHECKOUT, preferring the local branch and looking at
// `origin/<branch>` only if the local one was not there. It closed a real
// failure (a `--base` with a typo burned a whole claim/revert cycle), and it
// opened a worse one, measured in the field: the local branch can exist AND BE
// OLD.
//
// jjponz/rust-monitoring#10. The slice's worktree came off a local `main` that
// was one commit behind its remote, because another pull request had merged
// nineteen minutes earlier. From there, in a chain: the plan was written
// quoting verbatim an AGENTS.md that was no longer the base's, the pull request
// was born in conflict, and because of the conflict GitHub could not compute
// its merge ref and NOT ONE CHECK STARTED. The slice's acceptance criterion was
// "continuous integration runs the four commands on every pull request", and it
// was delivered without that ever having been demonstrated.
//
// So the local copy stops deciding. `git fetch origin <base>` is run and the
// worktree is cut from `origin/<base>`: the only thing that can be stale —a
// local branch nobody updated— is taken out of the equation instead of being
// diagnosed. The fetch is NOT optional and its failure is terminal: without it
// there is no knowing whether the base is up to date, and dispatching without
// knowing is exactly what happened in that run.
//
// What does NOT change: the branch name. `base:` in the slice's seed is still
// `main` and not `origin/main`, because that is where `gh pr create`'s `--base`
// comes from, and it does not accept a remote branch. What changes is where the
// worktree COMES FROM, not what the pull request is opened against.
function fetchAndVerifyBaseOnRemote(base) {
  try {
    // timeout+killSignal like the rest of this file's blocking calls (finding
    // 1). Unlike the others, this one DOES touch the network: it is the only
    // point of the dispatch that does so with git.
    execFileSync('git', ['fetch', 'origin', base], { cwd: repoRoot, stdio: 'ignore', timeout: childTimeoutFor(), killSignal: 'SIGKILL' })
  } catch (e) {
    console.error(`no se pudo hacer \`git fetch origin ${base}\` en ${repoRoot} (${e.message}). El worktree del slice se corta de origin/${base}, así que sin fetch no se puede saber si la base está al día — y un slice que nace por detrás de su remoto acaba en una pull request en conflicto, que GitHub deja sin ningún check. Arréglalo (¿red? ¿remote origin? ¿credenciales?) y reintenta: NO se ha reclamado nada.`)
    process.exit(1)
  }
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `origin/${base}^{commit}`], { cwd: repoRoot, stdio: 'ignore', timeout: childTimeoutFor(), killSignal: 'SIGKILL' })
  } catch {
    console.error(`la rama base "${base}" no existe en el remoto: tras el fetch, origin/${base} no resuelve a ningún commit. Revisa el nombre (¿--base con un typo?) o pasa --base <otra-rama> que exista en origin.`)
    process.exit(1)
  }
}

// Repo identity guard (finding 1 of the final review, the gravest of the whole
// revision): `repoRoot` (further down) comes from `git rev-parse
// --show-toplevel` in the cwd the session started in — which may have NOTHING
// to do with `--repo`. Without this guard, running `/ct-next --repo
// other-org/other-repo` from a control-tower session creates `feat/<n>` +
// `.worktrees/<n>` INSIDE control-tower, seeds a SLICE.md there and launches
// an agent with a kickoff saying it is implementing a slice of
// other-org/other-repo. We resolve the checkout's real identity via `git
// remote get-url origin` — not `gh repo view --json nameWithOwner`: that fires
// a network call just to read something `git remote` already knows locally,
// and besides `gh repo view` internally depends on the remote too to resolve
// the default repo — and we abort if it does not match, or if we cannot verify
// it (a repo with no `origin` remote: we treat that as "not verifiable", never
// as "carry on unchecked", the same criterion the rest of the script uses for
// any read failure). It applies both on the real path and under --dry-run (see
// the `else` further down, which covers both): a --dry-run already requires
// being inside a real git repo in order to resolve `repoRoot` (that is not
// new, it did so before this fix), so the guard adds no new environment
// requirement to --dry-run — it only closes the gap of a --dry-run printing,
// with complete confidence, a plan (worktree paths, kickoff) that actually
// corresponds to a repo other than the one the human believes they are looking
// at. A --dry-run that validates LESS than the real run would be exactly the
// trap this guard exists to avoid.
function ensureRepoIdentity(root, expectedRepo) {
  let originUrl
  try {
    originUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL' }).trim()
  } catch (e) {
    console.error(`no se pudo verificar que ${root} es el checkout de ${expectedRepo}: no tiene remote "origin" (${e.message}). Por seguridad, ct-next.mjs NO continúa — podría estar corriendo dentro del repo equivocado (p.ej. una sesión de control-tower en vez de ${expectedRepo}). Añade un remote origin que apunte a ${expectedRepo}, o ejecuta ct-next.mjs desde el checkout correcto.`)
    process.exit(1)
  }
  const m = originUrl.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (!m) {
    console.error(`no se pudo interpretar el remote "origin" de ${root} ("${originUrl}") como un repo de GitHub owner/repo. Por seguridad, ct-next.mjs NO continúa.`)
    process.exit(1)
  }
  const actualRepo = `${m[1]}/${m[2]}`
  if (actualRepo.toLowerCase() !== expectedRepo.toLowerCase()) {
    console.error(`--repo ${expectedRepo} no coincide con el checkout local en ${root} (remote origin → ${actualRepo}). Aborta: ejecuta ct-next.mjs desde un checkout de ${expectedRepo}, o corrige --repo.`)
    process.exit(1)
  }
}

let repoRoot
let resolvedBase
let resolvedBaseSha = ''
// Round 1 fix, Minor 2 (W-D review): it tells apart "the value of
// resolvedBase comes from the fixture's synthetic filler" (never really
// resolved, neither against GitHub nor against the local checkout) from "it
// comes from a real resolution" — so that the --dry-run banner does not assert
// "resolved" about a value that was not resolved.
let baseIsFixtureDefault = false
if (fx) {
  // Only used to build strings on the --dry-run branch (the fixture is tied to
  // --dry-run further up): it never reaches a real `git worktree add`, so it
  // does not go through (nor does it need to go through) the identity guard
  // above nor the local check that the base branch exists (further down) —
  // this path is entirely synthetic by design.
  repoRoot = '/tmp/fake-repo'
  // --base still wins even with a fixture (the same order of precedence as the
  // real path, further down). With no override, "main" is a purely synthetic
  // filler for offline tests — it never touches a real `gh repo view` or a
  // real `git`, so it does not reintroduce the bug this change fixes (assuming
  // "main" against a REAL repo). (Round 1 fix, Minor 2: the `fx.base` that
  // used to be here was removed — no test fixture set it and no test covered
  // it, it was dead code.)
  if (typeof baseArg === 'string') {
    resolvedBase = baseArg
  } else {
    resolvedBase = 'main'
    baseIsFixtureDefault = true
  }
} else {
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL' }).trim()
  } catch (e) {
    console.error(`no se pudo resolver la raíz del repo git local: ${e.message}`)
    process.exit(1)
  }
  ensureRepoIdentity(repoRoot, repo)
  resolvedBase = typeof baseArg === 'string' ? baseArg : detectDefaultBranch(repo)
  // Step 1: fetch and verification AGAINST THE REMOTE before the dispatch loop
  // — see fetchAndVerifyBaseOnRemote's comment.
  fetchAndVerifyBaseOnRemote(resolvedBase)
  // F22: resolved ONCE, here, where fetchAndVerifyBaseOnRemote has just proved
  // the ref exists. If it failed even so, we carry on with an empty string:
  // the seed treats it as "no last_commit" and the hook keeps quiet, which is
  // the behaviour from before this change — degrading is acceptable, lying is
  // not.
  try {
    resolvedBaseSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `origin/${resolvedBase}^{commit}`], {
      cwd: repoRoot, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    }).trim()
  } catch {
    console.error(`aviso: no se pudo resolver "origin/${resolvedBase}" a un sha concreto, así que la semilla del slice irá sin \`last_commit\`. El hook de cierre de turno no podrá avisar al agente de que su estado se ha quedado atrás.`)
  }
}

// F17 — THE TRAP THAT TURNS AN OBEDIENT AGENT INTO THE VERY SAME DEADLOCK.
//
// The kickoff already asks for `Closes #N` in the PR body (kickoff.js), which
// is what closes the issue on merge and with that releases its tokens and
// satisfies its dependents. But GitHub's closing keywords ONLY close the issue
// when the PR is merged into the repo's DEFAULT branch.
//
// VERIFIED IN THE FIELD against josemerca/ct-loop-sandbox (28-Jul-2026), not
// deduced from the documentation:
//   - PR #33, `Closes #31` in the body, merged with base `f17-base` (a branch
//     that is NOT the default) → issue #31 ended up as
//     {"state":"OPEN","stateReason":""};
//   - PR #34, `Closes #32` in the body, merged with base `main` (the default
//     branch) → issue #32 ended up as
//     {"state":"CLOSED","stateReason":"COMPLETED"}.
//
// That is: with `--base <another-branch>`, an agent that obeys the kickoff to
// the letter leaves the issue open and the lane blocked JUST THE SAME. And it
// is worse than not knowing: whoever reads the remedy the dispatcher gives
// ("the PR was missing the Closes #N") will look at the PR, see the `Closes
// #N` right there, and discard the correct diagnosis.
//
// Why a conditional warning and not a check: knowing whether `resolvedBase` is
// the default branch requires asking GitHub, and `detectDefaultBranch` is only
// called when there is NO `--base` (precisely the case in which the warning is
// unnecessary, because then the base IS the default branch by construction).
// Adding that call here would put a network dependency —and an abort path— in
// the one branch that today does not need it, in order to decide the text of a
// warning. The warning is emitted only when somebody passes `--base` on
// purpose, which is exactly when it needs reading: low noise, high value.
if (typeof baseArg === 'string') {
  warn(`--base ${resolvedBase}: si "${resolvedBase}" NO es la rama por defecto de ${repo}, el \`Closes #<n>\` que el kickoff le pide al agente NO cerrará su issue al mergear el PR — GitHub solo aplica las closing keywords cuando el PR entra en la rama por defecto (verificado contra un repo real, no deducido de la documentación). Con esta base, cerrar cada issue como *completed* al mergear su PR es un paso A MANO (\`gh issue close <n> --repo ${repo} --reason completed\`): si no se hace, el slice retiene sus tokens de \`area:\`/\`touches:\` indefinidamente y ningún dependiente con \`merge-after\` sobre él lo ve satisfecho nunca.`)
}

function readDispatchInput() {
  if (fx) return fx
  // The paginated read of open/closed issues lives in scripts/loop-issues.js,
  // shared with other commands: the same two `gh api ... --paginate --slurp`
  // blocks, the same comments, the same normalisation of state_reason.
  const { abiertos, cerrados, motivos } = loadIssues({ repo, gh })
  // The same criterion as always, and /ct-next's behaviour does not change: a
  // failed read is NOT degraded to "there are no issues". We abort with the
  // message that names which read failed. The only thing `loadIssues`'s new
  // contract adds (returning what is partial instead of throwing) is that if
  // BOTH fail, both are said, instead of only the first: this dispatcher is
  // going to mutate things, so any reason is reason enough not to carry on.
  if (motivos.length) {
    console.error(motivos.join('\n'))
    process.exit(1)
  }
  return buildDispatchInput(abiertos, cerrados)
}

// formatOrderCollisions (D1 finding 1, the gravest of the dispatch hardening —
// hardened in the review, finding 4): `orderCollisions`
// (gh-issue-map.js#buildOrderIndex, via buildDispatchInput) is non-empty when
// two DIFFERENT issues share the same `<!-- ct-order:N -->` inside the SAME
// epic (the same milestone, or both with no milestone) — an accidental
// re-groom, or two epics sharing a milestone by mistake (e.g. neither passed
// `--milestone` and both landed in the default title "Epic"). Refusing to
// resolve this silently is still the right direction — what this wrapper NO
// LONGER does is abort the WHOLE batch: the affected epic already arrives
// EXCLUDED from `issues` (buildDispatchInput, same reason documented there —
// with the order indexed over closed issues too, a collision that lived only
// among issues merged long ago bricked the WHOLE repo forever). All that is
// left here is to warn, ALWAYS (never silently), about which epic was left out
// and why, while the rest of the repo is dispatched as normal.
function formatOrderCollisions(collisions) {
  return collisions.map((c) => {
    const epicLabel = c.epicKey === NO_MILESTONE_KEY ? 'issues sin milestone asignado' : `el milestone #${c.epicKey}`
    return `aviso: colisión de orden — el marcador <!-- ct-order:${c.order} --> aparece en más de un issue de ${epicLabel} (${c.issues.map((n) => `#${n}`).join(', ')}). Ese epic queda EXCLUIDO de esta tanda (ni se despacha ni cuenta en vuelo) hasta que se corrija — el resto del repo se despacha con normalidad. ¿Re-groom accidental sobre el mismo milestone, o dos epics compartiendo milestone por no haber pasado --milestone?`
  })
}

// formatStatusAmbiguityWarnings (D1 finding 3): one warning, ALWAYS printed
// (not only under --dry-run: it is a signal of broken data, not of the
// dispatch plan) — never silently — for each issue carrying more than one
// `status:` label at once. gh-issue-map.js#mapGhIssue has already resolved a
// deterministic value independent of the array's order (in-progress >
// in-review > ready > backlog); this warning is ONLY so that a human corrects
// the labels by hand and the ambiguity does not repeat on the next run.
function formatStatusAmbiguityWarnings(issues) {
  return issues
    .filter((i) => i.statusAmbiguous)
    .map((i) => `aviso: #${i.n} tiene más de una label "status:" a la vez (${(i.statusLabels || []).map((s) => `status:${s}`).join(', ')}) — probablemente una edición a medias. Resuelto de forma conservadora a "status:${i.status}" (in-progress > in-review > ready > backlog), sin depender del orden en que gh/GitHub devuelve las labels. Corrige las labels a mano para dejar solo una.`)
}

// formatStrayDepsWarnings (D1 finding 1, review follow-up): narrowing the
// dispatcher's deps domain to "## Dependencias" (D1 finding 2) opened a door
// that `main` kept shut — verified by the review with the same fixture both
// ways: a `merge-after #N` outside the section (e.g. under "## Descripción")
// NO LONGER gates the dispatch. It is the correct and desired narrowing, but
// before this warning it was invisible — an issue was dispatched silently
// without anyone knowing that its intended dependency lives in the wrong place
// and stopped counting. gh-issue-map.js#mapGhIssue exposes `strayDeps` for
// exactly this; this warning never blocks the dispatch (the decision to narrow
// the domain is already taken and is correct) — it only informs.
function formatStrayDepsWarnings(issues) {
  return issues
    .filter((i) => (i.strayDeps || []).length > 0)
    .map((i) => `aviso: #${i.n} tiene "merge-after ${i.strayDeps.map((d) => `#${d}`).join(', ')}" fuera de la sección "## Dependencias" — desde el hardening del dispatch, esto YA NO cuenta como dependencia real (se despacha igual). Si se pretendía como tal, muévelo dentro de la sección "## Dependencias", o bórralo si ya no aplica.`)
}

// ============================================================================
// F18/H2 — the residue of `status:` labels on CLOSED issues.
//
// ONE SINGLE AGGREGATED WARNING, and that is the design decision that matters.
// The rate measured in a production repo is 10 out of 99 closed (see
// gh-issue-map.js#closedWithLiveStatus's comment): one warning per issue would
// be ten lines on EVERY run, forever, because nobody cleans labels off closed
// issues. A warning that comes out ten times is read by nobody, and that is
// the same as not warning at all. One line, with the numbers grouped by state
// and the remedy.
//
// `status:in-review` is NOT counted as an anomaly, and that is not an
// oversight: closing a slice from `in-review` is the NORMAL end of the flow
// (`backlog → ready → in-progress → in-review → closed`) and NOTHING in the
// loop removes that label on closing — not `dispatch-check.mjs`, not the hook,
// not GitHub. Reporting it as a contradiction would turn every properly
// finished slice into a false alarm. But its count DOES come out: the first
// field measurement counted 6 out of 10 precisely because it left the four
// `in-review` ones out, and a total that hides part of what it has seen is the
// kind of datum that gets rediscovered two rounds later.
//
// The order of the groups is that of the CONSEQUENCE, not that of the flow:
// first `ready` (the one that dropped out of the dispatch queue: the case
// lived through in the field), then `in-progress` (claims that were never
// released), and the rest at the end.
//
// ============================================================================
// F19/H2 — WHAT F18 LEFT OPEN: THE WARNING WAS CORRECT BUT STATIC.
//
// The field judgement, which is shared here: «I am going to skip it from the
// third run onwards, and not because of how it is written but because it is
// static». Those ten cases do not change on their own, so the paragraph is
// printed identically on every run until somebody cleans up — and a warning
// that does not change stops being read. Then, the day a NEW one appears in
// the list, it is not seen. It is a third way of dying, different from the
// unsatisfiable wall (F14) and from noise by volume (F16): repetition with no
// novelty.
//
// TWO FIXES, and neither of them is "write it better":
//
//  1. THE SEVERITY GRADIENT THAT WAS FLATTENED. The three states carried equal
//     weight inside the aggregate, and they are not equal:
//       - `ready`       → it dropped out of the dispatch queue SILENTLY. It is
//                         F18's original finding and the only one that can
//                         explain «why is this not being dispatched?».
//       - `in-progress` → a claim that was never released. It does not block
//                         the dispatch (the dispatcher only looks at open
//                         issues) but it leaves a worktree and a branch on
//                         disk and dirties every audit.
//       - `blocked` and
//         anything else → INERT. It retains nothing, blocks nothing, matters
//                         to nobody. It comes out as a count, just like the
//                         `in-review` ones, and does NOT inflate the headline.
//                         A headline that counts the inert alongside the
//                         grave teaches you to discount the whole thing.
//
//  2. ONE ACKNOWLEDGEMENT PER CASE, reusing F14's mechanism
//     (`.agent/conventions-ack.md`, see scripts/conventions.js#ACK_SET_IDS),
//     which solves exactly this: «I have seen and decided this, keep quiet
//     about these particular numbers and carry on warning about the new
//     ones». Without it, the only way to silence the warning is to clean
//     labels off closed issues that maybe nobody wants to clean — that is,
//     another wall.
//
// The property that remains: the warning only appears when it has something
// that has NOT already been said. If nothing changes and everything is
// acknowledged, it does not come out.
//
// repoAckOnce: the target repo's acknowledgement, read ONCE per run and shared
// by its two consumers (this warning and the conventions one). It is not just
// saving a readFileSync: two independent reads of the SAME file are two
// criteria that can diverge silently, which is exactly the class of failure
// this plugin has spent several rounds closing. In fixture mode nothing is read
// (a synthetic repoRoot) and nothing is silenced: "it has not been looked at"
// never turns into "there are no acknowledgements".
let ackCache = null
function repoAckOnce() {
  if (ackCache) return ackCache
  if (fx) {
    ackCache = { acks: new Map(), problems: [], unreadable: null, prosaSinAcuses: false }
    return ackCache
  }
  try {
    ackCache = readAck(repoRoot)
  } catch (e) {
    // Same as in formatConventionWarnings: the read blowing up cannot bring a
    // dispatch down, and it cannot pass for "there are no acknowledgements"
    // either — the `unreadable` travels and whoever prints it says so.
    ackCache = { acks: new Map(), problems: [], unreadable: e.message, prosaSinAcuses: false }
  }
  return ackCache
}
// ackedResidueNumbers: the set of issue numbers the human has already looked
// at and decided to leave. Empty (never `null`) if there is no
// acknowledgement: the absence of the file means "you have acknowledged
// nothing", which is the normal state.
function ackedResidueNumbers() {
  const entry = repoAckOnce().acks.get('residuo-status')
  return entry?.cases ?? new Set()
}

const RESIDUO_ESTADO_TERMINAL = 'in-review'
// The two states with a real consequence. The order IS that of severity, and
// also the order in which they are printed.
const RESIDUO_ESTADOS_GRAVES = ['ready', 'in-progress']
function formatClosedStatusResidueWarning(residue, { acked = new Set() } = {}) {
  const todos = residue || []
  const acusados = todos.filter((r) => acked.has(r.n))
  const vivos = todos.filter((r) => !acked.has(r.n))
  const esTerminal = (r) => r.statusLabels.length === 1 && r.statusLabels[0] === RESIDUO_ESTADO_TERMINAL
  const esGrave = (r) => r.statusLabels.some((s) => RESIDUO_ESTADOS_GRAVES.includes(s))
  const anomalos = vivos.filter((r) => !esTerminal(r) && esGrave(r))
  const inertes = vivos.filter((r) => !esTerminal(r) && !esGrave(r))
  const terminales = vivos.filter(esTerminal).length
  const notaInerte = inertes.length
    ? ` (Otros ${inertes.length} cerrados conservan ${[...new Set(inertes.flatMap((r) => r.statusLabels))].map((s) => `status:${s}`).join(', ')} — ${refsAcotadas(inertes.map((r) => r.n))}: inerte. No retiene tokens, no bloquea ninguna cola y no le pasa nada a nadie por dejarlo; se dice para que el número no sorprenda en una auditoría de labels, no como algo que arreglar.)`
    : ''
  const notaTerminal = terminales
    ? ` (Otros ${terminales} cerrados conservan status:${RESIDUO_ESTADO_TERMINAL}: ése es el final NORMAL de un slice —nada le quita la label al cerrar— y no cuentan como anomalía.)`
    : ''
  if (!anomalos.length) {
    // With nothing grave, there is no headline. The inert/terminal counts only
    // come out if there really is something to count; the acknowledged ones
    // are NOT mentioned here on purpose — repeating «3 acknowledged» on every
    // run would be exactly the static noise this change removes.
    return terminales || inertes.length
      ? `${terminales + inertes.length} issue(s) cerrados conservan una label \`status:\` que no es una anomalía.${notaTerminal}${notaInerte}`.trim()
      : null
  }
  const conEstado = (s) => anomalos.filter((r) => r.statusLabels.includes(s)).map((r) => r.n)
  const listos = conEstado('ready')
  const enCurso = conEstado('in-progress').filter((n) => !listos.includes(n))
  const partes = []
  if (listos.length) {
    partes.push(`${refsAcotadas(listos)} siguen en status:ready: estaban en la cola de despacho y se cayeron de ella sin una palabra — si esperabas que /ct-next despachara alguno de ésos, ésta es la explicación que ninguna otra línea te va a dar.`)
  }
  if (enCurso.length) {
    partes.push(`${refsAcotadas(enCurso)} siguen en status:in-progress: son claims que nunca se soltaron (su worktree y su rama pueden seguir en disco).`)
  }
  // The acknowledgement is only mentioned when there is something LIVE to say:
  // it is useful context ("you have already looked at 8, these 2 are new"), not
  // a periodic reminder.
  const notaAcuse = acusados.length
    ? ` (${acusados.length} más ya acusados en \`${ACK_PATH}\`, no se repiten.)`
    : ''
  return `${anomalos.length} issue(s) CERRADOS conservan una label \`status:\` viva, y para /ct-next NO EXISTEN: este dispatcher solo barre issues ABIERTOS. ${partes.join(' ')} Cerrar el issue y quitarle su label son dos actos distintos y NADA comprueba el segundo, así que el residuo se acumula solo (medido en un repo real: 10 de 99 cerrados). Límpialos con \`gh issue edit <n> --repo ${repo} --remove-label status:<la que tenga>\` — o, si ya los has mirado y decides DEJARLOS así, escribe una línea en \`${ACK_PATH}\`: \`residuo-status: ${new Date().toISOString().slice(0, 10)} — ${refsAcotadas(anomalos.slice(0, 3).map((r) => r.n))} <por qué se quedan>\`. Esos números dejan de salir y los nuevos siguen apareciendo, que es la única forma de que este aviso siga sirviendo dentro de tres corridas.${notaAcuse}${notaTerminal}${notaInerte}`
}

// ============================================================================
// F18/H3 — AN AGENT THAT DECLARES ITSELF BLOCKED LEAVES ITS CLAIM IN PLACE
// FOREVER, and the dispatcher tells the human that somebody is working on it.
//
// The kickoff orders the agent to mark `blocked: {reason, unblock}` in its
// `.agent/SLICE.md` (before F22, `.agent/STATE.md`) and STOP. The issue stays
// in `status:in-progress`: it retains area/touches tokens AND a `--cap` slot,
// indefinitely. And there is no transition the agent can execute correctly:
//   - `stalenessNote` does not flag it: it returns null as soon as the
//     worktree or the branch exists, and in a block both exist;
//   - `--requeue` REFUSES by design (it requires that neither worktree nor
//     branch is left: F15, it does not release the tokens of live unmerged
//     work);
//   - `--release` would lie — it would say there is a PR ready for review;
//   - and the `blocked` field lived in a STATE.md that the dispatcher wrote
//     when seeding and NEVER read again.
//
// The fix is on DISK and needs no network: the dispatcher knows exactly where
// the slice's state is (inside the same worktree directory that
// `assessLocalLiveness` already walks) and `readBlocked` (state.js) already
// knows how to read it, including the `status: blocked` variant that state.js
// itself documents as the most likely writing mistake.
//
// F22: that file is `.worktrees/<n>/.agent/SLICE.md` (`SLICE_REL_PATH`), WITH
// NO FALLBACK to `.agent/STATE.md`. In a worktree seeded by the current
// dispatcher, `.agent/STATE.md` is the COORDINATOR's file, frozen at the base
// commit (F22/Task 4 stopped writing the slice's state there): its `blocked`
// describes the epic, not this slice, and reading it would report as blocked a
// slice that is not. A worktree with no SLICE.md either was seeded by a
// version older than F22, or lost it afterwards (it is ignored: a `git clean
// -x` carries it off) — both causes are warned about, neither is chosen (see
// the block below).
//
// It comes out as a first-level warning and not hanging off a collision
// message: a blocked claim retains cap and tokens EVEN IF it collides with
// nobody today, so tying it to there also being a collision would hide it
// precisely while it is still cheap to fix. A read failure is NOT kept quiet as
// "there is no block": the same criterion as formatConventionWarnings.
function formatBlockedClaimWarnings(issues) {
  const out = []
  for (const i of (issues || [])) {
    if (i.status !== 'in-progress') continue
    const path = `${repoRoot}/.worktrees/${i.n}/${SLICE_REL_PATH}`
    if (!existsSync(path)) {
      // F22: NO FALLBACK to `.agent/STATE.md`, and that is deliberate. In a
      // worktree seeded by this version, that file is the COORDINATOR's,
      // frozen at the base: its `blocked` field talks about the epic, not
      // about this slice, and reading it would report as blocked a slice that
      // is not. A worktree with no SLICE.md is warned about, not guessed at —
      // the same criterion as the read failure further down. And the warning
      // does NOT pick a cause: there are two, and from here they cannot be
      // told apart. The second is new in F22 and could not happen to the
      // tracked STATE.md: `.agent/SLICE.md` is IGNORED, so a `git clean -xdf`
      // in the worktree carries it off. Same symptom, different remedy;
      // asserting "this is from the old schema" would be declaring checked
      // what has not been looked at.
      if (existsSync(`${repoRoot}/.worktrees/${i.n}`)) {
        out.push(`#${i.n} está en status:in-progress y su worktree existe, pero no tiene ${SLICE_REL_PATH}: o lo sembró una versión del plugin anterior a F22 (cuando el estado del slice vivía en .agent/STATE.md), o se sembró bien y se borró después —p. ej. un \`git clean -x\`, que sí se lo lleva ahora que está ignorado—. Desde aquí no se distinguen. En cualquiera de los dos casos, NO se ha comprobado si ese agente se declaró BLOQUEADO —y su .agent/STATE.md NO se lee a propósito: en un worktree nuevo ese fichero es el de la coordinadora, y su campo \`blocked\` no habla de este slice—. Míralo a mano: \`cat .worktrees/${i.n}/.agent/STATE.md\` si resulta ser del esquema viejo; si no, pregúntale al agente de ese worktree.`)
      }
      continue // with no worktree there is nothing to read; the stale claim is already covered by stalenessNote
    }
    let md
    try {
      md = readFileSync(path, 'utf8')
    } catch (e) {
      out.push(`#${i.n} está en status:in-progress y su worktree existe, pero no se ha podido leer ${path} (${e.message}): NO se ha comprobado si ese agente se declaró BLOQUEADO. No lo leas como "no lo está".`)
      continue
    }
    // `stateRel` (F22/Task 6b): `readBlocked` composes its notes naming a
    // file, and without this it names `.agent/STATE.md` by default — the
    // TRACKED file the coordinator has in its own cwd. The contradiction note
    // (`status: blocked` + an empty `blocked` field) is concatenated AS IS
    // into the warning below, so the dispatcher would end up sending the
    // coordinator to edit precisely the file whose contamination motivated
    // F22. There is no ambiguity to resolve here: `md` has just been read from
    // `path`, which is `SLICE_REL_PATH` by construction (the line above).
    const b = readBlocked(parseStateSafe(md).meta, { stateRel: SLICE_REL_PATH })
    if (b.state === 'unreadable') {
      out.push(`#${i.n} está en status:in-progress, pero el frontmatter de ${path} no se puede interpretar (${b.why}): NO se ha comprobado si ese agente se declaró BLOQUEADO.`)
      continue
    }
    if (b.state !== 'blocked') continue
    const motivo = b.reason ? `: «${b.reason}»` : ' (sin motivo declarado)'
    const salida = b.unblock ? ` Para levantarlo, lo que el propio agente dejó escrito: «${b.unblock}».` : ''
    const extras = (b.notes || []).length ? ` ${b.notes.join(' ')}` : ''
    out.push(`#${i.n} está en status:in-progress —el dispatcher lo cuenta como trabajo en curso, ocupando una plaza de --cap y reteniendo sus tokens de área/touches— pero su propio .worktrees/${i.n}/${SLICE_REL_PATH} se declara BLOQUEADO${motivo}. No hay ningún agente avanzándolo, y NINGUNA transición del loop lo saca de ahí sola: la detección de claims rancios no lo ve (el worktree y la rama SÍ existen), \`--requeue\` se niega mientras existan, y \`--release\` mentiría (no hay PR). Esto lo decides tú: desbloquéalo, o abandónalo (borra .worktrees/${i.n} y la rama feat/${i.n} —comprueba antes que no pierdes trabajo sin pushear— y solo entonces \`node <plugin>/scripts/dispatch-check.mjs ${i.n} --repo ${repo} --requeue\`).${salida}${extras}`)
  }
  return out
}

const dispatchInput = readDispatchInput()
// depStates (F13/H4): the state of the CLOSED issues that do NOT count as
// merged. It only exists on the real path (buildDispatchInput); the test
// fixture brings `issues`/`mergedIssues` already mapped, so `|| {}` treats it
// as "no closure has a recorded reason" — never as "all completed".
const { issues, mergedIssues } = dispatchInput
const depStates = dispatchInput.depStates || {}
// `orderCollisions` only exists on the real path (buildDispatchInput) — the
// test fixture (CT_NEXT_FIXTURE) already brings pre-mapped issues and does not
// go through that computation; `|| []` treats it as "no collisions" in that
// case. It never aborts (see formatOrderCollisions's comment): `issues`
// already arrives filtered by buildDispatchInput.
//
// F16/H2 — these four blocks used to go through `console.log` under the
// criterion "console.error is reserved for what aborts". That criterion is
// what split the plugin in two: they are `aviso:`, exactly the same category
// that ct-groom.mjs and ct-init.sh emit on stderr. The criterion in force (see
// the `warn()` block, above) is product/diagnosis, not aborts/does-not-abort —
// and a warning is diagnosis even if it aborts nothing.
const orderCollisions = dispatchInput.orderCollisions || []
for (const w of formatOrderCollisions(orderCollisions)) console.error(w)
for (const w of formatStatusAmbiguityWarnings(issues)) console.error(w)
for (const w of formatStrayDepsWarnings(issues)) console.error(w)
// F18/H2 — the `closed + live status:` residue. `|| []` for the same reason as
// `depStates`: it only exists on the real path (buildDispatchInput); a fixture
// without the field means "it has not been looked at", never "it is clean".
{
  // F19/H2: the numbers already acknowledged in `.agent/conventions-ack.md` do
  // not come out again. The acknowledgement is read ONCE per run
  // (`repoAckOnce`, memoized) and shared by this warning and the conventions
  // one — reading the same file twice with two criteria is how you end up with
  // one silencing and the other not.
  const w = formatClosedStatusResidueWarning(dispatchInput.closedStatusResidue || [], { acked: ackedResidueNumbers() })
  if (w) warn(w)
}
// F18/H3 — claims whose own SLICE.md declares itself BLOCKED. It goes through
// `warn()` (and not through a bare `console.error` like the three above) on
// purpose: it is exactly the kind of thing that gets lost in the middle of
// forty lines of plan and needs to come out in the final recap too.
for (const w of formatBlockedClaimWarnings(issues)) warn(w)

// ============================================================================
// F20/H2 — THE HARVEST. The detector of the residue a FINISHED slice leaves.
//
// See dispatch.js#collectFinishedResidue for the complete finding and for why
// this detects and does not delete. All that lives here is the IO: reading
// `.worktrees/`, reading the `feat/*` branches, and —only if any of that has
// turned up— asking cmux whether a session is left open on top.
//
// Cost in the clean case: two cheap local calls (a readdir and a `git branch
// --list`) and ZERO calls to cmux. The query to cmux (which can take up to
// CMUX_QUERY_TIMEOUT_MS per window) is made only once it is known that there
// is something to count — the same "cheap signals first" criterion as
// stale-claim detection.
//
// In fixture mode nothing is done: `repoRoot` is synthetic (`/tmp/fake-repo`)
// and `mergedIssues` comes from a fixture with no correspondence to any real
// checkout, so the answer would say nothing about anything.
if (!fx && (mergedIssues || []).length) {
  let worktreeDirs = []
  let dirsLeidos = true
  try {
    worktreeDirs = readdirSync(join(repoRoot, '.worktrees'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch (e) {
    // ENOENT is the normal, healthy case: there is no worktree at all.
    // Anything else (permissions, a file where a directory should be) is a
    // FAILED query and cannot be read as "it is clean".
    if (e.code !== 'ENOENT') dirsLeidos = false
  }
  let branchNames = []
  let ramasLeidas = true
  try {
    branchNames = execFileSync('git', ['branch', '--list', '--format=%(refname:short)', 'feat/*'], {
      cwd: repoRoot, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    }).split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    ramasLeidas = false
  }
  if (!dirsLeidos || !ramasLeidas) {
    warn(`no se ha podido comprobar si algún slice ya mergeado deja worktree o rama sin recoger en este checkout (${!dirsLeidos ? `no se pudo listar ${join(repoRoot, '.worktrees')}` : `falló \`git branch --list 'feat/*'\``}). NO lo leas como "está limpio": el residuo de un slice terminado bloquea cualquier redespacho futuro de ese mismo número.`)
  } else {
    const preliminar = collectFinishedResidue(mergedIssues, {
      worktreeDirs, branchNames, cmuxTitles: null, worktreePathOf: (n) => `${repoRoot}/.worktrees/${n}`,
    })
    if (preliminar.length) {
      const titles = queryCmuxWorkspaceTitles() // null = not conclusive, never "there are no sessions"
      const residuo = collectFinishedResidue(mergedIssues, {
        worktreeDirs, branchNames, cmuxTitles: titles, worktreePathOf: (n) => `${repoRoot}/.worktrees/${n}`,
      })
      const w = formatFinishedResidueWarning(residuo, { repo })
      if (w) warn(titles === null ? `${w}\n(no se pudo consultar cmux, así que de las sesiones abiertas no se afirma nada: puede haber agentes vivos que no salen en esta lista.)` : w)
    }
  }
}

// ============================================================================
// F18/H1 + H4 — HOW EACH DEPENDENCY WAS CLOSED, AND WHICH BRANCH WAS REALLY
// MERGED. A single GraphQL call, with aliases, and only if there is something
// to ask. See scripts/gh-closure.js for the complete measurement (97 issues,
// 18.8 KB of query, 2.8 s) and for why this is a DETECTOR and never a gate.
//
// It is not done in fixture mode: the fixture brings `issues`/`mergedIssues`
// already mapped and with no correspondence to a real repo, so asking about
// them would query somebody else's issues. The same thing
// formatConventionWarnings does.
if (!fx) {
  const plan = planClosureProbe({ issues, mergedIssues })
  const query = buildClosureQuery(repo, plan)
  if (query) {
    let raw = null
    try {
      raw = JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`]))
    } catch (e) {
      // It never aborts: a detector that can fail cannot hold a veto over the
      // work. But neither does it keep quiet — the silence would read as
      // "checked and clean", which is the exact lie this round is chasing.
      warn(`no se ha podido comprobar cómo se cerraron las dependencias ya satisfechas (ni si la rama de un slice en revisión está mergeada): ${e.message}. El despacho sigue con el criterio de siempre (una dep cuenta si su issue está cerrado como *completed*); NO lo leas como "comprobado y correcto".`)
    }
    if (raw) {
      if (Array.isArray(raw.errors) && raw.errors.length) {
        warn(`la comprobación de cierres devolvió errores de GraphQL (${raw.errors.map((x) => x?.message || 'sin mensaje').join('; ')}); lo que no vino en la respuesta queda SIN comprobar.`)
      }
      const { closers, mergedPr } = parseClosureProbe(raw, plan)
      for (const w of formatSuspectClosureWarnings(closers, plan.dependents)) warn(w)
      for (const w of formatMergedButOpenWarnings(mergedPr, repo)) warn(w)
    }
    const cobertura = formatClosureCoverageNote(plan)
    if (cobertura) warn(cobertura)
  }
}
// F11, part B — the same finding that made ct-init stop bootstrapping on top
// of somebody else's conventions in silence, but at the moment where it really
// bites: the DISPATCH. The kickoff each agent is given orders it to release
// the claim with the plugin's `dispatch-check.mjs` and to work in the worktree
// `.worktrees/<n>` on `feat/<n>`. If the repo's AGENTS.md (or CLAUDE.md)
// orders it SOMETHING ELSE — its own `scripts/dispatch-check.sh`, another
// worktrees path — the agent receives two contradictory orders and is going to
// obey the repo's, which is the one it reads when hydrating. That is the exact
// road to the deadlock that originated this batch: /ct-next sets
// `status:in-progress`, the agent starts, runs the repo's claim, and the
// repo's script finds an active claim on its own issue.
//
// ONLY the repo's documentation is looked at (the tree is not scanned the way
// ct-init does): what contradicts the kickoff is the INSTRUCTION, not the
// existence of a file — and a dispatch cannot afford a walk of the disk. ONE
// hop IS followed from AGENTS.md/CLAUDE.md to the `.md` files they cite (F14):
// that is a handful of readFileSync calls, and that is where the real repo
// still had the old order alive after removing it from both guides.
// It is one more warning, of the same kind as the three above: it never
// blocks. A read failure is NOT kept quiet as "there is nothing": see
// `failures`.
function formatConventionWarnings() {
  if (fx) return [] // fixture mode: synthetic repoRoot, there is nothing real to read
  const out = []
  let docs = []
  let failures = []
  let acks = new Map()
  let ackProblems = []
  let ackUnreadable = null
  let ackProsaSinAcuses = false
  try {
    ;({ docs, failures } = readRepoDocs(repoRoot))
    // F19/H2: the SAME read the residue warning uses (memoized in
    // repoAckOnce) — one file, one criterion.
    ;({ acks, problems: ackProblems, unreadable: ackUnreadable, prosaSinAcuses: ackProsaSinAcuses } = repoAckOnce())
  } catch (e) {
    // The read blowing up CANNOT bring a dispatch down nor pass for "there is
    // no conflict": it is said and we carry on.
    out.push(`aviso: no se ha podido leer la documentación del repo para comprobar si contradice al kickoff (${e.message}). NO lo leas como "no hay conflicto": no se ha mirado.`)
  }
  for (const f of failures) {
    out.push(`aviso: no se ha podido leer la documentación del repo para comprobar si contradice al kickoff (${f}). NO lo leas como "no hay conflicto": no se ha mirado.`)
  }
  // `files: []` on purpose — with no walk of the disk, the rule about other
  // people's worktree directories and the one about state files do not fire
  // here. The ones that DO matter in a dispatch (the claim instruction, `git
  // worktree add <another path>`) come entirely out of the documents.
  const findings = detectConventions({ docs, files: [], acks }).filter((f) => f.id === 'claim' || f.id === 'worktrees')
  const text = formatFindings(findings, { where: `el repo ${repo}`, ackProblems, ackUnreadable, ackProsaSinAcuses })
  if (text) {
    const live = findings.some((f) => !f.silenced)
    out.push(
      live
        ? `${text}\n  En un DESPACHO esto importa ya: el kickoff manda liberar el claim con el dispatch-check del plugin y trabajar en .worktrees/<n> sobre feat/<n>. El agente va a leer las dos órdenes y obedecer la de tu repo.`
        : text
    )
  }
  return out
}
// F16/H2: on stderr, just like ct-init.sh's conventions warnings — which are
// literally the same finding said by another executable of the same plugin
// (see __tests__/conventions.test.js, which looks for them in `res.stderr`).
for (const w of formatConventionWarnings()) console.error(w)
// planDispatch (dispatch.js) is what decides EVERYTHING that used to be done
// half-way here: this wrapper used to call selectNext with a hardcoded
// `runningTouches: []`, so two successive invocations of /ct-next --cap 1
// never saw each other — neither for a touches collision nor for the cap,
// which counted only what was launched IN THIS batch. planDispatch derives the
// in-flight work (status:in-progress) from the same `issues` already loaded,
// subtracts that work from the cap before selecting, and explains the exact
// reason when it selects nothing (W-B, §8) — this wrapper only formats what it
// already decided.
const { selected, inFlight, tokenHolders, blockReason } = planDispatch(issues, { mergedIssues, cap, depStates })

// Visibility of the in-flight work under --dry-run (point 4 of W-B's brief):
// without this, a --dry-run that DOES select something could give the false
// impression that nothing is running already, when the cap could be partly
// occupied by earlier invocations of /ct-next (or by a manual claim). It is
// printed BEFORE each slice's plan, whether something is selected or not.
if (dryRun) {
  // W-D: the base branch is no longer a fixed literal "main" — show it
  // explicitly under --dry-run (even when no slice is selected) so that the
  // human sees which branch would be branched from before it really runs.
  // Round 1 fix, Minor 2: when the value comes from the fixture's synthetic
  // filler (`baseIsFixtureDefault`), the banner marks it as "(fixture)"
  // instead of asserting "resolved" about a value that in fact was never
  // resolved (neither against GitHub nor against the local checkout).
  console.log(`rama base resuelta: ${resolvedBase}${baseIsFixtureDefault ? ' (fixture)' : ''}`)
  if (inFlight.length) {
    console.log(`En vuelo (${inFlight.length}/${cap} del cap ocupados): ${detalleDeHolders(inFlight)}`)
  } else {
    console.log(`En vuelo: ninguno (0/${cap} del cap ocupados).`)
  }
  // F13/H2: slices in `status:in-review` do NOT occupy cap (there is no live
  // agent) but they DO retain their tokens until the merge. Without this line,
  // a --dry-run that dispatches nothing because of a collision against an
  // in-review left the human looking at "En vuelo: ninguno" and a collision
  // message — an apparent contradiction. It is listed separately, not merged
  // into "En vuelo", precisely because they are two different accountings.
  const reviewHolders = (tokenHolders || []).filter((i) => i.status === 'in-review')
  if (reviewHolders.length) {
    console.log(`Sin mergear, reteniendo tokens (${reviewHolders.length}, status:in-review, NO ocupan cap): ${detalleDeHolders(reviewHolders)}`)
  }
}

if (!selected.length) {
  // Finding 2: the staleness context is created here (once per run, memoized
  // inside) and only fires its query to cmux the first time formatReason
  // really needs to explain a collision — never for
  // 'none-ready'/'deps-unmet'/cap-full-with-a-slot.
  console.log(formatBlockReason(blockReason, cap, stalenessCtxFor()))
  process.exit(0)
}

// D2 (dispatch audit), finding 2: under --dry-run, the complete selection is
// always visible because each slice of `selected` prints its own `=== slice #N
// === ` block without anything aborting half-way (there are no real calls). On
// the REAL path that is not guaranteed — if the dispatch aborts mid-batch (an
// unexpected claim, the worktree, the seed, cmux), the selected slices that
// had not yet been attempted left NO trace at all: a human reading the log
// could not know what had been chosen in total, only what got as far as being
// attempted. It is printed here, BEFORE attempting any claim, on both paths
// (dry-run and real) — it is the single source of truth of the selection
// (`selected`, already decided by planDispatch) and it does not depend on the
// rest of the script getting as far as completing.
// sliceRef (D4, defect 5): a slice whose `n` is not a usable number must not
// be printed as if it were. The previous version interpolated `s.n` as it
// came — verified by construction: a slice with no `n` produced "#undefined"
// on this line, in the cmux workspace's title ("repo · #undefined name"), in
// the branch, in the worktree and in the claim command, and the dry-run exited
// 0 as if the plan were good. The unreadable identifier no longer propagates
// anywhere (see sliceNumberError, further down, which now stops it dead); this
// function only takes care that, in the meantime, the text does not lie
// either.
const sliceRef = (s) => (typeof s.n === 'number' && Number.isSafeInteger(s.n) && s.n >= 1 ? `#${s.n}` : `(slice SIN número de issue utilizable: ${JSON.stringify(s.n) ?? 'undefined'})`)
console.log(`seleccionados para esta tanda (cap ${cap}, ${inFlight.length} en vuelo): ${selected.map((s) => `${sliceRef(s)} (${s.name})`).join(', ')}`)

// repoName keeps the argument's original casing (parseRepoSlug normalises to
// lower case in order to COMPARE, not to display): this only feeds the cmux
// workspace's title, where what the human wants to see is the name exactly as
// they wrote it.
const repoName = repo.split('/')[1]

// ============================================================================
// D4, defect 3 — PRECONDITIONS OF THE REAL RUN.
//
// Before, `--dry-run` printed the plan and exited: it checked NONE of what
// would make the real run fail, so a clean dry-run did not mean the real run
// was going to work — which is exactly what people use a dry-run for. And the
// real run did not check them either: it discovered, for instance, that
// `feat/42` already existed AFTER having written the claim, and spent the rest
// of the way reverting it.
//
// That is why this block runs on BOTH paths, with the same code and the same
// rules, before touching anything (not a claim, not a worktree): that the
// dry-run and the real run can diverge in what they validate is the bug, not
// an implementation detail. The only difference between the two is in what can
// really be checked in fixture mode (see below), and that is said plainly
// instead of being taken for granted.
//
// HARD FAILURE (exit 1, nothing is attempted) vs WARNING (it carries on, but
// the final recap makes it clear that it exited 0 IN SPITE OF the warnings):
//   - hard    → what would BREAK the real run with certainty and requires a
//               human to fix something first: an unusable slice number, a
//               worktree or a branch already occupied, `cmux` absent from the
//               PATH (THIS process runs it, so its absence is a certain
//               failure), the kickoff not rendering.
//   - warning → what we CANNOT assert with certainty from here. `claude` is
//               the clear case: it is not this process that runs it but the
//               LOGIN shell cmux opens, with its own PATH (verified on this
//               machine: `claude` is on top of that a zsh function defined in
//               the .zshrc, invisible to any PATH search). Its absence here is
//               a useful signal, but not a proof — and turning a suspicion
//               into a hard failure would be the same class of unverified
//               assertion this batch of work is chasing.
const preflightFailures = []
// D5, finding H — besides the flat list (which feeds the final summary,
// identical on both paths), WHICH SLICE each failure belongs to is kept,
// indexed by its position in the batch. It serves two things that could not be
// said before: annotating each --dry-run plan block with ITS problem, and
// naming which is the FIRST that would break on a real run.
const failuresBySliceIdx = new Map()
function failSlice(idx, msg) {
  preflightFailures.push(msg)
  if (!failuresBySliceIdx.has(idx)) failuresBySliceIdx.set(idx, [])
  failuresBySliceIdx.get(idx).push(msg)
}

function sliceNumberError(s) {
  if (typeof s.n === 'number' && Number.isSafeInteger(s.n) && s.n >= 1) return null
  // D4, defect 5: without this guard, a slice with no usable number did not
  // stop at an ugly title — it propagated to EVERYTHING: the branch
  // `feat/undefined`, the worktree `.worktrees/undefined`,
  // `dispatch-check.mjs undefined` (which now, with strict parsing, would die
  // with exit 2 mid-batch) and the cmux title `repo · #undefined name`.
  // Verified by construction against the unfixed code: a fixture with no `n`
  // printed exactly those five things and the dry-run exited 0, as if the plan
  // were good.
  return `${sliceRef(s)}: ${JSON.stringify(s.n) ?? 'undefined'} no es un número de issue utilizable (se esperaba un entero >= 1). Todo lo que el dispatcher construye para un slice sale de ese número — la rama feat/<n>, el worktree .worktrees/<n>, el claim contra GitHub y el título de la sesión de cmux — así que no hay forma de despacharlo sin inventarse un identificador. Revisa de dónde salió este slice (${JSON.stringify(s.name ?? null)}): en la ruta real, "n" es siempre el número de issue de GitHub.`
}

// branchExistsLocally: 'yes' | 'no' | 'unknown'.
//
// Three states, not two, because `git rev-parse --verify --quiet <ref>` exits
// with 1 when the ref does NOT exist (the normal case) but can also exit with
// 128 (a corrupt repo, an unreadable .git) or die by the SIGKILL of our own
// timeout. Putting it all into a `catch { return false }` would turn "I could
// not ask" into "it is free" — and "it is free" is precisely what authorises
// going ahead and claiming. 'unknown' is treated as a warning (not as a hard
// failure): we do not know that it is occupied, but neither can we assert the
// opposite, and the dry-run's message stops saying "checked".
// In fixture mode it is 'unknown' by construction: that mode promises not to
// touch any real subprocess.
function branchExistsLocally(branch) {
  if (fx) return 'unknown'
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: repoRoot, stdio: 'ignore', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    })
    return 'yes'
  } catch (e) {
    // `--quiet` makes git exit with 1 (and no message) for exactly "the ref
    // does not exist". Any other status, or a death by signal, is a failure of
    // the QUERY, not an answer.
    if (e.status === 1) return 'no'
    return 'unknown'
  }
}

// registeredWorktreePaths: the paths `git worktree list` already knows about.
// It is needed on top of `existsSync(wt)` because git fails with "missing but
// already registered worktree" when the directory was deleted BY HAND without
// `git worktree remove` — the registration is still in .git/worktrees. That
// case passes an existsSync without trouble and then blows up the `git
// worktree add`… on the real run, with the claim already written, which is
// exactly what this block exists to avoid. Returns a Set, or null if it could
// not be queried.
function registeredWorktreePaths() {
  if (fx) return null
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    })
    const paths = new Set()
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) paths.add(line.slice('worktree '.length).trim())
    }
    return paths
  } catch {
    return null
  }
}

// Binaries. `cmux` is looked for by reading the PATH, NEVER by running it:
// launching a real workspace in order to check that it exists would be exactly
// what a --dry-run promises not to do.
const cmuxPath = findInPath('cmux')
if (cmuxPath) {
  console.log(`cmux: ${cmuxPath} (encontrado en PATH; no se ejecuta para comprobarlo).`)
} else {
  preflightFailures.push('`cmux` no está en el PATH de este proceso — ct-next.mjs lo invoca directamente (`cmux new-workspace ...`), así que sin él NINGÚN slice puede lanzarse. Instálalo o añádelo al PATH y reintenta.')
}
// F29: the binary looked for is THE RESOLVED ACCOUNT's (`claude-personal` /
// `claude-work`), not plain `claude` — that is the one that is going to be
// typed, and a preflight that looks at another name is a preflight that checks
// nothing.
const claudePath = findInPath(agentBin)
if (claudePath) {
  console.log(`${agentBin}: ${claudePath} (encontrado en el PATH de este proceso).`)
} else {
  warn(`\`${agentBin}\` no aparece en el PATH de ESTE proceso. No es concluyente — quien lo ejecuta de verdad es el shell de login que abre cmux, con su propio PATH (y puede ser incluso una función de shell, invisible desde aquí) — pero si tampoco está allí, cada sesión lanzada morirá nada más arrancar, con el claim ya puesto y sin agente. Compruébalo a mano antes de fiarte de un "lanzado".`)
}

// A plan per slice + the check that its destination is free. EVERYTHING is
// built here (branch, worktree, kickoff, seed, cmux argv) so that a kickoff
// rendering failure shows up as a failed precondition — with its message —
// instead of as an uncaught exception mid-batch.
// A single query to the worktree registry for the whole batch (not one per
// slice): the list is the same for all of them.
const registeredWorktrees = registeredWorktreePaths()
// ============================================================================
// #96 — THE BASELINE IS MEASURED BY THE PROGRAM, NOT ASSERTED BY THE AGENT.
//
// The kickoff ordered «a green baseline BEFORE touching anything» and the
// agent asserted it (incident 5 of the catalogue: the report stood in for the
// evidence). Now, as soon as the worktree exists, this script runs the test
// command the repo declares (`test: \`<command>\`` in AGENTS.md or in
// .agent/conventions.md — see scripts/baseline.js) INSIDE the worktree and
// seeds the result into `.agent/SLICE.md` as the `baseline:` field.
//
// With red or not-verified it WARNS on stderr and carries on: dispatching over
// a red baseline is a human decision, not this script's. A green one is not
// announced — a warning that always comes out is a warning nobody reads.
//
// The bound is the same as the other subprocesses' (CT_NEXT_CHILD_TIMEOUT_MS):
// a suite that exhausts it is left as not-verified, not as red — it did not
// finish, so it measured nothing.
// ============================================================================
const BASELINE_WITHOUT_WORKTREE = BaselineResult.notMeasured(
  'dry-run: sin worktree no hay dónde ejecutar el comando de test; la corrida real lo mide en el worktree recién cortado'
)
const baselineMeter = new Baseline({ run: new ShellBaselineRunner({ timeoutMs: childTimeoutFor() }).run })
async function measureBaseline(s, wt) {
  const measured = await baselineMeter.measure(wt)
  if (measured.outcome !== BaselineOutcome.GREEN) {
    console.error(`aviso: baseline de #${s.n}: ${measured.outcome}${measured.command ? ` (\`${measured.command}\` en ${wt})` : ''} — ${measured.summary}. Queda sembrado así en ${SLICE_REL_PATH}; despachar sobre un baseline que no está en verde es decisión tuya, y este script sigue.`)
  }
  return measured
}
// D5, finding H: how many of the failures accumulated so far are BATCH-level
// (not a particular slice's) — `cmux` absent from the PATH and a non-existent
// agent binary. They are distinguished in the final summary because their
// remedy and their scope are different: there is no "fix this slice", they
// affect all of them.
const batchLevelFailureCount = preflightFailures.length
const plans = []
for (let idx = 0; idx < selected.length; idx++) {
  const s = selected[idx]
  const numErr = sliceNumberError(s)
  if (numErr) { failSlice(idx, numErr); continue }
  const branch = `feat/${s.n}`
  const wt = `${repoRoot}/.worktrees/${s.n}`
  const name = cmuxSessionName({ repoName, issue: s.n, sliceName: s.name })
  // Normalise ac/issue in case the slice comes from a test fixture (like the
  // brief's) that does not carry them: renderKickoff/buildStateSeed index
  // slice.ac as an array and use slice.issue with `??`/`||` — without this
  // default they blow up with a TypeError instead of printing the plan.
  const sliceForKickoff = { ...s, ac: s.ac || [], issue: s.issue ?? null, epic: s.epic ?? null }
  let kickoff
  let stateSeed
  try {
    // F17: `base` travels to the kickoff too, not only to the seeded SLICE.md
    // (the line below has always received it). The agent opens the PR: if it
    // does not know which branch its worktree came off, `gh pr create` points
    // it at the repo's default branch — with `--base <another-branch>`, a diff
    // that is not its own.
    kickoff = renderKickoff(sliceForKickoff, { repo, dispatchCheckPath, ctStepPath, conventionsDir, base: resolvedBase })
    // #96: this seed is the --dry-run's and the real run's fallback one (if
    // the rev-parse of the cut fails). The baseline is measured in the
    // WORKTREE, which does not exist yet here: it is declared not measured,
    // and the real run reseeds with the measurement as soon as it has it.
    stateSeed = buildStateSeed(sliceForKickoff, { branch, base: resolvedBase, baseSha: resolvedBaseSha, baseline: BASELINE_WITHOUT_WORKTREE })
  } catch (e) {
    failSlice(idx, `no se pudo renderizar el kickoff/SLICE.md de #${s.n}: ${e.message}. El agente se lanzaría sin prompt utilizable — antes, esto solo se descubría en el run real.`)
    continue
  }
  // Override 1 (shell quoting): --command is ONE argv element (buildCmuxArgv
  // already guarantees that), but the STRING inside that argv element is a
  // command line that cmux runs via a shell. `JSON.stringify` is JSON
  // escaping, not shell escaping — a `$`, a backtick or a `\` in the kickoff
  // would still be interpreted inside the double quotes. shQuote() does the
  // real POSIX escaping (single quotes).
  // F29: `--dangerously-skip-permissions` is still passed explicitly even
  // though the account wrappers already carry it inside. Duplicating it is
  // harmless (measured: `claude --dangerously-skip-permissions
  // --dangerously-skip-permissions --version` → `2.1.223 (Claude Code)`, exit
  // 0), and the alternative was that the agent's autonomous mode depended on
  // the content of a file this repo neither versions nor can check.
  const agentCommand = `${agentBin} --dangerously-skip-permissions ${shQuote(kickoff)}`
  // ==========================================================================
  // F19/H1 — WHAT IS TYPED STOPS BEING THE WHOLE COMMAND.
  //
  // cmux's `--command` does NOT execute: it types. Its own help, embedded in
  // the binary installed on this machine, says so literally: «Send text+Enter
  // to the new workspace after creation». Up to here, SEVERAL KB were typed
  // (the `claude` line with the kickoff inside) towards an interactive login
  // shell that might be printing an oh-my-zsh prompt and eating characters —
  // which is exactly what happened on the first real dispatch (see
  // scripts/launch-sentinel.js).
  //
  // Now ~70 characters are typed: a `.` over a script this process writes with
  // `writeFileSync`. The kickoff travels by disk, where no prompt can bite it.
  // And the script writes a sentinel BEFORE launching the agent, which is the
  // only possible evidence that the order was executed.
  //
  // The directory is EXCLUSIVE per process and per issue, and it is created
  // with `recursive: false` on purpose (see the dispatch loop): in a shared
  // /tmp, a predictable path that already exists is not silently reused — it
  // would be the door for somebody to put a symlink there and make us write
  // the kickoff where it does not belong. Its existing is an error, not a
  // shortcut.
  // F20 — THE PID IS NOT UNIQUE, AND IT SHOWED. The name was plain
  // `ct-next-launch-<pid>-<n>`, with `recursive: false` so that an already
  // existing directory was an ERROR (see below: in a shared /tmp, a
  // predictable path that gets reused is the door for somebody to leave a
  // symlink there). But these directories are NEVER deleted —the shell has to
  // be able to source the launcher— and PIDs are recycled: measured on the
  // development machine, 592 `ct-next-launch-*` directories accumulated in
  // $TMPDIR. At that density, a dispatch against the same issue number from a
  // process that inherits an already-used PID finds the directory in place,
  // the `mkdirSync` blows up with EEXIST, and the dispatch is aborted AFTER
  // the claim (it is reverted, yes, but it is a failure that did not have to
  // happen). It was first seen as a run of the suite going red under load with
  // no assertion broken at all.
  //
  // The random suffix removes the collision WITHOUT touching the security
  // property: the path stops being predictable (which was the point), and
  // `recursive: false` still makes "it already exists" an error.
  const launchDir = join(tmpdir(), `ct-next-launch-${process.pid}-${s.n}-${randomBytes(6).toString('hex')}`)
  const launcherPath = join(launchDir, LAUNCHER_FILENAME)
  const sentinelPath = join(launchDir, SENTINEL_FILENAME)
  let launcherScript
  try {
    launcherScript = buildLauncherScript({ sentinelPath, agentCommand, agentBin, issue: s.n, worktree: wt }, shQuote)
  } catch (e) {
    failSlice(idx, `no se pudo construir el script de arranque de #${s.n}: ${e.message}. Sin él no hay forma de comprobar que el comando llegó a ejecutarse, y despachar sin esa comprobación es exactamente lo que esta ronda elimina.`)
    continue
  }
  const command = buildTypedCommand(launcherPath, shQuote)
  // The pty's environment is set by cmux via --env, NEVER by the local env of
  // the `cmux` client process (see dispatch.js#buildCmuxArgv): `cmux` is a
  // client that talks to an already-running daemon over a Unix socket, and it
  // is the daemon —not this process— that creates the real pty. An env var set
  // on the local `execFileSync('cmux', ...)` dies with that client process
  // without ever reaching the pty; verified live against the sandbox (T10):
  // without --env, the session hangs on the interactive account selector.
  const cmuxArgv = buildCmuxArgv({ name, cwd: wt, command })

  // A free destination. This is the case the assignment names explicitly: if
  // `feat/<n>` already exists, the real run died HALF-WAY, with the claim
  // ALREADY in place.
  //
  // In fixture mode the disk is NOT looked at at all (not even the
  // `existsSync`, which would be the only "free" part): that mode's `repoRoot`
  // is synthetic (`/tmp/fake-repo`), so the answer would say nothing about any
  // real checkout — and checking half of it while the message says "NO
  // COMPROBADOS" would be, once again, reporting one thing and doing another.
  const destinationChecked = !fx
  const branchExists = branchExistsLocally(branch)
  if (destinationChecked) {
    if (existsSync(wt)) {
      failSlice(idx, `el worktree de #${s.n} ya existe: ${wt}. \`git worktree add\` fallaría — y en el run real eso pasa DESPUÉS de haber reclamado el issue. Limpia con \`git worktree remove --force ${wt}\` (y \`git branch -D ${branch}\` si la rama también sobra) si es basura de una corrida anterior, o revisa si hay trabajo real ahí antes de borrar nada.`)
    } else if (registeredWorktrees && registeredWorktrees.has(wt)) {
      // The directory is NOT there, but git still has it registered (somebody
      // deleted it by hand without `git worktree remove`): `git worktree add`
      // fails with "missing but already registered worktree".
      failSlice(idx, `el worktree de #${s.n} (${wt}) no existe en disco pero git SIGUE teniéndolo registrado — \`git worktree add\` fallaría con "missing but already registered worktree" (alguien borró el directorio a mano, sin \`git worktree remove\`). Límpialo con \`git worktree prune\` y reintenta.`)
    }
  }
  if (branchExists === 'yes') {
    failSlice(idx, `la rama ${branch} ya existe en el checkout local. \`git worktree add -b ${branch}\` fallaría — y en el run real eso pasa DESPUÉS de haber reclamado el issue. Bórrala (\`git branch -D ${branch}\`) si es basura de una corrida anterior, o revisa qué hay en ella antes de tocarla.`)
  } else if (branchExists === 'unknown' && !fx) {
    // We do not know whether it is free: a warning, never a "free" by default.
    warn(`no se pudo comprobar si la rama ${branch} ya existe (la consulta a git falló, no es que la rama no esté). Si existe, el run real fallará al crear el worktree DESPUÉS de haber reclamado #${s.n} — compruébalo a mano con \`git branch --list ${branch}\` antes de seguir.`)
  }
  // `selIdx` (not plain `idx`) because the dispatch loop further down iterates
  // over `plans`, which can be SHORTER than `selected` (a slice with no usable
  // number, or whose kickoff does not render, never gets as far as having a
  // plan). Keeping the ORIGINAL position in the batch is what makes it
  // possible to recover that slice's failures without confusing the two
  // indices.
  // `destinationCheck` with THREE values, not a boolean (D5, our own review —
  // the same defect as the rest of this batch, found while going back over
  // it): it used to be `destinationChecked && branchExists !== 'unknown'`, and
  // the dry-run's message for the `false` said, literally, "NO COMPROBADOS
  // (modo fixture: repoRoot sintético, no se toca git). En una corrida real sí
  // se comprueban antes de reclamar". True for fixture mode, FALSE for the
  // other case that fell into the same `false`: a query to git that was REALLY
  // attempted and failed ('unknown', e.g. an unreadable .git). There the
  // dry-run was real, git WAS touched, and the sentence "on a real run they
  // are checked" promised exactly what had just proved impossible. Verified by
  // construction with the branch query broken: a --dry-run with no fixture
  // printed "modo fixture" and exited 0.
  const destinationCheck = fx ? 'fixture' : (branchExists === 'unknown' ? 'unknown' : 'checked')
  plans.push({ s, selIdx: idx, branch, wt, name, kickoff, stateSeed, sliceForKickoff, cmuxArgv, destinationCheck, launchDir, launcherPath, sentinelPath, launcherScript, typedCommand: command })
}

// ============================================================================
// D5, finding H — A --DRY-RUN EXISTS TO SHOW THE WHOLE BATCH AT ONCE.
//
// D4 left this open on purpose and asked: with `--cap 3`, if a single slice
// has its destination occupied, should the whole batch fall? The answer is no.
// Checked before touching anything: the preconditions of ALL the selected
// slices were already being evaluated (with `--cap 3` and the branches of two
// of them occupied, the summary listed both), so THAT part did not need
// fixing. What was missing, and is what makes the user have to fix and run
// again to see the rest:
//
//   1. the --dry-run exited here BEFORE printing the plan of ANY slice — not
//      even the healthy ones'. A dry-run with a problem in the second of
//      three showed neither the kickoff, nor the seeded SLICE.md, nor the
//      `cmux` line of any of them: exactly what it was opened to look at.
//   2. the summary gave the COUNT of failures but did not say which would
//      break first, nor which of the slices were ready.
//
// From here on, the --dry-run CARRIES ON and prints the whole batch, with each
// slice's problem annotated in its own block, and closes with the complete
// summary and an exit 1 (never 0: a dry-run with unmet preconditions is not a
// green light). The REAL run does not change at all: it aborts right here,
// before writing a single claim. That asymmetry is not a divergence in what is
// VALIDATED (which was the bug D4 closed): both check exactly the same thing
// and both fail. The only thing that changes is how much is PRINTED after
// having failed.
function preflightSummary() {
  const failedIdxs = [...failuresBySliceIdx.keys()].sort((a, b) => a - b)
  const label = (i) => sliceRef(selected[i])
  const parts = [`\nprecondiciones NO cumplidas (${preflightFailures.length}) — no se reclama ni se lanza NADA${dryRun ? '' : ' (ni un solo claim escrito: se comprueba antes de tocar GitHub)'}:\n  - ${preflightFailures.join('\n  - ')}`]
  if (batchLevelFailureCount > 0) {
    parts.push(`De esos, ${batchLevelFailureCount} afecta(n) a TODA la tanda (no a un slice concreto): con eso sin arreglar no se lanzaría ninguno de los ${selected.length} seleccionados.`)
  }
  if (failedIdxs.length) {
    const okIdxs = selected.map((_, i) => i).filter((i) => !failuresBySliceIdx.has(i))
    const okPart = okIdxs.length
      ? `; ${okIdxs.length} sin problemas propios (${okIdxs.map(label).join(', ')})`
      : '; ninguno queda sin problemas propios'
    parts.push(`De los ${selected.length} slice(s) seleccionados, ${failedIdxs.length} tienen precondiciones sin cumplir (${failedIdxs.map(label).join(', ')})${okPart}. En una corrida real, el primero que rompería es ${label(failedIdxs[0])} — pero se listan TODOS a propósito, para que puedas arreglarlos de una vez en vez de descubrirlos de uno en uno.`)
  }
  return parts.join('\n')
}

if (preflightFailures.length && !dryRun) {
  console.error(preflightSummary())
  process.exit(1)
}
if (preflightFailures.length) {
  console.error(`\nATENCIÓN: ${preflightFailures.length} precondición(es) sin cumplir en esta tanda. Este --dry-run NO es luz verde y terminará con exit 1 — pero el plan de abajo se imprime IGUAL, entero, para que veas de una sola pasada todos los problemas y todos los slices. El detalle va al final.`)
}
// ============================================================================

// If a step AFTER `git worktree add` fails (seeding SLICE.md, or launching
// cmux), the worktree and the branch already exist on disk. Without cleanup,
// retrying the same slice fails again at `git worktree add` (path and branch
// already occupied) until a human cleans up by hand — and T10 is precisely
// where this would be found for the first time against a real repo (review
// round 1, Important finding). We try to undo it automatically right here —
// the same pattern as dispatch-check.mjs reverting the claim label when a
// later step fails. It exits with exit 1 in any case: failing THIS slice's
// dispatch must never be decided in silence.
//
// The two cleanup steps (`worktree remove` and `branch -D`) are attempted
// SEPARATELY, each in its own try/catch (finding 10 of the final review): if
// they were in the same try, a failure in the first would skip the second
// without even attempting it, leaving the branch orphaned too. And the manual
// hint that is printed when something is left pending never joins both
// commands with `&&`: if `worktree remove` succeeded but `branch -D` was the
// one that failed, a hint with `&&` would be unrunnable as it stands — the
// first command would fail (the worktree no longer exists) and by
// short-circuit the second, which is the one really needed, would never get to
// run. The message only lists the commands of the steps that really were left
// pending.
// W-C, point 1: it invokes dispatch-check.mjs as a subprocess, with an argv
// array (NEVER a shell string) — process.execPath instead of the string "node"
// so as not to depend on "node" resolving in PATH to the same binary that is
// already running this very script. dispatch-check.mjs's exit code contract
// (see its own header, T11): 0 = claimed, 1 = do not start, 2 = usage error.
// The message dispatch-check prints (collision, lost race, a
// read/write/readback failure, or "claimed #N → in-progress") already explains
// the reason well — this wrapper lets it through as it is instead of
// reformatting it.
//
// D2 (dispatch audit), finding 3 — it NO LONGER uses `stdio: 'inherit'`:
// stdout/stderr are captured with an EXPLICIT `stdio` — `['ignore', 'pipe',
// 'pipe']`, see below for why "explicit" — and forwarded as they are to this
// very process. The difference is that that text stays available for
// `classifyClaimOutcome` (further down): its own header comment calls its exit
// 1 "a collision or a lost race", but the SAME exit code also covers a failure
// to read the candidate's labels, a failure to write the claim, and a readback
// failure — five very different causes that, without distinguishing the TEXT
// dispatch-check already prints, are indistinguishable from outside with only
// the exit code. dispatch-check.mjs is not modified to widen its exit code
// contract (out of scope for this change; see classifyClaimOutcome's header
// comment for what would be done if it could be).
//
// D2 review (important 1) — EXPLICIT `stdio`, not just `{ encoding: 'utf8'
// }`: Node's default for execFileSync/execSync is 'pipe' for all three, BUT
// stderr has a documented special case (Node docs, execFileSync): "stderr by
// default will be output to the parent process' stderr unless stdio is
// specified" — that is, without setting `stdio`, Node ALREADY forwards the
// child's stderr to the parent on its own, live, IN ADDITION to returning it
// in `e.stderr`. The first version of this fix did not set `stdio` and wrote
// `e.stderr` again with `process.stderr.write(stderr)` further down — the
// result, verified by construction (a child that writes one line to stderr and
// exits with 1; with `stdio` unspecified, the line appears TWICE in the
// parent's output): EVERY COLLISION line, and the whole 4-line block of the
// ATENCIÓN of an orphaned issue (including the manual `gh issue edit ...`
// command), came out duplicated — one orphan read as TWO different failed
// reverts. Setting `stdio: ['ignore', 'pipe', 'pipe']` disables that automatic
// forwarding of Node's; the ONLY forwarding left is the explicit one further
// down (`writeSync`), once.
//
// D2 review (minor 4) — explicit `maxBuffer: GH_MAX_BUFFER`: without this,
// Node's default (1 MiB PER STREAM) applies here too — a collision with many
// issues in flight (`COLLISION: #N choca con #A[...] #B[...] ...`, one for
// each) can exceed it easily against a real repo. Above the limit, Node KILLS
// the child (SIGTERM) instead of truncating silently — `execFileSync` throws
// with no numeric `status`, and the caller (further down) already classifies
// that as "an unexpected failure launching the subprocess": noisy, but
// MISLEADING (a large, legitimate message is reported as if it were a bug/bad
// configuration). Same value (20 MiB) that `gh()` already uses in this very
// file for exactly the same reason.
//
// D2 review (minor 4, collateral finding) — the forwarding uses
// `fs.writeSync`, NOT `process.stdout.write`/`process.stderr.write`: verified
// by construction that THESE TOO truncate a large payload if a
// `process.exit()` arrives shortly after the write (further down, in the
// dispatch loop, there is ALWAYS a `process.exit()` or a `continue` followed
// by more iterations that eventually end in one) — `process.stdout`/
// `process.stderr` are ASYNCHRONOUS towards a pipe on POSIX (documented in
// Node's own docs: "Pipes (and sockets): asynchronous on POSIX"), which is
// exactly how THIS script's output reaches whoever invokes it (a test, a
// `/loop`, cmux). `fs.writeSync(fd, text)` is a genuinely SYNCHRONOUS syscall:
// when it RETURNS WITHOUT THROWING, the data is already in the descriptor and
// no later `process.exit()` can truncate it.
//
// D5, finding F — WHAT THAT PARAGRAPH OVERCLAIMED. It said, flatly, that the
// data "is written to the descriptor before the call returns", as if
// `writeSync` could not fail. It can, and in two different ways, both
// measured:
//   - With the destination a FULL pipe whose reader does not consume: if the
//     descriptor is blocking, `writeSync` does NOT return — it waits for room
//     (verified: a child with stdout to a pipe with no reader stayed inside
//     the first 64 KiB `writeSync` indefinitely). If the descriptor is
//     non-blocking, it throws EAGAIN at once and writes NOTHING (measured by
//     the external re-review: with >= 64 KiB stuck not a single byte gets
//     through; with 0-32 KiB it does).
//   - With the reader CLOSED (`ct-next | head`, a caller that stopped
//     reading), it throws EPIPE and also writes nothing.
// That is: the real guarantee is "if it returns, it is written", not "it
// always writes". That limit is acceptable —there is no way to deliver a
// message to a destination that does not accept it— but it has to be written
// down, and it has to be CONTAINED, which is what `relay()` does just below.
//
// D5 (collateral finding, the gravest of those I found outside the
// assignment): the forwarding `writeSync`s were NAKED, and the one on the
// success branch was INSIDE the same `try` as the `execFileSync`. Consequence
// verified by construction, launching ct-next.mjs with stdout's read end
// closed: dispatch-check claimed #90 SUCCESSFULLY (the `issue edit ...
// --add-label status:in-progress` appears in gh's log, and its readback too),
// the subsequent `writeSync(1, out)` threw EPIPE, the `catch` picked it up as
// if it were the SUBPROCESS's failure — `e.status` undefined — and ct-next
// printed "dispatch-check devolvió un fallo inesperado […] probablemente es un
// bug o una mala configuración", aborted the whole batch with exit 1 and
// reverted NOTHING: the issue was left orphaned in status:in-progress because
// it could not print one line. A successful claim reported as a failure, with
// the very text that blames the user for a bad configuration: this whole batch
// of work's entire family of defects in a single one.
//
// `relay()` isolates each forwarding write: a destination that does not accept
// the text can NEVER change what ct-next decides nor what it reports about the
// claim. There is nowhere to report the forwarding's failure to (if stderr is
// the broken one, it could not be done either), so it is swallowed silently on
// purpose — what is NOT swallowed is the claim's result.
function relay(fd, text) {
  if (!text) return
  try {
    writeSync(fd, text)
  } catch {
    // A full/closed pipe, an invalid descriptor: the forwarding is lost. It is
    // a known limit, documented above, never a reason to misclassify the claim
    // nor to bring the process down.
  }
}

function attemptClaim(s) {
  try {
    // timeout+killSignal (finding 1, defence 2): if dispatch-check.mjs hangs
    // (its own `gh` half-hung), this bounds the wait instead of blocking
    // ct-next.mjs forever. If the kill arrives in the middle of its own
    // claim-then-verify, we cannot know whether the label was already written
    // before the SIGKILL — the whole batch is aborted instead of assuming
    // anything, the same conservative criterion that already governs any other
    // unexpected result from dispatch-check. The generic backstop for a claim
    // that really was left orphaned this way is staleness detection (finding
    // 2), not this.
    //
    // D5, finding D — A CORRECTION TO THIS COMMENT: it said that this case
    // fell "on purpose" into the UNEXPECTED FAILURE branch further down. That
    // stopped being true when the previous round added the `signal` branch:
    // killing the child with SIGKILL leaves `status` at null and `signal` at
    // 'SIGKILL', so since then it falls into the SIGNAL branch, not the
    // unexpected-failure one. The comment described the code from before the
    // very change it accompanied. Now the signal branch explicitly tells our
    // own timeout (`timedOut`, below) apart from somebody else's signal.
    const out = execFileSync(process.execPath, [dispatchCheckPath, String(s.n), '--repo', repo], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GH_MAX_BUFFER,
      timeout: childTimeoutFor('dispatch-check'),
      killSignal: 'SIGKILL',
    })
    relay(1, out)
    return { ok: true }
  } catch (e) {
    const stdout = typeof e.stdout === 'string' ? e.stdout : ''
    const stderr = typeof e.stderr === 'string' ? e.stderr : ''
    relay(1, stdout)
    relay(2, stderr)
    // `signal` (external review, minor finding): when the subprocess ends
    // because of a signal (an ordinary terminal Ctrl-C that DOES reach the
    // child too, or the SIGKILL of our own timeout above), Node leaves
    // `status` at `null` and fills `signal` with the name — before, this fell
    // indiscriminately into the same "unexpected failure, probably a bad
    // configuration" as a malformed --repo, blaming the user for a
    // configuration problem that never existed. `text` (the concatenated
    // stdout+stderr) was withdrawn: classifyClaimOutcome no longer consumes it
    // since dispatch-check.mjs's contract was widened to exit codes (finding
    // 4) — dispatch-check's text has already been forwarded above for the
    // human to see, there is no need to duplicate it here.
    // `timedOut` (D5, finding D): the SAME detection the `git worktree add`
    // catch already used — Node kills the child with `killSignal` and fills
    // the message with ETIMEDOUT when what expired was OUR `timeout`. It
    // serves not to present our own limit as an interruption by the user.
    const timedOut = e.signal === 'SIGKILL' && /ETIMEDOUT/.test(e.message || '')
    return { ok: false, status: e.status, signal: e.signal, timedOut }
  }
}

// classifyClaimOutcome (finding 4 — rewritten to use dispatch-check.mjs's EXIT
// CODE, not its text): before this change, this function had to TELL APART
// five very different causes by parsing the free text dispatch-check.mjs
// prints, because its exit 1 conflated them all — fragile in the face of any
// future wording change in that file. Now dispatch-check.mjs (which is no
// longer out of scope for this task) emits a different code for each
// consequence that really matters to the caller — see dispatch-check.mjs's
// header for the complete contract:
//   - 'skip'  (exit 1) → the NORMAL result of the protocol: a collision
//               detected in time (nothing was written), or a lost race with a
//               SUCCESSFUL subsequent revert (the issue comes back clean to
//               status:ready). Skipping this slice and carrying on with the
//               rest of the batch is correct.
//   - 'infra' (exit 3) → a failure READING the candidate's labels, a failure
//               WRITING the initial claim, or a READBACK failure with a
//               SUCCESSFUL subsequent revert — in all three cases no
//               persistent mutation is left (the issue intact or back in
//               status:ready), but the cause is infrastructural (gh down,
//               auth, the network), not a real collision.
//   - 'stuck' (exit 4) → a lost race OR a readback failure, and the
//               subsequent revert failed TOO: the issue is left ORPHANED in
//               status:in-progress, with nobody working on it. dispatch-check
//               already prints its own "ATENCIÓN" (with the manual command) —
//               this code is the MACHINE signal that that is precisely the
//               case, without depending on recognising that text.
//
// Treatment in the caller (unchanged from before — D2 review, minor 3): only
// 'stuck' aborts the WHOLE batch with exit 1, just like the "unexpected
// failure" that already existed for an unrecognised exit — a genuinely
// orphaned issue requires a human to look at it before ct-next retries
// anything else against this repo. 'infra' is treated the same as 'skip' (we
// carry on with the rest of the batch), with a message that makes it explicit
// that it is NOT a normal collision — the log must not lie about what
// happened, even if the control flow is the same.
function classifyClaimOutcome(status) {
  if (status === 1) return { kind: 'skip', label: 'colisión o carrera perdida, protocolo normal (detalle arriba, en el texto de dispatch-check)' }
  if (status === 3) return { kind: 'infra', label: 'fallo de infraestructura sin mutación persistente (detalle arriba, en el texto de dispatch-check)' }
  if (status === 4) return { kind: 'stuck', label: 'huérfano — el revert automático de dispatch-check también falló (detalle arriba)' }
  // Should not be reachable: the caller only calls this function for
  // status ∈ {1,3,4}. For any other value, 'infra' (carry on with caution,
  // never a silent 'skip') is the safest option — the same criterion that
  // already governs the rest of this file in the face of an unexpected input.
  return { kind: 'infra', label: `código de salida ${status} no reconocido para este contrato` }
}

// W-C, point 3: it reverts an already-obtained claim when the dispatch fails
// AFTER claiming (git worktree add, seeding SLICE.md, or cmux) — without this
// the issue is left orphaned in status:in-progress with nobody working on it,
// precisely the failure mode dispatch-check.mjs works hard to avoid behind its
// own doors (its own claim-then-verify). dispatch-check.mjs has no "abort"
// flag: --release is the in-progress → in-review transition of an ALREADY open
// PR, and here there never was any real work, so we revert with the same label
// mutation dispatch-check uses behind its own doors for its own reverts (a
// lost race, a readback failure) — reusing the `gh()` already defined in this
// file, not a loose call to execFileSync.
function attemptRevertClaim(s) {
  try {
    gh(['issue', 'edit', String(s.n), '--repo', repo, '--add-label', 'status:ready', '--remove-label', 'status:in-progress'])
    return null
  } catch (e) {
    return e
  }
}
const manualRevertClaimHint = (s) => `gh issue edit ${s.n} --repo ${repo} --add-label status:ready --remove-label status:in-progress`

// Like the rest of this file's messages: the steps that DID succeed are never
// listed (nor is their manual command printed) — only the ones that really
// were left pending.
function formatSpanishList(items) {
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

// ============================================================================
// F22 — THE RULE THAT MAKES THE SLICE'S STATE INVISIBLE.
//
// It goes to git's COMMON directory, not to the worktree's `.git` — which is
// not even a directory: in a linked worktree `.git` is a FILE pointing at
// `<main>/.git/worktrees/<n>`. `git rev-parse --git-common-dir` returns the
// main checkout's `.git`, so ONE write covers the coordinator and every
// worktree, present and future. And since `info/exclude` is never committed,
// this rule cannot end up inside a PR — which is exactly the failure this
// round fixes.
//
// WHY THE .gitignore IS NOT ENOUGH. `ct-init` does add the line to the repo's
// `.gitignore` (the long way, committed and shared), but that only protects
// the repos that re-run it AND only from the moment that commit reaches the
// base the worktree is cut from. This write is the net that makes the other
// one not be a prerequisite.
//
// WHY IT IS NO USE FOR `.agent/STATE.md`, and it is worth writing down: NO
// ignore rule affects an already TRACKED file. It works here, and only here,
// because `.agent/SLICE.md` is born untracked and is never tracked.
//
// Idempotent by exact line, the same criterion as ct-init.sh's `.worktrees/`
// block: it is added only if it is not there already.
// ============================================================================
function ensureSliceIgnored() {
  let commonDir
  try {
    commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repoRoot, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    }).trim()
  } catch (e) {
    return { ok: false, why: `no se pudo localizar el directorio común de git (\`git rev-parse --git-common-dir\`): ${e.message}` }
  }
  if (!commonDir) return { ok: false, why: '`git rev-parse --git-common-dir` no devolvió ninguna ruta' }
  const base = isAbsolute(commonDir) ? commonDir : join(repoRoot, commonDir)
  const excludePath = join(base, 'info', 'exclude')
  try {
    mkdirSync(join(base, 'info'), { recursive: true })
    let current = ''
    try { current = readFileSync(excludePath, 'utf8') } catch { current = '' }
    const next = excludeContentWith(current, SLICE_REL_PATH)
    if (!next.added) return { ok: true, added: false, path: excludePath }
    writeFileSync(excludePath, next.content)
    return { ok: true, added: true, path: excludePath }
  } catch (e) {
    return { ok: false, why: `no se pudo escribir ${excludePath}: ${e.message}` }
  }
}

function cleanupOrphanedWorktree(s, wt, branch, reason) {
  console.error(`no se pudo completar el dispatch de #${s.n} tras crear el worktree (${reason}).`)

  const attempts = [
    { label: 'el worktree', cmd: `git worktree remove --force ${wt}`, err: null },
    { label: 'la rama', cmd: `git branch -D ${branch}`, err: null },
    { label: 'el claim (status:in-progress → status:ready)', cmd: manualRevertClaimHint(s), err: null },
  ]

  // timeout+killSignal (finding 1, defence 2) here too: THIS SAME function is
  // the one that would run if the signal already caused the failure that
  // brought us here — we do not want the cleanup itself to be able to hang
  // just as indefinitely as the step that failed.
  try {
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, stdio: 'inherit', timeout: childTimeoutFor(), killSignal: 'SIGKILL' })
  } catch (e) {
    attempts[0].err = e
  }

  try {
    execFileSync('git', ['branch', '-D', branch], { cwd: repoRoot, stdio: 'inherit', timeout: childTimeoutFor(), killSignal: 'SIGKILL' })
  } catch (e) {
    attempts[1].err = e
  }

  // The three steps are attempted SEPARATELY (the same reason that already
  // governed worktree/branch before W-C): if they were in a single try, a
  // failure in the first would skip the following ones without even attempting
  // them, leaving more things orphaned than necessary. An `&&` in the manual
  // hint would have the same problem the other way round (if the chain's first
  // command is no longer needed because it succeeded, re-running it would fail
  // and the `&&` would short-circuit the rest) — that is why the hint below
  // always lists the pending commands separated by `;`, never chained.
  attempts[2].err = attemptRevertClaim(s)
  // finding 1: THIS claim's fate has already been decided (a revert was
  // attempted, successfully or not — if it failed, the ATENCIÓN below already
  // says so) — clearing it here prevents a signal handler that got to run
  // right afterwards from trying to revert it a second time.
  activeClaim = null

  const failed = attempts.filter((a) => a.err)
  if (!failed.length) {
    console.error(`worktree y rama de #${s.n} limpiados automáticamente (${wt}, ${branch}); claim revertido automáticamente a status:ready — puedes reintentar el dispatch de este slice.`)
  } else {
    const what = formatSpanishList(failed.map((a) => a.label))
    const errMsg = failed.map((a) => a.err.message).join('; ')
    const pendingCmds = failed.map((a) => a.cmd)
    console.error(`ATENCIÓN: no se pudo limpiar automáticamente ${what} de #${s.n} (${errMsg}). Pendiente a mano — ejecuta cada comando por separado: ${pendingCmds.join(' ; ')}`)
  }
  // The slices of this same batch already launched successfully BEFORE this
  // failure (if cap > 1) carry on running in their own cmux, independent of
  // this process — they are neither touched nor stopped here.
  console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
  process.exit(1)
}

// Finding 1 — interruption state. `activeClaim` is non-null EXACTLY during the
// dangerous window: a claim already confirmed (status:in-progress) for which
// the worktree has not yet been created (or whose failure has not yet been
// handled). It is cleared to null in the only three places where its fate is
// resolved along the normal path: worktree created successfully, the catch of
// `git worktree add` (after attempting the revert), and inside
// cleanupOrphanedWorktree (after its own revert attempt) — never before the
// automatic revert has been attempted, so that if the signal handler got to
// run right in the middle (JS is single-threaded: in practice it cannot, see
// the comment block further up — this is defence in depth, not something that
// can be triggered today) it finds the state already resolved instead of
// attempting a second, overlapping revert.
//
// D5, finding E — `activeWorktree` AND ITS MESSAGE IN THE HANDLER WERE
// WITHDRAWN. There was an `activeWorktree` variable that was set to
// `{wt, branch}` just before the `execFileSync` of `git worktree add` and
// returned to `null` immediately afterwards (both in the `try` and in the
// `catch`), and an `if (activeWorktree)` inside `handleInterrupt` warning that
// the worktree might have been left half-created. That guard was UNREACHABLE
// by construction: between the assignment and the `execFileSync` there is no
// `await`, so the event loop cannot regain control (and therefore no signal
// handler can run); during the `execFileSync` it cannot either (finding (a) of
// the header); and as soon as the call returns, the variable goes back to
// `null` synchronously before any other yield. A guard that pretends to cover
// a case it does not cover is worse than not having it: it tells the reader
// that that scenario is attended to.
//
// Nothing is lost by removing it, and this is the important part: the scenario
// that message described —a `git worktree add` interrupted half-way through
// creating— DOES have a voice, in the timeout branch of `git worktree add`'s
// `catch` (the only path by which that scenario is really reached: the call is
// killed with SIGKILL when CT_NEXT_CHILD_TIMEOUT_MS runs out), whose message
// already says literally "puede haber quedado un directorio y/o una rama a
// MEDIO crear" with the cleanup commands.
let activeClaim = null
// `batchFinished` (D5, finding C): true as soon as the dispatch loop has
// finished entirely. Only `handleInterrupt` uses it, to tell the truth about
// WHAT arrives late — a signal received with the batch already processed
// undoes nothing, and saying "interrupting safely before exiting" would
// suggest the opposite.
let batchFinished = false
// `interrupting`: a reentrancy lock AND a "stop at the next checkpoint" flag
// for the main loop (see the use of `interrupting` at the loop's two
// checkpoints, further down). A second signal while we are already handling
// the first must not fire a second, overlapping revert of the SAME claim — it
// forces the exit right away, with no retried cleanup.
let interrupting = false
const SIGNAL_EXIT_CODE = { SIGINT: 130, SIGTERM: 143 }
// CRITICAL — a finding from an external review, reproduced 3/3 and 2/2
// deterministically: the previous version of this function was `async` and
// ended in `await sleep(0)` BEFORE `process.exit()`, with the reasoning
// (correct in isolation, but incomplete) of giving the `interrupting` lock a
// chance to be genuinely reentrant. That extra `await` REOPENED exactly the
// gap finding 1 came to close: the main loop, suspended in its OWN `await
// sleep(testDelayAfterClaimMs)` (registered BEFORE the signal was processed),
// has a timer that was ALREADY in libuv's queue. This handler's `sleep(0)`
// registers a NEW timer, behind the previous one — and Node processes expired
// timers in the order they were registered. Result, verified by construction
// (at PRODUCTION configuration, testDelayAfterClaimMs=0, not at the value the
// tests use): the main loop's timer expires BEFORE this handler's, so the loop
// RESUMES — it creates the worktree, launches cmux and prints "lanzado" — ALL
// OF THAT AFTER this handler had already printed "revertido automáticamente a
// status:ready". The claim is left reverted on GitHub while a real agent
// carries on running on top of it: finding 1 exactly, caused by finding 1's
// own fix.
//
// A corollary about my own original empirical finding (also pointed out by the
// review, and confirmed true): "not even after the call unblocks" is valid for
// ONE blocked synchronous call, but it does NOT mean that any old `await` is a
// "safe and side-effect-free" yield point — every `await` reintroduces a real
// race against ANY other already-pending timer/callback. A `sleep(0)` is not a
// guaranteed delivery of anything; it is one more turn round the event loop,
// with the same risk of other code advancing in the meantime.
//
// The fix: this function is now 100% SYNCHRONOUS — not a single `await` — from
// the moment it is invoked until `process.exit()`. With that, as soon as the
// event loop invokes it, it runs in one go (the revert included:
// `attemptRevertClaim` was already synchronous) until the process ends,
// without yielding control even once — nothing else can run in the meantime
// (JS is single-threaded, and with no `await` at all there is no point at
// which the main loop could slip in). The `interrupting` lock is, in practice,
// dead code again for the real reentrancy case (a second signal cannot
// interrupt a 100% synchronous function) — but a dead guard is harmless; the
// `await` that made it "live" was not. As additional defence in depth (not as
// a solution to the gap above, which is already closed by construction): the
// main loop ALSO checks `interrupting` immediately on resuming from each of
// its two checkpoints, before any mutation — see those two places.
function handleInterrupt(sig) {
  if (interrupting) {
    console.error(`\n${sig} recibido de nuevo mientras ya se estaba limpiando de una interrupción anterior — no reintento el revert (podría solaparse con el que ya está en curso); salgo ya.`)
    process.exit(SIGNAL_EXIT_CODE[sig] || 130)
  }
  interrupting = true
  // D5, finding C: a signal that arrives with the batch ALREADY processed (the
  // case that used to be discarded in silence) interrupts nothing — saying
  // "interrupting safely before exiting" there would be suggesting that
  // something is being stopped or undone, and that is not true.
  if (batchFinished) {
    console.error(`\n${sig} recibido, pero la tanda YA había terminado de procesarse cuando llegó: no se interrumpe ni se deshace nada de lo ya hecho (el resumen de arriba es el resultado real de esta corrida). Se sale con el código de la señal para que quien invocó a ct-next sepa que se pulsó.`)
  } else {
    console.error(`\n${sig} recibido — interrumpiendo de forma segura antes de salir.`)
  }
  if (activeClaim) {
    const claimant = { n: activeClaim.n }
    console.error(`#${claimant.n} tiene un claim (status:in-progress) sin worktree completado — revirtiendo a status:ready antes de salir.`)
    const err = attemptRevertClaim(claimant)
    if (!err) {
      console.error(`claim de #${claimant.n} revertido automáticamente a status:ready.`)
    } else {
      console.error(`ATENCIÓN: no se pudo revertir automáticamente el claim de #${claimant.n} (${err.message}). Puede haber quedado bloqueado en status:in-progress sin nadie trabajándolo — libéralo a mano con: ${manualRevertClaimHint(claimant)}`)
    }
    activeClaim = null
  } else {
    console.error('no había ningún claim propio pendiente de revertir en este instante.')
  }
  console.error('Los slices de esta tanda ya lanzados con éxito antes de esta interrupción (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
  process.exit(SIGNAL_EXIT_CODE[sig] || 130)
}
process.on('SIGINT', () => handleInterrupt('SIGINT'))
process.on('SIGTERM', () => handleInterrupt('SIGTERM'))

// ============================================================================
// D5, finding G (the root half) — THERE WAS A NET FOR SIGNALS, BUT NOT FOR
// EXCEPTIONS.
//
// `handleInterrupt` reverts the claim of the dangerous window when a SIGNAL
// arrives. Any `throw` in that same window —claim written, worktree not yet—
// had absolutely nothing: the process died with its trace and the issue stayed
// in status:in-progress forever. The unvalidated test hook (above) was only
// ONE example of that hole, and fixing only the hook would have left the hole
// intact: a `mkdirSync` that throws an unforeseen error, a `JSON.parse` of an
// odd response, a `renderKickoff` that blows up on a malformed slice, a V8 OOM
// in the middle of the loop… all fall the same way.
//
// `bailOutOnCrash` is the exact equivalent of `handleInterrupt` for that case,
// with the SAME design rules and for the same reasons:
//   - 100% SYNCHRONOUS, from the first line to `process.exit()`. Not one
//     `await`. See `handleInterrupt`'s header for the concrete (and
//     reproduced) regression that one `await sleep(0)` too many caused in
//     there.
//   - Its own reentrancy lock (`crashing`) so as not to chain a second,
//     overlapping revert if handling the failure itself fails again.
//   - It prints the COMPLETE trace, always. Installing an `uncaughtException`
//     handler replaces Node's default behaviour (which prints it itself), so
//     keeping it quiet would turn this net into a way of hiding bugs — exactly
//     the opposite of what is wanted.
//
// BOTH global handlers are registered, not one: all the code in this file is
// synchronous except for the checkpoints' `await`s, and verified by
// construction (an ES module of the same shape: a top-level `await` and then a
// `process.kill` with an invalid signal) the failure arrives as
// `uncaughtException` — but betting on just one would be exactly the class of
// unchecked assumption this work is chasing, and covering both costs nothing.
// This was preferred over a `try/catch` around the loop's body: it covers
// strictly MORE (any `throw` at any point of the script, not only inside the
// loop) and does not depend on getting the placement of the try right.
let crashing = false
function bailOutOnCrash(err, kind) {
  if (crashing) process.exit(1)
  crashing = true
  const detail = (err && err.stack) || String(err)
  console.error(`\n${kind} en ct-next.mjs — esto es un bug, no un resultado esperado del protocolo:\n${detail}`)
  if (activeClaim) {
    const claimant = { n: activeClaim.n }
    activeClaim = null
    console.error(`#${claimant.n} tenía un claim (status:in-progress) sin worktree completado cuando ocurrió el fallo — revirtiendo a status:ready antes de salir, para no dejarlo huérfano.`)
    const revertErr = attemptRevertClaim(claimant)
    if (!revertErr) {
      console.error(`claim de #${claimant.n} revertido automáticamente a status:ready.`)
    } else {
      console.error(`ATENCIÓN: no se pudo revertir automáticamente el claim de #${claimant.n} (${revertErr.message}). Puede haber quedado bloqueado en status:in-progress sin nadie trabajándolo — libéralo a mano con: ${manualRevertClaimHint(claimant)}`)
    }
  } else {
    console.error('no había ningún claim propio pendiente de revertir en ese instante.')
  }
  console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
  process.exit(1)
}
process.on('uncaughtException', (err) => bailOutOnCrash(err, 'excepción no capturada'))
process.on('unhandledRejection', (err) => bailOutOnCrash(err, 'promesa rechazada sin manejar'))

// D2, finding 1: a count of how many of `selected`'s slices were really
// launched — it is used both for the final count line and to decide the exit
// code when the whole batch ends without launching anything.
let launchedCount = 0
// D5, finding A — slices that reached the end of the loop LEAVING STATE behind
// without being able to confirm that there is an agent working on them:
// 'wrong-cwd' and 'not-found'. It is the ONLY way of ending the loop with
// residue (every other path either mutates nothing, or aborts with
// process.exit after attempting its cleanup — see the final verdict's comment,
// further down, for the complete enumeration).
const unverifiedLaunches = []

for (let idx = 0; idx < plans.length; idx++) {
  const { s, selIdx, branch, wt, name, kickoff, stateSeed, sliceForKickoff, cmuxArgv, destinationCheck, launchDir, launcherPath, sentinelPath, launcherScript, typedCommand } = plans[idx]

  if (dryRun) {
    console.log(`\n=== slice #${s.n} (${s.name}) ===`)
    // D5, finding H: THIS slice's problem, in ITS block — so as not to force
    // anyone to cross-reference the summary at the end with the plan above.
    const own = failuresBySliceIdx.get(selIdx)
    if (own) {
      console.log(`PRECONDICIÓN NO CUMPLIDA (${own.length}) para este slice — con esto sin arreglar, este slice NO se despacharía:\n  - ${own.join('\n  - ')}`)
    }
    // W-C, point 5: the plan has to make it clear that a claim WOULD BE
    // ATTEMPTED (dispatch-check.mjs, status:ready → status:in-progress) for
    // this particular issue BEFORE creating the worktree — without really
    // invoking dispatch-check. dispatch-check.mjs, even in its own --dry-run
    // with no fixture, does real reads against gh (only the claim's write is
    // skipped); invoking it here would break --dry-run's "no network"
    // guarantee with CT_NEXT_FIXTURE, so under --dry-run ct-next.mjs simply
    // does NOT call dispatch-check.mjs — no real gh is touched.
    // Round 1 fix, minor: `node ${dispatchCheckPath} ...` (not a loose name
    // "dispatch-check ...") so that the line is copyable and runnable as it
    // stands, just like its neighbours (`git worktree add ...`, `cmux ...`).
    console.log(`node ${dispatchCheckPath} ${s.n} --repo ${repo}   # se reclamaría #${s.n} (status:ready → status:in-progress) antes de crear el worktree; en --dry-run no se ejecuta, ningún gh real se toca`)
    // D4, defect 3: what could REALLY be checked about the destination. In
    // fixture mode (`CT_NEXT_FIXTURE`) the repoRoot is synthetic and the
    // branch check would require a real `git`, which that mode promises not to
    // touch — so it is said, instead of letting the absence of a complaint
    // read as "checked and free".
    // D5, finding H: "destino libre" is only said when it really is. With this
    // slice's preconditions block already printed above, repeating "destino
    // libre" would be a contradiction inside the same block — the exact defect
    // this batch of work is chasing.
    if (own) {
      console.log(`destino: ${wt} / rama ${branch} — NO LIBRE (ver la precondición de arriba).`)
    } else if (destinationCheck === 'checked') {
      console.log(`destino libre: ${wt} no existe y la rama ${branch} tampoco (comprobado en este checkout).`)
    } else if (destinationCheck === 'fixture') {
      console.log(`destino: ${wt} / rama ${branch} — NO COMPROBADOS (modo fixture: repoRoot sintético, no se toca git). En una corrida real sí se comprueban antes de reclamar.`)
    } else {
      // 'unknown': it was really attempted and the query failed. Neither
      // "free" nor "not looked at" — it was looked at and could not be known.
      // The warning with the detail and the manual command was already printed
      // when the check was made.
      // F16/H2: that warning comes out on STDERR (the channel criterion), so
      // the reference says WHERE it is and not just "further up" — whoever
      // redirected stdout to a file does not have it "above" anywhere.
      console.log(`destino: ${wt} / rama ${branch} — SIN CONFIRMAR: la consulta a git se intentó y FALLÓ (el detalle y el comando manual están en el aviso correspondiente, por stderr), así que no se puede afirmar que estén libres. Esto NO es modo fixture: la corrida real hará exactamente esta misma comprobación, y si vuelve a fallar tampoco lo sabrá.`)
    }
    console.log(`git worktree add -b ${branch} ${wt} origin/${resolvedBase}`)
    // slice 9b: under --dry-run there is no worktree, so this seed carries the sha resolved before the loop; the real run re-measures it in the worktree
    console.log(`seed ${wt}/${SLICE_REL_PATH}:\n${stateSeed}`)
    // D4, defect 3: the kickoff, as PROSE. The `cmux ...` line below carries
    // it inside, but doubly escaped (POSIX quotes + the JSON.stringify of the
    // line itself): a single-line blob with literal `\n`s that nobody can read
    // — and judging whether the prompt the agent is going to receive is the
    // right one is the only reason a human looks at a dry-run. It is printed
    // exactly as the agent will see it, BEFORE the literal command (which is
    // kept whole, untrimmed: it is still the source of truth of what exactly
    // would be executed).
    console.log(`--- kickoff que recibiría el agente de #${s.n} (prosa, tal cual) ---\n${kickoff}\n--- fin del kickoff ---`)
    // F19/H1: the `cmux` line NO LONGER carries the agent's command inside —
    // it carries a `.` over this script, which is the only thing typed into
    // the pty. If the dry-run only printed the cmux line, it would hide
    // exactly what is going to be executed, which is the only reason anybody
    // looks at a dry-run. It is printed whole, exactly as it would be written
    // to disk.
    console.log(`--- ${launcherPath} (script de arranque que cmux sourcearía; el kickoff viaja AQUÍ, no tecleado) ---\n${launcherScript}--- fin del script de arranque ---`)
    console.log(`cmux ${cmuxArgv.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`)
    console.log(`tras lanzar, se espera hasta ${launchSentinelTimeoutMs} ms a que aparezca ${sentinelPath} — el centinela que el propio shell escribe al ejecutar el comando. Sin él NO se dice "lanzado" (ver CT_NEXT_LAUNCH_TIMEOUT_MS).`)
    console.log(`ese presupuesto se reparte en intentos de ${LAUNCH_ATTEMPT_MS} ms: si el centinela no está al acabar uno, se REENVÍA la misma línea (\`cmux send\` + Enter) a esa sesión y se vuelve a esperar. Medido contra el cmux de esta máquina: sin reenvío, 0 de 6 lanzamientos arrancaron (el prompt de oh-my-zsh se come el primer carácter); con reenvío, 5 de 5, todos al segundo intento y con un solo \`claude\` lanzado.`)
    continue
  }

  // W-C, points 1/2: the claim is made BEFORE creating the worktree. An exit 1
  // from dispatch-check can mean an EXPECTED result of the protocol (a
  // collision detected in time, a lost race with a clean revert, or a one-off
  // infrastructure failure that mutated nothing and left nothing stuck — D2
  // review, minor 3) — this slice is skipped and we carry on with the rest of
  // the batch, if any is left — or it can mean that an issue was left ORPHANED
  // in status:in-progress because the subsequent revert failed too ('stuck').
  // `classifyClaimOutcome`, further up, is what tells these cases apart from
  // the text dispatch-check has already printed, because its exit 1 on its own
  // conflates the five causes (D2, finding 3). An exit other than 0/1 (exit 2,
  // or a failure to launch the subprocess at all) is NEVER an expected result
  // of the protocol — it would be a bug or a bad configuration that would fail
  // the same way for every remaining slice of this same batch.
  //
  // Only 'stuck' (and the unexpected exit further down) abort the WHOLE batch
  // — 'skip' and 'infra' carry on with the rest (see classifyClaimOutcome's
  // header comment for why 'infra' is treated that way).
  //
  // Finding 1 — the yield checkpoint: if a SIGINT/SIGTERM arrived while this
  // process was not blocked in any synchronous call (e.g. idle between two
  // slices of this same batch), this `await` gives the event loop the chance
  // to process it and to call `handleInterrupt` BEFORE starting one more
  // claim. With the signal absent (production, and most of the tests), this is
  // a yield of ~0 cost (see the big comment block further up for why it is
  // real and not an `Atomics.wait`). It reuses
  // CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS (the same value as the post-claim
  // checkpoint, further down) so that THIS window can be widened
  // deterministically in a test too — there is no need for a new variable per
  // checkpoint, both exist exclusively to give time to send a real signal
  // during the gap.
  //
  // CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT — for tests only (a
  // finding from an external review): sending an EXTERNAL signal in such a way
  // that it reliably arrives at this particular checkpoint is a real timing
  // race (verified by construction: at CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS=0 —
  // the only value at which the original failure showed up — between 10% and
  // 20% of an external test harness's attempts never got processed at all,
  // because the whole pipeline of fake subprocesses could finish before the
  // external process reacted). This variable, instead, makes the process send
  // the signal to itself (`process.kill(pid, sig)`) SYNCHRONOUSLY right here —
  // indistinguishable to Node from an external signal (the same underlying
  // syscall), but with no inter-process timing race whatsoever: the exact
  // point at which it is left pending is deterministic. It only fires from the
  // SECOND iteration onwards (`idx > 0`), in order to simulate "the signal
  // arrived at some point during a previous slice's life" instead of
  // interrupting before there is any slice to revert.
  if (process.env.CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT && idx > 0) {
    process.kill(process.pid, process.env.CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT)
  }
  await sleep(testDelayAfterClaimMs)
  // D5: the `sleep` above resolves in the TIMERS phase, which runs BEFORE the
  // POLL one — where libuv dispatches signals. Without this second yield (the
  // CHECK phase, after poll), an already-pending signal might not have been
  // dispatched yet by the time we get here — measured, 2 out of 8 rounds. See
  // `yieldToSignals`'s header comment.
  await yieldToSignals()
  // Defence in depth (not the only defence — see handleInterrupt's header
  // comment for why it is already 100% synchronous): if the handler already
  // started and set `interrupting` to true at the instant this `await` yields
  // control, process.exit() will already have ended the process before this
  // point is reached. This check covers the case — far more improbable, but
  // not to be dismissed out of hand — of some future route reintroducing a
  // yield inside handleInterrupt. `break` (not `return`: this loop lives at
  // the module's top level, not inside a function) — but in practice, if
  // `interrupting` is true here, `handleInterrupt` has already called
  // `process.exit()` synchronously, so this `break` never actually gets to
  // run; it is belt and braces, not the main defence.
  if (interrupting) break
  const claim = attemptClaim(s)
  if (!claim.ok) {
    // Finding 4: dispatch-check.mjs's exit code contract was widened
    // (1='skip', 3='infra', 4='stuck' — see dispatch-check.mjs's header)
    // precisely so that THIS caller no longer has to parse the free text it
    // prints in order to decide what to do — dispatch-check.mjs's text
    // (COLLISION, a lost race, ATENCIÓN, etc.) is forwarded as it is further
    // up (attemptClaim) and remains the source of DETAIL for a human; the exit
    // code is now the only source of the DECISION.
    if (claim.status === 1 || claim.status === 3 || claim.status === 4) {
      const outcome = classifyClaimOutcome(claim.status)
      // `plans.length`, not `selected.length` (D5, our own review): this loop
      // iterates over `plans`, and `plans` can be SHORTER than `selected` (a
      // slice with no usable number, or whose kickoff does not render, never
      // gets as far as having a plan). Today the two always coincide on the
      // real path —any precondition failure aborts before the loop— so it
      // changes no behaviour; but comparing `idx` against the length of the
      // OTHER array is exactly the class of trap a future change wakes up,
      // and the message that decides ("no candidates left" vs "carrying on
      // with the rest") has to reflect this loop's reality.
      const isLast = idx === plans.length - 1
      // D2, finding 1: on the batch's last candidate there is no "rest" left
      // to carry on with — saying so anyway is the false promise the audit
      // reproduced (the "if any candidate is left" hedge was not enough on its
      // own: the wording must reflect THIS moment's reality, not cover itself
      // with a conditional).
      const continuation = isLast ? 'no quedan más candidatos en esta tanda.' : 'sigo con el resto de esta tanda.'
      if (outcome.kind === 'skip') {
        console.error(`saltando #${s.n}: no se pudo reclamar (${outcome.label}, motivo arriba de dispatch-check) — ${continuation}`)
        continue
      }
      if (outcome.kind === 'infra') {
        // D2 review, minor 3: an infrastructure failure WITH nothing mutated
        // nor stuck (the issue intact in status:ready) says nothing about
        // whether the NEXT candidate — an independent call to dispatch-check —
        // would fail too. We carry on with the batch just as with 'skip', but
        // the message makes it explicit that it is NOT a normal collision —
        // the log must not lie about what happened, even if the control flow
        // is the same.
        console.error(`saltando #${s.n}: no se pudo reclamar — fallo de infraestructura (${outcome.label}), no una colisión normal (motivo arriba de dispatch-check) — ${continuation}`)
        continue
      }
      // 'stuck': the issue was left ORPHANED in status:in-progress, with
      // nobody working on it (dispatch-check already printed its own ATENCIÓN
      // with the manual command). This one DOES stop the whole batch with exit
      // 1: a human has to look at it before ct-next retries anything else
      // against this repo — carrying on blindly here is the gravest scenario
      // the audit reproduced.
      console.error(`dispatch-check devolvió exit ${claim.status} para #${s.n}, y el issue puede haber quedado bloqueado en status:in-progress sin nadie trabajándolo (${outcome.label}) — revisa el ATENCIÓN de dispatch-check (arriba) antes de reintentar cualquier cosa. Abortando toda la tanda: no sigo con el resto de candidatos a ciegas.`)
      console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
      process.exit(1)
    }
    // IMPORTANT (external review): an ordinary terminal Ctrl-C (which DOES
    // reach the child too, unlike finding 1's adversarial scenario) during
    // attemptClaim kills dispatch-check.mjs by signal — `status` is left
    // `null` and `signal` carries the name. Before, this was blamed,
    // indiscriminately, on "probably a bug or a bad configuration (e.g. a
    // malformed --repo)" — an actively misleading message precisely when the
    // user knows perfectly well what happened (they interrupted it
    // themselves), and one that on top of that omitted the most important
    // information: dispatch-check.mjs may have written the claim
    // (status:ready → status:in-progress) BEFORE dying by the signal, and
    // there is no way of knowing from here.
    if (claim.signal) {
      // D5, finding D: the SIGKILL WE ourselves send when
      // CT_NEXT_CHILD_TIMEOUT_MS runs out comes in through this very branch
      // and, before this fix, was presented as somebody else's signal ("it
      // ended by the signal SIGKILL", "before this interruption") without
      // naming the limit or the variable — blaming an interruption on a user
      // who interrupted nothing. It is exactly the distinction the previous
      // round had already added for `git worktree add` (see `timedOut` further
      // down, the same detection) and that was missing here.
      if (claim.timedOut) {
        console.error(`dispatch-check para #${s.n} no terminó dentro del límite de ${childTimeoutFor('dispatch-check')}ms (CT_NEXT_CHILD_TIMEOUT_MS) y lo matamos NOSOTROS con SIGKILL — no fue una interrupción tuya. Al matarlo a mitad de su propio claim-then-verify, no se puede saber si el claim llegó a escribirse: si #${s.n} queda en status:in-progress sin nadie trabajándolo, revierte a mano con ${manualRevertClaimHint(s)}. Si esto pasa contra un repo legítimamente grande/lento (o un \`gh\` que responde despacio), sube CT_NEXT_CHILD_TIMEOUT_MS. Abortando toda la tanda: no sigo con el resto de candidatos a ciegas.`)
        console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
        process.exit(1)
      }
      console.error(`dispatch-check para #${s.n} terminó por la señal ${claim.signal} mientras intentaba reclamar — no se puede saber si el claim llegó a escribirse antes de morir. Si #${s.n} queda en status:in-progress sin nadie trabajándolo, revisa y revierte a mano: ${manualRevertClaimHint(s)}. Abortando toda la tanda: no sigo con el resto de candidatos a ciegas.`)
      console.error('Los slices de esta tanda ya lanzados con éxito antes de esta interrupción (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
      process.exit(1)
    }
    const statusDesc = typeof claim.status === 'number' ? `exit ${claim.status}` : 'sin exit code numérico (fallo inesperado al lanzar el subproceso)'
    console.error(`dispatch-check devolvió un fallo inesperado (${statusDesc}) al intentar reclamar #${s.n} — no es un resultado reconocido del protocolo (1/3/4), así que probablemente es un bug o una mala configuración (p.ej. --repo mal formado, o dispatch-check.mjs no encontrado en ${dispatchCheckPath}). Abortando toda la tanda: no sigo con el resto de candidatos a ciegas.`)
    // Round 1 fix, minor: this abort can fire AFTER having successfully
    // launched some earlier slice of the same batch (cap > 1) — just as
    // cleanupOrphanedWorktree already does further down, it has to be made
    // explicit that those slices carry on running in their own cmux,
    // untouched.
    console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
    process.exit(1)
  }

  // Finding 1 — THE dangerous window: #${s.n}'s claim is already written
  // (status:in-progress) and the worktree does not exist yet. `activeClaim`
  // stays non-null from here until its fate is resolved (complete success, or
  // the catch further down after attempting the revert). The `await
  // sleep(testDelayAfterClaimMs)` is the real checkpoint: in production
  // (testDelayAfterClaimMs === 0) it is a yield of ~0 cost that gives the
  // event loop the chance to process an already-pending signal before starting
  // `git worktree add`; in tests, it widens that same window
  // deterministically (see the big comment block further up).
  activeClaim = { n: s.n }
  // CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM — for tests only: the same mechanism
  // and the same reason as CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT
  // further up (a deterministic self-send of the signal, with no external
  // process's timing race) — here for the exact dangerous window finding 1
  // describes: claim already confirmed, worktree not yet created.
  if (process.env.CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM) {
    process.kill(process.pid, process.env.CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM)
  }
  // CT_NEXT_TEST_THROW_AFTER_CLAIM — for tests only (D5, finding G): it throws
  // an arbitrary exception EXACTLY in the dangerous window (claim written,
  // worktree not yet) so that `bailOutOnCrash`'s net can be exercised. It is
  // the same mechanism as the self-signal hook above and exists for the same
  // reason: reproducing an unexpected `throw` at that exact point from outside
  // is not possible deterministically, and the finding this net closes is
  // precisely that ANY throw there left the issue orphaned. Unlike the signal
  // hook, this one needs no validation of its shape: any string is a valid
  // error message, and its only effect is to enter the net being tested.
  if (process.env.CT_NEXT_TEST_THROW_AFTER_CLAIM) {
    throw new Error(process.env.CT_NEXT_TEST_THROW_AFTER_CLAIM)
  }
  await sleep(testDelayAfterClaimMs)
  // D5: same as the previous checkpoint — crossing the POLL phase is what
  // really guarantees that an already-pending signal has been dispatched
  // before checking `interrupting`. This is THE checkpoint of the dangerous
  // window (claim written, worktree not yet), so it is precisely where that
  // ~25% of signals that slipped through did the most damage.
  await yieldToSignals()
  // Defence in depth — the same reasoning as the previous checkpoint: if
  // `interrupting` is true here, `handleInterrupt` (100% synchronous) has
  // already reverted this very claim and called `process.exit()`, so in
  // practice this `break` is never reached — but if something changed that in
  // the future, this avoids creating the worktree on top of an already
  // reverted claim.
  if (interrupting) break

  try {
    // timeout+killSignal (finding 1, defence 2): see the big comment block
    // further up. If `git worktree add` really hangs (a slow remote repo, or
    // something worse) and the signal only reaches this process, this is the
    // only way the catch below (which ALREADY reverts the claim) ever gets to
    // run.
    // (D5, finding E: there used to be an `activeWorktree = {wt, branch}` /
    // `= null` here whose only consumer was an unreachable guard inside
    // `handleInterrupt` — see `activeClaim`'s comment for why it was
    // withdrawn.)
    execFileSync('git', ['worktree', 'add', '-b', branch, wt, `origin/${resolvedBase}`], { cwd: repoRoot, stdio: 'inherit', timeout: childTimeoutFor('worktree-add'), killSignal: 'SIGKILL' })
  } catch (e) {
    // If the worktree or the branch already exist, `git worktree add` fails
    // with exit != 0 — we let it fail noisily instead of silently reusing
    // something that might not correspond to this slice. The claim WAS already
    // obtained (the step above): without reverting it here, this issue would
    // be left orphaned in status:in-progress with nothing running — the same
    // reason as cleanupOrphanedWorktree further down, but here there is no
    // worktree/branch to clean up (git worktree add failed before creating
    // anything).
    // MINOR (external review): the message used not to distinguish "git
    // worktree add failed fast" (branch/path already occupied, etc.) from "we
    // have just killed it ourselves because the timeout ran out" — in this
    // second case, the user needs to know the exact limit, the variable that
    // adjusts it, and that a `git worktree add` killed half-way through
    // (SIGKILL, not a clean shutdown) may have left a half-created
    // directory/branch on disk, something not even `git worktree list` always
    // reflects reliably.
    const timedOut = e.signal === 'SIGKILL' && /ETIMEDOUT/.test(e.message || '')
    if (timedOut) {
      console.error(`no se pudo crear el worktree para #${s.n} en ${wt}: se agotó el límite de ${childTimeoutFor('worktree-add')}ms (CT_NEXT_CHILD_TIMEOUT_MS) esperando a "git worktree add" y se mató el proceso (SIGKILL). Al matarse a mitad de camino (no un fallo limpio), puede haber quedado un directorio y/o una rama a MEDIO crear en ${wt} / ${branch} — revísalo a mano (\`git worktree list\`, \`git branch\`) antes de reintentar este slice; si sigue ahí, límpialo con \`git worktree remove --force ${wt}\` / \`git branch -D ${branch}\`. Si esto pasa contra un repo legítimamente grande/lento, sube CT_NEXT_CHILD_TIMEOUT_MS.`)
    } else {
      console.error(`no se pudo crear el worktree para #${s.n} en ${wt}: ${e.message}`)
    }
    const claimErr = attemptRevertClaim(s)
    activeClaim = null
    if (!claimErr) {
      console.error(`claim de #${s.n} revertido automáticamente a status:ready — puedes reintentar el dispatch de este slice.`)
    } else {
      console.error(`ATENCIÓN: no se pudo revertir automáticamente el claim de #${s.n} (${claimErr.message}). Queda bloqueado en status:in-progress — revierte a mano con: ${manualRevertClaimHint(s)}`)
    }
    process.exit(1)
  }
  // F22: the ignore rule BEFORE seeding. If the file came to exist without the
  // rule in place, a `git add -A` from the agent could already carry it off.
  const ignored = ensureSliceIgnored()
  if (!ignored.ok) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo garantizar que ${SLICE_REL_PATH} quede fuera de git (${ignored.why}). NO se siembra: un estado de slice que git puede ver acaba dentro del PR y de ahí a main.`)
  }
  // ==========================================================================
  // Slice 9(b) — THE CUT IS MEASURED WHERE IT WAS CUT, NOT BEFORE.
  //
  // `resolvedBaseSha` is resolved ONCE before the loop (after the fetch) and
  // the worktree is cut HERE. With `--cap N` and another session fetching the
  // same repo in between, `origin/<base>` may have moved in that gap: the sha
  // resolved earlier would no longer be the cut, and `base_sha:` —the field
  // that exists precisely to be the diff's fixed point— would point at a
  // commit this branch does not have underneath it. The observable consequence
  // is mild (--release's diffs use `base...HEAD`, i.e. merge-base; only
  // `readFileAtBase` looks at the fixed point, and it would give a spurious
  // "does not exist in the base" — the same class of failure slice 2 fixes,
  // much rarer).
  //
  // The HEAD of the freshly created worktree does not have that gap by
  // construction: `git worktree add -b <branch> <wt> origin/<base>` (above)
  // creates the branch AT the commit `origin/<base>` pointed to at THAT
  // instant, and nothing moves it after that — the agent does not exist yet.
  // It is strictly better and no more expensive: one more rev-parse, and in
  // the normal case it returns the same sha.
  //
  // It feeds BOTH fields that used to come from `resolvedBaseSha` (`base_sha`
  // and `last_commit`): both want the same thing —the point this branch came
  // off— and `buildStateSeed` serves them from the same argument.
  //
  // If the rev-parse fails (very rare in a worktree git has just created: an
  // unreadable .git, a full disk, the timeout) we do NOT abort and we do NOT
  // omit the field: we fall back to the sha from before the loop, which is the
  // behaviour from before this change. Degrading to yesterday's value is
  // acceptable; seeding a gap where there was a reasonable sha is not. The
  // omission stays reserved for the case where there is NO sha at all, which
  // is the one covered by the resolution warning above.
  // ==========================================================================
  // #96: the baseline is measured HERE, with the worktree already cut and
  // before seeding — the seed carries it inside. If the rev-parse below fails,
  // the fallback seed carries it just the same: the baseline does not depend
  // on the cut.
  const baseline = await measureBaseline(s, wt)
  let seedToWrite = buildStateSeed(sliceForKickoff, { branch, base: resolvedBase, baseSha: resolvedBaseSha, baseline })
  try {
    const cutSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
      cwd: wt, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    }).trim()
    if (cutSha) seedToWrite = buildStateSeed(sliceForKickoff, { branch, base: resolvedBase, baseSha: cutSha, baseline })
  } catch (e) {
    console.error(`aviso: no se pudo medir el corte real en el worktree de #${s.n} (\`git rev-parse HEAD\` en ${wt} falló: ${e.message}). La semilla se siembra con el sha que se resolvió de "origin/${resolvedBase}" antes de la tanda${resolvedBaseSha ? ` (${resolvedBaseSha.slice(0, 12)}…)` : ', que tampoco se pudo resolver: irá sin `base_sha` y con `last_commit` vacío'} — el comportamiento anterior a esta mejora: puede ser el corte, o puede haberse quedado atrás si algo movió origin/${resolvedBase} entre medias.`)
  }
  try {
    mkdirSync(`${wt}/.agent`, { recursive: true })
    writeFileSync(`${wt}/${SLICE_REL_PATH}`, seedToWrite)
  } catch (e) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo sembrar ${SLICE_REL_PATH}: ${e.message}`)
  }
  // ==========================================================================
  // F22 — THE EFFECT IS VERIFIED, NOT THE EXIT CODE.
  //
  // The two writes above can exit 0 and still leave the file VISIBLE to git: a
  // user's core.excludesFile with odd precedence, a `.gitignore` with a
  // negation (`!.agent/*`) that beats our rule, a repo where somebody tracked
  // the path by hand in the past. None of those is detected by looking at
  // whether `writeFileSync` threw.
  //
  // The only question that matters is the one git answers: does it see the
  // file? If it does, the dispatch does NOT carry on. It aborts by the same
  // route as any failure after creating the worktree (it reverts the claim,
  // deletes the branch and the directory), because dispatching an agent that
  // is going to contaminate main is worse than not dispatching it.
  // ==========================================================================
  // Round 1 fix, Important finding 1: `--untracked-files=all`, NEVER the
  // default mode. With the default, git COLLAPSES an entirely untracked
  // directory into a single line (`?? .agent/`) instead of listing each file
  // (`?? .agent/SLICE.md`) — and `.agent/` is entirely untracked in any repo
  // whose checkout does not already have a tracked `.agent/STATE.md` (or
  // another file under `.agent/`). The `.some(includes(SLICE_REL_PATH))` below
  // finds nothing in that collapsed line, the gate lets the dispatch through,
  // and the agent's `git add -A` carries the file off anyway: exactly the
  // contagion this check exists to close. `--untracked-files=all` forces git
  // to list each individual file regardless of its directory's tracking
  // state.
  let porcelain = null
  try {
    porcelain = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: wt, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    })
  } catch (e) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo COMPROBAR que ${SLICE_REL_PATH} queda fuera de git (\`git status --porcelain\` falló: ${e.message}). No se afirma que esté bien: sin esa comprobación, un estado de slice visible para git acaba en el PR y de ahí a main.`)
  }
  if (porcelain.split('\n').some((l) => l.includes(SLICE_REL_PATH))) {
    cleanupOrphanedWorktree(s, wt, branch, `${SLICE_REL_PATH} SIGUE siendo visible para git en ${wt} después de escribir la regla de ignore en ${ignored.path}. Causas típicas: una negación en el .gitignore del repo que gana a la regla (p. ej. \`!.agent/*\`), un core.excludesFile con precedencia, o que alguien trackeara ese path a mano en el pasado (y ninguna regla de ignore afecta a un fichero ya trackeado: haría falta \`git rm --cached ${SLICE_REL_PATH}\`). No se despacha este slice: su estado acabaría dentro del PR.`)
  }
  // F19/H1: the start-up script is written BEFORE invoking cmux — cmux types
  // the `.` immediately, and a fast shell could source it before it existed.
  // `recursive: false` on purpose: if the directory is already there (another
  // process with the same pid is impossible; a symlink placed by hand in a
  // shared /tmp is not), that is an error that has to be seen, not something
  // to reuse in silence. Mode 0700 for the same reason: the kickoff can carry
  // context from the repo inside it.
  try {
    mkdirSync(launchDir, { recursive: false, mode: 0o700 })
    // 0600 and NOT 0700, and this is not hygiene: it is part of the detection.
    // Found while writing the finding's test — if the script were EXECUTABLE,
    // eating the `.` of `. '<path>'` would leave ` '<path>'`, which the shell
    // runs just the same as a program: the sentinel would appear, the agent
    // would start in a subshell with none of the user's aliases or functions,
    // and the corruption of the line would be UNDETECTABLE. With no execute
    // bit, that same corruption gives "Permission denied", there is no
    // sentinel, and it is said. A script that is only sourced does not need to
    // be executable; that it cannot even be is what makes the check
    // hole-free.
    writeFileSync(launcherPath, launcherScript, { mode: 0o600 })
  } catch (e) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo escribir el script de arranque en ${launchDir} (${e.message}). Sin él, el comando que cmux teclea no existiría y el agente no arrancaría — así que NO se lanza nada y se deshace lo hecho, en vez de despachar a ciegas.`)
  }
  try {
    execFileSync('cmux', cmuxArgv, { stdio: 'inherit', timeout: childTimeoutFor(), killSignal: 'SIGKILL' })
  } catch (e) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo lanzar cmux: ${e.message}`)
  }
  // finding 1 + F19: the dangerous window CLOSES HERE, not at the end of the
  // iteration, and the change is compulsory because of what comes right below.
  // A non-null `activeClaim` means "if a signal arrives, revert this claim":
  // that was correct while the gap between the claim and the launch was
  // measured in microseconds. Waiting for the sentinel opens it up to
  // CT_NEXT_LAUNCH_TIMEOUT_MS of `await`s — that is, REAL time in which a
  // Ctrl-C does get dispatched — and by then `cmux new-workspace` has already
  // returned 0: there may be a live agent. Reverting its claim because of a
  // signal would be precisely the damage the rest of this round avoids. From
  // here on, an interruption undoes nothing; the paths that DO have to undo
  // (the 'no-claude' below) call attemptRevertClaim explicitly and do not
  // depend on this variable.
  activeClaim = null
  // ==========================================================================
  // F19/H1 — THE EFFECT FIRST, THE WINDOW AFTERWARDS.
  //
  // The sentinel is consulted BEFORE cmux, and that order is the fix: the
  // question «did the command run?» dominates «does the window exist?». The
  // window is opened by the dispatcher itself; the sentinel can only be
  // written by the shell that executed the order.
  // F20/H1: the wait is no longer a single wait — it is a budget split into
  // attempts, with a RESEND of the same line between one and the next. See
  // awaitLaunchSentinelWithRetypes and the constants block for the measurement
  // that justifies it (0/6 without a resend, 5/5 with it, against the real
  // cmux).
  const sentinel = await awaitLaunchSentinelWithRetypes({ sentinelPath, expectedCwd: wt, title: name, typedCommand })
  const reenvio = retypeNote(sentinel.retypes, sentinel.retypeProblem)
  // Finding 3: `new-workspace` has already returned success (otherwise the
  // line above would have aborted) — but that, on its own, NEVER implies that
  // the session started in `wt` (cmux tolerates a non-existent cwd and carries
  // on in the default login shell). verifyCmuxLaunch queries read-only (it
  // never launches anything) in order to tell the three possible cases apart
  // before deciding what to say.
  const launchCheck = verifyCmuxLaunch(name, wt)
  // IMPORTANT (external review): before, 'wrong-cwd' and 'not-found' printed
  // their own ATENCIÓN but incremented `launchedCount` anyway — with which the
  // batch ended in "lanzados 1/1" and exit 0, which a `/loop` reads as normal
  // progress. And since the issue stays in status:in-progress with a worktree
  // present, staleness detection itself (finding 2) would never flag it either
  // — a slice with no confirmed agent became invisible forever. Only the two
  // cases where there is no POSITIVE evidence of a problem count as
  // "launched": 'confirmed' (really verified) and 'unverifiable' (cmux could
  // not be queried — the same "benefit of the doubt" criterion 'infra' already
  // uses in classifyClaimOutcome, because a failed query says nothing about
  // whether the launch was good or bad). 'wrong-cwd' and 'not-found' ARE
  // positive evidence that something went wrong, so they do NOT count — if
  // this were the batch's only selection, the final exit code falls, with no
  // further changes, into the already existing 3 ("selected but zero confirmed
  // launches, retry later"), instead of an exit 0 that asserts more than is
  // known.
  //
  // F19/H1 — THE NEW GATE, AND IT COMES BEFORE EVERYTHING ELSE.
  //
  // The four `verifyCmuxLaunch` cases below are only evaluated if the sentinel
  // says the command RAN. Without that, it does not matter what cmux answers
  // about its window: the window existed on the day the agent did not start
  // too. The three verdicts that cut things short here:
  //
  //   'no-claude' → NEGATIVE certainty. The script ran and `claude` does not
  //                 resolve in that shell: the next line dies with "command
  //                 not found" and there is not going to be an agent, neither
  //                 now nor in ten seconds. It is the ONLY case where things
  //                 can be undone without risk, so it is undone entirely
  //                 (worktree, branch and claim) by the same route any failure
  //                 after the worktree already uses. It also closes the "not
  //                 conclusive" warning the preflight could only suspect: the
  //                 PATH that matters is the login shell's that cmux opens,
  //                 not this process's, and now it is known with evidence.
  //   'wrong-cwd' → the command ran in ANOTHER directory (a datum taken from
  //                 the shell's own `$PWD`, not from the field cmux reports).
  //                 There is a possibly live agent touching somewhere else:
  //                 NOTHING is deleted, it counts as not launched and it is
  //                 enumerated.
  //   'never' /
  //   'garbled'   → it cannot be confirmed. And here is the decision this
  //                 round had to take and which is not comfortable: the claim
  //                 is NOT reverted. An absent sentinel is compatible with the
  //                 field case (the command never ran) and with a shell that
  //                 takes nine seconds to start, and from here they cannot be
  //                 told apart. Reverting the claim and deleting the worktree
  //                 with an agent that starts late is destroying live work;
  //                 leaving the residue and SHOUTING about it —exit 1, with
  //                 the exact commands— is recoverable. The recoverable one is
  //                 chosen. What is NOT done, and that was the whole finding,
  //                 is calling it "launched" and exiting with 0.
  if (sentinel.status === 'no-claude') {
    cleanupOrphanedWorktree(s, wt, branch, `el comando SÍ llegó a ejecutarse en la sesión de cmux (el centinela de arranque está escrito en ${sentinelPath}), pero \`${agentBin}\` NO resuelve en ese shell de login — \`command -v ${agentBin}\` falló DENTRO de la propia sesión. El agente no va a arrancar: la línea siguiente muere con "command not found", igual que si no se hubiera lanzado nada. Esto no lo puede ver el preflight de ct-next.mjs, que solo mira el PATH de ESTE proceso; el que cuenta es el del shell que abre cmux (donde \`${agentBin}\` puede ser además un alias o una función). Arregla el PATH de tu shell de login —o apunta CT_AGENT_BIN a un ejecutable que sí resuelva ahí— y reintenta`)
  }
  if (sentinel.status === 'wrong-cwd') {
    console.error(`ATENCIÓN: el comando de #${s.n} SÍ se ejecutó (el centinela de arranque está escrito), pero el shell que lo ejecutó estaba en "${sentinel.cwd}", NO en ${wt}. El dato sale del \`$PWD\` del propio shell, no de lo que cmux diga de su ventana: hay un agente arrancando sobre un directorio que no es el worktree de este slice, así que puede estar tocando otro repo. NO se cuenta como lanzado con éxito, y NO se borra nada: revisa esa sesión antes.`)
    unverifiedLaunches.push({ n: s.n, wt, branch, name, why: `el comando se ejecutó, pero en "${sentinel.cwd}" y no en ${wt} (según el $PWD del propio shell)` })
    continue
  }
  if (sentinel.status === 'never' || sentinel.status === 'garbled') {
    const ventana = launchCheck.status === 'confirmed' || launchCheck.status === 'cwd-unknown'
      ? ' La ventana de cmux SÍ existe con el título esperado — pero eso ya no cuenta como prueba de nada: la abre este mismo dispatcher, y el día del hallazgo también existía.'
      : launchCheck.status === 'not-found'
        ? ' Y cmux tampoco encuentra ninguna sesión con ese título: dos ausencias, no una.'
        : ''
    const detalle = sentinel.status === 'garbled'
      ? `el fichero centinela ${sentinelPath} EXISTE pero no tiene el formato esperado (empieza por «${sentinel.raw}»), así que no dice nada fiable`
      : `el centinela de arranque ${sentinelPath} NO apareció en ${launchSentinelTimeoutMs} ms`
    // F20/H1: what was ATTEMPTED, not just how long was waited. The three
    // situations lead you to look in different places and until now all three
    // said the same thing.
    const reintentoFallido = sentinel.retypeProblem
      ? ` Y el reenvío automático de la línea tampoco se pudo hacer: ${sentinel.retypeProblem}.`
      : sentinel.retypes > 0
        ? ` Y esto YA no se arregla esperando más: la línea se reenvió ${sentinel.retypes} ${sentinel.retypes === 1 ? 'vez' : 'veces'} a esa sesión dentro del presupuesto y siguió sin ejecutarse — mira qué hay en esa pantalla.`
        : ` No hubo ningún reenvío automático: el presupuesto (${launchSentinelTimeoutMs} ms) no dio para un intento más allá del primero.`
    console.error(`ATENCIÓN: cmux aceptó el lanzamiento de #${s.n} (exit 0) y la ventana está abierta, pero ${detalle} — NO se puede confirmar que el comando llegara a ejecutarse. Los dos casos que esto cubre son indistinguibles desde aquí: (a) el comando nunca corrió —el shell de login se comió parte de la línea al arrancar, que es lo que pasó en el primer despacho real de este loop: un prompt de oh-my-zsh convirtió \`claude\` en \`laude\`— o (b) ese shell sigue arrancando y va a ejecutarlo dentro de un momento. Por eso NO se cuenta como lanzado y por eso TAMPOCO se revierte el claim solo: mira la sesión de cmux "${name}". Si el shell está ahí parado en un prompt, el agente no va a arrancar nunca. Si tu shell de login tarda de verdad tanto, sube CT_NEXT_LAUNCH_TIMEOUT_MS (ahora ${launchSentinelTimeoutMs}).${ventana}${reintentoFallido}`)
    unverifiedLaunches.push({ n: s.n, wt, branch, name, why: sentinel.status === 'garbled' ? `el centinela de arranque existe pero es ilegible: no se puede afirmar que el comando corriera` : `el comando no dejó constancia de haberse ejecutado en ${launchSentinelTimeoutMs} ms (centinela ausente en ${sentinelPath})` })
    continue
  }
  // From here on the command RAN, in the right directory and with `claude`
  // resolvable. All that is left to decide is how much we know about the
  // WINDOW, which is a less important question and can no longer produce a
  // false "launched" on its own.
  // The `-OK` watcher is only launched if this slice COUNTS as launched, and
  // `launchedCount` is exactly that fact: the two branches that do not
  // increment it ('wrong-cwd' and 'not-found') are the ones that record the
  // slice in `unverifiedLaunches`, and in both of them the session's title
  // —the watcher's only handle— is precisely what cmux has just denied.
  const lanzadosAntesDeVerificar = launchedCount
  if (launchCheck.status === 'confirmed') {
    console.log(`lanzado #${s.n} en ${wt} — verificado: la sesión cmux está corriendo en ese directorio, y el comando llegó a ejecutarse de verdad (centinela de arranque escrito por el propio shell, con $PWD=${sentinel.cwd} y \`claude\` resoluble).${reenvio}`)
    launchedCount++
  } else if (launchCheck.status === 'wrong-cwd') {
    // D5, finding A: besides the ATENCIÓN, the slice is RECORDED in
    // `unverifiedLaunches` — because this case leaves real state behind (claim
    // written, branch and worktree created, and a `cmux new-workspace` that
    // returned 0, i.e. possibly an agent running) and the final summary has to
    // be able to say so instead of asserting "nothing was left half-done".
    console.error(`ATENCIÓN: cmux aceptó el lanzamiento de #${s.n} (exit 0), pero la sesión NO está en ${wt} — está en "${launchCheck.actualCwd}" en su lugar (cmux tolera un cwd inexistente y arranca en el shell de login por defecto en vez de fallar; ¿el worktree no llegó a existir a tiempo, o se borró justo antes?). El agente puede estar corriendo en el directorio equivocado — revisa la sesión a mano antes de asumir que está trabajando #${s.n}. NO se cuenta como lanzado con éxito.${reenvio}`)
    unverifiedLaunches.push({ n: s.n, wt, branch, name, why: `la sesión de cmux existe pero está en "${launchCheck.actualCwd}", no en ${wt} — aunque el comando SÍ se ejecutó (su propio $PWD era ${sentinel.cwd}), así que lo más probable es que haya un agente vivo: no borres nada sin mirarlo` })
  } else if (launchCheck.status === 'not-found') {
    console.error(`ATENCIÓN: cmux devolvió éxito (exit 0) al lanzar #${s.n}, pero no se encontró ninguna sesión con el nombre "${name}" al consultarlo — no se puede confirmar que el agente esté corriendo en absoluto, y mucho menos en ${wt}. El comando SÍ llegó a ejecutarse (centinela de arranque escrito, $PWD=${sentinel.cwd}), o sea que muy probablemente hay un agente vivo en alguna parte y lo que falla es localizar su ventana. Revisa cmux a mano. NO se cuenta como lanzado con éxito.`)
    unverifiedLaunches.push({ n: s.n, wt, branch, name, why: `cmux respondió y no hay ninguna sesión con el título "${name}" (pero el comando sí se ejecutó: probablemente hay un agente vivo cuya ventana no se localiza)` })
  } else if (launchCheck.status === 'cwd-unknown') {
    // D5, finding B: the session DOES exist with the exact title we asked for
    // — that is positive evidence that the launch happened. The only thing
    // missing is the directory, and it is missing because cmux did not give us
    // a readable field, not because it is somewhere else. It counts as
    // launched (the same "benefit of the doubt in the face of an incomplete
    // query" criterion as 'unverifiable'), but the message does not assert
    // "verified".
    console.log(`lanzado #${s.n} en ${wt} — la sesión de cmux con el título esperado EXISTE, pero cmux no expuso un directorio legible para ella (¿esquema/versión distinta de la esperada?), así que NO se pudo comprobar que esté corriendo en ${wt}. Eso sí: el comando llegó a ejecutarse (centinela de arranque escrito) y su propio $PWD era ${sentinel.cwd}, que es el worktree esperado — así que lo que falta es el dato de cmux, no la evidencia del arranque.${reenvio}`)
    launchedCount++
  } else {
    // F19/H1: this path is no longer the "benefit of the doubt" it was.
    // Before, not being able to query cmux left the launch with NO evidence at
    // all and it counted anyway; now the sentinel has already said, on its own
    // and without asking cmux anything, that the command ran in the right
    // place. The only thing not known is in which window.
    console.log(`lanzado #${s.n} en ${wt} — no se pudo verificar la sesión de cmux (la consulta falló: ¿daemon caído?), pero el comando SÍ llegó a ejecutarse: el centinela de arranque está escrito, con $PWD=${sentinel.cwd} y \`claude\` resoluble en ese shell. Lo que no se sabe es en qué ventana de cmux quedó.${reenvio}`)
    launchedCount++
  }
  // finding 1: the slice was launched completely — there is no longer a claim
  // "in the dangerous window" that a future signal handler (for the NEXT slice
  // of this same batch) should touch. This is true REGARDLESS of
  // verifyCmuxLaunch's result: the claim itself is already resolved
  // (in-progress, deliberately — it is not reverted just because the session
  // could not be verified, that would be overreacting to a different
  // uncertainty).
  // (F19: `activeClaim` was already set to null ABOVE, as soon as `cmux
  // new-workspace` returned success — see the comment there: from that instant
  // there may be a live agent and a signal cannot revert its claim. This line
  // is kept as an idempotent one in case the flow above changed; it is not the
  // one that closes the window.)
  activeClaim = null
  if (launchedCount > lanzadosAntesDeVerificar) lanzarVigilanteDelGo(s, name)
}

// D2 review, minor 1: ALL of this counting/exit-code block is exclusive to the
// REAL path — a --dry-run neither claims nor launches ANYTHING for real (it is
// purely informative, `launchedCount` is always 0 there by construction). A
// "lanzados 0/N" line at the end of a successful --dry-run would be exactly
// the same class of misleading message this task exists to eliminate, only the
// other way round (asserting "zero launches" about a plan that never even
// attempted them).
//
// D5, finding C: the verdict is COMPUTED here and applied at the end of the
// file, after the last yield point — see the big block further down. Before,
// each branch called `process.exit()` directly, which made it impossible to
// give an already-pending signal its chance of being acknowledged without
// duplicating the yield at every exit.
let finalExitCode = 0
// D5, finding H: under --dry-run the preconditions summary goes AT THE END,
// after the whole batch has been printed — it is the last thing read, and what
// fixes the exit 1. On the real run this block is not reached: it aborts much
// earlier, on detecting the same preconditions.
if (dryRun && preflightFailures.length) {
  console.error(preflightSummary())
  console.error('Este --dry-run NO es luz verde: la corrida real se pararía en las precondiciones de arriba, sin escribir ningún claim. Arréglalas TODAS y vuelve a pasar el dry-run.')
  finalExitCode = 1
}
if (!dryRun) {
  // D2, finding 1: if the loop reaches here (it did not abort with
  // process.exit on any iteration), the batch finished processing completely —
  // but that does not mean anything was launched. Before this fix, a whole
  // batch where EVERY selected slice collided (or lost the race, cleanly, or
  // tripped over an infrastructure hiccup — D2 review, minor 3) when claiming
  // ended in silence: zero agents, zero worktrees, exit 0, with no line saying
  // "of the N selected, 0 were launched".
  console.log(`lanzados ${launchedCount}/${selected.length} slice(s) seleccionados de esta tanda.`)

  // A deliberate exit code, not a reused 0/1/2: when /ct-next runs inside a
  // /loop, whoever invokes it (a human, or another agent) needs to tell three
  // very different situations apart by the exit code, without having to parse
  // the text:
  //   0 = progress (something was launched — wholly or partly — or there was
  //       nothing to launch and why has already been explained with
  //       formatBlockReason). A caller in a /loop can carry on at its normal
  //       pace.
  //   1 = something BROKE (a bug, a bad configuration, or an issue left
  //       orphaned in status:in-progress) — it was ALREADY like this before
  //       this change for mid-batch aborts; a caller in a /loop must stop and
  //       tell a human, not retry blindly. D4 EXTENDS this code, deliberately
  //       and without inventing a new one, to unmet PRECONDITIONS (a
  //       worktree/branch already occupied, `cmux` absent from the PATH, a
  //       kickoff that does not render, a slice with no usable number) — under
  //       --dry-run and on the real run alike: they fit exactly the semantics
  //       it already had ("something requires a human to fix it, retrying
  //       blindly does not help"), and they are not "retry later" (3) because
  //       they do not resolve themselves with time. The difference from before
  //       is WHEN they are detected: now before writing any claim, not
  //       mid-batch.
  //   2 = a usage error or a STATIC CONFIGURATION error: misplaced flags, and
  //       (D4) a kickoff that does not render — both are known without
  //       touching the network or the disk, before deciding anything.
  //   3 = the batch was selected (selected.length > 0) but finished processing
  //       with ZERO launches, and nothing broke NOR WAS LEFT HALF-DONE — every
  //       candidate collided, lost a race cleanly, or tripped over a one-off
  //       infrastructure failure (D2 review, minor 3), against work another
  //       process claimed between ct-next's snapshot and dispatch-check's live
  //       claim (the honest "no compare-and-swap" warning already documented),
  //       or simply against an unstable `gh`. It is not a bug and does not
  //       require manual intervention, but neither is it "nothing to do"
  //       (formatBlockReason already covers THAT case with exit 0): there was
  //       a selection, there was an attempt, there was no progress. A caller
  //       in a /loop should see it as "retry later", different both from 0
  //       (all good) and from 1 (stop and look at what happened).
  //
  // ============================================================================
  // D5, finding A — EXIT 3 MEANT TWO THINGS AND ITS MESSAGE ONLY DESCRIBED
  // ONE.
  //
  // Exit 3's text ("Nada quedó a medias ni bloqueado — reintenta más tarde")
  // was written when `launchedCount === 0` could ONLY mean "we never got as
  // far as claiming anything". The previous round changed that without
  // noticing: by stopping counting as launched a slice whose launch
  // verification does NOT match ('wrong-cwd'/'not-found'), it opened a new
  // road to the same exit 3 — one in which the claim IS written, the branch
  // and the worktree DO exist, and `cmux new-workspace` returned 0 (that is,
  // there may be an agent running). Verified by construction before this fix:
  // with a single slice and cmux answering with another cwd, the output
  // carried `claimed #90 → in-progress` and a `worktree add -b feat/90` in
  // git's log THREE LINES above a message asserting that nothing had been left
  // half-done. And "retry later" was on top of that IMPOSSIBLE in that state:
  // the issue is no longer in status:ready and both the branch and the
  // directory exist, so the next attempt would neither select the slice nor be
  // able to create its worktree.
  //
  // The two cases are genuinely separated here, not by softening the text:
  // `unverifiedLaunches` (populated in the loop) is the EXACT list of slices
  // that left state behind. That that list is the only possible source of
  // residue by the time we get here is checkable by enumerating the loop's
  // exits: 'skip'/'infra' `continue` without mutating anything; 'stuck', the
  // unexpected exit, death by signal, the failure of `git worktree add`, the
  // seed's and `cmux`'s all end in `process.exit()` after attempting their own
  // cleanup (they never get here); 'confirmed', 'cwd-unknown' and
  // 'unverifiable' count as launched. What is left is 'wrong-cwd'/'not-found'.
  //
  // Exit 1 is EXTENDED (no new code is invented) because its semantics are
  // already exactly this: "there is something a human has to look at and clean
  // up; retrying blindly does not help". And it applies EVEN IF the batch
  // launched other slices successfully (`launchedCount > 0`): with cap 2, one
  // confirmed and one unconfirmed, the exit 0 of before announced "progress"
  // while an issue was left in status:in-progress with a worktree, a branch
  // and no confirmed agent — the same lie, only harder to see.
  if (unverifiedLaunches.length > 0) {
    const detail = unverifiedLaunches
      .map((u) => `  - #${u.n}: ${u.why}. Quedan en disco/GitHub: el claim (status:in-progress), la rama ${u.branch} y el worktree ${u.wt}. Si NO hay agente trabajándolo, límpialo con: git worktree remove --force ${u.wt} ; git branch -D ${u.branch} ; ${manualRevertClaimHint({ n: u.n })}`)
      .join('\n')
    console.error(`\nATENCIÓN: ${unverifiedLaunches.length} de los ${selected.length} slice(s) seleccionados quedaron LANZADOS SIN VERIFICAR — no es "reintenta más tarde": hay estado a medias que solo un humano puede resolver, porque no se puede saber desde aquí si hay un agente corriendo o no (mirar la sesión de cmux a mano es la única forma).\n${detail}\nNO borres nada sin comprobar antes que no hay un agente trabajando ahí: un revert del claim con el agente vivo es peor que dejarlo como está.`)
    finalExitCode = 1
  } else if (selected.length > 0 && launchedCount === 0) {
    // From D5 onwards this branch is only reached when there is NO residue
    // (the case above takes it first), so "nothing was left half-done" is at
    // last a true assertion and not an inherited assumption.
    console.error(`ninguno de los ${selected.length} slice(s) seleccionados se lanzó esta vez — todos se saltaron AL RECLAMAR, por colisión, carrera perdida, o un fallo de infraestructura puntual (detalle arriba). No es necesariamente un fallo de configuración: puede ser otro dispatcher (u otra invocación concurrente) adelantándose entre la foto de esta tanda y el claim en vivo, o un gh inestable. Ningún claim quedó escrito, ninguna rama ni worktree se creó, y no hay nada que limpiar a mano — reintenta más tarde, o en la próxima vuelta del /loop.`)
    finalExitCode = 3
  }
}

// ============================================================================
// D5, finding C — THE LAST YIELD POINT, SO THAT A Ctrl-C IS NEVER DISCARDED
// IN SILENCE.
//
// Observed before this fix, with `--cap 1` (the documentation's own headline
// invocation): an external SIGINT arriving while the process is inside a
// blocking call AFTER the second checkpoint (e.g. `git worktree add` itself)
// gave EXIT=0, "lanzados 1/1", and NO TRACE of anything having been pressed.
// The handler can only run when the event loop regains control, and with cap 1
// there is no `await` left ahead: the process reaches its `process.exit()`
// without ever having yielded, and the signal handle is unref'd (it does not
// keep the loop alive), so the signal dies with the process.
//
// The decision here is to ACKNOWLEDGE the signal, not just to document it: the
// batch's summary ("lanzados X/Y" and the verdict) has already been printed
// ABOVE, so yielding control at this point cannot hide information — it can
// only add the acknowledgement that was missing. And it cannot undo anything:
// by the time we get here, all of the loop's mutating work has finished and
// `activeClaim` is null, so `handleInterrupt` reverts no claim; it limits
// itself to saying that the signal arrived late and that what is done is done.
//
// WHY `setImmediate` AND NOT `sleep(0)` (measured, not assumed): a pending
// signal is dispatched in libuv's POLL phase, which runs AFTER the TIMERS
// phase. An `await sleep(0)` (a `setTimeout`) can resolve in the timers phase
// of the SAME turn in which the signal has not yet been dispatched — verified
// by construction with a signal sent during a blocking `execFileSync`: in 2
// out of 8 rounds, the handler had still NOT run after the first `await
// sleep(0)` (and had after the second). A `setImmediate` runs in the CHECK
// phase, immediately AFTER poll: 8/8 rounds of the same experiment with the
// signal already dispatched. That is why this yield —and the loop's two
// checkpoints, see `yieldToSignals`— cross the poll phase instead of trusting
// a timer.
batchFinished = true
await yieldToSignals()
// If `handleInterrupt` ran during the yield above, it has already called
// `process.exit()` (it is 100% synchronous) and this line is not reached. If
// it did not run, there was no pending signal and there is nothing to
// announce.
//
// `process.exitCode` and NOT `process.exit(code)`: this is the only exit point
// that is reached after having printed a lot of text (the --dry-run dumps the
// kickoff as prose and the whole `cmux` line for each slice), and
// `process.stdout` is ASYNCHRONOUS towards a pipe on POSIX — a
// `process.exit()` here does not wait for those writes to drain and could
// truncate the very end of the plan. Setting the code and letting the process
// end on its own keeps the same exit code and drains the output as well;
// nothing keeps the event loop alive at this stage (the signal handles are
// unref'd). The file's other exit points do use `process.exit()` on purpose:
// they are aborts, and their messages go through `console.error`/`writeSync`
// just before.
process.exitCode = finalExitCode

