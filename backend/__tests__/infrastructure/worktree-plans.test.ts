import { describe, expect, it, vi } from 'vitest'
import { WorktreePlans } from '../../src/infrastructure/worktree-plans.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { PreparedWorkspace } from '../../src/domain/value-objects/prepared-workspace.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { WorkspaceSurvey } from '../../src/domain/value-objects/workspace-survey.ts'
import { PlanStoryNotRead, WorkspaceNotRead } from '../../src/domain/exceptions.ts'
import { HarnessAnswer } from '../../src/infrastructure/harness-conversations.ts'
import { HarnessConversation } from '../../src/infrastructure/headless-plan-agents.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import type { RealpathOf } from '../../src/infrastructure/worktree-plans.ts'
import type { DiagnosticWriter } from '../../src/infrastructure/git-workspace.ts'
import type { ConversationsAsked, StoryOf } from '../../src/infrastructure/worktree-plans.ts'

class KnownCheckouts extends CheckoutRegistry {
  readonly #roots: CheckoutRoot[] | null

  constructor(roots: CheckoutRoot[] | null) {
    super()
    this.#roots = roots
  }

  known(): CheckoutRoot[] | null {
    return this.#roots
  }
}

class SurveyedCheckout {
  static REPOSITORY = new RepositoryName('owner/repo')

  static of(root: string, issueNumbers: number[]): WorkspaceSurvey {
    return new WorkspaceSurvey({
      repository: SurveyedCheckout.REPOSITORY,
      prepared: issueNumbers.map((issueNumber: number) => new PreparedWorkspace({
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
  static REPOSITORY = SurveyedCheckout.REPOSITORY.text
  static REFUSAL = 'the harness root could not be listed: EACCES: permission denied'

  static async attending(worktree: string, {
    agent = 'agent-1', repository = ConversationsOf.REPOSITORY, startedAt = 1,
  }: { agent?: string, repository?: string, startedAt?: number } = {}): Promise<HarnessAnswer> {
    return ConversationsOf.listing([
      new HarnessConversation({ agent, worktree, issue: 33, repository, startedAt }),
    ])
  }

  static async listing(conversations: readonly HarnessConversation[]): Promise<HarnessAnswer> {
    return HarnessAnswer.answered(conversations)
  }

  static async none(): Promise<HarnessAnswer> {
    return ConversationsOf.listing([])
  }

  static async couldNotBeListed(): Promise<HarnessAnswer> {
    return HarnessAnswer.refused(ConversationsOf.REFUSAL)
  }
}

class PlansOf {
  static ONE_CHECKOUT = '/repos/one'

  static aCheckoutRegistryThatCannotBeRead({ stderr }: { stderr: DiagnosticWriter }): WorktreePlans {
    return PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending(`${PlansOf.ONE_CHECKOUT}/.worktrees/33`),
      { stderr, checkouts: new KnownCheckouts(null) }
    )
  }

  static aWorktreeAttendedBy(conversations: ConversationsAsked, {
    story = () => new UserStoryKey('ABC-123'), stderr = vi.fn(), realpathOf = (path: string) => path,
    checkouts = new KnownCheckouts([new CheckoutRoot(PlansOf.ONE_CHECKOUT)]),
  }: {
    story?: StoryOf, stderr?: DiagnosticWriter, realpathOf?: RealpathOf, checkouts?: CheckoutRegistry,
  } = {}): WorktreePlans {
    return new WorktreePlans({
      checkouts,
      survey: () => SurveyedCheckout.of(PlansOf.ONE_CHECKOUT, [33]),
      conversations,
      story,
      realpathOf,
      stderr,
    })
  }
}

describe('WorktreePlans', () => {
  it('the_identity_of_a_plan_in_flight_comes_from_git_and_the_session_only_names_its_agent', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/repos/one/.worktrees/33')
    )

    const [watch] = (await plans.inFlight()).watches ?? []

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
      agent: 'agent-1',
    })
  })

  it('a_worktree_with_no_live_session_is_left_out_the_same_way_it_is_left_out_today', async () => {
    expect((await PlansOf.aWorktreeAttendedBy(ConversationsOf.none).inFlight()).watches).toEqual([])
  })

  it('a_session_sitting_somewhere_else_does_not_lend_its_agent_to_this_worktree', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/repos/one/.worktrees/41')
    )

    expect((await plans.inFlight()).watches).toEqual([])
  })

  it('sessions_that_could_not_be_listed_is_not_the_same_as_no_plans_in_flight', async () => {
    expect((await PlansOf.aWorktreeAttendedBy(ConversationsOf.couldNotBeListed).inFlight()).wereListed).toBe(false)
  })

  it('when_the_harness_could_not_be_asked_its_own_words_reach_the_error_channel', async () => {
    const stderr = vi.fn()

    await PlansOf.aWorktreeAttendedBy(ConversationsOf.couldNotBeListed, { stderr }).inFlight()

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(ConversationsOf.REFUSAL))
  })

  it('the_reason_written_on_the_error_channel_is_the_same_one_the_caller_is_handed', async () => {
    const stderr = vi.fn()

    const found = await PlansOf.aWorktreeAttendedBy(ConversationsOf.couldNotBeListed, { stderr }).inFlight()

    expect(found.reason).toBe(ConversationsOf.REFUSAL)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(String(found.reason)))
  })

  it('when_the_checkout_registry_cannot_be_read_the_error_channel_says_that_is_why', async () => {
    const stderr = vi.fn()

    await PlansOf.aCheckoutRegistryThatCannotBeRead({ stderr }).inFlight()

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('the checkouts it serves could not be read'))
  })

  it('the_story_it_could_not_read_leaves_the_plan_recovered_without_one', async () => {
    const stderr = vi.fn()
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      { story: () => { throw new PlanStoryNotRead('gh: not authenticated') }, stderr }
    )

    const [watch] = (await plans.inFlight()).watches ?? []

    expect(watch.storyText()).toBeNull()
    expect(watch.issue.number).toBe(33)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('#33'))
  })

  it('a_checkout_that_cannot_be_surveyed_does_not_take_the_other_checkouts_with_it', async () => {
    const stderr = vi.fn()
    const plans = new WorktreePlans({
      checkouts: new KnownCheckouts([new CheckoutRoot('/repos/broken'), new CheckoutRoot('/repos/one')]),
      survey: (root: CheckoutRoot) => {
        if (root.text === '/repos/broken') throw new WorkspaceNotRead('git worktree list refused')

        return SurveyedCheckout.of('/repos/one', [33])
      },
      conversations: () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path: string) => path,
      stderr,
    })

    const recovered = (await plans.inFlight()).watches ?? []

    expect(recovered.map((watch) => watch.issue.number)).toEqual([33])
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/repos/broken'))
  })

  it('the_newest_launch_is_the_conversation_that_attends_a_worktree_two_of_them_name', async () => {
    const older = new HarnessConversation({
      agent: 'agent-old', worktree: '/repos/one/.worktrees/33', issue: 33,
      repository: 'owner/repo', startedAt: 1_000,
    })
    const newer = new HarnessConversation({
      agent: 'agent-new', worktree: '/repos/one/.worktrees/33', issue: 33,
      repository: 'owner/repo', startedAt: 1_001,
    })

    const oldestFirst = PlansOf.aWorktreeAttendedBy(async () => HarnessAnswer.answered([older, newer]))
    const newestFirst = PlansOf.aWorktreeAttendedBy(async () => HarnessAnswer.answered([newer, older]))

    const [fromOldestFirst] = (await oldestFirst.inFlight()).watches ?? []
    const [fromNewestFirst] = (await newestFirst.inFlight()).watches ?? []

    expect(fromOldestFirst.agent).toBe('agent-new')
    expect(fromNewestFirst.agent).toBe('agent-new')
  })

  it('a_conversation_of_another_repository_does_not_attend_a_worktree_whose_path_it_matches', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(async () => HarnessAnswer.answered([
      new HarnessConversation({
        agent: 'agent-elsewhere', worktree: '/repos/one/.worktrees/33', issue: 33,
        repository: 'someone/else', startedAt: 1,
      }),
    ]))

    expect((await plans.inFlight()).watches).toEqual([])
  })

  it('a_plan_in_flight_is_recovered_even_when_the_registry_has_never_been_written', async () => {
    const plans = new WorktreePlans({
      checkouts: new KnownCheckouts([]),
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      conversations: () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path: string) => path,
      stderr: vi.fn(),
    })

    const [watch] = (await plans.inFlight()).watches ?? []

    expect(watch.issue.number).toBe(33)
    expect(watch.located.root).toBe('/repos/one')
  })

  it('a_checkout_registry_that_could_not_be_read_is_not_the_same_as_no_checkouts', async () => {
    const plans = new WorktreePlans({
      checkouts: new KnownCheckouts(null),
      survey: () => SurveyedCheckout.of('/repos/one', [33]),
      conversations: () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path: string) => path,
      stderr: vi.fn(),
    })

    expect((await plans.inFlight()).wereListed).toBe(false)
  })

  it('a_session_sitting_in_the_same_place_through_a_symlink_still_names_its_agent', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/private/repos/one/.worktrees/33'),
      { realpathOf: (path: string) => path.replace(/^\/(private\/)?repos\/one/, '/private/repos/one') }
    )

    const [watch] = (await plans.inFlight()).watches ?? []

    expect(watch.agent).toBe('agent-1')
  })

  it('a_session_that_names_the_logical_path_while_git_names_the_physical_one_still_names_its_agent', async () => {
    const plans = PlansOf.aWorktreeAttendedBy(
      () => ConversationsOf.attending('/logical/one/.worktrees/33'),
      { realpathOf: (path: string) => path.replace(/^\/(logical|repos)\/one/, '/physical/one') }
    )

    const [watch] = (await plans.inFlight()).watches ?? []

    expect(watch.agent).toBe('agent-1')
  })

  it('the_checkout_a_session_names_is_surveyed_by_the_path_git_itself_uses', async () => {
    const surveyed: string[] = []
    const plans = new WorktreePlans({
      checkouts: new KnownCheckouts([]),
      survey: (root: CheckoutRoot) => {
        surveyed.push(root.text)

        return SurveyedCheckout.of(root.text, [])
      },
      conversations: () => ConversationsOf.attending('/logical/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path: string) => path.replace('/logical/one', '/physical/one'),
      stderr: vi.fn(),
    })

    await plans.inFlight()

    expect(surveyed).toEqual(['/physical/one'])
  })

  it('a_failure_of_another_kind_of_domain_is_not_swallowed_as_this_checkout_having_no_plans', async () => {
    const plans = new WorktreePlans({
      checkouts: new KnownCheckouts([new CheckoutRoot('/repos/one')]),
      survey: () => { throw new PlanStoryNotRead('a failure that is not the survey\'s') },
      conversations: () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path: string) => path,
      stderr: vi.fn(),
    })

    await expect(plans.inFlight()).rejects.toBeInstanceOf(PlanStoryNotRead)
  })

  it('a_failure_that_is_not_the_ones_this_reader_degrades_travels_out_instead_of_passing_for_nothing', async () => {
    const surveyBroke = new WorktreePlans({
      checkouts: new KnownCheckouts([new CheckoutRoot('/repos/one')]),
      survey: () => { throw new TypeError('git-workspace has a bug') },
      conversations: () => ConversationsOf.attending('/repos/one/.worktrees/33'),
      story: () => null,
      realpathOf: (path: string) => path,
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
