import { describe, expect, it, vi } from 'vitest'
import { WorktreePlans } from '../../src/infrastructure/worktree-plans.js'
import { HarnessConversation } from '../../src/infrastructure/headless-plan-agents.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'
import { PreparedWorkspace } from '../../src/domain/value-objects/prepared-workspace.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { WorkspaceSurvey } from '../../src/domain/value-objects/workspace-survey.js'
import { PlanStoryNotRead, WorkspaceNotRead } from '../../src/domain/exceptions.js'

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

class ConversationsOf {
  static AGENT = 'aaaaaaaa-0000-0000-0000-000000000001'

  static attending(worktree, {
    agent = ConversationsOf.AGENT, repository = SurveyedCheckout.REPOSITORY.text, startedAt = 1,
  } = {}) {
    return [new HarnessConversation({
      agent, worktree, issue: ConversationsOf.#issueOf(worktree), repository, startedAt,
    })]
  }

  static none() {
    return []
  }

  static couldNotBeListed() {
    return null
  }

  static #issueOf(worktree) {
    return Number(worktree.match(/\.worktrees\/([1-9]\d*)$/)[1])
  }
}

class PlansOf {
  static ONE_CHECKOUT = '/repos/one'

  static aWorktreeAttendedBy(conversations, {
    story = () => new UserStoryKey('ABC-123'), stderr = vi.fn(), realpathOf = (path) => path,
  } = {}) {
    return new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot(PlansOf.ONE_CHECKOUT)] },
      survey: () => SurveyedCheckout.of(PlansOf.ONE_CHECKOUT, [33]),
      conversations,
      story,
      realpathOf,
      stderr,
    })
  }
}

describe('WorktreePlans', () => {
  it('the_identity_of_a_plan_in_flight_comes_from_git_and_the_conversation_only_names_its_agent', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/repos/one/.worktrees/33')
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
      agent: ConversationsOf.AGENT,
    })
  })

  it('a_worktree_with_no_live_conversation_is_left_out_the_same_way_it_is_left_out_today', async () => {
    expect(await PlansOf.aWorktreeAttendedBy(ConversationsOf.none).inFlight()).toEqual([])
  })

  it('a_conversation_sitting_somewhere_else_does_not_lend_its_agent_to_this_worktree', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/repos/one/.worktrees/41')
    )

    expect(await plans.inFlight()).toEqual([])
  })

  it('conversations_that_could_not_be_listed_is_not_the_same_as_no_plans_in_flight', async () => {
    expect(await PlansOf.aWorktreeAttendedBy(ConversationsOf.couldNotBeListed).inFlight()).toBeNull()
  })

  it('the_newest_launch_is_the_conversation_that_attends_a_worktree_two_of_them_name', async () => {
    const worktree = '/repos/one/.worktrees/33'
    const [older] = ConversationsOf.attending(worktree, { agent: 'older-agent', startedAt: 1 })
    const [newer] = ConversationsOf.attending(worktree, { agent: 'newer-agent', startedAt: 2 })

    const [olderListedFirst] = await PlansOf.aWorktreeAttendedBy(() => [older, newer]).inFlight()
    const [newerListedFirst] = await PlansOf.aWorktreeAttendedBy(() => [newer, older]).inFlight()

    expect(olderListedFirst.agent).toBe('newer-agent')
    expect(newerListedFirst.agent).toBe('newer-agent')
  })

  it('a_conversation_of_another_repository_does_not_attend_a_worktree_whose_path_it_matches', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/repos/one/.worktrees/33', { repository: 'owner/other-repo' })
    )

    expect(await plans.inFlight()).toEqual([])
  })

  it('the_story_it_could_not_read_leaves_the_plan_recovered_without_one', async () => {
    const stderr = vi.fn()
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/repos/one/.worktrees/33'),
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
      conversations: () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path) => path,
      stderr,
    })

    const recovered = await plans.inFlight()

    expect(recovered.map((watch) => watch.issue.number)).toEqual([33])
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/repos/broken'))
  })

  it('a_plan_in_flight_is_recovered_even_when_the_registry_has_never_been_written', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => [] },
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      conversations: () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path) => path,
      stderr: vi.fn(),
    })

    const [watch] = await plans.inFlight()

    expect(watch.issue.number).toBe(33)
    expect(watch.located.root).toBe('/repos/one')
  })

  it('a_checkout_registry_that_could_not_be_read_is_not_the_same_as_no_checkouts', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => null },
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      conversations: () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path) => path,
      stderr: vi.fn(),
    })

    expect(await plans.inFlight()).toBeNull()
  })

  it('a_conversation_sitting_in_the_same_place_through_a_symlink_still_names_its_agent', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/private/repos/one/.worktrees/33'),
      { realpathOf: (path) => path.replace(/^\/(private\/)?repos\/one/, '/private/repos/one') }
    )

    const [watch] = await plans.inFlight()

    expect(watch.agent).toBe(ConversationsOf.AGENT)
  })

  it('a_conversation_that_names_the_logical_path_while_git_names_the_physical_one_still_names_its_agent', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/logical/one/.worktrees/33'),
      { realpathOf: (path) => path.replace(/^\/(logical|repos)\/one/, '/physical/one') }
    )

    const [watch] = await plans.inFlight()

    expect(watch.agent).toBe(ConversationsOf.AGENT)
  })

  it('the_checkout_a_conversation_names_is_surveyed_by_the_path_git_itself_uses', async () => {
    const surveyed = []
    const plans = new WorktreePlans({
      checkouts: { known: () => [] },
      survey: (root) => {
        surveyed.push(root.text)

        return SurveyedCheckout.of(root.text, [])
      },
      conversations: () => ConversationsOf.attending('/logical/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path) => path.replace('/logical/one', '/physical/one'),
      stderr: vi.fn(),
    })

    await plans.inFlight()

    expect(surveyed).toEqual(['/physical/one'])
  })

  it('a_failure_of_another_kind_of_domain_is_not_swallowed_as_this_checkout_having_no_plans', async () => {
    const plans = new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot('/repos/one')] },
      survey: () => { throw new PlanStoryNotRead('a failure that is not the survey\'s') },
      conversations: () => ConversationsOf.attending('/repos/one/.worktrees/33'),
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
      conversations: () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path) => path,
      stderr: vi.fn(),
    })
    const storyBroke = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      { story: () => { throw new TypeError('gh-plan-issues has a bug') } }
    )

    await expect(surveyBroke.inFlight()).rejects.toBeInstanceOf(TypeError)
    await expect(storyBroke.inFlight()).rejects.toBeInstanceOf(TypeError)
  })
})
