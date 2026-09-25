import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { GateKey } from './gate-key.ts'
import { PromoteEpic, PromoteEpicParams } from '../application/actions/promote-epic.ts'
import { EpicGroomState } from '../application/queries/read-epic-groom.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import { PlanCollapse } from './start-plan-route.ts'
import { CoordinatingSessionTarget } from './coordinating-session-target.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import type { EpicGroomStateValue } from '../application/queries/read-epic-groom.ts'
import type { EpicPromoted } from '../application/actions/promote-epic.ts'
import type { EpicIssue } from '../domain/value-objects/epic-issue.ts'

type WireIssue = { readonly number: number, readonly url: string, readonly title: string, readonly status: string }

export const EpicPromotionOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  NOT_FROM_THE_PAGE: 'gate-not-from-the-page',
  NO_EPIC_ISSUES: 'no-epic-issues',
  EPIC_PARTIALLY_GROOMED: 'epic-partially-groomed',
  ISSUES_UNCERTAIN: 'epic-issues-uncertain',
} as const)

export type EpicPromotionOutcomeValue = (typeof EpicPromotionOutcome)[keyof typeof EpicPromotionOutcome]

type EpicPromotionRefusalOf = (promoted: EpicPromoted) => Refusal

export class EpicPromotionRefusal {
  static readonly #STATUS = 400
  static readonly #NO_EPIC_ISSUES_DETAIL = 'the milestone holds no issue yet: the groom has to run first'

  static readonly #BY_STATE: Projection<EpicPromotionRefusalOf, EpicGroomStateValue> =
    new Projection<EpicPromotionRefusalOf, EpicGroomStateValue>('refusal', [
      ...[
        EpicGroomState.NO_SPEC, EpicGroomState.DRAFT, EpicGroomState.AWAITING_PUBLICATION, EpicGroomState.GROOMABLE,
      ].map((state) => [state, () => new Refusal({
        status: EpicPromotionRefusal.#STATUS,
        code: EpicPromotionOutcome.NO_EPIC_ISSUES,
        detail: EpicPromotionRefusal.#NO_EPIC_ISSUES_DETAIL,
      })] as const),
      [EpicGroomState.PARTIALLY_GROOMED, (promoted: EpicPromoted) => new Refusal({
        status: EpicPromotionRefusal.#STATUS,
        code: EpicPromotionOutcome.EPIC_PARTIALLY_GROOMED,
        detail: EpicPromotionRefusal.#partiallyGroomedDetail(promoted),
      })] as const,
      [EpicGroomState.ISSUES_UNCERTAIN, (promoted: EpicPromoted) => new Refusal({
        status: EpicPromotionRefusal.#STATUS,
        code: EpicPromotionOutcome.ISSUES_UNCERTAIN,
        detail: promoted.reason!,
      })] as const,
    ])

  static appliesTo(state: EpicGroomStateValue): boolean {
    return EpicPromotionRefusal.#BY_STATE.members().includes(state)
  }

  static of(promoted: EpicPromoted): Refusal {
    return EpicPromotionRefusal.#BY_STATE.of(promoted.state)(promoted)
  }

  static #partiallyGroomedDetail(promoted: EpicPromoted): string {
    const exists = promoted.issues.length
    const planned = promoted.plan?.issues.length ?? exists

    return `the milestone holds ${exists} of ${planned} issue(s): finish the groom before authorising`
  }
}

export class EpicPromotionRoute {
  static readonly PATH = '/epic-promotion'
  static readonly METHOD = 'POST'
  static readonly RECORD = 'gate 2 promotion'
  static readonly #NOT_FROM_THE_PAGE_DETAIL = 'gate 2 answers only a request carrying the key the page was given'

  static promoting(
    held: CoordinatingSessions, promote: PromoteEpic, key: GateKey, stderr: (line: string) => void
  ): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      if (!key.holds(request.get(GateKey.HEADER))) {
        Answer.refuse(response, 403, EpicPromotionOutcome.NOT_FROM_THE_PAGE, EpicPromotionRoute.#NOT_FROM_THE_PAGE_DETAIL)
        return
      }
      const holding = CoordinatingSessionTarget.admitted(request, response, held)
      if (holding === null) return
      let promoted: EpicPromoted
      try {
        promoted = await promote.execute(new PromoteEpicParams({
          root: holding.conversation.root,
          repository: holding.conversation.repository,
          story: holding.conversation.story,
        }))
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, PlanCollapse.of(cause))
        return
      }
      if (EpicPromotionRefusal.appliesTo(promoted.state)) {
        Answer.refuseAs(response, EpicPromotionRefusal.of(promoted))
        return
      }
      stderr(EpicPromotionRoute.#recordOf(promoted))
      Answer.send(response, 200, {
        status: promoted.state,
        milestone: promoted.milestone,
        issues: promoted.issues.map(EpicPromotionRoute.#wireIssueOf),
        promoted: promoted.promoted,
      })
    }
  }

  static #recordOf(promoted: EpicPromoted): string {
    const moved = promoted.promoted.length === 0 ? 'no issue' : promoted.promoted.join(', ')

    return `${EpicPromotionRoute.RECORD}: "${promoted.milestone}" holds ${promoted.issues.length} issue(s), moved ${moved} to status:ready\n`
  }

  static #wireIssueOf(issue: EpicIssue): WireIssue {
    return { number: issue.number, url: issue.url, title: issue.title, status: issue.status }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', EpicPromotionRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
