// ============================================================================
// F22 — THE STATE OF THE SLICE STOPS BEING PRODUCT.
//
// The dispatcher seeded the state of the slice ON TOP OF `.agent/STATE.md`,
// which is TRACKED and is the file of the coordinator session. Three times over
// a span of 9 slices that file went into a PR; one reached `main`, which was
// left with `task: <name of the slice>` and a gate pending on an already merged
// PR — any new session of the repository hydrated believing it was the agent of
// that slice.
//
// And the same file was a false snapshot in the meantime: 21 hours and 7
// commits with the seed intact (`status: not_started`). The cause was NOT that
// the kickoff asked for it to be updated at the end: the `Stop` hook ALREADY
// forced it to be refreshed every turn, and it was disarmed because the seed
// wrote `last_commit: ''` — with the field empty, `describeStopRelation`
// returns `unset` and `classifyStopState` leaves in silence.
//
// The two go together because fixing the second makes the first worse: an agent
// forced to refresh its state every turn is an agent more likely to commit
// it.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATE_REL_PATH, SLICE_REL_PATH, NEVER_IN_A_SLICE_PR, resolveStatePath, excludeContentWith } from '../scripts/state-paths.js'
import { buildStateSeed, renderKickoff } from '../scripts/kickoff.js'
import { parseState } from '../scripts/state.js'
// F22, Step 4: setup reused from __tests__/ct-next-launch-verification.test.js
// — account dirs + cmux/claude stubs, and the hygiene of cleaning up temporary
// directories that can hang off a SIGKILL to an orphaned grandchild.
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { goEnv } from './fixtures/go-gate.js'

const here = dirname(fileURLToPath(import.meta.url))
const stopHook = join(here, '..', 'dist', 'stop.js')
const sessionStartHook = join(here, '..', 'dist', 'session-start.js')

// A real git repository with one commit: the hooks run `git rev-parse HEAD` and
// `git log`, so a bare directory does not exercise the real path.
const mkGitRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'f22-git-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  // Fix round 1, finding 2: an explicit `-b main` — without it, `git init` uses
  // the `init.defaultBranch` of the machine running the test (factory git:
  // "master"), and the merge test further down plainly assumes "main".
  git('init', '-q', '-b', 'main', '.')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, 'f.txt'), 'base\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
  return dir
}

const runHook = (hookPath, cwd, extra = {}) => {
  const r = spawnSync('node', [hookPath], {
    input: JSON.stringify({ cwd, stop_hook_active: false, ...extra }),
    encoding: 'utf8',
  })
  return r.stdout ? JSON.parse(r.stdout) : null
}

const mkRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'f22-'))
  mkdirSync(join(dir, '.agent'), { recursive: true })
  return dir
}

describe('F22 — the precedence for reading the state', () => {
  it('with BOTH files, SLICE.md wins: it is the state of the slice, not that of the coordinator', () => {
    const dir = mkRepo()
    writeFileSync(join(dir, STATE_REL_PATH), 'coordinadora')
    writeFileSync(join(dir, SLICE_REL_PATH), 'slice')
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('slice')
    expect(r.path).toBe(join(dir, SLICE_REL_PATH))
    rmSync(dir, { recursive: true, force: true })
  })

  it('with no SLICE.md it falls back to STATE.md — the coordinator checkout, and the worktrees of the previous scheme', () => {
    const dir = mkRepo()
    writeFileSync(join(dir, STATE_REL_PATH), 'coordinadora')
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('coordinator')
    expect(r.path).toBe(join(dir, STATE_REL_PATH))
    rmSync(dir, { recursive: true, force: true })
  })

  it('with neither of the two it returns a null path, and invents no path that does not exist', () => {
    const dir = mkRepo()
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('none')
    expect(r.path).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('the paths a slice PR may not introduce are EXACTLY those two, not the whole of `.agent/`', () => {
    expect(NEVER_IN_A_SLICE_PR).toEqual([STATE_REL_PATH, SLICE_REL_PATH])
    expect(NEVER_IN_A_SLICE_PR).not.toContain('.agent/conventions-ack.md')
  })
})

describe('F22 — the hooks read by precedence', () => {
  it('SessionStart hydrates from SLICE.md when it exists, not from the coordinator STATE.md', () => {
    const dir = mkGitRepo()
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic de la coordinadora\nstatus: in_progress\n---\n# c\n')
    writeFileSync(join(dir, SLICE_REL_PATH), '---\ntask: el slice despachado\nstatus: not_started\n---\n# s\n')
    const out = runHook(sessionStartHook, dir)
    const ctx = out.hookSpecificOutput.additionalContext
    expect(ctx).toContain('el slice despachado')
    expect(ctx).not.toContain('el epic de la coordinadora')
    rmSync(dir, { recursive: true, force: true })
  })

  it('SessionStart falls back to STATE.md with no SLICE.md — the coordinator checkout stays as it was', () => {
    const dir = mkGitRepo()
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic de la coordinadora\nstatus: in_progress\n---\n# c\n')
    const out = runHook(sessionStartHook, dir)
    expect(out.hookSpecificOutput.additionalContext).toContain('el epic de la coordinadora')
    rmSync(dir, { recursive: true, force: true })
  })

  it('Stop measures the freshness of SLICE.md, not that of the coordinator STATE.md', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const base = git('rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, SLICE_REL_PATH), `---\ntask: slice\nlast_commit: ${base}\n---\n# s\n`)
    // Do some work and capture the new HEAD
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')
    const newHead = git('rev-parse', 'HEAD').trim()
    // The coordinator STATE.md points at the new HEAD: if the hook read it, the
    // relation would be `same` and it would not block. But SLICE.md points at
    // base, so if the hook reads SLICE.md, it sees `behind` and blocks.
    writeFileSync(join(dir, STATE_REL_PATH), `---\ntask: coordinadora\nlast_commit: ${newHead}\n---\n# c\n`)
    const out = runHook(stopHook, dir)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('has fallen behind')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('F22 — the exclude rule is idempotent and corrupts nothing that is already there', () => {
  it('it adds the rule when it is not there', () => {
    const r = excludeContentWith('# comentario\n', '.agent/SLICE.md')
    expect(r.added).toBe(true)
    expect(r.content).toBe('# comentario\n.agent/SLICE.md\n')
  })

  it('it does NOT duplicate it on the second pass — two dispatches leave a single line', () => {
    const once = excludeContentWith('', '.agent/SLICE.md')
    const twice = excludeContentWith(once.content, '.agent/SLICE.md')
    expect(twice.added).toBe(false)
    expect(twice.content).toBe(once.content)
    expect(twice.content.split('\n').filter((l) => l === '.agent/SLICE.md')).toHaveLength(1)
  })

  it('it normalises the trailing newline: without it, the append would glue the rule onto the last line of the user and corrupt BOTH', () => {
    const r = excludeContentWith('*.tmp', '.agent/SLICE.md')
    expect(r.content).toBe('*.tmp\n.agent/SLICE.md\n')
    expect(r.content).not.toContain('*.tmp.agent')
  })

  it('it recognises the rule even when it comes with spaces around it', () => {
    expect(excludeContentWith('  .agent/SLICE.md  \n', '.agent/SLICE.md').added).toBe(false)
  })
})

describe('F22 — the ignore rule goes to the COMMON git directory', () => {
  it('the info/exclude a worktree sees is the one of the main checkout, not one of its own', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: join(dir, '.worktrees', '1'), encoding: 'utf8',
    }).trim()
    // It returns the .git of the main checkout: ONE write covers the
    // coordinator and every worktree, present and future.
    expect(common).toContain(dir)
    expect(common).not.toContain('.worktrees')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a rule in info/exclude DOES hide the new file, and survives a git add -A', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    mkdirSync(join(wt, '.agent'), { recursive: true })
    writeFileSync(join(wt, SLICE_REL_PATH), 'estado del slice')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    execFileSync('git', ['add', '-A'], { cwd: wt })
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('F22 — the seed does not touch the coordinator file', () => {
  it('after seeding, the STATE.md of the worktree is at ZERO DIFF against the base', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# coordinadora\n')
    git('add', '-A')
    git('commit', '-qm', 'estado de la coordinadora')
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')

    // What the dispatcher does after this change: the ignore rule, and it
    // seeds into SLICE.md without touching STATE.md.
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    writeFileSync(join(wt, SLICE_REL_PATH), '---\ntask: el slice\n---\n# slice\n')

    expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    expect(execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('the merge of main that used to conflict in STATE.md now comes in clean', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# v1\n')
    git('add', '-A')
    git('commit', '-qm', 'estado v1')
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    writeFileSync(join(wt, SLICE_REL_PATH), '---\ntask: el slice\n---\n# slice\n')

    // The coordinator advances its state on main — 44 out of every 1074
    // commits of main did so in the real repository.
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# v2\n')
    git('add', '-A')
    git('commit', '-qm', 'estado v2')

    const merge = spawnSync('git', ['merge', 'main', '-m', 'merge main'], { cwd: wt, encoding: 'utf8' })
    expect(merge.status).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// F22, Step 4 — THE EFFECT DOOR ABORTS A REAL RUN, AND REVERTS THE CLAIM.
//
// This is the test that keeps the effect verification from degrading into
// decoration: a REAL run of ct-next.mjs is needed (--dry-run creates no
// worktree and seeds nothing), built on __tests__/ct-next-launch-
// verification.test.js — the same gh/cmux/claude stubs, the same best-effort
// cleanup.
//
// The difference from that setup is deliberate: fake-git-bin is NOT used here.
// The scenario depends on a real property of git (a negation in `.gitignore`
// beats a rule in `info/exclude`), and an entirely simulated git has no such
// precedence to reproduce — the real binary is needed, against a real
// repository on disk.
// ============================================================================
const ctNextScript = join(here, '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(here, 'fixtures')

// A PATH with no fake-git-bin (on purpose, see the comment above): the real
// git, in front of simulated gh/cmux/claude.
const realGitFakeRestPath = [
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

// A REAL git repository with the trap set: a `.gitignore` with the rule and its
// own negation right below it — verified by hand (see Step 4 of the brief) that
// with these two lines `git status --porcelain --untracked-files=all` STILL
// sees the file despite the rule ensureSliceIgnored() writes into info/exclude,
// because a negation in the repository's .gitignore takes precedence over
// info/exclude.
//
// `trackAgentState` (fix round 1, finding Important 1): drives whether
// `.agent/STATE.md` goes COMMITTED in the base, so as to cover the TWO cases
// `.agent/` can be in on a real checkout:
//   - true  (the default case, the normal checkout): `.agent/` ALREADY has
//     something tracked, so git lists SLICE.md individually in the porcelain
//     with no help from any flag.
//   - false: NOTHING under `.agent/` is tracked — the directory does not even
//     exist in the base. It is the case `--untracked-files=all` exists to
//     cover: with the default mode of `git status --porcelain`, an ENTIRELY
//     untracked directory collapses into a single line (`?? .agent/`) that the
//     `includes(SLICE_REL_PATH)` of ct-next.mjs does not recognise — the door
//     goes blind precisely in the case it exists to close. Verified by hand
//     against real git before writing the test below.
function mkRealDispatchRepo({ trackAgentState = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'f22-real-dispatch-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  if (trackAgentState) {
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: el epic\n---\n# coordinadora\n')
  }
  writeFileSync(join(dir, '.gitignore'), `${SLICE_REL_PATH}\n!${SLICE_REL_PATH}\n`)
  git('add', '-A')
  git('commit', '-qm', 'base')
  // A REAL ORIGIN, FETCHABLE AND OFFLINE (Step 1 of the spec of the first run
  // in someone else's repository). These two tests run REAL git, and since Step
  // 1 ct-next.mjs does a `git fetch origin <base>` and cuts the worktree from
  // `origin/<base>`: with the `https://github.com/o/r.git` that used to be
  // here, the fetch went out to the network, failed, and the run died BEFORE
  // reaching the effect door these tests exist to test.
  //
  // The trick is the PATH: a local bare repository hanging off
  // `.../github.com/o/r.git` satisfies both things at once without touching
  // anything of production — `git fetch` reaches it because it is a path on
  // disk, and the identity guard of ct-next.mjs reads it as `o/r` because its
  // regex looks for `github.com[:/]owner/repo` in the remote's URL, and a path
  // with that stretch inside it matches just as a URL does. It is cloned AFTER
  // the commit so that `origin/main` exists, and it lives INSIDE `.git/` so
  // that it does not show up in `git status --porcelain` (F22's effect door
  // reads that output) and so that the cleanup of the repository itself takes
  // it away.
  const origin = join(dir, '.git', 'test-origin', 'github.com', 'o', 'r.git')
  mkdirSync(dirname(origin), { recursive: true })
  execFileSync('git', ['clone', '-q', '--bare', dir, origin], { stdio: 'ignore' })
  git('remote', 'add', 'origin', origin)
  git('fetch', '-q', 'origin', 'main')
  return dir
}

const openIssue1 = { number: 1, title: '#1 algo', labels: [{ name: 'status:ready' }], body: '' }

// runGateTest: the real dispatch setup (identical between the two cases below),
// parameterised only by the input repository — so that the two cases (`.agent/`
// with something tracked / `.agent/` entirely untracked) run exactly the same
// sequence of assertions and cannot diverge in anything other than the cause
// each one wants to test.
function runGateTest(repoRoot) {
  const argvLog = join(repoRoot, 'gh-argv-log')
  const counterFile = join(repoRoot, 'gh-list-count')
  const r = spawnSync('node', [ctNextScript, '--repo', 'o/r', '--cap', '1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
            PATH: realGitFakeRestPath,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue1], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    },
  })
  const out = (r.stdout || '') + (r.stderr || '')

  // 1. Nothing is dispatched.
  expect(r.status).not.toBe(0)
  // 2. The reason is the one the effect door prints — not a generic failure.
  expect(out).toContain('SIGUE siendo visible para git')
  // 3. The worktree was cleaned up, not left orphaned.
  expect(existsSync(join(repoRoot, '.worktrees', '1'))).toBe(false)
  // 4. And the claim reverted: the fake-gh recorded the real call back to
  // status:ready (the same assertion pattern ct-next-claim.test.js uses for the
  // same kind of automatic revert after a post-claim failure).
  const argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
  expect(argv).toMatch(/issue edit 1 --repo o\/r --add-label status:ready --remove-label status:in-progress/)

  rmSyncBestEffort(repoRoot)
}

describe('F22 — the effect verification ABORTS a real run and reverts the claim', () => {
  it('a .gitignore with a negation beats info/exclude, with .agent/STATE.md already tracked → nothing is dispatched, the worktree is cleaned up, the claim is handed back to status:ready', () => {
    runGateTest(mkRealDispatchRepo({ trackAgentState: true }))
  })

  // Fix round 1, finding Important 1: a separate case with NOTHING tracked
  // under `.agent/` — the one `git status --porcelain` without
  // `--untracked-files=all` let through (it collapsed into `?? .agent/`,
  // invisible to the door's `includes(SLICE_REL_PATH)`). Without this case,
  // `.agent/STATE.md` going committed in the other test is a property of the
  // FIXTURE that by accident makes the real check pass — ct-next.mjs nowhere
  // demands that `.agent/` have anything tracked.
  it('a .gitignore with a negation beats info/exclude, with NOTHING tracked under .agent/ → it still aborts (it protects against the untracked-directory collapse)', () => {
    runGateTest(mkRealDispatchRepo({ trackAgentState: false }))
  })
})

describe('F22 — the seed stops disarming the freshness hook', () => {
  it('it seeds last_commit with the sha of the base, not empty', () => {
    const slice = { n: 7, name: 'un slice', ac: ['AC1'], issue: 42 }
    const seed = buildStateSeed(slice, { branch: 'feat/42', base: 'main', baseSha: 'a'.repeat(40) })
    expect(parseState(seed).meta.last_commit).toBe('a'.repeat(40))
  })

  it('with no baseSha it falls back to empty — an invented sha would be worse than none', () => {
    const slice = { n: 7, name: 'un slice', ac: ['AC1'], issue: 42 }
    const seed = buildStateSeed(slice, { branch: 'feat/42', base: 'main' })
    expect(parseState(seed).meta.last_commit).toBe('')
  })

  it('with the new seed, the Stop hook BLOCKS the closure after a commit of work', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const baseSha = git('rev-parse', 'HEAD').trim()
    const seed = buildStateSeed(
      { n: 1, name: 'slice', ac: ['AC1'], issue: 1 },
      { branch: 'feat/1', base: 'main', baseSha },
    )
    writeFileSync(join(dir, SLICE_REL_PATH), seed)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')
    const out = runHook(stopHook, dir)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('1 commit')
    rmSync(dir, { recursive: true, force: true })
  })

  it("and with TODAY's seed (an empty last_commit) it does NOT block — the defect this fixes", () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const seed = buildStateSeed({ n: 1, name: 'slice', ac: ['AC1'], issue: 1 }, { branch: 'feat/1', base: 'main' })
    writeFileSync(join(dir, SLICE_REL_PATH), seed)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')
    expect(runHook(stopHook, dir)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// F22, Task 6b — THE MESSAGES NAME THE FILE THAT WAS REALLY READ.
//
// The readers already apply the precedence, but the messages that talk about
// the file kept naming `.agent/STATE.md` flat out. In the worktree of a slice
// that tells the agent to edit the coordinator's TRACKED file — precisely the
// contamination F22 removes. And since Task 5 (which rearmed the `Stop` hook by
// seeding `last_commit` with the sha of the base) that blocking reason comes
// out on EVERY turn of EVERY slice, so the wrong instruction went from harmless
// to being what the agent reads turn after turn.
//
// The first two tests run the REAL hook from `dist/` against a real repository:
// it is the only way to check that the resolved path travels from
// `resolveStatePath` all the way to the text, through the hook and
// `state.js`.
// ============================================================================
describe('F22 — the messages name the file that was read', () => {
  it('in a slice worktree, the Stop hook block names SLICE.md and NOT STATE.md', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const base = git('rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, SLICE_REL_PATH), `---\ntask: slice\nlast_commit: ${base}\n---\n# s\n`)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')

    const out = runHook(stopHook, dir)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain(SLICE_REL_PATH)
    // What really matters: not a single mention of the coordinator's file. An
    // `Actualiza STATE.md` here is an order to contaminate.
    expect(out.reason).not.toContain(STATE_REL_PATH)
    rmSync(dir, { recursive: true, force: true })
  })

  it('in the coordinator checkout, the same block keeps naming STATE.md', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const base = git('rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, STATE_REL_PATH), `---\ntask: el epic\nlast_commit: ${base}\n---\n# c\n`)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')

    const out = runHook(stopHook, dir)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain(STATE_REL_PATH)
    expect(out.reason).not.toContain(SLICE_REL_PATH)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the kickoff tells the agent to use SLICE.md, on ALL of its lines', () => {
    const k = renderKickoff(
      { n: 7, name: 'un slice', type: 'backend', ac: ['AC-7.1'], issue: '#7' },
      { repo: 'o/r', dispatchCheckPath: '/p/dispatch-check.mjs', base: 'main', conventionsDir: '/plugin/conventions' },
    )
    // No line names the coordinator's file: the kickoff is received ONLY by a
    // slice agent, so there is no possible ambiguity there.
    expect(k).not.toContain(STATE_REL_PATH)
    const lineWith = (needle) => k.split('\n').find((l) => l.includes(needle))
    expect(lineWith('blocked:')).toContain(SLICE_REL_PATH)
    expect(lineWith('Al acabar:')).toContain(SLICE_REL_PATH)
  })
})

// ============================================================================
// F22, Task 6 — the `blocked` that formatBlockedClaimWarnings (ct-next.mjs)
// reports is read from `.agent/SLICE.md`, with NO fallback to
// `.agent/STATE.md`. In a worktree seeded by this version, `.agent/STATE.md` is
// the COORDINATOR's file, frozen at the base: its `blocked` talks about the
// epic, not about the slice, and reading it would report as blocked a slice
// that is not. A worktree with no SLICE.md is one of the scheme before F22 — it
// warns, it does not guess.
//
// The setup is traced from __tests__/ct-next-staleness.test.js (runReal via
// spawnSync, a fakePath with fake-git-bin/fake-gh-bin/fake-cmux-bin,
// rmSyncBestEffort) — with one deliberate difference: here stdout and stderr
// are captured SEPARATELY, because the central assertion is that the
// coordinator's reason leaks into NEITHER of the two channels, not just into
// the mix of both.
// ============================================================================
const blockedFakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  process.env.PATH,
].join(':')

function runBlockedCheck(args, envOverrides = {}) {
  const r = spawnSync('node', [ctNextScript, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: blockedFakePath, ...envOverrides },
  })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

describe('F22 — the dispatcher does not mistake the coordinator blocked for the one of the slice', () => {
  it('a worktree of the previous scheme WARNS instead of reading the coordinator STATE.md', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'f22-blocked-'))
    mkdirSync(join(repoRoot, '.worktrees', '5', '.agent'), { recursive: true })
    writeFileSync(
      join(repoRoot, '.worktrees', '5', STATE_REL_PATH),
      '---\ntask: el epic de la coordinadora\nblocked:\n  reason: esperando una decisión de producto\n---\n# c\n',
    )
    const issue5 = { number: 5, title: '#5 slice viejo', labels: [{ name: 'status:in-progress' }], body: '<!-- ct-order:1 -->\n' }
    const r = runBlockedCheck(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // Two sequenced calls (open, then closed): without FAKE_GH_COUNTER_FILE
      // both would return seq[0] alike and the "closed" fixture (empty, on
      // purpose) would be ignored.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue5], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })

    // It says it has NOT checked, and names the file that is missing…
    expect(r.stderr).toContain('.agent/SLICE.md')
    expect(r.stderr).toContain('NO se ha comprobado')
    // …and it NEVER asserts that the slice is blocked by citing the reason of
    // the epic, on NEITHER of the two channels.
    expect(r.stderr).not.toContain('esperando una decisión de producto')
    expect(r.stdout).not.toContain('esperando una decisión de producto')

    rmSyncBestEffort(repoRoot)
  })

  // Task 6b, fix round 1 — THE CALLER THAT ESCAPED THE SWEEP.
  //
  // `formatBlockedClaimWarnings` reads `.worktrees/<n>/.agent/SLICE.md` and
  // passes it to `readBlocked`, which composes its notes with whatever file it
  // is told — and without `stateRel` it tells it `.agent/STATE.md` by default.
  // The contradiction note fires with `status: blocked` + an empty `blocked`
  // field (the writing error state.js itself documents as the most likely one)
  // and is concatenated AS IS to the dispatcher's warning: the coordinator
  // would read «its own .worktrees/7/.agent/SLICE.md declares itself BLOCKED …
  // contradiction in .agent/STATE.md», which sends it off to edit the TRACKED
  // file it has in its own cwd. It is the contamination F22 exists to prevent,
  // served by the dispatcher itself.
  //
  // A default is a silent failure by construction: it does not blow up, it
  // produces a PLAUSIBLE and wrong answer. That is why the guard is a test and
  // not a convention.
  it('the contradiction note of a SLICE.md names SLICE.md, not the STATE.md the coordinator has in its cwd', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'f22-blocked-nota-'))
    mkdirSync(join(repoRoot, '.worktrees', '7', '.agent'), { recursive: true })
    // `status: blocked` with an empty `blocked` field: it fires the note.
    writeFileSync(
      join(repoRoot, '.worktrees', '7', SLICE_REL_PATH),
      '---\ntask: el slice\nstatus: blocked\nblocked:\n---\n# s\n',
    )
    const issue7 = { number: 7, title: '#7 un slice', labels: [{ name: 'status:in-progress' }], body: '<!-- ct-order:1 -->\n' }
    const r = runBlockedCheck(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue7], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })

    // The note comes out (otherwise the test would be testing nothing)…
    expect(r.stderr).toContain('contradiction in')
    // …and it names the file the dispatcher really read.
    expect(r.stderr).toContain(`contradiction in ${SLICE_REL_PATH}`)
    // Not a single mention of the coordinator's file in the WHOLE warning.
    expect(r.stderr).not.toContain(STATE_REL_PATH)
    expect(r.stdout).not.toContain(STATE_REL_PATH)

    rmSyncBestEffort(repoRoot)
  })
})

describe('F22 — ct-init leaves the rule committed in the .gitignore', () => {
  it('it adds .agent/SLICE.md, and does not duplicate it when re-run', () => {
    const dir = mkGitRepo()
    const initScript = join(here, '..', 'scripts', 'ct-init.sh')
    execFileSync('bash', [initScript, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const first = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(first.split('\n').filter((l) => l.trim() === SLICE_REL_PATH)).toHaveLength(1)
    execFileSync('bash', [initScript, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const second = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(second.split('\n').filter((l) => l.trim() === SLICE_REL_PATH)).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('F22 — --release refuses if the branch carries a state file', () => {
  const dispatchCheck = join(here, '..', 'scripts', 'dispatch-check.mjs')

  const mkSliceWorktree = ({ baseFiles = {} } = {}) => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# c\n')
    // F-jjponz-3: files that already exist IN THE BASE of the branch. They are
    // the ones a plan cites as "Current state (file)" and that a task of the
    // slice rewrites afterwards — the case no fixture covered, because they all
    // created new files ("does not exist") and never exercised the literalness
    // check in the --release gate.
    for (const [rel, content] of Object.entries(baseFiles)) {
      writeFileSync(join(dir, rel), content)
    }
    git('add', '-A')
    git('commit', '-qm', 'estado coordinadora')
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')
    const baseSha = git('rev-parse', 'HEAD').trim()
    // The same pattern as "F22 — the seed does not touch the coordinator
    // file": without this rule in info/exclude, `.agent/SLICE.md` is not
    // ignored in this test repository and a later `git add -A` would drag it
    // into the "work" commit — contaminating precisely the case the second test
    // below wants to leave clean. In the real dispatcher this rule is written
    // by ensureSliceIgnored() (Task 3) before seeding SLICE.md; here it has to
    // be replicated by hand.
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    writeFileSync(join(wt, SLICE_REL_PATH), `---\ntask: slice\nbase: ${baseSha}\n---\n# s\n`)
    return { dir, wt, git: (...a) => execFileSync('git', a, { cwd: wt, encoding: 'utf8' }) }
  }

  it('exit 5 when the branch introduces .agent/STATE.md, and the message gives the remedy', () => {
    const { dir, wt, git } = mkSliceWorktree()
    writeFileSync(join(wt, STATE_REL_PATH), '---\ntask: el slice\n---\n# contaminado\n')
    git('add', '-A')
    git('commit', '-qm', 'work + estado')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('.agent/STATE.md')
    expect(r.stderr).toContain('git checkout')
    rmSync(dir, { recursive: true, force: true })
  })

  // A minimal plan that satisfies plan-contract.js — since F-jjponz-1,
  // --release demands a prescriptive plan committed on the branch. Its only
  // block goes under "Final text (f.txt):" (F-jjponz-4: every block declares
  // its role), a role that is not checked against the repository: the fixture
  // still cites nothing.
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
    'f.txt',
    '## 5. Interfaces',
    'Consumes: N/A. Produces: N/A.',
    '## 6. Test strategy',
    'N/A — fixture.',
    '## 7. Tasks',
    '### Task 1 — do the work',
    '**Objective:** the work is committed.',
    '**Files:** f.txt',
    'Final text (f.txt):',
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

  const seedPlan = (wt, issue) => {
    mkdirSync(join(wt, 'docs', 'superpowers', 'plans'), { recursive: true })
    writeFileSync(join(wt, 'docs', 'superpowers', 'plans', `2026-08-12-issue-${issue}-fixture.md`), minimalPlanFor(issue))
  }

  // The run gate of --release (exit 7): these tests test OTHER doors, so they
  // are given a delivered run so that the run's own door does not interfere.
  // Uncommitted, which is how ct-step leaves it (ct-init gitignores it).
  const seedRun = (wt, issue) => {
    mkdirSync(join(wt, '.agent'), { recursive: true })
    writeFileSync(join(wt, '.agent', `run-${issue}.json`), JSON.stringify({ issue, task: 1, tasksTotal: 1, step: 'commit', closed: 'delivered' }))
  }

  // The same as seedPlan, but its Task 1 CITES a file instead of creating it:
  // `Current state (<path>):` with `<body>` inside the fence.
  const seedPlanCiting = (wt, issue, path, body) => {
    const plan = minimalPlanFor(issue)
      .replace('Final text (f.txt):', `Current state (${path}):`)
      .replace(`${FENCE}\ntrabajo\n${FENCE}`, `${FENCE}\n${body}\n${FENCE}`)
    mkdirSync(join(wt, 'docs', 'superpowers', 'plans'), { recursive: true })
    writeFileSync(join(wt, 'docs', 'superpowers', 'plans', `2026-08-12-issue-${issue}-fixture.md`), plan)
  }

  it('exit 0 with a clean branch — the normal case pays nothing', () => {
    const { dir, wt, git } = mkSliceWorktree()
    writeFileSync(join(wt, 'f.txt'), 'trabajo\n')
    seedPlan(wt, 1)
    git('add', '-A')
    git('commit', '-qm', 'work')
    seedRun(wt, 1)
    // Task 10 (F-e2e): --release reads the body of the issue through `gh` even
    // after passing the doors above — without the stub in PATH, this real `gh`
    // would fail against an 'o/r' repository that does not exist. With no
    // FAKE_GH_VIEW_BODY, the stub answers empty: no "## E2E" section to
    // cross-check, the happy path.
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
      env: { ...process.env, PATH: `${join(fixturesDir, 'fake-gh-bin')}:${process.env.PATH}`, ...goEnv({ repo: 'o/r', issue: 1 }) },
    })
    expect(r.status).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('exit 6 with the branch clean but with NO prescriptive plan — the remedy names the skill (F-jjponz-1)', () => {
    const { dir, wt, git } = mkSliceWorktree()
    writeFileSync(join(wt, 'f.txt'), 'trabajo\n')
    git('add', '-A')
    git('commit', '-qm', 'work')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(6)
    expect(r.stderr).toContain('writing-plans-prescriptive')
    expect(r.stderr).toContain('status:in-progress')
    rmSync(dir, { recursive: true, force: true })
  })

  it('--check-plan green with the plan in the working tree, still uncommitted (F-jjponz-1)', () => {
    const { dir, wt } = mkSliceWorktree()
    seedPlan(wt, 1)
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--check-plan'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('plan ok')
    rmSync(dir, { recursive: true, force: true })
  })

  it('--check-plan with a citation from memory → exit 6 and it names the cited file (F-jjponz-1)', () => {
    const { dir, wt } = mkSliceWorktree()
    seedPlan(wt, 1)
    const broken = readFileSync(join(wt, 'docs', 'superpowers', 'plans', '2026-08-12-issue-1-fixture.md'), 'utf8')
      .replace('Final text (f.txt):', 'Current state (f.txt):')
    writeFileSync(join(wt, 'docs', 'superpowers', 'plans', '2026-08-12-issue-1-fixture.md'), broken)
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--check-plan'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(6)
    expect(r.stderr).toContain('f.txt')
    rmSync(dir, { recursive: true, force: true })
  })

  // ==========================================================================
  // F-jjponz-3 — the plan gate in --release was UNSATISFIABLE for any plan that
  // modifies an existing file.
  //
  // Both modes shared a reader (`readFileSync` of the working tree). In
  // --check-plan that is correct: the plan is written BEFORE implementing and
  // cites the tree exactly as it is. In --release the tasks have ALREADY run,
  // so every citation of a file the slice rewrites has stopped existing
  // verbatim and the gate came out with exit 6 — that is, only the plans that
  // limit themselves to creating new files got through it.
  //
  // Discovered in the e2e of slice #1 of repo-pulse (a plan that updates
  // AGENTS.md): the agent could only release by relabelling its three citations
  // as prose, which takes them out of the gate in silence. That is, the bug did
  // not block: it pushed people into dodging the very check the feature is
  // named after.
  //
  // The correction is asymmetric and leans on what --check-plan already does:
  // the release verifies the citations against the SAME snapshot the plan was
  // validated against when it was written, which is the base of the branch.
  // ==========================================================================

  it('exit 0 when the plan cites a file this slice MODIFIES: the citation is checked in the BASE, not in HEAD (F-jjponz-3)', () => {
    const { dir, wt, git } = mkSliceWorktree({ baseFiles: { 'AGENTS.md': 'texto de antes del slice\n' } })
    seedPlanCiting(wt, 1, 'AGENTS.md', 'texto de antes del slice')
    // The task does what the plan orders: it rewrites the cited file.
    writeFileSync(join(wt, 'AGENTS.md'), 'texto nuevo que trae el slice\n')
    git('add', '-A')
    git('commit', '-qm', 'work')
    seedRun(wt, 1)
    // Task 10 (F-e2e): the same as the test above — the stub is needed for
    // reading the body, not only for the mutation scenario.
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
      env: { ...process.env, PATH: `${join(fixturesDir, 'fake-gh-bin')}:${process.env.PATH}`, ...goEnv({ repo: 'o/r', issue: 1 }) },
    })
    expect(r.status).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('exit 6 if the citation does not exist in the base EITHER, even when the branch writes it in HEAD — the fix hardens the gate, it does not disarm it (F-jjponz-3)', () => {
    const { dir, wt, git } = mkSliceWorktree({ baseFiles: { 'AGENTS.md': 'texto de antes del slice\n' } })
    // An invented citation... and the work of the slice leaves it written in
    // the tree: with the old reader (HEAD) this passed green. It is exactly the
    // way to slip a citation from memory through the release door.
    seedPlanCiting(wt, 1, 'AGENTS.md', 'esto no estuvo nunca en el fichero')
    writeFileSync(join(wt, 'AGENTS.md'), 'esto no estuvo nunca en el fichero\n')
    git('add', '-A')
    git('commit', '-qm', 'work')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(6)
    expect(r.stderr).toContain('AGENTS.md')
    rmSync(dir, { recursive: true, force: true })
  })

  it('exit 6 with an honest message if the cited file did NOT exist in the base: a file the slice creates is cited with "does not exist" (F-jjponz-3)', () => {
    const { dir, wt, git } = mkSliceWorktree()
    seedPlanCiting(wt, 1, 'nuevo.txt', 'contenido nuevo')
    writeFileSync(join(wt, 'nuevo.txt'), 'contenido nuevo\n')
    git('add', '-A')
    git('commit', '-qm', 'work')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(6)
    expect(r.stderr).toContain('nuevo.txt')
    // It does not assert "citation from memory" when what is happening is that
    // the file was not in the base: the message has to say WHERE it looked.
    expect(r.stderr).toContain('base')
    rmSync(dir, { recursive: true, force: true })
  })

  it('--check-plan keeps reading the WORKING TREE: it is the mode from BEFORE implementing (F-jjponz-3)', () => {
    const { dir, wt } = mkSliceWorktree({ baseFiles: { 'AGENTS.md': 'texto de antes del slice\n' } })
    seedPlanCiting(wt, 1, 'AGENTS.md', 'texto de antes del slice')
    const green = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--check-plan'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(green.status).toBe(0)
    // And if the tree no longer says that, --check-plan calls it out: in that
    // mode the tree IS the state the plan cites, and it is not replaced by the
    // base.
    writeFileSync(join(wt, 'AGENTS.md'), 'otra cosa\n')
    const red = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--check-plan'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(red.status).toBe(6)
    rmSync(dir, { recursive: true, force: true })
  })

  // ==========================================================================
  // F22, fix round 1 — three more ways for the door to let a contaminated
  // branch through in silence. The reviewer raised them from Minor to blocking:
  // a door that can be switched off by config, by a rename, or by a
  // self-referential `base:` is not a door, it is a check that sometimes
  // checks.
  // ==========================================================================

  it('with diff.relative=true in the git config and invoked from a subdirectory, it STILL sees .agent/STATE.md outside the subtree', () => {
    // Without `--no-relative`, `git diff --name-only` from a subdirectory with
    // `diff.relative=true` in the config OMITS entirely the paths outside that
    // subtree — it does not even hide them under some odd relative path, it
    // makes them disappear from the output. Verified by hand before this test:
    // without the flag, the only line `git diff` prints from `sub/` is
    // `work.txt`; `.agent/STATE.md` appears nowhere.
    const { dir, wt, git } = mkSliceWorktree()
    mkdirSync(join(wt, 'sub'), { recursive: true })
    // `.agent/STATE.md` is already tracked from the base (mkSliceWorktree
    // commits it in `dir` before creating the worktree) — its content has to be
    // CHANGED for it to show up in the diff, not merely be present.
    writeFileSync(join(wt, STATE_REL_PATH), '---\ntask: el slice\n---\n# contaminado\n')
    writeFileSync(join(wt, 'sub', 'work.txt'), 'trabajo\n')
    git('add', '-A')
    git('commit', '-qm', 'work + estado')
    // The config belongs to the repository (it affects any invocation of git
    // in it, as the real config of whoever is running the gate would) — not
    // something the script controls.
    git('config', 'diff.relative', 'true')
    const subDir = join(wt, 'sub')
    // With no SLICE.md in `sub/` (the real `.agent/SLICE.md` lives at the root
    // of the worktree, not in the subdirectory), sliceBaseRef() falls back:
    // there IS a SLICE.md at the root of the worktree here, but `readFileSync`
    // looks for it in `process.cwd()` (=`sub/`), so it does not find it from
    // there either and falls back all the same, which resolves `main`.
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: subDir, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('.agent/STATE.md')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a rename of .agent/STATE.md does not hide the deletion of the original path', () => {
    // With rename detection on (the default of `git diff`), a branch that does
    // `git mv .agent/STATE.md otro-nombre.md` prints ONLY the destination in
    // `--name-only` — the deletion of the source stays hidden inside the rename
    // pair. Verified by hand: without `--no-renames`, the only line is
    // `otro-nombre.md`; with `--no-renames`, both come out, deletion and
    // creation, as independent paths.
    // `.agent/STATE.md` is already tracked from the base (mkSliceWorktree
    // commits it in `dir` before creating the worktree): renaming it is
    // enough.
    const { dir, wt, git } = mkSliceWorktree()
    git('mv', STATE_REL_PATH, 'otro-nombre.md')
    git('commit', '-qm', 'renombra STATE.md')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('.agent/STATE.md')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a `base:` in the seed equal to HEAD is not read as "clean" — it refuses just as with "the base could not be determined"', () => {
    // `SLICE.md` is not tracked and is written by the slice's own agent: it is
    // agent-reachable. A `base:` pointing at HEAD (by accident, or because
    // something rewrote it after committing the contamination) would make
    // `git diff base...HEAD` come out ALWAYS empty by construction — not
    // because the branch is clean, but because nothing was compared. The door
    // has to treat it as "could not be checked", never as "clean".
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# c\n')
    git('add', '-A')
    git('commit', '-qm', 'estado coordinadora')
    git('worktree', 'add', '-q', '-b', 'feat/3', '.worktrees/3', 'HEAD')
    const wt = join(dir, '.worktrees', '3')
    const wtGit = (...a) => execFileSync('git', a, { cwd: wt, encoding: 'utf8' })
    // It contaminates first...
    writeFileSync(join(wt, STATE_REL_PATH), '---\ntask: el slice\n---\n# contaminado\n')
    wtGit('add', '-A')
    wtGit('commit', '-qm', 'work + estado')
    // ...and THEN it writes the seed with `base:` pointing at the current HEAD
    // (the commit that ALREADY includes the contamination) instead of at the
    // real commit the worktree was cut from.
    const selfSha = wtGit('rev-parse', 'HEAD').trim()
    writeFileSync(join(wt, SLICE_REL_PATH), `---\ntask: slice\nbase: ${selfSha}\n---\n# s\n`)
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('EL MISMO commit que HEAD')
    expect(r.stderr).toContain('NO se ha podido comprobar')
    rmSync(dir, { recursive: true, force: true })
  })

  it('with no resolvable base (no main/master/remote, no SLICE.md) → exit 5, and it says explicitly that it could NOT be checked', () => {
    // The central invariant of the plan: never assert that something was
    // checked when it was not. This is the test that would catch a regression
    // such as adding 'HEAD' to the fallback chain of sliceBaseRef() — with that
    // change, this very branch (no main/master/remote) would resolve its own
    // HEAD as the base, the diff would come out empty, and the gate would
    // report "clean" without having compared anything. On purpose, NOTHING of
    // mkGitRepo() (which creates the `main` branch): the branch of this
    // repository is called `feat/1`, there is no remote, and there is no
    // `.agent/SLICE.md`, so the four routes of sliceBaseRef() are closed.
    const dir = mkdtempSync(join(tmpdir(), 'f22-nobase-'))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'feat/1', '.')
    git('config', 'user.email', 'test@test')
    git('config', 'user.name', 'test')
    writeFileSync(join(dir, 'f.txt'), 'base\n')
    git('add', '-A')
    git('commit', '-qm', 'base')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: dir, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('no se pudo determinar la base')
    expect(r.stderr).toContain('NO se ha podido comprobar')
    rmSync(dir, { recursive: true, force: true })
  })
})
