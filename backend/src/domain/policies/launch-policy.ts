export type LaunchStepValue = 'keep-probing' | 'resend-the-line' | 'give-up'

export class LaunchStep {
  static readonly KEEP_PROBING = 'keep-probing'
  static readonly RESEND_THE_LINE = 'resend-the-line'
  static readonly GIVE_UP = 'give-up'

  static declared(): LaunchStepValue[] {
    return Object.values(LaunchStep)
  }
}

export class LaunchBudget {
  readonly attempts: number
  readonly resends: number

  constructor({ attempts, resends }: { attempts: unknown, resends: unknown }) {
    if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 1) {
      throw new Error(`the probes of one send are a count of at least one, got ${JSON.stringify(attempts)}`)
    }
    if (typeof resends !== 'number' || !Number.isInteger(resends) || resends < 0) {
      throw new Error(`the resends of a launch are a count, got ${JSON.stringify(resends)}`)
    }
    this.attempts = attempts
    this.resends = resends
    Object.freeze(this)
  }

  get probes(): number {
    return this.attempts * (this.resends + 1)
  }
}

export class LaunchPolicy {
  readonly budget: LaunchBudget

  constructor({ budget }: { budget: LaunchBudget }) {
    this.budget = budget
    Object.freeze(this)
  }

  afterProbing(probes: unknown): LaunchStepValue {
    if (typeof probes !== 'number' || !Number.isInteger(probes) || probes < 1 || probes > this.budget.probes) {
      throw new Error(
        `a launch is probed from one up to ${this.budget.probes} times, got ${JSON.stringify(probes)}`
      )
    }
    if (probes % this.budget.attempts !== 0) return LaunchStep.KEEP_PROBING
    if (probes === this.budget.probes) return LaunchStep.GIVE_UP

    return LaunchStep.RESEND_THE_LINE
  }
}
