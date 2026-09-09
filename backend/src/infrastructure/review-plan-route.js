import { Answer, JsonBody, Refusal } from './http.js'
import { ActivePlanPhase } from './active-plans-route.js'
import { Projection } from './projection.js'
import { AskPlanChangesParams } from '../application/actions/ask-plan-changes.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { PlanChangesFailure } from '../domain/exceptions.js'

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
})

class ReviewRequest {
  static ISSUE_FIELD = 'issue'
  static REPO_FIELD = 'repo'
  static CHANGES_FIELD = 'changes'
  static #FORBIDDEN_CONTROL = /[^\P{Cc}\n\r\t]/u
  static KNOWN_FIELDS = Object.freeze([
    ReviewRequest.ISSUE_FIELD, ReviewRequest.REPO_FIELD, ReviewRequest.CHANGES_FIELD,
  ])

  constructor({ outcome, issue, repository, changes, fields }) {
    this.outcome = outcome
    this.issue = issue
    this.repository = repository
    this.changes = changes
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted({ issue, repository, changes }) {
    return new ReviewRequest({
      outcome: ReviewRequestOutcome.ACCEPTED, issue, repository, changes, fields: [],
    })
  }

  static refused(outcome) {
    return new ReviewRequest({
      outcome, issue: null, repository: null, changes: null, fields: [],
    })
  }

  static withUnknownFields(fields) {
    return new ReviewRequest({
      outcome: ReviewRequestOutcome.UNKNOWN_FIELD,
      issue: null, repository: null, changes: null, fields,
    })
  }

  static #isWellFormedIssue(given) {
    return Number.isInteger(given) && given >= 1
  }

  static #isWellFormedChanges(given) {
    return typeof given === 'string' &&
      given.trim().length > 0 &&
      !ReviewRequest.#FORBIDDEN_CONTROL.test(given)
  }

  static from(raw) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return ReviewRequest.refused(ReviewRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return ReviewRequest.refused(ReviewRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter(
      (field) => !ReviewRequest.KNOWN_FIELDS.includes(field)
    )
    if (unknown.length > 0) {
      return ReviewRequest.withUnknownFields(unknown.sort())
    }
    if (!ReviewRequest.#isWellFormedIssue(parsed[ReviewRequest.ISSUE_FIELD])) {
      return ReviewRequest.refused(ReviewRequestOutcome.MALFORMED_ISSUE)
    }
    if (!RepositoryName.isWellFormed(parsed[ReviewRequest.REPO_FIELD])) {
      return ReviewRequest.refused(ReviewRequestOutcome.MALFORMED_REPO)
    }
    if (!ReviewRequest.#isWellFormedChanges(parsed[ReviewRequest.CHANGES_FIELD])) {
      return ReviewRequest.refused(ReviewRequestOutcome.MALFORMED_CHANGES)
    }

    return ReviewRequest.accepted({
      issue: parsed[ReviewRequest.ISSUE_FIELD],
      repository: new RepositoryName(parsed[ReviewRequest.REPO_FIELD]),
      changes: parsed[ReviewRequest.CHANGES_FIELD].trim(),
    })
  }
}

export class ReviewRefusal {
  static #BY_OUTCOME = new Projection('refusal', [
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
      status: 409,
      code: ReviewRequestOutcome.NO_LIVE_SESSION,
      detail: 'no matching live planning session exists, so nobody would read the changes',
    })],
    [ReviewRequestOutcome.ALREADY_IMPLEMENTING, () => new Refusal({
      status: 409,
      code: ReviewRequestOutcome.ALREADY_IMPLEMENTING,
      detail: 'the plan is already being implemented, so its review watch is gone',
    })],
    [ReviewRequestOutcome.UNCERTAIN_PHASE, () => new Refusal({
      status: 409,
      code: ReviewRequestOutcome.UNCERTAIN_PHASE,
      detail: 'implementation may have started; inspect the plan before retrying',
    })],
  ])

  static of(asked) {
    return ReviewRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes() {
    return ReviewRefusal.#BY_OUTCOME.members()
  }
}

export class ReviewPhases {
  static #BY_PHASE = new Projection('review outcome', [
    [ActivePlanPhase.PLANNING, ReviewRequestOutcome.ACCEPTED],
    [ActivePlanPhase.IMPLEMENTING, ReviewRequestOutcome.ALREADY_IMPLEMENTING],
    [ActivePlanPhase.UNCERTAIN, ReviewRequestOutcome.UNCERTAIN_PHASE],
  ])

  static outcomeFor(phase) {
    return ReviewPhases.#BY_PHASE.of(phase)
  }

  static declaredPhases() {
    return ReviewPhases.#BY_PHASE.members()
  }
}

export class ReviewCollapse {
  static CODE = 'plan-changes-not-asked'

  static of(cause) {
    return new Refusal({ status: 400, code: ReviewCollapse.CODE, detail: cause.message })
  }
}

export class ReviewPlanRoute {
  static PATH = '/review-plan'
  static METHOD = 'POST'

  static handledBy(askPlanChanges, activePlans) {
    return async (request, response) => {
      const asked = ReviewRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== ReviewRequestOutcome.ACCEPTED) {
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

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', ReviewPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
