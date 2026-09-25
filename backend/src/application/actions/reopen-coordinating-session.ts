import { CoordinatingConversation } from '../../domain/value-objects/coordinating-conversation.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../domain/value-objects/session-timeline-event.ts'
import { PhasePrompt } from '../../domain/value-objects/phase-prompt.ts'
import { StoryStep, StoryStepPolicy } from '../../domain/policies/story-step.ts'
import type { StoryStepValue } from '../../domain/policies/story-step.ts'
import type { EpicSpec } from '../../domain/value-objects/epic-spec.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'
import type { Conversations } from '../../domain/ports/conversations.ts'
import type { SessionHooks } from '../../domain/ports/session-hooks.ts'
import type { ConversationRecords } from '../../domain/ports/conversation-records.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { EpicIssues } from '../../domain/ports/epic-issues.ts'
import type { UserStories } from '../../domain/ports/user-stories.ts'

export const Reopening = Object.freeze({
  RESUMED: 'resumed',
  OPENED: 'opened',
} as const)

export type ReopeningValue = (typeof Reopening)[keyof typeof Reopening]

export class ReopenCoordinatingSessionParams {
  readonly conversation: CoordinatingConversation

  constructor({ conversation }: { conversation: CoordinatingConversation }) {
    this.conversation = conversation
    Object.freeze(this)
  }
}

export class CoordinatingSessionReopened {
  readonly outcome: ReopeningValue
  readonly step: StoryStepValue | null
  readonly conversation: CoordinatingConversation
  readonly session: LiveSession
  readonly timeline: readonly SessionTimelineEvent[]

  constructor(asked: {
    outcome: ReopeningValue,
    step: StoryStepValue | null,
    conversation: CoordinatingConversation,
    session: LiveSession,
    timeline: readonly SessionTimelineEvent[],
  }) {
    this.outcome = asked.outcome
    this.step = asked.step
    this.conversation = asked.conversation
    this.session = asked.session
    this.timeline = Object.freeze([...asked.timeline])
    Object.freeze(this)
  }
}

export class ReopenCoordinatingSession {
  readonly conversations: Conversations
  readonly sessionHooks: SessionHooks
  readonly records: ConversationRecords
  readonly specs: EpicSpecs
  readonly issues: EpicIssues
  readonly userStories: UserStories
  readonly newId: () => string
  readonly now: () => string

  constructor({ conversations, sessionHooks, records, specs, issues, userStories, newId, now }: {
    conversations: Conversations,
    sessionHooks: SessionHooks,
    records: ConversationRecords,
    specs: EpicSpecs,
    issues: EpicIssues,
    userStories: UserStories,
    newId: () => string,
    now: () => string,
  }) {
    this.conversations = conversations
    this.sessionHooks = sessionHooks
    this.records = records
    this.specs = specs
    this.issues = issues
    this.userStories = userStories
    this.newId = newId
    this.now = now
  }

  async execute(params: ReopenCoordinatingSessionParams): Promise<CoordinatingSessionReopened> {
    if (this.conversations.isResumable(params.conversation)) return await this.#resumed(params.conversation)

    return await this.#opened(params.conversation)
  }

  async #resumed(conversation: CoordinatingConversation): Promise<CoordinatingSessionReopened> {
    await this.sessionHooks.install(conversation.root)
    const session = this.conversations.resume(conversation)
    const prior = await this.records.recallTimeline(conversation)
    const event = new SessionTimelineEvent({
      id: this.newId(), kind: TimelineEventKind.RESUMED, at: this.now(), detail: null,
    })
    await this.records.appendTimelineEvent({ conversation, event })

    return new CoordinatingSessionReopened({
      outcome: Reopening.RESUMED, step: null, conversation, session, timeline: [...prior, event],
    })
  }

  async #opened(conversation: CoordinatingConversation): Promise<CoordinatingSessionReopened> {
    const spec = await this.specs.of({ root: conversation.root, story: conversation.story })
    const listing = spec !== null && spec.isFrozen()
      ? await this.issues.listOf({ repository: conversation.repository, milestone: spec.title()! })
      : null
    const step = StoryStepPolicy.of({ spec, listing })
    const minted = new CoordinatingConversation({
      id: this.conversations.mint(),
      repository: conversation.repository,
      root: conversation.root,
      story: conversation.story,
    })
    const prompt = await this.#promptFor(step, spec, minted)
    const { promptPath, timeline } = await this.records.prepare({ conversation: minted, prompt })
    await this.sessionHooks.install(minted.root)
    const session = this.conversations.start({ conversation: minted, promptPath })

    return new CoordinatingSessionReopened({ outcome: Reopening.OPENED, step, conversation: minted, session, timeline })
  }

  async #promptFor(step: StoryStepValue, spec: EpicSpec | null, conversation: CoordinatingConversation): Promise<PhasePrompt> {
    switch (step) {
      case StoryStep.BRAINSTORMING: {
        const story = await this.userStories.detail(conversation.story)
        return PhasePrompt.brainstorming({ story, repository: conversation.repository, root: conversation.root })
      }
      case StoryStep.GROOM:
        return PhasePrompt.groom({
          spec: spec!, milestone: spec!.title()!, repository: conversation.repository, root: conversation.root,
        })
      case StoryStep.IMPLEMENTATION:
        throw new Error('the implementation prompt for step 4 arrives in a later task')
    }
  }
}
