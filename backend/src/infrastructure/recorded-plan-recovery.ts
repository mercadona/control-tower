import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { RegisteredCheckout } from '../domain/value-objects/registered-checkout.ts'
import type { CheckoutRegistry } from '../domain/ports/checkout-registry.ts'
import type { PlanRecords } from '../domain/ports/plan-records.ts'
import type { PlanCalls } from '../domain/ports/plan-calls.ts'
import type { PlanRecovery } from '../domain/policies/plan-recovery.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import {
  ActivePlanPhase,
  type ActivePlans,
  type ActivePlanRecovery,
  type FoundActivePlan,
} from './active-plans-route.ts'
import type { ClaudeCalls } from './claude-calls.ts'
import type { ReviewWatch } from './review-watch.ts'

type RecoveredPlanOutcome =
  | { readonly phase: typeof ActivePlanPhase.PLANNING | typeof ActivePlanPhase.IMPLEMENTING }
  | {
    readonly phase: typeof ActivePlanPhase.UNCERTAIN,
    readonly diagnostic: string,
    readonly recovery: ActivePlanRecovery,
  }

class RecoveredPlan {
  readonly watch: PlanWatch
  readonly outcome: RecoveredPlanOutcome

  constructor(asked: {
    watch: PlanWatch,
    outcome: RecoveredPlanOutcome,
  }) {
    this.watch = asked.watch
    this.outcome = Object.freeze({ ...asked.outcome })
    Object.freeze(this)
  }

}

export class RecordedPlanRecovery {
  readonly records: PlanRecords
  readonly calls: PlanCalls
  readonly ownership: ClaudeCalls
  readonly checkouts: CheckoutRegistry
  readonly activePlans: ActivePlans
  readonly reviews: ReviewWatch
  recovering: Promise<string | null> | null

  constructor(ports: {
    records: PlanRecords,
    calls: PlanCalls,
    ownership: ClaudeCalls,
    checkouts: CheckoutRegistry,
    activePlans: ActivePlans,
    reviews: ReviewWatch,
  }) {
    this.records = ports.records
    this.calls = ports.calls
    this.ownership = ports.ownership
    this.checkouts = ports.checkouts
    this.activePlans = ports.activePlans
    this.reviews = ports.reviews
    this.recovering = null
  }

  async recover(): Promise<string | null> {
    this.recovering = this.recovering ?? this.#recover()
    const recovery = this.recovering
    try {
      return await recovery
    } finally {
      if (this.recovering === recovery) this.recovering = null
    }
  }

  async #recover(): Promise<string | null> {
    const found = await this.records.inFlight()
    if (!found.wereListed) return found.reason
    const watches = found.watches ?? []
    const recoveries: PlanRecovery[] = []
    try {
      for (const watch of watches) recoveries.push(await this.calls.recoveryFor(watch))
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }

    const previous = new Map<string, FoundActivePlan | null>()
    for (const watch of watches) previous.set(
      RecordedPlanRecovery.#keyFor(watch),
      this.activePlans.find({ issue: watch.issue.number, repository: watch.repository }),
    )
    const foundKeys = new Set(watches.map(RecordedPlanRecovery.#keyFor))
    for (const watch of this.activePlans.watches()) {
      if (foundKeys.has(RecordedPlanRecovery.#keyFor(watch))) continue
      this.reviews.stop({ issue: watch.issue.number, repository: watch.repository })
      this.activePlans.forget({ issue: watch.issue.number, repository: watch.repository })
    }

    for (let index = 0; index < watches.length; index += 1) {
      const watch = watches[index]
      this.checkouts.remember(new RegisteredCheckout({
        repository: watch.repository,
        root: new CheckoutRoot(watch.located.root),
      }))
      const recovered = this.#project(watch, recoveries[index])
      this.#remember(recovered, previous.get(RecordedPlanRecovery.#keyFor(watch)) ?? null)
    }
    return null
  }

  #project(watch: PlanWatch, recovery: PlanRecovery): RecoveredPlan {
    const decision = recovery.decision
    if (recovery.successfulExecution() !== null) {
      return new RecoveredPlan({ watch, outcome: { phase: ActivePlanPhase.IMPLEMENTING } })
    }
    if (decision.action === 'observe' && this.ownership.owns(decision.call)) {
      return new RecoveredPlan({
        watch,
        outcome: {
          phase: recovery.purposeOf(decision.call) === 'plan'
            ? ActivePlanPhase.PLANNING
            : ActivePlanPhase.IMPLEMENTING,
        },
      })
    }
    return new RecoveredPlan({
      watch,
      outcome: {
        phase: ActivePlanPhase.UNCERTAIN,
        diagnostic: decision.action === 'observe'
          ? `incomplete call ${decision.call.id} is not owned by this API process; ${decision.detail}`
          : decision.detail,
        recovery: { action: decision.action, detail: decision.detail },
      },
    })
  }

  #remember(recovered: RecoveredPlan, previous: FoundActivePlan | null): void {
    switch (recovered.outcome.phase) {
      case ActivePlanPhase.PLANNING:
        this.reviews.stop({ issue: recovered.watch.issue.number, repository: recovered.watch.repository })
        this.activePlans.rememberPlanning(recovered.watch)
        return
      case ActivePlanPhase.UNCERTAIN:
        this.reviews.stop({ issue: recovered.watch.issue.number, repository: recovered.watch.repository })
        this.activePlans.rememberUncertain(
          recovered.watch,
          recovered.outcome.diagnostic,
          recovered.outcome.recovery,
        )
        return
      case ActivePlanPhase.IMPLEMENTING:
        this.activePlans.rememberImplementing(recovered.watch)
        if (previous?.phase !== ActivePlanPhase.IMPLEMENTING || previous.watch.agent !== recovered.watch.agent) {
          void this.reviews.startRecovered(recovered.watch)
        }
        return
    }
  }

  static #keyFor(watch: PlanWatch): string {
    return `${watch.repository.text}#${watch.issue.number}`
  }
}
