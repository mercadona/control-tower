import { describe, it, expect } from 'vitest'
import { JsonBody } from '../../src/infrastructure/http.ts'

class Causes {
  static readonly OVERFLOW_TYPE = 'entity.too.large'

  static raisedByAnOversizedBody(): Error {
    return Object.assign(new Error('request entity too large'), { type: Causes.OVERFLOW_TYPE })
  }

  static raisedByUnreadableJson(): Error {
    return Object.assign(new Error('unexpected token'), { type: 'entity.parse.failed' })
  }
}

describe('JsonBody.isOverflow', () => {
  it('the_cause_an_oversized_body_really_raises_is_the_one_answered_true', () => {
    expect(JsonBody.isOverflow(Causes.raisedByAnOversizedBody())).toBe(true)
  })

  it('another_failure_of_the_same_shape_is_not_mistaken_for_an_overflow', () => {
    expect(JsonBody.isOverflow(Causes.raisedByUnreadableJson())).toBe(false)
  })

  it('a_cause_carrying_no_type_at_all_answers_false_instead_of_comparing_undefined', () => {
    expect(JsonBody.isOverflow(new Error('something else failed'))).toBe(false)
    expect(JsonBody.isOverflow({})).toBe(false)
  })

  it('an_absent_cause_is_answered_instead_of_crashing_the_handler_that_asked', () => {
    expect(JsonBody.isOverflow(null)).toBe(false)
    expect(JsonBody.isOverflow(undefined)).toBe(false)
  })

  it('a_cause_that_is_not_an_object_answers_false_instead_of_throwing', () => {
    expect(JsonBody.isOverflow(Causes.OVERFLOW_TYPE)).toBe(false)
    expect(JsonBody.isOverflow(413)).toBe(false)
  })
})
