import { describe, it, expect } from 'vitest'
import { statusTransitions, phaseDurations, countRequeues, countReopens, blockedEpisodes, formatDuration, harvestSlice, closingPrNumbers, STATUS_LADDER } from '../scripts/harvest.js'

// FIXTURES OF THE REAL DISPATCH 1 (menoplus-app/menoplus, epic #602,
// 2026-08-12/13). They are not invented: they are the timeline `gh api
// .../timeline` returned for the four slices, trimmed to the fields this module
// looks at. They are used exactly as they came because the first harvest by hand
// found TWO shapes in them that a pretty fixture would not have had — the
// tied-to-the-second pair with an unstable order (see below) and the 9h41 visual
// gate —, and losing those shapes by idealising the fixture is exactly how a
// harvester passes the test and lies about real data.

// Slice 1 (#659). Look at 17:45:15: the `labeled status:ready` arrives BEFORE
// the `unlabeled status:backlog` that accompanies it.
const SLICE_1 = [
  { created_at: '2026-08-12T17:29:12Z', event: 'labeled', label: { name: 'area:proceso' } },
  { created_at: '2026-08-12T17:29:12Z', event: 'labeled', label: { name: 'touches:ci' } },
  { created_at: '2026-08-12T17:29:12Z', event: 'labeled', label: { name: 'status:backlog' } },
  { created_at: '2026-08-12T17:29:12Z', event: 'labeled', label: { name: 'type:infra' } },
  { created_at: '2026-08-12T17:29:13Z', event: 'labeled', label: { name: 'gate:apply' } },
  { created_at: '2026-08-12T17:45:15Z', event: 'labeled', label: { name: 'status:ready' } },
  { created_at: '2026-08-12T17:45:15Z', event: 'unlabeled', label: { name: 'status:backlog' } },
  { created_at: '2026-08-12T17:46:18Z', event: 'labeled', label: { name: 'status:in-progress' } },
  { created_at: '2026-08-12T17:46:18Z', event: 'unlabeled', label: { name: 'status:ready' } },
  { created_at: '2026-08-12T18:39:00Z', event: 'unlabeled', label: { name: 'status:in-progress' } },
  { created_at: '2026-08-12T18:39:00Z', event: 'labeled', label: { name: 'status:in-review' } },
  { created_at: '2026-08-12T18:45:58Z', event: 'closed', actor: { login: 'josemerca' } },
]

// Slice 2 (#660). SAME second, OPPOSITE ORDER: here the `unlabeled
// status:backlog` arrives BEFORE the `labeled status:ready`. Both timelines came
// out of the same API minutes apart. It is the reason the ladder is derived ONLY
// from the `labeled` events.
const SLICE_2 = [
  { created_at: '2026-08-12T17:29:15Z', event: 'labeled', label: { name: 'status:backlog' } },
  { created_at: '2026-08-12T19:12:36Z', event: 'unlabeled', label: { name: 'status:backlog' } },
  { created_at: '2026-08-12T19:12:36Z', event: 'labeled', label: { name: 'status:ready' } },
  { created_at: '2026-08-12T19:13:02Z', event: 'unlabeled', label: { name: 'status:ready' } },
  { created_at: '2026-08-12T19:13:02Z', event: 'labeled', label: { name: 'status:in-progress' } },
  { created_at: '2026-08-12T21:19:19Z', event: 'labeled', label: { name: 'status:in-review' } },
  { created_at: '2026-08-12T21:19:19Z', event: 'unlabeled', label: { name: 'status:in-progress' } },
  { created_at: '2026-08-12T21:30:32Z', event: 'closed', actor: { login: 'josemerca' } },
]

describe('statusTransitions — the ladder is derived from the `labeled` events, never from the `unlabeled` ones', () => {
  it('ignores the status `unlabeled` events: keeping them would duplicate every rung', () => {
    expect(statusTransitions(SLICE_1).map((t) => t.status)).toEqual(['backlog', 'ready', 'in-progress', 'in-review'])
  })

  // THIS is the test that justifies the design decision. The two real timelines
  // bring the pair (old unlabeled, new labeled) in the SAME second and in the
  // OPPOSITE order to each other. A harvester that read `unlabeled` to decide
  // "which status am I leaving" would derive a different status for each issue
  // without anything different having happened: pure noise in the dependent
  // variable.
  it('the unlabeled/labeled pair tied to the second gives the same result in both observed orders', () => {
    const desde1 = statusTransitions(SLICE_1).map((t) => t.status)
    const desde2 = statusTransitions(SLICE_2).map((t) => t.status)
    expect(desde1).toEqual(desde2)
  })

  it('ignores labels that are not status: (area:, type:, gate:, touches:)', () => {
    const soloStatus = statusTransitions(SLICE_1).every((t) => STATUS_LADDER.includes(t.status) || t.status === 'blocked')
    expect(soloStatus).toBe(true)
  })

  it('returns the rungs sorted by time even if the API hands them over unsorted', () => {
    const revuelto = [...SLICE_1].reverse()
    expect(statusTransitions(revuelto).map((t) => t.status)).toEqual(['backlog', 'ready', 'in-progress', 'in-review'])
  })

  it('an empty timeline → no rungs, not a throw', () => {
    expect(statusTransitions([])).toEqual([])
  })
})

describe('phaseDurations — the three phases of §6, in seconds', () => {
  it('slice 1: ready→claim 1m03, claim→release 52m42, release→merge 6m56', () => {
    const d = phaseDurations(statusTransitions(SLICE_1), { mergedAt: '2026-08-12T18:45:56Z' })
    expect(d.readyToClaim).toBe(63)
    expect(d.claimToRelease).toBe(3162)
    expect(d.releaseToMerge).toBe(416)
  })

  it('slice 2: the 26s claim and the 2h06 of work', () => {
    const d = phaseDurations(statusTransitions(SLICE_2), { mergedAt: '2026-08-12T21:30:31Z' })
    expect(d.readyToClaim).toBe(26)
    expect(d.claimToRelease).toBe(7577)
  })

  // The distinction that matters most in the whole module. A slice that never
  // reached `in-review` did NOT take 0 seconds to get there: it did not get
  // there. Emitting 0 would put a false datum into the denominator of any later
  // mean — and §6 says the measure is harvested, not invented.
  it('a phase that did not happen is null, NEVER 0', () => {
    const enVuelo = SLICE_1.filter((e) => e.label?.name !== 'status:in-review')
    const d = phaseDurations(statusTransitions(enVuelo), { mergedAt: null })
    expect(d.claimToRelease).toBeNull()
    expect(d.releaseToMerge).toBeNull()
    expect(d.readyToClaim).toBe(63)
  })

  // The visual gate of slice 3: 9h41m23 between `in-review` and the merge, which
  // is not machine time but Jose asleep. It is harvested unadorned; interpreting
  // it belongs to the outcome, not to the script.
  it('release→merge accepts enormous values without clipping them (overnight visual gate: 9h41m23)', () => {
    const t = [
      { created_at: '2026-08-12T21:31:31Z', event: 'labeled', label: { name: 'status:ready' } },
      { created_at: '2026-08-12T21:31:51Z', event: 'labeled', label: { name: 'status:in-progress' } },
      { created_at: '2026-08-12T22:55:27Z', event: 'labeled', label: { name: 'status:in-review' } },
    ]
    const d = phaseDurations(statusTransitions(t), { mergedAt: '2026-08-13T08:36:50Z' })
    expect(d.releaseToMerge).toBe(34883)
  })

  // With no merged PR there is no `mergedAt`. The closing of the issue is the
  // reasonable substitute (in this loop the kickoff's `Closes` ties them
  // together), but it is NOT the same thing and whoever reads the row has to be
  // able to tell the difference.
  it('with no mergedAt it falls back to the closing of the issue and DECLARES it in mergeSource', () => {
    const d = phaseDurations(statusTransitions(SLICE_1), { mergedAt: null, closedAt: '2026-08-12T18:45:58Z' })
    expect(d.releaseToMerge).toBe(418)
    expect(d.mergeSource).toBe('issue-closed')
  })

  it('with a mergedAt, mergeSource says so too — provenance is never implicit', () => {
    const d = phaseDurations(statusTransitions(SLICE_1), { mergedAt: '2026-08-12T18:45:56Z' })
    expect(d.mergeSource).toBe('pr-merged')
  })

  it('neither mergedAt nor closedAt → releaseToMerge null and mergeSource null', () => {
    const d = phaseDurations(statusTransitions(SLICE_1), {})
    expect(d.releaseToMerge).toBeNull()
    expect(d.mergeSource).toBeNull()
  })
})

describe('countRequeues — one rung backwards on the ladder', () => {
  it('the whole of dispatch 1: zero requeues across the four slices', () => {
    expect(countRequeues(statusTransitions(SLICE_1))).toBe(0)
    expect(countRequeues(statusTransitions(SLICE_2))).toBe(0)
  })

  it('in-review → in-progress counts as 1 (the slice sent back by the review)', () => {
    const t = [...SLICE_1, { created_at: '2026-08-12T19:00:00Z', event: 'labeled', label: { name: 'status:in-progress' } }]
    expect(countRequeues(statusTransitions(t))).toBe(1)
  })

  it('in-progress → ready counts too (the released claim)', () => {
    const t = [...SLICE_2, { created_at: '2026-08-12T22:00:00Z', event: 'labeled', label: { name: 'status:ready' } }]
    expect(countRequeues(statusTransitions(t))).toBe(1)
  })

  // `blocked` does not live on the ladder: entering blocked is not going
  // backwards, it is stepping off. Counting it as a requeue would mix two
  // phenomena that §6 asks about separately (question 3: reopens/blocked).
  it('passing through blocked does NOT count as a requeue', () => {
    const t = [
      { created_at: '2026-08-12T17:45:15Z', event: 'labeled', label: { name: 'status:ready' } },
      { created_at: '2026-08-12T17:46:18Z', event: 'labeled', label: { name: 'status:in-progress' } },
      { created_at: '2026-08-12T18:00:00Z', event: 'labeled', label: { name: 'status:blocked' } },
      { created_at: '2026-08-12T19:00:00Z', event: 'labeled', label: { name: 'status:in-progress' } },
    ]
    expect(countRequeues(statusTransitions(t))).toBe(0)
  })
})

describe('countReopens', () => {
  it('dispatch 1: zero', () => {
    expect(countReopens(SLICE_1)).toBe(0)
  })
  it('counts the `reopened` events, which belong to the issue and not to a label', () => {
    expect(countReopens([...SLICE_1, { created_at: '2026-08-13T09:00:00Z', event: 'reopened', actor: { login: 'josemerca' } }])).toBe(1)
  })
})

describe('blockedEpisodes — the ONLY place where the `unlabeled` events are read', () => {
  // Deliberate coherence, not an exception: the ladder is a state machine (each
  // `labeled` marks the entry into a rung and the `unlabeled` is redundant),
  // whereas blocked is an INTERVAL whose end is marked only by the removal of
  // the label. That is why one ignores it and the other needs it.
  it('dispatch 1: no episode at all across the four slices — A3 with no evidence', () => {
    expect(blockedEpisodes(SLICE_1)).toEqual([])
  })

  it('a closed episode brings a start, an end and a duration', () => {
    const t = [
      { created_at: '2026-08-12T18:00:00Z', event: 'labeled', label: { name: 'status:blocked' } },
      { created_at: '2026-08-12T19:30:00Z', event: 'unlabeled', label: { name: 'status:blocked' } },
    ]
    expect(blockedEpisodes(t)).toEqual([{ from: '2026-08-12T18:00:00Z', to: '2026-08-12T19:30:00Z', seconds: 5400 }])
  })

  // A blocked that is still open is the case that matters MOST to see — it is a
  // slice stopped right now. Emitting it with seconds:null and to:null makes it
  // visible; omitting it would hide it exactly when it hurts.
  it('an episode that is still open is emitted with to and seconds at null, it is not omitted', () => {
    const t = [{ created_at: '2026-08-12T18:00:00Z', event: 'labeled', label: { name: 'status:blocked' } }]
    expect(blockedEpisodes(t)).toEqual([{ from: '2026-08-12T18:00:00Z', to: null, seconds: null }])
  })

  it('two separate episodes are two, not one long one', () => {
    const t = [
      { created_at: '2026-08-12T18:00:00Z', event: 'labeled', label: { name: 'status:blocked' } },
      { created_at: '2026-08-12T18:30:00Z', event: 'unlabeled', label: { name: 'status:blocked' } },
      { created_at: '2026-08-12T20:00:00Z', event: 'labeled', label: { name: 'status:blocked' } },
      { created_at: '2026-08-12T20:15:00Z', event: 'unlabeled', label: { name: 'status:blocked' } },
    ]
    expect(blockedEpisodes(t)).toHaveLength(2)
  })
})

describe('formatDuration — the form in which the outcome of dispatch 1 was written down', () => {
  it('63 → 1m03', () => expect(formatDuration(63)).toBe('1m03'))
  it('3162 → 52m42', () => expect(formatDuration(3162)).toBe('52m42'))
  it('7577 → 2h06m17', () => expect(formatDuration(7577)).toBe('2h06m17'))
  it('34883 → 9h41m23', () => expect(formatDuration(34883)).toBe('9h41m23'))
  it('14 → 0m14, with the minute explicit so that the column lines up', () => expect(formatDuration(14)).toBe('0m14'))
  // null is not 0 here either: the row has to be able to say «it did not happen».
  it('null → «—», never «0m00»', () => expect(formatDuration(null)).toBe('—'))
})

describe('closingPrNumbers — which PR closed the issue is told by GitHub, not by a heuristic', () => {
  // THIS TEST EXISTS BECAUSE OF A MEASURED BUG, not out of caution. The first
  // version of /ct-harvest resolved the PR by scanning the timeline's
  // `cross-referenced` events and keeping the last merged one. Run against the
  // real epic #602 it gave: #659→PR #665 and #660→PR #666, when the right ones
  // were #663 and #665. The cause: an issue accumulates references from LATER
  // PRs that simply MENTION it (the next slice's PR cites the previous one), and
  // "the last merged one" rewards precisely those. The harvest came out green
  // and lied — which is the failure mode this whole command exists in order not
  // to have.
  //
  // The right answer is not deduced: it is asked for. GitHub maintains
  // `closedByPullRequestsReferences` precisely for this.
  it('reads the field GitHub publishes, with no recency heuristic', () => {
    const issue = { number: 659, closedByPullRequestsReferences: [{ number: 663, repository: { name: 'menoplus', owner: { login: 'menoplus-app' } } }] }
    expect(closingPrNumbers(issue, 'menoplus-app/menoplus')).toEqual([663])
  })

  it('an issue with no PR closing it (closed by hand, or in flight) → empty list, not null', () => {
    expect(closingPrNumbers({ number: 1, closedByPullRequestsReferences: [] }, 'o/r')).toEqual([])
    expect(closingPrNumbers({ number: 1 }, 'o/r')).toEqual([])
  })

  // A PR from ANOTHER repo can close an issue of this one. Counting it here
  // would bring sizes and reviews from a different repo into a table that claims
  // to be about this one.
  it('discards references from another repository', () => {
    const issue = { number: 1, closedByPullRequestsReferences: [
      { number: 99, repository: { name: 'otro', owner: { login: 'menoplus-app' } } },
      { number: 663, repository: { name: 'menoplus', owner: { login: 'menoplus-app' } } },
    ] }
    expect(closingPrNumbers(issue, 'menoplus-app/menoplus')).toEqual([663])
  })

  // Two PRs closing one and the same issue is rare and it is a signal: both are
  // returned so that the caller can say it out loud, instead of picking one in
  // silence and losing the finding.
  it('several PRs closing the same issue are ALL returned — it is an anomaly that has to be seen', () => {
    const issue = { number: 1, closedByPullRequestsReferences: [
      { number: 10, repository: { name: 'r', owner: { login: 'o' } } },
      { number: 11, repository: { name: 'r', owner: { login: 'o' } } },
    ] }
    expect(closingPrNumbers(issue, 'o/r')).toEqual([10, 11])
  })
})

describe('harvestSlice — the whole row, exactly as it came out by hand in the outcome', () => {
  const ISSUE_1 = {
    number: 659,
    title: '#1 Encender, medir y vigilar',
    closedAt: '2026-08-12T18:45:58Z',
    labels: [{ name: 'area:proceso' }, { name: 'touches:ci' }, { name: 'type:infra' }, { name: 'gate:apply' }, { name: 'status:in-review' }],
    milestone: { title: 'V1 · M7.5 — Guardarraíles de ortografía española' },
  }
  const PR_1 = { number: 663, mergedAt: '2026-08-12T18:45:56Z', additions: 876, deletions: 67, changedFiles: 4, reviews: 0, reviewComments: 0 }

  it('reproduces the row of slice 1 without a single manual field', () => {
    const fila = harvestSlice({ events: SLICE_1, issue: ISSUE_1, pr: PR_1 })
    expect(fila.issue).toBe(659)
    expect(fila.type).toBe('infra')
    expect(fila.gate).toBe('apply')
    expect(fila.readyToClaim).toBe(63)
    expect(fila.claimToRelease).toBe(3162)
    expect(fila.releaseToMerge).toBe(416)
    expect(fila.mergeSource).toBe('pr-merged')
    expect(fila.reopens).toBe(0)
    expect(fila.requeues).toBe(0)
    expect(fila.blocked).toEqual([])
    expect(fila.pr).toBe(663)
    expect(fila.additions).toBe(876)
    expect(fila.changedFiles).toBe(4)
  })

  // The `Tipo` is the unit of reporting the honesty rules of §6 demand
  // («report by family, never aggregated»). If it does not travel in the row,
  // the dishonest aggregate is the path of least resistance for whoever reads
  // it.
  it('emits `type` and `gate` because §6 forces reporting by family', () => {
    const fila = harvestSlice({ events: SLICE_1, issue: ISSUE_1, pr: PR_1 })
    expect(fila).toHaveProperty('type')
    expect(fila).toHaveProperty('gate')
  })

  it('with no PR (a slice in flight) the row comes out all the same, with the gaps at null', () => {
    const fila = harvestSlice({ events: SLICE_1, issue: { ...ISSUE_1, closedAt: null }, pr: null })
    expect(fila.pr).toBeNull()
    expect(fila.additions).toBeNull()
    expect(fila.releaseToMerge).toBeNull()
    expect(fila.claimToRelease).toBe(3162)
  })

  it('an issue with no type: label does not invent a family', () => {
    const fila = harvestSlice({ events: SLICE_1, issue: { ...ISSUE_1, labels: [{ name: 'status:in-review' }] }, pr: PR_1 })
    expect(fila.type).toBeNull()
    expect(fila.gate).toBeNull()
  })
})
