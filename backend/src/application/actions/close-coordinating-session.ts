import { ClosureStatus, SessionClosure } from '../../domain/value-objects/session-closure.ts'
import {
  CoordinatingSessionTargetChanged,
  SessionClosureNotUnderstood,
  SessionTerminationUnconfirmed,
} from '../../domain/exceptions.ts'
import type { ConversationId } from '../../domain/value-objects/conversation-id.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'
import type { ConversationRecords } from '../../domain/ports/conversation-records.ts'
import type { LiveSessions } from '../../domain/ports/live-sessions.ts'

export class CloseCoordinatingSessionParams {
  readonly conversation: ConversationId
  readonly target: string
  readonly session: LiveSession | null

  constructor({ conversation, target, session }: {
    conversation: ConversationId, target: string, session: LiveSession | null,
  }) {
    this.conversation = conversation
    this.target = target
    this.session = session
    Object.freeze(this)
  }
}

export class CoordinatingSessionClosed {
  readonly conversation: ConversationId
  readonly target: string

  constructor({ conversation, target }: { conversation: ConversationId, target: string }) {
    this.conversation = conversation
    this.target = target
    Object.freeze(this)
  }
}

export class CloseCoordinatingSession {
  readonly records: ConversationRecords
  readonly liveSessions: LiveSessions

  constructor({ records, liveSessions }: { records: ConversationRecords, liveSessions: LiveSessions }) {
    this.records = records
    this.liveSessions = liveSessions
  }

  async execute(params: CloseCoordinatingSessionParams): Promise<CoordinatingSessionClosed> {
    const recorded = await this.records.recallClosure(params.conversation)
    if (recorded !== null && !recorded.matches(params)) {
      throw new SessionClosureNotUnderstood(
        `conversation ${params.conversation.text} has closure evidence for target ${recorded.target}, not ${params.target}`
      )
    }
    if (recorded?.status === ClosureStatus.CLOSED) return new CoordinatingSessionClosed(params)

    const requested = recorded ?? this.liveSessions.terminationEvidence(params)
    if (recorded === null) await this.records.requestClosure(requested)
    if (recorded === null) {
      await this.liveSessions.terminate(requested)
    } else {
      try {
        await this.liveSessions.confirmTermination(requested)
      } catch (cause) {
        if (!(cause instanceof SessionTerminationUnconfirmed) || params.session === null) throw cause
        await this.liveSessions.terminate(requested)
      }
    }
    await this.records.completeClosure(requested.closed())

    return new CoordinatingSessionClosed(params)
  }

  async acknowledge(params: CloseCoordinatingSessionParams): Promise<CoordinatingSessionClosed> {
    const recorded = await this.records.recallClosure(params.conversation)
    if (recorded === null || !recorded.matches(params) || recorded.status !== ClosureStatus.CLOSED) {
      throw new CoordinatingSessionTargetChanged(
        `coordinating target ${params.target} is not the durably closed target for conversation ${params.conversation.text}`
      )
    }

    return new CoordinatingSessionClosed(params)
  }
}
