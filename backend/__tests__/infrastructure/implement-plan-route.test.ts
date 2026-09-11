import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { ReviewsSpy } from '../reviews-spy.ts'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/api/plan-events-route.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import {
  ImplementRequestOutcome, ImplementRefusal, ImplementCollapse,
} from '../../src/infrastructure/api/implement-plan-route.ts'
import {
  PlanAgentNotResumed, PlanFailure, PlanGoNotAnswered, GoFailure, GoNotRecorded, PlanProgressNotRead,
} from '../../src/domain/exceptions.ts'
import { PlanState, type PlanStateValue } from '../../src/domain/value-objects/plan-state.ts'
import {
  ReviewGatePolicy, ReviewInFlight, type ReviewInFlightValue,
} from '../../src/domain/policies/review-gate-policy.ts'
import { ReadPlanProgressParams } from '../../src/application/queries/read-plan-progress.ts'
import { ActivePlans, ActivePlanPhase } from '../../src/infrastructure/api/active-plans-route.ts'
import type { ImplementPlanParams } from '../../src/application/actions/implement-plan.ts'

type AskedImplementation = { agent: string, issue: number, repository: string }

type ImplementationStartsDouble = { remember: Mock }

type ListeningOptions = {
  watched?: boolean,
  implementationStarts?: ImplementationStartsDouble,
  stderr?: Mock,
  reviews?: ReviewsSpy,
  progress?: ReadPlanProgressSpy,
}

class ReadPlanProgressSpy {
  readonly state: PlanStateValue | null
  readonly asked: ReadPlanProgressParams[]

  constructor(state: PlanStateValue | null) {
    this.state = state
    this.asked = []
  }

  static reading(state: PlanStateValue): ReadPlanProgressSpy {
    return new ReadPlanProgressSpy(state)
  }

  static failingWith(cause: Error): ReadPlanProgressSpy {
    const spy = new ReadPlanProgressSpy(null)
    spy.execute = async () => {
      throw cause
    }

    return spy
  }

  async execute(params: ReadPlanProgressParams): Promise<{ state: PlanStateValue }> {
    this.asked.push(params)

    return { state: this.state as PlanStateValue }
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
  static reviews: ReviewsSpy = null!
  static pullRequestReviews: ReviewsSpy = null!
  static sessions: PlanSessions = null!
  static activePlans: ActivePlans = null!
  static implementationStarts: ImplementationStartsDouble = null!
  static stderr: Mock = null!
  static readPlanProgress: ReadPlanProgressSpy = null!
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
    RunningApi.reviews = options.reviews ?? new ReviewsSpy()
    RunningApi.readPlanProgress = options.progress ?? ReadPlanProgressSpy.reading(PlanState.READY)
    RunningApi.pullRequestReviews = new ReviewsSpy()
    RunningApi.sessions = new PlanSessions()
    if (options.watched ?? true) RunningApi.sessions.remember(RunningApi.WATCHED)
    RunningApi.activePlans = new ActivePlans({ sessions: RunningApi.sessions })
    RunningApi.implementationStarts = options.implementationStarts ?? { remember: vi.fn() }
    RunningApi.stderr = options.stderr ?? vi.fn()
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: spy,
      askPlanChanges: null,
      implementProgress: null,
      externalTools: null,
      reviews: RunningApi.reviews,
      pullRequestReviews: RunningApi.pullRequestReviews,
      sessions: RunningApi.sessions,
      activePlans: RunningApi.activePlans,
      implementationStarts: RunningApi.implementationStarts,
      stderr: RunningApi.stderr,
      planEvents: RunningApi.NO_EVENTS,
      readPlanProgress: RunningApi.readPlanProgress,
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

describe('ImplementPlanRoute', () => {
  it('an_accepted_order_answers_that_the_implementation_is_under_way', async () => {
    const response = await RunningApi.asking(RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.text()).toBe(RunningApi.ANSWER)
  })

  it('a_duplicate_order_returns_the_same_answer_and_executes_only_once', async () => {
    const port = await RunningApi.listening()

    const first = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)
    const duplicate = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect([first.status, duplicate.status]).toEqual([202, 202])
    expect(await duplicate.text()).toBe(RunningApi.ANSWER)
    expect(RunningApi.spy.asked).toHaveLength(1)
    expect(RunningApi.implementationStarts.remember).toHaveBeenCalledOnce()
  })

  it('the_three_fields_reach_the_use_case_as_domain_values_and_not_as_the_raw_json', async () => {
    await RunningApi.asking(RunningApi.ACCEPTED_BODY)

    expect(RunningApi.spy.asked).toEqual([
      { agent: 'workspace:20', issue: 33, repository: 'jjponz/repo-pulse' },
    ])
  })

  it('a_repository_that_is_not_owner_slash_name_is_refused_before_it_can_become_an_argument_of_gh', async () => {
    const response = await RunningApi.asking('{"agent":"workspace:20","issue":33,"repo":"-oProxy"}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-repo',
      detail: 'repo must be a repository such as owner/name',
    })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_agent_handle_with_whitespace_is_refused_before_it_can_become_an_argument_of_cmux', async () => {
    const response = await RunningApi.asking('{"agent":"ct-plan XOP-4909","issue":33,"repo":"jjponz/repo-pulse"}')

    expect(response.status).toBe(400)
    const body = await response.json() as { code: string, detail: string }
    expect(body.code).toBe('malformed-agent')
    expect(body.detail).toMatch(/^agent must be the handle/)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_issue_that_is_not_a_whole_number_from_one_is_refused_and_never_reaches_the_use_case', async () => {
    const response = await RunningApi.asking('{"agent":"workspace:20","issue":"33"}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-issue',
      detail: 'issue must be a whole number from one',
    })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_issue_of_zero_is_refused_because_the_count_of_whole_numbers_from_one_starts_at_one', async () => {
    const response = await RunningApi.asking('{"agent":"workspace:20","issue":0}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-issue',
      detail: 'issue must be a whole number from one',
    })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_field_nobody_declared_is_named_in_the_refusal_instead_of_being_ignored', async () => {
    const response = await RunningApi.asking('{"agent":"workspace:20","issue":33,"force":true}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'unknown-field', detail: 'unknown field: force' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_body_that_is_not_a_json_object_is_refused_as_such', async () => {
    const response = await RunningApi.asking('[]')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'body-not-a-json-object', detail: 'body must be a JSON object' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_body_over_the_cap_is_refused_with_the_same_answer_start_plan_gives_and_never_reaches_the_use_case', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, `{"id":"${'A'.repeat(9000)}","issue":33}`)

    expect(response.status).toBe(413)
    expect(await response.text()).toBe('{"code":"body-too-large","detail":"body must not exceed 8192 bytes"}')
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_tool_that_refuses_to_write_in_the_tab_names_the_specific_way_it_refused', async () => {
    const port = await RunningApi.listening(
      ImplementPlanSpy.failingWith(new PlanAgentNotResumed('cmux send failed: no such workspace'))
    )

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(400)
    const body = await response.json() as { code: string, detail: string }
    expect(body.code).toBe('plan-agent-not-resumed')
    expect(body.detail).toBe('cmux send failed: no such workspace')
  })

  it('a_bug_of_ours_is_not_dressed_up_as_the_tool_refusing', async () => {
    const port = await RunningApi.listening(ImplementPlanSpy.buggy())

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'request-failed', detail: 'request failed' })
  })

  it('a_body_with_no_json_content_type_is_refused_before_it_is_read', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY, { 'Content-Type': 'text/plain' })

    expect(response.status).toBe(415)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('any_method_other_than_post_is_refused_saying_which_one_is_allowed', async () => {
    const port = await RunningApi.listening()

    const response = await fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'GET' })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
  })
})

describe('ImplementRefusal', () => {
  it('every_refusable_outcome_has_an_answer_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const refusable = Object.values(ImplementRequestOutcome).filter(
      (outcome) => outcome !== ImplementRequestOutcome.ACCEPTED
    )

    expect(ImplementRefusal.declaredOutcomes().sort()).toEqual(refusable.sort())
  })

  it('an_outcome_with_no_answer_raises_instead_of_being_served_as_a_blank_refusal', () => {
    expect(() => ImplementRefusal.of({ outcome: 'invented' })).toThrow(/no refusal declared/)
  })
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

  it('accepting_the_implementation_stops_watching_the_plan_because_that_gate_is_closed', async () => {
    await RunningApi.post(await RunningApi.listening(), RunningApi.ACCEPTED_BODY)

    expect(RunningApi.reviews.stopped).toEqual([
      { issue: 33, repository: RunningApi.WATCHED.repository },
    ])
  })

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

  it('a_refused_request_to_implement_lifts_no_watch', async () => {
    const response = await RunningApi.asking('{"agent":"workspace:20","issue":0,"repo":"a/b"}')

    expect(response.status).toBe(400)
    expect(RunningApi.reviews.stopped).toEqual([])
  })

  it('a_plan_the_agent_would_not_take_keeps_its_watch_so_the_changes_can_still_be_asked_for', async () => {
    const spy = ImplementPlanSpy.failingWith(new PlanAgentNotResumed('no such workspace'))
    const implementationStarts = { remember: vi.fn() }

    const response = await RunningApi.post(
      await RunningApi.listening(spy, { implementationStarts }), RunningApi.ACCEPTED_BODY
    )

    expect(response.status).toBe(400)
    expect(RunningApi.reviews.stopped).toEqual([])
    expect(implementationStarts.remember).not.toHaveBeenCalled()
    expect(RunningApi.pullRequestReviews.started).toEqual([])
  })
})
describe('the go is refused while the plan is under review', () => {
  afterEach(RunningApi.stopAll)

  const UNDER_REVIEW = {
    code: 'plan-under-review',
    detail: 'changes were asked for on this plan and it has not been reworked yet',
  }

  it('a_change_the_watch_has_not_delivered_yet_refuses_the_go', async () => {
    const port = await RunningApi.listening(
      new ImplementPlanSpy(), { reviews: ReviewsSpy.withAnUndeliveredChange() }
    )

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(UNDER_REVIEW)
  })

  it('an_undelivered_change_neither_records_the_go_nor_resumes_the_agent_nor_lifts_the_watch', async () => {
    const implementationStarts = { remember: vi.fn() }
    const port = await RunningApi.listening(
      new ImplementPlanSpy(), { reviews: ReviewsSpy.withAnUndeliveredChange(), implementationStarts }
    )

    await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(RunningApi.spy.asked).toEqual([])
    expect(implementationStarts.remember).not.toHaveBeenCalled()
    expect(RunningApi.reviews.stopped).toEqual([])
    expect(RunningApi.pullRequestReviews.started).toEqual([])
    expect(RunningApi.activePlans.known()[0].phase).toBe(ActivePlanPhase.PLANNING)
  })

  it('the_watch_is_asked_about_the_plan_it_is_watching_and_not_about_the_request', async () => {
    const port = await RunningApi.listening(
      new ImplementPlanSpy(), { reviews: ReviewsSpy.withAnUndeliveredChange() }
    )

    await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(RunningApi.reviews.asked).toEqual([RunningApi.WATCHED])
  })

  it('a_plan_being_reworked_refuses_the_go_even_though_every_change_was_delivered', async () => {
    const port = await RunningApi.listening(
      new ImplementPlanSpy(), { progress: ReadPlanProgressSpy.reading(PlanState.REVIEWING) }
    )

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(UNDER_REVIEW)
    expect(RunningApi.spy.asked).toEqual([])
    expect(RunningApi.reviews.stopped).toEqual([])
  })

  it('the_state_is_read_for_the_workspace_the_watch_carries', async () => {
    const port = await RunningApi.listening(
      new ImplementPlanSpy(), { progress: ReadPlanProgressSpy.reading(PlanState.REVIEWING) }
    )

    await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(RunningApi.readPlanProgress.asked).toEqual([{
      located: RunningApi.WATCHED.located,
      issue: RunningApi.WATCHED.issue,
      repository: RunningApi.WATCHED.repository,
    }])
  })

  it('a_plan_still_being_written_is_not_under_review_and_the_go_is_admitted', async () => {
    const port = await RunningApi.listening(
      new ImplementPlanSpy(), { progress: ReadPlanProgressSpy.reading(PlanState.WRITING) }
    )

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(RunningApi.reviews.stopped).toEqual([
      { issue: 33, repository: RunningApi.WATCHED.repository },
    ])
  })

  it('a_plan_already_implementing_answers_the_same_202_even_while_a_review_is_in_flight', async () => {
    const port = await RunningApi.listening(new ImplementPlanSpy(), {
      reviews: ReviewsSpy.withAnUndeliveredChange(),
      progress: ReadPlanProgressSpy.reading(PlanState.REVIEWING),
    })
    RunningApi.activePlans.rememberImplementing(RunningApi.WATCHED)

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(await response.text()).toBe(RunningApi.ANSWER)
    expect(RunningApi.reviews.asked).toEqual([])
    expect(RunningApi.readPlanProgress.asked).toEqual([])
  })

  it('half_a_signal_is_still_a_signal_and_a_plan_read_as_being_reworked_refuses_the_go', async () => {
    const stderr = vi.fn()
    const port = await RunningApi.listening(new ImplementPlanSpy(), {
      reviews: ReviewsSpy.unreadable(),
      progress: ReadPlanProgressSpy.reading(PlanState.REVIEWING),
      stderr,
    })

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(UNDER_REVIEW)
    expect(RunningApi.spy.asked).toEqual([])
    expect(stderr).not.toHaveBeenCalled()
  })

  it('a_watch_that_could_not_be_asked_admits_the_go_and_warns_instead_of_hanging', async () => {
    const stderr = vi.fn()
    const port = await RunningApi.listening(
      new ImplementPlanSpy(), { reviews: ReviewsSpy.unreadable(), stderr }
    )

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(RunningApi.readPlanProgress.asked).toHaveLength(1)
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('jjponz/repo-pulse#33 without being able to read')
    )
  })

  it('a_state_that_could_not_be_read_admits_the_go_and_warns_instead_of_hanging', async () => {
    const stderr = vi.fn()
    const port = await RunningApi.listening(new ImplementPlanSpy(), {
      progress: ReadPlanProgressSpy.failingWith(new PlanProgressNotRead('git status refused')),
      stderr,
    })

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('jjponz/repo-pulse#33 without being able to read')
    )
  })

  it('a_readable_signal_that_says_nothing_is_in_flight_warns_about_nothing', async () => {
    const stderr = vi.fn()
    const port = await RunningApi.listening(new ImplementPlanSpy(), { stderr })

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(stderr).not.toHaveBeenCalled()
  })

  it('a_bug_reading_the_state_is_not_swallowed_as_an_unreadable_signal', async () => {
    const port = await RunningApi.listening(new ImplementPlanSpy(), {
      progress: ReadPlanProgressSpy.failingWith(new TypeError('a bug of ours')),
    })

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(await response.json()).toEqual({ code: 'request-failed', detail: 'request failed' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('the_watch_is_lifted_only_after_the_gate_found_nothing_waiting', async () => {
    const waiting = await RunningApi.listening(
      new ImplementPlanSpy(), { reviews: ReviewsSpy.withAnUndeliveredChange() }
    )
    await RunningApi.post(waiting, RunningApi.ACCEPTED_BODY)
    const liftedWhileWaiting = [...RunningApi.reviews.stopped]

    const clear = await RunningApi.listening(new ImplementPlanSpy())
    await RunningApi.post(clear, RunningApi.ACCEPTED_BODY)

    expect(liftedWhileWaiting).toEqual([])
    expect(RunningApi.reviews.stopped).toEqual([
      { issue: 33, repository: RunningApi.WATCHED.repository },
    ])
  })
})

describe('what counts as a review in flight is a rule of its own', () => {
  it('either_signal_saying_a_review_is_in_flight_is_enough_to_say_so', () => {
    const clear = ReviewInFlight.CLEAR

    expect(ReviewGatePolicy.of({ watched: ReviewInFlight.IN_FLIGHT, reworking: clear }))
      .toBe(ReviewInFlight.IN_FLIGHT)
    expect(ReviewGatePolicy.of({ watched: clear, reworking: ReviewInFlight.IN_FLIGHT }))
      .toBe(ReviewInFlight.IN_FLIGHT)
  })

  it('a_signal_in_flight_outranks_a_signal_that_could_not_be_read', () => {
    expect(ReviewGatePolicy.of({
      watched: ReviewInFlight.UNREADABLE, reworking: ReviewInFlight.IN_FLIGHT,
    })).toBe(ReviewInFlight.IN_FLIGHT)
  })

  it('either_signal_that_could_not_be_read_leaves_the_answer_unreadable', () => {
    const clear = ReviewInFlight.CLEAR

    expect(ReviewGatePolicy.of({ watched: ReviewInFlight.UNREADABLE, reworking: clear }))
      .toBe(ReviewInFlight.UNREADABLE)
    expect(ReviewGatePolicy.of({ watched: clear, reworking: ReviewInFlight.UNREADABLE }))
      .toBe(ReviewInFlight.UNREADABLE)
  })

  it('two_signals_that_say_nothing_is_in_flight_say_nothing_is_in_flight', () => {
    expect(ReviewGatePolicy.of({
      watched: ReviewInFlight.CLEAR, reworking: ReviewInFlight.CLEAR,
    })).toBe(ReviewInFlight.CLEAR)
  })

  it('a_signal_nobody_declared_is_refused_instead_of_read_as_nothing_in_flight', () => {
    const undeclared = 'maybe' as unknown as ReviewInFlightValue

    expect(() => ReviewGatePolicy.of({ watched: undeclared, reworking: ReviewInFlight.CLEAR }))
      .toThrow(/a review signal is one of in-flight, clear, unreadable, got \["maybe"\]/)
  })

  it('every_plan_state_says_whether_it_is_a_review_in_flight', () => {
    expect(ReviewGatePolicy.readingThePlan(PlanState.REVIEWING)).toBe(ReviewInFlight.IN_FLIGHT)
    expect(ReviewGatePolicy.readingThePlan(PlanState.READY)).toBe(ReviewInFlight.CLEAR)
    expect(ReviewGatePolicy.readingThePlan(PlanState.WRITING)).toBe(ReviewInFlight.CLEAR)
  })

  it('a_plan_state_nobody_declared_is_refused_instead_of_admitting_the_go', () => {
    expect(() => ReviewGatePolicy.readingThePlan('half-written' as unknown as PlanStateValue))
      .toThrow(/no review signal declared for the plan state "half-written"/)
  })
})
