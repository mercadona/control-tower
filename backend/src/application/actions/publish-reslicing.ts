import { Reslicing } from '../../domain/value-objects/reslicing.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { EpicBranch } from '../../domain/ports/epic-branch.ts'
import type { EpicSpec } from '../../domain/value-objects/epic-spec.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { PullRequests } from '../../domain/ports/pull-requests.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

export class PublishReslicingParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName

  constructor({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }) {
    this.root = root
    this.repository = repository
    Object.freeze(this)
  }
}

export const ReslicingOutcome = Object.freeze({
  PUBLISHED: 'published',
  NO_SPEC: 'no-spec',
  NOT_FROZEN: 'not-frozen',
} as const)

export type ReslicingOutcomeValue = (typeof ReslicingOutcome)[keyof typeof ReslicingOutcome]

export class ReslicingPublished {
  readonly outcome: ReslicingOutcomeValue
  readonly pullRequest: ReviewedPullRequest | null

  private constructor({ outcome, pullRequest }: {
    outcome: ReslicingOutcomeValue, pullRequest: ReviewedPullRequest | null,
  }) {
    this.outcome = outcome
    this.pullRequest = pullRequest
    Object.freeze(this)
  }

  static published(pullRequest: ReviewedPullRequest): ReslicingPublished {
    return new ReslicingPublished({ outcome: ReslicingOutcome.PUBLISHED, pullRequest })
  }

  static refused(outcome: ReslicingOutcomeValue): ReslicingPublished {
    return new ReslicingPublished({ outcome, pullRequest: null })
  }
}

export class PublishReslicing {
  readonly specs: EpicSpecs
  readonly branch: EpicBranch
  readonly pullRequests: PullRequests

  constructor({ specs, branch, pullRequests }: {
    specs: EpicSpecs, branch: EpicBranch, pullRequests: PullRequests,
  }) {
    this.specs = specs
    this.branch = branch
    this.pullRequests = pullRequests
  }

  async execute(params: PublishReslicingParams): Promise<ReslicingPublished> {
    const found = await this.specs.mostRecent(params.root)
    if (found === null) return ReslicingPublished.refused(ReslicingOutcome.NO_SPEC)
    if (!found.isFrozen()) return ReslicingPublished.refused(ReslicingOutcome.NOT_FROZEN)

    const branch = await this.branch.publishing({ root: params.root, milestone: found.milestoneBranch() })
    const spec = await this.specs.reread({ root: params.root, spec: found }) ?? found
    await this.#committed({ params, spec })
    if (!(await this.branch.pushed({ root: params.root, branch }))) {
      await this.branch.push({ root: params.root, branch })
    }

    return ReslicingPublished.published(await this.#pullRequest({ params, spec, branch }))
  }

  async #committed({ params, spec }: { params: PublishReslicingParams, spec: EpicSpec }): Promise<void> {
    if (await this.branch.committed({ root: params.root, paths: [spec.path] })) return

    await this.branch.commit({
      root: params.root,
      paths: [spec.path],
      message: `Re-slice the execution spec of ${spec.title()}`,
    })
  }

  async #pullRequest({ params, spec, branch }: {
    params: PublishReslicingParams, spec: EpicSpec, branch: string,
  }): Promise<ReviewedPullRequest> {
    const standing = await this.pullRequests.openOfBranch({ branch, repository: params.repository })
    if (standing !== null) return standing

    return await this.pullRequests.open({
      repository: params.repository,
      branch,
      title: Reslicing.titleOf(spec.title()!),
      body: Reslicing.bodyFor({ milestone: spec.title()!, path: spec.path }),
    })
  }
}
