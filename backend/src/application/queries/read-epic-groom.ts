import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { PublishedSpecs } from '../../domain/ports/published-specs.ts'
import type { EpicIssues } from '../../domain/ports/epic-issues.ts'
import type { EpicGroom } from '../../domain/ports/epic-groom.ts'
import type { EpicSpec } from '../../domain/value-objects/epic-spec.ts'
import type { GroomPlan } from '../../domain/value-objects/groom-plan.ts'
import type { EpicIssue } from '../../domain/value-objects/epic-issue.ts'
import type { PlanFingerprint } from '../../domain/policies/plan-fingerprint.ts'

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

  constructor({ state, spec, milestone, plan, planFingerprint, issues }: {
    state: EpicGroomStateValue,
    spec: EpicSpec | null,
    milestone: string | null,
    plan: GroomPlan | null,
    planFingerprint: string | null,
    issues: readonly EpicIssue[],
  }) {
    this.state = state
    this.spec = spec
    this.milestone = milestone
    this.plan = plan
    this.planFingerprint = planFingerprint
    this.issues = issues
    Object.freeze(this)
  }
}

export class ReadEpicGroom {
  readonly specs: EpicSpecs
  readonly published: PublishedSpecs
  readonly issues: EpicIssues
  readonly groom: EpicGroom
  readonly fingerprint: PlanFingerprint

  constructor({ specs, published, issues, groom, fingerprint }: {
    specs: EpicSpecs, published: PublishedSpecs, issues: EpicIssues, groom: EpicGroom, fingerprint: PlanFingerprint,
  }) {
    this.specs = specs
    this.published = published
    this.issues = issues
    this.groom = groom
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
        issues: [],
      })
    }

    const milestone = spec.title()!
    const holding = await this.issues.listOf({ repository: params.repository, milestone })
    const plan = await this.groom.planned({ root: params.root, spec, repository: params.repository, milestone })
    const planFingerprint = this.fingerprint.of(plan)

    if (holding.length === 0) {
      return new EpicGroomRead({
        state: EpicGroomState.GROOMABLE, spec, milestone, plan, planFingerprint, issues: [],
      })
    }

    if (ReadEpicGroom.#isPartiallyGroomed(plan, holding)) {
      return new EpicGroomRead({
        state: EpicGroomState.PARTIALLY_GROOMED, spec, milestone, plan, planFingerprint, issues: holding,
      })
    }

    const state = holding.some((issue) => issue.isPromotable()) ? EpicGroomState.GROOMED : EpicGroomState.AUTHORISED
    return new EpicGroomRead({ state, spec, milestone, plan, planFingerprint, issues: holding })
  }

  static #isPartiallyGroomed(plan: GroomPlan, holding: readonly EpicIssue[]): boolean {
    const heldOrders = new Set(holding.map((issue) => issue.order).filter((order) => order !== null))
    const plannedOrderIsMissing = (planned: { order: number }): boolean => !heldOrders.has(planned.order)

    return plan.issues.some(plannedOrderIsMissing)
  }
}
