import { isNoValueCell } from '../../../plugin/scripts/cells.js'
import { UserStories } from '../domain/ports/user-stories.ts'
import { UserStory } from '../domain/value-objects/user-story.ts'
import { UserStoryNotRead, UserStoryNotUnderstood } from '../domain/exceptions.ts'
import type { Gh } from './gh.ts'
import type { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'

export class GhUserStories extends UserStories {
  static readonly BIN = 'gh'

  static readonly #FIELDS = 'title,body,comments'

  readonly gh: Gh

  constructor({ gh }: { gh: Gh }) {
    super()
    this.gh = gh
  }

  static argvFor(reference: UserStoryKey | UserStoryUrl): string[] {
    return ['issue', 'view', reference.text, '--json', GhUserStories.#FIELDS]
  }

  async detail(reference: UserStoryKey | UserStoryUrl): Promise<UserStory> {
    const argv = GhUserStories.argvFor(reference)
    const output = await this.gh.run(argv, { safeToRepeat: true })
    if (output.failed) {
      throw new UserStoryNotRead(`${GhUserStories.BIN} issue view failed: ${output.stderr.trim()}`)
    }

    return GhUserStories.#storyFrom(output.stdout, reference)
  }

  static #storyFrom(printed: string, reference: UserStoryKey | UserStoryUrl): UserStory {
    const answered = GhUserStories.#answeredIn(printed, reference)

    return new UserStory({
      key: reference,
      summary: GhUserStories.#summaryIn(answered, reference, printed),
      description: GhUserStories.#descriptionIn(answered),
    })
  }

  static #answeredIn(printed: string, reference: UserStoryKey | UserStoryUrl): Record<string, unknown> {
    let parsed: unknown
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new UserStoryNotUnderstood(
        `gh answered something that is not json for ${reference.text}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!GhUserStories.#isFields(parsed)) {
      throw new UserStoryNotUnderstood(
        `gh answered without the fields of ${reference.text}, it printed ${JSON.stringify(printed)}`
      )
    }

    return parsed
  }

  static #isFields(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  static #summaryIn(
    answered: Record<string, unknown>, reference: UserStoryKey | UserStoryUrl, printed: string
  ): string {
    const written = typeof answered.title === 'string' ? answered.title.trim() : ''
    if (written.length === 0 || isNoValueCell(written)) {
      throw new UserStoryNotUnderstood(
        `${reference.text} carries no title to plan with, it printed ${JSON.stringify(printed)}`
      )
    }

    return written
  }

  static #descriptionIn(answered: Record<string, unknown>): string {
    const body = typeof answered.body === 'string' ? answered.body.trim() : ''
    const comments: unknown[] = Array.isArray(answered.comments) ? answered.comments : []
    const blocks = [body, ...comments.map((comment) => GhUserStories.#commentBlock(comment))]

    return blocks.filter((block) => block.length > 0).join('\n\n')
  }

  static #commentBlock(comment: unknown): string {
    if (!GhUserStories.#isFields(comment)) return ''
    const text = typeof comment.body === 'string' ? comment.body.trim() : ''
    if (text.length === 0) return ''
    const author = comment.author as { login: string }

    return `> @${author.login}: ${text}`
  }
}
