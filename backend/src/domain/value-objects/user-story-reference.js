import { UserStoryKey } from './user-story-key.js'
import { UserStoryUrl } from './user-story-url.js'

export class UserStoryReference {
  static EXAMPLES = [UserStoryKey.EXAMPLE, UserStoryUrl.EXAMPLE]

  static isWellFormed(text) {
    return UserStoryKey.isWellFormed(text) || UserStoryUrl.isWellFormed(text)
  }

  static of(text) {
    if (UserStoryKey.isWellFormed(text)) return new UserStoryKey(text)
    if (UserStoryUrl.isWellFormed(text)) return new UserStoryUrl(text)
    throw new Error(
      `a user story is named by ${UserStoryReference.EXAMPLES.join(' or ')}, got ${JSON.stringify(text)}`
    )
  }
}
