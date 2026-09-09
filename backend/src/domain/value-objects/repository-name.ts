export class RepositoryName {
  static #SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9._-]*$/
  static EXAMPLE = 'owner/name'

  readonly text: string

  constructor(text: unknown) {
    if (!RepositoryName.isWellFormed(text)) {
      throw new Error(`a repository looks like ${RepositoryName.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = text
    Object.freeze(this)
  }

  static isWellFormed(text: unknown): text is string {
    return typeof text === 'string' && RepositoryName.#SHAPE.test(text)
  }

  toString(): string {
    return this.text
  }
}
