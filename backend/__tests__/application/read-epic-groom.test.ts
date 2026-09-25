import { describe, it, expect } from 'vitest'
import { ReadEpicGroom, ReadEpicGroomParams, EpicGroomState } from '../../src/application/queries/read-epic-groom.ts'
import { EpicSpecsDouble } from '../epic-specs-double.ts'
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
import { SpecRevision } from '../../src/domain/policies/spec-revision.ts'
import { Reslicing } from '../../src/domain/value-objects/reslicing.ts'
import { createHash } from 'node:crypto'

type PublishedAsked = { repository: RepositoryName, spec: EpicSpec }
type IssuesAsked = { repository: RepositoryName, milestone: string }
type GroomAsked = { root: CheckoutRoot, spec: EpicSpec, repository: RepositoryName, milestone: string }
type PullRequestAsked = { branch: string, repository: RepositoryName }
type ReslicingAsked = { branch: string, repository: RepositoryName, approving: Reslicing, into: string }
type ReviewedPullRequest = { readonly number: number, readonly url: string }

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
  askedDefault: CheckoutRoot[]
  isCommitted: boolean
  askedCommitted: { root: CheckoutRoot, paths: string[] }[]

  constructor(isCommitted = true) {
    super()
    this.asked = []
    this.askedDefault = []
    this.isCommitted = isCommitted
    this.askedCommitted = []
  }

  static withTheSpecEdited(): EpicBranchDouble {
    return new EpicBranchDouble(false)
  }

  async current(root: CheckoutRoot): Promise<string> {
    this.asked.push(root)
    return Mother.BRANCH
  }

  async defaultBranch(root: CheckoutRoot): Promise<string> {
    this.askedDefault.push(root)
    return Mother.DEFAULT_BRANCH
  }

  async committed({ root, paths }: { root: CheckoutRoot, paths: string[] }): Promise<boolean> {
    this.askedCommitted.push({ root, paths })
    return this.isCommitted
  }
}

class PullRequestsDouble extends PullRequests {
  answer: ReviewedPullRequest | null
  merged: ReviewedPullRequest | null
  asked: PullRequestAsked[]
  mergedAsked: ReslicingAsked[]

  constructor(answer: ReviewedPullRequest | null, merged: ReviewedPullRequest | null = null) {
    super()
    this.answer = answer
    this.merged = merged
    this.asked = []
    this.mergedAsked = []
  }

  static withNoneOpen(): PullRequestsDouble {
    return new PullRequestsDouble(null)
  }

  static withAReslicingMerged(): PullRequestsDouble {
    return new PullRequestsDouble(null, Mother.RESLICING)
  }

  async openOfBranch(subject: PullRequestAsked): Promise<ReviewedPullRequest | null> {
    this.asked.push(subject)
    return this.answer
  }

  async mergedReslicingOf(subject: ReslicingAsked): Promise<ReviewedPullRequest | null> {
    this.mergedAsked.push(subject)
    return this.merged
  }
}

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly BRANCH = 'milestone/2026-01-01-test-execution'
  static readonly DEFAULT_BRANCH = 'main'
  static readonly REVISIONS = new SpecRevision({
    digest: (text) => createHash('sha1').update(text, 'utf8').digest('hex'),
  })
  static readonly PULL_REQUEST: ReviewedPullRequest = Object.freeze({
    number: 12, url: 'https://github.com/owner/name/pull/12',
  })

  static readonly RESLICING: ReviewedPullRequest = Object.freeze({
    number: 363, url: 'https://github.com/owner/name/pull/363',
  })
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly HOME = Mother.REPOSITORY.text
  static readonly PATH = 'docs/superpowers/specs/2026-01-01-test-execution.md'
  static readonly TITLE = 'Test epic'
  static readonly DESIGN_LINE = '**Handoff origen:** `docs/superpowers/specs/2026-01-01-test-design.md`'
  static readonly PLAN = new GroomPlan({
    home: Mother.HOME,
    milestone: Mother.TITLE,
    issues: [new GroomPlanIssue({ order: 1, title: '#1 First slice', labels: ['type:feature'], repo: Mother.HOME })],
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
    home: Mother.HOME,
    milestone: Mother.TITLE,
    issues: [
      new GroomPlanIssue({ order: 1, title: '#1 First slice', labels: ['type:feature'], repo: Mother.HOME }),
      new GroomPlanIssue({ order: 2, title: '#2 Second slice', labels: ['type:feature'], repo: Mother.HOME }),
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
  revisions: SpecRevision

  constructor({ specs, published, issues, groom, branch, pullRequests }: {
    specs?: EpicSpecsDouble,
    published?: PublishedSpecsDouble,
    issues?: EpicIssuesDouble,
    groom?: EpicGroomDouble,
    branch?: EpicBranchDouble,
    pullRequests?: PullRequestsDouble,
  } = {}) {
    this.specs = specs ?? new EpicSpecsDouble(null)
    this.published = published ?? new PublishedSpecsDouble(true)
    this.issues = issues ?? new EpicIssuesDouble([])
    this.groom = groom ?? new EpicGroomDouble(Mother.PLAN)
    this.branch = branch ?? new EpicBranchDouble()
    this.pullRequests = pullRequests ?? new PullRequestsDouble(Mother.PULL_REQUEST)
    this.fingerprint = Mother.FINGERPRINT
    this.revisions = Mother.REVISIONS
  }

  static readingSpec(spec: EpicSpec | null): Flow {
    return new Flow({ specs: new EpicSpecsDouble(spec) })
  }

  async run() {
    return new ReadEpicGroom(this).execute(new ReadEpicGroomParams({
      root: Mother.ROOT, repository: Mother.REPOSITORY, story: EpicSpecsDouble.STORY,
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

  it('a frozen spec the session edited and nobody committed is resliced, and the pull request is never asked for', async () => {
    const frozen = Mother.frozen()
    const flow = new Flow({
      specs: new EpicSpecsDouble(frozen),
      published: new PublishedSpecsDouble(false),
      branch: EpicBranchDouble.withTheSpecEdited(),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.RESLICED)
    expect(flow.branch.askedCommitted).toEqual([{ root: Mother.ROOT, paths: [frozen.path] }])
    expect(flow.pullRequests.asked).toEqual([])
    expect(read.pullRequest).toBeNull()
    expect(read.plan).toBeNull()
    expect(read.planFingerprint).toBeNull()
    expect(read.issues).toEqual([])
    expect(flow.issues.asked).toEqual([])
    expect(flow.groom.asked).toEqual([])
  })

  it('a frozen spec whose edit is already committed still waits for its pull request to merge', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      published: new PublishedSpecsDouble(false),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.AWAITING_PUBLICATION)
    expect(read.pullRequest).toEqual(Mother.PULL_REQUEST)
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

  it('a groomable milestone whose re-slicing already merged carries that pull request', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      pullRequests: PullRequestsDouble.withAReslicingMerged(),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.GROOMABLE)
    expect(read.reslicing).toEqual(Mother.RESLICING)
    expect(flow.pullRequests.mergedAsked).toEqual([{
      branch: Mother.BRANCH,
      repository: Mother.REPOSITORY,
      approving: new Reslicing({
        path: Mother.PATH, revision: Mother.REVISIONS.of(Mother.frozen().text),
      }),
      into: Mother.DEFAULT_BRANCH,
    }])
    expect(flow.pullRequests.asked).toEqual([])
  })

  it('the approval it looks for names this spec and the revision the default branch holds, not the branch alone', async () => {
    const frozen = Mother.frozen()
    const flow = new Flow({
      specs: new EpicSpecsDouble(frozen),
      pullRequests: PullRequestsDouble.withAReslicingMerged(),
    })

    await flow.run()

    const [asked] = flow.pullRequests.mergedAsked
    expect(asked.approving.path).toBe(frozen.path)
    expect(asked.approving.revision).toBe(Mother.REVISIONS.of(frozen.text))
    expect(asked.into).toBe(Mother.DEFAULT_BRANCH)
    expect(flow.branch.askedDefault).toEqual([Mother.ROOT])
  })

  it('a second milestone published from the same branch asks about its own spec, so the first approval cannot authorise it', async () => {
    const other = new EpicSpec({
      path: 'docs/superpowers/specs/2026-02-02-another-execution.md',
      text: Mother.frozen().text.replace(Mother.TITLE, 'Another epic'),
    })
    const flow = new Flow({
      specs: new EpicSpecsDouble(other),
      pullRequests: PullRequestsDouble.withAReslicingMerged(),
    })

    await flow.run()

    const [asked] = flow.pullRequests.mergedAsked
    expect(asked.branch).toBe(Mother.BRANCH)
    expect(asked.approving).toEqual(new Reslicing({ path: other.path, revision: Mother.REVISIONS.of(other.text) }))
    expect(asked.approving.approves(
      new Reslicing({ path: Mother.PATH, revision: Mother.REVISIONS.of(Mother.frozen().text) })
    )).toBe(false)
  })

  it('a groomable milestone nobody re-sliced carries no pull request to authorise it', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      pullRequests: PullRequestsDouble.withNoneOpen(),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.GROOMABLE)
    expect(read.reslicing).toBeNull()
  })

  it('a groomed milestone is never asked which merge authorised it, because its issues already exist', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      issues: new EpicIssuesDouble([Mother.backlogIssue()]),
      pullRequests: PullRequestsDouble.withAReslicingMerged(),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.GROOMED)
    expect(read.reslicing).toBeNull()
    expect(flow.pullRequests.mergedAsked).toEqual([])
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
