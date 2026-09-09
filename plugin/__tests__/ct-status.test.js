import { execFileSync, spawnSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-status.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (o = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...o })

const gitEn = (repo, ...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })

// bancada: each test takes its own git checkout, with its `origin` and its
// contents of `.worktrees/`. The `origin` is not decoration — the command
// compares the checkout's identity against `--repo` before looking at
// anything local, because crossing one repo's issues with another's worktrees
// manufactures findings (measured: 3, one of them an accusation of
// abandonment).
//
// FAKE_GH_COUNTER_FILE is not optional either: without it the stub ALWAYS
// returns the first element of FAKE_GH_LIST_SEQUENCE, so the "open" issues
// would come back again as "closed".
function bancada({ worktrees = [], origin = 'https://github.com/o/r.git', conCommit = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-st-'))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: ['ignore', 'ignore', 'pipe'] })
  if (origin) gitEn(repo, 'remote', 'add', 'origin', origin)
  if (conCommit) gitEn(repo, 'commit', '--allow-empty', '-q', '-m', 'base')
  for (const n of worktrees) mkdirSync(join(repo, '.worktrees', String(n)), { recursive: true })
  return { dir, repo, counter: join(dir, 'gh-count'), argvLog: join(dir, 'gh-argv'), cwd: repo }
}

const correr = (b, env = {}, args = ['--repo', 'o/r']) => spawnSync('node', [script, ...args], {
  encoding: 'utf8',
  cwd: b.cwd,
  env: fakeEnv({ FAKE_GH_COUNTER_FILE: b.counter, FAKE_GH_ARGV_LOG_FILE: b.argvLog, ...env }),
})

const limpiar = (b) => rmSync(b.dir, { recursive: true, force: true })
const argvDe = (b) => (existsSync(b.argvLog) ? readFileSync(b.argvLog, 'utf8') : '')
const SIN_ISSUES = JSON.stringify([[], []])
const abierto = (n, status, titulo = 'refresh') => ({ number: n, title: `#${n} ${titulo}`, body: '', labels: [{ name: `status:${status}` }] })
const enProgreso7 = () => JSON.stringify([[abierto(7, 'in-progress')], []])
const hace = (ms) => JSON.stringify([{ event: 'labeled', label: { name: 'status:in-progress' }, created_at: new Date(Date.now() - ms).toISOString() }])

describe('/ct-status', () => {
  it('a clean loop: exit 0, with no empty blocks', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: SIN_ISSUES })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/EN VUELO/)
    expect(res.stdout).not.toMatch(/ENTREGADO/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stdout).not.toMatch(/\(ninguno\)/)
    limpiar(b)
  })

  it('a slice in flight with no process and an old claim: exit 3 and it names it', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000) })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/EN VUELO/)
    expect(res.stdout).toMatch(/#7/)
    expect(res.stdout).toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stdout).toMatch(/claim puesto hace 3 h/)
    limpiar(b)
  })

  it('a slice in flight whose claim was just set comes out as starting up, not dead: exit 0', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(1000) })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/arrancando/i)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    limpiar(b)
  })

  it('an unreadable timeline accuses nobody, and exits 1', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_FAIL: '1' })
    expect(res.status).toBe(1)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stderr).toMatch(/timeline/)
    // The reason is said ONCE: the composer knows the age is missing, but
    // only the CLI knows why, so its generic message is replaced rather than
    // accumulated — two lines about the same issue for a single cause would
    // read as two different problems.
    expect(res.stderr.match(/#7/g)).toHaveLength(1)
    limpiar(b)
  })

  it('a read that fails NEVER exits 0, even if the rest is clean', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_FAIL_AT: '0' })
    expect(res.status).toBe(1)
    expect(res.stdout + res.stderr).not.toMatch(/limpio/i)
    expect(res.stdout + res.stderr).not.toMatch(/reposo/i)
    limpiar(b)
  })

  it('if the CLOSED ones fail, what is above does not go empty: the IN FLIGHT block is still there', () => {
    // The report came out empty under a footer that said "what is above is
    // only what could be checked"… and above there was nothing, because
    // `cargarIssues` threw and with it dropped the read of open issues that
    // was already entirely in memory. It contradicted the contract this
    // command publishes: "what is known is reported".
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000), FAKE_GH_LIST_FAIL_AT: '1' })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/EN VUELO \(1\)/)
    expect(res.stdout).toMatch(/#7\s+refresh/)
    expect(res.stderr).toMatch(/no se pudieron listar issues cerrados/)
    // And only ONE of the two reads has been lost, not both.
    expect(res.stdout).toMatch(/exit 1 — 1 aviso\(s\)/)
    limpiar(b)
  })

  it('with the issues half read, a worktree that IS on disk is asserted: `worktree ✓`, never `✗`', () => {
    // A defect born of the INTERACTION of two fixes, and that is why no task
    // review saw it: the emptying of `worktreesEnDisco` that protects against
    // manufacturing orphans also fed the `hasWorktree` of the in-flight
    // block. It was unreachable while `cargarIssues` threw (with no issues
    // there was no in-flight block to print); the partial report made it
    // reachable, and the report contradicted itself in two consecutive lines:
    // the warning named `.worktrees/7` and the block said `worktree ✗` about
    // #7.
    //
    // The right mark here is `✓`, not `?`: the disk read WAS done and the
    // directory IS there. What is not known is who it belongs to, and that is
    // not a signal of the in-flight block — it is what switches off the
    // attribution of orphans. A `?` would be inventing a doubt that does not
    // exist.
    const b = bancada({ worktrees: [7] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000), FAKE_GH_LIST_FAIL_AT: '1' })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/worktree ✓/)
    expect(res.stdout).not.toMatch(/worktree ✗/)
    // And the warning does NOT name the 7: the report has just explained it.
    // See the test below, which is the one that ties down that half.
    expect(res.stderr).not.toMatch(/en \.worktrees\//)
    // Unable to attribute, nobody is accused of being an orphan either.
    expect(res.stdout).not.toMatch(/RESIDUO/)
    limpiar(b)
  })

  it('the warning does not name a directory the report DOES explain', () => {
    // The other face of the same defect: on passing the real list to the
    // blocks, the warning —which was not touched— went on to assert the
    // opposite of what the report printed two lines further down. Both of its
    // halves were false for the 7: it HAD been crossed, and who claimed it
    // WAS known, because the read that DID work is precisely the one that
    // explains it.
    const b = bancada({ worktrees: [7, 8] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000), FAKE_GH_LIST_FAIL_AT: '1' })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/worktree ✓/) // the 7, explained by #7 in flight
    const aviso = res.stderr.split('\n').find((l) => /en \.worktrees\//.test(l))
    expect(aviso).toBeDefined()
    const nombrados = /en \.worktrees\/ \(([^)]*)\)/.exec(aviso)[1].split(', ')
    expect(nombrados).toEqual(['8'])
    limpiar(b)
  })

  it('if the partial read explains ALL the worktrees, there is no warning — but the exit is still 1', () => {
    // The reason for the read that failed is never lost: it travels
    // separately, from `cargarIssues`. That no directory is left to warn
    // about does not turn an incomplete read into a loop at rest.
    const b = bancada({ worktrees: [7] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000), FAKE_GH_LIST_FAIL_AT: '1' })
    expect(res.status).toBe(1)
    expect(res.stderr).not.toMatch(/en \.worktrees\//)
    expect(res.stderr).toMatch(/no se pudieron listar issues cerrados/)
    expect(res.stdout).toMatch(/exit 1 — 1 aviso\(s\)/)
    expect(res.stdout).not.toMatch(/reposo/i)
    limpiar(b)
  })

  it('if the OPEN ones fail, the harvest does not omit the worktree that is on disk', () => {
    // Collateral of the same origin: `ENTREGADO, SIN COSECHAR` is built from
    // the closed ones, which here were read, but the emptying deleted its
    // worktree — and the worktree is precisely what has to be cleaned up.
    const b = bancada({ worktrees: [5] })
    const seq = JSON.stringify([[], [{ number: 5, body: '', labels: [], state_reason: 'completed' }]])
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: seq, FAKE_GH_LIST_FAIL_AT: '0' })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/ENTREGADO, SIN COSECHAR \(1\)/)
    expect(res.stdout).toMatch(/#5\s+cerrado como completado, y todavía queda en disco: worktree \.worktrees\/5/)
    limpiar(b)
  })

  it('if the issue read fails, no worktree is accused of being an orphan', () => {
    const b = bancada({ worktrees: [7] })
    const res = correr(b, { FAKE_GH_LIST_FAIL_AT: '0' })
    expect(res.status).toBe(1)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stderr).toMatch(/\.worktrees/)
    limpiar(b)
  })

  it('.worktrees/ cannot be listed → never "there are no orphans", and the signal comes out `?` instead of `✗`', () => {
    // The test §9 of the design demands and that was missing. With
    // `.worktrees/` unreadable, the EACCES `aviso:` and a `worktree ✗` came
    // out at the same time, the latter asserting the absence of what could
    // not be looked at.
    const b = bancada({ worktrees: [7] })
    chmodSync(join(b.repo, '.worktrees'), 0o000)
    try {
      const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000) })
      expect(res.status).toBe(1)
      expect(res.stderr).toMatch(/no se pudo listar .*\.worktrees/)
      expect(res.stdout).toMatch(/worktree \?/)
      expect(res.stdout).not.toMatch(/worktree ✗/)
      // And never the assertion of cleanliness about the read that was not done.
      expect(res.stdout).not.toMatch(/RESIDUO/)
      expect(res.stdout).not.toMatch(/reposo/i)
      // The branch COULD be read, so that one is asserted: the doubt does
      // not spread to the signal next to it.
      expect(res.stdout).toMatch(/rama ✗/)
    } finally {
      chmodSync(join(b.repo, '.worktrees'), 0o755)
      limpiar(b)
    }
  })

  it('a worktree of an OPEN issue that is not in flight is named without asserting nobody claims it', () => {
    const b = bancada({ worktrees: [9] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto(9, 'ready', 'plan')], []]) })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/RESIDUO/)
    expect(res.stdout).toMatch(/\.worktrees\/9/)
    expect(res.stdout).toMatch(/#9 sigue abierto/)
    expect(res.stdout).toMatch(/status:ready/)
    // The phrase §6 of the spec proposed would be FALSE here: issue #9 is
    // open, that is, alive.
    expect(res.stdout).not.toMatch(/sin issue vivo que lo reclame/)
    limpiar(b)
  })

  it('a worktree no issue explains does come out as unclaimed', () => {
    const b = bancada({ worktrees: [11] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: SIN_ISSUES })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/\.worktrees\/11/)
    expect(res.stdout).toMatch(/ning.n issue lo reclama/)
    limpiar(b)
  })

  it('the worktree of a slice IN FLIGHT is not residue', () => {
    const b = bancada({ worktrees: [7] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(1000) })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stdout).toMatch(/worktree ✓/)
    limpiar(b)
  })

  it('a closed issue that keeps its status: label comes out as residue, with exit 3', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 3, body: '', labels: [{ name: 'status:in-review' }], state_reason: 'completed' }]]) })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/RESIDUO \(1\)/)
    expect(res.stdout).toMatch(/#3\s+cerrado, pero conserva status:in-review/)
    // With no orphaned worktrees, the note about worktrees has no business here.
    expect(res.stdout).not.toMatch(/\.worktrees/)
    limpiar(b)
  })

  it('with no `ps` on the PATH nobody comes out dead: exit 1 and "it could not be checked"', () => {
    const b = bancada()
    // A PATH with neither `ps` nor `lsof`, but with `git` (needed to resolve
    // the checkout's root) and with `node` (the `gh` stub is a node script
    // and without it the issue read would fail TOO, which is not what is
    // being tested here): that way the only failure is the process signal's,
    // and you get to see what the command does when the tool is missing —
    // accusing a healthy slice of abandonment over that would be its worst
    // possible failure.
    const bin = join(b.dir, 'bin')
    mkdirSync(bin)
    symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'))
    symlinkSync(process.execPath, join(bin, 'node'))
    const res = spawnSync(process.execPath, [script, '--repo', 'o/r'], {
      encoding: 'utf8',
      cwd: b.cwd,
      env: {
        ...process.env,
        PATH: `${fakeGhDir}:${bin}`,
        FAKE_GH_COUNTER_FILE: b.counter,
        FAKE_GH_LIST_SEQUENCE: enProgreso7(),
        FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000),
      },
    })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/proceso \?/)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stderr).toMatch(/no se pudo listar procesos con ps/)
    limpiar(b)
  })

  it('it mutates nothing: it never calls `gh issue edit` nor `gh label`', () => {
    const b = bancada({ worktrees: [7] })
    correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000) })
    const log = argvDe(b)
    // The test looks at the REAL argv `gh` was invoked with, not at the
    // absence of errors: a command can mutate and exit 0 quite happily.
    expect(log.length).toBeGreaterThan(0)
    expect(log).not.toMatch(/issue edit/)
    expect(log).not.toMatch(/label/)
    expect(log).not.toMatch(/--method (POST|PATCH|PUT|DELETE)/)
    for (const l of log.split('\n').filter(Boolean)) expect(l).toMatch(/^api /)
    limpiar(b)
  })

  it('no read carries --limit, and they all paginate', () => {
    const b = bancada()
    correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: '[]' })
    const lineas = argvDe(b).split('\n').filter(Boolean)
    expect(lineas.length).toBe(3) // open, closed, timeline of #7
    for (const l of lineas) {
      expect(l).not.toMatch(/--limit/)
      expect(l).toMatch(/--paginate/)
    }
    limpiar(b)
  })

  it('a dangling --repo (the last token of argv) does not reach gh: exit 2', () => {
    const b = bancada()
    const res = correr(b, {}, ['--repo'])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/sin valor/)
    expect(argvDe(b)).toBe('')
    limpiar(b)
  })

  it('--repo with an invalid shape: exit 2, without touching gh', () => {
    const b = bancada()
    const res = correr(b, {}, ['--repo', 'menoplus'])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/owner\/repo/)
    expect(argvDe(b)).toBe('')
    limpiar(b)
  })

  it('with no --repo: exit 2 with the usage', () => {
    const b = bancada()
    const res = correr(b, {}, [])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/uso: ct-status\.mjs/)
    limpiar(b)
  })
})

describe("/ct-status — the checkout's identity", () => {
  it("a --repo that is not this checkout's does not manufacture findings: it warns and exits 1", () => {
    // The checkout is o/r's, with three worktrees and a claim; ANOTHER repo
    // is asked about. Without this check, 3 findings came out with zero
    // warnings and exit 3 — one the accusation of abandonment on #7, and two
    // worktrees (8 and 9) marked as candidates for `git worktree remove`.
    // That the command does not write does not help: the human writes, at its
    // suggestion.
    const b = bancada({ worktrees: [7, 8, 9] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000) }, ['--repo', 'otro/repo'])
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/es el checkout de o\/r, no de otro\/repo/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stdout).not.toMatch(/worktree ✗/)
    expect(res.stdout).toMatch(/worktree \?/)
    limpiar(b)
  })

  it('a checkout with no origin remote is not taken as good: it warns and exits 1, accusing nobody', () => {
    const b = bancada({ worktrees: [9], origin: null })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: SIN_ISSUES })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/no tiene remote "origin"/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    limpiar(b)
  })

  it('invoked FROM INSIDE a worktree, it looks at the main checkout', () => {
    // `git rev-parse --show-toplevel` would return the worktree itself here:
    // there is no `.worktrees/` inside (everything would come out
    // `worktree ✗`) and the prefix each process's cwd is mapped with would be
    // wrong (everything `proceso ✗`) — the report would deny precisely the
    // directory you are standing in.
    const b = bancada({ conCommit: true })
    gitEn(b.repo, 'worktree', 'add', '-q', '-b', 'feat/7', join(b.repo, '.worktrees', '7'))
    b.cwd = join(b.repo, '.worktrees', '7')
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(1000) })
    expect(res.stdout).toMatch(/worktree ✓/)
    expect(res.stdout).toMatch(/rama ✓/)
    expect(res.status).toBe(0)
    limpiar(b)
  })
})

describe('/ct-status — delivered, waiting for the merge', () => {
  it('three in-review with their worktrees: a block of their own, no residue and exit 0', () => {
    const b = bancada({ worktrees: [11, 12, 13] })
    const res = correr(b, {
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto(11, 'in-review', 'refresh de tokens'), abierto(12, 'in-review', 'marca de ritmo'), abierto(13, 'in-review', 'pie de plan')], []]),
    })
    // A healthy loop with three open PRs returned 3 permanently: the
    // coordinator learns to ignore the exit code, and a watcher that gates on
    // it becomes useless.
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/ENTREGADO, ESPERANDO MERGE \(3\)/)
    expect(res.stdout).toMatch(/#11\s+refresh de tokens — status:in-review/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    limpiar(b)
  })

  it('it is not confused with the harvest: the two blocks can come out at once', () => {
    const b = bancada({ worktrees: [11, 5] })
    const res = correr(b, {
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto(11, 'in-review')], [{ number: 5, body: '', labels: [], state_reason: 'completed' }]]),
    })
    expect(res.status).toBe(3) // what is merged and unharvested IS a finding
    expect(res.stdout).toMatch(/ENTREGADO, ESPERANDO MERGE \(1\)/)
    expect(res.stdout).toMatch(/ENTREGADO, SIN COSECHAR \(1\)/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    limpiar(b)
  })
})

describe('/ct-status — the sign of life in the residue block', () => {
  it('with a live process inside, it is NOT said that there is none', () => {
    const b = bancada({ worktrees: [9] })
    // A real process with its cwd inside the worktree: it is the only way to
    // exercise `liveSliceProcesses` end to end.
    //
    // Set up THE WAY THE NATIVE INSTALLER SETS IT UP, which is what makes
    // this test decisive: `bin/claude` is a SYMLINK to an executable stored
    // under `versions/<version>`, just as `~/.local/bin/claude` points at
    // `~/.local/share/claude/versions/2.1.221`. The process name the kernel
    // sees is that of the RESOLVED executable (measured: `ps -o ucomm=` of a
    // real Claude Code returns "2.1.221", not "claude"), so the only thing
    // `claude` says here is the PATH it was invoked with — which is precisely
    // what this command looks at. A symlink to /bin/sleep, not a copy:
    // copying a system binary on macOS breaks its signature and the OS kills
    // it with SIGKILL (checked).
    const bin = join(b.dir, 'bin')
    mkdirSync(join(bin, 'versions'), { recursive: true })
    symlinkSync('/bin/sleep', join(bin, 'versions', '2.1.221'))
    symlinkSync(join(bin, 'versions', '2.1.221'), join(bin, 'claude'))
    const hijo = spawn(join(bin, 'claude'), ['30'], { cwd: join(b.repo, '.worktrees', '9'), stdio: 'ignore' })
    try {
      execFileSync('sh', ['-c', 'sleep 0.5'])
      // THE CANARY, AND WHY IT DEPENDS ON THE OPERATING SYSTEM.
      //
      // On macOS `ucomm` gives the RESOLVED executable ('2.1.221'), so "the
      // name is not claude" gives away anyone who goes back to identifying by
      // name before the assertion below. On Linux `ucomm` is an alias of
      // `comm`, which gives the INVOKED basename: 'claude'.
      //
      // That is NOT a supposition: it is what the first continuous
      // integration run on ubuntu-latest measured, and it is exactly the
      // question scripts/liveness.js left open in writing ("if anyone takes
      // the loop to Linux, the first thing to verify is what `ps -o comm=`
      // returns there"). Consequence for liveness.js's filter, which accepts
      // a process if the basename of `comm` is exactly `claude`: on Linux it
      // keeps working, because the basename of 'claude' is 'claude'.
      //
      // Each platform's value is ASSERTED instead of skipping the assertion
      // where it gets in the way: that way the test documents the measurement
      // and breaks the day it changes. On Linux the canary is inert —the name
      // IS 'claude'— and this test's guarantee is therefore weaker there; it
      // is said out loud instead of being relaxed in silence.
      const nombreDeProceso = execFileSync('ps', ['-o', 'ucomm=', '-p', String(hijo.pid)], { encoding: 'utf8' }).trim()
      if (process.platform === 'darwin') {
        expect(nombreDeProceso).not.toBe('claude')
      } else {
        expect(nombreDeProceso).toBe('claude')
      }
      const res = correr(b, { FAKE_GH_LIST_SEQUENCE: SIN_ISSUES })
      // THE assertion that cannot be made without looking: the first version
      // printed "nobody is working on it now" without consulting
      // `procesos.porSlice`, which was already in memory.
      expect(res.stdout).not.toMatch(/no hay ning.n proceso trabajando dentro/)
      // The positive branch is only demanded if the process check could
      // really be done on this machine: if `lsof` is missing, the command
      // stays quiet, and that is exactly what the assertion above already
      // protects.
      if (!/no se pudo (listar procesos|leer el directorio)/.test(res.stderr)) {
        expect(res.stdout).toMatch(new RegExp(`OJO: hay un proceso trabajando dentro ahora mismo \\(pid ${hijo.pid}\\)`))
      }
    } finally {
      hijo.kill('SIGKILL')
      limpiar(b)
    }
  })

  it('if the process check failed, NOTHING is said about processes', () => {
    const b = bancada({ worktrees: [9] })
    const bin = join(b.dir, 'bin')
    mkdirSync(bin)
    symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'))
    symlinkSync(process.execPath, join(bin, 'node'))
    const res = spawnSync(process.execPath, [script, '--repo', 'o/r'], {
      encoding: 'utf8',
      cwd: b.cwd,
      env: { ...process.env, PATH: `${fakeGhDir}:${bin}`, FAKE_GH_COUNTER_FILE: b.counter, FAKE_GH_LIST_SEQUENCE: SIN_ISSUES },
    })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/\.worktrees\/9/)
    expect(res.stdout).not.toMatch(/no hay ning.n proceso trabajando dentro/)
    expect(res.stdout).not.toMatch(/OJO: hay un proceso/)
    limpiar(b)
  })
})

describe('/ct-status — the whole report reaches the other side of the pipe', () => {
  it('a long report captured by a parent is not truncated at 65536 bytes', () => {
    const b = bancada()
    // `process.stdout` is asynchronous towards a pipe on POSIX: with
    // `process.exit()` the process dies without waiting to drain it, and the
    // report arrived cut off mid-line at the size of the OS's pipe buffer —
    // with the exit code intact, so nothing gave the cut away.
    const cerrados = Array.from({ length: 2000 }, (_, i) => ({ number: i + 1, body: '', labels: [{ name: 'status:in-review' }], state_reason: 'completed' }))
    const seqFile = join(b.dir, 'seq.json')
    writeFileSync(seqFile, JSON.stringify([[], cerrados]))
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE_FILE: seqFile })
    expect(res.status).toBe(3)
    expect(res.stdout.length).toBeGreaterThan(65536)
    const ultima = res.stdout.trimEnd().split('\n').pop()
    expect(ultima).toMatch(/^exit 3 — hay 2000 cosa\(s\) que revisar$/)
    limpiar(b)
  })
})
