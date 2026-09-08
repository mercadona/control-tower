import { describe, expect, it, vi } from 'vitest'
import { WorktreePlans } from '../../src/infrastructure/worktree-plans.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'
import { PreparedWorkspace } from '../../src/domain/value-objects/prepared-workspace.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { WorkspaceSurvey } from '../../src/domain/value-objects/workspace-survey.js'
import { PlanStoryNotRead, WorkspaceNotRead } from '../../src/domain/exceptions.js'
import { CmuxPlanAgents } from '../../src/infrastructure/cmux-plan-agents.js'

class SurveyedCheckout {
  static REPOSITORY = new RepositoryName('owner/repo')

  static of(root, issueNumbers) {
    return new WorkspaceSurvey({
      repository: SurveyedCheckout.REPOSITORY,
      prepared: issueNumbers.map((issueNumber) => new PreparedWorkspace({
        issueNumber,
        located: new WorkspaceLocation({
          root,
          path: `${root}/.worktrees/${issueNumber}`,
          branch: `feat/${issueNumber}`,
        }),
      })),
    })
  }
}

class SessionsOfCmux {
  static PLAN_TITLE = CmuxPlanAgents.nameFor({
    story: new UserStoryKey('ABC-123'),
    repository: new RepositoryName('owner/repo'),
    issueNumber: 33,
  })

  static DISPATCHED_TITLE = 'owner/repo \u00b7 #33 un slice del dispatcher'

  static attending(worktree, { ref = 'workspace:20', title = SessionsOfCmux.PLAN_TITLE } = {}) {
    return [{ cwd: worktree, cwdKnown: true, ref, title }]
  }

  static none() {
    return []
  }

  static couldNotBeListed() {
    return null
  }
}

class PlansOf {
  static ONE_CHECKOUT = '/repos/one'

  static aWorktreeAttendedBy(sessions, { storyOf = () => new UserStoryKey('ABC-123'), stderr = vi.fn() } = {}) {
    return new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot(PlansOf.ONE_CHECKOUT)] },
      survey: () => SurveyedCheckout.of(PlansOf.ONE_CHECKOUT, [33]),
      sessions,
      planIssues: { storyOf },
      stderr,
    })
  }
}

describe('WorktreePlans', () => {
  it('the_identity_of_a_plan_in_flight_comes_from_git_and_the_session_only_names_its_agent', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/repos/one/.worktrees/33')
    )

    const [watch] = await plans.inFlight()

    expect({
      story: watch.storyText(),
      issue: watch.issue.number,
      url: watch.issue.url,
      repo: watch.repository.text,
      root: watch.located.root,
      worktree: watch.located.path,
      branch: watch.located.branch,
      agent: watch.agent,
    }).toEqual({
      story: 'ABC-123',
      issue: 33,
      url: 'https://github.com/owner/repo/issues/33',
      repo: 'owner/repo',
      root: '/repos/one',
      worktree: '/repos/one/.worktrees/33',
      branch: 'feat/33',
      agent: 'workspace:20',
    })
  })

  it('a_worktree_with_no_live_session_is_left_out_the_same_way_it_is_left_out_today', async () => {
    expect(await PlansOf.aWorktreeAttendedBy(SessionsOfCmux.none).inFlight()).toEqual([])
  })

  it('a_session_that_hides_its_directory_does_not_lend_its_agent_while_another_one_shows_its_own', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(() => [
      { cwd: '/repos/one/.worktrees/33', cwdKnown: false, ref: 'workspace:20', title: SessionsOfCmux.PLAN_TITLE },
      ...SessionsOfCmux.attending('/repos/elsewhere/.worktrees/7'),
    ])

    expect(await plans.inFlight()).toEqual([])
  })

  it('a_session_sitting_somewhere_else_does_not_lend_its_agent_to_this_worktree', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/repos/one/.worktrees/41')
    )

    expect(await plans.inFlight()).toEqual([])
  })

  it('sessions_that_could_not_be_listed_is_not_the_same_as_no_plans_in_flight', async () => {
    expect(await PlansOf.aWorktreeAttendedBy(SessionsOfCmux.couldNotBeListed).inFlight()).toBeNull()
  })

  it('the_story_it_could_not_read_leaves_the_plan_recovered_without_one', async () => {
    const stderr = vi.fn()
    const plans = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      { storyOf: () => { throw new PlanStoryNotRead('gh: not authenticated') }, stderr }
    )

    const [watch] = await plans.inFlight()

    expect(watch.storyText()).toBeNull()
    expect(watch.issue.number).toBe(33)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('#33'))
  })

  it('a_checkout_that_cannot_be_surveyed_does_not_take_the_other_checkouts_with_it', async () => {
    const stderr = vi.fn()
    const plans = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/broken'), new CheckoutRoot('/repos/one')] },
      survey: (root) => {
        if (root.text === '/repos/broken') throw new WorkspaceNotRead('git worktree list refused')

        return SurveyedCheckout.of('/repos/one', [33])
      },
      sessions: () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      planIssues: { storyOf: () => null },
      stderr,
    })

    const recovered = await plans.inFlight()

    expect(recovered.map((watch) => watch.issue.number)).toEqual([33])
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/repos/broken'))
  })

  it('a_worktree_the_dispatcher_opened_is_not_adopted_as_a_plan_of_this_backend', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/repos/one/.worktrees/33', { title: SessionsOfCmux.DISPATCHED_TITLE })
    )

    expect(await plans.inFlight()).toEqual([])
  })

  it('a_session_whose_ref_is_not_a_handle_names_no_agent', async () => {
    const notAHandle = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/repos/one/.worktrees/33', { ref: 'surface:9' })
    )
    const noRefAtAll = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/repos/one/.worktrees/33', { ref: null })
    )

    expect(await notAHandle.inFlight()).toEqual([])
    expect(await noRefAtAll.inFlight()).toEqual([])
  })

  it('sessions_that_all_hide_their_directory_is_not_the_same_as_no_plans_in_flight', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => [{ cwd: null, cwdKnown: false, ref: 'workspace:20', title: SessionsOfCmux.PLAN_TITLE }]
    )

    expect(await plans.inFlight()).toBeNull()
  })

  it('a_checkout_registry_that_could_not_be_read_is_not_the_same_as_no_checkouts', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => null },
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      sessions: () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      planIssues: { storyOf: () => null },
      stderr: vi.fn(),
    })

    expect(await plans.inFlight()).toBeNull()
  })

  it('a_failure_that_is_not_the_ones_this_reader_degrades_travels_out_instead_of_passing_for_nothing', async () => {
    const surveyBroke = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/one')] },
      survey: () => { throw new TypeError('git-workspace has a bug') },
      sessions: () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      planIssues: { storyOf: () => null },
      stderr: vi.fn(),
    })
    const storyBroke = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      { storyOf: () => { throw new TypeError('gh-plan-issues has a bug') } }
    )

    await expect(surveyBroke.inFlight()).rejects.toBeInstanceOf(TypeError)
    await expect(storyBroke.inFlight()).rejects.toBeInstanceOf(TypeError)
  })
})
