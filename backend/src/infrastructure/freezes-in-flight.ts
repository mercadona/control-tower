import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'

export const FreezeReservation = Object.freeze({
  RESERVED: 'reserved',
  IN_PROGRESS: 'in-progress',
} as const)

export type FreezeReservationValue = (typeof FreezeReservation)[keyof typeof FreezeReservation]

export class FreezesInFlight {
  readonly #underWay: Set<string>

  constructor() {
    this.#underWay = new Set<string>()
  }

  reserve(root: CheckoutRoot): FreezeReservationValue {
    if (this.#underWay.has(root.text)) return FreezeReservation.IN_PROGRESS
    this.#underWay.add(root.text)

    return FreezeReservation.RESERVED
  }

  release(root: CheckoutRoot): void {
    this.#underWay.delete(root.text)
  }
}
