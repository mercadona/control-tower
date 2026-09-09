// F16 — TWO FIELD FINDINGS FROM THE FIRST REAL RUN OF /ct-next.
//
//   H1  The blocking message named ONE blocker when there were five, and it
//       implied a remedy that unblocks nothing. In the real run there were
//       four `touches:ci` and one `touches:migration` occupying the GLOBAL
//       serialising lane, and the dispatcher cited a single one: whoever read
//       it would resolve that one, run again, and find themselves just as
//       blocked. Four times in a row.
//   H2  ct-next's warnings went over STDOUT; ct-groom's, over STDERR. Two
//       commands of the same plugin using different channels for the same
//       thing.
//
// Every test of this file was checked RED against the unfixed code — the
// observed output is written down in the test itself.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planDispatch, selectNext, collisionBlockers, SERIALIZING_TOUCHES } from '../scripts/dispatch.js'
import { hermeticEnv } from './fixtures/hermetic-env.js'

const here = dirname(fileURLToPath(import.meta.url))
const ctNext = join(here, '..', 'scripts', 'ct-next.mjs')
const ctGroom = join(here, '..', 'scripts', 'ct-groom.mjs')
const fixturesDir = join(here, 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
]

// Returns stdout and stderr SEPARATELY — that is precisely what H2 puts at
// stake, so this helper cannot concatenate them the way the helpers of the
// other files do.
function runNext(args, env = {}) {
  const r = spawnSync('node', [ctNext, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...hermeticEnv(fakePath), ...env },
  })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') }
}

// ============================================================================
// H1 — the GLOBAL serialising lane with several occupants.
// ============================================================================
describe('F16/H1 — when N of them block, the message cannot name a single one', () => {
  // Reproduction of the field case: 4 × touches:ci + 1 × touches:migration
  // holding the lane, a candidate with touches:pbxproj.
  const CAMPO = {
    issues: [
      { n: 10, order: 1, status: 'in-review', deps: [], touches: ['ci'], name: 'a' },
      { n: 11, order: 2, status: 'in-review', deps: [], touches: ['ci'], name: 'b' },
      { n: 12, order: 3, status: 'in-review', deps: [], touches: ['ci'], name: 'c' },
      { n: 13, order: 4, status: 'in-review', deps: [], touches: ['ci'], name: 'd' },
      { n: 14, order: 5, status: 'in-review', deps: [], touches: ['migration'], name: 'e' },
      { n: 20, order: 6, status: 'ready', deps: [], touches: ['pbxproj'], name: 'f' },
    ],
    mergedIssues: [],
  }

  // OBSERVED UNFIXED (dispatch.js:55-56): blockReason was
  //   { reason:'collision', kind:'serializing', issue:20, token:'pbxproj',
  //     runningToken:'ci', withIssue:10, withIssueStatus:'in-review' }
  // — a single blocker, with no trace at all of the other four.
  it('planDispatch exposes ALL the occupants of the lane, not only the first one', () => {
    const plan = planDispatch(CAMPO.issues, { mergedIssues: [], cap: 3 })
    expect(plan.selected).toEqual([])
    expect(plan.blockReason.reason).toBe('collision')
    expect(plan.blockReason.blockers.map((b) => b.n)).toEqual([10, 11, 12, 13, 14])
    // None of them shares a literal token with #20 (pbxproj): the five of them
    // block by LANE, and that has to stay distinguishable in the datum.
    expect(plan.blockReason.blockers.every((b) => b.sharedTokens.length === 0)).toBe(true)
    expect(plan.blockReason.blockers.map((b) => b.laneTokens)).toEqual([['ci'], ['ci'], ['ci'], ['ci'], ['migration']])
    // And the old shape (first blocker) is kept so as not to break any existing
    // consumer.
    expect(plan.blockReason.withIssue).toBe(10)
  })

  // OBSERVED UNFIXED: the line said "...que touches:ci, retenido por #10
  // (status:in-review) — #10 está en status:in-review: ... Mergea su PR; ...".
  // Neither #11, nor #12, nor #13, nor #14 appeared anywhere in the message,
  // and "Mergea su PR" (singular, about #10) unblocks nothing.
  it('ct-next names the five of them and says they ALL have to be cleared', () => {
    const r = runNext(['--repo', 'o/r', '--cap', '3', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify(CAMPO) })
    expect(r.code).toBe(0)
    for (const n of [10, 11, 12, 13, 14]) expect(r.stdout).toMatch(new RegExp(`#${n}\\b`))
    expect(r.stdout).toMatch(/5 issues?/)
    expect(r.stdout).toMatch(/ALL/)
    // The essential part: the message has to say explicitly that resolving one
    // is no use — it is the wrong deduction the old message invited.
    expect(r.stdout).toMatch(/resolving just one/i)
  })

  // A case nobody asked for, the same defect: the candidate touches TWO tokens
  // and each one is held by a different issue.
  // OBSERVED UNFIXED: token:'api', withIssue:1 — #2 (which holds 'db') did not
  // come out anywhere.
  it('several shared tokens, each with its owner → all of them come out', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'a' },
      { n: 2, order: 2, status: 'in-review', deps: [], touches: ['db'], name: 'b' },
      { n: 3, order: 3, status: 'ready', deps: [], touches: ['api', 'db'], name: 'c' },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 9 })
    expect(plan.blockReason.blockers.map((b) => [b.n, b.sharedTokens])).toEqual([[1, ['api']], [2, ['db']]])
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.stdout).toMatch(/#1\b/)
    expect(r.stdout).toMatch(/#2\b/)
    expect(r.stdout).toMatch(/'api'/)
    expect(r.stdout).toMatch(/'db'/)
  })

  // Another case nobody asked for: the SAME token held by two issues at once
  // (one in-progress, the other in-review — perfectly possible with labels put
  // on by hand or with a --release in between).
  // OBSERVED UNFIXED: withIssue:1 and nothing else; merging/waiting for #1 does
  // not unblock because #2 still holds 'api'.
  it('one and the same token held by TWO issues → both of them come out', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'a' },
      { n: 2, order: 2, status: 'in-review', deps: [], touches: ['api'], name: 'b' },
      { n: 3, order: 3, status: 'ready', deps: [], touches: ['api'], name: 'c' },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 9 })
    expect(plan.blockReason.blockers.map((b) => b.n)).toEqual([1, 2])
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.stdout).toMatch(/#1\b/)
    expect(r.stdout).toMatch(/#2\b/)
    // Mixed statuses: the remedy is NOT the same for the two of them, and the
    // message has to say both.
    expect(r.stdout).toMatch(/in-progress/)
    expect(r.stdout).toMatch(/in-review/)
  })

  // The worst of all, and the one nobody gave me: the token collision COVERS UP
  // a lane collision behind it. Resolving the shared token leaves you blocked
  // by the lane, with a new message. Two rounds to discover two walls.
  // OBSERVED UNFIXED: first {kind:'token', withIssue:1}; after merging #1,
  // {kind:'serializing', withIssue:2}.
  it('a shared token cannot cover up the serialising lane behind it', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-review', deps: [], touches: ['ci'], name: 'a' },
      { n: 2, order: 2, status: 'in-review', deps: [], touches: ['migration'], name: 'b' },
      { n: 3, order: 3, status: 'ready', deps: [], touches: ['ci'], name: 'c' },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 9 })
    expect(plan.blockReason.kind).toBe('token') // the primary kind does not change
    expect(plan.blockReason.blockers.map((b) => b.n)).toEqual([1, 2])
    expect(plan.blockReason.blockers[0].sharedTokens).toEqual(['ci'])
    expect(plan.blockReason.blockers[1].laneTokens).toEqual(['migration'])
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.stdout).toMatch(/#2\b/)
    expect(r.stdout).toMatch(/serialising/)
  })

  // The opposite excess is a defect too: forty issues listed are not
  // actionable. A sample is listed and the total is said — what is needed in
  // order to DECIDE is the number, not the forty names.
  it('with many blockers the list is capped but the count NEVER is', () => {
    const issues = []
    for (let n = 1; n <= 30; n++) issues.push({ n, order: n, status: 'in-review', deps: [], touches: ['ci'], name: `s${n}` })
    issues.push({ n: 99, order: 99, status: 'ready', deps: [], touches: ['migration'], name: 'cand' })
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/30 issues/)
    expect(r.stdout).toMatch(/and \d+ more/)
    // The thirty of them are not spewed out.
    const citados = new Set((r.stdout.match(/#(\d+)/g) || []).map((s) => s.slice(1)))
    expect(citados.size).toBeLessThan(20)
  })

  // Negative check: with a SINGLE blocker the usual message does not change
  // (the F13/staleness tests pin it literally, and adding "hay que despejarlos
  // todos" when there is only one would be noise).
  it('with a single blocker the message is still the usual one', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'a' },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'b' },
    ]
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.stdout).toMatch(/#2 is ready with merged deps, but it collides with work in flight: it shares the token 'api' with #1 \(status:in-progress\)/)
    expect(r.stdout).not.toMatch(/resolving just one/i)
  })
})

// ============================================================================
// The new ATTRIBUTION cannot diverge from the GATE that really decides.
//
// `touchesConflict` is still the only collision predicate (selectNext's
// `continue` uses it); `collisionBlockers` only attributes. That the two say
// the same thing was asserted in a comment and in nothing else — and a
// divergence there would produce exactly the failure this batch is chasing: a
// message that names blockers when there are none, or that keeps quiet about
// the only one there is. This oracle checks it by behaviour, over the complete
// space of the relevant touches, not over a handful of chosen examples.
//
// Discriminating power checked with TWO real sabotages of `collisionBlockers`,
// not assumed:
//   - `laneActive = false` (ignore the lane entirely) → RED, and the first
//     counterexample it spits out is `cand=["migration"] holder=["ci"]`: the
//     gate blocks and the attribution finds nobody.
//   - `laneActive = candHasSerializing` (activate the lane without requiring
//     that somebody be inside it) → GREEN, and rightly so: if there is no
//     serialising holder, there is none to list either, so the two versions
//     agree over the WHOLE space. That second sabotage is NOT a gap in the
//     test — it is a real redundancy of the code, and it is said here instead
//     of faking a coverage that does not exist.
describe('F16 — attribution and gate cannot diverge (exhaustive oracle)', () => {
  it('a non-empty collisionBlockers() ⟺ selectNext discards the candidate', () => {
    const universo = [...SERIALIZING_TOUCHES, 'api', 'ui', 'db']
    // Every subset of up to 2 tokens (the empty one included).
    const combos = [[]]
    for (const a of universo) {
      combos.push([a])
      for (const b of universo) if (a !== b) combos.push([a, b])
    }
    let bloqueos = 0
    let libres = 0
    for (const candT of combos) {
      for (const holderT of combos) {
        const cand = { n: 100, order: 1, status: 'ready', deps: [], touches: candT }
        const holders = [{ n: 1, status: 'in-progress', touches: holderT }]
        const blockers = collisionBlockers(cand, holders)
        const seleccionado = selectNext([cand], { mergedIssues: [], runningTouches: holderT, concurrencyCap: 1 })
        const gateBloquea = seleccionado.length === 0
        expect(blockers.length > 0, `cand=${JSON.stringify(candT)} holder=${JSON.stringify(holderT)}`).toBe(gateBloquea)
        if (gateBloquea) bloqueos++
        else libres++
      }
    }
    // Without this, an oracle that never saw a block (or never a free case)
    // would pass by accident: the space walked is required to have both.
    expect(bloqueos).toBeGreaterThan(100)
    expect(libres).toBeGreaterThan(100)
  })

  it('a holder that does not block NEVER appears in the list (negative check)', () => {
    const cand = { n: 3, order: 3, status: 'ready', deps: [], touches: ['api'] }
    const holders = [
      { n: 1, status: 'in-progress', touches: ['ui'] },   // nothing to do with it
      { n: 2, status: 'in-review', touches: ['api'] },    // this one does
      { n: 4, status: 'in-review', touches: [] },         // no touches
    ]
    expect(collisionBlockers(cand, holders).map((b) => b.n)).toEqual([2])
  })

  it('the lane is NOT invoked if the candidate touches no serialising token', () => {
    const cand = { n: 3, order: 3, status: 'ready', deps: [], touches: ['api'] }
    const holders = [{ n: 1, status: 'in-progress', touches: ['migration', 'ci'] }]
    expect(collisionBlockers(cand, holders)).toEqual([])
  })
})

// ============================================================================
// H1, the same lens over 'none-ready': a case nobody gave me.
// ============================================================================
describe('F16/H1 — "there is nothing to dispatch YET" told you to wait for something that does not arrive on its own', () => {
  // OBSERVED UNFIXED, with three issues in status:backlog:
  //   "No hay ningún issue en status:ready — no hay nada que despachar todavía."
  // "todavía" invites waiting; promoting backlog → ready is a deliberate HUMAN
  // gate (ct-groom even prints a reminder about it). Nobody is going to do it
  // if the dispatcher says it is not time yet.
  it('with issues in backlog, it says the gate is human and how it opens', () => {
    const issues = [
      { n: 1, order: 1, status: 'backlog', deps: [], touches: ['api'], name: 'a' },
      { n: 2, order: 2, status: 'backlog', deps: [], touches: ['ui'], name: 'b' },
      { n: 3, order: 3, status: 'backlog', deps: [], touches: ['db'], name: 'c' },
    ]
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/3 .*status:backlog/)
    expect(r.stdout).toMatch(/--add-label status:ready/)
    expect(r.stdout).not.toMatch(/no hay nada que despachar todavía/)
  })

  // OBSERVED UNFIXED: with ZERO open issues exactly the same text came out as
  // with three in backlog — two situations with opposite remedies (promote vs.
  // groom / check --repo) made indistinguishable.
  it('with ZERO open issues it does not say the same as with issues in backlog', () => {
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues: [], mergedIssues: [] }) })
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/not a single open issue/i)
    expect(r.stdout).toMatch(/ct-groom|--repo/)
  })
})

// ============================================================================
// H2 — one single channel criterion for the three executables.
// ============================================================================
describe('F16/H2 — the warnings of the three executables go over the same channel', () => {
  // OBSERVED UNFIXED: a run of /ct-next with warnings left 0 bytes on stderr
  // (ct-next.mjs:888 emitted `console.log(\`warning: ...\`)`), while ct-groom.mjs
  // emits its own over console.error.
  it('ct-next sends the warnings to STDERR, not to stdout', () => {
    // F35: the vehicle used to be the "default account" warning of ACCOUNT_MAP,
    // which no longer exists. `--base` is used instead, which warns for the
    // same old reason (a base that is not the default branch breaks the closing
    // keywords) and depends on nothing in the environment.
    const fx = JSON.stringify({ issues: [], mergedIssues: [] })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--base', 'otra-rama', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.stderr).toMatch(/warning: --base otra-rama/)
    expect(r.stdout).not.toMatch(/^warning:/m)
  })

  it('ct-groom still sends its own to STDERR (the reference channel)', () => {
    const r = spawnSync('node', [ctGroom, '/no/existe/spec.md', '--repo', 'o/r', '--dry-run'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
    })
    expect(r.stderr).toMatch(/no se pudo leer el spec/)
    expect(r.stdout).toBe('')
  })

  // The plan (what somebody might want to capture or parse) still comes out
  // over stdout, without mixing with the diagnosis.
  it('the dispatch plan is still clean stdout, with no warnings inside it', () => {
    const fx = JSON.stringify({
      issues: [{ n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend' }],
      mergedIssues: [],
    })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--base', 'otra-rama', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.stdout).toMatch(/git worktree add/)
    expect(r.stdout).not.toMatch(/warning:/)
    expect(r.stderr).toMatch(/warning:/)
  })

  // The warnings recap of the 'exit' handler already went over stderr
  // (writeSync 2) and is still there: without it, an exit 0 with warnings reads
  // as "all good".
  it('the final warnings recap is still on stderr and counts the same warnings', () => {
    const fx = JSON.stringify({ issues: [], mergedIssues: [] })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--base', 'otra-rama', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.stderr).toMatch(/DESPITE \d+ warning\(s\)/)
  })
})
