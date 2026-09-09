import { describe, it, expect } from 'vitest'
import { diffIssue, formatDrift, buildReconcileBody } from '../scripts/reconcile.js'
import { groomPlan, buildIssueBody } from '../scripts/groom.js'

const SPEC_REF = { path: 'spec.md', heading: null, url: null, reason: 'sin publicar' }
const SLICE = { n: 1, name: 'login', type: 'backend', entrega: '', gate: '', deps: [], ac: ['AC-1.1'], protected: 'schema', area: [], touches: [] }

// wanted: the issue the plan says THIS slice ought to have, with whatever
// decisions it is handed (and optionally epic context / reason).
function wanted(frozenDecisions, opts = {}) {
  const plan = groomPlan([SLICE], {
    milestone: 'Epic', specRef: SPEC_REF,
    epicContext: opts.epicContext ?? null,
    frozenDecisions, frozenDecisionsReason: opts.frozenDecisionsReason ?? null,
  })
  return plan.issues[0]
}

// existingIssue: the raw shape of gh api, with whatever body it is handed.
// Labels/milestone/title traced from wanted so that only the decisions differ.
function existingIssue(body) {
  const w = wanted('- **D-1** — iOS 17.')
  return { number: 5, title: w.title, state: 'open', milestone: { title: 'Epic' }, labels: w.labels.map((name) => ({ name })), body }
}

describe('diffIssue — frozenDecisionsDiffers', () => {
  it('detects drift when the spec carries decisions and the issue does not', () => {
    const existing = existingIssue(buildIssueBody(SLICE, SPEC_REF, null, null))
    const diff = diffIssue(existing, wanted('- **D-1** — iOS 17.'), 'Epic', [])
    expect(diff.frozenDecisionsDiffers).toBe(true)
  })
  it('does not count as drift when the reason is `malformada` (unknown)', () => {
    const existing = existingIssue(buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.'))
    const diff = diffIssue(existing, wanted(null, { frozenDecisionsReason: 'malformada' }), 'Epic', [])
    expect(diff.frozenDecisionsDiffers).toBe(false)
  })
  it('is reported as a note, not as drift (it does not move the exit code)', () => {
    const existing = existingIssue(buildIssueBody(SLICE, SPEC_REF, null, null))
    const diff = diffIssue(existing, wanted('- **D-1** — iOS 17.'), 'Epic', [])
    const rep = formatDrift(diff).join('\n')
    expect(rep).toContain('note:')
    expect(rep).toContain('## Decisiones congeladas')
    expect(rep).not.toContain('drift:')
  })
})

describe('buildReconcileBody — frozen decisions', () => {
  it('inserts the section into an issue that did not have it, before the inherited context', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, null)
    const res = buildReconcileBody(existing, wanted('- **D-1** — iOS 17.'))
    expect(res.body).toContain('## Decisiones congeladas')
    expect(res.body).toContain('iOS 17')
    expect(res.body.indexOf('## Decisiones congeladas')).toBeLessThan(res.body.indexOf('## Contexto heredado'))
  })
  it('rewrites the section when the spec changes, AND ONLY it (I3.5)', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 16.')
    const res = buildReconcileBody(existing, wanted('- **D-1** — iOS 17.'))
    expect(res.body).toContain('iOS 17')
    expect(res.body).not.toContain('iOS 16')
    // "only it": everything that is NOT the decisions section stays identical.
    const strip = (b) => b.replace(/## Decisiones congeladas\n[\s\S]*?(?=\n## |\n<!-- ct-order)/, '## Decisiones congeladas\n<X>')
    expect(strip(res.body)).toBe(strip(existing))
  })
  it('withdraws the section when the spec no longer carries it', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.')
    const res = buildReconcileBody(existing, wanted(null))
    expect(res.body).not.toContain('## Decisiones congeladas')
  })
  it('does NOT withdraw the section when the reason is `malformada` (unknown)', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.')
    const res = buildReconcileBody(existing, wanted(null, { frozenDecisionsReason: 'malformada' }))
    expect(res.body).toBe(null) // nothing changed: unknown does not authorise a withdrawal
  })
  it('when inserting epic and decisions into an old issue, the order is epic → decisions → inherited', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, null)
    const res = buildReconcileBody(existing, wanted('- **D-1** — x.', { epicContext: 'contexto común' }))
    expect(res.body.indexOf('## Contexto del epic')).toBeLessThan(res.body.indexOf('## Decisiones congeladas'))
    expect(res.body.indexOf('## Decisiones congeladas')).toBeLessThan(res.body.indexOf('## Contexto heredado'))
  })
  it('it GIVES UP (marks sin-ancla) when there is neither inherited context nor AC to anchor to (I3.6)', () => {
    // A body with no "## Contexto heredado" and no "## Acceptance criteria":
    // there is nowhere to anchor the insertion. The property being pinned is
    // that the decisions are NOT written blind: 'sin-ancla' is marked. (The
    // body may change because of other reconcile blocks —here the link to the
    // spec—; what matters is that the decisions gave up instead of inventing a
    // position.)
    const withoutAnchor = 'algo de texto\n\n<!-- ct-order:1 -->'
    const res = buildReconcileBody(withoutAnchor, wanted('- **D-1** — iOS 17.'))
    expect(res.unresolvedFrozenDecisions).toBe('sin-ancla')
    expect(res.body || '').not.toContain('## Decisiones congeladas') // it was not written blind
  })
})
