import { PlanFailure } from '../domain/exceptions.ts'
import { ReviewInFlight, type ReviewInFlightValue } from '../domain/policies/review-gate-policy.ts'
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
    const attended = new Set<string>()
    this.live.set(key, attended)

    return this.#follow(watch, key, attended, recovered).catch((cause: Error) => {
      this.stop({ issue: watch.issue.number, repository: watch.repository })
      this.#warn(watch, `is no longer watched: ${cause.message}`)
    })
  }

  stop({ issue, repository }: WatchedIssue): void {
    this.live.delete(ReviewWatch.#keyFor(repository, issue))
  }

  async refresh(watch: PlanWatch): Promise<ReviewInFlightValue> {
    const attended = this.live.get(ReviewWatch.#keyFor(watch.repository, watch.issue.number))
    if (attended === undefined) return ReviewInFlight.CLEAR
    const read = await this.#sound(watch)
    if (read === null) return ReviewInFlight.UNREADABLE
    const waiting = read.changes.some((change) => !attended.has(change.id))

    return waiting ? ReviewInFlight.IN_FLIGHT : ReviewInFlight.CLEAR
  }

  async #follow(watch: PlanWatch, key: string, attended: Set<string>, recovering: boolean): Promise<void> {
    if (recovering) {
      recovering = !(await this.#baseline(watch, attended))
      if (!this.live.has(key)) return
    }
    for (;;) {
      await this.sleep()
      if (!this.live.has(key)) return
      if (recovering) {
        recovering = !(await this.#baseline(watch, attended))
        if (!this.live.has(key)) return
        continue
      }
      await this.#attend(watch, key, attended)
    }
  }

  async #baseline(watch: PlanWatch, attended: Set<string>): Promise<boolean> {
    const read = await this.#sound(watch)
    if (read === null) return false
    for (const change of read.changes) attended.add(change.id)

    return true
  }

  async #attend(watch: PlanWatch, key: string, attended: Set<string>): Promise<void> {
    const read = await this.#sound(watch)
    if (read === null) return
    const change = read.changes.find((candidate) => !attended.has(candidate.id))
    if (change === undefined) return
    if (!this.live.has(key)) return
    if (await this.#deliver(watch, change)) attended.add(change.id)
  }

  async #sound(watch: PlanWatch): Promise<ChangesAsked | null> {
    try {
      const read = await this.asked(watch)
      this.#note(watch, read.changes)

      return read
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      this.#warn(watch, `could not be asked what changes were asked for: ${cause.message}`)

      return null
    }
  }

  #note(watch: PlanWatch, changes: readonly ChangeAsked[]): void {
    for (const change of changes) {
      if (change.askedAt === null) continue
      this.log.noted({ issue: watch.issue.number, repository: watch.repository, at: change.askedAt })
    }
  }

  async #deliver(watch: PlanWatch, change: ChangeAsked): Promise<boolean> {
    try {
      await this.review({
        agent: watch.agent,
        issue: watch.issue.number,
        repository: watch.repository,
        changes: change.text,
      })

      return true
    } catch (cause) {
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
}
