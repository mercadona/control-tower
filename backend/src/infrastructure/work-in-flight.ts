export const Reservation = Object.freeze({
  RESERVED: 'reserved',
  IN_PROGRESS: 'in-progress',
} as const)

export type ReservationValue = (typeof Reservation)[keyof typeof Reservation]

export class WorkInFlight {
  readonly #underWay: Set<string>

  constructor() {
    this.#underWay = new Set<string>()
  }

  reserve(key: string): ReservationValue {
    if (this.#underWay.has(key)) return Reservation.IN_PROGRESS
    this.#underWay.add(key)

    return Reservation.RESERVED
  }

  release(key: string): void {
    this.#underWay.delete(key)
  }
}
