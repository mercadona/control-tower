import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { goEnv } from './fixtures/go-gate.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
// Stub of `gh` for the error-handling tests (review round 1, Critical 2): it
// NEVER touches the network nor any real repository. It is driven by
// environment variables — see __tests__/fixtures/fake-gh-bin/gh.
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')

// Explicit stdio on EVERY invocation below (finding 11 of the final review):
// without this, execFileSync, besides capturing the child's stderr in
// `e.stderr` (which the assertions already use), also forwards it to the parent
// process — the output of `npm test`. All those lines are the EXPECTED output
// of deliberate failure paths (usage error, collision, lost race...), but a
// reader cannot tell that expected noise from a real failure without reading
// the code. `stdio: ['ignore','pipe','pipe']` keeps stdout/stderr available via
// `e.stdout`/`e.stderr` without echoing them to the parent.
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

// `cwd` is optional (fix round 2, F22 — see mkReleaseDryRunRepo further down):
// the vast majority of runReal()'s callers do not touch git at all (only `gh`,
// intercepted by fake-gh-bin via PATH), so the default cwd (that of the test
// process) never mattered to them. The one that does matter is anyone invoking
// `--release`, because the F22 door reads real git from the cwd ALWAYS, dry-run
// or not.
function runReal(args, envOverrides = {}, cwd) {
  try {
    const out = execFileSync('node', [script, ...args], {
      encoding: 'utf8',
      stdio: QUIET_STDIO,
      env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
      ...(cwd ? { cwd } : {}),
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
function run(issue, fixture) {
  try {
    const out = execFileSync('node', [script, String(issue), '--repo', 'o/r', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    return { code: 0, out }
  } catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}

// F22, fix round 1, item 1 (and fix round 2: the same defect found in a FOURTH
// call site that was not in the original sweep — see the comment next to
// "--release whose gh edit fails" further down) — `--release` runs the F22 door
// (Task 8) in dry-run as much as for real: the door reads real git from the cwd
// ALWAYS. The tests that invoke `--release` with no `cwd` ran, before this
// fixture, against this plugin's own checkout, and passed only because two
// ENVIRONMENTAL facts happen to be true today: this repository does not have
// `.agent/` tracked, and `main`/`origin/HEAD` resolve. Neither of the two is a
// property of the test — the day this very repository gets ct-init'ed (which is
// literally what this plugin does to other repositories), `.agent/STATE.md`
// becomes tracked, and these tests would start failing with a slice
// contamination message that has nothing to do with what they are testing. A
// purpose-built repository, with a real base (`main`) and a branch (`feat/9`)
// that diverges from it without touching any state file, makes the outcome
// depend on the fixture, not on the checkout the suite happens to run in.
// A minimal plan that satisfies plan-contract.js — since F-jjponz-1, --release
// demands a prescriptive plan committed on the branch, so the release fixture
// carries one. Its only block goes under "Final text (work.txt):" (F-jjponz-4:
// every block declares its role) and that role is not checked against the
// repository, so the fixture still cites nothing.
const FENCE = '```'
const minimalPlanFor = (issue) => [
  `# #${issue} — fixture slice`,
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 1. Context and goal',
  'Fixture.',
  '### Desired end state',
  'Work done.',
  '### Out of scope',
  'N/A — fixture.',
  '## 2. Closed decisions',
  '| Decision | Value |',
  '|---|---|',
  '| fixture | yes |',
  '## 3. Reference patterns',
  'N/A — fixture.',
  '## 4. Inventory',
  'work.txt',
  '## 5. Interfaces',
  'Consumes: N/A. Produces: N/A.',
  '## 6. Test strategy',
  'N/A — fixture.',
  '## 7. Tasks',
  '### Task 1 — do the work',
  '**Objective:** the work is committed.',
  '**Files:** work.txt',
  'Final text (work.txt):',
  FENCE,
  'trabajo',
  FENCE,
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** git log shows the commit.',
  FENCE + 'bash',
  'git log --oneline -1',
  FENCE,
  '## 8. Global verification',
  'N/A — fixture.',
  '## 9. Assumptions',
  'None.',
  '',
].join('\n')

function mkReleaseDryRunRepo(issue = 9) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-release-dryrun-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  writeFileSync(join(dir, 'f.txt'), 'base\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feat/9')
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', `2026-08-12-issue-${issue}-work.md`), minimalPlanFor(issue))
  git('add', '-A')
  git('commit', '-qm', 'work')
  // The run gate: --release demands a ct-step run that is DELIVERED. Local to
  // the worktree and uncommitted, which is how ct-step leaves it (ct-init
  // gitignores it). The tests that test its ABSENCE delete it.
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', `run-${issue}.json`), JSON.stringify({
    plan: `docs/superpowers/plans/2026-08-12-issue-${issue}-work.md`,
    issue, task: 1, tasksTotal: 1, step: 'commit', closed: 'delivered',
  }))
  return dir
}

describe('dispatch-check --dry-run', () => {
  it('a collision → exit 1', () => {
    const r = run(7, { candLabels: ['touches:db'], openIssues: [{ n: 5, labels: ['status:in-progress', 'touches:db'] }], readback: [] })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/COLLISION|collision/i)
  })
  it('no collision and we win the race → exit 0 (claimed)', () => {
    const r = run(3, { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] })
    expect(r.code).toBe(0)
  })
  it('a lost race (another lower one in-progress with the token) → exit 1', () => {
    const r = run(7, { candLabels: ['touches:db'], openIssues: [], readback: [
      { n: 7, labels: ['status:in-progress', 'touches:db'] },
      { n: 5, labels: ['status:in-progress', 'touches:db'] },
    ] })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/perdid|lost/i)
  })

  it('--release → exit 0 and prints the in-progress → in-review transition', () => {
    const dir = mkReleaseDryRunRepo()
    try {
      // Task 10 (F-e2e): --release now reads the body of the issue through
      // `gh` even in --dry-run (it is a READ, not the mutation --dry-run
      // avoids) — without the PATH to the stub, this real `gh` would fail
      // against an 'o/r' repository that does not exist. FAKE_GH_VIEW_BODY not
      // set → empty body → no "## E2E" section → nothing to cross-check, the
      // happy path of this test.
      const out = execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'], { cwd: dir, encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...goEnv({ repo: 'o/r', issue: 9 }) } })
      expect(out).toMatch(/released #9.*in-review/)
    } catch (e) {
      throw new Error(`no debería fallar: ${e.status} ${(e.stdout || '') + (e.stderr || '')}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Capde review (2026-08-19), point 1: the kickoff orders you to drive with
  // ct-step, but a prompt is not a gate. This is the gate: with no DELIVERED run
  // nothing is released, and exit 7 tells it apart from the absent plan (6) and
  // from the state files (5).
  it('--release with no delivered ct-step run → exit 7, and the issue does not move', () => {
    const dir = mkReleaseDryRunRepo()
    rmSync(join(dir, '.agent', 'run-9.json'))
    let threw = false
    try {
      execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'], { cwd: dir, encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(7)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/\.agent\/run-9\.json does not exist/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(threw).toBe(true)
  })

  it('--release with a half-finished run → exit 7 and says how far it got', () => {
    const dir = mkReleaseDryRunRepo()
    writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify({ issue: 9, task: 1, tasksTotal: 3, step: 'judge' }))
    let threw = false
    try {
      execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'], { cwd: dir, encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(7)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/is not delivered.*task 1\/3.*judge/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(threw).toBe(true)
  })

  it('a usage error (no --repo) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, '9', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/usage:/)
    }
    expect(threw).toBe(true)
  })

  it('a usage error (a non-numeric issue) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, 'nope', '--repo', 'o/r', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
    }
    expect(threw).toBe(true)
  })

})

// D4, defect 2 — the same pattern as `--cap` in ct-next.mjs, but here the
// number identifies the issue that is going to be MUTATED against a real
// repository. With `parseInt(process.argv[2], 10)`, "42x" claimed issue 42 and
// "1e3" claimed issue 1: an issue the user never named, mutated in silence.
// Verified against the unfixed code: the three cases below came out 0 (dry-run)
// after having DECIDED about an issue other than the one asked for.
describe('dispatch-check <issue#> — strict parsing (D4, defect 2)', () => {
  const FIXTURE = { issue: 42, labels: ['status:ready'], others: [] }
  for (const bad of ['42x', '1e3', '4.2', ' 42', '0x2A', '']) {
    it(`<issue#> ${JSON.stringify(bad)} → exit 2, never an issue other than the one asked for`, () => {
      let threw = false
      try {
        execFileSync('node', [script, bad, '--repo', 'o/r', '--dry-run'],
          { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(FIXTURE) } })
      } catch (e) {
        threw = true
        expect(e.status).toBe(2)
        expect((e.stdout || '') + (e.stderr || '')).toMatch(/<issue#> invalid/)
      }
      expect(threw).toBe(true)
    })
  }

  it('<issue#> 0 or negative → exit 2 (there is no issue 0 on GitHub)', () => {
    for (const bad of ['0', '-1']) {
      let threw = false
      try {
        execFileSync('node', [script, bad, '--repo', 'o/r', '--dry-run'],
          { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(FIXTURE) } })
      } catch (e) {
        threw = true
        expect(e.status).toBe(2)
      }
      expect(threw).toBe(true)
    }
  })
})

// T11 fix round 3 (re-review): --settle-ms/CT_CLAIM_SETTLE_MS were removed from
// the code (see the header comment of dispatch-check.mjs). If they were ignored
// in silence, someone invoking the script with --settle-ms out of habit would
// get a clean exit 0 and would go on believing there is an active settling wait
// — exactly the false confidence that motivated removing it. They must be
// rejected explicitly with exit 2.
describe('dispatch-check — T11 fix round 3 (--settle-ms/CT_CLAIM_SETTLE_MS rejected explicitly)', () => {
  it('--settle-ms in argv → exit 2, and the message points at the header of the file', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--repo', 'o/r', '--dry-run', '--settle-ms', '2000'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/--settle-ms.*no longer exist/i)
    }
    expect(threw).toBe(true)
  })

  it('CT_CLAIM_SETTLE_MS in the environment → exit 2, even when the flag is not passed', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--repo', 'o/r', '--dry-run'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_SETTLE_MS: '2000' } })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/--settle-ms.*no longer exist/i)
    }
    expect(threw).toBe(true)
  })

  it('with neither --settle-ms nor CT_CLAIM_SETTLE_MS → it is unaffected (the normal path)', () => {
    const dir = mkReleaseDryRunRepo()
    // Task 10 (F-e2e): --release reads the body of the issue through `gh` — it
    // needs the stub here just as the test above does, or it hits the real
    // 'o/r'.
    const out = execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'], { cwd: dir, encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...goEnv({ repo: 'o/r', issue: 9 }) } })
    expect(out).toMatch(/released #9.*in-review/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('dispatch-check — fix review round 1 (Critical 1: the fixture is tied to --dry-run)', () => {
  it('CT_CLAIM_FIXTURE set WITHOUT --dry-run → exit 2, it neither decides with the fixture nor touches gh', () => {
    const fixture = { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] }
    let threw = false
    try {
      // With no PATH to fake-gh: if the script tried to invoke the real `gh`
      // here it would fail anyway (there is no network/auth), but the real
      // assertion is that it NEVER gets to try — see the expected error
      // message.
      execFileSync('node', [script, '3', '--repo', 'o/r'], { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/CT_CLAIM_FIXTURE.*--dry-run/i)
    }
    expect(threw).toBe(true)
  })
})

describe('dispatch-check — fix review round 1 (Minor 1: flag validation)', () => {
  it('a dangling --repo (the last token, with no value) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--dry-run', '--repo'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/usage:/)
    }
    expect(threw).toBe(true)
  })

  it('--repo followed by another flag (with no real value) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--repo', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
    }
    expect(threw).toBe(true)
  })
})

describe('dispatch-check — fix review round 1 (Critical 2: gh() failures leave no silent orphan locks)', () => {
  it('the initial claim fails (gh down) → exit 3 (infrastructure, no persistent mutation), a clear message, no uncaught crash', () => {
    // Finding 4: the exit code was widened — this case no longer shares the
    // exit 1 of a real COLLISION (see the header of dispatch-check.mjs). No
    // persistent mutation (the claim never even got written), but it is an
    // infrastructure failure, not a collision — the caller (ct-next.mjs) no
    // longer needs to parse the text to tell them apart.
    const r = runReal(['11', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:in-progress',
    })
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/no se pudo escribir el claim/i)
  })

  it('the readback after the claim fails → it reverts, warns that the race could not be confirmed, exit 3 (infrastructure, successful revert)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-fakegh-'))
    const counterFile = join(dir, 'list-count')
    const r = runReal(['13', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]), // first call (collision): no clash
      FAKE_GH_LIST_FAIL_AT: '1', // second call (post-claim readback): it fails
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    rmSync(dir, { recursive: true, force: true })
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/the race cannot be confirmed/i)
    expect(r.out).toMatch(/reverted to status:ready/i)
  })

  it('a lost race and the revert fails too → it warns of the lost race AND of the orphan lock with the manual command, exit 4 (orphan)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-fakegh-'))
    const counterFile = join(dir, 'list-count')
    // The raw format of `gh issue list --json number,labels`
    // (number/labels[].name), not the internal {n,labels} — allOpen() does that
    // mapping, and the stub must imitate exactly what the real gh would
    // return.
    const readbackWithLoss = [
      { number: 17, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }, // us
      { number: 5, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] },  // another one, a lower number → we lose
    ]
    const r = runReal(['17', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], readbackWithLoss]), // 1st: no clash; 2nd: readback with a loss
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready', // the revert (not the initial claim) fails
    })
    rmSync(dir, { recursive: true, force: true })
    expect(r.code).toBe(4)
    expect(r.out).toMatch(/race lost/i)
    expect(r.out).toMatch(/ATTENTION.*#17.*stuck/is)
    expect(r.out).toMatch(/gh issue edit 17 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  // F22, fix round 2 — the same defect as the three of mkReleaseDryRunRepo
  // above, found by the same sweep: WITHOUT `--dry-run`, so it is not one of
  // those three by literal text, but the F22 door runs all the same (it reads
  // real git from the cwd in EVERY `--release`, dry-run or not) — it passed
  // only because this checkout does not have `.agent/` tracked and `main`
  // resolves.
  it('--release whose gh edit fails → exit 1, a clear message (no uncaught crash)', () => {
    const dir = mkReleaseDryRunRepo(19)
    const r = runReal(['19', '--repo', 'o/r', '--release'], {
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:in-review',
      // F38: door 9 goes before the mutation, so this test needs the `plan`
      // gate closed in order to reach the `gh edit` it wants to see fail.
      ...goEnv({ repo: 'o/r', issue: 19 }),
    }, dir)
    rmSync(dir, { recursive: true, force: true })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/#19 could not be released/i)
  })
})

// Finding 2 of the final review: `allOpen()` used `gh issue list --limit 200` —
// since it returns newest first, a fixed cap can leave out an OLD colliding
// `in-progress`, and then `detectCollisions`/`claimLost` fail OPEN (the lock
// stops locking). fake-gh-bin does not simulate real HTTP pagination, but it
// DOES record the exact argv dispatch-check.mjs passes it — the right way to
// check, with no network, that the command no longer carries the fixed cap.
// T11 — robust AC6: the CT_CLAIM_PRECLAIM_DELAY_MS test hook. The hook can only
// add a synchronous wait between "clean collision" and "write the claim" on the
// REAL path (never --dry-run/fixture, which are purely synchronous and without
// network). These tests check: (a) validation of the variable itself, (b) that
// absent == 0 wait == a path identical to the one before the hook, and (c) that
// present does delay the write measurably and verifiably — without which the
// adversarial harness could not trust that the hook really builds the window it
// says it builds.
describe('dispatch-check — the T11 CT_CLAIM_PRECLAIM_DELAY_MS hook', () => {
  it('a malformed CT_CLAIM_PRECLAIM_DELAY_MS ("300ms") → exit 2, a clear message', () => {
    const r = runReal(['5', '--repo', 'o/r'], {
      CT_CLAIM_PRECLAIM_DELAY_MS: '300ms',
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_CLAIM_PRECLAIM_DELAY_MS invalid/)
  })

  it('a negative CT_CLAIM_PRECLAIM_DELAY_MS → exit 2', () => {
    const r = runReal(['5', '--repo', 'o/r'], {
      CT_CLAIM_PRECLAIM_DELAY_MS: '-50',
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_CLAIM_PRECLAIM_DELAY_MS invalid/)
  })

  it('an explicit "0" from the environment → valid (it is not an error), the same result as absent', () => {
    const r = runReal(['3', '--repo', 'o/r'], {
      CT_CLAIM_PRECLAIM_DELAY_MS: '0',
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 3, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }]]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/claimed #3/)
  })

  // ==========================================================================
  // F8 — THE ONLY TWO TESTS IN THE SUITE THAT REALLY MEASURE TIME.
  //
  // `CT_CLAIM_PRECLAIM_DELAY_MS` IS a delay: there is no honest way to check
  // that it sleeps what it says without looking at a clock. What can be removed
  // is the dependence on THE MACHINE's clock — the noise — without removing the
  // measurement.
  //
  // What there was before: four runs of branch A followed by four of branch B,
  // and a comparison of MEDIANS between blocks. That takes for granted that the
  // load on the machine is the same in both blocks, which is exactly what does
  // not hold: the blocks are separated by seconds, and in those seconds the
  // rest of the suite (and anything else on the laptop) comes and goes.
  // Measured against an untouched main, with another vitest suite running at
  // the same time: 2 out of 6 runs failed here, with differences of 22ms and
  // 249ms against the required minimum of 300 — the 600ms delay was still
  // there, but the noise between blocks ate it whole.
  //
  // What there is now: PAIRED and INTERLEAVED measurement. Each iteration runs
  // both branches one after the other and keeps ITS difference; the statistic
  // is the median of the paired differences, not the difference of the medians.
  // Two consecutive runs see practically the same machine, so the common noise
  // cancels out in the subtraction instead of adding up. The threshold (half
  // the nominal value) is still the same, and it still detects exactly what it
  // has to detect: a hook that does not sleep what it says.
  //
  // WHY THE NOMINAL VALUE IS IN SECONDS AND NOT IN TENTHS. The pairing removes
  // the noise COMMON to both branches, but not the noise that separates them,
  // and here that is what rules: each branch starts its own `node` process, and
  // that start-up costs of the order of half a second with a spread of the same
  // order. With a nominal of tenths, the signal and the noise are the same
  // size, and the median of a few samples falls below the threshold without the
  // hook having done anything wrong — which is exactly what was happening:
  // measured at rest, 1 out of 15 paired differences fell below the threshold,
  // and under load that proportion was enough to bring down the median of five
  // samples.
  //
  // The cure is not more samples (it multiplies the cost without separating
  // signal from noise): it is for the signal to dominate. With a nominal in
  // seconds, the start-up goes from being worth as much as the signal to being
  // worth a small fraction of it, and the WORST sample stays well above the
  // threshold instead of grazing it. The iterations go down from five to three
  // so as not to pay the higher nominal five times; even so this file takes a
  // few seconds MORE than before, and that is the deliberate price of it no
  // longer falling over on its own. Three is the minimum with which a median
  // still means something.
  // ==========================================================================
  const preclaimEnv = {
    FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 3, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }]]),
  }
  const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  function timed(fn) {
    const t0 = Date.now()
    const r = fn()
    return { elapsed: Date.now() - t0, r }
  }

  it('a positive value measurably delays the write of the claim compared to absent (the same final result, slower)', () => {
    const NOMINAL_MS = 2000
    const diffs = []
    for (let i = 0; i < 3; i++) {
      // The two branches, one immediately after the other, in the same
      // iteration: they see the same machine.
      const a = timed(() => runReal(['3', '--repo', 'o/r'], { ...preclaimEnv }))
      const b = timed(() => runReal(['3', '--repo', 'o/r'], { ...preclaimEnv, CT_CLAIM_PRECLAIM_DELAY_MS: String(NOMINAL_MS) }))
      for (const s of [a, b]) {
        expect(s.r.code).toBe(0)
        expect(s.r.out).toMatch(/claimed #3/)
      }
      diffs.push(b.elapsed - a.elapsed)
    }
    // The median of the PAIRED differences. Half the nominal value is
    // required: below that the hook would not be sleeping what it says.
    expect(median(diffs)).toBeGreaterThanOrEqual(NOMINAL_MS / 2)
  })

  it('with --dry-run/fixture, a high CT_CLAIM_PRECLAIM_DELAY_MS delays NOTHING (the hook never touches the pure path)', () => {
    // The same correction: before, this was `elapsed < 1000ms`, an ABSOLUTE
    // wall-clock threshold over a node start-up — under load, starting node
    // alone can already take more than 1s, and the test would have failed
    // without the hook having slept a single millisecond. What is really meant
    // to be asserted is "the 5000ms sleep did NOT happen", and that is checked
    // by comparing against a control run alongside the case, not against a
    // constant.
    const NOMINAL_MS = 5000
    const fixture = { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] }
    const dryRun = (env) => execFileSync('node', [script, '3', '--repo', 'o/r', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(fixture), ...env } })

    const control = timed(() => dryRun({}))
    const withHook = timed(() => dryRun({ CT_CLAIM_PRECLAIM_DELAY_MS: String(NOMINAL_MS) }))

    expect(control.r).toMatch(/claimed #3/)
    expect(withHook.r).toMatch(/claimed #3/)
    // If the hook had touched the pure path, the difference would be ~5000ms.
    // It is required to be below HALF: plenty of margin for the noise of two
    // consecutive node start-ups, and nowhere near enough to hide the sleep.
    expect(withHook.elapsed - control.elapsed).toBeLessThan(NOMINAL_MS / 2)
  })

  // Fix round 1 (T11 review), Minor 1: the validation of
  // CT_CLAIM_PRECLAIM_DELAY_MS lives AFTER the --release guard in the script —
  // --release does not even pass through that point of the code. Before the
  // fix, a malformed value left hanging in the environment aborted --release
  // with exit 2 without running the mutation, leaving the issue stuck in
  // status:in-progress. This test shows that --release is now immune: not even
  // a clearly invalid value affects it.
  it('--release with a malformed CT_CLAIM_PRECLAIM_DELAY_MS in the environment → --release proceeds all the same, unaffected', () => {
    const dir = mkReleaseDryRunRepo()
    // Task 10 (F-e2e): likewise — the `gh` stub is needed for reading the body
    // of the issue, not only for the mutation scenario.
    const out = execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'],
      { cwd: dir, encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, CT_CLAIM_PRECLAIM_DELAY_MS: 'not-a-number', ...goEnv({ repo: 'o/r', issue: 9 }) } })
    expect(out).toMatch(/released #9.*in-review/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Fix round 1, Minor 2: an upper cap of 60000ms. With no cap, "1e12" (~31
  // years in ms) is accepted as a valid "number >= 0" and is in practice
  // indistinguishable from a hang.
  it('CT_CLAIM_PRECLAIM_DELAY_MS above the cap (60000ms) → exit 2, a clear message', () => {
    const r = runReal(['5', '--repo', 'o/r'], {
      CT_CLAIM_PRECLAIM_DELAY_MS: '1e12',
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_CLAIM_PRECLAIM_DELAY_MS invalid/)
  })

  // The exact limit (60000ms) must keep being valid — it is checked through
  // the --dry-run/fixture path (the validation is unconditional, but
  // sleepSync() is only invoked on the real path) so as not to pay 60s of real
  // waiting in the suite.
  it('CT_CLAIM_PRECLAIM_DELAY_MS exactly at the cap (60000ms) → it is still valid', () => {
    const fixture = { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] }
    const out = execFileSync('node', [script, '3', '--repo', 'o/r', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_PRECLAIM_DELAY_MS: '60000', CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    expect(out).toMatch(/claimed #3/)
  })
})

describe('dispatch-check — enumerating open issues with no fixed --limit (final review, finding 2)', () => {
  it('allOpen() uses --paginate and never --limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-dc-nolimit-'))
    const logFile = join(dir, 'gh-argv-log')
    const r = runReal(['3', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 3, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }]]),
      FAKE_GH_ARGV_LOG_FILE: logFile,
    })
    expect(r.code).toBe(0)
    const log = readFileSync(logFile, 'utf8')
    rmSync(dir, { recursive: true, force: true })
    expect(log).toMatch(/--paginate/)
    expect(log).not.toMatch(/--limit/)
    expect(log).toMatch(/state=open/)
  })
})

// ============================================================================
// Slice 2 (Capde notes) — the base of the --release diff is the real cut.
//
// The geometry of the slice 10 run: the worktree was cut from origin/main at
// commit S; the LOCAL copy of main stayed 7 commits behind; and the plan cited
// a file that exists in S but not in that stale main — the plan gate
// (F-jjponz-3 reads the citations in the BASE) accused it of an "invented
// citation". Here it is reproduced with 1 commit of lag (the same class of
// failure): `citado.txt` is born in the commit of the cut, the plan cites it,
// and the local `main` is rewound with `git branch -f` (legal: the checkout is
// on feat/9).
function mkStaleMainRepo({ issue = 9, sliceMd } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-release-stale-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  writeFileSync(join(dir, 'f.txt'), 'base\n')
  git('add', '-A')
  git('commit', '-qm', 'main vieja')
  const oldMain = git('rev-parse', 'HEAD').trim()
  writeFileSync(join(dir, 'citado.txt'), 'texto del corte\n')
  git('add', '-A')
  git('commit', '-qm', 'main avanza (los 7 commits de la corrida real)')
  const cutSha = git('rev-parse', 'HEAD').trim()
  git('checkout', '-qb', `feat/${issue}`) // the cut of the worktree: origin/<base> at S
  const plan = minimalPlanFor(issue)
    .replace('Final text (work.txt):', 'Current state (citado.txt):')
    .replace(`${FENCE}\ntrabajo\n${FENCE}`, `${FENCE}\ntexto del corte\n${FENCE}`)
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', `2026-08-12-issue-${issue}-work.md`), plan)
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  git('add', '-A')
  git('commit', '-qm', 'work')
  git('branch', '-f', 'main', oldMain) // the LOCAL main stays BEHIND the cut
  // Seed and run uncommitted, the way the real dispatch leaves them.
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), sliceMd(cutSha))
  writeFileSync(join(dir, '.agent', `run-${issue}.json`), JSON.stringify({
    plan: `docs/superpowers/plans/2026-08-12-issue-${issue}-work.md`,
    issue, task: 1, tasksTotal: 1, step: 'commit', closed: 'delivered',
  }))
  return { dir, cutSha }
}

// --release reads the body of the issue through gh even in --dry-run; without
// the PATH to the stub, the real gh would fail against an o/r repository that
// does not exist. FAKE_GH_VIEW_BODY not set → empty body → no "## E2E" section
// → nothing to cross-check.
//
// `goEnv` (F38): since the go nonce, `--release` has one more door —the `plan`
// gate does not close without a registered `-OK <nonce>`— and without
// satisfying it ALL of this would come out 9 before reaching what these tests
// measure, which is where the base of the diff comes from and what the `base:`
// guardrail warns about. Door 9 is not the object of this test: it is covered
// in f38-the-plan-gate-go.test.js. The shared fixture is used and not a copy
// because its own header asks for it («the day the format of the record
// changes, a shared fixture breaks once and in one place»), and it is what the
// other `--release` tests of this file and those of f22 already do.
const releaseStale = (dir) => spawnSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...goEnv({ repo: 'o/r', issue: 9 }) } })

describe('dispatch-check --release — the base of the diff is the real cut (slice 2, Capde notes)', () => {
  it('with base_sha: present the diff comes out against that commit even when the local main is behind', () => {
    const { dir } = mkStaleMainRepo({ sliceMd: (cut) => `---\ntask: slice\nbase: main\nbase_sha: ${cut}\n---\n# s\n` })
    const r = releaseStale(dir)
    // Without the fix this came out 6: `base:` resolved the LOCAL (stale)
    // main, the citation of citado.txt did not exist there, and the plan was
    // accused of citing an invented file — the exact case of the slice 10
    // run.
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/released #9.*in-review/)
    expect(r.stderr).not.toContain("does not exist in the branch's base")
    rmSync(dir, { recursive: true, force: true })
  })

  it('a seed with no base_sha: behaves as it does today — it falls back to `base:` and measures the local copy, defect included', () => {
    const { dir } = mkStaleMainRepo({ sliceMd: () => `---\ntask: slice\nbase: main\n---\n# s\n` })
    const r = releaseStale(dir)
    // TODAY's behaviour for seeds older than slice 1, preserved on purpose
    // (for_developers: the chain stays intact). If this starts coming out 0,
    // someone touched the fallback — precisely what this slice promises NOT to
    // do.
    expect(r.status).toBe(6)
    expect(r.stderr).toContain('citado.txt')
    expect(r.stderr).toContain("does not exist in the branch's base")
    rmSync(dir, { recursive: true, force: true })
  })

  it('base_sha: present but not resolvable (a pruned repository / a corrupt seed) falls back to `base:`, it does not refuse', () => {
    const { dir } = mkStaleMainRepo({ sliceMd: () => `---\ntask: slice\nbase: main\nbase_sha: ${'a'.repeat(40)}\n---\n# s\n` })
    const r = releaseStale(dir)
    // It tells a fallback from a refusal: if sliceBaseRef returned the sha
    // WITHOUT verifying it, the consumers' rev-parse would fail and this would
    // come out 5 ("could not be resolved"). The correct fallback comes out 6
    // for the SAME reason as the test above: it measures the local main and
    // accuses the citation.
    expect(r.status).toBe(6)
    expect(r.stderr).toContain('citado.txt')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a `base:` that looks like a SHA (40 hex) warns on stderr — once only and without aborting — that it breaks gh pr create and that the diff already uses base_sha:', () => {
    // The guardrail against the spontaneous fix of the real run: the agent put
    // a SHA into `base:` to "fix" the diff. The diff works all the same (a sha
    // resolves — that is why it does NOT abort), but `gh pr create --base`
    // demands a branch name and will fail when closing.
    const { dir } = mkStaleMainRepo({ sliceMd: (cut) => `---\ntask: slice\nbase: ${cut}\nbase_sha: ${cut}\n---\n# s\n` })
    const r = releaseStale(dir)
    expect(r.status).toBe(0) // it warns, it does not abort
    expect(r.stdout).toMatch(/released #9.*in-review/)
    expect(r.stderr).toContain('gh pr create')
    expect(r.stderr).toContain('base_sha:')
    // --release consults the base TWICE (F22 cleanup + F-jjponz-1 plan); the
    // warning comes out ONCE.
    expect(r.stderr.match(/WARNING:/g)).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Slice 9(a) — the guardrail looks at the NATURE of `base:`, not at its length.
// Slice 2 demanded 40 hex; a `git rev-parse --short HEAD` put in 7-12 and broke
// `gh pr create --base` just the same, in silence.
describe('dispatch-check --release — the `base:` guardrail does not count characters (slice 9)', () => {
  it('a `base:` with a SHORT SHA (10 hex) warns just as the 40-hex one does', () => {
    const { dir } = mkStaleMainRepo({ sliceMd: (cut) => `---\ntask: slice\nbase: ${cut.slice(0, 10)}\nbase_sha: ${cut}\n---\n# s\n` })
    const r = releaseStale(dir)
    expect(r.status).toBe(0)               // it warns, it does not abort (just as the 40-hex one)
    expect(r.stderr).toContain('gh pr create')
    expect(r.stderr).toContain('base_sha:')
    expect(r.stderr.match(/WARNING:/g)).toHaveLength(1)   // two consultations, one warning
    rmSync(dir, { recursive: true, force: true })
  })

  it('`base: main` — a real branch of this clone — does NOT warn', () => {
    const { dir } = mkStaleMainRepo({ sliceMd: (cut) => `---\ntask: slice\nbase: main\nbase_sha: ${cut}\n---\n# s\n` })
    const r = releaseStale(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('AVISO:')  // `AVISO:` comes out ONCE only in the whole of dispatch-check
    rmSync(dir, { recursive: true, force: true })
  })

  it('a branch that only exists in `refs/remotes/origin/` (never checked out here) does NOT warn', () => {
    // The false positive the refs/remotes probe exists to avoid: a clone that
    // only has `main` locally and dispatches with --base develop. The remote
    // ref is manufactured with `update-ref` (no remote and no network needed: a
    // ref is a file).
    const { dir, cutSha } = mkStaleMainRepo({ sliceMd: (cut) => `---\ntask: slice\nbase: develop\nbase_sha: ${cut}\n---\n# s\n` })
    execFileSync('git', ['update-ref', 'refs/remotes/origin/develop', cutSha], { cwd: dir })
    const r = releaseStale(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('AVISO:')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a `base:` that is neither a branch NOR resolves to a commit (a typo) does NOT warn: that breakage has another voice', () => {
    const { dir } = mkStaleMainRepo({ sliceMd: (cut) => `---\ntask: slice\nbase: mian\nbase_sha: ${cut}\n---\n# s\n` })
    const r = releaseStale(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('AVISO:')
    rmSync(dir, { recursive: true, force: true })
  })
})
