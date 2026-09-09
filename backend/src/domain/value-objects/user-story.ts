import type { UserStoryKey } from './user-story-key.ts'
import type { UserStoryUrl } from './user-story-url.ts'

export class UserStory {
  readonly key: UserStoryKey | UserStoryUrl
  readonly summary: string
  readonly description: string

  constructor({ key, summary, description }: { key: UserStoryKey | UserStoryUrl, summary: unknown, description: string }) {
    if (typeof summary !== 'string' || summary.length === 0) {
      throw new Error(`a user story is titled by its summary, got ${JSON.stringify(summary)}`)
    }
    this.key = key
    this.summary = summary
    this.description = description
    Object.freeze(this)
  }

  hasDescription(): boolean {
    return this.description.trim().length > 0
  }
}
