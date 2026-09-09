import { UserStoryKey } from './user-story-key.js'
import { UserStoryUrl } from './user-story-url.js'

export class UserStoryReference {
  static isWellFormed(text) {
    return UserStoryKey.isWellFormed(text) || UserStoryUrl.isWellFormed(text)
  }

  static of(text) {
    return UserStoryKey.isWellFormed(text) ? new UserStoryKey(text) : new UserStoryUrl(text)
  }
}
