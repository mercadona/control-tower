import { Answer } from './http.js'

export class ExternalToolsRoute {
  static PATH = '/external-tools'
  static METHOD = 'GET'

  static handledBy(surveyExternalTools) {
    return async (request, response) => {
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

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', ExternalToolsRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
