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
import { CmuxAnswer } from '../../../plugin/scripts/cmux.js'

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
  static REFUSAL = 'cmux could not be asked for its windows: Error: ERROR: Access denied - only processes started inside cmux can connect'

  static attending(worktree, { ref = 'workspace:20', title = SessionsOfCmux.PLAN_TITLE } = {}) {
    return SessionsOfCmux.listing([{ cwd: worktree, cwdKnown: true, ref, title }])
  }

  static listing(entries) {
    return CmuxAnswer.answered(entries)
  }

  static none() {
    return SessionsOfCmux.listing([])
  }

  static couldNotBeListed() {
    return CmuxAnswer.refused(SessionsOfCmux.REFUSAL)
  }
}

class PlansOf {
  static ONE_CHECKOUT = '/repos/one'

  static aCheckoutRegistryThatCannotBeRead({ stderr }) {
    return PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending(`${PlansOf.ONE_CHECKOUT}/.worktrees/33`),
      { stderr, checkouts: { known: () => null } }
    )
  }

  static aWorktreeAttendedBy(sessions, {
    story = () => new UserStoryKey('ABC-123'), stderr = vi.fn(), realpathOf = (path) => path,
    checkouts = { known: () => [new CheckoutRoot(PlansOf.ONE_CHECKOUT)] },
  } = {}) {
    return new WorktreePlans({
      checkouts,
      survey: () => SurveyedCheckout.of(PlansOf.ONE_CHECKOUT, [33]),
      sessions,
      story,
      realpathOf,
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
    const plans = PlansOf.aWorktreeAttendedBy(() => SessionsOfCmux.listing([
      { cwd: '/repos/one/.worktrees/33', cwdKnown: false, ref: 'workspace:20', title: SessionsOfCmux.PLAN_TITLE },
      ...SessionsOfCmux.attending('/repos/elsewhere/.worktrees/7').entries,
    ]))

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

  it('when_cmux_could_not_be_asked_its_own_words_reach_the_error_channel', async () => {
    const stderr = vi.fn()

    await PlansOf.aWorktreeAttendedBy(SessionsOfCmux.couldNotBeListed, { stderr }).inFlight()

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(SessionsOfCmux.REFUSAL))
  })

  it('when_no_session_exposes_its_directory_the_error_channel_says_that_is_why', async () => {
    const stderr = vi.fn()
    const plans = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.listing([{ cwd: null, cwdKnown: false, ref: 'workspace:20', title: SessionsOfCmux.PLAN_TITLE }]),
      { stderr }
    )

    await plans.inFlight()

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('none of them exposes its directory'))
  })

  it('when_the_checkout_registry_cannot_be_read_the_error_channel_says_that_is_why', async () => {
    const stderr = vi.fn()

    await PlansOf.aCheckoutRegistryThatCannotBeRead({ stderr }).inFlight()

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('the checkouts it serves could not be read'))
  })

  it('the_story_it_could_not_read_leaves_the_plan_recovered_without_one', async () => {
    const stderr = vi.fn()
    const plans = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      { story: () => { throw new PlanStoryNotRead('gh: not authenticated') }, stderr }
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
      story: () => null,
      realpathOf: (path) => path,
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
      () => SessionsOfCmux.listing([{ cwd: null, cwdKnown: false, ref: 'workspace:20', title: SessionsOfCmux.PLAN_TITLE }])
    )

    expect(await plans.inFlight()).toBeNull()
  })

  it('a_plan_in_flight_is_recovered_even_when_the_registry_has_never_been_written', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => [] },
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      sessions: () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path) => path,
      stderr: vi.fn(),
    })

    const [watch] = await plans.inFlight()

    expect(watch.issue.number).toBe(33)
    expect(watch.located.root).toBe('/repos/one')
  })

  it('a_session_the_dispatcher_opened_does_not_put_its_checkout_on_the_list_to_survey', async () => {
    const surveyed = []
    const plans = new WorktreePlans({
      checkouts: { known: () => [] },
      survey: (root) => {
        surveyed.push(root.text)

        return SurveyedCheckout.of(root.text, [])
      },
      sessions: () => SessionsOfCmux.attending(
        '/repos/dispatched/.worktrees/41', { title: SessionsOfCmux.DISPATCHED_TITLE }
      ),
      story: () => null,
      realpathOf: (path) => path,
      stderr: vi.fn(),
    })

    expect(await plans.inFlight()).toEqual([])
    expect(surveyed).toEqual([])
  })

  it('a_checkout_registry_that_could_not_be_read_is_not_the_same_as_no_checkouts', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => null },
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      sessions: () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path) => path,
      stderr: vi.fn(),
    })

    expect(await plans.inFlight()).toBeNull()
  })

  it('a_session_sitting_in_the_same_place_through_a_symlink_still_names_its_agent', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/private/repos/one/.worktrees/33'),
      { realpathOf: (path) => path.replace(/^\/(private\/)?repos\/one/, '/private/repos/one') }
    )

    const [watch] = await plans.inFlight()

    expect(watch.agent).toBe('workspace:20')
  })

  it('a_session_that_names_the_logical_path_while_git_names_the_physical_one_still_names_its_agent', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/logical/one/.worktrees/33'),
      { realpathOf: (path) => path.replace(/^\/(logical|repos)\/one/, '/physical/one') }
    )

    const [watch] = await plans.inFlight()

    expect(watch.agent).toBe('workspace:20')
  })

  it('the_checkout_a_session_names_is_surveyed_by_the_path_git_itself_uses', async () => {
    const surveyed = []
    const plans = new WorktreePlans({
      checkouts: { known: () => [] },
      survey: (root) => {
        surveyed.push(root.text)

        return SurveyedCheckout.of(root.text, [])
      },
      sessions: () => SessionsOfCmux.attending('/logical/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path) => path.replace('/logical/one', '/physical/one'),
      stderr: vi.fn(),
    })

    await plans.inFlight()

    expect(surveyed).toEqual(['/physical/one'])
  })

  it('an_entry_that_is_not_an_object_does_not_take_the_whole_recovery_down_with_it', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(() => SessionsOfCmux.listing([
      null,
      ...SessionsOfCmux.attending('/repos/one/.worktrees/33').entries,
    ]))

    const [watch] = await plans.inFlight()

    expect(watch.agent).toBe('workspace:20')
  })

  it('a_failure_of_another_kind_of_domain_is_not_swallowed_as_this_checkout_having_no_plans', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/one')] },
      survey: () => { throw new PlanStoryNotRead('a failure that is not the survey\'s') },
      sessions: () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path) => path,
      stderr: vi.fn(),
    })

    await expect(plans.inFlight()).rejects.toBeInstanceOf(PlanStoryNotRead)
  })

  it('a_failure_that_is_not_the_ones_this_reader_degrades_travels_out_instead_of_passing_for_nothing', async () => {
    const surveyBroke = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/one')] },
      survey: () => { throw new TypeError('git-workspace has a bug') },
      sessions: () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path) => path,
      stderr: vi.fn(),
    })
    const storyBroke = PlansOf.aWorktreeAttendedBy(
      () => SessionsOfCmux.attending('/repos/one/.worktrees/33'),
      { story: () => { throw new TypeError('gh-plan-issues has a bug') } }
    )

    await expect(surveyBroke.inFlight()).rejects.toBeInstanceOf(TypeError)
    await expect(storyBroke.inFlight()).rejects.toBeInstanceOf(TypeError)
  })
})
