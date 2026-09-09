import { RepositoryName } from './repository-name.ts'

export class UserStoryUrl {
  static #SHAPE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)$/
  static EXAMPLE = 'https://github.com/owner/name/issues/123'

  constructor(text) {
    const parsed = UserStoryUrl.#parsed(text)
    if (parsed === null) {
      throw new Error(`a github issue url looks like ${UserStoryUrl.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = text
    this.repository = parsed.repository
    this.number = parsed.number
    Object.freeze(this)
  }

  static isWellFormed(text) {
    return UserStoryUrl.#parsed(text) !== null
  }

  static #parsed(text) {
    if (typeof text !== 'string') return null
    const found = text.match(UserStoryUrl.#SHAPE)
    if (found === null) return null
    try {
      return { repository: new RepositoryName(found[1]), number: Number(found[2]) }
    } catch {
      return null
    }
  }

  toString() {
    return `${this.repository.text.replace(/\//g, '__')}-${this.number}`
  }
}
