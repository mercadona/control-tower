import { describe, expect, it } from 'vitest'
import {
  ReopenCoordinatingSession, ReopenCoordinatingSessionParams, Reopening,
} from '../../src/application/actions/reopen-coordinating-session.ts'
import { StoryStep } from '../../src/domain/policies/story-step.ts'
import { Conversations } from '../../src/domain/ports/conversations.ts'
import { SessionHooks } from '../../src/domain/ports/session-hooks.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { EpicIssues } from '../../src/domain/ports/epic-issues.ts'
import { UserStories } from '../../src/domain/ports/user-stories.ts'
import { EpicSpecsDouble } from '../epic-specs-double.ts'
import { CoordinatingConversationMother } from '../coordinating-conversation-mother.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { EpicIssue } from '../../src/domain/value-objects/epic-issue.ts'
import { EpicIssuesListing } from '../../src/domain/value-objects/epic-issues-listing.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import { UserStory } from '../../src/domain/value-objects/user-story.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'
import { PhasePrompt } from '../../src/domain/value-objects/phase-prompt.ts'

class ConversationsDouble extends Conversations {
  readonly resumableAnswer: boolean
  readonly mintAnswer: ConversationId
  readonly resumeAsked: CoordinatingConversation[] = []
  readonly startAsked: { conversation: CoordinatingConversation, promptPath: string }[] = []
  mintCount = 0

  constructor(resumableAnswer: boolean, mintAnswer: ConversationId) {
    super()
    this.resumableAnswer = resumableAnswer
    this.mintAnswer = mintAnswer
  }

  static resumable(): ConversationsDouble {
    return new ConversationsDouble(true, Mother.MINTED_ID)
  }

  static notResumable(): ConversationsDouble {
    return new ConversationsDouble(false, Mother.MINTED_ID)
  }

  override mint(): ConversationId {
    this.mintCount += 1
    return this.mintAnswer
  }

  override isResumable(): boolean {
    return this.resumableAnswer
  }

  override start({ conversation, promptPath }: { conversation: CoordinatingConversation, promptPath: string }): LiveSession {
    this.startAsked.push({ conversation, promptPath })
    return Mother.SESSION
  }

  override resume(conversation: CoordinatingConversation): LiveSession {
    this.resumeAsked.push(conversation)
    return Mother.SESSION
  }
}

class SessionHooksDouble extends SessionHooks {
  readonly installed: CheckoutRoot[] = []

  override async install(root: CheckoutRoot): Promise<void> {
    this.installed.push(root)
  }
}

class ConversationRecordsDouble extends ConversationRecords {
  readonly priorTimeline: readonly SessionTimelineEvent[]
  readonly prepared: { conversation: CoordinatingConversation, prompt: PhasePrompt }[] = []
  readonly appended: { conversation: CoordinatingConversation, event: SessionTimelineEvent }[] = []
  readonly promptPathAnswer: string

  constructor(priorTimeline: readonly SessionTimelineEvent[] = [], promptPathAnswer = '/repo/.agent/prompt.md') {
    super()
    this.priorTimeline = priorTimeline
    this.promptPathAnswer = promptPathAnswer
  }

  override async prepare(
    { conversation, prompt }: { conversation: CoordinatingConversation, prompt: PhasePrompt }
  ): Promise<{ promptPath: string, timeline: readonly SessionTimelineEvent[] }> {
    this.prepared.push({ conversation, prompt })
    return { promptPath: this.promptPathAnswer, timeline: this.priorTimeline }
  }

  override async recallTimeline(): Promise<readonly SessionTimelineEvent[]> {
    return this.priorTimeline
  }

  override async appendTimelineEvent(
    { conversation, event }: { conversation: CoordinatingConversation, event: SessionTimelineEvent }
  ): Promise<void> {
    this.appended.push({ conversation, event })
  }

  override async recall(): Promise<CoordinatingConversation | null> {
    throw new Error('reopen never recalls the held conversation')
  }

  override async recallClosure(): Promise<null> {
    throw new Error('reopen never reads a closure')
  }

  override async requestClosure(): Promise<void> {
    throw new Error('reopen never requests a closure')
  }

  override async completeClosure(): Promise<void> {
    throw new Error('reopen never completes a closure')
  }
}

class EpicIssuesDouble extends EpicIssues {
  readonly answer: EpicIssuesListing
  readonly asked: { repository: RepositoryName, milestone: string }[] = []

  constructor(answer: EpicIssuesListing) {
    super()
    this.answer = answer
  }

  override async listOf(subject: { repository: RepositoryName, milestone: string }): Promise<EpicIssuesListing> {
    this.asked.push(subject)
    return this.answer
  }

  override async promote(): Promise<void> {
    throw new Error('reopen never promotes an issue')
  }
}

class UnaskedEpicIssues extends EpicIssues {
  override async listOf(): Promise<EpicIssuesListing> {
    throw new Error('a resumed reopen, or a draft spec, must not read the milestone issues')
  }
}

class UserStoriesDouble extends UserStories {
  readonly answer: UserStory
  readonly asked: unknown[] = []

  constructor(answer: UserStory) {
    super()
    this.answer = answer
  }

  override async detail(reference: unknown): Promise<UserStory> {
    this.asked.push(reference)
    return this.answer
  }
}

class UnaskedUserStories extends UserStories {
  override async detail(): Promise<UserStory> {
    throw new Error('a resumed reopen, or a groom step, must not read the user story')
  }
}

class Mother {
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly MINTED_ID = new ConversationId('69d8d78f-1f6f-47db-98c5-3a13b1710691')
  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'implementation' })
  static readonly MILESTONE = 'Some milestone'

  static conversation(): CoordinatingConversation {
    return CoordinatingConversationMother.of({
      id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
      repository: Mother.REPOSITORY,
      root: Mother.ROOT,
    })
  }

  static draftSpec(): EpicSpec {
    return new EpicSpec({
      path: 'docs/superpowers/specs/2026-09-25-some-milestone-execution.md',
      text: [`# ${Mother.MILESTONE} — Execution spec`, '', '**Fecha de congelación:** —', '**Estado:** DRAFT', ''].join('\n'),
    })
  }

  static frozenSpec(): EpicSpec {
    return new EpicSpec({
      path: 'docs/superpowers/specs/2026-09-25-some-milestone-execution.md',
      text: [
        `# ${Mother.MILESTONE} — Execution spec`, '', '**Fecha de congelación:** 2026-09-14', '**Estado:** CONGELADA', '',
      ].join('\n'),
    })
  }

  static backlogIssue(): EpicIssue {
    return new EpicIssue({
      number: 1, url: `https://github.com/${Mother.REPOSITORY.text}/issues/1`, title: 'A backlog slice',
      status: PlanIssueStatus.BACKLOG, isOpen: true, order: 1,
    })
  }

  static readyIssue(): EpicIssue {
    return new EpicIssue({
      number: 2, url: `https://github.com/${Mother.REPOSITORY.text}/issues/2`, title: 'A ready slice',
      status: PlanIssueStatus.READY, isOpen: true, order: 2,
    })
  }

  static userStory(): UserStory {
    return new UserStory({ key: EpicSpecsDouble.STORY, summary: 'Read the milestone progress', description: '' })
  }
}

class Subject {
  conversations: Conversations
  sessionHooks = new SessionHooksDouble()
  records = new ConversationRecordsDouble()
  specs = new EpicSpecsDouble(null)
  issues: EpicIssues = new UnaskedEpicIssues()
  userStories: UserStories = new UnaskedUserStories()

  constructor(conversations: Conversations) {
    this.conversations = conversations
  }

  action(): ReopenCoordinatingSession {
    return new ReopenCoordinatingSession({
      conversations: this.conversations, sessionHooks: this.sessionHooks, records: this.records,
      specs: this.specs, issues: this.issues, userStories: this.userStories,
      newId: () => 'timeline-event-1', now: () => '2026-09-25T12:00:00.000Z',
    })
  }
}

describe('ReopenCoordinatingSession', () => {
  it('a conversation whose transcript exists resumes by its identifier', async () => {
    const conversations = ConversationsDouble.resumable()
    const subject = new Subject(conversations)
    const conversation = Mother.conversation()

    const reopened = await subject.action().execute(new ReopenCoordinatingSessionParams({ conversation }))

    expect(reopened.outcome).toBe(Reopening.RESUMED)
    expect(reopened.step).toBeNull()
    expect(conversations.resumeAsked).toEqual([conversation])
    expect(conversations.mintCount).toBe(0)
    expect(conversations.startAsked).toEqual([])
    expect(subject.sessionHooks.installed).toEqual([conversation.root])
  })

  it('the resumed reopen appends a resumed timeline event to what it recalls', async () => {
    const conversations = ConversationsDouble.resumable()
    const subject = new Subject(conversations)
    const prior = new SessionTimelineEvent({ id: 'earlier', kind: TimelineEventKind.OPENED, at: '2026-09-25T11:00:00.000Z', detail: null })
    subject.records = new ConversationRecordsDouble([prior])
    const conversation = Mother.conversation()

    const reopened = await subject.action().execute(new ReopenCoordinatingSessionParams({ conversation }))

    expect(reopened.timeline).toHaveLength(2)
    expect(reopened.timeline[0]).toBe(prior)
    expect(reopened.timeline[1].kind).toBe(TimelineEventKind.RESUMED)
    expect(subject.records.appended).toEqual([{ conversation, event: reopened.timeline[1] }])
  })

  it('a draft spec reopens as a new conversation with the brainstorming prompt', async () => {
    const subject = new Subject(ConversationsDouble.notResumable())
    subject.specs = new EpicSpecsDouble(Mother.draftSpec())
    subject.userStories = new UserStoriesDouble(Mother.userStory())
    const conversation = Mother.conversation()

    const reopened = await subject.action().execute(new ReopenCoordinatingSessionParams({ conversation }))

    expect(reopened.outcome).toBe(Reopening.OPENED)
    expect(reopened.step).toBe(StoryStep.BRAINSTORMING)
    expect(reopened.conversation.id).toEqual(Mother.MINTED_ID)
    expect(subject.records.prepared[0].conversation.id).toEqual(Mother.MINTED_ID)
    expect(subject.sessionHooks.installed).toHaveLength(1)
    expect(subject.records.prepared[0].prompt.text).toBe(
      PhasePrompt.brainstorming({ story: Mother.userStory(), repository: Mother.REPOSITORY, root: Mother.ROOT }).text
    )
  })

  it('a frozen spec whose milestone holds a backlog issue reopens with the groom prompt', async () => {
    const subject = new Subject(ConversationsDouble.notResumable())
    subject.specs = new EpicSpecsDouble(Mother.frozenSpec())
    subject.issues = new EpicIssuesDouble(
      new EpicIssuesListing({ issues: [Mother.backlogIssue()], exhausted: true, reason: null })
    )
    const conversation = Mother.conversation()

    const reopened = await subject.action().execute(new ReopenCoordinatingSessionParams({ conversation }))

    expect(reopened.outcome).toBe(Reopening.OPENED)
    expect(reopened.step).toBe(StoryStep.GROOM)
    expect(subject.records.prepared[0].prompt.text).toBe(
      PhasePrompt.groom({ spec: Mother.frozenSpec(), milestone: Mother.MILESTONE, repository: Mother.REPOSITORY, root: Mother.ROOT }).text
    )
  })

  it('one backlog issue among otherwise ready ones still needs grooming, not implementation', async () => {
    const subject = new Subject(ConversationsDouble.notResumable())
    subject.specs = new EpicSpecsDouble(Mother.frozenSpec())
    subject.issues = new EpicIssuesDouble(new EpicIssuesListing({
      issues: [Mother.backlogIssue(), Mother.readyIssue()], exhausted: true, reason: null,
    }))
    const conversation = Mother.conversation()

    const reopened = await subject.action().execute(new ReopenCoordinatingSessionParams({ conversation }))

    expect(reopened.step).toBe(StoryStep.GROOM)
  })

  it('a frozen spec with no issue yet reopens with the groom prompt', async () => {
    const subject = new Subject(ConversationsDouble.notResumable())
    subject.specs = new EpicSpecsDouble(Mother.frozenSpec())
    subject.issues = new EpicIssuesDouble(new EpicIssuesListing({ issues: [], exhausted: true, reason: null }))
    const conversation = Mother.conversation()

    const reopened = await subject.action().execute(new ReopenCoordinatingSessionParams({ conversation }))

    expect(reopened.outcome).toBe(Reopening.OPENED)
    expect(reopened.step).toBe(StoryStep.GROOM)
  })
})
