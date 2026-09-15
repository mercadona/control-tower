import { join } from 'node:path'
import { ConversationRecords } from '../domain/ports/conversation-records.ts'
import { ConversationNotRecorded, ConversationNotUnderstood } from '../domain/exceptions.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../domain/value-objects/coordinating-conversation.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../domain/value-objects/session-timeline-event.ts'
import type { PhasePrompt } from '../domain/value-objects/phase-prompt.ts'

type ReadText = (path: string) => Promise<string | null>
type WriteText = (path: string, text: string) => Promise<void>
type JsonRecord = Record<string, unknown>

export class DiskConversationRecords extends ConversationRecords {
  static readonly DIRECTORY = 'coordinating-session'
  static readonly RECORD = 'conversation.json'
  static readonly PROMPT = 'phase-prompt.md'
  static readonly TIMELINE = 'timeline.json'

  readonly read: ReadText
  readonly write: WriteText
  readonly root: string
  readonly newId: () => string
  readonly now: () => string

  constructor({ read, write, root, newId, now }: {
    read: ReadText, write: WriteText, root: string, newId: () => string, now: () => string,
  }) {
    super()
    this.read = read
    this.write = write
    this.root = root
    this.newId = newId
    this.now = now
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

  #timelinePath(conversation: CoordinatingConversation): string {
    return join(this.root, DiskConversationRecords.DIRECTORY, conversation.id.text, DiskConversationRecords.TIMELINE)
  }

  static #eventFor(event: SessionTimelineEvent): JsonRecord {
    return { id: event.id, kind: event.kind, at: event.at, detail: event.detail }
  }

  static #eventFrom(raw: unknown): SessionTimelineEvent {
    if (!DiskConversationRecords.#isRecord(raw)) {
      throw new Error(`expected a JSON object for a timeline event, got ${JSON.stringify(raw)}`)
    }
    return new SessionTimelineEvent({
      id: raw.id,
      kind: raw.kind,
      at: raw.at,
      detail: raw.detail ?? null,
    })
  }

  static #timelineFrom(text: string): readonly SessionTimelineEvent[] {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      throw new Error(`expected a JSON array of timeline events, got ${JSON.stringify(parsed)}`)
    }
    return parsed.map((raw) => DiskConversationRecords.#eventFrom(raw))
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
  }): Promise<{ promptPath: string, timeline: readonly SessionTimelineEvent[] }> {
    const promptPath = this.#promptPath(conversation)
    const opened = new SessionTimelineEvent({
      id: this.newId(), kind: TimelineEventKind.OPENED, at: this.now(), detail: null,
    })
    try {
      await this.write(promptPath, prompt.text)
      await this.write(
        this.#recordPath(),
        `${JSON.stringify(DiskConversationRecords.#recordFor(conversation), null, 2)}\n`
      )
      await this.write(
        this.#timelinePath(conversation),
        `${JSON.stringify([opened].map(DiskConversationRecords.#eventFor), null, 2)}\n`
      )
    } catch (cause) {
      throw new ConversationNotRecorded(`the conversation ${conversation.id.text} could not be recorded: ${String(cause)}`)
    }
    return { promptPath, timeline: [opened] }
  }

  async recallTimeline(conversation: CoordinatingConversation): Promise<readonly SessionTimelineEvent[]> {
    const path = this.#timelinePath(conversation)
    const text = await this.read(path)
    if (text === null) return []

    try {
      return DiskConversationRecords.#timelineFrom(text)
    } catch (cause) {
      throw new ConversationNotUnderstood(`the timeline at ${path} cannot be read as a list of events: ${String(cause)}`)
    }
  }

  async appendTimelineEvent({ conversation, event }: {
    conversation: CoordinatingConversation, event: SessionTimelineEvent,
  }): Promise<void> {
    const prior = await this.recallTimeline(conversation)
    await this.write(
      this.#timelinePath(conversation),
      `${JSON.stringify([...prior, event].map(DiskConversationRecords.#eventFor), null, 2)}\n`
    )
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
