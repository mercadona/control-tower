// Finding 2 (interruption/staleness audit): with #41 stuck in
// status:in-progress holding touches:api (e.g. after the interruption of
// finding 1), the next run said:
//
//   El cap (1) ya está copado por trabajo en vuelo: 1 slice(s) en
//   status:in-progress — aunque subieras --cap no bastaría todavía: #42 está
//   ready con deps mergeadas, pero colisiona con trabajo en vuelo: comparte
//   el token 'api' con #41 (status:in-progress) — espera a que termine, o
//   resuelve el token.
//
// "espera a que termine" is false when nothing is running — nothing in the
// dispatch ever crossed an in-progress against LOCAL evidence of real work
// (worktree, branch, cmux session). These tests reproduce the auditor's
// scenario exactly and verify the hardened message.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
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
  const d = mkdtempSync(join(tmpdir(), 'ct-next-stale-'))
  dirs.push(d)
  return d
}

// Issue #41 "stuck" (it collides via touches:api) and #42 "ready" that clashes
// with it — the same shape as dispatch-integration-seams.test.js.
function rawIssue({ number, order, status = 'status:ready', touches = [] }) {
  const labels = [{ name: status }, ...touches.map((t) => ({ name: `touches:${t}` }))]
  return { number, title: `#${number} slice`, labels, body: `<!-- ct-order:${order} -->\n` }
}

const issue41Stuck = rawIssue({ number: 41, order: 1, status: 'status:in-progress', touches: ['api'] })
const issue42Ready = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['api'] })

describe('ct-next — a collision against an in-progress WITHOUT local evidence (finding 2): the message stops claiming "espera a que termine"', () => {
  it('with no worktree, no branch, and cmux with no session carrying "#41" → a staleness note, not "espera a que termine"', () => {
    const repoRoot = makeRepoRoot()
    // repoRoot does NOT have .worktrees/41 (nor is it created here).
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      // Without FAKE_GIT_STALE_BRANCH_EXISTS: NO branch exists (the default).
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]), // no live cmux session
    })
    expect(r.code).toBe(0)
    // The diagnosis is still correct (it collides with #41, token api)...
    expect(r.out).toMatch(/#42 está ready con deps mergeadas, pero colisiona con trabajo en vuelo/)
    expect(r.out).toMatch(/comparte el token 'api' con #41/)
    // ...but it NO LONGER claims "espera a que termine" without qualification.
    expect(r.out).not.toMatch(/espera a que termine, o resuelve el token/)
    expect(r.out).not.toMatch(/even if you raised --cap it would not be enough yet: #42.*espera a que termine\./)
    // And it does include the staleness note, making clear what is known and
    // what is not.
    expect(r.out).toMatch(/no worktree, local branch or cmux session was found for #41 ON THIS MACHINE/)
    expect(r.out).toMatch(/it cannot confirm that nobody is working on it somewhere else/)
    // It never states the abandonment as a plain fact — it only mentions it in
    // order to RULE IT OUT explicitly ("tampoco afirmamos que esté
    // abandonado").
    expect(r.out).not.toMatch(/#41 está abandonado/i)
    expect(r.out).toMatch(/neither do we assert that it is abandoned/)
  })

  it('with a worktree present for #41 → it STILL says "espera a que termine" (there is real local evidence)', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees', '41'), { recursive: true })
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/espera a que termine, o resuelve el token\./)
    expect(r.out).not.toMatch(/no worktree, local branch or cmux session was found/)
  })

  it('with the local branch feat/41 present (worktree already deleted, orphan branch) → it STILL says "espera a que termine"', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_GIT_STALE_BRANCH_EXISTS: '41',
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/espera a que termine, o resuelve el token\./)
  })

  it('with no worktree and no branch, but with a live cmux session whose title contains "#41" → it STILL says "espera a que termine"', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify(['o/r · #41 arreglar login']),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/espera a que termine, o resuelve el token\./)
  })

  it('adversarial attack: a cmux session "#410" must NOT count as evidence of #41 (word boundary)', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      // "#410" contains "#41" as a substring but it is a DIFFERENT issue —
      // without a word boundary in the regex, this would give a false "it is
      // still alive".
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify(['o/r · #410 otra cosa totalmente distinta']),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/no worktree, local branch or cmux session was found for #41 ON THIS MACHINE/)
  })

  it('the query to cmux fails (daemon unavailable) → "inconclusive", NEVER "there is no session"', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_LIST_WINDOWS_FAIL: '1',
    })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/espera a que termine, o resuelve el token\./)
    expect(r.out).not.toMatch(/ON THIS MACHINE/) // that is the phrase of the "no evidence" verdict — it does not apply here
    expect(r.out).toMatch(/cmux could not be queried/)
    expect(r.out).toMatch(/it cannot be ruled out that the work is still under way somewhere else/)
  })

  it('the cmux binary "is not available" (a stub that always fails) → treated the same as "inconclusive", it never blows up ct-next.mjs', () => {
    // CAREFUL — cmux IS really installed on this machine (verified by
    // construction: a first attempt at this test that simply left
    // `fake-cmux-bin` out of the PATH but kept `process.env.PATH` at the end
    // ENDED UP FINDING AND QUERYING THE REAL CMUX of the development machine
    // — exactly the mistake the brief warns an earlier agent made. Here a
    // DEDICATED stub is used (fixtures/fake-cmux-missing-bin/cmux, which
    // always fails) placed IN FRONT of the real PATH, to simulate absence
    // without ever risking touching the real binary.
    const repoRoot = makeRepoRoot()
    const pathWithMissingCmuxStub = [
      join(fixturesDir, 'fake-git-bin'),
      join(fixturesDir, 'fake-gh-bin'),
      join(fixturesDir, 'fake-cmux-missing-bin'),
      process.env.PATH,
    ].join(':')
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env,
                PATH: pathWithMissingCmuxStub,
        FAKE_GIT_TOPLEVEL: repoRoot,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).toBe(0)
    expect(out).toMatch(/cmux could not be queried/)
    expect(out).not.toMatch(/espera a que termine, o resuelve el token\./)
  })
})

describe('ct-next — staleness also applies to the cap-full + collision-with-a-gap case (finding 2, adversarial attack: not only the "cap already covered" path)', () => {
  it('cap 1, #41 in flight with no evidence, #42 collides: the cap-full message includes the staleness note (not only "sube --cap")', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
    })
    expect(r.out).toMatch(/The cap \(1\) is already taken up by in-flight work: 1 slice\(s\) at status:in-progress/)
    expect(r.out).toMatch(/even if you raised --cap it would not be enough yet/)
    expect(r.out).toMatch(/no worktree, local branch or cmux session was found for #41 ON THIS MACHINE/)
  })
})

describe('ct-next — staleness is not queried at all when it is not needed (the cost only when the blocking reason is a collision)', () => {
  it('none-ready: `cmux list-windows` is not even invoked (verifiable: cmux "absent" via a dedicated stub, and still a clean exit 0)', () => {
    // Same reason as the test above for NEVER relying on leaving
    // `fake-cmux-bin` out of the PATH: that leaves `process.env.PATH` as the
    // fallback, which DOES have the real cmux of this machine.
    const repoRoot = makeRepoRoot()
    const pathWithMissingCmuxStub = [
      join(fixturesDir, 'fake-git-bin'),
      join(fixturesDir, 'fake-gh-bin'),
      join(fixturesDir, 'fake-cmux-missing-bin'),
      process.env.PATH,
    ].join(':')
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: pathWithMissingCmuxStub, FAKE_GIT_TOPLEVEL: repoRoot, FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], []]) },
    })
    expect(r.status).toBe(0)
    const out = (r.stdout || '') + (r.stderr || '')
    expect(out).toMatch(/There is no issue at status:ready/)
    expect(out).not.toMatch(/cmux could not be queried/) // it was never attempted: there was no collision to explain
  })
})

// An adversarial attack discovered in this task's own review (not in the
// original brief): CT_NEXT_FIXTURE promises to touch NOTHING real — but
// without an explicit guard, a --dry-run with a fixture that collides DID
// fire a real read-only call to `cmux list-windows` (never
// `new-workspace`, but real all the same) in order to be able to explain the
// blocking reason. Verified by construction: the two collision tests of
// __tests__/ct-next-dryrun.test.js (by shared token and by
// serialisation) use CT_NEXT_FIXTURE + --dry-run with no PATH carrying
// stubs — before this guard, running this suite on a machine with a real
// cmux installed (like this one) silently invoked that real binary.
// queryAllCmuxWorkspaces now cuts out dead (`if (fx) return null`) before
// touching any subprocess when a fixture is active.
describe('ct-next — CT_NEXT_FIXTURE + collision: the staleness note NEVER fires a real call to cmux (adversarial attack, found in self-review)', () => {
  it('with a fixture, cmux is never invoked (not even read-only) even when the blocking reason is a collision', () => {
    const repoRoot = makeRepoRoot()
    const invokedLog = join(repoRoot, 'cmux-invoked-log')
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'choca', type: 'backend' },
      ],
      mergedIssues: [],
    })
    // On purpose, PATH includes the cmux stub (so that, IF it were invoked, it
    // gets recorded instead of failing with "command not found" and masking the
    // problem) — what is checked is that the invocation log stays EMPTY, not
    // that cmux is absent from the PATH.
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '9', '--dry-run'], {
      CT_NEXT_FIXTURE: fx,
      FAKE_CMUX_INVOKED_LOG_FILE: invokedLog,
    })
    expect(r.code).toBe(0)
    // The collision message is still the same (a fixture never resolves a real
    // repoRoot, so worktree/branch are not really checked either — but that is
    // a separate matter; what this test verifies is cmux).
    expect(r.out).toMatch(/#2/)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/api/)
    expect(existsSync(invokedLog)).toBe(false)
  })
})
