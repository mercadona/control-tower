// One piece of the state machine of scripts/ct-step.mjs. The preamble —and why
// there are nine files and not one— lives in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLAN, GLOBAL_VERIFICATION } from './fixtures/ct-step-harness.js'

let repo
const { ct, commits, runState, taskOk, reviewOk } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// §3.7-A of the handoff: `## 8. Global verification` is run by the PROGRAM,
// after the last committed task. Until this slice nobody ran it: `controls`
// only measures the **Verification:** block of each task.
describe('the Global verification is run by the program (§3.7-A)', () => {
  // The review (#530) and `reconcile` (Phase B, Task 8) slip in between the
  // last task commit and the global verification: the fixture leaves the base unmoved, so it comes out
  // on the first round (up-to-date) and leaves the run exactly where these
  // tests already expected it.
  const twoTasks = () => { taskOk('uno.txt'); taskOk('dos.txt'); reviewOk(); ct('reconcile') }

  it('after the last commit, next announces the global phase with the §8 commands', () => {
    twoTasks()
    const r = ct('next')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/the 2 tasks committed/)
    expect(r.stdout).toMatch(/GLOBAL VERIFICATION/)
    expect(r.stdout).toMatch(/test -f uno\.txt && test -f dos\.txt/)
  })

  it('when green it advances to slice-judge and leaves the log in the run folder', () => {
    twoTasks()
    const r = ct('global')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/global: done/)
    expect(runState().step).toBe('slice-judge')
    expect(readFileSync(runState().lastGlobalLog, 'utf8')).toMatch(/test -f uno\.txt && test -f dos\.txt/)
  })

  it('a red command closes the run ON THE FIRST TRY with 11: everything is committed and there is nobody to hand it back to', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt && test -f dos.txt', 'test -f no-existe.txt'))
    twoTasks()
    const r = ct('global')
    expect(r.status).toBe(11)
    expect(commits()).toBe(5)   // nothing is un-committed: the red is for the human; the fourth is the review (#530), the fifth the loop's telemetry (#501)
  })

  it('a command that could not be MEASURED closes with 12, which is not the same red', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt && test -f dos.txt', 'comando-que-no-existe-en-esta-maquina'))
    twoTasks()
    expect(ct('global').status).toBe(12)
  })

  it('with "N/A — <reason>" it records and advances without running anything', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(GLOBAL_VERIFICATION, '## 8. Global verification\n\nN/A — fixture sin punta a punta.\n'))
    twoTasks()
    const r = ct('global')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/N\/A/)
    expect(runState().step).toBe('slice-judge')
    expect(runState().lastGlobalLog ?? null).toBeNull()
  })

  it('a plan with NO executable §8 exits with 6 before taking a single step', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(GLOBAL_VERIFICATION, '## 8. Global verification\n\nQue todo siga en verde.\n'))
    const r = ct('next')
    expect(r.status).toBe(6)
    expect(r.stderr).toMatch(/does not execute prose/)
  })
})

describe('the telemetry the loop writes after the last task commit travels before §8 runs (#501)', () => {
  const CLEAN_TREE = 'test -z "$(git status --porcelain)"'
  const TELEMETRY = 'docs/superpowers/metrics/issue-7.jsonl'
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  const twoTasks = () => { taskOk('uno.txt'); taskOk('dos.txt'); reviewOk(); ct('reconcile') }
  const cleanTreePlan = () => writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt && test -f dos.txt', CLEAN_TREE))
  const ignoreAsCtInitDoes = (extra = '') => {
    writeFileSync(join(repo, '.gitignore'), `.telemetria/\n/*.json\n.agent/run-*.json\n.agent/run-*/\n${extra}`)
    git('add', '.gitignore')
    git('commit', '-q', '-m', 'the rules ct-init writes')
  }

  beforeEach(() => { ignoreAsCtInitDoes() })

  it('reconcile leaves its telemetry row uncommitted, and global commits it before measuring, so a clean-tree predicate holds', () => {
    cleanTreePlan()
    twoTasks()
    expect(git('status', '--porcelain')).toBe(`M ${TELEMETRY}`)

    const before = commits()
    const r = ct('global')
    expect(r.status).toBe(0)
    expect(commits()).toBe(before + 1)
    expect(git('show', '--stat', '--format=%s', 'HEAD')).toMatch(/^Telemetry of the slice \(#7\)/)
    expect(git('show', '--name-only', '--format=', 'HEAD')).toBe(TELEMETRY)
  })

  it('the telemetry commit is counted in the state, so the slice judge does not die at PRECONDITION', () => {
    cleanTreePlan()
    twoTasks()
    ct('global')
    expect(runState().sliceCommits).toBe(2)   // the review's (#530) and the telemetry's
    const r = ct('next')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/slice/i)
  })

  it('an interrupted global verification resumes without losing or duplicating its telemetry commit', () => {
    const interruptOnce = 'if [ ! -f .agent/run-7/global-interrupted ]; then touch .agent/run-7/global-interrupted; kill -KILL "$PPID"; fi'
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt && test -f dos.txt', `${interruptOnce}\n${CLEAN_TREE}`))
    twoTasks()
    const before = commits()

    const interrupted = ct('global')
    expect(interrupted.signal).toBe('SIGKILL')
    expect(commits()).toBe(before + 1)
    expect(ct('next').status).toBe(0)
    expect(runState().step).toBe('global')
    expect(runState().sliceCommits).toBe(2)   // the review's (#530) and the telemetry's

    expect(ct('global').status).toBe(0)
    expect(commits()).toBe(before + 1)
    expect(runState().sliceCommits).toBe(2)
    expect(runState().step).toBe('slice-judge')
    expect(ct('next').status).toBe(0)
  })

  it('a foreign path staged before global is not taken inside the telemetry commit: nothing is committed and §8 sees the dirty tree', () => {
    cleanTreePlan()
    twoTasks()
    writeFileSync(join(repo, 'colado.txt'), 'colado\n')
    git('add', 'colado.txt')
    const before = commits()
    const r = ct('global')
    expect(r.status).toBe(11)
    expect(commits()).toBe(before)
    expect(r.stderr).toMatch(/colado\.txt/)
    expect(git('diff', '--cached', '--name-only').split('\n')).toContain('colado.txt')
  })

  it('with the telemetry path gitignored nothing is pending: no commit, no warning, and the verification runs unchanged', () => {
    ignoreAsCtInitDoes('docs/\n')
    twoTasks()
    const before = commits()
    const r = ct('global')
    expect(r.status).toBe(0)
    expect(commits()).toBe(before)
    expect(r.stderr).not.toMatch(/telemetry/)
    expect(existsSync(join(repo, TELEMETRY))).toBe(true)
  })
})
