export class ChangeAsked {
  constructor({ id, text, askedAt }) {
    this.id = id
    this.text = text
    this.askedAt = askedAt
    Object.freeze(this)
  }
}
