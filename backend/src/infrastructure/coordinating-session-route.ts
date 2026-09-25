import type { Request, RequestHandler, Response } from 'express'
import { Answer, JsonBody, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { PlanRequest, PlanRequestOutcome, PlanRefusal, PlanCollapse } from './start-plan-route.ts'
import {
  HeldCoordinatingSession, CoordinatingOperation, CoordinatingSessionState, OpeningReservation,
} from './coordinating-sessions.ts'
import { CoordinatingSessionOpening, OpenCoordinatingSessionParams } from '../application/actions/open-coordinating-session.ts'
import { SessionAttention } from '../domain/value-objects/session-attention.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import type { CoordinatingSessions, OpeningReservationValue, ReservedOpening } from './coordinating-sessions.ts'
import type { CoordinatingSessionOpened, OpenCoordinatingSession } from '../application/actions/open-coordinating-session.ts'
import type { SessionTimelineEvent } from '../domain/value-objects/session-timeline-event.ts'
import type { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'

export const CoordinatingSessionOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  ALREADY_LIVE: 'coordinating-session-already-live',
  OPENING: 'coordinating-session-opening',
  STORY_SPEC_FROZEN: 'story-spec-frozen',
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
        Answer.send(response, 200, { status: 'none', operation: held.operation() })
        return
      }
      CoordinatingSessionRoute.#answerHolding(response, holding, held.timeline(), held.operation(), held.closureError())
    }
  }

  static #timelineOf(timeline: readonly SessionTimelineEvent[]): unknown[] {
    return timeline.map((event) => ({ id: event.id, kind: event.kind, at: event.at, detail: event.detail }))
  }

  static #answerHolding(
    response: Response,
    holding: HeldCoordinatingSession,
    timeline: readonly SessionTimelineEvent[],
    operation: ReturnType<CoordinatingSessions['operation']>,
    closureError: ReturnType<CoordinatingSessions['closureError']>,
  ): void {
    const lifecycle = {
      operation,
      target: holding.target,
      ...(operation === CoordinatingOperation.CLOSE_FAILED && closureError !== null
        ? { closureError: { code: closureError.code, detail: closureError.detail } }
        : {}),
    }
    switch (holding.state) {
      case CoordinatingSessionState.LIVE:
        Answer.send(response, 200, {
          status: CoordinatingSessionState.LIVE,
          ...lifecycle,
          conversation: holding.conversation.id.text,
          repo: holding.conversation.repository.text,
          story: holding.conversation.story.text,
          root: holding.conversation.root.text,
          session: { id: holding.session!.id, name: holding.session!.name },
          attention: { status: holding.attention!.status, question: holding.attention!.question },
          timeline: CoordinatingSessionRoute.#timelineOf(timeline),
        })
        return
      case CoordinatingSessionState.UNRESUMABLE:
        Answer.send(response, 200, {
          status: CoordinatingSessionState.UNRESUMABLE,
          ...lifecycle,
          conversation: holding.conversation.id.text,
          repo: holding.conversation.repository.text,
          story: holding.conversation.story.text,
          root: holding.conversation.root.text,
          detail: CoordinatingSessionRoute.#UNRESUMABLE_DETAIL,
          timeline: CoordinatingSessionRoute.#timelineOf(timeline),
        })
        return
      case CoordinatingSessionState.ENDED:
        Answer.send(response, 200, {
          status: CoordinatingSessionState.ENDED,
          ...lifecycle,
          conversation: holding.conversation.id.text,
          repo: holding.conversation.repository.text,
          story: holding.conversation.story.text,
          root: holding.conversation.root.text,
          detail: CoordinatingSessionRoute.#ENDED_DETAIL,
          timeline: CoordinatingSessionRoute.#timelineOf(timeline),
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
      let opened: CoordinatingSessionOpened
      try {
        opened = await open.execute(new OpenCoordinatingSessionParams({
          story: asked.story!,
          root: asked.root!,
        }))
      } catch (cause) {
        held.release()
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, PlanCollapse.of(cause))
        return
      }
      switch (opened.outcome) {
        case CoordinatingSessionOpening.STORY_SPEC_FROZEN:
          held.release()
          Answer.refuse(
            response, 400, CoordinatingSessionOutcome.STORY_SPEC_FROZEN, CoordinatingSessionRoute.#frozenDetail(asked.story!, opened)
          )
          return
        case CoordinatingSessionOpening.OPENED:
          break
        default: {
          const exhaustive: never = opened.outcome
          throw new Error(`no answer declared for the opening outcome ${exhaustive}`)
        }
      }
      const sessionTarget = held.mintTarget()
      held.remember(new HeldCoordinatingSession({
        target: sessionTarget,
        state: CoordinatingSessionState.LIVE,
        conversation: opened.conversation!,
        session: opened.session!,
        attention: SessionAttention.working(),
      }), opened.timeline)
      Answer.send(response, 202, {
        status: 'brainstorming',
        conversation: opened.conversation!.id.text,
        target: sessionTarget,
        repo: opened.conversation!.repository.text,
        story: opened.conversation!.story.text,
        root: opened.conversation!.root.text,
        session: { id: opened.session!.id, name: opened.session!.name },
      })
    }
  }

  static #frozenDetail(story: UserStoryKey | UserStoryUrl, opened: CoordinatingSessionOpened): string {
    return `${story.text} already has its execution spec frozen at ${opened.frozen!.path}: its brainstorming is over, continue with the groom`
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
      target: live.target,
      ...(live.session === null ? {} : { session: { id: live.session.id, name: live.session.name } }),
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', CoordinatingSessionRoute.METHODS)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
