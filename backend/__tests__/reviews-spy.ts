import { ReviewInFlight, type ReviewInFlightValue } from '../src/domain/policies/review-gate-policy.ts'
import type { PlanWatch } from '../src/domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../src/domain/value-objects/repository-name.ts'

type StoppedWatch = { issue: number, repository: RepositoryName }

export class ReviewsSpy {
  readonly started: PlanWatch[]
  readonly stopped: StoppedWatch[]
  readonly asked: PlanWatch[]
  readonly inFlight: ReviewInFlightValue

  constructor(inFlight: ReviewInFlightValue = ReviewInFlight.CLEAR) {
    this.started = []
    this.stopped = []
    this.asked = []
    this.inFlight = inFlight
  }

  static withAnUndeliveredChange(): ReviewsSpy {
    return new ReviewsSpy(ReviewInFlight.IN_FLIGHT)
  }

  static unreadable(): ReviewsSpy {
    return new ReviewsSpy(ReviewInFlight.UNREADABLE)
  }

  start(watch: PlanWatch): void {
    this.started.push(watch)
  }

  stop({ issue, repository }: StoppedWatch): void {
    this.stopped.push({ issue, repository })
  }

  async refresh(watch: PlanWatch): Promise<ReviewInFlightValue> {
    this.asked.push(watch)

    return this.inFlight
  }
}
