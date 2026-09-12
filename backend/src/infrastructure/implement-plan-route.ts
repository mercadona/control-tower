import type { Request, RequestHandler, Response } from 'express'
import { Answer, JsonBody, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { ImplementPlanParams } from '../application/actions/implement-plan.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { ActivePlanPhase } from './active-plans-route.ts'
import {
  PlanFailure, PlanAgentNotResumed, PlanGoNotAnswered, GoNotRecorded,
} from '../domain/exceptions.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'

export const ImplementRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_AGENT: 'malformed-agent',
  MALFORMED_ISSUE: 'malformed-issue',
  MALFORMED_REPO: 'malformed-repo',
  NO_LIVE_SESSION: 'no-live-planning-session',
  UNCERTAIN_PHASE: 'implementation-phase-uncertain',
} as const)

export type ImplementRequestOutcomeValue =
  (typeof ImplementRequestOutcome)[keyof typeof ImplementRequestOutcome]

type ImplementAsked = { readonly outcome: unknown, readonly fields?: readonly string[] }

type ImplementRefusalOf = (asked: ImplementAsked) => Refusal

type ImplementFailureConstructor = new (reason: string) => Error

type ImplementCollapseOf = (cause: Error) => Refusal

type PlanImplementer = { execute(params: ImplementPlanParams): Promise<void> }

type WatchedIssue = { issue: number, repository: RepositoryName }

type PlanReviews = { stop(watched: WatchedIssue): void }

type PullRequestReviews = { start(watch: PlanWatch): void }

type ActivePlan = { readonly phase: string, readonly watch: PlanWatch }

type ActivePlanRegistry = {
  find(watched: WatchedIssue): ActivePlan | null,
  rememberImplementing(watch: PlanWatch): void,
}

type ImplementationStarts = { remember(watch: PlanWatch): Promise<void> }

type Stderr = (line: string) => void

class ImplementRequest {
  static readonly AGENT_FIELD = 'agent'
  static readonly ISSUE_FIELD = 'issue'
  static readonly REPO_FIELD = 'repo'
  static readonly KNOWN_FIELDS: readonly string[] = Object.freeze([
    ImplementRequest.AGENT_FIELD, ImplementRequest.ISSUE_FIELD, ImplementRequest.REPO_FIELD,
  ])

  readonly outcome: ImplementRequestOutcomeValue
  readonly agent: string | null
  readonly issue: number | null
  readonly repository: RepositoryName | null
  readonly fields: readonly string[]

  constructor({ outcome, agent, issue, repository, fields }: {
    outcome: ImplementRequestOutcomeValue,
    agent: string | null,
    issue: number | null,
    repository: RepositoryName | null,
    fields: readonly string[],
  }) {
    this.outcome = outcome
    this.agent = agent
    this.issue = issue
    this.repository = repository
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted({ agent, issue, repository }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
  }): ImplementRequest {
    return new ImplementRequest({
      outcome: ImplementRequestOutcome.ACCEPTED, agent, issue, repository, fields: [],
    })
  }

  static refused(outcome: ImplementRequestOutcomeValue): ImplementRequest {
    return new ImplementRequest({
      outcome, agent: null, issue: null, repository: null, fields: [],
    })
  }

  static withUnknownFields(fields: readonly string[]): ImplementRequest {
    return new ImplementRequest({
      outcome: ImplementRequestOutcome.UNKNOWN_FIELD,
      agent: null, issue: null, repository: null, fields,
    })
  }

  static isAccepted(asked: ImplementRequest): asked is AcceptedImplementRequest {
    return asked.outcome === ImplementRequestOutcome.ACCEPTED
  }

  static #isJsonObject(given: unknown): given is Record<string, unknown> {
    return given !== null && typeof given === 'object' && !Array.isArray(given)
  }

  static #isWellFormedIssue(given: unknown): given is number {
    return typeof given === 'number' && Number.isInteger(given) && given >= 1
  }

  static #isWellFormedAgent(given: unknown): given is string {
    return typeof given === 'string' && given.length > 0 && !/\s/.test(given)
  }

  static from(raw: string): ImplementRequest {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return ImplementRequest.refused(ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (!ImplementRequest.#isJsonObject(parsed)) {
      return ImplementRequest.refused(ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter(
      (field) => !ImplementRequest.KNOWN_FIELDS.includes(field)
    )
    if (unknown.length > 0) {
      return ImplementRequest.withUnknownFields(unknown.sort())
    }
    const agent = parsed[ImplementRequest.AGENT_FIELD]
    const issue = parsed[ImplementRequest.ISSUE_FIELD]
    const repo = parsed[ImplementRequest.REPO_FIELD]
    if (!ImplementRequest.#isWellFormedAgent(agent)) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_AGENT)
    }
    if (!ImplementRequest.#isWellFormedIssue(issue)) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_ISSUE)
    }
    if (!RepositoryName.isWellFormed(repo)) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_REPO)
    }

    return ImplementRequest.accepted({ agent, issue, repository: new RepositoryName(repo) })
  }
}

type AcceptedImplementRequest = ImplementRequest & {
  readonly agent: string,
  readonly issue: number,
  readonly repository: RepositoryName,
}

export class ImplementRefusal {
  static readonly #BY_OUTCOME: Projection<ImplementRefusalOf> = new Projection<ImplementRefusalOf>('refusal', [
    [ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT, () => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT,
      detail: 'body must be a JSON object',
    })],
    [ImplementRequestOutcome.MALFORMED_AGENT, () => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.MALFORMED_AGENT,
      detail: `${ImplementRequest.AGENT_FIELD} must be the handle start-plan answered with`,
    })],
    [ImplementRequestOutcome.MALFORMED_ISSUE, () => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.MALFORMED_ISSUE,
      detail: `${ImplementRequest.ISSUE_FIELD} must be a whole number from one`,
    })],
    [ImplementRequestOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.MALFORMED_REPO,
      detail: `${ImplementRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
    [ImplementRequestOutcome.UNKNOWN_FIELD, (asked) => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.UNKNOWN_FIELD,
      detail: `unknown field: ${(asked.fields as readonly string[]).join(', ')}`,
    })],
    [ImplementRequestOutcome.NO_LIVE_SESSION, () => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.NO_LIVE_SESSION,
      detail: 'no matching live planning session exists',
    })],
    [ImplementRequestOutcome.UNCERTAIN_PHASE, () => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.UNCERTAIN_PHASE,
      detail: 'implementation may have started; inspect the plan before retrying',
    })],
  ])

  static of(asked: ImplementAsked): Refusal {
    return ImplementRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes(): unknown[] {
    return ImplementRefusal.#BY_OUTCOME.members()
  }
}

export class ImplementCollapse {
  static readonly #STATUS = 400

  static #collapsed(code: string): ImplementCollapseOf {
    return (cause) => new Refusal({ status: ImplementCollapse.#STATUS, code, detail: cause.message })
  }

  static readonly #BY_FAILURE: Projection<ImplementCollapseOf, ImplementFailureConstructor> = new Projection<ImplementCollapseOf, ImplementFailureConstructor>('refusal', [
    [GoNotRecorded, ImplementCollapse.#collapsed('go-not-recorded')],
    [PlanGoNotAnswered, ImplementCollapse.#collapsed('plan-go-not-answered')],
    [PlanAgentNotResumed, ImplementCollapse.#collapsed('plan-agent-not-resumed')],
  ])

  static of(cause: Error): Refusal {
    return ImplementCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static #declared(): ImplementFailureConstructor[] {
    return ImplementCollapse.#BY_FAILURE.members()
  }

  static declaredFailures(): string[] {
    return ImplementCollapse.#declared().map((failure) => failure.name)
  }

  static declaredCodes(): string[] {
    return ImplementCollapse.#declared().map((failure) => ImplementCollapse.of(new failure('x')).code)
  }
}

export class ImplementPlanRoute {
  static readonly PATH = '/implement-plan'
  static readonly METHOD = 'POST'

  static handledBy(
    implementPlan: PlanImplementer,
    reviews: PlanReviews,
    pullRequestReviews: PullRequestReviews,
    activePlans: ActivePlanRegistry,
    implementationStarts: ImplementationStarts,
    stderr: Stderr
  ): RequestHandler {
    const transitions = new Map<string, Promise<void>>()
    return async (request, response) => {
      const asked = ImplementRequest.from(JsonBody.textOf(request))
      if (!ImplementRequest.isAccepted(asked)) {
        Answer.refuseAs(response, ImplementRefusal.of(asked))
        return
      }
      const key = `${asked.repository.text}#${asked.issue}`
      const pending = transitions.get(key)
      if (pending !== undefined) await pending
      const transition = ImplementPlanRoute.#accept(
        implementPlan, reviews, pullRequestReviews, activePlans,
        implementationStarts, stderr, response, asked
      )
      transitions.set(key, transition)
      try {
        await transition
      } finally {
        if (transitions.get(key) === transition) transitions.delete(key)
      }
    }
  }

  static async #accept(
    implementPlan: PlanImplementer,
    reviews: PlanReviews,
    pullRequestReviews: PullRequestReviews,
    activePlans: ActivePlanRegistry,
    implementationStarts: ImplementationStarts,
    stderr: Stderr,
    response: Response,
    asked: AcceptedImplementRequest
  ): Promise<void> {
    const active = activePlans.find({ issue: asked.issue, repository: asked.repository })
    if (active === null || active.watch.agent !== asked.agent) {
      Answer.refuseAs(response, ImplementRefusal.of({ outcome: ImplementRequestOutcome.NO_LIVE_SESSION }))
      return
    }
    if (active.phase === ActivePlanPhase.UNCERTAIN) {
      Answer.refuseAs(response, ImplementRefusal.of({ outcome: ImplementRequestOutcome.UNCERTAIN_PHASE }))
      return
    }
    if (active.phase === ActivePlanPhase.IMPLEMENTING) {
      ImplementPlanRoute.#answerAccepted(response, asked)
      return
    }
    try {
      await implementPlan.execute(new ImplementPlanParams({
        agent: asked.agent, issue: asked.issue, repository: asked.repository,
      }))
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, ImplementCollapse.of(cause))
      return
    }
    const watch = active.watch
    activePlans.rememberImplementing(watch)
    try {
      await implementationStarts.remember(watch)
    } catch (failure) {
      stderr(`could not persist implementation start for ${asked.repository.text}#${asked.issue}: ${(failure as Error).message}\n`)
    }
    reviews.stop({ issue: asked.issue, repository: asked.repository })
    pullRequestReviews.start(watch)
    ImplementPlanRoute.#answerAccepted(response, asked)
  }

  static #answerAccepted(response: Response, asked: AcceptedImplementRequest): void {
    Answer.send(response, 202, {
      status: 'implementing',
      [ImplementRequest.AGENT_FIELD]: asked.agent,
      [ImplementRequest.ISSUE_FIELD]: asked.issue,
    })
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', ImplementPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
