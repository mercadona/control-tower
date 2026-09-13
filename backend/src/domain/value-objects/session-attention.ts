export const AttentionStatus = Object.freeze({ WORKING: 'working', WAITING: 'waiting' } as const)

export type AttentionStatusValue = (typeof AttentionStatus)[keyof typeof AttentionStatus]

export class SessionAttention {
  readonly status: AttentionStatusValue
  readonly question: string | null

  private constructor(status: AttentionStatusValue, question: string | null) {
    this.status = status
    this.question = question
    Object.freeze(this)
  }

  static working(): SessionAttention {
    return new SessionAttention(AttentionStatus.WORKING, null)
  }

  static waiting(question: string | null): SessionAttention {
    return new SessionAttention(AttentionStatus.WAITING, question)
  }
}
