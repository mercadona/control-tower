import { describe, it, expect } from 'vitest'
import { FreezeSpec, FreezeSpecParams, FreezeOutcome } from '../../src/application/actions/freeze-spec.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { FreezeFinding, FreezeFindingCode } from '../../src/domain/value-objects/freeze-finding.ts'
import { EpicSpecNotUnderstood, EpicBranchNotPublished } from '../../src/domain/exceptions.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

type RewriteAsked = { root: CheckoutRoot, spec: EpicSpec, text: string }

type CommitAsked = { root: CheckoutRoot, paths: string[], message: string }

type OpenAsked = { repository: RepositoryName, branch: string, title: string, body: string }

class EpicSpecsDouble extends EpicSpecs {
  answer: EpicSpec | null
  mostRecentAsked: CheckoutRoot[]
  rewriteAsked: RewriteAsked[]

  constructor(answer: EpicSpec | null) {
    super()
    this.answer = answer
    this.mostRecentAsked = []
    this.rewriteAsked = []
  }

  async mostRecent(root: CheckoutRoot): Promise<EpicSpec | null> {
    this.mostRecentAsked.push(root)
    return this.answer
  }

  async rewrite(subject: RewriteAsked): Promise<void> {
    this.rewriteAsked.push(subject)
  }
}

class EpicBranchDouble extends EpicBranch {
  answer: string
  publishableAsked: CheckoutRoot[]
  commitAsked: CommitAsked[]
  pushAsked: string[]
  isCommitted: boolean
  isPushed: boolean
  commitRefusal: Error | null
  commitLands: boolean
  pushRefusal: Error | null
  readonly #refusal: Error | null

  constructor(answer: string, refusal: Error | null = null) {
    super()
    this.answer = answer
    this.publishableAsked = []
    this.commitAsked = []
    this.pushAsked = []
    this.isCommitted = false
    this.isPushed = false
    this.commitRefusal = null
    this.commitLands = false
    this.pushRefusal = null
    this.#refusal = refusal
  }

  static refusingTheDefaultBranch(): EpicBranchDouble {
    return new EpicBranchDouble('main', new EpicBranchNotPublished('/repo sits on main'))
  }

  static refusingToPush(): EpicBranchDouble {
    const refusing = new EpicBranchDouble(Mother.BRANCH)
    refusing.pushRefusal = new EpicBranchNotPublished('git push refused: no upstream')

    return refusing
  }

  static refusingToCommit(): EpicBranchDouble {
    const refusing = new EpicBranchDouble(Mother.BRANCH)
    refusing.commitRefusal = new EpicBranchNotPublished('git commit refused: a hook said no')

    return refusing
  }

  static committingAndThenFailing(): EpicBranchDouble {
    const landed = new EpicBranchDouble(Mother.BRANCH)
    landed.commitRefusal = new EpicBranchNotPublished('the commit landed and git still reported a failure')
    landed.commitLands = true

    return landed
  }

  static withTheFreezeCommittedAndNotPushed(): EpicBranchDouble {
    const resuming = new EpicBranchDouble(Mother.BRANCH)
    resuming.isCommitted = true

    return resuming
  }

  static withTheFreezeDelivered(): EpicBranchDouble {
    const done = new EpicBranchDouble(Mother.BRANCH)
    done.isCommitted = true
    done.isPushed = true

    return done
  }

  async publishable(root: CheckoutRoot): Promise<string> {
    this.publishableAsked.push(root)
    if (this.#refusal !== null) throw this.#refusal
    return this.answer
  }

  async committed(): Promise<boolean> {
    return this.isCommitted
  }

  async commit(subject: CommitAsked): Promise<void> {
    this.commitAsked.push(subject)
    if (this.commitLands) this.isCommitted = true
    if (this.commitRefusal !== null) throw this.commitRefusal
    this.isCommitted = true
  }

  async pushed(): Promise<boolean> {
    return this.isPushed
  }

  async push({ branch }: { root: CheckoutRoot, branch: string }): Promise<void> {
    this.pushAsked.push(branch)
    if (this.pushRefusal !== null) throw this.pushRefusal
    this.isPushed = true
  }
}

class PullRequestsDouble extends PullRequests {
  answer: ReviewedPullRequest
  openAsked: OpenAsked[]
  standing: ReviewedPullRequest | null

  constructor(answer: ReviewedPullRequest, standing: ReviewedPullRequest | null = null) {
    super()
    this.answer = answer
    this.openAsked = []
    this.standing = standing
  }

  static alreadyOpen(): PullRequestsDouble {
    return new PullRequestsDouble(Mother.PULL_REQUEST, Mother.PULL_REQUEST)
  }

  async openOfBranch(): Promise<ReviewedPullRequest | null> {
    return this.standing
  }

  async open(subject: OpenAsked): Promise<ReviewedPullRequest> {
    this.openAsked.push(subject)
    return this.answer
  }
}

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly BRANCH = 'epic/329-freeze'
  static readonly TODAY = () => new Date(2026, 8, 14)
  static readonly ON = '2026-09-14'
  static readonly PULL_REQUEST: ReviewedPullRequest = Object.freeze({
    number: 12, url: 'https://github.com/owner/name/pull/12',
  })
  static readonly PATH = 'docs/superpowers/specs/2026-01-01-test-execution.md'
  static readonly DESIGN_PATH = 'docs/superpowers/specs/2026-01-01-test-design.md'
  static readonly DESIGN_LINE = '**Handoff origen:** `docs/superpowers/specs/2026-01-01-test-design.md`'
  static readonly TITLE_LINE = '# Test epic — Execution spec'
  static readonly BET_LINE = '**The bet:** shipping this halves the time to freeze a spec.'

  static draftWithPendingClarification(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        Mother.TITLE_LINE,
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
        '## Hipótesis',
        '',
        '- [NEEDS CLARIFICATION: who commits the freeze?]',
        Mother.BET_LINE,
        '',
      ].join('\n'),
    })
  }

  static draftFreezable(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        Mother.TITLE_LINE,
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
        '## Hipótesis',
        '',
        Mother.BET_LINE,
        '',
      ].join('\n'),
    })
  }

  static frozenText(on: string): string {
    return [
      Mother.TITLE_LINE,
      '',
      Mother.DESIGN_LINE,
      `**Fecha de congelación:** ${on}`,
      '**Estado:** CONGELADA',
      '',
      '## Hipótesis',
      '',
      Mother.BET_LINE,
      '',
    ].join('\n')
  }

  static expectedBody(on: string): string {
    return [
      `The epic's two documents, with the execution spec frozen on ${on}.`,
      '',
      `- ${Mother.DESIGN_PATH}`,
      `- ${Mother.PATH}`,
      '',
      "Control Tower's gate 1 wrote the state line and committed both. The groom stays refused until this pull request merges.",
    ].join('\n')
  }

  static frozen(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        Mother.TITLE_LINE,
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** 2026-09-01',
        '**Estado:** CONGELADA',
        '',
        '## Hipótesis',
        '',
        Mother.BET_LINE,
        '',
      ].join('\n'),
    })
  }

  static draftWithNoDesign(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        Mother.TITLE_LINE,
        '',
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
        '## Hipótesis',
        '',
        Mother.BET_LINE,
        '',
      ].join('\n'),
    })
  }
}

class Flow {
  specs: EpicSpecsDouble
  branch: EpicBranchDouble
  pullRequests: PullRequestsDouble
  now: () => Date

  constructor({ specs, branch, pullRequests, now }: {
    specs?: EpicSpecsDouble,
    branch?: EpicBranchDouble,
    pullRequests?: PullRequestsDouble,
    now?: () => Date,
  } = {}) {
    this.specs = specs ?? new EpicSpecsDouble(null)
    this.branch = branch ?? new EpicBranchDouble(Mother.BRANCH)
    this.pullRequests = pullRequests ?? new PullRequestsDouble(Mother.PULL_REQUEST)
    this.now = now ?? Mother.TODAY
  }

  static freezing(spec: EpicSpec | null): Flow {
    return new Flow({ specs: new EpicSpecsDouble(spec) })
  }

  async run() {
    return new FreezeSpec(this).execute(new FreezeSpecParams({ root: Mother.ROOT, repository: Mother.REPOSITORY }))
  }
}

describe('FreezeSpec', () => {
  it('a spec with a pending clarification marker is refused and nothing is written, committed, pushed or opened', async () => {
    const flow = Flow.freezing(Mother.draftWithPendingClarification())

    const frozen = await flow.run()

    expect(frozen.outcome).toBe(FreezeOutcome.NOT_FREEZABLE)
    expect(frozen.findings).toEqual([
      new FreezeFinding({
        code: FreezeFindingCode.CLARIFICATION_MARKER,
        line: 9,
        detail: '- [NEEDS CLARIFICATION: who commits the freeze?]',
      }),
    ])
    expect(frozen.on).toBeNull()
    expect(frozen.pullRequest).toBeNull()
    expect(flow.specs.rewriteAsked).toEqual([])
    expect(flow.branch.commitAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('writes the state line with today date, commits both documents, pushes and opens the pull request', async () => {
    const spec = Mother.draftFreezable()
    const flow = Flow.freezing(spec)

    const frozen = await flow.run()

    expect(frozen.outcome).toBe(FreezeOutcome.FROZEN)
    expect(frozen.findings).toEqual([])
    expect(frozen.on).toBe('2026-09-14')
    expect(frozen.pullRequest).toEqual(Mother.PULL_REQUEST)

    expect(flow.specs.rewriteAsked).toEqual([
      { root: Mother.ROOT, spec, text: Mother.frozenText('2026-09-14') },
    ])
    expect(flow.branch.commitAsked).toEqual([
      {
        root: Mother.ROOT,
        paths: [Mother.DESIGN_PATH, Mother.PATH],
        message: 'Freeze the execution spec of Test epic (2026-09-14)',
      },
    ])
    expect(flow.pullRequests.openAsked).toEqual([
      {
        repository: Mother.REPOSITORY,
        branch: Mother.BRANCH,
        title: 'Test epic — design and execution spec',
        body: Mother.expectedBody('2026-09-14'),
      },
    ])
  })

  it('a checkout with no execution spec answers no-spec and writes nothing', async () => {
    const flow = Flow.freezing(null)

    const frozen = await flow.run()

    expect(frozen.outcome).toBe(FreezeOutcome.NO_SPEC)
    expect(frozen.findings).toEqual([])
    expect(frozen.on).toBeNull()
    expect(frozen.pullRequest).toBeNull()
    expect(flow.specs.rewriteAsked).toEqual([])
    expect(flow.branch.commitAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('the branch is vouched for before the state line is written, so a refused publish leaves the spec untouched', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.draftFreezable()),
      branch: EpicBranchDouble.refusingTheDefaultBranch(),
    })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(EpicBranchNotPublished)
    expect(flow.branch.publishableAsked).toEqual([Mother.ROOT])
    expect(flow.specs.rewriteAsked).toEqual([])
    expect(flow.branch.commitAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('a commit that fails after the state line is written puts the spec back as it was', async () => {
    const spec = Mother.draftFreezable()
    const flow = new Flow({ specs: new EpicSpecsDouble(spec), branch: EpicBranchDouble.refusingToCommit() })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(EpicBranchNotPublished)
    expect(flow.specs.rewriteAsked.at(-1)!.text).toBe(spec.text)
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('a push that fails leaves the file agreeing with the commit instead of putting it back', async () => {
    const spec = Mother.draftFreezable()
    const flow = new Flow({ specs: new EpicSpecsDouble(spec), branch: EpicBranchDouble.refusingToPush() })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(EpicBranchNotPublished)
    expect(flow.specs.rewriteAsked.at(-1)!.text).toBe(spec.frozenAt(Mother.ON))
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('a commit that landed and still reported a failure leaves the file frozen, because the commit says frozen', async () => {
    const spec = Mother.draftFreezable()
    const flow = new Flow({
      specs: new EpicSpecsDouble(spec),
      branch: EpicBranchDouble.committingAndThenFailing(),
    })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(EpicBranchNotPublished)
    expect(flow.specs.rewriteAsked.at(-1)!.text).toBe(spec.frozenAt(Mother.ON))
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('a freeze whose push failed resumes at the push when it is pressed again', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      branch: EpicBranchDouble.withTheFreezeCommittedAndNotPushed(),
    })

    const frozen = await flow.run()

    expect(frozen.outcome).toBe(FreezeOutcome.FROZEN)
    expect(flow.specs.rewriteAsked).toEqual([])
    expect(flow.branch.commitAsked).toEqual([])
    expect(flow.branch.pushAsked).toEqual([Mother.BRANCH])
    expect(frozen.pullRequest).toEqual(Mother.PULL_REQUEST)
  })

  it('a freeze pressed again after it fully succeeded says it is already frozen', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      branch: EpicBranchDouble.withTheFreezeDelivered(),
      pullRequests: PullRequestsDouble.alreadyOpen(),
    })

    const frozen = await flow.run()

    expect(frozen.outcome).toBe(FreezeOutcome.ALREADY_FROZEN)
    expect(flow.specs.rewriteAsked).toEqual([])
    expect(flow.branch.commitAsked).toEqual([])
    expect(flow.branch.pushAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('a spec that names no design document raises instead of publishing half the epic', async () => {
    const flow = Flow.freezing(Mother.draftWithNoDesign())

    await expect(flow.run()).rejects.toThrow(EpicSpecNotUnderstood)
    expect(flow.specs.rewriteAsked).toEqual([])
    expect(flow.branch.commitAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })
})
