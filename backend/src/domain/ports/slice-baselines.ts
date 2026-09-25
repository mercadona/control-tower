import type { CheckoutRoot } from '../value-objects/checkout-root.ts'

export abstract class SliceBaselines {
  abstract isRed(asked: { root: CheckoutRoot, issue: number }): Promise<boolean>
}
