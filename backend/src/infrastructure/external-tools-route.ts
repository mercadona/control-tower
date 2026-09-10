import type { Request, RequestHandler, Response } from 'express'
import { Answer } from './http.ts'
import type { SurveyExternalTools } from '../application/queries/survey-external-tools.ts'

export class ExternalToolsRoute {
  static readonly PATH = '/external-tools'
  static readonly METHOD = 'GET'

  static handledBy(surveyExternalTools: SurveyExternalTools): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const surveyed = await surveyExternalTools.execute()
      Answer.send(response, 200, {
        ready: surveyed.ready,
        tools: surveyed.sessions.map((session) => ({
          tool: session.tool,
          installed: session.installed,
          session: session.state,
          fix: session.fix,
        })),
      })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', ExternalToolsRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
