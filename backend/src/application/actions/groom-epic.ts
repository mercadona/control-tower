import { ReadEpicGroom, ReadEpicGroomParams, EpicGroomState } from '../queries/read-epic-groom.ts'
import type { EpicGroomStateValue } from '../queries/read-epic-groom.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { EpicGroom } from '../../domain/ports/epic-groom.ts'
import type { GroomPlan } from '../../domain/value-objects/groom-plan.ts'
import type { EpicIssue } from '../../domain/value-objects/epic-issue.ts'
import type { PlanFingerprint } from '../../domain/policies/plan-fingerprint.ts'
import type { UserStoryKey } from '../../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../../domain/value-objects/user-story-url.ts'

export const PlanStaleness = Object.freeze({
  FRESH: 'fresh',
  CHANGED: 'plan-changed',
} as const)

export type PlanStalenessValue = (typeof PlanStaleness)[keyof typeof PlanStaleness]

export class GroomEpicParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName
  readonly story: UserStoryKey | UserStoryUrl
  readonly fingerprint: string | null

  constructor({ root, repository, story, fingerprint }: {
    root: CheckoutRoot, repository: RepositoryName, story: UserStoryKey | UserStoryUrl, fingerprint: string | null,
  }) {
    this.root = root
    this.repository = repository
    this.story = story
    this.fingerprint = fingerprint
    Object.freeze(this)
  }
}

export class EpicGroomed {
  readonly state: EpicGroomStateValue
  readonly milestone: string | null
  readonly plan: GroomPlan | null
  readonly issues: readonly EpicIssue[]
  readonly staleness: PlanStalenessValue
  readonly reason: string | null

  constructor({ state, milestone, plan, issues, staleness, reason = null }: {
    state: EpicGroomStateValue,
    milestone: string | null,
    plan: GroomPlan | null,
    issues: readonly EpicIssue[],
    staleness: PlanStalenessValue,
    reason?: string | null,
  }) {
    this.state = state
    this.milestone = milestone
    this.plan = plan
    this.issues = issues
    this.staleness = staleness
    this.reason = reason
    Object.freeze(this)
  }
}

export class GroomEpic {
  static readonly REFUSED: readonly EpicGroomStateValue[] = Object.freeze([
    EpicGroomState.NO_SPEC,
    EpicGroomState.DRAFT,
    EpicGroomState.RESLICED,
    EpicGroomState.AWAITING_PUBLICATION,
    EpicGroomState.ISSUES_UNCERTAIN,
  ])

  readonly read: ReadEpicGroom
  readonly groom: EpicGroom
  readonly fingerprint: PlanFingerprint

  constructor({ read, groom, fingerprint }: { read: ReadEpicGroom, groom: EpicGroom, fingerprint: PlanFingerprint }) {
    this.read = read
    this.groom = groom
    this.fingerprint = fingerprint
  }

  async execute(params: GroomEpicParams): Promise<EpicGroomed> {
    const before = await this.read.execute(new ReadEpicGroomParams({ root: params.root, repository: params.repository, story: params.story }))

    if (GroomEpic.REFUSED.includes(before.state)) {
      return new EpicGroomed({
        state: before.state, milestone: before.milestone, plan: before.plan, issues: before.issues,
        staleness: PlanStaleness.FRESH, reason: before.reason,
      })
    }

    if (this.fingerprint.of(before.plan!) !== params.fingerprint) {
      return new EpicGroomed({
        state: before.state, milestone: before.milestone, plan: before.plan, issues: before.issues,
        staleness: PlanStaleness.CHANGED,
      })
    }

    await this.groom.run({
      root: params.root,
      spec: before.spec!,
      repository: params.repository,
      milestone: before.milestone!,
    })

    const after = await this.read.execute(new ReadEpicGroomParams({ root: params.root, repository: params.repository, story: params.story }))

    return new EpicGroomed({
      state: after.state, milestone: after.milestone, plan: before.plan, issues: after.issues,
      staleness: PlanStaleness.FRESH, reason: after.reason,
    })
  }
}
