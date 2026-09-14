import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { EpicBranch } from '../../domain/ports/epic-branch.ts'
import type { PullRequests } from '../../domain/ports/pull-requests.ts'
import type { EpicSpec } from '../../domain/value-objects/epic-spec.ts'
import type { FreezeFinding } from '../../domain/value-objects/freeze-finding.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

export class ReadSpecFreezeParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName

  constructor({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }) {
    this.root = root
    this.repository = repository
    Object.freeze(this)
  }
}

export const SpecFreezeState = Object.freeze({
  NO_SPEC: 'no-spec',
  DRAFT: 'draft',
  FROZEN: 'frozen',
} as const)

export type SpecFreezeStateValue = (typeof SpecFreezeState)[keyof typeof SpecFreezeState]

export class SpecFreezeRead {
  readonly state: SpecFreezeStateValue
  readonly spec: EpicSpec | null
  readonly findings: FreezeFinding[]
  readonly frozenOn: string | null
  readonly pullRequest: ReviewedPullRequest | null

  constructor({ state, spec, findings, frozenOn, pullRequest }: {
    state: SpecFreezeStateValue,
    spec: EpicSpec | null,
    findings: FreezeFinding[],
    frozenOn: string | null,
    pullRequest: ReviewedPullRequest | null,
  }) {
    this.state = state
    this.spec = spec
    this.findings = findings
    this.frozenOn = frozenOn
    this.pullRequest = pullRequest
    Object.freeze(this)
  }
}

export class ReadSpecFreeze {
  readonly specs: EpicSpecs
  readonly branch: EpicBranch
  readonly pullRequests: PullRequests

  constructor({ specs, branch, pullRequests }: { specs: EpicSpecs, branch: EpicBranch, pullRequests: PullRequests }) {
    this.specs = specs
    this.branch = branch
    this.pullRequests = pullRequests
  }

  async execute(params: ReadSpecFreezeParams): Promise<SpecFreezeRead> {
    const spec = await this.specs.mostRecent(params.root)
    if (spec === null) {
      return new SpecFreezeRead({ state: SpecFreezeState.NO_SPEC, spec: null, findings: [], frozenOn: null, pullRequest: null })
    }

    if (!spec.isFrozen()) {
      return new SpecFreezeRead({
        state: SpecFreezeState.DRAFT, spec, findings: spec.findings(), frozenOn: null, pullRequest: null,
      })
    }

    const branch = await this.branch.current(params.root)
    const pullRequest = await this.pullRequests.openOfBranch({ branch, repository: params.repository })
    return new SpecFreezeRead({
      state: SpecFreezeState.FROZEN, spec, findings: [], frozenOn: spec.frozenOn(), pullRequest,
    })
  }
}
