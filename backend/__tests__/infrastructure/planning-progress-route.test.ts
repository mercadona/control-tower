import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { Loopback } from '../servers.ts'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import {
  PlanningRequestOutcome, PlanningRefusal, PlanningCollapse,
} from '../../src/infrastructure/planning-progress-route.ts'
import { PlanningActivity, PlanningActivityState, PlanningToolCall } from '../../src/domain/value-objects/planning-activity.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { PlanningActivityNotRead } from '../../src/domain/exceptions.ts'
import * as exceptions from '../../src/domain/exceptions.ts'
import type { ReadPlanningActivityParams } from '../../src/application/queries/read-planning-activity.ts'

type ActivityReading = { readonly activity: PlanningActivity }

class ReadPlanningActivitySpy {
  readonly asked: ReadPlanningActivityParams[]

  constructor() {
    this.asked = []
  }

  static answering(activity: PlanningActivity): ReadPlanningActivitySpy {
    const spy = new ReadPlanningActivitySpy()
    spy.execute = async (params) => {
      spy.asked.push(params)
      return { activity }
    }

    return spy
  }

  static failingWith(cause: Error): ReadPlanningActivitySpy {
    const spy = new ReadPlanningActivitySpy()
    spy.execute = async (params) => {
      spy.asked.push(params)
      throw cause
    }

    return spy
  }

  static buggy(): ReadPlanningActivitySpy {
    const spy = new ReadPlanningActivitySpy()
    spy.execute = async (params) => {
      spy.asked.push(params)
      throw new TypeError('a bug of ours')
    }

    return spy
  }

  async execute(params: ReadPlanningActivityParams): Promise<ActivityReading> {
    this.asked.push(params)
    throw new Error('ReadPlanningActivitySpy was not given an answer')
  }
}

class Mother {
  static readonly REPO = 'mercadona/control-tower-plugin'
  static readonly ISSUE_NUMBER = 500

  static watch(): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: Mother.ISSUE_NUMBER, url: 'https://github.com/mercadona/control-tower-plugin/issues/500' }),
      located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/500', branch: 'feat/500' }),
      repository: new RepositoryName(Mother.REPO),
      agent: '11111111-1111-4111-8111-111111111111',
    })
  }

  static running(): PlanningActivity {
    return new PlanningActivity({
      state: PlanningActivityState.RUNNING,
      runningMs: 372_000,
      toolCalls: 41,
      lastToolCall: new PlanningToolCall({ name: 'Read', argument: 'plugin/conventions/testing.md' }),
      lastText: 'Ahora escribo el plan',
    })
  }
}

class RunningApi {
  static #started: ApiServer[] = []
  static readonly PATH = `/planning-progress/${Mother.ISSUE_NUMBER}`
  static readonly REPO_QUERY = `repo=${encodeURIComponent(Mother.REPO)}`

  static readonly NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })

  static async listening(
    spy: ReadPlanningActivitySpy = ReadPlanningActivitySpy.answering(Mother.running()),
    { watched = true }: { watched?: boolean } = {},
  ): Promise<{ port: number, spy: ReadPlanningActivitySpy }> {
    const sessions = new PlanSessions()
    if (watched) sessions.remember(Mother.watch())
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      readPlanningActivity: spy,
      sessions,
      activePlans: null,
      externalTools: null,
      stderr: null,
      planEvents: RunningApi.NO_EVENTS,
      frontendRoot: Loopback.FRONTEND_NEVER_BUILT,
    })
    const port = await server.start()
    RunningApi.#started.push(server)

    return { port, spy }
  }

  static async stopAll() {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => server.stop()))
  }

  static async get(port: number, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`)
  }

  static async asking(
    path: string, spy?: ReadPlanningActivitySpy, options?: { watched?: boolean }
  ): Promise<{ response: Response, spy: ReadPlanningActivitySpy }> {
    const running = await RunningApi.listening(spy, options)

    return { response: await RunningApi.get(running.port, path), spy: running.spy }
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('PlanningProgressRoute', () => {
  it('a_running_plan_answers_the_literal_200_body', async () => {
    const { response } = await RunningApi.asking(`${RunningApi.PATH}?${RunningApi.REPO_QUERY}`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(
      '{"state":"running","running_ms":372000,"tool_calls":41,'
      + '"last_tool":{"name":"Read","argument":"plugin/conventions/testing.md"},'
      + '"last_text":"Ahora escribo el plan"}'
    )
  })

  it('a_finished_plan_answers_the_literal_200_body_with_no_last_tool_or_text', async () => {
    const spy = ReadPlanningActivitySpy.answering(new PlanningActivity({
      state: PlanningActivityState.FINISHED, runningMs: 60_000, toolCalls: 0, lastToolCall: null, lastText: null,
    }))

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?${RunningApi.REPO_QUERY}`, spy)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(
      '{"state":"finished","running_ms":60000,"tool_calls":0,"last_tool":null,"last_text":null}'
    )
  })

  it('an_issue_nobody_started_a_plan_for_is_refused_without_asking_the_use_case', async () => {
    const spy = ReadPlanningActivitySpy.answering(Mother.running())

    const { response } = await RunningApi.asking(
      `${RunningApi.PATH}?${RunningApi.REPO_QUERY}`, spy, { watched: false }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'not-watched',
      detail: 'no plan was started for that issue',
    })
    expect(spy.asked).toEqual([])
  })

  it('an_issue_that_is_not_a_positive_whole_number_is_refused_and_never_reaches_the_use_case', async () => {
    const spy = ReadPlanningActivitySpy.answering(Mother.running())

    const { response } = await RunningApi.asking(`/planning-progress/0?${RunningApi.REPO_QUERY}`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-planning-issue',
      detail: 'the issue to watch is a number such as 42',
    })
    expect(spy.asked).toEqual([])
  })

  it('a_missing_repo_is_refused_the_same_way_as_plan_events', async () => {
    const spy = ReadPlanningActivitySpy.answering(Mother.running())

    const { response } = await RunningApi.asking(RunningApi.PATH, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-repo',
      detail: 'repo must be a repository such as owner/name',
    })
    expect(spy.asked).toEqual([])
  })

  it('a_planning_call_that_could_not_be_read_collapses_into_a_refusal', async () => {
    const spy = ReadPlanningActivitySpy.failingWith(
      new PlanningActivityNotRead('conversation has 0 recorded planner calls')
    )

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?${RunningApi.REPO_QUERY}`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'planning-progress-not-read',
      detail: 'conversation has 0 recorded planner calls',
    })
  })

  it('a_bug_of_ours_is_not_dressed_up_as_a_refusal', async () => {
    const spy = ReadPlanningActivitySpy.buggy()

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?${RunningApi.REPO_QUERY}`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'request-failed', detail: 'request failed' })
  })

  it('a_verb_this_route_does_not_serve_is_refused_naming_the_one_it_does', async () => {
    const running = await RunningApi.listening()

    const response = await fetch(
      `http://127.0.0.1:${running.port}${RunningApi.PATH}?${RunningApi.REPO_QUERY}`, { method: 'POST' },
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(running.spy.asked).toEqual([])
  })
})

describe('PlanningRefusal', () => {
  it('every_refusable_outcome_has_an_answer_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const refusable = Object.values(PlanningRequestOutcome).filter(
      (outcome) => outcome !== PlanningRequestOutcome.ACCEPTED
    )

    expect(PlanningRefusal.declaredOutcomes().sort()).toEqual(refusable.sort())
  })
})

describe('PlanningCollapse', () => {
  it('every_way_planning_activity_can_collapse_has_a_refusal_declared_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const ways = Object.entries(exceptions)
      .filter(([, thrown]) => thrown.prototype instanceof exceptions.PlanningActivityFailure)
      .map(([name]) => name)

    expect(PlanningCollapse.declaredFailures().sort()).toEqual(ways.sort())
  })
})
