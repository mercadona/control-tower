import { describe, it, expect } from 'vitest'
import { JudgeReturns } from '../scripts/judge-returns.js'
import { OUTCOMES, STEPS } from '../scripts/run-machine.js'

class TelemetryFiles {
  static of(rows) {
    return rows.map((row) => `${JSON.stringify(row)}\n`).join('')
  }

  static judge(outcome, overrides = {}) {
    return { step: STEPS.JUDGE, outcome, ruling: outcome === OUTCOMES.FAILED ? 'FAIL' : 'PASS', ...overrides }
  }

  static sliceJudge(outcome) {
    return { step: STEPS.SLICE_JUDGE, outcome, ruling: outcome === OUTCOMES.FAILED ? 'FAIL' : 'PASS' }
  }

  static discardedJudge() {
    return { step: STEPS.JUDGE, outcome: OUTCOMES.DISCARDED, why: 'the judge wrote no verdict' }
  }
}

describe('the returns to the implementer are the judge vetoes plus the corrections it ordered', () => {
  it('a_veto_and_an_ordered_correction_are_counted_apart_and_their_sum_is_the_returns', () => {
    const returns = JudgeReturns.of(TelemetryFiles.of([
      TelemetryFiles.judge(OUTCOMES.FAILED),
      TelemetryFiles.judge(OUTCOMES.CORRECTIONS_ORDERED),
      TelemetryFiles.judge(OUTCOMES.CORRECTIONS_ORDERED),
      TelemetryFiles.judge(OUTCOMES.DONE),
    ]))

    expect(returns.vetoes).toBe(1)
    expect(returns.correctionsOrdered).toBe(2)
    expect(returns.returns).toBe(3)
    expect(returns.attempts).toBe(4)
  })

  it('a_slice_judge_verdict_is_not_a_return_to_the_implementer_and_stays_out', () => {
    const returns = JudgeReturns.of(TelemetryFiles.of([
      TelemetryFiles.sliceJudge(OUTCOMES.FAILED),
      TelemetryFiles.sliceJudge(OUTCOMES.DONE),
    ]))

    expect(returns.attempts).toBe(0)
    expect(returns.vetoes).toBe(0)
    expect(returns.returns).toBe(0)
  })

  it('a_discarded_judge_attempt_never_ruled_and_is_not_in_the_denominator', () => {
    const returns = JudgeReturns.of(TelemetryFiles.of([
      TelemetryFiles.discardedJudge(),
      TelemetryFiles.judge(OUTCOMES.FAILED),
    ]))

    expect(returns.attempts).toBe(1)
    expect(returns.vetoes).toBe(1)
  })

  it('a_judge_row_with_no_outcome_is_malformed_for_this_measure_and_is_not_counted', () => {
    const returns = JudgeReturns.of(TelemetryFiles.of([
      { step: STEPS.JUDGE, ruling: 'FAIL' },
      { step: STEPS.JUDGE, outcome: 'invented' },
    ]))

    expect(returns.attempts).toBe(0)
  })

  it('a_line_that_is_not_json_does_not_take_the_good_ones_with_it', () => {
    const text = `${JSON.stringify(TelemetryFiles.judge(OUTCOMES.FAILED))}\nnot json\n[]\nnull\n`

    expect(JudgeReturns.of(text).attempts).toBe(1)
  })

  it('the_rows_of_the_other_steps_carry_no_return_however_they_ended', () => {
    const returns = JudgeReturns.of(TelemetryFiles.of([
      { step: STEPS.IMPLEMENT, outcome: OUTCOMES.DONE },
      { step: STEPS.CONTROLS, outcome: OUTCOMES.FAILED },
      { step: STEPS.RECONCILE, outcome: OUTCOMES.CORRECTIONS_ORDERED },
    ]))

    expect(returns.attempts).toBe(0)
    expect(returns.returns).toBe(0)
  })

  it('a_slice_the_judge_passed_at_the_first_go_lands_a_measured_zero_over_its_one_attempt', () => {
    const measures = JudgeReturns.of(TelemetryFiles.of([TelemetryFiles.judge(OUTCOMES.DONE)])).measures()

    expect(measures).toEqual({ judgeAttempts: 1, judgeVetoes: 0, judgeCorrectionsOrdered: 0, judgeReturns: 0 })
  })

  it('telemetry_with_no_judge_row_at_all_lands_zeros_over_zero_attempts_so_the_reader_sees_the_n', () => {
    const measures = JudgeReturns.of('').measures()

    expect(measures).toEqual({ judgeAttempts: 0, judgeVetoes: 0, judgeCorrectionsOrdered: 0, judgeReturns: 0 })
  })
})
