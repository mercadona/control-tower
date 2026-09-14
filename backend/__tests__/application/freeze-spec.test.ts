import { describe, it, expect } from 'vitest'
import { FreezeSpec, FreezeSpecParams, FreezeOutcome } from '../../src/application/actions/freeze-spec.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { FreezeFinding, FreezeFindingCode } from '../../src/domain/value-objects/freeze-finding.ts'
import { EpicSpecNotUnderstood } from '../../src/domain/exceptions.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

type RewriteAsked = { root: CheckoutRoot, spec: EpicSpec, text: string }

type PublishAsked = { root: CheckoutRoot, paths: string[], message: string }

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
  publishAsked: PublishAsked[]

  constructor(answer: string) {
    super()
    this.answer = answer
    this.publishAsked = []
  }

  async publish(subject: PublishAsked): Promise<string> {
    this.publishAsked.push(subject)
    return this.answer
  }
}

class PullRequestsDouble extends PullRequests {
  answer: ReviewedPullRequest
  openAsked: OpenAsked[]

  constructor(answer: ReviewedPullRequest) {
    super()
    this.answer = answer
    this.openAsked = []
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
    expect(flow.branch.publishAsked).toEqual([])
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
    expect(flow.branch.publishAsked).toEqual([
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
    expect(flow.branch.publishAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('a spec already frozen is refused instead of being frozen twice', async () => {
    const flow = Flow.freezing(Mother.frozen())

    const frozen = await flow.run()

    expect(frozen.outcome).toBe(FreezeOutcome.ALREADY_FROZEN)
    expect(frozen.findings).toEqual([])
    expect(frozen.on).toBeNull()
    expect(frozen.pullRequest).toBeNull()
    expect(flow.specs.rewriteAsked).toEqual([])
    expect(flow.branch.publishAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })

  it('a spec that names no design document raises instead of publishing half the epic', async () => {
    const flow = Flow.freezing(Mother.draftWithNoDesign())

    await expect(flow.run()).rejects.toThrow(EpicSpecNotUnderstood)
    expect(flow.specs.rewriteAsked).toEqual([])
    expect(flow.branch.publishAsked).toEqual([])
    expect(flow.pullRequests.openAsked).toEqual([])
  })
})
