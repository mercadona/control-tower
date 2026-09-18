import { PlanFailure } from '../domain/exceptions.ts'
import type { ChangeAsked } from '../domain/value-objects/change-asked.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { ReviewLog } from '../domain/ports/review-log.ts'

export type ChangesAsked = { readonly changes: readonly ChangeAsked[] }

export type ReviewAsked = (watch: PlanWatch) => Promise<ChangesAsked>

export type Delivered = {
  agent: string,
  issue: number,
  repository: RepositoryName,
  changes: string,
  requestId?: string,
}

export type ReviewDelivery = (params: Delivered) => Promise<void>

export type ReviewWait = () => Promise<void>

export type WatchedIssue = { issue: number, repository: RepositoryName }

export class ReviewWatch {
  readonly asked: ReviewAsked
  readonly review: ReviewDelivery
  readonly sleep: ReviewWait
  readonly stderr: (line: string) => void
  readonly label: string
  readonly log: ReviewLog
  readonly live: Map<string, Set<string>>
  readonly baselined: Map<string, Set<string>>

  constructor({ asked, review, sleep, stderr, label, log }: {
    asked: ReviewAsked,
    review: ReviewDelivery,
    sleep: ReviewWait,
    stderr: (line: string) => void,
    label: string,
    log: ReviewLog,
  }) {
    this.asked = asked
    this.review = review
    this.sleep = sleep
    this.stderr = stderr
    this.label = label
    this.log = log
    this.live = new Map()
    this.baselined = new Map()
  }

  static #keyFor(repository: RepositoryName, issueNumber: number): string {
    return `${repository.text}#${issueNumber}`
  }

  start(watch: PlanWatch): Promise<void> {
    return this.#start(watch, false)
  }

  startRecovered(watch: PlanWatch): Promise<void> {
    return this.#start(watch, true)
  }

  #start(watch: PlanWatch, recovered: boolean): Promise<void> {
    const key = ReviewWatch.#keyFor(watch.repository, watch.issue.number)
    const carried = this.baselined.get(key)
    const attended = new Set(carried ?? [])
    this.live.set(key, attended)
    const recovering = recovered && carried === undefined
    if (!recovering) this.baselined.set(key, attended)

    return this.#follow(watch, key, attended, recovering).catch((cause: Error) => {
      if (!this.#isCurrent(key, attended)) return
      this.live.delete(key)
      this.#warn(watch, `is no longer watched: ${cause.message}`)
    })
  }

  stop({ issue, repository }: WatchedIssue): void {
    this.live.delete(ReviewWatch.#keyFor(repository, issue))
  }

  async #follow(watch: PlanWatch, key: string, attended: Set<string>, recovering: boolean): Promise<void> {
    if (recovering) {
      recovering = !(await this.#baseline(watch, key, attended))
      if (!this.#isCurrent(key, attended)) return
    }
    for (;;) {
      if (!this.#isCurrent(key, attended)) return
      await this.sleep()
      if (!this.#isCurrent(key, attended)) return
      if (recovering) {
        recovering = !(await this.#baseline(watch, key, attended))
        if (!this.#isCurrent(key, attended)) return
        continue
      }
      await this.#attend(watch, key, attended)
      if (!this.#isCurrent(key, attended)) return
    }
  }

  async #baseline(watch: PlanWatch, key: string, attended: Set<string>): Promise<boolean> {
    if (!this.#isCurrent(key, attended)) return false
    const read = await this.#sound(watch, key, attended)
    if (!this.#isCurrent(key, attended)) return false
    if (read === null) return false
    this.#note(watch, key, attended, read.changes)
    for (const change of read.changes) {
      if (!this.#isCurrent(key, attended)) return false
      attended.add(change.id)
    }
    this.baselined.set(key, attended)

    return true
  }

  async #attend(watch: PlanWatch, key: string, attended: Set<string>): Promise<void> {
    if (!this.#isCurrent(key, attended)) return
    const read = await this.#sound(watch, key, attended)
    if (!this.#isCurrent(key, attended)) return
    if (read === null) return
    this.#note(watch, key, attended, read.changes)
    if (!this.#isCurrent(key, attended)) return
    const change = read.changes.find((candidate) => !attended.has(candidate.id))
    if (change === undefined) return
    if (!this.#isCurrent(key, attended)) return
    if (await this.#deliver(watch, key, attended, change) && this.#isCurrent(key, attended)) attended.add(change.id)
  }

  async #sound(watch: PlanWatch, key: string, attended: Set<string>): Promise<ChangesAsked | null> {
    try {
      const read = await this.asked(watch)
      if (!this.#isCurrent(key, attended)) return null

      return read
    } catch (cause) {
      if (!this.#isCurrent(key, attended)) return null
      if (!(cause instanceof PlanFailure)) throw cause
      this.#warn(watch, `could not be asked what changes were asked for: ${cause.message}`)

      return null
    }
  }

  #note(watch: PlanWatch, key: string, attended: Set<string>, changes: readonly ChangeAsked[]): void {
    for (const change of changes) {
      if (!this.#isCurrent(key, attended)) return
      if (change.askedAt === null) continue
      this.log.noted({ issue: watch.issue.number, repository: watch.repository, at: change.askedAt })
    }
  }

  async #deliver(watch: PlanWatch, key: string, attended: Set<string>, change: ChangeAsked): Promise<boolean> {
    if (!this.#isCurrent(key, attended)) return false
    try {
      await this.review({
        agent: watch.agent,
        issue: watch.issue.number,
        repository: watch.repository,
        changes: change.text,
        requestId: change.id,
      })
      if (!this.#isCurrent(key, attended)) return false

      return true
    } catch (cause) {
      if (!this.#isCurrent(key, attended)) return false
      if (!(cause instanceof PlanFailure)) throw cause
      this.#warn(
        watch,
        `the changes asked for in ${change.id} could not be typed into ${watch.agent}, ` +
        `so they stay pending and will be tried again: ${cause.message}`
      )

      return false
    }
  }

  #warn(watch: PlanWatch, said: string): void {
    this.stderr(`${this.label}: ${watch.repository.text}#${watch.issue.number} ${said}\n`)
  }

  #isCurrent(key: string, attended: Set<string>): boolean {
    return this.live.get(key) === attended
  }
}
