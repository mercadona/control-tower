import type { Request, RequestHandler, Response } from 'express'
import { Answer, JsonBody, Refusal } from './http.ts'
import { LocalSettingsSessionHooks } from './local-settings-session-hooks.ts'
import { Projection } from './projection.ts'
import { SessionAttention } from '../domain/value-objects/session-attention.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'

export const SessionHookOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  HOOK_NOT_UNDERSTOOD: 'hook-not-understood',
  CONVERSATION_NOT_LIVE: 'conversation-not-live',
} as const)

export type SessionHookOutcomeValue = (typeof SessionHookOutcome)[keyof typeof SessionHookOutcome]

type AttentionOf = (message: string | null) => SessionAttention

class SessionHookEvents {
  static readonly #TRANSFORM_BY_EVENT: Readonly<Record<string, AttentionOf>> = {
    UserPromptSubmit: () => SessionAttention.working(),
    Notification: (message) => SessionAttention.waiting(message),
    Stop: () => SessionAttention.waiting(null),
  }

  static readonly #BY_NAME: Projection<AttentionOf> = new Projection<AttentionOf>(
    'hook event',
    LocalSettingsSessionHooks.EVENTS.map((event) => [event, SessionHookEvents.#transformFor(event)] as const)
  )

  static #transformFor(event: string): AttentionOf {
    const transform = SessionHookEvents.#TRANSFORM_BY_EVENT[event]
    if (transform === undefined) {
      throw new Error(`no attention transform declared for the installed hook event ${event}`)
    }

    return transform
  }

  static understands(name: unknown): name is string {
    return typeof name === 'string' && SessionHookEvents.#BY_NAME.members().includes(name)
  }

  static attentionFor(name: string, message: string | null): SessionAttention {
    return SessionHookEvents.#BY_NAME.of(name)(message)
  }
}

type AcceptedSessionHookRequest = SessionHookRequest & { readonly conversation: string, readonly attention: SessionAttention }

class SessionHookRequest {
  readonly outcome: SessionHookOutcomeValue
  readonly conversation: string | null
  readonly attention: SessionAttention | null

  private constructor({ outcome, conversation, attention }: {
    outcome: SessionHookOutcomeValue, conversation: string | null, attention: SessionAttention | null,
  }) {
    this.outcome = outcome
    this.conversation = conversation
    this.attention = attention
    Object.freeze(this)
  }

  static accepted(conversation: string, attention: SessionAttention): SessionHookRequest {
    return new SessionHookRequest({ outcome: SessionHookOutcome.ACCEPTED, conversation, attention })
  }

  static refused(outcome: SessionHookOutcomeValue): SessionHookRequest {
    return new SessionHookRequest({ outcome, conversation: null, attention: null })
  }

  static isAccepted(asked: SessionHookRequest): asked is AcceptedSessionHookRequest {
    return asked.outcome === SessionHookOutcome.ACCEPTED
  }

  static #isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  static #isWellFormedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0
  }

  static #messageOf(parsed: Record<string, unknown>): string | null {
    const message = parsed[SessionHooksRoute.MESSAGE_FIELD]

    return typeof message === 'string' ? message : null
  }

  static from(raw: string): SessionHookRequest {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return SessionHookRequest.refused(SessionHookOutcome.HOOK_NOT_UNDERSTOOD)
    }
    if (!SessionHookRequest.#isRecord(parsed)) {
      return SessionHookRequest.refused(SessionHookOutcome.HOOK_NOT_UNDERSTOOD)
    }
    const conversation = parsed[SessionHooksRoute.SESSION_FIELD]
    if (!SessionHookRequest.#isWellFormedId(conversation)) {
      return SessionHookRequest.refused(SessionHookOutcome.HOOK_NOT_UNDERSTOOD)
    }
    const event = parsed[SessionHooksRoute.EVENT_FIELD]
    if (!SessionHookEvents.understands(event)) {
      return SessionHookRequest.refused(SessionHookOutcome.HOOK_NOT_UNDERSTOOD)
    }

    return SessionHookRequest.accepted(conversation, SessionHookEvents.attentionFor(event, SessionHookRequest.#messageOf(parsed)))
  }
}

type RefusalOf = () => Refusal

class SessionHookRefusal {
  static readonly #BY_OUTCOME: Projection<RefusalOf> = new Projection<RefusalOf>('refusal', [
    [SessionHookOutcome.HOOK_NOT_UNDERSTOOD, () => new Refusal({
      status: 400,
      code: SessionHookOutcome.HOOK_NOT_UNDERSTOOD,
      detail: 'the hook payload does not carry a known event and a session id',
    })],
    [SessionHookOutcome.CONVERSATION_NOT_LIVE, () => new Refusal({
      status: 400,
      code: SessionHookOutcome.CONVERSATION_NOT_LIVE,
      detail: 'no held conversation answers to that session id',
    })],
  ])

  static of(outcome: SessionHookOutcomeValue): Refusal {
    return SessionHookRefusal.#BY_OUTCOME.of(outcome)()
  }
}

export class SessionHooksRoute {
  static readonly PATH = '/session-hooks'
  static readonly METHOD = 'POST'
  static readonly SESSION_FIELD = 'session_id'
  static readonly EVENT_FIELD = 'hook_event_name'
  static readonly MESSAGE_FIELD = 'message'

  static handledBy(held: CoordinatingSessions): RequestHandler {
    return (request: Request, response: Response): void => {
      const asked = SessionHookRequest.from(JsonBody.textOf(request))
      if (!SessionHookRequest.isAccepted(asked)) {
        Answer.refuseAs(response, SessionHookRefusal.of(asked.outcome))
        return
      }
      const attended = held.attend({ conversation: asked.conversation, attention: asked.attention })
      if (!attended) {
        Answer.refuseAs(response, SessionHookRefusal.of(SessionHookOutcome.CONVERSATION_NOT_LIVE))
        return
      }
      Answer.send(response, 202, { status: 'reported', attention: asked.attention.status })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SessionHooksRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
