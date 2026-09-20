export class HeldMessage {
  static readonly REQUEST_PREFIX = 'message:'

  readonly ticket: string
  readonly askedAt: string
  readonly text: string

  constructor(asked: { ticket: string, askedAt: string, text: string }) {
    this.ticket = HeldMessage.#required('ticket', asked.ticket)
    this.askedAt = HeldMessage.#required('askedAt', asked.askedAt)
    this.text = HeldMessage.#required('text', asked.text)
    Object.freeze(this)
  }

  static #required(field: 'ticket' | 'askedAt' | 'text', value: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError(`${field} must be nonempty, got ${JSON.stringify(value)}`)
    }
    return value
  }
}
