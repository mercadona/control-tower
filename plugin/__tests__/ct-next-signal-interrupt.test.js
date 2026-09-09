// Finding 1 (interruption/staleness audit of the dispatcher): ct-next.mjs did
// not have A SINGLE signal handler. The auditor's reproduction — a real
// dispatch-check that writes the claim and exits 0, a fake `git` hung on
// `worktree add`, SIGINT at 3s — left the issue claimed (status:in-progress)
// FOREVER: no revert, no worktree, no agent, not even a message, only EXIT=130.
//
// These tests cover the TWO defences of the fix (see the big comment block in
// ct-next.mjs, right after the dispatchCheckPath check):
//   1. A real yielding checkpoint (`await sleep(...)`) right after confirming
//      the claim and before creating the worktree — the exact window the
//      finding describes — and another one before starting a fresh claim (idle
//      between two slices of the same batch).
//   2. A time cap on every blocking call to a subprocess (dispatch-check.mjs,
//      `git worktree add/remove`, `git branch -D`, `gh()`), for the case in
//      which the signal NEVER reaches JS because the child is genuinely stuck
//      (verified by construction: a JS signal handler cannot interrupt a
//      blocked synchronous call — see this task's report for the experiment).
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// D4: hermetic environment (account dirs + cmux/claude stubs) — see fixtures/hermetic-env.js
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-sig-'))
  dirs.push(d)
  return d
}

function runInterruptible(args, envOverrides) {
  return spawn('node', [script, ...args], { env: { ...process.env, PATH: fakePath, ...envOverrides } })
}

// ===========================================================================
// F8 — WHY THESE TESTS NO LONGER USE A TIME WINDOW.
//
// The previous setup was: widen the checkpoint window with
// CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS (2000-3000 ms), listen to the child's
// stdout until a marker showed up ("claimed #77") and send the signal at that
// moment. The original comment said that this "avoids any arbitrary sleep", and
// that is half true: the SENDING is tied to observable progress, yes — but the
// signal still has to ARRIVE inside a window of N milliseconds that closes on
// its own. The one who has to arrive in time is this vitest process, which
// competes for CPU with the rest of the suite. On an idle machine 2000 ms look
// infinite; under load, this process may not be scheduled for several seconds
// and the window closes before the 'data' event is even processed.
//
// The new setup inverts who waits for whom. The stubs (`gh issue edit`, `cmux
// new-workspace`) STOP inside the call and do not return until this test
// creates a sentinel file — see __tests__/fixtures/stub-wait.js. Since
// ct-next.mjs is blocked in an `execFileSync` meanwhile, the signal stays
// PENDING at kernel level and is not processed until the call returns and the
// loop reaches its checkpoint: exactly the point these tests want to exercise,
// and now with no race at all. It makes no difference how loaded the machine
// is: the process under test waits.
// ===========================================================================

// waitForFileMatch: waits for `path` to exist and its content to match `re`. It
// is the detector for "the process under test is already INSIDE the call we
// care about" — the stubs record their argv (synchronously) BEFORE stopping.
function waitForFileMatch(path, re) {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (existsSync(path) && re.test(readFileSync(path, 'utf8'))) {
        clearInterval(t)
        resolve()
      }
    }, 5)
  })
}
// release: lets the stopped stub go. It is ALWAYS called AFTER child.kill(),
// which is synchronous at syscall level: when it returns, the signal is already
// pending for the target process, so releasing here cannot overtake the
// dispatch of the signal.
const release = (path) => writeFileSync(path, '')

function collectOutput(child) {
  const state = { out: '' }
  const onData = (d) => { state.out += d.toString() }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  state.exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })))
  return state
}

function runRealSync(args, envOverrides) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const openIssue77 = { number: 77, title: '#77 algo', labels: [{ name: 'status:ready' }], body: '' }

describe('ct-next — SIGINT after a confirmed claim but before creating the worktree (finding 1)', () => {
  // Setup shared by the first two tests (SIGINT and SIGTERM): the signal is
  // sent while ct-next.mjs is BLOCKED inside the `execFileSync` of
  // dispatch-check.mjs, which in turn is stopped inside its `gh issue edit`
  // (the claim). Being blocked, ct-next cannot process the signal: it stays
  // pending. When we release the stub, dispatch-check finishes, ct-next marks
  // `activeClaim` (synchronously, with no `await` in between) and the FIRST
  // point at which it yields control is the post-claim checkpoint — the exact
  // window of finding 1, reached by construction and not by timing.
  async function signalDuringClaimWindow(repoRoot, signal) {
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const releaseFile = join(repoRoot, 'release-gh-edit')

    const child = runInterruptible(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_EDIT_WAIT_FILE: releaseFile,
    })
    const state = collectOutput(child)
    await waitForFileMatch(argvLog, /issue edit 77 .*--add-label status:in-progress/)
    child.kill(signal)
    release(releaseFile)
    const { code, sig } = await state.exited
    return { code, sig, out: state.out, gitLog, argvLog }
  }

  it('reverts the claim automatically, creates no worktree, and exits with 130', async () => {
    const repoRoot = makeRepoRoot()
    const { code, sig, out, gitLog, argvLog } = await signalDuringClaimWindow(repoRoot, 'SIGINT')

    expect(sig).toBeNull() // it ended through its own process.exit(), not killed by the OS
    expect(code).toBe(130)
    expect(out).toMatch(/SIGINT recibido/)
    expect(out).toMatch(/reverted automatically to status:ready/)

    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:ready --remove-label status:in-progress/)

    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  it('the same with SIGTERM: it reverts and exits with 143', async () => {
    const repoRoot = makeRepoRoot()
    const { code, sig, out, gitLog } = await signalDuringClaimWindow(repoRoot, 'SIGTERM')

    expect(sig).toBeNull()
    expect(code).toBe(143)
    expect(out).toMatch(/SIGTERM recibido/)
    expect(out).toMatch(/reverted automatically to status:ready/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  it('several extra signals neither retry the revert nor hang the process (safety invariant under repeated signals)', async () => {
    // CAREFUL — a note on why this test verifies an INVARIANT and not the exact
    // "recibido de nuevo..." message: non-realtime POSIX signals such as SIGINT
    // are not queued — there can only be ONE pending for a process at a time.
    // If a second signal arrives while the first has not yet been "drained" at
    // kernel/libuv level, the OS may merge it with the already pending one
    // instead of delivering it as a second, distinct invocation of the handler
    // — this was observed directly while writing this test (under load, with
    // the full suite running in parallel, the "recibido de nuevo" path was not
    // always reached, even with the same signals sent in the same sequence). No
    // amount of artificial waiting on our part closes that window — it depends
    // on the OS scheduler, not on this script. What IS a real, checkable
    // guarantee: whatever happens with that race, the process NEVER does a
    // double revert, NEVER hangs, and ALWAYS exits with a recognised signal
    // code. That is what gets verified here — a burst of signals, not just
    // two.
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const releaseFile = join(repoRoot, 'release-gh-edit')
    const child = runInterruptible(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      // F8 — the FIRST signal no longer depends on a window: it is sent with
      // the claim stopped inside the stub (a handshake), just as in the two
      // tests above. FAKE_GH_EDIT_DELAY_MS stays because here it does serve a
      // different purpose: it widens the REVERT (which is not where the test's
      // pass or fail is decided) to give the extra signals a chance to arrive
      // while `interrupting` is already set. Whether they arrive or not is
      // still not a requirement — the invariant checked below holds in both
      // cases, and the note above says so.
      FAKE_GH_EDIT_WAIT_FILE: releaseFile,
      FAKE_GH_EDIT_DELAY_MS: '3000',
    })
    const state = collectOutput(child)
    const timers = []
    await waitForFileMatch(argvLog, /issue edit 77 .*--add-label status:in-progress/)
    // A burst of extra signals (not just one) to maximise the probability that
    // at least one arrives while `interrupting` is already set — without
    // depending on getting one single exact race right.
    child.kill('SIGINT')
    for (const delayMs of [50, 150, 300, 600, 1000, 1500]) {
      timers.push(setTimeout(() => { try { child.kill('SIGINT') } catch { /* process already dead: ignore */ } }, delayMs))
    }
    release(releaseFile)
    const { code, sig: signal } = await state.exited
    for (const t of timers) clearTimeout(t)
    const out = state.out

    expect(signal).toBeNull() // it ended through its own process.exit(), never killed outright by the OS
    expect(code).toBe(130)
    // The real invariant: however many extra signals arrive, the automatic
    // revert completes EXACTLY once — never zero (a regression that stopped
    // reverting altogether would pass with `toBeLessThanOrEqual`, pointed out
    // by an external review) and never twice (an overlapping double revert).
    const occurrences = (out.match(/reverted automatically to status:ready/g) || []).length
    expect(occurrences).toBe(1)
    // If the race WAS won this time and a second signal really was processed as
    // a reentry, the message must be the right one (not an error trace nor a
    // second revert) — but it is not required to show up.
    if (out.includes('recibido de nuevo mientras ya se estaba limpiando')) {
      expect(occurrences).toBe(1)
    }
  })
})

// CRITICAL (external review, reproduced 3/3 and 2/2 deterministically against
// the first version of this fix): the signal handler itself, by ending in
// `await sleep(0)` before `process.exit()`, registered a timer BEHIND the main
// loop's ALREADY PENDING timer (its own `await sleep(testDelayAfterClaimMs)`,
// registered BEFORE the signal was processed). Node processes expired timers in
// the order they were registered — at CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS=0 (the
// only PRODUCTION value; the other tests in this file use 2000-3000 so they can
// send an external signal with room to spare, a value that also masked this bug
// completely: with that wide a window the handler's own timer always "won" the
// race anyway) the main loop's timer expired BEFORE the handler's — the loop
// RESUMED, created the worktree, launched cmux, and printed "lanzado" AFTER the
// handler had already reverted the claim to status:ready. The claim ends up
// reverted on GitHub while a real agent keeps running on it: finding 1 exactly,
// caused by the very fix for finding 1.
//
// These two tests reproduce the EXACT race at the real production value
// (CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS unset) — not at the 2000-3000 value the
// rest of this file uses, which would never have detected it (so it was
// confirmed: the ten tests above passed just the same with the bug present as
// without it). Sending the signal from an EXTERNAL process at the exact instant
// of this window is, in itself, one of the timing races these tests ought to
// avoid: verified by construction that, at this delay value, between 10 and 20%
// of the attempts of an external test harness never got to process the signal
// at all (the whole pipeline of fake subprocesses could finish before the
// external process reacted to the stdout data) — a timing failure of the TEST
// ITSELF, not of the code under test. Instead,
// `CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM`/`CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT`
// (test-only hooks, see ct-next.mjs) make the process send the signal to itself
// (`process.kill(pid, sig)`, the SAME underlying syscall as an external signal —
// indistinguishable to Node) synchronously at the exact point to be exercised,
// with no timing race between processes at all. Verified 20/20 without
// exception against the fix, and 0/20 (total reproduction) against the unfixed
// code.
describe('ct-next — CRITICAL: the handler itself must not give the main loop a second chance to mutate (regression from an external review)', () => {
  it('cap 1, self-interruption right after confirming the claim, at the production value (delay unset): it NEVER creates the worktree nor relaunches after the revert', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const r = runRealSync(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM: 'SIGINT',
      // CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS deliberately UNSET: 0, the real
      // production value — it is the only value at which the original bug
      // showed itself.
    })

    expect(r.code).toBe(130)
    expect(r.out).toMatch(/reverted automatically to status:ready/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
    const argv = readFileSync(argvLog, 'utf8')
    // Exactly one claim (the original one) and exactly one revert — never a
    // second `issue edit` that claimed again or repeated anything.
    expect((argv.match(/issue edit 77 --repo o\/r --add-label status:in-progress/g) || []).length).toBe(1)
    expect((argv.match(/issue edit 77 --repo o\/r --add-label status:ready/g) || []).length).toBe(1)
  })

  it('cap 2, self-interruption right before the idle checkpoint ahead of the second candidate: #78 NEVER receives an issue edit', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue78 = { number: 78, title: '#78 otro', labels: [{ name: 'status:ready' }], body: '' }

    const r = runRealSync(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77, openIssue78], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT: 'SIGINT',
    })

    expect(r.code).toBe(130)
    // #77 (the first candidate) did complete before the self-interruption
    // (which only fires from the SECOND iteration of the loop onwards).
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).toMatch(/worktree add -b feat\/77/)
    // #78 never gets as far as attempting a claim: no write, no revert, nothing.
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).not.toMatch(/issue edit 78/)
    expect(gitLogTxt).not.toMatch(/worktree add -b feat\/78/)
  })
})

describe('ct-next — SIGINT in the idle gap between two slices of the same batch (finding 1, pre-claim checkpoint)', () => {
  it('the first slice is left successfully launched; the second is never even attempted', async () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue78 = { number: 78, title: '#78 otro', labels: [{ name: 'status:ready' }], body: '' }
    const cmuxLog = join(repoRoot, 'cmux-invoked')
    const releaseFile = join(repoRoot, 'release-cmux')

    const child = runInterruptible(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open; idx1: ct-next closed; idx2/idx3: dispatch-check(#77)
      // collision-check + readback (clean); idx4/idx5 (were they ever used):
      // dispatch-check(#78) — they should never get invoked.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77, openIssue78], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_CMUX_INVOKED_LOG_FILE: cmuxLog,
      // F8 — a handshake instead of a window: the signal is sent while ct-next
      // is BLOCKED inside the `execFileSync('cmux', …)` that launches #77.
      // Everything that remains ahead until the idle checkpoint before #78 (the
      // session verification, the "launched #77") is synchronous, so the pending
      // signal is dispatched exactly at that checkpoint — the point this test
      // wants to exercise. It used to depend on reacting to the "launched #77"
      // on stdout inside a 2000ms window.
      FAKE_CMUX_NEW_WORKSPACE_WAIT_FILE: releaseFile,
    })
    const state = collectOutput(child)
    await waitForFileMatch(cmuxLog, /new-workspace/)
    child.kill('SIGINT')
    release(releaseFile)
    const { code, sig } = await state.exited
    const out = state.out

    expect(sig).toBeNull()
    expect(code).toBe(130)
    expect(out).toMatch(/SIGINT recibido/)
    // #77 did complete (worktree created) before the signal.
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/77/)
    // #78 never got as far as attempting a claim.
    const argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(argv).not.toMatch(/issue edit 78/)
    expect(out).not.toMatch(/claimed #78/)
    // No claim of our own is left pending a revert (none had been made for
    // #78).
    expect(out).toMatch(/there was no claim of our own pending a revert/)
  })
})

describe('ct-next — `git worktree add` genuinely hung, with the signal never reaching the child (finding 1, defence 2: the time cap)', () => {
  it('it does not hang forever: the configured timeout caps it, reverts the claim and exits with exit 1', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env,
                PATH: fakePath,
        FAKE_GIT_TOPLEVEL: repoRoot,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
        FAKE_GH_COUNTER_FILE: counterFile,
        FAKE_GH_ARGV_LOG_FILE: argvLog,
        FAKE_GIT_LOG_FILE: gitLog,
        FAKE_GIT_WORKTREE_ADD_HANG: '1',
        // A short cap so the test does not have to wait production's default
        // 10 minutes — it exercises the SAME code path.
        CT_NEXT_CHILD_TIMEOUT_MS: '800',
        // F8 — SCOPED TO THE STEP THIS TEST HANGS ON PURPOSE.
        //
        // Without this, the 800ms applied to ALL the subprocesses, and the test
        // came to depend on the machine dispatching the legitimate
        // `dispatch-check` (a node that starts three more nodes) in under
        // 800ms. Reproduced: with another vitest suite running at the same
        // time, 2 out of 6 runs against main failed here with
        //   expected 'warning: ningún patrón de ACCOUNT_MAP c…'
        //   to match /the worktree for/
        // because the cap had fired on dispatch-check, not on `git worktree
        // add`. The right answer is not a wider window (the failure would come
        // back with a more loaded machine), it is that the only child capable
        // of exhausting the cap be the one this test hangs.
        CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE: 'worktree-add',
      },
      // The test's own safety net: if the fix did not work,
      // `FAKE_GIT_WORKTREE_ADD_HANG` NEVER finishes on its own and spawnSync
      // would hang the runner forever. It is a rescue deadline, not an
      // assertion: the "it did not hang" check is `r.signal === null` further
      // down, which does not depend on any threshold.
      timeout: 60000,
    })

    // It did not hang: it ended through its OWN exit, spawnSync's safety net
    // did not kill it (that would leave `signal` holding the killSignal). This
    // used to be checked with `elapsedMs < 5000` — a wall-clock threshold that
    // only said something about how busy the machine was.
    expect(r.signal).toBeNull()
    const out = (r.stdout || '') + (r.stderr || '')
    expect(out).toMatch(/the worktree for/)
    // MINOR (external review): the timeout message must name the exact limit,
    // the environment variable that tunes it, and warn that the SIGKILL may
    // have left a half-created worktree/branch behind.
    expect(out).toMatch(/the limit of 800ms \(CT_NEXT_CHILD_TIMEOUT_MS\) ran out/)
    expect(out).toMatch(/a HALF-created directory and\/or branch may have been left/)
    expect(out).toMatch(/reverted automatically to status:ready|ATTENTION: could not be reverted/)
    const argv = readFileSync(argvLog, 'utf8')
    // the initial claim was indeed written (dispatch-check did get to complete
    // before the hang, which happens AFTERWARDS, in git worktree add)...
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    // ...and the automatic revert was attempted too.
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    expect(r.status).toBe(1)
  })
})

describe('ct-next — malformed CT_NEXT_CHILD_TIMEOUT_MS / CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS (defensive validation, adversarial attack)', () => {
  it('a non-numeric CT_NEXT_CHILD_TIMEOUT_MS → exit 2, clear usage, nothing of gh/git touched', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_CHILD_TIMEOUT_MS: 'not-a-number' },
    })
    expect(r.status).toBe(2)
    expect((r.stdout || '') + (r.stderr || '')).toMatch(/CT_NEXT_CHILD_TIMEOUT_MS invalid/)
  })

  it('a negative CT_NEXT_CHILD_TIMEOUT_MS → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_CHILD_TIMEOUT_MS: '-5' },
    })
    expect(r.status).toBe(2)
  })

  it('a CT_NEXT_CHILD_TIMEOUT_MS above the ceiling (25h) → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_CHILD_TIMEOUT_MS: String(25 * 60 * 60 * 1000) },
    })
    expect(r.status).toBe(2)
  })

  it('a negative CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS: '-1' },
    })
    expect(r.status).toBe(2)
  })

  it('a CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS above the ceiling (60001ms) → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS: '60001' },
    })
    expect(r.status).toBe(2)
  })

  // F8 — the new hook (CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE) is validated like all
  // the others. A test hook that lives in the PRODUCTION script and is read
  // from the environment is exactly the place a value with a typo comes from,
  // and this one in particular fails SILENTLY if it is not validated: with an
  // unrecognised scope, the short cap would apply to no child at all and every
  // one of them would use the 10-minute default — the test that thought it was
  // exercising the timeout path would sit waiting ten minutes against a stub
  // that never finishes, or would pass without having exercised anything.
  it('a CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE with an unknown scope → exit 2, naming the valid ones', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE: 'worktree_add' },
    })
    expect(r.status).toBe(2)
    const out = (r.stdout || '') + (r.stderr || '')
    expect(out).toMatch(/CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE invalid/)
    expect(out).toMatch(/dispatch-check, worktree-add/)
  })

  it('an empty CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE is ignored (equivalent to not setting it): the cap stays global', () => {
    // The empty string = "the variable is there but with no value", the typical
    // case of an `export VAR=` left dangling in the environment. It must not
    // abort, and it must not disable the cap either: with a malformed
    // CT_NEXT_CHILD_TIMEOUT_MS we still expect the USUAL exit 2, not the scope
    // one.
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE: '', CT_NEXT_CHILD_TIMEOUT_MS: 'not-a-number' },
    })
    expect(r.status).toBe(2)
    expect((r.stdout || '') + (r.stderr || '')).toMatch(/CT_NEXT_CHILD_TIMEOUT_MS invalid/)
  })
})
