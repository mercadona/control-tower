// Finding 3 (interruption/staleness audit): cmux's real command form is
// `/bin/zsh -lc '{ cd -- '\''<cwd>'\'' 2>/dev/null || [ ! -d
// '\''<cwd>'\'' ]; } && ...'` — it TOLERATES a non-existent cwd (the `[ ! -d
// ... ]` check makes the whole `{...}` succeed anyway) and starts the agent in
// the default login shell instead, exiting with exit 0. ct-next.mjs used to
// print "lanzado #N en <wt>" based only on `new-workspace` returning exit 0 —
// inferring "it is in the right place" from "the command did not fail",
// exactly what this finding forbids.
//
// These tests verify that ct-next.mjs now queries cmux read-only
// (`list-windows` + `workspace list --json`, NEVER `new-workspace` outside the
// real launch) to tell the three cases apart: confirmed, wrong cwd, and
// "the session cannot be found" — and that the final message reflects exactly
// which of the three was observed.
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
  const d = mkdtempSync(join(tmpdir(), 'ct-next-launch-'))
  dirs.push(d)
  return d
}

const openIssue90 = { number: 90, title: '#90 algo', labels: [{ name: 'status:ready' }], body: '' }

describe('ct-next — cmux launch verification (finding 3)', () => {
  it('happy path: cmux confirms the session in the exact cwd → "verificado" message', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #90 en .*\.worktrees\/90.*verificado: la sesión cmux está corriendo en ese directorio/)
  })

  it('cmux accepts the launch but the session ends up in ANOTHER directory (non-existent cwd tolerated) → ATENCIÓN, never a bare "lanzado"', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_WRONG_CWD_SUBSTR: '#90',
    })
    // IMPORTANT (external review): 'wrong-cwd' no longer counts as
    // successfully launched (it used to bump launchedCount all the same, and
    // the batch exited with exit 0 — ordinary progress for a /loop — even
    // though the issue was left in-progress with no confirmed agent, invisible
    // to staleness detection too).
    //
    // D5, finding A — the exit code of THIS case goes from 3 to 1. That fix
    // left it falling into exit 3, whose message asserted "Nada quedó a medias
    // ni bloqueado — reintenta más tarde": a lie on this path (claim written,
    // branch and worktree created, `cmux new-workspace` with exit 0) and
    // impossible to follow (the issue is no longer in status:ready and the
    // destination is taken). 1 = "stop and let a human look at it" is the
    // correct semantics, and the message now enumerates what has to be cleaned
    // up.
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN: cmux aceptó el lanzamiento de #90 \(exit 0\), pero la sesión NO está en/)
    expect(r.out).toMatch(/está en "\/Users\/fake\/\.config\/ghostty-default-shell-dir" en su lugar/)
    expect(r.out).toMatch(/NO se cuenta como lanzado con éxito/)
    // The final summary must NOT say "nada quedó a medias" nor "reintenta más
    // tarde": that is exactly the false assertion D5 removes.
    expect(r.out).toMatch(/quedaron LANZADOS SIN VERIFICAR/)
    expect(r.out).toMatch(/la rama feat\/90 y el worktree .*\.worktrees\/90/)
    expect(r.out).toMatch(/gh issue edit 90 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    expect(r.out).not.toMatch(/Nada quedó a medias/)
    expect(r.out).not.toMatch(/no hay nada que limpiar a mano/)
    // The text may indeed NAME "reintenta más tarde" in order to deny it, but
    // it can never recommend it as a way out.
    expect(r.out).toMatch(/no es "reintenta más tarde"/)
    expect(r.out).not.toMatch(/reintenta más tarde, o en la próxima vuelta del \/loop/)
    // It must never read as a confirmed launch with no qualification.
    expect(r.out).not.toMatch(/lanzado #90 en .*verificado/)
  })

  it('cmux accepts the launch but the session does not show up in the query at all → "no se encontró" ATENCIÓN, and it does NOT count as progress (exit 1)', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_SKIP_STATE_SUBSTR: '#90',
    })
    // IMPORTANT (external review): same reason as 'wrong-cwd' above —
    // 'not-found' is POSITIVE evidence of a problem, it does not count as
    // launched, and the exit code stops lying about "progress".
    // D5, finding A: and for the same reason as 'wrong-cwd', the code goes from
    // 3 to 1 — here too a claim, a branch and a worktree are left behind.
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN: cmux devolvió éxito \(exit 0\) al lanzar #90, pero no se encontró ninguna sesión/)
    expect(r.out).toMatch(/NO se cuenta como lanzado con éxito/)
    expect(r.out).toMatch(/quedaron LANZADOS SIN VERIFICAR/)
    expect(r.out).not.toMatch(/Nada quedó a medias/)
    expect(r.out).not.toMatch(/lanzado #90 en .*verificado/)
  })

  it('cmux cannot be queried after the launch (daemon down) → "no se pudo verificar" message, it never asserts confidence it does not have', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_LIST_WINDOWS_FAIL: '1',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #90 en .*\.worktrees\/90/)
    expect(r.out).toMatch(/no se pudo verificar la sesión/)
    expect(r.out).not.toMatch(/verificado: la sesión cmux está corriendo/)
  })

  it('adversarial attack: two slices in the same batch with different names are not confused with each other', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue91 = { number: 91, title: '#91 otra cosa', labels: [{ name: 'status:ready' }], body: '' }
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90, openIssue91], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      // #90 ends up in the wrong cwd; #91 launches clean.
      FAKE_CMUX_WRONG_CWD_SUBSTR: '#90',
    })
    expect(r.out).toMatch(/ATENCIÓN: cmux aceptó el lanzamiento de #90 \(exit 0\), pero la sesión NO está en/)
    expect(r.out).toMatch(/lanzado #91 en .*\.worktrees\/91.*verificado: la sesión cmux está corriendo en ese directorio/)
    // D5, finding A (the MIXED case, which the commission did not name and
    // which was the hardest to see): with one confirmed and one unconfirmed,
    // `launchedCount` is 1 — so exit 3 was never reached and the batch exited
    // with exit 0, that is, "progress" for a /loop, while #90 was left in
    // status:in-progress with a branch and a worktree and no confirmed agent.
    // Verified against the unfixed code: exit 0.
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/lanzados 1\/2 slice\(s\) seleccionados de esta tanda/)
    expect(r.out).toMatch(/1 de los 2 slice\(s\) seleccionados quedaron LANZADOS SIN VERIFICAR/)
    // Only #90 must show up in the "somebody has to look at this by hand"
    // list: the confirmed #91 is neither touched nor mentioned as residue.
    expect(r.out).toMatch(/- #90: la sesión de cmux existe pero está en/)
    expect(r.out).not.toMatch(/- #91: /)
  })

  it('IMPORTANT (external review): a schema change in cmux\'s answer (renamed field) is treated as inconclusive, NEVER as "zero sessions confirmed"', () => {
    // Simulates a version of cmux that returns `title` instead of
    // `custom_title` — there ARE real entries (the one this very dispatch has
    // just launched), but none with the field ct-next.mjs recognises. Without
    // the schema guard, this would silently filter down to an empty array,
    // indistinguishable from "cmux answered and there really are no sessions" —
    // a false alarm on EVERY successful dispatch.
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_SCHEMA_MISMATCH: '1',
    })
    expect(r.code).toBe(0) // it counts as launched: "inconclusive" gets the same benefit of the doubt as "could not be queried"
    expect(r.out).toMatch(/lanzado #90 en .*\.worktrees\/90/)
    expect(r.out).toMatch(/no se pudo verificar la sesión/)
    expect(r.out).not.toMatch(/no se encontró ninguna sesión con el nombre/) // never the confident "not-found"
    expect(r.out).not.toMatch(/verificado: la sesión cmux está corriendo/)
  })
})
