import type { EpicSpecs } from '../domain/ports/epic-specs.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { CoordinatingConversation } from '../domain/value-objects/coordinating-conversation.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

export class HeldStoryMilestone {
  readonly held: () => CoordinatingConversation | null
  readonly specs: EpicSpecs

  constructor({ held, specs }: { held: () => CoordinatingConversation | null, specs: EpicSpecs }) {
    this.held = held
    this.specs = specs
  }

  async of({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }): Promise<string | null> {
    const conversation = this.held()
    if (conversation === null) return null
    if (conversation.root.text !== root.text || conversation.repository.text !== repository.text) return null
    const spec = await this.specs.of({ root: conversation.root, story: conversation.story })

    return spec === null ? null : spec.title()
  }
}
