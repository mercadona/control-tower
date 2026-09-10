import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { ImplementationProgressFailure } from '../domain/exceptions.ts'
import { ImplementationStep } from '../domain/value-objects/implementation-state.ts'
import type { CheckoutRegistry } from '../domain/ports/checkout-registry.ts'
import type { ImplementationProgress } from '../domain/ports/implementation-progress.ts'
import type { ImplementationState } from '../domain/value-objects/implementation-state.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { DiskGoRegistry } from './disk-go-registry.ts'
import type { DiskImplementationStartRegistry } from './disk-implementation-start-registry.ts'
import type { WorktreePlans } from './worktree-plans.ts'
import type { ActivePlans } from './active-plans-route.js'
import type { PlanSessions } from './plan-events-route.js'
import type { ReviewWatch } from './review-watch.js'

export class ActivePlanRecovery {
  readonly plans: WorktreePlans
  readonly checkouts: CheckoutRegistry
  readonly implementationStarts: DiskImplementationStartRegistry
  readonly goRegistry: DiskGoRegistry
  readonly implementationProgress: ImplementationProgress
  readonly sessions: PlanSessions
  readonly reviews: ReviewWatch
  readonly pullRequestReviews: ReviewWatch
  readonly activePlans: ActivePlans
  conclusive: boolean
  recovering: Promise<string | null> | null

  constructor({
    plans, checkouts, implementationStarts, goRegistry, implementationProgress,
    sessions, reviews, pullRequestReviews, activePlans,
  }: {
    plans: WorktreePlans,
    checkouts: CheckoutRegistry,
    implementationStarts: DiskImplementationStartRegistry,
    goRegistry: DiskGoRegistry,
    implementationProgress: ImplementationProgress,
    sessions: PlanSessions,
    reviews: ReviewWatch,
    pullRequestReviews: ReviewWatch,
    activePlans: ActivePlans,
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

  async #workIsUnderway(watch: PlanWatch): Promise<boolean> {
    let state: ImplementationState
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

  #rememberImplementing(watch: PlanWatch): void {
    this.activePlans.rememberImplementing(watch)
    this.pullRequestReviews.startRecovered(watch)
  }

  async recover(): Promise<string | null> {
    if (this.conclusive) return null
    this.recovering = this.recovering ?? this.#recover()
    try {
      return await this.recovering
    } finally {
      this.recovering = null
    }
  }

  async #recover(): Promise<string | null> {
    const found = await this.plans.inFlight()
    if (!found.wereListed) return found.reason
    for (const watch of found.watches ?? []) {
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
