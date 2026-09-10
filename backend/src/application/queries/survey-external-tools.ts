import type { ToolSessions } from '../../domain/ports/tool-sessions.ts'
import type { ToolSession } from '../../domain/value-objects/tool-session.ts'

export class SurveyExternalToolsResult {
  readonly sessions: readonly ToolSession[]

  constructor({ sessions }: { sessions: readonly ToolSession[] }) {
    this.sessions = Object.freeze([...sessions])
    Object.freeze(this)
  }

  get ready(): boolean {
    return this.sessions.every((session) => !session.blocks)
  }
}

export class SurveyExternalTools {
  readonly toolSessions: ToolSessions

  constructor({ toolSessions }: { toolSessions: ToolSessions }) {
    this.toolSessions = toolSessions
  }

  async execute(): Promise<SurveyExternalToolsResult> {
    return new SurveyExternalToolsResult({ sessions: await this.toolSessions.all() })
  }
}
