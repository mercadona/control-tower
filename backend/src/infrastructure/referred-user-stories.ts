import { UserStories } from '../domain/ports/user-stories.ts'
import { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'
import { Projection } from './projection.js'
import type { UserStory } from '../domain/value-objects/user-story.ts'

export class ReferredUserStories extends UserStories {
  readonly byKind: Projection

  constructor({ jira, github }: { jira: UserStories, github: UserStories }) {
    super()
    this.byKind = new Projection('user stories adapter', [
      [UserStoryKey, jira],
      [UserStoryUrl, github],
    ])
  }

  async detail(reference: UserStoryKey | UserStoryUrl): Promise<UserStory> {
    return this.byKind.of(reference.constructor).detail(reference)
  }
}
