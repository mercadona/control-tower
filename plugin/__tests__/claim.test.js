import { describe, it, expect } from 'vitest'
import { conflictTokens, detectCollisions, claimLost } from '../scripts/claim.js'

describe('conflictTokens', () => {
  it('shares area:/touches:', () => {
    expect(conflictTokens(['area:api', 'touches:db'], ['area:api', 'touches:ui'])).toEqual(['area:api'])
  })
  it('ignores labels that are neither area nor touches', () => {
    expect(conflictTokens(['status:ready', 'type:backend'], ['status:in-progress', 'type:backend'])).toEqual([])
  })
  it('shares several area: and touches: tokens', () => {
    expect(conflictTokens(['area:api', 'touches:db'], ['area:api', 'touches:db'])).toEqual(['area:api', 'touches:db'])
  })
})

describe('detectCollisions', () => {
  it('only collides with in-progress issues that share a token', () => {
    const open = [
      { n: 10, labels: ['status:in-progress', 'touches:db'] },
      { n: 11, labels: ['status:ready', 'touches:db'] },
    ]
    const c = detectCollisions(['touches:db'], open)
    expect(c).toEqual([{ n: 10, tokens: ['touches:db'], status: 'status:in-progress' }])
  })
  it('ignores in-progress issues that share no token', () => {
    const open = [
      { n: 10, labels: ['status:in-progress', 'touches:ui'] },
      { n: 11, labels: ['status:in-progress', 'touches:db'] },
    ]
    const c = detectCollisions(['touches:db'], open)
    expect(c).toEqual([{ n: 11, tokens: ['touches:db'], status: 'status:in-progress' }])
  })
})

describe('claimLost (claim-then-verify)', () => {
  const readback = [
    { n: 7, labels: ['status:in-progress', 'touches:db'] },  // us
    { n: 5, labels: ['status:in-progress', 'touches:db'] },  // another one, lower number
  ]
  it('we lose if another in-progress with a shared token has a lower number', () => {
    expect(claimLost(readback, 7)).toBe(true)
  })
  it('we win if we are the lower one', () => {
    const rb = [
      { n: 3, labels: ['status:in-progress', 'touches:db'] },
      { n: 9, labels: ['status:in-progress', 'touches:db'] },
    ]
    expect(claimLost(rb, 3)).toBe(false)
  })
  it('with no other in-progress sharing a token → we do not lose', () => {
    expect(claimLost([{ n: 7, labels: ['status:in-progress', 'touches:db'] }], 7)).toBe(false)
  })
  it('we ignore a lower-numbered in-progress if it shares no token', () => {
    const rb = [
      { n: 7, labels: ['status:in-progress', 'touches:db'] },  // us
      { n: 5, labels: ['status:in-progress', 'touches:ui'] },  // another one, lower but with no shared token
    ]
    expect(claimLost(rb, 7)).toBe(false)
  })
  it('our issue absent from the readback → we do not lose', () => {
    const rb = [
      { n: 5, labels: ['status:in-progress', 'touches:db'] },
    ]
    expect(claimLost(rb, 7)).toBe(false)
  })
})
