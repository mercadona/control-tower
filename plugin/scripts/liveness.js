// Signs of life of a slice.
//
// `assessLocalLiveness` answers whether any TRACE of a slice is left on this
// machine —worktree, branch, cmux window—, which is not the same as whether
// anyone is WORKING on it. That difference is precisely the reason a dead slice
// could go unnoticed forever: on dying it leaves the worktree and the branch
// where they were, so "a trace is left" answers yes.
//
// `liveSliceProcesses` answers the other question: is there a `claude` process
// working RIGHT NOW inside each slice's worktree? It is the signal missing from
// `assessLocalLiveness`, and that is why it lives in the same module.

import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// `getCmuxTitles` is a THUNK, not the already computed value (F13): the query
// to cmux (list-windows + one workspace list per window, up to
// CMUX_QUERY_TIMEOUT_MS) only fires if the TWO cheap and local signals
// —worktree on disk, branch in this checkout— have already failed. Before, the
// value arrived precomputed, so asking about the life of an issue always cost
// the full query even when its worktree was sitting right there.
//
// It matters from F13/H3 on, which widens the check to the "cap full" case —
// the MOST COMMON outcome of a /ct-next with something running. Without this
// inversion, every routine invocation would pay for the cmux query only to say
// nothing. The semantics do not change at all: ONE sign of life is enough for
// no note to be emitted, and the order in which they are checked does not
// alter that conjunction.
export function assessLocalLiveness(n, getCmuxTitles, { repoRoot, timeoutMs }) {
  const wt = `${repoRoot}/.worktrees/${n}`
  const hasWorktree = existsSync(wt)
  let hasBranch = false
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/feat/${n}`], {
      cwd: repoRoot, stdio: 'ignore', timeout: timeoutMs, killSignal: 'SIGKILL',
    })
    hasBranch = true
  } catch {
    hasBranch = false
  }
  // Cut short here: with a worktree or a branch we already know there is NO
  // note to emit, and `cmuxChecked` is irrelevant on that path (stalenessNote
  // leaves through the first `return null`). Asserting `cmuxChecked: false`
  // without having asked would be correct but misleading if anyone read the
  // struct outside here, so it is explicitly marked as not consulted.
  if (hasWorktree || hasBranch) return { hasWorktree, hasBranch, hasCmuxWorkspace: false, cmuxChecked: false }
  const cmuxTitles = getCmuxTitles()
  const cmuxChecked = cmuxTitles !== null
  const hasCmuxWorkspace = cmuxChecked && cmuxTitles.some((t) => new RegExp(`#${n}(\\D|$)`).test(t))
  return { hasWorktree, hasBranch, hasCmuxWorkspace, cmuxChecked }
}

// SIGNAL_TIMEOUT_MS: neither `ps` nor `lsof` may leave this command hanging
// forever. `lsof` is the classic case —a dead network mount blocks it
// indefinitely while stat-ing a process's cwd— and /ct-status is sold as
// invokable in a loop by an external watcher: a hang there does not even return
// an exit code. Same criterion as its neighbours (`gh` and `git` in
// ct-status.mjs, and the `execFileSync` of `assessLocalLiveness` just above):
// `timeout` + `killSignal: 'SIGKILL'`, because a SIGTERM to a process stuck in
// a system call does not kill it. The cap is generous on purpose: measured on
// this machine, `ps` takes 26 ms and a grouped `lsof` over 400 PIDs takes
// 180 ms, so 10 s is ~55x the worst measured case — it does not fire because of
// load, only because of a real hang. A timeout arrives here with `status: null`
// (not 1), so it falls through the "could not be checked" branch with its
// reason, never through the empty-list one.
const SIGNAL_TIMEOUT_MS = 10_000
const runCommand = (cmd, args, options) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })

// Exact basename of the PATH a process was invoked with. No `path.basename` on
// purpose: nothing is normalised here, it is cut at the last slash and compared
// as it is.
const invokedName = (path) => path.slice(path.lastIndexOf('/') + 1)

// liveSliceProcesses: which slices have, RIGHT NOW, a `claude` process working
// inside their worktree? It is the question no other signal of the loop
// answers: on dying, an agent leaves worktree, branch and cmux window where
// they were, so everything else keeps saying "alive".
//
// IT IS IDENTIFIED BY THE INVOKED PATH, NOT BY `pgrep -x`, and it is not a
// matter of taste: `pgrep -x claude` does NOT see the Claude Code that is
// running you.
//
// BEFORE THE TWO FACTS, THE ONE THAT DISAMBIGUATES THEM, because without it it
// is easy to take a false conclusion out of here: on macOS `pgrep -x` does NOT
// match against the process name, it matches against the basename of `argv[0]`.
// Checked in isolation with a symlink `falsoclaude` → `/bin/sleep` run as
// `./falsoclaude`:
//   $ pgrep -x falsoclaude  → lists it      (basename of argv[0])
//   $ pgrep -x sleep        → does NOT      (and "sleep" is its ucomm)
// So `pgrep -x claude` does find Claude Code processes — all of them but its
// own ancestors, which is exactly the exception that broke it here. It is not
// that it finds none; it is that it does not find THE one that matters. And
// fact 1 below is what makes the obvious alternative —matching by process
// name— useless too.
//
// Two facts measured on this machine, both today:
//
//   1. The process name is not "claude". The native installer leaves
//      `~/.local/bin/claude` as a symlink to
//      `~/.local/share/claude/versions/<version>`, and the kernel takes the
//      process name from the ALREADY RESOLVED executable:
//        $ ps -u <uid> -o pid=,ucomm=  →  18539  2.1.220
//      The process name IS the version number, and it changes with every
//      update. Any matching by NAME chases a moving target.
//   2. THE DOMINANT CAUSE: `pgrep` excludes its own ancestors. `man pgrep`,
//      flag `-a`: «By default, the current pgrep or pkill process and all of
//      its ancestors are excluded». Since /ct-status is invoked FROM a Claude
//      Code session, the `claude` of that session is an ancestor of the
//      `pgrep` and is left out:
//        $ pgrep -x claude   → does not list pid 18539, which `ps` does
//      With a single session open the output is empty and rc=1 — which this
//      code read as «no match at all, a normal answer» and therefore
//      `comprobado: true`. Result: EVERY healthy in-flight slice came out as
//      «← NO SIGN OF LIFE» with exit 3 and without a single `warning:`, and
//      the residue block asserted «there is no process working inside»
//      about a worktree with an agent inside it. The safe degradation did not
//      kick in because, from the inside, the read «had been a success». It is
//      the worst possible failure of this feature. Do not go back to `pgrep`.
//
// What does identify it is the PATH the process was invoked with, which `ps`
// gives in the `comm` column and which survives the version changes:
//   $ ps -o comm= -p 18539  →  /Users/jpereag/.local/bin/claude
// It is accepted only if its basename is EXACTLY `claude`, comparing string
// against string. The exact match is not zeal: it leaves the desktop app out
// with no extra rule at all —`/Applications/Claude.app/Contents/MacOS/Claude`
// has basename `Claude` with a capital letter, and its helpers `Claude Helper`,
// `Claude Helper (Renderer)`, `Claude Helper (Plugin)`—, and an open desktop
// window is not an agent working in any worktree.
//
// `ps -u <uid>` narrows to the current user, just as `pgrep`'s `-U` did and for
// the same reason: it is what makes reading the partial `stdout` of `lsof`
// further down safe. And `ps`, unlike `pgrep`, does NOT exclude ancestors:
// that is why this path does see the session it is called from. Checked in
// isolation: a process invoked as `<dir>/claude` that runs `pgrep -x claude`
// does NOT see itself in the output; the filter down here does list it.
//
// KNOWN LIMIT, and already PARTIALLY MEASURED. Everything above is measured on
// macOS: that the `comm` column of `ps` carries the invoked PATH is what makes
// this work, and on another operating system that column may mean something
// else.
//
// What was to be verified «if anyone takes the loop to Linux» already has an
// answer, and it was given by the first continuous integration run on
// ubuntu-latest (see the canary of __tests__/ct-status.test.js): on Linux
// `comm` —and its alias `ucomm`— give the INVOKED basename, not the full path
// nor the resolved executable. For the filter down here that makes no
// difference: it takes the basename of whatever `comm` returns, and the
// basename of 'claude' is 'claude'. So the signal works on both systems, by
// different routes.
//
// What is NOT measured on Linux, and is worth knowing before trusting it:
// `comm` is TRUNCATED to 15 characters (TASK_COMM_LEN). It does not affect
// `claude`, but any future binary with a longer name would be compared against
// a cut string. And the rest of the path —the grouping of `lsof`, its exit
// codes, the time caps— is still measured only on macOS.
//
// A single call to `lsof` for every PID (measured: 180 ms over 400 PIDs). A PID
// that dies between the `ps` and the `lsof` breaks nothing, but not because
// `lsof` "exits with 0 and omits it" —that is false, measured—: `lsof` exits
// with **1** as soon as ONE of the requested PIDs is missing, even when the
// rest resolve fine and come in `stdout`. Reading that partial `stdout` is only
// safe BECAUSE the list is narrowed to the current user: every PID in the list
// is our own and readable, so the only reason for one to be missing from the
// output of `lsof` is that it has died —and a dead process is not working in
// any worktree. Without the narrowing by user, someone else's PID (not readable
// for permission reasons) would produce the same rc=1 and would be read here as
// "dead" while it could still be alive: it would be the only way to falsely
// accuse a healthy slice. Do not take it out.
export function liveSliceProcesses(repoRoot, { run = runCommand } = {}) {
  // `process.getuid` does not exist on Windows. Without a uid no narrowing is
  // possible, and an unnarrowed listing breaks the premise that makes the
  // partial read of `lsof` further down safe, so it degrades here instead of
  // taking the risk.
  if (typeof process.getuid !== 'function') {
    return { porSlice: new Map(), comprobado: false, motivo: 'could not determine the current user: process.getuid is not available on this platform' }
  }
  const uid = process.getuid()

  let listing
  try {
    listing = run('ps', ['-u', String(uid), '-o', 'pid=,comm='], { timeout: SIGNAL_TIMEOUT_MS, killSignal: 'SIGKILL' })
  } catch (e) {
    // A `ps` that fails is a read that could NOT be made. Never an empty list
    // presented as a fact: that is exactly the failure this module has just
    // fixed.
    return { porSlice: new Map(), comprobado: false, motivo: `could not list processes with ps: ${e && e.message}` }
  }
  const pids = []
  for (const line of listing.split('\n')) {
    // The PID is the first field and ALL the rest of the line is the path. It
    // is not split on spaces: the desktop app's paths carry them inside
    // (`.../Claude Helper.app/Contents/MacOS/Claude Helper`), and splitting on
    // spaces would turn that line into the loose token `Helper`.
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    if (invokedName(m[2]) !== 'claude') continue
    pids.push(m[1])
  }
  // With no PIDs lsof is not called, and it is not an optimisation: measured,
  // `lsof -a -p "" -d cwd -Fpn` does not return anything empty — it returns the
  // cwd of ALL the readable processes on the machine with rc=0 (hundreds of
  // entries: 399 in the measured run), because an empty PID list restricts
  // nothing. The empty list would then produce one false positive per
  // worktree.
  if (!pids.length) return { porSlice: new Map(), comprobado: true, motivo: null }

  let output
  try {
    output = run('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn'], { timeout: SIGNAL_TIMEOUT_MS, killSignal: 'SIGKILL' })
  } catch (e) {
    // rc=1 with a readable `stdout` is the ps→lsof race, not a failure: see
    // this function's header comment on why narrowing by user is what makes
    // this partial read safe.
    //
    // `status === 1` is the half that can NOT be taken out, and it is not there
    // for decoration: rc=1 is the only code that means "some PID was missing".
    // An `lsof` that does not exist exits with 127, and an `lsof` killed by the
    // `timeout` above arrives with `status: null` — both can carry a `stdout`
    // string (empty, or cut in half). Without this half of the condition, those
    // two cases would be read as a GOOD, partial read: the report would assert
    // "nobody is alive" over a `stdout` that stopped halfway.
    if (e && e.status === 1 && typeof e.stdout === 'string') {
      output = e.stdout
    } else {
      return { porSlice: new Map(), comprobado: false, motivo: `could not read the working directory of the processes with lsof: ${e && e.message}` }
    }
  }

  // `-Fpn` emits triplets: p<pid> / fcwd / n<path>.
  const bySlice = new Map()
  const prefix = `${repoRoot}/.worktrees/`
  let currentPid = null
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) { currentPid = line.slice(1); continue }
    if (!line.startsWith('n') || currentPid === null) continue
    const cwd = line.slice(1)
    const pid = currentPid
    currentPid = null
    if (!cwd.startsWith(prefix)) continue
    // The agent may have gone DEEPER INSIDE the worktree, so the first segment
    // after `.worktrees/` is taken, not the whole path.
    const slice = cwd.slice(prefix.length).split('/')[0]
    if (slice && !bySlice.has(slice)) bySlice.set(slice, pid)
  }
  return { porSlice: bySlice, comprobado: true, motivo: null }
}
