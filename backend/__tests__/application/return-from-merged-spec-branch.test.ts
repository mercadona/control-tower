import { describe, it, expect } from 'vitest'
import {
  ReturnFromMergedSpecBranch, ReturnFromMergedSpecBranchParams, SpecBranchReturned,
} from '../../src/application/actions/return-from-merged-spec-branch.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { RemoteBranchFate } from '../../src/domain/value-objects/remote-branch-fate.ts'
import type { RemoteBranchFateValue } from '../../src/domain/value-objects/remote-branch-fate.ts'

type ReturnAsked = { root: CheckoutRoot, branch: string, merged: string }

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo/checkout')
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly DEFAULT = 'main'
  static readonly MILESTONE_BRANCH = 'milestone/STAFF-129-execution'
  static readonly MERGED_HEAD = '9f2c1d7a6b5e4c3d2a1f0e9d8c7b6a5f4e3d2c1b'
  static readonly LATER_COMMIT = '0123456789abcdef0123456789abcdef01234567'
}

class EpicBranchDouble extends EpicBranch {
  readonly on: string
  readonly tip: string
  readonly returnAsked: ReturnAsked[]

  constructor({ on = Mother.MILESTONE_BRANCH, tip = Mother.MERGED_HEAD }: { on?: string, tip?: string } = {}) {
    super()
    this.on = on
    this.tip = tip
    this.returnAsked = []
  }

  async current(): Promise<string> {
    return this.on
  }

  async defaultBranch(): Promise<string> {
    return Mother.DEFAULT
  }

  async tipOf({ branch }: { root: CheckoutRoot, branch: string }): Promise<string> {
    if (branch !== this.on) throw new Error(`asked the tip of ${branch}, not of the branch the checkout is on`)
    return this.tip
  }

  async returnToDefault(asked: ReturnAsked): Promise<RemoteBranchFateValue> {
    this.returnAsked.push(asked)
    return RemoteBranchFate.REMOVED
  }
}

class PullRequestsDouble extends PullRequests {
  readonly merged: string | null
  readonly stillOpen: { number: number, url: string } | null

  constructor({ merged = Mother.MERGED_HEAD, open = null }: {
    merged?: string | null, open?: { number: number, url: string } | null,
  } = {}) {
    super()
    this.merged = merged
    this.stillOpen = open
  }

  async mergedHeadOf({ branch, into }: { branch: string, repository: RepositoryName, into: string }): Promise<string | null> {
    if (branch !== Mother.MILESTONE_BRANCH || into !== Mother.DEFAULT) return null
    return this.merged
  }

  async openOfBranch(): Promise<{ number: number, url: string } | null> {
    return this.stillOpen
  }
}

class Returning {
  static async of(branch: EpicBranchDouble, pullRequests = new PullRequestsDouble()) {
    const returned = await new ReturnFromMergedSpecBranch({ branch, pullRequests })
      .execute(new ReturnFromMergedSpecBranchParams({ root: Mother.ROOT, repository: Mother.REPOSITORY }))

    return { returned, asked: branch.returnAsked }
  }
}

describe('ReturnFromMergedSpecBranch', () => {
  it('a checkout on a milestone branch whose pull request merged goes back to the default branch', async () => {
    const { returned, asked } = await Returning.of(new EpicBranchDouble())

    expect(asked).toEqual([{ root: Mother.ROOT, branch: Mother.MILESTONE_BRANCH, merged: Mother.MERGED_HEAD }])
    expect(returned).toEqual(new SpecBranchReturned({
      branch: Mother.MILESTONE_BRANCH, into: Mother.DEFAULT, remote: RemoteBranchFate.REMOVED,
    }))
  })

  it('a checkout on a branch Control Tower did not cut is left where it is', async () => {
    const { returned, asked } = await Returning.of(new EpicBranchDouble({ on: 'feature/my-own-work' }))

    expect(returned).toBeNull()
    expect(asked).toEqual([])
  })

  it('a milestone branch with no merged pull request is left where it is', async () => {
    const { returned, asked } = await Returning.of(new EpicBranchDouble(), new PullRequestsDouble({ merged: null }))

    expect(returned).toBeNull()
    expect(asked).toEqual([])
  })

  it('a milestone branch with another pull request still open is left where it is', async () => {
    const open = { number: 7, url: 'https://github.com/owner/name/pull/7' }

    const { returned, asked } = await Returning.of(new EpicBranchDouble(), new PullRequestsDouble({ open }))

    expect(returned).toBeNull()
    expect(asked).toEqual([])
  })

  it('a milestone branch with commits past the merged head is left where it is, because its work is not done', async () => {
    const { returned, asked } = await Returning.of(new EpicBranchDouble({ tip: Mother.LATER_COMMIT }))

    expect(returned).toBeNull()
    expect(asked).toEqual([])
  })
})
