import type { SliceEscalations } from '../../domain/ports/slice-escalations.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { SliceEscalation } from '../../domain/value-objects/slice-escalation.ts'

export class ReadSliceEscalationParams {
  readonly root: CheckoutRoot
  readonly issue: number

  constructor({ root, issue }: { root: CheckoutRoot, issue: number }) {
    this.root = root
    this.issue = issue
    Object.freeze(this)
  }
}

export class ReadSliceEscalationResult {
  readonly escalation: SliceEscalation

  constructor({ escalation }: { escalation: SliceEscalation }) {
    this.escalation = escalation
    Object.freeze(this)
  }
}

export class ReadSliceEscalation {
  readonly escalations: SliceEscalations

  constructor({ escalations }: { escalations: SliceEscalations }) {
    this.escalations = escalations
  }

  async execute(params: ReadSliceEscalationParams): Promise<ReadSliceEscalationResult> {
    return new ReadSliceEscalationResult({
      escalation: await this.escalations.of({ root: params.root, issue: params.issue }),
    })
  }
}
