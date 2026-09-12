// The `plan` gate (F-jjponz-1, policy F-jjponz-2, retired by D-14): new
// vocabulary in gates.js. It USED TO be implied by default in every slice; D-14
// removes only that default, keeping the gate itself in the vocabulary with
// both its texts, exactly like `visual` and `apply`. What gates.js's doctrine
// demands of every entry is pinned down here: that it exists in the vocabulary
// with BOTH of its texts, that no `Tipo` implies it any more (a row asks for it
// by writing `plan` in its `Gate` column), and that the per-row waiver
// (`!plan`) is now an INERT one — there is nothing left to remove — with the
// same noise as every waiver.
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

  it('it is implied in NO slice: a row that wants it writes it in its Gate column', () => {
    // TYPE_GATES is still the Type→technical-gate map (ui→visual,
    // infra→apply); D-14 removes `plan`'s universal default from
    // gatesForType and does not touch TYPE_GATES.
    expect(Object.values(TYPE_GATES).flat()).not.toContain('plan')
    expect(gatesForType('backend')).toEqual([])
    expect(gatesForType('')).toEqual([])
    expect(gatesForType(undefined)).toEqual([])
    expect(gatesForType('ui')).toEqual(['visual'])
    expect(resolveGates('backend', 'plan').gates).toContain('plan')
  })

  it('`!plan` on a row is now an inert waiver, and it is said out loud', () => {
    const r = resolveGates('backend', '!plan')
    expect(r.gates).not.toContain('plan')
    expect(r.waived).not.toContain('plan')
    expect(r.inertWaivers).toContain('plan')
  })

  it('declaring it explicitly still applies it, and it is no longer redundant: no `Tipo` implies it any more', () => {
    expect(parseGateCell('plan')).toMatchObject({ add: ['plan'], waive: [], unknown: [] })
    const r = resolveGates('backend', 'plan')
    expect(r.gates).toContain('plan')
    expect(r.added).toContain('plan')
    expect(r.redundant).not.toContain('plan')
  })

  it('it lives alongside the others in one cell: `visual, plan` on a ui Type', () => {
    const r = resolveGates('ui', 'visual, plan')
    expect(r.gates).toContain('visual')
    expect(r.gates).toContain('plan')
    expect(r.unknown).toEqual([])
  })
})
