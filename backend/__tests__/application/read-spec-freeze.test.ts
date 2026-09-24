import { describe, it, expect } from 'vitest'
import { ReadSpecFreeze, ReadSpecFreezeParams, SpecFreezeState } from '../../src/application/queries/read-spec-freeze.ts'
import { EpicSpecsDouble } from '../epic-specs-double.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { FreezeFinding, FreezeFindingCode } from '../../src/domain/value-objects/freeze-finding.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

type PullRequestAsked = { branch: string, repository: RepositoryName }

class EpicBranchDouble extends EpicBranch {
  answer: string
  asked: CheckoutRoot[]

  constructor(answer: string) {
    super()
    this.answer = answer
    this.asked = []
  }

  async current(root: CheckoutRoot): Promise<string> {
    this.asked.push(root)
    return this.answer
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

  async openOfBranch(subject: PullRequestAsked): Promise<ReviewedPullRequest | null> {
    this.asked.push(subject)
    return this.answer
  }
}

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly BRANCH = 'epic/329-freeze'
  static readonly PULL_REQUEST: ReviewedPullRequest = Object.freeze({
    number: 12, url: 'https://github.com/owner/name/pull/12',
  })
  static readonly PATH = 'docs/superpowers/specs/2026-01-01-test-execution.md'
  static readonly DESIGN_LINE = '**Handoff origen:** `docs/superpowers/specs/2026-01-01-test-design.md`'
  static readonly BET_LINE = '**The bet:** shipping this halves the time to freeze a spec.'
  static readonly SOURCELESS_DECISION = '- **D-1 · the gate** — one single click freezes the spec.'
  static readonly CONTEXT = ['## Contexto del milestone', '', '- **Alcance:** `src/**`', '']

  static draftWithPendingClarification(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        '# Test epic — Execution spec',
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
        '## Hipótesis',
        '',
        '- [NEEDS CLARIFICATION: who signs the freeze?]',
        Mother.BET_LINE,
        '',
        ...Mother.CONTEXT,
      ].join('\n'),
    })
  }

  static draftWithNoScope(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        '# Test epic — Execution spec',
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
        '## Hipótesis',
        '',
        Mother.BET_LINE,
        '',
        '## Contexto del milestone',
        '',
        '- Stack: TypeScript.',
        '',
      ].join('\n'),
    })
  }

  static draftWithClarificationResolved(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        '# Test epic — Execution spec',
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
        '## Hipótesis',
        '',
        Mother.BET_LINE,
        '',
        ...Mother.CONTEXT,
      ].join('\n'),
    })
  }

  static draftWithHypothesisTemplateCommentOnly(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        '# Test epic — Execution spec',
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
        '## Hipótesis',
        '',
        '<!-- The bet: <what we believe will happen if we build this> -->',
        '',
        '## Decisiones congeladas',
        '',
        ...Mother.CONTEXT,
      ].join('\n'),
    })
  }

  static draftWithNoHypothesisHeading(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        '# Test epic — Execution spec',
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
        '## Decisiones congeladas',
        '',
        ...Mother.CONTEXT,
      ].join('\n'),
    })
  }

  static draftWithSourcelessDecision(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        '# Test epic — Execution spec',
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
        '## Hipótesis',
        '',
        Mother.BET_LINE,
        '',
        '## Decisiones congeladas',
        '',
        Mother.SOURCELESS_DECISION,
        '',
        ...Mother.CONTEXT,
      ].join('\n'),
    })
  }

  static frozen(): EpicSpec {
    return new EpicSpec({
      path: Mother.PATH,
      text: [
        '# Test epic — Execution spec',
        '',
        Mother.DESIGN_LINE,
        '**Fecha de congelación:** 2026-09-14',
        '**Estado:** CONGELADA',
        '',
        '## Hipótesis',
        '',
        Mother.BET_LINE,
        '',
        ...Mother.CONTEXT,
      ].join('\n'),
    })
  }
}

class Flow {
  specs: EpicSpecsDouble
  branch: EpicBranchDouble
  pullRequests: PullRequestsDouble

  constructor({ specs, branch, pullRequests }: {
    specs?: EpicSpecsDouble,
    branch?: EpicBranchDouble,
    pullRequests?: PullRequestsDouble,
  } = {}) {
    this.specs = specs ?? new EpicSpecsDouble(null)
    this.branch = branch ?? new EpicBranchDouble(Mother.BRANCH)
    this.pullRequests = pullRequests ?? new PullRequestsDouble(Mother.PULL_REQUEST)
  }

  static readingSpec(spec: EpicSpec | null): Flow {
    return new Flow({ specs: new EpicSpecsDouble(spec) })
  }

  async run() {
    return new ReadSpecFreeze(this).execute(new ReadSpecFreezeParams({
      root: Mother.ROOT, repository: Mother.REPOSITORY, story: EpicSpecsDouble.STORY,
    }))
  }
}

describe('ReadSpecFreeze', () => {
  it('a spec with a clarification marker still pending answers draft with the module line and raw text, and asks neither git nor github', async () => {
    const pendingFlow = Flow.readingSpec(Mother.draftWithPendingClarification())

    const pending = await pendingFlow.run()

    expect(pending.state).toBe(SpecFreezeState.DRAFT)
    expect(pending.findings).toEqual([
      new FreezeFinding({
        code: FreezeFindingCode.CLARIFICATION_MARKER,
        line: 9,
        detail: '- [NEEDS CLARIFICATION: who signs the freeze?]',
      }),
    ])
    expect(pendingFlow.branch.asked).toEqual([])
    expect(pendingFlow.pullRequests.asked).toEqual([])

    const resolvedFlow = Flow.readingSpec(Mother.draftWithClarificationResolved())

    const resolved = await resolvedFlow.run()

    expect(resolved.state).toBe(SpecFreezeState.DRAFT)
    expect(resolved.findings).toEqual([])
    expect(resolvedFlow.branch.asked).toEqual([])
    expect(resolvedFlow.pullRequests.asked).toEqual([])
  })

  it('a spec whose Hypothesis section holds only the template comment answers the hypothesis-empty finding', async () => {
    const read = await Flow.readingSpec(Mother.draftWithHypothesisTemplateCommentOnly()).run()

    expect(read.state).toBe(SpecFreezeState.DRAFT)
    expect(read.findings).toEqual([
      new FreezeFinding({ code: FreezeFindingCode.HYPOTHESIS_EMPTY, line: null, detail: null }),
    ])
  })

  it('a milestone context without the scope line the gate reads answers the scope-absent finding', async () => {
    const read = await Flow.readingSpec(Mother.draftWithNoScope()).run()

    expect(read.state).toBe(SpecFreezeState.DRAFT)
    expect(read.findings).toEqual([
      new FreezeFinding({ code: FreezeFindingCode.SCOPE_ABSENT, line: null, detail: null }),
    ])
  })

  it('a spec with no Hypothesis heading answers the hypothesis-absent finding', async () => {
    const read = await Flow.readingSpec(Mother.draftWithNoHypothesisHeading()).run()

    expect(read.state).toBe(SpecFreezeState.DRAFT)
    expect(read.findings).toEqual([
      new FreezeFinding({ code: FreezeFindingCode.HYPOTHESIS_ABSENT, line: null, detail: null }),
    ])
  })

  it('a frozen decision that does not name its source answers the provenance finding with the line and the raw text of its bullet', async () => {
    const read = await Flow.readingSpec(Mother.draftWithSourcelessDecision()).run()

    expect(read.state).toBe(SpecFreezeState.DRAFT)
    expect(read.findings).toEqual([
      new FreezeFinding({
        code: FreezeFindingCode.DECISION_WITHOUT_PROVENANCE,
        line: 13,
        detail: Mother.SOURCELESS_DECISION,
      }),
    ])
  })

  it('a frozen spec answers its date and the pull request open on the checkout branch', async () => {
    const flow = Flow.readingSpec(Mother.frozen())

    const read = await flow.run()

    expect(read.state).toBe(SpecFreezeState.FROZEN)
    expect(read.frozenOn).toBe('2026-09-14')
    expect(read.pullRequest).toEqual(Mother.PULL_REQUEST)
    expect(flow.branch.asked).toEqual([Mother.ROOT])
    expect(flow.pullRequests.asked).toEqual([{ branch: Mother.BRANCH, repository: Mother.REPOSITORY }])
  })

  it('a checkout with no execution spec answers no-spec and asks nothing else', async () => {
    const flow = Flow.readingSpec(null)

    const read = await flow.run()

    expect(read.state).toBe(SpecFreezeState.NO_SPEC)
    expect(flow.branch.asked).toEqual([])
    expect(flow.pullRequests.asked).toEqual([])
  })
})
