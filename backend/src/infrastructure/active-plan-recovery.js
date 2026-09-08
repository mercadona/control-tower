import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'
import { ImplementationProgressFailure } from '../domain/exceptions.js'
import { ImplementationStep } from '../domain/value-objects/implementation-state.js'

export class ActivePlanRecovery {
  constructor({
    plans, implementationStarts, goRegistry, implementationProgress,
    sessions, reviews, pullRequestReviews, activePlans,
  }) {
    this.plans = plans
    this.implementationStarts = implementationStarts
    this.goRegistry = goRegistry
    this.implementationProgress = implementationProgress
    this.sessions = sessions
    this.reviews = reviews
    this.pullRequestReviews = pullRequestReviews
    this.activePlans = activePlans
    this.conclusive = false
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
    if (this.conclusive) return true
    const watches = await this.plans.inFlight()
    if (watches === null) return false
    for (const watch of watches) {
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

    return true
  }
}
