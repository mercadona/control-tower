// D5 — "messages that assert the opposite of what happened".
//
// Every case of this file was REPRODUCED first against the unfixed code
// (main @ ab2d697) before touching anything, and every test was checked RED
// against that same code: if it does not fail there, it proves nothing. The
// detail of each reproduction is in the task's report.
//
// Common family: something diverges from what the user believes and the system
// reports success, or the message asserts something that is not true.
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  const d = mkdtempSync(join(tmpdir(), 'ct-next-d5-'))
  dirs.push(d)
  return d
}

function runReal(args, envOverrides = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: fakePath, ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const openIssue90 = { number: 90, title: '#90 algo', labels: [{ name: 'status:ready' }], body: '' }
const openIssue91 = { number: 91, title: '#91 otro', labels: [{ name: 'status:ready' }], body: '' }

function baseEnv(repoRoot, issues = [openIssue90]) {
  return {
    FAKE_GIT_TOPLEVEL: repoRoot,
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([issues, []]),
    FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    FAKE_GH_ARGV_LOG_FILE: join(repoRoot, 'gh-argv'),
    FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
  }
}
const readOrEmpty = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

// ---------------------------------------------------------------------------
// Finding B — an unrecognised schema field cannot degrade into
// "verificado que está mal"
// ---------------------------------------------------------------------------
describe('D5/B — cmux renames ONLY `current_directory`', () => {
  // Reproduced against the unfixed code with this very fixture: the output
  // said `está en "null" en su lugar` (a false 'wrong-cwd' on EVERY correct
  // launch) and the run exited with EXIT=3 instead of 0. The previous schema
  // guard only covered `custom_title`, which is still recognised here, so it
  // saved nothing.
  it('it does not treat it as a wrong cwd: the session exists, the directory is the only thing that could not be checked', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      FAKE_CMUX_CWD_FIELD_RENAMED: '1',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzados 1\/1 slice\(s\) seleccionados de esta tanda/)
    expect(r.out).toMatch(/la sesión de cmux con el título esperado EXISTE, pero cmux no expuso un directorio legible/)
    // Never the false alarm, nor the "verificado" that cannot be asserted
    // either.
    expect(r.out).not.toMatch(/la sesión NO está en/)
    expect(r.out).not.toMatch(/NO se cuenta como lanzado con éxito/)
    expect(r.out).not.toMatch(/verificado: la sesión cmux está corriendo/)
    expect(r.out).not.toMatch(/LANZADOS SIN VERIFICAR/)
  })

  it('with a REALLY different cwd (field present and readable) the wrong-cwd is still detected', () => {
    // Control for the previous test: the fix relaxes ONLY the unknown-schema
    // case; the real detection cannot have been lost along the way.
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      FAKE_CMUX_WRONG_CWD_SUBSTR: '#90',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/la sesión NO está en/)
  })
})

// ---------------------------------------------------------------------------
// Finding A — exit 3 meant two things and its message described only one
// ---------------------------------------------------------------------------
describe('D5/A — exit 3 only when nothing really was left half-done', () => {
  // Reproduced unfixed: with ALL the candidates skipped when claiming, the
  // exit was already 3, and the message ("Nada quedó a medias ni bloqueado")
  // was true. This test pins that case down so that the narrowing of exit 3
  // does not take it down with it.
  it('every candidate collides when claiming → exit 3, and the message can assert there is nothing to clean up', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      // dispatch-check's collision check sees another issue in flight with
      // the same token → collision, exit 1 ('skip'), writing nothing.
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:zzz']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([
        [openIssue90],
        [],
        [{ number: 5, labels: [{ name: 'status:in-progress' }, { name: 'touches:zzz' }] }],
      ]),
    })
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/lanzados 0\/1 slice\(s\) seleccionados de esta tanda/)
    expect(r.out).toMatch(/Ningún claim quedó escrito, ninguna rama ni worktree se creó, y no hay nada que limpiar a mano/)
    expect(r.out).not.toMatch(/LANZADOS SIN VERIFICAR/)
    // And nothing really was left behind: no claim written, no worktree
    // created.
    expect(readOrEmpty(join(repoRoot, 'gh-argv'))).not.toMatch(/issue edit 90 .*--add-label status:in-progress/)
    expect(readOrEmpty(join(repoRoot, 'git-log'))).not.toMatch(/worktree add/)
  })
})

// ---------------------------------------------------------------------------
// Finding D — our own timeout cannot present itself as somebody else's
// interruption
// ---------------------------------------------------------------------------
describe('D5/D — our own SIGKILL through CT_NEXT_CHILD_TIMEOUT_MS over dispatch-check', () => {
  // Reproduced unfixed: "dispatch-check para #90 terminó por la señal SIGKILL
  // mientras intentaba reclamar" + "antes de esta interrupción", naming
  // neither the cap nor the variable — blaming an interruption on somebody who
  // interrupted nothing.
  it("it names the cap, the variable, and says explicitly that it was not the user's interruption", () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      FAKE_GH_EDIT_DELAY_MS: '5000', // dispatch-check stays inside its `gh issue edit`
      CT_NEXT_CHILD_TIMEOUT_MS: '1000',
      // F8 — same correction as in ct-next-signal-interrupt.test.js: the short
      // cap applies ONLY to the child this test blocks on purpose. With the
      // global cap, the 1000ms applied to the legitimate `gh api .../issues`
      // and `git rev-parse` that ct-next makes BEFORE reaching dispatch-check
      // too, and under load any of them could exhaust it first: the message
      // this test checks would never get printed. Here the result is
      // deterministic by construction — dispatch-check stays 5000ms inside its
      // `gh issue edit`, that is, five times the cap, whatever happens to the
      // machine.
      CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE: 'dispatch-check',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no terminó dentro del límite de 1000ms \(CT_NEXT_CHILD_TIMEOUT_MS\)/)
    expect(r.out).toMatch(/lo matamos NOSOTROS con SIGKILL — no fue una interrupción tuya/)
    expect(r.out).toMatch(/sube CT_NEXT_CHILD_TIMEOUT_MS/)
    expect(r.out).toMatch(/gh issue edit 90 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    // The text no longer calls what WE did an "interrupción".
    expect(r.out).not.toMatch(/antes de esta interrupción/)
  })
})

// ---------------------------------------------------------------------------
// Finding G — validated test hooks, and a net for ANY exception in the
// dangerous window
// ---------------------------------------------------------------------------
describe('D5/G — the window between the claim and the worktree no longer leaves orphans because of an exception', () => {
  // Reproduced unfixed: `claimed #90 → in-progress` in the output,
  // ERR_UNKNOWN_SIGNAL in ct-next.mjs, NO revert in gh's log, orphan issue.
  it('an invalid value in CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM aborts with exit 2 BEFORE touching gh', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM: 'pepe',
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM inválido: "pepe"/)
    expect(r.out).toMatch(/SIGINT, SIGTERM/)
    // Not a single gh command: it aborts before reading anything.
    expect(readOrEmpty(join(repoRoot, 'gh-argv'))).toBe('')
    // The message NAMES ERR_UNKNOWN_SIGNAL in order to explain why it
    // validates, but there cannot be a stack trace showing it was ever
    // thrown.
    expect(r.out).not.toMatch(/at process\.kill/)
    expect(r.out).not.toMatch(/TypeError \[ERR_UNKNOWN_SIGNAL\]/)
    expect(r.out).not.toMatch(/claimed #90/)
  })

  it('the same for the idle checkpoint hook', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT: 'SIGKILL', // valid for the OS, but with NO handler here
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT inválido: "SIGKILL"/)
  })

  // The ROOT part: validating the hook does not fix the hole, only one case.
  // ANY throw in that window left the issue orphaned.
  it('any exception after the claim reverts the claim, says so, and prints the full stack trace', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      CT_NEXT_TEST_THROW_AFTER_CLAIM: 'boom-de-prueba',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/excepción no capturada en ct-next\.mjs — esto es un bug/)
    expect(r.out).toMatch(/boom-de-prueba/)
    expect(r.out).toMatch(/at file:/) // the stack trace is not hidden
    expect(r.out).toMatch(/#90 tenía un claim \(status:in-progress\) sin worktree completado/)
    expect(r.out).toMatch(/claim de #90 revertido automáticamente a status:ready/)
    const argv = readOrEmpty(join(repoRoot, 'gh-argv'))
    // EXACTLY one claim and EXACTLY one revert — neither zero (the bug), nor
    // two.
    expect((argv.match(/issue edit 90 --repo o\/r --add-label status:in-progress/g) || []).length).toBe(1)
    expect((argv.match(/issue edit 90 --repo o\/r --add-label status:ready/g) || []).length).toBe(1)
    // The worktree never got created.
    expect(readOrEmpty(join(repoRoot, 'git-log'))).not.toMatch(/worktree add/)
  })

  it('if the emergency revert ALSO fails, it says so with the manual command instead of keeping quiet about it', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      CT_NEXT_TEST_THROW_AFTER_CLAIM: 'boom-de-prueba',
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready --remove-label status:in-progress',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN: no se pudo revertir automáticamente el claim de #90/)
    expect(r.out).toMatch(/gh issue edit 90 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })
})

// ---------------------------------------------------------------------------
// Finding F (collateral, the most serious one outside the assignment) — a
// writeSync that fails cannot turn a SUCCESSFUL claim into an "unexpected
// failure"
// ---------------------------------------------------------------------------
describe("D5/F — forwarding dispatch-check's output does not decide the result of the claim", () => {
  // Reproduced unfixed, with the READING end of stdout closed (the real case
  // of `ct-next | head`, or a caller that stopped reading): the claim of #90
  // WAS written (it shows up in gh's log, with its readback behind it), but
  // the later `writeSync(1, out)` threw EPIPE INSIDE attemptClaim's try, the
  // catch read it as the subprocess's failure (`e.status` undefined) and
  // ct-next printed "dispatch-check devolvió un fallo inesperado […]
  // probablemente es un bug o una mala configuración", aborted the batch with
  // exit 1 and did NOT revert: an orphan issue for not having been able to
  // print one line.
  it('with stdout closed, a successful claim is NOT reported as an unexpected failure nor does it abort the batch', async () => {
    const repoRoot = makeRepoRoot()
    const child = spawn(process.execPath, [script, '--repo', 'o/r', '--cap', '1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: fakePath, ...baseEnv(repoRoot) },
    })
    let err = ''
    child.stderr.on('data', (d) => { err += d.toString() })
    child.stdout.destroy() // closes the reading end: every write to fd 1 gives EPIPE
    const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)))

    expect(err).not.toMatch(/fallo inesperado/)
    expect(err).not.toMatch(/probablemente es un bug o una mala configuración/)
    expect(err).not.toMatch(/Abortando toda la tanda/)
    expect(code).toBe(0)
    const argv = readOrEmpty(join(repoRoot, 'gh-argv'))
    // The claim was written ONCE and was NOT reverted: the slice really was
    // dispatched, which is what really happened.
    expect((argv.match(/issue edit 90 --repo o\/r --add-label status:in-progress/g) || []).length).toBe(1)
    expect(argv).not.toMatch(/issue edit 90 --repo o\/r --add-label status:ready/)
    expect(readOrEmpty(join(repoRoot, 'git-log'))).toMatch(/worktree add -b feat\/90/)
  })

  // Brother of the previous one, in dispatch-check.mjs, and worse: ct-next
  // captures dispatch-check's output through a pipe it DOES read, but the
  // kickoff the agents receive brings the literal command so it can be run by
  // hand, and a human puts it through `| head` without thinking twice.
  //
  // Reproduced against the unfixed code: the claim of #90 was written
  // SUCCESSFULLY (`issue edit 90 --add-label status:in-progress` + its
  // readback in gh's log) and the process died with an EPIPE stack trace in
  // the final `outLine`, exiting with 1 — which in THIS file's contract is
  // 'skip': "a collision or a lost race, nothing mutated". A claim obtained
  // read as a claim that never happened.
  it('dispatch-check with stdout closed: the exit code still describes the protocol, not the pipe', async () => {
    const repoRoot = makeRepoRoot()
    const dcScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
    const argvLog = join(repoRoot, 'gh-argv')
    const child = spawn(process.execPath, [dcScript, '90', '--repo', 'o/r'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: fakePath,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], []]),
        FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-count'),
        FAKE_GH_ARGV_LOG_FILE: argvLog,
        FAKE_GH_VIEW_LABELS: JSON.stringify([]),
      },
    })
    let err = ''
    child.stderr.on('data', (d) => { err += d.toString() })
    child.stdout.destroy()
    const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)))

    // 0 = claim confirmed, which is exactly what happened.
    expect(code).toBe(0)
    expect(err).not.toMatch(/EPIPE/)
    expect((readOrEmpty(argvLog).match(/issue edit 90 --repo o\/r --add-label status:in-progress/g) || []).length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Finding H — the dry-run shows the whole batch in one go
// ---------------------------------------------------------------------------
describe('D5/H — --dry-run with taken destinations', () => {
  it('with --cap 3 and two destinations taken: it reports BOTH, shows the plan of all THREE, says which one would break first, and exits 1', () => {
    const repoRoot = makeRepoRoot()
    const issues = [
      { number: 91, title: '#91 a', labels: [{ name: 'status:ready' }], body: '' },
      { number: 92, title: '#92 b', labels: [{ name: 'status:ready' }], body: '' },
      { number: 93, title: '#93 c', labels: [{ name: 'status:ready' }], body: '' },
    ]
    const r = runReal(['--repo', 'o/r', '--cap', '3', '--dry-run'], {
      ...baseEnv(repoRoot, issues),
      FAKE_GIT_STALE_BRANCH_EXISTS: '92,93',
    })
    expect(r.code).toBe(1)
    // Both problems, not only the first one.
    expect(r.out).toMatch(/precondiciones NO cumplidas \(2\)/)
    expect(r.out).toMatch(/la rama feat\/92 ya existe/)
    expect(r.out).toMatch(/la rama feat\/93 ya existe/)
    // The plan of all THREE slices, the healthy one included — before, not
    // one was printed.
    expect(r.out).toMatch(/=== slice #91 /)
    expect(r.out).toMatch(/=== slice #92 /)
    expect(r.out).toMatch(/=== slice #93 /)
    // Each slice's problem, in ITS own block.
    expect(r.out).toMatch(/=== slice #92 \(b\) ===\nPRECONDICIÓN NO CUMPLIDA \(1\) para este slice/)
    // And "destino libre" only where it is true.
    expect(r.out).toMatch(/destino libre: .*\.worktrees\/91 no existe y la rama feat\/91 tampoco/)
    expect(r.out).toMatch(/destino: .*\.worktrees\/92 \/ rama feat\/92 — NO LIBRE/)
    expect(r.out).not.toMatch(/destino libre: .*\.worktrees\/92/)
    // Counts and "which one would break first", with no ambiguity.
    expect(r.out).toMatch(/De los 3 slice\(s\) seleccionados, 2 tienen precondiciones sin cumplir \(#92, #93\); 1 sin problemas propios \(#91\)\. En una corrida real, el primero que rompería es #92/)
    expect(r.out).toMatch(/NO es luz verde/)
    // A dry-run touches nothing, whatever happens.
    expect(readOrEmpty(join(repoRoot, 'gh-argv'))).not.toMatch(/issue edit/)
    expect(readOrEmpty(join(repoRoot, 'git-log'))).not.toMatch(/worktree add/)
  })

  it('the REAL run still aborts before writing any claim, and with the same summary', () => {
    // The asymmetry is deliberate and bounded: the two of them check the same
    // thing and the two of them fail; all that changes is how much gets
    // printed AFTER failing.
    const repoRoot = makeRepoRoot()
    const issues = [
      { number: 91, title: '#91 a', labels: [{ name: 'status:ready' }], body: '' },
      { number: 92, title: '#92 b', labels: [{ name: 'status:ready' }], body: '' },
    ]
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      ...baseEnv(repoRoot, issues),
      FAKE_GIT_STALE_BRANCH_EXISTS: '92',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ni un solo claim escrito: se comprueba antes de tocar GitHub/)
    expect(r.out).toMatch(/el primero que rompería es #92/)
    expect(r.out).not.toMatch(/=== slice #91 /) // the plan is the dry-run's business
    expect(readOrEmpty(join(repoRoot, 'gh-argv'))).not.toMatch(/issue edit/)
  })
})

// ---------------------------------------------------------------------------
// A finding of our own (D5 review) — "NO COMPROBADOS (modo fixture)" in a
// dry-run that is not a fixture one
// ---------------------------------------------------------------------------
describe('D5 (self-review) — the dry-run cannot call a query that failed "modo fixture"', () => {
  // Reproduced against the unfixed code: a REAL --dry-run (with no
  // CT_NEXT_FIXTURE) whose branch query fails fell into the same `false`
  // boolean as fixture mode, and printed "NO COMPROBADOS (modo fixture:
  // repoRoot sintético, no se toca git). En una corrida real sí se comprueban
  // antes de reclamar" — three false assertions in a row: it was not a
  // fixture, the repoRoot was real, git WAS touched, and the real run will
  // make this very same failed check.
  it('it tells "it was not looked at" (fixture) apart from "it was looked at and it failed"', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      ...baseEnv(repoRoot),
      FAKE_GIT_REV_PARSE_BROKEN: '1', // the branch query exits with 128, not with 1
    })
    expect(r.code).toBe(0) // 'unknown' is a warning, never a hard failure: we do not know it is taken
    expect(r.out).toMatch(/SIN CONFIRMAR: la consulta a git se intentó y FALLÓ/)
    expect(r.out).toMatch(/Esto NO es modo fixture/)
    expect(r.out).not.toMatch(/NO COMPROBADOS \(modo fixture/)
    // And it cannot assert that the destination is free either.
    expect(r.out).not.toMatch(/destino libre/)
  })

  it('in fixture mode it DOES say "modo fixture" (the correct message is not lost along the way)', () => {
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: JSON.stringify({
        issues: [{ n: 90, order: 1, status: 'ready', deps: [], touches: ['a'], name: 'algo', type: 'backend' }],
        mergedIssues: [],
      }),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/NO COMPROBADOS \(modo fixture/)
    expect(r.out).not.toMatch(/SIN CONFIRMAR/)
  })
})

// ---------------------------------------------------------------------------
// Finding C — a Ctrl-C is never discarded in silence
// ---------------------------------------------------------------------------
describe('D5/C — a SIGINT that arrives with the work already done', () => {
  // Reproduced unfixed with exactly this setup (--cap 1, the signal sent ONLY
  // to the node process while it is blocked inside `git worktree add`):
  // EXIT=0, "lanzados 1/1", and NOT A TRACE that anything had been pressed.
  // The handler only runs when the event loop gets control back, and with cap
  // 1 there was no `await` left ahead.
  it('--cap 1: the signal is acknowledged, it exits with 130, and nothing already done is undone', async () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const child = spawn(process.execPath, [script, '--repo', 'o/r', '--cap', '1'], {
      env: {
        ...process.env,
                PATH: fakePath,
        ...baseEnv(repoRoot),
        // F8 — a handshake instead of a window. Before, this was
        // FAKE_GIT_WORKTREE_ADD_DELAY_MS: '2000', that is, "git worktree add
        // takes 2s and we trust this process to react within those 2s".
        // Reacting in time depended on the OS scheduler giving us CPU, not on
        // the code under test. Now `git worktree add` stays STOPPED until this
        // test releases it: the real blocking call after the second checkpoint
        // (where the finding says the signal was being lost) is still exactly
        // the same one, but its duration is no longer a bet.
        FAKE_GIT_WORKTREE_ADD_WAIT_FILE: join(repoRoot, 'release-worktree-add'),
      },
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    // The 'exit' listener is registered NOW, before waiting for anything: if
    // it were registered after the wait and the process had finished in the
    // meantime, the event would have been lost and the test would hang until
    // its own timeout — a harness failure disguised as a code failure.
    const exited = new Promise((resolve) => child.on('exit', (c, s) => resolve({ code: c, sig: s })))

    // The signal is sent when `git worktree add` HAS ALREADY STARTED —
    // fake-git writes its argv into the log BEFORE stopping, so the log is the
    // reliable marker of "we are inside the blocking call". And since the stub
    // does not return until WE release it (the line below), there is no window
    // that can close on us before we get there.
    await new Promise((resolve) => {
      const t = setInterval(() => {
        if (/worktree add/.test(readOrEmpty(gitLog))) { clearInterval(t); resolve() }
      }, 5)
    })
    child.kill('SIGINT') // only to the node process, never to the `git` child
    // Release AFTER the kill: `child.kill` is synchronous at the syscall level,
    // so on returning the signal is already pending for the target process.
    writeFileSync(join(repoRoot, 'release-worktree-add'), '')
    const { code, sig } = await exited

    expect(sig).toBeNull() // it left through its own process.exit(), not killed by the OS
    expect(code).toBe(130)
    // The work already done is kept and reported: the summary comes out
    // BEFORE the acknowledgement of the signal.
    expect(out).toMatch(/lanzados 1\/1 slice\(s\) seleccionados de esta tanda/)
    expect(readOrEmpty(gitLog)).toMatch(/worktree add -b feat\/90/)
    // And the signal is acknowledged, with the right nuance: it interrupted
    // nothing.
    expect(out).toMatch(/SIGINT recibido, pero la tanda YA había terminado de procesarse cuando llegó/)
    expect(out).toMatch(/no se interrumpe ni se deshace nada de lo ya hecho/)
    // The claim of a slice that launched fine is NOT reverted.
    expect(readOrEmpty(join(repoRoot, 'gh-argv'))).not.toMatch(/issue edit 90 --repo o\/r --add-label status:ready/)
    expect(out).toMatch(/no había ningún claim propio pendiente de revertir/)
  })

  // A NOTE about what is NOT tested here, and why: the same final yield point
  // also covers the --dry-run path (it is literally the same line, outside the
  // `if (!dryRun)`), but there is no honest way to exercise it with an
  // EXTERNAL signal: in --dry-run, EVERYTHING that happens after installing
  // the handlers is instantaneous (the loop does not make a single subprocess
  // call; it prints and moves on), so the process can finish before the OS
  // delivers the signal. A test like that would measure the scheduler, not the
  // code — the same timing mistake the previous round already documented for
  // its own attempts with external signals.
})
