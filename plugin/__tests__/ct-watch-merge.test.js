// The MERGE watcher (scripts/ct-watch-merge.mjs), against a fake `gh` and a
// fake `cmux`.
//
// What this file pins: that the merge of a slice's PR reaches the coordinator
// session without anybody telling it about it. Until this round, merging was an
// act that produced no mechanical signal at all — the harvest (F20: the
// `.worktrees/<n>` worktree, the `feat/<n>` branch and its zombie `claude`)
// stayed on disk until the very person who had merged walked over to the
// coordinator's window to tell it.
//
// The REAL script is executed as a subprocess, the same as ct-watch-go.test.js
// and for the same reason: what is left to test here is the seam —talking to
// `gh`, finding the coordinator by its DIRECTORY and typing the line into it—,
// which is precisely what a test with in-memory doubles would not check.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'scripts', 'ct-watch-merge.mjs')
const STUBS = [join(HERE, 'fixtures', 'fake-gh-bin'), join(HERE, 'fixtures', 'fake-cmux-bin')].join(':')

let dir
let stateFile
let counters = 0

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'watch-merge-'))
  stateFile = join(dir, 'cmux-state.json')
  // The coordinator, exposed by the stub with its `ref` and its `cwd`. The
  // watcher is going to locate it by the DIRECTORY (the main checkout), not by
  // the title: that way there is no session name to configure anywhere. The
  // title is different from the cwd on purpose — if the watcher looked by
  // title, this test would fail.
  writeFileSync(stateFile, JSON.stringify([{ title: 'coordinadora de repo-pulse', cwd: dir }]))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// The watcher runs until it decides, so each case gives it short deadlines:
// what is being tested is the decision, not the clock.
function run(env = {}, { timeoutMs = 800, pollMs = 40, coordinatorCwd = null } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [
      SCRIPT, '--issue', '5', '--repo', 'jjponz/repo-pulse',
      '--coordinator-cwd', coordinatorCwd ?? dir,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PATH: `${STUBS}:${process.env.PATH}`,
        FAKE_CMUX_STATE_FILE: stateFile,
        // The line that gets typed is prose, not a command: without this the
        // stub would try to run it with `sh -c`.
        FAKE_CMUX_SKIP_COMMAND_SUBSTR: 'coordinadora',
        CT_WATCH_MERGE_TIMEOUT_MS: String(timeoutMs),
        CT_WATCH_MERGE_POLL_MS: String(pollMs),
        ...env,
      },
    })
    return { status: 0, stdout }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}

const pendingOf = () => JSON.parse(readFileSync(stateFile, 'utf8'))[0].pending

// The merge has to ARRIVE, not be there already: the watcher is born exactly
// when the PR opens, so the first poll sees the PR unmerged. The delivery cases
// go in sequence — first polls empty, the next one with the PR merged — which
// is also how it really looks.
const withMerge = (extra = {}) => ({
  FAKE_GH_PR_LIST_SEQUENCE: JSON.stringify([
    [],
    [{ number: 41, mergedAt: '2026-08-25T09:12:00Z' }],
  ]),
  FAKE_GH_PR_LIST_COUNTER_FILE: join(dir, `contador-${++counters}`),
  ...extra,
})

// A PATH without `cmux` — but WITH `node`, or the `gh` stub (which is a script
// with an `env node` shebang) would not start either and the test would be
// measuring something else.
const withoutCmux = () => [join(HERE, 'fixtures', 'fake-gh-bin'), dirname(process.execPath), '/usr/bin', '/bin'].join(':')

describe('the watcher delivers the merge warning', () => {
  it('sees the merged PR and types the line into the coordinator', () => {
    const r = run(withMerge())
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/línea enviada/)
    // The `send-key Enter` consumes the pending one: its being null is the
    // proof that the line was SENT and executed, not that it stayed on the edit
    // line. The two steps go separately because `cmux send` adds no Enter.
    expect(pendingOf()).toBe(null)
  })

  it('the line names the PR, the slice and the two artefacts of the harvest', () => {
    // What the coordinator receives has to be enough for it to act without
    // asking again: which PR, which slice, and what is on disk. If the message
    // only said "merged", the human would still be the message bus.
    //
    // It is read from the RECORD of cmux invocations, not from the stub's
    // `pending`: `send-key Enter` consumes the pending one (sets it to null),
    // which is precisely what the test above uses as proof that the line was
    // executed. The two assertions need different sources.
    const invocations = join(dir, 'cmux-argv.log')
    const r = run(withMerge({ FAKE_CMUX_INVOKED_LOG_FILE: invocations }))
    expect(r.status).toBe(0)
    const line = readFileSync(invocations, 'utf8')
    expect(line).toMatch(/#41/)
    expect(line).toMatch(/#5/)
    expect(line).toMatch(/\.worktrees\/5/)
    expect(line).toMatch(/feat\/5/)
  })

  it('waits while the PR is not merged, and warns on the tick in which it is', () => {
    // What really matters: that it does not give up on the first poll. A PR
    // gets merged hours or days after it opens.
    const r = run(withMerge())
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/línea enviada/)
  })
})

describe('the watcher does not warn about what is not a merge', () => {
  it('an open, unmerged PR runs out the deadline without touching the coordinator', () => {
    const r = run({ FAKE_GH_PR_LIST: '[]' })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/plazo agotado/)
    expect(pendingOf()).toBeUndefined()
  })
})

describe('what cannot bring the watch down', () => {
  it('a failure of `gh` is written down and retried on the next tick', () => {
    // The network goes down and the token expires. What cannot happen is that a
    // transient failure gets read as "it is not merged" permanently: the watcher
    // would shut down with the work delivered and unharvested.
    const r = run({ FAKE_GH_PR_LIST_FAIL: '1' })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/no se pudo consultar el PR/)
    expect(r.stdout).toMatch(/se reintenta/)
  })

  it('if the merge arrives and there is no coordinator, it says so and dies', () => {
    writeFileSync(stateFile, JSON.stringify([]))
    const r = run(withMerge())
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/cmux dice que no existe/)
  })

  // -------------------------------------------------------------------------
  // This case happened in the field (2026-08-26, PR #16 of
  // jjponz/rust-monitoring) and the defect was not the watcher's: it did the
  // right thing and said so. The defect was that its message named the FACT
  // ("there is no session in <cwd>") and not the RULE, so whoever read it could
  // not deduce what they should have done differently — and on top of that it
  // looked as if work had been lost, when `/ct-next` still detects the residue
  // on its own.
  //
  // It is the same criterion that holds up ct-next-honest-messages.test.js: a
  // message that correctly describes a state without saying what to do about it
  // is half a diagnosis.
  // -------------------------------------------------------------------------
  it('when it does not find it, it names the RULE and says no work has been lost', () => {
    writeFileSync(stateFile, JSON.stringify([]))
    const r = run(withMerge())
    expect(r.status).toBe(1)
    // The rule: the coordinator lives in the main checkout, and the concrete
    // directory has to appear for it to be actionable.
    expect(r.stdout).toMatch(/coordinadora tiene que ser una workspace de cmux abierta EN/)
    expect(r.stdout).toContain(dir)
    // And why it is by directory and not by name: it is not created by the loop.
    expect(r.stdout).toMatch(/no la crea el loop/)
    // The safety net, said out loud: the warning is lost, the work is not.
    expect(r.stdout).toMatch(/cosecha pendiente/)
    expect(r.stdout).toMatch(/No se ha perdido trabajo/)
  })

  // -------------------------------------------------------------------------
  // THE TEST THAT WAS MISSING, and that would have caught the finding of the
  // adversarial review on #37.
  //
  // `custom_title` and `current_directory` are field names OBSERVED against the
  // installed version of cmux; there is no schema guarantee. With the raw read
  // this watcher used to have, a rename of that field made no entry match, "cmux
  // answered and it is not there" was returned, and the error message —which
  // since the previous round NAMES THE RULE and tells the person what they did
  // wrong— turned into a specific, confident and FALSE accusation. Making the
  // message more honest made the failure mode worse, which is what made it hard
  // to see.
  //
  // `ct-next.mjs` had already fought this one (D5, finding B). What the three
  // consumers now share is the conclusion of that fight: a field whose schema we
  // do not recognise degrades to INCONCLUSIVE, never to "verified that it is not
  // there".
  // -------------------------------------------------------------------------
  it('if cmux renames the directory field, it does NOT accuse: it degrades to inconclusive', () => {
    // The stub answers with real entries, but with no `current_directory`.
    const r = run(withMerge({ FAKE_CMUX_CWD_FIELD_RENAMED: '1' }), { timeoutMs: 500, pollMs: 40 })
    // It exits by DEADLINE (it can never deliver), not by the exit 1 of "it is
    // not there": the difference is that it keeps trying instead of blaming
    // anybody.
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/no se pudo consultar cmux/)
    expect(r.stdout).toMatch(/se reintenta la entrega/)
    // And what CANNOT appear: the accusation.
    expect(r.stdout).not.toMatch(/La regla que no se cumplió/)
    expect(r.stdout).not.toMatch(/no existe ninguna workspace/)
  })

  it('if the merge arrives and cmux cannot be asked right then, it does NOT give up', () => {
    // The finding ct-watch-go paid for with an adversarial review: "cmux
    // answered that it is not there" and "it could not be asked" do not mean the
    // same thing, and throwing that distinction away on the DELIVERY path kills
    // the watch at the only instant that matters.
    const r = run(withMerge({ PATH: withoutCmux() }), { timeoutMs: 500, pollMs: 40 })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/el merge está visto pero no se pudo consultar cmux/)
    expect(r.stdout).toMatch(/se reintenta la entrega/)
  })

  // -------------------------------------------------------------------------
  // THE DELIBERATE DIVERGENCE FROM ct-watch-go.
  //
  // That one shuts down as soon as cmux answers that the slice's session does
  // not exist, and it is right to: without that session there is nothing to
  // watch. Here it does NOT, and the reason is that the absence of the
  // coordinator does not mean the same thing: closing its window is the normal
  // thing —you go to sleep and the merge arrives in the morning— and that is
  // exactly the case this watcher exists to cover. Shutting down then would be
  // shutting down always in the very scenario that motivates all of this.
  // -------------------------------------------------------------------------
  it('if the coordinator is not there while it waits, it keeps watching', () => {
    writeFileSync(stateFile, JSON.stringify([]))
    const r = run({ FAKE_GH_PR_LIST: '[]' }, { timeoutMs: 400, pollMs: 40 })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/plazo agotado/)
    // And no exit 4 "the session no longer exists" has been invented like the
    // go watcher's: here that is not a bound, it is the normal case.
    expect(r.stdout).not.toMatch(/ya no existe/)
  })

  it('if the typing fails it says so and dies: the merge was seen and could not be delivered', () => {
    const r = run(withMerge({ FAKE_CMUX_SEND_FAIL: '1' }))
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/no se pudo escribir/)
  })
})

describe('the arguments and the deadlines', () => {
  it("without an issue, a repo or the coordinator's cwd it does not start", () => {
    let r
    try {
      execFileSync(process.execPath, [SCRIPT, '--issue', '5'], { encoding: 'utf8', timeout: 10_000 })
      r = { status: 0, stderr: '' }
    } catch (e) {
      r = { status: e.status, stderr: String(e.stderr || '') }
    }
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/usage:/)
  })

  it('a deadline that cannot be understood aborts instead of silently falling back to the default', () => {
    // Same criterion as CT_WATCH_GO_POLL_MS and CT_NEXT_LAUNCH_TIMEOUT_MS: a
    // badly written deadline changes what this process means, and you would not
    // want to discover that two days later.
    const r = run({ CT_WATCH_MERGE_POLL_MS: 'un rato' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/CT_WATCH_MERGE_POLL_MS invalid/)
  })
})
