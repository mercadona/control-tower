import type { CheckoutRoot } from '../value-objects/checkout-root.ts'
import type { EpicSpec } from '../value-objects/epic-spec.ts'

export class EpicSpecs {
  async mostRecent(root: CheckoutRoot): Promise<EpicSpec | null> {
    throw new Error(`${this.constructor.name} must implement mostRecent(root), asked about ${root}`)
  }

  async rewrite({ root, spec, text }: { root: CheckoutRoot, spec: EpicSpec, text: string }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement rewrite({ root, spec, text }), asked for ${spec?.path} in ${root}`
    )
  }
}
