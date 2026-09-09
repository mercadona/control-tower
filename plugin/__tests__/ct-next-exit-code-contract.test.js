// Finding 4 (interruption/staleness audit), second half: before this,
// ct-next.mjs#classifyClaimOutcome told the causes of an exit 1 of
// dispatch-check.mjs apart by PARSING ITS FREE TEXT — fragile against any
// future wording change in that file. With the exit code contract widened
// (1='skip', 3='infra', 4='stuck'; see the header of dispatch-check.mjs and
// of classifyClaimOutcome in ct-next.mjs), ct-next.mjs's decision no longer
// depends on recognising any particular phrase.
//
// These tests verify the END-TO-END behaviour (ct-next.mjs invoking the real
// dispatch-check.mjs) for the two cases that previously could ONLY be told
// apart by parsing text: 'infra' (carries on with the rest of the batch) and
// 'stuck' (aborts the whole batch).
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
  const d = mkdtempSync(join(tmpdir(), 'ct-next-exitcode-'))
  dirs.push(d)
  return d
}

describe('ct-next — classifies the claim by the dispatch-check CODE, not by its text (finding 4)', () => {
  it('exit 3 (infra: reading the candidate labels failed) → skips #42 and CARRIES ON with #43, final exit 0', () => {
    const repoRoot = makeRepoRoot()
    const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const viewCounterFile = join(repoRoot, 'gh-view-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#42)
      // collision check (reading the candidate labels) FAILS ; idx3/4:
      // dispatch-check(#43) collision check + readback, both clean.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], [], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_VIEW_FAIL_AT: '0', // the FIRST call to `issue view` (labelsOf of candidate #42) fails
      FAKE_GH_VIEW_COUNTER_FILE: viewCounterFile,
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:zzz']),
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.out).toMatch(/no se pudo reclamar — fallo de infraestructura/)
    expect(r.out).toMatch(/sigo con el resto de esta tanda/)
    expect(r.out).toMatch(/lanzado #43/)
    expect(r.out).toMatch(/lanzad[oa]s? 1.*2/i)
    expect(r.code).toBe(0)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).not.toMatch(/worktree add -b feat\/42/)
    expect(gitLogTxt).toMatch(/worktree add -b feat\/43/)
  })

  it('exit 4 (orphan: race lost and the revert fails too) → aborts the WHOLE batch with exit 1, even with another candidate left', () => {
    const repoRoot = makeRepoRoot()
    const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    // The readback (idx3) has to include OUR OWN #42 (already carrying the
    // freshly written claim) as well as the lower-numbered rival — claimLost()
    // looks for `mine` in the readback itself; if #42 did not show up there,
    // the result would be "ambiguous, we do not block" instead of the real
    // lost race this test needs to reproduce.
    const readbackConPerdida = [
      { number: 42, labels: [{ name: 'status:in-progress' }, { name: 'touches:zzz' }] },
      { number: 5, labels: [{ name: 'status:in-progress' }, { name: 'touches:zzz' }] }, // lower number → it wins, we lose
    ]
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#42)
      // collision check (clean) ; idx3: readback WITH a loss (#5 < #42).
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], [], [], readbackConPerdida]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:zzz']),
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready --remove-label status:in-progress', // the revert of #42 fails
    })
    expect(r.out).toMatch(/dispatch-check devolvió exit 4 para #42/)
    expect(r.out).toMatch(/bloqueado en status:in-progress sin nadie trabajándolo/)
    expect(r.out).toMatch(/Abortando toda la tanda/)
    expect(r.out).not.toMatch(/lanzado #43/) // it NEVER gets as far as trying the next candidate
    expect(r.code).toBe(1)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })
})

// ===========================================================================
// D5, finding A — EXPLICIT WIDENING OF THE EXIT CODE CONTRACT.
//
// Exit 3 meant two different things and its message described only one of
// them: ever since an unverified launch stopped counting as launched, exit 3
// could be reached with the claim written, the branch and the worktree
// created and `cmux new-workspace` at exit 0 — while the text asserted
// "Nada quedó a medias ni bloqueado — reintenta más tarde".
//
// The contract now reads like this, and these tests pin it down:
//   3 = there was a batch, zero launches, and NOTHING was left half done (all
//       the candidates were skipped AT CLAIM TIME, mutating nothing).
//       Retryable.
//   1 = WIDENED to "at least one slice was left launched without being
//       verified" — there is half-done state a human has to resolve. It
//       applies even if other slices of the same batch did launch fine.
// The table in commands/ct-next.md was updated in the same change.
describe('ct-next — exit 3 and exit 1 are told apart by whether ANYTHING WAS LEFT HALF DONE (D5, finding A)', () => {
  const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

  it('zero launches WITHOUT residue → 3, and the message states there is nothing to clean up', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GH_ARGV_LOG_FILE: join(repoRoot, 'gh-argv'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
      // Collision detected by dispatch-check BEFORE writing anything.
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:zzz']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([
        [openIssue42],
        [],
        [{ number: 5, labels: [{ name: 'status:in-progress' }, { name: 'touches:zzz' }] }],
      ]),
    })
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/no hay nada que limpiar a mano/)
    expect(r.out).not.toMatch(/LANZADOS SIN VERIFICAR/)
  })

  it('zero launches WITH residue (a launch that was never verified) → 1, never 3', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GH_ARGV_LOG_FILE: join(repoRoot, 'gh-argv'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
      FAKE_CMUX_SKIP_STATE_SUBSTR: '#42',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/1 de los 1 slice\(s\) seleccionados quedaron LANZADOS SIN VERIFICAR/)
    // The claim and the worktree DO exist: that is why it cannot be a 3.
    expect(readFileSync(join(repoRoot, 'gh-argv'), 'utf8')).toMatch(/issue edit 42 .*--add-label status:in-progress/)
    expect(readFileSync(join(repoRoot, 'git-log'), 'utf8')).toMatch(/worktree add -b feat\/42/)
  })
})
