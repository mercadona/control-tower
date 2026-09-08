// ===========================================================================
// F19/H1 — THE DISPATCHER REPORTED SUCCESS OVER AN AGENT THAT NEVER STARTED.
//
// First real dispatch of the loop against a production repository. `/ct-next
// --cap 1` exited with 0, said «lanzados 1/1» and added «verificado: la
// sesión cmux está corriendo en ese directorio». This is what was really in
// that terminal:
//
//     [oh-my-zsh] Would you like to update? [Y/n] laude --dangerously-skip-…
//     zsh: command not found: laude
//
// The single-character `read` of the oh-my-zsh prompt ate the `c` of `claude`
// while cmux was typing the command. What was left was an idle shell, in the
// right directory and with the right title. Measured consequence: twenty
// minutes in `status:in-progress` claimed by nobody, holding `area:plan` and
// the serialising `pbxproj` lane of the whole repository; zero commits, zero
// PRs.
//
// THE ROOT: what was checked was the CONTAINER (a cmux window exists with the
// title and the cwd that were asked for) instead of the CONTENT (the command
// got to run). The window is opened by the dispatcher itself — just as the
// "modified" `.agent/STATE.md` that also fooled the humans was its own seed. A
// trace of the tool taken for proof of the effect.
//
// These tests pin the property that matters above the concrete fix: **if it
// cannot be confirmed that the agent started up, the result cannot be
// "launched" with exit 0.**
// ===========================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import {
  buildLauncherScript, buildTypedCommand, parseSentinel, sameDir,
  SENTINEL_MAGIC, LAUNCHER_FILENAME, SENTINEL_FILENAME,
} from '../scripts/launch-sentinel.js'
import { shQuote } from '../scripts/shquote.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(here, 'fixtures')

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
  const d = mkdtempSync(join(tmpdir(), 'ct-f19-'))
  dirs.push(d)
  return d
}

const openIssue90 = { number: 90, title: '#90 algo', labels: [{ name: 'status:ready' }], body: '' }

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: fakePath, ...envOverrides },
  })
  return { code: r.status, pid: r.pid, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') }
}

function dispatchOne(repoRoot, envOverrides = {}) {
  return runReal(['--repo', 'o/r', '--cap', '1'], {
    FAKE_GIT_TOPLEVEL: repoRoot,
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
    FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    ...envOverrides,
  })
}

// ---------------------------------------------------------------------------
// The finding, reproduced exactly as it was
// ---------------------------------------------------------------------------
describe('F19/H1 — the shell eats the first character of the command', () => {
  it('it NEVER says "launched" nor exits with 0 when the command never got to run', () => {
    const repoRoot = makeRepoRoot()
    // Verified against the code with the fix NOT applied (with this very
    // stub, which does run the command): exit 0, «lanzados 1/1» and
    // «verificado: la sesión cmux está corriendo en ese directorio» — the
    // exact lie from the field.
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_EAT_FIRST_CHAR_SUBSTR: '#90',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '600',
    })
    expect(r.code).toBe(1)
    expect(r.all).not.toMatch(/verificado: la sesión cmux está corriendo/)
    expect(r.all).toMatch(/lanzados 0\/1 slice\(s\)/)
    expect(r.all).toMatch(/NO se puede confirmar que el comando llegara a ejecutarse/)
    // The TWO indistinguishable cases are named: it never claims which one.
    expect(r.all).toMatch(/el comando nunca corrió/)
    expect(r.all).toMatch(/ese shell sigue arrancando/)
    // And the residue is declared, with the exact commands.
    expect(r.all).toMatch(/quedaron LANZADOS SIN VERIFICAR/)
    expect(r.all).toMatch(/git worktree remove --force .*\.worktrees\/90/)
    expect(r.all).toMatch(/gh issue edit 90 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    expect(r.all).not.toMatch(/Nada quedó a medias/)
  })

  it('the happy path does say it, and says WHY it can say it', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot)
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/lanzado #90 en .*\.worktrees\/90/)
    expect(r.all).toMatch(/el comando llegó a ejecutarse de verdad \(centinela de arranque escrito por el propio shell/)
    expect(r.all).toMatch(/lanzados 1\/1 slice\(s\)/)
  })

  it('the command that is TYPED no longer carries the kickoff inside: the surface exposed to the pty goes from KB to one line', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })
    const cmuxLine = r.out.split('\n').find((l) => l.startsWith('cmux new-workspace'))
    expect(cmuxLine).toBeTruthy()
    // The kickoff is several KB; the whole cmux line has to fit comfortably
    // below that now that it only carries a `. <path>`.
    expect(cmuxLine.length).toBeLessThan(600)
    expect(cmuxLine).not.toMatch(/dangerously-skip-permissions/)
    // …but the dry-run CANNOT hide what is going to be run: the whole script
    // is printed, with the `claude` inside.
    expect(r.out).toMatch(/script de arranque que cmux sourcearía/)
    expect(r.out).toMatch(/claude --dangerously-skip-permissions/)
    expect(r.out).toMatch(/se espera hasta \d+ ms a que aparezca .*started/)
  })
})

// ---------------------------------------------------------------------------
// "it has not appeared yet" vs "it is not going to appear"
// ---------------------------------------------------------------------------
describe('F19/H1 — a slow sentinel is not an absent sentinel', () => {
  it('the shell takes its time, but within the cap: it counts as launched', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_COMMAND_DELAY_MS: '700',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '8000',
    })
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/lanzado #90 en .*centinela de arranque escrito/)
  })

  it('the same slow shell with a short cap: it does NOT count, and the message names the variable it is tuned with', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_COMMAND_DELAY_MS: '3000',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '400',
    })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/NO apareció en 400 ms/)
    expect(r.all).toMatch(/sube CT_NEXT_LAUNCH_TIMEOUT_MS \(ahora 400\)/)
    expect(r.all).not.toMatch(/verificado: la sesión cmux está corriendo/)
  })

  it('an invalid CT_NEXT_LAUNCH_TIMEOUT_MS aborts with exit 2 before touching anything, instead of picking a cap on its own', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, { CT_NEXT_LAUNCH_TIMEOUT_MS: 'un rato' })
    expect(r.code).toBe(2)
    expect(r.all).toMatch(/CT_NEXT_LAUNCH_TIMEOUT_MS inválido/)
    expect(r.all).not.toMatch(/claimed #90/)
  })
})

// ---------------------------------------------------------------------------
// What the sentinel knows and the window does not
// ---------------------------------------------------------------------------
describe('F19/H1 — the sentinel sees what no query to cmux can see', () => {
  it('`claude` does not resolve in the login shell: negative certainty → EVERYTHING is undone (the claim included)', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, { FAKE_CMUX_NO_CLAUDE_IN_SHELL: '1', CT_NEXT_LAUNCH_TIMEOUT_MS: '4000' })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/`claude` NO resuelve en ese shell de login/)
    // This is the ONLY case with certainty that there will be no agent, so it
    // is the only one where reverting the claim cannot destroy live work.
    expect(r.all).toMatch(/claim revertido automáticamente a status:ready|worktree y rama de #90 limpiados automáticamente/)
    expect(r.all).not.toMatch(/lanzado #90/)
  })

  it('the shell started up in ANOTHER directory: its own $PWD gives it away, not what cmux says about its window — and nothing is deleted', () => {
    const repoRoot = makeRepoRoot()
    const otherDir = mkdtempSync(join(tmpdir(), 'ct-f19-otro-'))
    dirs.push(otherDir)
    const r = dispatchOne(repoRoot, { FAKE_CMUX_COMMAND_CWD: otherDir, CT_NEXT_LAUNCH_TIMEOUT_MS: '4000' })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/el shell que lo ejecutó estaba en/)
    expect(r.all).toMatch(/NO se cuenta como lanzado con éxito, y NO se borra nada/)
    expect(r.all).toMatch(/quedaron LANZADOS SIN VERIFICAR/)
    // A live agent in the wrong place is NOT cleaned up on its own.
    expect(r.all).not.toMatch(/claim revertido automáticamente/)
  })

  it('cmux cannot be queried, but the sentinel is there: that is no longer "the benefit of the doubt", it is evidence', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, { FAKE_CMUX_LIST_WINDOWS_FAIL: '1' })
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/no se pudo verificar la sesión de cmux/)
    expect(r.all).toMatch(/pero el comando SÍ llegó a ejecutarse/)
  })
})

// ---------------------------------------------------------------------------
// The format of the sentinel, in a unit test
// ---------------------------------------------------------------------------
describe('F19/H1 — format of the sentinel (unit)', () => {
  const q = shQuote
  it('the script writes the sentinel BEFORE launching the agent: were it after, it would only appear once it had finished', () => {
    const s = buildLauncherScript({ sentinelPath: '/tmp/s', agentCommand: 'claude --x', agentBin: 'claude', issue: 7, worktree: '/wt' }, q)
    expect(s.indexOf('/tmp/s')).toBeLessThan(s.indexOf('claude --x'))
    expect(s).toMatch(/command -v claude/)
  })

  it('what gets typed is a single short line, and it sources (does not execute) so the aliases/functions of the user survive', () => {
    const t = buildTypedCommand('/tmp/x/launch.sh', q)
    expect(t).toBe(". '/tmp/x/launch.sh'")
    expect(t).not.toMatch(/\n/)
  })

  it('a sentinel of another version, truncated, or with garbage is NOT interpreted: null is returned', () => {
    expect(parseSentinel(`${SENTINEL_MAGIC}\t1\tok\t/wt`)).toEqual({ version: '1', claudeResolved: true, cwd: '/wt' })
    expect(parseSentinel(`${SENTINEL_MAGIC}\t1\tmissing\t/wt`).claudeResolved).toBe(false)
    expect(parseSentinel(`${SENTINEL_MAGIC}\t2\tok\t/wt`)).toBe(null) // a future version
    expect(parseSentinel(`otra-cosa\t1\tok\t/wt`)).toBe(null)
    expect(parseSentinel(`${SENTINEL_MAGIC}\t1\tok`)).toBe(null) // truncated
    expect(parseSentinel(`${SENTINEL_MAGIC}\t1\tquizá\t/wt`)).toBe(null)
    expect(parseSentinel('')).toBe(null)
  })

  it('a path with tabs inside survives: the $PWD is the LAST field on purpose', () => {
    expect(parseSentinel(`${SENTINEL_MAGIC}\t1\tok\t/a\tb/c`).cwd).toBe('/a\tb/c')
  })

  it('sameDir tolerates symlinks (on macOS /tmp is /private/tmp): comparing bare strings would give false "wrong directory"', () => {
    const real = (p) => (p === '/tmp/x' ? '/private/tmp/x' : p)
    expect(sameDir('/tmp/x', '/private/tmp/x', real)).toBe(true)
    expect(sameDir('/tmp/x', '/otro', real)).toBe(false)
    expect(sameDir('/a', '/a', () => null)).toBe(true) // literal equality, without touching disk
  })

  it('the kickoff travels by DISK, escaped, not typed: a kickoff with quotes and `$` does not break the script', () => {
    const nasty = `no "toques" $HOME ni \`esto\` ni 'aquello'`
    const d = mkdtempSync(join(tmpdir(), 'ct-f19-sh-'))
    dirs.push(d)
    // `printf` in the slot of the agent — NEVER `claude`: this test runs on
    // the machine of whoever executes it, and a stub slipping in through PATH
    // would invoke the real `claude`. (It happened while writing this very
    // test, with a `replace('claude ', …)` that matched first against the
    // `command -v claude ` of the script itself: the shell ended up running
    // the real Claude.) What is being tested is the ESCAPING, and for that the
    // program does not matter.
    const s = buildLauncherScript(
      { sentinelPath: join(d, 'out'), agentCommand: `printf '%s' ${q(nasty)}`, agentBin: 'claude', issue: 1, worktree: '/wt' },
      q
    )
    const f = join(d, 'l.sh')
    writeFileSync(f, s)
    const r = spawnSync('/bin/sh', ['-c', `. ${q(f)} > ${q(join(d, 'arg'))}`], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(readFileSync(join(d, 'arg'), 'utf8')).toBe(nasty)
  })

  it('the script is NOT written executable, and that is part of the detection: were it so, eating the `.` would still launch the agent and the corruption would be invisible', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot)
    expect(r.code).toBe(0)
    // The start-up directory carries the pid of ct-next.mjs and the issue
    // number, plus a random suffix (F20: PIDs get recycled and these
    // directories are never deleted — a deterministic name collided).
    // `spawnSync` gives us the pid, so it is located by prefix and what is
    // read is the file ct-next.mjs really wrote, not a reconstruction.
    const prefix = `ct-next-launch-${r.pid}-90-`
    const dirName = readdirSync(tmpdir()).find((n) => n.startsWith(prefix))
    expect(dirName, `no se encontró ningún directorio de arranque ${prefix}*`).toBeDefined()
    const f = join(tmpdir(), dirName, LAUNCHER_FILENAME)
    dirs.push(dirname(f))
    const mode = statSync(f).mode & 0o777
    expect(mode & 0o111).toBe(0) // neither user, nor group, nor other
    expect(mode).toBe(0o600)
    // And the sentinel the shell wrote is beside it, with the magic inside.
    expect(readFileSync(join(dirname(f), SENTINEL_FILENAME), 'utf8')).toMatch(new RegExp(`^${SENTINEL_MAGIC}\t`))
  })
})

// ===========================================================================
// F19/H2 — THE AGGREGATE WARNING IS CORRECT BUT STATIC.
//
// F18 added an aggregate warning of CLOSED issues that keep a live `status:`
// label. The shape is the right one (one paragraph, grouped by status, with
// the `in-review` ones counted apart for not being an anomaly) and even so
// anybody will skip it from the third run on: those ten cases do not change on
// their own, so the warning prints the SAME paragraph for ever. A third way
// for a warning to stop being of use, different from the unsatisfiable wall
// (F14) and from noise by volume (F16): repetition with no news. And then, the
// day a new one turns up, it is not seen.
//
// Two fixes: (1) the severity gradient that was flattened inside the
// aggregate, and (2) an acknowledgement PER CASE reusing
// `.agent/conventions-ack.md`.
// ===========================================================================
function closedWith(n, status) {
  return { number: n, state_reason: 'completed', body: `<!-- ct-order:${n} -->`, labels: [{ name: `status:${status}` }] }
}
const open42 = { number: 42, title: '#42 x', body: '<!-- ct-order:99 -->', labels: [{ name: 'status:ready' }, { name: 'touches:ui' }] }

function runResidue(repoRoot, closedIssues) {
  return runReal(['--repo', 'o/r', '--dry-run'], {
    FAKE_GIT_TOPLEVEL: repoRoot,
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([[open42], closedIssues]),
    FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
  })
}
function residueLine(r) {
  return r.err.split('\n').find((l) => /^aviso: \d+ issue\(s\) CERRADOS/.test(l)) || ''
}
function writeAck(repoRoot, text) {
  mkdirSync(join(repoRoot, '.agent'), { recursive: true })
  writeFileSync(join(repoRoot, '.agent', 'conventions-ack.md'), text)
}

describe('F19/H2 — the severity gradient that was flattened', () => {
  it('a closed one with status:blocked is inert: it does not enter the anomaly count, it is counted apart', () => {
    const repoRoot = makeRepoRoot()
    const r = runResidue(repoRoot, [closedWith(101, 'ready'), closedWith(102, 'blocked')])
    const l = residueLine(r)
    // Verified against the unfixed code: it said «2 issue(s) CERRADOS»,
    // throwing into the same sack the one that fell out of the dispatch queue
    // and the one nobody cares about.
    expect(l).toMatch(/^aviso: 1 issue\(s\) CERRADOS/)
    expect(l).toMatch(/#101/)
    expect(l).toMatch(/#102/) // it shows up, but as an inert count, not as an anomaly
    expect(l).toMatch(/inerte|no bloquea|no le pasa nada/i)
  })

  it('ready comes first and is said to be the serious one; in-progress after it', () => {
    const repoRoot = makeRepoRoot()
    const r = runResidue(repoRoot, [closedWith(101, 'in-progress'), closedWith(102, 'ready')])
    const l = residueLine(r)
    expect(l).toMatch(/^aviso: 2 issue\(s\) CERRADOS/)
    expect(l.indexOf('#102')).toBeLessThan(l.indexOf('#101'))
  })

  it('if EVERYTHING left over is inert or terminal, there is no anomaly and nobody shouts', () => {
    const repoRoot = makeRepoRoot()
    const r = runResidue(repoRoot, [closedWith(101, 'blocked'), closedWith(102, 'in-review')])
    expect(residueLine(r)).toBe('')
    expect(r.err).not.toMatch(/CERRADOS conservan una label `status:` viva/)
  })
})

describe('F19/H2 — acknowledgement PER CASE: keep quiet about these numbers, go on warning about the new ones', () => {
  it('the acknowledged numbers disappear from the warning and the new ones go on coming out', () => {
    const repoRoot = makeRepoRoot()
    writeAck(repoRoot, 'residuo-status: 2026-07-28 — #101, #102 revisados: slices descartados, las labels se quedan.\n')
    const r = runResidue(repoRoot, [closedWith(101, 'ready'), closedWith(102, 'ready'), closedWith(103, 'ready')])
    const l = residueLine(r)
    expect(l).toMatch(/^aviso: 1 issue\(s\) CERRADOS/)
    expect(l).toMatch(/#103/)
    expect(l).not.toMatch(/#101/)
    expect(l).not.toMatch(/#102/)
    // The acknowledgement is recognised, and how many it silences is said —
    // but only when there is something live to say; otherwise it would be the
    // same static noise all over again.
    expect(l).toMatch(/2 más ya acusados/)
  })

  it('with ALL of them acknowledged the warning disappears entirely: that is the point', () => {
    const repoRoot = makeRepoRoot()
    writeAck(repoRoot, '# decisiones\n\nresiduo-status: 2026-07-28 — #101, #102 son slices descartados.\n')
    const r = runResidue(repoRoot, [closedWith(101, 'ready'), closedWith(102, 'in-progress')])
    expect(residueLine(r)).toBe('')
    expect(r.err).not.toMatch(/2 más ya acusados/)
  })

  it('the acknowledgement accumulates across lines (one decision per date), instead of treating them as duplicates', () => {
    const repoRoot = makeRepoRoot()
    writeAck(repoRoot, 'residuo-status: 2026-07-01 — #101 descartado.\nresiduo-status: 2026-07-28 — #102 también.\n')
    const r = runResidue(repoRoot, [closedWith(101, 'ready'), closedWith(102, 'ready')])
    expect(residueLine(r)).toBe('')
    expect(r.err).not.toMatch(/ya estaba acusada más arriba/)
  })

  it('an acknowledgement with NO numbers silences nothing and says so: believing you have silenced something and not having done it is the failure we cannot afford', () => {
    const repoRoot = makeRepoRoot()
    writeAck(repoRoot, 'residuo-status: 2026-07-28 — ya lo he mirado todo, da igual.\n')
    const r = runResidue(repoRoot, [closedWith(101, 'ready')])
    expect(residueLine(r)).toMatch(/^aviso: 1 issue\(s\) CERRADOS/)
    expect(r.err).toMatch(/no silencia nada/)
  })

  it('the warning teaches how to acknowledge: without that, the way out exists but nobody finds it', () => {
    const repoRoot = makeRepoRoot()
    const r = runResidue(repoRoot, [closedWith(101, 'ready')])
    expect(residueLine(r)).toMatch(/\.agent\/conventions-ack\.md/)
    expect(residueLine(r)).toMatch(/residuo-status: \d{4}-\d{2}-\d{2}/)
  })
})
