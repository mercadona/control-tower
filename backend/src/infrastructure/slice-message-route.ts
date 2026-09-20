import { Answer, JsonBody, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import {
  PlanAgentNotResumed,
  PlanFailure,
  PlanStatusNotRead,
  PlanStatusNotUnderstood,
  ReopenNotUnderstood,
  SliceNotReopened,
} from '../domain/exceptions.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { Request, RequestHandler, Response } from 'express'

export const SliceMessageOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_ISSUE: 'slice-message-malformed-issue',
  MALFORMED_AGENT: 'slice-message-malformed-agent',
  MALFORMED_TEXT: 'slice-message-malformed-text',
} as const)

export type SliceMessageOutcomeValue = (typeof SliceMessageOutcome)[keyof typeof SliceMessageOutcome]

export type SliceChangeAsked = (asked: {
  agent: string, issue: number, repository: RepositoryName, changes: string,
}) => Promise<void>

export type SliceChangeHeld = (asked: {
  agent: string, issue: number, repository: RepositoryName, changes: string,
}) => Promise<string>

type AcceptedSliceMessageRequest = SliceMessageRequest & {
  readonly issue: number, readonly repository: RepositoryName, readonly agent: string, readonly text: string,
}

class SliceMessageRequest {
  static readonly REPO_FIELD = 'repo'
  static readonly AGENT_FIELD = 'agent'
  static readonly TEXT_FIELD = 'text'
  static readonly KNOWN_FIELDS: readonly string[] = Object.freeze([
    SliceMessageRequest.REPO_FIELD, SliceMessageRequest.AGENT_FIELD, SliceMessageRequest.TEXT_FIELD,
  ])

  static readonly #ISSUE_SHAPE = /^[1-9][0-9]*$/

  readonly outcome: SliceMessageOutcomeValue
  readonly issue: number | null
  readonly repository: RepositoryName | null
  readonly agent: string | null
  readonly text: string | null
  readonly fields: readonly string[]

  constructor({ outcome, issue, repository, agent, text, fields }: {
    outcome: SliceMessageOutcomeValue,
    issue: number | null,
    repository: RepositoryName | null,
    agent: string | null,
    text: string | null,
    fields: readonly string[],
  }) {
    this.outcome = outcome
    this.issue = issue
    this.repository = repository
    this.agent = agent
    this.text = text
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted({ issue, repository, agent, text }: {
    issue: number, repository: RepositoryName, agent: string, text: string,
  }): SliceMessageRequest {
    return new SliceMessageRequest({ outcome: SliceMessageOutcome.ACCEPTED, issue, repository, agent, text, fields: [] })
  }

  static refused(outcome: SliceMessageOutcomeValue): SliceMessageRequest {
    return new SliceMessageRequest({ outcome, issue: null, repository: null, agent: null, text: null, fields: [] })
  }

  static withUnknownFields(fields: readonly string[]): SliceMessageRequest {
    return new SliceMessageRequest({
      outcome: SliceMessageOutcome.UNKNOWN_FIELD, issue: null, repository: null, agent: null, text: null, fields,
    })
  }

  static isAccepted(asked: SliceMessageRequest): asked is AcceptedSliceMessageRequest {
    return asked.outcome === SliceMessageOutcome.ACCEPTED
  }

  static #isFieldMap(given: unknown): given is Record<string, unknown> {
    return given !== null && typeof given === 'object' && !Array.isArray(given)
  }

  static from(rawIssue: unknown, raw: string): SliceMessageRequest {
    if (typeof rawIssue !== 'string' || !SliceMessageRequest.#ISSUE_SHAPE.test(rawIssue)) {
      return SliceMessageRequest.refused(SliceMessageOutcome.MALFORMED_ISSUE)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return SliceMessageRequest.refused(SliceMessageOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (!SliceMessageRequest.#isFieldMap(parsed)) {
      return SliceMessageRequest.refused(SliceMessageOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter((field) => !SliceMessageRequest.KNOWN_FIELDS.includes(field))
    if (unknown.length > 0) {
      return SliceMessageRequest.withUnknownFields(unknown.sort())
    }
    const repo = parsed[SliceMessageRequest.REPO_FIELD]
    if (!RepositoryName.isWellFormed(repo)) {
      return SliceMessageRequest.refused(SliceMessageOutcome.MALFORMED_REPO)
    }
    const agent = parsed[SliceMessageRequest.AGENT_FIELD]
    if (!ConversationId.isWellFormed(agent)) {
      return SliceMessageRequest.refused(SliceMessageOutcome.MALFORMED_AGENT)
    }
    const text = parsed[SliceMessageRequest.TEXT_FIELD]
    if (typeof text !== 'string' || text.length === 0) {
      return SliceMessageRequest.refused(SliceMessageOutcome.MALFORMED_TEXT)
    }

    return SliceMessageRequest.accepted({
      issue: Number(rawIssue), repository: new RepositoryName(repo), agent, text,
    })
  }
}

type SliceMessageRefusalOf = (asked: SliceMessageRequest) => Refusal

class SliceMessageRefusal {
  static readonly #BY_OUTCOME: Projection<SliceMessageRefusalOf> = new Projection<SliceMessageRefusalOf>('refusal', [
    [SliceMessageOutcome.BODY_NOT_A_JSON_OBJECT, () => new Refusal({
      status: 400, code: SliceMessageOutcome.BODY_NOT_A_JSON_OBJECT, detail: 'body must be a JSON object',
    })],
    [SliceMessageOutcome.UNKNOWN_FIELD, (asked) => new Refusal({
      status: 400, code: SliceMessageOutcome.UNKNOWN_FIELD, detail: `unknown field(s): ${asked.fields.join(', ')}`,
    })],
    [SliceMessageOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: SliceMessageOutcome.MALFORMED_REPO,
      detail: `${SliceMessageRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
    [SliceMessageOutcome.MALFORMED_ISSUE, () => new Refusal({
      status: 400,
      code: SliceMessageOutcome.MALFORMED_ISSUE,
      detail: `${SliceMessageRoute.ISSUE_PARAMETER} must be a positive integer`,
    })],
    [SliceMessageOutcome.MALFORMED_AGENT, () => new Refusal({
      status: 400,
      code: SliceMessageOutcome.MALFORMED_AGENT,
      detail: `${SliceMessageRequest.AGENT_FIELD} must be a conversation id such as ${ConversationId.EXAMPLE}`,
    })],
    [SliceMessageOutcome.MALFORMED_TEXT, () => new Refusal({
      status: 400,
      code: SliceMessageOutcome.MALFORMED_TEXT,
      detail: `${SliceMessageRequest.TEXT_FIELD} must be a non-empty string`,
    })],
  ])

  static of(asked: SliceMessageRequest): Refusal {
    return SliceMessageRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }
}

type SliceMessageFailureConstructor = new (reason: string) => Error
type SliceMessageCollapseOf = (cause: Error) => Refusal

export class SliceMessageCollapse {
  static readonly #STATUS = 400

  static #collapsed(code: string): SliceMessageCollapseOf {
    return (cause) => new Refusal({ status: SliceMessageCollapse.#STATUS, code, detail: cause.message })
  }

  static readonly #BY_FAILURE: Projection<SliceMessageCollapseOf, SliceMessageFailureConstructor> =
    new Projection<SliceMessageCollapseOf, SliceMessageFailureConstructor>('refusal', [
      [PlanAgentNotResumed, SliceMessageCollapse.#collapsed('slice-message-not-delivered')],
      [SliceNotReopened, SliceMessageCollapse.#collapsed('slice-message-not-reopened')],
      [ReopenNotUnderstood, SliceMessageCollapse.#collapsed('slice-message-reopen-not-understood')],
      [PlanStatusNotRead, SliceMessageCollapse.#collapsed('slice-message-status-not-read')],
      [PlanStatusNotUnderstood, SliceMessageCollapse.#collapsed('slice-message-status-not-understood')],
    ])

  static of(cause: Error): Refusal {
    return SliceMessageCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static #declared(): SliceMessageFailureConstructor[] {
    return SliceMessageCollapse.#BY_FAILURE.members()
  }

  static declaredFailures(): string[] {
    return SliceMessageCollapse.#declared().map((failure) => failure.name)
  }

  static declaredCodes(): string[] {
    return SliceMessageCollapse.#declared().map((failure) => SliceMessageCollapse.of(new failure('x')).code)
  }
}

export class SliceMessageRoute {
  static readonly PATH = '/slices/:issue/message'
  static readonly METHOD = 'POST'
  static readonly ISSUE_PARAMETER = 'issue'

  static handledBy(fixes: SliceChangeAsked): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const asked = SliceMessageRequest.from(request.params[SliceMessageRoute.ISSUE_PARAMETER], JsonBody.textOf(request))
      if (!SliceMessageRequest.isAccepted(asked)) {
        Answer.refuseAs(response, SliceMessageRefusal.of(asked))
        return
      }
      try {
        await fixes({
          agent: asked.agent, issue: asked.issue, repository: asked.repository, changes: asked.text,
        })
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, SliceMessageCollapse.of(cause))
        return
      }
      Answer.send(response, 202, { status: 'delivered' })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SliceMessageRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}

export class SliceHeldChangeRoute {
  static readonly PATH = '/slices/:issue/held-change'
  static readonly METHOD = 'POST'
  static readonly ISSUE_PARAMETER = 'issue'
  static readonly STATUS = 'held'

  static handledBy(hold: SliceChangeHeld): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const asked = SliceMessageRequest.from(
        request.params[SliceHeldChangeRoute.ISSUE_PARAMETER], JsonBody.textOf(request),
      )
      if (!SliceMessageRequest.isAccepted(asked)) {
        Answer.refuseAs(response, SliceMessageRefusal.of(asked))
        return
      }
      let ticket: string
      try {
        ticket = await hold({
          agent: asked.agent, issue: asked.issue, repository: asked.repository, changes: asked.text,
        })
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, SliceMessageCollapse.of(cause))
        return
      }
      Answer.send(response, 202, { status: SliceHeldChangeRoute.STATUS, ticket })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SliceHeldChangeRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
