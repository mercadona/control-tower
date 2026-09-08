import { describe, it, expect } from 'vitest'
import { readFrozenDecisions, FROZEN_DECISIONS_HEADING, buildIssueBody, groomPlan } from '../scripts/groom.js'
import { extractOrder, extractAc, extractDepsInSection, extractStrayDeps } from '../scripts/gh-issue-map.js'
import { renderKickoff } from '../scripts/kickoff.js'

const SLICE = { n: 1, name: 'login', type: 'backend', entrega: '', gate: '', deps: [], ac: ['AC-1.1'], protected: '', area: [], touches: [] }
const SPEC_REF = { path: 'spec.md', heading: null, url: null, reason: 'sin publicar' }

// LITERAL format of _TEMPLATE-execution-spec.md, verified against
// docs/loop/loop.body.html: the user's quote goes INSIDE the parentheses.
const SPEC = `# Epic

## Decisiones congeladas
- **D-1 · versión mínima** — iOS 17. *(Procedencia: hablada — «lo dijo el PO».)*
- **D-2 · nombre** — se llama Pilares. *(Procedencia: deducida de D-1.)*

## 9. Slices
`

describe('readFrozenDecisions', () => {
  it('projects the section with the provenance stripped from every line', () => {
    const { content } = readFrozenDecisions(SPEC)
    expect(content).toBe('- **D-1 · versión mínima** — iOS 17.\n- **D-2 · nombre** — se llama Pilares.')
  })
  it('spec with no section → content null and reason `ausente`', () => {
    const r = readFrozenDecisions('# Epic\n\nnada\n')
    expect(r.content).toBe(null)
    expect(r.reason).toBe('ausente')
  })
  it('section present but empty → content null and reason `vacia`', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n\n## 9. Slices\n')
    expect(r.content).toBe(null)
    expect(r.reason).toBe('vacia')
  })
  it('a ### heading inside truncates it → content null, reason `malformada` AND the warning names the line (I3.2)', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n- **D-1** — algo.\n### sub\nmás\n')
    expect(r.content).toBe(null)
    expect(r.reason).toBe('malformada')
    expect(r.warnings.join('\n')).toContain('### sub') // the warning names the offending line, not just the reason
  })
  // B2 — OBSERVABLE cleanup failure: a suffix the regex does not match (here,
  // the underscore italics) does NOT travel in silence: the section is
  // projected, but with a warning naming the line where "Procedencia" survives.
  it('unrecognised suffix → it is projected WITH a warning (no silent failure)', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n- **D-1** — iOS 17. _(Procedencia: hablada.)_\n\n## 9. Slices\n')
    expect(r.content).toContain('iOS 17')
    expect(r.warnings.join('\n')).toMatch(/Procedencia/)
    expect(r.warnings.join('\n')).toContain('- **D-1** — iOS 17.') // it names the line
  })
  it('the heading is exported with the correct literal', () => {
    expect(FROZEN_DECISIONS_HEADING).toBe('## Decisiones congeladas')
  })
  // DeepSeek #1 — data loss: a line with TWO markers must not delete the text
  // between them. ONLY the trailing suffix is trimmed; the inner marker
  // survives and B2 warns about it (it is not a silent failure).
  it('line with two markers → trims only the last one, loses no text, and warns', () => {
    const spec = '## Decisiones congeladas\n- **D-1** — iOS 17 (fijada *(Procedencia: anterior)*) y re-confirmada *(Procedencia: hablada.)*\n\n## 9. Slices\n'
    const r = readFrozenDecisions(spec)
    expect(r.content).toContain('y re-confirmada') // the text in between is NOT lost
    expect(r.content).not.toContain('hablada.)*')  // the trailing suffix IS trimmed
    expect(r.warnings.join('\n')).toMatch(/Procedencia/) // the surviving inner marker is warned about
  })
  // DeepSeek #2 — false positive: the word "Procedencia" in prose, with no
  // marker, is NOT a cleanup failure and must not warn.
  it('the word "Procedencia" in prose (with no marker) does not fire a warning', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n- **D-1** — revisar la Procedencia en el acta.\n\n## 9. Slices\n')
    expect(r.content).toContain('revisar la Procedencia en el acta.')
    expect(r.warnings).toEqual([]) // no marker, no warning
  })
})

describe('buildIssueBody — frozen decisions', () => {
  it('emits the section when there is content', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.')
    expect(body).toContain('## Decisiones congeladas')
    expect(body).toContain('- **D-1** — iOS 17.')
  })
  it('does not emit the section when there is no content', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, null)
    expect(body).not.toContain('## Decisiones congeladas')
  })
  it('places the decisions after the epic context and before the inherited one', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, 'contexto común', '- **D-1** — x.')
    expect(body.indexOf('## Contexto del epic')).toBeLessThan(body.indexOf('## Decisiones congeladas'))
    expect(body.indexOf('## Decisiones congeladas')).toBeLessThan(body.indexOf('## Contexto heredado'))
  })
})

describe('groomPlan — the frozen decisions travel in the plan', () => {
  it('every issue carries frozenDecisions and frozenDecisionsUnknown', () => {
    const plan = groomPlan([SLICE], { milestone: 'Epic', specRef: SPEC_REF, frozenDecisions: '- **D-1** — iOS 17.' })
    expect(plan.issues[0].frozenDecisions).toBe('- **D-1** — iOS 17.')
    expect(plan.issues[0].frozenDecisionsUnknown).toBe(false)
    expect(plan.issues[0].body).toContain('## Decisiones congeladas')
  })
  it('reason `malformada` → frozenDecisionsUnknown true (it is not "it has none")', () => {
    const plan = groomPlan([SLICE], { milestone: 'Epic', specRef: SPEC_REF, frozenDecisions: null, frozenDecisionsReason: 'malformada' })
    expect(plan.issues[0].frozenDecisionsUnknown).toBe(true)
  })
})

describe('buildIssueBody — decisions with hostile content do not break the extractors (I2/P1)', () => {
  // The prose plants THE WORST case for each extractor: a ct-order with its
  // "-->" closer (which a lax regex would match), a merge-after, an AC and a
  // closes.
  const HOSTILE = '- **D-1** — respeta el marcador ct-order:99 -->, no toques merge-after #7, mira AC-1.1 y closes #3.'
  it('extractOrder returns the slice REAL order, not the ct-order:99 --> from the prose (P1)', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, HOSTILE) // SLICE.n === 1
    expect(extractOrder(body)).toBe(1) // only matches the trailing LINE "<!-- ct-order:1 -->"; NOT the 99 with --> from the prose
  })
  it('extractAc does not swallow the AC-1.1 planted in the prose of the decision', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, HOSTILE)
    expect(extractAc(body)).toEqual(SLICE.ac) // it reads the AC section, not the decisions one
  })
  it('extractDepsInSection reads ONLY "## Dependencias", oblivious to the merge-after in the prose', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, HOSTILE)
    expect(extractDepsInSection(body).deps).toEqual([]) // returns {deps, malformed}; SLICE has no deps and the hostile #7 lives outside that section
  })
  it('extractStrayDeps DOES pick up the merge-after #7 from the prose — known and accepted noise, not a fault', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, HOSTILE)
    // Documents the limitation honestly (spec §7): a merge-after in prose
    // produces a stray dep. It does NOT move the exit code (it is a note, not
    // a machine divergence). What is pinned here is the REAL behaviour, not an
    // aspirational one.
    expect(extractStrayDeps(body, [])).toContain(7)
  })
})

describe('kickoff — frozen decisions (B1)', () => {
  const slice = { n: 2, name: 'scoring', type: 'backend', deps: [1], ac: ['AC'], gate: '', protected: '' }
  // `conventionsDir` is MANDATORY ever since ct dictates the yardstick
  // (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md §7):
  // `renderKickoff` throws if it does not get it, because a kickoff without the
  // path to ct's yardstick leaves whoever plans writing a plan that the judge
  // is going to block, and losing that in silence was the failure that guard
  // closes. These three tests are on ANOTHER axis —that the kickoff names the
  // frozen decisions section, its input phrase and its destination in the
  // plan— and they still measure exactly that: the argument is passed so that
  // they can reach what they assert, just like the rest of this function's
  // callers.
  const OPTS = { repo: 'o/r', conventionsDir: '/plugin/conventions' }
  // renderKickoff returns the kickoff text as a single string.
  it('names the section using the CONSTANT, not a literal (I3.9)', () => {
    expect(renderKickoff(slice, OPTS)).toContain(FROZEN_DECISIONS_HEADING)
  })
  it('lists it as an input of the plan (same phrase as AC/Protegido)', () => {
    const inputLine = renderKickoff(slice, OPTS).split('\n').find((l) => l.includes('entrada que la skill pide'))
    expect(inputLine).toBeDefined()
    expect(inputLine).toContain(FROZEN_DECISIONS_HEADING)
  })
  it('names the destination ## 2. Closed decisions', () => {
    expect(renderKickoff(slice, OPTS)).toContain('## 2. Closed decisions')
  })
})
