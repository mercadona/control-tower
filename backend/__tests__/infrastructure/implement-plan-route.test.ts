import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import {
  ImplementRequestOutcome, ImplementRefusal, ImplementCollapse,
} from '../../src/infrastructure/implement-plan-route.ts'
import {
  PlanAgentNotResumed, PlanFailure, PlanGoNotAnswered, GoFailure, GoNotRecorded,
} from '../../src/domain/exceptions.ts'
import { ActivePlans, ActivePlanPhase } from '../../src/infrastructure/active-plans-route.ts'
import type { ImplementPlanParams } from '../../src/application/actions/implement-plan.ts'

type AskedImplementation = { agent: string, issue: number, repository: string }

type ImplementationStartsDouble = { remember: Mock }

type ListeningOptions = {
  watched?: boolean,
  implementationStarts?: ImplementationStartsDouble,
  stderr?: Mock,
}

class PullRequestWatchSpy {
  readonly started: PlanWatch[]

  constructor() {
    this.started = []
  }

  start(watch: PlanWatch): void {
    this.started.push(watch)
  }
}

class ImplementPlanSpy {
  readonly asked: AskedImplementation[]

  constructor() {
    this.asked = []
  }

  static failingWith(cause: Error): ImplementPlanSpy {
    const spy = new ImplementPlanSpy()
    spy.execute = async () => {
      throw cause
    }

    return spy
  }

  static buggy(): ImplementPlanSpy {
    const spy = new ImplementPlanSpy()
    spy.execute = async () => {
      throw new TypeError('a bug of ours')
    }

    return spy
  }

  async execute(params: ImplementPlanParams): Promise<void> {
    this.asked.push({
      agent: params.agent,
      issue: params.issue,
      repository: params.repository.text,
    })
  }
}

class RunningApi {
  static #started: ApiServer[] = []
  static PATH = '/implement-plan'
  static ACCEPTED_BODY = '{"agent":"workspace:20","issue":33,"repo":"jjponz/repo-pulse"}'
  static ANSWER = '{"status":"implementing","agent":"workspace:20","issue":33}'
  static spy: ImplementPlanSpy = null!
  static pullRequestReviews: PullRequestWatchSpy = null!
  static sessions: PlanSessions = null!
  static activePlans: ActivePlans = null!
  static implementationStarts: ImplementationStartsDouble = null!
  static stderr: Mock = null!
  static WATCHED = new PlanWatch({
    story: new UserStoryKey('ABC-123'),
    issue: new PlanIssue({ number: 33, url: 'https://github.com/jjponz/repo-pulse/issues/33' }),
    located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/33', branch: 'feat/33' }),
    repository: new RepositoryName('jjponz/repo-pulse'),
    agent: 'workspace:20',
  })

  static NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static #NEVER_STREAMS = {
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    readDelivery: () => Promise.reject(new Error('this suite never streams delivery events')),
    sleep: () => Promise.resolve(),
  }

  static NO_EVENTS = new PlanEvents(RunningApi.#NEVER_STREAMS)

  static async listening(spy = new ImplementPlanSpy(), options: ListeningOptions = {}): Promise<number> {
    RunningApi.spy = spy
    RunningApi.pullRequestReviews = new PullRequestWatchSpy()
    RunningApi.sessions = new PlanSessions()
    if (options.watched ?? true) RunningApi.sessions.remember(RunningApi.WATCHED)
    RunningApi.activePlans = new ActivePlans({ sessions: RunningApi.sessions })
    RunningApi.implementationStarts = options.implementationStarts ?? { remember: vi.fn() }
    RunningApi.stderr = options.stderr ?? vi.fn()
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: spy,
      implementProgress: null,
      externalTools: null,
      pullRequestReviews: RunningApi.pullRequestReviews,
      sessions: RunningApi.sessions,
      activePlans: RunningApi.activePlans,
      implementationStarts: RunningApi.implementationStarts,
      stderr: RunningApi.stderr,
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

  static async post(
    port: number, body: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }
  ): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'POST', body, headers })
  }

  static async asking(body: string): Promise<Response> {
    return RunningApi.post(await RunningApi.listening(), body)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('ImplementCollapse', () => {
  const RESUMING_AN_AGENT = ['GoNotRecorded', 'PlanGoNotAnswered', 'PlanAgentNotResumed']

  it('every_way_resuming_an_agent_can_collapse_has_a_refusal_declared_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    expect(ImplementCollapse.declaredFailures().sort()).toEqual(RESUMING_AN_AGENT.sort())
  })

  it('every_way_resuming_an_agent_can_collapse_has_a_code_distinct_from_every_other_one', () => {
    const codes = ImplementCollapse.declaredCodes()

    expect(new Set(codes).size).toBe(codes.length)
  })

  it('every_way_resuming_an_agent_can_collapse_answers_400_because_the_code_carries_the_distinction_now', () => {
    const causes = [
      new GoNotRecorded('the directory is not writable'),
      new PlanGoNotAnswered('gh issue comment failed: nope'),
      new PlanAgentNotResumed('cmux send failed: no such workspace'),
    ]

    expect(causes.map((cause) => ImplementCollapse.of(cause).status)).toEqual(Array(causes.length).fill(400))
  })

  it('a_go_nobody_could_record_names_the_specific_way_it_failed_and_keeps_why', () => {
    const collapse = ImplementCollapse.of(new GoNotRecorded('the directory is not writable'))

    expect(collapse.code).toBe('go-not-recorded')
    expect(collapse.detail).toBe('the directory is not writable')
  })

  it('a_go_the_issue_did_not_take_names_what_gh_said', () => {
    const collapse = ImplementCollapse.of(new PlanGoNotAnswered('gh issue comment failed: nope'))

    expect(collapse.code).toBe('plan-go-not-answered')
    expect(collapse.detail).toBe('gh issue comment failed: nope')
  })

  it('a_family_is_not_a_way_of_collapsing_so_answering_one_raises_instead_of_guessing', () => {
    expect(() => ImplementCollapse.of(new PlanFailure('nope'))).toThrow(/no refusal declared/)
    expect(() => ImplementCollapse.of(new GoFailure('nope'))).toThrow(/no refusal declared/)
  })
})

describe('implementing the plan lifts the watch on its issue', () => {
  afterEach(RunningApi.stopAll)

  it('accepting_the_implementation_starts_watching_the_pull_request_that_does_not_exist_yet', async () => {
    await RunningApi.post(await RunningApi.listening(), RunningApi.ACCEPTED_BODY)

    expect(RunningApi.pullRequestReviews.started).toHaveLength(1)
    expect(RunningApi.pullRequestReviews.started[0].issue.number).toBe(33)
  })

  it('the_plan_moves_to_the_implementing_phase_so_the_plan_stream_stops_answering_for_it', async () => {
    await RunningApi.post(await RunningApi.listening(), RunningApi.ACCEPTED_BODY)

    const active = RunningApi.activePlans.find({ issue: 33, repository: RunningApi.WATCHED.repository })!

    expect(active.phase).toBe(ActivePlanPhase.IMPLEMENTING)
    expect(RunningApi.sessions.find({ issue: 33, repository: RunningApi.WATCHED.repository })).toBeNull()
  })

  it('the_watch_it_starts_is_the_one_the_active_plan_carries_and_not_a_fresh_one', async () => {
    await RunningApi.post(await RunningApi.listening(), RunningApi.ACCEPTED_BODY)

    const active = RunningApi.activePlans.find({ issue: 33, repository: RunningApi.WATCHED.repository })!

    expect(RunningApi.pullRequestReviews.started[0]).toBe(active.watch)
    expect(RunningApi.pullRequestReviews.started[0].agent).toBe(RunningApi.WATCHED.agent)
  })

  it('an_implementation_of_an_issue_nobody_is_watching_is_refused_and_starts_nothing', async () => {
    const port = await RunningApi.listening(new ImplementPlanSpy(), { watched: false })

    const answered = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(answered.status).toBe(400)
    expect((await answered.json() as { code: string }).code).toBe(ImplementRequestOutcome.NO_LIVE_SESSION)
    expect(RunningApi.pullRequestReviews.started).toEqual([])
  })

  it('implementing_the_plan_remains_active_after_its_planning_session_is_forgotten', async () => {
    const port = await RunningApi.listening()
    await RunningApi.post(port, RunningApi.ACCEPTED_BODY)
    const response = await fetch(`http://127.0.0.1:${port}/active-plans`)

    expect(await response.json()).toEqual({
      plans: [expect.objectContaining({ phase: 'implementing' })],
    })
  })

  it('a_successful_transition_writes_its_marker_and_remains_active', async () => {
    const implementationStarts = { remember: vi.fn() }
    const port = await RunningApi.listening(new ImplementPlanSpy(), { implementationStarts })

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(implementationStarts.remember).toHaveBeenCalledWith(RunningApi.WATCHED)
    expect(RunningApi.activePlans.known()[0].phase).toBe('implementing')
  })

  it('a_marker_write_failure_keeps_the_accepted_answer_and_reports_a_warning', async () => {
    const implementationStarts = { remember: vi.fn().mockRejectedValue(new Error('disk full')) }
    const stderr = vi.fn()
    const port = await RunningApi.listening(new ImplementPlanSpy(), { implementationStarts, stderr })

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(RunningApi.activePlans.known()[0].phase).toBe('implementing')
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('disk full'))
  })

  it('implementing_an_unwatched_plan_is_refused_without_executing_stale_input', async () => {
    const port = await RunningApi.listening()
    RunningApi.sessions.forget({ repository: RunningApi.WATCHED.repository, issue: 33 })

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'no-live-planning-session', detail: 'no matching live planning session exists',
    })
    expect(RunningApi.spy.asked).toEqual([])
    expect(RunningApi.activePlans.known()).toEqual([])
  })

  it('an_uncertain_plan_is_refused_without_retrying_implementation', async () => {
    const port = await RunningApi.listening()
    RunningApi.activePlans.rememberUncertain(RunningApi.WATCHED)

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'implementation-phase-uncertain',
      detail: 'implementation may have started; inspect the plan before retrying',
    })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_refused_request_to_implement_forgets_no_session', async () => {
    await RunningApi.asking('{"agent":"workspace:20","issue":0,"repo":"a/b"}')

    expect(RunningApi.sessions.find({ repository: RunningApi.WATCHED.repository, issue: 33 })).toBe(RunningApi.WATCHED)
  })

  it('a_plan_the_agent_would_not_take_starts_no_pull_request_watch_or_implementation_start', async () => {
    const spy = ImplementPlanSpy.failingWith(new PlanAgentNotResumed('no such workspace'))
    const implementationStarts = { remember: vi.fn() }

    const response = await RunningApi.post(
      await RunningApi.listening(spy, { implementationStarts }), RunningApi.ACCEPTED_BODY
    )

    expect(response.status).toBe(400)
    expect(implementationStarts.remember).not.toHaveBeenCalled()
    expect(RunningApi.pullRequestReviews.started).toEqual([])
  })
})
