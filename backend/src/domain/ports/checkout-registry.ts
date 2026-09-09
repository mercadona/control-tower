import type { CheckoutRoot } from '../value-objects/checkout-root.ts'

export class CheckoutRegistry {
  remember(root: CheckoutRoot): void {
    throw new Error(`${this.constructor.name} must implement remember(root), asked to remember ${root}`)
  }

  known(): CheckoutRoot[] | null {
    throw new Error(`${this.constructor.name} must implement known()`)
  }
}
