import type { CoordinatingConversation } from '../value-objects/coordinating-conversation.ts'
import type { PhasePrompt } from '../value-objects/phase-prompt.ts'
import type { SessionTimelineEvent } from '../value-objects/session-timeline-event.ts'

export class ConversationRecords {
  async prepare({ conversation, prompt }: {
    conversation: CoordinatingConversation, prompt: PhasePrompt,
  }): Promise<{ promptPath: string, timeline: readonly SessionTimelineEvent[] }> {
    throw new Error(
      `${this.constructor.name} must implement prepare({ conversation, prompt }), asked for ${conversation.id}`
    )
  }

  async recall(): Promise<CoordinatingConversation | null> {
    throw new Error(`${this.constructor.name} must implement recall()`)
  }

  async recallTimeline(conversation: CoordinatingConversation): Promise<readonly SessionTimelineEvent[]> {
    throw new Error(`${this.constructor.name} must implement recallTimeline(conversation), asked for ${conversation.id}`)
  }

  async appendTimelineEvent({ conversation, event }: {
    conversation: CoordinatingConversation, event: SessionTimelineEvent,
  }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement appendTimelineEvent({ conversation, event }), asked for ${conversation.id} ${event.kind}`
    )
  }
}
