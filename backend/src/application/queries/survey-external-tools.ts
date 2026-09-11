import type { ToolSessions } from '../../domain/ports/tool-sessions.ts'
import { MetricsDelivery } from '../../domain/value-objects/metrics-delivery.ts'
import type { ToolSession } from '../../domain/value-objects/tool-session.ts'

export class SurveyExternalToolsResult {
  readonly sessions: readonly ToolSession[]
  readonly metricsDelivery: MetricsDelivery

  constructor({ sessions, metricsDelivery }: {
    sessions: readonly ToolSession[],
    metricsDelivery: unknown,
  }) {
    if (!(metricsDelivery instanceof MetricsDelivery)) {
      throw new Error(
        `a survey of the external tools cannot say what is ready without knowing whether metrics delivery is configured, got ${JSON.stringify(metricsDelivery)}`
      )
    }
    this.sessions = Object.freeze([...sessions])
    this.metricsDelivery = metricsDelivery
    Object.freeze(this)
  }

  get ready(): boolean {
    return this.sessions.every((session) => !this.#blocking(session))
  }

  #blocking(session: ToolSession): boolean {
    if (!session.blocks) return false

    return session.tool === MetricsDelivery.TOOL ? this.metricsDelivery.demands(session.tool) : true
  }
}

export class SurveyExternalTools {
  readonly toolSessions: ToolSessions
  readonly metricsDelivery: MetricsDelivery

  constructor({ toolSessions, metricsDelivery }: {
    toolSessions: ToolSessions,
    metricsDelivery: MetricsDelivery,
  }) {
    this.toolSessions = toolSessions
    this.metricsDelivery = metricsDelivery
  }

  async execute(): Promise<SurveyExternalToolsResult> {
    return new SurveyExternalToolsResult({
      sessions: await this.toolSessions.all(),
      metricsDelivery: this.metricsDelivery,
    })
  }
}
