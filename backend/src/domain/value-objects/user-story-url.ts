import { RepositoryName } from './repository-name.ts'

export class UserStoryUrl {
  static #SHAPE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)$/
  static EXAMPLE = 'https://github.com/owner/name/issues/123'

  readonly text: string
  readonly repository: RepositoryName
  readonly number: number

  constructor(text: unknown) {
    const parsed = UserStoryUrl.#parsed(text)
    if (parsed === null) {
      throw new Error(`a github issue url looks like ${UserStoryUrl.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = parsed.text
    this.repository = parsed.repository
    this.number = parsed.number
    Object.freeze(this)
  }

  static isWellFormed(text: unknown): text is string {
    return UserStoryUrl.#parsed(text) !== null
  }

  static #parsed(text: unknown): { text: string, repository: RepositoryName, number: number } | null {
    if (typeof text !== 'string') return null
    const found = text.match(UserStoryUrl.#SHAPE)
    if (found === null) return null
    try {
      return { text, repository: new RepositoryName(found[1]), number: Number(found[2]) }
    } catch {
      return null
    }
  }

  toString(): string {
    return `${this.repository.text.replace(/\//g, '__')}-${this.number}`
  }
}
