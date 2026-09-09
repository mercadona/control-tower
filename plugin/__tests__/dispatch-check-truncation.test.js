// Finding 4 (interruption/staleness audit): `console.error(big)` followed
// IMMEDIATELY by `process.exit()` can lose text —
// `process.stdout`/`process.stderr` are ASYNCHRONOUS towards a pipe on POSIX,
// and `process.exit()` does not wait for an in-flight `write()` to finish
// flushing (documented in Node's own docs; the same reasoning that already
// motivated the `writeSync` in `attemptClaim` in ct-next.mjs, and that a
// sibling task used to diagnose the same pattern in another file). The
// "ATTENTION … libéralo a mano" diagnostics of dispatch-check.mjs are EXACTLY
// the ones a human needs whole when something went wrong — and the
// `COLLISION: ...` message can grow arbitrarily with the number of in-flight
// issues that share a token.
//
// This test reproduces the adversarial scenario directly: thousands of
// in-flight issues sharing the candidate's token, so that the COLLISION
// message goes well past the typical POSIX pipe buffer size (~64 KiB on
// macOS) — and it checks that the LAST issue of the list (the one that would
// be lost first if something truncates) still shows up whole.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

function runReal(args, envOverrides = {}) {
  try {
    const out = execFileSync('node', [script, ...args], {
      encoding: 'utf8',
      stdio: QUIET_STDIO,
      maxBuffer: 64 * 1024 * 1024, // the READING SIDE is not the problem — we are just making sure we do not truncate ourselves while capturing.
      env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

describe('dispatch-check.mjs — the COLLISION diagnostic is not truncated however huge it gets (finding 4)', () => {
  it('thousands of in-flight issues colliding: the LAST of the list (the first to be lost if something truncates) arrives whole', () => {
    const N = 10000
    const inFlight = []
    for (let i = 1; i <= N; i++) {
      inFlight.push({ number: 1000 + i, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] })
    }
    // The sequence travels through a FILE and not inline in the environment
    // variable. Linux caps EACH argv/environment string at MAX_ARG_STRLEN (32
    // pages, 128 KiB); these 10,000 issues go past 700 KiB, so the `execve`
    // failed and `r.code` arrived as `null` — the process did not start, and
    // the test was not measuring the truncation it claims to measure. macOS
    // has no such per-string cap, and that is why it passed locally and not in
    // continuous integration. The fake gh already carries this path
    // (FAKE_GH_LIST_SEQUENCE_FILE), added for the same size reason.
    const seqDir = mkdtempSync(join(tmpdir(), 'ct-truncation-'))
    const seqFile = join(seqDir, 'list-sequence.json')
    writeFileSync(seqFile, JSON.stringify([inFlight]))
    let r
    try {
      r = runReal(['5', '--repo', 'o/r'], {
        FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
        FAKE_GH_LIST_SEQUENCE_FILE: seqFile,
      })
    } finally {
      rmSync(seqDir, { recursive: true, force: true })
    }
    expect(r.code).toBe(1)
    expect(r.out.length).toBeGreaterThan(100 * 1024) // confirms the scenario IS big enough to go past a typical pipe buffer (~64 KiB)
    expect(r.out).toMatch(/^COLLISION: #5 clashes with/)
    // The last issue of the list is the likeliest candidate to be lost if
    // something truncates — it must still be present, whole.
    // F13/H2: each collider now carries its status inside the bracket
    // (`#N[touches:db status:in-progress]`) — "clashes with #N" no longer implies
    // there is a live agent there, and the remedy depends on which of the two
    // it is.
    expect(r.out).toMatch(new RegExp(`#${1000 + N}\\[touches:db status:in-progress\\]`))
  })
})
