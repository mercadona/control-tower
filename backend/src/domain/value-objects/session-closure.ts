import { ConversationId } from './conversation-id.ts'

export const ClosureStatus = Object.freeze({
  REQUESTED: 'requested',
  CLOSED: 'closed',
} as const)

export type ClosureStatusValue = (typeof ClosureStatus)[keyof typeof ClosureStatus]

export class SessionClosure {
  readonly conversation: ConversationId
  readonly target: string
  readonly session: string | null
  readonly processGroup: number | null
  readonly status: ClosureStatusValue

  constructor({ conversation, target, session, processGroup, status }: {
    conversation: ConversationId,
    target: unknown,
    session: unknown,
    processGroup: unknown,
    status: unknown,
  }) {
    if (!ConversationId.isWellFormed(target)) {
      throw new Error(`a session closure target must be a UUID, got ${JSON.stringify(target)}`)
    }
    if (session !== null && (typeof session !== 'string' || session.trim().length === 0)) {
      throw new Error(`a session closure terminal must be a non-empty string or null, got ${JSON.stringify(session)}`)
    }
    if (processGroup !== null && (
      typeof processGroup !== 'number' || !Number.isSafeInteger(processGroup) || processGroup <= 0
    )) {
      throw new Error(`a session closure process group must be a positive safe integer or null, got ${JSON.stringify(processGroup)}`)
    }
    if (status !== ClosureStatus.REQUESTED && status !== ClosureStatus.CLOSED) {
      throw new Error(`a session closure status must be requested or closed, got ${JSON.stringify(status)}`)
    }
    if ((session === null) !== (processGroup === null)) {
      throw new Error('a session closure terminal and process group must both be present or both be null')
    }
    this.conversation = conversation
    this.target = target
    this.session = session
    this.processGroup = processGroup
    this.status = status
    Object.freeze(this)
  }

  closed(): SessionClosure {
    return new SessionClosure({
      conversation: this.conversation,
      target: this.target,
      session: this.session,
      processGroup: this.processGroup,
      status: ClosureStatus.CLOSED,
    })
  }

  matches({ conversation, target }: { conversation: ConversationId, target: string }): boolean {
    return this.conversation.text === conversation.text && this.target === target
  }
}
