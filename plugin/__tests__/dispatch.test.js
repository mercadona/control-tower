import { describe, it, expect } from 'vitest'
import { selectNext, buildCmuxArgv, collectInFlight, planDispatch, computeReadyCandidates } from '../scripts/dispatch.js'

const ISSUES = [
  { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'] },
  { n: 2, order: 2, status: 'ready',     deps: [1], touches: ['api'] },
  { n: 3, order: 3, status: 'ready',     deps: [],  touches: ['ui'] },
  { n: 4, order: 4, status: 'ready',     deps: [],  touches: ['migration'] },
  { n: 5, order: 5, status: 'ready',     deps: [],  touches: ['migration'] },
]

// computeReadyCandidates: fix round 1 of the W-B review (finding Important —
// the duplication of the ready/merged-deps filter between selectNext and
// explainNoSelection was a risk of silent drift). It is now the single source of
// truth of that computation; these tests cover it directly.
// (Fix round 2, finding 1: the note that used to be here claimed there was no
// cheap behavioural check capable of detecting a future divergence between
// selectNext and explainNoSelection — the review corrected that, and rightly so:
// there IS one, see the describe 'explainNoSelection / selectNext — candidate
// identity oracle' further down, which compares against the REAL selectNext, not
// against this same helper.)
describe('computeReadyCandidates', () => {
  it('ready: status:ready only, in the original order', () => {
    const { ready } = computeReadyCandidates(ISSUES, [1])
    expect(ready.map((i) => i.n)).toEqual([2, 3, 4, 5])
  })
  it('readyDepsMet: it also filters by merged deps, sorted by ascending `order`', () => {
    const { readyDepsMet } = computeReadyCandidates(ISSUES, [])
    expect(readyDepsMet.map((i) => i.n)).toEqual([3, 4, 5]) // #2 out: dep #1 not merged
  })
  it('with merged deps, readyDepsMet also includes the one whose deps were pending', () => {
    const { readyDepsMet } = computeReadyCandidates(ISSUES, [1])
    expect(readyDepsMet.map((i) => i.n)).toEqual([2, 3, 4, 5])
  })
  it('with no ready at all → both arrays empty', () => {
    const issues = [{ n: 1, order: 1, status: 'in-review', deps: [], touches: [] }]
    const { ready, readyDepsMet } = computeReadyCandidates(issues, [])
    expect(ready).toEqual([])
    expect(readyDepsMet).toEqual([])
  })
  // Fix round 2, finding 2: in ALL the fixtures of this file (the old ones and
  // the three above), the order of the input array already coincides with the
  // order of the `order` field — so an implementation that filtered correctly
  // but forgot the `.sort` would pass every existing test just the same. This
  // fixture comes in deliberately UNSORTED with respect to `order` (30, 10, 20)
  // so that the assertion can only pass if it really sorts.
  it('readyDepsMet comes out sorted by ascending `order` even when the input array arrives unsorted', () => {
    const issues = [
      { n: 100, order: 30, status: 'ready', deps: [], touches: [] },
      { n: 200, order: 10, status: 'ready', deps: [], touches: [] },
      { n: 300, order: 20, status: 'ready', deps: [], touches: [] },
    ]
    const { readyDepsMet } = computeReadyCandidates(issues, [])
    expect(readyDepsMet.map((i) => i.order)).toEqual([10, 20, 30])
    expect(readyDepsMet.map((i) => i.n)).toEqual([200, 300, 100])
  })

  // D1 finding 2: an issue with `depsMalformed: true`
  // (gh-issue-map.js#mapGhIssue — the "## Dependencias" section exists but no
  // "merge-after #N" was recognised inside it, most likely a human rewrite)
  // has its `deps` at `[]`, but that does NOT mean "no dependencies" — it
  // means "state unknown". Without this filter, an issue like that would pass
  // the empty `.every(...)` trivially and would be treated as ready to
  // dispatch — exactly the "gate opened in silence" the finding describes.
  it('an issue with depsMalformed:true NEVER enters readyDepsMet, even when its `deps` is empty', () => {
    const issues = [{ n: 9, order: 9, status: 'ready', deps: [], depsMalformed: true, touches: [] }]
    const { ready, readyDepsMet } = computeReadyCandidates(issues, [])
    expect(ready.map((i) => i.n)).toEqual([9]) // it still counts as "ready" (status), just not as "deps resolved"
    expect(readyDepsMet).toEqual([])
  })

  it('depsMalformed:false (or absent) with a real deps [] → readyDepsMet includes it as normal (the normal case, no regression)', () => {
    const issues = [{ n: 9, order: 9, status: 'ready', deps: [], touches: [] }]
    const { readyDepsMet } = computeReadyCandidates(issues, [])
    expect(readyDepsMet.map((i) => i.n)).toEqual([9])
  })
})

describe('selectNext', () => {
  it('does not choose a slice whose dep is not merged', () => {
    const out = selectNext(ISSUES, { mergedIssues: [], runningTouches: [], concurrencyCap: 5 })
    expect(out.find((i) => i.n === 2)).toBeUndefined() // dep #1 not merged
  })
  it('chooses the slice whose dep is merged', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 5 })
    expect(out.some((i) => i.n === 2)).toBe(true)
  })
  it('parallelises disjoint touches up to the cap', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 2 })
    expect(out).toHaveLength(2)
  })
  it('serialises touches:migration (only one of #4/#5)', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 9 })
    const migs = out.filter((i) => i.touches.includes('migration'))
    expect(migs).toHaveLength(1)
    expect(migs[0].n).toBe(4) // the one of lowest order
  })
  it('does not choose if its touches clash with runningTouches', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: ['api'], concurrencyCap: 9 })
    expect(out.find((i) => i.n === 2)).toBeUndefined()
  })
  it('respects ascending order', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 9 })
    expect(out.map((i) => i.n)).toEqual([...out.map((i) => i.n)].sort((a, b) => a - b))
  })
  it('cross-type serialisation: only one of touches:ci or touches:migration', () => {
    const issues = [
      { n: 1, order: 1, status: 'ready', deps: [], touches: ['ci'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['migration'] },
    ]
    const out = selectNext(issues, { mergedIssues: [], runningTouches: [], concurrencyCap: 9 })
    const serializingCount = out.filter((i) => i.touches.some((t) => ['ci', 'migration'].includes(t))).length
    expect(serializingCount).toBe(1)
    expect(out[0].n).toBe(1) // lowest order
  })
  it('runningTouches:migration blocks a candidate with touches:ci', () => {
    const issues = [
      { n: 1, order: 1, status: 'ready', deps: [], touches: ['ci'] },
    ]
    const out = selectNext(issues, { mergedIssues: [], runningTouches: ['migration'], concurrencyCap: 9 })
    expect(out.find((i) => i.n === 1)).toBeUndefined()
  })
  it('disjoint non-serializing ones are parallelised (negative control)', () => {
    const issues = [
      { n: 1, order: 1, status: 'ready', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'] },
    ]
    const out = selectNext(issues, { mergedIssues: [], runningTouches: [], concurrencyCap: 2 })
    expect(out).toHaveLength(2)
  })
})

describe('collectInFlight', () => {
  it('gathers only the issues in status:in-progress, with their touches', () => {
    const issues = [
      { n: 1, status: 'in-progress', touches: ['api', 'ui'] },
      { n: 2, status: 'ready', touches: ['db'] },
      { n: 3, status: 'in-progress', touches: [] },
    ]
    expect(collectInFlight(issues)).toEqual([
      { n: 1, status: 'in-progress', touches: ['api', 'ui'] },
      { n: 3, status: 'in-progress', touches: [] },
    ])
  })
  it('an in-progress issue with no touches → touches: []', () => {
    expect(collectInFlight([{ n: 1, status: 'in-progress' }])).toEqual([{ n: 1, status: 'in-progress', touches: [] }])
  })
  it('with no in-progress at all → []', () => {
    expect(collectInFlight([{ n: 1, status: 'ready', touches: ['x'] }])).toEqual([])
  })
})

// W-B (§8): before, ct-next.mjs called selectNext with a hardcoded
// `runningTouches: []` — two successive invocations of /ct-next never saw each
// other, so neither the touches collision nor the cap counted the work already
// in flight (status:in-progress). planDispatch is the pure layer that closes
// that gap: it derives runningTouches/remainingCap from the issues already
// loaded and, when it selects nothing, it explains WHY (a distinguishable
// reason instead of a generic message) so that the human knows what to do
// next.
describe('planDispatch — the cap counts work in flight, and the blocking reason is distinguishable (W-B, §8)', () => {
  it('with nothing in flight and one dispatchable ready → selected includes it and blockReason is null', () => {
    const issues = [{ n: 1, order: 1, status: 'ready', deps: [], touches: ['api'] }]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.selected.map((i) => i.n)).toEqual([1])
    expect(plan.blockReason).toBeNull()
    expect(plan.inFlight).toEqual([])
    expect(plan.runningTouches).toEqual([])
    expect(plan.remainingCap).toBe(1)
  })

  it('runningTouches is derived from the in-progress ones, not from a hardcoded [] (the bug that motivates W-B)', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'] }, // clashes with #1 in flight
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 5 })
    expect(plan.selected).toEqual([])
    expect(plan.runningTouches).toEqual(['api'])
    expect(plan.blockReason).toMatchObject({ reason: 'collision', issue: 2, token: 'api', withIssue: 1 })
  })

  // Fix Minor 1 of the review: `wouldDispatchIfCapAllowed` tells whether
  // raising --cap would really help. Here #2 collides with nothing in flight,
  // so it WOULD help (blockedEvenWithCap: null).
  it('the cap is already taken up by work in flight → it dispatches nothing, even with a ready that does not collide (raising --cap WOULD help)', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'] }, // no touches collision
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 }) // cap 1, there is already 1 in flight
    expect(plan.selected).toEqual([])
    expect(plan.remainingCap).toBe(0)
    expect(plan.blockReason).toEqual({
      reason: 'cap-full', inFlightCount: 1, inFlight: [{ n: 1, status: 'in-progress', touches: ['api'] }], cap: 1, wouldDispatchIfCapAllowed: true, blockedEvenWithCap: null,
    })
  })

  it('cap 2 with 1 in flight → 1 gap is left, one more is dispatched if it does not collide', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['migration'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'] },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 2 })
    expect(plan.selected.map((i) => i.n)).toEqual([2])
    expect(plan.remainingCap).toBe(1)
  })

  it('nothing in status:ready → blockReason none-ready', () => {
    const issues = [{ n: 1, order: 1, status: 'in-review', deps: [], touches: [] }]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.selected).toEqual([])
    // F13: 'none-ready' no longer keeps quiet about the slices stopped in
    // in-review — they are the usual cause of "there is nothing ready" at the
    // end of an epic, and since F13/H2 they also retain their tokens.
    // F16/H1: besides the in-review inventory, the backlog one, the
    // in-progress one and the TOTAL of open issues travel too — without them,
    // "there is nothing ready" could not tell "there is work waiting for your
    // human gate" from "this repo is empty", and both came out with the same
    // text.
    expect(plan.blockReason).toEqual({ reason: 'none-ready', inReview: [1], backlog: [], inProgress: [], total: 1 })
  })

  it('ready but with unmerged deps → blockReason deps-unmet, listing the blocked issues and which deps are missing', () => {
    const issues = [{ n: 2, order: 2, status: 'ready', deps: [1, 3], touches: [] }]
    const plan = planDispatch(issues, { mergedIssues: [3], cap: 1 }) // #1 is still to be merged
    expect(plan.selected).toEqual([])
    expect(plan.blockReason).toEqual({ reason: 'deps-unmet', depStates: {}, blocked: [{ n: 2, unmetDeps: [1], malformed: false }] })
  })

  // D1 finding 2: a ready issue whose "## Dependencias" section is unreadable
  // (depsMalformed) is reported with `malformed: true` and `unmetDeps: []` —
  // the formatter (ct-next.mjs) needs to tell this case apart from "no pending
  // dependencies" so as not to print an empty list and an apparent
  // contradiction ("blocked, but nothing is missing a merge").
  it('ready with depsMalformed:true → blockReason deps-unmet, malformed:true, unmetDeps empty (the state of the gate is unknown, not "no deps")', () => {
    const issues = [{ n: 9, order: 9, status: 'ready', deps: [], depsMalformed: true, touches: [] }]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.selected).toEqual([])
    expect(plan.blockReason).toEqual({ reason: 'deps-unmet', depStates: {}, blocked: [{ n: 9, unmetDeps: [], malformed: true }] })
  })

  // D1 finding 5: an ORDER dependency that cannot be mapped arrives here as
  // `null` (gh-issue-map.js#buildDispatchInput) — planDispatch/dispatch.js
  // does not rewrite that `null` (it is still the internal representation,
  // fail-closed); it is ct-next.mjs that translates it into a human message
  // (see ct-next-dryrun.test.js). This test pins that the `null` survives
  // intact all the way to blockReason, without planDispatch mistaking it for
  // a real issue.
  it('deps with a null (an order with no corresponding issue) → unmetDeps keeps the null just as it is, it does not blow up', () => {
    const issues = [{ n: 5, order: 5, status: 'ready', deps: [null], touches: [] }]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.blockReason).toEqual({ reason: 'deps-unmet', depStates: {}, blocked: [{ n: 5, unmetDeps: [null], malformed: false }] })
  })

  it('ready + merged deps but colliding with a serializing one in flight (migration/ci/pbxproj, different tokens) → a collision of kind serializing', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['migration'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ci'] },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 5 })
    expect(plan.selected).toEqual([])
    // F16/H1: `blockers` carries ALL the ones that hold the lane, not just
    // the first. Here there is one, so the list has one element — and the
    // reason it blocks is one of LANE (`laneTokens`), not of a shared token:
    // #2 touches `ci` and #1 `migration`, they share nothing literal.
    expect(plan.blockReason).toEqual({
      reason: 'collision', kind: 'serializing', issue: 2, token: 'ci', runningToken: 'migration', withIssue: 1, withIssueStatus: 'in-progress',
      blockers: [{ n: 1, status: 'in-progress', sharedTokens: [], laneTokens: ['migration'] }],
    })
  })

  // Fix Minor 1: here, even with the cap not full, the only ready one would
  // still be blocked by unmerged deps — raising --cap would NOT help.
  // `blockedEvenWithCap` carries the real reason (deps-unmet) so that the
  // message does not falsely promise that "raise --cap" would resolve
  // anything.
  it('cap-full has priority as the reported reason, but it notes that raising --cap would NOT help (the ready one also has unmerged deps)', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['x'] },
      { n: 2, order: 2, status: 'ready', deps: [99], touches: [] },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.blockReason).toEqual({
      reason: 'cap-full',
      inFlightCount: 1,
      inFlight: [{ n: 1, status: 'in-progress', touches: ['x'] }],
      cap: 1,
      wouldDispatchIfCapAllowed: false,
      blockedEvenWithCap: { reason: 'deps-unmet', depStates: {}, blocked: [{ n: 2, unmetDeps: [99], malformed: false }] },
    })
  })

  // Same idea as the previous test, but the underlying reason that survives
  // raising the cap is a COLLISION (not deps-unmet) — it confirms that
  // `blockedEvenWithCap` propagates any of explainSelectionGap's reasons, not
  // just deps-unmet.
  it('cap-full with the only ready one colliding (besides being in flight) → blockedEvenWithCap brings the collision', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'] }, // clashes with #1 in flight, not just with the cap
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.blockReason).toEqual({
      reason: 'cap-full',
      inFlightCount: 1,
      inFlight: [{ n: 1, status: 'in-progress', touches: ['api'] }],
      cap: 1,
      wouldDispatchIfCapAllowed: false,
      blockedEvenWithCap: {
        reason: 'collision', kind: 'token', issue: 2, token: 'api', withIssue: 1, withIssueStatus: 'in-progress',
        blockers: [{ n: 1, status: 'in-progress', sharedTokens: ['api'], laneTokens: [] }], // F16/H1
      },
    })
  })
})

// Fix round 2, finding 1 of the re-review: fix round 1 claimed there was no
// cheap behavioural check capable of detecting a future divergence between
// selectNext and explainNoSelection/explainSelectionGap — the review
// corrected that claim, and rightly so: there IS one. These tests compare the
// candidate `explainNoSelection` cites in its 'collision'/'deps-unmet'
// reasons against what the REAL `selectNext` (not a second call to
// computeReadyCandidates, but the complete selection algorithm) would decide
// if it were given one more gap of cap.
//
// A note on why selectNext is called with `runningTouches: []` instead of the
// same runningTouches that caused the original block: if they were kept,
// `selectNext(..., concurrencyCap: remainingCap + 1)` would go on returning
// `[]` anyway — neither a touches collision nor an unmerged dep comes undone
// by giving it one more gap of cap (both block regardless of the cap; verified
// by reading selectNext's loop: the `continue` for a collision does not depend
// on `concurrencyCap`), so there would never be a real `[0]` against which to
// compare the candidate's identity. What IS comparable, and is exactly the
// risk that worries us, is "is the candidate explainNoSelection identifies as
// THE blocked one the same one the real selection algorithm would choose as
// the first, given a clear road (no external interference and cap to
// spare)?" — if in the future somebody reintroduces a local candidate
// computation with errors in one of the two places, this comparison breaks
// because it invokes the REAL selectNext, not a re-derivation of the same
// shared helper.
describe('explainNoSelection / selectNext — candidate identity oracle (fix round 2, finding 1)', () => {
  it('collision: the issue explainNoSelection cites is the same [0] selectNext would choose with no interference and one more gap of cap', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'] }, // clashes with #1 in flight
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 9 })
    expect(plan.blockReason.reason).toBe('collision')

    const clean = selectNext(issues, { mergedIssues: [], runningTouches: [], concurrencyCap: plan.remainingCap + 1 })
    expect(clean[0]?.n).toBe(plan.blockReason.issue)
  })

  it('deps-unmet: the real selectNext (with no interference and cap to spare) also agrees in selecting nothing', () => {
    const issues = [{ n: 2, order: 2, status: 'ready', deps: [1, 3], touches: [] }]
    const plan = planDispatch(issues, { mergedIssues: [3], cap: 1 }) // #1 is still to be merged
    expect(plan.blockReason.reason).toBe('deps-unmet')

    const clean = selectNext(issues, { mergedIssues: [3], runningTouches: [], concurrencyCap: plan.remainingCap + 1 })
    // deps-unmet blocks regardless of the cap and of the touches — if the
    // real selectNext selected something here, it would be the signal that
    // explainSelectionGap has diverged from the deps filter selectNext uses.
    expect(clean).toEqual([])
  })

  // Fix round 3 (re-review): the collision test above has a SINGLE
  // ready+merged-deps candidate (#2; #1 falls out because it is in-progress,
  // not ready). With a single element, `readyDepsMet[0]` and
  // `readyDepsMet[readyDepsMet.length - 1]` ARE THE SAME element — so that
  // test has no discriminating power against the class of regression that
  // motivated writing the oracle: "the explainer chooses wrong among SEVERAL
  // candidates" (a re-derivation that filters or sorts differently, an
  // off-by-one of the index). The sabotage used to prove that the oracle does
  // detect divergences (see fix round 2's report) was done against a fixture
  // of TWO candidates and was never committed — a proof of non-tautology
  // stronger than the test that did stay in the repo was being left out. This
  // test is THAT two-candidate fixture, now committed as a variant of the
  // oracle (it does not replace the one above: both stay, one covers the more
  // common case of a single blocked candidate, this one covers the case with
  // real discriminating power among several).
  it('collision with SEVERAL candidates clashing with the same token in flight: the issue cited is the one of LOWEST order, not just any of them (a fixture with real discriminating power)', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['x'] },
      { n: 10, order: 1, status: 'ready', deps: [], touches: ['x'] }, // clashes with #1 in flight, order 1 (the lowest order)
      { n: 20, order: 2, status: 'ready', deps: [], touches: ['x'] }, // it also clashes, order 2
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 9 })
    expect(plan.blockReason.reason).toBe('collision')

    const clean = selectNext(issues, { mergedIssues: [], runningTouches: [], concurrencyCap: plan.remainingCap + 1 })
    // With no external `runningTouches`, #10 (order 1) no longer clashes with
    // anything and is selected first; #20 (order 2) DOES go on clashing — but
    // now with the batch's own `claimedTouches` (both share the same token
    // 'x' between them), not with work in flight, so it falls out and `clean`
    // brings only #10. What matters for the oracle is that `readyDepsMet` had
    // TWO elements and the identification of "the first" really had to be
    // exercised: if `explainNoSelection` cited #20 (e.g. because of a
    // `readyDepsMet[length - 1]` instead of `readyDepsMet[0]`, or an inverted
    // sort), `clean[0]` would still be #10 (computed by the real
    // `selectNext`, untouched) and the comparison below would fail — unlike
    // the single-candidate test above, where `[0]` and `[length - 1]` are the
    // same element and the same sabotage would go unnoticed.
    expect(clean.map((i) => i.n)).toEqual([10])
    expect(clean[0].n).toBe(plan.blockReason.issue)
  })
})

// D2, finding 4 (the dispatch audit): explainSelectionGap only looked at
// readyDepsMet[0] to decide `wouldDispatchIfCapAllowed` in the cap-full
// branch. The reasoning of "the first explains the block" (the comment above)
// is valid for explaining why selectNext, with a REAL gap of cap, selected
// nothing (if the [0] clashes, they all clash — if it does not, it would have
// been selected) — but it is NOT valid for the counterfactual "would raising
// --cap help?", because in cap-full `remainingCap` was 0 and selectNext NEVER
// examined candidate 2: that the [0] clashes says nothing about whether the
// [1] would too. The auditor's exact reproduction: cap=2, two in flight (api,
// db), two ready-with-merged-deps — #20 (order 1, touches:api, clashes with
// the `api` in flight) and #21 (order 2, touches:ui, free). Raising the cap
// WOULD dispatch #21 — the current message claims the opposite.
describe('explainSelectionGap / planDispatch — cap-full must scan ALL the candidates, not just the first (D2, finding 4)', () => {
  it('cap-full with #20 (order 1) clashing but #21 (order 2) free → wouldDispatchIfCapAllowed must be true', () => {
    const issues = [
      { n: 10, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 11, order: 2, status: 'in-progress', deps: [], touches: ['db'] },
      { n: 20, order: 1, status: 'ready', deps: [], touches: ['api'] }, // clashes with #10
      { n: 21, order: 2, status: 'ready', deps: [], touches: ['ui'] },  // free — raising --cap WOULD help
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 2 }) // 2 en vuelo, cap ya lleno
    expect(plan.selected).toEqual([])
    expect(plan.blockReason.reason).toBe('cap-full')
    // This is the assertion the bug breaks: looking only at readyDepsMet[0]
    // (#20, which clashes), the current code concludes `false` — but #21
    // WOULD be dispatched with one more gap of cap.
    expect(plan.blockReason.wouldDispatchIfCapAllowed).toBe(true)
    expect(plan.blockReason.blockedEvenWithCap).toBeNull()
  })

  it('cap-full with ALL the candidates really clashing → wouldDispatchIfCapAllowed stays false (negative control)', () => {
    const issues = [
      { n: 10, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 20, order: 1, status: 'ready', deps: [], touches: ['api'] }, // clashes
      { n: 21, order: 2, status: 'ready', deps: [], touches: ['api'] }, // it also clashes with #10
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.blockReason.reason).toBe('cap-full')
    expect(plan.blockReason.wouldDispatchIfCapAllowed).toBe(false)
    // The reported reason must still be the first one's (#20, lowest order) —
    // the scan does not change WHICH one is cited when they really all clash,
    // it only avoids the false negative of the case above.
    expect(plan.blockReason.blockedEvenWithCap).toEqual({
      reason: 'collision', kind: 'token', issue: 20, token: 'api', withIssue: 10, withIssueStatus: 'in-progress',
      blockers: [{ n: 10, status: 'in-progress', sharedTokens: ['api'], laneTokens: [] }], // F16/H1
    })
  })
})

// D4, defect 1: the previous version of this describe had THREE cases, all of
// them with the repo already stripped of its owner ('menoplus', 'mo.foo',
// 'otro') — that is, it tested exactly the broken model: the owner did not
// take part, so none of the three could detect that
// `mercadona/algun-tool-interno` ended up in the personal account, nor that
// the real map's 'mercadona' entry could never match. Now `resolveAccount`
// receives the COMPLETE slug and returns, besides the directory, BY WHICH rule
// it was reached.

describe('buildCmuxArgv', () => {
  it('returns argv with no shell, the prompt as a single element', () => {
    const argv = buildCmuxArgv({ name: 'r · #7 x', cwd: '/wt', command: "claude 'a b'\n#2" })
    expect(argv[0]).toBe('new-workspace')
    expect(argv).toContain('--name'); expect(argv).toContain('r · #7 x')
    expect(argv).toContain('--cwd'); expect(argv).toContain('/wt')
    expect(argv).toContain('--command')
    const ci = argv.indexOf('--command')
    expect(argv[ci + 1]).toBe("claude 'a b'\n#2") // intact, unescaped
  })

  // T10, a live finding against the sandbox: `cmux` is a client that talks to
  // an already running daemon over a Unix socket — an env var set in
  // `execFileSync('cmux', argv, {env})` dies with that client process and
  // NEVER reaches the real pty the daemon creates. Without passing
  // `--env KEY=VALUE` explicitly in the argv, CLAUDE_CONFIG_DIR does not
  // reach the session and it hangs on the interactive account selector.
  it('with no env → no --env at all in the argv (compatible with previous calls)', () => {
    const argv = buildCmuxArgv({ name: 'x', cwd: '/wt', command: 'claude' })
    expect(argv).not.toContain('--env')
  })
  it('with env → one --env KEY=VALUE per entry, BEFORE --command', () => {
    const argv = buildCmuxArgv({ name: 'x', cwd: '/wt', command: 'claude', env: { SOME_VAR: '/algun/valor' } })
    const ei = argv.indexOf('--env')
    expect(ei).toBeGreaterThan(-1)
    expect(argv[ei + 1]).toBe('SOME_VAR=/algun/valor')
    expect(argv.indexOf('--env')).toBeLessThan(argv.indexOf('--command'))
  })
  it('with several env entries → one --env for each of them', () => {
    const argv = buildCmuxArgv({ command: 'claude', env: { A: '1', B: '2' } })
    const envPairs = argv.reduce((acc, tok, i) => (tok === '--env' ? [...acc, argv[i + 1]] : acc), [])
    expect(envPairs).toEqual(['A=1', 'B=2'])
  })
})
