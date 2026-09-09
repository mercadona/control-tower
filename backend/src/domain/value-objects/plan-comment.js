export class PlanComment {
  static EXAMPLE = 'a text saying what needs planning'

  constructor(text) {
    if (!PlanComment.isWellFormed(text)) {
      throw new Error(`a plan comment looks like ${PlanComment.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = text.trim()
    Object.freeze(this)
  }

  static isWellFormed(text) {
    return typeof text === 'string' && text.trim().length > 0
  }
}
