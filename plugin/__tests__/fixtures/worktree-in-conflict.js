// A slice worktree whose merge with the base leaves a REAL content conflict.
// It lives here, and not inside a single test file, because two suites drive
// it now: `__tests__/e2e-ct-step.test.js`, which measures what `reconcileVerb`
// does, and `__tests__/ct-step-prose-unchanged-real-process.test.js`, which
// measures the bytes it prints against the branch base. `reconcile` PERFORMS
// the merge, so a repository serves exactly one `ct-step` root: the two
// comparisons each build their own with this same factory.
//
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
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function worktreeInConflict({ reconcileRetries = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-conflict-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, '.gitignore'), '.agent/*\n!.agent/SLICE.md\n')
  writeFileSync(join(dir, 'shared.txt'), 'original line\n')
  git('add', '-A'); git('commit', '-qm', 'base')
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  const origin = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-conflict-origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'ignore' })
  git('remote', 'add', 'origin', origin)
  git('push', '-q', 'origin', 'main')
  git('checkout', '-qb', 'feat/4')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', 'plan.md'), oneTaskPlan())
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 4\n---\n')
  writeFileSync(join(dir, 'work.txt'), 'work\n')
  writeFileSync(join(dir, 'shared.txt'), 'line from the task\n')
  git('add', '-A')
  git('commit', '-qm', 'task 1')
  // The base advances AFTER `feat/4` branched off, touching the SAME line of
  // `shared.txt`: that is what turns "the base moved" into a real conflict
  // and not a clean fast-forward.
  const clone = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-conflict-clone-'))
  execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore' })
  const gClone = (...a) => execFileSync('git', a, { cwd: clone, stdio: 'ignore' })
  gClone('config', 'user.email', 'b@b'); gClone('config', 'user.name', 'b')
  writeFileSync(join(clone, 'shared.txt'), 'line from the advanced base\n')
  gClone('add', '-A'); gClone('commit', '-qm', 'the base advances')
  gClone('push', '-q', 'origin', 'main')
  writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/plan.md', issue: 4, baseSha,
    task: 1, tasksTotal: 1, e2eRuns: [], step: 'reconcile',
    controlRetries: 0, judgeRetries: 0, correctionRetries: 0, reconcileRetries,
    discards: 0, spendUsd: 0,
  }, null, 2))
  return dir
}

// The minimal plan plan-contract.js accepts and plan-tasks.js knows how to
// split, with ONE task and its **Verification:** block. It is the
// `minimalPlanFor` of __tests__/dispatch-check-dryrun.test.js:73, copied (not
// imported: this repo's tests do not import each other) and pinned to issue 4.
// It travelled here with `worktreeInConflict`, which cannot build a repository
// without it, and `__tests__/e2e-ct-step.test.js` imports it back for the four
// sibling worktrees it keeps.
const FENCE = '```'
export const oneTaskPlan = () => [
  '# #4 — fixture slice',
  '',
  '> **Task-scoped subagents execute this plan. They arrive with no context.**',
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
  'work',
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
