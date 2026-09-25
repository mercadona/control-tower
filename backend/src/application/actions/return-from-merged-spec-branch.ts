import { EpicSpec } from '../../domain/value-objects/epic-spec.ts'
import type { EpicBranch } from '../../domain/ports/epic-branch.ts'
import type { PullRequests } from '../../domain/ports/pull-requests.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { RemoteBranchFateValue } from '../../domain/value-objects/remote-branch-fate.ts'

export class ReturnFromMergedSpecBranchParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName

  constructor({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }) {
    this.root = root
    this.repository = repository
    Object.freeze(this)
  }
}

export class SpecBranchReturned {
  readonly branch: string
  readonly into: string
  readonly remote: RemoteBranchFateValue

  constructor({ branch, into, remote }: { branch: string, into: string, remote: RemoteBranchFateValue }) {
    this.branch = branch
    this.into = into
    this.remote = remote
    Object.freeze(this)
  }
}

export class ReturnFromMergedSpecBranch {
  readonly branch: EpicBranch
  readonly pullRequests: PullRequests

  constructor({ branch, pullRequests }: { branch: EpicBranch, pullRequests: PullRequests }) {
    this.branch = branch
    this.pullRequests = pullRequests
  }

  async execute(params: ReturnFromMergedSpecBranchParams): Promise<SpecBranchReturned | null> {
    const on = await this.branch.current(params.root)
    if (!EpicSpec.namesAMilestoneBranch(on)) return null

    const into = await this.branch.defaultBranch(params.root)
    const merged = await this.pullRequests.mergedHeadOf({ branch: on, repository: params.repository, into })
    if (merged === null) return null
    if (await this.pullRequests.openOfBranch({ branch: on, repository: params.repository }) !== null) return null
    if (await this.branch.tipOf({ root: params.root, branch: on }) !== merged) return null

    const remote = await this.branch.returnToDefault({ root: params.root, branch: on, merged })

    return new SpecBranchReturned({ branch: on, into, remote })
  }
}
