import { describe, it, expect } from 'vitest'
import { PromoteEpic, PromoteEpicParams } from '../../src/application/actions/promote-epic.ts'
import { ReadEpicGroom, ReadEpicGroomParams, EpicGroomRead, EpicGroomState } from '../../src/application/queries/read-epic-groom.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { PublishedSpecs } from '../../src/domain/ports/published-specs.ts'
import { EpicIssues } from '../../src/domain/ports/epic-issues.ts'
import { EpicGroom } from '../../src/domain/ports/epic-groom.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { EpicIssue } from '../../src/domain/value-objects/epic-issue.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'

type PromoteAsked = { repository: RepositoryName, issue: EpicIssue }

class ReadEpicGroomDouble extends ReadEpicGroom {
  answers: EpicGroomRead[]
  asked: ReadEpicGroomParams[]

  constructor(answers: EpicGroomRead[]) {
    super({ specs: new EpicSpecs(), published: new PublishedSpecs(), issues: new EpicIssues(), groom: new EpicGroom() })
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
  static readonly MILESTONE = 'Test epic'

  static backlogIssue(): EpicIssue {
    return new EpicIssue({
      number: 1,
      url: 'https://github.com/owner/name/issues/1',
      title: 'wears status:backlog and stays open',
      status: PlanIssueStatus.BACKLOG,
      isOpen: true,
    })
  }

  static noStatusLabelIssue(): EpicIssue {
    return new EpicIssue({
      number: 2,
      url: 'https://github.com/owner/name/issues/2',
      title: 'wears no status: label at all, which resolves to backlog',
      status: PlanIssueStatus.BACKLOG,
      isOpen: true,
    })
  }

  static inProgressIssue(): EpicIssue {
    return new EpicIssue({
      number: 3,
      url: 'https://github.com/owner/name/issues/3',
      title: 'already claimed and wearing status:in-progress',
      status: PlanIssueStatus.IN_PROGRESS,
      isOpen: true,
    })
  }

  static closedBacklogIssue(): EpicIssue {
    return new EpicIssue({
      number: 4,
      url: 'https://github.com/owner/name/issues/4',
      title: 'closed while still wearing status:backlog',
      status: PlanIssueStatus.BACKLOG,
      isOpen: false,
    })
  }

  static readyIssue(): EpicIssue {
    return new EpicIssue({
      number: 1,
      url: 'https://github.com/owner/name/issues/1',
      title: 'now promoted to status:ready',
      status: PlanIssueStatus.READY,
      isOpen: true,
    })
  }

  static groomableRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.GROOMABLE, spec: null, milestone: null, plan: null, issues: [],
    })
  }

  static groomedRead(issues: EpicIssue[]): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.GROOMED, spec: null, milestone: Mother.MILESTONE, plan: null, issues,
    })
  }

  static authorisedRead(issues: EpicIssue[]): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.AUTHORISED, spec: null, milestone: Mother.MILESTONE, plan: null, issues,
    })
  }
}

class Flow {
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
