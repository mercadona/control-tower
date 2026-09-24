import type { CheckoutRoot } from '../value-objects/checkout-root.ts'
import type { EpicSpec } from '../value-objects/epic-spec.ts'
import type { UserStoryKey } from '../value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../value-objects/user-story-url.ts'

export class EpicSpecs {
  async of({ root, story }: { root: CheckoutRoot, story: UserStoryKey | UserStoryUrl }): Promise<EpicSpec | null> {
    throw new Error(`${this.constructor.name} must implement of({ root, story }), asked about ${story} in ${root}`)
  }

  async rewrite({ root, spec, text }: { root: CheckoutRoot, spec: EpicSpec, text: string }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement rewrite({ root, spec, text }), asked for ${spec?.path} in ${root}`
    )
  }
}
