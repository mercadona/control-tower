export type PlanNonLaunchSource = 'before-worker' | 'worker-spawn' | 'child-spawn'

export class PlanNonLaunch {
  readonly conversation: string
  readonly callId: string | null
  readonly source: PlanNonLaunchSource
  readonly diagnostic: string
  readonly observedAt: string

  constructor(asked: {
    conversation: string,
    callId: string | null,
    source: PlanNonLaunchSource,
    diagnostic: string,
    observedAt: string,
  }) {
    this.conversation = PlanNonLaunch.#text('conversation', asked.conversation)
    this.callId = asked.callId === null ? null : PlanNonLaunch.#text('callId', asked.callId)
    this.source = PlanNonLaunch.#source(asked.source)
    this.diagnostic = PlanNonLaunch.#text('diagnostic', asked.diagnostic)
    this.observedAt = PlanNonLaunch.#timestamp(asked.observedAt)
    Object.freeze(this)
  }

  static #text(field: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(`${field} must be nonempty text, got ${JSON.stringify(value)}`)
    }
    return value
  }

  static #source(value: unknown): PlanNonLaunchSource {
    switch (value) {
      case 'before-worker':
      case 'worker-spawn':
      case 'child-spawn':
        return value
      default:
        throw new TypeError(`source must name a non-launch boundary, got ${JSON.stringify(value)}`)
    }
  }

  static #timestamp(value: unknown): string {
    const text = PlanNonLaunch.#text('observedAt', value)
    const parsed = new Date(text)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
      throw new TypeError(`observedAt must be an ISO timestamp, got ${JSON.stringify(value)}`)
    }
    return text
  }
}
