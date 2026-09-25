export class DispatchWait {
  readonly waiting: number
  readonly token: string
  readonly holder: number | null
  readonly holderStatus: string | null

  constructor({ waiting, token, holder, holderStatus }: {
    waiting: number, token: string, holder: number | null, holderStatus: string | null,
  }) {
    this.waiting = waiting
    this.token = token
    this.holder = holder
    this.holderStatus = holderStatus
    Object.freeze(this)
  }

  describe(): string {
    const held = this.holder === null ? 'work in flight' : `#${this.holder} (${this.holderStatus ?? 'status unknown'})`

    return `#${this.waiting} shares ${this.token} with ${held}`
  }
}
