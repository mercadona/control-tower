import { OUTCOMES, STEPS } from './run-machine.js'
import { TelemetryLines } from './telemetry-lines.js'

export class JudgeReturns {
  static RULED = Object.freeze([OUTCOMES.DONE, OUTCOMES.FAILED, OUTCOMES.CORRECTIONS_ORDERED])

  constructor({ attempts, vetoes, correctionsOrdered }) {
    this.attempts = attempts
    this.vetoes = vetoes
    this.correctionsOrdered = correctionsOrdered
    Object.freeze(this)
  }

  get returns() {
    return this.vetoes + this.correctionsOrdered
  }

  static of(text) {
    let attempts = 0
    let vetoes = 0
    let correctionsOrdered = 0
    for (const row of TelemetryLines.objectsOf(text)) {
      if (row.step !== STEPS.JUDGE) continue
      if (!JudgeReturns.RULED.includes(row.outcome)) continue
      attempts += 1
      if (row.outcome === OUTCOMES.FAILED) vetoes += 1
      if (row.outcome === OUTCOMES.CORRECTIONS_ORDERED) correctionsOrdered += 1
    }
    return new JudgeReturns({ attempts, vetoes, correctionsOrdered })
  }

  measures() {
    return {
      judgeAttempts: this.attempts,
      judgeVetoes: this.vetoes,
      judgeCorrectionsOrdered: this.correctionsOrdered,
      judgeReturns: this.returns,
    }
  }

  static NO_COUNTS = Object.freeze({
    judgeAttempts: null, judgeVetoes: null, judgeCorrectionsOrdered: null, judgeReturns: null,
  })
}
