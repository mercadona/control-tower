import { describe, it, expect } from 'vitest'
import {
  PublishReslicing, PublishReslicingParams, ReslicingOutcome,
} from '../../src/application/actions/publish-reslicing.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { Reslicing } from '../../src/domain/value-objects/reslicing.ts'
import { SpecRevision } from '../../src/domain/policies/spec-revision.ts'
import { createHash } from 'node:crypto'

type ReviewedPullRequest = { readonly number: number, readonly url: string }
type RereadAsked = { root: CheckoutRoot, spec: EpicSpec }
type CommitAsked = { root: CheckoutRoot, paths: string[], message: string }
type CommittedAsked = { root: CheckoutRoot, paths: string[] }
type PublishingAsked = { root: CheckoutRoot, milestone: string }
type OpenAsked = { repository: RepositoryName, branch: string, title: string, body: string }

class EpicSpecsDouble extends EpicSpecs {
  answer: EpicSpec | null
  held: EpicSpec | null
  mostRecentAsked: CheckoutRoot[]
  rereadAsked: RereadAsked[]
  rewriteAsked: number

  constructor(answer: EpicSpec | null) {
    super()
    this.answer = answer
    this.held = answer
    this.mostRecentAsked = []
    this.rereadAsked = []
    this.rewriteAsked = 0
  }

  static withTheBranchHolding(answer: EpicSpec, held: EpicSpec): EpicSpecsDouble {
    const double = new EpicSpecsDouble(answer)
    double.held = held

    return double
  }

  async mostRecent(root: CheckoutRoot): Promise<EpicSpec | null> {
    this.mostRecentAsked.push(root)
    return this.answer
  }

  async reread(subject: RereadAsked): Promise<EpicSpec | null> {
    this.rereadAsked.push(subject)
    return this.held
  }

  async rewrite(): Promise<void> {
    this.rewriteAsked += 1
  }
}

class EpicBranchDouble extends EpicBranch {
  publishingAsked: PublishingAsked[]
  committedAsked: CommittedAsked[]
  commitAsked: CommitAsked[]
  pushAsked: string[]
  isCommitted: boolean
  isPushed: boolean

  constructor({ isCommitted = false, isPushed = false }: { isCommitted?: boolean, isPushed?: boolean } = {}) {
    super()
    this.publishingAsked = []
    this.committedAsked = []
    this.commitAsked = []
    this.pushAsked = []
    this.isCommitted = isCommitted
    this.isPushed = isPushed
  }

  static withTheCorrectionAlreadyCommittedAndPushed(): EpicBranchDouble {
    return new EpicBranchDouble({ isCommitted: true, isPushed: true })
  }

  async publishing(subject: PublishingAsked): Promise<string> {
    this.publishingAsked.push(subject)
    return Mother.BRANCH
  }

  async committed(subject: CommittedAsked): Promise<boolean> {
    this.committedAsked.push(subject)
    return this.isCommitted
  }

  async commit(subject: CommitAsked): Promise<void> {
    this.commitAsked.push(subject)
  }

  async pushed(): Promise<boolean> {
    return this.isPushed
  }

  async push({ branch }: { root: CheckoutRoot, branch: string }): Promise<void> {
    this.pushAsked.push(branch)
  }
}

class PullRequestsDouble extends PullRequests {
  standing: ReviewedPullRequest | null
  openAsked: OpenAsked[]
  openOfBranchAsked: { branch: string, repository: RepositoryName }[]

  constructor(standing: ReviewedPullRequest | null) {
    super()
    this.standing = standing
    this.openAsked = []
    this.openOfBranchAsked = []
  }

  static withNoneOpen(): PullRequestsDouble {
    return new PullRequestsDouble(null)
  }

  static withOneAlreadyOpen(): PullRequestsDouble {
    return new PullRequestsDouble(Mother.STANDING)
  }

  async openOfBranch(subject: { branch: string, repository: RepositoryName }): Promise<ReviewedPullRequest | null> {
    this.openOfBranchAsked.push(subject)
    return this.standing
  }

  async open(subject: OpenAsked): Promise<ReviewedPullRequest> {
    this.openAsked.push(subject)
    return Mother.OPENED
  }
}

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly MILESTONE = 'Test epic'
  static readonly PATH = 'docs/superpowers/specs/2026-01-01-test-execution.md'
  static readonly MILESTONE_BRANCH = 'milestone/2026-01-01-test-execution'
  static readonly BRANCH = Mother.MILESTONE_BRANCH
  static readonly STANDING: ReviewedPullRequest = Object.freeze({
    number: 12, url: 'https://github.com/owner/name/pull/12',
  })

  static readonly REVISIONS = new SpecRevision({
    digest: (text) => createHash('sha1').update(text, 'utf8').digest('hex'),
  })

  static readonly OPENED: ReviewedPullRequest = Object.freeze({
    number: 13, url: 'https://github.com/owner/name/pull/13',
  })

  static frozen(slices = '| 1 | first |'): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        `# ${Mother.MILESTONE} — Execution spec`,
        '',
        '**Fecha de congelación:** 2026-09-14',
        '**Estado:** CONGELADA',
        '',
        '## 9. Slices',
        '',
        slices,
        '',
      ].join('\n'),
    })
  }

  static draft(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        `# ${Mother.MILESTONE} — Execution spec`,
        '',
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
      ].join('\n'),
    })
  }
}

class Flow {
  specs: EpicSpecsDouble
  branch: EpicBranchDouble
  pullRequests: PullRequestsDouble
  revisions: SpecRevision

  constructor({ specs, branch, pullRequests }: {
    specs?: EpicSpecsDouble,
    branch?: EpicBranchDouble,
    pullRequests?: PullRequestsDouble,
  } = {}) {
    this.specs = specs ?? new EpicSpecsDouble(Mother.frozen())
    this.branch = branch ?? new EpicBranchDouble()
    this.pullRequests = pullRequests ?? PullRequestsDouble.withNoneOpen()
    this.revisions = Mother.REVISIONS
  }

  static reading(spec: EpicSpec | null): Flow {
    return new Flow({ specs: new EpicSpecsDouble(spec) })
  }

  async run() {
    return new PublishReslicing(this).execute(new PublishReslicingParams({
      root: Mother.ROOT, repository: Mother.REPOSITORY,
    }))
  }
}

describe('PublishReslicing', () => {
  it('the correction is committed on the milestone branch, pushed, and announced in a pull request carrying the re-slicing marker', async () => {
    const flow = new Flow()

    const published = await flow.run()

    expect(published.outcome).toBe(ReslicingOutcome.PUBLISHED)
    expect(published.pullRequest).toEqual(Mother.OPENED)
    expect(flow.branch.publishingAsked).toEqual([{ root: Mother.ROOT, milestone: Mother.MILESTONE_BRANCH }])
    expect(flow.branch.commitAsked).toEqual([{
      root: Mother.ROOT,
      paths: [Mother.PATH],
      message: `Re-slice the execution spec of ${Mother.MILESTONE}`,
    }])
    expect(flow.branch.pushAsked).toEqual([Mother.BRANCH])
    expect(flow.pullRequests.openAsked).toHaveLength(1)
    const [opened] = flow.pullRequests.openAsked
    expect(opened.branch).toBe(Mother.BRANCH)
    const announced = new Reslicing({ path: Mother.PATH, revision: Mother.REVISIONS.of(Mother.frozen().text) })
    expect(opened.title).toBe(announced.titleOf(Mother.MILESTONE))
    expect(opened.body).toBe(announced.bodyFor(Mother.MILESTONE))
    expect(Reslicing.announcedIn(opened.body)).toEqual(announced)
    expect(flow.specs.rewriteAsked).toBe(0)
  })

  it('the revision it announces is the very text it publishes, so a later edit cannot inherit this approval', async () => {
    const held = Mother.frozen('| 1 | first, joined with the second |')
    const flow = new Flow({ specs: EpicSpecsDouble.withTheBranchHolding(Mother.frozen(), held) })

    await flow.run()

    const [opened] = flow.pullRequests.openAsked
    expect(Reslicing.announcedIn(opened.body)).toEqual(
      new Reslicing({ path: held.path, revision: Mother.REVISIONS.of(held.text) })
    )
    expect(Reslicing.announcedIn(opened.body)!.revision).not.toBe(Mother.REVISIONS.of(Mother.frozen().text))
  })

  it('a correction already committed and already travelling answers the pull request that is open instead of opening a second one', async () => {
    const flow = new Flow({
      branch: EpicBranchDouble.withTheCorrectionAlreadyCommittedAndPushed(),
      pullRequests: PullRequestsDouble.withOneAlreadyOpen(),
    })

    const published = await flow.run()

    expect(published.outcome).toBe(ReslicingOutcome.PUBLISHED)
    expect(published.pullRequest).toEqual(Mother.STANDING)
    expect(flow.branch.commitAsked).toEqual([])
    expect(flow.branch.pushAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('what the branch it switched to holds is what gets published, never the copy the press started from', async () => {
    const held = Mother.frozen('| 1 | first, joined with the second |')
    const flow = new Flow({ specs: EpicSpecsDouble.withTheBranchHolding(Mother.frozen(), held) })

    await flow.run()

    expect(flow.specs.rereadAsked).toEqual([{ root: Mother.ROOT, spec: flow.specs.answer }])
    expect(flow.branch.commitAsked[0].paths).toEqual([held.path])
    expect(flow.branch.committedAsked).toEqual([{ root: Mother.ROOT, paths: [held.path] }])
  })

  it('a spec that is not frozen is refused and nothing is committed, pushed or opened', async () => {
    const flow = Flow.reading(Mother.draft())

    const published = await flow.run()

    expect(published.outcome).toBe(ReslicingOutcome.NOT_FROZEN)
    expect(published.pullRequest).toBeNull()
    expect(flow.branch.publishingAsked).toEqual([])
    expect(flow.branch.commitAsked).toEqual([])
    expect(flow.branch.pushAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('a checkout with no execution spec is refused before any branch is resolved', async () => {
    const flow = Flow.reading(null)

    const published = await flow.run()

    expect(published.outcome).toBe(ReslicingOutcome.NO_SPEC)
    expect(flow.branch.publishingAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })
})
