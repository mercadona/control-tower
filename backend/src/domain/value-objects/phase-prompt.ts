import type { CheckoutRoot } from './checkout-root.ts'
import type { EpicSpec } from './epic-spec.ts'
import type { RepositoryName } from './repository-name.ts'
import type { UserStory } from './user-story.ts'
import { StoryDocuments } from './story-documents.ts'

export class PhasePrompt {
  static readonly BRAINSTORMING_SKILL = 'control-tower-loop:ct-brainstorming'
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
  static readonly ANOTHER_ROUND_AFTER_A_VETO =
    "When a slice's run closes at blocked-judge, the judge has vetoed the same task three times and the "
    + "run waits on a decision that is the person's. Read GET /active-plans for the repo, the issue and "
    + 'the agent, tell the person what the judge found, and ask them what to change. Send their words '
    + 'with POST /slices/<issue>/another-round and {repo, agent, instruction}: the backend grants the '
    + "round and the run carries on by itself. The instruction is the person's: you do not invent it, "
    + 'you do not widen the task, and you do not grant a round nobody asked for. There is no limit on '
    + 'rounds; the limit is the person. When the call is refused, tell the person what the refusal said '
    + 'and do not retry it in a loop.'
  static readonly RECOVERY_CAPABILITIES =
    'For recovery of already-authorized work, use the origin of $CT_SESSION_HOOKS_URL as the backend URL. '
    + 'Read GET /active-plans and preserve each returned repo, issue number and agent identity. '
    + 'For observe or continue, POST /recover-plan with exactly {repo, issue, agent} as JSON; '
    + 'for cleanup, POST /cleanup-plan with the same identity. Read GET /active-plans again after an answer. '
    + 'Inspect means read the diagnostic and refresh only; never force cleanup or launch replacement work. '
    + 'Recovery acceptance is not completion. Respect refusals; gates 1 and 2 and merge remain human-owned.'
  static readonly SLICES_ARE_NOT_YOURS =
    'The slices of this milestone run by themselves: you start none, you implement none and you merge none. '
    + 'When the person asks how a slice goes, read GET /active-plans and tell them what it answers.'

  readonly text: string

  private constructor(text: string) {
    this.text = text
    Object.freeze(this)
  }

  static brainstorming({ story, repository, root }: {
    story: UserStory,
    repository: RepositoryName,
    root: CheckoutRoot,
  }): PhasePrompt {
    return new PhasePrompt([
      `Invoke the skill ${PhasePrompt.BRAINSTORMING_SKILL}.`,
      PhasePrompt.#roleOf({ repository, root }),
      PhasePrompt.FREEZE_IS_NOT_YOURS,
      PhasePrompt.#idea(story),
      PhasePrompt.#documentsOf(story),
      PhasePrompt.CHANGE_TO_A_SLICE,
      PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO,
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
      PhasePrompt.#roleOf({ repository, root }),
      ...PhasePrompt.#slicingReview({ spec, milestone }),
      PhasePrompt.CHANGE_TO_A_SLICE,
      PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO,
      PhasePrompt.RECOVERY_CAPABILITIES,
    ].join('\n'))
  }

  static groomReview({ spec, milestone }: { spec: EpicSpec, milestone: string }): PhasePrompt {
    return new PhasePrompt(PhasePrompt.#slicingReview({ spec, milestone }).join('\n'))
  }

  static implementation({ milestone, repository, root }: {
    milestone: string,
    repository: RepositoryName,
    root: CheckoutRoot,
  }): PhasePrompt {
    return new PhasePrompt([
      PhasePrompt.#roleOf({ repository, root }),
      `Follow the implementation of the milestone "${milestone}" with the person.`,
      PhasePrompt.SLICES_ARE_NOT_YOURS,
      PhasePrompt.CHANGE_TO_A_SLICE,
      PhasePrompt.ANOTHER_ROUND_AFTER_A_VETO,
      PhasePrompt.RECOVERY_CAPABILITIES,
    ].join('\n'))
  }

  oneLine(): string {
    return this.text.split('\n').join(' ')
  }

  static #roleOf({ repository, root }: { repository: RepositoryName, root: CheckoutRoot }): string {
    return `You are the coordinating session of the epic for ${repository.text}, in the checkout ${root.text}: you cut no worktree and you switch no branch.`
  }

  static #documentsOf(story: UserStory): string {
    const documents = new StoryDocuments(story.key)

    return `Write the design document at ${documents.design} and the execution spec at ${documents.spec}, `
      + 'exactly those paths: when either already exists, continue it instead of starting another.'
  }

  static #slicingReview({ spec, milestone }: { spec: EpicSpec, milestone: string }): string[] {
    return [
      `Review the slicing of the milestone "${milestone}" with the person: its frozen execution spec is ${spec.path} and the slices are the table of its §9.`,
      PhasePrompt.ISSUES_ARE_NOT_YOURS,
      PhasePrompt.RESLICING_TRAVELS_AS_A_PULL_REQUEST,
    ]
  }

  static #idea(story: UserStory): string {
    return story.hasDescription()
      ? `The ticket ${story.key.text} says: "${story.summary}". ${story.description}`
      : `The ticket ${story.key.text} says: "${story.summary}".`
  }
}
