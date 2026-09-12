import type { DiagnosticWriter } from './git-workspace.ts'
import type { HarnessAnswer } from './harness-conversations.ts'
import type { HarnessConversation } from './headless-plan-agents.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import { PlanStoryFailure, WorkspaceFailure } from '../domain/exceptions.ts'
import { PlansInFlight } from '../domain/value-objects/plans-in-flight.ts'
import type { CheckoutRegistry } from '../domain/ports/checkout-registry.ts'
import type { PreparedWorkspace } from '../domain/value-objects/prepared-workspace.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'
import type { WorkspaceSurvey } from '../domain/value-objects/workspace-survey.ts'

export type SurveyOf = (root: CheckoutRoot) => WorkspaceSurvey | Promise<WorkspaceSurvey>
export type RecoveredStory = UserStoryKey | UserStoryUrl | null
export type StoryOf = (asked: { issueNumber: number, repository: RepositoryName }) =>
  RecoveredStory | Promise<RecoveredStory>
export type ConversationsAsked = () => Promise<HarnessAnswer>
export type RealpathOf = (path: string) => string | null

export class WorktreePlans {
  static #UNDER_A_CHECKOUT = /^(.+)\/\.worktrees\/[1-9]\d*$/

  readonly checkouts: CheckoutRegistry
  readonly survey: SurveyOf
  readonly conversations: ConversationsAsked
  readonly story: StoryOf
  readonly realpathOf: RealpathOf
  readonly stderr: DiagnosticWriter

  constructor({ checkouts, survey, conversations, story, realpathOf, stderr }: {
    checkouts: CheckoutRegistry,
    survey: SurveyOf,
    conversations: ConversationsAsked,
    story: StoryOf,
    realpathOf: RealpathOf,
    stderr: DiagnosticWriter,
  }) {
    this.checkouts = checkouts
    this.survey = survey
    this.conversations = conversations
    this.story = story
    this.realpathOf = realpathOf
    this.stderr = stderr
  }

  static #urlOf({ repository, issueNumber }: { repository: RepositoryName, issueNumber: number }): string {
    return `https://github.com/${repository.text}/issues/${issueNumber}`
  }

  #agentOf(
    known: readonly HarnessConversation[], prepared: PreparedWorkspace, repository: RepositoryName
  ): string | null {
    const canonical = this.#canonical(prepared.located.path)
    let newest: HarnessConversation | null = null
    for (const conversation of known) {
      if (conversation.repository !== repository.text) continue
      const sameWorktree = conversation.worktree === prepared.located.path ||
        (canonical !== null && this.#canonical(conversation.worktree) === canonical)
      if (!sameWorktree) continue
      if (newest === null || conversation.startedAt > newest.startedAt) newest = conversation
    }

    return newest === null ? null : newest.agent
  }

  #canonical(path: string | null): string | null {
    return path === null ? null : this.realpathOf(path)
  }

  #toSurvey(known: readonly HarnessConversation[]): CheckoutRoot[] | null {
    const registered = this.checkouts.known()
    if (registered === null) return null
    const roots = new Map<string, CheckoutRoot>(registered.map((root) => [root.text, root]))
    for (const conversation of known) {
      const found = conversation.worktree.match(WorktreePlans.#UNDER_A_CHECKOUT)
      if (found === null) continue
      const named = this.#canonical(found[1]) ?? found[1]
      if (roots.has(named) || !CheckoutRoot.isWellFormed(named)) continue
      roots.set(named, new CheckoutRoot(named))
    }

    return [...roots.values()]
  }

  async inFlight(): Promise<PlansInFlight> {
    const known = await this.conversations()
    if (known.reason !== null) return this.#refuse(known.reason)
    const conversations = known.conversations ?? []
    const roots = this.#toSurvey(conversations)
    if (roots === null) return this.#refuse('the checkouts it serves could not be read')
    const watches = []
    for (const root of roots) {
      for (const watch of await this.#of(root, conversations)) watches.push(watch)
    }

    return PlansInFlight.listed(watches)
  }

  #refuse(reason: string): PlansInFlight {
    this.stderr(`plans in flight: ${reason}, so no plan in flight can be recovered\n`)

    return PlansInFlight.refused(reason)
  }

  async #of(root: CheckoutRoot, known: readonly HarnessConversation[]): Promise<PlanWatch[]> {
    const surveyed = await this.#surveyed(root)
    if (surveyed === null) return []
    const watches = []
    for (const prepared of surveyed.prepared) {
      const agent = this.#agentOf(known, prepared, surveyed.repository)
      if (agent === null) continue
      watches.push(new PlanWatch({
        story: await this.#storyOf(prepared.issueNumber, surveyed.repository),
        issue: new PlanIssue({
          number: prepared.issueNumber,
          url: WorktreePlans.#urlOf({ repository: surveyed.repository, issueNumber: prepared.issueNumber }),
        }),
        located: prepared.located,
        repository: surveyed.repository,
        agent,
      }))
    }

    return watches
  }

  async #surveyed(root: CheckoutRoot): Promise<WorkspaceSurvey | null> {
    try {
      return await this.survey(root)
    } catch (failure) {
      if (!(failure instanceof WorkspaceFailure)) throw failure
      this.stderr(
        `plans in flight: ${root.text} could not be surveyed, so its plans are not recovered: ${failure.message}\n`
      )

      return null
    }
  }

  async #storyOf(issueNumber: number, repository: RepositoryName): Promise<RecoveredStory> {
    try {
      return await this.story({ issueNumber, repository })
    } catch (failure) {
      if (!(failure instanceof PlanStoryFailure)) throw failure
      this.stderr(`plans in flight: #${issueNumber} is recovered without its user story: ${failure.message}\n`)

      return null
    }
  }
}
