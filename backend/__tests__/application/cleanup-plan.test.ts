import { describe, expect, it } from 'vitest'
import { CleanupPlan, CleanupPlanParams } from '../../src/application/actions/cleanup-plan.ts'
import { DispatchClaims } from '../../src/domain/ports/dispatch-claims.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import {
  PlanCleanupConflict,
  PlanCleanupNotRead,
  PlanCleanupNotUnderstood,
  PlanIssueNotClaimed,
  PlanStatusNotRead,
  PlanStatusNotUnderstood,
} from '../../src/domain/exceptions.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import type { PlanIssueStatusValue } from '../../src/domain/value-objects/plan-issue-status.ts'
import { PlanNonLaunch } from '../../src/domain/value-objects/plan-non-launch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { UnusedWorkspace } from '../../src/domain/value-objects/unused-workspace.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'

class CleanupMother {
  static readonly WATCH = new PlanWatch({
    story: null,
    issue: new PlanIssue({ number: 331, url: 'https://github.com/mercadona/control-tower-plugin/issues/331' }),
    located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/331', branch: 'feat/331' }),
    repository: new RepositoryName('mercadona/control-tower-plugin'),
    agent: '11111111-1111-4111-8111-111111111111',
  })
  static readonly PROOF = new PlanNonLaunch({
    conversation: CleanupMother.WATCH.agent,
    callId: null,
    source: 'before-worker',
    diagnostic: 'worker was never started',
    observedAt: '2026-09-16T10:00:00.000Z',
  })
  static readonly EVIDENCE = new UnusedWorkspace({
    watch: CleanupMother.WATCH,
    baseSha: 'a'.repeat(40),
    checkedAt: '2026-09-16T10:01:00.000Z',
  })
}

class RecordsDouble extends PlanRecords {
  readonly events: string[]
  active: PlanWatch | null = CleanupMother.WATCH
  archived: PlanWatch | null = null
  snapshot: UnusedWorkspace | null = null
  archiveFailure: Error | null = null
  proofFailure: Error | null = null
  snapshotFailure: Error | null = null

  constructor(events: string[]) {
    super()
    this.events = events
  }

  override async recorded(): Promise<PlanWatch | null> { return this.active }
  override async retired(): Promise<PlanWatch | null> { return this.archived }
  override async nonLaunch(): Promise<PlanNonLaunch | null> {
    if (this.proofFailure !== null) throw this.proofFailure
    return CleanupMother.PROOF
  }
  override async cleanupEvidence(): Promise<UnusedWorkspace | null> { return this.snapshot }
  override async recordCleanupEvidence(evidence: UnusedWorkspace): Promise<void> {
    this.events.push('evidence')
    if (this.snapshotFailure !== null) throw this.snapshotFailure
    this.snapshot = evidence
  }
  override async archive(watch: PlanWatch): Promise<void> {
    this.events.push('archive')
    if (this.archiveFailure !== null) throw this.archiveFailure
    this.archived = watch
    this.active = null
  }
}

class WorkspaceDouble extends Workspace {
  readonly events: string[]
  refusal: Error | null = null
  failedEffect: string | null = null
  confirmations = 0
  evidence = CleanupMother.EVIDENCE
  worktreePresent = true
  branchPresent = true
  reappearAtConfirmation: number | null = null

  constructor(events: string[]) { super(); this.events = events }

  override async inspectUnlaunched(): Promise<UnusedWorkspace> {
    this.events.push('inspect')
    if (this.refusal !== null) throw this.refusal
    return this.evidence
  }

  override async undoUnlaunched(): Promise<void> {
    this.events.push('undo')
    if (this.failedEffect === 'worktree-removal') throw new Error('worktree-removal refused')
    this.worktreePresent = false
    if (this.failedEffect === 'branch-removal') throw new Error('branch-removal refused')
    this.branchPresent = false
    if (this.failedEffect === 'undo') throw new Error('undo refused')
  }
  override async confirmAbsent(): Promise<void> {
    this.confirmations += 1
    if (this.reappearAtConfirmation === this.confirmations) this.worktreePresent = true
    this.effect(`confirm-absent-${this.confirmations}`)
    if (this.worktreePresent || this.branchPresent) throw new PlanCleanupConflict('cleanup artifacts remain')
  }

  private effect(name: string): void {
    this.events.push(name)
    if (this.failedEffect === name) throw new Error(`${name} refused`)
  }
}

class ClaimsDouble extends DispatchClaims {
  readonly events: string[]
  failure: Error | null = null
  calls = 0
  effectBeforeFailure = false
  readonly issues: IssuesDouble

  constructor(events: string[], issues: IssuesDouble) { super(); this.events = events; this.issues = issues }

  override async requeue(): Promise<void> {
    this.events.push('requeue')
    this.calls += 1
    if (this.effectBeforeFailure) this.issues.status = PlanIssueStatus.READY
    if (this.failure !== null) throw this.failure
    this.issues.status = PlanIssueStatus.READY
  }
}

class IssuesDouble extends PlanIssues {
  status: PlanIssueStatusValue = PlanIssueStatus.IN_PROGRESS
  reads = 0
  readonly failures = new Map<number, Error>()

  override async statusOf(): Promise<PlanIssueStatusValue> {
    this.reads += 1
    const failure = this.failures.get(this.reads)
    if (failure !== undefined) throw failure
    return this.status
  }
}

class Flow {
  readonly events: string[] = []
  readonly records = new RecordsDouble(this.events)
  readonly workspace = new WorkspaceDouble(this.events)
  readonly issues = new IssuesDouble()
  readonly claims = new ClaimsDouble(this.events, this.issues)
  readonly cleanup = new CleanupPlan({
    records: this.records,
    workspace: this.workspace,
    claims: this.claims,
    planIssues: this.issues,
  })

  run(): Promise<void> {
    return this.cleanup.execute(new CleanupPlanParams({
      agent: CleanupMother.WATCH.agent,
      issue: CleanupMother.WATCH.issue.number,
      repository: CleanupMother.WATCH.repository,
    }))
  }
}

describe('CleanupPlan', () => {
  it('non-launch cleanup orders workspace requeue and retirement', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.events).toEqual([
      'inspect', 'evidence', 'undo',
      'confirm-absent-1', 'requeue', 'confirm-absent-2', 'archive',
    ])
    expect(flow.records.snapshot).toBe(CleanupMother.EVIDENCE)
  })

  it('partial cleanup resumes from verified facts', async () => {
    const flow = new Flow()
    flow.records.snapshot = CleanupMother.EVIDENCE
    flow.issues.status = PlanIssueStatus.READY

    await flow.run()

    expect(flow.claims.calls).toBe(0)
    expect(flow.events).toEqual([
      'inspect', 'undo', 'confirm-absent-1', 'confirm-absent-2', 'archive',
    ])
  })

  it('workspace refusal preserves evidence and claim', async () => {
    const flow = new Flow()
    flow.workspace.refusal = new PlanCleanupConflict('workspace changed or has a remote branch')

    await expect(flow.run()).rejects.toThrow('workspace changed')

    expect(flow.events).toEqual(['inspect'])
  })

  it.each([
    ['undo', ['inspect', 'evidence', 'undo'], 0],
    ['confirm-absent-1', ['inspect', 'evidence', 'undo', 'confirm-absent-1'], 0],
    ['confirm-absent-2', ['inspect', 'evidence', 'undo', 'confirm-absent-1', 'requeue', 'confirm-absent-2'], 1],
  ] as const)('cleanup stops at a failed %s effect', async (effect, expected, claims) => {
    const flow = new Flow()
    flow.workspace.failedEffect = effect

    await expect(flow.run()).rejects.toThrow(`${effect} refused`)

    expect(flow.events).toEqual(expected)
    expect(flow.claims.calls).toBe(claims)
    expect(flow.records.active).toBe(CleanupMother.WATCH)
  })

  it('lost requeue success does not repeat label writes', async () => {
    const flow = new Flow()
    flow.claims.failure = new PlanIssueNotClaimed('requeue answer was lost')
    flow.claims.effectBeforeFailure = true

    await flow.run()

    expect(flow.claims.calls).toBe(1)
    expect(flow.events.at(-1)).toBe('archive')
  })

  it.each([
    [new PlanStatusNotRead('status command failed'), PlanCleanupNotRead],
    [new PlanStatusNotUnderstood('status labels were malformed'), PlanCleanupNotUnderstood],
  ])('lost requeue status failures preserve category and both diagnostics', async (statusFailure, expected) => {
    const flow = new Flow()
    flow.claims.failure = new PlanIssueNotClaimed('checked requeue answer was lost')
    flow.claims.effectBeforeFailure = true
    flow.issues.failures.set(3, statusFailure)

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(expected)
    expect(refusal.message).toBe(
      `checked requeue failed: checked requeue answer was lost; status read failed: ${statusFailure.message}`
    )
    expect(flow.records.active).toBe(CleanupMother.WATCH)
    expect(flow.events).not.toContain('archive')
  })

  it('lost requeue status bugs escape unchanged', async () => {
    const flow = new Flow()
    const defect = new TypeError('status reader defect')
    flow.claims.failure = new PlanIssueNotClaimed('checked requeue answer was lost')
    flow.claims.effectBeforeFailure = true
    flow.issues.failures.set(3, defect)

    await expect(flow.run()).rejects.toBe(defect)

    expect(flow.records.active).toBe(CleanupMother.WATCH)
    expect(flow.events).not.toContain('archive')
  })

  it('an unexpected requeue bug escapes without authorizing retirement', async () => {
    const flow = new Flow()
    const defect = new Error('requeue implementation defect')
    flow.claims.failure = defect

    await expect(flow.run()).rejects.toBe(defect)

    expect(flow.records.active).toBe(CleanupMother.WATCH)
    expect(flow.events).not.toContain('archive')
  })

  it('archive refusal keeps the active descriptor', async () => {
    const flow = new Flow()
    flow.records.archiveFailure = new Error('archive refused')

    await expect(flow.run()).rejects.toThrow('archive refused')

    expect(flow.records.active).toBe(CleanupMother.WATCH)
  })

  it.each([
    ['proof read', (flow: Flow) => { flow.records.proofFailure = new Error('proof read refused') }],
    ['initial status read', (flow: Flow) => { flow.issues.failures.set(1, new Error('initial status refused')) }],
    ['eligibility inspection', (flow: Flow) => { flow.workspace.refusal = new Error('inspection refused') }],
    ['snapshot write', (flow: Flow) => { flow.records.snapshotFailure = new Error('snapshot write refused') }],
    ['worktree removal', (flow: Flow) => { flow.workspace.failedEffect = 'worktree-removal' }],
    ['branch removal', (flow: Flow) => { flow.workspace.failedEffect = 'branch-removal' }],
    ['first absence confirmation', (flow: Flow) => { flow.workspace.failedEffect = 'confirm-absent-1' }],
    ['status read before checked requeue', (flow: Flow) => { flow.issues.failures.set(2, new Error('release status refused')) }],
  ] as const)('each cleanup cut before requeue preserves actual state at %s', async (_cut, arrange) => {
    const flow = new Flow()
    arrange(flow)

    await expect(flow.run()).rejects.toThrow()

    expect(flow.issues.status).toBe(PlanIssueStatus.IN_PROGRESS)
    expect(flow.claims.calls).toBe(0)
    expect(flow.records.active).toBe(CleanupMother.WATCH)
    expect(flow.events).not.toContain('archive')
  })

  it('checked requeue failure before effect invents no release', async () => {
    const flow = new Flow()
    flow.claims.failure = new PlanIssueNotClaimed('checked requeue refused')

    await expect(flow.run()).rejects.toThrow('checked requeue refused')

    expect(flow.issues.status).toBe(PlanIssueStatus.IN_PROGRESS)
    expect(flow.records.active).toBe(CleanupMother.WATCH)
    expect(flow.events).not.toContain('archive')
  })

  it('artifact reappearance after requeue blocks archive without another deletion', async () => {
    const flow = new Flow()
    flow.workspace.reappearAtConfirmation = 2

    await expect(flow.run()).rejects.toThrow('cleanup artifacts remain')

    expect(flow.issues.status).toBe(PlanIssueStatus.READY)
    expect(flow.events.filter((event) => event === 'undo')).toHaveLength(1)
    expect(flow.records.active).toBe(CleanupMother.WATCH)
  })

  it('archive retry observes ready and does not requeue again', async () => {
    const flow = new Flow()
    flow.records.archiveFailure = new Error('archive rename refused')
    await expect(flow.run()).rejects.toThrow('archive rename refused')
    expect(flow.issues.status).toBe(PlanIssueStatus.READY)
    expect(flow.claims.calls).toBe(1)

    flow.records.archiveFailure = null
    await flow.run()

    expect(flow.claims.calls).toBe(1)
    expect(flow.records.active).toBeNull()
    expect(flow.records.archived).toBe(CleanupMother.WATCH)
  })

  it('retired cleanup cannot affect a newer dispatch', async () => {
    const flow = new Flow()
    flow.records.archived = CleanupMother.WATCH
    flow.records.active = new PlanWatch({
      ...CleanupMother.WATCH,
      agent: '22222222-2222-4222-8222-222222222222',
    })

    await flow.run()

    expect(flow.events).toEqual([])
  })

  it('successful retirement removes the active record', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.records.active).toBeNull()
    expect(flow.records.archived).toBe(CleanupMother.WATCH)
  })
})
