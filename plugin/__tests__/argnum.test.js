// D4, defect 2: `parseInt(x, 10)` is a TOLERANT parser — it returns a number
// DIFFERENT from the one the user wrote, silently. These cases are exactly
// the ones that used to slip through: every one of the `toBe(null)` below
// returned a number with `parseInt`, and that number decided how many agents
// were launched (`--cap`) or which issue was claimed (`dispatch-check
// <issue#>`).
import { describe, it, expect } from 'vitest'
import { parseStrictInt } from '../scripts/argnum.js'

describe('parseStrictInt', () => {
  it('accepts integers written in plain decimal digits', () => {
    expect(parseStrictInt('1')).toBe(1)
    expect(parseStrictInt('1000')).toBe(1000)
    expect(parseStrictInt('0')).toBe(0)
    expect(parseStrictInt('007')).toBe(7) // leading zeros: the value does NOT diverge
  })

  // D5, finding I: D4 accepted the sign on purpose ("+2" is faithfully 2, it
  // does not diverge from the value written). But the THREE call sites
  // promise, in the text of their own error, "dígitos decimales a secas" /
  // "dígitos a secas" — and "+2" is not that. The message asserted one rule
  // and the code applied another; the sign is rejected so that they agree.
  // Verified against the unfixed code: these two `toBe(null)` gave 2 and -3.
  it('rejects the explicit sign, even though the value did not diverge (the error message promises "a secas")', () => {
    expect(parseStrictInt('+2')).toBe(null)
    expect(parseStrictInt('-3')).toBe(null)
    expect(parseStrictInt('+0')).toBe(null)
    expect(parseStrictInt('-0')).toBe(null)
  })

  // The contrast with parseInt is the test: what follows is NOT a list of
  // theoretical oddities, it is what parseInt turned into a plausible number.
  const silentlyWrong = {
    '1e3': 1, // the user asked for 1000 and got 1
    '3perros': 3,
    '2.9': 2,
    ' 3': 3,
    '42x': 42, // dispatch-check: it claimed issue 42 without anyone naming it
  }
  for (const [raw, whatParseIntGave] of Object.entries(silentlyWrong)) {
    it(`rejects ${JSON.stringify(raw)} (parseInt silently gave ${whatParseIntGave})`, () => {
      expect(parseInt(raw, 10)).toBe(whatParseIntGave) // the bug, pinned as evidence
      expect(parseStrictInt(raw)).toBe(null)
    })
  }

  it('rejects shapes Number() would accept while changing the value non-obviously', () => {
    expect(parseStrictInt('0x10')).toBe(null) // Number → 16
    expect(parseStrictInt('')).toBe(null) // Number → 0
    expect(parseStrictInt('  ')).toBe(null) // Number → 0
    expect(parseStrictInt('1_000')).toBe(null)
    expect(parseStrictInt('Infinity')).toBe(null)
  })

  it('rejects an integer outside the safe range (it would round to another number)', () => {
    expect(parseStrictInt('99999999999999999999')).toBe(null)
  })

  it('rejects what is not a string (e.g. the `true` of a flag with no value)', () => {
    expect(parseStrictInt(true)).toBe(null)
    expect(parseStrictInt(undefined)).toBe(null)
    expect(parseStrictInt(7)).toBe(null)
  })
})
