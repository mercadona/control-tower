import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { goEnv } from './fixtures/go-gate.js'

const SCRIPT = fileURLToPath(new URL('../scripts/dispatch-check.mjs', import.meta.url))
const FAKE_GH = fileURLToPath(new URL('./fixtures/fake-gh-bin', import.meta.url))
const A = 'el server escucha en 9115 por defecto y en el puerto indicado si se pasa'

const issueBody = (journeys) => [
  '## Acceptance criteria (EARS, 1:1 con tests)',
  '- un criterio',
  '',
  '## Gates',
  '- **`plan`** — …',
  ...(journeys.length ? ['', '## E2E', ...journeys.map((r) => `- ${r}`)] : []),
  '',
].join('\n')

// FENCE/minimalPlanFor (Task 8, plan-contract.js): --release demands a
// prescriptive plan committed on the branch that meets the whole contract.
const FENCE = '```'
const oneTaskPlan = (issue = 9) => [
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

// A slice worktree with the task committed, the plan and the run DELIVERED.
// Copied from mkReleaseDryRunRepo (__tests__/dispatch-check-dryrun.test.js:117):
// the tests of this repo do not import one another.
// `closed` does NOT carry a destructuring default: `repo({ closed: undefined })`
// (the fixture of the run NOT delivered) must produce a run-9.json WITHOUT the
// "closed" key — but a destructuring default fires all the same when the value
// passed is an explicit `undefined`, not only when the key is missing. With
// `'closed' in opts` we tell "I was not given closed" (→ 'delivered', the happy
// case) from "I was given closed: undefined on purpose" (→ the key is omitted
// from the JSON, which is what a run ct-step never closed looks like).
function repo(opts = {}) {
  const { e2eRuns = [A], contaminaEstado = false, e2eResults } = opts
  const closed = 'closed' in opts ? opts.closed : 'delivered'
  const dir = mkdtempSync(join(tmpdir(), 'ct-rel-corr-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feat/9')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', '2026-08-12-issue-9-work.md'), oneTaskPlan())
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  if (contaminaEstado) {
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\nrole: coordinadora\n---\n')
  }
  git('add', '-A'); git('commit', '-qm', 'work')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 9\nbase: main\n---\n')
  const run = {
    plan: 'docs/superpowers/plans/2026-08-12-issue-9-work.md',
    issue: 9, baseSha: 'HEAD~1', task: 1, tasksTotal: 1, step: 'e2e',
    e2eRuns,
  }
  if (closed !== undefined) run.closed = closed
  // `e2eResults` is only written if the test asks for it: a run from a version
  // older than the final branch review does not carry it, and that absence has
  // to be testable too.
  if (e2eResults !== undefined) run.e2eResults = e2eResults
  writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify(run, null, 2))
  return dir
}

// `go` (F38): the `plan` gate of door 9 is CLOSED by default in this file,
// because what is being tested here is the e2e correspondence and not the go.
// The go's tests are in f38-the-plan-gate-go.test.js.
function release(dir, { body, viewFail = false, labels, go = true } = {}) {
  const log = join(dir, 'gh-argv.log')
  const r = spawnSync(process.execPath, [SCRIPT, '9', '--repo', 'o/r', '--release'], {
    cwd: dir, encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${FAKE_GH}:${process.env.PATH}`,
      FAKE_GH_ARGV_LOG_FILE: log,
      ...(body !== undefined ? { FAKE_GH_VIEW_BODY: body } : {}),
      ...(viewFail ? { FAKE_GH_VIEW_FAIL: '1' } : {}),
      FAKE_GH_VIEW_LABELS: JSON.stringify(labels || ['status:in-progress', 'gate:plan', 'gate:e2e']),
      ...(go ? goEnv({ repo: 'o/r', issue: 9 }) : {}),
    },
  })
  return { ...r, argv: existsSync(log) ? readFileSync(log, 'utf8') : '' }
}

describe('--release: correspondence between the run and the issue', () => {
  it('a delivered run that covers the issue runs → it releases', () => {
    const dir = repo()
    try {
      const r = release(dir, { body: issueBody([A]) })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('an issue with runs and a run that does NOT declare them → exit 8, without touching labels', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      const r = release(dir, { body: issueBody([A]) })
      expect(r.status).toBe(8)
      expect(r.stderr).toContain(A)
      // The assertion that really matters: NOTHING was mutated on GitHub.
      expect(r.argv).not.toMatch(/issue edit/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('an unreadable issue body → exit 8, and it does NOT assert that there are no runs', () => {
    const dir = repo()
    try {
      const r = release(dir, { viewFail: true })
      expect(r.status).toBe(8)
      expect(r.stderr).toMatch(/could not be/i)
      expect(r.stderr).not.toMatch(/no declara journeys/)
      expect(r.argv).not.toMatch(/issue edit/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('an issue with no ## E2E section → it releases without looking at the run', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      expect(release(dir, { body: issueBody([]) }).status).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('a gate:e2e label with no section → it releases, with a warning on stderr', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      const r = release(dir, { body: issueBody([]) })
      expect(r.status).toBe(0)
      expect(r.stderr).toMatch(/warning:/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // The two above share the SAME labels fixture (it always carries
  // "gate:e2e"), so "no label AND no section" was never exercised on its own —
  // the genuinely silent case: nothing to verify and nothing to warn about.
  it('with no gate:e2e label and no section → it releases, with no warning', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      const r = release(dir, { body: issueBody([]), labels: ['status:in-progress', 'gate:plan'] })
      expect(r.status).toBe(0)
      expect(r.stderr).not.toMatch(/warning:/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('the order rules: a branch that introduces .agent/STATE.md exits 5, not 8', () => {
    const dir = repo({ e2eRuns: [], contaminaEstado: true })
    try {
      expect(release(dir, { body: issueBody([A]) }).status).toBe(5)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // ==========================================================================
  // THE *UNVERIFIED* ONES, SAID OUT LOUD (final branch review, Important 3).
  //
  // Until this round the run persisted only the NAMES of the runs, so this door
  // could not tell a green slice from one whose runs were all "no-verificado" —
  // and three texts (run-machine.js#afterE2e, gates.js#GATES.e2e.issue and
  // §3.7 of the design) promised that --release "says so". It is the state that
  // releases a slice WITHOUT having verified it: for it to be silent at the
  // door is the opposite of "a limit that is said is operable".
  // ==========================================================================
  it('a "no-verificado" run in the delivered run → it releases, and the warning names it with its reason', () => {
    const dir = repo({ e2eResults: [{ run: A, verdict: 'no-verificado', reason: 'el docker de staging no arranca en esta máquina' }] })
    try {
      const r = release(dir, { body: issueBody([A]) })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
      expect(r.stderr).toMatch(/warning:/)
      expect(r.stderr).toContain(A)
      expect(r.stderr).toContain('el docker de staging no arranca en esta máquina')
      expect(r.stderr).toMatch(/could NOT be checked/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('every run green → it releases with no unverified warning at all', () => {
    const dir = repo({ e2eResults: [{ run: A, verdict: 'verde' }] })
    try {
      const r = release(dir, { body: issueBody([A]) })
      expect(r.status).toBe(0)
      expect(r.stderr).not.toMatch(/could NOT be checked/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('a run with no `e2eResults` (an older version) → it releases and invents no verdict', () => {
    const dir = repo()
    try {
      const r = release(dir, { body: issueBody([A]) })
      expect(r.status).toBe(0)
      expect(r.stderr).not.toMatch(/could NOT be checked/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('a run NOT delivered → it exits 7, the door that already existed, not 8', () => {
    const dir = repo({ closed: undefined })
    try {
      expect(release(dir, { body: issueBody([A]) }).status).toBe(7)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
