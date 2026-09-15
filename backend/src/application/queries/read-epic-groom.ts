import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { PublishedSpecs } from '../../domain/ports/published-specs.ts'
import type { EpicIssues } from '../../domain/ports/epic-issues.ts'
import type { EpicGroom } from '../../domain/ports/epic-groom.ts'
import type { EpicBranch } from '../../domain/ports/epic-branch.ts'
import type { PullRequests } from '../../domain/ports/pull-requests.ts'
import type { EpicSpec } from '../../domain/value-objects/epic-spec.ts'
import type { GroomPlan } from '../../domain/value-objects/groom-plan.ts'
import type { EpicIssue } from '../../domain/value-objects/epic-issue.ts'
import type { PlanFingerprint } from '../../domain/policies/plan-fingerprint.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

export class ReadEpicGroomParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName

  constructor({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }) {
    this.root = root
    this.repository = repository
    Object.freeze(this)
  }
}

export const EpicGroomState = Object.freeze({
  NO_SPEC: 'no-spec',
  DRAFT: 'draft',
  AWAITING_PUBLICATION: 'awaiting-publication',
  ISSUES_UNCERTAIN: 'issues-uncertain',
  GROOMABLE: 'groomable',
  PARTIALLY_GROOMED: 'partially-groomed',
  GROOMED: 'groomed',
  AUTHORISED: 'authorised',
} as const)

export type EpicGroomStateValue = (typeof EpicGroomState)[keyof typeof EpicGroomState]

export class EpicGroomRead {
  readonly state: EpicGroomStateValue
  readonly spec: EpicSpec | null
  readonly milestone: string | null
  readonly plan: GroomPlan | null
  readonly planFingerprint: string | null
  readonly issues: readonly EpicIssue[]
  readonly reason: string | null
  readonly pullRequest: ReviewedPullRequest | null

  constructor({ state, spec, milestone, plan, planFingerprint, issues, reason = null, pullRequest = null }: {
    state: EpicGroomStateValue,
    spec: EpicSpec | null,
    milestone: string | null,
    plan: GroomPlan | null,
    planFingerprint: string | null,
    issues: readonly EpicIssue[],
    reason?: string | null,
    pullRequest?: ReviewedPullRequest | null,
  }) {
    this.state = state
    this.spec = spec
    this.milestone = milestone
    this.plan = plan
    this.planFingerprint = planFingerprint
    this.issues = issues
    this.reason = reason
    this.pullRequest = pullRequest
    Object.freeze(this)
  }
}

export class ReadEpicGroom {
  readonly specs: EpicSpecs
  readonly published: PublishedSpecs
  readonly issues: EpicIssues
  readonly groom: EpicGroom
  readonly branch: EpicBranch
  readonly pullRequests: PullRequests
  readonly fingerprint: PlanFingerprint

  constructor({ specs, published, issues, groom, branch, pullRequests, fingerprint }: {
    specs: EpicSpecs,
    published: PublishedSpecs,
    issues: EpicIssues,
    groom: EpicGroom,
    branch: EpicBranch,
    pullRequests: PullRequests,
    fingerprint: PlanFingerprint,
  }) {
    this.specs = specs
    this.published = published
    this.issues = issues
    this.groom = groom
    this.branch = branch
    this.pullRequests = pullRequests
    this.fingerprint = fingerprint
  }

  async execute(params: ReadEpicGroomParams): Promise<EpicGroomRead> {
    const spec = await this.specs.mostRecent(params.root)
    if (spec === null) {
      return new EpicGroomRead({
        state: EpicGroomState.NO_SPEC, spec: null, milestone: null, plan: null, planFingerprint: null, issues: [],
      })
    }

    if (!spec.isFrozen()) {
      return new EpicGroomRead({
        state: EpicGroomState.DRAFT, spec, milestone: null, plan: null, planFingerprint: null, issues: [],
      })
    }

    const isPublished = await this.published.holds({ repository: params.repository, path: spec.path })
    if (!isPublished) {
      return new EpicGroomRead({
        state: EpicGroomState.AWAITING_PUBLICATION, spec, milestone: null, plan: null, planFingerprint: null,
        issues: [], pullRequest: await this.#awaitedPullRequest(params),
      })
    }

    const milestone = spec.title()!
    const holding = await this.issues.listOf({ repository: params.repository, milestone })
    if (!holding.exhausted) {
      return new EpicGroomRead({
        state: EpicGroomState.ISSUES_UNCERTAIN, spec, milestone, plan: null, planFingerprint: null, issues: [],
        reason: holding.reason,
      })
    }

    const plan = await this.groom.planned({ root: params.root, spec, repository: params.repository, milestone })
    const planFingerprint = this.fingerprint.of(plan)

    if (holding.issues.length === 0) {
      return new EpicGroomRead({
        state: EpicGroomState.GROOMABLE, spec, milestone, plan, planFingerprint, issues: [],
      })
    }

    if (ReadEpicGroom.#isPartiallyGroomed(plan, holding.issues)) {
      return new EpicGroomRead({
        state: EpicGroomState.PARTIALLY_GROOMED, spec, milestone, plan, planFingerprint, issues: holding.issues,
      })
    }

    const state = holding.issues.some((issue) => issue.isPromotable())
      ? EpicGroomState.GROOMED
      : EpicGroomState.AUTHORISED
    return new EpicGroomRead({ state, spec, milestone, plan, planFingerprint, issues: holding.issues })
  }

  async #awaitedPullRequest(params: ReadEpicGroomParams): Promise<ReviewedPullRequest | null> {
    const branch = await this.branch.current(params.root)

    return await this.pullRequests.openOfBranch({ branch, repository: params.repository })
  }

  static #isPartiallyGroomed(plan: GroomPlan, holding: readonly EpicIssue[]): boolean {
    const heldOrders = new Set(holding.map((issue) => issue.order).filter((order) => order !== null))
    const plannedOrderIsMissing = (planned: { order: number }): boolean => !heldOrders.has(planned.order)

    return plan.issues.some(plannedOrderIsMissing)
  }
}
