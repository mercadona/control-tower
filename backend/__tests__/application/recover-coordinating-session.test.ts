import { describe, it, expect } from 'vitest'
import {
  RecoverCoordinatingSession, CoordinatingSessionRecovered, RecoveredConversation,
} from '../../src/application/actions/recover-coordinating-session.ts'
import { Conversations } from '../../src/domain/ports/conversations.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { SessionHooks } from '../../src/domain/ports/session-hooks.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'
import { ClosureStatus, SessionClosure } from '../../src/domain/value-objects/session-closure.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import { SessionTerminationUnconfirmed } from '../../src/domain/exceptions.ts'

class ConversationsDouble extends Conversations {
  resumableAnswer: boolean
  resumeAnswer: LiveSession
  resumed: CoordinatingConversation[]
  started: number
  steps: string[]

  constructor({ resumableAnswer, resumeAnswer }: { resumableAnswer: boolean, resumeAnswer: LiveSession }) {
    super()
    this.resumableAnswer = resumableAnswer
    this.resumeAnswer = resumeAnswer
    this.resumed = []
    this.started = 0
    this.steps = []
  }

  isResumable(): boolean {
    return this.resumableAnswer
  }

  resume(conversation: CoordinatingConversation): LiveSession {
    this.resumed.push(conversation)
    this.steps.push('resume')

    return this.resumeAnswer
  }

  start(): LiveSession {
    this.started += 1
    throw new Error('RecoverCoordinatingSession must never call conversations.start')
  }
}

class SessionHooksDouble extends SessionHooks {
  installed: CheckoutRoot[]
  steps: string[]

  constructor() {
    super()
    this.installed = []
    this.steps = []
  }

  async install(root: CheckoutRoot): Promise<void> {
    this.installed.push(root)
    this.steps.push('install')
  }
}

class ConversationRecordsDouble extends ConversationRecords {
  static readonly PRIOR = [
    new SessionTimelineEvent({ id: 'first-event', kind: TimelineEventKind.OPENED, at: '2026-09-15T09:00:00.000Z', detail: null }),
  ]

  answer: CoordinatingConversation | null
  appended: { conversation: CoordinatingConversation, event: SessionTimelineEvent }[]
  appendFailure: Error | null
  closure: SessionClosure | null
  recalledTimelines: number
  completedClosures: SessionClosure[]

  constructor(answer: CoordinatingConversation | null) {
    super()
    this.answer = answer
    this.appended = []
    this.appendFailure = null
    this.closure = null
    this.recalledTimelines = 0
    this.completedClosures = []
  }

  async recall(): Promise<CoordinatingConversation | null> {
    return this.answer
  }

  async recallTimeline(): Promise<readonly SessionTimelineEvent[]> {
    this.recalledTimelines += 1
    return ConversationRecordsDouble.PRIOR
  }

  async recallClosure(): Promise<SessionClosure | null> {
    return this.closure
  }

  async completeClosure(closure: SessionClosure): Promise<void> {
    this.completedClosures.push(closure)
  }

  async appendTimelineEvent({ conversation, event }: {
    conversation: CoordinatingConversation, event: SessionTimelineEvent,
  }): Promise<void> {
    if (this.appendFailure !== null) throw this.appendFailure
    this.appended.push({ conversation, event })
  }
}

class LiveSessionsDouble extends LiveSessions {
  confirmed: SessionClosure[] = []
  confirmationFailure: Error | null = null

  async confirmTermination(closure: SessionClosure): Promise<void> {
    this.confirmed.push(closure)
    if (this.confirmationFailure !== null) throw this.confirmationFailure
  }
}

class Mother {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly ID = new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
  static readonly CONVERSATION = new CoordinatingConversation({
    id: Mother.ID, repository: Mother.REPOSITORY, root: Mother.ROOT,
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'

  static closure(status: 'requested' | 'closed', processGroup: number | null = 4102): SessionClosure {
    return new SessionClosure({
      conversation: Mother.ID,
      target: Mother.TARGET,
      session: processGroup === null ? null : Mother.SESSION.id,
      processGroup,
      status,
    })
  }
}

class Flow {
  static readonly NEW_EVENT_ID = 'second-event'
  static readonly NOW = '2026-09-15T10:00:00.000Z'

  conversations: ConversationsDouble
  sessionHooks: SessionHooksDouble
  records: ConversationRecordsDouble
  liveSessions: LiveSessionsDouble
  newId: () => string
  now: () => string
  said: string[]
  stderr: (line: string) => void
  steps: string[]

  constructor({ resumable = true, recorded = Mother.CONVERSATION }: {
    resumable?: boolean, recorded?: CoordinatingConversation | null,
  } = {}) {
    this.conversations = new ConversationsDouble({ resumableAnswer: resumable, resumeAnswer: Mother.SESSION })
    this.sessionHooks = new SessionHooksDouble()
    this.records = new ConversationRecordsDouble(recorded)
    this.liveSessions = new LiveSessionsDouble()
    this.newId = () => Flow.NEW_EVENT_ID
    this.now = () => Flow.NOW
    this.said = []
    this.stderr = (line) => { this.said.push(line) }
    this.steps = []
    this.conversations.steps = this.steps
    this.sessionHooks.steps = this.steps
  }

  async run(): Promise<CoordinatingSessionRecovered> {
    return new RecoverCoordinatingSession(this).execute()
  }
}

describe('RecoverCoordinatingSession', () => {
  it('answers none when nothing was ever recorded', async () => {
    const flow = new Flow({ recorded: null })

    const recovered = await flow.run()

    expect(recovered.outcome).toBe(RecoveredConversation.NONE)
    expect(recovered.conversation).toBeNull()
    expect(recovered.session).toBeNull()
  })

  it('preserves normal recovery after an abnormal exit without a closure receipt', async () => {
    const flow = new Flow()

    const recovered = await flow.run()

    expect(recovered.outcome).toBe(RecoveredConversation.LIVE)
    expect(recovered.conversation).toBe(Mother.CONVERSATION)
    expect(recovered.session).toBe(Mother.SESSION)
    expect(flow.conversations.started).toBe(0)
    expect(flow.records.recalledTimelines).toBe(1)
  })

  it('never probes or resumes a cancelled conversation even when Claude still holds it', async () => {
    const flow = new Flow()
    flow.records.closure = Mother.closure(ClosureStatus.CLOSED)

    const recovered = await flow.run()

    expect(recovered.outcome).toBe(RecoveredConversation.NONE)
    expect(flow.liveSessions.confirmed).toEqual([])
    expect(flow.records.recalledTimelines).toBe(0)
    expect(flow.conversations.resumed).toEqual([])
    expect(flow.sessionHooks.installed).toEqual([])
  })

  it('recovers an interrupted closure as retryable without resuming or signalling a recorded pid', async () => {
    const absent = new Flow()
    absent.records.closure = Mother.closure(ClosureStatus.REQUESTED)

    const completed = await absent.run()

    expect(completed.outcome).toBe(RecoveredConversation.NONE)
    expect(absent.liveSessions.confirmed).toEqual([Mother.closure(ClosureStatus.REQUESTED)])
    expect(absent.records.completedClosures).toEqual([Mother.closure(ClosureStatus.CLOSED)])
    expect(absent.conversations.resumed).toEqual([])

    const present = new Flow()
    present.records.closure = Mother.closure(ClosureStatus.REQUESTED)
    present.liveSessions.confirmationFailure = new SessionTerminationUnconfirmed('the recorded group still exists')

    const interrupted = await present.run()

    expect(interrupted.outcome).toBe(RecoveredConversation.INTERRUPTED)
    expect(interrupted.closure).toEqual(Mother.closure(ClosureStatus.REQUESTED))
    expect(present.records.recalledTimelines).toBe(0)
    expect(present.records.completedClosures).toEqual([])
    expect(present.conversations.resumed).toEqual([])
    expect(present.sessionHooks.installed).toEqual([])
  })

  it('appends a resumed event to the timeline it recalled and answers the whole history', async () => {
    const flow = new Flow()

    const recovered = await flow.run()

    expect(recovered.timeline).toEqual([
      ...ConversationRecordsDouble.PRIOR,
      new SessionTimelineEvent({
        id: Flow.NEW_EVENT_ID, kind: TimelineEventKind.RESUMED, at: Flow.NOW, detail: null,
      }),
    ])
    expect(flow.records.appended).toEqual([{
      conversation: Mother.CONVERSATION,
      event: new SessionTimelineEvent({
        id: Flow.NEW_EVENT_ID, kind: TimelineEventKind.RESUMED, at: Flow.NOW, detail: null,
      }),
    }])
  })

  it('installs the hooks before resuming', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.steps.indexOf('install')).toBeGreaterThanOrEqual(0)
    expect(flow.steps.indexOf('install')).toBeLessThan(flow.steps.indexOf('resume'))
  })

  it('opens nothing when Claude Code no longer holds the recorded conversation', async () => {
    const flow = new Flow({ resumable: false })

    const recovered = await flow.run()

    expect(recovered.outcome).toBe(RecoveredConversation.UNRESUMABLE)
    expect(recovered.conversation).toBe(Mother.CONVERSATION)
    expect(recovered.session).toBeNull()
    expect(flow.conversations.resumed).toEqual([])
    expect(flow.conversations.started).toBe(0)
    expect(flow.sessionHooks.installed).toEqual([])
  })

  it('resumes the conversation even when the resumed event cannot be persisted', async () => {
    const flow = new Flow()
    flow.records.appendFailure = new Error('disk is full')

    const recovered = await flow.run()

    expect(recovered.outcome).toBe(RecoveredConversation.LIVE)
    expect(recovered.conversation).toBe(Mother.CONVERSATION)
    expect(recovered.session).toBe(Mother.SESSION)
    expect(recovered.timeline).toEqual([
      ...ConversationRecordsDouble.PRIOR,
      new SessionTimelineEvent({ id: Flow.NEW_EVENT_ID, kind: TimelineEventKind.RESUMED, at: Flow.NOW, detail: null }),
    ])
    expect(flow.said).toEqual([
      `coordinating session ${Mother.CONVERSATION.id.text}: timeline event not recorded: Error: disk is full\n`,
    ])
  })

  it('appends an unresumable event to the recalled timeline instead of losing it', async () => {
    const flow = new Flow({ resumable: false })

    const recovered = await flow.run()

    expect(recovered.timeline).toEqual([
      ...ConversationRecordsDouble.PRIOR,
      new SessionTimelineEvent({
        id: Flow.NEW_EVENT_ID, kind: TimelineEventKind.UNRESUMABLE, at: Flow.NOW, detail: null,
      }),
    ])
  })

  it('answers unresumable even when the unresumable event cannot be persisted', async () => {
    const flow = new Flow({ resumable: false })
    flow.records.appendFailure = new Error('disk is full')

    const recovered = await flow.run()

    expect(recovered.outcome).toBe(RecoveredConversation.UNRESUMABLE)
    expect(recovered.timeline).toEqual([
      ...ConversationRecordsDouble.PRIOR,
      new SessionTimelineEvent({
        id: Flow.NEW_EVENT_ID, kind: TimelineEventKind.UNRESUMABLE, at: Flow.NOW, detail: null,
      }),
    ])
    expect(flow.said).toEqual([
      `coordinating session ${Mother.CONVERSATION.id.text}: timeline event not recorded: Error: disk is full\n`,
    ])
  })
})
