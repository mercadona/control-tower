import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { ImplementationProgressFailure } from '../domain/exceptions.ts'
import { ImplementationStep } from '../domain/value-objects/implementation-state.ts'

export class ActivePlanRecovery {
  constructor({
    plans, checkouts, implementationStarts, goRegistry, implementationProgress,
    sessions, reviews, pullRequestReviews, activePlans,
  }) {
    this.plans = plans
    this.checkouts = checkouts
    this.implementationStarts = implementationStarts
    this.goRegistry = goRegistry
    this.implementationProgress = implementationProgress
    this.sessions = sessions
    this.reviews = reviews
    this.pullRequestReviews = pullRequestReviews
    this.activePlans = activePlans
    this.conclusive = false
    this.recovering = null
  }

  async #workIsUnderway(watch) {
    let state
    try {
      state = await this.implementationProgress.of({
        root: new CheckoutRoot(watch.located.root), issue: watch.issue.number,
      })
    } catch (cause) {
      if (cause instanceof ImplementationProgressFailure) return false
      throw cause
    }

    return state.step !== ImplementationStep.STARTING
  }

  #rememberImplementing(watch) {
    this.activePlans.rememberImplementing(watch)
    this.pullRequestReviews.startRecovered(watch)
  }

  async recover() {
    if (this.conclusive) return null
    this.recovering = this.recovering ?? this.#recover()
    try {
      return await this.recovering
    } finally {
      this.recovering = null
    }
  }

  async #recover() {
    const found = await this.plans.inFlight()
    if (!found.wereListed) return found.reason
    for (const watch of found.watches) {
      this.checkouts.remember(new CheckoutRoot(watch.located.root))
      if (this.activePlans.find({ issue: watch.issue.number, repository: watch.repository }) !== null) continue
      if (this.implementationStarts.matches(watch)) {
        this.#rememberImplementing(watch)
        continue
      }
      if (this.goRegistry.matches(watch)) {
        if (await this.#workIsUnderway(watch)) {
          this.#rememberImplementing(watch)
        } else {
          this.activePlans.rememberUncertain(watch)
        }
        continue
      }
      this.sessions.remember(watch)
      this.reviews.startRecovered(watch)
    }
    this.conclusive = true

    return null
  }
}
