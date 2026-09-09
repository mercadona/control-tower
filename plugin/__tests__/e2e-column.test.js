// ============================================================================
// The E2E column: the parser treats it as one more raw cell.
//
// Why raw and not resolved: slices.js "knows nothing about gates, just as it
// knows nothing about labels or addenda: its job is to turn a markdown table
// into reliable cells" (comment on the `gate` field). Resolving the cell's
// three states lives in gates.js#resolveE2e.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { analyzeSlicesTable } from '../scripts/slices.js'

const table = (headerExtra, rowExtra) => `
## 9. Slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |${headerExtra}
|---|-------|------|---------|-----|--------|-----------|------|------|------|${headerExtra ? '---|' : ''}
| 1 | uno | backend | algo | – | un criterio | – | core | – | – |${rowExtra}
`

describe('E2E column', () => {
  it('without an E2E column, the field arrives empty and nothing else changes', () => {
    const { slices } = analyzeSlicesTable(table('', ''))
    expect(slices).toHaveLength(1)
    expect(slices[0].e2e).toBe('')
    expect(slices[0].name).toBe('uno')
  })

  it('with an E2E column, the field carries the raw cell already trimmed', () => {
    const { slices } = analyzeSlicesTable(table(' E2E |', ' levantado con el example\\, curl -i :9115/metrics responde 200 |'))
    expect(slices[0].e2e).toBe('levantado con el example\\, curl -i :9115/metrics responde 200')
  })

  it('the `no` cell arrives literal, uninterpreted', () => {
    const { slices } = analyzeSlicesTable(table(' E2E |', ' no |'))
    expect(slices[0].e2e).toBe('no')
  })

  it('the E2E header does not collide with any of the ten existing ones', () => {
    const { slices } = analyzeSlicesTable(table(' E2E |', ' un recorrido |'))
    const s = slices[0]
    expect(s.type).toBe('backend')
    expect(s.entrega).toBe('algo')
    expect(s.ac).toEqual(['un criterio'])
    expect(s.area).toEqual(expect.arrayContaining(['core']))
    expect(s.gate).toBe('–')
    expect(s.e2e).toBe('un recorrido')
  })

  it('the absent column does NOT produce an optional-column warning', () => {
    const res = analyzeSlicesTable(table('', ''))
    expect(res.missingOptionalColumns).not.toContain('E2E')
  })

  // e2eColumnPresent: exposed because it is NOT derivable from the cells (a
  // column that is all "–" is indistinguishable from an absent column). Task 3
  // consumes it to decide whether it demands an e2e decision per row, so the
  // boolean has to be exact: `toBe`, not a "truthy" check that would let a
  // numeric index through by mistake.
  it('e2eColumnPresent is true when the E2E header is there', () => {
    const res = analyzeSlicesTable(table(' E2E |', ' un recorrido |'))
    expect(res.e2eColumnPresent).toBe(true)
  })

  it('e2eColumnPresent is false when the E2E header is not there', () => {
    const res = analyzeSlicesTable(table('', ''))
    expect(res.e2eColumnPresent).toBe(false)
  })

  it('e2eColumnPresent is false on the "no table found" path too', () => {
    const res = analyzeSlicesTable('# Un documento sin tabla §9 en absoluto\n\nsolo texto.\n')
    expect(res.tableFound).toBe(false)
    expect(res.e2eColumnPresent).toBe(false)
  })
})
