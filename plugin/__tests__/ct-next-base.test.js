// W-D: ct-next.mjs hardcoded "main" in two places (`git worktree add ... main`
// and `base: 'main'` in the seeded STATE.md) — in a repository whose real
// default branch is a different one (say "master", or any other convention)
// this failed confusingly (git worktree add against a branch that does not
// exist) or, worse, seeded a STATE.md with a `base` that lies about the real
// branch. This file covers: (a) runtime resolution via `gh repo view --json
// defaultBranchRef` (the authoritative source, not a local copy that can go
// stale), (b) the explicit `--base <branch>` override, (c) what happens when it
// cannot be determined (abort with a clear message, NEVER silently assume
// "main" — that is exactly the bug being fixed), and (d) that --dry-run lets
// you see the resolved base branch.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
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

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})

function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-base-'))
  dirs.push(d)
  return d
}

const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

const FIXTURE = JSON.stringify({
  issues: [
    { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], name: 'login', type: 'backend' },
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], name: 'refresh', type: 'backend' },
  ],
  mergedIssues: [1],
})

describe('ct-next — resolving the default base branch (W-D)', () => {
  it('resolves via `gh repo view` (no hardcoded "main") and uses it both in `git worktree add` and in the seeded SLICE.md', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_DEFAULT_BRANCH: 'develop',
    })
    expect(r.code).toBe(0)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/42 \S*\/42 origin\/develop/)
    const stateMd = readFileSync(join(repoRoot, '.worktrees', '42', '.agent', 'SLICE.md'), 'utf8')
    expect(stateMd).toMatch(/base: develop/)
  })

  it('with no override and unable to determine it (gh repo view fails) → exit 1, clear message, no worktree created, never assumes "main"', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_REPO_VIEW_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/the default branch of/i)
    expect(r.out).toMatch(/--base/)
    const gitLogTxt = existsSyncSafe(gitLog)
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  it('an explicit --base <branch> wins over detection: it never invokes `gh repo view`', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--base', 'release/9'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      // If the override did not win, detection would fail on this and the test
      // would fail for a different reason than the one being checked.
      FAKE_GH_REPO_VIEW_FAIL: '1',
    })
    expect(r.code).toBe(0)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/42 \S*\/42 origin\/release\/9/)
    const stateMd = readFileSync(join(repoRoot, '.worktrees', '42', '.agent', 'SLICE.md'), 'utf8')
    expect(stateMd).toMatch(/base: release\/9/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).not.toMatch(/repo view/)
  })

  it('a dangling --base (last token, no value) → exit 2', () => {
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--base'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--base/i)
  })

  it('--base followed by another flag (no real value) → exit 2', () => {
    const r = runReal(['--repo', 'o/r', '--base', '--dry-run'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--base/i)
  })

  it('--dry-run with no fixture shows the resolved base branch (not a blind "main")', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_DEFAULT_BRANCH: 'develop',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/develop/)
    expect(r.out).toMatch(/git worktree add -b feat\/42 \S*\/42 origin\/develop/)
  })

  it('--dry-run with CT_NEXT_FIXTURE never really calls `gh repo view` (the fixture is tied to --dry-run, real gh untouched)', () => {
    const repoRoot = makeRepoRoot()
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(r.code).toBe(0)
    const log = existsSyncSafe(argvLog)
    expect(log).not.toMatch(/repo view/)
  })
})

function existsSyncSafe(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

// PART OF THIS BLOCK WAS INVERTED by Step 1 (see the last describe of the
// file): the Important here demanded that the base branch exist in the LOCAL
// CHECKOUT, and now the worktree is cut from `origin/<base>`, so the state of
// the local copy decides nothing. Its "exists in origin but not locally → exit
// 1" case was withdrawn: today that is the good case. The other one —a --base
// with a typo that resolves nowhere— is still alive, measured against the
// remote.
//
// Fix round 1 of the W-D review: one Important (the base branch was resolved
// against GitHub but it was never checked that it existed IN THE LOCAL
// CHECKOUT — `git worktree add` failed late, already after the claim, burning a
// claim/revert cycle over something that could be known offline) and three
// Minors (--base '' slipped through; the --dry-run banner lied "resuelta" in
// fixture mode; the guard for gh's empty answer was untestable with the
// fixture, and did not refuse the literal "null").
describe('ct-next — base branch: fix round 1 of the review (Important + Minor 1/2/3)', () => {
  it('Important: the base branch exists neither locally nor in origin → exit 1, a different message (probable typo), no worktree created', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--base', 'mian'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_BASE_NOT_LOCAL: '1',
      FAKE_GIT_BASE_NOT_REMOTE: '1',
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/does not exist on the remote/i)
    expect(r.out).toMatch(/typo/i)
    expect(existsSyncSafe(gitLog)).not.toMatch(/worktree add/)
  })

  it('Important: the base branch DOES exist locally (happy path, the stub\'s default) → it keeps working exactly as before this fix', () => {
    // It does not set FAKE_GIT_BASE_NOT_LOCAL/FAKE_GIT_BASE_NOT_REMOTE: the
    // stub considers any ref to "exist" by default — the same behaviour the
    // describe above already covers, repeated here explicitly alongside the rest
    // of this fix round's tests so it is on record that the happy path was not
    // broken by adding the verification.
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/launched #42/)
  })

  it('Minor 1: an empty --base ("") → exit 2, just like --base with no value', () => {
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--base', ''])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--base/i)
  })

  it('Minor 2: --dry-run with a fixture and NO --base → the banner marks "(fixture)" (the value was not really resolved)', () => {
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/base branch resolved: main \(fixture\)/)
  })

  it('Minor 2: --dry-run with a fixture AND an explicit --base → the banner does NOT mark "(fixture)" (a real value was given)', () => {
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run', '--base', 'develop'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/base branch resolved: develop\n/)
    expect(r.out).not.toMatch(/\(fixture\)/)
  })

  it('Minor 3: `gh repo view` returns the empty string → exit 1, "returned no usable branch name" (reachable thanks to `??` in the stub)', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_DEFAULT_BRANCH: '',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/returned no usable branch name/i)
  })

  it('Minor 3: `gh repo view` returns the literal "null" → it is refused just like the empty string', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_DEFAULT_BRANCH: 'null',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/returned no usable branch name/i)
  })
})

// Step 1 of the spec of the first run in someone else's repository
// (docs/superpowers/specs/2026-08-20-...): the worktree was cut from the LOCAL
// main. `verifyBaseExistsLocally` preferred the local branch and only looked at
// `origin/<base>` when the local one did not exist, and there was no `git
// fetch` anywhere in the dispatch.
//
// Measured in the field (jjponz/rust-monitoring#10): the slice's branch came
// out of a `main` that was one commit behind its remote —pull request #1 had
// already merged and had rewritten AGENTS.md— and three things came out of that
// in a chain: a plan quoted literally against a stale tree, a pull request in
// conflict and, because of the conflict, ZERO continuous integration checks
// (with no merge reference GitHub creates no run at all).
//
// What this block pins down: a fetch happens, the worktree comes out of
// `origin/<base>`, and a base absent from the local checkout is NO longer an
// error — which is half of the fix: the state of the local copy stops deciding
// anything.
describe('ct-next — the base comes from the remote, not from the local copy (Step 1)', () => {
  it('runs `git fetch origin <base>` before creating the worktree, and cuts the worktree from `origin/<base>`', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_DEFAULT_BRANCH: 'develop',
    })
    expect(r.code).toBe(0)
    const log = readFileSync(gitLog, 'utf8')
    expect(log).toMatch(/^fetch origin develop$/m)
    expect(log).toMatch(/worktree add -b feat\/42 \S*\/42 origin\/develop/)
    // The fetch goes BEFORE: refreshing after resolving refreshes nothing.
    expect(log.indexOf('fetch origin develop')).toBeLessThan(log.indexOf('worktree add'))
  })

  it('the `base:` seeded in SLICE.md is still the branch name, never `origin/<branch>`', () => {
    // `gh pr create --base <branch>` does not accept a remote branch, and that
    // value comes from here: what changes is where the worktree COMES FROM, not
    // which branch the pull request is opened against.
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GH_DEFAULT_BRANCH: 'develop',
    })
    expect(r.code).toBe(0)
    const sliceMd = readFileSync(join(repoRoot, '.worktrees', '42', '.agent', 'SLICE.md'), 'utf8')
    expect(sliceMd).toMatch(/^base: develop$/m)
    expect(sliceMd).not.toMatch(/origin\/develop/)
  })

  it('the seeded `base_sha:` is the HEAD of the freshly created worktree — the real cut, not the sha resolved before the loop (slice 9)', () => {
    // Slice 1 wired the cut's sha all the way to the seed; slice 9(b) measures
    // it where the cut really happens. The stub returns `deadbeef…` for
    // `origin/<base>^{commit}` (the resolution before the loop) and `cafebabe…`
    // for the worktree's `HEAD^{commit}`: if the seed carries `cafebabe…`, the
    // value being seeded is the one measured AFTER the `git worktree add`.
    // `last_commit` travels with it on purpose (the same argument as
    // buildStateSeed, and the same fact: where this branch came from).
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_DEFAULT_BRANCH: 'develop',
    })
    expect(r.code).toBe(0)
    const sliceMd = readFileSync(join(repoRoot, '.worktrees', '42', '.agent', 'SLICE.md'), 'utf8')
    expect(sliceMd).toMatch(/^base_sha: cafebabecafebabecafebabecafebabecafebabe$/m)
    expect(sliceMd).toMatch(/^last_commit: cafebabecafebabecafebabecafebabecafebabe$/m)
    expect(sliceMd).not.toContain('deadbeef')
    // And the cut's other consumer still sees a branch name.
    expect(sliceMd).toMatch(/^base: develop$/m)
    // The order matters more than the value: it is measured AFTER cutting. With
    // the measurement before the loop, this line would not exist after the add.
    const log = readFileSync(gitLog, 'utf8')
    expect(log).toMatch(/^rev-parse --verify --quiet HEAD\^\{commit\}$/m)
    expect(log.indexOf('worktree add')).toBeLessThan(log.indexOf('rev-parse --verify --quiet HEAD^{commit}'))
  })

  it('if the worktree\'s `rev-parse HEAD` fails, the seed falls back to the sha resolved before the loop and warns — the field is not omitted', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_WORKTREE_HEAD_FAIL: '1',
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GH_DEFAULT_BRANCH: 'develop',
    })
    expect(r.code).toBe(0)                       // it degrades, it does not abort: the slice is launched
    expect(r.out).toMatch(/launched #42/)
    expect(r.out).toMatch(/the real cut in the worktree of/)
    const sliceMd = readFileSync(join(repoRoot, '.worktrees', '42', '.agent', 'SLICE.md'), 'utf8')
    expect(sliceMd).toMatch(/^base_sha: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef$/m)
    expect(sliceMd).toMatch(/^last_commit: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef$/m)
  })

  it('a base absent from the local checkout is NO longer an error: the worktree comes out of the remote all the same', () => {
    // This is the deliberate inversion of the earlier behaviour. This used to be
    // exit 1 with "existe en origin pero no en tu checkout local"; now the state
    // of the local copy decides nothing, because it is not used.
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_BASE_NOT_LOCAL: '1',
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_DEFAULT_BRANCH: 'develop',
    })
    expect(r.code).toBe(0)
    expect(readFileSync(gitLog, 'utf8')).toMatch(/worktree add -b feat\/42 \S*\/42 origin\/develop/)
  })

  it('a base that does not exist in the remote → exit 1, no worktree and no claim', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--base', 'mian'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_BASE_NOT_REMOTE: '1',
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/origin\/mian/)
    expect(existsSyncSafe(gitLog)).not.toMatch(/worktree add/)
    expect(existsSyncSafe(argvLog)).not.toMatch(/issue edit/)
  })

  it('if the `git fetch` fails → exit 1, no worktree and no claim: with no fetch there is no knowing whether the base is up to date', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_FETCH_FAIL: '1',
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GH_DEFAULT_BRANCH: 'develop',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/fetch/i)
    expect(existsSyncSafe(gitLog)).not.toMatch(/worktree add/)
    expect(existsSyncSafe(argvLog)).not.toMatch(/issue edit/)
  })
})
