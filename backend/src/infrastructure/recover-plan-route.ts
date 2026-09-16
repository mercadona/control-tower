import type { Request, RequestHandler, Response } from 'express'
import { RecoverPlanParams, type RecoverPlan } from '../application/actions/recover-plan.ts'
import {
  PlanRecoveryConflict,
  PlanRecoveryFailure,
  PlanRecoveryNotFound,
  PlanRecoveryNotRead,
  PlanRecoveryNotUnderstood,
} from '../domain/exceptions.ts'
import { Answer, JsonBody, Refusal } from './http.ts'
import {
  MalformedPlanOperationRequest,
  PlanOperationRequest,
  type PlanProjectionRefresh,
} from './plan-operation-request.ts'
import { Projection } from './projection.ts'
import { Reservation, type WorkInFlight } from './work-in-flight.ts'

export const RecoverPlanOutcome = Object.freeze({
  INVALID_REQUEST: 'recover-plan-invalid-request',
  IN_PROGRESS: 'recover-plan-in-progress',
  NOT_FOUND: 'recover-plan-not-found',
  CONFLICT: 'recover-plan-conflict',
  FAILED: 'recover-plan-failed',
  UNREADABLE: 'recover-plan-unreadable',
} as const)

type PlanFailureClass = { readonly name: string, readonly prototype: PlanRecoveryFailure }
type RecoveryRefusalOf = (cause: PlanRecoveryFailure) => Refusal

export class RecoverPlanRoute {
  static readonly PATH = '/recover-plan'
  static readonly METHOD = 'POST'
  static readonly #BY_FAILURE = new Projection<RecoveryRefusalOf, PlanFailureClass>('recovery refusal', [
    [PlanRecoveryNotFound, RecoverPlanRoute.#collapsed(RecoverPlanOutcome.NOT_FOUND)],
    [PlanRecoveryConflict, RecoverPlanRoute.#collapsed(RecoverPlanOutcome.CONFLICT)],
    [PlanRecoveryNotRead, RecoverPlanRoute.#collapsed(RecoverPlanOutcome.FAILED)],
    [PlanRecoveryNotUnderstood, RecoverPlanRoute.#collapsed(RecoverPlanOutcome.UNREADABLE)],
  ])

  static handledBy(action: RecoverPlan, projection: PlanProjectionRefresh, inFlight: WorkInFlight): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      let asked: PlanOperationRequest
      try {
        asked = PlanOperationRequest.from(JsonBody.textOf(request))
      } catch (cause) {
        if (!(cause instanceof MalformedPlanOperationRequest)) throw cause
        Answer.refuse(response, 400, RecoverPlanOutcome.INVALID_REQUEST, String(cause))
        return
      }
      const key = asked.repository.text
      if (inFlight.reserve(key) !== Reservation.RESERVED) {
        Answer.refuse(response, 400, RecoverPlanOutcome.IN_PROGRESS, `work in ${key} is already in progress`)
        return
      }
      try {
        await action.execute(new RecoverPlanParams(asked))
        const refusal = await projection.recover()
        if (refusal !== null) throw new PlanRecoveryNotRead(refusal)
        Answer.send(response, 202, { agent: asked.agent })
      } catch (cause) {
        if (!(cause instanceof PlanRecoveryFailure)) throw cause
        Answer.refuseAs(response, RecoverPlanRoute.#refusalFor(cause))
      } finally {
        inFlight.release(key)
      }
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', RecoverPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }

  static declaredCodes(): readonly string[] {
    return Object.values(RecoverPlanOutcome)
  }

  static declaredFailures(): string[] {
    return RecoverPlanRoute.#BY_FAILURE.members().map((failure) => failure.name)
  }

  static #refusalFor(cause: PlanRecoveryFailure): Refusal {
    return RecoverPlanRoute.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static #collapsed(code: string): RecoveryRefusalOf {
    return (cause) => new Refusal({ status: 400, code, detail: cause.message })
  }
}
