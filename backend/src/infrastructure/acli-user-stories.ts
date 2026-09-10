import { isNoValueCell } from '../../../plugin/scripts/cells.js'
import { UserStories } from '../domain/ports/user-stories.ts'
import { UserStory } from '../domain/value-objects/user-story.ts'
import { UserStoryNotRead, UserStoryNotUnderstood } from '../domain/exceptions.ts'
import type { ExternalTool } from './external-tool.ts'
import type { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'

export class AcliUserStories extends UserStories {
  static readonly BIN = 'acli'

  static readonly #FIELDS = 'summary,description'
  static readonly #UNAUTHENTICATED = /auth|login|unauthorized|401/i
  static readonly #BREAKING_NODES = ['paragraph', 'heading', 'listItem']
  static readonly #BLANK_RUN = /\n{3,}/g

  readonly acli: ExternalTool

  constructor({ acli }: { acli: ExternalTool }) {
    super()
    this.acli = acli
  }

  static argvFor(key: UserStoryKey | UserStoryUrl): string[] {
    return ['jira', 'workitem', 'view', key.text, '--json', '--fields', AcliUserStories.#FIELDS]
  }

  async detail(key: UserStoryKey | UserStoryUrl): Promise<UserStory> {
    const argv = AcliUserStories.argvFor(key)
    const output = await this.acli.run(argv, { safeToRepeat: true })
    if (output.failed) {
      throw new UserStoryNotRead(
        `${AcliUserStories.BIN} ${argv[0]} failed: ${AcliUserStories.#reasonFor(output.stderr.trim())}`
      )
    }

    return AcliUserStories.#storyFrom(output.stdout, key)
  }

  static #reasonFor(message: string): string {
    return AcliUserStories.#UNAUTHENTICATED.test(message)
      ? `${AcliUserStories.BIN} is not authenticated, run "acli jira auth login" and try again: ${message}`
      : message
  }

  static #storyFrom(printed: string, key: UserStoryKey | UserStoryUrl): UserStory {
    const fields = AcliUserStories.#fieldsIn(printed, key)

    return new UserStory({
      key,
      summary: AcliUserStories.#summaryIn(fields, key, printed),
      description: AcliUserStories.#plainText(fields.description),
    })
  }

  static #fieldsIn(printed: string, key: UserStoryKey | UserStoryUrl): Record<string, unknown> {
    let parsed: unknown
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new UserStoryNotUnderstood(
        `acli answered something that is not json for ${key}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!AcliUserStories.#isKeyed(parsed) || !AcliUserStories.#isKeyed(parsed.fields)) {
      throw new UserStoryNotUnderstood(
        `acli answered without the fields of ${key}, it printed ${JSON.stringify(printed)}`
      )
    }

    return parsed.fields
  }

  static #isKeyed(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object'
  }

  static #summaryIn(
    fields: Record<string, unknown>, key: UserStoryKey | UserStoryUrl, printed: string
  ): string {
    const written = typeof fields.summary === 'string' ? fields.summary.trim() : ''
    if (written.length === 0 || isNoValueCell(written)) {
      throw new UserStoryNotUnderstood(
        `${key} carries no summary to plan with, it printed ${JSON.stringify(printed)}`
      )
    }

    return written
  }

  static #plainText(description: unknown): string {
    if (typeof description === 'string') return description.trim()
    if (description === null || typeof description !== 'object') return ''
    const parts: string[] = []
    AcliUserStories.#walk(description, parts)

    return parts.join('').replace(AcliUserStories.#BLANK_RUN, '\n\n').trim()
  }

  static #walk(node: unknown, parts: string[]): void {
    if (!AcliUserStories.#isKeyed(node)) return
    if (typeof node.text === 'string') parts.push(node.text)
    if (!Array.isArray(node.content)) return
    const content: unknown[] = node.content
    for (const child of content) AcliUserStories.#walk(child, parts)
    if (typeof node.type === 'string' && AcliUserStories.#BREAKING_NODES.includes(node.type)) parts.push('\n')
  }
}
