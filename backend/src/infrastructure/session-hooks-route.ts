import type { Request, RequestHandler, Response } from 'express'
import { Answer, JsonBody, Refusal } from './http.ts'
import { LocalSettingsSessionHooks } from './local-settings-session-hooks.ts'
import { Projection } from './projection.ts'
import { SessionAttention } from '../domain/value-objects/session-attention.ts'
import { TimelineEventKind } from '../domain/value-objects/session-timeline-event.ts'
import type { TimelineEventKindValue } from '../domain/value-objects/session-timeline-event.ts'
import { AttendOutcome } from './coordinating-sessions.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'

export const SessionHookOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  HOOK_NOT_UNDERSTOOD: 'hook-not-understood',
  CONVERSATION_NOT_LIVE: 'conversation-not-live',
  TIMELINE_NOT_RECORDED: 'timeline-not-recorded',
} as const)

export type SessionHookOutcomeValue = (typeof SessionHookOutcome)[keyof typeof SessionHookOutcome]

type HookPayload = Readonly<Record<string, unknown>>
type HookProjection = { attention: SessionAttention, timelineEvent: TimelineEventKindValue }
type ProjectionOf = (payload: HookPayload) => HookProjection | null

class SessionHookEvents {
  static readonly #TRANSFORM_BY_EVENT: Readonly<Record<string, ProjectionOf>> = {
    UserPromptSubmit: () => ({ attention: SessionAttention.working(), timelineEvent: TimelineEventKind.WORKING }),
    Notification: (payload) => SessionHookEvents.#notified(payload),
    Stop: () => ({ attention: SessionAttention.waiting(null), timelineEvent: TimelineEventKind.COMPLETED }),
  }

  static readonly #BY_NAME: Projection<ProjectionOf> = new Projection<ProjectionOf>(
    'hook event',
    LocalSettingsSessionHooks.EVENTS.map((event) => [event, SessionHookEvents.#transformFor(event)] as const)
  )

  static #notified(payload: HookPayload): HookProjection | null {
    if (payload[SessionHooksRoute.NOTIFICATION_TYPE_FIELD] !== SessionHooksRoute.PERMISSION_PROMPT) return null

    return {
      attention: SessionAttention.waiting(SessionHookEvents.#textOf(payload, SessionHooksRoute.MESSAGE_FIELD)),
      timelineEvent: TimelineEventKind.WAITING_FOR_PERMISSION,
    }
  }

  static #textOf(payload: HookPayload, field: string): string | null {
    const said = payload[field]
    if (typeof said !== 'string') return null
    const text = said.trim()

    return text === '' ? null : text
  }

  static #transformFor(event: string): ProjectionOf {
    const transform = SessionHookEvents.#TRANSFORM_BY_EVENT[event]
    if (transform === undefined) {
      throw new Error(`no attention transform declared for the installed hook event ${event}`)
    }

    return transform
  }

  static understands(name: unknown): name is string {
    return typeof name === 'string' && SessionHookEvents.#BY_NAME.members().includes(name)
  }

  static projectionFor(name: string, payload: HookPayload): HookProjection | null {
    return SessionHookEvents.#BY_NAME.of(name)(payload)
  }
}

type AcceptedSessionHookRequest = SessionHookRequest & { readonly conversation: string }

class SessionHookRequest {
  readonly outcome: SessionHookOutcomeValue
  readonly conversation: string | null
  readonly projected: HookProjection | null

  private constructor({ outcome, conversation, projected }: {
    outcome: SessionHookOutcomeValue, conversation: string | null, projected: HookProjection | null,
  }) {
    this.outcome = outcome
    this.conversation = conversation
    this.projected = projected
    Object.freeze(this)
  }

  static accepted(conversation: string, projected: HookProjection | null): SessionHookRequest {
    return new SessionHookRequest({ outcome: SessionHookOutcome.ACCEPTED, conversation, projected })
  }

  static refused(outcome: SessionHookOutcomeValue): SessionHookRequest {
    return new SessionHookRequest({ outcome, conversation: null, projected: null })
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

    return SessionHookRequest.accepted(conversation, SessionHookEvents.projectionFor(event, parsed))
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
    [SessionHookOutcome.TIMELINE_NOT_RECORDED, () => new Refusal({
      status: 400,
      code: SessionHookOutcome.TIMELINE_NOT_RECORDED,
      detail: 'the attention moved but the timeline event could not be recorded',
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
  static readonly NOTIFICATION_TYPE_FIELD = 'notification_type'
  static readonly PERMISSION_PROMPT = 'permission_prompt'

  static handledBy(held: CoordinatingSessions): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const asked = SessionHookRequest.from(JsonBody.textOf(request))
      if (!SessionHookRequest.isAccepted(asked)) {
        Answer.refuseAs(response, SessionHookRefusal.of(asked.outcome))
        return
      }
      if (asked.projected === null) {
        Answer.send(response, 202, { status: 'ignored' })
        return
      }
      const attended = await held.attend({
        conversation: asked.conversation,
        attention: asked.projected.attention,
        event: asked.projected.timelineEvent,
      })
      if (attended.outcome === AttendOutcome.NO_MATCH) {
        Answer.refuseAs(response, SessionHookRefusal.of(SessionHookOutcome.CONVERSATION_NOT_LIVE))
        return
      }
      if (attended.outcome === AttendOutcome.NOT_RECORDED) {
        Answer.refuseAs(response, SessionHookRefusal.of(SessionHookOutcome.TIMELINE_NOT_RECORDED))
        return
      }
      Answer.send(response, 202, { status: 'reported', attention: asked.projected.attention.status })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SessionHooksRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
