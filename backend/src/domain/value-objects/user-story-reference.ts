import { UserStoryKey } from './user-story-key.ts'
import { UserStoryUrl } from './user-story-url.ts'

export class UserStoryReference {
  static isWellFormed(text: unknown): text is string {
    return UserStoryKey.isWellFormed(text) || UserStoryUrl.isWellFormed(text)
  }

  static of(text: unknown): UserStoryKey | UserStoryUrl {
    return UserStoryKey.isWellFormed(text) ? new UserStoryKey(text) : new UserStoryUrl(text)
  }
}
