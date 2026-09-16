import type { Request, RequestHandler, Response } from 'express'
import { CleanupPlanParams, type CleanupPlan } from '../application/actions/cleanup-plan.ts'
import {
  PlanAgentNotLaunched,
  PlanAgentNotNamed,
  PlanCleanupConflict,
  PlanCleanupFailure,
  PlanCleanupNotFound,
  PlanCleanupNotRead,
  PlanCleanupNotUnderstood,
  PlanFailure,
  PlanStatusNotRead,
  PlanStatusNotUnderstood,
} from '../domain/exceptions.ts'
import { Answer, JsonBody, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { PlanOperationRequest, type PlanProjectionRefresh } from './recover-plan-route.ts'
import { Reservation, type WorkInFlight } from './work-in-flight.ts'

export const CleanupPlanOutcome = Object.freeze({
  INVALID_REQUEST: 'cleanup-plan-invalid-request',
  IN_PROGRESS: 'cleanup-plan-in-progress',
  NOT_FOUND: 'cleanup-plan-not-found',
  CONFLICT: 'cleanup-plan-conflict',
  FAILED: 'cleanup-plan-failed',
  UNREADABLE: 'cleanup-plan-unreadable',
} as const)

type PlanFailureClass = { readonly name: string, readonly prototype: PlanFailure }
type CleanupRefusalOf = (cause: PlanFailure) => Refusal

export class CleanupPlanRoute {
  static readonly PATH = '/cleanup-plan'
  static readonly METHOD = 'POST'
  static readonly #BY_FAILURE = new Projection<CleanupRefusalOf, PlanFailureClass>('cleanup refusal', [
    [PlanCleanupNotFound, CleanupPlanRoute.#collapsed(CleanupPlanOutcome.NOT_FOUND)],
    [PlanCleanupConflict, CleanupPlanRoute.#collapsed(CleanupPlanOutcome.CONFLICT)],
    [PlanCleanupNotRead, CleanupPlanRoute.#collapsed(CleanupPlanOutcome.FAILED)],
    [PlanCleanupNotUnderstood, CleanupPlanRoute.#collapsed(CleanupPlanOutcome.UNREADABLE)],
    [PlanAgentNotLaunched, CleanupPlanRoute.#collapsed(CleanupPlanOutcome.FAILED)],
    [PlanAgentNotNamed, CleanupPlanRoute.#collapsed(CleanupPlanOutcome.UNREADABLE)],
    [PlanStatusNotRead, CleanupPlanRoute.#collapsed(CleanupPlanOutcome.FAILED)],
    [PlanStatusNotUnderstood, CleanupPlanRoute.#collapsed(CleanupPlanOutcome.UNREADABLE)],
  ])

  static handledBy(action: CleanupPlan, projection: PlanProjectionRefresh, inFlight: WorkInFlight): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      let asked: PlanOperationRequest
      try {
        asked = PlanOperationRequest.from(JsonBody.textOf(request))
      } catch (cause) {
        Answer.refuse(response, 400, CleanupPlanOutcome.INVALID_REQUEST, String(cause))
        return
      }
      const key = asked.repository.text
      if (inFlight.reserve(key) !== Reservation.RESERVED) {
        Answer.refuse(response, 400, CleanupPlanOutcome.IN_PROGRESS, `work in ${key} is already in progress`)
        return
      }
      try {
        await action.execute(new CleanupPlanParams(asked))
        const refusal = await projection.recover()
        if (refusal !== null) throw new PlanCleanupNotRead(refusal)
        Answer.send(response, 200, { agent: asked.agent })
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, CleanupPlanRoute.#refusalFor(cause))
      } finally {
        inFlight.release(key)
      }
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', CleanupPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }

  static declaredCodes(): readonly string[] {
    return Object.values(CleanupPlanOutcome)
  }

  static declaredFailures(): string[] {
    return CleanupPlanRoute.#BY_FAILURE.members().map((failure) => failure.name)
  }

  static #refusalFor(cause: PlanFailure): Refusal {
    return CleanupPlanRoute.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static #collapsed(code: string): CleanupRefusalOf {
    return (cause) => new Refusal({ status: 400, code, detail: cause.message })
  }
}
