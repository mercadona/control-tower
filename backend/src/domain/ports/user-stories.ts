import type { UserStory } from '../value-objects/user-story.ts'
import type { UserStoryKey } from '../value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../value-objects/user-story-url.ts'

export class UserStories {
  async detail(reference: UserStoryKey | UserStoryUrl): Promise<UserStory> {
    throw new Error(`${this.constructor.name} must implement detail(reference), asked for ${reference}`)
  }
}
