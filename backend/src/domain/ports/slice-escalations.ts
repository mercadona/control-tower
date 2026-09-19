import type { CheckoutRoot } from '../value-objects/checkout-root.ts'
import type { SliceEscalation } from '../value-objects/slice-escalation.ts'

export abstract class SliceEscalations {
  abstract of(asked: { root: CheckoutRoot, issue: number }): Promise<SliceEscalation>
}
