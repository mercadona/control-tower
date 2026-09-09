// IMPORTANT (external review): a NORMAL terminal Ctrl-C (one that does reach
// the child too — unlike the adversarial scenario of finding 1, where the
// child ignores it) during attemptClaim kills dispatch-check.mjs by signal:
// Node leaves `status` at `null` and `signal` with the name. Before this fix,
// ct-next.mjs blamed this, without distinction, on "probablemente un bug o
// una mala configuración (p.ej. --repo mal formado)" — actively misleading
// precisely when the user knows perfectly well what happened (they
// interrupted it themselves), and without mentioning what matters most:
// dispatch-check.mjs may have written the claim BEFORE dying, and from here
// there is no way to know.
//
// CT_CLAIM_TEST_SELF_KILL_SIGNAL (a test-only hook in dispatch-check.mjs)
// makes the subprocess send the signal to itself right after validating its
// usage — the same underlying syscall as an external signal, but
// deterministic: it avoids having to coordinate the PID of a subprocess
// launched inside another subprocess (fragile, with the same timing races as
// finding 1).
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
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

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-sigkilled-'))
  dirs.push(d)
  return d
}

const openIssue77 = { number: 77, title: '#77 algo', labels: [{ name: 'status:ready' }], body: '' }

describe('ct-next — dispatch-check killed by a signal during the claim (IMPORTANT, external review)', () => {
  it('SIGTERM: the message names the signal, warns that the claim may already have been written, and gives the manual command — it never blames a "bad configuration"', () => {
    const repoRoot = makeRepoRoot()
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: fakePath, FAKE_GIT_TOPLEVEL: repoRoot,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
        CT_CLAIM_TEST_SELF_KILL_SIGNAL: 'SIGTERM',
      },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).toBe(1)
    expect(r.signal).toBeNull() // ct-next.mjs itself finishes cleanly (process.exit), not killed outright
    expect(out).toMatch(/dispatch-check for #77 was ended by the signal SIGTERM/)
    expect(out).toMatch(/there is no way to know whether the claim got as far as being written before it died/)
    expect(out).toMatch(/gh issue edit 77 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    expect(out).not.toMatch(/it is probably a bug or a misconfiguration/)
    expect(out).toMatch(/Aborting the whole batch/)
  })

  it('SIGINT: same treatment — it names the right signal', () => {
    const repoRoot = makeRepoRoot()
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: fakePath, FAKE_GIT_TOPLEVEL: repoRoot,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
        CT_CLAIM_TEST_SELF_KILL_SIGNAL: 'SIGINT',
      },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).toBe(1)
    expect(out).toMatch(/dispatch-check for #77 was ended by the signal SIGINT/)
    expect(out).not.toMatch(/it is probably a bug or a misconfiguration/)
  })
})
