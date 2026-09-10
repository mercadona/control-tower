import type { PlanWatch } from '../src/domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../src/domain/value-objects/repository-name.ts'

type StoppedWatch = { issue: number, repository: RepositoryName }

export class ReviewsSpy {
  readonly started: PlanWatch[]
  readonly stopped: StoppedWatch[]

  constructor() {
    this.started = []
    this.stopped = []
  }

  start(watch: PlanWatch): void {
    this.started.push(watch)
  }

  stop({ issue, repository }: StoppedWatch): void {
    this.stopped.push({ issue, repository })
  }
}
