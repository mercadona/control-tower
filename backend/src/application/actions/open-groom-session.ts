import { CoordinatingConversation } from '../../domain/value-objects/coordinating-conversation.ts'
import { PhasePrompt } from '../../domain/value-objects/phase-prompt.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { ConversationRecords } from '../../domain/ports/conversation-records.ts'
import type { Conversations } from '../../domain/ports/conversations.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { SessionHooks } from '../../domain/ports/session-hooks.ts'

export class OpenGroomSessionParams {
  readonly repository: RepositoryName
  readonly root: CheckoutRoot

  constructor({ repository, root }: { repository: RepositoryName, root: CheckoutRoot }) {
    this.repository = repository
    this.root = root
    Object.freeze(this)
  }
}

export const GroomSessionOpening = Object.freeze({
  OPENED: 'opened',
  NO_SPEC: 'no-spec',
} as const)

export type GroomSessionOpeningValue = (typeof GroomSessionOpening)[keyof typeof GroomSessionOpening]

export class GroomSessionOpened {
  readonly outcome: GroomSessionOpeningValue
  readonly conversation: CoordinatingConversation | null
  readonly session: LiveSession | null

  private constructor({ outcome, conversation, session }: {
    outcome: GroomSessionOpeningValue,
    conversation: CoordinatingConversation | null,
    session: LiveSession | null,
  }) {
    this.outcome = outcome
    this.conversation = conversation
    this.session = session
    Object.freeze(this)
  }

  static opened(conversation: CoordinatingConversation, session: LiveSession): GroomSessionOpened {
    return new GroomSessionOpened({ outcome: GroomSessionOpening.OPENED, conversation, session })
  }

  static noSpec(): GroomSessionOpened {
    return new GroomSessionOpened({ outcome: GroomSessionOpening.NO_SPEC, conversation: null, session: null })
  }
}

export class OpenGroomSession {
  readonly specs: EpicSpecs
  readonly conversations: Conversations
  readonly sessionHooks: SessionHooks
  readonly records: ConversationRecords

  constructor({ specs, conversations, sessionHooks, records }: {
    specs: EpicSpecs,
    conversations: Conversations,
    sessionHooks: SessionHooks,
    records: ConversationRecords,
  }) {
    this.specs = specs
    this.conversations = conversations
    this.sessionHooks = sessionHooks
    this.records = records
  }

  async execute(params: OpenGroomSessionParams): Promise<GroomSessionOpened> {
    const spec = await this.specs.mostRecent(params.root)
    if (spec === null) return GroomSessionOpened.noSpec()

    const conversation = new CoordinatingConversation({
      id: this.conversations.mint(),
      repository: params.repository,
      root: params.root,
    })
    const prompt = PhasePrompt.groom({
      spec, milestone: spec.title()!, repository: params.repository, root: params.root,
    })
    const promptPath = await this.records.prepare({ conversation, prompt })
    await this.sessionHooks.install(params.root)
    const session = this.conversations.start({ conversation, promptPath })

    return GroomSessionOpened.opened(conversation, session)
  }
}
