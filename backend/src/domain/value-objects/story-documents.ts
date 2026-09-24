import type { UserStoryKey } from './user-story-key.ts'
import type { UserStoryUrl } from './user-story-url.ts'

export class StoryDocuments {
  static readonly DIRECTORY = 'docs/superpowers/specs'
  static readonly SPEC_SUFFIX = '-execution.md'
  static readonly DESIGN_SUFFIX = '-design.md'

  readonly spec: string
  readonly design: string

  constructor(story: UserStoryKey | UserStoryUrl) {
    this.spec = `${StoryDocuments.DIRECTORY}/${story.toString()}${StoryDocuments.SPEC_SUFFIX}`
    this.design = `${StoryDocuments.DIRECTORY}/${story.toString()}${StoryDocuments.DESIGN_SUFFIX}`
    Object.freeze(this)
  }
}
