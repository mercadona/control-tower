export class ConversationId {
  static #SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  static EXAMPLE = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'

  readonly text: string

  constructor(text: unknown) {
    if (!ConversationId.isWellFormed(text)) {
      throw new Error(`a conversation id looks like ${ConversationId.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = text
    Object.freeze(this)
  }

  static isWellFormed(text: unknown): text is string {
    return typeof text === 'string' && ConversationId.#SHAPE.test(text)
  }

  toString(): string {
    return this.text
  }
}
