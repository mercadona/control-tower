import { ReadEpicGroom, ReadEpicGroomParams, EpicGroomState } from '../queries/read-epic-groom.ts'
import type { EpicGroomStateValue } from '../queries/read-epic-groom.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { EpicIssues } from '../../domain/ports/epic-issues.ts'
import type { EpicIssue } from '../../domain/value-objects/epic-issue.ts'
import type { GroomPlan } from '../../domain/value-objects/groom-plan.ts'
import type { CheckRepositoryPreparation } from './check-repository-preparation.ts'
import type { UserStoryKey } from '../../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../../domain/value-objects/user-story-url.ts'

export class PromoteEpicParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName
  readonly story: UserStoryKey | UserStoryUrl

  constructor({ root, repository, story }: {
    root: CheckoutRoot, repository: RepositoryName, story: UserStoryKey | UserStoryUrl,
  }) {
    this.root = root
    this.repository = repository
    this.story = story
    Object.freeze(this)
  }
}

export class EpicPromoted {
  readonly state: EpicGroomStateValue
  readonly milestone: string | null
  readonly plan: GroomPlan | null
  readonly issues: readonly EpicIssue[]
  readonly promoted: readonly number[]
  readonly reason: string | null

  constructor({ state, milestone, plan, issues, promoted, reason = null }: {
    state: EpicGroomStateValue,
    milestone: string | null,
    plan: GroomPlan | null,
    issues: readonly EpicIssue[],
    promoted: readonly number[],
    reason?: string | null,
  }) {
    this.state = state
    this.milestone = milestone
    this.plan = plan
    this.issues = issues
    this.promoted = promoted
    this.reason = reason
    Object.freeze(this)
  }
}

export class PromoteEpic {
  readonly read: ReadEpicGroom
  readonly issues: EpicIssues
  readonly preparation: CheckRepositoryPreparation

  constructor({ read, issues, preparation }: { read: ReadEpicGroom, issues: EpicIssues, preparation: CheckRepositoryPreparation }) {
    this.read = read
    this.issues = issues
    this.preparation = preparation
  }

  async execute(params: PromoteEpicParams): Promise<EpicPromoted> {
    const before = await this.read.execute(new ReadEpicGroomParams({ root: params.root, repository: params.repository, story: params.story }))
    const nothingSafeToAuthorise = before.issues.length === 0 ||
      before.state === EpicGroomState.PARTIALLY_GROOMED ||
      before.state === EpicGroomState.ISSUES_UNCERTAIN

    if (nothingSafeToAuthorise) {
      return new EpicPromoted({
        state: before.state, milestone: before.milestone, plan: before.plan, issues: before.issues, promoted: [],
        reason: before.reason,
      })
    }

    const waiting = before.issues.filter((issue) => issue.isPromotable())
    await this.preparation.execute(params)
    for (const issue of waiting) {
      await this.issues.promote({ repository: params.repository, issue })
    }

    const after = await this.read.execute(new ReadEpicGroomParams({ root: params.root, repository: params.repository, story: params.story }))

    return new EpicPromoted({
      state: after.state,
      milestone: after.milestone,
      plan: after.plan,
      issues: after.issues,
      promoted: waiting.map((issue) => issue.number),
    })
  }
}
