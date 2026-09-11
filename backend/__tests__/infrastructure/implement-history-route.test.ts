import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { ReviewsSpy } from '../reviews-spy.ts'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import {
  HistoryRequestOutcome, HistoryRefusal, HistoryCollapse,
} from '../../src/infrastructure/implement-history-route.ts'
import { ImplementationHistoryEntry } from '../../src/domain/value-objects/implementation-history-entry.ts'
import { ImplementationHistoryNotRead } from '../../src/domain/exceptions.ts'
import * as exceptions from '../../src/domain/exceptions.ts'
import type { ReadImplementationHistoryParams } from '../../src/application/queries/read-implementation-history.ts'

type HistoryReading = { readonly entries: ImplementationHistoryEntry[] }

class ReadImplementationHistorySpy {
  readonly asked: ReadImplementationHistoryParams[]

  constructor() {
    this.asked = []
  }

  static answering(entries: ImplementationHistoryEntry[]): ReadImplementationHistorySpy {
    const spy = new ReadImplementationHistorySpy()
    spy.execute = async (params) => {
      spy.asked.push(params)
      return { entries }
    }

    return spy
  }

  static failingWith(cause: Error): ReadImplementationHistorySpy {
    const spy = new ReadImplementationHistorySpy()
    spy.execute = async (params) => {
      spy.asked.push(params)
      throw cause
    }

    return spy
  }

  static buggy(): ReadImplementationHistorySpy {
    const spy = new ReadImplementationHistorySpy()
    spy.execute = async (params) => {
      spy.asked.push(params)
      throw new TypeError('a bug of ours')
    }

    return spy
  }

  async execute(params: ReadImplementationHistoryParams): Promise<HistoryReading> {
    this.asked.push(params)
    throw new Error('ReadImplementationHistorySpy was not given an answer')
  }
}

class RunningApi {
  static #started: ApiServer[] = []
  static PATH = '/implement-history/298'
  static ROOT = '/checkout'
  static ONE_STEP = [
    ImplementationHistoryEntry.of({
      step: 'implement', task: 1, taskName: 'the lookup looks where it says it looks', tasksTotal: 2,
      attempt: 1, outcome: 'done', writtenAt: '2026-09-10T14:55:59.885Z', durationMs: null,
      summary: 'Renamed ...', ruling: null, findingsTotal: null, toolTotalTokens: null,
    }),
  ]

  static NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })

  static async listening(
    spy: ReadImplementationHistorySpy = ReadImplementationHistorySpy.answering(RunningApi.ONE_STEP)
  ): Promise<{ port: number, spy: ReadImplementationHistorySpy }> {
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      askPlanChanges: null,
      implementHistory: spy,
      reviews: new ReviewsSpy(),
      pullRequestReviews: null,
      sessions: new PlanSessions(),
      activePlans: null,
      externalTools: null,
      implementationStarts: null,
      stderr: null,
      planEvents: RunningApi.NO_EVENTS,
      readPlanProgress: null,
      frontendRoot: RunningApi.NO_FRONTEND,
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

  static async asking(path: string, spy?: ReadImplementationHistorySpy) {
    const running = await RunningApi.listening(spy)

    return { response: await RunningApi.get(running.port, path), spy: running.spy }
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('ImplementHistoryRoute', () => {
  it('a_run_with_one_finished_step_answers_the_twelve_wire_fields', async () => {
    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout&repo=owner%2Fname`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      steps: [{
        step: 'implement', task: 1, task_name: 'the lookup looks where it says it looks', tasks_total: 2,
        attempt: 1, outcome: 'done', written_at: '2026-09-10T14:55:59.885Z', duration_ms: null,
        summary: 'Renamed ...', ruling: null, findings_total: null, tool_total_tokens: null,
      }],
    })
  })

  it('a_judge_step_answers_its_ruling_findings_total_and_tool_total_tokens', async () => {
    const spy = ReadImplementationHistorySpy.answering([
      ImplementationHistoryEntry.of({
        step: 'judge', task: 1, taskName: null, tasksTotal: 2, attempt: 2, outcome: 'done',
        writtenAt: '2026-09-11T06:57:22.561Z', durationMs: null, summary: null,
        ruling: 'PASS', findingsTotal: 0, toolTotalTokens: 1172301,
      }),
    ])

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout&repo=owner%2Fname`, spy)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      steps: [{
        step: 'judge', task: 1, task_name: null, tasks_total: 2, attempt: 2, outcome: 'done',
        written_at: '2026-09-11T06:57:22.561Z', duration_ms: null, summary: null,
        ruling: 'PASS', findings_total: 0, tool_total_tokens: 1172301,
      }],
    })
  })

  it('a_worktree_with_no_metrics_file_yet_answers_no_steps', async () => {
    const spy = ReadImplementationHistorySpy.answering([])

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout&repo=owner%2Fname`, spy)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ steps: [] })
  })

  it('a_call_with_no_root_is_refused_and_the_history_is_never_read', async () => {
    const spy = ReadImplementationHistorySpy.answering(RunningApi.ONE_STEP)

    const { response } = await RunningApi.asking(RunningApi.PATH, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-root',
      detail: 'root is an absolute path such as /Users/you/repos/name',
    })
    expect(spy.asked).toEqual([])
  })

  it('a_relative_root_is_refused_the_same_way', async () => {
    const spy = ReadImplementationHistorySpy.answering(RunningApi.ONE_STEP)

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=repos/name&repo=owner%2Fname`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-root',
      detail: 'root is an absolute path such as /Users/you/repos/name',
    })
    expect(spy.asked).toEqual([])
  })

  it('a_call_with_no_repo_is_refused_and_the_history_is_never_read', async () => {
    const spy = ReadImplementationHistorySpy.answering(RunningApi.ONE_STEP)

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=${RunningApi.ROOT}`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-history-repo',
      detail: 'repo must be a repository such as owner/name',
    })
    expect(spy.asked).toEqual([])
  })

  it('a_repo_that_is_not_owner_slash_name_is_refused_the_same_way', async () => {
    const spy = ReadImplementationHistorySpy.answering(RunningApi.ONE_STEP)

    const { response } = await RunningApi.asking(
      `${RunningApi.PATH}?root=${RunningApi.ROOT}&repo=${encodeURIComponent('--flag')}`, spy
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-history-repo',
      detail: 'repo must be a repository such as owner/name',
    })
    expect(spy.asked).toEqual([])
  })

  it('a_worktree_that_is_not_there_collapses_into_a_history_that_could_not_be_read', async () => {
    const spy = ReadImplementationHistorySpy.failingWith(
      new ImplementationHistoryNotRead('no worktree at /checkout/.worktrees/298')
    )

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout&repo=owner%2Fname`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'implementation-history-not-read',
      detail: 'no worktree at /checkout/.worktrees/298',
    })
  })

  it('a_line_that_is_not_json_collapses_naming_the_line_number', async () => {
    const spy = ReadImplementationHistorySpy.failingWith(
      new ImplementationHistoryNotRead('line 3 of /checkout/.worktrees/298/docs/superpowers/metrics/issue-298.jsonl could not be parsed as JSON')
    )

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout&repo=owner%2Fname`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'implementation-history-not-read',
      detail: 'line 3 of /checkout/.worktrees/298/docs/superpowers/metrics/issue-298.jsonl could not be parsed as JSON',
    })
  })

  it('a_bug_of_ours_is_not_dressed_up_as_a_refusal', async () => {
    const spy = ReadImplementationHistorySpy.buggy()

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout&repo=owner%2Fname`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'request-failed', detail: 'request failed' })
  })

  it('a_verb_this_route_does_not_serve_is_refused_naming_the_one_it_does', async () => {
    const running = await RunningApi.listening()

    const response = await fetch(
      `http://127.0.0.1:${running.port}${RunningApi.PATH}?root=${encodeURIComponent(RunningApi.ROOT)}&repo=owner%2Fname`,
      { method: 'POST' },
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(running.spy.asked).toEqual([])
  })
})

describe('HistoryRefusal', () => {
  it('every_refusable_outcome_has_an_answer_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const refusable = Object.values(HistoryRequestOutcome).filter(
      (outcome) => outcome !== HistoryRequestOutcome.ACCEPTED
    )

    expect(HistoryRefusal.declaredOutcomes().sort()).toEqual(refusable.sort())
  })
})

describe('HistoryCollapse', () => {
  it('every_way_the_history_can_collapse_has_a_refusal_declared_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const ways = Object.entries(exceptions)
      .filter(([, thrown]) => thrown.prototype instanceof exceptions.ImplementationHistoryFailure)
      .map(([name]) => name)

    expect(HistoryCollapse.declaredFailures().sort()).toEqual(ways.sort())
  })
})
