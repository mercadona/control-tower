import { describe, it, expect } from 'vitest'
import { GroomEpic, GroomEpicParams, PlanStaleness } from '../../src/application/actions/groom-epic.ts'
import { ReadEpicGroom, ReadEpicGroomParams, EpicGroomRead, EpicGroomState } from '../../src/application/queries/read-epic-groom.ts'
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
import { GroomPlan, GroomPlanIssue } from '../../src/domain/value-objects/groom-plan.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import { PlanFingerprint } from '../../src/domain/policies/plan-fingerprint.ts'

type GroomAsked = { root: CheckoutRoot, spec: EpicSpec, repository: RepositoryName, milestone: string }

class ReadEpicGroomDouble extends ReadEpicGroom {
  answers: EpicGroomRead[]
  asked: ReadEpicGroomParams[]

  constructor(answers: EpicGroomRead[]) {
    super({
      specs: new EpicSpecs(), published: new PublishedSpecs(), issues: new EpicIssues(), groom: new EpicGroom(),
      branch: new EpicBranch(), pullRequests: new PullRequests(), fingerprint: Mother.FINGERPRINT,
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

class EpicGroomDouble extends EpicGroom {
  runAsked: GroomAsked[]

  constructor() {
    super()
    this.runAsked = []
  }

  async run(subject: GroomAsked): Promise<void> {
    this.runAsked.push(subject)
  }
}

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly MILESTONE = 'Test epic'
  static readonly PATH = 'docs/superpowers/specs/2026-01-01-test-execution.md'
  static readonly DESIGN_LINE = '**Handoff origen:** `docs/superpowers/specs/2026-01-01-test-design.md`'
  static readonly PLAN = new GroomPlan({
    milestone: Mother.MILESTONE,
    issues: [new GroomPlanIssue({ order: 1, title: '#1 First slice', labels: ['type:feature'] })],
  })
  static readonly FINGERPRINT = new PlanFingerprint({ digest: (text) => text })
  static readonly PLAN_FINGERPRINT = Mother.FINGERPRINT.of(Mother.PLAN)

  static frozenSpec(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        `# ${Mother.MILESTONE} — Execution spec`,
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** 2026-09-14',
        '**Estado:** CONGELADA',
        '',
      ].join('\n'),
    })
  }

  static promotedIssue(): EpicIssue {
    return new EpicIssue({
      number: 1,
      url: 'https://github.com/owner/name/issues/1',
      title: 'first slice, groomed',
      status: PlanIssueStatus.BACKLOG,
      isOpen: true,
      order: 1,
    })
  }

  static draftRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.DRAFT, spec: Mother.frozenSpec(), milestone: null, plan: null, planFingerprint: null,
      issues: [],
    })
  }

  static noSpecRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.NO_SPEC, spec: null, milestone: null, plan: null, planFingerprint: null, issues: [],
    })
  }

  static awaitingPublicationRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.AWAITING_PUBLICATION, spec: Mother.frozenSpec(), milestone: null, plan: null,
      planFingerprint: null, issues: [],
    })
  }

  static reslicedRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.RESLICED, spec: Mother.frozenSpec(), milestone: null, plan: null,
      planFingerprint: null, issues: [],
    })
  }

  static readonly ISSUES_UNCERTAIN_REASON = 'the milestone may hold more issues than this backend could read'

  static issuesUncertainRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.ISSUES_UNCERTAIN, spec: Mother.frozenSpec(), milestone: Mother.MILESTONE, plan: null,
      planFingerprint: null, issues: [], reason: Mother.ISSUES_UNCERTAIN_REASON,
    })
  }

  static groomableRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.GROOMABLE,
      spec: Mother.frozenSpec(),
      milestone: Mother.MILESTONE,
      plan: Mother.PLAN,
      planFingerprint: Mother.PLAN_FINGERPRINT,
      issues: [],
    })
  }

  static groomedRead(issues: EpicIssue[]): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.GROOMED, spec: Mother.frozenSpec(), milestone: Mother.MILESTONE, plan: Mother.PLAN,
      planFingerprint: Mother.PLAN_FINGERPRINT, issues,
    })
  }

  static partiallyGroomedRead(issues: EpicIssue[]): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.PARTIALLY_GROOMED,
      spec: Mother.frozenSpec(),
      milestone: Mother.MILESTONE,
      plan: Mother.PLAN,
      planFingerprint: Mother.PLAN_FINGERPRINT,
      issues,
    })
  }
}

class Flow {
  read: ReadEpicGroomDouble
  groom: EpicGroomDouble
  fingerprint: PlanFingerprint

  constructor({ read, groom, fingerprint }: {
    read?: ReadEpicGroomDouble, groom?: EpicGroomDouble, fingerprint?: PlanFingerprint,
  } = {}) {
    this.read = read ?? new ReadEpicGroomDouble([Mother.groomableRead()])
    this.groom = groom ?? new EpicGroomDouble()
    this.fingerprint = fingerprint ?? Mother.FINGERPRINT
  }

  static readingOnce(answer: EpicGroomRead): Flow {
    return new Flow({ read: new ReadEpicGroomDouble([answer]) })
  }

  async run({ fingerprint = Mother.PLAN_FINGERPRINT }: { fingerprint?: string | null } = {}) {
    return new GroomEpic(this).execute(
      new GroomEpicParams({ root: Mother.ROOT, repository: Mother.REPOSITORY, fingerprint })
    )
  }
}

describe('GroomEpic', () => {
  it('a spec that is not frozen refuses the groom and the program is never run', async () => {
    const flow = Flow.readingOnce(Mother.draftRead())

    const groomed = await flow.run()

    expect(groomed.state).toBe(EpicGroomState.DRAFT)
    expect(flow.groom.runAsked).toEqual([])
  })

  it('a spec whose committed copy is not published refuses the groom and the program is never run', async () => {
    const flow = Flow.readingOnce(Mother.awaitingPublicationRead())

    const groomed = await flow.run()

    expect(groomed.state).toBe(EpicGroomState.AWAITING_PUBLICATION)
    expect(flow.groom.runAsked).toEqual([])
  })

  it('pressing the groom over a resliced spec is refused with the reason and nothing is groomed', async () => {
    const flow = Flow.readingOnce(Mother.reslicedRead())

    const groomed = await flow.run()

    expect(groomed.state).toBe(EpicGroomState.RESLICED)
    expect(groomed.staleness).toBe(PlanStaleness.FRESH)
    expect(flow.groom.runAsked).toEqual([])
  })

  it('a listing that could not be exhausted refuses the groom, carries why, and the program is never run', async () => {
    const flow = Flow.readingOnce(Mother.issuesUncertainRead())

    const groomed = await flow.run()

    expect(groomed.state).toBe(EpicGroomState.ISSUES_UNCERTAIN)
    expect(groomed.reason).toBe(Mother.ISSUES_UNCERTAIN_REASON)
    expect(flow.groom.runAsked).toEqual([])
  })

  it('no execution spec refuses the groom and the program is never run', async () => {
    const flow = Flow.readingOnce(Mother.noSpecRead())

    const groomed = await flow.run()

    expect(groomed.state).toBe(EpicGroomState.NO_SPEC)
    expect(flow.groom.runAsked).toEqual([])
  })

  it('a groomable epic runs the groom once and answers the issues the milestone holds afterwards', async () => {
    const issuesAfter = [Mother.promotedIssue()]
    const flow = new Flow({
      read: new ReadEpicGroomDouble([Mother.groomableRead(), Mother.groomedRead(issuesAfter)]),
    })

    const groomed = await flow.run()

    expect(flow.groom.runAsked).toEqual([{
      root: Mother.ROOT, spec: Mother.frozenSpec(), repository: Mother.REPOSITORY, milestone: Mother.MILESTONE,
    }])
    expect(groomed.state).toBe(EpicGroomState.GROOMED)
    expect(groomed.issues).toEqual(issuesAfter)
    expect(groomed.staleness).toBe(PlanStaleness.FRESH)
  })

  it('a press whose fingerprint no longer matches the plan it would run is refused and the program is never run', async () => {
    const flow = new Flow({ read: new ReadEpicGroomDouble([Mother.groomableRead()]) })

    const groomed = await flow.run({ fingerprint: 'the fingerprint of a plan nobody sees on screen any more' })

    expect(groomed.state).toBe(EpicGroomState.GROOMABLE)
    expect(groomed.staleness).toBe(PlanStaleness.CHANGED)
    expect(flow.groom.runAsked).toEqual([])
  })

  it('a press that carries no fingerprint at all is refused the same way, since a preview always sends one', async () => {
    const flow = new Flow({ read: new ReadEpicGroomDouble([Mother.groomableRead()]) })

    const groomed = await flow.run({ fingerprint: null })

    expect(groomed.staleness).toBe(PlanStaleness.CHANGED)
    expect(flow.groom.runAsked).toEqual([])
  })

  it('a partially groomed epic is not refused: finishing the groom is the way out this action offers', async () => {
    const before = [Mother.promotedIssue()]
    const after = [Mother.promotedIssue()]
    const flow = new Flow({
      read: new ReadEpicGroomDouble([Mother.partiallyGroomedRead(before), Mother.groomedRead(after)]),
    })

    const groomed = await flow.run()

    expect(flow.groom.runAsked).toEqual([{
      root: Mother.ROOT, spec: Mother.frozenSpec(), repository: Mother.REPOSITORY, milestone: Mother.MILESTONE,
    }])
    expect(groomed.state).toBe(EpicGroomState.GROOMED)
  })

  it('an epic already groomed runs again because the plugin is idempotent by existence', async () => {
    const issues = [Mother.promotedIssue()]
    const alreadyGroomed = Mother.groomedRead(issues)
    const flow = new Flow({ read: new ReadEpicGroomDouble([alreadyGroomed, alreadyGroomed]) })

    const groomed = await flow.run()

    expect(flow.groom.runAsked).toEqual([{
      root: Mother.ROOT, spec: Mother.frozenSpec(), repository: Mother.REPOSITORY, milestone: Mother.MILESTONE,
    }])
    expect(groomed.state).toBe(EpicGroomState.GROOMED)
  })

  it('the plan the read carried travels in the result beside the issues that now exist', async () => {
    const issuesAfter = [Mother.promotedIssue()]
    const flow = new Flow({
      read: new ReadEpicGroomDouble([Mother.groomableRead(), Mother.groomedRead(issuesAfter)]),
    })

    const groomed = await flow.run()

    expect(groomed.plan).toBe(Mother.PLAN)
    expect(groomed.issues).toEqual(issuesAfter)
  })
})
