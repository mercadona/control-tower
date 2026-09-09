export class ChangeAsked {
  readonly id: string
  readonly text: string

  constructor({ id, text }: { id: string, text: string }) {
    this.id = id
    this.text = text
    Object.freeze(this)
  }
}
