import type { Request, RequestHandler, Response } from 'express'
import { Answer } from './http.ts'
import type { ListLiveSessions } from '../application/queries/list-live-sessions.ts'

export class SessionsRoute {
  static readonly PATH = '/sessions'
  static readonly METHOD = 'GET'

  static handledBy(listLiveSessions: ListLiveSessions): RequestHandler {
    return (request: Request, response: Response): void => {
      const listed = listLiveSessions.execute()
      Answer.send(response, 200, {
        sessions: listed.sessions.map((session) => ({ id: session.id, name: session.name })),
      })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SessionsRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
