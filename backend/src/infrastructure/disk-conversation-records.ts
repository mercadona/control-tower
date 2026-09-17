import { join } from 'node:path'
import { ConversationRecords } from '../domain/ports/conversation-records.ts'
import {
  ConversationNotRecorded,
  ConversationNotUnderstood,
  SessionClosureNotRecorded,
  SessionClosureNotUnderstood,
} from '../domain/exceptions.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../domain/value-objects/coordinating-conversation.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../domain/value-objects/session-timeline-event.ts'
import type { PhasePrompt } from '../domain/value-objects/phase-prompt.ts'
import { ClosureStatus, SessionClosure } from '../domain/value-objects/session-closure.ts'

type ReadText = (path: string) => Promise<string | null>
type WriteText = (path: string, text: string) => Promise<void>
type JsonRecord = Record<string, unknown>

export class DiskConversationRecords extends ConversationRecords {
  static readonly DIRECTORY = 'coordinating-session'
  static readonly RECORD = 'conversation.json'
  static readonly PROMPT = 'phase-prompt.md'
  static readonly TIMELINE = 'timeline.json'
  static readonly CLOSURE = 'closure.json'
  static readonly CLOSURE_VERSION = 1

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

  #closurePath(conversation: ConversationId): string {
    return join(this.root, DiskConversationRecords.DIRECTORY, conversation.text, DiskConversationRecords.CLOSURE)
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

  static #closureFor(closure: SessionClosure): JsonRecord {
    return {
      version: DiskConversationRecords.CLOSURE_VERSION,
      conversation: closure.conversation.text,
      target: closure.target,
      session: closure.session,
      processGroup: closure.processGroup,
      status: closure.status,
    }
  }

  static #closureFrom(text: string): SessionClosure {
    const parsed: unknown = JSON.parse(text)
    if (!DiskConversationRecords.#isRecord(parsed)) {
      throw new Error(`expected a JSON object for closure evidence, got ${JSON.stringify(parsed)}`)
    }
    const expected = ['conversation', 'processGroup', 'session', 'status', 'target', 'version']
    const keys = Object.keys(parsed).sort()
    if (JSON.stringify(keys) !== JSON.stringify(expected)) {
      throw new Error(`expected closure evidence keys ${JSON.stringify(expected)}, got ${JSON.stringify(keys)}`)
    }
    if (parsed.version !== DiskConversationRecords.CLOSURE_VERSION) {
      throw new Error(`expected closure evidence version 1, got ${JSON.stringify(parsed.version)}`)
    }
    if (parsed.status !== ClosureStatus.REQUESTED && parsed.status !== ClosureStatus.CLOSED) {
      throw new Error(`expected closure status requested or closed, got ${JSON.stringify(parsed.status)}`)
    }

    return new SessionClosure({
      conversation: new ConversationId(parsed.conversation),
      target: parsed.target,
      session: parsed.session,
      processGroup: parsed.processGroup,
      status: parsed.status,
    })
  }

  static #sameEvidence(left: SessionClosure, right: SessionClosure): boolean {
    return left.conversation.text === right.conversation.text
      && left.target === right.target
      && left.session === right.session
      && left.processGroup === right.processGroup
  }

  async #writeClosure(closure: SessionClosure): Promise<void> {
    const path = this.#closurePath(closure.conversation)
    try {
      await this.write(path, `${JSON.stringify(DiskConversationRecords.#closureFor(closure), null, 2)}\n`)
    } catch (cause) {
      throw new SessionClosureNotRecorded(
        `closure evidence for conversation ${closure.conversation.text} could not be recorded: ${String(cause)}`
      )
    }
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

  async recallClosure(conversation: ConversationId): Promise<SessionClosure | null> {
    const path = this.#closurePath(conversation)
    try {
      const text = await this.read(path)
      if (text === null) return null
      const closure = DiskConversationRecords.#closureFrom(text)
      if (closure.conversation.text !== conversation.text) {
        throw new Error(
          `closure evidence at ${path} names conversation ${closure.conversation.text}, not ${conversation.text}`
        )
      }

      return closure
    } catch (cause) {
      if (cause instanceof SessionClosureNotUnderstood) throw cause
      throw new SessionClosureNotUnderstood(`the closure evidence at ${path} cannot be understood: ${String(cause)}`)
    }
  }

  async requestClosure(closure: SessionClosure): Promise<void> {
    if (closure.status !== ClosureStatus.REQUESTED) {
      throw new SessionClosureNotUnderstood(
        `requesting closure for conversation ${closure.conversation.text} requires requested evidence`
      )
    }
    const recorded = await this.recallClosure(closure.conversation)
    if (recorded !== null) {
      if (!DiskConversationRecords.#sameEvidence(recorded, closure)) {
        throw new SessionClosureNotUnderstood(
          `conversation ${closure.conversation.text} already has different closure evidence`
        )
      }
      return
    }
    await this.#writeClosure(closure)
  }

  async completeClosure(closure: SessionClosure): Promise<void> {
    if (closure.status !== ClosureStatus.CLOSED) {
      throw new SessionClosureNotUnderstood(
        `completing closure for conversation ${closure.conversation.text} requires closed evidence`
      )
    }
    const recorded = await this.recallClosure(closure.conversation)
    if (recorded === null || !DiskConversationRecords.#sameEvidence(recorded, closure)) {
      throw new SessionClosureNotUnderstood(
        `conversation ${closure.conversation.text} has no matching requested closure evidence`
      )
    }
    if (recorded.status === ClosureStatus.CLOSED) return
    await this.#writeClosure(closure)
  }
}
