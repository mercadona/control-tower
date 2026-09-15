import type { RegisteredCheckout } from '../value-objects/registered-checkout.ts'

export class CheckoutRegistry {
  remember(checkout: RegisteredCheckout): void {
    throw new Error(`${this.constructor.name} must implement remember(checkout), asked to remember ${checkout.root}`)
  }

  known(): RegisteredCheckout[] | null {
    throw new Error(`${this.constructor.name} must implement known()`)
  }
}
