import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import {
  ReadSliceEscalationParams, type ReadSliceEscalationResult,
} from '../application/queries/read-slice-escalation.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import {
  EscalationFailure, SliceEscalationNotRead, SliceEscalationNotUnderstood,
} from '../domain/exceptions.ts'

export const EscalationRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  MALFORMED_ROOT: 'malformed-escalation-root',
  MALFORMED_ISSUE: 'malformed-escalation-issue',
} as const)

export type EscalationRequestOutcomeValue =
  (typeof EscalationRequestOutcome)[keyof typeof EscalationRequestOutcome]

type EscalationAsked = { readonly outcome: unknown }

type EscalationRefusalOf = (asked: EscalationAsked) => Refusal

type EscalationFailureConstructor = new (reason: string) => Error

type EscalationCollapseOf = (cause: Error) => Refusal

type SliceEscalationReader = {
  execute(params: ReadSliceEscalationParams): Promise<ReadSliceEscalationResult>,
}

export class EscalationRequest {
  static readonly ROOT_FIELD = 'root'
  static readonly #ISSUE_SHAPE = /^[1-9][0-9]*$/

  readonly outcome: EscalationRequestOutcomeValue
  readonly root: CheckoutRoot | null
  readonly issue: number | null

  constructor({ outcome, root, issue }: {
    outcome: EscalationRequestOutcomeValue,
    root: CheckoutRoot | null,
    issue: number | null,
  }) {
    this.outcome = outcome
    this.root = root
    this.issue = issue
    Object.freeze(this)
  }

  static accepted({ root, issue }: { root: CheckoutRoot, issue: number }): EscalationRequest {
    return new EscalationRequest({ outcome: EscalationRequestOutcome.ACCEPTED, root, issue })
  }

  static refused(outcome: EscalationRequestOutcomeValue): EscalationRequest {
    return new EscalationRequest({ outcome, root: null, issue: null })
  }

  static from(rawIssue: unknown, rawRoot: unknown): EscalationRequest {
    if (typeof rawIssue !== 'string' || !EscalationRequest.#ISSUE_SHAPE.test(rawIssue)) {
      return EscalationRequest.refused(EscalationRequestOutcome.MALFORMED_ISSUE)
    }
    if (!CheckoutRoot.isWellFormed(rawRoot)) {
      return EscalationRequest.refused(EscalationRequestOutcome.MALFORMED_ROOT)
    }

    return EscalationRequest.accepted({ root: new CheckoutRoot(rawRoot), issue: Number(rawIssue) })
  }
}

export class EscalationRefusal {
  static readonly #BY_OUTCOME: Projection<EscalationRefusalOf> = new Projection<EscalationRefusalOf>('refusal', [
    [EscalationRequestOutcome.MALFORMED_ROOT, () => new Refusal({
      status: 400,
      code: EscalationRequestOutcome.MALFORMED_ROOT,
      detail: `${EscalationRequest.ROOT_FIELD} is an absolute path such as ${CheckoutRoot.EXAMPLE}`,
    })],
    [EscalationRequestOutcome.MALFORMED_ISSUE, () => new Refusal({
      status: 400,
      code: EscalationRequestOutcome.MALFORMED_ISSUE,
      detail: `${SliceEscalationRoute.ISSUE_PARAMETER} must be a positive integer`,
    })],
  ])

  static of(asked: EscalationAsked): Refusal {
    return EscalationRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes(): unknown[] {
    return EscalationRefusal.#BY_OUTCOME.members()
  }
}

export class EscalationCollapse {
  static readonly #STATUS = 400

  static #collapsed(code: string): EscalationCollapseOf {
    return (cause) => new Refusal({ status: EscalationCollapse.#STATUS, code, detail: cause.message })
  }

  static readonly #BY_FAILURE: Projection<EscalationCollapseOf, EscalationFailureConstructor> =
    new Projection<EscalationCollapseOf, EscalationFailureConstructor>('refusal', [
      [SliceEscalationNotRead, EscalationCollapse.#collapsed('slice-escalation-not-read')],
      [SliceEscalationNotUnderstood, EscalationCollapse.#collapsed('slice-escalation-not-understood')],
    ])

  static of(cause: Error): Refusal {
    return EscalationCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static #declared(): EscalationFailureConstructor[] {
    return EscalationCollapse.#BY_FAILURE.members()
  }

  static declaredFailures(): string[] {
    return EscalationCollapse.#declared().map((failure) => failure.name)
  }

  static declaredCodes(): string[] {
    return EscalationCollapse.#declared().map((failure) => EscalationCollapse.of(new failure('x')).code)
  }
}

export class SliceEscalationRoute {
  static readonly PATH = '/slices/:issue/escalation'
  static readonly METHOD = 'GET'
  static readonly ISSUE_PARAMETER = 'issue'

  static handledBy(readSliceEscalation: SliceEscalationReader): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const asked = EscalationRequest.from(
        request.params[SliceEscalationRoute.ISSUE_PARAMETER],
        request.query[EscalationRequest.ROOT_FIELD],
      )
      if (asked.outcome !== EscalationRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, EscalationRefusal.of(asked))
        return
      }
      let read: ReadSliceEscalationResult
      try {
        read = await readSliceEscalation.execute(new ReadSliceEscalationParams({
          root: asked.root as CheckoutRoot, issue: asked.issue as number,
        }))
      } catch (cause) {
        if (!(cause instanceof EscalationFailure)) throw cause
        Answer.refuseAs(response, EscalationCollapse.of(cause))
        return
      }
      Answer.send(response, 200, {
        state: read.escalation.state,
        reason: read.escalation.reason,
        unblock: read.escalation.unblock,
        notes: read.escalation.notes,
        detail: read.escalation.detail,
      })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SliceEscalationRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
