import { describe, it, expect } from 'vitest'
import {
  ownedLabelsOnly, diffLabels, diffDeps, diffAc, diffIssue, hasDrift, formatDrift,
  buildReconcileEditArgs, buildReconcileBody, reconcileGaps, hasReconcileGap,
} from '../scripts/reconcile.js'
import { buildIssueBody } from '../scripts/groom.js'
import { extractAc, extractDeps, extractSectionContent, extractSpecLink } from '../scripts/gh-issue-map.js'

// F5 — the groom detects divergence, not just existence. Until now,
// ct-groom.mjs only checked "is there an issue with this ct-order marker?" —
// if so, "it already exists, it is not duplicated" and that was that, without
// looking at whether the issue's title/labels/milestone/AC/deps still match
// what the spec produces TODAY.
//
// Review round 4 (the reviewer attacked its OWN scanner from round 3, not just
// the three cases it had been given):
//   1/2/3 (Critical, fence/exact-match/unbounded insertion): tests of the
//   pure parsing layer live in gh-issue-map.test.js; here Critical 3 (giving
//   up instead of growing without bound) is covered end-to-end via
//   buildReconcileBody.
//   4 (important): the link to the spec is compared ONLY by its #section
//   anchor — a difference in path notation (relative/absolute) NEVER counts
//   as divergence (it avoids the ping-pong between two invocation habits).
//   5 (important): a DUPLICATED "## Dependencias"/"## Acceptance criteria"
//   changes what the dispatcher does — it DOES count towards the exit code.
//   Duplicating Descripción/Protegido is still merely cosmetic.
//   6 (important): a "merge-after" outside the recognised section is reported
//   as a note (never as divergence: --reconcile cannot touch it safely). Until
//   the dispatch hardening (D1), the real dispatcher DID obey it even though
//   --reconcile could not apply it; D1 finding 2 unified both domains — today
//   it is inert text for both, and the note was updated to say so (see
//   reconcile.js#formatDrift).

describe('ownedLabelsOnly — the spec is only authoritative over the prefixes whose column the §9 table carries', () => {
  it('with the three prefixes active: it keeps type:/area:/touches:, discards status: and foreign labels', () => {
    const labels = ['type:backend', 'area:api', 'touches:db', 'status:in-progress', 'status:backlog', 'good first issue', 'priority:high']
    expect(ownedLabelsOnly(labels, ['type:', 'area:', 'touches:'])).toEqual(['type:backend', 'area:api', 'touches:db'])
  })
  it('empty list / undefined → []', () => {
    expect(ownedLabelsOnly([], ['type:', 'area:', 'touches:'])).toEqual([])
    expect(ownedLabelsOnly(undefined, ['type:', 'area:', 'touches:'])).toEqual([])
  })
  it('with no "area:" among the active prefixes (the Área column absent from the table): it is never reported, even if the label exists', () => {
    const labels = ['type:backend', 'area:ops']
    expect(ownedLabelsOnly(labels, ['type:', 'touches:'])).toEqual(['type:backend'])
  })
  it('with no "touches:" among the active prefixes: same thing, it is discarded', () => {
    expect(ownedLabelsOnly(['touches:db', 'type:x'], ['type:'])).toEqual(['type:x'])
  })
  it('with no "type:" among the active prefixes (the Tipo column absent): same criterion', () => {
    expect(ownedLabelsOnly(['type:backend', 'area:api'], ['area:'])).toEqual(['area:api'])
  })
})

describe('diffLabels — it only compares the active prefixes (column present in the §9 table)', () => {
  const ALL = ['type:', 'area:', 'touches:']
  it('no differences → missing and extra empty', () => {
    const d = diffLabels(['type:backend', 'area:api', 'status:in-progress'], ['type:backend', 'area:api', 'status:backlog'], ALL)
    expect(d).toEqual({ missing: [], extra: [] })
  })
  it('a label the spec asks for is missing → missing', () => {
    const d = diffLabels(['status:backlog'], ['type:backend', 'status:backlog'], ALL)
    expect(d.missing).toEqual(['type:backend'])
    expect(d.extra).toEqual([])
  })
  it('a type:/area:/touches: label the spec no longer produces is left over → extra', () => {
    const d = diffLabels(['type:ios', 'status:backlog'], ['type:backend', 'status:backlog'], ALL)
    expect(d.missing).toEqual(['type:backend'])
    expect(d.extra).toEqual(['type:ios'])
  })
  it('status:in-progress (or any status: other than backlog) never appears as extra', () => {
    const d = diffLabels(['type:backend', 'area:api', 'status:in-progress'], ['type:backend', 'area:api', 'status:backlog'], ALL)
    expect(d.extra).toEqual([])
    expect(d.missing).toEqual([])
  })
  it('a label foreign to the spec (with no type:/area:/touches: prefix) is never reported', () => {
    const d = diffLabels(['type:backend', 'good first issue', 'priority:high'], ['type:backend'], ALL)
    expect(d.extra).toEqual([])
  })
  it('with no "area:" among the active prefixes: an area: put on the issue by hand is never "extra"', () => {
    const d = diffLabels(['type:backend', 'area:ops'], ['type:backend'], ['type:', 'touches:'])
    expect(d.extra).toEqual([])
    expect(d.missing).toEqual([])
  })
})

describe('diffDeps / diffAc — structured comparison of the sections the dispatcher reads (set-based, order-independent)', () => {
  it('diffDeps: no differences → empty', () => {
    expect(diffDeps([1, 2], [2, 1])).toEqual({ missing: [], extra: [] })
  })
  it('diffDeps: a dependency the spec asks for is missing', () => {
    expect(diffDeps([1], [1, 2])).toEqual({ missing: [2], extra: [] })
  })
  it('diffDeps: a dependency the issue has and the spec no longer produces is left over', () => {
    expect(diffDeps([1, 2], [1])).toEqual({ missing: [], extra: [2] })
  })
  it('diffAc: no differences → empty', () => {
    expect(diffAc(['AC-1.1', 'AC-1.2'], ['AC-1.2', 'AC-1.1'])).toEqual({ missing: [], extra: [] })
  })
  it('diffAc: a criterion the spec asks for is missing', () => {
    expect(diffAc(['AC-1.1'], ['AC-1.1', 'AC-1.2'])).toEqual({ missing: ['AC-1.2'], extra: [] })
  })
  it('diffAc: a criterion the issue has and the spec no longer produces is left over', () => {
    expect(diffAc(['AC-1.1', 'AC-1.2'], ['AC-1.1'])).toEqual({ missing: [], extra: ['AC-1.2'] })
  })
})

// F10: today's canonical line — an absolute URL (a relative one = 404 from an
// issue's page, verified) and the anchor of the real heading
// ("## 9. Slices" -> "#9-slices", not "#9").
const SPEC_LINK = '> Slice #2 del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)'
const WANTED_ISSUE = {
  order: 2, title: '#2 refresh token', labels: ['type:backend', 'status:backlog'],
  deps: [1], ac: ['AC-2.1'], descripcion: 'flujo de refresco', protectedLine: '- 🚫 schema §6',
  specLink: SPEC_LINK,
}
const ALL_PREFIXES = ['type:', 'area:', 'touches:']

function existingWith(overrides) {
  return {
    number: 42,
    title: '#2 refresh token',
    state: 'open',
    milestone: { title: 'Epic' },
    labels: [{ name: 'type:backend' }],
    body: [
      SPEC_LINK, '',
      '## Descripción', 'flujo de refresco', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '## Dependencias', '- merge-after #1', '',
      '## Out of scope / Protected', '- 🚫 schema §6', '',
      '<!-- ct-order:2 -->',
    ].join('\n'),
    ...overrides,
  }
}

describe('diffIssue — it compares title, milestone, link-to-the-spec (anchor), labels (active prefixes), deps, ac and prose (boolean) against an existing issue', () => {
  it('everything matches → no divergence at all', () => {
    const d = diffIssue(existingWith({}), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.title).toBeNull()
    expect(d.milestone).toBeNull()
    expect(d.specLink).toBeNull()
    expect(d.labels).toEqual({ missing: [], extra: [] })
    expect(d.deps).toEqual({ missing: [], extra: [] })
    expect(d.ac).toEqual({ missing: [], extra: [] })
    expect(d.descripcionDiffers).toBe(false)
    expect(d.protectedDiffers).toBe(false)
    expect(d.closed).toBe(false)
    expect(d.duplicateSections).toEqual([])
    expect(d.duplicateMachineSections).toEqual([])
    expect(d.strayDeps).toEqual([])
  })
  // F10 inverts "important 4" of review round 4. That test demanded that two
  // notations of the SAME path did not diverge, because the line was composed
  // with `process.argv[2]` as it stood and comparing the path would have made
  // it ping-pong between two invocation habits. That premise no longer exists:
  // the path that goes into the line is the one relative to the repo root,
  // computed with git, so there are no two possible notations to reconcile —
  // and "two different paths" can now only mean what it always should have
  // meant, that the spec is in another file.
  it('a link to the spec at the SAME file and the SAME section → it does NOT diverge', () => {
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, specLink: SPEC_LINK }, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toBeNull()
  })
  it('a link to the spec at ANOTHER FILE (the spec moved) → it DOES diverge — what the anchor-only comparison did not detect', () => {
    const movedFile = '> Slice #2 del epic. Spec: [docs/viejo.md § 9. Slices](https://github.com/o/r/blob/main/docs/viejo.md#9-slices)'
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, specLink: movedFile }, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toEqual({ current: SPEC_LINK, wanted: movedFile })
  })
  it('a link to the spec with a different SECTION → it DOES diverge', () => {
    const movedSection = '> Slice #2 del epic. Spec: [docs/spec.md § 10. Riesgos](https://github.com/o/r/blob/main/docs/spec.md#10-riesgos)'
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, specLink: movedSection }, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toEqual({ current: SPEC_LINK, wanted: movedSection })
  })
  it('the RELATIVE link from before F10, still in an issue created back then → it DOES diverge (it was, and still is, a broken link)', () => {
    const preF10 = existingWith({
      body: existingWith({}).body.replace(SPEC_LINK, '> Slice #2 del epic. Spec: [docs/spec.md#9](docs/spec.md#9)'),
    })
    const d = diffIssue(preF10, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toEqual({ current: '> Slice #2 del epic. Spec: [docs/spec.md#9](docs/spec.md#9)', wanted: SPEC_LINK })
  })
  it('the link to the spec absent from the issue (a human deleted it) → current: null', () => {
    const noSpecLink = existingWith({ body: existingWith({}).body.split('\n').slice(2).join('\n') })
    const d = diffIssue(noSpecLink, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toEqual({ current: null, wanted: SPEC_LINK })
  })
  // F23: this branch is no longer exercised by any /ct-groom test — ever
  // since the pairing is scoped per epic (`partitionByEpic`), an issue that
  // `findByMarker` finds in `ct-groom.mjs` ALWAYS came from the requested
  // milestone, so `diffIssue` never receives a different milestone there. The
  // branch is still alive (other callers of `diffIssue` can reach it), so its
  // coverage moves down here, to the pure detector, instead of disappearing.
  it('a divergent milestone (issue in "Sprint 1", the spec asks for "Epic") → current/wanted', () => {
    const d = diffIssue(existingWith({ milestone: { title: 'Sprint 1' } }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.milestone).toEqual({ current: 'Sprint 1', wanted: 'Epic' })
  })
  it('divergent deps (issue with #1, the spec now also asks for #3)', () => {
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, deps: [1, 3] }, 'Epic', ALL_PREFIXES)
    expect(d.deps).toEqual({ missing: [3], extra: [] })
  })
  it('deps left over (issue with #1 and #4, the spec no longer asks for #4)', () => {
    const withExtra = existingWith({
      body: [
        SPEC_LINK, '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '- merge-after #4', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(withExtra, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.deps).toEqual({ missing: [], extra: [4] })
  })
  it('a loose "merge-after" in Descripción (outside "## Dependencias") does NOT count as a dependency — the same domain as the application', () => {
    const stray = existingWith({
      body: [
        SPEC_LINK, '',
        '## Descripción', 'menciona merge-after #9 de pasada, no es una dependencia real', '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(stray, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.deps).toEqual({ missing: [], extra: [] }) // #9 does not sneak into the comparison that decides apply/exit code
    // Important 6: but it IS warned about (a note, not divergence) — the real
    // dispatcher (mapGhIssue/extractDeps, unscoped) would obey it all the
    // same.
    expect(d.strayDeps).toEqual([9])
  })
  it('with nothing outside the section → strayDeps empty', () => {
    const d = diffIssue(existingWith({}), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.strayDeps).toEqual([])
  })
  it('divergent AC (a criterion the spec now asks for is missing)', () => {
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, ac: ['AC-2.1', 'AC-2.2'] }, 'Epic', ALL_PREFIXES)
    expect(d.ac).toEqual({ missing: ['AC-2.2'], extra: [] })
  })
  it('divergent Descripción (different content) → descripcionDiffers true, WITHOUT dumping the text into the diff', () => {
    const d = diffIssue(existingWith({ body: existingWith({}).body.replace('flujo de refresco', 'otro flujo distinto') }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.descripcionDiffers).toBe(true)
  })
  it('Descripción absent from the issue when the spec DOES ask for it → it diverges', () => {
    const withoutDescription = existingWith({
      body: [
        SPEC_LINK, '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(withoutDescription, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.descripcionDiffers).toBe(true)
  })
  it('with no Descripción on either side → it does not diverge (real silence)', () => {
    const noDescriptionBody = [
      SPEC_LINK, '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '## Dependencias', '- merge-after #1', '',
      '## Out of scope / Protected', '- 🚫 schema §6', '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const d = diffIssue(existingWith({ body: noDescriptionBody }), { ...WANTED_ISSUE, descripcion: null }, 'Epic', ALL_PREFIXES)
    expect(d.descripcionDiffers).toBe(false)
  })
  it('divergent Protegido → protectedDiffers true', () => {
    const d = diffIssue(existingWith({ body: existingWith({}).body.replace('schema §6', 'otra cosa') }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.protectedDiffers).toBe(true)
  })
  it('labels: only the active prefixes are compared (column present) — with no "area:" active, an area: put on by hand does not count', () => {
    const withAreaLabel = existingWith({ labels: [{ name: 'type:backend' }, { name: 'area:ops' }] })
    const d = diffIssue(withAreaLabel, WANTED_ISSUE, 'Epic', ['type:', 'touches:']) // "area:" outside the active prefixes
    expect(d.labels).toEqual({ missing: [], extra: [] })
  })
  it('it accepts labels as an array of strings as well as an array of {name}', () => {
    const d = diffIssue(existingWith({ labels: ['type:backend'] }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.labels).toEqual({ missing: [], extra: [] })
  })
  it('a closed issue → closed:true, alongside any other divergence', () => {
    const d = diffIssue(existingWith({ state: 'closed', title: '#2 otro título' }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.closed).toBe(true)
    expect(d.title).not.toBeNull()
  })
  // Important 5 (review round 4): a duplicated "## Dependencias"/"##
  // Acceptance criteria" changes what the dispatcher really does (it does not
  // tell "the first one" apart) — it is reported in duplicateMachineSections,
  // and hasDrift counts it.
  it('a duplicated "## Dependencias" → it appears in duplicateSections AND in duplicateMachineSections, and hasDrift counts it', () => {
    const dup = existingWith({
      body: [
        SPEC_LINK, '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## Dependencias', '- merge-after #1', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(dup, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.duplicateSections).toContain('Dependencias')
    expect(d.duplicateMachineSections).toContain('Dependencias')
    expect(hasDrift(d)).toBe(true) // it DOES count towards the exit code
  })
  it('a duplicated "## Descripción" → it appears in duplicateSections but NOT in duplicateMachineSections, and hasDrift does NOT count it', () => {
    const dup = existingWith({
      body: [
        SPEC_LINK, '',
        '## Descripción', 'flujo de refresco', '',
        '## Descripción', 'copia pegada por error', '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(dup, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.duplicateSections).toContain('Descripción')
    expect(d.duplicateMachineSections).toEqual([])
    expect(hasDrift(d)).toBe(false)
  })

  // Task 4 (review, finding 3): the logic of `e2eDiffers` had no test of its
  // own — it merely resembled, without proving it, the `descripcionDiffers`
  // already covered above. It is covered here with the SAME harness
  // (`existingWith`, `diffIssue` directly), following the exact pattern of
  // "## Descripción" (duplicated) and of the three state branches of that same
  // section (divergent, absent-when-the-spec-asks-for-it, real silence on both
  // sides) — no new harness is invented.
  it('a duplicated "## E2E" → it appears in duplicateSections but NOT in duplicateMachineSections, and hasDrift does NOT count it', () => {
    const dup = existingWith({
      body: [
        SPEC_LINK, '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## E2E', '- curl -i :9115/metrics responde 200', '',
        '## E2E', '- copia pegada por error', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(dup, { ...WANTED_ISSUE, e2eContent: '- curl -i :9115/metrics responde 200' }, 'Epic', ALL_PREFIXES)
    expect(d.duplicateSections).toContain('E2E')
    expect(d.duplicateMachineSections).toEqual([])
    expect(hasDrift(d)).toBe(false)
  })
  it('"## E2E" with content different from the spec → e2eDiffers true, and it DOES count towards hasDrift', () => {
    const withE2e = existingWith({
      body: [
        SPEC_LINK, '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## E2E', '- curl -i :9115/metrics responde 200', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(withE2e, { ...WANTED_ISSUE, e2eContent: '- otro recorrido distinto' }, 'Epic', ALL_PREFIXES)
    expect(d.e2eDiffers).toBe(true)
    // Final branch review: the opposite way round to Gates. Out of this
    // section come the runs /ct-next seeds and the ones --release demands, so
    // an issue that does not have them is a slice that does not walk through
    // what the spec asks for.
    expect(hasDrift(d)).toBe(true)
  })
  it('"## E2E" absent from the issue when the spec DOES ask for runs → e2eDiffers true', () => {
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, e2eContent: '- curl -i :9115/metrics responde 200' }, 'Epic', ALL_PREFIXES)
    expect(d.e2eDiffers).toBe(true)
  })
  it('with no "## E2E" on either side → e2eDiffers false (real agreement: this slice has no runs)', () => {
    // Unlike Gates (always emitted, so its absence ALWAYS diverges), "## E2E"
    // is only emitted with content — null on both sides is the normal case (6
    // out of every 8 rows in mo-monitoring v1), not a divergence.
    const d = diffIssue(existingWith({}), WANTED_ISSUE, 'Epic', ALL_PREFIXES) // WANTED_ISSUE carries no e2eContent
    expect(d.e2eDiffers).toBe(false)
  })
})

describe('hasDrift — title/milestone/link-to-the-spec/labels/deps/ac/machine-duplicates count; closed/prose/strayDeps NEVER', () => {
  const CLEAN = {
    order: 1, issueNumber: 1, closed: false, title: null, milestone: null, specLink: null,
    labels: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, ac: { missing: [], extra: [] },
    descripcionDiffers: false, protectedDiffers: false, e2eDiffers: false, duplicateSections: [], duplicateMachineSections: [], strayDeps: [],
  }
  it('no divergence at all → false, even when it is closed', () => {
    expect(hasDrift({ ...CLEAN, closed: true })).toBe(false)
  })
  it('deps.missing not empty → true', () => {
    expect(hasDrift({ ...CLEAN, deps: { missing: [3], extra: [] } })).toBe(true)
  })
  it('ac.extra not empty → true', () => {
    expect(hasDrift({ ...CLEAN, ac: { missing: [], extra: ['AC-9'] } })).toBe(true)
  })
  it('a divergent specLink → true', () => {
    expect(hasDrift({ ...CLEAN, specLink: { current: 'a', wanted: 'b' } })).toBe(true)
  })
  it('duplicateMachineSections not empty → true', () => {
    expect(hasDrift({ ...CLEAN, duplicateMachineSections: ['Dependencias'] })).toBe(true)
  })
  it('descripcionDiffers → it NEVER counts (it no longer anchors the exit code)', () => {
    expect(hasDrift({ ...CLEAN, descripcionDiffers: true })).toBe(false)
  })
  it('protectedDiffers → it NEVER counts', () => {
    expect(hasDrift({ ...CLEAN, protectedDiffers: true })).toBe(false)
  })
  it('duplicateSections (merely cosmetic, e.g. Descripción) → it NEVER counts', () => {
    expect(hasDrift({ ...CLEAN, duplicateSections: ['Descripción'] })).toBe(false)
  })
  it('strayDeps not empty → it NEVER counts (--reconcile cannot touch it safely)', () => {
    expect(hasDrift({ ...CLEAN, strayDeps: [9] })).toBe(false)
  })
  it('e2eDiffers → it DOES count (the run is not prose: /ct-next and --release obey it)', () => {
    expect(hasDrift({ ...CLEAN, e2eDiffers: true })).toBe(true)
  })
})

describe('formatDrift — drift: (counts) vs. note: (does not count); deps/ac/specLink/machine-duplicates show the value, prose/strayDeps/cosmetic-duplicates only the flag', () => {
  const BASE = {
    order: 2, issueNumber: 42, closed: false, title: null, milestone: null, specLink: null,
    labels: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, ac: { missing: [], extra: [] },
    descripcionDiffers: false, protectedDiffers: false, duplicateSections: [], duplicateMachineSections: [], strayDeps: [],
  }
  it('nothing to report → []', () => {
    expect(formatDrift(BASE)).toEqual([])
  })
  it('a divergent specLink → a "drift:" line with both values', () => {
    const lines = formatDrift({ ...BASE, specLink: { current: 'vieja', wanted: 'nueva' } })
    expect(lines[0]).toMatch(/^drift:/)
    expect(lines[0]).toMatch(/"vieja"/)
    expect(lines[0]).toMatch(/"nueva"/)
  })
  // F23: the same reason as the milestone test in the diffIssue describe —
  // /ct-groom can no longer produce a non-null diff.milestone (the epic-scoped
  // pairing makes it unreachable from that call-site), so formatDrift's line
  // for this branch is tested here, against the pure formatter, instead of
  // against a run of /ct-groom.
  it('a divergent milestone → a "drift:" line with both values', () => {
    const lines = formatDrift({ ...BASE, milestone: { current: 'Sprint 1', wanted: 'Epic' } })
    expect(lines[0]).toMatch(/^drift:/)
    expect(lines[0]).toMatch(/milestone differs/)
    expect(lines[0]).toMatch(/"Sprint 1"/)
    expect(lines[0]).toMatch(/"Epic"/)
  })
  // F6: the line cites the reference EXACTLY as it appears in the body the
  // spec produces today (with backticks) and says, on top of that, that the
  // number is a slice order — not an issue number. A human who reads "the
  // dependency merge-after #3 is missing" in the terminal has no way of knowing
  // which of the two ID spaces they are looking at.
  it('a missing/left-over dep → one "drift:" line for each, naming merge-after `#N` and that it is a slice order', () => {
    const lines = formatDrift({ ...BASE, deps: { missing: [3], extra: [4] } })
    expect(lines.find((l) => l.includes('merge-after `#3`'))).toMatch(/^drift:.*is missing/i)
    expect(lines.find((l) => l.includes('merge-after `#4`'))).toMatch(/^drift:.*is left over/i)
    expect(lines.every((l) => /slice order/i.test(l))).toBe(true)
    expect(lines.some((l) => /merge-after #\d/.test(l))).toBe(false) // never the bare form, which suggests an issue number
  })
  it('a missing/left-over ac → one "drift:" line for each, with the text of the criterion', () => {
    const lines = formatDrift({ ...BASE, ac: { missing: ['AC-2.2'], extra: ['AC-9.9'] } })
    expect(lines.find((l) => l.includes('AC-2.2'))).toMatch(/^drift:.*is missing/i)
    expect(lines.find((l) => l.includes('AC-9.9'))).toMatch(/^drift:.*is left over/i)
  })
  it('duplicateMachineSections (e.g. Dependencias) → a "drift:" line, not a "note:" one', () => {
    const lines = formatDrift({ ...BASE, duplicateSections: ['Dependencias'], duplicateMachineSections: ['Dependencias'] })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^drift:/)
    expect(lines[0]).toMatch(/Dependencias/)
  })
  it('a cosmetic duplicateSections (Descripción, not machine) → a "note:" line', () => {
    const lines = formatDrift({ ...BASE, duplicateSections: ['Descripción'], duplicateMachineSections: [] })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^note:/)
    expect(lines[0]).toMatch(/Descripción/)
  })
  it('divergent Descripción/Protegido (on their own, with no other divergence) → "note:" lines, mentioning the section, never the complete text', () => {
    const lines = formatDrift({ ...BASE, descripcionDiffers: true, protectedDiffers: true })
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.startsWith('note:'))).toBe(true)
    expect(lines.some((l) => l.includes('Descripción'))).toBe(true)
    expect(lines.some((l) => l.includes('Out of scope / Protected'))).toBe(true)
    for (const l of lines) expect(l.length).toBeLessThan(220) // it never dumps complete prose
  })
  it('strayDeps → one "note:" line per reference, naming the number and that the dispatcher DOES obey it', () => {
    const lines = formatDrift({ ...BASE, strayDeps: [9] })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^note:/)
    expect(lines[0]).toMatch(/merge-after #9/)
    expect(lines[0]).toMatch(/dispatcher/i)
  })
  it('a closed issue WITH something to report (prose-only included) → a final note about it being "closed"', () => {
    const lines = formatDrift({ ...BASE, closed: true, descripcionDiffers: true })
    expect(lines[lines.length - 1]).toMatch(/closed.*reconcile/is)
  })
  it('a closed issue with NOTHING to report → no closure note (closed on its own is still real silence)', () => {
    expect(formatDrift({ ...BASE, closed: true })).toEqual([])
  })
})

describe('buildReconcileEditArgs — title/milestone/labels via `gh issue edit` flags (unchanged)', () => {
  it('it combines every divergent flag field', () => {
    const d = { title: { current: 'a', wanted: 'b' }, milestone: { current: 'x', wanted: 'y' }, labels: { missing: ['type:backend'], extra: ['type:ios'] } }
    expect(buildReconcileEditArgs(d)).toEqual(['--title', 'b', '--milestone', 'y', '--add-label', 'type:backend', '--remove-label', 'type:ios'])
  })
  it('with none of that → []', () => {
    expect(buildReconcileEditArgs({ title: null, milestone: null, labels: { missing: [], extra: [] } })).toEqual([])
  })
})

describe('reconcileGaps / hasReconcileGap — real divergence that --reconcile could not apply', () => {
  const DIFF_CLEAN = { ac: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, duplicateMachineSections: [] }
  it('no ac/deps/e2e divergence → no gap, even when bodyResult marks unresolved (it should not happen, but on its own it is not enough)', () => {
    const gaps = reconcileGaps(DIFF_CLEAN, { body: null, unresolvedAc: true, unresolvedDeps: true, unresolvedE2e: 'duplicada' })
    expect(gaps).toEqual({ ac: false, deps: false, e2e: false, duplicates: false })
    expect(hasReconcileGap(gaps)).toBe(false)
  })
  // The "## E2E" section counts towards hasDrift, so giving up while writing
  // it has to count towards --reconcile's exit code too: without this, a body
  // in which the section cannot be touched safely exited 0 leaving the issue
  // without the runs the spec asks for.
  it('"## E2E" diverges AND could not be written → gap.e2e = true', () => {
    const diff = { ...DIFF_CLEAN, e2eDiffers: true }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: false, unresolvedDeps: false, unresolvedE2e: 'duplicada' })
    expect(gaps.e2e).toBe(true)
    expect(hasReconcileGap(gaps)).toBe(true)
  })
  it('"## E2E" diverges but it COULD be written → no gap', () => {
    const diff = { ...DIFF_CLEAN, e2eDiffers: true }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: false, unresolvedDeps: false, unresolvedE2e: null })
    expect(gaps.e2e).toBe(false)
    expect(hasReconcileGap(gaps)).toBe(false)
  })
  it('AC diverges AND the section could not be located → gap.ac = true', () => {
    const diff = { ac: { missing: ['AC-1.2'], extra: [] }, deps: { missing: [], extra: [] }, duplicateMachineSections: [] }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: true, unresolvedDeps: false })
    expect(gaps.ac).toBe(true)
    expect(hasReconcileGap(gaps)).toBe(true)
  })
  it('AC diverges but it COULD be applied (unresolvedAc: false) → no gap', () => {
    const diff = { ac: { missing: ['AC-1.2'], extra: [] }, deps: { missing: [], extra: [] }, duplicateMachineSections: [] }
    const gaps = reconcileGaps(diff, { body: 'algo', unresolvedAc: false, unresolvedDeps: false })
    expect(gaps.ac).toBe(false)
    expect(hasReconcileGap(gaps)).toBe(false)
  })
  // Critical 3 (review round 4): deps CAN now be left unresolved (it used to
  // be hardcoded to false) — when there is no safe anchor to insert at.
  it('deps diverges AND no safe anchor could be located → gap.deps = true', () => {
    const diff = { ac: { missing: [], extra: [] }, deps: { missing: [2], extra: [] }, duplicateMachineSections: [] }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: false, unresolvedDeps: true })
    expect(gaps.deps).toBe(true)
    expect(hasReconcileGap(gaps)).toBe(true)
  })

  // Important 3 (review round 5): "with --reconcile, the divergence
  // --reconcile cannot apply exits 0" — hasDrift counts
  // duplicateMachineSections, but before this fix reconcileGaps only looked
  // at ac/deps: a duplicate, with NO ac/deps gap at the same time (ac/deps
  // still agree on content — the duplicate is the only drift), went through
  // with hasReconcileGap false, so ct-groom.mjs (which under --reconcile uses
  // only hasReconcileGap for its exit code) exited 0 over a real divergence
  // without applying a single call to `gh`.
  it('duplicateMachineSections not empty, with no ac/deps gap at all → gap.duplicates = true all the same', () => {
    const diff = { ac: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, duplicateMachineSections: ['Dependencias'] }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: false, unresolvedDeps: false })
    expect(gaps.ac).toBe(false)
    expect(gaps.deps).toBe(false)
    expect(gaps.duplicates).toBe(true)
    expect(hasReconcileGap(gaps)).toBe(true)
  })
  it('with no duplicateMachineSections (or the field absent) → gap.duplicates = false', () => {
    expect(reconcileGaps(DIFF_CLEAN, { body: null, unresolvedAc: false, unresolvedDeps: false }).duplicates).toBe(false)
    const diffWithoutField = { ac: { missing: [], extra: [] }, deps: { missing: [], extra: [] } }
    expect(reconcileGaps(diffWithoutField, { body: null, unresolvedAc: false, unresolvedDeps: false }).duplicates).toBe(false)
  })
})

describe('buildReconcileBody — a surgical splice of link-to-the-spec/AC/Dependencias, preserving everything else', () => {
  const SLICE = { n: 2, name: 'refresh', type: 'backend', entrega: 'flujo de refresco', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }
  const SPEC_OPTS = { path: 'spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/spec.md#9-slices', reason: null }
  const GENERATED = buildIssueBody(SLICE, SPEC_OPTS)
  const WANTED_BASE = { deps: [1], ac: ['AC-2.1'], specLink: '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)' }

  it('no divergence of anything → body: null, no giving-up marked (nothing to apply)', () => {
    const r = buildReconcileBody(GENERATED, WANTED_BASE)
    expect(r).toEqual({
      body: null,
      unresolvedE2e: null,
      unresolvedAc: false,
      unresolvedDeps: false,
      unresolvedReasons: { ac: null, deps: null },
      unresolvedEpicContext: null,
      unresolvedFrozenDecisions: null,
    })
  })

  it('the same set of AC in a different order → body: null (diffAc does not consider it divergence, and buildReconcileBody does not rewrite either)', () => {
    const TWO_AC_SLICE = { ...SLICE, ac: ['AC-2.1', 'AC-2.2'] }
    const body = buildIssueBody(TWO_AC_SLICE, SPEC_OPTS)
    const r = buildReconcileBody(body, { ...WANTED_BASE, ac: ['AC-2.2', 'AC-2.1'] })
    expect(r.body).toBeNull()
  })

  it('divergent AC → it replaces ONLY the content of "## Acceptance criteria", preserving Descripción/Dependencias/Protected/marker intact', () => {
    const { body: newBody, unresolvedAc } = buildReconcileBody(GENERATED, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).not.toBeNull()
    expect(unresolvedAc).toBe(false)
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2'])
    expect(extractDeps(newBody)).toEqual([1]) // deps intact
    expect(extractSectionContent(newBody, '## Descripción')).toBe('flujo de refresco') // intact
    expect(extractSectionContent(newBody, '## Out of scope / Protected')).toBe('- 🚫 schema §6') // intact
    expect(newBody).toContain('<!-- ct-order:2 -->') // marker intact
  })

  // A body older than F26 (with no "## Contexto heredado"), which is where
  // the property below reads without noise: AC and Dependencias are
  // independent domains and one of them giving up does not block the other.
  // With the inherited section present things change, and that case has its
  // own test right below — see there for why.
  const WITHOUT_INHERITED = GENERATED.replace(/## Contexto heredado\n.*\n\n/, '')

  it('the "## Acceptance criteria" heading renamed/absent → unresolvedAc: true, NO position is invented, and the rest of the deps section CAN still be applied', () => {
    const renamed = WITHOUT_INHERITED.replace('## Acceptance criteria (EARS, 1:1 con tests)', '## Criterios')
    expect(renamed).not.toContain('## Contexto heredado') // the premise of the case, explicit
    const r = buildReconcileBody(renamed, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'], deps: [1, 3] })
    expect(r.unresolvedAc).toBe(true)
    expect(extractAc(r.body ?? renamed)).not.toEqual(['AC-2.1', 'AC-2.2']) // it was not applied
    expect(extractDeps(r.body)).toEqual([1, 3]) // but deps COULD be applied (an independent domain)
  })

  // Second wave of the final branch review. The coordinator session's
  // untouchable zone no longer ends at the first ATX heading (which may be one
  // it pasted itself) but at "## Acceptance criteria". Without that heading
  // there is no way of knowing where its own text ends, and the range extends
  // to the end of the body on purpose: of the two possible errors, the
  // expensive one is the one that deletes human text. The price, measured and
  // paid in full, is this: over a body WITH an inherited section and WITHOUT
  // an AC heading, Dependencias does not get applied either. It gives up out
  // loud, with a reason that does not talk about the inherited section (it
  // cannot be claimed that the block belongs to it) but about the missing
  // boundary.
  it('with the inherited section and with no AC heading, Dependencias does not get applied either: the coordinator zone stops having a known end', () => {
    const renamed = GENERATED.replace('## Acceptance criteria (EARS, 1:1 con tests)', '## Criterios')
    expect(renamed).toContain('## Contexto heredado') // the premise of the case
    const r = buildReconcileBody(renamed, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'], deps: [1, 3] })
    expect(r.unresolvedAc).toBe(true)
    expect(r.unresolvedDeps).toBe(true)
    expect(r.unresolvedReasons.deps).toBe('zona-sin-fin')
    expect(r.body).toBeNull() // NOTHING is written past the inherited heading
  })

  it('divergent deps (one missing) → it adds the reference, preserving AC/Descripción/Protected', () => {
    const { body: newBody } = buildReconcileBody(GENERATED, { ...WANTED_BASE, deps: [1, 3] })
    expect(extractDeps(newBody)).toEqual([1, 3])
    expect(extractAc(newBody)).toEqual(['AC-2.1'])
    expect(extractSectionContent(newBody, '## Descripción')).toBe('flujo de refresco')
  })

  it('divergent deps (one left over) → it removes it, preserving the rest', () => {
    const withTwoDeps = buildIssueBody({ ...SLICE, deps: [1, 3] }, SPEC_OPTS)
    const { body: newBody } = buildReconcileBody(withTwoDeps, { ...WANTED_BASE, deps: [1] })
    expect(extractDeps(newBody)).toEqual([1])
  })

  it('the spec stops having deps (the issue keeps them) → it withdraws the whole "## Dependencias" section', () => {
    const { body: newBody } = buildReconcileBody(GENERATED, { ...WANTED_BASE, deps: [] })
    expect(extractDeps(newBody)).toEqual([])
    expect(newBody).not.toContain('## Dependencias')
    expect(extractAc(newBody)).toEqual(['AC-2.1']) // nothing else is touched
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })

  it('the spec starts having deps (the issue had no section) → it inserts "## Dependencias" before "## Out of scope / Protected"', () => {
    const noDeps = buildIssueBody({ ...SLICE, deps: [] }, SPEC_OPTS)
    expect(noDeps).not.toContain('## Dependencias')
    const { body: newBody, unresolvedDeps } = buildReconcileBody(noDeps, { ...WANTED_BASE, deps: [5] })
    expect(unresolvedDeps).toBe(false)
    expect(extractDeps(newBody)).toEqual([5])
    expect(newBody.indexOf('## Dependencias')).toBeLessThan(newBody.indexOf('## Out of scope / Protected'))
    expect(extractSectionContent(newBody, '## Descripción')).toBe('flujo de refresco')
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })

  // Critical 3 (review round 4): with neither AC nor "## Out of scope /
  // Protected" locatable, the previous version inserted a new section BLINDLY
  // at `body.length` — without bound, on every run. Now it GIVES UP
  // (unresolvedDeps: true), just as AC already did, and it does NOT touch the
  // body.
  it('with no locatable "## Out of scope / Protected" (no safe anchor) → it GIVES UP: unresolvedDeps true, body unchanged as far as deps go', () => {
    const noProtected = '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)\n\n## Acceptance criteria (EARS, 1:1 con tests)\n- AC-2.1\n\n<!-- ct-order:2 -->'
    const r = buildReconcileBody(noProtected, { ...WANTED_BASE, deps: [5] })
    expect(r.unresolvedDeps).toBe(true)
    expect(r.body).toBeNull() // nothing else diverged (AC/specLink already matched) → null throughout
    expect(extractDeps(noProtected)).toEqual([]) // the original, verified, still had no dependency
  })

  // Exact reproduction of the reviewer's bug: an unclosed fence makes ANY
  // later heading unfindable (including "## Out of scope / Protected") —
  // before, this triggered a blind insertion on every run, growing without
  // bound (2, 3, 4 sections in 3 passes). Now, three successive calls
  // (simulating three runs of /ct-groom --reconcile) must give up ALL THREE
  // times, without ever inserting anything.
  it('an unclosed fence (the Protected anchor unfindable) → three successive "runs" give up all three times, without growing without bound', () => {
    const withUnclosedFence = [
      '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)', '',
      '## Descripción', '```', 'esta valla nunca se cierra', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    let current = withUnclosedFence
    for (let run = 0; run < 3; run++) {
      const r = buildReconcileBody(current, { ...WANTED_BASE, deps: [5] })
      expect(r.unresolvedDeps).toBe(true)
      expect(r.body).toBeNull()
      // "current" does not change between runs — there is nothing to
      // reconcile whatever we apply, so the loop converges on a stable no-op,
      // not on unbounded growth.
      current = current // eslint-disable-line no-self-assign
    }
    expect((current.match(/## Dependencias/g) || []).length).toBe(0)
  })

  it('human content in a new section ("## Notas") survives an AC reconcile intact', () => {
    const withHumanNotes = GENERATED.replace('<!-- ct-order:2 -->', '## Notas\nOjo con este slice, lo tocó Fulano.\n\n<!-- ct-order:2 -->')
    const { body: newBody } = buildReconcileBody(withHumanNotes, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).toContain('## Notas')
    expect(newBody).toContain('Ojo con este slice, lo tocó Fulano.')
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2'])
  })

  // Link to the spec: a single-line splice. F10 — it fires on ANY difference
  // in the line, not just in the anchor: the line is now canonical (it derives
  // from the repository, not from argv), so a difference can now only mean a
  // real change (another section, another file, or the broken relative link
  // from before F10).
  const OTHER_SECTION = '> Slice `#2` del epic. Spec: [spec.md § 10. Riesgos](https://github.com/o/r/blob/main/spec.md#10-riesgos)'
  it('a link to the spec with another section → the line is replaced, everything else preserved', () => {
    const { body: newBody } = buildReconcileBody(GENERATED, { ...WANTED_BASE, specLink: OTHER_SECTION })
    expect(extractSpecLink(newBody)).toBe(OTHER_SECTION)
    expect(extractAc(newBody)).toEqual(['AC-2.1'])
    expect(extractDeps(newBody)).toEqual([1])
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })
  const OTHER_FILE = '> Slice `#2` del epic. Spec: [docs/viejo.md § 9. Slices](https://github.com/o/r/blob/main/docs/viejo.md#9-slices)'
  it('a link to the spec at another file (the same section) → it is ALSO replaced — before F10 this was never touched', () => {
    const { body: newBody } = buildReconcileBody(GENERATED, { ...WANTED_BASE, specLink: OTHER_FILE })
    expect(extractSpecLink(newBody)).toBe(OTHER_FILE)
  })
  it('an identical link to the spec → it is NOT rewritten: body unchanged as far as that field goes', () => {
    const r = buildReconcileBody(GENERATED, WANTED_BASE)
    expect(r.body).toBeNull()
  })

  it('the link to the spec absent (a human deleted it) → it is prepended at the top', () => {
    const withoutSpecLink = GENERATED.split('\n').slice(2).join('\n')
    const { body: newBody } = buildReconcileBody(withoutSpecLink, WANTED_BASE)
    expect(newBody.startsWith(WANTED_BASE.specLink)).toBe(true)
  })

  it('reconciling deps with a mention of "## Dependencias" inside a fence in Descripción does not corrupt the fence', () => {
    const withFence = [
      '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)', '',
      '## Descripción', 'Ejemplo:', '```', '## Dependencias', '- merge-after #99', '```', 'fin.', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '## Dependencias', '- merge-after #1', '',
      '## Out of scope / Protected', '- 🚫 schema §6', '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const { body: newBody } = buildReconcileBody(withFence, { ...WANTED_BASE, deps: [1, 3] })
    expect(newBody).toContain('```\n## Dependencias\n- merge-after #99\n```') // the fence survives intact
    expect(newBody).toContain('fin.')
    expect(extractDeps(extractSectionContent(newBody, '## Descripción'))).toEqual([99]) // the fence was not touched
    const realDepsSection = extractSectionContent(newBody, '## Dependencias')
    expect(extractDeps(realDepsSection)).toEqual([1, 3]) // the REAL section did get updated
  })

  // Review round 5, Critical 1 — end-to-end: some OLD deps commented out
  // "while we decide with payments" must not hijack --reconcile's splice nor
  // lose their closing "-->".
  it('reconciling deps with a mention of "## Dependencias" inside a multi-line HTML comment corrupts neither the comment nor loses its closing', () => {
    const withComment = [
      '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)', '',
      '## Descripción', 'Ejemplo:', '<!--', '## Dependencias', '- merge-after #99 (pospuesto, negociado con pagos)', '-->', 'fin.', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '## Dependencias', '- merge-after #1', '',
      '## Out of scope / Protected', '- 🚫 schema §6', '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const { body: newBody } = buildReconcileBody(withComment, { ...WANTED_BASE, deps: [1, 3] })
    expect(newBody).toContain('<!--\n## Dependencias\n- merge-after #99 (pospuesto, negociado con pagos)\n-->') // the comment survives intact, WITH its closing
    expect(newBody).toContain('fin.')
    const realDepsSection = extractSectionContent(newBody, '## Dependencias')
    expect(extractDeps(realDepsSection)).toEqual([1, 3]) // the REAL section did get updated
    // No section/protected disappeared (which is what would happen if the
    // "-->" had been eaten along with everything that comes after it, up to
    // EOF).
    expect(newBody).toContain('## Out of scope / Protected')
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })

  // Review round 5, Critical 2 — end-to-end: exact reproduction of the
  // reviewer's corruption mechanism. A "### Notas de implementación" with a
  // real warning in it, written JUST BELOW the AC content (and therefore,
  // before the fix, "inside" the range --reconcile replaces when splicing AC),
  // must not be lost when AC is reconciled — the splice has to stop at that
  // heading, not at the next literal "## ".
  it('reconciling AC with a "### Notas de implementación" (a real warning) stuck right below the AC content: the splice does not swallow it', () => {
    const withSubheading = GENERATED.replace(
      '- AC-2.1\n\n## Dependencias',
      '- AC-2.1\n\n### Notas de implementación\nla dependencia la negociamos con pagos: NO tocar sin hablar con Ana\n\n## Dependencias',
    )
    const { body: newBody } = buildReconcileBody(withSubheading, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).toContain('### Notas de implementación')
    expect(newBody).toContain('NO tocar sin hablar con Ana')
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2'])
  })

  // Minor: CRLF — the final result keeps the original's line ending, without
  // mixing our LF with a human's CRLF.
  it('a body in CRLF: the reconciled result is CRLF from end to end too (no mixed endings)', () => {
    const crlfBody = GENERATED.replace(/\n/g, '\r\n')
    const { body: newBody } = buildReconcileBody(crlfBody, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).not.toBeNull()
    expect(newBody).toContain('\r\n')
    expect(newBody).not.toMatch(/[^\r]\n/) // no '\n' without its '\r' in front — never mixed
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2']) // the content is still correct after normalising/reconverting
  })
})

// ============================================================================
// The "## E2E" section under --reconcile (final branch review, Important 1).
//
// The natural adoption path of the whole feature is: an epic already groomed,
// plus the new `E2E` column in the spec, plus `--reconcile`. Until this round
// that path added the `gate:e2e` label (covered by the `gate:` prefix of
// `ownedLabelPrefixes`) and NOT the section — that is, an issue with the label
// and with no runs: /ct-next seeded `[]`, the agent walked through nothing, and
// `--release` released with a warning on stderr. The tool manufactured the very
// same divergent state that §4.6 of the design describes as "somebody edited
// the issue by hand".
//
// It IS rewritten, unlike Descripción/Protegido, because what protects those
// —a human's right to edit THEIR issue— is here exactly the opposite: §3.3
// says the run cannot be editable without going through Gate 1.
// ============================================================================
describe('buildReconcileBody — the "## E2E" section', () => {
  const SLICE = { n: 2, name: 'refresh', type: 'backend', entrega: 'flujo de refresco', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }
  const SPEC_OPTS = { path: 'spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/spec.md#9-slices', reason: null }
  const WITHOUT_E2E = buildIssueBody(SLICE, SPEC_OPTS)
  const WITH_E2E = buildIssueBody({ ...SLICE, e2e: 'curl -i :9115/metrics responde 200' }, SPEC_OPTS)
  const WANTED_BASE = { deps: [1], ac: ['AC-2.1'], specLink: '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)' }
  const JOURNEY = '- curl -i :9115/metrics responde 200'

  it('the issue does not have the section and the spec now asks for runs → it is inserted whole, right before "## Out of scope / Protected"', () => {
    const { body, unresolvedE2e } = buildReconcileBody(WITHOUT_E2E, { ...WANTED_BASE, e2eContent: JOURNEY })
    expect(unresolvedE2e).toBeNull()
    expect(extractSectionContent(body, '## E2E')).toBe(JOURNEY)
    expect(body.indexOf('## E2E')).toBeLessThan(body.indexOf('## Out of scope / Protected'))
    expect(body.indexOf('## Gates')).toBeLessThan(body.indexOf('## E2E'))
    // Nothing else has been touched: the dispatcher's marker is still there
    // and the AC have not moved.
    expect(body).toContain('<!-- ct-order:2 -->')
    expect(extractAc(body)).toEqual(['AC-2.1'])
  })

  it('the issue has something else in the section → ONLY its content is replaced', () => {
    const edited = WITH_E2E.replace(JOURNEY, '- un recorrido que alguien escribió a mano')
    const { body } = buildReconcileBody(edited, { ...WANTED_BASE, e2eContent: JOURNEY })
    expect(extractSectionContent(body, '## E2E')).toBe(JOURNEY)
    expect(body).not.toContain('un recorrido que alguien escribió a mano')
    expect(body).toContain('<!-- ct-order:2 -->')
  })

  it('the spec no longer declares runs (the cell turned to "no") → the section is withdrawn WHOLE', () => {
    const { body } = buildReconcileBody(WITH_E2E, WANTED_BASE) // with no e2eContent
    expect(body).not.toContain('## E2E')
    expect(body).toContain('## Out of scope / Protected')
    expect(body).toContain('<!-- ct-order:2 -->')
    expect(body).not.toMatch(/\n\n\n/) // the seam does not leave two blank lines
  })

  it('both sides in agreement (neither the issue nor the spec carries runs) → body: null', () => {
    expect(buildReconcileBody(WITHOUT_E2E, WANTED_BASE).body).toBeNull()
  })

  it('it has to be inserted but the "## Out of scope / Protected" anchor is not located → it gives up out loud, it does not invent a position', () => {
    const withoutAnchor = WITHOUT_E2E.replace('## Out of scope / Protected', '## Fuera de alcance (renombrada a mano)')
    const { body, unresolvedE2e } = buildReconcileBody(withoutAnchor, { ...WANTED_BASE, e2eContent: JOURNEY })
    expect(unresolvedE2e).toBe('sin-ancla')
    expect(body).toBeNull() // there was nothing else to apply, and this was not applied
  })

  it('the section appears twice → it is written in neither (one of them may be text pasted into "## Contexto heredado")', () => {
    const duplicated = WITH_E2E.replace('## Out of scope / Protected', '## E2E\n- copia pegada por error\n\n## Out of scope / Protected')
    const { unresolvedE2e } = buildReconcileBody(duplicated, { ...WANTED_BASE, e2eContent: '- otro recorrido' })
    expect(unresolvedE2e).toBe('duplicada')
  })
})

// Slice 10 — the signal in the reconciliation: a yes/no comparison as a
// `note:`, the EXACT precedent of Descripción/Protegido. The authority at
// runtime is THE ISSUE (like the gates: the signal the slice judge obeys is
// the one the issue had at dispatch time), and the splice machinery is the
// EXPERIMENTAL half that five review rounds decided not to fatten — so
// `senalDiffers` enters neither hasDrift nor reconcileGaps, and
// buildReconcileBody never writes or withdraws it.
describe('the signal in the reconciliation (Slice 10)', () => {
  const SIGNAL_SECTION = '## Señal de observabilidad'
  const bodyWithSignal = (text) =>
    existingWith({}).body.replace('## Dependencias', `${SIGNAL_SECTION}\n${text}\n\n## Dependencias`)

  it('senalDiffers: agreement when neither of the two sides has the section', () => {
    // WANTED_ISSUE carries no `senal` (→ null) and existingWith's body does
    // not carry the section either: real silence on both sides, never
    // divergence — the same null/null agreement as descripcionDiffers.
    const d = diffIssue(existingWith({}), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.senalDiffers).toBe(false)
  })

  it('senalDiffers: one side with the section and the other without it differs; different text differs', () => {
    // Issue with the section, spec with no signal → it differs.
    const withSection = existingWith({ body: bodyWithSignal('métrica x') })
    expect(diffIssue(withSection, WANTED_ISSUE, 'Epic', ALL_PREFIXES).senalDiffers).toBe(true)
    // Issue with no section, spec with a signal → it differs.
    expect(diffIssue(existingWith({}), { ...WANTED_ISSUE, senal: 'métrica x' }, 'Epic', ALL_PREFIXES).senalDiffers).toBe(true)
    // Both with text, different → it differs; equal (modulo trim) → agreement.
    expect(diffIssue(withSection, { ...WANTED_ISSUE, senal: 'métrica y' }, 'Epic', ALL_PREFIXES).senalDiffers).toBe(true)
    expect(diffIssue(withSection, { ...WANTED_ISSUE, senal: '  métrica x  ' }, 'Epic', ALL_PREFIXES).senalDiffers).toBe(false)
  })

  it('the signal divergence comes out as note: and counts neither towards hasDrift nor towards reconcileGaps', () => {
    // The only divergence of the diff is the signal: everything else matches.
    const d = diffIssue(existingWith({ body: bodyWithSignal('métrica x') }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.senalDiffers).toBe(true)
    expect(hasDrift(d)).toBe(false)
    const lines = formatDrift(d)
    // This fixture (with no "## Gates" section) also drags along the gates
    // note, pre-existing and orthogonal — what gets nailed down here is that
    // the signal comes out as note: (verbatim) and that NO line is a
    // drift:.
    expect(lines).toContain('note: slice #2 (issue #42): the "## Señal de observabilidad" section differs from the spec (it does not count towards the exit code; --reconcile does not rewrite it — the signal the slice judge obeys is the one the issue carried at dispatch, the same as the gates)')
    expect(lines.every((l) => l.startsWith('note:'))).toBe(true)
    const gaps = reconcileGaps(d, { body: null, unresolvedAc: false, unresolvedDeps: false })
    // `e2e: false` entered reconcileGaps' shape with the E2E column (which IS
    // rewritten and DOES count towards the exit code): here only the signal
    // diverges, so none of the four boxes lights up.
    expect(gaps).toEqual({ ac: false, deps: false, e2e: false, duplicates: false })
    expect(hasReconcileGap(gaps)).toBe(false)
  })

  it('buildReconcileBody neither writes nor withdraws the signal section even when it diverges', () => {
    const SLICE_S = { n: 2, name: 'refresh', type: 'backend', entrega: 'flujo de refresco', deps: [1], ac: ['AC-2.1'], protected: 'schema §6', senal: 'métrica `x` con label `y`' }
    const SPEC_OPTS = { path: 'spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/spec.md#9-slices', reason: null }
    const WANTED = { deps: [1], ac: ['AC-2.1'], specLink: '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)' }
    // Case A: the body DOES have the section, the spec no longer declares a
    // signal, and there is a real AC divergence that forces a splice — the
    // section survives verbatim into the rewritten body.
    const generated = buildIssueBody(SLICE_S, SPEC_OPTS)
    const rA = buildReconcileBody(generated, { ...WANTED, ac: ['AC-2.1', 'AC-2.2'] })
    expect(rA.body).not.toBeNull()
    expect(extractSectionContent(rA.body, SIGNAL_SECTION)).toBe('métrica `x` con label `y`')
    // Case B: the body does NOT have the section and the spec does declare a
    // signal — the AC splice does not insert it.
    const withoutSignal = buildIssueBody({ ...SLICE_S, senal: '' }, SPEC_OPTS)
    const rB = buildReconcileBody(withoutSignal, { ...WANTED, ac: ['AC-2.1', 'AC-2.2'], senal: 'métrica nueva' })
    expect(rB.body).not.toBeNull()
    expect(rB.body).not.toContain(SIGNAL_SECTION)
  })
})
