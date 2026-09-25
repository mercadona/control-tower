import type { Request, RequestHandler, Response } from 'express'
import { Answer } from './http.ts'
import { PlanCollapse } from './start-plan-route.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import { SessionAttention } from '../domain/value-objects/session-attention.ts'
import { CoordinatingSessionTarget } from './coordinating-session-target.ts'
import {
  HeldCoordinatingSession, CoordinatingSessionState, OpeningReservation,
} from './coordinating-sessions.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import {
  ReopenCoordinatingSessionParams, type CoordinatingSessionReopened, type ReopenCoordinatingSession,
} from '../application/actions/reopen-coordinating-session.ts'

export const CoordinatingSessionReopenOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  NOT_ENDED: 'coordinating-session-not-ended',
  REOPENING: 'coordinating-session-reopening',
} as const)

export class CoordinatingSessionReopenRoute {
  static readonly PATH = '/coordinating-session/reopen'
  static readonly METHODS = 'POST'
  static readonly #NOT_ENDED_DETAIL =
    'the coordinating conversation is still live: it has to end before it can be reopened'
  static readonly #REOPENING_DETAIL =
    'the coordinating conversation is being reopened: wait for it to be live and try again'

  static reopening(held: CoordinatingSessions, reopen: Pick<ReopenCoordinatingSession, 'execute'>): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const holding = CoordinatingSessionTarget.admitted(request, response, held)
      if (holding === null) return
      if (holding.state === CoordinatingSessionState.LIVE) {
        Answer.refuse(response, 409, CoordinatingSessionReopenOutcome.NOT_ENDED, CoordinatingSessionReopenRoute.#NOT_ENDED_DETAIL)
        return
      }
      const reserved = held.reserve()
      if (reserved.outcome !== OpeningReservation.RESERVED) {
        Answer.refuse(response, 409, CoordinatingSessionReopenOutcome.REOPENING, CoordinatingSessionReopenRoute.#REOPENING_DETAIL)
        return
      }
      let reopened: CoordinatingSessionReopened
      try {
        reopened = await reopen.execute(new ReopenCoordinatingSessionParams({ conversation: holding.conversation }))
      } catch (cause) {
        held.release()
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, PlanCollapse.of(cause))
        return
      }
      held.remember(new HeldCoordinatingSession({
        target: held.mintTarget(),
        state: CoordinatingSessionState.LIVE,
        conversation: reopened.conversation,
        session: reopened.session,
        attention: SessionAttention.working(),
      }), reopened.timeline)
      Answer.send(response, 202, {
        status: reopened.outcome,
        step: reopened.step,
        target: held.held()!.target,
        conversation: reopened.conversation.id.text,
        repo: reopened.conversation.repository.text,
        story: reopened.conversation.story.text,
        root: reopened.conversation.root.text,
        session: { id: reopened.session.id, name: reopened.session.name },
      })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', CoordinatingSessionReopenRoute.METHODS)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
