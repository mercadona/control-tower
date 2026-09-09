// The `plan` gate (F-jjponz-1, policy F-jjponz-2): new vocabulary in gates.js,
// IMPLIED BY DEFAULT in every slice. What gates.js's doctrine demands of every
// new entry is pinned down here: that it exists in the vocabulary with BOTH of
// its texts, that the default is universal (every slice carries it, whatever
// the Type may be), and that the per-row waiver (`!plan`) is a REAL waiver, not
// an inert one — with its noise, like every waiver.
import { describe, it, expect } from 'vitest'
import { GATES, TYPE_GATES, parseGateCell, resolveGates, gatesForType } from '../scripts/gates.js'

describe('the `plan` gate — vocabulary', () => {
  it('it exists with both its texts, and both say who closes it', () => {
    expect(Object.hasOwn(GATES, 'plan')).toBe(true)
    expect(GATES.plan.kickoff).toContain('PARA')
    expect(GATES.plan.kickoff).toContain('--check-plan')
    expect(GATES.plan.issue).toContain('comment')
    for (const text of [GATES.plan.kickoff, GATES.plan.issue]) {
      expect(text.toLowerCase()).toContain('human')
    }
  })

  it('it is implied in EVERY slice, whatever the Type may be — without touching TYPE_GATES', () => {
    // TYPE_GATES is still the Type→technical-gate map (ui→visual,
    // infra→apply); `plan`'s universal default lives in gatesForType.
    expect(Object.values(TYPE_GATES).flat()).not.toContain('plan')
    expect(gatesForType('backend')).toContain('plan')
    expect(gatesForType('ui')).toEqual(['visual', 'plan'])
    expect(gatesForType('')).toContain('plan')
    expect(gatesForType(undefined)).toContain('plan')
  })

  it('`!plan` is a real per-row waiver: it removes the gate and makes noise like every waiver', () => {
    const r = resolveGates('backend', '!plan')
    expect(r.gates).not.toContain('plan')
    expect(r.waived).toContain('plan')
    expect(r.inertWaivers).not.toContain('plan')
  })

  it('declaring it explicitly is redundant (harmless, and it is said)', () => {
    expect(parseGateCell('plan')).toMatchObject({ add: ['plan'], waive: [], unknown: [] })
    const r = resolveGates('backend', 'plan')
    expect(r.gates).toContain('plan')
    expect(r.redundant).toContain('plan')
  })

  it('it lives alongside the others in one cell: `visual, plan` on a ui Type', () => {
    const r = resolveGates('ui', 'visual, plan')
    expect(r.gates).toContain('visual')
    expect(r.gates).toContain('plan')
    expect(r.unknown).toEqual([])
  })
})
