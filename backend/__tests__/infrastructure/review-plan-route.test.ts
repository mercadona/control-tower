import { describe, it, expect, afterEach } from 'vitest'
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
import { ReviewRequestOutcome, ReviewRefusal, ReviewPhases } from '../../src/infrastructure/api/review-plan-route.ts'
import { PlanChangesNotAsked } from '../../src/domain/exceptions.ts'
import { ActivePlans, ActivePlanPhase } from '../../src/infrastructure/api/active-plans-route.ts'
import type { AskPlanChangesParams } from '../../src/application/actions/ask-plan-changes.ts'

type AskedChange = { issue: number, repository: string, changes: string }

class AskPlanChangesSpy {
  readonly asked: AskedChange[]

  constructor() {
    this.asked = []
  }

  static failingWith(cause: unknown): AskPlanChangesSpy {
    const spy = new AskPlanChangesSpy()
    spy.execute = async () => { throw cause }

    return spy
  }

  async execute(params: AskPlanChangesParams): Promise<void> {
    this.asked.push({ issue: params.issue.number, repository: params.repository.text, changes: params.changes })
  }
}

class RunningApi {
  static #started: ApiServer[] = []
  static PATH = '/review-plan'
  static ACCEPTED_BODY = '{"issue":33,"repo":"jjponz/repo-pulse","changes":"parte la tarea 2"}'
  static PADDED_BODY = '{"issue":33,"repo":"jjponz/repo-pulse","changes":"   parte la tarea 2   "}'
  static TWO_LINE_CHANGES = 'parte la tarea 2\ny renumera las siguientes'
  static TWO_LINE_BODY = '{"issue":33,"repo":"jjponz/repo-pulse","changes":"parte la tarea 2\\ny renumera las siguientes"}'
  static MALFORMED_IN_TWO_FIELDS_BODY = '{"issue":0,"repo":"repo-pulse","changes":"x"}'
  static activePlans: ActivePlans | null = null

  static watchOf(number: number): PlanWatch {
    return new PlanWatch({
      story: new UserStoryKey('ABC-123'),
      issue: new PlanIssue({ number, url: `https://github.com/jjponz/repo-pulse/issues/${number}` }),
      located: new WorkspaceLocation({
        root: '/repo', path: `/repo/.worktrees/${number}`, branch: `feat/${number}`,
      }),
      repository: new RepositoryName('jjponz/repo-pulse'),
      agent: 'workspace:20',
    })
  }

  static WATCHED = RunningApi.watchOf(33)
  static FIRST_ISSUE_BODY = '{"issue":1,"repo":"jjponz/repo-pulse","changes":"parte la tarea 2"}'

  static NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })

  static async listening(
    spy: AskPlanChangesSpy = new AskPlanChangesSpy(),
    options: { watched?: boolean, watch?: PlanWatch } = {}
  ): Promise<number> {
    const reviews = new ReviewsSpy()
    const pullRequestReviews = new ReviewsSpy()
    const sessions = new PlanSessions()
    if (options.watched ?? true) sessions.remember(options.watch ?? RunningApi.WATCHED)
    const activePlans = new ActivePlans({ sessions })
    RunningApi.activePlans = activePlans
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      askPlanChanges: spy,
      implementProgress: undefined,
      externalTools: undefined,
      reviews,
      pullRequestReviews,
      sessions,
      activePlans,
      implementationStarts: { remember: async () => {} },
      stderr: () => {},
      planEvents: RunningApi.NO_EVENTS,
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

  static async post(
    port: number, body: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }
  ): Promise<globalThis.Response> {
    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'POST', body, headers })
  }

  static async asking(body: string): Promise<globalThis.Response> {
    return RunningApi.post(await RunningApi.listening(), body)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('ReviewPlanRoute', () => {
  it('a_well_formed_body_for_a_watched_plan_publishes_the_changes_trimmed_and_answers_accepted', async () => {
    const spy = new AskPlanChangesSpy()
    const response = await RunningApi.post(await RunningApi.listening(spy), RunningApi.PADDED_BODY)

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('{"status":"changes-asked","issue":33}')
    expect(spy.asked).toEqual([{ issue: 33, repository: 'jjponz/repo-pulse', changes: 'parte la tarea 2' }])
  })

  it('a_plan_this_process_does_not_watch_is_refused_without_publishing_anything', async () => {
    const spy = new AskPlanChangesSpy()
    const response = await RunningApi.post(
      await RunningApi.listening(spy, { watched: false }), RunningApi.ACCEPTED_BODY
    )

    expect(response.status).toBe(400)
    expect(JSON.parse(await response.text()).code).toBe('no-live-planning-session')
    expect(spy.asked).toEqual([])
  })

  it('a_plan_already_being_implemented_is_told_apart_from_one_this_process_never_watched', async () => {
    const spy = new AskPlanChangesSpy()
    const port = await RunningApi.listening(spy)
    RunningApi.activePlans!.rememberImplementing(RunningApi.WATCHED)

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)
    const refusal = JSON.parse(await response.text())

    expect(response.status).toBe(400)
    expect(refusal.code).toBe('plan-already-being-implemented')
    expect(refusal.detail).toBe('the plan is already being implemented, so its review watch is gone')
    expect(spy.asked).toEqual([])
  })

  it('a_plan_whose_phase_is_uncertain_is_refused_with_the_code_implement_plan_already_uses_for_it', async () => {
    const spy = new AskPlanChangesSpy()
    const port = await RunningApi.listening(spy)
    RunningApi.activePlans!.rememberUncertain(RunningApi.WATCHED)

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)
    const refusal = JSON.parse(await response.text())

    expect(response.status).toBe(400)
    expect(refusal.code).toBe('implementation-phase-uncertain')
    expect(refusal.detail).toBe('implementation may have started; inspect the plan before retrying')
    expect(spy.asked).toEqual([])
  })

  it('changes_written_across_two_lines_reach_the_action_with_both_lines_verbatim', async () => {
    const spy = new AskPlanChangesSpy()
    const response = await RunningApi.post(await RunningApi.listening(spy), RunningApi.TWO_LINE_BODY)

    expect(response.status).toBe(202)
    expect(spy.asked).toEqual([{
      issue: 33, repository: 'jjponz/repo-pulse', changes: RunningApi.TWO_LINE_CHANGES,
    }])
  })

  it('the_first_issue_of_a_repository_is_a_whole_number_from_one_and_is_accepted', async () => {
    const spy = new AskPlanChangesSpy()
    const port = await RunningApi.listening(spy, { watch: RunningApi.watchOf(1) })

    const response = await RunningApi.post(port, RunningApi.FIRST_ISSUE_BODY)

    expect(response.status).toBe(202)
    expect(spy.asked).toEqual([{ issue: 1, repository: 'jjponz/repo-pulse', changes: 'parte la tarea 2' }])
  })

  it('a_body_malformed_in_the_issue_and_in_the_repo_names_the_issue_because_that_is_checked_first', async () => {
    const response = await RunningApi.asking(RunningApi.MALFORMED_IN_TWO_FIELDS_BODY)

    expect(JSON.parse(await response.text()).code).toBe('malformed-issue')
  })

  it('a_failure_that_is_not_a_refusal_to_publish_is_not_dressed_up_as_gh_refusing', async () => {
    const spy = AskPlanChangesSpy.failingWith(new TypeError('a bug of ours'))
    const response = await RunningApi.post(await RunningApi.listening(spy), RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'request-failed', detail: 'request failed' })
  })

  it('blank_changes_are_refused_because_an_empty_review_asks_the_agent_for_nothing', async () => {
    const response = await RunningApi.asking('{"issue":33,"repo":"jjponz/repo-pulse","changes":"   "}')

    expect(response.status).toBe(400)
    expect(JSON.parse(await response.text()).code).toBe('malformed-changes')
  })

  it('changes_carrying_a_control_character_are_refused_because_the_comment_could_not_carry_them', async () => {
    const spy = new AskPlanChangesSpy()
    const response = await RunningApi.post(
      await RunningApi.listening(spy),
      '{"issue":33,"repo":"jjponz/repo-pulse","changes":"parte\\u0000la tarea 2"}'
    )

    expect(response.status).toBe(400)
    expect(JSON.parse(await response.text()).code).toBe('malformed-changes')
    expect(spy.asked).toEqual([])
  })

  it('changes_that_are_not_text_are_refused', async () => {
    const response = await RunningApi.asking('{"issue":33,"repo":"jjponz/repo-pulse","changes":7}')

    expect(JSON.parse(await response.text()).code).toBe('malformed-changes')
  })

  it('a_body_that_is_not_a_json_object_is_refused', async () => {
    const response = await RunningApi.asking('[]')

    expect(JSON.parse(await response.text()).code).toBe('body-not-a-json-object')
  })

  it('an_unknown_field_is_refused_and_named_sorted', async () => {
    const response = await RunningApi.asking('{"issue":33,"repo":"jjponz/repo-pulse","changes":"x","zip":1,"agent":"a"}')
    const refusal = JSON.parse(await response.text())

    expect(refusal.code).toBe('unknown-field')
    expect(refusal.detail).toBe('unknown field: agent, zip')
  })

  it('a_malformed_issue_is_refused', async () => {
    const response = await RunningApi.asking('{"issue":0,"repo":"jjponz/repo-pulse","changes":"x"}')

    expect(JSON.parse(await response.text()).code).toBe('malformed-issue')
  })

  it('a_malformed_repo_is_refused', async () => {
    const response = await RunningApi.asking('{"issue":33,"repo":"repo-pulse","changes":"x"}')

    expect(JSON.parse(await response.text()).code).toBe('malformed-repo')
  })

  it('a_gh_that_refuses_reaches_the_page_as_plan_changes_not_asked_with_its_own_words', async () => {
    const spy = AskPlanChangesSpy.failingWith(new PlanChangesNotAsked('gh issue comment failed: gh: not found'))
    const response = await RunningApi.post(await RunningApi.listening(spy), RunningApi.ACCEPTED_BODY)
    const refusal = JSON.parse(await response.text())

    expect(response.status).toBe(400)
    expect(refusal.code).toBe('plan-changes-not-asked')
    expect(refusal.detail).toBe('gh issue comment failed: gh: not found')
  })

  it('a_wrong_method_answers_405_naming_the_right_one', async () => {
    const port = await RunningApi.listening()
    const response = await fetch(`http://127.0.0.1:${port}/review-plan`)

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })

  it('a_post_that_does_not_declare_json_is_refused', async () => {
    const port = await RunningApi.listening()
    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY, {})

    expect(response.status).toBe(415)
  })
})

describe('ReviewRefusal', () => {
  it('every_declared_outcome_but_the_accepted_one_has_a_refusal', () => {
    const declared = ReviewRefusal.declaredOutcomes()
    const outcomes = Object.values(ReviewRequestOutcome).filter(
      (outcome) => outcome !== ReviewRequestOutcome.ACCEPTED
    )

    expect(declared.sort()).toEqual(outcomes.sort())
  })
})

describe('ReviewPhases', () => {
  it('every_phase_a_plan_can_be_in_is_dispatched_over_so_a_fourth_one_cannot_fall_into_a_default', () => {
    expect(ReviewPhases.declaredPhases().sort()).toEqual(Object.values(ActivePlanPhase).sort())
  })
})
