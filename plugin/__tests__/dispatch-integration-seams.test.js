// Integration of D1 (fix/dispatch-graph-hardening) + D2 (fix/dispatch-silent-failures):
// each branch on its own tests its own half — D1 the per-epic scope of the
// dependency graph (order collision, deps by section, warnings), D2 the exit
// code contract of the claim loop (skip/infra/stuck, exit 0/1/2/3). Neither of
// the two original suites exercises BOTH halves AT ONCE in a single real run of
// ct-next.mjs — exactly where an integration can break at the seams without any
// inherited test noticing. These tests build those seam scenarios explicitly:
//
//   Seam A — an epic is EXCLUDED by an order collision (D1) AND the only
//   candidate left from another epic loses the live claim race (D2) → exit 3
//   (never 0 nor 1): the exclusion must not, on its own, change the "retry
//   later" code.
//   Seam B — an epic with an order collision is the ONLY source of work in the
//   repo → once it is excluded there is NOTHING left to select → exit 0 (not
//   exit 1: the collision never aborts the batch, it only narrows it).
//   Seam C — an issue with a "merge-after" outside "## Dependencias" (D1, it
//   warns but dispatches) ends up orphaned in status:in-progress when claiming
//   (D2, 'stuck') → exit 1 with the warning AND the ATTENTION present at the same
//   time, with neither contradicting the other.
//   Seam D — in a single batch: an epic excluded by collision (D1), an issue
//   with malformed deps in ANOTHER epic (D1, it blocks ONLY that issue) and an
//   issue with stray deps in a THIRD epic (D1, it warns but dispatches) that
//   does get claimed and launched successfully (D2, exit 0) — it verifies that
//   the warnings about broken data neither interfere with each other nor with
//   the batch's real progress.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
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
  const d = mkdtempSync(join(tmpdir(), 'ct-next-seam-'))
  dirs.push(d)
  return d
}

// A "raw" issue exactly as `gh api repos/<o>/<r>/issues` returns it — with a
// milestone (D1, epicKeyOf) and a body (the ct-order marker + the optional
// Dependencias/Descripción sections, D1 dep-by-section).
function rawIssue({ number, milestone, order, status = 'status:ready', touches = [], body = '' }) {
  const labels = [{ name: status }, ...touches.map((t) => ({ name: `touches:${t}` }))]
  const fullBody = `${body}\n<!-- ct-order:${order} -->\n`
  return {
    number,
    title: `#${number} slice ${number}`,
    labels,
    body: fullBody,
    milestone: milestone == null ? null : { number: milestone },
  }
}

describe('Seam A — an epic excluded by an order collision (D1) + the only remaining candidate loses the race (D2) → exit 3', () => {
  it('the collision does not change the "retry later" code', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    // Epic 100: #10 and #11 share <!-- ct-order:1 --> → collision, the WHOLE
    // epic excluded from `issues` (buildDispatchInput).
    const i10 = rawIssue({ number: 10, milestone: 100, order: 1 })
    const i11 = rawIssue({ number: 11, milestone: 100, order: 1 })
    // Epic 200: #20, the only survivor, ready and with no deps.
    const i20 = rawIssue({ number: 20, milestone: 200, order: 1, touches: ['foo'] })
    // Work in flight that ONLY dispatch-check sees in its own live read (idx2)
    // — never in the snapshot ct-next takes (idx0) — reproducing D2's own clean
    // lost race.
    const inFlight99 = { number: 99, labels: [{ name: 'status:in-progress' }, { name: 'touches:foo' }] }

    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#20)
      // live collision-check → it sees #99 in flight.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[i10, i11, i20], [], [inFlight99]]),
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:foo', 'status:ready']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
    })

    // D1: the collision warning is ALWAYS printed, never in silence.
    expect(r.out).toMatch(/warning: colisión de orden.*#10.*#11|warning: colisión de orden.*#11.*#10/)
    expect(r.out).toMatch(/EXCLUIDO de esta tanda/)
    // Only #20 was selected (epic 100's never competed).
    expect(r.out).toMatch(/selected for this batch.*#20/)
    // #20 collides live with #99 → it is skipped, zero launched.
    expect(r.out).toMatch(/skipping #20/)
    expect(r.out).toMatch(/lanzad[oa]s? 0.*1/i)
    // Exit 3 — the same "retry later" as D2, NOT 0 (that would claim real
    // progress that never happened) nor 1 (nothing broke: the exclusion is not
    // a failure).
    expect(r.code).toBe(3)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })
})

describe('Seam B — the order collision is the ONLY source of work in the repo → exit 0, not exit 1', () => {
  it('once the collided epic is excluded there is nothing left to select, and that is NOT a failure', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const i10 = rawIssue({ number: 10, milestone: 100, order: 1 })
    const i11 = rawIssue({ number: 11, milestone: 100, order: 1 })

    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[i10, i11], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
    })

    expect(r.out).toMatch(/warning: colisión de orden/)
    // planDispatch selected nothing — no dispatch-check is ever opened.
    expect(r.out).toMatch(/There is no issue at status:ready/)
    // exit 0: "nothing to do, and it has already been explained why" — the
    // collision NEVER aborts the batch (D1's round 2), not even when it leaves
    // the repo with nothing to dispatch.
    expect(r.code).toBe(0)
    const argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(argv).not.toMatch(/issue edit/) // no claim attempted
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })
})

describe('Seam C — a stray dep outside the section (D1, it warns and dispatches) that ends up orphaned in status:in-progress (D2, stuck) → exit 1 with both messages', () => {
  it('the stray dep warning and the orphan ATTENTION live together without contradicting each other', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    // #50: with no "## Dependencias" section at all (deps=[], malformed:false —
    // it never blocks), but with a loose "merge-after #7" in the
    // "## Descripción" — D1 exposes it as strayDeps, warns, and dispatches all
    // the same.
    const i50 = rawIssue({
      number: 50,
      milestone: 500,
      order: 1,
      touches: ['zzz'],
      body: '## Descripción\nAlgo que menciona merge-after #7 pero no cuenta como dependencia real.\n',
    })

    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#50)
      // collision-check (clean) ; idx3: dispatch-check(#50) readback → FAILS.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[i50], [], []]),
      FAKE_GH_LIST_FAIL_AT: '3',
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:zzz', 'status:ready']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      // The revert that follows the readback failure ALSO fails → orphan.
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready --remove-label status:in-progress',
    })

    // D1: the stray dep warning is printed — the narrowing of the deps domain
    // is correct, but never in silence.
    expect(r.out).toMatch(/warning: #50 tiene "merge-after #7" fuera de la sección/)
    // D2: 'stuck' aborts the WHOLE batch — the issue is left orphaned.
    expect(r.out).toMatch(/ATTENTION.*bloqueado en status:in-progress/is)
    expect(r.out).not.toMatch(/lanzado #50/)
    // Neither of the two messages steps on the other: the stray dep warning
    // does not say the dispatch completed, and the ATTENTION does not say the
    // dependency blocked anything.
    expect(r.out).not.toMatch(/warning: #50 tiene "merge-after #7"[^\n]*bloquead/i)
    expect(r.code).toBe(1)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })
})

describe('Seam D — an order collision + malformed deps in another epic + a stray dep in a third, in the SAME batch → real progress is not blocked by the warnings', () => {
  it('the collided epic is excluded, the issue with malformed deps is excluded from the selection (without aborting anything), and the issue with a stray dep is dispatched successfully', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    // Epic 100: order collision — #10/#11 excluded whole.
    const i10 = rawIssue({ number: 10, milestone: 100, order: 1 })
    const i11 = rawIssue({ number: 11, milestone: 100, order: 1 })
    // Epic 200: #20 with "## Dependencias" present but WITHOUT any recognisable
    // "merge-after #N" (a human rewrite) → depsMalformed. It is excluded from
    // readyDepsMet, but NOT from `issues` — it does not block the rest.
    const i20 = rawIssue({
      number: 20,
      milestone: 200,
      order: 1,
      body: '## Dependencias\n- Depende de #1 (ver más abajo)\n',
    })
    // Epic 300: #30 with a stray dep outside the section — it warns, and dispatches all the same.
    const i30 = rawIssue({
      number: 30,
      milestone: 300,
      order: 1,
      touches: ['qux'],
      body: '## Descripción\nNota suelta: merge-after #9 no debería contar aquí.\n',
    })

    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#30)
      // collision-check (clean, nothing in flight) ; idx3: readback (clean).
      // #20 never reaches a dispatch-check: it is not in readyDepsMet.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[i10, i11, i20, i30], [], [], []]),
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:qux', 'status:ready']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
    })

    // D1: the three warnings about broken/narrowed data live together.
    expect(r.out).toMatch(/warning: colisión de orden.*#10.*#11|warning: colisión de orden.*#11.*#10/)
    expect(r.out).toMatch(/warning: #30 tiene "merge-after #9" fuera de la sección/)
    // #20 (malformed) NEVER appears as selected nor launched — but it neither
    // aborts nor contaminates #30's result either: since #30 IS selected,
    // planDispatch never invokes explainNoSelection (it is only used when
    // selected.length === 0), so there is no blocking line dedicated to #20 in
    // this run — it stays out in functional silence, without aborting anything
    // or preventing #30's progress (behaviour verified here on purpose, not
    // assumed).
    expect(r.out).not.toMatch(/selected for this batch.*#20/)
    expect(r.out).not.toMatch(/lanzado #20/)
    // #30 was indeed selected, claimed and launched successfully.
    expect(r.out).toMatch(/selected for this batch.*#30/)
    expect(r.out).toMatch(/lanzado #30/)
    expect(r.out).toMatch(/lanzad[oa]s? 1.*1/i)
    expect(r.code).toBe(0)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 30 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    expect(argv).not.toMatch(/issue edit 20/)
    expect(argv).not.toMatch(/issue edit 10/)
    expect(argv).not.toMatch(/issue edit 11/)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/30/)
  })
})
