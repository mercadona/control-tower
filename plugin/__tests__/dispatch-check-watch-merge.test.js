// THE LAUNCH of the merge watcher, from the success path of `--release`
// (scripts/dispatch-check.mjs).
//
// What this file pins down is the seam, which is the only thing left to test
// here: that the watcher is launched WHEN the slice is really delivered, with
// the right arguments, and that no failure of its own can knock down the
// release. The watching logic is already tested apart (ct-watch-merge.test.js).
//
// The real watcher is replaced by a recorder via CT_WATCH_MERGE_BIN: without it
// every test that releases a slice would set a REAL process polling GitHub every
// minute for 48 hours. It is the same double, and for the same reason, as
// CT_WATCH_GO_BIN in ct-next-watch-go.test.js.
import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { goEnv } from './fixtures/go-gate.js'

const SCRIPT = fileURLToPath(new URL('../scripts/dispatch-check.mjs', import.meta.url))
const FAKE_GH = fileURLToPath(new URL('./fixtures/fake-gh-bin', import.meta.url))
const RECORDER = fileURLToPath(new URL('./fixtures/fake-watch-merge-bin/recorder.mjs', import.meta.url))

// Minimal plan that satisfies the contract of plan-contract.js. Copied from
// e2e-release-correspondence.test.js: the tests of this repository do not
// import each other.
const FENCE = '```'
const PLAN = [
  '# #9 — fixture slice',
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

const BODY = ['## Acceptance criteria (EARS, 1:1 con tests)', '- un criterio', '', '## Gates', '- **`plan`** — …', ''].join('\n')

// Slice worktree with the task committed, the plan and the run DELIVERED, on a
// REAL git repository: `localSliceArtifacts` asks for the main checkout with
// `git worktree list --porcelain`, and the watcher needs that path. A git stub
// would be no use for proving that the path passed to it is the real one.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-watch-merge-launch-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feat/9')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', '2026-08-12-issue-9-work.md'), PLAN)
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  git('add', '-A'); git('commit', '-qm', 'work')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 9\nbase: main\n---\n')
  writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/2026-08-12-issue-9-work.md',
    issue: 9, baseSha: 'HEAD~1', task: 1, tasksTotal: 1, step: 'e2e',
    e2eRuns: [], closed: 'delivered',
  }))
  return dir
}

// The child goes DETACHED and with `unref`, so dispatch-check can finish before
// the recorder writes. The file is polled instead of read once: otherwise the
// test would be flaky by construction. It is the same wait, and for the same
// reason, as `waitForArgv` in ct-next-watch-go.test.js.
async function waitForArgv(path, ms = 5000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (existsSync(path)) return readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    await new Promise((r) => setTimeout(r, 25))
  }
  return null
}

function release(dir, { args = [], env = {} } = {}) {
  const watchLog = join(dir, 'watch-merge.log')
  const r = spawnSync(process.execPath, [SCRIPT, '9', '--repo', 'o/r', '--release', ...args], {
    cwd: dir, encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${FAKE_GH}:${process.env.PATH}`,
      FAKE_GH_VIEW_BODY: BODY,
      FAKE_GH_VIEW_LABELS: JSON.stringify(['status:in-progress', 'gate:plan']),
      // The `plan` gate with its nonce (F38): without a registered commitment
      // and a comment satisfying it, `--release` refuses with exit 9 long before
      // reaching the watcher's launch. It is not this file's subject, so the
      // shared fixture is used instead of recreating the record.
      ...goEnv({ repo: 'o/r', issue: 9 }),
      CT_WATCH_MERGE_BIN: RECORDER,
      FAKE_WATCH_MERGE_LOG: watchLog,
      ...env,
    },
  })
  return { ...r, watchLog }
}

describe('--release launches the merge watcher', () => {
  it("a successful release launches it with the issue, the repo and the coordinator's cwd", async () => {
    const dir = repo()
    try {
      const r = release(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
      const launches = await waitForArgv(r.watchLog)
      expect(launches).toHaveLength(1)
      const argv = launches[0]
      expect(argv).toContain('--issue')
      expect(argv[argv.indexOf('--issue') + 1]).toBe('9')
      expect(argv[argv.indexOf('--repo') + 1]).toBe('o/r')
      // The coordinator's cwd is the MAIN checkout, not the cwd it is invoked
      // from. In this fixture they coincide (there is no real `.worktrees/9`),
      // but what is being checked is that it comes out of `git worktree list`
      // and not out of `process.cwd()` blindly: the path has to resolve to the
      // same place git says, /var symlinks included.
      const cwd = argv[argv.indexOf('--coordinator-cwd') + 1]
      expect(cwd).toBe(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' }).split('\n')[0].slice('worktree '.length).trim())
      // The log goes OUTSIDE the repository, alongside the telemetry and the
      // `-OK` watcher's own, so that no `git add` of the slice puts it in the PR.
      const log = argv[argv.indexOf('--log') + 1]
      expect(log).toMatch(/control-tower[/\\]log[/\\]watch-merge-9\.log$/)
      expect(log.startsWith(dir)).toBe(false)
      // And it gets announced: a process that runs when you are not watching and
      // whose pid and trace are never stated is undebuggable.
      expect(r.stdout + r.stderr).toMatch(/vigilante del merge/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('with --no-watch-merge it launches nothing, and the release is still a success', async () => {
    const dir = repo()
    try {
      const r = release(dir, { args: ['--no-watch-merge'] })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
      expect(await waitForArgv(r.watchLog, 600)).toBe(null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('with --no-watch-merge it says the harvest is left unannounced, so silence is not read as delivered', async () => {
    const dir = repo()
    try {
      const r = release(dir, { args: ['--no-watch-merge'] })

      expect(r.stdout + r.stderr).toMatch(/--no-watch-merge/)
      expect(r.stdout).not.toMatch(/vigilante del merge de #9 lanzado/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('with --dry-run it launches nothing: nothing has moved, so there is no merge to wait for', async () => {
    const dir = repo()
    try {
      const r = release(dir, { args: ['--dry-run'] })
      expect(r.status).toBe(0)
      expect(r.stdout).not.toMatch(/vigilante del merge/)
      expect(await waitForArgv(r.watchLog, 600)).toBe(null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('a release that does NOT release (gate unmet) launches nothing', async () => {
    // A run without `closed` is a slice ct-step never closed: exit 7. A watcher
    // launched here would poll for 48 h for a PR nobody is going to open.
    const dir = repo()
    try {
      writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify({
        plan: 'docs/superpowers/plans/2026-08-12-issue-9-work.md',
        issue: 9, baseSha: 'HEAD~1', task: 1, tasksTotal: 1, step: 'e2e', e2eRuns: [],
      }))
      const r = release(dir)
      expect(r.status).toBe(7)
      expect(r.stdout + r.stderr).not.toMatch(/vigilante del merge/)
      expect(await waitForArgv(r.watchLog, 600)).toBe(null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('a release held back by the go gate (exit 9) launches nothing either', async () => {
    // The newest door on the ladder (F38): without an `-OK <nonce>` on the issue
    // the release refuses. It goes here and not only in the F38 tests because
    // what this file pins down is "the watcher is born IF AND ONLY IF the slice
    // was really delivered", and that property has to hold against EVERY door,
    // not against the ones that existed the day it was written. A watcher
    // launched here would poll for 48 h for a PR nobody has opened.
    const dir = repo()
    try {
      const r = release(dir, { env: goEnv({ repo: 'o/r', issue: 9, given: false }) })
      expect(r.status).toBe(9)
      expect(r.stdout + r.stderr).not.toMatch(/vigilante del merge/)
      expect(await waitForArgv(r.watchLog, 600)).toBe(null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('if the watcher cannot be launched, the release is STILL a success', async () => {
    // The thermometer is not part of the engine: the work is already delivered
    // and the issue is already in `in-review`. Not being able to watch the merge
    // means going back to the old way —telling people by hand—, not losing the
    // delivery. And it gets said.
    const dir = repo()
    try {
      const r = release(dir, { env: { CT_WATCH_MERGE_BIN: join(dir, 'no-existe', 'ni-de-broma.mjs') } })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
      expect(r.stderr).toMatch(/warning:/)
      expect(r.stderr).toMatch(/a mano/)
      expect(r.stdout).not.toMatch(/vigilante del merge de #9 lanzado \(pid/)
      expect(await waitForArgv(r.watchLog, 600)).toBe(null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
