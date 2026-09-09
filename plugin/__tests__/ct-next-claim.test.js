// W-C: /ct-next must claim every slice (dispatch-check.mjs, status:ready →
// status:in-progress) BEFORE creating its worktree, skip the slice if the claim
// fails through a collision/lost race (exit 1) but carry on with the rest of
// the batch, abort the WHOLE batch on an unexpected failure of dispatch-check
// (an exit other than 0/1), and revert the claim if the dispatch fails AFTER
// claiming (git worktree add, the seeding of STATE.md, or cmux) — so as not to
// leave the issue orphaned in status:in-progress with nobody working on it. See
// the W-C brief and the header comment of scripts/dispatch-check.mjs (T11) for
// the honest warning about why this does NOT close the compare-and-swap gap: it
// only avoids the much more common case of /ct-next never calling
// dispatch-check at all.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// D4: hermetic environment (account dirs + cmux/claude stubs) — see fixtures/hermetic-env.js
import {hermeticEnv} from './fixtures/hermetic-env.js'
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

// spawnSync (not execFileSync): execFileSync only returns stdout when the child
// exits successfully (exit 0) — its stderr, in that case, NEVER reaches
// `e.stderr` because there is no exception to capture it. Several W-C scenarios
// end in an overall exit 0 (the batch makes progress) but with a warning
// message (e.g. "saltando #42...") printed by console.error — with execFileSync
// those assertions would pass falsely for want of that text. spawnSync always
// exposes stdout/stderr separately, exception or no exception.
function run(args, envOverrides = {}) {
  // hermeticEnv() (D4): account dirs + cmux/claude stubs ahead of the real
  // PATH, so that ct-next.mjs's preflight depends neither on $HOME nor on what
  // the machine running the tests happens to have installed.
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...hermeticEnv(), ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// countOccurrences (D2 review, important 1): counts how many times `substr`
// appears in `text`. The duplication of dispatch-check's output (the bug:
// `attemptClaim` forwarded with the default `stdio`, which ALREADY inherits the
// child's stderr into the parent — Node does it automatically in execFileSync
// unless told otherwise — AND ON TOP OF THAT returned it in `e.stderr` to
// forward it again) is invisible to a `toMatch`/`not.toMatch`: the text is
// STILL there, only twice. Without an explicit count, a regression of this
// class passes the whole suite green.
function countOccurrences(text, substr) {
  if (!substr) return 0
  let count = 0
  let idx = text.indexOf(substr)
  while (idx !== -1) {
    count++
    idx = text.indexOf(substr, idx + substr.length)
  }
  return count
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})

function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-claim-'))
  dirs.push(d)
  return d
}

const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

// The fixture tied to --dry-run (CT_NEXT_FIXTURE) already selects #2 without
// touching the network — reused as it is from ct-next-dryrun.test.js for the
// visibility part in --dry-run (point 5 of the W-C brief).
// F13: this fixture described an IMPOSSIBLE state — #1 appeared at the same
// time in `mergedIssues` (that is, closed and merged) and inside `issues`,
// which is the list of OPEN issues (buildDispatchInput only maps
// `rawOpenIssues`). It was harmless while `status:in-review` did nothing; since
// F13/H2 an in-review holds on to its tokens, so that phantom #1 blocked #2
// through `touches:api` and the fixture stopped dispatching anything. What is
// corrected is the contradiction, not the behaviour: a merged issue is not
// open, so it disappears from `issues` and stays in `mergedIssues` — which is
// exactly what this fixture meant to say (#2's dep is merged).
const FIXTURE = JSON.stringify({
  issues: [
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], name: 'refresh', type: 'backend' },
  ],
  mergedIssues: [1],
})

// The real path of dispatch-check.mjs, exactly as ct-next.mjs resolves it
// (relative to its own location) — used to check that the --dry-run line is a
// genuinely copy-pasteable command, not a loose name.
const realDispatchCheckPath = join(dirname(script), 'dispatch-check.mjs')
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ctNextSiblings (F11): the files of `scripts/` ct-next.mjs needs in order to
// start, DERIVED from its own relative imports instead of written by hand. The
// hardcoded list that used to be here was a copy of the dependency graph that
// nobody kept up to date: on adding a new import to ct-next.mjs (F11 added
// `conventions.js`) these tests copied an INCOMPLETE tree and measured an
// ERR_MODULE_NOT_FOUND (exit 1) believing they were measuring the scenario's
// exit code — green on the list of names, false in what they asserted. The
// resolution is transitive; a file that does not exist is ignored, so
// `dispatch-check.mjs` (which some tests delete on purpose) can still be left
// out separately.
function ctNextSiblings(scriptsDirPath) {
  const seen = new Set()
  const pending = ['ct-next.mjs']
  while (pending.length) {
    const f = pending.shift()
    if (seen.has(f)) continue
    seen.add(f)
    let src
    try {
      src = readFileSync(join(scriptsDirPath, f), 'utf8')
    } catch {
      continue
    }
    for (const m of src.matchAll(/from '\.\/([^']+)'/g)) pending.push(m[1])
  }
  return [...seen]
}

describe('ct-next — --dry-run shows the claim without executing it (W-C, point 5; fix round 1, minor: a copy-pasteable line and a real guard)', () => {
  it('prints the REAL, copy-pasteable command (node <ruta> <issue> --repo <repo>), and makes clear that it is not executed', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(new RegExp(`node ${escapeRegExp(realDispatchCheckPath)} 2 --repo menoplus-app/menoplus`))
    expect(r.out).toMatch(/it is not run/i)
  })

  // Fix round 1, minor: the test above only checks the SHAPE of the printed
  // text — a regression that DID really invoke dispatch-check.mjs in --dry-run
  // would stay green as long as the text looked right, even though that
  // invocation tried to talk to the real `gh` against menoplus-app/menoplus. It
  // goes through runReal() (PATH with the stubs) + FAKE_GH_ARGV_LOG_FILE and it
  // is checked that a `gh issue edit` is NEVER recorded — that is a guard on
  // behaviour, not on format.
  it('NEVER really invokes dispatch-check.mjs in --dry-run: no `gh issue edit` is recorded', () => {
    const repoRoot = makeRepoRoot()
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(r.code).toBe(0)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/)
  })
})

describe('ct-next — a successful claim before the dispatch (W-C, point 1)', () => {
  it('dispatch-check exit 0 → it proceeds with the normal dispatch, and the order of invocation is claim → worktree', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/claimed #42/i)
    expect(r.out).toMatch(/launched #42/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    // the claim (gh) happens BEFORE the worktree is created (git)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    const claimIdx = argv.indexOf('issue edit 42 --repo o/r --add-label status:in-progress')
    expect(claimIdx).toBeGreaterThan(-1)
    expect(gitLogTxt).toMatch(/worktree add -b feat\/42/)
  })
})

describe('ct-next — a failed claim (exit 1) skips the slice and carries on with the rest (W-C, point 2)', () => {
  it('#42 collides (exit 1, it is skipped) and #43 does get claimed and dispatched', () => {
    const repoRoot = makeRepoRoot()
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    const collidingRaw = { number: 99, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#42)
      // collision-check → it collides ; idx3: dispatch-check(#43)
      // collision-check → clean ; idx4: dispatch-check(#43) readback → clean
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], [], [collidingRaw], [], []]),
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/COLLISION|collision/i) // dispatch-check's own message, surfaced as it is
    expect(r.out).toMatch(/skipping #42/)
    expect(r.out).toMatch(/launched #43/)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/43/)
    expect(gitLogTxt).not.toMatch(/worktree add -b feat\/42/)
  })
})

describe('ct-next — an unexpected failure of dispatch-check (not exit 0/1) aborts the WHOLE batch (W-C, point 2)', () => {
  it('dispatch-check exit 2 (a usage/config error, simulated through a malformed CT_CLAIM_PRECLAIM_DELAY_MS) → it aborts, it does not carry on with the rest', () => {
    const repoRoot = makeRepoRoot()
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], [], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      CT_CLAIM_PRECLAIM_DELAY_MS: 'not-a-number',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/unexpected failure/i)
    expect(r.out).toMatch(/exit 2/)
    expect(r.out).toMatch(/abort/i)
    // Fix round 1, minor: the abort can fire AFTER some earlier slice of the
    // same batch has been launched successfully (cap > 1) — just as
    // cleanupOrphanedWorktree already does, the abort message has to make
    // explicit that those slices go on running untouched.
    expect(r.out).toMatch(/already launched successfully.*carry on running.*have not been touched/is)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/) // neither #42 nor #43 got as far as creating a worktree
  })
})

// Fix round 1 (W-C review), finding 2 — IMPORTANT: if dispatch-check.mjs is
// missing or gets renamed, Node exits with exit 1 (MODULE_NOT_FOUND) — the SAME
// exit code dispatch-check.mjs uses for "collision/lost race". Without a
// dedicated guard, attemptClaim would classify this as an EXPECTED outcome of
// the protocol: EVERY slice of the batch would be skipped ("saltando #N...")
// and the process would end with exit 0 having dispatched nothing — a silent
// no-op that on top of that contradicts the very "unexpected failure" abort
// message (which claims to cover exactly this case).
describe('ct-next — dispatch-check.mjs absent (W-C, fix round 1, finding 2)', () => {
  // The repo's REAL scripts/dispatch-check.mjs is not touched (renaming it
  // temporarily would put at risk any other test file that invokes it directly
  // and that vitest might run in parallel, in another worker). Instead
  // ct-next.mjs and ONLY the sibling modules it really imports (none of which
  // imports dispatch-check.mjs) are copied into a temporary directory INSIDE
  // the repo itself — so that the resolution of "yaml" (used by
  // scripts/state.js) goes on finding node_modules by walking up directories —
  // and dispatch-check.mjs is deliberately NOT copied: that way
  // `dispatchCheckPath`, resolved relative to the copied ct-next.mjs's new
  // location, points at a file that really does not exist.
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const scriptsDir = join(projectRoot, 'scripts')
  const SIBLING_FILES = ctNextSiblings(scriptsDir)

  it('dispatch-check.mjs does not exist at the resolved path → it aborts at start-up with that path, BEFORE treating it as a collision', () => {
    const copyDir = mkdtempSync(join(projectRoot, 'tmp-missing-dispatch-check-'))
    try {
      for (const f of SIBLING_FILES) cpSync(join(scriptsDir, f), join(copyDir, f))
      const copiedScript = join(copyDir, 'ct-next.mjs')
      const expectedMissingPath = join(copyDir, 'dispatch-check.mjs')
      expect(existsSync(expectedMissingPath)).toBe(false) // precondition: it really is not there

      const repoRoot = makeRepoRoot()
      const r = spawnSync('node', [copiedScript, '--repo', 'o/r', '--cap', '1'], {
        encoding: 'utf8',
        env: {
          ...process.env,
                    PATH: fakePath,
          FAKE_GIT_TOPLEVEL: repoRoot,
          FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
        },
      })
      const out = (r.stdout || '') + (r.stderr || '')
      expect(r.status).toBe(1)
      expect(out).toMatch(/dispatch-check\.mjs was not found/i)
      expect(out).toContain(expectedMissingPath)
      // It must never be read as a "collision" nor try to skip the slice: the
      // start-up guard has to cut in BEFORE getting there.
      expect(out).not.toMatch(/skipping #42/)
      expect(out).not.toMatch(/COLLISION/)
    } finally {
      rmSync(copyDir, { recursive: true, force: true })
    }
  })
})

// D2 review, minor 4: attemptClaim captured dispatch-check's stdout/stderr
// WITHOUT an explicit `maxBuffer` — with `stdio: 'inherit'` (before this
// change) that never mattered, but on moving to capturing (finding 3, so as to
// be able to classify the text) it inherits Node's default (1 MiB per stream).
// A candidate with MANY issues in flight colliding (`COLLISION: #N clashes with
// #A[...] #B[...] ...`, one per issue) can exceed 1 MiB easily against a real
// repo — and Node does not truncate in silence: it kills the child (SIGTERM)
// and `execFileSync` throws with no numeric `status`, which ct-next already
// classifies as "an unexpected failure launching the subprocess" — a loud but
// MISLEADING abort (it looks like a bug/bad config, when in reality it is just
// a large and legitimate message).
//
// This cannot be reproduced by invoking the REAL dispatch-check.mjs: it was
// verified by construction (outside the suite, against
// scripts/dispatch-check.mjs directly) that its own collision branch does
// `console.error(mensajeGrande); process.exit(1)` — and `process.stderr` is
// ASYNCHRONOUS towards a pipe on POSIX (documented in Node's own docs), so an
// immediate `process.exit()` truncates its own write to the size of the OS's
// pipe buffer (64 KiB on this Mac) BEFORE `maxBuffer`, on the reading side, even
// gets to matter — a latent and separate defect in dispatch-check.mjs, outside
// the scope of this task (that file is not touched). That is why this test
// replaces dispatch-check.mjs with a simple double that DOES flush its write
// before exiting (the same pattern applied to __tests__/fixtures/fake-gh-bin/gh),
// so as to isolate and really test the `maxBuffer` ON CT-NEXT.MJS'S SIDE —
// exactly what this test exists to cover — without depending on an unrelated
// bug in a file that cannot be touched.
describe("ct-next — an explicit maxBuffer when capturing dispatch-check's output (D2 review, minor 4)", () => {
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const scriptsDir = join(projectRoot, 'scripts')
  const SIBLING_FILES = ctNextSiblings(scriptsDir)
  // ~2 MiB: above Node's default (1 MiB) and below GH_MAX_BUFFER (20 MiB) — if
  // the fix applies the same limit, this fits whole; if it does not apply it
  // (the bug), Node kills the child before this.
  const BIG_PAYLOAD_BYTES = 2 * 1024 * 1024

  function makeFakeDispatchCheck(dir) {
    writeFileSync(join(dir, 'dispatch-check.mjs'), [
      '#!/usr/bin/env node',
      "// A double of dispatch-check.mjs ONLY for this test (D2 review, minor 4):",
      "// the same output shape as a real COLLISION (a large text on stderr,",
      "// exit 1), but with `process.exitCode` instead of `process.exit()` so as not",
      "// to truncate its own write, for the same reason already documented in",
      "// fake-gh-bin/gh — it is NOT a copy of dispatch-check.mjs, the real file is",
      "// not touched.",
      `process.stderr.write('COLLISION: #42 clashes with ' + 'X'.repeat(${BIG_PAYLOAD_BYTES}))`,
      'process.exitCode = 1',
      '',
    ].join('\n'))
  }

  it('a collision of several MiB is captured whole and treated as a normal skip, not as an unexpected failure', () => {
    const copyDir = mkdtempSync(join(projectRoot, 'tmp-maxbuffer-'))
    try {
      for (const f of SIBLING_FILES) cpSync(join(scriptsDir, f), join(copyDir, f))
      makeFakeDispatchCheck(copyDir)
      const copiedScript = join(copyDir, 'ct-next.mjs')

      const repoRoot = makeRepoRoot()
      const r = spawnSync('node', [copiedScript, '--repo', 'o/r', '--cap', '1'], {
        encoding: 'utf8',
        // The maxBuffer of the test harness ITSELF (D2 review, a collateral
        // finding while building this test): Node's default (1 MiB) is not
        // only the limit ct-next.mjs has to exceed when capturing
        // dispatch-check — it is ALSO the limit of this `spawnSync`, which
        // captures ct-next.mjs's output. Without raising it here, the harness
        // itself would kill ct-next.mjs (SIGTERM) before it got to print
        // "saltando #42", for the SAME reason this test exists to prove — a
        // false negative of the test, not of the code under test.
        maxBuffer: 20 * 1024 * 1024,
        env: {
          ...process.env,
                    PATH: fakePath,
          FAKE_GIT_TOPLEVEL: repoRoot,
          FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
        },
      })
      const out = (r.stdout || '') + (r.stderr || '')
      // NEVER "fallo inesperado" (which is how a child killed by overflowing
      // Node's default maxBuffer looks) — a candidate that collides, however
      // large the message, is still a NORMAL skip of the protocol.
      expect(out).not.toMatch(/unexpected failure/i)
      expect(out).toContain('COLLISION: #42 clashes with')
      expect(out).toMatch(/skipping #42/)
      // A single candidate, it collides, zero launched → the same exit 3 as finding 1.
      expect(r.status).toBe(3)
    } finally {
      rmSync(copyDir, { recursive: true, force: true })
    }
  })
})

// D2 (dispatch audit), finding 2: on the REAL path (without --dry-run) the
// complete list of slices selected for this batch was not printed anywhere
// BEFORE attempting to claim them — if the process aborted halfway, there was
// no way of knowing, after the fact, what had been chosen in total (only what
// was actually attempted). --dry-run does let it be seen implicitly (it prints
// one block per slice of `selected`, never aborting) — the fix prints the
// complete selection explicitly, up front, on BOTH paths.
describe("ct-next — the batch's selection is printed up front on the real path too (D2, finding 2)", () => {
  it('before any claim is attempted, what was selected for this batch is already visible', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/selected.*#42/i)
    // And it appears BEFORE the claim is really attempted.
    const selIdx = r.out.search(/selected.*#42/i)
    const claimIdx = r.out.indexOf('claimed #42')
    expect(selIdx).toBeGreaterThan(-1)
    expect(claimIdx).toBeGreaterThan(-1)
    expect(selIdx).toBeLessThan(claimIdx)
  })
})

// D2 review, minor 1: --dry-run claims and launches NOTHING for real (it is
// purely informative) — but the terminal count "lanzados X/Y" that finding 1's
// fix added at the end of the loop was printed in --dry-run too, where
// `launchedCount` is always 0 by construction. A line "lanzados 0/1" in a
// successful --dry-run is exactly the same class of misleading message this
// task exists to eliminate, only the other way round (it claims "zero launches"
// for a plan that never even attempted them).
describe('ct-next — --dry-run does not print the count of launches (D2 review, minor 1)', () => {
  it('--dry-run with one selected slice: no "lanzados X/Y" line, and exit 0', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: JSON.stringify({
        issues: [{ n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend' }],
        mergedIssues: [],
      }),
    })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/lanzad[oa]s? \d/i)
  })
})

// D2, finding 1: when EVERY selected slice of the batch is skipped at claim
// time (each one really collides, live, with work another process claimed just
// after ct-next loaded its own snapshot of issues — the same honest warning
// about "no compare-and-swap" documented in dispatch-check.mjs), the process
// ended in exit 0 with no trace at all that zero agents were launched, and the
// last line ("sigo con el resto de esta tanda") promised to carry on when there
// was no candidate left. Reproduction: cap=2, #41 and #42 do not collide WITH
// EACH OTHER (so ct-next selects both with its own snapshot, which does not see
// #99 in flight yet) but each of them, separately, really collides with #99
// when dispatch-check does its own live read.
describe('ct-next — EVERY selected slice is skipped at claim time → not silent (D2, finding 1)', () => {
  it('zero launched out of two selected → a count line, wording with no false promise, and a non-zero exit', () => {
    const repoRoot = makeRepoRoot()
    const openIssue41x = { number: 41, title: '#41 x', labels: [{ name: 'status:ready' }, { name: 'touches:x' }], body: '' }
    const openIssue42y = { number: 42, title: '#42 y', labels: [{ name: 'status:ready' }, { name: 'touches:y' }], body: '' }
    const inFlight99 = { number: 99, labels: [{ name: 'status:in-progress' }, { name: 'touches:x' }, { name: 'touches:y' }] }
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open (without #99 in flight yet — the race is exactly
      // that another process claims it AFTER this snapshot) ; idx1: ct-next
      // closed ; idx2: dispatch-check(#41) collision-check (#99 ALREADY in
      // flight, it shares 'x') ; idx3: dispatch-check(#42) collision-check
      // (#99, it shares 'y').
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue41x, openIssue42y], [], [inFlight99], [inFlight99]]),
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:x', 'touches:y']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    // No worktree should have been created: both candidates were skipped.
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
    expect(r.out).not.toMatch(/launched #/)
    // An explicit terminal count of how many out of how many were launched.
    expect(r.out).toMatch(/launched 0.*2/i)
    // #41 (not the last one) still says it carries on with the rest.
    expect(r.out).toMatch(/skipping #41:.*carrying on with the rest/i)
    // #42 (the LAST candidate) NO LONGER promises "sigo con el resto" — there
    // is nothing left to carry on with.
    expect(r.out).toMatch(/skipping #42:.*no candidates are left/i)
    expect(r.out).not.toMatch(/skipping #42:.*carrying on with the rest/i)
    // Exit code PINNED to 3 (D2 review, minor 2): before it was checked with
    // `not.toBe(0)`/`not.toBe(2)`, which a future change collapsing this case
    // into 1 ("something broke") would still pass green — the very contract
    // this finding introduces (telling "retry later" apart from "stop and
    // look") is only really proved by pinning the exact value.
    expect(r.code).toBe(3)
    // D2 review, important 1: every COLLISION line of dispatch-check must
    // appear ONCE only — before, `attemptClaim` forwarded the child's stderr
    // twice (once through Node's default forwarding in execFileSync, once
    // through the wrapper's own `process.stderr.write`).
    expect(countOccurrences(r.out, 'COLLISION: #41 clashes with #99')).toBe(1)
    expect(countOccurrences(r.out, 'COLLISION: #42 clashes with #99')).toBe(1)
  })
})

// D2, finding 3: dispatch-check.mjs's own comment calls its exit 1
// "collision o race lost", but that SAME exit 1 also covers a failure to
// read the candidate's labels, a failure to write the claim, and a readback
// failure — ct-next treated all five exactly alike ("saltando ... sigo con el
// resto"), even when the issue was left ORPHANED in status:in-progress
// (readback AND the subsequent revert fail at the same time, the worst
// combination the auditor reproduced). These tests force that distinction from
// the caller's side, without touching dispatch-check.mjs.
//
// D2 review, minor 3: inside exit 1 there are TWO very different families of
// "this is not a normal skip" — 'stuck' (the issue really was left orphaned in
// status:in-progress: the revert dispatch-check attempted failed too) and
// 'infra' (labelsOf failed, or the claim never even got written, or the
// readback failed but the revert DID succeed — in all three cases the issue is
// left intact in status:ready, nothing mutated, nothing stuck). Only 'stuck'
// demands stopping EVERYTHING and warning a human (exit 1): a rate limit or a
// momentary `gh` outage on THIS candidate ('infra') says nothing about whether
// the NEXT candidate — an independent call — would fail too, so it is treated
// as the same "retry later" that exit 3 already covers (finding 1): the rest of
// the batch is carried on with, and if nothing gets launched in the end, the
// exit code is 3, not 1.
describe("ct-next — dispatch-check's exit 1 is NOT always a normal outcome of the protocol (D2, finding 3; minor 3)", () => {
  it("'stuck' (readback fails AND the revert fails too, orphaned issue) → ct-next aborts the WHOLE batch with exit 1, it does not treat it as a normal skip", () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#42)
      // collision-check (clean) ; idx3: dispatch-check(#42) readback → FAILS.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], [], []]),
      FAKE_GH_LIST_FAIL_AT: '3',
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      // The initial claim (status:ready→in-progress) DOES get written
      // successfully; it is the SUBSEQUENT revert (in-progress→ready, after the
      // readback failure) that fails too — so the issue really is left blocked.
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready --remove-label status:in-progress',
    })
    // Exit code PINNED to 1 (not `not.toBe(0)`): 'stuck' is the only cause that
    // must still land here after the fix of minor 3.
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATTENTION.*stuck at status:in-progress/is)
    // It is NEVER reported as if it were the normal collision/race skip.
    expect(r.out).not.toMatch(/carrying on with the rest of this batch/i)
    expect(r.out).not.toMatch(/launched #42/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
    // D2 review, major 1: dispatch-check's ATTENTION line (the manual command
    // included) must appear ONCE, not twice — it is checked with the EXACT text
    // dispatch-check.mjs emits (not the bare word "ATTENTION": ct-next's own
    // message for 'stuck', a little further down in the code, MENTIONS the word
    // "ATTENTION" when pointing at that line — that is deliberate and a distinct
    // occurrence, not a duplication).
    expect(countOccurrences(r.out, 'ATTENTION: #42 may have been left stuck at status:in-progress')).toBe(1)
    expect(countOccurrences(r.out, 'Release it by hand with: gh issue edit 42')).toBe(1)
  })

  it("'infra' with nothing stuck (a failure to read the candidate's labels) → it NO LONGER aborts with exit 1: it is treated as 'retry later' (exit 3, with no further candidates in this batch)", () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_VIEW_FAIL: '1',
    })
    // It is NO LONGER an abort with exit 1: nothing mutated, nothing was left
    // stuck — the same code as finding 1's "zero launched, nothing broken".
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/the state of #42 in o\/r could not be read/i)
    // The message must say explicitly that this is NOT a normal collision —
    // but it must NO LONGER say that it aborts the whole batch (with cap=1
    // there are no further candidates anyway; what matters is that the control
    // flow no longer tells this apart from a skip — see the next test with
    // cap=2, where there IS one more candidate and it does get reached).
    expect(r.out).toMatch(/infrastructure failure/i)
    expect(r.out).not.toMatch(/aborting the whole batch/i)
    expect(r.out).not.toMatch(/launched #42/)
    expect(countOccurrences(r.out, 'the state of #42')).toBe(1)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  it("'infra' with nothing stuck on the FIRST of two candidates → it carries on with the SECOND, which does get launched (exit 0)", () => {
    const repoRoot = makeRepoRoot()
    const openIssue41a = { number: 41, title: '#41 a', labels: [{ name: 'status:ready' }, { name: 'touches:a' }], body: '' }
    const openIssue42b = { number: 42, title: '#42 b', labels: [{ name: 'status:ready' }, { name: 'touches:b' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const viewCounterFile = join(repoRoot, 'gh-view-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#41)
      // NEVER reaches this call (labelsOf fails first) ; in reality
      // idx2 = dispatch-check(#42) collision-check (clean) ; idx3 =
      // dispatch-check(#42) readback (clean).
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue41a, openIssue42b], [], [], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      // viewIdx0 (labelsOf of #41, the FIRST candidate processed) fails;
      // viewIdx1 (labelsOf of #42) does not match FAIL_AT=0 → it succeeds.
      FAKE_GH_VIEW_FAIL_AT: '0',
      FAKE_GH_VIEW_COUNTER_FILE: viewCounterFile,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/the state of #41 in o\/r could not be read/i)
    expect(r.out).toMatch(/infrastructure failure/i)
    // The batch WENT ON: #42 was claimed and launched, despite #41's hiccup.
    expect(r.out).toMatch(/claimed #42/)
    expect(r.out).toMatch(/launched #42/)
    expect(r.out).not.toMatch(/aborting the whole batch/i)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/42/)
    expect(gitLogTxt).not.toMatch(/worktree add -b feat\/41/)
  })

  it("'stuck' on the FIRST of two candidates → it aborts the WHOLE batch, the SECOND is not even attempted", () => {
    const repoRoot = makeRepoRoot()
    const openIssue41a = { number: 41, title: '#41 a', labels: [{ name: 'status:ready' }, { name: 'touches:a' }], body: '' }
    const openIssue42b = { number: 42, title: '#42 b', labels: [{ name: 'status:ready' }, { name: 'touches:b' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#41)
      // collision-check (clean) ; idx3: dispatch-check(#41) readback →
      // FAILS. An idx4/idx5 for #42 must never be reached.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue41a, openIssue42b], [], []]),
      FAKE_GH_LIST_FAIL_AT: '3',
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready --remove-label status:in-progress',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATTENTION.*stuck at status:in-progress/is)
    expect(r.out).not.toMatch(/launched #/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
    // #42 was never even attempted: no claim (issue edit) for 42 at all,
    // neither a write nor a revert.
    const argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(argv).not.toMatch(/issue edit 42/)
  })
})

describe('ct-next — dispatch fails after a successful claim → it reverts the claim (W-C, point 3)', () => {
  it('the SLICE.md seed fails after a successful claim → it cleans up worktree/branch AND reverts the claim to status:ready', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      // FAKE_GIT_WORKTREE_ADD_AS_FILE (D4): the worktree is created as a file
      // DURING `git worktree add`, so the seed fails with ENOTDIR. That file
      // used to be pre-created, but since D4 ct-next.mjs checks that the
      // destination is free BEFORE claiming, and a pre-existing worktree never
      // reaches the seed any more (see the preflight in ct-next.mjs).
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/could not seed \.agent\/SLICE\.md/)
    expect(r.out).toMatch(/cleaned up automatically/)
    expect(r.out).not.toMatch(/ATTENTION/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it("the SLICE.md seed fails AND the claim's revert fails too → ATTENTION with the exact manual command", () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready', // the revert fails; the initial claim (status:in-progress) does not
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATTENTION.*claim.*could not be cleaned up automatically/is)
    expect(r.out).toMatch(/gh issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('cmux fails after a successful claim (the seed was written) → it cleans up and reverts the claim', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_CMUX_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/could not launch cmux/)
    expect(r.out).toMatch(/cleaned up automatically/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('git worktree add fails after a successful claim → it reverts the claim automatically (with no worktree/branch to clean up)', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_WORKTREE_ADD_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/the worktree for/)
    expect(r.out).toMatch(/reverted/i)
    expect(r.out).not.toMatch(/ATTENTION/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it("git worktree add fails AND the claim's revert fails too → ATTENTION with the exact manual command", () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_FAIL: '1',
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATTENTION.*claim.*could not be reverted/is)
    expect(r.out).toMatch(/gh issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })
})
