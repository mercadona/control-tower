import { ReviewLog } from '../domain/ports/review-log.js'

export class MemoryReviewLog extends ReviewLog {
  constructor() {
    super()
    this.newest = new Map()
  }

  static #keyFor(repository, issue) {
    return `${repository.text}#${issue}`
  }

  noted({ issue, repository, at }) {
    const moment = Date.parse(at)
    if (Number.isNaN(moment)) return
    const key = MemoryReviewLog.#keyFor(repository, issue)
    const known = this.newest.get(key)
    if (known !== undefined && Date.parse(known) >= moment) return

    this.newest.set(key, at)
  }

  lastAskedAt({ issue, repository }) {
    return this.newest.get(MemoryReviewLog.#keyFor(repository, issue)) ?? null
  }
}
