import { PlanNonLaunch } from '../domain/value-objects/plan-non-launch.ts'

type JsonRecord = Record<string, unknown>

export class NonLaunchRecord {
  static readonly #FIELDS = Object.freeze(['conversation', 'callId', 'source', 'diagnostic', 'observedAt'])

  static read(text: string): PlanNonLaunch {
    const parsed: unknown = JSON.parse(text)
    if (!NonLaunchRecord.#record(parsed)) throw new Error('non-launch receipt must be a JSON object')
    const fields = Object.keys(parsed).sort()
    const expected = [...NonLaunchRecord.#FIELDS].sort()
    if (fields.length !== expected.length || fields.some((field, index) => field !== expected[index])) {
      throw new Error(`non-launch receipt must contain exactly ${expected.join(', ')}, got ${fields.join(', ')}`)
    }
    return new PlanNonLaunch({
      conversation: NonLaunchRecord.#string('conversation', parsed.conversation),
      callId: parsed.callId === null ? null : NonLaunchRecord.#string('callId', parsed.callId),
      source: NonLaunchRecord.#source(parsed.source),
      diagnostic: NonLaunchRecord.#string('diagnostic', parsed.diagnostic),
      observedAt: NonLaunchRecord.#string('observedAt', parsed.observedAt),
    })
  }

  static text(proof: PlanNonLaunch): string {
    return `${JSON.stringify({
      conversation: proof.conversation,
      callId: proof.callId,
      source: proof.source,
      diagnostic: proof.diagnostic,
      observedAt: proof.observedAt,
    }, null, 2)}\n`
  }

  static #record(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  static #string(field: string, value: unknown): string {
    if (typeof value !== 'string') throw new Error(`${field} must be a string`)
    return value
  }

  static #source(value: unknown): 'before-worker' | 'worker-spawn' | 'child-spawn' {
    if (value === 'before-worker' || value === 'worker-spawn' || value === 'child-spawn') return value
    throw new Error(`source is unknown: ${JSON.stringify(value)}`)
  }
}
