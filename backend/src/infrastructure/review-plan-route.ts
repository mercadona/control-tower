import { Answer, JsonBody, Refusal } from './http.ts'
import { ActivePlanPhase } from './active-plans-route.ts'
import { Projection } from './projection.ts'
import { AskPlanChangesParams } from '../application/actions/ask-plan-changes.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { PlanChangesFailure } from '../domain/exceptions.ts'
import type { Request, Response } from 'express'
import type { ActivePlans } from './active-plans-route.js'

export const ReviewRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ISSUE: 'malformed-issue',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_CHANGES: 'malformed-changes',
  NO_LIVE_SESSION: 'no-live-planning-session',
  ALREADY_IMPLEMENTING: 'plan-already-being-implemented',
  UNCERTAIN_PHASE: 'implementation-phase-uncertain',
} as const)

export type ReviewRequestOutcome = typeof ReviewRequestOutcome[keyof typeof ReviewRequestOutcome]

export type AskPlanChangesAction = { execute(params: AskPlanChangesParams): Promise<void> }

type AcceptedReviewRequest = ReviewRequest & {
  readonly issue: number,
  readonly repository: RepositoryName,
  readonly changes: string,
}

class ReviewRequest {
  static readonly ISSUE_FIELD = 'issue'
  static readonly REPO_FIELD = 'repo'
  static readonly CHANGES_FIELD = 'changes'
  static readonly #FORBIDDEN_CONTROL = /[^\P{Cc}\n\r\t]/u
  static readonly KNOWN_FIELDS: readonly string[] = Object.freeze([
    ReviewRequest.ISSUE_FIELD, ReviewRequest.REPO_FIELD, ReviewRequest.CHANGES_FIELD,
  ])

  readonly outcome: ReviewRequestOutcome
  readonly issue: number | null
  readonly repository: RepositoryName | null
  readonly changes: string | null
  readonly fields: readonly string[]

  constructor({ outcome, issue, repository, changes, fields }: {
    outcome: ReviewRequestOutcome,
    issue: number | null,
    repository: RepositoryName | null,
    changes: string | null,
    fields: readonly string[],
  }) {
    this.outcome = outcome
    this.issue = issue
    this.repository = repository
    this.changes = changes
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted({ issue, repository, changes }: {
    issue: number,
    repository: RepositoryName,
    changes: string,
  }): ReviewRequest {
    return new ReviewRequest({
      outcome: ReviewRequestOutcome.ACCEPTED, issue, repository, changes, fields: [],
    })
  }

  static refused(outcome: ReviewRequestOutcome): ReviewRequest {
    return new ReviewRequest({
      outcome, issue: null, repository: null, changes: null, fields: [],
    })
  }

  static withUnknownFields(fields: readonly string[]): ReviewRequest {
    return new ReviewRequest({
      outcome: ReviewRequestOutcome.UNKNOWN_FIELD,
      issue: null, repository: null, changes: null, fields,
    })
  }

  static isAccepted(asked: ReviewRequest): asked is AcceptedReviewRequest {
    return asked.outcome === ReviewRequestOutcome.ACCEPTED
  }

  static #isFieldMap(given: unknown): given is Record<string, unknown> {
    return given !== null && typeof given === 'object' && !Array.isArray(given)
  }

  static #isWellFormedIssue(given: unknown): given is number {
    return typeof given === 'number' && Number.isInteger(given) && given >= 1
  }

  static #isWellFormedChanges(given: unknown): given is string {
    return typeof given === 'string' &&
      given.trim().length > 0 &&
      !ReviewRequest.#FORBIDDEN_CONTROL.test(given)
  }

  static from(raw: string): ReviewRequest {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return ReviewRequest.refused(ReviewRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (!ReviewRequest.#isFieldMap(parsed)) {
      return ReviewRequest.refused(ReviewRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter(
      (field) => !ReviewRequest.KNOWN_FIELDS.includes(field)
    )
    if (unknown.length > 0) {
      return ReviewRequest.withUnknownFields(unknown.sort())
    }
    const issue = parsed[ReviewRequest.ISSUE_FIELD]
    const repository = parsed[ReviewRequest.REPO_FIELD]
    const changes = parsed[ReviewRequest.CHANGES_FIELD]
    if (!ReviewRequest.#isWellFormedIssue(issue)) {
      return ReviewRequest.refused(ReviewRequestOutcome.MALFORMED_ISSUE)
    }
    if (!RepositoryName.isWellFormed(repository)) {
      return ReviewRequest.refused(ReviewRequestOutcome.MALFORMED_REPO)
    }
    if (!ReviewRequest.#isWellFormedChanges(changes)) {
      return ReviewRequest.refused(ReviewRequestOutcome.MALFORMED_CHANGES)
    }

    return ReviewRequest.accepted({
      issue,
      repository: new RepositoryName(repository),
      changes: changes.trim(),
    })
  }
}

type RefusalOf = (asked: ReviewRequest) => Refusal

export class ReviewRefusal {
  static readonly #BY_OUTCOME: Projection<RefusalOf> = new Projection<RefusalOf>('refusal', [
    [ReviewRequestOutcome.BODY_NOT_A_JSON_OBJECT, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.BODY_NOT_A_JSON_OBJECT,
      detail: 'body must be a JSON object',
    })],
    [ReviewRequestOutcome.UNKNOWN_FIELD, (asked) => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.UNKNOWN_FIELD,
      detail: `unknown field: ${asked.fields.join(', ')}`,
    })],
    [ReviewRequestOutcome.MALFORMED_ISSUE, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.MALFORMED_ISSUE,
      detail: `${ReviewRequest.ISSUE_FIELD} must be a whole number from one`,
    })],
    [ReviewRequestOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.MALFORMED_REPO,
      detail: `${ReviewRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
    [ReviewRequestOutcome.MALFORMED_CHANGES, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.MALFORMED_CHANGES,
      detail: `${ReviewRequest.CHANGES_FIELD} must say what to change`,
    })],
    [ReviewRequestOutcome.NO_LIVE_SESSION, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.NO_LIVE_SESSION,
      detail: 'no matching live planning session exists, so nobody would read the changes',
    })],
    [ReviewRequestOutcome.ALREADY_IMPLEMENTING, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.ALREADY_IMPLEMENTING,
      detail: 'the plan is already being implemented, so its review watch is gone',
    })],
    [ReviewRequestOutcome.UNCERTAIN_PHASE, () => new Refusal({
      status: 400,
      code: ReviewRequestOutcome.UNCERTAIN_PHASE,
      detail: 'implementation may have started; inspect the plan before retrying',
    })],
  ])

  static of(asked: ReviewRequest): Refusal {
    return ReviewRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes(): unknown[] {
    return ReviewRefusal.#BY_OUTCOME.members()
  }
}

export class ReviewPhases {
  static readonly #BY_PHASE: Projection<ReviewRequestOutcome> =
    new Projection<ReviewRequestOutcome>('review outcome', [
      [ActivePlanPhase.PLANNING, ReviewRequestOutcome.ACCEPTED],
      [ActivePlanPhase.IMPLEMENTING, ReviewRequestOutcome.ALREADY_IMPLEMENTING],
      [ActivePlanPhase.UNCERTAIN, ReviewRequestOutcome.UNCERTAIN_PHASE],
    ])

  static outcomeFor(phase: unknown): ReviewRequestOutcome {
    return ReviewPhases.#BY_PHASE.of(phase)
  }

  static declaredPhases(): unknown[] {
    return ReviewPhases.#BY_PHASE.members()
  }
}

export class ReviewCollapse {
  static readonly CODE = 'plan-changes-not-asked'

  static of(cause: Error): Refusal {
    return new Refusal({ status: 400, code: ReviewCollapse.CODE, detail: cause.message })
  }
}

export class ReviewPlanRoute {
  static readonly PATH = '/review-plan'
  static readonly METHOD = 'POST'

  static handledBy(
    askPlanChanges: AskPlanChangesAction, activePlans: ActivePlans
  ): (request: Request, response: Response) => Promise<void> {
    return async (request, response) => {
      const asked = ReviewRequest.from(JsonBody.textOf(request))
      if (!ReviewRequest.isAccepted(asked)) {
        Answer.refuseAs(response, ReviewRefusal.of(asked))
        return
      }
      const active = activePlans.find({ issue: asked.issue, repository: asked.repository })
      if (active === null) {
        Answer.refuseAs(response, ReviewRefusal.of(
          ReviewRequest.refused(ReviewRequestOutcome.NO_LIVE_SESSION)
        ))
        return
      }
      const phased = ReviewPhases.outcomeFor(active.phase)
      if (phased !== ReviewRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, ReviewRefusal.of(ReviewRequest.refused(phased)))
        return
      }
      try {
        await askPlanChanges.execute(new AskPlanChangesParams({
          issue: active.watch.issue, repository: asked.repository, changes: asked.changes,
        }))
      } catch (cause) {
        if (!(cause instanceof PlanChangesFailure)) throw cause
        Answer.refuseAs(response, ReviewCollapse.of(cause))
        return
      }
      Answer.send(response, 202, { status: 'changes-asked', [ReviewRequest.ISSUE_FIELD]: asked.issue })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', ReviewPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
