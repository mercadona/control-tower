import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shQuote } from '../scripts/shquote.js'
// D4: hermetic environment (account dirs + cmux/claude stubs) — see fixtures/hermetic-env.js
import {hermeticEnv} from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

// explicit stdio (finding 11 of the final review): without this, execFileSync
// not only captures the child's stderr in `e.stderr` (which the assertions
// below already use) but also forwards it to the parent process — that is, to
// the output of `npm test`. Every line that showed up that way is the EXPECTED
// output of deliberate failure paths (usage-error tests, collision, etc.), but
// a reader cannot tell that expected noise from a real failure without reading
// the code. `stdio: ['ignore','pipe','pipe']` keeps stdout/stderr available
// via `e.stdout`/`e.stderr` without echoing them to the parent.
// F16/H2: `spawnSync`, not `execFileSync`. `execFileSync` only RETURNS stdout
// when the child exits with 0 — stderr showed up only through the `catch`,
// that is, only when the run failed. While the warnings went on stdout that
// went unnoticed; since the channel criterion (ct-next.mjs), a CORRECT run
// with warnings lost the whole of stderr and these tests were measuring half a
// transcript.
function run(args, envOverrides = {}) {
  // hermeticEnv() (D4): besides the account dirs, it puts the `cmux`/`claude`
  // stubs ahead of the real PATH — the preflight LOOKS them up (it does not
  // run them), and without this the suite would depend on the machine running
  // it having them installed.
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...hermeticEnv(), ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// The wrapper accepts CT_NEXT_FIXTURE (JSON of {issues, mergedIssues}) for tests without network.
// F13: this fixture described an IMPOSSIBLE state — #1 appeared at the same
// time in `mergedIssues` (that is, closed and merged) and inside `issues`,
// which is the list of OPEN issues (buildDispatchInput only maps
// `rawOpenIssues`). It was harmless while `status:in-review` did nothing;
// since F13/H2 an in-review retains its tokens, so that phantom #1 blocked #2
// through `touches:api` and the fixture stopped dispatching anything. The
// contradiction is fixed, not the behaviour: a merged issue is not open, so it
// disappears from `issues` and stays in `mergedIssues` — which is exactly what
// this fixture meant to say (#2's dep is merged).
const FIXTURE = JSON.stringify({
  issues: [
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], name: 'refresh', type: 'backend' },
  ],
  mergedIssues: [1],
})

describe('ct-next --dry-run', () => {
  it('picks #2 and prints worktree + cmux', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toContain('#2')
    expect(r.out).toContain('git worktree add')
    expect(r.out).toContain('cmux')
    expect(r.out).toContain('new-workspace')
    // F35: this used to check that cmux's argv carried
    // `--env CLAUDE_CONFIG_DIR=<dir of the resolved account>` (finding T10:
    // cmux's daemon only receives the environment through --env, not from the
    // client process). With no account resolution there is nothing to export,
    // and the pin becomes the opposite one: the cmux line carries no --env at
    // all, and the session inherits the ambient configuration of whoever
    // launches it.
    expect(r.out).not.toMatch(/--env/)
    expect(r.out).not.toMatch(/\.claude-personal/)
  })

  it('does not reproduce the fixture guarantee with a slice that has no ac/issue (defensive: it does not crash)', () => {
    // The shape of the brief's fixture does NOT carry `ac`/`issue` — just like
    // a real issue with no recognisable acceptance-criteria body.
    // renderKickoff/buildStateSeed index slice.ac as an array; if the wrapper
    // does not normalise it, this blows up with a TypeError instead of
    // printing the plan.
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '2', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/TypeError/)
  })
})

describe('ct-next — fixture tied to --dry-run', () => {
  it('CT_NEXT_FIXTURE set WITHOUT --dry-run → exit 2, it decides nothing and launches nothing real', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_NEXT_FIXTURE.*--dry-run/is)
  })
})

describe('ct-next — nothing dispatchable', () => {
  // W-B (§8): this test existed before W-B and expected the generic message
  // "no hay slices despachables". W-B's brief explicitly asks that message to
  // stop being generic and to distinguish the cause (nothing ready / unmerged
  // deps / collision with in-flight work / cap full) — this particular
  // scenario (a ready #2 whose only dep, #1, is not merged) is EXACTLY the
  // "deps-unmet" case, so the assertion is updated to reflect the new, more
  // specific message, instead of the generic one this change withdraws on
  // purpose. The remaining cases (none-ready/collision/cap-full) are covered
  // in the describe below.
  it('prints the reason "unmerged deps" and exit 0 when the only ready one has an unmerged dep', () => {
    const fixtureNadaReady = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], name: 'login', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], name: 'refresh', type: 'backend' },
      ],
      mergedIssues: [], // #1 not merged yet → #2 blocked by deps
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fixtureNadaReady })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/dependencies unmerged/i)
    expect(r.out).toMatch(/#2/)
    expect(r.out).toMatch(/#1/)
  })

  // D1 finding 5: an ORDER dependency that cannot be mapped (no issue, open
  // or closed, carries that `<!-- ct-order:N -->`) translates to `null` in
  // gh-issue-map.js#buildDispatchInput — correct (fail-closed: it is never
  // satisfied by accident), but the previous message printed literally
  // "falta mergear #null", instructing you to wait for something that does not
  // exist and is never going to be merged. The new message has to explain the
  // real cause (an order that corresponds to no issue) and NEVER show the
  // string "#null".
  it('unmappable order dep (null) → the message explains the real cause, it never prints "#null"', () => {
    const fx = JSON.stringify({
      issues: [{ n: 5, order: 5, status: 'ready', deps: [null], touches: [], name: 'x', type: 'backend' }],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#5/)
    expect(r.out).not.toMatch(/#null/)
    expect(r.out).toMatch(/corresponds to no existing/i)
  })

  // D1 finding 2: a ready issue with `depsMalformed: true` (the section "##
  // Dependencias" exists but no "merge-after #N" was recognised — probably a
  // human rewrite) is reported as blocked, with a message that makes it clear
  // that the state is UNKNOWN — never "no dependencies" (which is what an
  // empty unmetDeps list would suggest without this message).
  it('issue with depsMalformed:true → the message explains that the "## Dependencias" section is unreadable, not that it has no deps', () => {
    const fx = JSON.stringify({
      issues: [{ n: 9, order: 9, status: 'ready', deps: [], depsMalformed: true, touches: [], name: 'x', type: 'backend' }],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#9/)
    expect(r.out).toMatch(/Dependencias/)
    expect(r.out).not.toMatch(/still to merge\s*$/im)
  })
})

// D1 finding 3: two "status:" labels on the same issue (a half-finished edit)
// are resolved conservatively and independently of the array's order (see
// gh-issue-map.js#resolveStatus), but that must NEVER happen in silence: an
// explicit warning, always printed (not only in --dry-run), is what lets a
// human fix the labels before the ambiguity happens again.
describe('ct-next — warning about an ambiguous status: (D1 finding 3)', () => {
  it('an issue with statusAmbiguous:true produces an explicit warning, naming the conflicting labels and what it resolved to', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', statusAmbiguous: true, statusLabels: ['in-progress', 'ready'], deps: [], touches: ['api'], name: 'x', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/status:in-progress/)
    expect(r.out).toMatch(/status:ready/)
    expect(r.out).toMatch(/warning/i)
  })

  it('with no statusAmbiguous at all → no warning', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/warning/i)
  })
})

// D1's review, finding 1 (the "the warning is missing" part): narrowing the
// domain of deps to "## Dependencias" (D1 finding 2) opened a door that `main`
// kept shut — a `merge-after #N` outside the section no longer gates the
// dispatch (correct and desired), but before this fix nothing said so. The
// warning uses the SAME shape as the statusAmbiguous one (above): always
// printed (console.log, not console.error — it aborts nothing), listing the
// issue and the ignored reference.
describe('ct-next — warning about deps outside the "## Dependencias" section (D1 finding 1, review follow-up)', () => {
  it('an issue with strayDeps:[1] produces an explicit warning naming the issue and the ignored reference', () => {
    const fx = JSON.stringify({
      issues: [{ n: 8, order: 2, status: 'ready', deps: [], strayDeps: [1], touches: [], name: 'x', type: 'backend' }],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#8/)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/Dependencias/)
    expect(r.out).toMatch(/warning/i)
  })

  it('with no strayDeps at all → no warning', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/warning/i)
  })
})

// W-B (§8): a single message ("nada ready con deps mergeadas y sin colisión")
// forced you to guess between four causes with different remedies. Each test
// below pins, against the real wrapper (via CT_NEXT_FIXTURE), the exact
// message for one cause — using planDispatch/explainNoSelection (already
// tested without network in dispatch.test.js) underneath.
describe('ct-next — distinguishable reason for blocking (W-B, §8)', () => {
  it('nothing in status:ready → "none-ready" message', () => {
    const fx = JSON.stringify({
      issues: [{ n: 1, order: 1, status: 'in-review', deps: [], touches: [], name: 'x', type: 'backend' }],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/there is no issue at status:ready/i)
  })

  it('ready + merged deps but it collides with in-flight touches → it names the in-flight issue and the shared token', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'choca', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#2/)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/api/)
    expect(r.out).toMatch(/In flight/i)
  })

  it('ready + merged deps but it collides with serialisation (migration in flight vs. ci ready) → it names both tokens', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['migration'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [], touches: ['ci'], name: 'choca', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#2/)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/migration/)
    expect(r.out).toMatch(/ci/)
  })

  it('cap already hogged by in-flight work → it says how many are in flight and what the cap is, even though there is a ready one with no collision', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['db'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'], name: 'sin colisión', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cap.*1/i)
    expect(r.out).toMatch(/#1/)
    expect(r.out).not.toContain('#2 (') // #2 never gets evaluated/launched: the cap is already full
    // Here raising --cap WOULD solve something (#2 collides with nothing in
    // flight), so the message still suggests it as it was (fix Minor 1: the
    // message is not touched for the case where raising --cap DOES help).
    expect(r.out).toMatch(/raise --cap/i)
    expect(r.out).not.toMatch(/would not be enough/i)
  })

  // Fix Minor 1 from W-B's review: before, "cap full" always suggested
  // "sube --cap" — even when the only candidate that would be left was also
  // blocked by another cause (here, unmerged deps). Raising the cap in that
  // case would change nothing; the message now says so explicitly instead of
  // promising falsely.
  it('cap already hogged AND the ready one also has unmerged deps → it says that raising --cap would not be enough, and why', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['x'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [1], touches: [], name: 'con dep pendiente', type: 'backend' },
      ],
      mergedIssues: [], // #2's dep (order 1, that is #1) is not merged
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cap.*1/i)
    expect(r.out).toMatch(/would not be enough/i)
    expect(r.out).toMatch(/dependencies unmerged/i)
    expect(r.out).not.toMatch(/raise --cap, or wait/i) // it does not promise that raising the cap solves anything
  })
})

// W-B (§8), point 4 of the brief: "the dry run has to make the in-flight state
// visible: what is in-progress and which tokens it holds because of that" —
// without this, a --dry-run that DOES select something could give the false
// impression that nothing is running already, when in fact the cap was already
// partly occupied by earlier invocations.
describe('ct-next --dry-run — visibility of in-flight work (W-B, §8)', () => {
  it('with nothing in flight → it says so explicitly ("ninguno")', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/In flight.*none/is)
  })

  it('with something in flight (and another one dispatched anyway) → it lists the in-flight issue and the tokens it holds', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['migration'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'], name: 'nuevo', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '2', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/In flight/i)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/migration/)
    // and the second slice is dispatched all the same, with no collision
    expect(r.out).toContain('#2')
    expect(r.out).toContain('git worktree add')
  })
})

describe('ct-next — usage errors', () => {
  it('with no --repo → exit 2', () => {
    const r = run(['--dry-run'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/usage:/)
  })

  it('dangling --repo (last token, with no value) → exit 2', () => {
    const r = run(['--cap', '1', '--dry-run', '--repo'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/usage:/)
  })

  it('--repo followed by another flag (with no real value) → exit 2', () => {
    const r = run(['--repo', '--dry-run'])
    expect(r.code).toBe(2)
  })

  it('non-numeric --cap → exit 2', () => {
    const r = run(['--repo', 'o/r', '--cap', 'nope', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--cap/i)
  })
})

describe('shQuote (Override 1: POSIX escaping of the kickoff prompt)', () => {
  // Verifies, against a real POSIX shell, that the value reaching the program
  // after the shell-parsing round trip is byte-identical to the original — not
  // a visual approximation. We use `set --` to set the positional arguments
  // from the quoted value and check that it produces EXACTLY one argument (if
  // the quoting were broken and the shell split the word, $# would be > 1 and
  // we would catch it here instead of merely reading $1 and masking the bug).
  function shellRoundTrip(value) {
    const quoted = shQuote(value)
    const script = `set -- ${quoted}\nif [ "$#" -ne 1 ]; then echo "ARGC:$#"; exit 1; fi\nprintf '%s' "$1"`
    return execFileSync('sh', ['-c', script], { encoding: 'utf8' })
  }

  const cases = {
    'empty string': '',
    'plain text': 'hola mundo',
    'environment variable': 'no expandas $HOME por favor',
    backticks: 'esto `no` es un comando',
    'literal single quote': "el valor tiene una comilla ' suelta",
    backslash: 'una barra \\ invertida literal',
    'line break': 'primera línea\nsegunda línea',
    'everything at once (trap case)': "cd $HOME && echo `whoami` && rm -rf ' \\ \n fin",
  }

  for (const [label, value] of Object.entries(cases)) {
    it(`byte-identical round trip through a real POSIX shell: ${label}`, () => {
      expect(shellRoundTrip(value)).toBe(value)
    })
  }
})

// Review round 1, Important finding: if `git worktree add` works but a later
// step (seeding STATE.md or launching cmux) fails, the worktree and the branch
// are left orphaned. These tests exercise the REAL path (no fixture, no
// --dry-run) with stubs of `git`/`gh`/`cmux` (never a real repo, never a
// worktree outside a temporary directory, never a real cmux) to verify that
// ct-next.mjs tries to clean up and distinguishes "cleaned" from "I could not
// clean up, do it by hand".
describe('ct-next — orphaned worktree on a partial failure (review round 1, Important)', () => {
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

  // F16/H2: see the comment on the twin `runReal` further below — `spawnSync`
  // so as not to lose the stderr of a run that exits with 0.
  function runReal(args, envOverrides = {}) {
    const r = spawnSync('node', [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], // finding 11: do not echo the expected noise to the parent
      env: { ...process.env, PATH: fakePath, ...envOverrides },
    })
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }

  // combinedOutputOf (F8): the child's stdout and stderr go to THE SAME file
  // descriptor, so what ends up written is the transcript in the REAL order of
  // emission — the only thing with which you can honestly assert that one line
  // came out before another when the two travel on different streams.
  // Concatenating `e.stdout + e.stderr`, which is what `runReal` does, orders
  // by stream, not by time.
  function combinedOutputOf(args, envOverrides = {}) {
    const logPath = join(mkdtempSync(join(tmpdir(), 'ct-next-combined-')), 'combined.log')
    dirs.push(dirname(logPath))
    const fd = openSync(logPath, 'w')
    try {
      spawnSync('node', [script, ...args], {
        stdio: ['ignore', fd, fd],
        env: { ...process.env, PATH: fakePath, ...envOverrides },
      })
    } finally {
      closeSync(fd)
    }
    return readFileSync(logPath, 'utf8')
  }

  function makeRepoRoot() {
    const d = mkdtempSync(join(tmpdir(), 'ct-next-repo-'))
    dirs.push(d)
    return d
  }

  const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

  // FAKE_GIT_WORKTREE_ADD_AS_FILE (D4): the `git worktree add` stub creates
  // the worktree's path AS A FILE, so ct-next.mjs's later
  // `mkdirSync(`${wt}/.agent`)` blows up with ENOTDIR deterministically,
  // without depending on permissions. Before, these tests pre-created that
  // file BEFORE starting ct-next.mjs; since D4 (defect 3) that no longer works
  // — ct-next.mjs checks that the destination is free BEFORE claiming, so a
  // pre-existing worktree is detected in the preflight and never reaches the
  // seed (which is exactly the fix). Creating the file DURING the `worktree
  // add` reproduces the same seeding failure without disabling that check.
  it('the SLICE.md seed fails (the worktree turned out not to be a directory) → it cleans up and says you can retry', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/could not seed \.agent\/SLICE\.md/)
    expect(r.out).toMatch(/limpiados automáticamente/)
    expect(r.out).toMatch(/puedes reintentar/)
    expect(r.out).not.toMatch(/ATTENTION/)
  })

  // Finding 10 of the final review: the two cleanup steps are attempted
  // SEPARATELY, so the manual hint never joins both commands with `&&` — if it
  // did, and only one of the two steps had really failed, the hint would be
  // unrunnable as written (the step that did succeed would fail again on
  // retrying it, and because of the `&&` the other would never get to run).
  it('the worktree remove fails but the branch -D (attempted separately) does succeed → ATTENTION with the worktree command only, with no && and no mention of the branch', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const wtPath = join(repoRoot, '.worktrees', '42')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
      FAKE_GIT_WORKTREE_REMOVE_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATTENTION.*the worktree of #\d+ could not be cleaned up automatically/s)
    expect(r.out).toMatch(new RegExp(`git worktree remove --force ${wtPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    expect(r.out).not.toMatch(/&&/) // never chained
    expect(r.out).not.toMatch(/git branch -D feat\/42/) // the branch really was deleted, the hint is not needed
  })

  it('the branch -D fails but the worktree remove (attempted separately) does succeed → ATTENTION with the branch command only, with no && and no mention of the worktree', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
      FAKE_GIT_BRANCH_DELETE_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATTENTION.*the branch of #\d+ could not be cleaned up automatically/s)
    expect(r.out).toMatch(/git branch -D feat\/42/)
    expect(r.out).not.toMatch(/&&/)
    expect(r.out).not.toMatch(/git worktree remove --force/) // the worktree really was deleted, the hint is not needed
  })

  it('worktree remove AND branch -D both fail → ATTENTION with both commands, separately (never with &&)', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const wtPath = join(repoRoot, '.worktrees', '42')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
      FAKE_GIT_WORKTREE_REMOVE_FAIL: '1',
      FAKE_GIT_BRANCH_DELETE_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATTENTION.*the worktree and the branch of #\d+ could not be cleaned up automatically/s)
    expect(r.out).toMatch(new RegExp(`git worktree remove --force ${wtPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    expect(r.out).toMatch(/git branch -D feat\/42/)
    expect(r.out).not.toMatch(/&&/)
  })

  it('the cmux launch fails (the seed really was written) → it cleans up and says you can retry', () => {
    const repoRoot = makeRepoRoot()
    // Here the wt is a real, writable directory: mkdirSync/writeFileSync
    // (Override 2) really write a STATE.md under a temporary directory
    // (allowed — never outside a tmp dir), and it is cmux that fails.
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/could not launch cmux/)
    expect(r.out).toMatch(/limpiados automáticamente/)
    expect(r.out).toMatch(/puedes reintentar/)
  })

  it('cap 2, the first slice launches successfully and the second fails in cmux → the message makes clear where it stopped and what is still alive', () => {
    const repoRoot = makeRepoRoot()
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const logFile = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_FAIL_NAME_SUBSTR: '#43', // only the second slice fails
      FAKE_GIT_LOG_FILE: logFile,
    })
    expect(r.code).toBe(1)
    // #42 launched successfully BEFORE #43's failure — its success line must
    // appear, and #43's message must make it explicit that what has already
    // been launched keeps running untouched.
    //
    // F8 — THIS ORDER CHECK USED TO CHECK NOTHING. `runReal` returns
    // `e.stdout + e.stderr`: two CONCATENATED buffers, not an interleaved
    // transcript. "lanzado #42" comes out on console.log (stdout) and
    // "no se pudo lanzar cmux" on console.error (stderr), so the first
    // appeared before the second in that concatenation ALWAYS — even if the
    // process had emitted them in the opposite order. An order assertion over
    // things the capture itself has already ordered for you is green by
    // construction. `combinedOutputOf` runs the same command with stdout and
    // stderr pointing at THE SAME file descriptor, which is the only thing
    // that gives the real order of emission.
    const idxLanzado42 = r.out.indexOf('lanzado #42')
    const idxFallo43 = r.out.indexOf('could not launch cmux')
    expect(idxLanzado42).toBeGreaterThan(-1)
    expect(idxFallo43).toBeGreaterThan(-1)
    const interleaved = combinedOutputOf(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: makeRepoRoot(),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count-2'),
      FAKE_CMUX_FAIL_NAME_SUBSTR: '#43',
    })
    expect(interleaved.indexOf('lanzado #42')).toBeGreaterThan(-1)
    expect(interleaved.indexOf('could not launch cmux')).toBeGreaterThan(-1)
    expect(interleaved.indexOf('lanzado #42')).toBeLessThan(interleaved.indexOf('could not launch cmux'))
    expect(r.out).toMatch(/already launched successfully before this failure.*carry on running.*have not been touched/is)
    // git's log confirms that ONLY #43's worktree/branch (the second one) was
    // attempted for cleanup, never #42's (the first, which did succeed).
    const gitLog = readFileSync(logFile, 'utf8')
    expect(gitLog).toMatch(/worktree remove --force .*\/43/)
    expect(gitLog).not.toMatch(/worktree remove --force .*\/42/)
  })
})

// Finding 1 of the final review (the most serious of the whole review):
// `repoRoot` comes from `git rev-parse --show-toplevel` in the session's cwd,
// which may have nothing to do with `--repo`. With no guard, `/ct-next --repo
// other-org/other-repo` run from a control-tower session would create the
// worktree/branch/STATE.md/cmux INSIDE control-tower. fake-git-bin resolves
// `git remote get-url origin` to "https://github.com/o/r.git" by default (so
// as not to break the rest of the suite, which uses `--repo o/r`); these tests
// set FAKE_GIT_REMOTE_ORIGIN/FAKE_GIT_REMOTE_FAIL to exercise the mismatch.
describe('ct-next — repo identity guard (final review, finding 1)', () => {
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

  // F16/H2: `spawnSync`, NOT `execFileSync`. `execFileSync` only RETURNS
  // stdout when the child exits with 0 — stderr showed up only through the
  // `catch` branch, that is, only when the run failed. While the warnings went
  // on stdout that went unnoticed; since they go on stderr (ct-next.mjs's
  // channel criterion), a CORRECT run with warnings lost the whole of stderr
  // and these tests were measuring half a transcript.
  function runReal(args, envOverrides = {}) {
    const r = spawnSync('node', [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: fakePath, ...envOverrides },
    })
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }

  function makeRepoRoot() {
    const d = mkdtempSync(join(tmpdir(), 'ct-next-identity-'))
    dirs.push(d)
    return d
  }

  it('--repo does not match the local checkout\'s origin remote → exit 1, clear message, no worktree created', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_REMOTE_ORIGIN: 'https://github.com/control-tower/control-tower.git',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/does not match/i)
    expect(r.out).toMatch(/menoplus-app\/menoplus/)
    expect(r.out).toMatch(/control-tower\/control-tower/)
    expect(existsSync(join(repoRoot, '.worktrees'))).toBe(false)
  })

  it('checkout with no "origin" remote → exit 1, clear message (not an uncaught crash), no worktree created', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_REMOTE_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/it has no "origin" remote/i)
    expect(existsSync(join(repoRoot, '.worktrees'))).toBe(false)
  })

  it('--repo DOES match the origin remote (different URL forms) → it passes the guard', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_REMOTE_ORIGIN: 'git@github.com:menoplus-app/menoplus.git',
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    // W-B: with no open issues, the reason becomes "none-ready" (the generic
    // message this test used to check is no longer emitted).
    expect(r.out).toMatch(/there is no issue at status:ready/i)
  })

  it('the guard also applies in --dry-run with no fixture: a --repo that does not match aborts just the same, not only in the real run', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_REMOTE_ORIGIN: 'https://github.com/control-tower/control-tower.git',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/does not match/i)
  })
})

// Finding 2 of the final review: `gh issue list --limit 200` returns newest
// first, so a fixed cap leaves out precisely the OLD issues that others depend
// on. fake-gh-bin does not really simulate HTTP pagination, but it DOES record
// the exact argv ct-next.mjs passes it — the right way to check, without
// network, that the command no longer carries the fixed cap.
describe('ct-next — enumerating issues with no fixed --limit (final review, finding 2)', () => {
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
  // F16/H2: `spawnSync`, NOT `execFileSync`. `execFileSync` only RETURNS
  // stdout when the child exits with 0 — stderr showed up only through the
  // `catch` branch, that is, only when the run failed. While the warnings went
  // on stdout that went unnoticed; since they go on stderr (ct-next.mjs's
  // channel criterion), a CORRECT run with warnings lost the whole of stderr
  // and these tests were measuring half a transcript.
  function runReal(args, envOverrides = {}) {
    const r = spawnSync('node', [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: fakePath, ...envOverrides },
    })
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }

  it('enumerating open and closed issues uses --paginate and never --limit', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-nolimit-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const logFile = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: logFile,
    })
    expect(r.code).toBe(0)
    const log = readFileSync(logFile, 'utf8')
    expect(log).toMatch(/--paginate/)
    expect(log).not.toMatch(/--limit/)
    expect(log).toMatch(/state=open/)
    expect(log).toMatch(/state=closed/)
  })

  // Re-review: the normalisation of `state_reason` (REST, lowercase) →
  // `stateReason` (what filterMergedIssues expects, uppercase) did not have A
  // SINGLE test — exactly the regression surface pointed out in finding 2.
  // Without this normalisation, EVERY closed issue stops counting as merged,
  // and any slice with dependencies is left permanently undispatched (the bug
  // this branch already had once). Scenario: the closed issue #1 (order 1) has
  // `state_reason: 'completed'` exactly as the REST endpoint returns it; the
  // open issue #2 (order 2, ready) declares `merge-after #1` (order). If the
  // normalisation breaks (the `.toUpperCase()` is deleted, or `i.stateReason`
  // is read again), #1 stops counting as merged and #2 is never selected.
  it('normalises state_reason (REST, lowercase) to stateReason (uppercase) — a dep merged via state_reason:"completed" unblocks the slice', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-statereason-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue2 = {
      number: 2, title: '#2 endpoint', labels: [{ name: 'status:ready' }],
      body: 'algo\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->',
    }
    const closedIssue1 = { number: 1, state_reason: 'completed', body: '<!-- ct-order:1 -->' }
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue2], [closedIssue1]]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toContain('#2')
    expect(r.out).not.toMatch(/no hay slices despachables/i)
  })
})

// D1 finding 1 (the most serious one of the dispatch hardening): END-TO-END
// reproduction, against ct-next.mjs's REAL PATH (gh api repos/.../issues,
// never CT_NEXT_FIXTURE), of the exact scenario the auditor verified: epic A
// groomed and merged in full (milestone 100), epic B groomed AFTERWARDS in the
// SAME repo (milestone 200) — both number their slices 1..N from 1. #8 (slice
// 2 of epic B) declares "merge-after #1" (order 1 OF ITS OWN epic), which is
// #7. Before this fix, the order index was global to the repo and
// `[...open, ...closed]` made epic A's #1 (already merged) win the slot — #8
// would have been dispatched alongside #7 in the same batch, without ever
// having really waited for #7, and without anything being printed.
describe('ct-next — D1 finding 1: per-epic (milestone) scope of the order, real path (gh api)', () => {
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
  // F16/H2: `spawnSync`, NOT `execFileSync`. `execFileSync` only RETURNS
  // stdout when the child exits with 0 — stderr showed up only through the
  // `catch` branch, that is, only when the run failed. While the warnings went
  // on stdout that went unnoticed; since they go on stderr (ct-next.mjs's
  // channel criterion), a CORRECT run with warnings lost the whole of stderr
  // and these tests were measuring half a transcript.
  function runReal(args, envOverrides = {}) {
    const r = spawnSync('node', [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: fakePath, ...envOverrides },
    })
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }

  it("the auditor's reproduction: epic A merged + epic B under way, same order numbers, DIFFERENT milestones → #8 waits for its real sibling (#7), never for epic A's already-merged #1", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-epics-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue7 = {
      number: 7, title: '#7 cimiento epicB', labels: [{ name: 'status:ready' }],
      milestone: { number: 200 }, body: '<!-- ct-order:1 -->',
    }
    const openIssue8 = {
      number: 8, title: '#8 encima de epicB', labels: [{ name: 'status:ready' }],
      milestone: { number: 200 },
      body: 'algo\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->',
    }
    const closedIssue1 = { number: 1, state_reason: 'completed', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' }
    const closedIssue2 = { number: 2, state_reason: 'completed', milestone: { number: 100 }, body: '<!-- ct-order:2 -->' }
    const r = runReal(['--repo', 'o/r', '--cap', '5', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue7, openIssue8], [closedIssue1, closedIssue2]]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    // Only #7 is dispatched. #8 never appears as a launched slice — the fix
    // makes its dep resolve against #7 (its own epic), which is still
    // unmerged.
    expect(r.out).toContain('slice #7')
    expect(r.out).not.toContain('slice #8')
  })

  // D1's review, finding 4: the PREVIOUS abort (exit 1, the whole batch) had
  // too wide a radius — an order collision only makes the EPIC it lives in
  // suspect, but it blocked the WHOLE repo, healthy and entirely unrelated
  // epics included. Worse: since buildOrderIndex also indexes the CLOSED ones,
  // a collision that exists only between issues merged long ago (an epic
  // already finished, that nobody cares about today) would brick the ENTIRE
  // repo forever, with no remedy other than editing GitHub by hand. Aborting
  // instead of resolving in silence is still the right direction — what
  // changes is the RADIUS: now only the epic(s) whose own order collides are
  // excluded from the selection (they are neither dispatched nor counted as in
  // flight) — the rest of the repo is dispatched as normal, exit 0, with an
  // explicit warning about which epic was left out and why.
  it('if two epics share a milestone by mistake → ONLY that epic is excluded from the batch (explicit warning), a healthy, unrelated epic is dispatched as normal', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-collision-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue7 = {
      number: 7, title: '#7 a', labels: [{ name: 'status:ready' }],
      milestone: { number: 100 }, body: '<!-- ct-order:1 -->',
    }
    const openIssue8 = {
      number: 8, title: '#8 b', labels: [{ name: 'status:ready' }],
      milestone: { number: 100 }, body: '<!-- ct-order:1 -->', // SAME milestone, SAME order, different issue
    }
    // A completely healthy, unrelated epic (milestone 300): it has to be
    // dispatched all the same, without another epic's collision blocking it.
    const openIssue20 = {
      number: 20, title: '#20 sano', labels: [{ name: 'status:ready' }],
      milestone: { number: 300 }, body: '<!-- ct-order:1 -->',
    }
    const r = runReal(['--repo', 'o/r', '--cap', '5', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue7, openIssue8, openIssue20], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/colisi[oó]n/i)
    expect(r.out).toMatch(/#7/)
    expect(r.out).toMatch(/#8/)
    expect(r.out).toMatch(/warning/i)
    // #7/#8 (the collided epic) are never dispatched…
    expect(r.out).not.toContain('slice #7')
    expect(r.out).not.toContain('slice #8')
    // …but #20 (a healthy epic, entirely unrelated) IS, without somebody
    // else's collision preventing it.
    expect(r.out).toContain('slice #20')
  })

  // Reproduction of the scenario the review was worried about: the collision
  // lives ONLY between ALREADY CLOSED issues of an old, finished epic — nobody
  // has pending work there. A new, healthy, unrelated epic has to be
  // dispatched entirely as normal; the warning about the historical collision
  // may keep being printed (it is real information), but it must never prevent
  // anything in the rest of the repo.
  it('a collision that lives ONLY between issues closed long ago does not block a new, healthy epic', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-collision-closed-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const closedIssueOld1 = { number: 50, state_reason: 'completed', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' }
    const closedIssueOld2 = { number: 51, state_reason: 'completed', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' } // same (epic,order) as #50 → historical collision
    const openIssueNew = {
      number: 60, title: '#60 nuevo y sano', labels: [{ name: 'status:ready' }],
      milestone: { number: 400 }, body: '<!-- ct-order:1 -->',
    }
    const r = runReal(['--repo', 'o/r', '--cap', '5', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssueNew], [closedIssueOld1, closedIssueOld2]]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toContain('slice #60')
  })

  // EXACT reproduction of the review's finding 1 (the "the warning is
  // missing" part): #8 depends, textually, on a `#1` written under "##
  // Descripción" instead of "## Dependencias" — the narrowing (D1 finding 2)
  // makes it no longer count as a real dependency, so #7 AND #8 are both
  // dispatched (the correct decision, unchanged), but NOW the out-of-section
  // reference of #8 is explicitly warned about.
  it('merge-after outside "## Dependencias" (under "## Descripción") → both #7 and #8 are dispatched all the same (correct narrowing), but the ignored reference is warned about', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-straydeps-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue7 = {
      number: 7, title: '#7 cimiento', labels: [{ name: 'status:ready' }],
      milestone: { number: 200 }, body: '<!-- ct-order:1 -->',
    }
    const openIssue8 = {
      number: 8, title: '#8 encima', labels: [{ name: 'status:ready' }],
      milestone: { number: 200 },
      body: '## Descripción\nhace referencia a merge-after #1 pero no en la sección correcta\n\n<!-- ct-order:2 -->',
    }
    const r = runReal(['--repo', 'o/r', '--cap', '5', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue7, openIssue8], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toContain('slice #7')
    expect(r.out).toContain('slice #8') // the narrowing is correct: it is NOT blocked
    expect(r.out).toMatch(/warning/i)
    expect(r.out).toMatch(/#8/)
    expect(r.out).toMatch(/Dependencias/)
  })
})
