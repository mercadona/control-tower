import { describe, it, expect } from 'vitest'
import { ReadEpicGroom, ReadEpicGroomParams, EpicGroomState } from '../../src/application/queries/read-epic-groom.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { PublishedSpecs } from '../../src/domain/ports/published-specs.ts'
import { EpicIssues } from '../../src/domain/ports/epic-issues.ts'
import { EpicGroom } from '../../src/domain/ports/epic-groom.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { EpicIssue } from '../../src/domain/value-objects/epic-issue.ts'
import { GroomPlan, GroomPlanIssue } from '../../src/domain/value-objects/groom-plan.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'

type PublishedAsked = { repository: RepositoryName, path: string }
type IssuesAsked = { repository: RepositoryName, milestone: string }
type GroomAsked = { root: CheckoutRoot, spec: EpicSpec, repository: RepositoryName, milestone: string }

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
  answer: EpicIssue[]
  asked: IssuesAsked[]

  constructor(answer: EpicIssue[]) {
    super()
    this.answer = answer
    this.asked = []
  }

  async listOf(subject: IssuesAsked): Promise<EpicIssue[]> {
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

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly PATH = 'docs/superpowers/specs/2026-01-01-test-execution.md'
  static readonly TITLE = 'Test epic'
  static readonly DESIGN_LINE = '**Handoff origen:** `docs/superpowers/specs/2026-01-01-test-design.md`'
  static readonly PLAN = new GroomPlan({
    milestone: Mother.TITLE,
    issues: [new GroomPlanIssue({ order: 1, title: '#1 First slice', labels: ['type:feature'] })],
  })

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
    })
  }

  static readyIssue(): EpicIssue {
    return new EpicIssue({
      number: 2,
      url: 'https://github.com/owner/name/issues/2',
      title: 'already promoted to status:ready',
      status: PlanIssueStatus.READY,
      isOpen: true,
    })
  }

  static closedBacklogIssue(): EpicIssue {
    return new EpicIssue({
      number: 3,
      url: 'https://github.com/owner/name/issues/3',
      title: 'closed while still wearing status:backlog',
      status: PlanIssueStatus.BACKLOG,
      isOpen: false,
    })
  }
}

class Flow {
  specs: EpicSpecsDouble
  published: PublishedSpecsDouble
  issues: EpicIssuesDouble
  groom: EpicGroomDouble

  constructor({ specs, published, issues, groom }: {
    specs?: EpicSpecsDouble,
    published?: PublishedSpecsDouble,
    issues?: EpicIssuesDouble,
    groom?: EpicGroomDouble,
  } = {}) {
    this.specs = specs ?? new EpicSpecsDouble(null)
    this.published = published ?? new PublishedSpecsDouble(true)
    this.issues = issues ?? new EpicIssuesDouble([])
    this.groom = groom ?? new EpicGroomDouble(Mother.PLAN)
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
  it('a frozen spec whose committed copy is not on the default branch waits and asks github for nothing else', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      published: new PublishedSpecsDouble(false),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.AWAITING_PUBLICATION)
    expect(read.plan).toBeNull()
    expect(read.issues).toEqual([])
    expect(flow.issues.asked).toEqual([])
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
    expect(flow.issues.asked).toEqual([{ repository: Mother.REPOSITORY, milestone: Mother.TITLE }])
    expect(flow.groom.asked).toEqual([{
      root: Mother.ROOT, spec: frozen, repository: Mother.REPOSITORY, milestone: Mother.TITLE,
    }])
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

  it('a milestone with an issue still at backlog is groomed and carries no plan', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      issues: new EpicIssuesDouble([Mother.backlogIssue(), Mother.readyIssue()]),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.GROOMED)
    expect(read.plan).toBeNull()
    expect(read.issues).toEqual([Mother.backlogIssue(), Mother.readyIssue()])
    expect(flow.groom.asked).toEqual([])
  })

  it('a milestone whose issues are all promoted is authorised', async () => {
    const flow = new Flow({
      specs: new EpicSpecsDouble(Mother.frozen()),
      issues: new EpicIssuesDouble([Mother.readyIssue(), Mother.closedBacklogIssue()]),
    })

    const read = await flow.run()

    expect(read.state).toBe(EpicGroomState.AUTHORISED)
    expect(read.plan).toBeNull()
    expect(read.issues).toEqual([Mother.readyIssue(), Mother.closedBacklogIssue()])
    expect(flow.groom.asked).toEqual([])
  })
})
