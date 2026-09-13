import type { Request, RequestHandler, Response } from 'express'
import { Answer, JsonBody, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { PlanRequest, PlanRequestOutcome, PlanRefusal, PlanCollapse } from './start-plan-route.ts'
import { HeldCoordinatingSession, CoordinatingSessionState } from './coordinating-sessions.ts'
import { OpenCoordinatingSessionParams } from '../application/actions/open-coordinating-session.ts'
import { SessionAttention } from '../domain/value-objects/session-attention.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import type { CoordinatingSessionOpened, OpenCoordinatingSession } from '../application/actions/open-coordinating-session.ts'

export const CoordinatingSessionOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  ONE_REPOSITORY_ONLY: 'one-repository-only',
} as const)

export type CoordinatingSessionOutcomeValue = (typeof CoordinatingSessionOutcome)[keyof typeof CoordinatingSessionOutcome]

type CoordinatingSessionRefusalOf = () => Refusal

export class CoordinatingSessionRefusal {
  static readonly #BY_OUTCOME: Projection<CoordinatingSessionRefusalOf, CoordinatingSessionOutcomeValue> =
    new Projection<CoordinatingSessionRefusalOf, CoordinatingSessionOutcomeValue>('refusal', [
      [CoordinatingSessionOutcome.ONE_REPOSITORY_ONLY, () => new Refusal({
        status: 400,
        code: CoordinatingSessionOutcome.ONE_REPOSITORY_ONLY,
        detail: `an epic governs one checkout: send ${PlanRequest.REPO_FIELD} and ${PlanRequest.PATH_FIELD} `
          + `instead of ${PlanRequest.REPO_LIST_FIELD}`,
      })],
    ])

  static of(outcome: CoordinatingSessionOutcomeValue): Refusal {
    return CoordinatingSessionRefusal.#BY_OUTCOME.of(outcome)()
  }
}

export class CoordinatingSessionRoute {
  static readonly PATH = '/coordinating-session'
  static readonly METHODS = 'GET, POST'

  static opening(open: OpenCoordinatingSession, held: CoordinatingSessions): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const asked = PlanRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== PlanRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, PlanRefusal.of(asked))
        return
      }
      if (asked.listed) {
        Answer.refuseAs(response, CoordinatingSessionRefusal.of(CoordinatingSessionOutcome.ONE_REPOSITORY_ONLY))
        return
      }
      const [target] = asked.targets!
      let opened: CoordinatingSessionOpened
      try {
        opened = await open.execute(new OpenCoordinatingSessionParams({
          story: asked.story,
          comment: asked.comment,
          repository: target.repository,
          root: target.root,
        }))
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, PlanCollapse.of(cause))
        return
      }
      held.remember(new HeldCoordinatingSession({
        state: CoordinatingSessionState.LIVE,
        conversation: opened.conversation,
        session: opened.session,
        attention: SessionAttention.working(),
      }))
      Answer.send(response, 202, {
        status: 'brainstorming',
        conversation: opened.conversation.id.text,
        repo: opened.conversation.repository.text,
        root: opened.conversation.root.text,
        session: { id: opened.session.id, name: opened.session.name },
      })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', CoordinatingSessionRoute.METHODS)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
