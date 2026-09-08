// HARVEST of the dependent variables of the pre-registration (§6 of the F32
// handoff): ready→claim, claim→release, release→merge, reopens, requeues,
// blocked episodes, PR size and review comments.
//
// THE RULE THAT GOVERNS THIS WHOLE FILE: the measure is HARVESTED, not
// captured. Zero new manual fields. Everything here comes out of the timeline
// GitHub already writes on its own every time the loop moves a label. The one
// manual field of the measure —the minutes of human intervention— lives in the
// epic's outcome and does NOT come in here, on purpose: the moment a harvester
// admits one field by hand, it turns into a form and dies the way
// docs/medicion-slices.md died.
//
// It was written AFTER dispatch 1, not before, and that shows in the decisions:
// the three below exist because the first harvest (done by hand over menoplus's
// epic #602, 2026-08-12/13) ran into them. Not one of them was deduced.
//
// This module is PURE: it touches neither network nor disk. The IO lives in
// ct-harvest.mjs. It is the same separation as gh-issue-map.js/loop-issues.js
// and for the same reason (being able to test the logic against real timelines
// without a network).

// The loop's ladder, in order. The index IS the rung: going backwards along it
// is what this module calls a requeue.
//
// `blocked` is NOT in the list, and that is deliberate: entering blocked is not
// going backwards, it is stepping off the ladder. Mixing it with the requeues
// would lump together two phenomena that §6 asks about separately.
export const STATUS_LADDER = ['backlog', 'ready', 'in-progress', 'in-review']

const STATUS_PREFIX = 'status:'

// DECISION 1, the one that saves the most data: the ladder is derived ONLY
// from the `labeled` events.
//
// Measured in dispatch 1: the pair (unlabeled of the old status, labeled of the
// new one) arrives TIED TO THE SECOND and the order between the two is NOT
// stable across issues. In #659 the `labeled status:ready` precedes the
// `unlabeled status:backlog`; in #660, minutes later and through the same API,
// the order is the opposite. A harvester that read the `unlabeled` events to
// decide "which status am I leaving" would derive different states for two
// issues that had nothing different happen to them: pure noise injected into
// the dependent variable.
//
// With `labeled` alone, the tie stops mattering: each rung is marked by its
// entry, which is a single event with no partner.
export function statusTransitions(events) {
  return (events || [])
    .filter((e) => e && e.event === 'labeled' && typeof e.label?.name === 'string' && e.label.name.startsWith(STATUS_PREFIX))
    .map((e) => ({ at: e.created_at, status: e.label.name.slice(STATUS_PREFIX.length) }))
    // The API returns them in chronological order, but sorting is cheap and not
    // depending on it prevents a future pagination, or a `--slurp` that
    // concatenates pages backwards, from silently producing NEGATIVE durations.
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

// First entry into a rung. The FIRST, not the last: if a slice goes back to
// `in-progress` after a review, the claim→release phase of the original cycle
// is still the one that runs from its first claim to its first release. Going
// backwards is counted separately, in countRequeues, instead of deforming the
// duration.
function firstAt(transiciones, status) {
  const t = transiciones.find((x) => x.status === status)
  return t ? t.at : null
}

function segundosEntre(desde, hasta) {
  if (!desde || !hasta) return null
  const d = Date.parse(desde)
  const h = Date.parse(hasta)
  if (Number.isNaN(d) || Number.isNaN(h)) return null
  return Math.round((h - d) / 1000)
}

// The three phases of §6, in seconds.
//
// DECISION 2: a phase that did not happen is worth `null`, NEVER 0. A slice
// that never reached `in-review` did not take zero seconds to get there: it did
// not get there. Emitting 0 would put a false datum into the denominator of any
// later mean, and with a small N —which is all this measure is ever going to
// have— an invented zero moves the mean more than the real datum it replaces.
//
// DECISION 3: `release→merge` prefers the PR's merge and, failing that, falls
// back to the closing of the issue, DECLARING it in `mergeSource`. In this loop
// the kickoff's `Closes` ties the two events together (they land seconds apart),
// but they are not the same thing: an issue can be closed by hand with no merge.
// Whoever reads the row has to be able to tell the measure from its substitute —
// provenance is never implicit, which is the same rule §4.2 imposes on
// decisions.
export function phaseDurations(transiciones, { mergedAt = null, closedAt = null } = {}) {
  const ready = firstAt(transiciones, 'ready')
  const claim = firstAt(transiciones, 'in-progress')
  const release = firstAt(transiciones, 'in-review')

  const fin = mergedAt || closedAt || null
  const mergeSource = mergedAt ? 'pr-merged' : (closedAt ? 'issue-closed' : null)

  return {
    readyToClaim: segundosEntre(ready, claim),
    claimToRelease: segundosEntre(claim, release),
    releaseToMerge: segundosEntre(release, fin),
    mergeSource: release && fin ? mergeSource : null,
  }
}

// A requeue is one rung backwards: `in-review` → `in-progress` (the review sent
// the slice back) or `in-progress` → `ready` (someone released the claim).
//
// The states off the ladder (today only `blocked`) do not take part: they
// neither count as going backwards when entered, nor is the rung that was
// stepped back from lost. That is why the "last rung seen" is only updated with
// states that ARE on the ladder.
export function countRequeues(transiciones) {
  let ultimo = -1
  let n = 0
  for (const t of transiciones) {
    const i = STATUS_LADDER.indexOf(t.status)
    if (i === -1) continue
    if (ultimo !== -1 && i < ultimo) n += 1
    ultimo = i
  }
  return n
}

// Reopens: an issue event, not a label one. It goes separately from the
// requeues because it answers a different question of §6 (number 2: does the
// spec reduce the ambiguity or displace it?) and aggregating them would hide
// which of the two moved.
export function countReopens(events) {
  return (events || []).filter((e) => e && e.event === 'reopened').length
}

// Episodes of `status:blocked` — the edge back (A3 of the handoff).
//
// THIS is the only place in the module where the `unlabeled` events ARE read,
// and it is not an exception to decision 1 but its other face: the ladder is a
// state machine where each `labeled` marks the entry into a rung and the
// `unlabeled` is redundant; blocked is an INTERVAL, and the end of an interval
// is marked only by the removal of the label. One ignores it because it is
// superfluous; the other needs it because it is its only source.
//
// An episode that is still open is emitted with `to`/`seconds` at null instead
// of being omitted: a slice that is blocked RIGHT NOW is exactly the one to
// look at.
export function blockedEpisodes(events) {
  const episodios = []
  const ordenados = (events || [])
    .filter((e) => e && e.label?.name === 'status:blocked' && (e.event === 'labeled' || e.event === 'unlabeled'))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))

  let abierto = null
  for (const e of ordenados) {
    if (e.event === 'labeled') {
      // A `labeled` on an already open episode does not open another: GitHub
      // does not relabel what is already labelled, so if one shows up it is an
      // API duplicate and counting it would inflate the episodes.
      if (!abierto) abierto = { from: e.created_at, to: null, seconds: null }
    } else if (abierto) {
      abierto.to = e.created_at
      abierto.seconds = segundosEntre(abierto.from, e.created_at)
      episodios.push(abierto)
      abierto = null
    }
  }
  if (abierto) episodios.push(abierto)
  return episodios
}

// `1m03`, `52m42`, `2h06m17`, `9h41m23` — the exact form in which dispatch 1's
// outcome was written down, so that the harvested table and the hand-written one
// can be compared without translating anything.
//
// The minute is always printed, even below 60s (`0m14`): without it the column
// stops lining up and the eye compares badly, which is half of what a table
// exists for.
export function formatDuration(segundos) {
  if (segundos === null || segundos === undefined) return '—'
  const s = Math.max(0, Math.round(segundos))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const dosCifras = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}h${dosCifras(m)}m${dosCifras(sec)}` : `${m}m${dosCifras(sec)}`
}

// Which PR closed the issue. It is NOT deduced from the timeline: it is asked
// for.
//
// The first version of /ct-harvest deduced it —it scanned the
// `cross-referenced` events and kept the last merged PR— and against the real
// epic #602 it tied issue #659 to PR #665 and #660 to #666, when the right ones
// were #663 and #665. The cause is structural, not an oversight: every PR of a
// slice cites the previous slice, so the old issue accumulates references from
// LATER PRs and "the last merged one" rewards exactly the wrong ones. The table
// came out green and with the PR sizes swapped around.
//
// GitHub publishes `closedByPullRequestsReferences` precisely for this. It is
// read as it comes and nothing is guessed.
//
// ALL the references from the repo itself are returned, not one: two PRs
// closing the same issue is an anomaly, and the caller has to be able to say it
// out loud instead of picking in silence and losing the finding.
export function closingPrNumbers(issue, repo) {
  const refs = issue?.closedByPullRequestsReferences || []
  return refs
    .filter((r) => {
      if (!r || typeof r.number !== 'number') return false
      // With no repo declared in the reference, it is accepted: that is the
      // normal case within the same repository in some API responses.
      const owner = r.repository?.owner?.login
      const name = r.repository?.name
      if (!owner || !name) return true
      return `${owner}/${name}` === repo
    })
    .map((r) => r.number)
}

function labelValue(labels, prefijo) {
  const l = (labels || []).find((x) => typeof x?.name === 'string' && x.name.startsWith(prefijo))
  return l ? l.name.slice(prefijo.length) : null
}

// The whole row of a slice, ready for a table or a CSV.
//
// `type` and `gate` travel in the row because the honesty rules of §6 force
// reporting BY FAMILY and never aggregated. If the family does not travel with
// the datum, the dishonest aggregate is the path of least resistance for
// whoever reads the harvest — and it is exactly the mistake (POSTCONDBENCH's FDR
// 0,08–0,31) that rule exists to avoid.
//
// An issue with no `type:` label emits `type: null`, not an invented family and
// not the empty string: a row with no family has to be visibly unclassifiable,
// not sneak into a bucket.
export function harvestSlice({ events, issue, pr }) {
  const transiciones = statusTransitions(events)
  const fases = phaseDurations(transiciones, { mergedAt: pr?.mergedAt || null, closedAt: issue?.closedAt || null })

  return {
    issue: issue?.number ?? null,
    title: issue?.title ?? null,
    milestone: issue?.milestone?.title ?? null,
    type: labelValue(issue?.labels, 'type:'),
    gate: labelValue(issue?.labels, 'gate:'),
    area: labelValue(issue?.labels, 'area:'),

    readyToClaim: fases.readyToClaim,
    claimToRelease: fases.claimToRelease,
    releaseToMerge: fases.releaseToMerge,
    mergeSource: fases.mergeSource,

    reopens: countReopens(events),
    requeues: countRequeues(transiciones),
    blocked: blockedEpisodes(events),

    pr: pr?.number ?? null,
    additions: pr?.additions ?? null,
    deletions: pr?.deletions ?? null,
    changedFiles: pr?.changedFiles ?? null,
    reviews: pr?.reviews ?? null,
    reviewComments: pr?.reviewComments ?? null,
  }
}
