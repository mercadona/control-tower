import type { CheckoutRoot } from './checkout-root.ts'
import type { EpicSpec } from './epic-spec.ts'
import type { PlanComment } from './plan-comment.ts'
import type { RepositoryName } from './repository-name.ts'
import type { UserStory } from './user-story.ts'

export class PhasePrompt {
  static readonly BRAINSTORMING_SKILL = 'control-tower-loop:ct-brainstorming'
  static readonly GROOM_SKILL = 'control-tower-loop:ct-groom'
  static readonly FREEZE_IS_NOT_YOURS =
    'You never freeze the spec yourself: the state line and its date are written by gate 1 of the '
    + "cabin, on a person's click. Leave the spec at DRAFT, present the freeze summary and stop."
  static readonly ISSUES_ARE_NOT_YOURS =
    'You never create the issues yourself: the milestone, the labels, the issues and the Project are written by '
    + "gate 2 of the cabin, on a person's click or on the merge of a re-slicing pull request. Walk the slices "
    + 'table with the person, answer what they ask about it and stop.'
  static readonly RESLICING_TRAVELS_AS_A_PULL_REQUEST =
    'When the slicing has to change, edit the table of §9 and stop there: leave the state line and the '
    + 'freeze date as they are, commit nothing and push nothing. Gate 2 publishes your edit as a pull request, '
    + 'and the issues are created when that pull request merges.'
  static readonly CHANGE_TO_A_SLICE =
    'A change a person asks you for on a slice travels through you and never round you. '
    + 'Read GET /active-plans first: when that slice answers acceptsChange true, POST /slices/<issue>/message '
    + 'with {repo, agent, text} and say it is on its way. When it answers false the slice is busy with earlier '
    + 'supervised work, so POST /slices/<issue>/held-change with the same body: it is kept where the run keeps '
    + 'its journal, it survives a restart of anything, and it goes out by itself when that work finishes. '
    + 'Tell the person it is queued and name the ticket you got back. Do not ask them to choose between waiting '
    + 'and dropping it, do not send it again yourself, and never report a raw refusal code as the answer. '
    + 'When the backend tells you a kept change has gone out, say so to the person naming the ticket.'
  static readonly RECOVERY_CAPABILITIES =
    'For recovery of already-authorized work, use the origin of $CT_SESSION_HOOKS_URL as the backend URL. '
    + 'Read GET /active-plans and preserve each returned repo, issue number and agent identity. '
    + 'For observe or continue, POST /recover-plan with exactly {repo, issue, agent} as JSON; '
    + 'for cleanup, POST /cleanup-plan with the same identity. Read GET /active-plans again after an answer. '
    + 'Inspect means read the diagnostic and refresh only; never force cleanup or launch replacement work. '
    + 'Recovery acceptance is not completion. Respect refusals; gates 1 and 2 and merge remain human-owned.'

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
      PhasePrompt.#roleOf({ repository, root }),
      PhasePrompt.FREEZE_IS_NOT_YOURS,
      ...PhasePrompt.#idea({ story, comment }),
      PhasePrompt.CHANGE_TO_A_SLICE,
      PhasePrompt.RECOVERY_CAPABILITIES,
    ].join('\n'))
  }

  static groom({ spec, milestone, repository, root }: {
    spec: EpicSpec,
    milestone: string,
    repository: RepositoryName,
    root: CheckoutRoot,
  }): PhasePrompt {
    return new PhasePrompt([
      `Invoke the skill ${PhasePrompt.GROOM_SKILL}.`,
      PhasePrompt.#roleOf({ repository, root }),
      PhasePrompt.ISSUES_ARE_NOT_YOURS,
      PhasePrompt.RESLICING_TRAVELS_AS_A_PULL_REQUEST,
      `The milestone is "${milestone}" and its frozen execution spec is ${spec.path}.`,
      PhasePrompt.CHANGE_TO_A_SLICE,
      PhasePrompt.RECOVERY_CAPABILITIES,
    ].join('\n'))
  }

  oneLine(): string {
    return this.text.split('\n').join(' ')
  }

  static #roleOf({ repository, root }: { repository: RepositoryName, root: CheckoutRoot }): string {
    return `You are the coordinating session of the epic for ${repository.text}, in the checkout ${root.text}: you cut no worktree and you switch no branch.`
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
