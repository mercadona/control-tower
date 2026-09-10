import { PlanFailure } from '../domain/exceptions.ts'

export class ReviewWatch {
  constructor({ asked, baseline = asked, review, sleep, stderr, label }) {
    this.asked = asked
    this.readBaseline = baseline
    this.review = review
    this.sleep = sleep
    this.stderr = stderr
    this.label = label
    this.live = new Map()
  }

  static #keyFor(repository, issueNumber) {
    return `${repository.text}#${issueNumber}`
  }

  start(watch) {
    return this.#start(watch, false)
  }

  startRecovered(watch) {
    return this.#start(watch, true)
  }

  #start(watch, recovered) {
    const key = ReviewWatch.#keyFor(watch.repository, watch.issue.number)
    const attended = new Set()
    this.live.set(key, attended)

    return this.#follow(watch, key, attended, recovered).catch((cause) => {
      if (!this.#isCurrent(key, attended)) return
      this.stop({ issue: watch.issue.number, repository: watch.repository })
      this.#warn(watch, `is no longer watched: ${cause.message}`)
    })
  }

  stop({ issue, repository }) {
    this.live.delete(ReviewWatch.#keyFor(repository, issue))
  }

  #isCurrent(key, attended) {
    return this.live.get(key) === attended
  }

  async #follow(watch, key, attended, recovering) {
    if (recovering) {
      recovering = !(await this.#baseline(watch, attended))
      if (!this.#isCurrent(key, attended)) return
    }
    for (;;) {
      await this.sleep()
      if (!this.#isCurrent(key, attended)) return
      if (recovering) {
        recovering = !(await this.#baseline(watch, attended))
        if (!this.#isCurrent(key, attended)) return
        continue
      }
      await this.#attend(watch, key, attended)
      if (!this.#isCurrent(key, attended)) return
    }
  }

  async #baseline(watch, attended) {
    const read = await this.#sound(watch, this.readBaseline)
    if (read === null) return false
    for (const change of read.changes) attended.add(change.id)

    return true
  }

  async #attend(watch, key, attended) {
    const read = await this.#sound(watch)
    if (read === null) return
    const change = read.changes.find((candidate) => !attended.has(candidate.id))
    if (change === undefined) return
    if (!this.#isCurrent(key, attended)) return
    if (await this.#deliver(watch, change)) attended.add(change.id)
  }

  async #sound(watch, read = this.asked) {
    try {
      return await read(watch)
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      this.#warn(watch, `could not be asked what changes were asked for: ${cause.message}`)

      return null
    }
  }

  async #deliver(watch, change) {
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

  #warn(watch, said) {
    this.stderr(`${this.label}: ${watch.repository.text}#${watch.issue.number} ${said}\n`)
  }
}
