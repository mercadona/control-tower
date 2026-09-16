import { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import type { PlanCallPurpose } from '../../src/domain/value-objects/plan-call.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RegisteredCheckout } from '../../src/domain/value-objects/registered-checkout.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { UnusedWorkspace } from '../../src/domain/value-objects/unused-workspace.ts'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.ts'
import { CallInvocation, ClaudeCalls } from '../../src/infrastructure/claude-calls.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import { RecordedPlanRecovery } from '../../src/infrastructure/recorded-plan-recovery.ts'
import { ReviewWatch } from '../../src/infrastructure/review-watch.ts'
import { ReviewLog } from '../../src/domain/ports/review-log.ts'

class RememberingCheckouts extends CheckoutRegistry {
  readonly remembered: RegisteredCheckout[] = []

  remember(checkout: RegisteredCheckout): void {
    this.remembered.push(checkout)
  }
}

class RecordingReviews extends ReviewWatch {
  readonly started: PlanWatch[] = []
  readonly stopped: string[] = []

  constructor() {
    super({
      asked: async () => ({ changes: [] }),
      review: async () => {},
      sleep: async () => {},
      stderr: () => {},
      label: 'recorded recovery review double',
      log: new ReviewLog(),
    })
  }

  override startRecovered(watch: PlanWatch): Promise<void> {
    this.started.push(watch)
    return Promise.resolve()
  }

  override stop(asked: { issue: number, repository: RepositoryName }): void {
    this.stopped.push(`${asked.repository.text}#${asked.issue}`)
  }
}

class AcceptedChild extends ChildProcess {}

class RecoveryMother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly SECOND_CALL = '22222222-2222-4222-8222-222222222222'
  static readonly THIRD_CALL = '33333333-3333-4333-8333-333333333333'
  static readonly REPOSITORY = 'mercadona/control-tower-plugin'
  static readonly ISSUE = 331
  static readonly STARTED_AT = '2026-09-15T10:00:00.000Z'

  readonly stateRoot: string
  readonly checkoutRoot: string
  readonly worktree: string
  readonly files: HeadlessFiles
  readonly records: DiskPlanRecords
  readonly calls: ClaudeCalls
  readonly sessions: PlanSessions
  readonly activePlans: ActivePlans
  readonly checkouts: RememberingCheckouts
  readonly reviews: RecordingReviews
  readonly recovery: RecordedPlanRecovery

  private constructor(stateRoot: string, checkoutRoot: string) {
    this.stateRoot = stateRoot
    this.checkoutRoot = checkoutRoot
    this.worktree = join(checkoutRoot, '.worktrees', String(RecoveryMother.ISSUE))
    this.files = new HeadlessFiles({ root: stateRoot, fs, newId: () => 'temporary-record' })
    this.records = new DiskPlanRecords({
      files: this.files,
      newId: () => { throw new Error('recovery never prepares a plan') },
      now: () => { throw new Error('recovery never asks for the current time') },
      exists: async (path) => {
        try {
          await fs.stat(path)
          return true
        } catch (cause) {
          if (cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') return false
          throw cause
        }
      },
    })
    this.calls = new ClaudeCalls({
      files: this.files,
      binary: '/usr/local/bin/claude',
      worker: '/backend/headless-call-worker.ts',
      spawn: (() => { throw new Error('recovery must never launch a process') }) as typeof import('node:child_process').spawn,
      env: {},
      newId: () => { throw new Error('recovery must never mint a call') },
      now: () => { throw new Error('recovery must never ask for the current time') },
      budgetMs: 100,
      killGraceMs: 20,
      acceptanceMs: 50,
      pollMs: 10,
      sleep: async () => { throw new Error('recovery must never poll a call') },
    })
    this.sessions = new PlanSessions()
    this.activePlans = new ActivePlans({ sessions: this.sessions })
    this.checkouts = new RememberingCheckouts()
    this.reviews = new RecordingReviews()
    this.recovery = new RecordedPlanRecovery({
      records: this.records,
      calls: this.calls,
      checkouts: this.checkouts,
      activePlans: this.activePlans,
      reviews: this.reviews,
    })
  }

  static async recorded(): Promise<RecoveryMother> {
    const stateRoot = await mkdtemp(join(tmpdir(), 'ct-recorded-recovery-state-'))
    const checkoutRoot = await mkdtemp(join(tmpdir(), 'ct-recorded-recovery-checkout-'))
    const fixture = new RecoveryMother(stateRoot, checkoutRoot)
    await fs.mkdir(fixture.worktree, { recursive: true })
    await fixture.writeDispatch()
    return fixture
  }

  static completion(asked: {
    execution?: { kind: 'success' } | { kind: 'error' | 'unavailable', diagnostic: string },
    cost?: Record<string, unknown>,
  } = {}): string {
    return `${JSON.stringify({
      code: asked.execution?.kind === 'error' ? 1 : 0,
      signal: null,
      finishedAt: '2026-09-15T10:01:00.000Z',
      wallDurationMs: 60_000,
      execution: asked.execution ?? { kind: 'success' },
      measurement: {
        cost: asked.cost ?? { kind: 'reported', totalUsd: 0.42, attribution: 'unverified-resume' },
        turns: 2,
        durationMs: 55_000,
        unavailable: [],
      },
    }, null, 2)}\n`
  }

  static argvFor(purpose: PlanCallPurpose): string[] {
    switch (purpose) {
      case 'plan':
        return ['--session-id', RecoveryMother.CONVERSATION]
      case 'implementation':
        return ['--resume', RecoveryMother.CONVERSATION]
      case 'fix':
        return ['--resume', RecoveryMother.CONVERSATION]
    }
  }

  async writeDispatch(): Promise<void> {
    const directory = join(this.stateRoot, 'harness', RecoveryMother.CONVERSATION)
    await fs.mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'dispatch.json'), `${JSON.stringify({
      repository: RecoveryMother.REPOSITORY,
      issue: {
        number: RecoveryMother.ISSUE,
        url: `https://github.com/${RecoveryMother.REPOSITORY}/issues/${RecoveryMother.ISSUE}`,
      },
      story: null,
      root: this.checkoutRoot,
      worktree: this.worktree,
      branch: `feat/${RecoveryMother.ISSUE}`,
      startedAt: RecoveryMother.STARTED_AT,
    }, null, 2)}\n`, 'utf8')
  }

  async writeCall(asked: {
    id?: string,
    purpose?: PlanCallPurpose,
    startedAt?: string,
    completion?: string | null,
  } = {}): Promise<string> {
    const id = asked.id ?? RecoveryMother.SECOND_CALL
    const purpose = asked.purpose ?? 'implementation'
    const directory = join(this.stateRoot, 'harness', RecoveryMother.CONVERSATION, 'calls', id)
    await fs.mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'call.json'), `${JSON.stringify({
      conversation: RecoveryMother.CONVERSATION,
      purpose,
      requestId: null,
      cwd: this.worktree,
      binary: '/usr/local/bin/claude',
      argv: RecoveryMother.argvFor(purpose),
      startedAt: asked.startedAt ?? RecoveryMother.STARTED_AT,
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    }, null, 2)}\n`, 'utf8')
    await writeFile(join(directory, 'prompt.md'), 'Read the recorded prompt.', 'utf8')
    if (asked.completion !== null && asked.completion !== undefined) {
      await writeFile(join(directory, 'completion.json'), asked.completion, 'utf8')
    }
    return directory
  }

  async remove(): Promise<void> {
    await Promise.all([
      rm(this.stateRoot, { recursive: true, force: true }),
      rm(this.checkoutRoot, { recursive: true, force: true }),
    ])
  }
}

describe('RecordedPlanRecovery', () => {
  const fixtures: RecoveryMother[] = []

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.remove()))
  })

  it('restart discovers the original plan with no process or checkout registry', async () => {
    const fixture = await RecoveryMother.recorded()
    fixtures.push(fixture)
    await fixture.writeCall({ purpose: 'implementation', completion: RecoveryMother.completion() })

    expect(await fixture.recovery.recover()).toBeNull()

    expect(fixture.activePlans.known()).toEqual([
      expect.objectContaining({
        phase: 'implementing',
        plan: expect.objectContaining({ agent: RecoveryMother.CONVERSATION }),
      }),
    ])
    expect(fixture.checkouts.remembered).toHaveLength(1)
  })

  it('an unowned incomplete call is uncertain and never relaunched', async () => {
    const fixture = await RecoveryMother.recorded()
    fixtures.push(fixture)
    const directory = await fixture.writeCall({ completion: null })
    const descriptor = await readFile(join(directory, 'call.json'), 'utf8')

    expect(await fixture.recovery.recover()).toBeNull()

    expect(fixture.activePlans.known()).toEqual([
      expect.objectContaining({ phase: 'uncertain', diagnostic: expect.stringContaining('not owned') }),
    ])
    expect(await readFile(join(directory, 'call.json'), 'utf8')).toBe(descriptor)
    await expect(readFile(join(directory, 'completion.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['plan', 'planning'],
    ['implementation', 'implementing'],
    ['fix', 'implementing'],
  ] as const)('an accepted live %s call projects its explicit purpose phase', async (purpose, phase) => {
    const fixture = await RecoveryMother.recorded()
    fixtures.push(fixture)
    const child = new AcceptedChild()
    const calls = new ClaudeCalls({
      files: fixture.files,
      binary: '/usr/local/bin/claude',
      worker: '/backend/headless-call-worker.ts',
      spawn: (() => {
        queueMicrotask(() => child.emit('message', { kind: 'accepted' }))
        return child
      }) as typeof import('node:child_process').spawn,
      env: {},
      newId: () => RecoveryMother.SECOND_CALL,
      now: () => RecoveryMother.STARTED_AT,
      budgetMs: 100,
      killGraceMs: 20,
      acceptanceMs: 50,
      pollMs: 10,
      sleep: async () => {},
    })
    await calls.start(new CallInvocation({
      conversation: RecoveryMother.CONVERSATION,
      purpose,
      cwd: fixture.worktree,
      argv: RecoveryMother.argvFor(purpose),
      prompt: 'Plan the recorded issue.',
    }))
    const recovery = new RecordedPlanRecovery({
      records: fixture.records,
      calls,
      checkouts: fixture.checkouts,
      activePlans: fixture.activePlans,
      reviews: fixture.reviews,
    })

    await recovery.recover()

    expect(fixture.activePlans.known()[0].phase).toBe(phase)
  })

  it('a completed planner without continuation stays recoverable', async () => {
    const fixture = await RecoveryMother.recorded()
    fixtures.push(fixture)
    await fixture.writeCall({
      purpose: 'plan',
      completion: RecoveryMother.completion({
        cost: { kind: 'reported', totalUsd: 0.42, attribution: 'initial-invocation' },
      }),
    })

    expect(await fixture.recovery.recover()).toBeNull()

    expect(fixture.activePlans.known()).toEqual([
      expect.objectContaining({
        phase: 'uncertain',
        plan: expect.objectContaining({ agent: RecoveryMother.CONVERSATION }),
        diagnostic: expect.stringContaining('continuation'),
      }),
    ])
  })

  it('later completion refreshes projection without rewriting records', async () => {
    const fixture = await RecoveryMother.recorded()
    fixtures.push(fixture)
    const directory = await fixture.writeCall({ completion: null })
    const descriptor = await readFile(join(directory, 'call.json'), 'utf8')
    await fixture.recovery.recover()
    expect(fixture.activePlans.known()[0].phase).toBe('uncertain')

    await writeFile(join(directory, 'completion.json'), RecoveryMother.completion(), 'utf8')
    expect(await fixture.recovery.recover()).toBeNull()

    expect(fixture.activePlans.known()[0].phase).toBe('implementing')
    expect(await readFile(join(directory, 'call.json'), 'utf8')).toBe(descriptor)
  })

  it('successful execution with unverified resumed cost remains implementing', async () => {
    const fixture = await RecoveryMother.recorded()
    fixtures.push(fixture)
    await fixture.writeCall({
      purpose: 'fix',
      completion: RecoveryMother.completion({
        cost: { kind: 'reported', totalUsd: 1.051838, attribution: 'unverified-resume' },
      }),
    })

    await fixture.recovery.recover()

    expect(fixture.activePlans.known()[0].phase).toBe('implementing')
  })

  it('repeated recovery starts one review watcher and forgets harvested work', async () => {
    const fixture = await RecoveryMother.recorded()
    fixtures.push(fixture)
    await fixture.writeCall({ completion: RecoveryMother.completion() })

    await fixture.recovery.recover()
    await fixture.recovery.recover()
    expect(fixture.reviews.started).toHaveLength(1)

    await rm(fixture.worktree, { recursive: true, force: true })
    await fixture.recovery.recover()

    expect(fixture.activePlans.known()).toEqual([])
    expect(fixture.reviews.stopped).toContain(`${RecoveryMother.REPOSITORY}#${RecoveryMother.ISSUE}`)
  })

  it('partial cleanup remains visible without its worktree', async () => {
    const fixture = await RecoveryMother.recorded()
    fixtures.push(fixture)
    const watch = await fixture.records.recorded(RecoveryMother.CONVERSATION)
    if (watch === null) throw new Error('fixture dispatch is absent')
    await fixture.records.recordCleanupEvidence(new UnusedWorkspace({
      watch,
      baseSha: 'a'.repeat(40),
      checkedAt: RecoveryMother.STARTED_AT,
    }))
    await rm(fixture.worktree, { recursive: true, force: true })

    await fixture.recovery.recover()

    expect(fixture.activePlans.known()).toEqual([
      expect.objectContaining({
        phase: 'uncertain',
        plan: expect.objectContaining({ agent: RecoveryMother.CONVERSATION }),
      }),
    ])
  })

  it('uncertainty and renewed implementation cannot revive the stopped review loop', async () => {
    const fixture = await RecoveryMother.recorded()
    fixtures.push(fixture)
    let releaseOldSleep!: () => void
    let releaseNewBaseline!: (answer: { changes: readonly never[] }) => void
    let releaseNewSleep!: () => void
    const oldSleep = new Promise<void>((resolve) => { releaseOldSleep = resolve })
    const newBaseline = new Promise<{ changes: readonly never[] }>((resolve) => { releaseNewBaseline = resolve })
    const newSleep = new Promise<void>((resolve) => { releaseNewSleep = resolve })
    let reads = 0
    let sleeps = 0
    let deliveries = 0
    const reviews = new ReviewWatch({
      asked: async () => {
        reads += 1
        if (reads === 1) return { changes: [] }
        if (reads === 2) return newBaseline
        throw new Error(`nobody wrote an answer for review read ${reads}`)
      },
      review: async () => { deliveries += 1 },
      sleep: () => {
        sleeps += 1
        if (sleeps === 1) return oldSleep
        if (sleeps === 2) return newSleep
        throw new Error(`nobody wrote an answer for review sleep ${sleeps}`)
      },
      stderr: () => {},
      label: 'recorded recovery review lifecycle',
      log: new ReviewLog(),
    })
    const recovery = new RecordedPlanRecovery({
      records: fixture.records,
      calls: fixture.calls,
      checkouts: fixture.checkouts,
      activePlans: fixture.activePlans,
      reviews,
    })
    await fixture.writeCall({ completion: RecoveryMother.completion() })
    await recovery.recover()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(reads).toBe(1)
    expect(sleeps).toBe(1)

    await fixture.writeCall({
      id: RecoveryMother.THIRD_CALL,
      startedAt: '2026-09-15T10:02:00.000Z',
      completion: RecoveryMother.completion({ execution: { kind: 'error', diagnostic: 'turn limit reached' } }),
    })
    await recovery.recover()
    expect(fixture.activePlans.known()[0].phase).toBe('uncertain')

    await fixture.writeCall({
      id: '44444444-4444-4444-8444-444444444444',
      startedAt: '2026-09-15T10:03:00.000Z',
      completion: RecoveryMother.completion(),
    })
    await recovery.recover()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    const registration = reviews.live.get(`${RecoveryMother.REPOSITORY}#${RecoveryMother.ISSUE}`)

    releaseOldSleep()
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(reads).toBe(2)
    expect(deliveries).toBe(0)
    expect(reviews.live.get(`${RecoveryMother.REPOSITORY}#${RecoveryMother.ISSUE}`)).toBe(registration)
    releaseNewBaseline({ changes: [] })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    reviews.stop({ issue: RecoveryMother.ISSUE, repository: new RepositoryName(RecoveryMother.REPOSITORY) })
    releaseNewSleep()
  })

  it('corrupt or ambiguous evidence is not an empty successful recovery', async () => {
    const corrupt = await RecoveryMother.recorded()
    fixtures.push(corrupt)
    const corruptDirectory = await corrupt.writeCall({ completion: null })
    await writeFile(join(corruptDirectory, 'call.json'), '{bad', 'utf8')

    expect(await corrupt.recovery.recover()).toContain('cannot be read as a call descriptor')
    expect(corrupt.activePlans.known()).toEqual([])

    const ambiguous = await RecoveryMother.recorded()
    fixtures.push(ambiguous)
    await ambiguous.writeCall({
      id: RecoveryMother.SECOND_CALL,
      purpose: 'plan',
      completion: RecoveryMother.completion({
        cost: { kind: 'reported', totalUsd: 0.42, attribution: 'initial-invocation' },
      }),
    })
    await ambiguous.writeCall({
      id: RecoveryMother.THIRD_CALL,
      purpose: 'implementation',
      completion: RecoveryMother.completion(),
    })

    expect(await ambiguous.recovery.recover()).toBeNull()
    expect(ambiguous.activePlans.known()).toEqual([
      expect.objectContaining({ phase: 'uncertain', diagnostic: expect.stringContaining('ambiguous') }),
    ])
  })
})
