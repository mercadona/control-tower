import { describe, it, expect } from 'vitest'
import { LOOP_ARTIFACT_PATTERNS } from '../scripts/scope.js'

describe('the e2e report is a loop artifact', () => {
  it('docs/superpowers/e2e/** is exempt from the scope gate', () => {
    expect(LOOP_ARTIFACT_PATTERNS).toContain('docs/superpowers/e2e/**')
  })

  it('is a directory of its own, not the spec exemption', () => {
    // It deliberately does not go into the spec's «Registro de cierre»: that
    // exemption is documented as the hole through which, in the dispatch 1
    // incident, an agent slipped part of its forged authorisation.
    expect(LOOP_ARTIFACT_PATTERNS.filter((p) => p.includes('e2e'))).toHaveLength(1)
  })
})
