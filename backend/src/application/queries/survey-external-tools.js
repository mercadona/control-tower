export class SurveyExternalToolsResult {
  constructor({ sessions }) {
    this.sessions = Object.freeze([...sessions])
    Object.freeze(this)
  }

  get ready() {
    return this.sessions.every((session) => !session.blocks)
  }
}

export class SurveyExternalTools {
  constructor({ toolSessions }) {
    this.toolSessions = toolSessions
  }

  async execute() {
    return new SurveyExternalToolsResult({ sessions: await this.toolSessions.all() })
  }
}
