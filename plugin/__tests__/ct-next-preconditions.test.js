// D4 — the dry-run lies and the account map sends work to the wrong account.
// END-TO-END tests against ct-next.mjs (never against a real repo, a real cmux
// or a real gh: stubs on PATH, repoRoot in a temporary directory, and
// --dry-run with a fixture where not even that is needed).
//
// Every block in here was checked first against the code BEFORE the fix: if it
// does not fail there, it proves nothing. See the report of the task for the
// detail.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync, cpSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// D4: a hermetic environment (real account dirs under tmpdir + cmux/claude
// stubs on PATH) — see fixtures/hermetic-env.js. The tests of this file that
// exercise the ABSENCE of a binary set their own PATH, which wins over this one
// (the overrides are spread afterwards).
import {hermeticEnv} from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(here, '..')
const scriptsDir = join(projectRoot, 'scripts')
const script = join(scriptsDir, 'ct-next.mjs')
const fixturesDir = join(here, 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

// A minimal PATH for the cases that need to simulate the ABSENCE of a binary.
// Omitting the stub and leaving `process.env.PATH` behind is not enough: `cmux`
// and `claude` are REALLY installed on the development machine, so that
// omission would find the real binary (the exact mistake an earlier agent of
// this project already made). These tests use a PATH that does NOT include the
// real one — possible only because they go with --dry-run + CT_NEXT_FIXTURE,
// where ct-next.mjs does not launch a single subprocess (no git, no gh, no
// cmux).
const dirs = []
function makeTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})

const FIXTURE_ONE_READY = JSON.stringify({
  issues: [{ n: 42, order: 1, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend', ac: ['AC-1'], issue: '#42' }],
  mergedIssues: [],
})

// process.execPath, not the string 'node': several tests here set a PATH that
// does NOT contain the real PATH (so that the absence of cmux/claude can be
// simulated with no risk of finding the machine's real binaries), and with that
// PATH the word 'node' itself would not resolve — the spawn would fail before
// running anything and the test would measure the harness, not the code.
function run(args, envOverrides = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...hermeticEnv(), ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

function runReal(args, envOverrides = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: fakePath, ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

// ---------------------------------------------------------------------------
// Defect 2 — numeric arguments parsed with `parseInt`
// ---------------------------------------------------------------------------
// ctNextSiblings (F11): the files of `scripts/` that ct-next.mjs needs in order
// to start, DERIVED from its own relative imports instead of written by hand.
// The hardcoded list that used to be here was a copy of the dependency graph
// that nobody kept up to date: on adding a new import to ct-next.mjs (F11 added
// `conventions.js`) these tests copied an INCOMPLETE tree and measured an
// ERR_MODULE_NOT_FOUND (exit 1) believing they were measuring the exit code of
// the scenario — green in the list of names, false in what they claimed. The
// resolution is transitive; a file that does not exist is ignored, so
// `dispatch-check.mjs` (which some tests delete on purpose) can still be left
// out separately.
function ctNextSiblings(scriptsDirPath) {
  const seen = new Set()
  const pending = ['ct-next.mjs']
  while (pending.length) {
    const f = pending.shift()
    if (seen.has(f)) continue
    seen.add(f)
    let src
    try {
      src = readFileSync(join(scriptsDirPath, f), 'utf8')
    } catch {
      continue
    }
    for (const m of src.matchAll(/from '\.\/([^']+)'/g)) pending.push(m[1])
  }
  return [...seen]
}

describe('ct-next --cap: strict parsing (D4, defect 2)', () => {
  // Checked against the code before the fix, in the same order as here: "1e3"
  // dispatched 1 slice, "3perros" dispatched 3, "2.9" dispatched 2, and " 3"
  // and "+2" sneaked through just the same — all five with exit 0 and without a
  // single line of warning. The user asked for a cap and got another one.
  for (const bad of ['1e3', '3perros', '2.9', ' 3', '0x2', '1_000', '']) {
    it(`--cap ${JSON.stringify(bad)} → exit 2, never a cap other than the one asked for`, () => {
      const r = run(['--repo', 'menoplus-app/menoplus', '--cap', bad, '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
      expect(r.code).toBe(2)
      expect(r.out).toMatch(/--cap inválido/)
      expect(r.out).not.toMatch(/seleccionados para esta tanda/)
    })
  }

  // Range vs. form: two different errors, with two different corrections. A
  // "0" is WELL WRITTEN (parseStrictInt reads it faithfully as 0), so the right
  // message is the one about range, not "this is not an integer".
  // (D5, finding I: "-1" moved from here to the list of invalid FORM — a sign
  // is no longer "plain decimal digits". The range/form distinction is kept
  // where it still means something: the 0.)
  it('--cap 0 → exit 2 with a RANGE message, different from the "this is not an integer" one', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '0', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/debe ser >= 1/)
  })

  // D5, finding I — the error message said "debe ser un entero en dígitos
  // decimales a secas" and "+2" was accepted all the same: the message claimed
  // one rule and the code applied another, the same family as the rest of this
  // batch. Checked against the code before the fix: `--cap +2` exited with 0
  // and printed "cap 2", and `--cap -1` gave the range message.
  for (const signed of ['+2', '-1']) {
    it(`--cap ${signed} → exit 2 with the FORM message, which now does name the sign`, () => {
      const r = run(['--repo', 'menoplus-app/menoplus', '--cap', signed, '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
      expect(r.code).toBe(2)
      expect(r.out).toMatch(/--cap inválido/)
      expect(r.out).toMatch(/ni signo "\+"\/"-"/)
      expect(r.out).not.toMatch(/debe ser >= 1/)
      expect(r.out).not.toMatch(/seleccionados para esta tanda/)
    })
  }

  it('--cap 3 (well written) still works', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '3', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cap 3/)
  })

  it('--repo without the owner/repo form → exit 2 (it used to get as far as gh and die with a 404 without explaining why)', () => {
    const r = run(['--repo', 'menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--repo inválido/)
  })
})

// ---------------------------------------------------------------------------
// Defect 1 — the account map, with a voice
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Defect 3 — preconditions of the real run
// ---------------------------------------------------------------------------
describe('ct-next --dry-run — preconditions of the binaries (D4, defect 3)', () => {
  // A PATH without cmux AND without the real PATH: with --dry-run + fixture,
  // ct-next.mjs launches NO subprocess at all, so an empty PATH is safe and,
  // above all, cannot find the machine's real cmux.
  it('cmux absent from the PATH → HARD FAILURE (exit 1): this very process invokes it, so its absence breaks safely', () => {
    const emptyDir = makeTmp('ct-next-emptypath-')
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE_ONE_READY,
      PATH: emptyDir,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/`cmux` no está en el PATH/)
    expect(r.out).toMatch(/NO es luz verde/)
  })

  it('cmux present but claude absent → WARNING (not conclusive: the login shell resolves it), exit 0', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE_ONE_READY,
      PATH: join(fixturesDir, 'fake-cmux-bin'),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/aviso: `claude` no aparece en el PATH/)
    // and the final recap has to make clear that the 0 was given IN SPITE of the warning
    expect(r.out).toMatch(/terminó con exit 0 A PESAR de \d+ aviso/)
  })




  it('with everything in place, the dry-run says explicitly what it checked', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cmux: \S+ \(encontrado en PATH; no se ejecuta/)
    // F35: the CLAUDE_CONFIG_DIR of the resolved account used to be checked
    // here too. With no accounts, the only preflight left of that pair is the
    // one of the agent's binary.
    expect(r.out).toMatch(/claude: \S+ \(encontrado en el PATH de este proceso\)/)
  })

  it('in fixture mode, the destination is marked as NOT CHECKED instead of being taken for free', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.out).toMatch(/NO COMPROBADOS \(modo fixture/)
  })
})

describe('ct-next — an occupied destination: it is detected BEFORE claiming (D4, defect 3)', () => {
  function makeRepoRoot() {
    return makeTmp('ct-next-precond-repo-')
  }

  it('--dry-run with the branch feat/42 already existing → exit 1 and it says so; the dry-run stops being a green light', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GIT_STALE_BRANCH_EXISTS: '42',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/la rama feat\/42 ya existe/)
    expect(r.out).toMatch(/NO es luz verde/)
  })

  it('--dry-run with the worktree already existing → exit 1 and it says so', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees', '42'), { recursive: true })
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/el worktree de #42 ya existe/)
  })

  // THE test that justifies the whole block: in the REAL run, with the branch
  // already occupied, ct-next.mjs wrote the claim first (status:ready →
  // status:in-progress), then `git worktree add` failed, and only then did it
  // revert. Now NOTHING is written: the argv log of gh cannot carry a single
  // `issue edit` for #42.
  it('a REAL run with the branch occupied → exit 1 WITHOUT having written a single claim', () => {
    const repoRoot = makeRepoRoot()
    const argvLog = join(repoRoot, 'gh-argv-log')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GIT_STALE_BRANCH_EXISTS: '42',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/la rama feat\/42 ya existe/)
    expect(r.out).toMatch(/ni un solo claim escrito/)
    const argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(argv).not.toMatch(/issue edit 42/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  // The directory is gone, but git still has it registered (somebody deleted
  // it by hand without `git worktree remove`). `existsSync` on its own says
  // "free" and `git worktree add` blows up afterwards with "missing but already
  // registered worktree" — in the real run, with the claim already written.
  it('a worktree registered but with its directory deleted by hand → exit 1 and it points at `git worktree prune`', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GIT_WORKTREE_REGISTERED: join(repoRoot, '.worktrees', '42'),
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/SIGUE teniéndolo registrado/)
    expect(r.out).toMatch(/git worktree prune/)
  })

  // A failure of the QUERY is not an answer: "I could not ask whether the
  // branch exists" cannot be read as "the branch is free", because "free" is
  // exactly what authorises a claim.
  it('if the query about the branch fails, a warning is given — it is never taken for free in silence', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GIT_REV_PARSE_BROKEN: '1',
    })
    expect(r.out).toMatch(/no se pudo comprobar si la rama feat\/42 ya existe/)
    expect(r.out).not.toMatch(/destino libre/)
    expect(r.out).toMatch(/A PESAR de \d+ aviso/)
  })

  it('a free destination in a real run → the dry-run states it with evidence, not by omission', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/destino libre: .*no existe y la rama feat\/42 tampoco \(comprobado/)
  })
})

describe('ct-next --dry-run — the kickoff reads as PROSE (D4, defect 3)', () => {
  it('prints the kickoff in real lines, not as a blob with escaped \\n', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(0)
    const start = r.out.indexOf('--- kickoff que recibiría el agente')
    const end = r.out.indexOf('--- fin del kickoff ---')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = r.out.slice(start, end)
    // Real prose: several real lines…
    expect(block.split('\n').length).toBeGreaterThan(5)
    // …and not a single two-character "\n" (which is how it used to come out,
    // inside the JSON.stringify of the cmux line).
    expect(block).not.toContain('\\n')
    expect(block).toMatch(/Es human-gated/)
  })

  it('what would be executed is kept whole and literal — F19 moved it from the cmux line to the start-up script, but it cannot be hidden', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    // BEFORE F19 this was `--command "claude --dangerously-skip-permissions
    // …"`: the whole command travelled TYPED into the pty, which is exactly
    // what let an oh-my-zsh prompt eat the `c` of `claude` in the first real
    // dispatch (see __tests__/f19-verificar-el-arranque.test.js). Now only a
    // `. <path>` is typed and the command lives in the script. The property
    // this test defends does NOT change —the dry-run has to show literally what
    // would be executed, with no trimming— only where it lives changes.
    expect(r.out).toMatch(/cmux new-workspace --name .*--command "\. '.*launch\.sh'"/)
    expect(r.out).toMatch(/script de arranque que cmux sourcearía/)
    expect(r.out).toMatch(/^claude --dangerously-skip-permissions '/m)
  })
})

// ---------------------------------------------------------------------------
// Defect 5 — a slice with no resolvable number cannot be dispatched
// ---------------------------------------------------------------------------
describe('ct-next — a slice with no usable issue number (D4, defect 5)', () => {
  const FIXTURE_NO_N = JSON.stringify({
    issues: [{ order: 1, status: 'ready', deps: [], touches: [], name: 'sin numero', type: 'backend' }],
    mergedIssues: [],
  })

  it('is not dispatched, and the unreadable identifier does not propagate to branch/worktree/claim/title', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_NO_N })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no es un número de issue utilizable/)
    // Before: "feat/undefined", ".worktrees/undefined", "dispatch-check.mjs
    // undefined", and the title "repo · #undefined nombre" — with exit 0.
    expect(r.out).not.toMatch(/feat\/undefined|worktrees\/undefined|· #undefined/)
    expect(r.out).not.toMatch(/=== slice/)
  })

  // The errand described this defect as "el nombre del workspace sale como
  // `repo · #— nombre`". What was observed against the code before the fix,
  // with a slice with NO `n`, was worse (`#undefined` propagated to
  // branch/worktree/claim), but an `n` that is literally an em dash — the form
  // slices.js uses for "no value" — is the same defect through the other door,
  // and it stops in the same place.
  it('an `n` that is an em dash (the literal case of the errand) is not dispatched either', () => {
    const fx = JSON.stringify({
      issues: [{ n: '—', order: 1, status: 'ready', deps: [], touches: [], name: 'raro', type: 'backend' }],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no es un número de issue utilizable/)
    expect(r.out).not.toMatch(/· #—/)
  })

  // With cap > 1, a single slice with no number aborts the WHOLE batch before
  // claiming anything — the same decision that already governed any
  // precondition failure: better not to start at all than to start halfway.
  // D5, finding H: the whole batch is still not dispatched (exit 1, no claim),
  // but the --dry-run NO LONGER keeps quiet about the plan of the healthy
  // slices — a dry-run exists to show the whole batch at once. Before, the
  // block `=== slice #7 ===` was not printed at all.
  it('with cap 2, one broken slice prevents the dispatch of the whole batch — but the dry-run DOES show the plan of the healthy slice', () => {
    const fx = JSON.stringify({
      issues: [
        { n: null, order: 1, status: 'ready', deps: [], touches: ['a'], name: 'roto', type: 'backend' },
        { n: 7, order: 2, status: 'ready', deps: [], touches: ['b'], name: 'bueno', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '2', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(1)
    // The plan of the healthy slice is printed all the same...
    expect(r.out).toMatch(/=== slice #7/)
    // ...and the final summary says how many failed, which one would break
    // first, and which one is left with no problems of its own.
    expect(r.out).toMatch(/precondiciones NO cumplidas \(1\)/)
    expect(r.out).toMatch(/el primero que rompería es \(slice SIN número de issue utilizable/)
    expect(r.out).toMatch(/1 sin problemas propios \(#7\)/)
    expect(r.out).toMatch(/NO es luz verde/)
  })

  it('the selection line does not print it as if it were a number either', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_NO_N })
    expect(r.out).toMatch(/seleccionados para esta tanda.*SIN número de issue utilizable/)
    expect(r.out).not.toMatch(/#undefined/)
  })
})
