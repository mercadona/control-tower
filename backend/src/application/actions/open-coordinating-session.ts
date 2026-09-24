import { CoordinatingConversation } from '../../domain/value-objects/coordinating-conversation.ts'
import { PhasePrompt } from '../../domain/value-objects/phase-prompt.ts'
import { RegisteredCheckout } from '../../domain/value-objects/registered-checkout.ts'
import type { CheckoutRegistry } from '../../domain/ports/checkout-registry.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { ConversationRecords } from '../../domain/ports/conversation-records.ts'
import type { Conversations } from '../../domain/ports/conversations.ts'
import type { EpicSpec } from '../../domain/value-objects/epic-spec.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'
import type { SessionHooks } from '../../domain/ports/session-hooks.ts'
import type { SessionTimelineEvent } from '../../domain/value-objects/session-timeline-event.ts'
import type { UserStories } from '../../domain/ports/user-stories.ts'
import type { UserStoryKey } from '../../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../../domain/value-objects/user-story-url.ts'
import type { Workspace } from '../../domain/ports/workspace.ts'

export class OpenCoordinatingSessionParams {
  readonly story: UserStoryKey | UserStoryUrl
  readonly root: CheckoutRoot

  constructor({ story, root }: {
    story: UserStoryKey | UserStoryUrl,
    root: CheckoutRoot,
  }) {
    this.story = story
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

export class StorySpecFrozen {
  readonly story: UserStoryKey | UserStoryUrl
  readonly spec: EpicSpec

  constructor({ story, spec }: { story: UserStoryKey | UserStoryUrl, spec: EpicSpec }) {
    this.story = story
    this.spec = spec
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
  readonly specs: EpicSpecs

  constructor({ userStories, workspace, conversations, sessionHooks, records, checkouts, specs }: {
    userStories: UserStories,
    workspace: Workspace,
    conversations: Conversations,
    sessionHooks: SessionHooks,
    records: ConversationRecords,
    checkouts: CheckoutRegistry,
    specs: EpicSpecs,
  }) {
    this.specs = specs
    this.userStories = userStories
    this.workspace = workspace
    this.conversations = conversations
    this.sessionHooks = sessionHooks
    this.records = records
    this.checkouts = checkouts
  }

  async execute(params: OpenCoordinatingSessionParams): Promise<CoordinatingSessionOpened | StorySpecFrozen> {
    const { root, repository } = await this.workspace.confirmForSession(params.root)
    const spec = await this.specs.of({ root, story: params.story })
    if (spec !== null && spec.closesItsBrainstorming()) return new StorySpecFrozen({ story: params.story, spec })
    this.checkouts.remember(new RegisteredCheckout({ repository, root }))
    const story = await this.userStories.detail(params.story)

    const conversation = new CoordinatingConversation({
      id: this.conversations.mint(),
      repository,
      root,
      story: params.story,
    })
    const prompt = PhasePrompt.brainstorming({ story, repository, root })
    const { promptPath, timeline } = await this.records.prepare({ conversation, prompt })
    await this.sessionHooks.install(root)
    const session = this.conversations.start({ conversation, promptPath })

    return new CoordinatingSessionOpened({ conversation, session, timeline })
  }
}
