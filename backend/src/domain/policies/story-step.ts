import type { EpicSpec } from '../value-objects/epic-spec.ts'
import type { EpicIssuesListing } from '../value-objects/epic-issues-listing.ts'

export const StoryStep = Object.freeze({
  BRAINSTORMING: 'brainstorming',
  GROOM: 'groom',
  IMPLEMENTATION: 'implementation',
} as const)

export type StoryStepValue = (typeof StoryStep)[keyof typeof StoryStep]

export class StoryStepPolicy {
  static of({ spec, listing }: { spec: EpicSpec | null, listing: EpicIssuesListing | null }): StoryStepValue {
    if (spec === null || !spec.isFrozen()) return StoryStep.BRAINSTORMING
    if (StoryStepPolicy.#isAuthorised(listing)) return StoryStep.IMPLEMENTATION

    return StoryStep.GROOM
  }

  static #isAuthorised(listing: EpicIssuesListing | null): boolean {
    return listing !== null && listing.exhausted && listing.issues.length > 0
      && !listing.issues.some((issue) => issue.isPromotable())
  }
}
