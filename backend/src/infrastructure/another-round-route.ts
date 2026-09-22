import { Answer, JsonBody, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { AnotherRoundNotGranted, PlanAgentNotResumed, PlanFailure } from '../domain/exceptions.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { Request, RequestHandler, Response } from 'express'

export const AnotherRoundOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_ISSUE: 'another-round-malformed-issue',
  MALFORMED_AGENT: 'another-round-malformed-agent',
  MALFORMED_INSTRUCTION: 'another-round-malformed-instruction',
} as const)

export type AnotherRoundOutcomeValue = (typeof AnotherRoundOutcome)[keyof typeof AnotherRoundOutcome]

export type AnotherRoundAsked = (asked: {
  agent: string, issue: number, repository: RepositoryName, instruction: string,
}) => Promise<void>

type AcceptedAnotherRoundRequest = AnotherRoundRequest & {
  readonly issue: number, readonly repository: RepositoryName, readonly agent: string, readonly instruction: string,
}

class AnotherRoundRequest {
  static readonly REPO_FIELD = 'repo'
  static readonly AGENT_FIELD = 'agent'
  static readonly INSTRUCTION_FIELD = 'instruction'
  static readonly KNOWN_FIELDS: readonly string[] = Object.freeze([
    AnotherRoundRequest.REPO_FIELD, AnotherRoundRequest.AGENT_FIELD, AnotherRoundRequest.INSTRUCTION_FIELD,
  ])

  static readonly #ISSUE_SHAPE = /^[1-9][0-9]*$/

  readonly outcome: AnotherRoundOutcomeValue
  readonly issue: number | null
  readonly repository: RepositoryName | null
  readonly agent: string | null
  readonly instruction: string | null
  readonly fields: readonly string[]

  constructor({ outcome, issue, repository, agent, instruction, fields }: {
    outcome: AnotherRoundOutcomeValue,
    issue: number | null,
    repository: RepositoryName | null,
    agent: string | null,
    instruction: string | null,
    fields: readonly string[],
  }) {
    this.outcome = outcome
    this.issue = issue
    this.repository = repository
    this.agent = agent
    this.instruction = instruction
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted({ issue, repository, agent, instruction }: {
    issue: number, repository: RepositoryName, agent: string, instruction: string,
  }): AnotherRoundRequest {
    return new AnotherRoundRequest({
      outcome: AnotherRoundOutcome.ACCEPTED, issue, repository, agent, instruction, fields: [],
    })
  }

  static refused(outcome: AnotherRoundOutcomeValue): AnotherRoundRequest {
    return new AnotherRoundRequest({ outcome, issue: null, repository: null, agent: null, instruction: null, fields: [] })
  }

  static withUnknownFields(fields: readonly string[]): AnotherRoundRequest {
    return new AnotherRoundRequest({
      outcome: AnotherRoundOutcome.UNKNOWN_FIELD, issue: null, repository: null, agent: null, instruction: null, fields,
    })
  }

  static isAccepted(asked: AnotherRoundRequest): asked is AcceptedAnotherRoundRequest {
    return asked.outcome === AnotherRoundOutcome.ACCEPTED
  }

  static #isFieldMap(given: unknown): given is Record<string, unknown> {
    return given !== null && typeof given === 'object' && !Array.isArray(given)
  }

  static from(rawIssue: unknown, raw: string): AnotherRoundRequest {
    if (typeof rawIssue !== 'string' || !AnotherRoundRequest.#ISSUE_SHAPE.test(rawIssue)) {
      return AnotherRoundRequest.refused(AnotherRoundOutcome.MALFORMED_ISSUE)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return AnotherRoundRequest.refused(AnotherRoundOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (!AnotherRoundRequest.#isFieldMap(parsed)) {
      return AnotherRoundRequest.refused(AnotherRoundOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter((field) => !AnotherRoundRequest.KNOWN_FIELDS.includes(field))
    if (unknown.length > 0) {
      return AnotherRoundRequest.withUnknownFields(unknown.sort())
    }
    const repo = parsed[AnotherRoundRequest.REPO_FIELD]
    if (!RepositoryName.isWellFormed(repo)) {
      return AnotherRoundRequest.refused(AnotherRoundOutcome.MALFORMED_REPO)
    }
    const agent = parsed[AnotherRoundRequest.AGENT_FIELD]
    if (!ConversationId.isWellFormed(agent)) {
      return AnotherRoundRequest.refused(AnotherRoundOutcome.MALFORMED_AGENT)
    }
    const instruction = parsed[AnotherRoundRequest.INSTRUCTION_FIELD]
    if (typeof instruction !== 'string'
      || instruction.trim().length === 0
      || instruction.startsWith('--')) {
      return AnotherRoundRequest.refused(AnotherRoundOutcome.MALFORMED_INSTRUCTION)
    }

    return AnotherRoundRequest.accepted({
      issue: Number(rawIssue), repository: new RepositoryName(repo), agent, instruction,
    })
  }
}

type AnotherRoundRefusalOf = (asked: AnotherRoundRequest) => Refusal

class AnotherRoundRefusal {
  static readonly #BY_OUTCOME: Projection<AnotherRoundRefusalOf> = new Projection<AnotherRoundRefusalOf>('refusal', [
    [AnotherRoundOutcome.BODY_NOT_A_JSON_OBJECT, () => new Refusal({
      status: 400, code: AnotherRoundOutcome.BODY_NOT_A_JSON_OBJECT, detail: 'body must be a JSON object',
    })],
    [AnotherRoundOutcome.UNKNOWN_FIELD, (asked) => new Refusal({
      status: 400, code: AnotherRoundOutcome.UNKNOWN_FIELD, detail: `unknown field(s): ${asked.fields.join(', ')}`,
    })],
    [AnotherRoundOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: AnotherRoundOutcome.MALFORMED_REPO,
      detail: `${AnotherRoundRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
    [AnotherRoundOutcome.MALFORMED_ISSUE, () => new Refusal({
      status: 400,
      code: AnotherRoundOutcome.MALFORMED_ISSUE,
      detail: `${AnotherRoundRoute.ISSUE_PARAMETER} must be a positive integer`,
    })],
    [AnotherRoundOutcome.MALFORMED_AGENT, () => new Refusal({
      status: 400,
      code: AnotherRoundOutcome.MALFORMED_AGENT,
      detail: `${AnotherRoundRequest.AGENT_FIELD} must be a conversation id such as ${ConversationId.EXAMPLE}`,
    })],
    [AnotherRoundOutcome.MALFORMED_INSTRUCTION, () => new Refusal({
      status: 400,
      code: AnotherRoundOutcome.MALFORMED_INSTRUCTION,
      detail: `${AnotherRoundRequest.INSTRUCTION_FIELD} must be non-blank text that does not start with --`,
    })],
  ])

  static of(asked: AnotherRoundRequest): Refusal {
    return AnotherRoundRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }
}

type AnotherRoundFailureConstructor = new (reason: string) => Error
type AnotherRoundCollapseOf = (cause: Error) => Refusal

export class AnotherRoundCollapse {
  static #collapsed(status: number, code: string): AnotherRoundCollapseOf {
    return (cause) => new Refusal({ status, code, detail: cause.message })
  }

  static readonly #BY_FAILURE: Projection<AnotherRoundCollapseOf, AnotherRoundFailureConstructor> =
    new Projection<AnotherRoundCollapseOf, AnotherRoundFailureConstructor>('refusal', [
      [AnotherRoundNotGranted, AnotherRoundCollapse.#collapsed(409, 'another-round-not-granted')],
      [PlanAgentNotResumed, AnotherRoundCollapse.#collapsed(400, 'another-round-not-delivered')],
    ])

  static of(cause: Error): Refusal {
    return AnotherRoundCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static #declared(): AnotherRoundFailureConstructor[] {
    return AnotherRoundCollapse.#BY_FAILURE.members()
  }

  static declaredFailures(): string[] {
    return AnotherRoundCollapse.#declared().map((failure) => failure.name)
  }

  static declaredCodes(): string[] {
    return AnotherRoundCollapse.#declared().map((failure) => AnotherRoundCollapse.of(new failure('x')).code)
  }
}

export class AnotherRoundRoute {
  static readonly PATH = '/slices/:issue/another-round'
  static readonly METHOD = 'POST'
  static readonly ISSUE_PARAMETER = 'issue'
  static readonly STATUS = 'granted'

  static handledBy(grant: AnotherRoundAsked): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const asked = AnotherRoundRequest.from(request.params[AnotherRoundRoute.ISSUE_PARAMETER], JsonBody.textOf(request))
      if (!AnotherRoundRequest.isAccepted(asked)) {
        Answer.refuseAs(response, AnotherRoundRefusal.of(asked))
        return
      }
      try {
        await grant({
          agent: asked.agent, issue: asked.issue, repository: asked.repository, instruction: asked.instruction,
        })
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, AnotherRoundCollapse.of(cause))
        return
      }
      Answer.send(response, 202, { status: AnotherRoundRoute.STATUS })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', AnotherRoundRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
