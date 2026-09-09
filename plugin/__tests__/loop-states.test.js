// F13 — STATES THAT WERE MISSING FROM THE LOOP.
//
// Four holes, all of them verified against the UNFIXED code before writing a
// single line of fix (the output observed in each case is noted down in the
// corresponding test):
//
//   H1  `status:in-review` was TERMINAL. `--release` moved in-progress →
//       in-review and there was no transition back to `ready` other than the
//       protocol-failure reverts. A PR rejected at the gate took its slice out
//       of the loop for ever, and every one of its dependents with it.
//   H2  the lock was released before the risk was over. `--release` runs WHEN
//       THE PR IS OPENED, and until F13 in-review held no tokens: in the
//       window [PR opened, PR merged] the next slice of the same area went out
//       and branched off a base that did not yet contain that work.
//   H3  a dead claim that filled the cap without sharing tokens was invisible
//       ("sube --cap, o espera a que termine alguno" — said to an agent that no
//       longer exists).
//   H4  a dep whose issue was closed as "not planned" is never satisfied, and
//       the message said "falta mergear #N" exactly as if it were still under
//       way.
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectCollisions, holdingStatusOf, CLAIM_HOLDING_STATUSES } from '../scripts/claim.js'
import { collectInFlight, collectTokenHolders, planDispatch } from '../scripts/dispatch.js'
import { closedNotCompleted, buildDispatchInput } from '../scripts/gh-issue-map.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const here = dirname(fileURLToPath(import.meta.url))
const ctNext = join(here, '..', 'scripts', 'ct-next.mjs')
const dispatchCheck = join(here, '..', 'scripts', 'dispatch-check.mjs')
const fixturesDir = join(here, 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

const QUIET = ['ignore', 'pipe', 'pipe']

function runNext(args, env = {}) {
  const r = spawnSync('node', [ctNext, ...args], { encoding: 'utf8', stdio: QUIET, env: { ...process.env, PATH: fakePath, ...env } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
function runCheck(args, env = {}) {
  const r = spawnSync('node', [dispatchCheck, ...args], { encoding: 'utf8', stdio: QUIET, env: { ...process.env, PATH: fakePath, ...env } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) rmSyncBestEffort(d) })
function tmpRepo() {
  const d = mkdtempSync(join(tmpdir(), 'ct-f13-'))
  dirs.push(d)
  return d
}

const rawIssue = ({ number, order, status = 'status:ready', touches = [], body = '' }) => ({
  number,
  title: `#${number} slice`,
  labels: [{ name: status }, ...touches.map((t) => ({ name: `touches:${t}` }))],
  body: `<!-- ct-order:${order} -->\n${body}`,
})

// ============================================================================
// H2 — in-review holds TOKENS, but not CAP.
// ============================================================================
describe('F13/H2 — the lock window reaches the merge, not the PR', () => {
  it('detectCollisions sees a status:in-review as a holder of the token (it used to return [])', () => {
    // Against the unfixed code, this VERY call returned `[]`: detectCollisions
    // did `if (!labels.includes('status:in-progress')) continue`. Run and
    // observed before touching anything.
    const c = detectCollisions(['touches:db'], [{ n: 5, labels: ['status:in-review', 'touches:db'] }])
    expect(c).toEqual([{ n: 5, tokens: ['touches:db'], status: 'status:in-review' }])
  })

  it('holdingStatusOf tells apart the two states that hold, and only those', () => {
    expect(holdingStatusOf(['status:in-progress'])).toBe('status:in-progress')
    expect(holdingStatusOf(['status:in-review'])).toBe('status:in-review')
    expect(holdingStatusOf(['status:ready'])).toBeNull()
    expect(holdingStatusOf(['status:backlog'])).toBeNull()
    expect(holdingStatusOf([])).toBeNull()
    // An issue with both at once (a half-done label edit) is read by the MOST
    // retentive state, just as resolveStatus does: never by the order in which
    // GitHub happens to return the array.
    expect(holdingStatusOf(['status:in-review', 'status:in-progress'])).toBe('status:in-progress')
    expect(CLAIM_HOLDING_STATUSES).toEqual(['status:in-progress', 'status:in-review'])
  })

  it('planDispatch does NOT dispatch a ready that shares a token with an in-review (it used to)', () => {
    const issues = [
      { n: 5, order: 1, status: 'in-review', deps: [], touches: ['db'] },
      { n: 6, order: 2, status: 'ready', deps: [], touches: ['db'] },
    ]
    // Observed against the unfixed code: selected === [6].
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.selected).toEqual([])
    expect(plan.blockReason.reason).toBe('collision')
    expect(plan.blockReason.withIssue).toBe(5)
    expect(plan.blockReason.withIssueStatus).toBe('in-review')
  })

  it('but an in-review does NOT consume cap: with cap 1 and an in-review holding other tokens, the ready DOES go out', () => {
    // It is the half that keeps this fix from being "block more": the cap
    // measures LIVE AGENTS and in an in-review there are none. If in-review
    // counted towards the cap, a three-day PR would freeze the whole repo.
    const issues = [
      { n: 5, order: 1, status: 'in-review', deps: [], touches: ['db'] },
      { n: 6, order: 2, status: 'ready', deps: [], touches: ['ui'] },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.selected.map((i) => i.n)).toEqual([6])
    expect(plan.inFlight).toEqual([])              // cap: solo in-progress
    expect(plan.remainingCap).toBe(1)
    expect(collectTokenHolders(issues).map((i) => i.n)).toEqual([5]) // tokens: también in-review
    expect(collectInFlight(issues)).toEqual([])
  })

  it('the migration/ci/pbxproj serialisation also reaches an in-review', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-review', deps: [], touches: ['migration'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ci'] },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 5 })
    expect(plan.selected).toEqual([])
    expect(plan.blockReason).toMatchObject({ reason: 'collision', kind: 'serializing', withIssue: 1, withIssueStatus: 'in-review' })
  })

  it('ct-next explains the collision against an in-review WITHOUT telling you to wait and WITHOUT a stale-claim note', () => {
    // The staleness note (worktree/branch/cmux session) must NOT fire here: in
    // an already delivered slice, having no open session is the normal thing.
    // Demanding one would turn every PR under review into a false alarm.
    const fx = JSON.stringify({
      issues: [
        { n: 5, order: 1, status: 'in-review', deps: [], touches: ['db'], name: 'modelo' },
        { n: 6, order: 2, status: 'ready', deps: [], touches: ['db'], name: 'api' },
      ],
      mergedIssues: [],
    })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#6 is ready with merged deps, but it collides with delivered unmerged work/)
    expect(r.out).toMatch(/status:in-review/)
    expect(r.out).toMatch(/waiting achieves nothing/i)
    expect(r.out).not.toMatch(/wait for it to finish/)
    expect(r.out).not.toMatch(/no worktree, local branch or cmux session was found/)
    // And it gives the three real ways out, including the one nobody sees
    // coming: an already merged PR whose issue nobody closed because the PR was
    // missing its "Closes #N".
    expect(r.out).toMatch(/Closes #5/)
    expect(r.out).toMatch(/--reopen/)
  })

  it('--dry-run lists separately those holding tokens without filling the cap (otherwise "En vuelo: ninguno" + a collision contradict each other)', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 5, order: 1, status: 'in-review', deps: [], touches: ['db'], name: 'modelo' },
        { n: 6, order: 2, status: 'ready', deps: [], touches: ['db'], name: 'api' },
      ],
      mergedIssues: [],
    })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.out).toMatch(/In flight: none/)
    // F16/H1: the line's label now carries the COUNT, because the enumeration
    // became bounded (thirty slices under review turned this line into a wall
    // that pushed the reason for the block off the screen). The count is never
    // trimmed; the names are.
    expect(r.out).toMatch(/Unmerged, holding tokens \(1, status:in-review, they do NOT take cap\): #5 \[touches:db\]/)
  })

  it('dispatch-check aborts the claim against an in-review, and says so naming its status', () => {
    const fixture = JSON.stringify({
      candLabels: ['touches:db'],
      openIssues: [{ n: 5, labels: ['status:in-review', 'touches:db'] }],
      readback: [],
    })
    // Against the unfixed code this came out 0 ("claimed #7 → in-progress"):
    // the in-review did not count as a collision.
    const r = runCheck(['7', '--repo', 'o/r', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/COLLISION: #7 clashes with #5\[touches:db status:in-review\]/)
    expect(r.out).toMatch(/they hold their tokens until the merge/)
  })
})

// ============================================================================
// H1 — --reopen: the missing edge out of in-review.
// ============================================================================
describe('F13/H1 — a rejected PR can come back into the loop', () => {
  // F15/H1: the destination of --reopen is NO LONGER `ready`, it is
  // `in-progress`. `ready` holds no tokens, so F13's edge back reopened the
  // very window F13 came to close. See the F15/H1 block further down for why.
  it('--reopen on a status:in-review sends it back to in-progress', () => {
    // Against the unfixed code, `--reopen` was an UNKNOWN flag: it was ignored
    // in silence and the script carried on to the claim path (observed: it tried
    // `gh issue view` and exited 3).
    const fixture = JSON.stringify({ candLabels: ['status:in-review'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/reopened #9 → in-progress/)
    expect(r.out).toMatch(/UNMERGED/)
  })

  // F15/H1: `in-progress` goes from "a state you cannot reopen from" to "the
  // state --reopen would already have left you in", so the message moves but the
  // property does not: NO label is touched.
  it('--reopen on a status:in-progress REFUSES without touching any label (it is already where it would go)', () => {
    const fixture = JSON.stringify({ candLabels: ['status:in-progress', 'touches:db'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/is already at status:in-progress/)
    expect(r.out).toMatch(/No label has been touched/)
    // And it names the real way out for the other path, which is no longer --reopen.
    expect(r.out).toMatch(/--requeue/)
  })

  it('--reopen from backlog (with no status: label at all) REFUSES without touching anything', () => {
    const fixture = JSON.stringify({ candLabels: ['touches:db'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/only returns to the workbench a slice at status:in-review/)
    expect(r.out).toMatch(/No label has been touched/)
    expect(r.out).toMatch(/TWO states at once/)
  })

  it('--reopen on something ALREADY ready says so as a no-op, not as a user error', () => {
    const fixture = JSON.stringify({ candLabels: ['status:ready'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/is already at status:ready — there is nothing to reopen/)
  })

  it('--reopen does NOT reopen an issue with TWO status labels, even if one of them is in-review', () => {
    // A finding from attacking F13's own implementation: the first version
    // checked `labels.includes('status:in-review')`, so an issue with
    // in-progress AND in-review at once passed, and the add ready / remove
    // in-review left it at [in-progress, ready] — the very ambiguous state its
    // own error message warns about. Observed: exit 0 and
    // "reopened #9 → ready".
    const fixture = JSON.stringify({ candLabels: ['status:in-review', 'status:in-progress', 'touches:db'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/TWO or more status labels at once/)
    expect(r.out).toMatch(/status:in-progress/)
    expect(r.out).toMatch(/status:in-review/)
    expect(r.out).not.toMatch(/reopened/)
  })

  it('--release and --reopen together → a usage error, without guessing which one the writer meant', () => {
    const r = runCheck(['9', '--repo', 'o/r', '--release', '--reopen', '--dry-run'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/mutually exclusive/)
  })

  it('with a worktree and a branch from the previous round: it says what is left and gives BOTH paths with their commands', () => {
    // Reopening moves the label, not the disk — and /ct-next REFUSES to
    // dispatch a slice whose worktree or branch already exist. Without saying so
    // here, reopening "works" and the next /ct-next fails with a message that
    // does not mention the reopening.
    const repoRoot = tmpRepo()
    mkdirSync(join(repoRoot, '.worktrees', '9'), { recursive: true })
    const fixture = JSON.stringify({ candLabels: ['status:in-review'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_STALE_BRANCH_EXISTS: '9',
    })
    expect(r.code).toBe(0)
    expect(r.out).toContain(join(repoRoot, '.worktrees', '9'))
    expect(r.out).toMatch(/feat\/9/)
    expect(r.out).toMatch(/NOTHING of that has been touched: reopening moves the label, not the disk/)
    expect(r.out).toMatch(/\(a\) FIX ON TOP/)
    expect(r.out).toMatch(/Do NOT invoke \/ct-next/)
    expect(r.out).toMatch(/\(b\) START FROM SCRATCH/)
    expect(r.out).toContain(`git -C ${repoRoot} worktree remove`)
    expect(r.out).toContain(`git -C ${repoRoot} branch -D feat/9`)
    // F15/H1: path (b) no longer ends in "and /ct-next dispatches it": after
    // deleting, it has to be put back in the queue explicitly, because --reopen
    // left it claimed.
    expect(r.out).toMatch(/--requeue/)
  })

  it('unable to consult git, it does NOT assert that nothing is left', () => {
    const fixture = JSON.stringify({ candLabels: ['status:in-review'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_WORKTREE_LIST_FAIL: '1',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/What is left of the previous round/)
    expect(r.out).toMatch(/do NOT read that as "there is nothing"/)
  })

  it('the usage line announces --reopen (otherwise nobody reading the error finds out it exists)', () => {
    const r = runCheck(['9', '--dry-run'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/\[--release \| --reopen \| --requeue \| --check-plan \| --collect\]/)
  })
})

// ============================================================================
// H3 — a dead claim that fills the cap.
// ============================================================================
describe('F13/H3 — the stale claim is cross-checked too when the only thing blocking is the cap', () => {
  const issue41Stuck = rawIssue({ number: 41, order: 1, status: 'status:in-progress', touches: ['api'] })
  const issue42Ready = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['ui'] })

  it('an in-progress with no worktree/branch/session that only fills the cap → ATTENTION, not a bare "espera a que termine alguno"', () => {
    // Observed against the unfixed code, with this very scenario:
    //   "El cap (1) ya está copado por trabajo en vuelo: 1 slice(s) en
    //    status:in-progress — sube --cap, o espera a que termine alguno."
    // and not one word of staleness: D3's detection was only consulted from the
    // 'collision' case, and here the tokens (api / ui) do NOT clash.
    const repoRoot = tmpRepo()
    const r = runNext(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/The cap \(1\) is already taken up/)
    expect(r.out).toMatch(/ATTENTION, the cap may be taken up by a dead claim/)
    expect(r.out).toMatch(/no worktree, local branch or cmux session was found for #41 ON THIS MACHINE/)
    // And it still does not assert the abandonment as a fact: the evidence is local.
    expect(r.out).toMatch(/neither do we assert that it is abandoned/)
  })

  it('with local evidence of life (a worktree present) nothing is said about a dead claim — and cmux is NOT EVEN consulted', () => {
    // The second half is a finding from attacking the implementation itself:
    // widening the check to the "cap full" case (the MOST COMMON outcome of a
    // /ct-next with something running) made EVERY routine invocation pay for the
    // cmux query —list-windows + one workspace list per window, up to a 5s
    // timeout— only to say nothing. Now the two cheap signals (worktree, branch)
    // are looked at first and cmux is only consulted if both fail. The semantics
    // do not change: ONE signal is enough.
    const repoRoot = tmpRepo()
    mkdirSync(join(repoRoot, '.worktrees', '41'), { recursive: true })
    const cmuxLog = join(repoRoot, 'cmux-invocations.log')
    const r = runNext(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
      FAKE_CMUX_INVOKED_LOG_FILE: cmuxLog,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/raise --cap, or wait for one of them to finish\./)
    expect(r.out).not.toMatch(/dead claim/)
    expect(existsSync(cmuxLog)).toBe(false) // not a single invocation of cmux
  })

  it('an in-review holding tokens is NOT accused of a dead claim for having no session', () => {
    // A new category created by H2: if the staleness cross-check were applied to
    // the in-review holders, EVERY PR under review would be a false alarm.
    const issue50Review = rawIssue({ number: 50, order: 1, status: 'status:in-review', touches: ['api'] })
    const issue51Ready = rawIssue({ number: 51, order: 2, status: 'status:ready', touches: ['api'] })
    const repoRoot = tmpRepo()
    const r = runNext(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue50Review, issue51Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/collides with delivered unmerged work/)
    expect(r.out).not.toMatch(/no worktree, local branch or cmux session was found/)
    expect(r.out).not.toMatch(/dead claim/)
  })
})

// ============================================================================
// H4 — a dep that is never going to be satisfied has to be able to say so.
// ============================================================================
describe('F13/H4 — "closed" is not "merged", and now it shows', () => {
  it('closedNotCompleted picks up the closures that do NOT satisfy a dep, and only those', () => {
    expect(closedNotCompleted([
      { number: 1, stateReason: 'COMPLETED' },
      { number: 2, stateReason: 'NOT_PLANNED' },
      { number: 3, stateReason: 'REOPENED' },
      { number: 4, stateReason: null },
      { number: 5 },
    ])).toEqual({ 2: 'NOT_PLANNED', 3: 'REOPENED', 4: null, 5: null })
  })

  it('buildDispatchInput exposes depStates alongside mergedIssues (same source, so that one cannot leak while the other does not)', () => {
    const closed = [{ number: 7, body: '<!-- ct-order:1 -->', milestone: { number: 1 }, stateReason: 'NOT_PLANNED' }]
    const open = [{ number: 8, body: '<!-- ct-order:2 -->\n## Dependencias\nmerge-after `#1`\n', milestone: { number: 1 }, labels: [{ name: 'status:ready' }], title: 'x' }]
    const di = buildDispatchInput(open, closed)
    expect(di.mergedIssues).toEqual([])
    expect(di.depStates).toEqual({ 7: 'NOT_PLANNED' })
    expect(di.issues[0].deps).toEqual([7]) // order #1 does resolve to issue #7
  })

  it('ct-next names the "not planned" closure and says that dep is NEVER going to be satisfied', () => {
    // Against the unfixed code, this very scenario produced:
    //   "...#8 (falta mergear #7) — espera a que se mergeen esas dependencias"
    // with #7 CLOSED. An instruction to wait for something that is never going
    // to happen.
    const repoRoot = tmpRepo()
    const open = [rawIssue({ number: 8, order: 2, status: 'status:ready', body: '## Dependencias\nmerge-after `#1`\n' })]
    const closed = [{ number: 7, title: '#7 descartado', labels: [], body: '<!-- ct-order:1 -->\n', state_reason: 'not_planned' }]
    // FAKE_GH_COUNTER_FILE is essential: without it, the gh stub ALWAYS serves
    // element 0 of the sequence, so the call for CLOSED issues would return the
    // list of open ones and this test would prove nothing.
    const r = runNext(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-counter'),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([open, closed]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#7, which is closed as "not planned"/)
    expect(r.out).toMatch(/IS NEVER GOING TO SATISFY ITSELF/)
    // The two real remedies, because "wait" is not one of them.
    expect(r.out).toMatch(/remove the "merge-after/)
    expect(r.out).toMatch(/reopen #7 and close it as completed/)
    // And the closing tag line cannot contradict the detail. Observed in a real
    // run against josemerca/ct-loop-sandbox with the first version of this
    // message: "...ESTA NO SE VA A SATISFACER NUNCA... — espera a que se
    // mergeen esas dependencias". The last sentence is the one that sticks.
    expect(r.out).toMatch(/waiting is NOT going to unblock anything here/)
    expect(r.out).not.toMatch(/wait for those dependencies to be merged/)
  })

  it('a dep that is simply unmerged (an open issue) still says "falta mergear", with no new noise', () => {
    // Negative control: the new message must NOT appear when waiting IS the
    // right advice.
    const repoRoot = tmpRepo()
    const open = [
      rawIssue({ number: 7, order: 1, status: 'status:backlog' }),
      rawIssue({ number: 8, order: 2, status: 'status:ready', body: '## Dependencias\nmerge-after `#1`\n' }),
    ]
    const r = runNext(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-counter'),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([open, []]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#8 \(still to merge: #7\)/)
    expect(r.out).not.toMatch(/IS NEVER GOING TO SATISFY ITSELF/)
    // A control on the tag line in the other direction: here waiting IS the
    // right advice, and it has to keep being given.
    expect(r.out).toMatch(/wait for those dependencies to be merged/)
    expect(r.out).not.toMatch(/waiting is NOT going to unblock anything/)
  })

  it('"nothing is ready" no longer keeps quiet about the slices stopped under review', () => {
    // At the end of an epic, "everything delivered, nothing merged" is the
    // NORMAL state — and the message painted it as if nothing had been started.
    const fx = JSON.stringify({
      issues: [
        { n: 5, order: 1, status: 'in-review', deps: [], touches: ['db'], name: 'a' },
        { n: 6, order: 2, status: 'in-review', deps: [], touches: ['ui'], name: 'b' },
      ],
      mergedIssues: [],
    })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    // F16/H1: "Sí hay N" became "Hay N" when it was unified with the other two
    // voices of the same message (backlog and in-progress) — the "sí" was a
    // contrast with the short sentence that no longer exists. The content this
    // test defends (the count and the concrete numbers) does not change.
    expect(r.out).toMatch(/There are 2 at status:in-review \(#5, #6\)/)
    expect(r.out).toMatch(/delivered but NOT MERGED/)
    expect(r.out).toMatch(/--reopen/)
    expect(r.out).not.toMatch(/no hay nada que despachar todavía/)
  })

  // F16/H1 changed the sentence of this branch: "no hay nada que despachar
  // TODAVÍA" was an instruction to WAIT, and with everything in status:backlog
  // there is nothing to wait for — promoting backlog → ready is the loop's human
  // gate, not an event that arrives on its own. What this test defended (that
  // the in-review voice does NOT appear when there is no in-review at all) is
  // kept intact; what is withdrawn is the wrong claim.
  it('with no in-review at all, the in-review voice does not sneak in — and the backlog stops reading as "wait"', () => {
    const fx = JSON.stringify({ issues: [{ n: 5, order: 1, status: 'backlog', deps: [], touches: [], name: 'a' }], mergedIssues: [] })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/There is no issue at status:ready\./)
    expect(r.out).not.toMatch(/in-review/)
    expect(r.out).toMatch(/1 at status:backlog \(#5\)/)
    expect(r.out).not.toMatch(/no hay nada que despachar todavía/)
  })
})
