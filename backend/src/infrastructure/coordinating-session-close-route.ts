import type { Request, RequestHandler, Response } from 'express'
import { Answer, JsonBody, Refusal } from './http.ts'
import { CloseReservation } from './coordinating-sessions.ts'
import {
  CloseCoordinatingSessionParams,
  CoordinatingSessionClosed,
} from '../application/actions/close-coordinating-session.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import {
  CoordinatingSessionTargetChanged,
  SessionClosureNotRecorded,
  SessionClosureNotUnderstood,
  SessionNotTerminated,
  SessionTerminationUnconfirmed,
} from '../domain/exceptions.ts'
import type { CloseCoordinatingSession } from '../application/actions/close-coordinating-session.ts'
import type {
  CloseReservationValue,
  CoordinatingSessionIdentity,
  CoordinatingSessions,
  HeldCoordinatingSession,
} from './coordinating-sessions.ts'

class SessionCloseRequest {
  readonly params: CloseCoordinatingSessionParams | null
  readonly detail: string | null

  private constructor(params: CloseCoordinatingSessionParams | null, detail: string | null) {
    this.params = params
    this.detail = detail
    Object.freeze(this)
  }

  static from(text: string): SessionCloseRequest {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return new SessionCloseRequest(null, 'body must be a JSON object with conversation and target UUIDs')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new SessionCloseRequest(null, 'body must be a JSON object with conversation and target UUIDs')
    }
    const keys = Object.keys(parsed).sort()
    if (keys.length !== 2 || keys[0] !== 'conversation' || keys[1] !== 'target') {
      return new SessionCloseRequest(null, 'body must contain exactly conversation and target')
    }
    if (!('conversation' in parsed) || !('target' in parsed)
      || !ConversationId.isWellFormed(parsed.conversation) || !ConversationId.isWellFormed(parsed.target)) {
      return new SessionCloseRequest(null, 'conversation and target must be UUIDs')
    }

    return new SessionCloseRequest(new CloseCoordinatingSessionParams({
      conversation: new ConversationId(parsed.conversation),
      target: parsed.target,
      session: null,
    }), null)
  }
}

export class CoordinatingSessionCloseRoute {
  static readonly PATH = '/coordinating-session/close'
  static readonly METHODS = 'POST'
  static readonly #MALFORMED = 'malformed-session-close'
  static readonly #OPENING = 'coordinating-session-opening'

  static closing(close: CloseCoordinatingSession, registry: CoordinatingSessions): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const asked = SessionCloseRequest.from(JsonBody.textOf(request))
      if (asked.params === null) {
        Answer.refuse(response, 400, CoordinatingSessionCloseRoute.#MALFORMED, asked.detail!)
        return
      }
      const identity = CoordinatingSessionCloseRoute.#identityOf(asked.params)
      const reserved = registry.beginClose(identity)
      switch (reserved.outcome) {
        case CloseReservation.OPENING:
          Answer.refuse(
            response,
            400,
            CoordinatingSessionCloseRoute.#OPENING,
            'a coordinating conversation is opening or recovering: wait for it to settle before closing',
          )
          return
        case CloseReservation.TARGET_CHANGED:
          await CoordinatingSessionCloseRoute.#acknowledgeOld(close, asked.params, response)
          return
        case CloseReservation.JOINED:
          await CoordinatingSessionCloseRoute.#answerClosing(reserved.closing!, response)
          return
        case CloseReservation.RESERVED:
          await CoordinatingSessionCloseRoute.#closeReserved(close, registry, identity, reserved.held!, response)
          return
        default: {
          const exhaustive: never = reserved.outcome
          throw new Error(`no coordinating close declared for ${exhaustive}`)
        }
      }
    }
  }

  static async #closeReserved(
    close: CloseCoordinatingSession,
    registry: CoordinatingSessions,
    identity: CoordinatingSessionIdentity,
    held: HeldCoordinatingSession,
    response: Response,
  ): Promise<void> {
    const closing = close.execute(new CloseCoordinatingSessionParams({
      conversation: held.conversation.id,
      target: held.target,
      session: held.terminal,
    })).then(
      (closed) => {
        registry.finishClose(identity)
        return closed
      },
      (cause: unknown) => {
        const refusal = CoordinatingSessionCloseRoute.#refusalOf(cause)
        registry.failClose(identity, refusal)
        throw cause
      },
    )
    registry.trackClose(identity, closing)
    await CoordinatingSessionCloseRoute.#answerClosing(closing, response)
  }

  static async #acknowledgeOld(
    close: CloseCoordinatingSession,
    params: CloseCoordinatingSessionParams,
    response: Response,
  ): Promise<void> {
    try {
      CoordinatingSessionCloseRoute.#answer(response, await close.acknowledge(params))
    } catch (cause) {
      Answer.refuseAs(response, CoordinatingSessionCloseRoute.#refusalOf(cause))
    }
  }

  static async #answerClosing(closing: Promise<unknown>, response: Response): Promise<void> {
    try {
      const closed = await closing
      if (!(closed instanceof CoordinatingSessionClosed)) {
        throw new Error(`a coordinating close answered ${JSON.stringify(closed)}`)
      }
      CoordinatingSessionCloseRoute.#answer(response, closed)
    } catch (cause) {
      Answer.refuseAs(response, CoordinatingSessionCloseRoute.#refusalOf(cause))
    }
  }

  static #answer(response: Response, closed: CoordinatingSessionClosed): void {
    Answer.send(response, 200, {
      status: 'closed',
      conversation: closed.conversation.text,
      target: closed.target,
    })
  }

  static #identityOf(params: CloseCoordinatingSessionParams): CoordinatingSessionIdentity {
    return { conversation: params.conversation.text, target: params.target }
  }

  static #refusalOf(cause: unknown): Refusal {
    if (cause instanceof CoordinatingSessionTargetChanged) {
      return new Refusal({ status: 400, code: 'coordinating-session-target-changed', detail: cause.message })
    }
    if (cause instanceof SessionClosureNotRecorded) {
      return new Refusal({ status: 400, code: 'session-closure-not-recorded', detail: cause.message })
    }
    if (cause instanceof SessionClosureNotUnderstood) {
      return new Refusal({ status: 400, code: 'session-closure-not-understood', detail: cause.message })
    }
    if (cause instanceof SessionNotTerminated) {
      return new Refusal({ status: 400, code: 'session-not-terminated', detail: cause.message })
    }
    if (cause instanceof SessionTerminationUnconfirmed) {
      return new Refusal({ status: 400, code: 'session-termination-unconfirmed', detail: cause.message })
    }
    throw cause
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', CoordinatingSessionCloseRoute.METHODS)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
