import { describe, expect, it, vi } from 'vitest'
import { DiskConversationRecords } from '../../src/infrastructure/disk-conversation-records.ts'
import {
  ConversationNotRecorded,
  ConversationNotUnderstood,
  SessionClosureNotRecorded,
  SessionClosureNotUnderstood,
} from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { PhasePrompt } from '../../src/domain/value-objects/phase-prompt.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'
import { ClosureStatus, SessionClosure } from '../../src/domain/value-objects/session-closure.ts'
import { SessionProcessOwnership } from '../../src/domain/value-objects/session-process-ownership.ts'

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
  PhasePrompt.RECOVERY_CAPABILITIES,
].join('\n')

const PROMPT_PATH = '/state/coordinating-session/2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f/phase-prompt.md'
const RECORD_PATH = '/state/coordinating-session/conversation.json'
const TIMELINE_PATH = '/state/coordinating-session/2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f/timeline.json'
const CLOSURE_PATH = '/state/coordinating-session/2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f/closure.json'

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

class ClosureMother {
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'

  static readonly OWNERSHIP = new SessionProcessOwnership({
    rootIdentity: '4102:Thu Sep 17 22:29:08 2026',
    members: [
      { pid: 4103, identity: '4103:Thu Sep 17 22:29:09 2026' },
      { pid: 4102, identity: '4102:Thu Sep 17 22:29:08 2026' },
    ],
  })

  static requested({ session = 'terminal-1', processGroup = 4102, ownership = null }: {
    session?: string | null, processGroup?: number | null, ownership?: SessionProcessOwnership | null,
  } = {}): SessionClosure {
    return new SessionClosure({
      conversation: CONVERSATION_ID,
      target: ClosureMother.TARGET,
      session,
      processGroup,
      status: ClosureStatus.REQUESTED,
      ownership,
    })
  }

  static payload(status: 'requested' | 'closed' = 'requested'): string {
    return `${JSON.stringify({
      version: 1,
      conversation: CONVERSATION_ID.text,
      target: ClosureMother.TARGET,
      session: 'terminal-1',
      processGroup: 4102,
      status,
    }, null, 2)}\n`
  }

  static payloadV2(status: 'requested' | 'closed' = 'requested', ownership: SessionProcessOwnership | null = null): string {
    return `${JSON.stringify({
      version: 2,
      conversation: CONVERSATION_ID.text,
      target: ClosureMother.TARGET,
      session: 'terminal-1',
      processGroup: 4102,
      status,
      ownership: ownership === null ? null : {
        rootIdentity: ownership.rootIdentity,
        members: ownership.members,
      },
    }, null, 2)}\n`
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

  it('closure records preserve compatible evidence and reject invented ownership', async () => {
    const writes: { path: string, text: string }[] = []
    const stored = new Map<string, string>()
    const write = vi.fn(async (path: string, text: string) => {
      writes.push({ path, text })
      stored.set(path, text)
    })
    const read = vi.fn(async (path: string) => stored.get(path) ?? null)
    const records = new DiskConversationRecords(Collaborators.of({ read, write }))
    const requested = ClosureMother.requested()

    await records.requestClosure(requested)
    const rootOnly = ClosureMother.requested({ ownership: new SessionProcessOwnership({
      rootIdentity: '4102:Thu Sep 17 22:29:08 2026',
      members: [{ pid: 4102, identity: '4102:Thu Sep 17 22:29:08 2026' }],
    }) })
    await records.requestClosure(rootOnly)
    const anchored = ClosureMother.requested({ ownership: ClosureMother.OWNERSHIP })
    await records.requestClosure(anchored)
    await records.completeClosure(anchored.closed())
    await expect(records.requestClosure(requested)).rejects.toBeInstanceOf(SessionClosureNotUnderstood)

    expect(writes).toEqual([
      { path: CLOSURE_PATH, text: ClosureMother.payloadV2('requested') },
      { path: CLOSURE_PATH, text: ClosureMother.payloadV2('requested', rootOnly.ownership) },
      { path: CLOSURE_PATH, text: ClosureMother.payloadV2('requested', ClosureMother.OWNERSHIP) },
      { path: CLOSURE_PATH, text: ClosureMother.payloadV2('closed', ClosureMother.OWNERSHIP) },
    ])
    expect(writes.map(({ path }) => path)).not.toContain(RECORD_PATH)
    expect(writes.map(({ path }) => path)).not.toContain(PROMPT_PATH)
    expect(writes.map(({ path }) => path)).not.toContain(TIMELINE_PATH)

    const endedWrites: { path: string, text: string }[] = []
    const ended = new DiskConversationRecords(Collaborators.of({
      write: vi.fn(async (path: string, text: string) => { endedWrites.push({ path, text }) }),
    }))
    await ended.requestClosure(ClosureMother.requested({ session: null, processGroup: null }))
    expect(endedWrites).toEqual([{
      path: CLOSURE_PATH,
      text: `${JSON.stringify({
        version: 2,
        conversation: CONVERSATION_ID.text,
        target: ClosureMother.TARGET,
        session: null,
        processGroup: null,
        status: 'requested',
        ownership: null,
      }, null, 2)}\n`,
    }])

    const v1Requested = new DiskConversationRecords(Collaborators.of({
      read: vi.fn(async (path: string) => path === CLOSURE_PATH ? ClosureMother.payload('requested') : null),
    }))
    await expect(v1Requested.recallClosure(CONVERSATION_ID)).resolves.toEqual(ClosureMother.requested())
    const v1Closed = new DiskConversationRecords(Collaborators.of({
      read: vi.fn(async (path: string) => path === CLOSURE_PATH ? ClosureMother.payload('closed') : null),
    }))
    await expect(v1Closed.recallClosure(CONVERSATION_ID)).resolves.toEqual(ClosureMother.requested().closed())

    const v2Anchored = new DiskConversationRecords(Collaborators.of({
      read: vi.fn(async (path: string) => path === CLOSURE_PATH
        ? ClosureMother.payloadV2('requested', ClosureMother.OWNERSHIP)
        : null),
    }))
    await expect(v2Anchored.recallClosure(CONVERSATION_ID)).resolves.toEqual(anchored)

    const conflictWrite = vi.fn(async () => {})
    const requestedCheckpoint = ClosureMother.payloadV2('requested', ClosureMother.OWNERSHIP)
    const conflicting = new DiskConversationRecords(Collaborators.of({
      read: vi.fn(async (path: string) => path === CLOSURE_PATH ? requestedCheckpoint : null),
      write: conflictWrite,
    }))
    await expect(conflicting.requestClosure(anchored)).resolves.toBeUndefined()
    expect(conflictWrite).not.toHaveBeenCalled()
    const rootOnlyConflict = ClosureMother.requested({ ownership: rootOnly.ownership })
    const changedRoot = ClosureMother.requested({ ownership: new SessionProcessOwnership({
      rootIdentity: '4102:Thu Sep 17 22:29:10 2026',
      members: [
        { pid: 4102, identity: '4102:Thu Sep 17 22:29:10 2026' },
        ClosureMother.OWNERSHIP.members[1],
      ],
    }) })
    const changedMember = ClosureMother.requested({ ownership: new SessionProcessOwnership({
      rootIdentity: ClosureMother.OWNERSHIP.rootIdentity,
      members: [
        ClosureMother.OWNERSHIP.members[0],
        { pid: 4103, identity: '4103:Thu Sep 17 22:29:10 2026' },
      ],
    }) })
    const changedTarget = new SessionClosure({
      conversation: CONVERSATION_ID,
      target: 'f910a470-13f7-4956-b750-bef89f55dd6d',
      session: 'terminal-1',
      processGroup: 4102,
      status: ClosureStatus.REQUESTED,
      ownership: ClosureMother.OWNERSHIP,
    })
    const changedSession = ClosureMother.requested({ session: 'terminal-2', ownership: ClosureMother.OWNERSHIP })
    const changedGroup = ClosureMother.requested({
      session: 'terminal-1',
      processGroup: 4103,
      ownership: new SessionProcessOwnership({
        rootIdentity: '4103:Thu Sep 17 22:29:08 2026',
        members: [{ pid: 4103, identity: '4103:Thu Sep 17 22:29:08 2026' }],
      }),
    })
    for (const candidate of [rootOnlyConflict, changedRoot, changedMember, changedTarget, changedSession, changedGroup]) {
      await expect(conflicting.requestClosure(candidate)).rejects.toBeInstanceOf(SessionClosureNotUnderstood)
    }
    await expect(conflicting.completeClosure(rootOnlyConflict.closed()))
      .rejects.toBeInstanceOf(SessionClosureNotUnderstood)
    expect(conflictWrite).not.toHaveBeenCalled()
  })

  it('rejects corrupt closure evidence instead of treating it as recoverable', async () => {
    const valid = JSON.parse(ClosureMother.payload()) as Record<string, unknown>
    const validV2 = JSON.parse(ClosureMother.payloadV2('requested', ClosureMother.OWNERSHIP)) as Record<string, unknown>
    const corrupt: unknown[] = [
      '{not json',
      null,
      [],
      { ...valid, extra: true },
      Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'target')),
      { ...valid, version: 2 },
      { ...valid, status: 'ended' },
      { ...valid, conversation: 'not-a-uuid' },
      { ...valid, target: 'not-a-uuid' },
      { ...valid, session: 42 },
      { ...valid, processGroup: 0 },
      { ...valid, processGroup: 1.5 },
      { ...valid, processGroup: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, processGroup: null },
      { ...valid, session: null },
      { ...validV2, version: 3 },
      { ...validV2, ownership: {} },
      { ...validV2, ownership: { rootIdentity: ClosureMother.OWNERSHIP.rootIdentity, members: [] } },
      {
        ...validV2,
        ownership: {
          rootIdentity: ClosureMother.OWNERSHIP.rootIdentity,
          members: [ClosureMother.OWNERSHIP.members[0], ClosureMother.OWNERSHIP.members[0]],
        },
      },
      {
        ...validV2,
        ownership: {
          rootIdentity: '4104:Thu Sep 17 22:29:08 2026',
          members: ClosureMother.OWNERSHIP.members,
        },
      },
      {
        version: 2,
        conversation: CONVERSATION_ID.text,
        target: ClosureMother.TARGET,
        session: 'terminal-1',
        processGroup: 4102,
        status: 'requested',
        ownership: {
          rootIdentity: '04102:Thu Sep 17 22:29:08 2026',
          members: [{ pid: 4102, identity: '04102:Thu Sep 17 22:29:08 2026' }],
        },
      },
    ]

    for (const raw of corrupt) {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      const records = new DiskConversationRecords(Collaborators.of({
        read: vi.fn(async (path: string) => path === CLOSURE_PATH ? text : null),
      }))
      await expect(records.recallClosure(CONVERSATION_ID)).rejects.toBeInstanceOf(SessionClosureNotUnderstood)
    }

    const absent = new DiskConversationRecords(Collaborators.of())
    await expect(absent.recallClosure(CONVERSATION_ID)).resolves.toBeNull()

    const unreadable = new DiskConversationRecords(Collaborators.of({
      read: vi.fn(async () => { throw new Error('permission denied') }),
    }))
    await expect(unreadable.recallClosure(CONVERSATION_ID)).rejects.toBeInstanceOf(SessionClosureNotUnderstood)

    const unwritable = new DiskConversationRecords(Collaborators.of({
      write: vi.fn(async () => { throw new Error('disk full') }),
    }))
    await expect(unwritable.requestClosure(ClosureMother.requested()))
      .rejects.toBeInstanceOf(SessionClosureNotRecorded)
  })

  it('a delayed timeline append cannot remove a completed cancellation receipt', async () => {
    const stored = new Map<string, string>([
      [TIMELINE_PATH, JSON.stringify([{ id: EVENT_ID, kind: 'opened', at: AT, detail: null }], null, 2)],
    ])
    let releaseTimeline: (() => void) | null = null
    const delayedTimeline = new Promise<void>((resolve) => { releaseTimeline = resolve })
    const write = vi.fn(async (path: string, text: string) => {
      if (path === TIMELINE_PATH) await delayedTimeline
      stored.set(path, text)
    })
    const read = vi.fn(async (path: string) => stored.get(path) ?? null)
    const records = new DiskConversationRecords(Collaborators.of({ read, write }))
    const event = new SessionTimelineEvent({
      id: 'second-event', kind: TimelineEventKind.WORKING, at: '2026-09-15T10:01:00.000Z', detail: null,
    })

    const appending = records.appendTimelineEvent({ conversation: CONVERSATION, event })
    await Promise.resolve()
    await records.requestClosure(ClosureMother.requested())
    await records.completeClosure(ClosureMother.requested().closed())
    releaseTimeline!()
    await appending

    const restarted = new DiskConversationRecords(Collaborators.of({ read }))
    await expect(restarted.recallClosure(CONVERSATION_ID)).resolves.toEqual(ClosureMother.requested().closed())
  })
})
