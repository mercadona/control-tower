import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { ImplementationProgressFailure } from '../domain/exceptions.ts'
import { ImplementationStep } from '../domain/value-objects/implementation-state.ts'
import { ActivePlanPhase } from './active-plans-route.js'

export class ActivePlanRecovery {
  constructor({
    plans, checkouts, implementationStarts, goRegistry, implementationProgress,
    sessions, reviews, pullRequestReviews, activePlans, now, freshnessMs,
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
    this.now = now
    this.freshnessMs = freshnessMs
    this.lastRecoveredAt = null
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
    if (this.recovering !== null) return this.recovering
    if (this.lastRecoveredAt !== null && this.now() - this.lastRecoveredAt < this.freshnessMs) return null
    this.recovering = this.#recover().finally(() => {
      this.recovering = null
    })
    return this.recovering
  }

  async #recover() {
    const captured = this.activePlans.snapshot()
    const found = await this.plans.inFlight([...captured.values()].map((entry) => entry.watch))
    if (!found.wereListed) return found.reason
    const staged = new Map()
    for (const watch of found.watches) {
      const key = ActivePlanRecovery.#keyFor(watch)
      staged.set(key, { watch, phase: await this.#phaseOf(watch, captured.get(key)) })
    }
    for (const [key, entry] of captured) {
      if (!staged.has(key)) this.#forget(entry)
    }
    for (const [key, entry] of staged) this.#apply(entry, captured.get(key))
    this.lastRecoveredAt = this.now()

    return null
  }

  static #keyFor(watch) {
    return `${watch.repository.text}#${watch.issue.number}`
  }

  static #sameSession(first, second) {
    return first.agent === second.agent && first.located.root === second.located.root &&
      first.located.path === second.located.path && first.located.branch === second.located.branch
  }

  async #phaseOf(watch, captured) {
    const previous = captured !== undefined && ActivePlanRecovery.#sameSession(watch, captured.watch)
      ? captured.phase : null
    if (previous === ActivePlanPhase.IMPLEMENTING || this.implementationStarts.matches(watch)) {
      return ActivePlanPhase.IMPLEMENTING
    }
    if (previous === ActivePlanPhase.UNCERTAIN || this.goRegistry.matches(watch)) {
      return await this.#workIsUnderway(watch) ? ActivePlanPhase.IMPLEMENTING : ActivePlanPhase.UNCERTAIN
    }
    return ActivePlanPhase.PLANNING
  }

  #forget(captured) {
    if (!this.activePlans.forgetIfUnchanged(captured)) return false
    const subject = { issue: captured.watch.issue.number, repository: captured.watch.repository }
    this.reviews.stop(subject)
    this.pullRequestReviews.stop(subject)
    return true
  }

  #apply(entry, captured) {
    if (captured === undefined) {
      if (this.activePlans.find({ issue: entry.watch.issue.number, repository: entry.watch.repository }) !== null) return
    } else {
      if (!this.activePlans.isUnchanged(captured)) return
      if (entry.phase === captured.phase && ActivePlanRecovery.#sameSession(entry.watch, captured.watch)) return
      if (!this.#forget(captured)) return
    }
    this.checkouts.remember(new CheckoutRoot(entry.watch.located.root))
    if (entry.phase === ActivePlanPhase.IMPLEMENTING) {
      this.#rememberImplementing(entry.watch)
    } else if (entry.phase === ActivePlanPhase.UNCERTAIN) {
      this.activePlans.rememberUncertain(entry.watch)
    } else {
      this.sessions.remember(entry.watch)
      this.reviews.startRecovered(entry.watch)
    }
  }
}
