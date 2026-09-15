import { describe, it, expect } from 'vitest'
import { ReadEpicGroom, ReadEpicGroomParams, EpicGroomState } from '../../src/application/queries/read-epic-groom.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { PublishedSpecs } from '../../src/domain/ports/published-specs.ts'
import { EpicIssues } from '../../src/domain/ports/epic-issues.ts'
import { EpicGroom } from '../../src/domain/ports/epic-groom.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { EpicIssue } from '../../src/domain/value-objects/epic-issue.ts'
import { EpicIssuesListing } from '../../src/domain/value-objects/epic-issues-listing.ts'
import { GroomPlan, GroomPlanIssue } from '../../src/domain/value-objects/groom-plan.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import { PlanFingerprint } from '../../src/domain/policies/plan-fingerprint.ts'

type PublishedAsked = { repository: RepositoryName, spec: EpicSpec }
type IssuesAsked = { repository: RepositoryName, milestone: string }
type GroomAsked = { root: CheckoutRoot, spec: EpicSpec, repository: RepositoryName, milestone: string }
type PullRequestAsked = { branch: string, repository: RepositoryName }
type ReviewedPullRequest = { readonly number: number, readonly url: string }

class EpicSpecsDouble extends EpicSpecs {
  answer: EpicSpec | null
  asked: CheckoutRoot[]

  constructor(answer: EpicSpec | null) {
    super()
    this.answer = answer
    this.asked = []
  }

  async mostRecent(root: CheckoutRoot): Promise<EpicSpec | null> {
    this.asked.push(root)
    return this.answer
  }
}

class PublishedSpecsDouble extends PublishedSpecs {
  answer: boolean
  asked: PublishedAsked[]

  constructor(answer: boolean) {
    super()
    this.answer = answer
    this.asked = []
  }

  async holds(subject: PublishedAsked): Promise<boolean> {
    this.asked.push(subject)
    return this.answer
  }
}

class EpicIssuesDouble extends EpicIssues {
  answer: EpicIssuesListing
  asked: IssuesAsked[]

  constructor(issues: EpicIssue[]) {
    super()
    this.answer = new EpicIssuesListing({ issues, exhausted: true, reason: null })
    this.asked = []
  }

  static uncertain(reason: string): EpicIssuesDouble {
    const double = new EpicIssuesDouble([])
    double.answer = new EpicIssuesListing({ issues: [], exhausted: false, reason })
    return double
  }

  async listOf(subject: IssuesAsked): Promise<EpicIssuesListing> {
    this.asked.push(subject)
    return this.answer
  }
}

class EpicGroomDouble extends EpicGroom {
  answer: GroomPlan
  asked: GroomAsked[]

  constructor(answer: GroomPlan) {
    super()
    this.answer = answer
    this.asked = []
  }

  async planned(subject: GroomAsked): Promise<GroomPlan> {
    this.asked.push(subject)
    return this.answer
  }
}

class EpicBranchDouble extends EpicBranch {
  asked: CheckoutRoot[]

  constructor() {
    super()
    this.asked = []
  }

  async current(root: CheckoutRoot): Promise<string> {
    this.asked.push(root)
    return Mother.BRANCH
  }
}

class PullRequestsDouble extends PullRequests {
  answer: ReviewedPullRequest | null
  asked: PullRequestAsked[]

  constructor(answer: ReviewedPullRequest | null) {
    super()
    this.answer = answer
    this.asked = []
  }

  static withNoneOpen(): PullRequestsDouble {
    return new PullRequestsDouble(null)
  }

  async openOfBranch(subject: PullRequestAsked): Promise<ReviewedPullRequest | null> {
    this.asked.push(subject)
    return this.answer
  }
}

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly BRANCH = 'milestone/2026-01-01-test-execution'
  static readonly PULL_REQUEST: ReviewedPullRequest = Object.freeze({
    number: 12, url: 'https://github.com/owner/name/pull/12',
  })
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly PATH = 'docs/superpowers/specs/2026-01-01-test-execution.md'
  static readonly TITLE = 'Test epic'
  static readonly DESIGN_LINE = '**Handoff origen:** `docs/superpowers/specs/2026-01-01-test-design.md`'
  static readonly PLAN = new GroomPlan({
    milestone: Mother.TITLE,
    issues: [new GroomPlanIssue({ order: 1, title: '#1 First slice', labels: ['type:feature'] })],
  })
  static readonly FINGERPRINT = new PlanFingerprint({ digest: (text) => text })

  static draft(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        `# ${Mother.TITLE} — Execution spec`,
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
      ].join('\n'),
    })
  }

  static frozen(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        `# ${Mother.TITLE} — Execution spec`,
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** 2026-09-14',
        '**Estado:** CONGELADA',
        '',
      ].join('\n'),
    })
  }

  static backlogIssue(): EpicIssue {
    return new EpicIssue({
      number: 1,
      url: 'https://github.com/owner/name/issues/1',
      title: 'wears status:backlog and stays open',
      status: PlanIssueStatus.BACKLOG,
      isOpen: true,
      order: 1,
    })
  }

  static readyIssue(): EpicIssue {
    return new EpicIssue({
      number: 2,
      url: 'https://github.com/owner/name/issues/2',
      title: 'already promoted to status:ready',
      status: PlanIssueStatus.READY,
      isOpen: true,
      order: 2,
    })
  }

  static closedBacklogIssue(): EpicIssue {
    return new EpicIssue({
      number: 3,
      url: 'https://github.com/owner/name/issues/3',
      title: 'closed while still wearing status:backlog',
      status: PlanIssueStatus.BACKLOG,
      isOpen: false,
      order: 1,
    })
  }

  static issueOfOrder(order: number): EpicIssue {
    return new EpicIssue({
      number: order,
      url: `https://github.com/owner/name/issues/${order}`,
      title: `slice #${order}, groomed`,
      status: PlanIssueStatus.BACKLOG,
      isOpen: true,
      order,
    })
  }

  static readonly TWO_SLICE_PLAN = new GroomPlan({
    milestone: Mother.TITLE,
    issues: [
      new GroomPlanIssue({ order: 1, title: '#1 First slice', labels: ['type:feature'] }),
      new GroomPlanIssue({ order: 2, title: '#2 Second slice', labels: ['type:feature'] }),
    ],
  })
}

class Flow {
  specs: EpicSpecsDouble
  published: PublishedSpecsDouble
  issues: EpicIssuesDouble
  groom: EpicGroomDouble
  branch: EpicBranchDouble
  pullRequests: PullRequestsDouble
  fingerprint: PlanFingerprint

  constructor({ specs, published, issues, groom, pullRequests }: {
    specs?: EpicSpecsDouble,
    published?: PublishedSpecsDouble,
    issues?: EpicIssuesDouble,
    groom?: EpicGroomDouble,
    pullRequests?: PullRequestsDouble,
  } = {}) {
    this.specs = specs ?? new EpicSpecsDouble(null)
    this.published = published ?? new PublishedSpecsDouble(true)
    this.issues = issues ?? new EpicIssuesDouble([])
    this.groom = groom ?? new EpicGroomDouble(Mother.PLAN)
    this.branch = new EpicBranchDouble()
    this.pullRequests = pullRequests ?? new PullRequestsDouble(Mother.PULL_REQUEST)
    this.fingerprint = Mother.FINGERPRINT
  }

  static readingSpec(spec: EpicSpec | null): Flow {
    return new Flow({ specs: new EpicSpecsDouble(spec) })
  }

  async run() {
    return new ReadEpicGroom(this).execute(new ReadEpicGroomParams({
      root: Mother.ROOT, repository: Mother.REPOSITORY,
    }))
  }
}

describe('ReadEpicGroom', () => {
  it('a frozen spec whose committed copy is not on the default branch waits, carrying the pull request it waits for', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      published: new PublishedSpecsDouble(false),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.AWAITING_PUBLICATION)
    expect(read.pullRequest).toEqual(Mother.PULL_REQUEST)
    expect(flow.branch.asked).toEqual([Mother.ROOT])
    expect(flow.pullRequests.asked).toEqual([{ branch: Mother.BRANCH, repository: Mother.REPOSITORY }])
    expect(read.plan).toBeNull()
    expect(read.planFingerprint).toBeNull()
    expect(read.issues).toEqual([])
    expect(flow.issues.asked).toEqual([])
    expect(flow.groom.asked).toEqual([])
  })

  it('a wait whose branch has no open pull request is still a wait, with nothing to link', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      published: new PublishedSpecsDouble(false),
      pullRequests: PullRequestsDouble.withNoneOpen(),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.AWAITING_PUBLICATION)
    expect(read.pullRequest).toBeNull()
  })

  it('a listing that could not be exhausted is issues-uncertain, carries why, and the plan is never asked', async () => {
    const frozen = Mother.frozen()
    const reason = 'gh issue list answered exactly as many issues as it was asked for at every limit up to the ' +
      'ceiling: the milestone may hold more issues than this backend could read'
    const flow = new Flow({
      specs: new EpicSpecsDouble(frozen),
      issues: EpicIssuesDouble.uncertain(reason),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.ISSUES_UNCERTAIN)
    expect(read.reason).toBe(reason)
    expect(read.milestone).toBe(Mother.TITLE)
    expect(read.plan).toBeNull()
    expect(read.planFingerprint).toBeNull()
    expect(read.issues).toEqual([])
    expect(flow.groom.asked).toEqual([])
  })

  it('a frozen and published spec with an empty milestone is groomable and carries what would be created', async () => {
    const frozen = Mother.frozen()
    const flow = new Flow({
      specs: new EpicSpecsDouble(frozen),
      published: new PublishedSpecsDouble(true),
      issues: new EpicIssuesDouble([]),
      groom: new EpicGroomDouble(Mother.PLAN),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.GROOMABLE)
    expect(read.plan).toBe(Mother.PLAN)
    expect(read.planFingerprint).toBe(Mother.FINGERPRINT.of(Mother.PLAN))
    expect(flow.issues.asked).toEqual([{ repository: Mother.REPOSITORY, milestone: Mother.TITLE }])
    expect(flow.groom.asked).toEqual([{
      root: Mother.ROOT, spec: frozen, repository: Mother.REPOSITORY, milestone: Mother.TITLE,
    }])
    expect(flow.pullRequests.asked).toEqual([])
  })

  it('the plan fingerprint follows the plan it summarises, so a plan with different issues reads as a different fingerprint', async () => {
    const frozen = Mother.frozen()
    const flow = new Flow({
      specs: new EpicSpecsDouble(frozen),
      groom: new EpicGroomDouble(Mother.TWO_SLICE_PLAN),
    })

    const read = await flow.run()

    expect(read.planFingerprint).toBe(Mother.FINGERPRINT.of(Mother.TWO_SLICE_PLAN))
    expect(read.planFingerprint).not.toBe(Mother.FINGERPRINT.of(Mother.PLAN))
  })

  it('publication is asked about the spec this checkout holds, so its content decides and not its path', async () => {
    const frozen = Mother.frozen()
    const flow = new Flow({ specs: new EpicSpecsDouble(frozen) })

    await flow.run()

    expect(flow.published.asked).toEqual([{ repository: Mother.REPOSITORY, spec: frozen }])
    expect(flow.published.asked[0].spec.text).toBe(frozen.text)
  })

  it('no execution spec is no-spec and nothing is asked of github', async () => {
    const flow = Flow.readingSpec(null)

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.NO_SPEC)
    expect(flow.published.asked).toEqual([])
    expect(flow.issues.asked).toEqual([])
    expect(flow.groom.asked).toEqual([])
  })

  it('a spec that is not frozen is draft and nothing is asked of github', async () => {
    const flow = Flow.readingSpec(Mother.draft())

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.DRAFT)
    expect(flow.published.asked).toEqual([])
    expect(flow.issues.asked).toEqual([])
    expect(flow.groom.asked).toEqual([])
  })

  it('a milestone holding every planned order is groomed, and the plan is still asked and carried', async () => {
    const frozen = Mother.frozen()
    const flow = new Flow({
      specs: new EpicSpecsDouble(frozen),
      issues: new EpicIssuesDouble([Mother.backlogIssue(), Mother.readyIssue()]),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.GROOMED)
    expect(read.plan).toBe(Mother.PLAN)
    expect(read.planFingerprint).toBe(Mother.FINGERPRINT.of(Mother.PLAN))
    expect(read.issues).toEqual([Mother.backlogIssue(), Mother.readyIssue()])
    expect(flow.groom.asked).toEqual([{
      root: Mother.ROOT, spec: frozen, repository: Mother.REPOSITORY, milestone: Mother.TITLE,
    }])
  })

  it('a milestone holding every planned order, all promoted, is authorised and still carries the plan', async () => {
    const frozen = Mother.frozen()
    const flow = new Flow({
      specs: new EpicSpecsDouble(frozen),
      issues: new EpicIssuesDouble([Mother.readyIssue(), Mother.closedBacklogIssue()]),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.AUTHORISED)
    expect(read.plan).toBe(Mother.PLAN)
    expect(read.planFingerprint).toBe(Mother.FINGERPRINT.of(Mother.PLAN))
    expect(read.issues).toEqual([Mother.readyIssue(), Mother.closedBacklogIssue()])
    expect(flow.groom.asked).toEqual([{
      root: Mother.ROOT, spec: frozen, repository: Mother.REPOSITORY, milestone: Mother.TITLE,
    }])
  })

  it('a milestone missing a planned order is partially groomed, not groomed: an order absent from every held issue is a slice the groom never finished creating', async () => {
    const frozen = Mother.frozen()
    const flow = new Flow({
      specs: new EpicSpecsDouble(frozen),
      issues: new EpicIssuesDouble([Mother.issueOfOrder(1)]),
      groom: new EpicGroomDouble(Mother.TWO_SLICE_PLAN),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.PARTIALLY_GROOMED)
    expect(read.plan).toBe(Mother.TWO_SLICE_PLAN)
    expect(read.planFingerprint).toBe(Mother.FINGERPRINT.of(Mother.TWO_SLICE_PLAN))
    expect(read.issues).toEqual([Mother.issueOfOrder(1)])
  })

  it('an issue with no ct-order marker at all never counts towards a planned order, so a milestone holding only that issue still reads as partially groomed', async () => {
    const frozen = Mother.frozen()
    const unmarked = new EpicIssue({
      number: 9, url: 'https://github.com/owner/name/issues/9', title: 'renamed away from its plan title',
      status: PlanIssueStatus.BACKLOG, isOpen: true, order: null,
    })
    const flow = new Flow({
      specs: new EpicSpecsDouble(frozen),
      issues: new EpicIssuesDouble([unmarked]),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.PARTIALLY_GROOMED)
  })

  it('a renamed issue is still matched by its ct-order marker, not its title, so it is not read as missing', async () => {
    const frozen = Mother.frozen()
    const renamed = new EpicIssue({
      number: 1, url: 'https://github.com/owner/name/issues/1', title: 'a title nobody planned',
      status: PlanIssueStatus.BACKLOG, isOpen: true, order: 1,
    })
    const flow = new Flow({
      specs: new EpicSpecsDouble(frozen),
      issues: new EpicIssuesDouble([renamed]),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.GROOMED)
  })
})
