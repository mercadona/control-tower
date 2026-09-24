import { EpicSpecs } from '../src/domain/ports/epic-specs.ts'
import { CoordinatingConversationMother } from './coordinating-conversation-mother.ts'
import type { CheckoutRoot } from '../src/domain/value-objects/checkout-root.ts'
import type { EpicSpec } from '../src/domain/value-objects/epic-spec.ts'
import type { UserStoryKey } from '../src/domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../src/domain/value-objects/user-story-url.ts'

type SpecAsked = { root: CheckoutRoot, story: UserStoryKey | UserStoryUrl }

type RewriteAsked = { root: CheckoutRoot, spec: EpicSpec, text: string }

export class EpicSpecsDouble extends EpicSpecs {
  static readonly STORY = CoordinatingConversationMother.STORY

  readonly reads: readonly (EpicSpec | null)[]
  readonly story: UserStoryKey | UserStoryUrl
  readonly asked: SpecAsked[]
  readonly rewriteAsked: RewriteAsked[]

  constructor(answer: EpicSpec | null, { then = [], story = EpicSpecsDouble.STORY }: {
    then?: readonly (EpicSpec | null)[], story?: UserStoryKey | UserStoryUrl,
  } = {}) {
    super()
    this.reads = [answer, ...then]
    this.story = story
    this.asked = []
    this.rewriteAsked = []
  }

  static withTheBranchHolding(answer: EpicSpec, held: EpicSpec): EpicSpecsDouble {
    return new EpicSpecsDouble(answer, { then: [held] })
  }

  static withTheBranchMissingIt(answer: EpicSpec): EpicSpecsDouble {
    return new EpicSpecsDouble(answer, { then: [null] })
  }

  get answer(): EpicSpec | null {
    return this.reads[0]
  }

  async of(asked: SpecAsked): Promise<EpicSpec | null> {
    if (asked.story.text !== this.story.text) {
      throw new Error(`unexpected spec read for ${asked.story.text} in ${asked.root.text}; only ${this.story.text} was written`)
    }
    this.asked.push(asked)

    return this.reads[Math.min(this.asked.length, this.reads.length) - 1]
  }

  async rewrite(asked: RewriteAsked): Promise<void> {
    this.rewriteAsked.push(asked)
  }
}
