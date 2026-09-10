import { describe, expect, it, vi } from 'vitest'
import { ActivePlanRecovery } from '../../src/infrastructure/active-plan-recovery.ts'
import { PlansInFlight } from '../../src/domain/value-objects/plans-in-flight.ts'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.js'
import { PlanSessions } from '../../src/infrastructure/plan-events-route.js'
import { DiskImplementationStartRegistry } from '../../src/infrastructure/disk-implementation-start-registry.ts'
import { ImplementationState, ImplementationStep } from '../../src/domain/value-objects/implementation-state.ts'
import { ImplementationProgressNotRead } from '../../src/domain/exceptions.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { ImplementationProgress } from '../../src/domain/ports/implementation-progress.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { DiskGoRegistry } from '../../src/infrastructure/disk-go-registry.ts'
import { ReviewWatch } from '../../src/infrastructure/review-watch.js'
import { WorktreePlans } from '../../src/infrastructure/worktree-plans.ts'
import type { Mock } from 'vitest'

type ProgressAnswer = (asked: {
  root: CheckoutRoot,
  issue: number,
  repository?: RepositoryName,
}) => Promise<ImplementationState>

class ProgressThat extends ImplementationProgress {
  readonly of: Mock<ProgressAnswer>

  constructor(answer: ProgressAnswer) {
    super()
    this.of = vi.fn(answer)
  }
}

class RememberingCheckouts extends CheckoutRegistry {
  readonly remembered: string[] = []

  remember(root: CheckoutRoot): void {
    this.remembered.push(root.text)
  }
}

class MatchingGoRegistry extends DiskGoRegistry {
  readonly matches: Mock<(watch: PlanWatch) => boolean>

  constructor(answer: boolean) {
    super({
      random: () => { throw new Error('a go registry double never mints') },
      write: () => { throw new Error('a go registry double never writes') },
      root: '/state',
    })
    this.matches = vi.fn(() => answer)
  }
}

class RecordingReviews extends ReviewWatch {
  readonly startRecovered: Mock<(watch: PlanWatch) => Promise<void>>

  constructor(label: string) {
    super({
      asked: () => { throw new Error(`${label} never asks`) },
      review: () => { throw new Error(`${label} never reviews`) },
      sleep: () => { throw new Error(`${label} never sleeps`) },
      stderr: () => undefined,
      label,
      log: null,
    })
    this.startRecovered = vi.fn((): Promise<void> => Promise.resolve())
  }
}

class PlansThat extends WorktreePlans {
  readonly inFlight: Mock<() => Promise<PlansInFlight>>

  constructor(answer: () => Promise<PlansInFlight>) {
    super({
      checkouts: new CheckoutRegistry(),
      survey: () => { throw new Error('a plans double never surveys a checkout') },
      sessions: () => { throw new Error('a plans double never asks cmux') },
      story: () => { throw new Error('a plans double never reads a user story') },
      realpathOf: () => null,
      stderr: () => undefined,
    })
    this.inFlight = vi.fn(answer)
  }
}

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
    implementationProgress = new ProgressThat(async () => {
      throw new ImplementationProgressNotRead('no run file was recorded for this plan')
    }),
  }: {
    watches?: PlanWatch[] | null,
    marker?: string | null,
    go?: boolean,
    regular?: boolean,
    readFailure?: Error | null,
    implementationProgress?: ProgressThat,
  } = {}) {
    const sessions = new PlanSessions()
    const activePlans = new ActivePlans({ sessions })
    const reviews = new RecordingReviews('plan review watch double')
    const pullRequestReviews = new RecordingReviews('pull request review watch double')
    const implementationStarts = new DiskImplementationStartRegistry({
      read: vi.fn((): string => {
        if (readFailure !== null) throw readFailure
        if (marker === null) throw new Error('ENOENT')

        return marker
      }),
      stat: vi.fn(() => {
        if (marker === null && readFailure === null) throw new Error('ENOENT')
        return { isFile: () => regular }
      }),
      write: vi.fn(),
      root: '/state',
    })
    const checkouts = new RememberingCheckouts()
    const plans = new PlansThat(async () => (watches === null ? PlansInFlight.refused('cmux said no') : PlansInFlight.listed(watches)))
    const recovery = new ActivePlanRecovery({
      plans,
      checkouts,
      implementationStarts,
      goRegistry: new MatchingGoRegistry(go),
      implementationProgress,
      sessions,
      reviews,
      pullRequestReviews,
      activePlans,
    })

    return { recovery, sessions, activePlans, reviews, pullRequestReviews, checkouts, plans }
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

    expect(await recovered.recovery.recover()).toBeNull()

    expect(recovered.sessions.known()).toEqual([])
    expect(recovered.reviews.startRecovered).not.toHaveBeenCalled()
    expect(recovered.activePlans.known()[0].phase).toBe('uncertain')
  })

  it('a_go_that_predates_the_implementation_marker_registry_recovers_as_implementing_when_the_run_file_shows_work_underway', async () => {
    const runState = ImplementationState.of({
      step: ImplementationStep.SLICE_JUDGE, task: 8, totalTasks: 8, name: null, attempt: 1, discards: 0,
    })
    const implementationProgress = new ProgressThat(async () => runState)
    const recovered = fixture({ go: true, implementationProgress })

    expect(await recovered.recovery.recover()).toBeNull()

    expect(implementationProgress.of).toHaveBeenCalledWith({ root: expect.objectContaining({ text: '/repo' }), issue: 45 })
    expect(recovered.sessions.known()).toEqual([])
    expect(recovered.reviews.startRecovered).not.toHaveBeenCalled()
    expect(recovered.activePlans.known()[0].phase).toBe('implementing')
  })

  it('a_go_whose_run_file_cannot_be_read_stays_uncertain_instead_of_being_assumed_clean', async () => {
    const implementationProgress = new ProgressThat(async () => {
      throw new ImplementationProgressNotRead('the worktree is not there, so its run cannot be read')
    })
    const recovered = fixture({ go: true, implementationProgress })

    expect(await recovered.recovery.recover()).toBeNull()

    expect(recovered.activePlans.known()[0].phase).toBe('uncertain')
  })

  it('a_go_whose_worktree_exists_but_has_no_run_file_yet_stays_uncertain_instead_of_being_assumed_clean', async () => {
    const implementationProgress = new ProgressThat(async () => ImplementationState.starting())
    const recovered = fixture({ go: true, implementationProgress })

    expect(await recovered.recovery.recover()).toBeNull()

    expect(recovered.activePlans.known()[0].phase).toBe('uncertain')
  })

  it('a_go_whose_run_file_explicitly_says_starting_stays_uncertain_instead_of_being_assumed_clean', async () => {
    const runState = ImplementationState.of({
      step: ImplementationStep.STARTING, task: null, totalTasks: null, name: null, attempt: null, discards: null,
    })
    const implementationProgress = new ProgressThat(async () => runState)
    const recovered = fixture({ go: true, implementationProgress })

    expect(await recovered.recovery.recover()).toBeNull()

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
    const recovered = fixture({ go: true, implementationProgress: new ProgressThat(async () => runState) })

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

  it('the_checkout_of_a_plan_it_recovered_goes_back_to_the_registry_so_the_sweep_knows_that_clone', async () => {
    const recovered = fixture()

    await recovered.recovery.recover()

    expect(recovered.checkouts.remembered).toEqual(['/repo'])
  })

  it('two_recoveries_at_once_run_the_recovery_once_so_nobody_gets_two_watches', async () => {
    const recovered = fixture()

    await Promise.all([recovered.recovery.recover(), recovered.recovery.recover()])

    expect(recovered.plans.inFlight).toHaveBeenCalledOnce()
    expect(recovered.reviews.startRecovered).toHaveBeenCalledOnce()
  })

  it('does_not_start_a_second_review_when_recovery_is_repeated', async () => {
    const recovered = fixture()

    expect(await recovered.recovery.recover()).toBeNull()
    expect(await recovered.recovery.recover()).toBeNull()

    expect(recovered.sessions.known()).toHaveLength(1)
    expect(recovered.reviews.startRecovered).toHaveBeenCalledOnce()
  })

  it('recovers_nothing_and_hands_over_the_reason_when_the_plans_in_flight_could_not_be_listed', async () => {
    const recovered = fixture({ watches: null })

    expect(await recovered.recovery.recover()).toBe('cmux said no')
    expect(recovered.activePlans.known()).toEqual([])
    expect(recovered.reviews.startRecovered).not.toHaveBeenCalled()
  })
})
