import { Answer, JsonBody, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { StartPlanParams } from '../application/actions/start-plan.ts'
import { StartMilestonePlanParams } from '../application/actions/start-milestone-plan.ts'
import { EpicGroomState, ReadEpicGroomParams } from '../application/queries/read-epic-groom.ts'
import { Reservation, WorkInFlight } from './work-in-flight.ts'
import { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'
import { UserStoryReference } from '../domain/value-objects/user-story-reference.ts'
import { PlanComment } from '../domain/value-objects/plan-comment.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { PlanTarget } from '../domain/value-objects/plan-target.ts'
import {
  PlanFailure,
  DispatchNotAvailable, DispatchNotRead, DispatchNotUnderstood,
  UserStoryNotRead, UserStoryNotUnderstood, PlanIssueNotCreated, PlanIssueNotNamed,
  PlanIssueNotClaimed,
  PlanAgentNeverLaunched, PlanAgentNotLaunched, PlanAgentNotNamed,
  WorkspaceNotPrepared, WorkspaceNotCleaned, WorkspaceNotRead,
  WorkspaceNotUnderstood, CheckoutNotConfirmed, CheckoutNotOnDefaultBranch, CheckoutNotUpToDate,
  ConversationNotStarted, ConversationNotRecorded, ConversationNotUnderstood,
  SessionHooksNotWritten, SessionHooksNotUnderstood,
  EpicSpecNotRead, EpicSpecNotUnderstood, EpicSpecNotWritten,
  EpicBranchNotPublished, EpicBranchNotUnderstood, EpicPullRequestNotOpened,
  PullRequestNotRead, PullRequestNotUnderstood,
  EpicNotGroomed, GroomPlanNotUnderstood,
  PublishedSpecNotRead,
  PublishedSpecNotUnderstood,
  EpicIssuesNotRead, EpicIssuesNotUnderstood, EpicIssueNotPromoted,
} from '../domain/exceptions.ts'
import type { Request, Response } from 'express'
import type { PlanStarted, StartPlan, StartPlanResult } from '../application/actions/start-plan.ts'
import type { StartMilestonePlan } from '../application/actions/start-milestone-plan.ts'
import type { ReadEpicGroom } from '../application/queries/read-epic-groom.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'

export const PlanRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ID: 'malformed-id',
  MALFORMED_USER_COMMENT: 'malformed-user-comment',
  NOTHING_TO_PLAN: 'nothing-to-plan',
  REPO_LIST_RETIRED: 'repo-list-retired',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_PATH: 'malformed-path',
} as const)

export type PlanRequestOutcomeValue = (typeof PlanRequestOutcome)[keyof typeof PlanRequestOutcome]

export type RefusedPlanRequest = {
  readonly outcome: unknown,
  readonly named?: string | null,
  readonly fields?: readonly string[],
}

export type PlanSessionRegistry = { remember(watch: PlanWatch): void }

export const MilestonePlanOutcome = Object.freeze({
  MALFORMED: 'start-milestone-malformed',
  NO_SESSION: 'start-milestone-no-session',
  MISMATCH: 'start-milestone-mismatch',
  NOT_DISPATCHABLE: 'start-milestone-not-dispatchable',
  IN_PROGRESS: 'start-plan-in-progress',
} as const)

export type MilestonePlanOutcomeValue = (typeof MilestonePlanOutcome)[keyof typeof MilestonePlanOutcome]

export class MalformedMilestonePlan extends Error {}

const PlanEntrance = Object.freeze({
  LOOSE: 'loose',
  MILESTONE: 'milestone',
} as const)

type PlanEntranceValue = (typeof PlanEntrance)[keyof typeof PlanEntrance]

export class MilestonePlanRequest {
  static readonly FIELD = 'milestone'
  readonly milestone: string

  private constructor(milestone: string) {
    this.milestone = milestone
    Object.freeze(this)
  }

  static entranceOf(raw: string): PlanEntranceValue {
    try {
      const parsed: unknown = JSON.parse(raw)
      return MilestonePlanRequest.#isJsonObject(parsed) && Object.hasOwn(parsed, MilestonePlanRequest.FIELD)
        ? PlanEntrance.MILESTONE
        : PlanEntrance.LOOSE
    } catch {
      return PlanEntrance.LOOSE
    }
  }

  static from(raw: string): MilestonePlanRequest {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new MalformedMilestonePlan(`milestone command must be exactly {"milestone":"name"}, got ${raw}`)
    }
    if (!MilestonePlanRequest.#isJsonObject(parsed)) {
      throw new MalformedMilestonePlan(`milestone command must be exactly {"milestone":"name"}, got ${raw}`)
    }
    const fields = Object.keys(parsed)
    const milestone = parsed[MilestonePlanRequest.FIELD]
    if (fields.length !== 1 || fields[0] !== MilestonePlanRequest.FIELD
      || typeof milestone !== 'string' || milestone.length === 0 || milestone.trim() !== milestone) {
      throw new MalformedMilestonePlan(`milestone command must be exactly {"milestone":"name"}, got ${raw}`)
    }

    return new MilestonePlanRequest(milestone)
  }

  static #isJsonObject(parsed: unknown): parsed is Record<string, unknown> {
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  }
}

class RefusedMilestonePlan {
  readonly outcome: MilestonePlanOutcomeValue
  readonly detail: string

  constructor({ outcome, detail }: { outcome: MilestonePlanOutcomeValue, detail: string }) {
    this.outcome = outcome
    this.detail = detail
    Object.freeze(this)
  }
}

type MilestonePlanRefusalOf = (asked: RefusedMilestonePlan) => Refusal

class MilestonePlanRefusal {
  static readonly #BY_OUTCOME = new Projection<MilestonePlanRefusalOf, MilestonePlanOutcomeValue>('refusal', [
    [MilestonePlanOutcome.MALFORMED, MilestonePlanRefusal.#answer],
    [MilestonePlanOutcome.NO_SESSION, MilestonePlanRefusal.#answer],
    [MilestonePlanOutcome.MISMATCH, MilestonePlanRefusal.#answer],
    [MilestonePlanOutcome.NOT_DISPATCHABLE, MilestonePlanRefusal.#answer],
    [MilestonePlanOutcome.IN_PROGRESS, MilestonePlanRefusal.#answer],
  ])

  static of(asked: RefusedMilestonePlan): Refusal {
    return MilestonePlanRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static #answer(asked: RefusedMilestonePlan): Refusal {
    return new Refusal({ status: 400, code: asked.outcome, detail: asked.detail })
  }
}

type MilestoneStartCollaborators = Readonly<{
  milestone: StartMilestonePlan | null,
  coordinating: CoordinatingSessions | null,
  groom: ReadEpicGroom | null,
  inFlight: WorkInFlight | null,
}>

export class PlanRequest {
  static readonly ID_FIELD = 'id'
  static readonly COMMENT_FIELD = 'user_comment'
  static readonly REPO_FIELD = 'repo'
  static readonly PATH_FIELD = 'path'
  static readonly RETIRED_REPO_LIST_FIELD = 'repo_list'

  static readonly KNOWN_FIELDS: readonly string[] = Object.freeze([
    PlanRequest.ID_FIELD, PlanRequest.COMMENT_FIELD, PlanRequest.REPO_FIELD, PlanRequest.PATH_FIELD,
  ])

  readonly outcome: PlanRequestOutcomeValue
  readonly story: UserStoryKey | UserStoryUrl | null
  readonly comment: PlanComment | null
  readonly targets: readonly PlanTarget[] | null
  readonly fields: readonly string[]
  readonly named: string | null

  constructor({ outcome, story, comment, targets, fields, named = null }: {
    outcome: PlanRequestOutcomeValue,
    story: UserStoryKey | UserStoryUrl | null,
    comment: PlanComment | null,
    targets: readonly PlanTarget[] | null,
    fields: readonly string[],
    named?: string | null,
  }) {
    this.outcome = outcome
    this.story = story
    this.comment = comment
    this.targets = targets === null ? null : Object.freeze([...targets])
    this.fields = Object.freeze([...fields])
    this.named = named
    Object.freeze(this)
  }

  static accepted(
    story: UserStoryKey | UserStoryUrl | null,
    comment: PlanComment | null,
    targets: readonly PlanTarget[]
  ): PlanRequest {
    return new PlanRequest({ outcome: PlanRequestOutcome.ACCEPTED, story, comment, targets, fields: [] })
  }

  static refused(outcome: PlanRequestOutcomeValue, named: string | null = null): PlanRequest {
    return new PlanRequest({
      outcome, story: null, comment: null, targets: null, fields: [], named,
    })
  }

  static withUnknownFields(fields: readonly string[]): PlanRequest {
    return new PlanRequest({
      outcome: PlanRequestOutcome.UNKNOWN_FIELD, story: null, comment: null, targets: null, fields,
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
    if (Object.hasOwn(parsed, PlanRequest.RETIRED_REPO_LIST_FIELD)) {
      return PlanRequest.refused(PlanRequestOutcome.REPO_LIST_RETIRED)
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
    const commentGiven = Object.hasOwn(parsed, PlanRequest.COMMENT_FIELD)
    const saidByHand = parsed[PlanRequest.COMMENT_FIELD]
    if (commentGiven && !PlanComment.isWellFormed(saidByHand)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_USER_COMMENT)
    }
    if (!idGiven && !commentGiven) {
      return PlanRequest.refused(PlanRequestOutcome.NOTHING_TO_PLAN)
    }
    const story = idGiven ? UserStoryReference.of(given) : null
    const comment = commentGiven ? new PlanComment(saidByHand) : null

    const asked = parsed[PlanRequest.REPO_FIELD]
    if (!RepositoryName.isWellFormed(asked)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_REPO, PlanRequest.REPO_FIELD)
    }
    const where = parsed[PlanRequest.PATH_FIELD]
    if (!CheckoutRoot.isWellFormed(where)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_PATH, PlanRequest.PATH_FIELD)
    }
    return PlanRequest.accepted(story, comment, [
      new PlanTarget({ repository: new RepositoryName(asked), root: new CheckoutRoot(where) }),
    ])
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
    [PlanRequestOutcome.MALFORMED_USER_COMMENT, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_USER_COMMENT,
      detail: `${PlanRequest.COMMENT_FIELD} must be text saying what to plan`,
    })],
    [PlanRequestOutcome.NOTHING_TO_PLAN, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.NOTHING_TO_PLAN,
      detail: `either ${PlanRequest.ID_FIELD} or ${PlanRequest.COMMENT_FIELD} must say what to plan`,
    })],
    [PlanRequestOutcome.REPO_LIST_RETIRED, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.REPO_LIST_RETIRED,
      detail: `${PlanRequest.RETIRED_REPO_LIST_FIELD} is retired: send ${PlanRequest.REPO_FIELD} and `
        + `${PlanRequest.PATH_FIELD} for one repository instead`,
    })],
    [PlanRequestOutcome.MALFORMED_REPO, (asked) => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_REPO,
      detail: `${asked.named} must be a repository such as ${RepositoryName.EXAMPLE}`,
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
    [PlanIssueNotCreated, PlanCollapse.#collapsed('plan-issue-not-created')],
    [PlanIssueNotClaimed, PlanCollapse.#collapsed('plan-issue-not-claimed')],
    [DispatchNotAvailable, PlanCollapse.#collapsed('dispatch-not-available')],
    [DispatchNotRead, PlanCollapse.#collapsed('dispatch-not-read')],
    [DispatchNotUnderstood, PlanCollapse.#collapsed('dispatch-not-understood')],
    [PlanAgentNeverLaunched, PlanCollapse.#collapsed('plan-agent-never-launched')],
    [PlanAgentNotLaunched, PlanCollapse.#collapsed('plan-agent-not-launched')],
    [WorkspaceNotPrepared, PlanCollapse.#collapsed('workspace-not-prepared')],
    [WorkspaceNotCleaned, PlanCollapse.#collapsed('workspace-not-cleaned')],
    [WorkspaceNotRead, PlanCollapse.#collapsed('workspace-not-read')],
    [CheckoutNotConfirmed, (cause) => new Refusal({
      status: PlanCollapse.#STATUS,
      code: 'checkout-not-confirmed',
      detail: `${PlanRequest.PATH_FIELD} must be a git checkout of ${cause.message}`,
    })],
    [CheckoutNotOnDefaultBranch, PlanCollapse.#collapsed('checkout-not-on-default-branch')],
    [CheckoutNotUpToDate, PlanCollapse.#collapsed('checkout-not-up-to-date')],
    [UserStoryNotUnderstood, PlanCollapse.#collapsed('user-story-not-understood')],
    [PlanIssueNotNamed, PlanCollapse.#collapsed('plan-issue-not-named')],
    [PlanAgentNotNamed, PlanCollapse.#collapsed('plan-agent-not-named')],
    [WorkspaceNotUnderstood, PlanCollapse.#collapsed('workspace-not-understood')],
    [ConversationNotStarted, PlanCollapse.#collapsed('conversation-not-started')],
    [ConversationNotRecorded, PlanCollapse.#collapsed('conversation-not-recorded')],
    [ConversationNotUnderstood, PlanCollapse.#collapsed('conversation-not-understood')],
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

export class StartPlanRoute {
  static readonly PATH = '/start-plan'
  static readonly METHOD = 'POST'

  static handledBy(
    startPlan: StartPlan,
    sessions: PlanSessionRegistry,
    collaborators: MilestoneStartCollaborators = Object.freeze({
      milestone: null, coordinating: null, groom: null, inFlight: null,
    })
  ): (request: Request, response: Response) => Promise<void> {
    const inFlight = collaborators.inFlight ?? new WorkInFlight()
    return async (request, response) => {
      const raw = JsonBody.textOf(request)
      switch (MilestonePlanRequest.entranceOf(raw)) {
        case PlanEntrance.MILESTONE:
          await StartPlanRoute.#acceptMilestone(sessions, response, raw, collaborators, inFlight)
          return
        case PlanEntrance.LOOSE:
          break
      }
      const asked = PlanRequest.from(raw)
      if (asked.outcome !== PlanRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, PlanRefusal.of(asked))
        return
      }
      const repository = asked.targets![0].repository.text
      await StartPlanRoute.#withReservation(repository, inFlight, response, async () => {
        await StartPlanRoute.#accept(startPlan, sessions, response, asked, collaborators.coordinating)
      })
    }
  }

  static async #acceptMilestone(
    sessions: PlanSessionRegistry,
    response: Response,
    raw: string,
    collaborators: MilestoneStartCollaborators,
    inFlight: WorkInFlight,
  ): Promise<void> {
    let asked: MilestonePlanRequest
    try {
      asked = MilestonePlanRequest.from(raw)
    } catch (cause) {
      if (!(cause instanceof MalformedMilestonePlan)) throw cause
      StartPlanRoute.#refuse(response, MilestonePlanOutcome.MALFORMED, cause.message)
      return
    }
    if (collaborators.milestone === null || collaborators.coordinating === null || collaborators.groom === null) {
      StartPlanRoute.#refuse(response, MilestonePlanOutcome.NO_SESSION, 'no coordinating session is held')
      return
    }
    const startMilestone = collaborators.milestone
    const groom = collaborators.groom
    const holding = collaborators.coordinating.held()
    if (holding === null) {
      StartPlanRoute.#refuse(response, MilestonePlanOutcome.NO_SESSION, 'no coordinating session is held')
      return
    }
    const repository = holding.conversation.repository
    await StartPlanRoute.#withReservation(repository.text, inFlight, response, async () => {
      try {
        const groomed = await groom.execute(new ReadEpicGroomParams({
          root: holding.conversation.root,
          repository,
        }))
        switch (groomed.state) {
          case EpicGroomState.GROOMED:
          case EpicGroomState.AUTHORISED:
            break
          case EpicGroomState.NO_SPEC:
          case EpicGroomState.DRAFT:
          case EpicGroomState.RESLICED:
          case EpicGroomState.AWAITING_PUBLICATION:
          case EpicGroomState.ISSUES_UNCERTAIN:
          case EpicGroomState.GROOMABLE:
          case EpicGroomState.PARTIALLY_GROOMED:
            StartPlanRoute.#refuse(
              response,
              MilestonePlanOutcome.NOT_DISPATCHABLE,
              `milestone ${JSON.stringify(asked.milestone)} is ${groomed.state}`,
            )
            return
        }
        if (groomed.milestone !== asked.milestone) {
          StartPlanRoute.#refuse(
            response,
            MilestonePlanOutcome.MISMATCH,
            `held checkout is for milestone ${JSON.stringify(groomed.milestone)}, not ${JSON.stringify(asked.milestone)}`,
          )
          return
        }
        await StartPlanRoute.#startMilestone(
          sessions,
          response,
          asked,
          startMilestone,
          new PlanTarget({ repository, root: holding.conversation.root }),
        )
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, PlanCollapse.of(cause))
      }
    })
  }

  static async #startMilestone(
    sessions: PlanSessionRegistry,
    response: Response,
    asked: MilestonePlanRequest,
    start: StartMilestonePlan,
    target: PlanTarget,
  ): Promise<void> {
    try {
      const started = await start.execute(new StartMilestonePlanParams({
        repository: target.repository,
        root: target.root,
        milestone: asked.milestone,
      }))
      sessions.remember(started.watch)
      Answer.send(response, 202, { status: 'started', ...StartPlanRoute.#startedAnswer(started) })
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, PlanCollapse.of(cause))
    }
  }

  static async #withReservation(
    repository: string,
    inFlight: WorkInFlight,
    response: Response,
    start: () => Promise<void>,
  ): Promise<void> {
    if (inFlight.reserve(repository) === Reservation.IN_PROGRESS) {
      StartPlanRoute.#refuse(
        response,
        MilestonePlanOutcome.IN_PROGRESS,
        `a plan start in ${repository} is already in progress`,
      )
      return
    }
    try {
      await start()
    } finally {
      inFlight.release(repository)
    }
  }

  static #refuse(response: Response, code: MilestonePlanOutcomeValue, detail: string): void {
    Answer.refuseAs(response, MilestonePlanRefusal.of(new RefusedMilestonePlan({ outcome: code, detail })))
  }

  static async #accept(
    startPlan: StartPlan,
    sessions: PlanSessionRegistry,
    response: Response,
    asked: PlanRequest,
    coordinating: CoordinatingSessions | null = null,
  ): Promise<void> {
    let result: StartPlanResult
    try {
      result = await startPlan.execute(
        new StartPlanParams({ story: asked.story, comment: asked.comment, targets: asked.targets! })
      )
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, PlanCollapse.of(cause))
      return
    }
    if (result.failed.length > 0) {
      Answer.refuseAs(response, PlanCollapse.of(result.failed[0].cause))
      return
    }
    const [started] = result.started
    sessions.remember(started.watch)
    coordinating?.planStartedIn(asked.targets![0].root)
    Answer.send(response, 202, { status: 'started', ...StartPlanRoute.#startedAnswer(started) })
  }

  static #startedAnswer(started: PlanStarted): Record<string, unknown> {
    return {
      [PlanRequest.ID_FIELD]: started.watch.storyText(),
      [PlanRequest.REPO_FIELD]: started.watch.repository.text,
      issue: { number: started.watch.issue.number, url: started.watch.issue.url },
      agent: started.agent,
      branch: started.watch.located.branch,
      worktree: started.watch.located.path,
      root: started.watch.located.root,
      baseline: started.baseline.seedField,
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', StartPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
