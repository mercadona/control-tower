import { PlanState } from '../../domain/value-objects/plan-state.js'

export class ReadPlanProgressParams {
  constructor({ located, issue, repository }) {
    this.located = located
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadPlanProgressResult {
  constructor({ state }) {
    this.state = state
    Object.freeze(this)
  }
}

export class ReadPlanProgress {
  constructor({ planProgress, reviewLog }) {
    this.planProgress = planProgress
    this.reviewLog = reviewLog
  }

  async execute(params) {
    return new ReadPlanProgressResult({
      state: await this.#stateOf(params),
    })
  }

  async #stateOf(params) {
    if (await this.#underReview(params)) return PlanState.REVIEWING

    return await this.planProgress.of({
      located: params.located,
      issue: params.issue,
      repository: params.repository,
    })
  }

  async #underReview(params) {
    const asked = ReadPlanProgress.#momentOf(
      this.reviewLog.lastAskedAt({ issue: params.issue.number, repository: params.repository })
    )
    if (asked === null) return false
    const committed = ReadPlanProgress.#momentOf(
      await this.planProgress.committedAt({ located: params.located })
    )

    return committed === null || asked > committed
  }

  static #momentOf(dated) {
    if (typeof dated !== 'string') return null
    const moment = Date.parse(dated)

    return Number.isNaN(moment) ? null : moment
  }
}
