// One piece of the state machine of scripts/ct-step.mjs. The preamble —and why
// there are nine files and not one— lives in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLAN, GLOBAL_VERIFICATION } from './fixtures/ct-step-harness.js'

let repo
const { ct, commits, runState, taskOk } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// §3.7-A of the handoff: `## 8. Global verification` is run by the PROGRAM,
// after the last committed task. Until this slice nobody ran it: `controls`
// only measures the **Verification:** block of each task.
describe('the Global verification is run by the program (§3.7-A)', () => {
  // `reconcile` (Phase B, Task 8) slips in between the last commit and the
  // global verification: the fixture leaves the base unmoved, so it comes out
  // on the first round (up-to-date) and leaves the run exactly where these
  // tests already expected it.
  const dosTareas = () => { taskOk('uno.txt'); taskOk('dos.txt'); ct('reconcile') }

  it('after the last commit, next announces the global phase with the §8 commands', () => {
    dosTareas()
    const r = ct('next')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/las 2 tareas comiteadas/)
    expect(r.stdout).toMatch(/GLOBAL VERIFICATION/)
    expect(r.stdout).toMatch(/test -f uno\.txt && test -f dos\.txt/)
  })

  it('when green it advances to slice-judge and leaves the log in the run folder', () => {
    dosTareas()
    const r = ct('global')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/global: done/)
    expect(runState().step).toBe('slice-judge')
    expect(readFileSync(runState().lastGlobalLog, 'utf8')).toMatch(/test -f uno\.txt && test -f dos\.txt/)
  })

  it('a red command closes the run ON THE FIRST TRY with 11: everything is committed and there is nobody to hand it back to', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt && test -f dos.txt', 'test -f no-existe.txt'))
    dosTareas()
    const r = ct('global')
    expect(r.status).toBe(11)
    expect(commits()).toBe(3)   // nothing is un-committed: the red is for the human
  })

  it('a command that could not be MEASURED closes with 12, which is not the same red', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt && test -f dos.txt', 'comando-que-no-existe-en-esta-maquina'))
    dosTareas()
    expect(ct('global').status).toBe(12)
  })

  it('with "N/A — <reason>" it records and advances without running anything', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(GLOBAL_VERIFICATION, '## 8. Global verification\n\nN/A — fixture sin punta a punta.\n'))
    dosTareas()
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
    expect(r.stderr).toMatch(/no ejecuta prosa/)
  })
})
