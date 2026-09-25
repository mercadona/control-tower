import { describe, expect, it } from 'vitest'
import { GhDispatchCandidates } from '../../src/infrastructure/gh-dispatch-candidates.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { DispatchNotAvailable, DispatchNotRead, DispatchNotUnderstood, DispatchWaitsBehind } from '../../src/domain/exceptions.ts'
import { DispatchWait } from '../../src/domain/value-objects/dispatch-wait.ts'
import { TOKEN_HOLDING_STATUSES } from '../../../plugin/scripts/dispatch.js'
import { issuesQueryFor } from '../../../plugin/scripts/gh-issues.js'

type RawIssue = {
  number: number,
  url: string,
  title: string,
  body: string,
  state: 'OPEN' | 'CLOSED',
  stateReason: string | null,
  milestone: { number: number, title: string, description: string | null } | null,
  labels: { nodes: { name: string }[] },
}

class CandidateMother {
  static readonly REPOSITORY = new RepositoryName('mercadona/control-tower-plugin')
  static readonly TARGET = 'CT370'
  static readonly TARGET_MILESTONE = Object.freeze({ number: 370, title: CandidateMother.TARGET, description: null })
  static readonly OTHER_MILESTONE = Object.freeze({ number: 369, title: 'CT369', description: null })

  static issue({
    number,
    order,
    status = 'ready',
    milestone = CandidateMother.TARGET_MILESTONE,
    touches = [],
    dependencies = [],
    gates = ['none'],
    stateReason = null,
    url = `https://github.com/mercadona/control-tower-plugin/issues/${number}`,
  }: {
    number: number,
    order: number,
    status?: string,
    milestone?: { number: number, title: string, description: string | null },
    touches?: string[],
    dependencies?: number[],
    gates?: string[],
    stateReason?: string | null,
    url?: string,
  }): RawIssue {
    const dependencySection = dependencies.length === 0
      ? ''
      : `\n## Dependencias\n${dependencies.map((dependency) => `- merge-after #${dependency}`).join('\n')}`
    return {
      number,
      url,
      title: `Slice ${order}`,
      body: `<!-- ct-order:${order} -->${dependencySection}`,
      state: stateReason === null ? 'OPEN' : 'CLOSED',
      stateReason,
      milestone,
      labels: { nodes: [
        { name: `status:${status}` },
        ...touches.map((touch) => ({ name: `touches:${touch}` })),
        ...gates.map((gate) => ({ name: `gate:${gate}` })),
      ] },
    }
  }

  static page(nodes: RawIssue[], hasNextPage: boolean): Record<string, unknown> {
    return { data: { repository: { issues: { nodes, pageInfo: { hasNextPage, endCursor: hasNextPage ? 'cursor' : null } } } } }
  }

  static pages(issues: RawIssue[]): string {
    return JSON.stringify([CandidateMother.page(issues.slice(0, 2), true), CandidateMother.page(issues.slice(2), false)])
  }

  static listing(states: string[]): string[] {
    return [
      'api', 'graphql', '--paginate', '--slurp',
      '-f', `query=${issuesQueryFor(states)}`,
      '-f', 'owner=mercadona', '-f', 'name=control-tower-plugin',
    ]
  }
}

class GhDouble {
  readonly calls: string[][] = []
  readonly answers: ProcessOutput[]

  constructor(answers: ProcessOutput[]) {
    this.answers = [...answers]
  }

  static listing(open: RawIssue[], closed: RawIssue[] = []): GhDouble {
    return new GhDouble([
      new ProcessOutput({ code: 0, stdout: CandidateMother.pages(open), stderr: '' }),
      new ProcessOutput({ code: 0, stdout: CandidateMother.pages(closed), stderr: '' }),
    ])
  }

  static output(code: number, stdout = '', stderr = ''): ProcessOutput {
    return new ProcessOutput({ code, stdout, stderr })
  }

  candidates(): GhDispatchCandidates {
    return new GhDispatchCandidates({
      gh: new Gh({
        launch: async (argv) => {
          this.calls.push(argv)
          const answer = this.answers.shift()
          if (answer === undefined) throw new Error(`unexpected gh call ${JSON.stringify(argv)}`)
          return answer
        },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
        sleep: async () => undefined,
      }),
    })
  }

  admissible(): Promise<readonly import('../../src/domain/value-objects/plan-issue.ts').PlanIssue[]> {
    return this.candidates().admissible({ repository: CandidateMother.REPOSITORY, milestone: CandidateMother.TARGET })
  }

  authorised(): Promise<readonly string[]> {
    return this.candidates().authorisedMilestones({ repository: CandidateMother.REPOSITORY })
      .then((milestones) => milestones.titles)
  }

  numbers(): Promise<number[]> {
    return this.admissible().then((issues) => issues.map((issue) => issue.number))
  }
}

describe('GhDispatchCandidates', () => {
  it('table order beats issue number while dependencies and outside holders still block, read over GraphQL in two states', async () => {
    const gh = GhDouble.listing([
      CandidateMother.issue({ number: 10, order: 1, dependencies: [99] }),
      CandidateMother.issue({ number: 20, order: 2, touches: ['api'] }),
      CandidateMother.issue({ number: 500, order: 3 }),
      CandidateMother.issue({ number: 2, order: 4 }),
      CandidateMother.issue({
        number: 700,
        order: 1,
        status: 'in-review',
        milestone: CandidateMother.OTHER_MILESTONE,
        touches: ['api'],
      }),
    ])

    await expect(gh.admissible()).resolves.toEqual([
      { number: 500, url: 'https://github.com/mercadona/control-tower-plugin/issues/500' },
      { number: 2, url: 'https://github.com/mercadona/control-tower-plugin/issues/2' },
    ])
    expect(gh.calls).toEqual([CandidateMother.listing(['OPEN']), CandidateMother.listing(['CLOSED'])])
  })

  it('every unblocked slice of the milestone comes back in one read', async () => {
    const gh = GhDouble.listing([
      CandidateMother.issue({ number: 41, order: 1, touches: ['api'] }),
      CandidateMother.issue({ number: 42, order: 2, touches: ['ui'] }),
      CandidateMother.issue({ number: 43, order: 3, touches: [] }),
    ])

    await expect(gh.numbers()).resolves.toEqual([41, 42, 43])
    expect(gh.calls).toHaveLength(2)
  })

  it('a slice under review retains its tokens while the one beside it goes', async () => {
    const gh = GhDouble.listing([
      CandidateMother.issue({ number: 11, order: 1, touches: ['api'] }),
      CandidateMother.issue({ number: 12, order: 2, touches: ['ui'] }),
      CandidateMother.issue({
        number: 90,
        order: 9,
        status: 'in-review',
        milestone: CandidateMother.OTHER_MILESTONE,
        touches: ['api'],
      }),
    ])

    await expect(gh.numbers()).resolves.toEqual([12])
  })

  it('work in flight holds its tokens and no longer holds a cap', async () => {
    const colliding = GhDouble.listing([
      CandidateMother.issue({ number: 11, order: 1, status: 'in-progress', touches: ['api'] }),
      CandidateMother.issue({ number: 12, order: 2, touches: ['api'] }),
    ])
    const free = GhDouble.listing([
      CandidateMother.issue({ number: 11, order: 1, status: 'in-progress', touches: ['api'] }),
      CandidateMother.issue({ number: 12, order: 2, touches: ['ui'] }),
    ])

    const refusal = await colliding.admissible().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(DispatchNotAvailable)
    expect(refusal).toBeInstanceOf(DispatchWaitsBehind)
    expect(refusal.wait).toEqual(new DispatchWait({ waiting: 12, token: 'api', holder: 11, holderStatus: 'in-progress' }))
    await expect(free.numbers()).resolves.toEqual([12])
  })

  it('not planned closure does not satisfy a dependency', async () => {
    const gh = GhDouble.listing(
      [CandidateMother.issue({ number: 11, order: 2, dependencies: [1] })],
      [CandidateMother.issue({ number: 10, order: 1, status: 'closed', stateReason: 'NOT_PLANNED' })],
    )

    const refusal = await gh.admissible().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(DispatchNotAvailable)
    expect(refusal).not.toBeInstanceOf(DispatchWaitsBehind)
    expect(refusal.message).toContain('NOT_PLANNED')
  })

  it('partial reads and duplicate target orders refuse', async () => {
    const partial = new GhDouble([
      GhDouble.output(1, 'partial open output', 'open refused'),
      GhDouble.output(0, CandidateMother.pages([])),
    ])
    const duplicate = GhDouble.listing([
      CandidateMother.issue({ number: 11, order: 1 }),
      CandidateMother.issue({ number: 12, order: 1 }),
      CandidateMother.issue({
        number: 90,
        order: 1,
        status: 'in-review',
        milestone: CandidateMother.OTHER_MILESTONE,
        touches: ['api'],
      }),
      CandidateMother.issue({
        number: 91,
        order: 1,
        status: 'in-review',
        milestone: CandidateMother.OTHER_MILESTONE,
        touches: ['ui'],
      }),
    ])

    await expect(partial.admissible()).rejects.toBeInstanceOf(DispatchNotRead)
    expect(partial.calls).toHaveLength(2)
    await expect(duplicate.admissible()).rejects.toBeInstanceOf(DispatchNotUnderstood)
    await expect(new GhDouble([
      GhDouble.output(0, '{"broken":true}'),
      GhDouble.output(0, CandidateMother.pages([])),
    ]).admissible()).rejects.toBeInstanceOf(DispatchNotUnderstood)
    await expect(new GhDouble([
      GhDouble.output(0, JSON.stringify([{ data: { repository: null } }])),
      GhDouble.output(0, CandidateMother.pages([])),
    ]).admissible()).rejects.toBeInstanceOf(DispatchNotUnderstood)
  })

  it('a slice that declares the plan gate is dispatched instead of stopping the chain in silence', async () => {
    const gh = GhDouble.listing([
      CandidateMother.issue({ number: 11, order: 1, gates: ['plan'] }),
    ])

    await expect(gh.admissible()).resolves.toEqual([
      { number: 11, url: 'https://github.com/mercadona/control-tower-plugin/issues/11' },
    ])
  })

  it('empty issue urls are malformed payloads that retain the offending value', async () => {
    const gh = GhDouble.listing([
      CandidateMother.issue({ number: 11, order: 1, url: '' }),
    ])

    const refusal = await gh.admissible().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(DispatchNotUnderstood)
    expect(refusal.message).toContain('url')
    expect(refusal.message).toContain('""')
  })

  it('repository holders follow plugin token authority independently of order collisions', async () => {
    const authorityOnlyStatus = 'plugin-authority-holder'
    TOKEN_HOLDING_STATUSES.push(authorityOnlyStatus)
    try {
      const gh = GhDouble.listing([
        CandidateMother.issue({ number: 11, order: 1, touches: ['api'] }),
        CandidateMother.issue({ number: 12, order: 2, touches: ['ui'] }),
        CandidateMother.issue({
          number: 90,
          order: 1,
          status: authorityOnlyStatus,
          milestone: CandidateMother.OTHER_MILESTONE,
          touches: ['api'],
        }),
        CandidateMother.issue({
          number: 91,
          order: 1,
          status: 'in-review',
          milestone: CandidateMother.OTHER_MILESTONE,
          touches: ['other'],
        }),
      ])

      await expect(gh.numbers()).resolves.toEqual([12])
    } finally {
      TOKEN_HOLDING_STATUSES.splice(TOKEN_HOLDING_STATUSES.indexOf(authorityOnlyStatus), 1)
    }
  })

  it('the authorised milestones are the ones with an open ready slice, read from the open issues alone', async () => {
    const gh = new GhDouble([GhDouble.output(0, CandidateMother.pages([
      CandidateMother.issue({ number: 11, order: 1 }),
      CandidateMother.issue({ number: 12, order: 2 }),
      CandidateMother.issue({ number: 20, order: 1, status: 'backlog', milestone: CandidateMother.OTHER_MILESTONE }),
      { ...CandidateMother.issue({ number: 30, order: 1 }), milestone: null },
    ]))])

    await expect(gh.authorised()).resolves.toEqual([CandidateMother.TARGET])
    expect(gh.calls).toEqual([CandidateMother.listing(['OPEN'])])
  })

  it('every authorised milestone is named once, in the same order on every sweep', async () => {
    const gh = new GhDouble([GhDouble.output(0, CandidateMother.pages([
      CandidateMother.issue({ number: 11, order: 1 }),
      CandidateMother.issue({ number: 20, order: 1, milestone: CandidateMother.OTHER_MILESTONE }),
      CandidateMother.issue({ number: 12, order: 2 }),
      CandidateMother.issue({ number: 21, order: 2, milestone: CandidateMother.OTHER_MILESTONE }),
    ]))])

    await expect(gh.authorised()).resolves.toEqual([CandidateMother.OTHER_MILESTONE.title, CandidateMother.TARGET])
  })

  it('an open table gh could not print is not read, and one it printed badly is not understood', async () => {
    const unread = await new GhDouble([GhDouble.output(1, '', 'open refused')]).authorised().catch((cause) => cause)
    const misunderstood = await new GhDouble([GhDouble.output(0, 'not json')]).authorised().catch((cause) => cause)

    expect(unread).toBeInstanceOf(DispatchNotRead)
    expect(unread).not.toBeInstanceOf(DispatchNotUnderstood)
    expect(misunderstood).toBeInstanceOf(DispatchNotUnderstood)
    expect(misunderstood).not.toBeInstanceOf(DispatchNotRead)
  })
})
