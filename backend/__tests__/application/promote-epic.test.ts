import { describe, it, expect } from 'vitest'
import { PreparationMother } from '../preparation-mother.ts'
import { PromoteEpic, PromoteEpicParams } from '../../src/application/actions/promote-epic.ts'
import { ReadEpicGroom, ReadEpicGroomParams, EpicGroomRead, EpicGroomState } from '../../src/application/queries/read-epic-groom.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { PublishedSpecs } from '../../src/domain/ports/published-specs.ts'
import { EpicIssues } from '../../src/domain/ports/epic-issues.ts'
import { EpicGroom } from '../../src/domain/ports/epic-groom.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { EpicIssue } from '../../src/domain/value-objects/epic-issue.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import { GroomPlan, GroomPlanIssue } from '../../src/domain/value-objects/groom-plan.ts'
import { PlanFingerprint } from '../../src/domain/policies/plan-fingerprint.ts'
import { SpecRevision } from '../../src/domain/policies/spec-revision.ts'
import { createHash } from 'node:crypto'

type PromoteAsked = { repository: RepositoryName, issue: EpicIssue }

class ReadEpicGroomDouble extends ReadEpicGroom {
  answers: EpicGroomRead[]
  asked: ReadEpicGroomParams[]

  constructor(answers: EpicGroomRead[]) {
    super({
      specs: new EpicSpecs(), published: new PublishedSpecs(), issues: new EpicIssues(), groom: new EpicGroom(),
      branch: new EpicBranch(), pullRequests: new PullRequests(), fingerprint: Mother.FINGERPRINT,
      revisions: Mother.REVISIONS,
    })
    this.answers = answers
    this.asked = []
  }

  async execute(params: ReadEpicGroomParams): Promise<EpicGroomRead> {
    this.asked.push(params)
    const answer = this.answers[this.asked.length - 1]
    if (answer === undefined) {
      throw new Error(`ReadEpicGroomDouble was asked a ${this.asked.length}th time with no answer written for it`)
    }
    return answer
  }
}

class EpicIssuesDouble extends EpicIssues {
  promoteAsked: PromoteAsked[]

  constructor() {
    super()
    this.promoteAsked = []
  }

  async promote(subject: PromoteAsked): Promise<void> {
    this.promoteAsked.push(subject)
  }
}

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly HOME = Mother.REPOSITORY.text
  static readonly MILESTONE = 'Test epic'

  static readonly PLAN = new GroomPlan({
    home: Mother.HOME,
    milestone: Mother.MILESTONE,
    issues: [
      new GroomPlanIssue({ order: 1, title: '#1 First slice', labels: ['type:feature'], repo: Mother.HOME }),
      new GroomPlanIssue({ order: 2, title: '#2 Second slice', labels: ['type:feature'], repo: Mother.HOME }),
    ],
  })
  static readonly FINGERPRINT = new PlanFingerprint({ digest: (text) => text })
  static readonly REVISIONS = new SpecRevision({ digest: (text) => createHash('sha1').update(text, 'utf8').digest('hex') })

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

  static noStatusLabelIssue(): EpicIssue {
    return new EpicIssue({
      number: 2,
      url: 'https://github.com/owner/name/issues/2',
      title: 'wears no status: label at all, which resolves to backlog',
      status: PlanIssueStatus.BACKLOG,
      isOpen: true,
      order: 2,
    })
  }

  static inProgressIssue(): EpicIssue {
    return new EpicIssue({
      number: 3,
      url: 'https://github.com/owner/name/issues/3',
      title: 'already claimed and wearing status:in-progress',
      status: PlanIssueStatus.IN_PROGRESS,
      isOpen: true,
      order: null,
    })
  }

  static closedBacklogIssue(): EpicIssue {
    return new EpicIssue({
      number: 4,
      url: 'https://github.com/owner/name/issues/4',
      title: 'closed while still wearing status:backlog',
      status: PlanIssueStatus.BACKLOG,
      isOpen: false,
      order: null,
    })
  }

  static readyIssue(): EpicIssue {
    return new EpicIssue({
      number: 1,
      url: 'https://github.com/owner/name/issues/1',
      title: 'now promoted to status:ready',
      status: PlanIssueStatus.READY,
      isOpen: true,
      order: 1,
    })
  }

  static groomableRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.GROOMABLE, spec: null, milestone: null, plan: null, planFingerprint: null, issues: [],
    })
  }

  static groomedRead(issues: EpicIssue[]): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.GROOMED, spec: null, milestone: Mother.MILESTONE, plan: null, planFingerprint: null,
      issues,
    })
  }

  static authorisedRead(issues: EpicIssue[]): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.AUTHORISED, spec: null, milestone: Mother.MILESTONE, plan: null, planFingerprint: null,
      issues,
    })
  }

  static partiallyGroomedRead(issues: EpicIssue[]): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.PARTIALLY_GROOMED, spec: null, milestone: Mother.MILESTONE, plan: Mother.PLAN,
      planFingerprint: Mother.FINGERPRINT.of(Mother.PLAN), issues,
    })
  }

  static readonly ISSUES_UNCERTAIN_REASON = 'the milestone may hold more issues than this backend could read'

  static issuesUncertainRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.ISSUES_UNCERTAIN, spec: null, milestone: Mother.MILESTONE, plan: null,
      planFingerprint: null, issues: [], reason: Mother.ISSUES_UNCERTAIN_REASON,
    })
  }
}

class Flow {
  preparation = PreparationMother.check()
  read: ReadEpicGroomDouble
  issues: EpicIssuesDouble

  constructor({ read, issues }: { read?: ReadEpicGroomDouble, issues?: EpicIssuesDouble } = {}) {
    this.read = read ?? new ReadEpicGroomDouble([Mother.groomedRead([Mother.backlogIssue()])])
    this.issues = issues ?? new EpicIssuesDouble()
  }

  async run() {
    return new PromoteEpic(this).execute(new PromoteEpicParams({ root: Mother.ROOT, repository: Mother.REPOSITORY }))
  }
}

describe('PromoteEpic', () => {
  it('does not promote any issue while preparation is required', async () => {
    const flow = new Flow()
    flow.preparation = PreparationMother.check(PreparationMother.blocked())
    await expect(flow.run()).rejects.toThrow(PreparationMother.blocked().summary)
    expect(flow.issues.promoteAsked).toEqual([])
  })

  it('it promotes the issues waiting at backlog and asks nothing of the ones that are not', async () => {
    const waiting = [Mother.backlogIssue(), Mother.noStatusLabelIssue()]
    const before = [...waiting, Mother.inProgressIssue(), Mother.closedBacklogIssue()]
    const after = [...waiting.map(() => Mother.readyIssue()), Mother.inProgressIssue(), Mother.closedBacklogIssue()]
    const flow = new Flow({
      read: new ReadEpicGroomDouble([Mother.groomedRead(before), Mother.groomedRead(after)]),
    })

    const promoted = await flow.run()

    expect(flow.issues.promoteAsked).toEqual([
      { repository: Mother.REPOSITORY, issue: Mother.backlogIssue() },
      { repository: Mother.REPOSITORY, issue: Mother.noStatusLabelIssue() },
    ])
    expect(promoted.promoted).toEqual([1, 2])
  })

  it('an epic with no issue at all is refused and nothing is promoted', async () => {
    const flow = new Flow({ read: new ReadEpicGroomDouble([Mother.groomableRead()]) })

    const promoted = await flow.run()

    expect(promoted.state).toBe(EpicGroomState.GROOMABLE)
    expect(flow.issues.promoteAsked).toEqual([])
    expect(promoted.promoted).toEqual([])
  })

  it('a listing that could not be exhausted is refused, carries why, and nothing is promoted', async () => {
    const flow = new Flow({ read: new ReadEpicGroomDouble([Mother.issuesUncertainRead()]) })

    const promoted = await flow.run()

    expect(promoted.state).toBe(EpicGroomState.ISSUES_UNCERTAIN)
    expect(promoted.reason).toBe(Mother.ISSUES_UNCERTAIN_REASON)
    expect(flow.issues.promoteAsked).toEqual([])
    expect(promoted.promoted).toEqual([])
  })

  it('a partially groomed epic is refused and nothing is promoted, though it already holds an issue', async () => {
    const flow = new Flow({
      read: new ReadEpicGroomDouble([Mother.partiallyGroomedRead([Mother.backlogIssue()])]),
    })

    const promoted = await flow.run()

    expect(promoted.state).toBe(EpicGroomState.PARTIALLY_GROOMED)
    expect(promoted.plan).toBe(Mother.PLAN)
    expect(promoted.issues).toEqual([Mother.backlogIssue()])
    expect(flow.issues.promoteAsked).toEqual([])
    expect(promoted.promoted).toEqual([])
  })

  it('an epic already authorised promotes nothing and is no failure', async () => {
    const settled = [Mother.readyIssue(), Mother.closedBacklogIssue()]
    const flow = new Flow({
      read: new ReadEpicGroomDouble([Mother.authorisedRead(settled), Mother.authorisedRead(settled)]),
    })

    const promoted = await flow.run()

    expect(promoted.state).toBe(EpicGroomState.AUTHORISED)
    expect(flow.issues.promoteAsked).toEqual([])
    expect(promoted.promoted).toEqual([])
  })

  it('the issues it answers are the ones the second read gave, not the ones it started from', async () => {
    const started = [Mother.backlogIssue()]
    const settled = [Mother.readyIssue()]
    const flow = new Flow({
      read: new ReadEpicGroomDouble([Mother.groomedRead(started), Mother.authorisedRead(settled)]),
    })

    const promoted = await flow.run()

    expect(promoted.issues).toEqual(settled)
    expect(promoted.issues).not.toEqual(started)
  })
})
