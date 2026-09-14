import { join } from 'node:path'
import { ConversationRecords } from '../domain/ports/conversation-records.ts'
import { ConversationNotRecorded, ConversationNotUnderstood } from '../domain/exceptions.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../domain/value-objects/coordinating-conversation.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { PhasePrompt } from '../domain/value-objects/phase-prompt.ts'

type ReadText = (path: string) => Promise<string | null>
type WriteText = (path: string, text: string) => Promise<void>
type JsonRecord = Record<string, unknown>

export class DiskConversationRecords extends ConversationRecords {
  static readonly DIRECTORY = 'coordinating-session'
  static readonly RECORD = 'conversation.json'
  static readonly PROMPT = 'phase-prompt.md'

  readonly read: ReadText
  readonly write: WriteText
  readonly root: string

  constructor({ read, write, root }: { read: ReadText, write: WriteText, root: string }) {
    super()
    this.read = read
    this.write = write
    this.root = root
  }

  static #isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  #recordPath(): string {
    return join(this.root, DiskConversationRecords.DIRECTORY, DiskConversationRecords.RECORD)
  }

  #promptPath(conversation: CoordinatingConversation): string {
    return join(this.root, DiskConversationRecords.DIRECTORY, conversation.id.text, DiskConversationRecords.PROMPT)
  }

  static #recordFor(conversation: CoordinatingConversation): JsonRecord {
    return {
      conversation: conversation.id.text,
      repo: conversation.repository.text,
      root: conversation.root.text,
    }
  }

  static #conversationFrom(text: string): CoordinatingConversation {
    const parsed: unknown = JSON.parse(text)
    if (!DiskConversationRecords.#isRecord(parsed)) {
      throw new Error(`expected a JSON object, got ${JSON.stringify(parsed)}`)
    }
    return new CoordinatingConversation({
      id: new ConversationId(parsed.conversation),
      repository: new RepositoryName(parsed.repo),
      root: new CheckoutRoot(parsed.root),
    })
  }

  async prepare({ conversation, prompt }: {
    conversation: CoordinatingConversation, prompt: PhasePrompt,
  }): Promise<string> {
    const promptPath = this.#promptPath(conversation)
    try {
      await this.write(promptPath, prompt.text)
      await this.write(
        this.#recordPath(),
        `${JSON.stringify(DiskConversationRecords.#recordFor(conversation), null, 2)}\n`
      )
    } catch (cause) {
      throw new ConversationNotRecorded(`the conversation ${conversation.id.text} could not be recorded: ${String(cause)}`)
    }
    return promptPath
  }

  async recall(): Promise<CoordinatingConversation | null> {
    const path = this.#recordPath()
    const text = await this.read(path)
    if (text === null) return null

    try {
      return DiskConversationRecords.#conversationFrom(text)
    } catch (cause) {
      throw new ConversationNotUnderstood(`the record at ${path} cannot be read as a conversation: ${String(cause)}`)
    }
  }
}
