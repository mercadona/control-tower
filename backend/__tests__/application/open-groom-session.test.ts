import { describe, it, expect } from 'vitest'
import {
  OpenGroomSession, OpenGroomSessionParams, GroomSessionOpening,
} from '../../src/application/actions/open-groom-session.ts'
import { Conversations } from '../../src/domain/ports/conversations.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { EpicSpecsDouble } from '../epic-specs-double.ts'
import { SessionHooks } from '../../src/domain/ports/session-hooks.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import type { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { PhasePrompt } from '../../src/domain/value-objects/phase-prompt.ts'
import { SlicingReviewContract } from '../slicing-review-contract.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'
import { CoordinatingConversationMother } from '../coordinating-conversation-mother.ts'

class ConversationsDouble extends Conversations {
  static readonly ID = new ConversationId('9c3f1b7e-4d2a-4c8b-9a3e-6f2b1a6c2e8f')
  static readonly SESSION = new LiveSession({ id: 'session-9', name: 'brainstorming' })

  started: { conversation: CoordinatingConversation, promptPath: string }[]
  steps: string[]

  constructor() {
    super()
    this.started = []
    this.steps = []
  }

  mint(): ConversationId {
    return ConversationsDouble.ID
  }

  start({ conversation, promptPath }: {
    conversation: CoordinatingConversation, promptPath: string,
  }): LiveSession {
    this.started.push({ conversation, promptPath })
    this.steps.push('start')
    return ConversationsDouble.SESSION
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
  static readonly PATH = '/repo/coordinating-session/9c3f1b7e-4d2a-4c8b-9a3e-6f2b1a6c2e8f/phase-prompt.md'
  static readonly TIMELINE = [
    new SessionTimelineEvent({
      id: 'groom-opened', kind: TimelineEventKind.OPENED, at: '2026-09-15T10:00:00.000Z', detail: null,
    }),
  ]

  prepared: { conversation: CoordinatingConversation, prompt: PhasePrompt }[]
  steps: string[]

  constructor() {
    super()
    this.prepared = []
    this.steps = []
  }

  async prepare({ conversation, prompt }: {
    conversation: CoordinatingConversation, prompt: PhasePrompt,
  }): Promise<{ promptPath: string, timeline: readonly SessionTimelineEvent[] }> {
    this.prepared.push({ conversation, prompt })
    this.steps.push('prepare')
    return { promptPath: ConversationRecordsDouble.PATH, timeline: ConversationRecordsDouble.TIMELINE }
  }
}

class Flow {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly MILESTONE = 'The groom is an interactive session'
  static readonly SPEC_PATH = 'docs/superpowers/specs/2026-09-15-the-groom-execution.md'

  specs: EpicSpecsDouble
  conversations: ConversationsDouble
  sessionHooks: SessionHooksDouble
  records: ConversationRecordsDouble
  steps: string[]

  constructor(specs: EpicSpecsDouble) {
    this.specs = specs
    this.conversations = new ConversationsDouble()
    this.sessionHooks = new SessionHooksDouble()
    this.records = new ConversationRecordsDouble()
    this.steps = []
    this.conversations.steps = this.steps
    this.sessionHooks.steps = this.steps
    this.records.steps = this.steps
  }

  static frozenSpec(): EpicSpec {
    return new EpicSpec({
      path: Flow.SPEC_PATH,
      text: [
        `# ${Flow.MILESTONE} — Execution spec`,
        '',
        '**Estado:** CONGELADA',
        '',
      ].join('\n'),
    })
  }

  static reading(spec: EpicSpec | null): Flow {
    return new Flow(new EpicSpecsDouble(spec))
  }

  async run() {
    return new OpenGroomSession(this).execute(new OpenGroomSessionParams({
      repository: Flow.REPOSITORY, root: Flow.ROOT, story: CoordinatingConversationMother.STORY,
    }))
  }
}

describe('OpenGroomSession', () => {
  it('the groom conversation is told to review the slicing of the frozen spec, that the issues are not its to create and that a re-slicing is published for it', async () => {
    const flow = Flow.reading(Flow.frozenSpec())

    await flow.run()

    const [recorded] = flow.records.prepared
    expect(recorded.prompt.text).toBe([
      `You are the coordinating session of the epic for ${Flow.REPOSITORY.text}, in the checkout ${Flow.ROOT.text}: you cut no worktree and you switch no branch.`,
      SlicingReviewContract.review({ milestone: Flow.MILESTONE, spec: Flow.SPEC_PATH }),
      SlicingReviewContract.ISSUES_ARE_NOT_YOURS,
      SlicingReviewContract.RESLICING_TRAVELS_AS_A_PULL_REQUEST,
      PhasePrompt.CHANGE_TO_A_SLICE,
      PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO,
      PhasePrompt.RECOVERY_CAPABILITIES,
    ].join('\n'))
  })

  it('groom explains recovery without granting human gates', async () => {
    const flow = Flow.reading(Flow.frozenSpec())

    await flow.run()

    const [recorded] = flow.records.prepared
    expect(recorded.prompt.text).toContain('Read GET /active-plans')
    expect(recorded.prompt.text).toContain('POST /recover-plan with exactly {repo, issue, agent} as JSON')
    expect(recorded.prompt.text).toContain('POST /cleanup-plan with the same identity')
    expect(recorded.prompt.text).toContain('gates 1 and 2 and merge remain human-owned')
  })

  it('a checkout with no execution spec opens no conversation at all', async () => {
    const flow = Flow.reading(null)

    const opened = await flow.run()

    expect(opened.outcome).toBe(GroomSessionOpening.NO_SPEC)
    expect(opened.conversation).toBeNull()
    expect(opened.session).toBeNull()
    expect(opened.timeline).toEqual([])
    expect(flow.records.prepared).toEqual([])
    expect(flow.sessionHooks.installed).toEqual([])
    expect(flow.conversations.started).toEqual([])
  })

  it('the hooks are installed and the conversation recorded before the session starts', async () => {
    const flow = Flow.reading(Flow.frozenSpec())

    await flow.run()

    expect(flow.steps).toEqual(['prepare', 'install', 'start'])
    expect(flow.sessionHooks.installed).toEqual([Flow.ROOT])
  })

  it('the session starts on the path the records answered, in the checkout it was asked about', async () => {
    const flow = Flow.reading(Flow.frozenSpec())

    const opened = await flow.run()

    expect(opened.outcome).toBe(GroomSessionOpening.OPENED)
    expect(opened.session).toBe(ConversationsDouble.SESSION)
    expect(opened.timeline).toBe(ConversationRecordsDouble.TIMELINE)
    const [started] = flow.conversations.started
    expect(started.promptPath).toBe(ConversationRecordsDouble.PATH)
    expect(started.conversation.root).toBe(Flow.ROOT)
    expect(started.conversation.repository).toBe(Flow.REPOSITORY)
    expect(started.conversation.id).toBe(ConversationsDouble.ID)
    expect(flow.specs.asked).toEqual([{ root: Flow.ROOT, story: CoordinatingConversationMother.STORY }])
  })

  it('the new conversation keeps the story of the conversation it follows', async () => {
    const flow = Flow.reading(Flow.frozenSpec())

    await flow.run()

    const [recorded] = flow.records.prepared
    expect(recorded.conversation.story).toBe(CoordinatingConversationMother.STORY)
  })
})
