// F11, part B — the warning at DISPATCH time. ct-init warns while it
// bootstraps, but the moment the contradiction bites is another one: /ct-next
// sets `status:in-progress`, creates the worktree, and the agent starts up by
// reading the repo's AGENTS.md. If that AGENTS.md orders it to use ANOTHER
// claim (or to work in ANOTHER worktrees path), the agent obeys that order —
// the one it reads as it hydrates — and the repo's own script runs into an
// active claim on its own issue. That is the deadlock this batch came from.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {hermeticEnv} from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-next.mjs')
const initScript = join(here, '..', 'scripts', 'ct-init.sh')
const fixturesDir = join(here, 'fixtures')

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
  const d = mkdtempSync(join(tmpdir(), 'ct-next-conv-'))
  dirs.push(d)
  return d
}

const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: fakePath, ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const FIXTURE = JSON.stringify({
  issues: [{ n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend' }],
  mergedIssues: [],
})

describe('ct-next — warns when the repo AGENTS.md contradicts the kickoff', () => {
  it('an AGENTS.md ordering another dispatch-check → a warning that names the conflict, without blocking the dispatch', () => {
    const repoRoot = makeRepoRoot()
    writeFileSync(
      join(repoRoot, 'AGENTS.md'),
      '# AGENTS.md\n- **Claim:** `scripts/dispatch-check.sh <issue#>` antes de implementar, `--release` al abrir PR.\n'
    )
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
    })
    // The warning does NOT block: the batch carries on and the slice is launched.
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #42/)
    expect(r.out).toMatch(/\[claim\]/)
    expect(r.out).toContain('AGENTS.md:2')
    expect(r.out).toMatch(/dispatch-check\.sh/)
    // And it says why it matters HERE, in a dispatch.
    expect(r.out).toMatch(/kickoff/i)
  })

  it('an AGENTS.md ordering another worktrees path → a warning citing .worktrees/<n> and feat/<n>', () => {
    const repoRoot = makeRepoRoot()
    writeFileSync(
      join(repoRoot, 'AGENTS.md'),
      '# AGENTS.md\n- Trabajo nuevo: `git worktree add .claude/worktrees/<slug> -b <rama> main`.\n'
    )
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/\[worktrees\]/)
    expect(r.out).toContain('.claude/worktrees')
    expect(r.out).toContain('.worktrees/<n>')
    expect(r.out).toContain('feat/<n>')
  })

  it('an AGENTS.md bootstrapped by ct-init (and nothing else) does NOT fire the warning: the block the loop seeds itself does not count', () => {
    const repoRoot = makeRepoRoot()
    execFileSync('bash', [initScript, repoRoot], { encoding: 'utf8' })
    // Check: the seeded block DOES talk about the ground that gets scanned.
    const agents = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(/\.worktrees\/<n>/)
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
    })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/\[claim\]|\[worktrees\]/)
  })

  it('a repo with neither AGENTS.md nor CLAUDE.md fires nothing (absence is not a signal)', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
    })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/ATTENTION: el repo/)
    expect(r.out).not.toMatch(/documentation could not be read/)
  })

  it('if AGENTS.md cannot be READ (it is not ENOENT), it is said — it does not pass as "no conflict"', () => {
    const repoRoot = makeRepoRoot()
    // A directory named AGENTS.md: readFileSync fails with EISDIR, not
    // ENOENT. The distinction matters — "it does not exist" says nothing,
    // "it could not be read" does.
    mkdirSync(join(repoRoot, 'AGENTS.md'))
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/the repo documentation could not be read/)
    expect(r.out).toMatch(/it has not been looked at/)
  })

  it('--dry-run with a fixture scans NOTHING (a synthetic repoRoot): it does not invent a warning about a repo that does not exist', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1', '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, ...hermeticEnv(), CT_NEXT_FIXTURE: FIXTURE },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).toBe(0)
    expect(out).not.toMatch(/\[claim\]|\[worktrees\]/)
  })
})
