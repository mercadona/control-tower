// The watcher of the `-OK` (scripts/ct-watch-go.mjs), against a fake `gh` and a
// fake `cmux`.
//
// What this file pins down is the whole property of the round: that the go is
// given ONCE, on the issue, and that the work starts on its own. Before, nobody
// read GitHub's «ok» and the thing that resumed the work was what the person
// typed by hand into the cmux window.
//
// The REAL script is executed as a subprocess: the deciding logic is already
// tested apart (go-response.test.js) and what is left here is the seam —
// talking to `gh`, finding the session by its title and typing the line into
// it—, which is exactly what a test with in-memory doubles would not check.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GO_TOKEN, goBody, goCommitment, newGoNonce, GO_FORMAT_REPLY } from '../scripts/go-response.js'

// F38 — the go this watcher recognises is `-OK <nonce>`, with the nonce of ITS
// OWN dispatch. What reaches it through argv is the sha256 (`--go-hash`): `ps`
// shows its argv to any process of the same uid, the agent included.
const NONCE = newGoNonce(Buffer.from([0x3f, 0x9a, 0x1c, 0x04]))
const GO_HASH = goCommitment(NONCE)
const GO = goBody(NONCE)

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'scripts', 'ct-watch-go.mjs')
const STUBS = [join(HERE, 'fixtures', 'fake-gh-bin'), join(HERE, 'fixtures', 'fake-cmux-bin')].join(':')

const SESSION = 'repo-pulse · #5 el cliente tipado'
let dir
let stateFile

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'watch-go-'))
  stateFile = join(dir, 'cmux-state.json')
  // A session already "launched" with the title the watcher is going to look
  // for. The stub exposes it through `workspace list` with its `ref` and accepts
  // `send` on it.
  writeFileSync(stateFile, JSON.stringify([{ title: SESSION, cwd: dir }]))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// The watcher runs until it decides, so every case gives it short deadlines:
// what is being tested is the decision, not the clock.
function run(env = {}, { timeoutMs = 800, pollMs = 40 } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [
      SCRIPT, '--issue', '5', '--repo', 'jjponz/repo-pulse', '--session', SESSION,
      '--go-hash', env.CT_TEST_GO_HASH ?? GO_HASH,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PATH: `${STUBS}:${process.env.PATH}`,
        FAKE_CMUX_STATE_FILE: stateFile,
        // The line that gets typed is prose, not a command: without this the
        // stub would try to run it with `sh -c`.
        FAKE_CMUX_SKIP_COMMAND_SUBSTR: '#5',
        CT_WATCH_GO_TIMEOUT_MS: String(timeoutMs),
        CT_WATCH_GO_POLL_MS: String(pollMs),
        ...env,
      },
    })
    return { status: 0, stdout }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}

// Comments are identified by `id` (`gh` gives it: `IC_kwDO…`), and that is the
// window: what was not in the initial snapshot counts. `createdAt` goes along
// too because `gh` returns it, but NOBODY looks at it — and there is a test of
// the pure module that prevents cutting by time again.
let n = 0
const comment = (body, id = null) => ({ id: id ?? `IC_${++n}`, body, createdAt: new Date().toISOString() })
const pendingOf = () => JSON.parse(readFileSync(stateFile, 'utf8'))[0].pending

// The go has to ARRIVE after the watcher takes its initial snapshot: a FIXED
// payload that already carries the `-OK` is, by definition, inside that
// snapshot, and then it does not count — which is exactly the window's
// property. So the delivery cases go in a sequence: first poll without a go
// (the snapshot), the next one with it. It is also truer to what really
// happens.
let sequences = 0
const withGo = (extra = {}) => ({
  FAKE_GH_VIEW_COMMENTS_SEQUENCE: JSON.stringify([
    { comments: [] },
    { comments: [comment(GO)] },
  ]),
  FAKE_GH_VIEW_COMMENTS_COUNTER_FILE: join(dir, `contador-${++sequences}`),
  ...extra,
})

// PATH without `cmux` — but WITH `node`, or the `gh` stub (which is a script
// with an `env node` shebang) would not start either and the test would be
// measuring something else.
const withoutCmux = () => [join(HERE, 'fixtures', 'fake-gh-bin'), dirname(process.execPath), '/usr/bin', '/bin'].join(':')

describe('the watcher delivers the go', () => {
  it('sees the token and types the line into the slice session', () => {
    const r = run(withGo())
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/línea enviada/)
    // The `send-key Enter` consumes the pending one: its being null is the
    // proof that the line was SENT and executed, not that it was left on the
    // edit line. The two steps go separately because `cmux send` adds no Enter.
    expect(pendingOf()).toBe(null)
  })

  it('waits while there is no token, and starts on the tick it appears', () => {
    // What really matters: that it does not give up on the first poll. The first
    // payload carries no go; the second one does.
    const r = run(withGo())
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/línea enviada/)
  })
})

describe('the watcher does not deliver what is not a go', () => {
  it('a comment that is not the exact token exhausts the deadline without touching the session', () => {
    // The asymmetric failure mode: «-OK but change the name» has to leave the
    // work stopped, because starting it is exactly what that person was
    // holding back.
    const r = run({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comment(`${GO} pero cambia el nombre`)] }),
    })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/plazo agotado/)
    expect(pendingOf()).toBeUndefined()
  })

  it('a go that was already there at start-up does not count: it belongs to an earlier dispatch', () => {
    // Without the window, re-dispatching a slice whose issue already carried a
    // go would inherit that go and the gate would be skipped in silence. The
    // payload is FIXED, so the `-OK` is already in the initial snapshot the
    // watcher takes before it starts looking.
    const r = run({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comment(GO, 'IC_heredado')] }),
    })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/1 comentario\(s\) ya presentes/)
    expect(pendingOf()).toBeUndefined()
  })
})

describe('what cannot knock down the watch', () => {
  it('a `gh` failure is noted down and retried on the next tick', () => {
    // The network goes down and the token expires. What cannot happen is for a
    // transient failure to be read as «there is no go» permanently.
    const r = run({ FAKE_GH_VIEW_FAIL: '1' })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/no se pudo leer el issue/)
    expect(r.stdout).toMatch(/se reintenta/)
  })

  it('if the session does not exist it says so and dies, instead of pretending it is still watching', () => {
    writeFileSync(stateFile, JSON.stringify([]))
    const r = run(withGo())
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/cmux dice que no existe/)
    expect(r.stdout).toMatch(/a mano/)
  })

  // -------------------------------------------------------------------------
  // THE FINDING THAT HURT MOST in the adversarial review: `querySession`
  // distinguishes «cmux answered that it is not there» from «it could not be
  // asked», and the DELIVERY path threw that distinction away. Which means a
  // cmux timeout right on the tick the `-OK` arrived killed an eight-hour watch
  // at the one instant that mattered, and on top of that diagnosed the opposite
  // of what had happened. When there was nothing to lose it retried; with the
  // go already in hand, it gave up.
  // -------------------------------------------------------------------------
  it('if the go arrives and right then cmux cannot be asked, it does NOT give up', () => {
    const r = run(withGo({ PATH: withoutCmux() }), { timeoutMs: 500, pollMs: 40 })
    // It exits on the deadline (it can never deliver, because cmux is not
    // there), NOT on the exit 1 of «there is no session»: the difference is that
    // it keeps trying.
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/el go está visto pero no se pudo consultar cmux/)
    expect(r.stdout).toMatch(/se reintenta la entrega/)
  })

  // -------------------------------------------------------------------------
  // THE BOUND THAT ACTUALLY BOUNDS. The eight-hour deadline covers the person
  // being asleep; it does not cover the session disappearing, and then the
  // watcher would poll for hours to deliver a line to something that no longer
  // exists. It showed up on the very first try: the first run of the full suite
  // left 42 processes like that.
  // -------------------------------------------------------------------------
  it('if the session disappears it shuts itself down, without waiting out the deadline', () => {
    // A long deadline on purpose: if the watcher waited for the deadline, this
    // test would take a minute. Finishing fast IS the assertion.
    writeFileSync(stateFile, JSON.stringify([]))
    const before = Date.now()
    const r = run({}, { timeoutMs: 60_000, pollMs: 40 })
    expect(r.status).toBe(4)
    expect(r.stdout).toMatch(/ya no existe/)
    expect(Date.now() - before).toBeLessThan(20_000)
  })

  // -------------------------------------------------------------------------
  // THE SAME FAILURE THE ADVERSARIAL REVIEW OF #37 found in the merge watcher,
  // and which this file had been carrying since before: cmux's listing was read
  // raw. `custom_title` is an OBSERVED field name, with no schema guarantee; if
  // cmux renamed it, no entry would match, «cmux answered and the session is not
  // there» was returned, and this watcher SHUT DOWN with exit 4 declaring dead a
  // session that was right in front of it — throwing away the go of the person
  // who had given it.
  //
  // It hurts more here than in the merge one: there a warning is lost that
  // /ct-next recomputes; here a human's permission is lost and the slice stays
  // stopped without anybody knowing. `ct-next.mjs` had already solved it (D5,
  // finding B) and as of this round the three consumers share that guard.
  // -------------------------------------------------------------------------
  it('if cmux renames the title field, it does NOT declare the session dead', () => {
    const r = run({ FAKE_CMUX_SCHEMA_MISMATCH: '1' }, { timeoutMs: 400, pollMs: 40 })
    // On the deadline (exit 3), NOT on the exit 4 of «the session no longer
    // exists»: the watch stays standing instead of killing itself with a false
    // diagnosis.
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/no se pudo consultar cmux/)
    expect(r.stdout).not.toMatch(/ya no existe/)
  })

  it('but if the session could not be ASKED about, it goes on waiting', () => {
    // The distinction ct-next.mjs holds so carefully: "cmux answered that it is
    // not there" and "it could not be asked" do not mean the same thing, and
    // nothing follows from the second. `cmux` is taken off the PATH —the stub is
    // not asked to pretend— because what has to be exercised is the query being
    // impossible to make, not it answering something else.
    const r = run({ PATH: withoutCmux() }, { timeoutMs: 400, pollMs: 40 })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/no se pudo consultar cmux/)
    expect(r.stdout).toMatch(/plazo agotado/)
  })

  it('if the typing fails it says so and dies: the go was seen and could not be delivered', () => {
    const r = run(withGo({ FAKE_CMUX_SEND_FAIL: '1' }))
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/no se pudo escribir/)
  })
})

describe('the initial snapshot', () => {
  // If the first read fails and the snapshot were taken as empty, an `-OK`
  // inherited from an earlier dispatch would count as new and would open the
  // gate in silence — exactly what the window exists to prevent. So it is
  // retried until it succeeds, and if it never succeeds nothing is delivered.
  it('it is not taken as empty: if it cannot be read even once, nothing is delivered', () => {
    const r = run({ FAKE_GH_VIEW_FAIL: '1' }, { timeoutMs: 300, pollMs: 40 })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/sin poder leer ni una vez/)
    expect(r.stdout).not.toMatch(/foto inicial/)
  })

  it('it announces how many comments are not going to count', () => {
    const r = run({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comment('hola'), comment('qué tal')] }),
    }, { timeoutMs: 300, pollMs: 40 })
    expect(r.stdout).toMatch(/foto inicial: 2 comentario\(s\) ya presentes/)
  })
})

describe('the arguments and the deadlines', () => {
  it('without an issue, a repo or a session it does not start', () => {
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

  it('a deadline that cannot be understood aborts instead of falling back to the default in silence', () => {
    // Same criterion as CT_NEXT_LAUNCH_TIMEOUT_MS: a badly written deadline
    // changes what this process means, and you would not want to find that out
    // eight hours later.
    const r = run({ CT_WATCH_GO_POLL_MS: 'un rato' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/CT_WATCH_GO_POLL_MS inválido/)
  })
})

// The attempt that starts nothing, answered where the person is looking.
// Measured in jjponz/rust-monitoring#7: a bare `-OK`, silence, and eight minutes
// until the good go. The gate does NOT move because of this — it still only
// opens with the exact token—; what changes is that whoever tries finds out the
// format.
describe('a go attempt that starts nothing gets the format on the issue', () => {
  const withAttempt = (body) => {
    const counter = join(dir, `contador-intento-${++sequences}`)
    return {
      FAKE_GH_VIEW_COMMENTS_SEQUENCE: JSON.stringify([
        { comments: [] },
        { comments: [comment(body)] },
      ]),
      FAKE_GH_VIEW_COMMENTS_COUNTER_FILE: counter,
    }
  }
  // The log IS READ RAW and not split on newlines. The body that gets published
  // is multiline, so splitting it left `publicados()[0]` on the first fragment
  // of the body and the nonce assertion looked where the nonce was never going
  // to be. It came out of mutating: interpolating the hash at the END of the
  // body left the test green.
  const log = () => {
    try {
      return readFileSync(join(dir, 'argv.log'), 'utf8')
    } catch {
      return ''
    }
  }
  const howManyPublished = () => log().split('issue comment').length - 1

  it('it publishes the format when the new comment is the bare token', () => {
    run({ ...withAttempt(GO_TOKEN), FAKE_GH_ARGV_LOG_FILE: join(dir, 'argv.log') }, { timeoutMs: 1500, pollMs: 40 })
    expect(howManyPublished()).toBe(1)
    expect(log()).toContain('jjponz/repo-pulse')
  })

  it("the published body is the module's text, and carries NEITHER the nonce nor its hash", () => {
    run({ ...withAttempt(`${GO_TOKEN} deadbeef`), FAKE_GH_ARGV_LOG_FILE: join(dir, 'argv.log') }, { timeoutMs: 1500, pollMs: 40 })
    expect(howManyPublished()).toBe(1)
    expect(log()).toContain(GO_FORMAT_REPLY)
    expect(log()).not.toContain(NONCE)
    expect(log()).not.toContain(GO_HASH)
  })

  it('it publishes it ONCE even though the attempt is still there tick after tick', () => {
    run({
      FAKE_GH_VIEW_COMMENTS_SEQUENCE: JSON.stringify([
        { comments: [] },
        { comments: [comment(GO_TOKEN, 'IC_intento')] },
        { comments: [comment(GO_TOKEN, 'IC_intento')] },
        { comments: [comment(GO_TOKEN, 'IC_intento')] },
      ]),
      FAKE_GH_VIEW_COMMENTS_COUNTER_FILE: join(dir, `contador-repe-${++sequences}`),
      FAKE_GH_ARGV_LOG_FILE: join(dir, 'argv.log'),
    }, { timeoutMs: 1500, pollMs: 40 })
    expect(howManyPublished()).toBe(1)
  })

  it('a VALID go gets no explanation: it would be answering whoever got it right', () => {
    run({ ...withGo(), FAKE_GH_ARGV_LOG_FILE: join(dir, 'argv.log') })
    expect(howManyPublished()).toBe(0)
  })

  it('a comment that is not trying to give the go gets no explanation', () => {
    run({ ...withAttempt('me parece bien el plan'), FAKE_GH_ARGV_LOG_FILE: join(dir, 'argv.log') }, { timeoutMs: 1500, pollMs: 40 })
    expect(howManyPublished()).toBe(0)
  })

  it('if publishing fails, the watch goes on: the later go is delivered just the same', () => {
    const r = run({
      FAKE_GH_VIEW_COMMENTS_SEQUENCE: JSON.stringify([
        { comments: [] },
        { comments: [comment(GO_TOKEN, 'IC_intento')] },
        { comments: [comment(GO_TOKEN, 'IC_intento'), comment(GO, 'IC_bueno')] },
      ]),
      FAKE_GH_VIEW_COMMENTS_COUNTER_FILE: join(dir, `contador-fallo-${++sequences}`),
      FAKE_GH_ISSUE_COMMENT_FAIL: '1',
      // A ROOMY deadline and not a tight one, and the reason is a measured
      // regression: at 600 ms this case passed on its own and failed in the full
      // suite, because the go arrives on the THIRD poll and with a loaded
      // machine a tick takes longer than its budget. Here the deadline is not
      // the subject —the subject is that a failure to publish does not kill the
      // watch— and the process exits by itself as soon as it delivers, so
      // deadline to spare costs no time when it passes.
    }, { timeoutMs: 8000, pollMs: 40 })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/no se pudo publicar el formato/)
    expect(r.stdout).toMatch(new RegExp(`${GO_TOKEN} visto`))
  })
})
