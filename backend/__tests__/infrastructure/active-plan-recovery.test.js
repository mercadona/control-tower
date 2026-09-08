import { describe, expect, it, vi } from 'vitest'
import { ActivePlanRecovery } from '../../src/infrastructure/active-plan-recovery.js'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.js'
import { PlanSessions } from '../../src/infrastructure/plan-events-route.js'
import { DiskImplementationStartRegistry } from '../../src/infrastructure/disk-implementation-start-registry.js'
import { ImplementationState, ImplementationStep } from '../../src/domain/value-objects/implementation-state.js'
import { ImplementationProgressNotRead } from '../../src/domain/exceptions.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'

const IN_FLIGHT = new PlanWatch({
  story: new UserStoryKey('ABC-123'),
  issue: new PlanIssue({ number: 45, url: 'https://github.com/jjponz/repo-pulse/issues/45' }),
  located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/45', branch: 'feat/45' }),
  repository: new RepositoryName('jjponz/repo-pulse'),
  agent: 'workspace:9',
})

describe('ActivePlanRecovery', () => {
  const VALID_MARKER = JSON.stringify({
    repo: 'jjponz/repo-pulse', issue: 45, agent: 'workspace:9', story: 'ABC-123',
    root: '/repo', branch: 'feat/45', worktree: '/repo/.worktrees/45',
  })

  function fixture({
    watches = [IN_FLIGHT], marker = null, go = false, regular = true, readFailure = null,
    implementationProgress = { of: vi.fn(async () => {
      throw new ImplementationProgressNotRead('no run file was recorded for this plan')
    }) },
  } = {}) {
    const sessions = new PlanSessions()
    const activePlans = new ActivePlans({ sessions })
    const reviews = { startRecovered: vi.fn() }
    const pullRequestReviews = { startRecovered: vi.fn() }
    const implementationStarts = new DiskImplementationStartRegistry({
      read: vi.fn(() => {
        if (readFailure !== null) throw readFailure
        return marker
      }),
      stat: vi.fn(() => {
        if (marker === null && readFailure === null) throw new Error('ENOENT')
        return { isFile: () => regular }
      }),
      write: vi.fn(),
      root: '/state',
    })
    const recovery = new ActivePlanRecovery({
      plans: { inFlight: vi.fn(async () => watches) },
      implementationStarts,
      goRegistry: { matches: vi.fn(() => go) },
      implementationProgress,
      sessions,
      reviews,
      pullRequestReviews,
      activePlans,
    })

    return { recovery, sessions, activePlans, reviews, pullRequestReviews }
  }

  it('a_plan_with_no_go_and_no_implementation_marker_recovers_as_planning', async () => {
    const recovered = fixture()

    await recovered.recovery.recover()

    expect(recovered.sessions.known()).toHaveLength(1)
    expect(recovered.reviews.startRecovered).toHaveBeenCalledWith(recovered.sessions.known()[0])
    expect(recovered.activePlans.known()[0].phase).toBe('planning')
  })

  it('a_valid_go_without_an_implementation_marker_recovers_as_uncertain', async () => {
    const recovered = fixture({ go: true })

    expect(await recovered.recovery.recover()).toBe(true)

    expect(recovered.sessions.known()).toEqual([])
    expect(recovered.reviews.startRecovered).not.toHaveBeenCalled()
    expect(recovered.activePlans.known()[0].phase).toBe('uncertain')
  })

  it('a_go_that_predates_the_implementation_marker_registry_recovers_as_implementing_when_the_run_file_shows_work_underway', async () => {
    const runState = ImplementationState.of({
      step: ImplementationStep.SLICE_JUDGE, task: 8, totalTasks: 8, name: null, attempt: 1, discards: 0,
    })
    const implementationProgress = { of: vi.fn(async () => runState) }
    const recovered = fixture({ go: true, implementationProgress })

    expect(await recovered.recovery.recover()).toBe(true)

    expect(implementationProgress.of).toHaveBeenCalledWith({ root: expect.objectContaining({ text: '/repo' }), issue: 45 })
    expect(recovered.sessions.known()).toEqual([])
    expect(recovered.reviews.startRecovered).not.toHaveBeenCalled()
    expect(recovered.activePlans.known()[0].phase).toBe('implementing')
  })

  it('a_go_whose_run_file_cannot_be_read_stays_uncertain_instead_of_being_assumed_clean', async () => {
    const implementationProgress = { of: vi.fn(async () => {
      throw new ImplementationProgressNotRead('the worktree is not there, so its run cannot be read')
    }) }
    const recovered = fixture({ go: true, implementationProgress })

    expect(await recovered.recovery.recover()).toBe(true)

    expect(recovered.activePlans.known()[0].phase).toBe('uncertain')
  })

  it('a_go_whose_worktree_exists_but_has_no_run_file_yet_stays_uncertain_instead_of_being_assumed_clean', async () => {
    const implementationProgress = { of: vi.fn(async () => ImplementationState.starting()) }
    const recovered = fixture({ go: true, implementationProgress })

    expect(await recovered.recovery.recover()).toBe(true)

    expect(recovered.activePlans.known()[0].phase).toBe('uncertain')
  })

  it('a_go_whose_run_file_explicitly_says_starting_stays_uncertain_instead_of_being_assumed_clean', async () => {
    const runState = ImplementationState.of({
      step: ImplementationStep.STARTING, task: null, totalTasks: null, name: null, attempt: null, discards: null,
    })
    const implementationProgress = { of: vi.fn(async () => runState) }
    const recovered = fixture({ go: true, implementationProgress })

    expect(await recovered.recovery.recover()).toBe(true)

    expect(recovered.activePlans.known()[0].phase).toBe('uncertain')
  })

  it('a_plan_with_a_matching_marker_recovers_as_implementing_and_its_plan_watch_stays_off', async () => {
    const recovered = fixture({ marker: VALID_MARKER })

    await recovered.recovery.recover()

    expect(recovered.sessions.known()).toEqual([])
    expect(recovered.reviews.startRecovered).not.toHaveBeenCalled()
    expect(recovered.activePlans.known()[0].phase).toBe('implementing')
  })

  it('a_plan_that_was_already_implementing_gets_its_pull_request_watched_again', async () => {
    const recovered = fixture({ marker: VALID_MARKER })

    await recovered.recovery.recover()

    expect(recovered.pullRequestReviews.startRecovered).toHaveBeenCalledOnce()
    expect(recovered.pullRequestReviews.startRecovered).toHaveBeenCalledWith(IN_FLIGHT)
  })

  it('a_go_whose_run_file_shows_work_underway_gets_its_pull_request_watched_too', async () => {
    const runState = ImplementationState.of({
      step: ImplementationStep.SLICE_JUDGE, task: 8, totalTasks: 8, name: null, attempt: 1, discards: 0,
    })
    const recovered = fixture({ go: true, implementationProgress: { of: vi.fn(async () => runState) } })

    await recovered.recovery.recover()

    expect(recovered.pullRequestReviews.startRecovered).toHaveBeenCalledWith(IN_FLIGHT)
  })

  it('a_plan_that_never_started_implementing_gets_no_pull_request_watch', async () => {
    const planning = fixture()
    const uncertain = fixture({ go: true })

    await planning.recovery.recover()
    await uncertain.recovery.recover()

    expect(planning.pullRequestReviews.startRecovered).not.toHaveBeenCalled()
    expect(uncertain.pullRequestReviews.startRecovered).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', ''],
    ['malformed', '{'],
    ['Go commitment only', JSON.stringify({ repo: 'jjponz/repo-pulse', issue: 45, commitment: 'a'.repeat(64) })],
    ['mismatched repository', VALID_MARKER.replace('jjponz/repo-pulse', 'other/repo')],
    ['mismatched issue', VALID_MARKER.replace('"issue":45', '"issue":44')],
    ['mismatched agent', VALID_MARKER.replace('workspace:9', 'workspace:10')],
    ['mismatched root', VALID_MARKER.replace('"/repo"', '"/other"')],
    ['mismatched branch', VALID_MARKER.replace('feat/45', 'feat/44')],
    ['mismatched worktree', VALID_MARKER.replace('/repo/.worktrees/45', '/repo/.worktrees/44')],
  ])('keeps_a_plan_with_an_%s_marker_in_planning', async (description, marker) => {
    const recovered = fixture({ marker })

    await recovered.recovery.recover()

    expect(recovered.activePlans.known()[0].phase).toBe('planning')
    expect(recovered.reviews.startRecovered).toHaveBeenCalledOnce()
  })

  it('a_marker_whose_story_differs_is_still_this_plan_because_the_title_of_an_issue_can_be_renamed', async () => {
    const recovered = fixture({ marker: VALID_MARKER.replace('ABC-123', 'ABC-124') })

    await recovered.recovery.recover()

    expect(recovered.activePlans.known()[0].phase).toBe('implementing')
  })

  it('keeps_a_plan_with_a_marker_path_that_is_a_directory_in_planning', async () => {
    const recovered = fixture({ marker: VALID_MARKER, regular: false })

    await recovered.recovery.recover()

    expect(recovered.activePlans.known()[0].phase).toBe('planning')
  })

  it('keeps_a_plan_with_an_unreadable_marker_in_planning_without_stopping_startup', async () => {
    const recovered = fixture({ marker: VALID_MARKER, readFailure: new Error('EACCES') })

    await expect(recovered.recovery.recover()).resolves.not.toThrow()
    expect(recovered.activePlans.known()[0].phase).toBe('planning')
  })

  it('does_not_start_a_second_review_when_recovery_is_repeated', async () => {
    const recovered = fixture()

    expect(await recovered.recovery.recover()).toBe(true)
    expect(await recovered.recovery.recover()).toBe(true)

    expect(recovered.sessions.known()).toHaveLength(1)
    expect(recovered.reviews.startRecovered).toHaveBeenCalledOnce()
  })

  it('recovers_nothing_when_the_plans_in_flight_could_not_be_listed', async () => {
    const recovered = fixture({ watches: null })

    expect(await recovered.recovery.recover()).toBe(false)
    expect(recovered.activePlans.known()).toEqual([])
    expect(recovered.reviews.startRecovered).not.toHaveBeenCalled()
  })
})
