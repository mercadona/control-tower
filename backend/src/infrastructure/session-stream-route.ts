import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from './http.ts'
import type { LiveSessions } from '../domain/ports/live-sessions.ts'
import { WatchLiveSession, WatchLiveSessionParams } from '../application/queries/watch-live-session.ts'

export const SessionStreamOutcome = Object.freeze({ NOT_LIVE: 'session-not-live' } as const)

export class SessionStreamRoute {
  static readonly PATH = '/sessions/:id/stream'
  static readonly METHOD = 'GET'
  static readonly ID_PARAMETER = 'id'
  static readonly #NOT_LIVE_DETAIL = 'no live session answers to that id'
  static readonly #HEADERS: Readonly<Record<string, string>> = Object.freeze({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  static frameFor(bytes: string): string {
    return `data: ${JSON.stringify({ bytes })}\n\n`
  }

  static notLive(): Refusal {
    return new Refusal({ status: 400, code: SessionStreamOutcome.NOT_LIVE, detail: SessionStreamRoute.#NOT_LIVE_DETAIL })
  }

  static handledBy(liveSessions: LiveSessions, watchLiveSession: WatchLiveSession): RequestHandler {
    return (request: Request, response: Response): void => {
      const session = liveSessions.find(request.params[SessionStreamRoute.ID_PARAMETER] as string)
      if (session === null) {
        Answer.refuseAs(response, SessionStreamRoute.notLive())
        return
      }
      response.writeHead(200, SessionStreamRoute.#HEADERS)
      const watched = watchLiveSession.execute(new WatchLiveSessionParams({
        session,
        onBytes: (bytes) => { response.write(SessionStreamRoute.frameFor(bytes)) },
      }))
      request.on('close', () => {
        watched.stop()
        response.end()
      })
      response.write(SessionStreamRoute.frameFor(watched.printed))
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SessionStreamRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
