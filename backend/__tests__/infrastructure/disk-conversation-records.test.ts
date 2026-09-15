import { describe, expect, it, vi } from 'vitest'
import { DiskConversationRecords } from '../../src/infrastructure/disk-conversation-records.ts'
import { ConversationNotRecorded, ConversationNotUnderstood } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { PhasePrompt } from '../../src/domain/value-objects/phase-prompt.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'

const STATE_ROOT = '/state'
const REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
const CHECKOUT_ROOT = new CheckoutRoot('/real/repo')
const CONVERSATION_ID = new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
const CONVERSATION = new CoordinatingConversation({ id: CONVERSATION_ID, repository: REPOSITORY, root: CHECKOUT_ROOT })

const PROMPT = PhasePrompt.brainstorming({ story: null, comment: null, repository: REPOSITORY, root: CHECKOUT_ROOT })
const PROMPT_TEXT = [
  'Invoke the skill control-tower-loop:brainstorming.',
  `You are the coordinating session of the epic for ${REPOSITORY.text}, in the checkout ${CHECKOUT_ROOT.text}: you cut no worktree and you switch no branch.`,
  PhasePrompt.FREEZE_IS_NOT_YOURS,
].join('\n')

const PROMPT_PATH = '/state/coordinating-session/2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f/phase-prompt.md'
const RECORD_PATH = '/state/coordinating-session/conversation.json'
const TIMELINE_PATH = '/state/coordinating-session/2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f/timeline.json'

const EVENT_ID = 'e5b1a6c2-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
const AT = '2026-09-15T10:00:00.000Z'

class Collaborators {
  static of(over: Partial<{
    read: (path: string) => Promise<string | null>, write: (path: string, text: string) => Promise<void>,
  }> = {}) {
    return {
      read: over.read ?? vi.fn(async () => null),
      write: over.write ?? vi.fn(async () => {}),
      root: STATE_ROOT,
      newId: () => EVENT_ID,
      now: () => AT,
    }
  }
}

describe('DiskConversationRecords', () => {
  it('answers the path of the prompt it wrote for that conversation', async () => {
    const write = vi.fn(async () => {})
    const records = new DiskConversationRecords(Collaborators.of({ write }))

    const { promptPath } = await records.prepare({ conversation: CONVERSATION, prompt: PROMPT })

    expect(promptPath).toBe(PROMPT_PATH)
    expect(write).toHaveBeenCalledWith(PROMPT_PATH, PROMPT_TEXT)
  })

  it('writes the record beside it with the conversation, the repository and the root', async () => {
    const write = vi.fn(async () => {})
    const records = new DiskConversationRecords(Collaborators.of({ write }))

    await records.prepare({ conversation: CONVERSATION, prompt: PROMPT })

    expect(write).toHaveBeenCalledWith(
      RECORD_PATH,
      `${JSON.stringify({
        conversation: '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f',
        repo: 'josemerca/ct-loop-sandbox',
        root: '/real/repo',
      }, null, 2)}\n`
    )
  })

  it('seeds the timeline with a single opened event and answers it', async () => {
    const write = vi.fn(async () => {})
    const records = new DiskConversationRecords(Collaborators.of({ write }))

    const { timeline } = await records.prepare({ conversation: CONVERSATION, prompt: PROMPT })

    expect(timeline).toEqual([
      new SessionTimelineEvent({ id: EVENT_ID, kind: TimelineEventKind.OPENED, at: AT, detail: null }),
    ])
    expect(write).toHaveBeenCalledWith(
      TIMELINE_PATH,
      `${JSON.stringify([{ id: EVENT_ID, kind: 'opened', at: AT, detail: null }], null, 2)}\n`
    )
  })

  it('recalls the recorded conversation', async () => {
    const read = vi.fn(async () => JSON.stringify({
      conversation: '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f',
      repo: 'josemerca/ct-loop-sandbox',
      root: '/real/repo',
    }))
    const records = new DiskConversationRecords(Collaborators.of({ read }))

    const recalled = await records.recall()

    expect(recalled).toEqual(CONVERSATION)
    expect(read).toHaveBeenCalledWith(RECORD_PATH)
  })

  it('answers no conversation when nothing was ever recorded', async () => {
    const records = new DiskConversationRecords(Collaborators.of())

    expect(await records.recall()).toBeNull()
  })

  it('raises conversation-not-understood when the record cannot be read as a conversation', async () => {
    const read = vi.fn(async () => '{not json')
    const records = new DiskConversationRecords(Collaborators.of({ read }))

    await expect(records.recall()).rejects.toBeInstanceOf(ConversationNotUnderstood)
  })

  it('raises conversation-not-recorded when the prompt cannot be written', async () => {
    const write = vi.fn(async () => { throw new Error('disk is full') })
    const records = new DiskConversationRecords(Collaborators.of({ write }))

    await expect(records.prepare({ conversation: CONVERSATION, prompt: PROMPT })).rejects.toBeInstanceOf(ConversationNotRecorded)
  })

  it('answers no timeline events when nothing was ever recorded for that conversation', async () => {
    const records = new DiskConversationRecords(Collaborators.of())

    expect(await records.recallTimeline(CONVERSATION)).toEqual([])
  })

  it('recalls the timeline events it wrote, in order', async () => {
    const stored = [
      { id: EVENT_ID, kind: 'opened', at: AT, detail: null },
      { id: 'second-event', kind: 'working', at: '2026-09-15T10:01:00.000Z', detail: null },
    ]
    const read = vi.fn(async (path: string) => (path === TIMELINE_PATH ? JSON.stringify(stored) : null))
    const records = new DiskConversationRecords(Collaborators.of({ read }))

    const timeline = await records.recallTimeline(CONVERSATION)

    expect(timeline).toEqual([
      new SessionTimelineEvent({ id: EVENT_ID, kind: TimelineEventKind.OPENED, at: AT, detail: null }),
      new SessionTimelineEvent({
        id: 'second-event', kind: TimelineEventKind.WORKING, at: '2026-09-15T10:01:00.000Z', detail: null,
      }),
    ])
  })

  it('raises conversation-not-understood instead of reading a malformed timeline as an empty one', async () => {
    const read = vi.fn(async (path: string) => (path === TIMELINE_PATH ? '{not json' : null))
    const records = new DiskConversationRecords(Collaborators.of({ read }))

    await expect(records.recallTimeline(CONVERSATION)).rejects.toBeInstanceOf(ConversationNotUnderstood)
  })

  it('raises conversation-not-understood instead of coercing an event of an unknown kind', async () => {
    const stored = [{ id: EVENT_ID, kind: 'a-kind-nobody-declared', at: AT, detail: null }]
    const read = vi.fn(async (path: string) => (path === TIMELINE_PATH ? JSON.stringify(stored) : null))
    const records = new DiskConversationRecords(Collaborators.of({ read }))

    await expect(records.recallTimeline(CONVERSATION)).rejects.toBeInstanceOf(ConversationNotUnderstood)
  })

  it('raises conversation-not-understood instead of coercing a non-string detail into null', async () => {
    const stored = [{ id: EVENT_ID, kind: 'opened', at: AT, detail: 42 }]
    const read = vi.fn(async (path: string) => (path === TIMELINE_PATH ? JSON.stringify(stored) : null))
    const records = new DiskConversationRecords(Collaborators.of({ read }))

    await expect(records.recallTimeline(CONVERSATION)).rejects.toBeInstanceOf(ConversationNotUnderstood)
  })

  it('raises conversation-not-understood instead of coercing a missing timestamp', async () => {
    const stored = [{ id: EVENT_ID, kind: 'opened', detail: null }]
    const read = vi.fn(async (path: string) => (path === TIMELINE_PATH ? JSON.stringify(stored) : null))
    const records = new DiskConversationRecords(Collaborators.of({ read }))

    await expect(records.recallTimeline(CONVERSATION)).rejects.toBeInstanceOf(ConversationNotUnderstood)
  })

  it('raises conversation-not-understood instead of accepting a timestamp that is not this system\'s ISO shape', async () => {
    const stored = [{ id: EVENT_ID, kind: 'opened', at: '2026-09-15T10:00:00Z', detail: null }]
    const read = vi.fn(async (path: string) => (path === TIMELINE_PATH ? JSON.stringify(stored) : null))
    const records = new DiskConversationRecords(Collaborators.of({ read }))

    await expect(records.recallTimeline(CONVERSATION)).rejects.toBeInstanceOf(ConversationNotUnderstood)
  })

  it('raises conversation-not-understood instead of accepting a calendar-impossible timestamp', async () => {
    const stored = [{ id: EVENT_ID, kind: 'opened', at: '2026-99-99T99:99:99.999Z', detail: null }]
    const read = vi.fn(async (path: string) => (path === TIMELINE_PATH ? JSON.stringify(stored) : null))
    const records = new DiskConversationRecords(Collaborators.of({ read }))

    await expect(records.recallTimeline(CONVERSATION)).rejects.toBeInstanceOf(ConversationNotUnderstood)
  })

  it('raises conversation-not-understood instead of accepting a day that rolls over into the next month', async () => {
    const stored = [{ id: EVENT_ID, kind: 'opened', at: '2026-02-30T10:00:00.000Z', detail: null }]
    const read = vi.fn(async (path: string) => (path === TIMELINE_PATH ? JSON.stringify(stored) : null))
    const records = new DiskConversationRecords(Collaborators.of({ read }))

    await expect(records.recallTimeline(CONVERSATION)).rejects.toBeInstanceOf(ConversationNotUnderstood)
  })

  it('appends a timeline event to the ones already recorded', async () => {
    const stored = [{ id: EVENT_ID, kind: 'opened', at: AT, detail: null }]
    const read = vi.fn(async (path: string) => (path === TIMELINE_PATH ? JSON.stringify(stored) : null))
    const write = vi.fn(async () => {})
    const records = new DiskConversationRecords(Collaborators.of({ read, write }))
    const event = new SessionTimelineEvent({
      id: 'second-event', kind: TimelineEventKind.WORKING, at: '2026-09-15T10:01:00.000Z', detail: null,
    })

    await records.appendTimelineEvent({ conversation: CONVERSATION, event })

    expect(write).toHaveBeenCalledWith(
      TIMELINE_PATH,
      `${JSON.stringify([
        { id: EVENT_ID, kind: 'opened', at: AT, detail: null },
        { id: 'second-event', kind: 'working', at: '2026-09-15T10:01:00.000Z', detail: null },
      ], null, 2)}\n`
    )
  })
})
