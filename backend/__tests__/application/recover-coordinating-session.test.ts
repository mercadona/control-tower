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
  answer: CoordinatingConversation | null

  constructor(answer: CoordinatingConversation | null) {
    super()
    this.answer = answer
  }

  async recall(): Promise<CoordinatingConversation | null> {
    return this.answer
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
}

class Flow {
  conversations: ConversationsDouble
  sessionHooks: SessionHooksDouble
  records: ConversationRecordsDouble
  steps: string[]

  constructor({ resumable = true, recorded = Mother.CONVERSATION }: {
    resumable?: boolean, recorded?: CoordinatingConversation | null,
  } = {}) {
    this.conversations = new ConversationsDouble({ resumableAnswer: resumable, resumeAnswer: Mother.SESSION })
    this.sessionHooks = new SessionHooksDouble()
    this.records = new ConversationRecordsDouble(recorded)
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

  it('resumes the recorded conversation instead of opening a new one', async () => {
    const flow = new Flow()

    const recovered = await flow.run()

    expect(recovered.outcome).toBe(RecoveredConversation.LIVE)
    expect(recovered.conversation).toBe(Mother.CONVERSATION)
    expect(recovered.session).toBe(Mother.SESSION)
    expect(flow.conversations.started).toBe(0)
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
})
