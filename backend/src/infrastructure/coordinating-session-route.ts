import type { Request, RequestHandler, Response } from 'express'
import { Answer, JsonBody, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { PlanRequest, PlanRequestOutcome, PlanRefusal, PlanCollapse } from './start-plan-route.ts'
import { HeldCoordinatingSession, CoordinatingSessionState, OpeningReservation } from './coordinating-sessions.ts'
import { OpenCoordinatingSessionParams } from '../application/actions/open-coordinating-session.ts'
import { SessionAttention } from '../domain/value-objects/session-attention.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import type { CoordinatingSessions, OpeningReservationValue, ReservedOpening } from './coordinating-sessions.ts'
import type { CoordinatingSessionOpened, OpenCoordinatingSession } from '../application/actions/open-coordinating-session.ts'

export const CoordinatingSessionOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  ALREADY_LIVE: 'coordinating-session-already-live',
  OPENING: 'coordinating-session-opening',
} as const)

export type CoordinatingSessionOutcomeValue = (typeof CoordinatingSessionOutcome)[keyof typeof CoordinatingSessionOutcome]

type CoordinatingSessionRefusalOf = () => Refusal

export class CoordinatingSessionRefusal {
  static readonly #BY_OUTCOME: Projection<CoordinatingSessionRefusalOf, CoordinatingSessionOutcomeValue> =
    new Projection<CoordinatingSessionRefusalOf, CoordinatingSessionOutcomeValue>('refusal', [
      [CoordinatingSessionOutcome.ALREADY_LIVE, () => new Refusal({
        status: 409,
        code: CoordinatingSessionOutcome.ALREADY_LIVE,
        detail: 'a coordinating conversation is already live: it has to end before another one opens',
      })],
      [CoordinatingSessionOutcome.OPENING, () => new Refusal({
        status: 409,
        code: CoordinatingSessionOutcome.OPENING,
        detail: 'a coordinating conversation is being opened: wait for it to be live and try again',
      })],
    ])

  static of(outcome: CoordinatingSessionOutcomeValue): Refusal {
    return CoordinatingSessionRefusal.#BY_OUTCOME.of(outcome)()
  }
}

export class CoordinatingSessionRoute {
  static readonly PATH = '/coordinating-session'
  static readonly METHODS = 'GET, POST'
  static readonly #UNRESUMABLE_DETAIL =
    'claude code no longer holds this conversation: the coordinating session was not resumed'
  static readonly #ENDED_DETAIL =
    'the terminal of this coordinating session exited and no other one was opened'

  static reading(held: CoordinatingSessions): RequestHandler {
    return (request: Request, response: Response): void => {
      const holding = held.held()
      if (holding === null) {
        Answer.send(response, 200, { status: 'none' })
        return
      }
      CoordinatingSessionRoute.#answerHolding(response, holding)
    }
  }

  static #answerHolding(response: Response, holding: HeldCoordinatingSession): void {
    switch (holding.state) {
      case CoordinatingSessionState.LIVE:
        Answer.send(response, 200, {
          status: CoordinatingSessionState.LIVE,
          conversation: holding.conversation.id.text,
          repo: holding.conversation.repository.text,
          root: holding.conversation.root.text,
          session: { id: holding.session!.id, name: holding.session!.name },
          attention: { status: holding.attention!.status, question: holding.attention!.question },
        })
        return
      case CoordinatingSessionState.UNRESUMABLE:
        Answer.send(response, 200, {
          status: CoordinatingSessionState.UNRESUMABLE,
          conversation: holding.conversation.id.text,
          repo: holding.conversation.repository.text,
          root: holding.conversation.root.text,
          detail: CoordinatingSessionRoute.#UNRESUMABLE_DETAIL,
        })
        return
      case CoordinatingSessionState.ENDED:
        Answer.send(response, 200, {
          status: CoordinatingSessionState.ENDED,
          conversation: holding.conversation.id.text,
          repo: holding.conversation.repository.text,
          root: holding.conversation.root.text,
          detail: CoordinatingSessionRoute.#ENDED_DETAIL,
        })
        return
      default: {
        const exhaustive: never = holding.state
        throw new Error(`no coordinating session answer declared for ${exhaustive}`)
      }
    }
  }

  static opening(open: OpenCoordinatingSession, held: CoordinatingSessions): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const asked = PlanRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== PlanRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, PlanRefusal.of(asked))
        return
      }
      const reserved = held.reserve()
      if (reserved.outcome !== OpeningReservation.RESERVED) {
        CoordinatingSessionRoute.#refuseOpening(response, reserved)
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
        held.release()
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

  static readonly #OUTCOME_BY_RESERVATION: Projection<CoordinatingSessionOutcomeValue, OpeningReservationValue> =
    new Projection<CoordinatingSessionOutcomeValue, OpeningReservationValue>('opening refusal', [
      [OpeningReservation.LIVE_HELD, CoordinatingSessionOutcome.ALREADY_LIVE],
      [OpeningReservation.OPENING_IN_PROGRESS, CoordinatingSessionOutcome.OPENING],
    ])

  static #refuseOpening(response: Response, reserved: ReservedOpening): void {
    const refusal = CoordinatingSessionRefusal.of(
      CoordinatingSessionRoute.#OUTCOME_BY_RESERVATION.of(reserved.outcome)
    )
    Answer.send(response, refusal.status, {
      code: refusal.code,
      detail: refusal.detail,
      ...CoordinatingSessionRoute.#whatIsLive(reserved.live),
    })
  }

  static #whatIsLive(live: HeldCoordinatingSession | null): Record<string, unknown> {
    if (live === null) return {}

    return {
      conversation: live.conversation.id.text,
      session: { id: live.session!.id, name: live.session!.name },
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', CoordinatingSessionRoute.METHODS)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
