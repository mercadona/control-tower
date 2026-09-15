export const TimelineEventKind = Object.freeze({
  OPENED: 'opened',
  RESUMED: 'resumed',
  UNRESUMABLE: 'unresumable',
  WORKING: 'working',
  WAITING_FOR_PERMISSION: 'waiting-for-permission',
  COMPLETED: 'completed',
  ENDED: 'ended',
} as const)

export type TimelineEventKindValue = (typeof TimelineEventKind)[keyof typeof TimelineEventKind]

export class SessionTimelineEvent {
  static readonly #KINDS: readonly string[] = Object.values(TimelineEventKind)
  static readonly #AT_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
  static readonly EXAMPLE_AT = '2026-09-15T10:00:00.000Z'

  readonly id: string
  readonly kind: TimelineEventKindValue
  readonly at: string
  readonly detail: string | null

  constructor({ id, kind, at, detail }: { id: unknown, kind: unknown, at: unknown, detail: unknown }) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`a timeline event id must be a non-empty string, got ${JSON.stringify(id)}`)
    }
    if (!SessionTimelineEvent.#isKind(kind)) {
      throw new Error(
        `a timeline event kind must be one of ${SessionTimelineEvent.#KINDS.join(', ')}, got ${JSON.stringify(kind)}`
      )
    }
    if (!SessionTimelineEvent.#isWellFormedAt(at)) {
      throw new Error(
        `a timeline event timestamp must look like ${SessionTimelineEvent.EXAMPLE_AT}, got ${JSON.stringify(at)}`
      )
    }
    if (detail !== null && typeof detail !== 'string') {
      throw new Error(`a timeline event detail must be a string or null, got ${JSON.stringify(detail)}`)
    }
    this.id = id
    this.kind = kind
    this.at = at
    this.detail = detail
    Object.freeze(this)
  }

  static #isKind(value: unknown): value is TimelineEventKindValue {
    return typeof value === 'string' && SessionTimelineEvent.#KINDS.includes(value)
  }

  static #isWellFormedAt(value: unknown): value is string {
    if (typeof value !== 'string' || !SessionTimelineEvent.#AT_SHAPE.test(value)) return false
    const parsed = new Date(value)

    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
  }
}
