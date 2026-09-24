import { ImplementationStep } from '../../domain/value-objects/implementation-state.ts'
import type { ImplementationState } from '../../domain/value-objects/implementation-state.ts'
import { DeliveryPolicy, DeliveryState } from '../../domain/policies/delivery-policy.ts'
import type { DeliveryStateValue } from '../../domain/policies/delivery-policy.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { ImplementationProgress } from '../../domain/ports/implementation-progress.ts'
import type { PlanIssues } from '../../domain/ports/plan-issues.ts'
import type { PullRequests } from '../../domain/ports/pull-requests.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { PlanRecords } from '../../domain/ports/plan-records.ts'
import type { RunDelivery } from '../../domain/ports/run-delivery.ts'
import type { PlanWatch } from '../../domain/value-objects/plan-watch.ts'
import { PlanFailure } from '../../domain/exceptions.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

type DeliveryProjection = (state: ImplementationState, pullRequest: ReviewedPullRequest) => ImplementationState

export class ReadImplementationProgressParams {
  readonly root: CheckoutRoot
  readonly issue: number
  readonly repository: RepositoryName

  constructor({ root, issue, repository }: {
    root: CheckoutRoot,
    issue: number,
    repository: RepositoryName,
  }) {
    this.root = root
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadImplementationProgressResult {
  readonly state: ImplementationState
  readonly delivery: { readonly kind: 'verified' } | { readonly kind: 'unavailable', readonly detail: string }

  constructor({ state, delivery = { kind: 'verified' } }: {
    state: ImplementationState,
    delivery?: { readonly kind: 'verified' } | { readonly kind: 'unavailable', readonly detail: string },
  }) {
    this.state = state
    this.delivery = Object.freeze(delivery)
    Object.freeze(this)
  }
}

export class ReadImplementationProgress {
  static #BY_DELIVERY: ReadonlyMap<DeliveryStateValue, DeliveryProjection> = new Map([
    [DeliveryState.IN_REVIEW, (state, pullRequest) =>
      state.underReview({ step: ImplementationStep.IN_REVIEW, pullRequest })],
    [DeliveryState.FIXING, (state, pullRequest) =>
      state.underReview({ step: ImplementationStep.FIXING, pullRequest })],
    [DeliveryState.UNATTENDED, (state) => state],
  ])

  readonly implementationProgress: ImplementationProgress
  readonly pullRequests: PullRequests
  readonly planIssues: PlanIssues
  readonly records: PlanRecords
  readonly delivery: RunDelivery
  readonly isDriver: (watch: PlanWatch) => Promise<boolean>

  constructor({ implementationProgress, pullRequests, planIssues, records, delivery, isDriver }: {
    implementationProgress: ImplementationProgress,
    pullRequests: PullRequests,
    planIssues: PlanIssues,
    records: PlanRecords,
    delivery: RunDelivery,
    isDriver: (watch: PlanWatch) => Promise<boolean>,
  }) {
    this.implementationProgress = implementationProgress
    this.pullRequests = pullRequests
    this.planIssues = planIssues
    this.records = records
    this.delivery = delivery
    this.isDriver = isDriver
  }

  async execute(params: ReadImplementationProgressParams): Promise<ReadImplementationProgressResult> {
    const state = await this.implementationProgress.of({
      root: params.root,
      issue: params.issue,
      repository: params.repository,
    })

    try {
      return await this.#reviewed(state, params)
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      return new ReadImplementationProgressResult({ state, delivery: { kind: 'unavailable', detail: cause.message } })
    }
  }

  async #reviewed(state: ImplementationState, params: ReadImplementationProgressParams): Promise<ReadImplementationProgressResult> {
    if (state.step !== ImplementationStep.DELIVERED) return new ReadImplementationProgressResult({ state })
    const watch = await this.records.find({ issue: params.issue, repository: params.repository })
    if (watch !== null && await this.isDriver(watch)) {
      const delivery = await this.delivery.inspect(watch)
      if (delivery.kind === 'uncertain') {
        return new ReadImplementationProgressResult({ state, delivery: { kind: 'unavailable', detail: delivery.diagnostic } })
      }
      if (delivery.kind !== 'delivered') {
        return new ReadImplementationProgressResult({ state: state.underReview({
          step: ImplementationStep.PUBLISHING,
          pullRequest: delivery.kind === 'absent' ? null : delivery.pullRequest,
        }) })
      }
      return new ReadImplementationProgressResult({ state: await this.#deliveryReviewed(state, delivery.pullRequest, params) })
    }
    const pullRequest = await this.pullRequests.openOf({
      issueNumber: params.issue, repository: params.repository,
    })
    if (pullRequest === null) return new ReadImplementationProgressResult({ state })

    return new ReadImplementationProgressResult({ state: await this.#deliveryReviewed(state, pullRequest, params) })
  }

  async #deliveryReviewed(
    state: ImplementationState, pullRequest: ReviewedPullRequest, params: ReadImplementationProgressParams,
  ): Promise<ImplementationState> {
    const status = await this.planIssues.statusOf({
      issueNumber: params.issue, repository: params.repository,
    })
    const delivery = DeliveryPolicy.of({ status })
    const projected = ReadImplementationProgress.#BY_DELIVERY.get(delivery)
    if (projected === undefined) {
      throw new Error(`no implementation step declared for the delivery state ${JSON.stringify(delivery)}`)
    }

    return projected(state, pullRequest)
  }
}
