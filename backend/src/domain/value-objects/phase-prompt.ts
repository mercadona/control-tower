import type { CheckoutRoot } from './checkout-root.ts'
import type { PlanComment } from './plan-comment.ts'
import type { RepositoryName } from './repository-name.ts'
import type { UserStory } from './user-story.ts'

export class PhasePrompt {
  static readonly BRAINSTORMING_SKILL = 'control-tower-loop:brainstorming'

  readonly text: string

  private constructor(text: string) {
    this.text = text
    Object.freeze(this)
  }

  static brainstorming({ story, comment, repository, root }: {
    story: UserStory | null,
    comment: PlanComment | null,
    repository: RepositoryName,
    root: CheckoutRoot,
  }): PhasePrompt {
    return new PhasePrompt([
      `Invoke the skill ${PhasePrompt.BRAINSTORMING_SKILL}.`,
      `You are the coordinating session of the epic for ${repository.text}, in the checkout ${root.text}: you cut no worktree and you switch no branch.`,
      ...PhasePrompt.#idea({ story, comment }),
    ].join('\n'))
  }

  static #idea({ story, comment }: { story: UserStory | null, comment: PlanComment | null }): string[] {
    const idea: string[] = []
    if (story !== null) {
      idea.push(story.hasDescription()
        ? `The ticket ${story.key.text} says: "${story.summary}". ${story.description}`
        : `The ticket ${story.key.text} says: "${story.summary}".`)
    }
    if (comment !== null) {
      idea.push(comment.text)
    }
    return idea
  }
}
