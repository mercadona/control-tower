import { CoordinatingConversation } from '../../domain/value-objects/coordinating-conversation.ts'
import { PhasePrompt } from '../../domain/value-objects/phase-prompt.ts'
import { RegisteredCheckout } from '../../domain/value-objects/registered-checkout.ts'
import type { CheckoutRegistry } from '../../domain/ports/checkout-registry.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { ConversationRecords } from '../../domain/ports/conversation-records.ts'
import type { Conversations } from '../../domain/ports/conversations.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'
import type { PlanComment } from '../../domain/value-objects/plan-comment.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { SessionHooks } from '../../domain/ports/session-hooks.ts'
import type { SessionTimelineEvent } from '../../domain/value-objects/session-timeline-event.ts'
import type { UserStories } from '../../domain/ports/user-stories.ts'
import type { UserStoryKey } from '../../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../../domain/value-objects/user-story-url.ts'
import type { Workspace } from '../../domain/ports/workspace.ts'

export class OpenCoordinatingSessionParams {
  readonly story: UserStoryKey | UserStoryUrl | null
  readonly comment: PlanComment | null
  readonly repository: RepositoryName
  readonly root: CheckoutRoot

  constructor({ story, comment, repository, root }: {
    story: UserStoryKey | UserStoryUrl | null,
    comment: PlanComment | null,
    repository: RepositoryName,
    root: CheckoutRoot,
  }) {
    this.story = story
    this.comment = comment
    this.repository = repository
    this.root = root
    Object.freeze(this)
  }
}

export class CoordinatingSessionOpened {
  readonly conversation: CoordinatingConversation
  readonly session: LiveSession
  readonly timeline: readonly SessionTimelineEvent[]

  constructor({ conversation, session, timeline }: {
    conversation: CoordinatingConversation, session: LiveSession, timeline: readonly SessionTimelineEvent[],
  }) {
    this.conversation = conversation
    this.session = session
    this.timeline = timeline
    Object.freeze(this)
  }
}

export class OpenCoordinatingSession {
  readonly userStories: UserStories
  readonly workspace: Workspace
  readonly conversations: Conversations
  readonly sessionHooks: SessionHooks
  readonly records: ConversationRecords
  readonly checkouts: CheckoutRegistry

  constructor({ userStories, workspace, conversations, sessionHooks, records, checkouts }: {
    userStories: UserStories,
    workspace: Workspace,
    conversations: Conversations,
    sessionHooks: SessionHooks,
    records: ConversationRecords,
    checkouts: CheckoutRegistry,
  }) {
    this.userStories = userStories
    this.workspace = workspace
    this.conversations = conversations
    this.sessionHooks = sessionHooks
    this.records = records
    this.checkouts = checkouts
  }

  async execute(params: OpenCoordinatingSessionParams): Promise<CoordinatingSessionOpened> {
    const root = await this.workspace.confirmForSession({ root: params.root, repository: params.repository })
    this.checkouts.remember(new RegisteredCheckout({ repository: params.repository, root }))
    const story = params.story === null ? null : await this.userStories.detail(params.story)

    const conversation = new CoordinatingConversation({
      id: this.conversations.mint(),
      repository: params.repository,
      root,
    })
    const prompt = PhasePrompt.brainstorming({ story, comment: params.comment, repository: params.repository, root })
    const { promptPath, timeline } = await this.records.prepare({ conversation, prompt })
    await this.sessionHooks.install(root)
    const session = this.conversations.start({ conversation, promptPath })

    return new CoordinatingSessionOpened({ conversation, session, timeline })
  }
}
