// F18 — WHAT DISAPPEARS IN SILENCE.
//
// Four different holes with the same shape: the dispatcher (or the groom)
// stops seeing something and does not say so, so the operator reads a careful
// explanation of something else and is left with no clue at all about what
// really happened.
//
//   H1  a dep closed by a LOOSE COMMIT (not by a merged PR) is taken as
//       satisfied. It happened in the field with a DOCUMENTATION commit that
//       only MENTIONED the string `Closes #451` — quotes do not protect.
//   H2  a CLOSED issue that keeps its `status:` label disappears from the
//       dispatcher (it only sweeps open ones) without a word.
//   H3  an agent that declares itself BLOCKED in its STATE.md leaves the claim
//       in place for ever: no transition of the loop takes it out of there and
//       `stalenessNote` does not see it (the worktree and the branch DO exist).
//   H4  "PR merged, issue open" was a dilemma the human had to resolve by
//       looking at GitHub; the branch is deterministic (`feat/<n>`).
//   H6  `gh project item-list --limit 200` without checking the truncation:
//       with more than 200 items, `hasProjectItem` says `false` about items
//       that DO exist and the groom duplicates them.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdtempSync as mkdtemp2, readFileSync, rmSync } from 'node:fs'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { closedWithLiveStatus, buildDispatchInput } from '../scripts/gh-issue-map.js'
import {
  planClosureProbe, buildClosureQuery, parseClosureProbe,
  formatSuspectClosureWarnings, formatMergedButOpenWarnings, formatClosureCoverageNote,
  CLOSURE_PROBE_MAX,
} from '../scripts/gh-closure.js'

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

// FAKE_GH_COUNTER_FILE is MANDATORY here: without it, the stub's
// `nextCallIndex` always returns 0 and BOTH enumerations (open and closed) get
// the SAME element of FAKE_GH_LIST_SEQUENCE — that is, the list of "closed"
// ones would actually be the list of open ones. Verified by construction while
// writing these tests: the first attempt reported the OPEN issue #42 as
// "closed with a live status:ready".
function runReal(args, envOverrides = {}) {
  const counter = join(mkdtempSync(join(tmpdir(), 'ct-f18-c-')), 'n')
  dirs.push(dirname(counter))
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: fakePath, FAKE_GH_COUNTER_FILE: counter, ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.stderr || '', stdout: r.stdout || '' }
}

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) rmSyncBestEffort(d) })
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-f18-'))
  dirs.push(d)
  return d
}

function rawIssue({ number, order, status = 'status:ready', touches = [], deps = [], stateReason }) {
  const labels = [...(status ? [{ name: status }] : []), ...touches.map((t) => ({ name: `touches:${t}` }))]
  const depsBlock = deps.length ? `\n## Dependencias\n${deps.map((d) => `merge-after #${d}`).join('\n')}\n` : ''
  const o = { number, title: `#${number} slice`, labels, body: `<!-- ct-order:${order} -->${depsBlock}` }
  if (stateReason !== undefined) o.state_reason = stateReason
  return o
}

// ===========================================================================
// H2 — the closed issue that keeps its `status:`
// ===========================================================================

describe('H2 (unit) — closedWithLiveStatus: the residue of labels on closed issues', () => {
  it('recognises the live `status:` labels of a closed issue, with its number and its closure reason', () => {
    const res = closedWithLiveStatus([
      { number: 451, stateReason: 'COMPLETED', labels: [{ name: 'status:ready' }, { name: 'touches:pbxproj' }, { name: 'type:ui' }] },
      { number: 400, stateReason: 'COMPLETED', labels: [{ name: 'type:ui' }] },
    ])
    expect(res).toEqual([{ n: 451, statusLabels: ['ready'], stateReason: 'COMPLETED' }])
  })

  it('the set measured in the field repo: 10 of 99 closed ones keep a label, spread over four states', () => {
    // Real numbers and states, measured with a COMPLETE paginated query (not a
    // hand-written list: the first field measurement counted 6 out of 10
    // because it left out the four `in-review` ones).
    const fieldSet = [
      [53, 'in-review'], [54, 'in-review'], [58, 'in-review'], [63, 'in-review'],
      [155, 'in-progress'], [245, 'in-progress'],
      [156, 'ready'], [157, 'ready'], [161, 'ready'],
      [158, 'blocked'],
    ]
    const closed = fieldSet.map(([n, s]) => ({ number: n, stateReason: 'COMPLETED', labels: [{ name: `status:${s}` }] }))
    // …plus 89 closed ones with no `status:` label at all (the rest of the repo).
    for (let i = 0; i < 89; i++) closed.push({ number: 1000 + i, stateReason: 'COMPLETED', labels: [] })
    const res = closedWithLiveStatus(closed)
    expect(res.length).toBe(10)
    expect(res.map((r) => r.n)).toEqual([53, 54, 58, 63, 155, 245, 156, 157, 161, 158])
  })

  it('a `status:` label with NO value does not count (same criterion as empty area:/touches:)', () => {
    expect(closedWithLiveStatus([{ number: 7, labels: [{ name: 'status:' }, { name: 'status: ' }] }])).toEqual([])
  })

  it('buildDispatchInput exposes it alongside mergedIssues, with no extra call', () => {
    const open = [rawIssue({ number: 1, order: 1 })]
    const closed = [{ number: 451, state_reason: 'COMPLETED', stateReason: 'COMPLETED', body: '<!-- ct-order:9 -->', labels: [{ name: 'status:ready' }] }]
    const dispatchInput = buildDispatchInput(open, closed)
    expect(dispatchInput.closedStatusResidue).toEqual([{ n: 451, statusLabels: ['ready'], stateReason: 'COMPLETED' }])
  })
})

describe('H2 (CLI) — the slice that fell off the queue stops disappearing in silence', () => {
  it('a closed one with status:ready is named, and it is said that for /ct-next it DOES NOT EXIST', () => {
    const repoRoot = makeRepoRoot()
    const openIssue = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['ui'] })
    const closedIssue = { number: 451, state_reason: 'completed', body: '<!-- ct-order:1 -->', labels: [{ name: 'status:ready' }] }
    const r = runReal(['--repo', 'o/r', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue], [closedIssue]]),
    })
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/#451/)
    expect(r.err).toMatch(/CERRADOS conservan una label/)
    expect(r.err).toMatch(/NO EXISTEN/)
    expect(r.err).toMatch(/status:ready/)
    // It is diagnostics, not product: never over stdout (F16 channel criterion).
    expect(r.stdout).not.toMatch(/CERRADOS conservan una label/)
  })

  it('a closed one with status:in-review is NOT reported as an anomaly: it is the normal end of a slice', () => {
    const repoRoot = makeRepoRoot()
    const openIssue = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['ui'] })
    const closedIssue = { number: 300, state_reason: 'completed', body: '<!-- ct-order:1 -->', labels: [{ name: 'status:in-review' }] }
    const r = runReal(['--repo', 'o/r', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue], [closedIssue]]),
    })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/#300 .*status:ready/)
    expect(r.out).not.toMatch(/CERRADOS conservan una label `status:` viva, y para/)
    // But the number is not hidden: it is counted and it is said why it is not
    // an anomaly.
    expect(r.err).toMatch(/final NORMAL de un slice/)
  })

  it('a single aggregated warning, not one per issue: ten residues are NOT ten lines', () => {
    const repoRoot = makeRepoRoot()
    const openIssue = rawIssue({ number: 42, order: 20, status: 'status:ready', touches: ['ui'] })
    const closedIssues = []
    const statuses = ['ready', 'ready', 'ready', 'in-progress', 'in-progress', 'blocked', 'in-review', 'in-review', 'in-review', 'in-review']
    statuses.forEach((s, i) => closedIssues.push({ number: 100 + i, state_reason: 'completed', body: `<!-- ct-order:${i + 1} -->`, labels: [{ name: `status:${s}` }] }))
    const r = runReal(['--repo', 'o/r', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue], closedIssues]),
    })
    expect(r.code).toBe(0)
    // Only the emissions AT THE MOMENT (`aviso: …`) are counted, not the recap
    // at the end, which by design repeats every accumulated warning.
    const lines = r.err.split('\n').filter((l) => /^aviso: \d+ issue\(s\) CERRADOS/.test(l))
    expect(lines.length).toBe(1)
    // F19/H2 CHANGES THIS NUMBER ON PURPOSE: it was 6 when `blocked` counted as
    // an anomaly alongside `ready` and `in-progress`. A closed one with
    // `status:blocked` is INERT — it holds no tokens, it blocks no queue,
    // nothing happens to anyone for leaving it there — and putting it in the
    // same headline as the one that fell off the dispatch queue is exactly what
    // teaches a reader to discount the whole headline. Now the headline counts
    // 5 (3 ready + 2 in-progress) and the `blocked` one comes out in its own
    // count, just like the `in-review` ones.
    expect(lines[0]).toMatch(/^aviso: 5 issue\(s\) CERRADOS/)
    expect(lines[0]).toMatch(/Otros 4 cerrados conservan status:in-review/)
    expect(lines[0]).toMatch(/Otros 1 cerrados conservan status:blocked/)
  })
})

// ===========================================================================
// H3 — the BLOCKED agent that leaves the claim in place
// ===========================================================================

// F22, Task 6: the `blocked` is read from `.agent/SLICE.md`, not from `.agent/
// STATE.md` (that one became the coordinator's file, frozen at the base — see
// __tests__/f22-slice-state.test.js). This block seeds SLICE.md, which is
// the file a worktree of THIS version brings.
describe('H3 (CLI) — a claim whose SLICE.md declares itself BLOCKED', () => {
  function repoWithWorktree(n, sliceMd) {
    const repoRoot = makeRepoRoot()
    const wt = join(repoRoot, '.worktrees', String(n), '.agent')
    mkdirSync(wt, { recursive: true })
    if (sliceMd !== null) writeFileSync(join(wt, 'SLICE.md'), sliceMd)
    return repoRoot
  }

  const blockedSliceMd = '---\nstatus: wip\nblocked:\n  reason: la API de pagos del sandbox está caída\n  unblock: que Stripe restaure el entorno de test\n---\n\nnotas\n'

  it('it says so, with the reason, and names the three transitions that do NOT help', () => {
    const repoRoot = repoWithWorktree(41, blockedSliceMd)
    const inProgress = rawIssue({ number: 41, order: 1, status: 'status:in-progress', touches: ['api'] })
    const ready = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['api'] })
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[inProgress, ready], []]),
    })
    expect(r.err).toMatch(/#41/)
    expect(r.err).toMatch(/se declara BLOQUEADO/)
    expect(r.err).toMatch(/la API de pagos del sandbox está caída/)
    expect(r.err).toMatch(/--requeue/)
    expect(r.err).toMatch(/--release/)
    // And it does not claim that anyone is moving it forward.
    expect(r.err).toMatch(/ningún agente avanzándolo/)
  })

  it('with no `blocked` in the SLICE.md it says nothing (negative control: the normal case)', () => {
    const repoRoot = repoWithWorktree(41, '---\nstatus: wip\nnext_action: seguir\n---\n\nnotas\n')
    const inProgress = rawIssue({ number: 41, order: 1, status: 'status:in-progress', touches: ['api'] })
    const ready = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['api'] })
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[inProgress, ready], []]),
    })
    expect(r.out).not.toMatch(/se declara BLOQUEADO/)
  })

  it('`status: blocked` (the most likely way of writing it wrong) also counts', () => {
    const repoRoot = repoWithWorktree(41, '---\nstatus: blocked\nnext_action: seguir\n---\n\nnotas\n')
    const inProgress = rawIssue({ number: 41, order: 1, status: 'status:in-progress', touches: ['api'] })
    const ready = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['api'] })
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[inProgress, ready], []]),
    })
    expect(r.err).toMatch(/se declara BLOQUEADO/)
  })
})

// ===========================================================================
// H1 + H4 — who closed the issue, and which branch was really merged
// ===========================================================================

describe('H1/H4 (unit) — planClosureProbe: what is asked and what is not', () => {
  const issues = [
    { n: 10, status: 'ready', deps: [451] },
    { n: 11, status: 'ready', deps: [451, 99] },
    { n: 12, status: 'in-review', deps: [] },
    { n: 13, status: 'backlog', deps: [777] },
  ]
  it('it only asks about the deps that ALREADY count as satisfied, and about the in-review ones', () => {
    const plan = planClosureProbe({ issues, mergedIssues: [451, 777] })
    expect(plan.deps).toEqual([451, 777])
    expect(plan.inReview).toEqual([12])
    expect(plan.dependents.get(451)).toEqual([10, 11])
  })
  it('with no satisfied deps and no in-review, there is NO query (zero network calls)', () => {
    const plan = planClosureProbe({ issues: [{ n: 1, status: 'ready', deps: [] }], mergedIssues: [] })
    expect(buildClosureQuery('o/r', plan)).toBeNull()
  })
  it('the query asks for the issue closer and the merged PR of the deterministic branch feat/<n>', () => {
    const plan = planClosureProbe({ issues, mergedIssues: [451] })
    const q = buildClosureQuery('o/r', plan)
    expect(q).toMatch(/repository\(owner:"o", name:"r"\)/)
    expect(q).toMatch(/dep451: issue\(number:451\)/)
    expect(q).toMatch(/CLOSED_EVENT/)
    expect(q).toMatch(/rev12: pullRequests\(headRefName:"feat\/12", states:\[MERGED\]/)
  })
  it('the cap is SAID when it trims, it never trims in silence', () => {
    const many = Array.from({ length: CLOSURE_PROBE_MAX + 5 }, (_, i) => ({ n: 1000 + i, status: 'ready', deps: [i + 1] }))
    const plan = planClosureProbe({ issues: many, mergedIssues: many.map((_, i) => i + 1) })
    expect(formatClosureCoverageNote(plan)).toMatch(/SIN mirar/)
    expect(formatClosureCoverageNote(planClosureProbe({ issues, mergedIssues: [451] }))).toBeNull()
  })
})

describe('H1/H4 (unit) — parseClosureProbe: it does not invent what did not arrive', () => {
  const plan = { deps: [451, 452, 453, 454], inReview: [12], dependents: new Map([[451, [10]]]) }
  const raw = {
    data: {
      repository: {
        dep451: { number: 451, timelineItems: { nodes: [{ closer: { __typename: 'Commit', oid: 'c4b0da66b398b4d1', messageHeadline: 'docs(loop): #37-#46 cerrados como completed…', associatedPullRequests: { nodes: [] } } }] } },
        dep452: { number: 452, timelineItems: { nodes: [{ closer: { __typename: 'PullRequest', number: 62, merged: true } }] } },
        dep453: { number: 453, timelineItems: { nodes: [{ closer: null }] } },
        rev12: { nodes: [{ number: 88, mergedAt: '2026-07-12T10:00:00Z' }] },
      },
    },
  }
  const { closers, mergedPr } = parseClosureProbe(raw, plan)
  it('it tells apart a loose commit, a merged PR, a manual closure and "we do not know"', () => {
    expect(closers[451].kind).toBe('commit')
    expect(closers[451].mergedPrs).toEqual([])
    expect(closers[452]).toMatchObject({ kind: 'pull-request', merged: true })
    expect(closers[453].kind).toBe('manual')
    expect(closers[454].kind).toBe('unknown') // the alias did not arrive: it is NOT 'manual'
  })
  it('only the loose commit raises suspicion; the manual closure does NOT (86 of 97 in the field)', () => {
    const w = formatSuspectClosureWarnings(closers, plan.dependents)
    expect(w.length).toBe(1)
    expect(w[0]).toMatch(/#451/)
    expect(w[0]).toMatch(/COMMIT c4b0da66/)
    expect(w[0]).toMatch(/#10/)
    expect(w.join(' ')).not.toMatch(/#453/)
    expect(w.join(' ')).not.toMatch(/#452/)
    expect(w.join(' ')).not.toMatch(/#454/)
  })
  it('a commit that DOES belong to a merged PR is not suspicious', () => {
    const okRaw = { data: { repository: { dep451: { timelineItems: { nodes: [{ closer: { __typename: 'Commit', oid: 'abc', messageHeadline: 'x', associatedPullRequests: { nodes: [{ number: 9, merged: true }] } } }] } } } } }
    const p = { deps: [451], inReview: [], dependents: new Map() }
    expect(formatSuspectClosureWarnings(parseClosureProbe(okRaw, p).closers, p.dependents)).toEqual([])
  })
  it('H4: the merged PR of feat/12 turns the dilemma into a fact', () => {
    expect(mergedPr[12]).toEqual({ number: 88, mergedAt: '2026-07-12T10:00:00Z' })
    const w = formatMergedButOpenWarnings(mergedPr, 'o/r')
    expect(w[0]).toMatch(/feat\/12 YA está mergeada en el PR #88/)
    expect(w[0]).toMatch(/2026-07-12/)
    expect(w[0]).toMatch(/gh issue close 12 --repo o\/r --reason completed/)
  })
})

describe('H1/H4 (CLI) — the check enters the real run', () => {
  it('a dep closed by a loose commit is warned about, naming whoever depends on it', () => {
    const repoRoot = makeRepoRoot()
    const openIssue = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['ui'], deps: [1] })
    const closedIssue = { number: 451, state_reason: 'completed', body: '<!-- ct-order:1 -->', labels: [] }
    const closure = {
      data: { repository: { dep451: { timelineItems: { nodes: [{ closer: { __typename: 'Commit', oid: 'c4b0da66b398', messageHeadline: 'docs(loop): kickoff', associatedPullRequests: { nodes: [] } } }] } } } },
    }
    const r = runReal(['--repo', 'o/r', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue], [closedIssue]]),
      FAKE_GH_CLOSURE_JSON: JSON.stringify(closure),
    })
    expect(r.err).toMatch(/#451 consta cerrado como \*completed\* por el COMMIT/)
    expect(r.err).toMatch(/#42 depende de #451/)
  })

  it('if the query fails, it is said and NOTHING is blocked (a detector has no veto)', () => {
    const repoRoot = makeRepoRoot()
    const openIssue = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['ui'], deps: [1] })
    const closedIssue = { number: 451, state_reason: 'completed', body: '<!-- ct-order:1 -->', labels: [] }
    const r = runReal(['--repo', 'o/r', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue], [closedIssue]]),
      FAKE_GH_CLOSURE_FAIL: '1',
    })
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/no se ha podido comprobar/i)
    // The dispatch runs its course: #42 is selected all the same.
    expect(r.stdout).toMatch(/#42/)
  })
})

// ===========================================================================
// §9 contract (ct-init.sh): v7 → v8
// ===========================================================================

const ctInit = join(here, '..', 'scripts', 'ct-init.sh')
function seedContract() {
  const dir = mkdtemp2(join(tmpdir(), 'ct-f18-init-'))
  execFileSync('bash', [ctInit, dir], { encoding: 'utf8' })
  const contract = readFileSync(join(dir, 'docs', 'superpowers', 'CONTRATO-SLICES.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return contract
}
const flat = (s) => s.replace(/\*/g, '').replace(/\s+/g, ' ')
// The v7 fixture is not a transcription: its sha256 is 8730d7be…, exactly the
// hash SLICES_PRISTINE_HASHES already had registered for the v7 block, and it
// was generated by running b6b9754's ct-init.sh. It is the real block.
const V7 = () => readFileSync(join(here, 'fixtures', 'slices-contract-v7.md'), 'utf8')

describe('§9 contract (F18): the falsified premise and the two states nobody stated', () => {
  it('control: v7 DID say a deliberate wrong action was needed, and kept quiet about the other two', () => {
    const v7 = flat(V7())
    expect(v7).toMatch(/no se detecta/)
    expect(v7).toMatch(/haría falta cruzar el grafo de PRs/)
    expect(v7).not.toMatch(/closing keywords/)
    expect(v7).not.toMatch(/las comillas no protegen/)
    // Nothing about the residue of labels on closed ones…
    expect(v7).not.toMatch(/conserva su label `status:`/)
    // …nor about the blocked claim.
    expect(v7).not.toMatch(/BLOQUEADO retiene su claim/)
  })

  it('v8 says writing the keyword in any commit is enough, and that quotes do not protect', () => {
    const v8 = flat(seedContract())
    expect(v8).toMatch(/no requiere que nadie se equivoque a propósito/)
    expect(v8).toMatch(/cualquier mensaje de commit/)
    expect(v8).toMatch(/las comillas no protegen/)
    expect(v8).not.toMatch(/haría falta cruzar el grafo de PRs/)
  })

  it('v8 does not turn the detector into a gate, and says why (86 of 97 closures are manual)', () => {
    const v8 = flat(seedContract())
    expect(v8).toMatch(/86 de 97 cierres/)
    expect(v8).toMatch(/avisa/)
  })

  it('v8 names the `closed + live status:` residue with its measured rate', () => {
    const v8 = flat(seedContract())
    expect(v8).toMatch(/CERRADO que conserva su label `status:` no existe/)
    expect(v8).toMatch(/10 cerrados con label viva de cada 99/)
    // And it makes clear that in-review on a closed one is NOT an anomaly.
    expect(v8).toMatch(/sobre un issue cerrado NO es anomalía/)
  })

  it('v8 names the deadlock of the blocked claim and the three transitions that do not release it', () => {
    const v8 = flat(seedContract())
    expect(v8).toMatch(/BLOQUEADO retiene su claim/)
    expect(v8).toMatch(/--requeue` se niega/)
    expect(v8).toMatch(/--release` mentiría/)
    // It does not promise an automatic fix that does not exist.
    expect(v8).toMatch(/no lo arregla/)
  })

  // F20: this test pins that the marker and the footnote declare the SAME
  // version as `SLICES_CONTRACT_VERSION` — that the three cannot diverge is the
  // property, not the concrete number. The number is updated on every round
  // that touches the contract's text (F18 → v8; F20 → v9, because of the
  // sharing out of roles); what can never happen is that one of the three
  // falls behind.
  it("the block's declared version matches, in the marker and in the footnote, SLICES_CONTRACT_VERSION", () => {
    const src = readFileSync(join(here, '..', 'scripts', 'ct-init.sh'), 'utf8')
    const declared = src.match(/^SLICES_CONTRACT_VERSION=(\d+)$/m)?.[1]
    expect(declared).toBeDefined()
    const seeded = seedContract()
    expect(seeded).toMatch(new RegExp(`<!-- ct-init:slices-contract-version: ${declared} -->`))
    expect(seeded).toMatch(new RegExp(`contrato v${declared}`))
  })
})

// The same lens as H1 applied to the REST of the contract: are there more
// decisions justified with a "this only happens if someone does something
// wrong"? Yes, one — and it came from the previous round.
describe("§9 contract (F18): the cause the kickoff cannot guarantee", () => {
  it('control: v7 said that case "only shows up" with manual PRs or an edited body', () => {
    const v7 = flat(V7())
    expect(v7).toMatch(/solo aparece con PRs abiertos a mano/)
    // And the kickoff was the reason the obvious cause was ruled out.
    expect(v7).toMatch(/le da a cada agente lo pide explícitamente/)
  })

  it('v8 names the most likely cause: that the agent simply did not put it there', () => {
    const v8 = flat(seedContract())
    expect(v8).not.toMatch(/solo aparece con PRs abiertos a mano/)
    expect(v8).toMatch(/el kickoff es un PROMPT, no un gate/)
    expect(v8).toMatch(/la causa más probable de este caso es simplemente que el agente no lo puso/)
  })

  it('v7 already contradicted itself: it admitted it cannot guarantee obedience', () => {
    // It is not an inference: the sentence is in the same block, two paragraphs
    // further down. What was missing was connecting it to the list of causes.
    expect(flat(V7())).toMatch(/Lo que el kickoff no puede garantizar es que el agente obedezca/)
  })
})
