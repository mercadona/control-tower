import { describe, it, expect } from 'vitest'
import {
  CoordinatingSessionOpened, CoordinatingSessionOpening, OpenCoordinatingSession, OpenCoordinatingSessionParams,
} from '../../src/application/actions/open-coordinating-session.ts'
import { EpicSpecsDouble } from '../epic-specs-double.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { Conversations } from '../../src/domain/ports/conversations.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { SessionHooks } from '../../src/domain/ports/session-hooks.ts'
import { UserStories } from '../../src/domain/ports/user-stories.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import type { RegisteredCheckout } from '../../src/domain/value-objects/registered-checkout.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import type { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { PhasePrompt } from '../../src/domain/value-objects/phase-prompt.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionTimelineEvent, TimelineEventKind } from '../../src/domain/value-objects/session-timeline-event.ts'
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
  static readonly HELD = new RepositoryName('josemerca/ct-loop-sandbox')

  confirmedRoot: CheckoutRoot
  confirmed: CheckoutRoot[]
  prepared: number
  steps: string[]

  constructor(confirmedRoot: CheckoutRoot) {
    super()
    this.confirmedRoot = confirmedRoot
    this.confirmed = []
    this.prepared = 0
    this.steps = []
  }

  async confirm(): Promise<never> {
    this.steps.push('confirm')
    throw new Error('OpenCoordinatingSession must never call workspace.confirm')
  }

  async confirmForSession(root: CheckoutRoot): Promise<{ root: CheckoutRoot, repository: RepositoryName }> {
    this.confirmed.push(root)
    this.steps.push('confirmForSession')
    return { root: this.confirmedRoot, repository: WorkspaceDouble.HELD }
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
  static readonly TIMELINE = [
    new SessionTimelineEvent({ id: 'first-event', kind: TimelineEventKind.OPENED, at: '2026-09-15T10:00:00.000Z', detail: null }),
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

class CheckoutRegistryDouble extends CheckoutRegistry {
  remembered: RegisteredCheckout[]
  steps: string[]

  constructor() {
    super()
    this.remembered = []
    this.steps = []
  }

  remember(checkout: RegisteredCheckout): void {
    this.remembered.push(checkout)
    this.steps.push('remember')
  }
}

class Flow {
  static REPOSITORY = WorkspaceDouble.HELD
  static ROOT = new CheckoutRoot('/repo')
  static CANONICAL_ROOT = new CheckoutRoot('/real/repo')
  static STORY = new UserStoryKey('MO_SHOP-42')
  static DOCUMENTS_LINE = 'Write the design document at docs/superpowers/specs/MO_SHOP-42-design.md and the execution spec at '
    + 'docs/superpowers/specs/MO_SHOP-42-execution.md, exactly those paths: when either already exists, continue it instead of starting another.'

  userStories: UserStoriesDouble
  workspace: WorkspaceDouble
  conversations: ConversationsDouble
  sessionHooks: SessionHooksDouble
  records: ConversationRecordsDouble
  checkouts: CheckoutRegistryDouble
  specs: EpicSpecsDouble
  steps: string[]

  constructor({ userStories, workspace, spec = null }: {
    userStories?: UserStoriesDouble,
    workspace?: WorkspaceDouble,
    spec?: EpicSpec | null,
  } = {}) {
    this.specs = new EpicSpecsDouble(spec, { story: Flow.STORY })
    this.userStories = userStories ?? UserStoriesDouble.reading('the summary of the story', 'as a user I want')
    this.workspace = workspace ?? new WorkspaceDouble(Flow.CANONICAL_ROOT)
    this.conversations = new ConversationsDouble()
    this.sessionHooks = new SessionHooksDouble()
    this.records = new ConversationRecordsDouble()
    this.checkouts = new CheckoutRegistryDouble()
    this.steps = []
    this.workspace.steps = this.steps
    this.conversations.steps = this.steps
    this.sessionHooks.steps = this.steps
    this.records.steps = this.steps
    this.checkouts.steps = this.steps
  }

  static specOfTheStory(state: string): EpicSpec {
    return new EpicSpec({
      path: 'docs/superpowers/specs/MO_SHOP-42-execution.md',
      text: `# The story's epic${EpicSpec.TITLE_SUFFIX}\n${EpicSpec.STATE_LINE} ${state}\n`,
    })
  }

  async run(story: UserStoryKey | UserStoryUrl = Flow.STORY) {
    return new OpenCoordinatingSession(this).execute(new OpenCoordinatingSessionParams({
      story, root: Flow.ROOT,
    }))
  }

  async opened(): Promise<CoordinatingSessionOpened> {
    const answered = await this.run()
    if (answered.outcome !== CoordinatingSessionOpening.OPENED) throw new Error(`expected an opened session, got ${answered.outcome}`)

    return answered
  }
}

describe('OpenCoordinatingSession', () => {
  it('confirms the checkout with the preconditions a session needs, not only the identity of its repository', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.steps).toContain('confirmForSession')
    expect(flow.steps).not.toContain('confirm')
  })

  it('starts the conversation in the confirmed checkout and prepares no worktree', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.conversations.started[0].conversation.root).toBe(Flow.CANONICAL_ROOT)
    expect(flow.workspace.prepared).toBe(0)
  })

  it('hydrates the phase prompt with the story summary and description', async () => {
    const flow = new Flow({
      userStories: UserStoriesDouble.reading('rename the button', 'as a user I want a dark mode'),
    })

    await flow.run(Flow.STORY)

    const [recorded] = flow.records.prepared
    expect(recorded.prompt.text).toBe([
      'Invoke the skill control-tower-loop:ct-brainstorming.',
      `You are the coordinating session of the epic for ${Flow.REPOSITORY.text}, in the checkout ${Flow.CANONICAL_ROOT.text}: you cut no worktree and you switch no branch.`,
      PhasePrompt.FREEZE_IS_NOT_YOURS,
      `The ticket ${Flow.STORY.text} says: "rename the button". as a user I want a dark mode`,
      Flow.DOCUMENTS_LINE,
      PhasePrompt.CHANGE_TO_A_SLICE,
      PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO,
      PhasePrompt.ANOTHER_ROUND_AFTER_A_FAILED_CHECK,
      PhasePrompt.RECOVERY_CAPABILITIES,
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

  it('the conversation is recorded with the story it was opened for', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.records.prepared[0].conversation.story).toBe(Flow.STORY)
  })

  it('answers the timeline the records seeded for the freshly opened conversation', async () => {
    const flow = new Flow()

    const opened = await flow.opened()

    expect(opened.timeline).toBe(ConversationRecordsDouble.TIMELINE)
  })

  it('a story whose spec is already frozen is refused before anything is asked of the tracker or started', async () => {
    const frozen = Flow.specOfTheStory(EpicSpec.FROZEN)
    const flow = new Flow({ spec: frozen })

    const answered = await flow.run()

    expect(answered).toEqual(CoordinatingSessionOpened.storySpecFrozen(frozen))
    expect(flow.steps).toEqual(['confirmForSession'])
    expect(flow.userStories.asked).toEqual([])
  })

  it('a story whose spec is still a draft opens its brainstorming again, to continue on that draft', async () => {
    const flow = new Flow({ spec: Flow.specOfTheStory(EpicSpec.DRAFT) })

    const opened = await flow.opened()

    expect(opened.conversation?.story).toBe(Flow.STORY)
    expect(flow.steps).toContain('start')
  })

  it('the spec is looked for in the checkout the workspace confirmed, under the story being opened', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.specs.asked).toEqual([{ root: Flow.CANONICAL_ROOT, story: Flow.STORY }])
  })

  it('tells the coordinating session that the freeze is the cabin button and not a line it writes', async () => {
    const flow = new Flow()

    await flow.run(Flow.STORY)

    const [recorded] = flow.records.prepared
    const lines = recorded.prompt.text.split('\n')
    const checkoutLine = `You are the coordinating session of the epic for ${Flow.REPOSITORY.text}, in the checkout ${Flow.CANONICAL_ROOT.text}: you cut no worktree and you switch no branch.`
    const ideaLine = `The ticket ${Flow.STORY.text} says: "the summary of the story". as a user I want`

    expect(lines.indexOf(PhasePrompt.FREEZE_IS_NOT_YOURS)).toBe(lines.indexOf(checkoutLine) + 1)
    expect(lines.indexOf(ideaLine)).toBe(lines.indexOf(PhasePrompt.FREEZE_IS_NOT_YOURS) + 1)
  })

  it('brainstorming explains recovery without granting human gates', async () => {
    const flow = new Flow()

    await flow.run()

    const [recorded] = flow.records.prepared
    expect(recorded.prompt.text).toContain('Read GET /active-plans')
    expect(recorded.prompt.text).toContain('POST /recover-plan with exactly {repo, issue, agent} as JSON')
    expect(recorded.prompt.text).toContain('POST /cleanup-plan with the same identity')
    expect(recorded.prompt.text).toContain('gates 1 and 2 and merge remain human-owned')
  })

  it('leaves the description out of the phase prompt when the ticket has none', async () => {
    const flow = new Flow({
      userStories: UserStoriesDouble.reading('rename the button', ''),
    })

    await flow.run()

    const [recorded] = flow.records.prepared
    expect(recorded.prompt.text).toBe([
      'Invoke the skill control-tower-loop:ct-brainstorming.',
      `You are the coordinating session of the epic for ${Flow.REPOSITORY.text}, in the checkout ${Flow.CANONICAL_ROOT.text}: you cut no worktree and you switch no branch.`,
      PhasePrompt.FREEZE_IS_NOT_YOURS,
      `The ticket ${Flow.STORY.text} says: "rename the button".`,
      Flow.DOCUMENTS_LINE,
      PhasePrompt.CHANGE_TO_A_SLICE,
      PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO,
      PhasePrompt.ANOTHER_ROUND_AFTER_A_FAILED_CHECK,
      PhasePrompt.RECOVERY_CAPABILITIES,
    ].join('\n'))
  })

  it('registers the checkout so the sweep surveys it before anything has been dispatched', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.checkouts.remembered).toHaveLength(1)
    expect(flow.checkouts.remembered[0].repository).toBe(Flow.REPOSITORY)
  })

  it('takes the repository from the checkout the workspace confirmed, since the request names only its path', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.workspace.confirmed).toEqual([Flow.ROOT])
    expect(flow.conversations.started[0].conversation.repository).toBe(WorkspaceDouble.HELD)
  })

  it('registers the root the workspace confirmed and not the one the request named', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.checkouts.remembered[0].root).toBe(Flow.CANONICAL_ROOT)
  })

  it('registers the checkout before the conversation starts, so a session that fails to start is still swept', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.steps.indexOf('remember')).toBeGreaterThanOrEqual(0)
    expect(flow.steps.indexOf('remember')).toBeLessThan(flow.steps.indexOf('start'))
  })
})
