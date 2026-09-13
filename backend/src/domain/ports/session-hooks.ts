import type { CheckoutRoot } from '../value-objects/checkout-root.ts'

export class SessionHooks {
  async install(root: CheckoutRoot): Promise<void> {
    throw new Error(`${this.constructor.name} must implement install(root), asked for ${root.text}`)
  }
}
