import type { PlanWatch } from './plan-watch.ts'

export class PlansInFlight {
  readonly watches: readonly PlanWatch[] | null
  readonly reason: string | null

  static listed(watches: readonly PlanWatch[]): PlansInFlight {
    return new PlansInFlight(watches, null)
  }

  static refused(reason: string): PlansInFlight {
    return new PlansInFlight(null, reason)
  }

  static incomplete(watches: readonly PlanWatch[], reason: string): PlansInFlight {
    return new PlansInFlight(watches, reason)
  }

  constructor(watches: readonly PlanWatch[] | null, reason: string | null) {
    this.watches = watches
    this.reason = reason
    Object.freeze(this)
  }

  get wereListed(): boolean {
    return this.reason === null
  }
}
