import { UserStories } from '../domain/ports/user-stories.ts'
import { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'
import { Projection } from './projection.js'

export class ReferredUserStories extends UserStories {
  constructor({ jira, github }) {
    super()
    this.byKind = new Projection('user stories adapter', [
      [UserStoryKey, jira],
      [UserStoryUrl, github],
    ])
  }

  async detail(reference) {
    return this.byKind.of(reference.constructor).detail(reference)
  }
}
