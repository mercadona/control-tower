import { describe, it, expect } from 'vitest'
import { pickCurrentIteration, hasProjectItem } from '../scripts/project-fields.js'

describe('pickCurrentIteration', () => {
  const iterations = [
    { id: 'a', title: 'Sprint 1', startDate: '2026-07-06', duration: 14 },
    { id: 'b', title: 'Sprint 2', startDate: '2026-07-20', duration: 14 },
    { id: 'c', title: 'Sprint 3', startDate: '2026-08-03', duration: 14 },
  ]

  it('picks the iteration whose range [startDate, startDate+duration) covers today', () => {
    expect(pickCurrentIteration(iterations, '2026-07-25')?.id).toBe('b')
  })

  it('the first day of an iteration counts as current (lower bound inclusive)', () => {
    expect(pickCurrentIteration(iterations, '2026-07-20')?.id).toBe('b')
  })

  it('the day startDate+duration already belongs to the next iteration (upper bound exclusive)', () => {
    expect(pickCurrentIteration(iterations, '2026-08-03')?.id).toBe('c')
    expect(pickCurrentIteration(iterations, '2026-08-02')?.id).toBe('b')
  })

  it('returns null if no iteration covers the date (gap between sprints or out of range)', () => {
    expect(pickCurrentIteration(iterations, '2026-06-01')).toBeNull()
    expect(pickCurrentIteration(iterations, '2026-09-01')).toBeNull()
  })

  it('accepts a full ISO string (with a time) and trims it to the date', () => {
    expect(pickCurrentIteration(iterations, '2026-07-25T10:08:43.000Z')?.id).toBe('b')
  })

  it('defensive: an empty or absent list returns null without blowing up', () => {
    expect(pickCurrentIteration([], '2026-07-25')).toBeNull()
    expect(pickCurrentIteration(undefined, '2026-07-25')).toBeNull()
  })

  it('does not depend on the process time zone (arithmetic in UTC days)', () => {
    // Regression: if Date#setDate were used on a Date parsed with no time,
    // in negative time zones (America/*) the calendar date would shift by a
    // day. We pin TZ and check that the result does not change.
    const prevTz = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      expect(pickCurrentIteration(iterations, '2026-07-20')?.id).toBe('b')
      expect(pickCurrentIteration(iterations, '2026-08-03')?.id).toBe('c')
    } finally {
      if (prevTz === undefined) delete process.env.TZ
      else process.env.TZ = prevTz
    }
  })
})

describe('hasProjectItem', () => {
  const items = [
    { content: { repository: 'o/r', number: 2 } },
    { content: { repository: 'o/r', number: 3 } },
    { content: { repository: 'other/repo', number: 2 } }, // same number, another repo: it must not match
  ]

  it('detects an issue already present in the project', () => {
    expect(hasProjectItem(items, 'o/r', 2)).toBe(true)
    expect(hasProjectItem(items, 'o/r', 3)).toBe(true)
  })

  it('an issue with the same number but from another repo does not count as present', () => {
    expect(hasProjectItem(items, 'other/repo', 3)).toBe(false)
  })

  it('returns false if the issue is not in the item list', () => {
    expect(hasProjectItem(items, 'o/r', 999)).toBe(false)
  })

  it('defensive: an empty/absent list or an absent content does not blow up', () => {
    expect(hasProjectItem([], 'o/r', 2)).toBe(false)
    expect(hasProjectItem(undefined, 'o/r', 2)).toBe(false)
    expect(hasProjectItem([{ content: null }], 'o/r', 2)).toBe(false)
    expect(hasProjectItem([{}], 'o/r', 2)).toBe(false)
  })
})
