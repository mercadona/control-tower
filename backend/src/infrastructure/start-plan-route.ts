import { Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'
import { UserStoryReference } from '../domain/value-objects/user-story-reference.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import {
  PlanFailure,
  RepositoryPreparationRequired,
  UserStoryNotRead, UserStoryNotUnderstood,
  WorkspaceNotRead,
  WorkspaceNotUnderstood, CheckoutNotConfirmed, CheckoutNotOnDefaultBranch, CheckoutNotUpToDate,
  ConversationNotStarted, ConversationNotRecorded,
  SessionHooksNotWritten, SessionHooksNotUnderstood,
  EpicSpecNotRead, EpicSpecNotUnderstood, EpicSpecNotWritten,
  EpicBranchNotPublished, EpicBranchNotUnderstood, EpicPullRequestNotOpened,
  PullRequestNotRead, PullRequestNotUnderstood,
  EpicNotGroomed, GroomPlanNotUnderstood,
  PublishedSpecNotRead,
  PublishedSpecNotUnderstood,
  EpicIssuesNotRead, EpicIssuesNotUnderstood, EpicIssueNotPromoted,
} from '../domain/exceptions.ts'

export const PlanRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ID: 'malformed-id',
  NOTHING_TO_PLAN: 'nothing-to-plan',
  MALFORMED_PATH: 'malformed-path',
} as const)

export type PlanRequestOutcomeValue = (typeof PlanRequestOutcome)[keyof typeof PlanRequestOutcome]

export type RefusedPlanRequest = {
  readonly outcome: unknown,
  readonly named?: string | null,
  readonly fields?: readonly string[],
}

export class PlanRequest {
  static readonly ID_FIELD = 'id'
  static readonly PATH_FIELD = 'path'

  static readonly KNOWN_FIELDS: readonly string[] = Object.freeze([
    PlanRequest.ID_FIELD, PlanRequest.PATH_FIELD,
  ])

  readonly outcome: PlanRequestOutcomeValue
  readonly story: UserStoryKey | UserStoryUrl | null
  readonly root: CheckoutRoot | null
  readonly fields: readonly string[]
  readonly named: string | null

  constructor({ outcome, story, root, fields, named = null }: {
    outcome: PlanRequestOutcomeValue,
    story: UserStoryKey | UserStoryUrl | null,
    root: CheckoutRoot | null,
    fields: readonly string[],
    named?: string | null,
  }) {
    this.outcome = outcome
    this.story = story
    this.root = root
    this.fields = Object.freeze([...fields])
    this.named = named
    Object.freeze(this)
  }

  static accepted(story: UserStoryKey | UserStoryUrl, root: CheckoutRoot): PlanRequest {
    return new PlanRequest({ outcome: PlanRequestOutcome.ACCEPTED, story, root, fields: [] })
  }

  static refused(outcome: PlanRequestOutcomeValue, named: string | null = null): PlanRequest {
    return new PlanRequest({
      outcome, story: null, root: null, fields: [], named,
    })
  }

  static withUnknownFields(fields: readonly string[]): PlanRequest {
    return new PlanRequest({
      outcome: PlanRequestOutcome.UNKNOWN_FIELD, story: null, root: null, fields,
    })
  }

  static from(raw: string): PlanRequest {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return PlanRequest.refused(PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (!PlanRequest.#isJsonObject(parsed)) {
      return PlanRequest.refused(PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter((field) => !PlanRequest.KNOWN_FIELDS.includes(field))
    if (unknown.length > 0) {
      return PlanRequest.withUnknownFields(unknown.sort())
    }
    const idGiven = Object.hasOwn(parsed, PlanRequest.ID_FIELD)
    const given = parsed[PlanRequest.ID_FIELD]
    if (idGiven && !UserStoryReference.isWellFormed(given)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_ID)
    }
    if (!idGiven) {
      return PlanRequest.refused(PlanRequestOutcome.NOTHING_TO_PLAN)
    }
    const story = UserStoryReference.of(given)

    const where = parsed[PlanRequest.PATH_FIELD]
    if (!CheckoutRoot.isWellFormed(where)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_PATH, PlanRequest.PATH_FIELD)
    }
    return PlanRequest.accepted(story, new CheckoutRoot(where))
  }

  static #isJsonObject(parsed: unknown): parsed is Record<string, unknown> {
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  }
}

type PlanRefusalOf = (asked: RefusedPlanRequest) => Refusal

export class PlanRefusal {
  static readonly #BY_OUTCOME: Projection<PlanRefusalOf, PlanRequestOutcomeValue> =
    new Projection<PlanRefusalOf, PlanRequestOutcomeValue>('refusal', [
    [PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT,
      detail: 'body must be a JSON object',
    })],
    [PlanRequestOutcome.MALFORMED_ID, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_ID,
      detail: `${PlanRequest.ID_FIELD} must be a user story key such as ${UserStoryKey.EXAMPLE} `
        + `or a github issue url such as ${UserStoryUrl.EXAMPLE}`,
    })],
    [PlanRequestOutcome.NOTHING_TO_PLAN, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.NOTHING_TO_PLAN,
      detail: `${PlanRequest.ID_FIELD} is required to say what to plan`,
    })],
    [PlanRequestOutcome.MALFORMED_PATH, (asked) => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_PATH,
      detail: `${asked.named} must be an absolute path`,
    })],
    [PlanRequestOutcome.UNKNOWN_FIELD, (asked) => new Refusal({
      status: 400,
      code: PlanRequestOutcome.UNKNOWN_FIELD,
      detail: `unknown field: ${asked.fields!.join(', ')}`,
    })],
  ])

  static of(asked: RefusedPlanRequest): Refusal {
    return PlanRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes(): PlanRequestOutcomeValue[] {
    return PlanRefusal.#BY_OUTCOME.members()
  }
}

type PlanFailureClass = { readonly name: string, readonly prototype: PlanFailure }

type PlanCollapseOf = (cause: PlanFailure) => Refusal

export class PlanCollapse {
  static readonly #STATUS = 400

  static #collapsed(code: string): PlanCollapseOf {
    return (cause) => new Refusal({ status: PlanCollapse.#STATUS, code, detail: cause.message })
  }

  static readonly #BY_FAILURE: Projection<PlanCollapseOf, PlanFailureClass> =
    new Projection<PlanCollapseOf, PlanFailureClass>('refusal', [
    [UserStoryNotRead, PlanCollapse.#collapsed('user-story-not-read')],
    [RepositoryPreparationRequired, PlanCollapse.#collapsed('repository-preparation-required')],
    [WorkspaceNotRead, PlanCollapse.#collapsed('workspace-not-read')],
    [CheckoutNotConfirmed, (cause) => new Refusal({
      status: PlanCollapse.#STATUS,
      code: 'checkout-not-confirmed',
      detail: `${PlanRequest.PATH_FIELD} must be a git checkout of ${cause.message}`,
    })],
    [CheckoutNotOnDefaultBranch, PlanCollapse.#collapsed('checkout-not-on-default-branch')],
    [CheckoutNotUpToDate, PlanCollapse.#collapsed('checkout-not-up-to-date')],
    [UserStoryNotUnderstood, PlanCollapse.#collapsed('user-story-not-understood')],
    [WorkspaceNotUnderstood, PlanCollapse.#collapsed('workspace-not-understood')],
    [ConversationNotStarted, PlanCollapse.#collapsed('conversation-not-started')],
    [ConversationNotRecorded, PlanCollapse.#collapsed('conversation-not-recorded')],
    [SessionHooksNotWritten, PlanCollapse.#collapsed('session-hooks-not-written')],
    [SessionHooksNotUnderstood, PlanCollapse.#collapsed('session-hooks-not-understood')],
    [EpicSpecNotRead, PlanCollapse.#collapsed('epic-spec-not-read')],
    [EpicSpecNotUnderstood, PlanCollapse.#collapsed('epic-spec-not-understood')],
    [EpicSpecNotWritten, PlanCollapse.#collapsed('epic-spec-not-written')],
    [EpicBranchNotPublished, PlanCollapse.#collapsed('epic-branch-not-published')],
    [EpicBranchNotUnderstood, PlanCollapse.#collapsed('epic-branch-not-understood')],
    [EpicPullRequestNotOpened, PlanCollapse.#collapsed('epic-pull-request-not-opened')],
    [PullRequestNotRead, PlanCollapse.#collapsed('pull-request-not-read')],
    [PullRequestNotUnderstood, PlanCollapse.#collapsed('pull-request-not-understood')],
    [EpicNotGroomed, PlanCollapse.#collapsed('epic-not-groomed')],
    [GroomPlanNotUnderstood, PlanCollapse.#collapsed('groom-plan-not-understood')],
    [PublishedSpecNotRead, PlanCollapse.#collapsed('published-spec-not-read')],
    [PublishedSpecNotUnderstood, PlanCollapse.#collapsed('published-spec-not-understood')],
    [EpicIssuesNotRead, PlanCollapse.#collapsed('epic-issues-not-read')],
    [EpicIssuesNotUnderstood, PlanCollapse.#collapsed('epic-issues-not-understood')],
    [EpicIssueNotPromoted, PlanCollapse.#collapsed('epic-issue-not-promoted')],
  ])

  static of(cause: PlanFailure): Refusal {
    return PlanCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static declaredFailures(): string[] {
    return PlanCollapse.#BY_FAILURE.members().map((failure) => failure.name)
  }

  static declaredCodes(): string[] {
    const probe = new PlanFailure('x')
    return PlanCollapse.#BY_FAILURE.members().map((failure) => PlanCollapse.#BY_FAILURE.of(failure)(probe).code)
  }
}
