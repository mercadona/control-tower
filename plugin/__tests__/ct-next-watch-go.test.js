// That the COORDINATOR launches the `-OK` watcher when dispatching, and only
// when there is something to watch.
//
// Why the watcher lives on this side and not on the agent's: this repo's
// doctrine says it five times —«el kickoff es un prompt, no un gate. Un agente
// que no lo llame se salta esta puerta» (dispatch-check.mjs), «ninguna exigencia
// que el spec le haga al agente puede depender de que el agente lea el spec»
// (kickoff.js)—. Asking the agent to watch its own gate would be an obligation
// created by a line of prompt. And the division of roles settles it: the
// coordinator «groomea, despacha, REVISA y mergea»; the dispatched one
// «implementa lo suyo Y PARA» (README).
//
// The real watcher is replaced by a recorder via CT_WATCH_GO_BIN: without that,
// every test that dispatches a slice would leave a process polling GitHub for
// eight hours.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { cmuxSessionName } from '../scripts/dispatch.js'
import { GO_TOKEN, goCommitment } from '../scripts/go-response.js'
import { goPath } from '../scripts/go-registry.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const script = join(HERE, '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(HERE, 'fixtures')
const RECORDER = join(fixturesDir, 'fake-watch-go-bin', 'recorder.mjs')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  join(fixturesDir, 'fake-osascript-bin'),
  process.env.PATH,
].join(':')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})
function newRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-watch-go-'))
  dirs.push(d)
  return d
}

// The child goes DETACHED and without an `unref` nobody is waited for, so
// ct-next can finish before the recorder writes. The file is polled instead of
// read once: otherwise the test would be flaky by construction.
//
// And the condition being waited for is that the log be COMPLETE, not that it
// exist. An `appendFileSync` is open, write and close: between the first and the
// second the file exists with zero bytes, and there `JSON.parse('')` blew up with
// «Unexpected end of JSON input» — the intermittent red of #109, which showed up
// in CI and not locally because it depends on how the load falls. The line is
// only taken as good once the newline that closes it is already written AND it
// parses.
function completeArgv(path) {
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf8')
  if (!raw.endsWith('\n')) return null
  try {
    return raw.trim().split('\n').map((l) => JSON.parse(l))
  } catch {
    return null
  }
}

async function waitForArgv(path, ms = 5000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const calls = completeArgv(path)
    if (calls) return calls
    await new Promise((r) => setTimeout(r, 25))
  }
  return null
}

function dispatch(repoRoot, issue, envExtra = {}) {
  const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...ACCOUNT_ENV,
      PATH: fakePath,
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      // The watcher's log goes to ~/.claude/control-tower/log/. In a test that
      // would be the $HOME of whoever runs it, so it is redirected with the REAL
      // variable the code already consults, not with a test trick.
      CLAUDE_CONFIG_DIR: join(repoRoot, 'claude-config'),
      CT_WATCH_GO_BIN: RECORDER,
      FAKE_WATCH_GO_LOG: join(repoRoot, 'watch-go-argv.log'),
      ...envExtra,
    },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const issueWith = (labels) => ({ number: 90, title: '#90 el cliente tipado', labels, body: '' })

describe('the coordinator launches the -OK watcher', () => {
  it('launches it when dispatching, with the issue, the repo and the exact title of the session', async () => {
    const repoRoot = newRepoRoot()
    // With no `gate:` label at all, resolveGatesForAgent falls back to the Tipo
    // — and the `plan` gate is implied in EVERY slice (gates.js#gatesForType).
    // Which means the default case DOES stop to wait, and therefore DOES bring a
    // watcher into play.
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }]))
    expect(r.code).toBe(0)
    expect(r.out).toContain(`vigilante del ${GO_TOKEN} de #90 lanzado`)

    const calls = await waitForArgv(join(repoRoot, 'watch-go-argv.log'))
    expect(calls).toHaveLength(1)
    const argv = calls[0]
    expect(argv).toContain('--issue')
    expect(argv[argv.indexOf('--issue') + 1]).toBe('90')
    expect(argv[argv.indexOf('--repo') + 1]).toBe('o/r')
    // The title is the HANDLE by which the watcher will find the session: there
    // is no stable identifier cmux returns when creating it. It is compared
    // against cmuxSessionName and not against a hand-written string, because a
    // second copy of that template would diverge and then the watcher would shut
    // down on its first poll saying the session no longer exists — that person's
    // go undelivered, and the message blaming the session instead of the
    // mismatch. The slice's name arrives already without the `#90 ` of the
    // issue's title: the issue mapping strips it, not this round.
    expect(argv[argv.indexOf('--session') + 1]).toBe(
      cmuxSessionName({ repoName: 'r', issue: 90, sliceName: 'el cliente tipado' }),
    )
    // The log is opened by the WATCHER, not by ct-next: when ct-next opened it,
    // the suite created files in the real $HOME of whoever ran it. Here only the
    // path travels.
    expect(argv[argv.indexOf('--log') + 1]).toMatch(/watch-go-90\.log$/)
  })

  it('says where the log is, because a process that runs when you are not looking and leaves no trace is undebuggable', () => {
    const repoRoot = newRepoRoot()
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }]))
    expect(r.out).toMatch(/Log: .*watch-go-90\.log/)
  })

  it('does NOT launch it if the slice has no `plan` gate: there is nothing to watch', async () => {
    const repoRoot = newRepoRoot()
    // `gate:none` is an explicit declaration of "no gate at all" (gates.js: it
    // exists precisely to tell it apart from "this issue is old"). A slice like
    // that does not stop to wait for anyone, and a process polling GitHub for
    // eight hours for nothing is worse than its absence.
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }, { name: 'gate:none' }]))
    expect(r.code).toBe(0)
    expect(r.out).not.toContain('vigilante del')
    expect(await waitForArgv(join(repoRoot, 'watch-go-argv.log'), 600)).toBe(null)
  })
})

describe('the watcher cannot bring the dispatch down', () => {
  // -------------------------------------------------------------------------
  // `spawn(process.execPath, [bin, …])` with a `bin` that DOES NOT EXIST does
  // not fail: the executable is always `node`. The process is born, dies
  // instantly with a module error, and before this fix «vigilante lanzado» was
  // announced with an already dead pid. An adversarial review caught it, and
  // pointed out that the test that claimed to cover it pinned both a broken bin
  // and an impossible log at once, so it passed through the log failure and the
  // broken bin was never tested.
  //
  // It is the same class of defect F19/H1 closed in the dispatch —«cmux returned
  // 0» is not «the command ran»— with even weaker evidence: the only thing
  // checked would be that `node` exists.
  // -------------------------------------------------------------------------
  it('a watcher program that does not exist is warned about, and is NOT announced as launched', async () => {
    const repoRoot = newRepoRoot()
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }]), {
      CT_WATCH_GO_BIN: join(repoRoot, 'no-existe', 'ni-de-broma.mjs'),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #90/)
    expect(r.out).toMatch(/no se ha lanzado el vigilante/)
    expect(r.out).toMatch(/no existe/)
    expect(r.out).not.toMatch(/vigilante del .* lanzado \(pid/)
    expect(r.out).toMatch(/a mano/)
    expect(await waitForArgv(join(repoRoot, 'watch-go-argv.log'), 600)).toBe(null)
  })

  it('if where the coordinator state lives is not known, it warns and the slice stays launched', () => {
    // The work is already under way when this runs. Not being able to watch the
    // go means going back to the old way —pushing the session by hand—, not
    // losing the slice. Same rule as the telemetry's `git add` in ct-step: the
    // thermometer is not part of the engine.
    //
    // F38 — WITH `HOME` AND `CLAUDE_CONFIG_DIR` EMPTY, THE FIRST THING THAT
    // FAILS IS NO LONGER THE LOG: it is the GO REGISTRY, which without an
    // absolute path refuses to write (go-registry.js) instead of leaving the
    // commitment in the cwd, where nobody would read it. Both halves of the
    // warning are asserted on purpose: before, this test only looked at the exit
    // code, so it would have stayed green with the warning talking about
    // something else — which is exactly what happened while building this
    // round.
    const repoRoot = newRepoRoot()
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }]), {
      CLAUDE_CONFIG_DIR: '',
      HOME: '',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #90/)
    expect(r.out).toMatch(/no se ha lanzado el vigilante/)
    expect(r.out).toMatch(/no se ha podido registrar el go/)
    // The remedy, named: with no registry, gate 9 will refuse, and there is a
    // command to get out of there.
    expect(r.out).toMatch(/ct-go\.mjs --issue 90 --repo o\/r/)
    // And no launched watcher is announced: with no registered commitment, a go
    // that started the work could not be honoured at release time.
    expect(r.out).not.toMatch(/vigilante del .* lanzado \(pid/)
  })

  // -------------------------------------------------------------------------
  // The watcher's only handle is the session's TITLE. If cmux has just answered
  // that there is no session with that title, launching it was announcing «the
  // session starts on its own» in the very same run in which that session is
  // said not to be findable. The repo has a whole test file against this class
  // of message (ct-next-honest-messages.test.js).
  // -------------------------------------------------------------------------
  it('is NOT launched when cmux cannot find the session that has just been created', async () => {
    const repoRoot = newRepoRoot()
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }]), {
      FAKE_CMUX_SKIP_STATE_SUBSTR: '#90',
    })
    expect(r.out).toMatch(/no se encontró ninguna sesión con el nombre/)
    expect(r.out).not.toMatch(/la sesión arranca sola/)
    expect(await waitForArgv(join(repoRoot, 'watch-go-argv.log'), 600)).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// F38 — THE GO'S NONCE COMES OUT ON THE SCREEN AND NOWHERE ELSE.
//
// It is the whole property of the round: the agent cannot FABRICATE the go
// because the nonce is not in its context, nor in the issue, nor in its
// worktree, nor in the argv of a process it can read with `ps`, nor in the
// watcher's log. What travels to all those places is the sha256. If a future
// change leaked the nonce into the argv, this round would stop being worth
// anything AND NOTHING ELSE WOULD FAIL — hence these tests look at where it is
// NOT.
// ---------------------------------------------------------------------------
describe('the go nonce: where it shows up and where it does not', () => {
  const nonceOf = (out) => (out.match(/-OK ([0-9a-f]{8})/) || [])[1]

  it('it is dictated on the screen, and only its sha256 reaches the watcher', async () => {
    const repoRoot = newRepoRoot()
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }]))
    expect(r.code).toBe(0)

    const nonce = nonceOf(r.out)
    expect(nonce).toMatch(/^[0-9a-f]{8}$/)
    expect(r.out).toContain(`GO de #90: contesta exactamente \`${GO_TOKEN} ${nonce}\``)

    const argv = (await waitForArgv(join(repoRoot, 'watch-go-argv.log')))[0]
    const hash = argv[argv.indexOf('--go-hash') + 1]
    // The hash is THE one of the dictated nonce: if they diverged, the person
    // would type the right permission and nothing would start.
    expect(hash).toBe(goCommitment(nonce))
    // And the nonce is NOT in the argv, which is what `ps` shows the agent.
    expect(argv.join(' ')).not.toContain(nonce)
  })

  it('the commitment is registered outside the repo, and without the nonce inside', () => {
    const repoRoot = newRepoRoot()
    const configDir = join(repoRoot, 'claude-config')
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }]))
    const nonce = nonceOf(r.out)

    const path = goPath({ repo: 'o/r', issue: 90, configDir })
    // Outside the repo on purpose: on GitHub everything is written by the agent,
    // which has `gh`; a commitment in a label would turn it into a one-move
    // game.
    expect(path.startsWith(configDir)).toBe(true)
    const datum = JSON.parse(readFileSync(path, 'utf8'))
    expect(datum.commitment).toBe(goCommitment(nonce))
    expect(readFileSync(path, 'utf8')).not.toContain(nonce)
  })

  it('with CT_GO_CHANNEL=notify the nonce does not pass through stdout: it enters NO agent context', () => {
    const repoRoot = newRepoRoot()
    const log = join(repoRoot, 'osascript.log')
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }]), {
      CT_GO_CHANNEL: 'notify',
      FAKE_OSASCRIPT_LOG: log,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/enviado por notificación del sistema/)
    expect(r.out).not.toMatch(/-OK [0-9a-f]{8}/)
    // The go does travel in the notification, and in a SEPARATE ARGUMENT:
    // nothing is interpolated inside the AppleScript, so there is nothing to
    // escape.
    const call = JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[0])
    expect(call[call.length - 1]).toMatch(new RegExp(`^\\${GO_TOKEN} [0-9a-f]{8}$`))
  })

  it('if the notification fails, it falls back to the screen SAYING SO — staying quiet would leave the gate with no go', () => {
    const repoRoot = newRepoRoot()
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }]), {
      CT_GO_CHANNEL: 'notify',
      FAKE_OSASCRIPT_FAIL: '1',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/la notificación del go de #90 falló/)
    // And it warns of the real consequence: the nonce DOES end up in this
    // context.
    expect(r.out).toMatch(/SÍ entra en el contexto de esta sesión/)
    expect(r.out).toMatch(/-OK [0-9a-f]{8}/)
  })

  it('with no `plan` gate no go is registered: there is nothing to authorise', () => {
    const repoRoot = newRepoRoot()
    const configDir = join(repoRoot, 'claude-config')
    const r = dispatch(repoRoot, issueWith([{ name: 'status:ready' }, { name: 'gate:none' }]))
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/GO de #90/)
    expect(existsSync(goPath({ repo: 'o/r', issue: 90, configDir }))).toBe(false)
  })
})
