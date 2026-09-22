import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { ReadPlanningActivityParams } from '../application/queries/read-planning-activity.ts'
import { PlanningActivityFailure, PlanningActivityNotRead } from '../domain/exceptions.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { PlanningActivity } from '../domain/value-objects/planning-activity.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { PlanSessions } from './plan-events-route.ts'

export const PlanningRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  MALFORMED_ISSUE: 'malformed-planning-issue',
  MALFORMED_REPO: 'malformed-repo',
  NOT_WATCHED: 'not-watched',
} as const)

export type PlanningRequestOutcomeValue = (typeof PlanningRequestOutcome)[keyof typeof PlanningRequestOutcome]

type PlanningAsked = { readonly outcome: unknown }

type PlanningRefusalOf = (asked: PlanningAsked) => Refusal

type PlanningFailureConstructor = new (reason: string) => Error

type PlanningCollapseOf = (cause: Error) => Refusal

type PlanningRead = { readonly activity: PlanningActivity }

type PlanningActivityReader = {
  execute(params: ReadPlanningActivityParams): Promise<PlanningRead>,
}

type AcceptedPlanningRequest = PlanningRequest & { readonly watched: PlanWatch }

export class PlanningRequest {
  static readonly EXAMPLE = 42
  static readonly REPO_FIELD = 'repo'
  static readonly #NUMBERED = /^[1-9][0-9]*$/

  readonly outcome: PlanningRequestOutcomeValue
  readonly watched: PlanWatch | null

  constructor({ outcome, watched }: { outcome: PlanningRequestOutcomeValue, watched: PlanWatch | null }) {
    this.outcome = outcome
    this.watched = watched
    Object.freeze(this)
  }

  static accepted(watched: PlanWatch): PlanningRequest {
    return new PlanningRequest({ outcome: PlanningRequestOutcome.ACCEPTED, watched })
  }

  static refused(outcome: PlanningRequestOutcomeValue): PlanningRequest {
    return new PlanningRequest({ outcome, watched: null })
  }

  static isAccepted(asked: PlanningRequest): asked is AcceptedPlanningRequest {
    return asked.outcome === PlanningRequestOutcome.ACCEPTED
  }

  static from(rawIssue: unknown, rawRepo: unknown, sessions: PlanSessions): PlanningRequest {
    if (typeof rawIssue !== 'string' || !PlanningRequest.#NUMBERED.test(rawIssue)) {
      return PlanningRequest.refused(PlanningRequestOutcome.MALFORMED_ISSUE)
    }
    if (!RepositoryName.isWellFormed(rawRepo)) {
      return PlanningRequest.refused(PlanningRequestOutcome.MALFORMED_REPO)
    }
    const watched = sessions.find({ repository: new RepositoryName(rawRepo), issue: Number(rawIssue) })
    if (watched === null) {
      return PlanningRequest.refused(PlanningRequestOutcome.NOT_WATCHED)
    }

    return PlanningRequest.accepted(watched)
  }
}

export class PlanningRefusal {
  static readonly NOT_WATCHED = 'no plan was started for that issue'
  static readonly #BY_OUTCOME: Projection<PlanningRefusalOf> = new Projection<PlanningRefusalOf>('refusal', [
    [PlanningRequestOutcome.MALFORMED_ISSUE, () => new Refusal({
      status: 400,
      code: PlanningRequestOutcome.MALFORMED_ISSUE,
      detail: `the issue to watch is a number such as ${PlanningRequest.EXAMPLE}`,
    })],
    [PlanningRequestOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: PlanningRequestOutcome.MALFORMED_REPO,
      detail: `${PlanningRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
    [PlanningRequestOutcome.NOT_WATCHED, () => new Refusal({
      status: 400,
      code: PlanningRequestOutcome.NOT_WATCHED,
      detail: PlanningRefusal.NOT_WATCHED,
    })],
  ])

  static of(asked: PlanningAsked): Refusal {
    return PlanningRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes(): unknown[] {
    return PlanningRefusal.#BY_OUTCOME.members()
  }
}

export class PlanningCollapse {
  static readonly #STATUS = 400

  static #collapsed(code: string): PlanningCollapseOf {
    return (cause) => new Refusal({ status: PlanningCollapse.#STATUS, code, detail: cause.message })
  }

  static readonly #BY_FAILURE: Projection<PlanningCollapseOf, PlanningFailureConstructor>
    = new Projection<PlanningCollapseOf, PlanningFailureConstructor>('refusal', [
      [PlanningActivityNotRead, PlanningCollapse.#collapsed('planning-progress-not-read')],
    ])

  static of(cause: Error): Refusal {
    return PlanningCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static #declared(): PlanningFailureConstructor[] {
    return PlanningCollapse.#BY_FAILURE.members()
  }

  static declaredFailures(): string[] {
    return PlanningCollapse.#declared().map((failure) => failure.name)
  }

  static declaredCodes(): string[] {
    return PlanningCollapse.#declared().map((failure) => PlanningCollapse.of(new failure('x')).code)
  }
}

export class PlanningProgressRoute {
  static readonly PATH = '/planning-progress/:issue'
  static readonly METHOD = 'GET'

  static handledBy(sessions: PlanSessions, readPlanningActivity: PlanningActivityReader): RequestHandler {
    return async (request, response) => {
      const asked = PlanningRequest.from(request.params.issue, request.query[PlanningRequest.REPO_FIELD], sessions)
      if (!PlanningRequest.isAccepted(asked)) {
        Answer.refuseAs(response, PlanningRefusal.of(asked))
        return
      }
      let read
      try {
        read = await readPlanningActivity.execute(new ReadPlanningActivityParams({ watch: asked.watched }))
      } catch (cause) {
        if (!(cause instanceof PlanningActivityFailure)) throw cause
        Answer.refuseAs(response, PlanningCollapse.of(cause))
        return
      }
      Answer.send(response, 200, {
        state: read.activity.state,
        running_ms: read.activity.runningMs,
        tool_calls: read.activity.toolCalls,
        last_tool: read.activity.lastToolCall === null ? null : {
          name: read.activity.lastToolCall.name,
          argument: read.activity.lastToolCall.argument,
        },
        last_text: read.activity.lastText,
      })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', PlanningProgressRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
