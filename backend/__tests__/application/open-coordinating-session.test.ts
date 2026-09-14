import { describe, it, expect } from 'vitest'
import {
  OpenCoordinatingSession, OpenCoordinatingSessionParams,
} from '../../src/application/actions/open-coordinating-session.ts'
import { Conversations } from '../../src/domain/ports/conversations.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { SessionHooks } from '../../src/domain/ports/session-hooks.ts'
import { UserStories } from '../../src/domain/ports/user-stories.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import type { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { PhasePrompt } from '../../src/domain/value-objects/phase-prompt.ts'
import { PlanComment } from '../../src/domain/value-objects/plan-comment.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UserStory } from '../../src/domain/value-objects/user-story.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../../src/domain/value-objects/user-story-url.ts'

class UserStoriesDouble extends UserStories {
  answer: (key: UserStoryKey | UserStoryUrl) => UserStory
  asked: (UserStoryKey | UserStoryUrl)[]

  constructor(answer: (key: UserStoryKey | UserStoryUrl) => UserStory) {
    super()
    this.answer = answer
    this.asked = []
  }

  static reading(summary: string, description: string): UserStoriesDouble {
    return new UserStoriesDouble((key) => new UserStory({ key, summary, description }))
  }

  async detail(key: UserStoryKey | UserStoryUrl): Promise<UserStory> {
    this.asked.push(key)
    return this.answer(key)
  }
}

class WorkspaceDouble extends Workspace {
  confirmedRoot: CheckoutRoot
  confirmed: { root: CheckoutRoot, repository: RepositoryName }[]
  prepared: number
  steps: string[]

  constructor(confirmedRoot: CheckoutRoot) {
    super()
    this.confirmedRoot = confirmedRoot
    this.confirmed = []
    this.prepared = 0
    this.steps = []
  }

  async confirm({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }): Promise<CheckoutRoot> {
    this.confirmed.push({ root, repository })
    this.steps.push('confirm')
    return this.confirmedRoot
  }

  async prepare(): Promise<never> {
    this.prepared += 1
    throw new Error('OpenCoordinatingSession must never call workspace.prepare')
  }
}

class ConversationsDouble extends Conversations {
  static readonly ID = new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'claude' })

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
  static readonly PATH = '/repo/coordinating-session/2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f/phase-prompt.md'

  prepared: { conversation: CoordinatingConversation, prompt: PhasePrompt }[]
  steps: string[]

  constructor() {
    super()
    this.prepared = []
    this.steps = []
  }

  async prepare({ conversation, prompt }: {
    conversation: CoordinatingConversation, prompt: PhasePrompt,
  }): Promise<string> {
    this.prepared.push({ conversation, prompt })
    this.steps.push('prepare')
    return ConversationRecordsDouble.PATH
  }
}

class Flow {
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static ROOT = new CheckoutRoot('/repo')
  static CANONICAL_ROOT = new CheckoutRoot('/real/repo')
  static STORY = new UserStoryKey('MO_SHOP-42')
  static COMMENT = new PlanComment('use dark mode on the panel')

  userStories: UserStoriesDouble
  workspace: WorkspaceDouble
  conversations: ConversationsDouble
  sessionHooks: SessionHooksDouble
  records: ConversationRecordsDouble
  steps: string[]

  constructor({ userStories, workspace }: {
    userStories?: UserStoriesDouble,
    workspace?: WorkspaceDouble,
  } = {}) {
    this.userStories = userStories ?? UserStoriesDouble.reading('the summary of the story', 'as a user I want')
    this.workspace = workspace ?? new WorkspaceDouble(Flow.CANONICAL_ROOT)
    this.conversations = new ConversationsDouble()
    this.sessionHooks = new SessionHooksDouble()
    this.records = new ConversationRecordsDouble()
    this.steps = []
    this.workspace.steps = this.steps
    this.conversations.steps = this.steps
    this.sessionHooks.steps = this.steps
    this.records.steps = this.steps
  }

  async run(story: UserStoryKey | UserStoryUrl | null = Flow.STORY, comment: PlanComment | null = null) {
    return new OpenCoordinatingSession(this).execute(new OpenCoordinatingSessionParams({
      story, comment, repository: Flow.REPOSITORY, root: Flow.ROOT,
    }))
  }
}

describe('OpenCoordinatingSession', () => {
  it('starts the conversation in the confirmed checkout and prepares no worktree', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.conversations.started[0].conversation.root).toBe(Flow.CANONICAL_ROOT)
    expect(flow.workspace.prepared).toBe(0)
  })

  it('hydrates the phase prompt with the story summary and description and with the free text', async () => {
    const flow = new Flow({
      userStories: UserStoriesDouble.reading('rename the button', 'as a user I want a dark mode'),
    })

    await flow.run(Flow.STORY, Flow.COMMENT)

    const [recorded] = flow.records.prepared
    expect(recorded.prompt.text).toBe([
      'Invoke the skill control-tower-loop:brainstorming.',
      `You are the coordinating session of the epic for ${Flow.REPOSITORY.text}, in the checkout ${Flow.CANONICAL_ROOT.text}: you cut no worktree and you switch no branch.`,
      PhasePrompt.FREEZE_IS_NOT_YOURS,
      `The ticket ${Flow.STORY.text} says: "rename the button". as a user I want a dark mode`,
      Flow.COMMENT.text,
    ].join('\n'))
  })

  it('hydrates the phase prompt from free text alone without asking the user stories adapter', async () => {
    const flow = new Flow()

    await flow.run(null, Flow.COMMENT)

    expect(flow.userStories.asked).toEqual([])
    const [recorded] = flow.records.prepared
    expect(recorded.prompt.text).toBe([
      'Invoke the skill control-tower-loop:brainstorming.',
      `You are the coordinating session of the epic for ${Flow.REPOSITORY.text}, in the checkout ${Flow.CANONICAL_ROOT.text}: you cut no worktree and you switch no branch.`,
      PhasePrompt.FREEZE_IS_NOT_YOURS,
      Flow.COMMENT.text,
    ].join('\n'))
  })

  it('installs the hooks before the conversation starts', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.steps.indexOf('install')).toBeGreaterThanOrEqual(0)
    expect(flow.steps.indexOf('install')).toBeLessThan(flow.steps.indexOf('start'))
  })

  it('starts the conversation with the path the records answered', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.conversations.started[0].promptPath).toBe(ConversationRecordsDouble.PATH)
  })

  it('records the conversation before answering', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.steps.indexOf('prepare')).toBeGreaterThanOrEqual(0)
    expect(flow.steps.indexOf('prepare')).toBeLessThan(flow.steps.indexOf('start'))
  })

  it('tells the coordinating session that the freeze is the cabin button and not a line it writes', async () => {
    const flow = new Flow()

    await flow.run(Flow.STORY, Flow.COMMENT)

    const [recorded] = flow.records.prepared
    const lines = recorded.prompt.text.split('\n')
    const checkoutLine = `You are the coordinating session of the epic for ${Flow.REPOSITORY.text}, in the checkout ${Flow.CANONICAL_ROOT.text}: you cut no worktree and you switch no branch.`
    const ideaLine = `The ticket ${Flow.STORY.text} says: "the summary of the story". as a user I want`

    expect(lines.indexOf(PhasePrompt.FREEZE_IS_NOT_YOURS)).toBe(lines.indexOf(checkoutLine) + 1)
    expect(lines.indexOf(ideaLine)).toBe(lines.indexOf(PhasePrompt.FREEZE_IS_NOT_YOURS) + 1)
  })

  it('leaves the description out of the phase prompt when the ticket has none', async () => {
    const flow = new Flow({
      userStories: UserStoriesDouble.reading('rename the button', ''),
    })

    await flow.run()

    const [recorded] = flow.records.prepared
    expect(recorded.prompt.text).toBe([
      'Invoke the skill control-tower-loop:brainstorming.',
      `You are the coordinating session of the epic for ${Flow.REPOSITORY.text}, in the checkout ${Flow.CANONICAL_ROOT.text}: you cut no worktree and you switch no branch.`,
      PhasePrompt.FREEZE_IS_NOT_YOURS,
      `The ticket ${Flow.STORY.text} says: "rename the button".`,
    ].join('\n'))
  })
})
