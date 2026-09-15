import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { EpicGroomState, ReadEpicGroomParams } from '../application/queries/read-epic-groom.ts'
import { GateKey } from './gate-key.ts'
import { GroomEpic, GroomEpicParams } from '../application/actions/groom-epic.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import { PlanCollapse } from './start-plan-route.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import type { ReadEpicGroom, EpicGroomRead, EpicGroomStateValue } from '../application/queries/read-epic-groom.ts'
import type { EpicGroomed } from '../application/actions/groom-epic.ts'
import type { GroomPlanIssue } from '../domain/value-objects/groom-plan.ts'
import type { EpicIssue } from '../domain/value-objects/epic-issue.ts'

type WirePlanIssue = { readonly order: number, readonly title: string, readonly labels: readonly string[] }
type WireIssue = { readonly number: number, readonly url: string, readonly title: string, readonly status: string }

export const EpicGroomOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  NOT_FROM_THE_PAGE: 'gate-not-from-the-page',
  NO_COORDINATING_SESSION: 'no-coordinating-session',
  NO_EPIC_SPEC: 'no-epic-spec',
  SPEC_NOT_FROZEN: 'spec-not-frozen',
  SPEC_NOT_PUBLISHED: 'spec-not-published',
} as const)

export type EpicGroomOutcomeValue = (typeof EpicGroomOutcome)[keyof typeof EpicGroomOutcome]

type EpicGroomRefusalOf = () => Refusal

export class EpicGroomRefusal {
  static readonly #STATUS = 400
  static readonly #NO_EPIC_SPEC_DETAIL = 'no execution spec exists in this checkout to groom'
  static readonly #SPEC_NOT_FROZEN_DETAIL = 'the spec is not frozen: gate 1 first'
  static readonly #SPEC_NOT_PUBLISHED_DETAIL =
    'the spec is frozen, but its committed copy is not yet readable on the default branch'

  static readonly #BY_STATE: Projection<EpicGroomRefusalOf, EpicGroomStateValue> =
    new Projection<EpicGroomRefusalOf, EpicGroomStateValue>('refusal', [
      [EpicGroomState.NO_SPEC, () => new Refusal({
        status: EpicGroomRefusal.#STATUS,
        code: EpicGroomOutcome.NO_EPIC_SPEC,
        detail: EpicGroomRefusal.#NO_EPIC_SPEC_DETAIL,
      })],
      [EpicGroomState.DRAFT, () => new Refusal({
        status: EpicGroomRefusal.#STATUS,
        code: EpicGroomOutcome.SPEC_NOT_FROZEN,
        detail: EpicGroomRefusal.#SPEC_NOT_FROZEN_DETAIL,
      })],
      [EpicGroomState.AWAITING_PUBLICATION, () => new Refusal({
        status: EpicGroomRefusal.#STATUS,
        code: EpicGroomOutcome.SPEC_NOT_PUBLISHED,
        detail: EpicGroomRefusal.#SPEC_NOT_PUBLISHED_DETAIL,
      })],
    ])

  static of(groomed: EpicGroomed): Refusal {
    return EpicGroomRefusal.#BY_STATE.of(groomed.state)()
  }
}

export class EpicGroomRoute {
  static readonly PATH = '/epic-groom'
  static readonly METHODS = 'GET, POST'
  static readonly RECORD = 'gate 2 groom'
  static readonly NO_PLAN_ON_THIS_PRESS = 'no plan on this press'
  static readonly #NOT_FROM_THE_PAGE_DETAIL = 'gate 2 answers only a request carrying the key the page was given'
  static readonly #NO_COORDINATING_SESSION_DETAIL = 'no coordinating session is held: there is nothing to groom'

  static reading(held: CoordinatingSessions, read: ReadEpicGroom, key: GateKey): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const holding = held.held()
      if (holding === null) {
        Answer.send(response, 200, { status: 'none' })
        return
      }
      let outcome: EpicGroomRead
      try {
        outcome = await read.execute(new ReadEpicGroomParams({
          root: holding.conversation.root,
          repository: holding.conversation.repository,
        }))
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, PlanCollapse.of(cause))
        return
      }
      const minted = key.forThePage({
        origin: request.get('Origin'),
        host: request.get('Host'),
        site: request.get(GateKey.SITE_HEADER),
      })
      EpicGroomRoute.#answerRead(response, outcome, minted)
    }
  }

  static grooming(
    held: CoordinatingSessions, groom: GroomEpic, key: GateKey, stderr: (line: string) => void
  ): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      if (!key.holds(request.get(GateKey.HEADER))) {
        Answer.refuse(response, 403, EpicGroomOutcome.NOT_FROM_THE_PAGE, EpicGroomRoute.#NOT_FROM_THE_PAGE_DETAIL)
        return
      }
      const holding = held.held()
      if (holding === null) {
        Answer.refuse(response, 400, EpicGroomOutcome.NO_COORDINATING_SESSION, EpicGroomRoute.#NO_COORDINATING_SESSION_DETAIL)
        return
      }
      let groomed: EpicGroomed
      try {
        groomed = await groom.execute(new GroomEpicParams({
          root: holding.conversation.root,
          repository: holding.conversation.repository,
        }))
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, PlanCollapse.of(cause))
        return
      }
      if (GroomEpic.REFUSED.includes(groomed.state)) {
        Answer.refuseAs(response, EpicGroomRefusal.of(groomed))
        return
      }
      stderr(EpicGroomRoute.#recordOf(groomed))
      Answer.send(response, 200, {
        status: groomed.state,
        milestone: groomed.milestone,
        issues: groomed.issues.map(EpicGroomRoute.#wireIssueOf),
      })
    }
  }

  static #recordOf(groomed: EpicGroomed): string {
    const planned = groomed.plan === null
      ? EpicGroomRoute.NO_PLAN_ON_THIS_PRESS
      : `planned ${groomed.plan.issues.length} issue(s)`

    return `${EpicGroomRoute.RECORD}: "${groomed.milestone}" ${planned}, holds ${groomed.issues.length} now\n`
  }

  static #answerRead(response: Response, outcome: EpicGroomRead, minted: string | null): void {
    switch (outcome.state) {
      case EpicGroomState.NO_SPEC:
        Answer.send(response, 200, { status: EpicGroomState.NO_SPEC })
        return
      case EpicGroomState.DRAFT:
        Answer.send(response, 200, { status: EpicGroomState.DRAFT })
        return
      case EpicGroomState.AWAITING_PUBLICATION:
        Answer.send(response, 200, { status: EpicGroomState.AWAITING_PUBLICATION })
        return
      case EpicGroomState.GROOMABLE:
        Answer.send(response, 200, {
          status: EpicGroomState.GROOMABLE,
          milestone: outcome.milestone,
          plan: { issues: outcome.plan!.issues.map(EpicGroomRoute.#wirePlanIssueOf) },
          ...(minted === null ? {} : { key: minted }),
        })
        return
      case EpicGroomState.GROOMED:
        Answer.send(response, 200, {
          status: EpicGroomState.GROOMED,
          milestone: outcome.milestone,
          issues: outcome.issues.map(EpicGroomRoute.#wireIssueOf),
          ...(minted === null ? {} : { key: minted }),
        })
        return
      case EpicGroomState.AUTHORISED:
        Answer.send(response, 200, {
          status: EpicGroomState.AUTHORISED,
          milestone: outcome.milestone,
          issues: outcome.issues.map(EpicGroomRoute.#wireIssueOf),
        })
        return
      default: {
        const exhaustive: never = outcome.state
        throw new Error(`no epic groom answer declared for ${exhaustive}`)
      }
    }
  }

  static #wirePlanIssueOf(issue: GroomPlanIssue): WirePlanIssue {
    return { order: issue.order, title: issue.title, labels: issue.labels }
  }

  static #wireIssueOf(issue: EpicIssue): WireIssue {
    return { number: issue.number, url: issue.url, title: issue.title, status: issue.status }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', EpicGroomRoute.METHODS)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
