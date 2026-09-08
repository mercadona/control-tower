import { describe, it, expect } from 'vitest'
import { buildIssueTitle, buildLabels, buildIssueBody, groomPlan, renderDepsContent, renderAcContent, DEPS_ORDER_NOTE, parseSignalCell, renderSignalContent, SIGNAL_HEADING } from '../scripts/groom.js'

// F3: the issue title comes from `slice.name` (the spec's "Slice" column),
// not from `slice.entrega` (the "Entrega" column) — buildIssueTitle composed
// "#N <Entrega>" while "Slice" was discarded except for its "#NN", so an
// author writing the natural thing (a short name in Slice, a description in
// Entrega) got a paragraph as the title. `entrega` is now an OPTIONAL
// description that renders in the body (see below).
const SLICE = { n: 2, issue: null, name: 'refresh token', type: 'backend', entrega: 'flujo de refresco de sesión', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }

// SPEC_REF (F10): buildIssueBody/groomPlan no longer receive `{ specPath,
// specSection }` (a path exactly as it came in argv + a section number that
// turned into a non-existent anchor), but the reference ALREADY RESOLVED by
// scripts/spec-link.js: the path relative to the repo root, the text of §9's
// real heading, and the absolute URL that was verified against GitHub.
const SPEC_REF = {
  path: 'docs/spec.md',
  heading: '9. Slices',
  url: 'https://github.com/o/r/blob/main/docs/spec.md#9-slices',
  reason: null,
}

describe('pure groom', () => {
  it('title carries order + name (the "Slice" column), not "Entrega"', () => {
    expect(buildIssueTitle(SLICE)).toBe('#2 refresh token')
  })
  // F21: the `gate:` label joins buildLabels' output. `gate:none` is the one
  // that corresponds to a `backend` slice with no `Gate` cell — see
  // gates.js#GATE_LABEL_NONE for why "no gate at all" is ASSERTED with a label
  // instead of being left in silence.
  it('labels: type + gate + status:backlog', () => {
    expect(buildLabels(SLICE)).toEqual(['type:backend', 'gate:plan', 'status:backlog'])
  })
  it('body: spec link, AC, deps as merge-after, protected', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain('[docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)')
    expect(b).toContain('AC-2.1')
    expect(b).toContain('merge-after `#1`')
    expect(b).toContain('schema §6')
  })
  // F3: "Entrega" no longer feeds the title — it becomes a description
  // section inside the body (decision: right below the spec link and BEFORE
  // "Acceptance criteria", so that whoever reads the issue knows WHAT the
  // slice delivers before reading its acceptance criteria).
  it('body: "Entrega" renders as a "## Descripción" section, before "Acceptance criteria"', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain('## Descripción')
    expect(b).toContain('flujo de refresco de sesión')
    expect(b.indexOf('## Descripción')).toBeLessThan(b.indexOf('## Acceptance criteria'))
  })
  it('body: without "Entrega" (empty/undefined) → no "Descripción" section', () => {
    const b = buildIssueBody({ ...SLICE, entrega: '' }, SPEC_REF)
    expect(b).not.toContain('## Descripción')
    const b2 = buildIssueBody({ ...SLICE, entrega: undefined }, SPEC_REF)
    expect(b2).not.toContain('## Descripción')
  })
  it.each(['-', '–', '—', '―', '−', '--'])('body: "Entrega" with a "no value" marker ("%s") → no "Descripción" section, the same criterion as "Protegido"', (marker) => {
    const b = buildIssueBody({ ...SLICE, entrega: marker }, SPEC_REF)
    expect(b).not.toContain('## Descripción')
  })
  it('body without deps → no merge-after', () => {
    const b = buildIssueBody({ ...SLICE, deps: [] }, SPEC_REF)
    expect(b).not.toContain('merge-after')
  })
  // F6, grave 1 — VERIFIED AGAINST THE REAL GITHUB (the /markdown API with
  // `context=josemerca/ct-loop-sandbox`, and the real `body_html` of issue #4
  // of that repo): a BARE `#N` in an issue's body renders as a LINK to issue N
  // of that repo as soon as that issue exists. The number groom writes here is
  // the slice's ORDER in the §9 table, not an issue number — so in a repo that
  // is up to #447, "merge-after #1" links to an old, entirely unrelated issue,
  // and whoever opens the issue reads a false dependency with no way of
  // knowing that it is one. It was checked literally in the sandbox: issue #4
  // (slice 3) has "merge-after #2" and GitHub linked it to `issues/2`, which
  // is slice 1's issue.
  //
  // The same check showed that a `#N` INSIDE inline code (`` `#2` ``) does NOT
  // autolink — hence the format.
  it('body: the dependency is emitted as inline code (`#N`), never as a bare "#N" (GitHub would autolink it to issue N)', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain('- merge-after `#1`')
    expect(b).not.toMatch(/merge-after #\d/)
  })
  it('body: the Dependencias section says explicitly that the number is a slice order, not an issue', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain(DEPS_ORDER_NOTE)
    expect(DEPS_ORDER_NOTE.toLowerCase()).toMatch(/orden/)
    expect(DEPS_ORDER_NOTE.toLowerCase()).toMatch(/issue/)
    // The note itself cannot introduce a bare "#<digits>": it would be another
    // false autolink, and on top of that `extractDepsInSection` would read it
    // as an uncovered reference (`malformed`).
    expect(DEPS_ORDER_NOTE).not.toMatch(/#\d/)
  })
  // The same false autolink lived in the FIRST line of the body: the real
  // `body_html` of the sandbox's issue #4 shows "Slice #3 del epic" with the
  // "#3" turned into a link to `issues/3` — slice 2's issue.
  it('body: the spec link cites the order as inline code, never a bare "#N"', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b.split('\n')[0]).toContain('> Slice `#2` del epic')
    expect(b).not.toMatch(/> Slice #\d/)
  })
  // renderDepsContent/renderAcContent are the ONLY source of truth for "what
  // each section should say" — shared between CREATING the issue (here) and
  // RECONCILING it later (scripts/reconcile.js#buildReconcileBody, which until
  // F6 had its own copy of the format: two implementations of the same
  // criterion that would diverge the moment either of the two changed).
  it('the created body uses exactly renderDepsContent/renderAcContent (a single source of truth with --reconcile)', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain(renderDepsContent([1]))
    expect(b).toContain(renderAcContent(['AC-2.1']))
  })
  it('groomPlan aggregates milestone + issues', () => {
    const plan = groomPlan([SLICE], { milestone: 'Epic X', specPath: 'x', specSection: '9' })
    expect(plan.milestone).toBe('Epic X')
    expect(plan.issues).toHaveLength(1)
    expect(plan.issues[0].labels).toContain('type:backend')
  })
  it('body emits the exact ct-order marker', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain('<!-- ct-order:2 -->')
  })
  it('buildIssueBody, defensively: undefined ac + deps', () => {
    const incomplete = { n: 5, type: 'frontend', entrega: 'fix', ac: undefined, deps: undefined, protected: '–' }
    const b = buildIssueBody(incomplete, SPEC_REF)
    expect(b).toContain('(rellenar desde el spec)')
    expect(b).not.toContain('merge-after')
  })
  it('buildLabels with an empty type: only status:backlog', () => {
    const empty = { n: 1, type: '', entrega: 'x', deps: [], ac: [], protected: '–' }
    expect(buildLabels(empty)).toEqual(['gate:plan', 'status:backlog'])
  })
  // F3's review, finding 1 (a bug that predated F3, closed now): `Tipo` with a
  // "no value" marker ("–", "-", "—", etc. — the same criterion Dep/Acepta/
  // Protegido/Área/Toca already use) is truthy in JS, so `if (slice.type)`
  // treated it as a real value and emitted the literal label "type:–" — which
  // `gh label create --force` would really create in the user's repo. The same
  // bug as "area:areamedicacion" through another door: a marker the contract
  // itself teaches you to use in every other column produces junk in this one.
  // The two ways of saying "none" (an empty cell, a cell with a marker) must
  // produce the SAME output.
  it.each(['-', '–', '—', '―', '−', '--'])('buildLabels with type = a "no value" marker ("%s"): no "type:" label, the same as an empty type', (marker) => {
    const s = { n: 1, type: marker, entrega: 'x', deps: [], ac: [], protected: '–' }
    expect(buildLabels(s)).toEqual(['gate:plan', 'status:backlog'])
  })
  it('buildLabels emits area:/touches: for each token, in the order type→area→touches→status', () => {
    const s = { ...SLICE, area: ['api'], touches: ['db', 'migration'] }
    expect(buildLabels(s)).toEqual(['type:backend', 'area:api', 'touches:db', 'touches:migration', 'gate:plan', 'status:backlog'])
  })
  it("buildLabels without area/touches (undefined, an old spec) produces exactly today's output", () => {
    expect(buildLabels(SLICE)).toEqual(['type:backend', 'gate:plan', 'status:backlog'])
  })
  it("buildLabels with empty area/touches ([]) produces exactly today's output", () => {
    const s = { ...SLICE, area: [], touches: [] }
    expect(buildLabels(s)).toEqual(['type:backend', 'gate:plan', 'status:backlog'])
  })
  it('groomPlan refuses duplicate slice orders, naming the duplicate ones', () => {
    const dup1 = { ...SLICE, n: 1 }
    const dup2 = { ...SLICE, n: 1 }
    expect(() => groomPlan([dup1, dup2], { milestone: 'Epic', specPath: 'x', specSection: '9' }))
      .toThrow(/1/)
  })
  it('groomPlan with unique orders still works (regression)', () => {
    const a = { ...SLICE, n: 1 }
    const b = { ...SLICE, n: 2 }
    const plan = groomPlan([a, b], { milestone: 'Epic', specPath: 'x', specSection: '9' })
    expect(plan.issues).toHaveLength(2)
  })
  // A review bug: buildIssueBody only treated the literal em dash ('–',
  // U+2013) as "no value" for Protegido — the other four variants isNoValueCell
  // accepts in EVERY other column (Dep/Acepta/Área/Toca) slipped through as if
  // they were real content, producing a junk bullet ("- 🚫 -", "- 🚫 —",
  // "- 🚫 −") in the issue's body. All five variants must produce
  // "(ninguno declarado)", just like the other columns.
  it.each(['-', '–', '—', '―', '−', '--'])('"Protegido" as "%s" (a "no value" marker) → "(ninguno declarado)", not a junk bullet', (marker) => {
    const b = buildIssueBody({ ...SLICE, protected: marker }, SPEC_REF)
    expect(b).toContain('(ninguno declarado)')
    expect(b).not.toMatch(/🚫 .*[-–—―−]\s*$/m)
  })
  it('"Protegido" with real content still emits its 🚫 bullet', () => {
    const b = buildIssueBody({ ...SLICE, protected: 'schema §6' }, SPEC_REF)
    expect(b).toContain('🚫 schema §6')
  })
  it('groomPlan names every duplicate order when there is more than one', () => {
    const s1a = { ...SLICE, n: 1 }
    const s1b = { ...SLICE, n: 1 }
    const s2 = { ...SLICE, n: 2 }
    const s3a = { ...SLICE, n: 3 }
    const s3b = { ...SLICE, n: 3 }
    let message = ''
    try {
      groomPlan([s1a, s1b, s2, s3a, s3b], { milestone: 'Epic', specPath: 'x', specSection: '9' })
    } catch (e) {
      message = e.message
    }
    expect(message).toMatch(/1/)
    expect(message).toMatch(/3/)
  })
})

// Slice 10 — parseSignalCell is THE classifier of the `Señal` cell: groom
// (validation + render), kickoff (the conditional line) and, in prose, the
// slice judge's rubric all share it. A single classifier so that "what an
// exemption is" cannot diverge between whoever validates it and whoever
// announces it. The exemption is written `N/A — <razón>` (the language the
// repo already has for "does not apply, and here is why"); an exemption
// WITHOUT a reason is an undeclared signal disguised as a decision, and it is
// told apart by its own kind.
describe('parseSignalCell / renderSignalContent — the signal and its exemption (Slice 10)', () => {
  it('a declared signal: kind senal with the text verbatim', () => {
    expect(parseSignalCell('métrica `backfill_progress` con label `estado`'))
      .toEqual({ kind: 'senal', text: 'métrica `backfill_progress` con label `estado`' })
    // Trim only — the text is neither re-rendered nor normalised.
    expect(parseSignalCell('  log de arranque  ')).toEqual({ kind: 'senal', text: 'log de arranque' })
  })
  it('N/A — <razón> is a reasoned exemption; the text travels verbatim', () => {
    expect(parseSignalCell('N/A — pantalla sin telemetría nueva que prometer'))
      .toEqual({ kind: 'exencion', text: 'N/A — pantalla sin telemetría nueva que prometer' })
    // Case-insensitive and with the language's other separators: the reason is
    // whatever is left after removing N/A and the leading separators.
    expect(parseSignalCell('n/a: refactor puro').kind).toBe('exencion')
    expect(parseSignalCell('N/A - sin efecto observable').kind).toBe('exencion')
    // The text keeps its `N/A —` inside it — the consumer (the judge) tells it
    // apart by the prefix alone, without re-parsing.
    expect(parseSignalCell('n/a: refactor puro').text).toBe('n/a: refactor puro')
  })
  it('a bare N/A (or a separator with no reason behind it) is exencion-sin-razon', () => {
    expect(parseSignalCell('N/A').kind).toBe('exencion-sin-razon')
    expect(parseSignalCell('n/a').kind).toBe('exencion-sin-razon')
    expect(parseSignalCell('N/A —').kind).toBe('exencion-sin-razon')
    expect(parseSignalCell('N/A -').kind).toBe('exencion-sin-razon')
    expect(parseSignalCell('N/A:').kind).toBe('exencion-sin-razon')
    expect(parseSignalCell('N/A —  ').kind).toBe('exencion-sin-razon')
  })
  it('an empty cell, dashes and null are ninguna — never an exemption', () => {
    expect(parseSignalCell(null).kind).toBe('ninguna')
    expect(parseSignalCell(undefined).kind).toBe('ninguna')
    expect(parseSignalCell('').kind).toBe('ninguna')
    expect(parseSignalCell('   ').kind).toBe('ninguna')
    for (const marker of ['-', '–', '—', '―', '−', '--']) {
      expect(parseSignalCell(marker).kind).toBe('ninguna')
    }
    // "N/Algo" is not the N/A family: \b demands the word boundary.
    expect(parseSignalCell('N/Algo que medir').kind).toBe('senal')
  })
  it('renderSignalContent: null when nothing is declared; verbatim text with a signal or an exemption', () => {
    expect(renderSignalContent({ ...SLICE, senal: '' })).toBe(null)
    expect(renderSignalContent({ ...SLICE, senal: '–' })).toBe(null)
    // An exemption with no reason → null: this function is pure and does not
    // throw — the wrapper (ct-groom.mjs) aborts BEFORE reaching render, with a
    // hardError.
    expect(renderSignalContent({ ...SLICE, senal: 'N/A' })).toBe(null)
    expect(renderSignalContent({ ...SLICE, senal: 'métrica x' })).toBe('métrica x')
    expect(renderSignalContent({ ...SLICE, senal: 'N/A — razón real' })).toBe('N/A — razón real')
  })
})

// Slice 10 — the `## Señal de observabilidad` section of the issue's body: it
// is emitted ONLY when there is content (a signal or an exemption, verbatim
// from the cell), after the AC and before `## Dependencias` — it closes the
// reader's "how it is verified → what must be observed" area without touching
// any of --reconcile's insertion anchors.
describe('buildIssueBody — the signal section (Slice 10)', () => {
  it('with a declared signal, "## Señal de observabilidad" goes after the AC and before "## Dependencias"', () => {
    const b = buildIssueBody({ ...SLICE, senal: 'métrica `x` con label `y`' }, SPEC_REF)
    expect(b).toContain(SIGNAL_HEADING)
    expect(b).toContain('métrica `x` con label `y`')
    expect(b.indexOf('## Acceptance criteria')).toBeLessThan(b.indexOf(SIGNAL_HEADING))
    expect(b.indexOf(SIGNAL_HEADING)).toBeLessThan(b.indexOf('## Dependencias'))
  })
  it('with nothing declared the section is not emitted', () => {
    expect(buildIssueBody(SLICE, SPEC_REF)).not.toContain(SIGNAL_HEADING)
    expect(buildIssueBody({ ...SLICE, senal: '–' }, SPEC_REF)).not.toContain(SIGNAL_HEADING)
    // The reasoned exemption IS emitted, verbatim — it is not "nothing declared".
    expect(buildIssueBody({ ...SLICE, senal: 'N/A — sin telemetría nueva' }, SPEC_REF))
      .toContain('N/A — sin telemetría nueva')
  })
  it('groomPlan carries a structured senal on every issue', () => {
    const withSignal = { ...SLICE, n: 1, senal: 'métrica x' }
    const withoutSignal = { ...SLICE, n: 2, senal: '' }
    const exempt = { ...SLICE, n: 3, senal: 'N/A — razón' }
    const plan = groomPlan([withSignal, withoutSignal, exempt], { milestone: 'Epic', specRef: SPEC_REF })
    // Alongside descripcion/protectedLine and for the same reason: reconcile
    // compares without re-parsing the body this very plan has just generated.
    expect(plan.issues[0].senal).toBe('métrica x')
    expect(plan.issues[1].senal).toBe(null)
    expect(plan.issues[2].senal).toBe('N/A — razón')
  })
})
