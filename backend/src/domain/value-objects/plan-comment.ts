export class PlanComment {
  static EXAMPLE = 'a text saying what needs planning'

  readonly text: string

  constructor(text: unknown) {
    if (!PlanComment.isWellFormed(text)) {
      throw new Error(`a plan comment looks like ${PlanComment.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = text.trim()
    Object.freeze(this)
  }

  static isWellFormed(text: unknown): text is string {
    return typeof text === 'string' && text.trim().length > 0
  }
}
