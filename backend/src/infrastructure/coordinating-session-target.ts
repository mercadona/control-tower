import type { Request, Response } from 'express'
import { Answer } from './http.ts'
import { CoordinatingOperation } from './coordinating-sessions.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import type { CoordinatingSessions, HeldCoordinatingSession } from './coordinating-sessions.ts'

export class CoordinatingSessionTarget {
  static readonly HEADER = 'x-coordinating-target'
  static readonly CHANGED = 'coordinating-session-target-changed'
  static readonly BUSY = 'coordinating-session-busy'

  static admitted(
    request: Request, response: Response, registry: CoordinatingSessions
  ): HeldCoordinatingSession | null {
    const offered = request.get(CoordinatingSessionTarget.HEADER)
    const held = registry.held()
    if (!ConversationId.isWellFormed(offered)) {
      Answer.refuse(
        response,
        400,
        CoordinatingSessionTarget.CHANGED,
        'the coordinating session target changed: refresh before acting',
      )
      return null
    }
    if (held === null && registry.operation() !== CoordinatingOperation.IDLE) {
      Answer.refuse(
        response,
        400,
        CoordinatingSessionTarget.BUSY,
        `the coordinating session is ${registry.operation()}: wait for it to settle before acting`,
      )
      return null
    }
    if (held === null || held.target !== offered) {
      Answer.refuse(
        response,
        400,
        CoordinatingSessionTarget.CHANGED,
        'the coordinating session target changed: refresh before acting',
      )
      return null
    }
    if (registry.operation() !== CoordinatingOperation.IDLE) {
      Answer.refuse(
        response,
        400,
        CoordinatingSessionTarget.BUSY,
        `the coordinating session is ${registry.operation()}: wait for it to settle before acting`,
      )
      return null
    }

    return held
  }

  static stillCurrent(registry: CoordinatingSessions, held: HeldCoordinatingSession): boolean {
    return registry.isCurrent(held)
  }
}
