export class RetryBudget {
  readonly attempts: number
  readonly waitSeconds: number

  constructor({ attempts, waitSeconds }: { attempts: unknown, waitSeconds: unknown }) {
    if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0) {
      throw new Error(`the retries of a call are a count, got ${JSON.stringify(attempts)}`)
    }
    if (typeof waitSeconds !== 'number' || !Number.isInteger(waitSeconds) || waitSeconds < 0) {
      throw new Error(`the wait between calls is in seconds, got ${JSON.stringify(waitSeconds)}`)
    }
    this.attempts = attempts
    this.waitSeconds = waitSeconds
    Object.freeze(this)
  }
}

class RetryDecision {
  readonly retry: boolean
  readonly waitSeconds: number

  constructor({ retry, waitSeconds = 0 }: { retry: boolean, waitSeconds?: number }) {
    this.retry = retry
    this.waitSeconds = waitSeconds
    Object.freeze(this)
  }
}

export class RetryPolicy {
  readonly budget: RetryBudget

  constructor({ budget }: { budget: RetryBudget }) {
    this.budget = budget
    Object.freeze(this)
  }

  afterAFailure({ transient, safeToRepeat, attempted }: {
    transient: boolean,
    safeToRepeat: boolean,
    attempted: number,
  }): RetryDecision {
    if (!transient || !safeToRepeat || attempted >= this.budget.attempts) {
      return new RetryDecision({ retry: false })
    }

    return new RetryDecision({ retry: true, waitSeconds: this.budget.waitSeconds })
  }
}
