import type { CoordinatingConversation } from '../value-objects/coordinating-conversation.ts'
import type { PhasePrompt } from '../value-objects/phase-prompt.ts'

export class ConversationRecords {
  async prepare({ conversation, prompt }: {
    conversation: CoordinatingConversation, prompt: PhasePrompt,
  }): Promise<string> {
    throw new Error(
      `${this.constructor.name} must implement prepare({ conversation, prompt }), asked for ${conversation.id}`
    )
  }

  async recall(): Promise<CoordinatingConversation | null> {
    throw new Error(`${this.constructor.name} must implement recall()`)
  }
}
