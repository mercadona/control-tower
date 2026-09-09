import { isNoValueCell } from '../../../plugin/scripts/cells.js'
import { UserStories } from '../domain/ports/user-stories.js'
import { UserStory } from '../domain/value-objects/user-story.ts'
import { UserStoryNotRead, UserStoryNotUnderstood } from '../domain/exceptions.js'

export class GhUserStories extends UserStories {
  static BIN = 'gh'

  static #FIELDS = 'title,body,comments'

  constructor({ gh }) {
    super()
    this.gh = gh
  }

  static argvFor(reference) {
    return ['issue', 'view', reference.text, '--json', GhUserStories.#FIELDS]
  }

  async detail(reference) {
    const argv = GhUserStories.argvFor(reference)
    const output = await this.gh.run(argv, { safeToRepeat: true })
    if (output.failed) {
      throw new UserStoryNotRead(`${GhUserStories.BIN} issue view failed: ${output.stderr.trim()}`)
    }

    return GhUserStories.#storyFrom(output.stdout, reference)
  }

  static #storyFrom(printed, reference) {
    const answered = GhUserStories.#answeredIn(printed, reference)

    return new UserStory({
      key: reference,
      summary: GhUserStories.#summaryIn(answered, reference, printed),
      description: GhUserStories.#descriptionIn(answered),
    })
  }

  static #answeredIn(printed, reference) {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new UserStoryNotUnderstood(
        `gh answered something that is not json for ${reference.text}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new UserStoryNotUnderstood(
        `gh answered without the fields of ${reference.text}, it printed ${JSON.stringify(printed)}`
      )
    }

    return parsed
  }

  static #summaryIn(answered, reference, printed) {
    const written = typeof answered.title === 'string' ? answered.title.trim() : ''
    if (written.length === 0 || isNoValueCell(written)) {
      throw new UserStoryNotUnderstood(
        `${reference.text} carries no title to plan with, it printed ${JSON.stringify(printed)}`
      )
    }

    return written
  }

  static #descriptionIn(answered) {
    const body = typeof answered.body === 'string' ? answered.body.trim() : ''
    const comments = Array.isArray(answered.comments) ? answered.comments : []
    const blocks = [body, ...comments.map((comment) => GhUserStories.#commentBlock(comment))]

    return blocks.filter((block) => block.length > 0).join('\n\n')
  }

  static #commentBlock(comment) {
    const text = typeof comment?.body === 'string' ? comment.body.trim() : ''
    if (text.length === 0) return ''

    return `> @${comment.author.login}: ${text}`
  }
}
