import { describe, expect, it } from 'vitest'
import { CleanupPlan, CleanupPlanParams } from '../../src/application/actions/cleanup-plan.ts'
import { DispatchClaims } from '../../src/domain/ports/dispatch-claims.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import { PlanCleanupConflict, PlanIssueNotClaimed } from '../../src/domain/exceptions.ts'
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

  constructor(events: string[]) {
    super()
    this.events = events
  }

  override async recorded(): Promise<PlanWatch | null> { return this.active }
  override async retired(): Promise<PlanWatch | null> { return this.archived }
  override async nonLaunch(): Promise<PlanNonLaunch | null> { return CleanupMother.PROOF }
  override async cleanupEvidence(): Promise<UnusedWorkspace | null> { return this.snapshot }
  override async recordCleanupEvidence(evidence: UnusedWorkspace): Promise<void> {
    this.events.push('evidence')
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

  constructor(events: string[]) { super(); this.events = events }

  override async inspectUnlaunched(): Promise<UnusedWorkspace> {
    this.events.push('inspect')
    if (this.refusal !== null) throw this.refusal
    return this.evidence
  }

  override async undoUnlaunched(): Promise<void> { this.effect('undo') }
  override async confirmAbsent(): Promise<void> {
    this.confirmations += 1
    this.effect(`confirm-absent-${this.confirmations}`)
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

  constructor(events: string[]) { super(); this.events = events }

  override async requeue(): Promise<void> {
    this.events.push('requeue')
    this.calls += 1
    if (this.failure !== null) throw this.failure
  }
}

class IssuesDouble extends PlanIssues {
  statuses: PlanIssueStatusValue[] = [
    PlanIssueStatus.IN_PROGRESS,
    PlanIssueStatus.IN_PROGRESS,
    PlanIssueStatus.READY,
  ]

  override async statusOf(): Promise<PlanIssueStatusValue> {
    return this.statuses.shift() ?? PlanIssueStatus.READY
  }
}

class Flow {
  readonly events: string[] = []
  readonly records = new RecordsDouble(this.events)
  readonly workspace = new WorkspaceDouble(this.events)
  readonly claims = new ClaimsDouble(this.events)
  readonly issues = new IssuesDouble()
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
    flow.issues.statuses = [PlanIssueStatus.READY, PlanIssueStatus.READY]

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
    flow.issues.statuses = [PlanIssueStatus.IN_PROGRESS, PlanIssueStatus.IN_PROGRESS, PlanIssueStatus.READY]

    await flow.run()

    expect(flow.claims.calls).toBe(1)
    expect(flow.events.at(-1)).toBe('archive')
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
