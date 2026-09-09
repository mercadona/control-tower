// F15 — LOOSE ENDS THAT ONLY SHOW UP WHEN THE PLUGIN IS REALLY USED.
//
// Three field findings, each reproduced against the UNFIXED code before a
// single line of fix was written (what was observed is noted in each test):
//
//   H1  `--reopen` (the return edge F13 added) sent the slice to
//       `status:ready`, and `ready` does NOT hold tokens. While somebody is
//       correcting on top of a rejected PR, a neighbour sharing an
//       `area:`/`touches:` could be dispatched onto a `main` that does not
//       contain that work — the window F13 came to close, reopened by its own
//       edge.
//   H2  `/ct-groom --project <n>` validates the Project v2 (the `Sprint`
//       field, the current iteration) AFTER creating the milestone and the
//       labels. The deduction two independent readers made from the
//       documentation —"an abort leaves half-made junk behind"— was the RIGHT
//       one.
//   H3  `.agent/conventions-ack.md` is the file where the WHY of a decision is
//       put on record, and its parser did not admit a single line of prose.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planDispatch } from '../scripts/dispatch.js'
import { parseAcks, looksLikeAck, formatFindings, detectConventions, ACK_PATH } from '../scripts/conventions.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const here = dirname(fileURLToPath(import.meta.url))
const dispatchCheck = join(here, '..', 'scripts', 'dispatch-check.mjs')
const ctGroom = join(here, '..', 'scripts', 'ct-groom.mjs')
const fixturesDir = join(here, 'fixtures')
const fakePath = [join(fixturesDir, 'fake-git-bin'), join(fixturesDir, 'fake-gh-bin'), process.env.PATH].join(':')
const QUIET = ['ignore', 'pipe', 'pipe']

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) rmSyncBestEffort(d) })
function tmp(prefix = 'ct-f15-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

function runCheck(args, env = {}) {
  const r = spawnSync('node', [dispatchCheck, ...args], { encoding: 'utf8', stdio: QUIET, env: { ...process.env, PATH: fakePath, ...env } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// ============================================================================
// H1 — the return of a rejected PR cannot release the tokens.
// ============================================================================
const slice = (n, status, touches, order) => ({ n, status, touches, order, deps: [] })

describe('F15/H1 — `ready` meant two incompatible things', () => {
  // THE REPRODUCTION, by construction, before touching anything. With #7 in
  // `in-review` and `area:plan`, planDispatch holds that token: #8 (which
  // shares the area) is skipped and #9 comes out. With that same #7 in `ready`
  // —which is where F13's --reopen left it— `runningTouches` comes out EMPTY
  // and the protection disappears entirely.
  it('a slice in `ready` holds no tokens: THAT is the window (checking the premise)', () => {
    const issues = (st) => [slice(7, st, ['area:plan'], 1), slice(8, 'ready', ['area:plan'], 2), slice(9, 'ready', ['area:ui'], 3)]
    const inReview = planDispatch(issues('in-review'), { cap: 1 })
    expect(inReview.runningTouches).toEqual(['area:plan'])
    expect(inReview.selected.map((i) => i.n)).toEqual([9]) // #8 protected

    const inReady = planDispatch(issues('ready'), { cap: 1 })
    expect(inReady.runningTouches).toEqual([]) // nobody holds anything
  })

  // THE FIX. `--reopen` leaves the slice in `in-progress`, which holds tokens
  // AND takes up cap — the two things that are true of a slice somebody is
  // redoing.
  it('after --reopen the slice holds its tokens: the neighbour in the same area does NOT come out', () => {
    const issues = [slice(7, 'in-progress', ['area:plan'], 1), slice(8, 'ready', ['area:plan'], 2), slice(9, 'ready', ['area:ui'], 3)]
    const plan = planDispatch(issues, { cap: 2 })
    expect(plan.runningTouches).toEqual(['area:plan'])
    expect(plan.selected.map((i) => i.n)).toEqual([9]) // #8 is still protected
    // And it consumes cap, because somebody really is working on it.
    expect(plan.inFlight.map((i) => i.n)).toEqual([7])
    expect(plan.remainingCap).toBe(1)
  })

  it('--reopen announces that it STILL holds tokens (it does not sell itself as "you can dispatch now")', () => {
    const fixture = JSON.stringify({ candLabels: ['status:in-review'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/reopened #9 → in-progress/)
    expect(r.out).toMatch(/SIN MERGEAR/)
    expect(r.out).not.toMatch(/reopened #9 → ready/)
  })
})

// ============================================================================
// H1 (2) — --requeue: the other half of the edge, and its refusal category.
// ============================================================================
describe('F15/H1 — --requeue: sending it back to the queue is a DECLARATION that no work is left', () => {
  // Against the unfixed code `--requeue` did not exist: it was an unknown flag
  // that was silently ignored and the script carried on down the claim path
  // (observed: exit 1 with "COLLISION"/exit 3 depending on the fixture).
  it('on an in-progress WITHOUT a worktree or a branch: it sends it back to ready and says what it has NOT checked', () => {
    const repoRoot = tmp()
    const fixture = JSON.stringify({ candLabels: ['status:in-progress'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_TOPLEVEL: repoRoot,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/requeued #9 → ready/)
    expect(r.out).toMatch(/suelta sus tokens/)
    // The half it CANNOT check, said instead of hidden.
    expect(r.out).toMatch(/NO se ha comprobado/)
    expect(r.out).toMatch(/REMOTO/)
  })

  // THE NEW REFUSAL CATEGORY, with a voice of its own: `ready` would be lying.
  it('it REFUSES if the worktree or the branch is still there, and explains why that matters', () => {
    const repoRoot = tmp()
    mkdirSync(join(repoRoot, '.worktrees', '9'), { recursive: true })
    const fixture = JSON.stringify({ candLabels: ['status:in-progress'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_STALE_BRANCH_EXISTS: '9',
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/su trabajo sigue vivo sin mergear/)
    expect(r.out).toMatch(/soltaría sus tokens/)
    expect(r.out).toMatch(/No se ha tocado ninguna label/)
    expect(r.out).toContain(`git -C ${repoRoot} worktree remove`)
    expect(r.out).toContain(`git -C ${repoRoot} branch -D feat/9`)
    expect(r.out).not.toMatch(/requeued/)
  })

  // The deliberate asymmetry with --reopen: there "I don't know" can be said
  // and the run continues; here the mutation IS the assertion of absence.
  it('unable to consult git it REFUSES: what has not been looked at is not declared absent', () => {
    const fixture = JSON.stringify({ candLabels: ['status:in-progress'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_WORKTREE_LIST_FAIL: '1',
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/no se ha podido comprobar/i)
    expect(r.out).toMatch(/No se declara ausente lo que no se ha podido mirar/)
    expect(r.out).not.toMatch(/requeued/)
  })

  it('on an in-review it REFUSES and points at the right path (--reopen), without touching labels', () => {
    const repoRoot = tmp()
    const fixture = JSON.stringify({ candLabels: ['status:in-review'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_TOPLEVEL: repoRoot,
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/su PR sigue abierto sin mergear/)
    expect(r.out).toMatch(/--reopen/)
    expect(r.out).toMatch(/No se ha tocado ninguna label/)
  })

  it('on something ALREADY ready it says so as a no-op, not as an error', () => {
    const repoRoot = tmp()
    const fixture = JSON.stringify({ candLabels: ['status:ready'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture, FAKE_GIT_TOPLEVEL: repoRoot,
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/ya está en status:ready — no hay nada que devolver a la cola/)
  })

  it('with TWO status labels it REFUSES without touching either (the same criterion as --reopen)', () => {
    const repoRoot = tmp()
    const fixture = JSON.stringify({ candLabels: ['status:in-progress', 'status:ready'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture, FAKE_GIT_TOPLEVEL: repoRoot,
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/DOS o más labels de estado a la vez/)
    expect(r.out).not.toMatch(/requeued/)
  })

  it('the disk check happens BEFORE mutating, not after releasing the token', () => {
    // Without --dry-run and without a fixture the script would really mutate;
    // with the worktree present it has to abort before getting there. It is
    // checked with the fixture (which already prevents the mutation) by
    // looking that the refusal message is the disk one and NOT the "could not
    // write" one.
    const repoRoot = tmp()
    mkdirSync(join(repoRoot, '.worktrees', '9'), { recursive: true })
    const fixture = JSON.stringify({ candLabels: ['status:in-progress'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture, FAKE_GIT_TOPLEVEL: repoRoot,
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/todavía tiene el worktree/)
  })

  it('--requeue with --reopen (or with --release) → a usage error, no guessing', () => {
    for (const other of ['--reopen', '--release']) {
      const r = runCheck(['9', '--repo', 'o/r', '--requeue', other, '--dry-run'])
      expect(r.code).toBe(2)
      expect(r.out).toMatch(/mutuamente excluyentes/)
    }
  })
})

// ============================================================================
// H2 — /ct-groom validates the Project BEFORE creating anything. Now it does.
// ============================================================================
const SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | – | api | db |
`

function groomRun(extraEnv, args = []) {
  const dir = tmp('ct-f15-groom-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, SPEC)
  const argvLog = join(dir, 'argv.log')
  const r = spawnSync('node', [ctGroom, spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '5', ...args], {
    encoding: 'utf8',
    stdio: QUIET,
    env: {
      ...process.env,
      PATH: fakePath,
      FAKE_GH_MILESTONES_LIST: '[]',          // does not exist → it WOULD BE CREATED
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_LIST: '[[]]',            // a repo with no labels → they would ALL be created
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      ...extraEnv,
    },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), log: existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : '' }
}

describe('F15/H2 — if /ct-groom aborts while validating the Project, it has created NOTHING', () => {
  // WHAT WAS OBSERVED AGAINST THE UNFIXED CODE (same stub, same spec): the
  // argv log came out as
  //     api repos/o/r/milestones --method GET …
  //     api repos/o/r/milestones -f title=Epic      ← milestone CREATED
  //     label create type:backend …                 ← 4 labels CREATED
  //     project view 5 --owner o --format json      ← and it aborted HERE
  // with "milestone creado: Epic (#1)" already printed on stdout. The
  // "half-made junk" the documentation did not deny was real.
  it('with no Sprint field: it aborts without creating the milestone or any label', () => {
    const r = groomRun({ FAKE_GH_PROJECT_FIELDS: '[]' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no tiene un campo de iteración llamado "Sprint"/)
    expect(r.log).not.toMatch(/milestones -f title=/)   // no creation at all
    expect(r.log).not.toMatch(/label create/)
    expect(r.out).not.toMatch(/milestone creado/)
  })

  it('with no current iteration: it aborts without creating the milestone or any label', () => {
    const old = JSON.stringify([{ id: 'F', name: 'Sprint', configuration: { iterations: [{ id: 'I', title: 'Sprint 1', startDate: '2020-01-06', duration: 14 }] } }])
    const r = groomRun({ FAKE_GH_PROJECT_FIELDS: old })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no tiene una iteración vigente/)
    expect(r.log).not.toMatch(/milestones -f title=/)
    expect(r.log).not.toMatch(/label create/)
  })

  it('if the project cannot even be read: it creates nothing either', () => {
    const r = groomRun({ FAKE_GH_PROJECT_VIEW_FAIL: '1' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo leer el project/)
    expect(r.log).not.toMatch(/milestones -f title=/)
    expect(r.log).not.toMatch(/label create/)
  })

  // The other half: with a healthy project, the order is the same as always
  // and everything gets created. Without this, "it creates nothing" could be
  // satisfied by never creating anything at all.
  it('with a healthy project it does create, and the whole validation sits ahead of the first write', () => {
    const r = groomRun({})
    expect(r.code).toBe(0)
    const idx = (re) => r.log.split('\n').findIndex((l) => re.test(l))
    const validation = idx(/^project view 5/)
    const createdMilestone = idx(/^api repos\/o\/r\/milestones -f title=/)
    const createdLabel = idx(/^label create /)
    const createdIssue = idx(/^issue create /)
    expect(validation).toBeGreaterThanOrEqual(0)
    expect(createdMilestone).toBeGreaterThan(validation)
    expect(createdLabel).toBeGreaterThan(validation)
    expect(createdIssue).toBeGreaterThan(validation)
  })

  // And the sister guarantee, the one that makes a failure HALFWAY through the
  // writes recoverable (which can happen, and is not promised away): running
  // again duplicates nothing.
  it('running again with the milestone already there does not duplicate it (idempotence, the other half of the road)', () => {
    const r = groomRun({ FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]) })
    expect(r.code).toBe(0)
    expect(r.log).not.toMatch(/milestones -f title=/)
    expect(r.out).toMatch(/milestone ya existe/)
  })
})

// ============================================================================
// H3 — the file for the why admits the why.
// ============================================================================
describe('F15/H3 — the acknowledgement admits a human explanation without ceasing to warn', () => {
  // WHAT WAS OBSERVED AGAINST THE UNFIXED CODE: this very file produced 3
  // "silences nothing" warnings, one per line of the preamble. Putting it
  // between <!-- and --> produced 4 (the three inside plus the one for the
  // `-->`), because only the line that STARTED with `<!--` was skipped.
  const withPreamble = [
    '# Convenciones acusadas',
    '',
    'Este repo traía su propio protocolo de claim desde 2025, en',
    'scripts/dispatch-check.sh. Se discutió el 2026-07-20 y la decisión es que',
    'manda el claim del plugin; el del repo se queda para trabajo a mano.',
    '',
    'claim: 2026-07-28 — manda el claim del plugin',
    'worktrees: 2026-07-28 — el loop crea los suyos bajo .worktrees/',
  ].join('\n')

  it('a prose preamble no longer produces a single warning, and the acknowledgements still hold', () => {
    const { acks, problems, prosaSinAcuses } = parseAcks(withPreamble)
    expect(problems).toEqual([])
    expect([...acks.keys()]).toEqual(['claim', 'worktrees'])
    expect(prosaSinAcuses).toBe(false)
  })

  it('a multi-line HTML comment is skipped WHOLE, the closing line included', () => {
    const { acks, problems } = parseAcks('<!--\nrazonamiento\nlargo\n-->\nclaim: 2026-07-28 — motivo\n')
    expect(problems).toEqual([])
    expect([...acks.keys()]).toEqual(['claim'])
  })

  // THE PROPERTY THAT CANNOT BE LOST: whatever MEANT to be an acknowledgement
  // and does not parse still warns. Three different ways of breaking it.
  it('an acknowledgement with a misspelled signal (a typo) still warns', () => {
    const { acks, problems } = parseAcks('Prosa de contexto cualquiera.\nclim: 2026-07-28 — motivo\n')
    expect(acks.size).toBe(0)
    expect(problems).toHaveLength(1)
    expect(problems[0].why).toMatch(/desconocida/)
  })

  it('an acknowledgement with no colon (broken outright) still warns', () => {
    const { problems } = parseAcks('Prosa de contexto cualquiera.\nclaim - 2026-07-28 — motivo\n')
    expect(problems).toHaveLength(1)
    expect(problems[0].why).toMatch(/forma/)
  })

  it('an unknown signal with the exact shape of an acknowledgement still warns', () => {
    const { problems } = parseAcks('worktree: 2026-07-28 — motivo\n')
    expect(problems).toHaveLength(1)
    expect(problems[0].why).toMatch(/desconocida/)
  })

  it('the bias when in doubt is to WARN: a known signal with no date does not pass as prose', () => {
    const { problems } = parseAcks('claim: manda el del plugin\n')
    expect(problems).toHaveLength(1)
    expect(problems[0].why).toMatch(/fecha/)
  })

  it('looksLikeAck: the boundary between prose and a broken acknowledgement', () => {
    for (const prose of [
      'Contexto: en julio de 2026 se decidió retirar el script del repo.',
      'La decisión fue: seguir con el del plugin.',
      'Ver docs/agentic-workflow.md para el detalle.',
      'Nada que ver con esto.',
    ]) expect(looksLikeAck(prose), prose).toBe(false)

    for (const attempt of [
      'claim: 2026-01-01 — x',
      '- claim: 2026-01-01 — x',
      'clim: 2026-01-01 — x',      // a typo at distance 1
      'worktree: 2026-01-01 — x',  // an almost-valid signal
      'estado',                    // a bare signal, with nothing else
      'cualquiera: 2026-01-01 — x', // the fingerprint of a date
    ]) expect(looksLikeAck(attempt), attempt).toBe(true)
  })

  // THE VOICE OF THE NEW SILENCE. Ignoring prose creates a state in which the
  // file exists, has content, and silences nothing — the only one in which the
  // human can believe they already decided it. It gets said.
  it('a file that is prose THROUGHOUT silences nothing, and that is said out loud', () => {
    const { acks, problems, prosaSinAcuses } = parseAcks('Decidimos retirar el script del repo.\nY ya está.\n')
    expect(acks.size).toBe(0)
    expect(problems).toEqual([])
    expect(prosaSinAcuses).toBe(true)

    const docs = [{ path: 'AGENTS.md', content: '## Claim\nPrimer paso del agente: `./scripts/dispatch-check.sh <issue#>`\n' }]
    const text = formatFindings(detectConventions({ docs, files: [] }), { ackProsaSinAcuses: true })
    expect(text).toContain(ACK_PATH)
    expect(text).toMatch(/NO silencia ninguna señal/)
    expect(text).toMatch(/todo lo que hay dentro se ha leído como prosa/)
  })

  it('an empty file, or one with headings only, does NOT fire that warning (there is nobody to mislead)', () => {
    expect(parseAcks('').prosaSinAcuses).toBe(false)
    expect(parseAcks('# Acuses\n\n').prosaSinAcuses).toBe(false)
  })

  // A finding while attacking this very implementation: an acknowledgement
  // inside a fence (or behind a fence that was opened and never closed, which
  // swallows the rest of the file) does not parse AND was not "prose" either,
  // so the file came out in absolute silence. It is exactly the failure mode
  // this warning exists to cover.
  it('an acknowledgement swallowed by a code block does not pass in silence either', () => {
    const r = parseAcks('```\nclaim: 2026-07-28 — motivo\n```\n')
    expect(r.acks.size).toBe(0)
    expect(r.problems).toEqual([])
    expect(r.prosaSinAcuses).toBe(true)
  })

  it('a fence opened and never closed swallows the rest — and it gets said', () => {
    const r = parseAcks('```\nclaim: 2026-07-28 — motivo\n')
    expect(r.acks.size).toBe(0)
    expect(r.prosaSinAcuses).toBe(true)
  })

  it('with no live signal to silence, the warning does NOT come out: it would be pure noise', () => {
    // The condition that matters is not "your file silences nothing", it is
    // "you could believe you have hushed THIS and you have not". Without a
    // THIS, there is nobody to mislead.
    const clean = [{ path: 'AGENTS.md', content: '# Repo\nNada que choque con el loop.\n' }]
    const text = formatFindings(detectConventions({ docs: clean, files: [] }), { ackProsaSinAcuses: true })
    expect(text).not.toMatch(/NO silencia ninguna señal/)
  })

  it('a file that only has the reasoning commented out silences nothing either, and it gets said', () => {
    const r = parseAcks('<!--\nlo decidimos en julio\n-->\n')
    expect(r.acks.size).toBe(0)
    expect(r.prosaSinAcuses).toBe(true)
  })

  it('the live warning invites writing prose (otherwise nobody knows it is now allowed)', () => {
    const docs = [{ path: 'AGENTS.md', content: '## Claim\nPrimer paso del agente: `./scripts/dispatch-check.sh <issue#>`\n' }]
    const text = formatFindings(detectConventions({ docs, files: [] }))
    expect(text).toMatch(/prosa libre/)
  })
})
