import { describe, it, expect } from 'vitest'
import { PreparationMother } from '../preparation-mother.ts'
import { BaselineResult } from '../../../plugin/scripts/baseline.js'
import { issuesQueryFor } from '../../../plugin/scripts/gh-issues.js'
import { HarvestClock } from '../../src/infrastructure/harvest-clock.ts'
import { DispatchRelay } from '../../src/infrastructure/dispatch-relay.ts'
import { GhDispatchCandidates } from '../../src/infrastructure/gh-dispatch-candidates.ts'
import { StartMilestonePlan, StartMilestonePlanParams } from '../../src/application/actions/start-milestone-plan.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'
import { WorkInFlight } from '../../src/infrastructure/work-in-flight.ts'
import { PlanAgentNotLaunched } from '../../src/domain/exceptions.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { DispatchClaims } from '../../src/domain/ports/dispatch-claims.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RootedWorkspaceLocation } from '../../src/domain/value-objects/rooted-workspace-location.ts'
import { SownWorkspace } from '../../src/domain/value-objects/sown-workspace.ts'
import { WorkspaceSurvey } from '../../src/domain/value-objects/workspace-survey.ts'
import { RegisteredCheckout } from '../../src/domain/value-objects/registered-checkout.ts'
import type { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import type { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import type { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'

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

class Slice {
  static readonly REPOSITORY = new RepositoryName('mercadona/control-tower-plugin')
  static readonly MILESTONE = Object.freeze({
    number: 370, title: 'The chain that does not stop', description: null,
  })
  static readonly OTHER_MILESTONE = Object.freeze({
    number: 371, title: 'The groom is an interactive session', description: null,
  })
  static readonly ROOT = new CheckoutRoot('/repo/checkout')

  static issue({
    number, order, status = 'ready', dependencies = [], touches = [], stateReason = null, milestone = Slice.MILESTONE,
  }: {
    number: number, order: number, status?: string, dependencies?: number[], touches?: string[],
    stateReason?: string | null, milestone?: { number: number, title: string, description: string | null },
  }): RawIssue {
    const dependencySection = dependencies.length === 0
      ? ''
      : `\n## Dependencias\n${dependencies.map((dependency) => `- merge-after #${dependency}`).join('\n')}`

    return {
      number,
      url: `https://github.com/mercadona/control-tower-plugin/issues/${number}`,
      title: `Slice ${order}`,
      body: `<!-- ct-order:${order} -->${dependencySection}`,
      state: stateReason === null ? 'OPEN' : 'CLOSED',
      stateReason,
      milestone,
      labels: { nodes: [
        { name: `status:${status}` },
        ...touches.map((touch) => ({ name: `touches:${touch}` })),
        { name: 'gate:none' },
      ] },
    }
  }

  static pages(issues: RawIssue[]): string {
    return JSON.stringify([
      { data: { repository: { issues: { nodes: issues, pageInfo: { hasNextPage: false, endCursor: null } } } } },
    ])
  }
}

class ScriptedGh {
  readonly calls: string[][] = []
  readonly answers: Map<string, ProcessOutput>

  constructor(open: RawIssue[], closed: RawIssue[] = []) {
    this.answers = new Map([
      [JSON.stringify(ScriptedGh.argv(['OPEN'])), new ProcessOutput({ code: 0, stdout: Slice.pages(open), stderr: '' })],
      [JSON.stringify(ScriptedGh.argv(['CLOSED'])), new ProcessOutput({ code: 0, stdout: Slice.pages(closed), stderr: '' })],
    ])
  }

  static argv(states: string[]): string[] {
    const [owner, name] = Slice.REPOSITORY.text.split('/')

    return [
      'api', 'graphql', '--paginate', '--slurp',
      '-f', `query=${issuesQueryFor(states)}`, '-f', `owner=${owner}`, '-f', `name=${name}`,
    ]
  }

  build(): Gh {
    return new Gh({
      launch: async (argv: string[]): Promise<ProcessOutput> => {
        this.calls.push(argv)
        const answer = this.answers.get(JSON.stringify(argv))
        if (answer === undefined) throw new Error(`unexpected gh call ${JSON.stringify(argv)}`)

        return answer
      },
      policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
      sleep: async () => undefined,
    })
  }
}

class WorkspaceDouble extends Workspace {
  override async confirm({ root }: { root: CheckoutRoot }): Promise<CheckoutRoot> {
    return root
  }

  override async prepare({ issue }: { issue: PlanIssue }): Promise<SownWorkspace> {
    return new SownWorkspace({
      located: new RootedWorkspaceLocation({
        root: Slice.ROOT.text, path: `${Slice.ROOT.text}/.worktrees/${issue.number}`, branch: `feat/${issue.number}`,
      }),
      baseline: BaselineResult.notMeasured('no test command declared'),
    })
  }

  override async undo(): Promise<void> {}
}

class DispatchClaimsDouble extends DispatchClaims {
  override async claim(): Promise<void> {}

  override async requeue(): Promise<void> {}
}

class PlanRecordsDouble extends PlanRecords {
  readonly asked: { issue: number, repository: RepositoryName }[] = []

  override async find(asked: { issue: number, repository: RepositoryName }): Promise<PlanWatch | null> {
    this.asked.push(asked)

    return null
  }
}

class PlanAgentsDouble extends PlanAgents {
  readonly asked: PlanBriefing[] = []
  readonly refusing: ReadonlyMap<number, Error>

  constructor(refusing: ReadonlyMap<number, Error> = new Map()) {
    super()
    this.refusing = refusing
  }

  override async launch(briefing: PlanBriefing): Promise<string> {
    this.asked.push(briefing)
    const refusal = this.refusing.get(briefing.issue.number)
    if (refusal !== undefined) throw refusal

    return `workspace:${briefing.issue.number}`
  }
}

class CheckoutRegistryDouble extends CheckoutRegistry {
  override remember(): void {}

  override known(): RegisteredCheckout[] {
    return []
  }
}

type DispatchAsked = { repository: RepositoryName, root: CheckoutRoot, milestone: string }

class Sweep {
  readonly written: string[] = []
  readonly dispatchAsked: DispatchAsked[] = []
  readonly gh: ScriptedGh
  readonly claims = new DispatchClaimsDouble()
  readonly workspace = new WorkspaceDouble()
  readonly agents: PlanAgentsDouble
  readonly records = new PlanRecordsDouble()
  readonly checkouts = new CheckoutRegistryDouble()

  constructor(gh: ScriptedGh, refusing: ReadonlyMap<number, Error> = new Map()) {
    this.gh = gh
    this.agents = new PlanAgentsDouble(refusing)
  }

  dispatched(): number[] {
    return this.written
      .flatMap((line) => line.startsWith('relay: dispatched ') ? [Number(line.split('#')[1].split(' ')[0])] : [])
  }

  async run(): Promise<Sweep> {
    const candidates = new GhDispatchCandidates({ gh: this.gh.build() })
    const startMilestonePlan = new StartMilestonePlan({
      preparation: PreparationMother.check(),
      candidates,
      claims: this.claims,
      workspace: this.workspace,
      agents: this.agents,
      records: this.records,
      checkouts: this.checkouts,
    })
    const relay = new DispatchRelay({
      milestones: (repository) => candidates.authorisedMilestones({ repository }),
      ownMilestone: () => Promise.resolve(Slice.MILESTONE.title),
      dispatch: (asked) => {
        this.dispatchAsked.push(asked)

        return startMilestonePlan.execute(new StartMilestonePlanParams(asked))
      },
      inFlight: new WorkInFlight(),
      stderr: (line) => this.written.push(line),
    })
    const clock = new HarvestClock({
      checkouts: () => [Slice.ROOT],
      survey: () => Promise.resolve({ survey: new WorkspaceSurvey({ repository: Slice.REPOSITORY, prepared: [] }) }),
      harvest: () => { throw new Error('no prepared workspace should reach harvest in this suite') },
      relay: (root, repository) => relay.relay(root, repository),
      sleep: () => Promise.resolve(),
      stderr: (line) => this.written.push(line),
    })

    await clock.sweep()

    return this
  }
}

describe('DispatchRelay crossed with the real plugin selection', () => {
  it('an open pull request holds only its tokens and the sweep dispatches the next slice', async () => {
    const gh = new ScriptedGh(
      [
        Slice.issue({ number: 10, order: 2, status: 'in-review', touches: ['api'] }),
        Slice.issue({ number: 20, order: 3, status: 'ready', dependencies: [1] }),
      ],
      [Slice.issue({ number: 5, order: 1, status: 'closed', stateReason: 'COMPLETED' })],
    )

    const swept = await new Sweep(gh).run()

    expect(swept.agents.asked).toHaveLength(1)
    expect(swept.agents.asked[0].issue.number).toBe(20)
    expect(swept.written).toEqual(['relay: dispatched mercadona/control-tower-plugin#20 as workspace:20\n'])
  })

  it('a merged dependency makes the sweep dispatch what it unblocked', async () => {
    const gh = new ScriptedGh(
      [Slice.issue({ number: 31, order: 2, status: 'ready', dependencies: [1] })],
      [Slice.issue({ number: 6, order: 1, status: 'closed', stateReason: 'COMPLETED' })],
    )

    const swept = await new Sweep(gh).run()

    expect(swept.agents.asked).toHaveLength(1)
    expect(swept.agents.asked[0].issue.number).toBe(31)
    expect(swept.written).toEqual(['relay: dispatched mercadona/control-tower-plugin#31 as workspace:31\n'])
  })

  it('no caller of the sweep names the issue the plugin selected', async () => {
    const gh = new ScriptedGh(
      [
        Slice.issue({ number: 10, order: 2, status: 'in-review', touches: ['api'] }),
        Slice.issue({ number: 20, order: 3, status: 'ready', dependencies: [1] }),
      ],
      [Slice.issue({ number: 5, order: 1, status: 'closed', stateReason: 'COMPLETED' })],
    )

    const swept = await new Sweep(gh).run()

    expect(swept.dispatchAsked).toEqual([
      { repository: Slice.REPOSITORY, root: Slice.ROOT, milestone: Slice.MILESTONE.title },
    ])
    expect(swept.records.asked).toEqual([{ issue: 20, repository: Slice.REPOSITORY }])
    expect(swept.agents.asked[0].issue.number).toBe(20)
  })

  it('a sweep with nothing admissible launches no agent and writes no line', async () => {
    const gh = new ScriptedGh([], [])

    const swept = await new Sweep(gh).run()

    expect(swept.agents.asked).toEqual([])
    expect(swept.written).toEqual([])
  })

  it('every unblocked slice goes in one sweep, with no human input between them', async () => {
    const gh = new ScriptedGh(
      [
        Slice.issue({ number: 21, order: 2, status: 'ready', dependencies: [1], touches: ['api'] }),
        Slice.issue({ number: 22, order: 3, status: 'ready', dependencies: [1], touches: ['ui'] }),
        Slice.issue({ number: 23, order: 4, status: 'ready', dependencies: [1], touches: [] }),
      ],
      [Slice.issue({ number: 5, order: 1, status: 'closed', stateReason: 'COMPLETED' })],
    )

    const swept = await new Sweep(gh).run()

    expect(swept.dispatchAsked).toHaveLength(1)
    expect(swept.agents.asked.map((briefing) => briefing.issue.number)).toEqual([21, 22, 23])
    expect(swept.written).toEqual([
      'relay: dispatched mercadona/control-tower-plugin#21 as workspace:21\n',
      'relay: dispatched mercadona/control-tower-plugin#22 as workspace:22\n',
      'relay: dispatched mercadona/control-tower-plugin#23 as workspace:23\n',
    ])
  })

  it('two ready slices sharing a touches token: the first goes and the second waits', async () => {
    const gh = new ScriptedGh(
      [
        Slice.issue({ number: 24, order: 2, status: 'ready', dependencies: [1], touches: ['api'] }),
        Slice.issue({ number: 25, order: 3, status: 'ready', dependencies: [1], touches: ['api'] }),
      ],
      [Slice.issue({ number: 5, order: 1, status: 'closed', stateReason: 'COMPLETED' })],
    )

    const swept = await new Sweep(gh).run()

    expect(swept.dispatched()).toEqual([24])
    expect(swept.agents.asked.map((briefing) => briefing.issue.number)).toEqual([24])
  })

  it('an unmerged pull request keeps holding its tokens, so what collides with it waits', async () => {
    const gh = new ScriptedGh(
      [
        Slice.issue({ number: 26, order: 2, status: 'in-review', touches: ['api'] }),
        Slice.issue({ number: 27, order: 3, status: 'ready', dependencies: [1], touches: ['api'] }),
        Slice.issue({ number: 28, order: 4, status: 'ready', dependencies: [1], touches: ['ui'] }),
      ],
      [Slice.issue({ number: 5, order: 1, status: 'closed', stateReason: 'COMPLETED' })],
    )

    const swept = await new Sweep(gh).run()

    expect(swept.dispatched()).toEqual([28])
    expect(swept.agents.asked.map((briefing) => briefing.issue.number)).toEqual([28])
  })

  it('a slice that fails to start stops none of the others and is named in its own line', async () => {
    const gh = new ScriptedGh(
      [
        Slice.issue({ number: 31, order: 2, status: 'ready', dependencies: [1], touches: ['api'] }),
        Slice.issue({ number: 32, order: 3, status: 'ready', dependencies: [1], touches: ['ui'] }),
        Slice.issue({ number: 33, order: 4, status: 'ready', dependencies: [1], touches: [] }),
      ],
      [Slice.issue({ number: 5, order: 1, status: 'closed', stateReason: 'COMPLETED' })],
    )
    const refused = new PlanAgentNotLaunched('worker acceptance was lost')

    const swept = await new Sweep(gh, new Map([[32, refused]])).run()

    expect(swept.dispatched()).toEqual([31, 33])
    expect(swept.written).toEqual([
      'relay: dispatched mercadona/control-tower-plugin#31 as workspace:31\n',
      'relay: dispatched mercadona/control-tower-plugin#33 as workspace:33\n',
      'relay: mercadona/control-tower-plugin#32 could not be dispatched: worker acceptance was lost\n',
    ])
  })

  it('a ready slice of another story\'s milestone is left alone while the held story\'s one goes', async () => {
    const gh = new ScriptedGh([
      Slice.issue({ number: 40, order: 1, status: 'ready', touches: ['api'] }),
      Slice.issue({ number: 50, order: 1, status: 'ready', touches: ['ui'], milestone: Slice.OTHER_MILESTONE }),
    ])

    const swept = await new Sweep(gh).run()

    expect(swept.dispatchAsked.map((asked) => asked.milestone)).toEqual([Slice.MILESTONE.title])
    expect(swept.dispatched()).toEqual([40])
  })
})
