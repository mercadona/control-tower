import { Answer, JsonBody, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { ResizeSession, ResizeSessionParams } from '../application/actions/resize-session.ts'
import { LiveSessionNotLive } from '../domain/ports/live-sessions.ts'
import type { LiveSessions } from '../domain/ports/live-sessions.ts'
import type { Request, RequestHandler, Response } from 'express'

export const SessionResizeOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_SIZE: 'malformed-size',
  NOT_LIVE: 'session-not-live',
} as const)

export type SessionResizeOutcome = typeof SessionResizeOutcome[keyof typeof SessionResizeOutcome]

export class SessionResizeRoute {
  static readonly PATH = '/sessions/:id/resize'
  static readonly METHOD = 'POST'
  static readonly ID_PARAMETER = 'id'
  static readonly COLS_FIELD = 'cols'
  static readonly ROWS_FIELD = 'rows'
  static readonly MAX_COLUMNS = 500
  static readonly MAX_ROWS = 300

  static handledBy(liveSessions: LiveSessions, resizeSession: ResizeSession): RequestHandler {
    return (request: Request, response: Response): void => {
      const asked = SessionResizeRequest.from(JsonBody.textOf(request))
      if (!SessionResizeRequest.isAccepted(asked)) {
        Answer.refuseAs(response, SessionResizeRefusal.of(asked))
        return
      }
      const session = liveSessions.find(request.params[SessionResizeRoute.ID_PARAMETER] as string)
      if (session === null) {
        Answer.refuseAs(
          response, SessionResizeRefusal.of(SessionResizeRequest.refused(SessionResizeOutcome.NOT_LIVE))
        )
        return
      }
      try {
        resizeSession.execute(new ResizeSessionParams({ session, cols: asked.cols, rows: asked.rows }))
      } catch (failure) {
        if (!(failure instanceof LiveSessionNotLive)) throw failure
        Answer.refuseAs(
          response, SessionResizeRefusal.of(SessionResizeRequest.refused(SessionResizeOutcome.NOT_LIVE))
        )
        return
      }
      Answer.send(response, 202, { status: 'resized', id: session.id, cols: asked.cols, rows: asked.rows })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SessionResizeRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}

type AcceptedSessionResizeRequest = SessionResizeRequest & { readonly cols: number, readonly rows: number }

class SessionResizeRequest {
  static readonly KNOWN_FIELDS: readonly string[] =
    Object.freeze([SessionResizeRoute.COLS_FIELD, SessionResizeRoute.ROWS_FIELD])

  readonly outcome: SessionResizeOutcome
  readonly cols: number | null
  readonly rows: number | null
  readonly fields: readonly string[]

  constructor({ outcome, cols, rows, fields }: {
    outcome: SessionResizeOutcome,
    cols: number | null,
    rows: number | null,
    fields: readonly string[],
  }) {
    this.outcome = outcome
    this.cols = cols
    this.rows = rows
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted(cols: number, rows: number): SessionResizeRequest {
    return new SessionResizeRequest({ outcome: SessionResizeOutcome.ACCEPTED, cols, rows, fields: [] })
  }

  static refused(outcome: SessionResizeOutcome): SessionResizeRequest {
    return new SessionResizeRequest({ outcome, cols: null, rows: null, fields: [] })
  }

  static withUnknownFields(fields: readonly string[]): SessionResizeRequest {
    return new SessionResizeRequest({ outcome: SessionResizeOutcome.UNKNOWN_FIELD, cols: null, rows: null, fields })
  }

  static isAccepted(asked: SessionResizeRequest): asked is AcceptedSessionResizeRequest {
    return asked.outcome === SessionResizeOutcome.ACCEPTED
  }

  static #isFieldMap(given: unknown): given is Record<string, unknown> {
    return given !== null && typeof given === 'object' && !Array.isArray(given)
  }

  static #isWellFormedSize(given: unknown, max: number): given is number {
    return typeof given === 'number' && Number.isInteger(given) && given > 0 && given <= max
  }

  static from(raw: string): SessionResizeRequest {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return SessionResizeRequest.refused(SessionResizeOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (!SessionResizeRequest.#isFieldMap(parsed)) {
      return SessionResizeRequest.refused(SessionResizeOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter(
      (field) => !SessionResizeRequest.KNOWN_FIELDS.includes(field)
    )
    if (unknown.length > 0) {
      return SessionResizeRequest.withUnknownFields(unknown.sort())
    }
    const cols = parsed[SessionResizeRoute.COLS_FIELD]
    const rows = parsed[SessionResizeRoute.ROWS_FIELD]
    if (
      !SessionResizeRequest.#isWellFormedSize(cols, SessionResizeRoute.MAX_COLUMNS)
      || !SessionResizeRequest.#isWellFormedSize(rows, SessionResizeRoute.MAX_ROWS)
    ) {
      return SessionResizeRequest.refused(SessionResizeOutcome.MALFORMED_SIZE)
    }

    return SessionResizeRequest.accepted(cols, rows)
  }
}

type RefusalOf = (asked: SessionResizeRequest) => Refusal

export class SessionResizeRefusal {
  static readonly #BY_OUTCOME: Projection<RefusalOf> = new Projection<RefusalOf>('refusal', [
    [SessionResizeOutcome.BODY_NOT_A_JSON_OBJECT, () => new Refusal({
      status: 400,
      code: SessionResizeOutcome.BODY_NOT_A_JSON_OBJECT,
      detail: 'body must be a JSON object',
    })],
    [SessionResizeOutcome.UNKNOWN_FIELD, (asked) => new Refusal({
      status: 400,
      code: SessionResizeOutcome.UNKNOWN_FIELD,
      detail: `unknown field: ${asked.fields.join(', ')}`,
    })],
    [SessionResizeOutcome.MALFORMED_SIZE, () => new Refusal({
      status: 400,
      code: SessionResizeOutcome.MALFORMED_SIZE,
      detail:
        `${SessionResizeRoute.COLS_FIELD} and ${SessionResizeRoute.ROWS_FIELD} must be positive integers, `
        + `at most ${SessionResizeRoute.MAX_COLUMNS} and ${SessionResizeRoute.MAX_ROWS}`,
    })],
    [SessionResizeOutcome.NOT_LIVE, () => new Refusal({
      status: 400,
      code: SessionResizeOutcome.NOT_LIVE,
      detail: 'no live session answers to that id',
    })],
  ])

  static of(asked: SessionResizeRequest): Refusal {
    return SessionResizeRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }
}
