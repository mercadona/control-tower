import { Answer, JsonBody, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { TypeIntoSession, TypeIntoSessionParams } from '../application/actions/type-into-session.ts'
import type { LiveSessions } from '../domain/ports/live-sessions.ts'
import type { Request, RequestHandler, Response } from 'express'

export const SessionInputOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_TEXT: 'malformed-text',
  NOT_LIVE: 'session-not-live',
} as const)

export type SessionInputOutcome = typeof SessionInputOutcome[keyof typeof SessionInputOutcome]

export class SessionInputRoute {
  static readonly PATH = '/sessions/:id/input'
  static readonly METHOD = 'POST'
  static readonly ID_PARAMETER = 'id'
  static readonly TEXT_FIELD = 'text'

  static handledBy(liveSessions: LiveSessions, typeIntoSession: TypeIntoSession): RequestHandler {
    return (request: Request, response: Response): void => {
      const asked = SessionInputRequest.from(JsonBody.textOf(request))
      if (!SessionInputRequest.isAccepted(asked)) {
        Answer.refuseAs(response, SessionInputRefusal.of(asked))
        return
      }
      const session = liveSessions.find(request.params[SessionInputRoute.ID_PARAMETER] as string)
      if (session === null) {
        Answer.refuseAs(response, SessionInputRefusal.of(SessionInputRequest.refused(SessionInputOutcome.NOT_LIVE)))
        return
      }
      typeIntoSession.execute(new TypeIntoSessionParams({ session, text: asked.text }))
      Answer.send(response, 202, { status: 'typed', id: session.id })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SessionInputRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}

type AcceptedSessionInputRequest = SessionInputRequest & { readonly text: string }

class SessionInputRequest {
  static readonly KNOWN_FIELDS: readonly string[] = Object.freeze([SessionInputRoute.TEXT_FIELD])

  readonly outcome: SessionInputOutcome
  readonly text: string | null
  readonly fields: readonly string[]

  constructor({ outcome, text, fields }: {
    outcome: SessionInputOutcome,
    text: string | null,
    fields: readonly string[],
  }) {
    this.outcome = outcome
    this.text = text
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted(text: string): SessionInputRequest {
    return new SessionInputRequest({ outcome: SessionInputOutcome.ACCEPTED, text, fields: [] })
  }

  static refused(outcome: SessionInputOutcome): SessionInputRequest {
    return new SessionInputRequest({ outcome, text: null, fields: [] })
  }

  static withUnknownFields(fields: readonly string[]): SessionInputRequest {
    return new SessionInputRequest({ outcome: SessionInputOutcome.UNKNOWN_FIELD, text: null, fields })
  }

  static isAccepted(asked: SessionInputRequest): asked is AcceptedSessionInputRequest {
    return asked.outcome === SessionInputOutcome.ACCEPTED
  }

  static #isFieldMap(given: unknown): given is Record<string, unknown> {
    return given !== null && typeof given === 'object' && !Array.isArray(given)
  }

  static #isWellFormedText(given: unknown): given is string {
    return typeof given === 'string' && given.length > 0
  }

  static from(raw: string): SessionInputRequest {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return SessionInputRequest.refused(SessionInputOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (!SessionInputRequest.#isFieldMap(parsed)) {
      return SessionInputRequest.refused(SessionInputOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter(
      (field) => !SessionInputRequest.KNOWN_FIELDS.includes(field)
    )
    if (unknown.length > 0) {
      return SessionInputRequest.withUnknownFields(unknown.sort())
    }
    const text = parsed[SessionInputRoute.TEXT_FIELD]
    if (!SessionInputRequest.#isWellFormedText(text)) {
      return SessionInputRequest.refused(SessionInputOutcome.MALFORMED_TEXT)
    }

    return SessionInputRequest.accepted(text)
  }
}

type RefusalOf = (asked: SessionInputRequest) => Refusal

export class SessionInputRefusal {
  static readonly #BY_OUTCOME: Projection<RefusalOf> = new Projection<RefusalOf>('refusal', [
    [SessionInputOutcome.BODY_NOT_A_JSON_OBJECT, () => new Refusal({
      status: 400,
      code: SessionInputOutcome.BODY_NOT_A_JSON_OBJECT,
      detail: 'body must be a JSON object',
    })],
    [SessionInputOutcome.UNKNOWN_FIELD, (asked) => new Refusal({
      status: 400,
      code: SessionInputOutcome.UNKNOWN_FIELD,
      detail: `unknown field: ${asked.fields.join(', ')}`,
    })],
    [SessionInputOutcome.MALFORMED_TEXT, () => new Refusal({
      status: 400,
      code: SessionInputOutcome.MALFORMED_TEXT,
      detail: `${SessionInputRoute.TEXT_FIELD} must be a non-empty string`,
    })],
    [SessionInputOutcome.NOT_LIVE, () => new Refusal({
      status: 400,
      code: SessionInputOutcome.NOT_LIVE,
      detail: 'no live session answers to that id',
    })],
  ])

  static of(asked: SessionInputRequest): Refusal {
    return SessionInputRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }
}
