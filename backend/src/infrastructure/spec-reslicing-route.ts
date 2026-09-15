import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { GateKey } from './gate-key.ts'
import { PlanCollapse } from './start-plan-route.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import { ReslicingOutcome, PublishReslicingParams } from '../application/actions/publish-reslicing.ts'
import { WorkInFlight, Reservation } from './work-in-flight.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import type {
  PublishReslicing, ReslicingPublished, ReslicingOutcomeValue,
} from '../application/actions/publish-reslicing.ts'

export const SpecReslicingOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  NOT_FROM_THE_PAGE: 'gate-not-from-the-page',
  NO_COORDINATING_SESSION: 'no-coordinating-session',
  NO_EPIC_SPEC: 'no-epic-spec',
  SPEC_NOT_FROZEN: 'spec-not-frozen',
  IN_PROGRESS: 'reslicing-in-progress',
} as const)

export type SpecReslicingOutcomeValue = (typeof SpecReslicingOutcome)[keyof typeof SpecReslicingOutcome]

export class SpecReslicingRefusal {
  static readonly #STATUS = 400

  static readonly #BY_OUTCOME: Projection<Refusal, ReslicingOutcomeValue> =
    new Projection<Refusal, ReslicingOutcomeValue>('refusal', [
      [ReslicingOutcome.NO_SPEC, new Refusal({
        status: SpecReslicingRefusal.#STATUS,
        code: SpecReslicingOutcome.NO_EPIC_SPEC,
        detail: 'no execution spec exists in this checkout to publish',
      })],
      [ReslicingOutcome.NOT_FROZEN, new Refusal({
        status: SpecReslicingRefusal.#STATUS,
        code: SpecReslicingOutcome.SPEC_NOT_FROZEN,
        detail: 'the spec is not frozen: gate 1 first',
      })],
    ])

  static of(published: ReslicingPublished): Refusal {
    return SpecReslicingRefusal.#BY_OUTCOME.of(published.outcome)
  }
}

export class SpecReslicingRoute {
  static readonly PATH = '/spec-reslicing'
  static readonly METHODS = 'POST'
  static readonly #STATUS = 'published'
  static readonly #NOT_FROM_THE_PAGE_DETAIL = 'gate 2 answers only a request carrying the key the page was given'
  static readonly #NO_COORDINATING_SESSION_DETAIL =
    'no coordinating session is held: there is no checkout whose slicing could be published'
  static readonly #IN_PROGRESS_DETAIL =
    'a publication of this slicing is under way: wait for it to answer before pressing again'

  static publishing(
    held: CoordinatingSessions, publish: PublishReslicing, key: GateKey, inFlight: WorkInFlight
  ): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      if (!key.holds(request.get(GateKey.HEADER))) {
        Answer.refuse(
          response, 403, SpecReslicingOutcome.NOT_FROM_THE_PAGE, SpecReslicingRoute.#NOT_FROM_THE_PAGE_DETAIL
        )
        return
      }
      const holding = held.held()
      if (holding === null) {
        Answer.refuse(
          response, 400,
          SpecReslicingOutcome.NO_COORDINATING_SESSION, SpecReslicingRoute.#NO_COORDINATING_SESSION_DETAIL
        )
        return
      }
      if (inFlight.reserve(holding.conversation.root.text) !== Reservation.RESERVED) {
        Answer.refuse(response, 409, SpecReslicingOutcome.IN_PROGRESS, SpecReslicingRoute.#IN_PROGRESS_DETAIL)
        return
      }
      let published: ReslicingPublished
      try {
        published = await publish.execute(new PublishReslicingParams({
          root: holding.conversation.root,
          repository: holding.conversation.repository,
        }))
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, PlanCollapse.of(cause))
        return
      } finally {
        inFlight.release(holding.conversation.root.text)
      }
      if (published.outcome !== ReslicingOutcome.PUBLISHED) {
        Answer.refuseAs(response, SpecReslicingRefusal.of(published))
        return
      }
      Answer.send(response, 200, {
        status: SpecReslicingRoute.#STATUS,
        pullRequest: published.pullRequest,
      })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SpecReslicingRoute.METHODS)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
