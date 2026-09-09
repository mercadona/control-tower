import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { E2E_REQUIRED_BY_VERDICT } from '../scripts/step-contracts.js'
import { DEFAULT_BUDGETS } from '../scripts/run-machine.js'

const STEP = fileURLToPath(new URL('../scripts/ct-step.mjs', import.meta.url))
const A = 'el server escucha en 9115 por defecto y en el puerto indicado si se pasa'

// A slice worktree with ONE task already committed and the run stopped at
// `e2e`. The committed task matters: ct-step cross-checks the real commits
// against the state.
//
// `commitsTheTask: false` leaves the work STAGED instead of committed: zero
// commits since `baseSha`, which is the count the `commit` step demands
// (`task - 1`, with `task: 1`). It is the only way to really exercise the
// `commit` step with this fixture — see the test "with no runs…", which for
// the whole branch died at PRECONDITION without anyone noticing.
function worktreeAtE2e({ tasksTotal = 1, e2eRuns = [A], commitsTheTask = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-step-e2e-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  git('checkout', '-qb', 'feat/4')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', 'plan.md'), oneTaskPlan())
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 4\n---\n')
  git('add', '-A')
  if (commitsTheTask) git('commit', '-qm', 'tarea 1')
  writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/plan.md', issue: 4, baseSha,
    task: tasksTotal, tasksTotal, e2eRuns, step: 'e2e',
    controlRetries: 0, judgeRetries: 0, correctionRetries: 0, discards: 0, spendUsd: 0,
  }, null, 2))
  return dir
}

// A slice worktree with the last task already committed and the run stopped
// at `reconcile` (Phase B, Task 8). Unlike `worktreeAtE2e`, here a real
// `origin` IS needed: `reconcileVerb` talks to git — `BranchReconciliation.merge`
// does `git fetch origin <branch>` and measures how many commits it brings —
// so with no real remote there is no "base that has not moved" to test. The
// `origin` is a bare repo that starts at the same commit as `HEAD` and is
// never touched again: that IS "the base has not moved", with no need to fake
// anything else.
function worktreeAtReconcile({ tasksTotal = 1 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  const origin = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'ignore' })
  git('remote', 'add', 'origin', origin)
  git('push', '-q', 'origin', 'main')
  git('checkout', '-qb', 'feat/4')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', 'plan.md'), oneTaskPlan())
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 4\n---\n')
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  git('add', '-A')
  git('commit', '-qm', 'tarea 1')
  writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/plan.md', issue: 4, baseSha,
    task: tasksTotal, tasksTotal, e2eRuns: [], step: 'reconcile',
    controlRetries: 0, judgeRetries: 0, correctionRetries: 0, reconcileRetries: 0,
    discards: 0, spendUsd: 0,
  }, null, 2))
  return dir
}

// Fix round 1 (Task 8) — the four escalation messages of `reconcileVerb` ARE
// the mechanism: they are the only thing that makes a conflict get resolved.
// Testing them against a double proves nothing about the verb — a REAL
// conflict against a real `origin` is needed.
//
// `shared.txt` changes in task 1 and, AFTERWARDS, in the base — same line,
// two histories — so that `git merge` leaves a real content conflict and not
// a clean fast-forward. The base advances by pushing from a clone separate
// from the bare `origin`: a bare repo cannot be touched by hand, and cloning
// it is truer to how a real base advances than fabricating the commit by hand
// with `hash-object`.
//
// The `.gitignore` with `.agent/*` (except `SLICE.md`) reproduces what
// `ct-init` seeds in a real repo, and it is no longer what makes this fixture
// work: the final branch review showed that `filesTouchedOutside`'s question
// was badly put —`git status --porcelain` ALSO lists what git staged cleanly
// during the merge, so `RESOLVED` was unreachable— and since the fix the
// question is `git diff --name-only`, which sees neither what is cleanly
// staged nor what is untracked.
function worktreeInConflict({ reconcileRetries = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-conflicto-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, '.gitignore'), '.agent/*\n!.agent/SLICE.md\n')
  writeFileSync(join(dir, 'shared.txt'), 'línea original\n')
  git('add', '-A'); git('commit', '-qm', 'base')
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  const origin = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-conflicto-origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'ignore' })
  git('remote', 'add', 'origin', origin)
  git('push', '-q', 'origin', 'main')
  git('checkout', '-qb', 'feat/4')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', 'plan.md'), oneTaskPlan())
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 4\n---\n')
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  writeFileSync(join(dir, 'shared.txt'), 'línea de la tarea\n')
  git('add', '-A')
  git('commit', '-qm', 'tarea 1')
  // The base advances AFTER `feat/4` branched off, touching the SAME line of
  // `shared.txt`: that is what turns "the base moved" into a real conflict
  // and not a clean fast-forward.
  const clone = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-conflicto-clone-'))
  execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore' })
  const gClone = (...a) => execFileSync('git', a, { cwd: clone, stdio: 'ignore' })
  gClone('config', 'user.email', 'b@b'); gClone('config', 'user.name', 'b')
  writeFileSync(join(clone, 'shared.txt'), 'línea de la base avanzada\n')
  gClone('add', '-A'); gClone('commit', '-qm', 'la base avanza')
  gClone('push', '-q', 'origin', 'main')
  writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/plan.md', issue: 4, baseSha,
    task: 1, tasksTotal: 1, e2eRuns: [], step: 'reconcile',
    controlRetries: 0, judgeRetries: 0, correctionRetries: 0, reconcileRetries,
    discards: 0, spendUsd: 0,
  }, null, 2))
  return dir
}

// UNMERGEABLE_TREE: git does not even START the merge — no conflicting
// content is needed, it is enough for the base to touch a file the slice
// itself left modified WITHOUT committing: `git merge` refuses ("your local
// changes ... would be overwritten by merge") and never gets to create
// `MERGE_HEAD`. It is the slice's own dirty tree, not a content conflict —
// that is why it does not need the `.gitignore` of the helper above:
// `merge()` never calls `git status --porcelain`.
function worktreeWithDirtyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-sucio-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  const origin = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-sucio-origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'ignore' })
  git('remote', 'add', 'origin', origin)
  git('push', '-q', 'origin', 'main')
  git('checkout', '-qb', 'feat/4')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', 'plan.md'), oneTaskPlan())
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 4\n---\n')
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  git('add', '-A')
  git('commit', '-qm', 'tarea 1')
  // The base advances by touching `f.txt`, the SAME file that is going to be
  // dirtied locally without committing.
  const clone = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-sucio-clone-'))
  execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore' })
  const gClone = (...a) => execFileSync('git', a, { cwd: clone, stdio: 'ignore' })
  gClone('config', 'user.email', 'b@b'); gClone('config', 'user.name', 'b')
  writeFileSync(join(clone, 'f.txt'), 'avance en la base\n')
  gClone('add', '-A'); gClone('commit', '-qm', 'la base avanza')
  gClone('push', '-q', 'origin', 'main')
  writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/plan.md', issue: 4, baseSha,
    task: 1, tasksTotal: 1, e2eRuns: [], step: 'reconcile',
    controlRetries: 0, judgeRetries: 0, correctionRetries: 0, reconcileRetries: 0,
    discards: 0, spendUsd: 0,
  }, null, 2))
  // The UNCOMMITTED change in `f.txt`, AFTER writing the run: it is what
  // makes git refuse even to start the merge.
  writeFileSync(join(dir, 'f.txt'), 'cambio local sin commitear\n')
  return dir
}

// A slice worktree with NO run-<issue>.json yet: it is the only path that
// goes through `newRun` (see the `else` of the state load in ct-step.mjs),
// and therefore the only one that can prove that the reader of
// `.agent/SLICE.md` really feeds `e2eRuns` — the helper above seeds the run
// by hand and never goes through there.
function newWorktree({ e2eYaml = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-step-nuevo-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feat/4')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', 'plan.md'), oneTaskPlan())
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), `---\nissue: 4\n${e2eYaml}---\n`)
  git('add', '-A'); git('commit', '-qm', 'setup')
  return dir
}

// The minimal plan plan-contract.js accepts and plan-tasks.js knows how to
// split, with ONE task and its **Verification:** block. It is the
// `minimalPlanFor` of __tests__/dispatch-check-dryrun.test.js:73, copied (not
// imported: this repo's tests do not import each other) and pinned to issue 4.
const FENCE = '```'
const oneTaskPlan = () => [
  '# #4 — fixture slice',
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
  // The original `minimalPlanFor` of dispatch-check-dryrun.test.js writes
  // `**Files:** work.txt` without backticks, and that plan never goes through
  // `plan-tasks.js#splitFiles` (dispatch-check.mjs uses plan-contract.js,
  // with a different tolerance). ct-step DOES go through `extractTasks` on
  // every invocation — including `next`, before looking at the verb — and
  // `splitFiles` only recognises paths between backticks: without them, EVERY
  // call dies with PLAN_NOT_EXECUTABLE (exit 6) before the test gets to
  // exercise anything of `e2e`. It is the brief's warning about "fix the
  // harness before implementing" made flesh.
  '**Files:** `work.txt` (create).',
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

const step = (dir, args) => spawnSync(process.execPath, [STEP, ...args, '--plan', 'docs/superpowers/plans/plan.md', '--issue', '4'], { cwd: dir, encoding: 'utf8' })
const report = (dir, obj) => { const p = join(dir, 'informe.json'); writeFileSync(p, JSON.stringify(obj)); return 'informe.json' }

const GREEN = { runs: [{ run: A, verdict: 'verde', brought_up: 'cargo run --example serve', evidence: [{ command: 'curl -sS localhost:9115/metrics', output: '# HELP x' }] }] }
const RED = { runs: [{ run: A, verdict: 'rojo', brought_up: 'cargo run --example serve', expected: '200', actual: '404', repro: 'curl -i localhost:9115/metrics', refuted_by: 'otro proceso en el puerto' }] }

describe('ct-step e2e', () => {
  it('green: exit 0, run delivered and the markdown written and COMMITTED', () => {
    const dir = worktreeAtE2e()
    try {
      const r = step(dir, ['e2e', report(dir, GREEN)])
      expect(r.status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.closed).toBe('delivered')
      const md = join(dir, 'docs', 'superpowers', 'e2e', '4.md')
      expect(existsSync(md)).toBe(true)
      expect(readFileSync(md, 'utf8')).toContain(A)
      // Finding 3 of the Task 8 review: DELIVERED commits the report, it does
      // not just stage it — if it stayed only staged, the commits the session
      // pushes would not carry it and the evidence would never reach the pull
      // request. An empty `git diff --cached` proves it is no longer in the
      // index (it was committed); `git show HEAD --name-only` proves it IS in
      // the last commit.
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' })
      expect(staged).not.toContain('docs/superpowers/e2e/4.md')
      const inTheCommit = execFileSync('git', ['show', '--name-only', '--pretty=', 'HEAD'], { cwd: dir, encoding: 'utf8' })
      expect(inTheCommit).toContain('docs/superpowers/e2e/4.md')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // Each run's verdict is PERSISTED (final branch review): without it, gate 8
  // of `dispatch-check --release` cannot tell a green slice apart from one
  // whose runs were all "no-verificado" — and three texts promised that
  // --release "says so". The shape is the minimum that sustains that warning:
  // run -> verdict, plus `reason` where there is one.
  it("the run persists each run's verdict, with its reason when it is no-verificado", () => {
    const dir = worktreeAtE2e()
    try {
      const UNVERIFIED = { runs: [{ run: A, verdict: 'no-verificado', reason: 'la sección de AGENTS.md está sin rellenar', unblock: 'rellenar "Levantar" y "Listo cuando"' }] }
      const r = step(dir, ['e2e', report(dir, UNVERIFIED)])
      expect(r.status).toBe(0) // the no-verificado DELIVERS
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.closed).toBe('delivered')
      expect(run.e2eResults).toEqual([{ run: A, verdict: 'no-verificado', reason: 'la sección de AGENTS.md está sin rellenar' }])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('when green, the persisted verdict carries no `reason` (there is no reason to give)', () => {
    const dir = worktreeAtE2e()
    try {
      expect(step(dir, ['e2e', report(dir, GREEN)]).status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.e2eResults).toEqual([{ run: A, verdict: 'verde' }])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('red: exit 7, run blocked-e2e, NOT delivered, and the report STAGED but NOT committed', () => {
    const dir = worktreeAtE2e()
    try {
      const r = step(dir, ['e2e', report(dir, RED)])
      expect(r.status).toBe(7)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.closed).not.toBe('delivered')
      // Red does NOT close the run, so it does not commit: committing here
      // would push `hechos` above `esperados` (= tasksTotal at the e2e step)
      // and would bring down the NEXT attempt with PRECONDITION before anyone
      // got to fix the failure. The report stays staged as proof that it is
      // waiting for whoever fixes it.
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' })
      expect(staged).toContain('docs/superpowers/e2e/4.md')
      const inTheCommit = execFileSync('git', ['show', '--name-only', '--pretty=', 'HEAD'], { cwd: dir, encoding: 'utf8' })
      expect(inTheCommit).not.toContain('docs/superpowers/e2e/4.md')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('outside its step: exit 9 and it says which one is due', () => {
    const dir = worktreeAtE2e()
    try {
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      // `task: 2, tasksTotal: 2` and not `task: 1` (which would be this
      // fixture's real `task` with `tasksTotal: 1`): there is ONE commit
      // since `baseSha` (worktreeAtE2e commits once only, "tarea 1"), so
      // outside the `e2e` step the invariant demands `task - 1 === 1`.
      // `task: 2` without raising `tasksTotal` would make the count add up
      // but would describe "task 2 of 1", a state
      // `run-machine.js#afterCommit` never produces: `task` does not advance
      // beyond `tasksTotal` (on committing the last one it enters E2E or
      // closes DELIVERED). With `tasksTotal: 2` this is really "working on
      // the second of two tasks" — the real state the guard protects. With
      // `task: 1` (the original value) the PRECONDITION guard itself fires
      // before reaching `requireStep` — correct for THAT check, but it is not
      // what this test wants to exercise.
      writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({ ...run, step: 'implement', task: 2, tasksTotal: 2 }))
      const r = step(dir, ['e2e', report(dir, GREEN)])
      expect(r.status).toBe(9)
      expect(r.stderr).toMatch(/implement/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('unreadable JSON is a discard, not a usage error', () => {
    const dir = worktreeAtE2e()
    try {
      writeFileSync(join(dir, 'roto.json'), '{no es json')
      const r = step(dir, ['e2e', 'roto.json'])
      expect(r.status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.discards).toBe(1)
      expect(run.step).toBe('e2e')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('`next` at the e2e step says what is expected and cites the WHOLE schema (including the per-verdict fields)', () => {
    const dir = worktreeAtE2e()
    try {
      const r = step(dir, ['next'])
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/e2e/)
      expect(r.stdout).toContain(A)
      // The AGENTS.md section is named, not alluded to (§3.3 of the design).
      expect(r.stdout).toContain('## Cómo se atraviesa este repo (e2e)')
      expect(r.stdout).toMatch(/E2E_SCHEMA/)
      // The conditional contract, which is the one `readE2eReport` really
      // demands: announcing only "run and verdict" cost one DISCARDED round
      // per slice. It is checked against the SAME table that validates, not
      // against a list typed in here — two copies diverge.
      for (const [veredicto, campos] of Object.entries(E2E_REQUIRED_BY_VERDICT)) {
        expect(r.stdout, veredicto).toContain(`${veredicto}: ${campos.join(', ')}`)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // This test PASSED for the wrong reason, and the final branch review
  // reproduced it: with the task already committed, `ct-step commit` died at
  // PRECONDITION (exit 8, "el state y git no cuentan lo mismo") because
  // outside the `e2e` step the invariant demands `commits === task - 1` and
  // here there was one too many. `run-4.json` was never rewritten, so
  // `after.step` was the 'commit' the test itself had just written and the
  // assertion was trivially true about a file nobody had touched. The exit
  // code was not checked, and the second half of the title ("and `next` does
  // not ask for it") was not exercised at all.
  //
  // With the work staged and uncommitted, the count adds up (`task: 1`, zero
  // commits since base), the commit really happens, and the transition being
  // tested is the one that matters: last task committed + empty `e2eRuns`
  // does NOT go through `e2e`.
  //
  // What this test used to assert —that right there the run closed at
  // DELIVERED— stopped being true on converging with the GLOBAL/SLICE_JUDGE
  // phase (§3.7), which got in between the last commit and the delivery. THIS
  // feature's property does not change and it is the one still being nailed
  // down: with no runs, the `e2e` step appears at no point in the queue,
  // neither in the state nor in what `next` asks for. The closure at
  // DELIVERED is proved by the global phase's tests, which is whose it is now.
  it('with no runs, the run never enters e2e (and `next` does not ask for it)', () => {
    const dir = worktreeAtE2e({ e2eRuns: [], commitsTheTask: false })
    try {
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      // Slice 12: `commit` demands the seal the verdict leaves on being
      // accepted, and this fixture seeds the state by hand — so it seeds the
      // seal too. It is the index's tree AS OF NOW, which is what that commit
      // is going to carry: the same thing `verdictVerb` seals after staging
      // the verdict.
      const sealedTree = execFileSync('git', ['write-tree'], { cwd: dir, encoding: 'utf8' }).trim()
      writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({ ...run, step: 'commit', sealedTree }))
      const r = step(dir, ['commit'])
      expect(r.status).toBe(0)
      const after = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(after.step).not.toBe('e2e')
      // Phase B (Task 8): the last task committed opens RECONCILE, not GLOBAL
      // directly — the branch has to be up to date with its base before the
      // end-to-end measures it.
      expect(after.step).toBe('reconcile')
      // And `next` does not ask for it either: it asks to reconcile the base,
      // not for a journey.
      const n = step(dir, ['next'])
      expect(n.status).toBe(0)
      expect(n.stdout).toMatch(/RECONCILE THE BRANCH/)
      expect(n.stdout).not.toMatch(/e2e/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // THE ADDITION THE BRIEF DOES NOT COVER: `newRun` receives `e2eRuns`, but
  // nothing in the brief proves that ct-step really READS them from anywhere.
  // The six tests above seed `run-<issue>.json` by hand (helper
  // `worktreeAtE2e`), so none of them goes through the `else` branch that
  // creates the run — the only path that calls `newRun`. These two do.
  it('a new run reads the runs from .agent/SLICE.md (the only path that calls newRun)', () => {
    const dir = newWorktree({ e2eYaml: 'e2e:\n  - uno\n  - dos\n' })
    try {
      const r = step(dir, ['next'])
      expect(r.status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.e2eRuns).toEqual(['uno', 'dos'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('with no `e2e` field in SLICE.md, the new run is born with e2eRuns: [] (not undefined)', () => {
    const dir = newWorktree()
    try {
      const r = step(dir, ['next'])
      expect(r.status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.e2eRuns).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

// Phase B, Task 8 — the `reconcile` verb, idempotent through MERGE_HEAD.
describe('ct-step reconcile', () => {
  it('with the base unmoved, it advances to global without creating any commit', () => {
    const dir = worktreeAtReconcile()
    try {
      const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
      const r = step(dir, ['reconcile'])
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/up-to-date/)
      const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
      expect(after).toBe(before) // no reconcile round commits anything here
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.step).toBe('global')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // Ruling 2 of the brief: RECONCILE is a step of the SLICE, not of a task —
  // if `SLICE_STEPS` did not know that, the state and git would not add up
  // on loading the run and ANY verb (including this `global`) would die at
  // PRECONDITION before even getting to look at the step. This test also
  // serves as a net for that regression (see Step 5 of the brief).
  it('`global` outside its step (the run is at reconcile) exits with 9 naming "reconcile"', () => {
    const dir = worktreeAtReconcile()
    try {
      const r = step(dir, ['global'])
      expect(r.status).toBe(9)
      expect(r.stderr).toMatch(/reconcile/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // Fix round 1 — the four escalation messages are the mechanism: they are
  // the only thing that makes a conflict get resolved. Each test fires the
  // REAL path against a real `origin` (never a double) and asserts against
  // that path's DISTINCTIVE PHRASE, never a substring the four share (all
  // four say "reconcile", the first three say "shared.txt", etc.).
  describe('the four escalation messages', () => {
    it('CONFLICTING with budget left: it names the conflicting files and asks for ct-reconciler to be dispatched', () => {
      const dir = worktreeInConflict({ reconcileRetries: 0 })
      try {
        const r = step(dir, ['reconcile'])
        expect(r.stdout).toMatch(/conflicting — 1 file\(s\) in conflict/)
        expect(r.stdout).toContain('- shared.txt')
        expect(r.stdout).toMatch(/DISPATCH ct-reconciler/)
        // Budget available (reconcileRetries: 0 < 2): FAILED stays OPEN — it
        // retries the same step, it does not close the run.
        expect(r.status).toBe(0)
        const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
        expect(run.step).toBe('reconcile')
        expect(run.reconcileRetries).toBe(1)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })

    // Task 9 — the package `ct-reconciler` consumes: the list of conflicting
    // files and the log of the commits the base brought in, WITHOUT which the
    // reconciler stares at two texts that clash with no idea what the base
    // was after (the Task 9 brief is explicit: "without this it resolves
    // blind").
    it('CONFLICTING with budget left: it writes the reconciliation package with the conflicting files and the base log', () => {
      const dir = worktreeInConflict({ reconcileRetries: 0 })
      try {
        const r = step(dir, ['reconcile'])
        expect(r.status).toBe(0)
        const packagePath = join(dir, '.agent', 'run-4', 'reconcile-package-1.md')
        expect(existsSync(packagePath)).toBe(true)
        const content = readFileSync(packagePath, 'utf8')
        expect(content).toContain('shared.txt')
        expect(content).toMatch(/la base avanza/)
        expect(r.stdout).toContain(packagePath)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })

    it('CONFLICTING with the budget spent: it stops naming ct-reconciler and hands the turn to the slice agent', () => {
      const dir = worktreeInConflict({ reconcileRetries: DEFAULT_BUDGETS.reconcileRetries })
      try {
        const r = step(dir, ['reconcile'])
        expect(r.stdout).toMatch(/conflicting — 1 file\(s\) in conflict/)
        expect(r.stdout).not.toMatch(/DISPATCH ct-reconciler/)
        expect(r.stdout).toMatch(/ct-reconciler used up its \d+ round\(s\)/)
        expect(r.stdout).toMatch(/it is now up to the slice's own agent, which does have Bash/)
        // Budget spent: FAILED closes the run via EXIT.RECONCILE_BLOCKED.
        expect(r.status).toBe(13)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })

    it('UNMERGEABLE_TREE: it goes to the slice agent and NEVER mentions ct-reconciler (it is not a content conflict)', () => {
      const dir = worktreeWithDirtyTree()
      try {
        const r = step(dir, ['reconcile'])
        expect(r.stdout).toMatch(/unmergeable-tree/)
        expect(r.stdout).toMatch(/DISPATCH THE SLICE'S AGENT/)
        // The assertion that matters: the ABSENCE, not just what is said.
        expect(r.stdout + r.stderr).not.toMatch(/ct-reconciler/)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })

    // Fix round 1: it was first thought that `markers-left` was unreachable
    // here, because the FIRST call leaves
    // `docs/superpowers/metrics/*.jsonl` uncommitted (the very telemetry of
    // `medir('reconcile', ...)`) and `filesTouchedOutside` looks at that
    // before the markers. That finding was real (see the report, fix round 1)
    // but the cause was that `BranchReconciliation` did not tell the loop's
    // own footprint apart from a resolution that touched too much. Fix round
    // 2 teaches it that through the constructor (`isMachineryPath`, wired in
    // `reconcileVerb` from `LOOP_ARTIFACT_PATTERNS`/`matchesPattern` of
    // `scope.js`): the metrics file no longer counts as "touched outside", so
    // this second call DOES get to look at the markers — and it finds them,
    // because nobody resolved anything. `markers-left` is once again the
    // correct and reachable reason.
    it('ROUND_DISCARDED: it names which of the three DiscardReason it was (markers-left)', () => {
      const dir = worktreeInConflict({ reconcileRetries: 0 })
      try {
        // First round: CONFLICTING (covered above). Its own telemetry leaves
        // the metrics file uncommitted in the tree — that no longer matters,
        // thanks to `isMachineryPath`.
        step(dir, ['reconcile'])
        // Second round: nobody touched anything — git's markers are still in
        // place in `shared.txt` — so `conclude()` has to discard through
        // MARKERS_LEFT.
        const r = step(dir, ['reconcile'])
        expect(r.stdout).toMatch(/round-discarded \(markers-left\)/)
        expect(r.stdout).toMatch(/conflict markers/)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })

    // Task 9 — on the attempt that has a discard reason, the NEW package
    // carries that reason: without it, the re-dispatched reconciler repeats
    // the same attempt that already failed, blind to why it failed.
    it('ROUND_DISCARDED: the new package (attempt 2) carries the discard reason', () => {
      const dir = worktreeInConflict({ reconcileRetries: 0 })
      try {
        step(dir, ['reconcile']) // round 1: CONFLICTING, writes reconcile-package-1.md
        const r = step(dir, ['reconcile']) // round 2: nobody resolved -> MARKERS_LEFT
        expect(r.status).toBe(0)
        const first = join(dir, '.agent', 'run-4', 'reconcile-package-1.md')
        const second = join(dir, '.agent', 'run-4', 'reconcile-package-2.md')
        expect(existsSync(first)).toBe(true)
        expect(existsSync(second)).toBe(true)
        const content = readFileSync(second, 'utf8')
        expect(content).toContain('shared.txt')
        expect(content).toMatch(/markers-left/)
        expect(content).toMatch(/conflict markers/)
        expect(r.stdout).toContain(second)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })

    // #92 — the cost of the reconciliation role. The row measures the package
    // `ct-reconciler` READ in this round (the last one written), not the one
    // the round writes afterwards for the next attempt: the other way round,
    // the column would state the cost of a call that has not been made yet.
    it('ROUND_DISCARDED: the row records the reconciler agent and the package it read, not the one written afterwards', () => {
      const dir = worktreeInConflict({ reconcileRetries: 0 })
      try {
        step(dir, ['reconcile'])
        const firstPackageBytes = statSync(join(dir, '.agent', 'run-4', 'reconcile-package-1.md')).size
        step(dir, ['reconcile'])
        const rows = readFileSync(join(dir, 'docs', 'superpowers', 'metrics', 'issue-4.jsonl'), 'utf8')
          .trim().split('\n').map((l) => JSON.parse(l)).filter((f) => f.step === 'reconcile')
        expect(rows.at(-1).package_bytes).toBe(firstPackageBytes)
        expect(rows.at(-1).agent_bytes).toBeGreaterThan(0)
        expect(rows.at(-1).skill_bytes).toBe(0)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })
  })
})

// The reconcile LADDER, end to end and against real git. The final branch
// review measured that it did not reach the bottom: since the discard did not
// spend a retry and the merge stays alive between rounds, every round from
// the second onwards discarded, `reconcileRetries` was never consumed and
// BLOCKED_RECONCILE (exit 13) was unreachable — the run died at MAX_DISCARDS
// with an exit 3 that speaks of "no trustworthy verdict" about a half-done
// merge. This test walks the three real rounds and demands the ending.
describe('the reconcile ladder reaches all the way down', () => {
  it('three rounds without resolving end at BLOCKED_RECONCILE, with exit 13 and the slice agent taking the turn', () => {
    const dir = worktreeInConflict({ reconcileRetries: 0 })
    try {
      const firstRound = step(dir, ['reconcile'])
      expect(firstRound.status).toBe(0)
      expect(firstRound.stdout).toMatch(/DISPATCH ct-reconciler/)

      const secondRound = step(dir, ['reconcile'])
      expect(secondRound.status).toBe(0)
      expect(secondRound.stdout).toMatch(/round-discarded \(markers-left\)/)
      const afterTheSecondRound = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(afterTheSecondRound.reconcileRetries).toBe(DEFAULT_BUDGETS.reconcileRetries)

      const thirdRound = step(dir, ['reconcile'])
      expect(thirdRound.stdout).toMatch(/round-discarded \(markers-left\)/)
      expect(thirdRound.stdout).toMatch(/ct-reconciler used up its \d+ round\(s\)/)
      expect(thirdRound.stdout).toMatch(/it is now up to the slice's own agent, which does have Bash/)
      expect(thirdRound.stdout).not.toMatch(/REDESPACHA ct-reconciler/)
      expect(thirdRound.status).toBe(13)
      expect(thirdRound.stdout).toMatch(/run blocked-reconcile/)
      const atTheEnd = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(atTheEnd.discards).toBeLessThan(6)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // A run that was OPEN before `reconcileRetries` existed does not carry the
  // field. `undefined < 2` is `false`, so without normalising it when loading
  // the state the budget reads as spent and the first conflict closes the run
  // without having dispatched the reconciler even once — and precisely to the
  // oldest runs, which are the ones whose base has moved the most.
  it('a run that was open before the field existed dispatches the reconciler instead of blocking on the first go', () => {
    const dir = worktreeInConflict({ reconcileRetries: 0 })
    try {
      const state = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      delete state.reconcileRetries
      writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify(state, null, 2))

      const r = step(dir, ['reconcile'])

      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/DISPATCH ct-reconciler/)
      expect(r.stdout).not.toMatch(/used up its/)
      const after = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(after.reconcileRetries).toBe(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

// The design's declared limit: the slice agent has Bash, so it can stage and
// commit the merge without calling this verb again. When it does that badly,
// the only thing left to look at is the commit already made — and the post-hoc
// validation is what stops the branch from going on to `global` with the
// markers inside the commit.
describe('ct-step reconcile validates post hoc the merge someone else committed', () => {
  function worktreeWithMergeCommittedByHand(resolution) {
    const dir = worktreeInConflict({ reconcileRetries: 0 })
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
    git('fetch', '-q', 'origin', 'main')
    const merge = spawnSync('git', ['merge', '--no-edit', 'origin/main'], { cwd: dir, encoding: 'utf8' })
    if (merge.status === 0) throw new Error('el montaje esperaba un conflicto real y no lo obtuvo')
    writeFileSync(join(dir, 'shared.txt'), resolution)
    git('add', 'shared.txt')
    git('commit', '-qm', 'merge resuelta a mano, sin pasar por ct-step reconcile')
    return dir
  }

  it('a merge commit with markers inside is not announced as up-to-date: it names the file and sends for the slice agent', () => {
    const dir = worktreeWithMergeCommittedByHand('<<<<<<< HEAD\nlínea de la tarea\n=======\nlínea de la base avanzada\n>>>>>>> origin/main\n')
    try {
      const r = step(dir, ['reconcile'])
      expect(r.stdout).toMatch(/markers-committed/)
      expect(r.stdout).not.toMatch(/up-to-date/)
      expect(r.stdout).toContain('- shared.txt')
      expect(r.stdout).toMatch(/DISPATCH THE SLICE'S AGENT/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('a properly resolved merge commit is still up-to-date and advances to global', () => {
    const dir = worktreeWithMergeCommittedByHand('línea de la tarea\nlínea de la base avanzada\n')
    try {
      const r = step(dir, ['reconcile'])
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/up-to-date/)
      expect(r.stdout).not.toMatch(/markers-committed/)
      const after = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(after.step).toBe('global')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
