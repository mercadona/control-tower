export class ChangeAsked {
  readonly id: string
  readonly text: string
  readonly askedAt: string | null

  constructor({ id, text, askedAt }: { id: string, text: string, askedAt: string | null }) {
    this.id = id
    this.text = text
    this.askedAt = askedAt
    Object.freeze(this)
  }
}
