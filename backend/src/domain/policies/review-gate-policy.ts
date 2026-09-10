import { PlanState, type PlanStateValue } from '../value-objects/plan-state.ts'

export type ReviewInFlightValue = 'in-flight' | 'clear' | 'unreadable'

export class ReviewInFlight {
  static readonly IN_FLIGHT = 'in-flight'
  static readonly CLEAR = 'clear'
  static readonly UNREADABLE = 'unreadable'

  static declared(): ReviewInFlightValue[] {
    return Object.values(ReviewInFlight)
  }
}

export class ReviewGatePolicy {
  static #BY_STATE: ReadonlyMap<PlanStateValue, ReviewInFlightValue> = new Map([
    [PlanState.REVIEWING, ReviewInFlight.IN_FLIGHT],
    [PlanState.READY, ReviewInFlight.CLEAR],
    [PlanState.WRITING, ReviewInFlight.CLEAR],
  ])

  static readingThePlan(state: PlanStateValue): ReviewInFlightValue {
    const projected = ReviewGatePolicy.#BY_STATE.get(state)
    if (projected === undefined) {
      throw new Error(`no review signal declared for the plan state ${JSON.stringify(state)}`)
    }

    return projected
  }

  static of({ watched, reworking }: {
    watched: ReviewInFlightValue,
    reworking: ReviewInFlightValue,
  }): ReviewInFlightValue {
    const read = [watched, reworking]
    const undeclared = read.filter((signal) => !ReviewInFlight.declared().includes(signal))
    if (undeclared.length > 0) {
      throw new Error(
        `a review signal is one of ${ReviewInFlight.declared().join(', ')}, got ${JSON.stringify(undeclared)}`
      )
    }
    if (read.includes(ReviewInFlight.IN_FLIGHT)) return ReviewInFlight.IN_FLIGHT
    if (read.includes(ReviewInFlight.UNREADABLE)) return ReviewInFlight.UNREADABLE

    return ReviewInFlight.CLEAR
  }
}
