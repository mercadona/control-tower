import { describe, it, expect } from 'vitest'
import { extractAc, extractDeps, extractOrder, extractSpecLink, normalizeSpecLink, specTarget, locateSection, countHeadingLines, detectLineEnding, normalizeToLF, mapGhIssue, filterMergedIssues, buildOrderIndex, buildDispatchInput, AC_HEADING_FORMS, NO_MILESTONE_KEY, epicKeyOf, extractDepsInSection, extractStrayDeps, extractE2eRuns, extractSenal, SENAL_HEADING } from '../scripts/gh-issue-map.js'
import { selectNext } from '../scripts/dispatch.js'
import { buildIssueBody } from '../scripts/groom.js'

// SPEC_REF (F10): the already-resolved spec reference buildIssueBody receives —
// a path relative to the repo root, the §9's real heading and the verified
// absolute URL. It replaces the old `{ specPath, specSection }`.
const SPEC_REF = {
  path: 'spec.md',
  heading: '9. Slices',
  url: 'https://github.com/o/r/blob/main/spec.md#9-slices',
  reason: null,
}

describe('mapGhIssue — defensive about absent labels and markers', () => {
  it('with no ct-order marker in the body → order falls back to i.number', () => {
    const mapped = mapGhIssue({ number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: 'sin marcador' })
    expect(mapped.order).toBe(42)
    expect(mapped.n).toBe(42)
  })
  it('with no status: label → status falls back to "backlog"', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'type:backend' }], body: '' })
    expect(mapped.status).toBe('backlog')
  })
  it('with no touches: labels → touches is []', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }], body: '' })
    expect(mapped.touches).toEqual([])
  })
  // Finding 5 of the final review: gh-issue-map.js#mapGhIssue only looked at
  // `touches:`, dropping `area:` entirely, while claim.js#tokensOf already
  // treated both prefixes as equally relevant for collision (spec §14: a
  // conflict = a shared `area:` OR `touches:` token). The real consequence:
  // ct-next.mjs could co-dispatch two slices that only share an `area:`
  // (`area:api` in both, say) without detecting it during selection —
  // worktrees and agents already launched — and only dispatch-check.mjs
  // rejected it afterwards.
  it('with an area: label (and no touches:) → it also goes into touches, just like claim.js#tokensOf', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'area:api' }], body: '' })
    expect(mapped.touches).toEqual(['api'])
  })
  it('with area: AND touches: at once → both go in, each stripped of its own prefix', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'area:api' }, { name: 'touches:db' }], body: '' })
    expect(mapped.touches).toEqual(['api', 'db'])
  })
  it('with no type: label → type is an empty string, not the literal "type:"', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }], body: '' })
    expect(mapped.type).toBe('')
  })
  it('an empty or absent body → deps [] and ac []', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body: '' })
    expect(mapped.deps).toEqual([])
    expect(mapped.ac).toEqual([])
    const mapped2 = mapGhIssue({ number: 1, title: '#1 x', labels: [] })
    expect(mapped2.deps).toEqual([])
    expect(mapped2.ac).toEqual([])
  })
  it('with a ct-order marker and merge-after INSIDE "## Dependencias" → correct order and deps', () => {
    // D1 finding 2: mapGhIssue no longer scans the WHOLE body looking for
    // "merge-after #N" — only the content of the recognised "## Dependencias"
    // section (unified with --reconcile's scope). A "merge-after" outside that
    // section (see the dedicated describe further down) is ignored.
    const body = 'algo\n## Dependencias\n- merge-after #3\n- merge-after #4\n\n<!-- ct-order:7 -->'
    const mapped = mapGhIssue({ number: 99, title: '#99 x', labels: [], body })
    expect(mapped.order).toBe(7)
    expect(mapped.deps).toEqual([3, 4])
    expect(mapped.depsMalformed).toBe(false)
  })
  it('name: it strips the "#N " prefix from the title', () => {
    const mapped = mapGhIssue({ number: 5, title: '#5 refresh token', labels: [], body: '' })
    expect(mapped.name).toBe('refresh token')
  })
  it('issue: always "#<number>", never undefined', () => {
    const mapped = mapGhIssue({ number: 5, title: '#5 x', labels: [], body: '' })
    expect(mapped.issue).toBe('#5')
  })
})

describe('extractAc', () => {
  it('with no "## Acceptance criteria" section → []', () => {
    expect(extractAc('cualquier body sin esa sección')).toEqual([])
    expect(extractAc('')).toEqual([])
    expect(extractAc(null)).toEqual([])
  })
  it('with an AC block → it extracts every "- …" line', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- AC-7.1 algo\n- AC-7.2 otro\n\n## Dependencias\n- merge-after #1'
    expect(extractAc(body)).toEqual(['AC-7.1 algo', 'AC-7.2 otro'])
  })
  it('the placeholder "(rellenar desde el spec)" does not count as a real AC', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- (rellenar desde el spec)\n\n## Dependencias'
    expect(extractAc(body)).toEqual([])
  })
  it('the AC block is the last section of the body (with no following heading) → it is extracted too', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- AC-1 único'
    expect(extractAc(body)).toEqual(['AC-1 único'])
  })
})

// extractE2eRuns had coverage of the single case and the empty case (through
// the end-to-end chain tests and dispatch-check --release), but none with MORE
// than one run read from a real body — the split/trim/filter itself had no test
// forcing it to break more than one line.
describe('extractE2eRuns', () => {
  it('with no "## E2E" section → []', () => {
    expect(extractE2eRuns('cualquier body sin esa sección')).toEqual([])
    expect(extractE2eRuns('')).toEqual([])
    expect(extractE2eRuns(null)).toEqual([])
  })
  it('with several runs → one per line, in order, verbatim', () => {
    const body = '## Acceptance criteria\n- un criterio\n\n## E2E\n- curl -i :9115/metrics responde 200\n- el server escucha en 9115\n- el example compila con cargo build --examples\n\n## Dependencias\n- merge-after #1'
    expect(extractE2eRuns(body)).toEqual([
      'curl -i :9115/metrics responde 200',
      'el server escucha en 9115',
      'el example compila con cargo build --examples',
    ])
  })
})

describe('mapGhIssue + groom.js#buildIssueBody — it ties the two pieces together (it detects format drift)', () => {
  it('a body generated by ct-groom\u2019s real buildIssueBody is mapped correctly', () => {
    const slice = { n: 7, entrega: 'refresh token', ac: ['AC-7.1 algo', 'AC-7.2 otro'], deps: [1, 2], protected: '–' }
    const body = buildIssueBody(slice, SPEC_REF)
    const mapped = mapGhIssue({ number: 55, title: '#55 refresh token', labels: [{ name: 'status:ready' }, { name: 'type:backend' }], body })
    expect(mapped.order).toBe(7) // <!-- ct-order:7 --> generated by buildIssueBody
    expect(mapped.deps).toEqual([1, 2])
    expect(mapped.ac).toEqual(['AC-7.1 algo', 'AC-7.2 otro'])
    expect(mapped.status).toBe('ready')
    expect(mapped.type).toBe('backend')
  })
})

// T10: in the real sandbox, groom.js creates issues in §9 order but GitHub
// assigns them its own issue numbers — which do NOT match the order. Order 1 =
// issue #2, order 2 = issue #3. The bodies carry `merge-after #1` (an order),
// but mergedIssues are real ISSUE NUMBERS. Without translating,
// `deps.every(d => merged.has(d))` compares two different spaces and leaves any
// slice with dependencies blocked for ever — unless, by chance, order == issue
// number (which is exactly what happened in EVERY previous fixture of the
// suite, which is why the bug was never detected here). See
// gh-issue-map.js#buildDispatchInput.
// F6, grave 1: the format of the dependency reference changes from a bare "#N"
// to inline code ("`#N`") so that GitHub stops autolinking it to issue N
// (verified against the real API, see groom.test.js). Issues ALREADY CREATED
// with the old format still exist in real repos — the reader has to understand
// BOTH, for ever. An explicit decision: they are NOT migrated (nobody rewrites
// existing bodies just for this); an old body only adopts the new format if
// --reconcile was going to rewrite that section anyway because of a real
// divergence.
describe('extractDeps / extractDepsInSection — the new format (`#N`) and the old one (#N) read the same (F6, grave 1)', () => {
  it('extractDeps reads the reference between backticks', () => {
    expect(extractDeps('- merge-after `#3`')).toEqual([3])
  })
  it('extractDeps still reads the old format, with no backticks (issues already created)', () => {
    expect(extractDeps('- merge-after #3')).toEqual([3])
  })
  it('extractDeps reads a mixed body (a section edited by hand with both forms)', () => {
    expect(extractDeps('- merge-after `#3`\n- merge-after #4')).toEqual([3, 4])
  })
  it('the section generated today is not "malformed": the order note introduces no uncaptured reference', () => {
    const body = buildIssueBody({ n: 5, name: 'x', ac: ['AC-5.1'], deps: [1, 2], protected: '–' }, SPEC_REF)
    expect(extractDepsInSection(body)).toEqual({ deps: [1, 2], malformed: false })
  })
  it('a body with the OLD format still maps the same through the production path (mapGhIssue)', () => {
    const legacyBody = [
      '> Slice #5 del epic. Spec: [spec.md#9](spec.md#9)', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-5.1', '',
      '## Dependencias', '- merge-after #1', '- merge-after #2', '',
      '## Out of scope / Protected', '- (ninguno declarado)', '',
      '<!-- ct-order:5 -->',
    ].join('\n')
    const mapped = mapGhIssue({ number: 60, title: '#60 x', labels: [{ name: 'status:ready' }], body: legacyBody })
    expect(mapped.deps).toEqual([1, 2])
    expect(mapped.depsMalformed).toBe(false)
    expect(mapped.strayDeps).toEqual([])
  })
})

describe('extractOrder', () => {
  it('it reads the ct-order:N marker', () => expect(extractOrder('x\n<!-- ct-order:2 -->')).toBe(2))
  it('with no marker → null', () => expect(extractOrder('sin marcador')).toBeNull())
  it('an empty or absent body → null', () => {
    expect(extractOrder('')).toBeNull()
    expect(extractOrder(undefined)).toBeNull()
  })
})

// buildOrderIndex — hardening of the dispatch, D1 finding 1 (the gravest of the
// review): the order→issue index was GLOBAL TO THE REPO (a single Map), but
// /ct-groom numbers slices 1..N PER EPIC. Two epics groomed in the same repo
// reuse the same order numbers, and `index.set` kept the LAST issue seen for
// each order — with `[...open, ...closed]`, an ALREADY MERGED (closed) issue of
// an epic A silently won the slot a `merge-after` of an in-flight epic B needed
// to resolve against its own sibling slice. Reproduction verified by the
// auditor: epic A (slices 1,2 → #1,#2, both merged), epic B in the same repo
// (slices 1,2 → #7,#8) — #8's `merge-after #1` (order 1 OF EPIC B) resolved
// against epic A's #1 (already merged), so #7 and #8 were dispatched in the
// SAME batch without #8 ever really waiting for #7. Nothing was printed.
//
// The SCOPE decision: every issue carries a real milestone ever since
// groom.js#groomPlan exists (one invocation of /ct-groom = one `--milestone` =
// one epic) — GitHub's milestone number is unique PER REPO and already travels
// in EVERY issue (open or closed) without this fix having to write anything new
// into any body: ZERO compatibility cost for any issue already groomed with the
// current marker (`<!-- ct-order:N -->` does not change). The alternative
// (encoding an epic identifier INSIDE the marker itself) is ruled out: it would
// force rewriting issues that already exist, or maintaining two marker formats
// in parallel indefinitely, to carry the SAME information GitHub's `milestone`
// field already provides for free. An issue with no milestone (created by hand,
// or a repo from before ct-groom assigned milestones) falls into the shared
// `NO_MILESTONE_KEY` bucket — still better than blowing up, but the shared
// bucket can collide again if two epics with no milestone reuse orders; see the
// collision test further down, which covers exactly that case.
//
// The DETECTION decision: a collision within the SAME epic (two DIFFERENT
// issues with the same order under the same milestone — two epics sharing a
// milestone by mistake, say, or an accidental re-groom) is NEVER resolved in
// silence by keeping "the last" or "the first" — it is reported in `collisions`
// so that buildDispatchInput/ct-next.mjs abort the whole batch (see its own
// describe further down) instead of risking a dispatch against the wrong
// dependency, which is precisely the bug this finding describes.
describe('buildOrderIndex — scope per epic (milestone) and collision detection (D1 finding 1)', () => {
  it('it maps order → issue number, with the index separated PER MILESTONE (epic)', () => {
    const raw = [
      { number: 2, milestone: { number: 5 }, body: '<!-- ct-order:1 -->' },
      { number: 3, milestone: { number: 5 }, body: '<!-- ct-order:2 -->' },
    ]
    const { perEpic, collisions } = buildOrderIndex(raw)
    expect(perEpic.get('5').get(1)).toBe(2)
    expect(perEpic.get('5').get(2)).toBe(3)
    expect(collisions).toEqual([])
  })

  it('the SAME order number in DIFFERENT milestones is not a collision — they are different epics, each with its own order space', () => {
    const raw = [
      { number: 1, milestone: { number: 10 }, body: '<!-- ct-order:1 -->' }, // epic A, slice 1
      { number: 7, milestone: { number: 20 }, body: '<!-- ct-order:1 -->' }, // epic B, slice 1
    ]
    const { perEpic, collisions } = buildOrderIndex(raw)
    expect(collisions).toEqual([])
    expect(perEpic.get('10').get(1)).toBe(1)
    expect(perEpic.get('20').get(1)).toBe(7)
  })

  it('the SAME order under the SAME milestone, on DIFFERENT issues → a real collision, reported (never "the last one wins" in silence)', () => {
    const raw = [
      { number: 7, milestone: { number: 100 }, body: '<!-- ct-order:2 -->' },
      { number: 8, milestone: { number: 100 }, body: '<!-- ct-order:2 -->' },
    ]
    const { perEpic, collisions } = buildOrderIndex(raw)
    expect(collisions).toEqual([{ epicKey: '100', order: 2, issues: [7, 8] }])
    // the slot is not arbitrarily resolved to "the last one" — it still points
    // at the first one seen, but whoever consumes the index has to look at
    // `collisions` before trusting that value (buildDispatchInput does).
    expect(perEpic.get('100').get(2)).toBe(7)
  })

  it('issues with NO milestone fall into a shared bucket (NO_MILESTONE_KEY), not into any real epic\u2019s', () => {
    const raw = [{ number: 9, milestone: null, body: '<!-- ct-order:1 -->' }]
    const { perEpic } = buildOrderIndex(raw)
    expect(perEpic.get(NO_MILESTONE_KEY).get(1)).toBe(9)
  })

  it('two issues with no milestone and the same order → it counts as a collision too (the shared bucket is not immune)', () => {
    const raw = [
      { number: 1, body: '<!-- ct-order:1 -->' },
      { number: 2, body: '<!-- ct-order:1 -->' },
    ]
    const { collisions } = buildOrderIndex(raw)
    expect(collisions).toEqual([{ epicKey: NO_MILESTONE_KEY, order: 1, issues: [1, 2] }])
  })

  it('issues with no marker do not enter any index', () => {
    const { perEpic, collisions } = buildOrderIndex([{ number: 9, milestone: { number: 1 }, body: 'sin marcador' }])
    expect(perEpic.get('1')).toBeUndefined()
    // A reinforced assertion (not just "the bucket for milestone 1 does not
    // exist" — that on its own does not rule out SOME other empty bucket having
    // been created by mistake): with no `ct-order` marker at all, the whole
    // `perEpic` is left empty, just like the `idx.size === 0` this same test's
    // pre-D1 version (a flat Map) checked.
    expect(perEpic.size).toBe(0)
    expect(collisions).toEqual([])
  })

  it('three DIFFERENT issues in the same slot (epic, order) → ONE single collision with the three numbers, never entries overlapping in pairs', () => {
    const raw = [
      { number: 7, milestone: { number: 100 }, body: '<!-- ct-order:2 -->' },
      { number: 8, milestone: { number: 100 }, body: '<!-- ct-order:2 -->' },
      { number: 9, milestone: { number: 100 }, body: '<!-- ct-order:2 -->' },
    ]
    const { collisions } = buildOrderIndex(raw)
    // A single entry for the slot (epic 100, order 2), with the THREE numbers —
    // not two overlapping entries ([7,8] and [7,9]) that repeat the first one
    // and make it harder to see at a glance how many different issues really
    // compete for the same slot.
    expect(collisions).toEqual([{ epicKey: '100', order: 2, issues: [7, 8, 9] }])
  })

  it('defensive: an empty or absent input does not blow up', () => {
    expect(buildOrderIndex([]).perEpic.size).toBe(0)
    expect(buildOrderIndex([]).collisions).toEqual([])
    expect(buildOrderIndex(undefined).perEpic.size).toBe(0)
  })

  it('epicKeyOf: a milestone with a number → String(number); with no milestone (or a non-finite milestone.number) → NO_MILESTONE_KEY', () => {
    expect(epicKeyOf({ milestone: { number: 42 } })).toBe('42')
    expect(epicKeyOf({ milestone: null })).toBe(NO_MILESTONE_KEY)
    expect(epicKeyOf({})).toBe(NO_MILESTONE_KEY)
    expect(epicKeyOf({ milestone: {} })).toBe(NO_MILESTONE_KEY)
  })
})

describe('buildDispatchInput — it reproduces and pins the sandbox\u2019s order/issue mismatch (T10)', () => {
  it('the sandbox\u2019s exact scenario: order 1=#2 (merged), order 2=#3 (ready, dep on order 1) → #3 becomes dispatchable', () => {
    // #2 (order 1) is already closed and merged.
    const closed = [{ number: 2, stateReason: 'COMPLETED', body: '<!-- ct-order:1 -->' }]
    // #3 (order 2) is still open, ready, with its dep declared as "merge-after #1" (an ORDER, not an issue).
    const open = [{
      number: 3, title: '#3 endpoint', labels: [{ name: 'status:ready' }],
      body: 'algo\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->',
    }]
    const { issues, mergedIssues } = buildDispatchInput(open, closed)
    expect(mergedIssues).toEqual([2]) // a real issue number, not an order
    const mapped = issues.find((i) => i.n === 3)
    expect(mapped.deps).toEqual([2]) // translated: order 1 → issue #2, not [1]
    // An end-to-end proof: with the mismatch uncorrected this would have given [].
    const selected = selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 1 })
    expect(selected.map((i) => i.n)).toEqual([3])
  })

  it('without the translation, comparing deps (orders) against mergedIssues (issues) directly selects NOTHING (it documents the bug that was fixed)', () => {
    // The same scenario, but replicating the PRE-fix code: a raw mapGhIssue
    // (deps in order space) compared straight against mergedIssues.
    const openRaw = {
      number: 3, title: '#3 endpoint', labels: [{ name: 'status:ready' }],
      body: 'algo\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->',
    }
    const mapped = mapGhIssue(openRaw) // deps is still in order space: [1]
    expect(mapped.deps).toEqual([1])
    const mergedIssues = filterMergedIssues([{ number: 2, stateReason: 'COMPLETED' }]) // [2]
    const selected = selectNext([mapped], { mergedIssues, runningTouches: [], concurrencyCap: 1 })
    expect(selected).toEqual([]) // blocked for ever without the translation — the real bug
  })

  it('a dependency whose order exists in no issue at all (open or closed) → null, never satisfied, no blow-up', () => {
    const open = [{
      number: 5, title: '#5 algo', labels: [{ name: 'status:ready' }],
      body: '## Dependencias\n- merge-after #99\n\n<!-- ct-order:1 -->', // order 99 exists nowhere
    }]
    const { issues, mergedIssues, orderCollisions } = buildDispatchInput(open, [])
    expect(orderCollisions).toEqual([])
    const mapped = issues.find((i) => i.n === 5)
    expect(mapped.deps).toEqual([null])
    expect(() => selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 1 })).not.toThrow()
    expect(selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 1 })).toEqual([])
  })

  it('a dependency that IS merged resolves correctly even though the merged issue is no longer in the open list', () => {
    // buildOrderIndex has to see the CLOSED one's body to know its order — if
    // it indexed only the open ones, this dep would become unresolvable as soon
    // as the dependency was merged (exactly when we want it to unblock).
    const closed = [{ number: 10, stateReason: 'COMPLETED', body: '<!-- ct-order:1 -->' }]
    const open = [{
      number: 11, title: '#11 x', labels: [{ name: 'status:ready' }],
      body: '## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->',
    }]
    const { issues, mergedIssues } = buildDispatchInput(open, closed)
    const selected = selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 1 })
    expect(selected.map((i) => i.n)).toEqual([11])
  })

  // D1 finding 1 (the gravest): the auditor's exact END-TO-END reproduction —
  // epic A groomed and merged completely (#1, #2, milestone 100), epic B groomed
  // AFTERWARDS in the same repo (#7, #8, milestone 200 — a DIFFERENT milestone,
  // because they really are different epics). #8 declares "merge-after #1" —
  // order 1 OF ITS OWN epic (B), which is #7. Before this fix, the global order
  // index resolved "order 1" against the LAST issue seen with that marker in
  // the WHOLE repo — epic A's #1, already merged — so #8 was dispatched
  // alongside #7 in the same batch, without ever really having waited for #7.
  // With the per-milestone index, #8 resolves against #7 (its real sibling) and
  // stays blocked until #7 is merged.
  it('D1 finding 1 — the auditor\u2019s reproduction: epic A merged + epic B in flight, the same order numbers, DIFFERENT milestones → B\u2019s dep resolves against B, never against A', () => {
    const closed = [
      { number: 1, stateReason: 'COMPLETED', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' }, // epic A, slice 1
      { number: 2, stateReason: 'COMPLETED', milestone: { number: 100 }, body: '<!-- ct-order:2 -->' }, // epic A, slice 2
    ]
    const open = [
      {
        number: 7, title: '#7 cimiento epicB', labels: [{ name: 'status:ready' }],
        milestone: { number: 200 }, body: '<!-- ct-order:1 -->', // epic B, slice 1 (no deps)
      },
      {
        number: 8, title: '#8 encima de epicB', labels: [{ name: 'status:ready' }],
        milestone: { number: 200 },
        body: 'algo\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->', // epic B, slice 2: it depends on order 1 OF ITS OWN epic
      },
    ]
    const { issues, mergedIssues, orderCollisions } = buildDispatchInput(open, closed)
    expect(orderCollisions).toEqual([]) // different milestones: never a real collision
    expect(mergedIssues).toEqual([1, 2])
    const slice8 = issues.find((i) => i.n === 8)
    expect(slice8.deps).toEqual([7]) // THE FIX: never [1] (epic A's order 1)
    // end-to-end: with cap to spare, only #7 is dispatched — #8 keeps waiting
    // for its real sibling, not for epic A's #1 that was already merged.
    const selected = selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 5 })
    expect(selected.map((i) => i.n)).toEqual([7])
  })

  it('D1 finding 1 — if two epics share a milestone by mistake (both with the default title "Epic", say), the order collision is reported, never resolved in silence', () => {
    const open = [
      { number: 7, title: '#7 a', labels: [{ name: 'status:ready' }], milestone: { number: 100 }, body: '<!-- ct-order:1 -->' },
      { number: 8, title: '#8 b', labels: [{ name: 'status:ready' }], milestone: { number: 100 }, body: '<!-- ct-order:1 -->' },
    ]
    const { orderCollisions } = buildDispatchInput(open, [])
    expect(orderCollisions).toEqual([{ epicKey: '100', order: 1, issues: [7, 8] }])
  })

  // Review of D1, finding 4: the "refuse" radius was too wide — the whole batch
  // aborted (see ct-next.mjs, the earlier version), even for healthy epics with
  // no relation to the collision at all. `issues` now EXCLUDES, inside
  // buildDispatchInput itself (so that no consumer has to remember to filter on
  // its own), any issue whose OWN epicKey is in `orderCollisions` — it is
  // neither selected nor counted as in flight, because its own dep resolution
  // can no longer be trusted. An unrelated epic (a different milestone, no
  // collision) keeps being seen as normal.
  it('D1 finding 4 — an epic with an order collision is EXCLUDED from `issues` (neither selected nor counted as in flight), but a healthy, unrelated epic is left intact', () => {
    const open = [
      { number: 7, title: '#7 a', labels: [{ name: 'status:ready' }], milestone: { number: 100 }, body: '<!-- ct-order:1 -->' },
      { number: 8, title: '#8 b', labels: [{ name: 'status:ready' }], milestone: { number: 100 }, body: '<!-- ct-order:1 -->' },
      { number: 20, title: '#20 sano', labels: [{ name: 'status:ready' }], milestone: { number: 300 }, body: '<!-- ct-order:1 -->' },
    ]
    const { issues, orderCollisions } = buildDispatchInput(open, [])
    expect(orderCollisions.length).toBe(1) // the collision keeps being reported (informational)
    expect(issues.map((i) => i.n)).toEqual([20]) // #7/#8 (the collided epic) out; #20 (healthy) present
  })

  // A reproduction of the scenario the review worried about most: the collision
  // lives ONLY between ALREADY CLOSED issues of an old epic — nobody has
  // pending work there today. A new, open, unrelated epic (a different
  // milestone) must not be affected at all — neither excluded nor blocked.
  it('D1 finding 4 — a collision that lives ONLY between closed issues of an old epic neither excludes nor affects a new, open epic', () => {
    const closed = [
      { number: 50, stateReason: 'COMPLETED', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' },
      { number: 51, stateReason: 'COMPLETED', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' }, // the same (epic, order) → a historical collision
    ]
    const open = [
      { number: 60, title: '#60 nuevo', labels: [{ name: 'status:ready' }], milestone: { number: 400 }, body: '<!-- ct-order:1 -->' },
    ]
    const { issues, orderCollisions } = buildDispatchInput(open, closed)
    expect(orderCollisions.length).toBe(1)
    expect(issues.map((i) => i.n)).toEqual([60]) // the new, unrelated epic is not touched
  })
})

// It reproduces finding 5's exact scenario end-to-end: two `ready` issues that
// only share an `area:api` label (never a `touches:`) — before the fix,
// selectNext (which decides what to co-dispatch) did not see that `area:` at all
// and launched both with cap 2; with the fix, both produce the same stripped
// token 'api' and the collision is detected during SELECTION, not afterwards.
describe('mapGhIssue + selectNext — a collision through a shared area: is detected during selection (finding 5)', () => {
  it('two ready issues sharing ONLY area:api → with cap 2 only one is selected', () => {
    const a = mapGhIssue({ number: 1, title: '#1 a', labels: [{ name: 'status:ready' }, { name: 'area:api' }], body: '<!-- ct-order:1 -->' })
    const b = mapGhIssue({ number: 2, title: '#2 b', labels: [{ name: 'status:ready' }, { name: 'area:api' }], body: '<!-- ct-order:2 -->' })
    const selected = selectNext([a, b], { mergedIssues: [], runningTouches: [], concurrencyCap: 2 })
    expect(selected.map((i) => i.n)).toEqual([1])
  })
})

describe('filterMergedIssues', () => {
  it('stateReason COMPLETED (upper case, the real GraphQL enum) → it counts as merged', () => {
    expect(filterMergedIssues([{ number: 1, stateReason: 'COMPLETED' }])).toEqual([1])
  })
  it('stateReason NOT_PLANNED → it does NOT count', () => {
    expect(filterMergedIssues([{ number: 1, stateReason: 'NOT_PLANNED' }])).toEqual([])
  })
  it('a lower-case stateReason ("completed") → it does NOT count (it does not exist in practice; no dead branch)', () => {
    expect(filterMergedIssues([{ number: 1, stateReason: 'completed' }])).toEqual([])
  })
  it('defensive: an empty or absent input does not blow up', () => {
    expect(filterMergedIssues([])).toEqual([])
    expect(filterMergedIssues(undefined)).toEqual([])
  })
})

// F5 review round 3, CRITICAL 1 — locateSection looked for the heading with a
// regex NOT anchored to the start of a line and NOT escaped, while the
// terminator WAS anchored (`\n##\s`) — the two halves used different criteria.
// Verified by construction (the reviewer's report): a mention of
// "## Dependencias" inside a code fence, halfway through a line, or quoted, was
// mistaken for a real heading. These tests reproduce the three exact shapes from
// the report.
describe('locateSection — anchored to column 0 and aware of code fences (review round 3, Critical 1)', () => {
  it('an inline mention ("…## Dependencias…" halfway through a line, inside an AC) is NOT mistaken for the real heading', () => {
    const body = [
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-2.1 el body debe traer ## Dependencias cuando hay deps',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const loc = locateSection(body, '## Dependencias')
    expect(loc).not.toBeNull()
    expect(extractDeps(loc.content)).toEqual([1]) // the REAL section, not the inline mention
    // the AC itself is not truncated by the mention — it stays complete
    expect(extractAc(body)).toEqual(['AC-2.1 el body debe traer ## Dependencias cuando hay deps'])
  })

  it('a quoted heading ("> ## Dependencias") is NOT mistaken for the real heading', () => {
    const body = [
      '## Descripción',
      '> ## Dependencias (cita de otro issue, no una cabecera real)',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #3',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const loc = locateSection(body, '## Dependencias')
    expect(extractDeps(loc.content)).toEqual([3])
  })

  it('a "## Dependencias" inside a fenced code block (inside "## Descripción") is NOT mistaken for the real heading, and the fence survives intact', () => {
    const body = [
      '## Descripción',
      'Ejemplo de la sección que genera el groom:',
      '```',
      '## Dependencias',
      '- merge-after #99',
      '```',
      'fin del ejemplo.',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1]) // the REAL section, not the one inside the fence (#99)

    const descripcionLoc = locateSection(body, '## Descripción')
    // The Descripción section must include the WHOLE fence (opening AND
    // closing) — if the closing "```" is lost, the rest of the body renders as
    // code.
    expect(descripcionLoc.content).toContain('```\n## Dependencias\n- merge-after #99\n```')
    expect(descripcionLoc.content).toContain('fin del ejemplo.')
    expect(descripcionLoc.content).not.toContain('## Acceptance criteria') // it did not eat the next real heading
  })
})

// Review round 4 — the reviewer attacked their own round 3: "it fixed the three
// shapes the review named and tested exactly those three; it did not attack its
// own scanner". These tests build adversarial inputs nobody asked for
// explicitly: a nested fence (a shorter delimiter of the SAME character
// inside), delimiters of different lengths, a "~~~" inside a "```" (a DIFFERENT
// character), an unclosed fence, and a suffixed heading for the sections that
// should NOT tolerate one.
describe('locateSection / stepFence — real CommonMark: it closes only with the SAME character and a length >= the opening (review round 4, Critical 1)', () => {
  it('a SHORTER delimiter of the same character (``` inside a fence opened with ````) does NOT close it — the real section beyond is located properly', () => {
    const body = [
      '## Descripción',
      'Ejemplo (round 4): una valla de 4 backticks que contiene, como parte',
      'del propio ejemplo, un bloque de 3 backticks con la cabecera real dentro:',
      '````',
      '```',
      '## Dependencias',
      '- merge-after #99',
      '```',
      '````',
      'fin del ejemplo real.',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1]) // the REAL section, not the nested example's (#99)
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).toContain('````\n```\n## Dependencias\n- merge-after #99\n```\n````')
    expect(descripcionLoc.content).toContain('fin del ejemplo real.')
    expect(descripcionLoc.content).not.toContain('## Acceptance criteria')
  })

  it('a delimiter of ANOTHER character ("~~~~" inside a fence opened with "```") does NOT close the fence', () => {
    const body = [
      '## Descripción',
      '```',
      'dentro de la valla de backticks, esto NO la cierra:',
      '~~~~',
      '## Dependencias',
      '- merge-after #99',
      '~~~~',
      'y esto sí la cierra de verdad:',
      '```',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1])
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).toContain('~~~~\n## Dependencias\n- merge-after #99\n~~~~')
    expect(descripcionLoc.content).not.toContain('## Acceptance criteria')
  })

  it('a LONGER delimiter of the same character DOES close it (real CommonMark: length >= the opening)', () => {
    const body = [
      '## Descripción',
      '```',
      'contenido',
      '````',
      'esto ya está FUERA de la valla (la cerró la línea de arriba, más larga)',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).toContain('esto ya está FUERA de la valla')
    // The AC heading is located as normal — it did not end up "inside" anything.
    const acLoc = locateSection(body, AC_HEADING_FORMS)
    expect(acLoc).not.toBeNull()
  })

  // Minor (review round 5): a CLOSING line, by real CommonMark, cannot carry
  // anything after the delimiter other than whitespace — an "info string" (the
  // "js" of "```js", say) is only valid on the OPENING. Before, a "```js"
  // inside an ALREADY open block (meant as example CONTENT — showing another
  // fence with a language — not as a real closing) was read as a closing all
  // the same, because only character and length were compared, ignoring the
  // rest of the line.
  it('a "```js" (with an info string) INSIDE a fence already opened with "```" does NOT close it — it is still the example\u2019s content', () => {
    const body = [
      '## Descripción',
      '```',
      'ejemplo mostrando cómo abrir un fence con lenguaje:',
      '```js',
      'esto sigue siendo CONTENIDO del ejemplo exterior, no un cierre real',
      '```',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const descripcionLoc = locateSection(body, '## Descripción')
    // The example's three delimiters (the opening, the inner "```js" that does
    // NOT close, and the real closing) survive intact inside the section.
    expect(descripcionLoc.content).toContain('```\nejemplo mostrando cómo abrir un fence con lenguaje:\n```js\nesto sigue siendo CONTENIDO del ejemplo exterior, no un cierre real\n```')
    expect(descripcionLoc.content).not.toContain('## Dependencias')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1])
  })

  it('an UNCLOSED fence: everything that follows is treated as inside it (CommonMark: an open fence reaches the end of the document) — a real heading after the opening is not located', () => {
    const body = [
      '## Descripción',
      '```',
      'esta valla nunca se cierra',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    // "## Dependencias" lives, literally, inside the unclosed fence — it is not
    // a real heading while the fence stays open.
    expect(locateSection(body, '## Dependencias')).toBeNull()
    expect(locateSection(body, '## Out of scope / Protected')).toBeNull()
  })

  it('a heading with a human suffix ("## Dependencias externas (notas del equipo)") is NOT claimed as the real dependencies section (exact, not a prefix)', () => {
    const body = [
      '## Dependencias externas (notas del equipo)',
      'El equipo de pagos también depende de este cambio, informalmente.',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1]) // the REAL section, not the human one with a suffix
    expect(depsLoc.content).not.toContain('pagos')
  })

  it('"## Acceptance criteria" accepts BOTH forms of AC_HEADING_FORMS — never an open prefix', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- AC-1.1\n\n<!-- ct-order:1 -->'
    const loc = locateSection(body, AC_HEADING_FORMS)
    expect(loc).not.toBeNull()
    expect(extractAc(body)).toEqual(['AC-1.1'])
  })

  it('the old form of the AC heading (with no EARS suffix, from before it was added) is located too — it is the SECOND form of the closed set', () => {
    const body = '## Acceptance criteria\n- AC-1.1\n\n<!-- ct-order:1 -->'
    expect(extractAc(body)).toEqual(['AC-1.1'])
  })

  // Important 4 (review round 5): before, `extractAc` located the heading by
  // PREFIX (`{ exact: false }`) — the same hijack that had already been closed
  // for the other three sections. A "## Acceptance criteria propuestos por QA
  // (borrador)" written by a human ABOVE the real section was claimed as if it
  // were it: the dispatcher injected ZERO real criteria into the agent's prompt.
  // buildIssueBody only emits two fixed strings for this heading — the
  // legitimate slack is THAT closed set, not a prefix.
  it('a "## Acceptance criteria propuestos por QA (borrador)" ABOVE the real one no longer hijacks it — extractAc reads the real one, not QA\u2019s', () => {
    const body = [
      '## Acceptance criteria propuestos por QA (borrador)',
      '- esto NO debe ser lo que el dispatcher inyecte',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1 la real',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    expect(extractAc(body)).toEqual(['AC-1.1 la real'])
  })
})

// Review round 5, Critical 1 — the same diagnosis as round 4 applied to the
// OTHER delimiter-shaped thing that lives in the same body: a MULTILINE HTML
// comment did not hide its interior, so a known heading that had been "commented
// out" (old deps that were postponed, say) was read as real structure. These
// tests attack the CLASS — not just the example the reviewer gave (commented-out
// deps) — just as round 4 attacked its own fence scanner beyond the three named
// cases.
describe('locateSection / stepLine — multiline HTML comments hide their interior (review round 5, Critical 1)', () => {
  it('the reviewer\u2019s reproduction: some OLD deps commented out "mientras decidimos" do not hijack the section — the real one is located', () => {
    const body = [
      '## Descripción',
      'algo',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '<!--',
      '## Dependencias',
      '- merge-after #99 (pospuesto mientras decidimos con pagos)',
      '-->',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1]) // the REAL section, not the commented-out one (#99)
  })

  it('the multiline comment survives INTACT (opening and closing) inside the section that contains it', () => {
    const body = [
      '## Descripción',
      'antes del comentario.',
      '<!--',
      '## Dependencias',
      '- merge-after #99',
      '-->',
      'después del comentario, misma sección.',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).toContain('<!--\n## Dependencias\n- merge-after #99\n-->')
    expect(descripcionLoc.content).toContain('después del comentario, misma sección.')
    expect(descripcionLoc.content).not.toContain('## Acceptance criteria') // it did not eat the next real heading
  })

  it('an UNCLOSED comment: everything that follows (real headings included) is hidden until EOF — just like an unclosed fence', () => {
    const body = [
      '## Descripción',
      '<!--',
      'este comentario nunca se cierra',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    // "## Dependencias" and "## Out of scope / Protected" live, literally,
    // inside the unclosed comment — they are not real headings while the
    // comment stays open.
    expect(locateSection(body, '## Dependencias')).toBeNull()
    expect(locateSection(body, '## Out of scope / Protected')).toBeNull()
  })

  it('once the comment is closed, the scan resumes as normal: a real heading AFTER the closing is located properly', () => {
    const body = [
      '## Descripción',
      '<!--',
      'nota vieja',
      '-->',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(depsLoc).not.toBeNull()
    expect(extractDeps(depsLoc.content)).toEqual([1])
    expect(extractAc(body)).toEqual(['AC-1.1'])
  })

  it('a SELF-CONTAINED comment (it opens and closes on the SAME line, like the ct-order marker) still terminates a section as normal — it is not mistaken for the opening of a multiline one', () => {
    const body = [
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '<!-- ct-order:1 -->',
      '',
      '## Dependencias',
      '- merge-after #99 (esto NO debería aparecer dentro de Protected)',
    ].join('\n')
    const protectedLoc = locateSection(body, '## Out of scope / Protected')
    expect(protectedLoc.content).not.toContain('## Dependencias')
    expect(protectedLoc.content).not.toContain('merge-after #99')
  })

  it('a comment inside an OPEN code fence is treated as literal text — it fires no comment tracking and hides nothing extra beyond the fence', () => {
    const body = [
      '## Descripción',
      '```',
      'ejemplo mostrando un comentario sin cerrar: <!--',
      'esto sigue siendo parte del EJEMPLO, no un comentario real',
      '```',
      'fin del ejemplo — esto ya está fuera de la valla',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(depsLoc).not.toBeNull()
    expect(extractDeps(depsLoc.content)).toEqual([1])
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).toContain('fin del ejemplo — esto ya está fuera de la valla')
  })

  it('countHeadingLines also ignores a heading "commented out" inside a multiline comment — it does not count as a duplicate', () => {
    const body = [
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!--',
      '## Dependencias',
      '- merge-after #99 (copia vieja comentada, no un duplicado real)',
      '-->',
    ].join('\n')
    expect(countHeadingLines(body, '## Dependencias')).toBe(1)
  })
})

// Review round 5, Critical 2 — "only a '## ' at column 0 terminates a section":
// a "#", a "###", a "####", a "##" separated by a tab, or one indented 1-3
// spaces are, all five of them, real ATX headings on GitHub — none of them
// terminated anything before this fix, so their content (and anything below,
// up to the next EXACT "## ") was swallowed into the previous section's splice.
// These tests attack the whole CLASS of ATX levels and shapes, not just the
// "###" the reviewer gave.
describe('locateSection — any ATX heading (not just "## ") terminates a section (review round 5, Critical 2)', () => {
  it('the reviewer\u2019s reproduction: a "### Notas de implementación" with a real warning in it NO longer disappears on reconciling — it stays outside the previous section', () => {
    const body = [
      '## Descripción',
      'algo de contexto.',
      '',
      '### Notas de implementación',
      'la dependencia la negociamos con pagos: NO tocar sin hablar con Ana',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).not.toContain('NO tocar sin hablar con Ana')
    expect(descripcionLoc.content).not.toContain('### Notas de implementación')
  })

  it('an H1 ("# Algo") also terminates the previous section', () => {
    const body = '## Descripción\ncontenido\n\n# Algo\nresto\n\n<!-- ct-order:1 -->'
    expect(locateSection(body, '## Descripción').content).not.toContain('# Algo')
  })

  it('an H4 ("#### Algo") also terminates the previous section', () => {
    const body = '## Descripción\ncontenido\n\n#### Algo\nresto\n\n<!-- ct-order:1 -->'
    expect(locateSection(body, '## Descripción').content).not.toContain('#### Algo')
  })

  it('a "##" separated by a TAB (instead of a space) also terminates the previous section', () => {
    const body = '## Descripción\ncontenido\n\n##\tOtra cabecera\nresto\n\n<!-- ct-order:1 -->'
    expect(locateSection(body, '## Descripción').content).not.toContain('Otra cabecera')
  })

  it('a heading indented 1-3 spaces ("   ## Algo") also terminates the previous section (CommonMark: up to 3 spaces is still a heading)', () => {
    const body = '## Descripción\ncontenido\n\n   ## Algo\nresto\n\n<!-- ct-order:1 -->'
    expect(locateSection(body, '## Descripción').content).not.toContain('Algo')
  })

  it('a bare "##" heading with nothing after it (an immediate end of line) also terminates the previous section', () => {
    const body = '## Descripción\ncontenido\n\n##\nresto\n\n<!-- ct-order:1 -->'
    expect(locateSection(body, '## Descripción').content).not.toContain('resto')
  })

  // Negatives — an attack on my own rule: verifying that the criterion was NOT
  // widened too far.
  it('4+ spaces of indentation → an indented code block, NOT a heading (real CommonMark) — it terminates nothing', () => {
    const body = '## Descripción\ncontenido\n\n    ## esto es código indentado, no una cabecera\nmás contenido\n\n<!-- ct-order:1 -->'
    const loc = locateSection(body, '## Descripción')
    expect(loc.content).toContain('## esto es código indentado, no una cabecera')
    expect(loc.content).toContain('más contenido')
  })

  it('with no space or tab after the "#" ("##Something", stuck together) → it is NOT a valid ATX heading, it terminates nothing', () => {
    const body = '## Descripción\ncontenido\n\n##Something pegado, no es cabecera\nresto\n\n<!-- ct-order:1 -->'
    const loc = locateSection(body, '## Descripción')
    expect(loc.content).toContain('##Something pegado, no es cabecera')
    expect(loc.content).toContain('resto')
  })

  it('more than 6 "#" (7, say) → CommonMark no longer considers it an ATX heading, it terminates nothing', () => {
    const body = '## Descripción\ncontenido\n\n####### siete almohadillas, no es cabecera ATX\nresto\n\n<!-- ct-order:1 -->'
    const loc = locateSection(body, '## Descripción')
    expect(loc.content).toContain('####### siete almohadillas, no es cabecera ATX')
    expect(loc.content).toContain('resto')
  })
})

describe('CRLF — normalizeToLF/detectLineEnding (review round 4, menor)', () => {
  it('detectLineEnding: a body with \\r\\n → "\\r\\n"; a body with pure \\n → "\\n"', () => {
    expect(detectLineEnding('a\r\nb\r\n')).toBe('\r\n')
    expect(detectLineEnding('a\nb\n')).toBe('\n')
    expect(detectLineEnding('')).toBe('\n')
  })
  it('normalizeToLF: it strips \\r\\n and any loose \\r, leaving pure \\n', () => {
    expect(normalizeToLF('a\r\nb\r\nc')).toBe('a\nb\nc')
    expect(normalizeToLF('a\rb')).toBe('ab')
  })
  it('an "exact" heading with CRLF (it drags a \\r at the end of the line) still matches — trimEnd absorbs the \\r', () => {
    const body = normalizeToLF('## Dependencias\r\n- merge-after #1\r\n\r\n<!-- ct-order:1 -->\r\n')
    const loc = locateSection(body, '## Dependencias')
    expect(extractDeps(loc.content)).toEqual([1])
  })
})

// F10 replaces specLinkAnchor, which extracted ONLY the anchor and discarded
// the path on purpose: while the line was composed with `process.argv[2]` as it
// stood, comparing the path would have made two notations of the same file
// rewrite each other for ever. The price was not detecting that the spec had
// moved file (a link to ANOTHER file with the same section number passed as
// good). Now the line is canonical — it derives from the repository, not from
// argv — and it is compared whole.
describe('normalizeSpecLink — it compares the whole line, normalising only the whitespace at the ends (F10)', () => {
  const LINK = '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)'
  it('two identical lines are equal', () => {
    expect(normalizeSpecLink(LINK)).toBe(normalizeSpecLink(LINK))
  })
  it('a trailing space (an editor that adds one) is not a change of content', () => {
    expect(normalizeSpecLink(`${LINK}  `)).toBe(normalizeSpecLink(LINK))
  })
  it('the SAME anchor in ANOTHER file is NO longer considered equal — the hole the anchor comparison left', () => {
    const otroFichero = '> Slice `#2` del epic. Spec: [docs/viejo.md § 9. Slices](https://github.com/o/r/blob/main/docs/viejo.md#9-slices)'
    expect(normalizeSpecLink(otroFichero)).not.toBe(normalizeSpecLink(LINK))
  })
  it('the RELATIVE link from before F10 is not considered equal to today\u2019s absolute one', () => {
    expect(normalizeSpecLink('> Slice `#2` del epic. Spec: [docs/spec.md#9](docs/spec.md#9)')).not.toBe(normalizeSpecLink(LINK))
  })
  it('with no line → null (and null is not equal to any real line)', () => {
    expect(normalizeSpecLink(null)).toBeNull()
    expect(normalizeSpecLink(undefined)).toBeNull()
    expect(normalizeSpecLink(null)).not.toBe(normalizeSpecLink(LINK))
  })
})

describe('countHeadingLines — it counts duplicated headings (review round 3, minor)', () => {
  it('a single occurrence → 1', () => {
    expect(countHeadingLines('## Dependencias\n- merge-after #1', '## Dependencias')).toBe(1)
  })
  it('absent → 0', () => {
    expect(countHeadingLines('## Acceptance criteria\n- x', '## Dependencias')).toBe(0)
  })
  it('two real occurrences → 2', () => {
    const body = '## Dependencias\n- merge-after #1\n\n## Dependencias\n- merge-after #2'
    expect(countHeadingLines(body, '## Dependencias')).toBe(2)
  })
  it('an occurrence inside a code fence does NOT count as real', () => {
    const body = '## Descripción\n```\n## Dependencias\n```\n\n## Dependencias\n- merge-after #1'
    expect(countHeadingLines(body, '## Dependencias')).toBe(1)
  })
})

describe('extractSpecLink — the "> Slice #N del epic. Spec: …" line (review round 3, important 5)', () => {
  it('it extracts it as it stands', () => {
    const body = '> Slice #2 del epic. Spec: [docs/spec.md#9](docs/spec.md#9)\n\n## Acceptance criteria (EARS, 1:1 con tests)\n- AC-1.1'
    expect(extractSpecLink(body)).toBe('> Slice #2 del epic. Spec: [docs/spec.md#9](docs/spec.md#9)')
  })
  it('with no such line → null', () => {
    expect(extractSpecLink('## Acceptance criteria\n- x')).toBeNull()
  })
  it('a quoted or indented mention does not count as the real line', () => {
    const body = '> algo más\n  > Slice #9 no es la línea real (indentada)\n> Slice #2 del epic. Spec: [x#9](x#9)'
    expect(extractSpecLink(body)).toBe('> Slice #2 del epic. Spec: [x#9](x#9)')
  })
  // F6, grave 1: the order now goes between backticks in this line too (the
  // real `body_html` of the sandbox's issue #4 proves that GitHub linked that
  // "#3" to issue #3). Both formats have to be located: old issues are not
  // rewritten.
  it('it also locates the line with the order between backticks (the F6 format)', () => {
    const body = '> Slice `#2` del epic. Spec: [docs/spec.md#9](docs/spec.md#9)\n\n## Acceptance criteria\n- AC-1.1'
    expect(extractSpecLink(body)).toBe('> Slice `#2` del epic. Spec: [docs/spec.md#9](docs/spec.md#9)')
  })
  it('a "> Slice …" line that quotes no order at all is not mistaken for the spec link', () => {
    const body = '> Slice pendiente de negociar con Ana\n> Slice `#2` del epic. Spec: [x#9](x#9)'
    expect(extractSpecLink(body)).toBe('> Slice `#2` del epic. Spec: [x#9](x#9)')
  })
})

// D1 finding 2: extractDeps matched ONLY the literal "merge-after #N", with NO
// anchoring to any section — and with no signal at all when the attempt to
// declare a dependency produced no match. Verified by the auditor over bodies
// edited the way a human really edits them in GitHub's web editor:
//   "- merge-after #1"                  -> deps [1]      (the normal case)
//   "- Depende de #1 (merge primero)"   -> deps []       gate open, SILENCE
//   "- merge after #1" (lost hyphen)    -> deps []       gate open, SILENCE
//   "- ~~merge-after #1~~ ya no aplica" -> deps [1]       (it fails closed, it is not the case this fix attacks)
//   "merge-after #9" in an AC's prose -> it used to count (a scan of the WHOLE
//     body); unified with --reconcile (which ALREADY read only the
//     "## Dependencias" section — the only one it can safely touch through a
//     splice), the dispatcher stops seeing it.
//
// A "## Dependencias" section that is PRESENT with ZERO matches of "merge-after
// #N" is the signal that was being wasted: before, it was translated in silence
// into `deps: []` (the same result as "this slice declares no dependency at
// all"), indistinguishable from a slice that really has no deps. `mapGhIssue`
// now exposes `depsMalformed: true` in that case — dispatch.js#computeReadyCandidates
// treats it as NOT ready to dispatch (fail-closed) instead of "no deps" (see
// dispatch.test.js).
//
// The cost of unifying the domain: a `merge-after` written by hand OUTSIDE the
// recognised section (in an AC's prose, say) stops being honoured by the
// dispatcher — exactly what was already happening to --reconcile since F5.
// Before this fix, the dispatcher DID obey it but --reconcile could never
// reconcile it (an unsafe splice outside the section): one and the same datum
// with two different behaviours depending on who read it. Now the two agree.
describe('mapGhIssue — deps scoped to the "## Dependencias" section, and detection of a human rewrite (D1 finding 2)', () => {
  it('a "- merge-after #1" inside the section → correct deps, depsMalformed false', () => {
    const body = '## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })

  it('a human rewrite ("Depende de #1 (merge primero)") inside the section → deps [], depsMalformed true — never an "open gate" in silence', () => {
    const body = '## Dependencias\n- Depende de #1 (merge primero)\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('a lost hyphen ("merge after #1", with no hyphen) inside the section → deps [], depsMalformed true', () => {
    const body = '## Dependencias\n- merge after #1\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('a strikethrough ("~~merge-after #1~~ ya no aplica") → the regex STILL matches (it fails closed; it is not the case this fix attacks) → deps [1], NOT malformed', () => {
    const body = '## Dependencias\n- ~~merge-after #1~~ ya no aplica\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })

  it('a loose "merge-after #9" in an AC\u2019s prose, OUTSIDE "## Dependencias" → it is IGNORED (unified with --reconcile); only what is INSIDE the real section counts', () => {
    const body = [
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- algo que menciona merge-after #9 de pasada, sin ser una dependencia real',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1]) // never [9, 1] nor [1, 9]
    expect(mapped.depsMalformed).toBe(false)
    // Review of D1, finding 1 (the "the warning is missing" part): narrowing
    // the dispatcher's domain to the section opened a gate `main` kept closed
    // (the "#9" in the prose DID block before, and no longer does) — correct
    // and wanted, but invisible without this. `strayDeps` exposes exactly that
    // ignored reference so that ct-next.mjs can warn; see the dedicated
    // describe further down.
    expect(mapped.strayDeps).toEqual([9])
  })

  it('with no "## Dependencias" section at all → deps [], depsMalformed false (the normal case: the slice declares no deps)', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body: 'sin nada de deps aquí' })
    expect(mapped.deps).toEqual([])
    expect(mapped.depsMalformed).toBe(false)
  })

  it('a "## Dependencias" section that is present but completely empty (with no content line at all) → depsMalformed true (buildIssueBody NEVER emits the heading without at least one "merge-after"; if it shows up like that, someone emptied it by hand)', () => {
    const body = '## Dependencias\n\n<!-- ct-order:1 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('extractDepsInSection — the same function reconcile.js reuses; identical scope', () => {
    expect(extractDepsInSection('## Dependencias\n- merge-after #1\n\n<!-- ct-order:1 -->')).toEqual({ deps: [1], malformed: false })
    expect(extractDepsInSection('sin sección')).toEqual({ deps: [], malformed: false })
    expect(extractDepsInSection('## Dependencias\n- nada reconocible\n\n<!-- ct-order:1 -->')).toEqual({ deps: [], malformed: true })
  })

  // An adversarial attack (not an example from the auditor): a section with TWO
  // lines — a real one ("merge-after #1") and one rewritten by hand ("Depende
  // de #2") — produces no ZERO matches (so the simple "deps.length === 0" check
  // would not catch it), but it DOES lose a real dependency in silence.
  // `malformed` compares the number of bullet lines ("- …") against the number
  // of deps extracted: if there are fewer deps than bullets, some line could
  // not be read — it is still `malformed: true`, even though `deps` is not empty
  // (fail-closed: the `#1` that WAS recognised still applies as a real
  // dependency).
  it('a section with one real line and another rewritten by hand (a mixture) → partial deps, BUT depsMalformed:true (not just "zero matches")', () => {
    const body = '## Dependencias\n- merge-after #1\n- Depende de #2 (mal escrito)\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1]) // the #2 is lost, but #1 is kept (fail-closed)
    expect(mapped.depsMalformed).toBe(true) // it is never treated as "it only depends on #1"
  })

  it('two real "merge-after" on the SAME bullet line → it is not a mixture, not malformed', () => {
    const body = '## Dependencias\n- merge-after #1, merge-after #2\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1, 2])
    expect(mapped.depsMalformed).toBe(false)
  })

  // An adversarial attack on my OWN "bulletLines" heuristic (the same spirit as
  // F5's review rounds on locateSection): a human sub-list of elaboration,
  // indented UNDER a real dependency ("- merge-after #1\n  - nota: esto es
  // importante") is a legitimate and frequent edit — buildIssueBody never nests
  // bullets, so counting ANY line beginning with "-" (indented ones included)
  // as a "dependency bullet" would falsely mark this as `malformed`, even
  // though the one real dependency (#1) was read perfectly. `bulletLines`
  // counts only TOP-LEVEL bullets ("- " unindented, exactly as buildIssueBody
  // emits them) — an indented sub-list does not count.
  it('a human sub-list indented under a real dependency does NOT count as a dependency bullet — it does not falsely fire malformed', () => {
    const body = '## Dependencias\n- merge-after #1\n  - nota: esto lo negociamos con pagos, no tocar\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })

  // Another attack on the heuristic itself: a markdown separator "---" (a
  // horizontal rule) begins with "-" but is NOT a bullet — without the "- "
  // requirement (hyphen AND space, the exact format buildIssueBody emits), this
  // separator would inflate bulletLines with no corresponding dependency,
  // falsely marking it malformed.
  it('a "---" line (a markdown separator) inside the section does not count as a dependency bullet', () => {
    const body = '## Dependencias\n- merge-after #1\n---\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })
})

// Review of D1, finding 1 (the "the warning is missing" part): narrowing the
// dispatcher's deps domain to "## Dependencias" (D1 finding 2) opened a gate
// `main` kept closed — verified by the review with the SAME fixture both ways:
// an `#8` whose body carries `merge-after #1` under "## Descripción" (never
// inside "## Dependencias"). `main` (a scan of the WHOLE body) saw it and
// blocked `#8` until `#1`, its real sibling, merged; this branch, after D1
// finding 2, ignores it entirely — correct and wanted (it is exactly the
// narrowing that was asked for), but before this fix NOTHING was printed about
// it: `#8` was dispatched in silence without anyone knowing that its attempt at
// a dependency had stopped counting.
//
// `extractStrayDeps`/`mapGhIssue#strayDeps` expose exactly those "merge-after
// #N" references that exist in the body but OUTSIDE the recognised section —
// the same signal reconcile.js already computed for its own report
// (`diffIssue#strayDeps`), now shared (a single implementation, not two that
// can diverge) so that ct-next.mjs can warn too (see ct-next-dryrun.test.js).
describe('extractStrayDeps / mapGhIssue#strayDeps — deps outside the recognised section, exposed so a warning is possible (D1 finding 1, review follow-up)', () => {
  it('the review\u2019s EXACT reproduction: "merge-after #1" under "## Descripción" (never "## Dependencias") → deps:[], strayDeps:[1]', () => {
    const body = [
      '## Descripción',
      'hace referencia a merge-after #1 pero no en la sección correcta',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const mapped = mapGhIssue({ number: 8, title: '#8 x', labels: [], body })
    expect(mapped.deps).toEqual([]) // the narrowing (D1 finding 2) is correct: it does not count as a real dependency
    expect(mapped.strayDeps).toEqual([1]) // but the ignored reference is left exposed so a warning is possible
  })

  it('a "merge-after #N" INSIDE the recognised section is not "stray" — only what lives outside counts', () => {
    const body = '## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.strayDeps).toEqual([])
  })

  it('with no out-of-section reference at all → strayDeps: [] (the normal case, no noise)', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body: 'body normal sin nada de esto' })
    expect(mapped.strayDeps).toEqual([])
  })

  it('extractStrayDeps — the shared function: dedup and ascending order, and a dep repeated INSIDE and outside the section does not count as stray', () => {
    expect(extractStrayDeps('merge-after #9\nmerge-after #9', [])).toEqual([9]) // dedup
    expect(extractStrayDeps('merge-after #3\nmerge-after #1', [3])).toEqual([1]) // #3 is already in sectionDeps, it is not stray; #1 is
    expect(extractStrayDeps('sin nada', [])).toEqual([])
  })
})

// Review of D1 (round 2): counting "- " bullets is not the right axis — it is
// defeated by any good line with TWO "merge-after" (it inflates the dep count
// without inflating the bullet count) and by any broken line that does not use
// "- " (a "*" bullet, a numbered one, or no bullet at all). The right signal is
// another one: ANY "#N" reference (by VALUE, not by position — so the same
// reference repeated in prose, "ver también #1" for instance, does not count as
// a problem if #1 is ALREADY a recognised dependency) that "merge-after" never
// captured is what really tells "this line meant to declare a dependency and is
// badly written" apart from "this line is a note with no number in it". These
// tests reproduce EXACTLY the three false negatives and the false positive the
// review found against my first heuristic (bulletLines), and they attack the
// NEW heuristic with shapes nobody gave me: a "*" bullet, a numbered one, no
// bullet, an indented one, several deps on one line, struck-through deps.
describe('mapGhIssue — extractDepsInSection: the right signal is the uncaptured "#N" reference, not the bullet count (review of D1, round 2)', () => {
  it('false negative 1 (review): two real merge-after on one line + a third broken dependency on ANOTHER line → malformed:true (before: false, the "mixture" was lost)', () => {
    const body = '## Dependencias\n- merge-after #1, merge-after #2\n- Depende de #3\n\n<!-- ct-order:4 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1, 2]) // what was read properly is kept (fail-closed)
    expect(mapped.depsMalformed).toBe(true) // but #3 cannot be lost in silence
  })

  it('false negative 2 (review): a broken dependency with a "*" bullet instead of "-" → malformed:true (before: false, "*" did not count as a bullet)', () => {
    const body = '## Dependencias\n- merge-after #1\n* Depende de #2\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('false negative 3 (review): a broken dependency with NO bullet at all → malformed:true (before: false, the line did not begin with "-")', () => {
    const body = '## Dependencias\n- merge-after #1\nDepende de #2 tambien\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('false positive (review): a real dependency + a NOTE with no number at all → malformed:false (before: true, 2 bullets against 1 dep blocked a healthy slice)', () => {
    const body = '## Dependencias\n- merge-after #1\n- ojo: revisar con Ana\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })

  // Further attacks on the NEW heuristic (not given by the review):
  it('a broken dependency in NUMBERED list format ("1. Depende de #2") → malformed:true', () => {
    const body = '## Dependencias\n- merge-after #1\n1. Depende de #2\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('a broken dependency INDENTED under the real one ("  Depende de #2", a sub-level) → malformed:true — indenting it does not make it harmless', () => {
    const body = '## Dependencias\n- merge-after #1\n  - Depende de #2\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('the SAME reference repeated in prose ("ver también #1 en el spec", where #1 is ALREADY a recognised dependency) → it does NOT count as a problem (comparison by value, not by position)', () => {
    const body = '## Dependencias\n- merge-after #1\n- ver también #1 en el spec para más contexto\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })

  it('struck-through deps ("~~merge-after #1~~ ya no aplica") + a note with no number → still not malformed (regression: do not reintroduce the false positive)', () => {
    const body = '## Dependencias\n- ~~merge-after #1~~ ya no aplica\n- nota: pendiente de decidir con pagos\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })
})

// D1 finding 3: two "status:" labels at once (a half-finished edit — the new
// one was added without removing the old one) made `Array.prototype.find` pick
// the FIRST of the array `gh` returns, with no warning and no check that there
// was exactly one. The auditor verified that
// `['status:in-progress','status:ready']` resolves to "in-progress" and the
// same array reversed resolves to "ready" — but could not determine offline the
// real order GitHub uses, and asked explicitly NOT to guess it: the code has to
// be independent of that order. The resolution here does NOT try to guess which
// of the two labels is "the real one": it always applies the MOST CONSERVATIVE
// interpretation possible (in-progress > in-review > ready > backlog) — the one
// least likely to re-dispatch the same work twice or to leave it out of the
// cap's reckoning. The same result for BOTH orders of the array is the proof of
// independence.
describe('mapGhIssue — an ambiguous status: with more than one label at once, resolved without depending on the array order (D1 finding 3)', () => {
  it('["status:in-progress","status:ready"] → it resolves to "in-progress", flagged as ambiguous', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:in-progress' }, { name: 'status:ready' }], body: '' })
    expect(mapped.status).toBe('in-progress')
    expect(mapped.statusAmbiguous).toBe(true)
  })

  it('the SAME array but REVERSED → it resolves to the SAME status ("in-progress") — independent of the order', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }, { name: 'status:in-progress' }], body: '' })
    expect(mapped.status).toBe('in-progress')
    expect(mapped.statusAmbiguous).toBe(true)
  })

  it('status:ready + status:in-review (both orders) → always "in-review", never "ready"', () => {
    const a = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }, { name: 'status:in-review' }], body: '' })
    const b = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:in-review' }, { name: 'status:ready' }], body: '' })
    expect(a.status).toBe('in-review')
    expect(b.status).toBe('in-review')
  })

  it('a single status: label → no ambiguity, normal behaviour unchanged', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }], body: '' })
    expect(mapped.status).toBe('ready')
    expect(mapped.statusAmbiguous).toBe(false)
  })

  it('with no status: label at all → "backlog", no ambiguity', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'type:x' }], body: '' })
    expect(mapped.status).toBe('backlog')
    expect(mapped.statusAmbiguous).toBe(false)
  })

  it('three status: labels at once (a doubly half-finished edit) → it keeps resolving by precedence, without blowing up', () => {
    const mapped = mapGhIssue({
      number: 1, title: '#1 x',
      labels: [{ name: 'status:backlog' }, { name: 'status:ready' }, { name: 'status:in-progress' }],
      body: '',
    })
    expect(mapped.status).toBe('in-progress')
    expect(mapped.statusAmbiguous).toBe(true)
  })

  // Minor (review of D1): two custom labels that are NONE of the four known
  // ones (they gate nothing in dispatch.js — they count as neither "ready" nor
  // "in-progress" anywhere, so the dispatch DECISION is identical whatever
  // happens here) still resolved by the array order through `?? statusLabels[0]`
  // — the very defect this function exists in order not to have. The TEXT of
  // the warning does depend on this value: it has to be independent of the
  // order, like the rest of the function.
  it('two custom status: labels (none of the four known ones) → the fallback is independent of the array order (alphabetical, not "the first of the array")', () => {
    const a = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:paused' }, { name: 'status:blocked' }], body: '' })
    const b = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:blocked' }, { name: 'status:paused' }], body: '' })
    expect(a.status).toBe(b.status) // the same result whatever the input order
    expect(a.status).toBe('blocked') // deterministic: "blocked" < "paused" alphabetically
  })
})

// D1 finding 4: an "area:" or "touches:" label with NO VALUE (the colon there,
// nothing behind it — created by accident in GitHub's editor, say) strips down
// to an EMPTY string once the prefix is removed. Two such issues "collide" over
// the token '' even though they share no real area or touch — and the collision
// message in ct-next.mjs would show it as `comparte el token ''`. An empty token
// represents nothing: it is discarded before entering the collision machinery
// (dispatch.js#touchesConflict), just as an unmappable order dep is discarded to
// `null` rather than sneaking a junk value through.
describe('mapGhIssue — an "area:"/"touches:" label with no value produces no collidable empty token (D1 finding 4)', () => {
  it('an "area:" label with nothing behind the colon → touches does not include the empty string', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'area:' }, { name: 'status:ready' }], body: '' })
    expect(mapped.touches).toEqual([])
  })

  it('a "touches:" label with no value + a real area: → only the real token survives, never the empty string', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'touches:' }, { name: 'area:api' }], body: '' })
    expect(mapped.touches).toEqual(['api'])
  })

  it('two issues sharing ONLY the broken "area:" label (with no value) → selectNext does NOT treat them as a collision (the empty token does not count)', () => {
    const a = mapGhIssue({ number: 1, title: '#1 a', labels: [{ name: 'status:ready' }, { name: 'area:' }], body: '<!-- ct-order:1 -->' })
    const b = mapGhIssue({ number: 2, title: '#2 b', labels: [{ name: 'status:ready' }, { name: 'area:' }], body: '<!-- ct-order:2 -->' })
    const selected = selectNext([a, b], { mergedIssues: [], runningTouches: [], concurrencyCap: 2 })
    expect(selected.map((i) => i.n)).toEqual([1, 2]) // both, with no spurious collision
  })

  // An adversarial attack (not an example from the auditor): "area: " — a colon
  // followed by whitespace, with no real content behind it — strips down to ' '
  // (a space, NOT the empty string). A filter that only checks `t.length > 0`
  // lets this token, just as empty of content, through, and two issues with
  // this variant would "collide" over ' ' again — the SAME bug as the finding,
  // with a different character.
  it('an "area: " label (colon + whitespace, with no real content) → it does not produce a collidable token either', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'area: ' }], body: '' })
    expect(mapped.touches).toEqual([])
  })

  it('two issues sharing ONLY "area: " (whitespace) → they do not collide either', () => {
    const a = mapGhIssue({ number: 1, title: '#1 a', labels: [{ name: 'status:ready' }, { name: 'area: ' }], body: '<!-- ct-order:1 -->' })
    const b = mapGhIssue({ number: 2, title: '#2 b', labels: [{ name: 'status:ready' }, { name: 'area: ' }], body: '<!-- ct-order:2 -->' })
    const selected = selectNext([a, b], { mergedIssues: [], runningTouches: [], concurrencyCap: 2 })
    expect(selected.map((i) => i.n)).toEqual([1, 2])
  })
})

// F23 — specTarget: "do these two issues point at the same spec?", which is NOT
// the same question as "has the link line changed?" (diffIssue answers that one
// by comparing the whole line, and it must go on doing so).
describe('specTarget', () => {
  it('it returns what comes after "Spec: " in the link\u2019s current form', () => {
    const linea = '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)'
    expect(specTarget(linea)).toBe('[docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)')
  })
  it('the form from BEFORE F6 (with no backticks) gives the SAME target — that is the reason for comparing the target and not the line', () => {
    const destino = '[docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)'
    expect(specTarget(`> Slice #2 del epic. Spec: ${destino}`)).toBe(destino)
    expect(specTarget(`> Slice \`#2\` del epic. Spec: ${destino}`)).toBe(destino)
  })
  it('the slice\u2019s ORDER is not part of the target: two different slices of the same spec match', () => {
    const destino = '`docs/spec.md` § `9. Slices` — sin enlace: el fichero no está publicado'
    expect(specTarget(`> Slice \`#1\` del epic. Spec: ${destino}`))
      .toBe(specTarget(`> Slice \`#7\` del epic. Spec: ${destino}`))
  })
  it('different specs give different targets', () => {
    const a = specTarget('> Slice `#1` del epic. Spec: [docs/a.md](https://github.com/o/r/blob/main/docs/a.md)')
    const b = specTarget('> Slice `#1` del epic. Spec: [docs/b.md](https://github.com/o/r/blob/main/docs/b.md)')
    expect(a).not.toBe(b)
  })
  it('with no "Spec: " separator → null (it does not invent a target)', () => {
    expect(specTarget('> Slice `#1` del epic.')).toBeNull()
    expect(specTarget('una línea cualquiera')).toBeNull()
  })
  it('defensive: null/undefined/empty → null', () => {
    expect(specTarget(null)).toBeNull()
    expect(specTarget(undefined)).toBeNull()
    expect(specTarget('')).toBeNull()
    expect(specTarget('> Slice `#1` del epic. Spec: ')).toBeNull()
  })
})

// Slice 10 — extractSenal: the body's "## Señal de observabilidad" section,
// section-scoped with extractSectionContent and first occurrence wins — the same
// stance as extractAc. It is the first link of the end-to-end program channel
// (issue → SLICE.md → the slice judge's package): no agent decides to copy the
// signal at any point.
describe('extractSenal — the body\u2019s signal (Slice 10)', () => {
  it('it reads the content of "## Señal de observabilidad" and returns it verbatim', () => {
    const body = '## Señal de observabilidad\nmétrica `backfill_progress` con label `estado`\n\n## Dependencias\n- merge-after #1'
    expect(extractSenal(body)).toBe('métrica `backfill_progress` con label `estado`')
    // The reasoned exemption travels verbatim too — the consumer tells it apart
    // only by its N/A prefix.
    const exenta = `${SENAL_HEADING}\nN/A — pantalla sin telemetría nueva\n\n## Gates\nx`
    expect(extractSenal(exenta)).toBe('N/A — pantalla sin telemetría nueva')
  })
  it('with no section it returns null; an empty section counts as absent in mapGhIssue', () => {
    expect(extractSenal('body sin esa sección')).toBe(null)
    expect(extractSenal('')).toBe(null)
    // A section that is present but empty: extractSenal returns '' (trimmed
    // content) and mapGhIssue collapses it to null — empty content = absent.
    const vacia = `${SENAL_HEADING}\n\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:7 -->`
    const mapped = mapGhIssue({ number: 9, title: '#9 x', labels: [], body: vacia })
    expect(mapped.senal).toBe(null)
  })
  it('mapGhIssue exposes senal alongside ac and gates', () => {
    const body = [
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-1', '',
      '## Señal de observabilidad', 'métrica x', '',
      '## Dependencias', '- merge-after #1', '',
      '<!-- ct-order:7 -->',
    ].join('\n')
    const mapped = mapGhIssue({ number: 9, title: '#9 x', labels: [{ name: 'gate:visual' }], body })
    expect(mapped.senal).toBe('métrica x')
    expect(mapped.ac).toEqual(['AC-1'])
    expect(mapped.gates).toEqual(['visual'])
    // With no section → null, not undefined: the absence is a declared value.
    const sinSenal = mapGhIssue({ number: 9, title: '#9 x', labels: [], body: '' })
    expect(sinSenal.senal).toBe(null)
  })
})
