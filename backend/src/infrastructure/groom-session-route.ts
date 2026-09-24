import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { GateKey } from './gate-key.ts'
import { PlanCollapse } from './start-plan-route.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import { GroomSessionOpening, OpenGroomSessionParams } from '../application/actions/open-groom-session.ts'
import { AskGroomReviewParams, GroomReviewAsk } from '../application/actions/ask-groom-review.ts'
import {
  HeldCoordinatingSession, CoordinatingSessionState, OpeningReservation,
} from './coordinating-sessions.ts'
import { SessionAttention } from '../domain/value-objects/session-attention.ts'
import { GroomReviewRefusal } from '../domain/ports/groom-review-admission.ts'
import type { GroomReviewRefusalValue } from '../domain/ports/groom-review-admission.ts'
import { LiveSessionNotLive } from '../domain/ports/live-sessions.ts'
import { CoordinatingSessionTarget } from './coordinating-session-target.ts'
import type { CoordinatingSessions, OpeningReservationValue } from './coordinating-sessions.ts'
import type { AskGroomReview, GroomReviewAsked } from '../application/actions/ask-groom-review.ts'
import type { GroomSessionOpened, OpenGroomSession } from '../application/actions/open-groom-session.ts'

export const GroomSessionOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  NOT_FROM_THE_PAGE: 'gate-not-from-the-page',
  NO_COORDINATING_SESSION: 'no-coordinating-session',
  NO_EPIC_SPEC: 'no-epic-spec',
  ALREADY_LIVE: 'coordinating-session-already-live',
  OPENING: 'coordinating-session-opening',
  WORKING: 'coordinating-session-working',
  AWAITING_PERMISSION: 'coordinating-session-awaiting-permission',
  TURN_NOT_FINISHED: 'coordinating-session-turn-not-finished',
  NOT_LIVE: 'coordinating-session-not-live',
} as const)

export type GroomSessionOutcomeValue = (typeof GroomSessionOutcome)[keyof typeof GroomSessionOutcome]

export class GroomSessionRefusal {
  static readonly #BY_RESERVATION: Projection<Refusal, OpeningReservationValue> =
    new Projection<Refusal, OpeningReservationValue>('refusal', [
      [OpeningReservation.LIVE_HELD, new Refusal({
        status: 409,
        code: GroomSessionOutcome.ALREADY_LIVE,
        detail: 'a coordinating conversation is already live: it has to end before the groom conversation opens',
      })],
      [OpeningReservation.OPENING_IN_PROGRESS, new Refusal({
        status: 409,
        code: GroomSessionOutcome.OPENING,
        detail: 'a coordinating conversation is being opened: wait for it to be live and try again',
      })],
    ])

  static of(reservation: OpeningReservationValue): Refusal {
    return GroomSessionRefusal.#BY_RESERVATION.of(reservation)
  }
}

export class GroomSessionRoute {
  static readonly PATH = '/groom-session'
  static readonly METHODS = 'POST'
  static readonly #STATUS = 'grooming'
  static readonly #TYPED = 'typed'
  static readonly #WORKING_DETAIL =
    'the coordinating conversation is working: what is typed now would land in the middle of its turn'
  static readonly #AWAITING_PERMISSION_DETAIL =
    'the coordinating conversation is waiting for a permission: '
    + 'what is typed now would answer that prompt instead of asking for the review'
  static readonly #TURN_NOT_FINISHED_DETAIL =
    'the coordinating conversation has not reported finishing a turn: '
    + 'what its terminal is showing now is unknown'
  static readonly #NOT_LIVE_DETAIL =
    'the coordinating conversation is no longer live: nothing was typed into it'
  static readonly #NOT_FROM_THE_PAGE_DETAIL = 'gate 2 answers only a request carrying the key the page was given'
  static readonly #NO_COORDINATING_SESSION_DETAIL =
    'no coordinating session is held: there is no checkout to open the groom conversation in'
  static readonly #NO_EPIC_SPEC_DETAIL = 'no execution spec exists in this checkout to talk about'

  static opening(
    held: CoordinatingSessions, open: OpenGroomSession, key: GateKey, ask: AskGroomReview
  ): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      if (!key.holds(request.get(GateKey.HEADER))) {
        Answer.refuse(response, 403, GroomSessionOutcome.NOT_FROM_THE_PAGE, GroomSessionRoute.#NOT_FROM_THE_PAGE_DETAIL)
        return
      }
      const holding = CoordinatingSessionTarget.admitted(request, response, held)
      if (holding === null) return
      if (holding.state === CoordinatingSessionState.LIVE) {
        await GroomSessionRoute.#askTheLiveOne(held, ask, response, holding)
        return
      }
      const reserved = held.reserve()
      if (reserved.outcome !== OpeningReservation.RESERVED) {
        Answer.refuseAs(response, GroomSessionRefusal.of(reserved.outcome))
        return
      }
      await GroomSessionRoute.#accept(held, open, response, holding)
    }
  }

  static async #askTheLiveOne(
    held: CoordinatingSessions, ask: AskGroomReview, response: Response, holding: HeldCoordinatingSession
  ): Promise<void> {
    const refusal = held.refusalFor({ target: holding.target, session: holding.session! })
    if (refusal !== null) {
      GroomSessionRoute.#refuseAsk(response, refusal, held)
      return
    }
    let asked: GroomReviewAsked
    try {
      asked = await ask.execute(new AskGroomReviewParams({
        root: holding.conversation.root,
        session: holding.session!,
        target: holding.target,
      }))
    } catch (cause) {
      if (cause instanceof LiveSessionNotLive) {
        Answer.refuse(response, 409, GroomSessionOutcome.NOT_LIVE, GroomSessionRoute.#NOT_LIVE_DETAIL)
        return
      }
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, PlanCollapse.of(cause))
      return
    }
    if (asked.outcome === GroomReviewAsk.NO_SPEC) {
      Answer.refuse(response, 400, GroomSessionOutcome.NO_EPIC_SPEC, GroomSessionRoute.#NO_EPIC_SPEC_DETAIL)
      return
    }
    if (asked.outcome === GroomReviewAsk.REFUSED) {
      GroomSessionRoute.#refuseAsk(response, asked.refusal!, held)
      return
    }
    Answer.send(response, 202, {
      status: GroomSessionRoute.#TYPED,
      target: holding.target,
      conversation: holding.conversation.id.text,
      repo: holding.conversation.repository.text,
      root: holding.conversation.root.text,
      session: { id: holding.session!.id, name: holding.session!.name },
    })
  }

  static #refuseAsk(response: Response, refusal: GroomReviewRefusalValue, held: CoordinatingSessions): void {
    switch (refusal) {
      case GroomReviewRefusal.TARGET_CHANGED:
        Answer.refuse(response, 400, CoordinatingSessionTarget.CHANGED,
          'the coordinating session target changed: refresh before acting')
        return
      case GroomReviewRefusal.BUSY:
        Answer.refuse(response, 409, CoordinatingSessionTarget.BUSY,
          `the coordinating session is ${held.operation()}: wait for it to settle before acting`)
        return
      case GroomReviewRefusal.NOT_LIVE:
        Answer.refuse(response, 409, GroomSessionOutcome.NOT_LIVE, GroomSessionRoute.#NOT_LIVE_DETAIL)
        return
      case GroomReviewRefusal.AWAITING_PERMISSION:
        Answer.refuse(response, 409, GroomSessionOutcome.AWAITING_PERMISSION, GroomSessionRoute.#AWAITING_PERMISSION_DETAIL)
        return
      case GroomReviewRefusal.WORKING:
        Answer.refuse(response, 409, GroomSessionOutcome.WORKING, GroomSessionRoute.#WORKING_DETAIL)
        return
      case GroomReviewRefusal.TURN_NOT_FINISHED:
        Answer.refuse(response, 409, GroomSessionOutcome.TURN_NOT_FINISHED, GroomSessionRoute.#TURN_NOT_FINISHED_DETAIL)
        return
      default: {
        const exhaustive: never = refusal
        throw new Error(`no groom review refusal declared for ${exhaustive}`)
      }
    }
  }

  static async #accept(
    held: CoordinatingSessions, open: OpenGroomSession, response: Response, holding: HeldCoordinatingSession
  ): Promise<void> {
    let opened: GroomSessionOpened
    try {
      opened = await open.execute(new OpenGroomSessionParams({
        repository: holding.conversation.repository,
        root: holding.conversation.root,
      }))
    } catch (cause) {
      held.release()
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, PlanCollapse.of(cause))
      return
    }
    if (opened.outcome === GroomSessionOpening.NO_SPEC) {
      held.release()
      Answer.refuse(response, 400, GroomSessionOutcome.NO_EPIC_SPEC, GroomSessionRoute.#NO_EPIC_SPEC_DETAIL)
      return
    }
    held.remember(new HeldCoordinatingSession({
      target: held.mintTarget(),
      state: CoordinatingSessionState.LIVE,
      conversation: opened.conversation!,
      session: opened.session!,
      attention: SessionAttention.working(),
    }), opened.timeline)
    Answer.send(response, 202, {
      status: GroomSessionRoute.#STATUS,
      target: held.held()!.target,
      conversation: opened.conversation!.id.text,
      repo: opened.conversation!.repository.text,
      root: opened.conversation!.root.text,
      session: { id: opened.session!.id, name: opened.session!.name },
    })
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', GroomSessionRoute.METHODS)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
