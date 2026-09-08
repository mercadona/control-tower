import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.js'
import { ReviewsSpy } from '../reviews-spy.js'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.js'
import { SurveyExternalToolsResult } from '../../src/application/queries/survey-external-tools.js'
import { SessionState, ToolSession } from '../../src/domain/value-objects/tool-session.js'

class SurveySpy {
  static GH_READY = new ToolSession({ tool: 'gh', installed: true, state: SessionState.READY, fix: null })
  static BQ_MISSING = new ToolSession({
    tool: 'bq', installed: true, state: SessionState.MISSING,
    fix: 'gcloud auth login && gcloud auth application-default login',
  })
  static CLAUDE_UNKNOWN = new ToolSession({
    tool: 'claude', installed: true, state: SessionState.UNKNOWN, fix: 'claude, then /login',
  })

  constructor(sessions) {
    this.asked = 0
    this.sessions = sessions
  }

  static answeringGhReadyAndBqMissing() {
    return new SurveySpy([SurveySpy.GH_READY, SurveySpy.BQ_MISSING])
  }

  static answeringOnlyAReadyTool() {
    return new SurveySpy([SurveySpy.GH_READY])
  }

  static answeringAnUnknownAndAMissingTool() {
    return new SurveySpy([SurveySpy.CLAUDE_UNKNOWN, SurveySpy.BQ_MISSING])
  }

  async execute() {
    this.asked += 1

    return new SurveyExternalToolsResult({ sessions: this.sessions })
  }
}

class RunningApi {
  static #started = []
  static PATH = '/external-tools'
  static NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })

  static async listening(spy) {
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      externalTools: spy,
      reviews: new ReviewsSpy(),
      sessions: new PlanSessions(),
      planEvents: RunningApi.NO_EVENTS,
      frontendRoot: RunningApi.NO_FRONTEND,
    })
    const port = await server.start()
    RunningApi.#started.push(server)

    return port
  }

  static async stopAll() {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => server.stop()))
  }

  static async asking(spy) {
    const port = await RunningApi.listening(spy)
    const response = await fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`)

    return { response, spy }
  }

  static async posting(spy) {
    const port = await RunningApi.listening(spy)
    const response = await fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'POST' })

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
      ready: false,
      tools: [
        { tool: 'gh', installed: true, session: 'ready', fix: null },
        {
          tool: 'bq', installed: true, session: 'missing',
          fix: 'gcloud auth login && gcloud auth application-default login',
        },
      ],
    }))
  })

  it('a_ready_tool_answers_a_null_fix', async () => {
    const { response } = await RunningApi.asking(SurveySpy.answeringOnlyAReadyTool())

    const body = await response.json()

    expect(body.tools[0].fix).toBe(null)
  })

  it('the_verdict_is_false_when_one_tool_blocks', async () => {
    const { response } = await RunningApi.asking(SurveySpy.answeringAnUnknownAndAMissingTool())

    const body = await response.json()

    expect(body.ready).toBe(false)
  })

  it('a_post_is_refused_with_405_and_allow_get_without_asking_the_use_case', async () => {
    const { response, spy } = await RunningApi.posting(SurveySpy.answeringOnlyAReadyTool())

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(spy.asked).toBe(0)
  })
})
