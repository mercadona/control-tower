import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

type WatchedPlan = { issue: number, repository: RepositoryName }

export class PlanSessions {
  readonly live = new Map<string, PlanWatch>()

  static #keyFor(repository: RepositoryName, issueNumber: number): string {
    return `${repository.text}#${issueNumber}`
  }

  remember(watch: PlanWatch): void {
    this.live.set(PlanSessions.#keyFor(watch.repository, watch.issue.number), watch)
  }

  find({ issue, repository }: WatchedPlan): PlanWatch | null {
    return this.live.get(PlanSessions.#keyFor(repository, issue)) ?? null
  }

  known(): PlanWatch[] {
    return [...this.live.values()]
  }

  forget({ issue, repository }: WatchedPlan): void {
    this.live.delete(PlanSessions.#keyFor(repository, issue))
  }
}
