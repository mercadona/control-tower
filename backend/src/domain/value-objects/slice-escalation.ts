export const EscalationState: Readonly<{ NONE: 'none', RAISED: 'raised', UNCHECKED: 'unchecked' }> = Object.freeze({
  NONE: 'none',
  RAISED: 'raised',
  UNCHECKED: 'unchecked',
})

export type EscalationStateValue = typeof EscalationState[keyof typeof EscalationState]

export class SliceEscalation {
  readonly state: EscalationStateValue
  readonly reason: string
  readonly unblock: string
  readonly notes: readonly string[]
  readonly detail: string

  private constructor(asked: {
    state: EscalationStateValue,
    reason: string,
    unblock: string,
    notes: readonly string[],
    detail: string,
  }) {
    this.state = asked.state
    this.reason = asked.reason
    this.unblock = asked.unblock
    this.notes = Object.freeze([...asked.notes])
    this.detail = asked.detail
    Object.freeze(this)
  }

  static none(): SliceEscalation {
    return new SliceEscalation({ state: EscalationState.NONE, reason: '', unblock: '', notes: [], detail: '' })
  }

  static raised({ reason, unblock, notes }: {
    reason: string,
    unblock: string,
    notes: readonly string[],
  }): SliceEscalation {
    return new SliceEscalation({ state: EscalationState.RAISED, reason, unblock, notes, detail: '' })
  }

  static unchecked(detail: string): SliceEscalation {
    if (detail.trim().length === 0) {
      throw new TypeError('an unchecked escalation must say why it could not be checked')
    }
    return new SliceEscalation({ state: EscalationState.UNCHECKED, reason: '', unblock: '', notes: [], detail })
  }
}
