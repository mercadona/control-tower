import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { ReviewsSpy } from '../reviews-spy.ts'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import { SurveyExternalTools, SurveyExternalToolsResult } from '../../src/application/queries/survey-external-tools.ts'
import { ToolSessions } from '../../src/domain/ports/tool-sessions.ts'
import { MetricsDelivery } from '../../src/domain/value-objects/metrics-delivery.ts'
import { SessionState, ToolSession } from '../../src/domain/value-objects/tool-session.ts'

class SurveySpy extends SurveyExternalTools {
  static readonly GH_READY = new ToolSession({ tool: 'gh', installed: true, state: SessionState.READY, fix: null })
  static readonly BQ_MISSING = new ToolSession({
    tool: 'bq', installed: true, state: SessionState.MISSING,
    fix: 'fixture-fix-bq-do-not-copy-into-production',
  })
  static readonly BQ_READY = new ToolSession({
    tool: 'bq', installed: true, state: SessionState.READY, fix: null,
  })
  static readonly CLAUDE_UNKNOWN = new ToolSession({
    tool: 'claude', installed: true, state: SessionState.UNKNOWN, fix: 'fixture-fix-claude-do-not-copy-into-production',
  })
  static readonly GIT_NOT_INSTALLED = new ToolSession({
    tool: 'git', installed: false, state: SessionState.MISSING,
    fix: 'fixture-fix-git-do-not-copy-into-production',
  })

  static readonly DESTINATION = 'fixture-project:fixture_dataset.fixture_table'

  asked: number
  readonly sessions: readonly ToolSession[]

  constructor(sessions: readonly ToolSession[], metricsDelivery: MetricsDelivery) {
    super({ toolSessions: new ToolSessions(), metricsDelivery })
    this.asked = 0
    this.sessions = sessions
  }

  static answeringGhReadyAndBqMissing(): SurveySpy {
    return new SurveySpy([SurveySpy.GH_READY, SurveySpy.BQ_MISSING], MetricsDelivery.disabled())
  }

  static answeringOnlyAReadyTool(): SurveySpy {
    return new SurveySpy([SurveySpy.GH_READY], MetricsDelivery.disabled())
  }

  static answeringAnUnknownAndAnUninstalledTool(): SurveySpy {
    return new SurveySpy([SurveySpy.CLAUDE_UNKNOWN, SurveySpy.GIT_NOT_INSTALLED], MetricsDelivery.disabled())
  }

  static answeringADeliveryConfiguredAndBqReady(): SurveySpy {
    return new SurveySpy([SurveySpy.BQ_READY], MetricsDelivery.to(SurveySpy.DESTINATION))
  }

  static answeringADeliveryConfiguredAndBqMissing(): SurveySpy {
    return new SurveySpy([SurveySpy.GH_READY, SurveySpy.BQ_MISSING], MetricsDelivery.to(SurveySpy.DESTINATION))
  }

  async execute(): Promise<SurveyExternalToolsResult> {
    this.asked += 1

    return new SurveyExternalToolsResult({ sessions: this.sessions, metricsDelivery: this.metricsDelivery })
  }
}

type ToolRow = { tool: string, installed: boolean, session: string, fix: string | null }

type DeliveredMetrics = { enabled: boolean, variable: string, destination: string | null }

type SurveyedTools = { ready: boolean, tools: ToolRow[], metricsDelivery: DeliveredMetrics }

type Answered = { response: Response, spy: SurveySpy }

class RunningApi {
  static readonly #started: ApiServer[] = []
  static readonly PATH = '/external-tools'
  static readonly NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static readonly NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })

  static async listening(spy: SurveySpy): Promise<number> {
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      implementProgress: undefined,
      externalTools: spy,
      reviews: new ReviewsSpy(),
      pullRequestReviews: undefined,
      sessions: new PlanSessions(),
      activePlans: undefined,
      implementationStarts: undefined,
      planEvents: RunningApi.NO_EVENTS,
      stderr: undefined,
      readPlanProgress: null,
      frontendRoot: RunningApi.NO_FRONTEND,
    })
    const port = await server.start()
    RunningApi.#started.push(server)

    return port
  }

  static async stopAll(): Promise<void> {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => server.stop()))
  }

  static async asking(spy: SurveySpy): Promise<Answered> {
    const port = await RunningApi.listening(spy)
    const response = await fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`)

    return { response, spy }
  }

  static async posting(spy: SurveySpy): Promise<Answered> {
    const port = await RunningApi.listening(spy)
    const response = await fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'POST' })

    return { response, spy }
  }

  static async askingFromOrigin(spy: SurveySpy, origin: string): Promise<Answered> {
    const port = await RunningApi.listening(spy)
    const response = await fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, {
      headers: { Origin: origin },
    })

    return { response, spy }
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('ExternalToolsRoute', () => {
  it('answers_a_row_per_tool_with_its_state_and_its_fix', async () => {
    const { response } = await RunningApi.asking(SurveySpy.answeringGhReadyAndBqMissing())

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(JSON.stringify({
      ready: true,
      tools: [
        { tool: 'gh', installed: true, session: 'ready', fix: null },
        {
          tool: 'bq', installed: true, session: 'missing',
          fix: 'fixture-fix-bq-do-not-copy-into-production',
        },
      ],
      metricsDelivery: { enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null },
    }))
  })

  it('a_ready_tool_answers_a_null_fix', async () => {
    const { response } = await RunningApi.asking(SurveySpy.answeringOnlyAReadyTool())

    const body = await response.json() as SurveyedTools

    expect(body.tools[0].fix).toBe(null)
    expect(body.ready).toBe(true)
  })

  it('the_verdict_is_false_when_one_tool_blocks', async () => {
    const { response } = await RunningApi.asking(SurveySpy.answeringAnUnknownAndAnUninstalledTool())

    const body = await response.json() as SurveyedTools

    expect(body.ready).toBe(false)
    expect(body.tools.find((row) => row.tool === 'git')?.installed).toBe(false)
  })

  it('a_disabled_delivery_answers_its_variable_with_no_destination_and_leaves_a_missing_bq_unblocking', async () => {
    const { response } = await RunningApi.asking(SurveySpy.answeringGhReadyAndBqMissing())

    const body = await response.json() as SurveyedTools

    expect(body.metricsDelivery).toEqual({
      enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null,
    })
    expect(body.ready).toBe(true)
  })

  it('an_enabled_delivery_answers_its_destination_and_is_ready_when_bq_is_ready', async () => {
    const { response } = await RunningApi.asking(SurveySpy.answeringADeliveryConfiguredAndBqReady())

    const body = await response.json() as SurveyedTools

    expect(body.metricsDelivery).toEqual({
      enabled: true, variable: 'CT_HARVEST_BQ_TABLE', destination: SurveySpy.DESTINATION,
    })
    expect(body.ready).toBe(true)
  })

  it('an_enabled_delivery_whose_bq_is_missing_answers_not_ready_and_still_names_its_destination', async () => {
    const { response } = await RunningApi.asking(SurveySpy.answeringADeliveryConfiguredAndBqMissing())

    const body = await response.json() as SurveyedTools

    expect(body.ready).toBe(false)
    expect(body.metricsDelivery.destination).toBe(SurveySpy.DESTINATION)
    expect(body.tools.find((row) => row.tool === 'bq')?.fix)
      .toBe('fixture-fix-bq-do-not-copy-into-production')
  })

  it('a_post_is_refused_with_405_and_allow_get_without_asking_the_use_case', async () => {
    const { response, spy } = await RunningApi.posting(SurveySpy.answeringOnlyAReadyTool())

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(spy.asked).toBe(0)
  })

  it('a_request_from_a_foreign_page_is_refused_with_403_and_the_use_case_is_never_asked', async () => {
    const { response, spy } = await RunningApi.askingFromOrigin(
      SurveySpy.answeringOnlyAReadyTool(), 'https://evil.example'
    )

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('{"code":"foreign-origin","detail":"this api only serves the page it hosts"}')
    expect(spy.asked).toBe(0)
  })
})
