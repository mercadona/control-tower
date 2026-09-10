import { ReviewLog } from '../domain/ports/review-log.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

export class MemoryReviewLog extends ReviewLog {
  readonly newest: Map<string, string>

  constructor() {
    super()
    this.newest = new Map()
  }

  static #keyFor(repository: RepositoryName, issue: number): string {
    return `${repository.text}#${issue}`
  }

  noted({ issue, repository, at }: { issue: number, repository: RepositoryName, at: string }): void {
    const moment = Date.parse(at)
    if (Number.isNaN(moment)) return
    const key = MemoryReviewLog.#keyFor(repository, issue)
    const known = this.newest.get(key)
    if (known !== undefined && Date.parse(known) >= moment) return

    this.newest.set(key, at)
  }

  lastAskedAt({ issue, repository }: { issue: number, repository: RepositoryName }): string | null {
    return this.newest.get(MemoryReviewLog.#keyFor(repository, issue)) ?? null
  }
}
