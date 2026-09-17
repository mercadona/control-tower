import { describe, expect, it } from 'vitest'
import {
  StartMilestonePlan, StartMilestonePlanParams,
} from '../../src/application/actions/start-milestone-plan.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { DispatchCandidates } from '../../src/domain/ports/dispatch-candidates.ts'
import { DispatchClaims } from '../../src/domain/ports/dispatch-claims.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import {
  DispatchNotAvailable, PlanAgentNotLaunched, WorkspaceNotCleaned,
} from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RegisteredCheckout } from '../../src/domain/value-objects/registered-checkout.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SownWorkspace } from '../../src/domain/value-objects/sown-workspace.ts'
import { RootedWorkspaceLocation } from '../../src/domain/value-objects/rooted-workspace-location.ts'
import { BaselineResult } from '../../../plugin/scripts/baseline.js'

class DispatchCandidatesDouble extends DispatchCandidates {
  readonly answer: PlanIssue | Error
  readonly steps: string[]
  readonly asked: { repository: RepositoryName, milestone: string }[] = []

  constructor(answer: PlanIssue | Error, steps: string[]) {
    super()
    this.answer = answer
    this.steps = steps
  }

  override async next(asked: { repository: RepositoryName, milestone: string }): Promise<PlanIssue> {
    this.steps.push('candidate')
    this.asked.push(asked)
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

type ClaimAsked = { issue: PlanIssue, repository: RepositoryName, root: CheckoutRoot }

class DispatchClaimsDouble extends DispatchClaims {
  readonly steps: string[]
  readonly claimed: ClaimAsked[] = []
  readonly requeued: ClaimAsked[] = []

  constructor(steps: string[]) {
    super()
    this.steps = steps
  }

  override async claim(asked: ClaimAsked): Promise<void> {
    this.steps.push('claim')
    this.claimed.push(asked)
  }

  override async requeue(asked: ClaimAsked): Promise<void> {
    this.steps.push('requeue')
    this.requeued.push(asked)
  }
}

class PlanRecordsDouble extends PlanRecords {
  readonly answers: (PlanWatch | null | Error)[]
  readonly steps: string[]
  readonly asked: { issue: number, repository: RepositoryName }[] = []

  constructor(answers: (PlanWatch | null | Error)[], steps: string[]) {
    super()
    this.answers = [...answers]
    this.steps = steps
  }

  override async find(asked: { issue: number, repository: RepositoryName }): Promise<PlanWatch | null> {
    this.steps.push('find')
    this.asked.push(asked)
    const answer = this.answers.shift()
    if (answer instanceof Error) throw answer
    if (answer === undefined) throw new Error('no record answer declared')
    return answer
  }
}

class WorkspaceDouble extends Workspace {
  readonly prepareAnswer: SownWorkspace | Error
  readonly undoAnswer: WorkspaceNotCleaned | null
  readonly steps: string[]
  readonly confirmed: { root: CheckoutRoot, repository: RepositoryName }[] = []
  readonly prepared: ClaimAsked[] = []
  readonly undone: RootedWorkspaceLocation[] = []

  constructor({ prepareAnswer, undoAnswer, steps }: {
    prepareAnswer: SownWorkspace | Error,
    undoAnswer: WorkspaceNotCleaned | null,
    steps: string[],
  }) {
    super()
    this.prepareAnswer = prepareAnswer
    this.undoAnswer = undoAnswer
    this.steps = steps
  }

  override async confirm(asked: {
    root: CheckoutRoot, repository: RepositoryName,
  }): Promise<CheckoutRoot> {
    this.steps.push('confirm')
    this.confirmed.push(asked)
    return asked.root
  }

  override async prepare(asked: ClaimAsked): Promise<SownWorkspace> {
    this.steps.push('prepare')
    this.prepared.push(asked)
    if (this.prepareAnswer instanceof Error) throw this.prepareAnswer
    return this.prepareAnswer
  }

  override async undo(located: RootedWorkspaceLocation): Promise<void> {
    this.steps.push('undo')
    this.undone.push(located)
    if (this.undoAnswer !== null) throw this.undoAnswer
  }
}

class PlanAgentsDouble extends PlanAgents {
  readonly answer: string | Error
  readonly steps: string[]
  readonly asked: PlanBriefing[] = []

  constructor(answer: string | Error, steps: string[]) {
    super()
    this.answer = answer
    this.steps = steps
  }

  override async launch(briefing: PlanBriefing): Promise<string> {
    this.steps.push('launch')
    this.asked.push(briefing)
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class CheckoutRegistryDouble extends CheckoutRegistry {
  readonly steps: string[]
  readonly remembered: RegisteredCheckout[] = []

  constructor(steps: string[]) {
    super()
    this.steps = steps
  }

  override remember(checkout: RegisteredCheckout): void {
    this.steps.push('remember')
    this.remembered.push(checkout)
  }
}

class MilestoneFlow {
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly MILESTONE = 'ready milestone'
  static readonly ISSUE = new PlanIssue({ number: 31, url: 'https://github.com/owner/name/issues/31' })
  static readonly LOCATED = new RootedWorkspaceLocation({
    root: '/repo', path: '/repo/.worktrees/31', branch: 'feat/31',
  })
  static readonly BASELINE = new BaselineResult({
    outcome: 'verde', command: 'npm test', summary: '42 passed',
  })
  static readonly SOWN = new SownWorkspace({ located: MilestoneFlow.LOCATED, baseline: MilestoneFlow.BASELINE })
  static readonly EXISTING = new PlanWatch({
    story: null,
    issue: MilestoneFlow.ISSUE,
    located: MilestoneFlow.LOCATED,
    repository: MilestoneFlow.REPOSITORY,
    agent: '11111111-1111-4111-8111-111111111111',
  })

  readonly steps: string[] = []
  readonly candidates: DispatchCandidatesDouble
  readonly claims: DispatchClaimsDouble
  readonly records: PlanRecordsDouble
  readonly workspace: WorkspaceDouble
  readonly agents: PlanAgentsDouble
  readonly checkouts: CheckoutRegistryDouble

  constructor({ candidate, records, preparation, launch, undo }: {
    candidate?: PlanIssue | Error,
    records?: (PlanWatch | null | Error)[],
    preparation?: SownWorkspace | Error,
    launch?: string | Error,
    undo?: WorkspaceNotCleaned | null,
  } = {}) {
    this.candidates = new DispatchCandidatesDouble(candidate ?? MilestoneFlow.ISSUE, this.steps)
    this.claims = new DispatchClaimsDouble(this.steps)
    this.records = new PlanRecordsDouble(records ?? [null], this.steps)
    this.workspace = new WorkspaceDouble({
      prepareAnswer: preparation ?? MilestoneFlow.SOWN,
      undoAnswer: undo ?? null,
      steps: this.steps,
    })
    this.agents = new PlanAgentsDouble(launch ?? '11111111-1111-4111-8111-111111111111', this.steps)
    this.checkouts = new CheckoutRegistryDouble(this.steps)
  }

  async run() {
    return new StartMilestonePlan({
      candidates: this.candidates,
      claims: this.claims,
      workspace: this.workspace,
      agents: this.agents,
      records: this.records,
      checkouts: this.checkouts,
    }).execute(new StartMilestonePlanParams({
      repository: MilestoneFlow.REPOSITORY,
      root: MilestoneFlow.ROOT,
      milestone: MilestoneFlow.MILESTONE,
    }))
  }

  async failure(): Promise<unknown> {
    return this.run().catch((cause: unknown) => cause)
  }
}

describe('StartMilestonePlan', () => {
  it('selected work is claimed prepared and launched without opening an issue', async () => {
    const flow = new MilestoneFlow()

    const started = await flow.run()

    const selected = {
      issue: MilestoneFlow.ISSUE,
      repository: MilestoneFlow.REPOSITORY,
      root: MilestoneFlow.ROOT,
    }
    expect(flow.steps).toEqual(['confirm', 'candidate', 'find', 'claim', 'prepare', 'launch', 'remember'])
    expect(flow.candidates.asked).toEqual([{
      repository: MilestoneFlow.REPOSITORY, milestone: MilestoneFlow.MILESTONE,
    }])
    expect(flow.claims.claimed).toEqual([selected])
    expect(flow.workspace.prepared).toEqual([selected])
    expect(flow.agents.asked[0].issue).toBe(MilestoneFlow.ISSUE)
    expect(flow.agents.asked[0].story).toBe(null)
    expect(started.watch.issue).toBe(MilestoneFlow.ISSUE)
    expect(started.baseline).toBe(MilestoneFlow.BASELINE)
    expect(started.agent).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('no eligible issue reaches claim', async () => {
    const unavailable = new DispatchNotAvailable('no ready issue is eligible')
    const flow = new MilestoneFlow({ candidate: unavailable })

    const failure = await flow.failure()

    expect(failure).toBe(unavailable)
    expect(flow.steps).toEqual(['confirm', 'candidate'])
    expect(flow.claims.claimed).toEqual([])
  })

  it('an existing record prevents redispatch', async () => {
    const flow = new MilestoneFlow({ records: [MilestoneFlow.EXISTING] })

    const failure = await flow.failure()

    expect(failure).toBeInstanceOf(PlanAgentNotLaunched)
    expect(flow.steps).toEqual(['confirm', 'candidate', 'find'])
    expect(flow.claims.claimed).toEqual([])
    expect(flow.workspace.prepared).toEqual([])
    expect(flow.agents.asked).toEqual([])
  })

  it('unrecorded launch failure compensates workspace then claim', async () => {
    const launch = new PlanAgentNotLaunched('worker acceptance was lost')
    const flow = new MilestoneFlow({ launch, records: [null, null] })

    const failure = await flow.failure()

    expect(failure).toBe(launch)
    expect(flow.steps).toEqual([
      'confirm', 'candidate', 'find', 'claim', 'prepare', 'launch', 'find', 'undo', 'requeue',
    ])
    expect(flow.workspace.undone).toEqual([MilestoneFlow.LOCATED])
    expect(flow.claims.requeued).toEqual([{
      issue: MilestoneFlow.ISSUE,
      repository: MilestoneFlow.REPOSITORY,
      root: MilestoneFlow.ROOT,
    }])
  })

  it('recorded or uncertain launch failure preserves work', async () => {
    const recordedLaunch = new PlanAgentNotLaunched('worker response was lost')
    const recorded = new MilestoneFlow({ launch: recordedLaunch, records: [null, MilestoneFlow.EXISTING] })
    const uncertainLaunch = new PlanAgentNotLaunched('worker response was lost')
    const uncertain = new MilestoneFlow({
      launch: uncertainLaunch,
      records: [null, new PlanAgentNotLaunched('dispatch record could not be read')],
    })

    const recordedFailure = await recorded.failure()
    const uncertainFailure = await uncertain.failure()

    expect(recordedFailure).toBe(recordedLaunch)
    expect(uncertainFailure).toBe(uncertainLaunch)
    expect(recorded.workspace.undone).toEqual([])
    expect(recorded.claims.requeued).toEqual([])
    expect(uncertain.workspace.undone).toEqual([])
    expect(uncertain.claims.requeued).toEqual([])
  })

  it('failed undo preserves the claim and reports launch and cleanup diagnostics', async () => {
    const flow = new MilestoneFlow({
      launch: new PlanAgentNotLaunched('worker acceptance was lost'),
      records: [null, null],
      undo: new WorkspaceNotCleaned('worktree removal failed'),
    })

    const failure = await flow.failure()

    expect(failure).toBeInstanceOf(WorkspaceNotCleaned)
    expect((failure as Error).message).toContain('worker acceptance was lost')
    expect((failure as Error).message).toContain('worktree removal failed')
    expect(flow.claims.requeued).toEqual([])
  })

  it('failed preparation cleanup never requeues its claim', async () => {
    const notCleaned = new WorkspaceNotCleaned(
      'branch preparation failed and worktree removal failed'
    )
    const flow = new MilestoneFlow({ preparation: notCleaned })

    const failure = await flow.failure()

    expect(failure).toBe(notCleaned)
    expect(flow.claims.requeued).toEqual([])
    expect(flow.agents.asked).toEqual([])
  })
})
