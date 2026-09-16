import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { RegisteredCheckout } from '../domain/value-objects/registered-checkout.ts'
import type { CheckoutRegistry } from '../domain/ports/checkout-registry.ts'
import type { PlanRecords } from '../domain/ports/plan-records.ts'
import type { PlanCallPurpose } from '../domain/value-objects/plan-call.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import {
  ActivePlanPhase,
  type ActivePlans,
  type FoundActivePlan,
} from './active-plans-route.ts'
import type { ClaudeCalls } from './claude-calls.ts'
import type { RecordedCall } from './recorded-call.ts'
import type { ReviewWatch } from './review-watch.ts'

type RecoveredPlanOutcome =
  | { readonly phase: typeof ActivePlanPhase.PLANNING | typeof ActivePlanPhase.IMPLEMENTING }
  | { readonly phase: typeof ActivePlanPhase.UNCERTAIN, readonly diagnostic: string }

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

  compatibleWith(other: RecoveredPlan): boolean {
    if (this.outcome.phase !== other.outcome.phase) return false
    if (this.outcome.phase !== ActivePlanPhase.UNCERTAIN) return true
    return other.outcome.phase === ActivePlanPhase.UNCERTAIN
      && this.outcome.diagnostic === other.outcome.diagnostic
  }
}

export class RecordedPlanRecovery {
  readonly records: PlanRecords
  readonly calls: ClaudeCalls
  readonly checkouts: CheckoutRegistry
  readonly activePlans: ActivePlans
  readonly reviews: ReviewWatch
  recovering: Promise<string | null> | null

  constructor(ports: {
    records: PlanRecords,
    calls: ClaudeCalls,
    checkouts: CheckoutRegistry,
    activePlans: ActivePlans,
    reviews: ReviewWatch,
  }) {
    this.records = ports.records
    this.calls = ports.calls
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
    const histories: (readonly RecordedCall[])[] = []
    try {
      for (const watch of watches) histories.push(await this.calls.history(watch.agent))
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
      const recovered = this.#project(watch, histories[index])
      this.#remember(recovered, previous.get(RecordedPlanRecovery.#keyFor(watch)) ?? null)
    }
    return null
  }

  #project(watch: PlanWatch, history: readonly RecordedCall[]): RecoveredPlan {
    if (history.length === 0) {
      return new RecoveredPlan({
        watch,
        outcome: {
          phase: ActivePlanPhase.UNCERTAIN,
          diagnostic: 'no call descriptor is recorded; launch outcome is uncertain',
        },
      })
    }
    const newest = history.reduce((latest, call) => call.startedAt > latest ? call.startedAt : latest, history[0].startedAt)
    const candidates = history.filter((call) => call.startedAt === newest).map((call) => this.#fromCall(watch, call))
    const selected = candidates[0]
    if (candidates.every((candidate) => selected.compatibleWith(candidate))) return selected
    return new RecoveredPlan({
      watch,
      outcome: {
        phase: ActivePlanPhase.UNCERTAIN,
        diagnostic: `calls recorded at ${newest} carry ambiguous evidence`,
      },
    })
  }

  #fromCall(watch: PlanWatch, recorded: RecordedCall): RecoveredPlan {
    if (recorded.completion === null) {
      if (!this.calls.owns(recorded.call)) {
        return new RecoveredPlan({
          watch,
          outcome: {
            phase: ActivePlanPhase.UNCERTAIN,
            diagnostic: `incomplete call ${recorded.call.id} is not owned by this API process`,
          },
        })
      }
      return this.#ownedLive(watch, recorded.purpose)
    }
    if (!recorded.completion.succeeded) {
      const diagnostic = recorded.completion.execution.kind === 'success'
        ? `call ${recorded.call.id} did not exit successfully`
        : recorded.completion.execution.diagnostic
      return new RecoveredPlan({
        watch,
        outcome: { phase: ActivePlanPhase.UNCERTAIN, diagnostic },
      })
    }
    return this.#successful(watch, recorded.purpose)
  }

  #ownedLive(watch: PlanWatch, purpose: PlanCallPurpose): RecoveredPlan {
    switch (purpose) {
      case 'plan':
        return new RecoveredPlan({ watch, outcome: { phase: ActivePlanPhase.PLANNING } })
      case 'implementation':
        return new RecoveredPlan({ watch, outcome: { phase: ActivePlanPhase.IMPLEMENTING } })
      case 'fix':
        return new RecoveredPlan({ watch, outcome: { phase: ActivePlanPhase.IMPLEMENTING } })
    }
  }

  #successful(watch: PlanWatch, purpose: PlanCallPurpose): RecoveredPlan {
    switch (purpose) {
      case 'plan':
        return new RecoveredPlan({
          watch,
          outcome: {
            phase: ActivePlanPhase.UNCERTAIN,
            diagnostic: 'planning completed but publication and continuation remain pending',
          },
        })
      case 'implementation':
        return new RecoveredPlan({ watch, outcome: { phase: ActivePlanPhase.IMPLEMENTING } })
      case 'fix':
        return new RecoveredPlan({ watch, outcome: { phase: ActivePlanPhase.IMPLEMENTING } })
    }
  }

  #remember(recovered: RecoveredPlan, previous: FoundActivePlan | null): void {
    switch (recovered.outcome.phase) {
      case ActivePlanPhase.PLANNING:
        this.reviews.stop({ issue: recovered.watch.issue.number, repository: recovered.watch.repository })
        this.activePlans.rememberPlanning(recovered.watch)
        return
      case ActivePlanPhase.UNCERTAIN:
        this.reviews.stop({ issue: recovered.watch.issue.number, repository: recovered.watch.repository })
        this.activePlans.rememberUncertain(recovered.watch, recovered.outcome.diagnostic)
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
