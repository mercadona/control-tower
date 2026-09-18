import { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { issuesQueryFor } from '../../../plugin/scripts/gh-issues.js'
import { describe, expect, it } from 'vitest'
import { Baseline } from '../../../plugin/scripts/baseline.js'
import { ContinuePlan } from '../../src/application/actions/continue-plan.ts'
import { RecoverPlan } from '../../src/application/actions/recover-plan.ts'
import { StartMilestonePlan } from '../../src/application/actions/start-milestone-plan.ts'
import {
  EpicGroomRead, EpicGroomState, ReadEpicGroom,
} from '../../src/application/queries/read-epic-groom.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { EpicGroom } from '../../src/domain/ports/epic-groom.ts'
import { EpicIssues } from '../../src/domain/ports/epic-issues.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { LiveSessions, type LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { PublishedSpecs } from '../../src/domain/ports/published-specs.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { PlanFingerprint } from '../../src/domain/policies/plan-fingerprint.ts'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'
import { SpecRevision } from '../../src/domain/policies/spec-revision.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RegisteredCheckout } from '../../src/domain/value-objects/registered-checkout.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.ts'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { ClaudeCallResult } from '../../src/infrastructure/claude-call-result.ts'
import {
  CallDescriptor, ClaudeCalls, StoredCompletion,
} from '../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../src/infrastructure/claude-plan-calls.ts'
import {
  CoordinatingSessions, CoordinatingSessionState, HeldCoordinatingSession,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { DispatchCheckClaims } from '../../src/infrastructure/dispatch-check-claims.ts'
import { GhDispatchCandidates } from '../../src/infrastructure/gh-dispatch-candidates.ts'
import { GhPlanPublication } from '../../src/infrastructure/gh-plan-publication.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { GitWorkspace, SliceSeed } from '../../src/infrastructure/git-workspace.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { HeadlessPlanAgents } from '../../src/infrastructure/headless-plan-agents.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'
import { PlanContractProgress } from '../../src/infrastructure/plan-contract-progress.ts'
import { PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import { RecordedPlanRecovery } from '../../src/infrastructure/recorded-plan-recovery.ts'
import { ReviewWatch } from '../../src/infrastructure/review-watch.ts'
import { ReviewLog } from '../../src/domain/ports/review-log.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'

class AcceptedWorker extends ChildProcess {}

class Deferred {
  readonly promise: Promise<void>
  #resolve!: () => void
  released = false

  constructor() {
    this.promise = new Promise((resolve) => { this.#resolve = resolve })
  }

  release(): void {
    this.released = true
    this.#resolve()
  }
}

class BoundedDrain {
  static async wait(promise: Promise<void>, milliseconds: number): Promise<void> {
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<void>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`supervised work did not settle within ${milliseconds}ms`)), milliseconds)
    })
    try {
      await Promise.race([promise, timeout])
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  static async value<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`operation did not settle within ${milliseconds}ms`)), milliseconds)
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }
}

class RememberingCheckouts extends CheckoutRegistry {
  readonly remembered: RegisteredCheckout[] = []

  remember(checkout: RegisteredCheckout): void {
    this.remembered.push(checkout)
  }

  known(): RegisteredCheckout[] {
    return [...this.remembered]
  }
}

class CoordinatingLiveSessions extends LiveSessions {
  static readonly SESSION = new LiveSession({ id: 'coordinator', name: 'coordinator' })

  find(id: string): LiveSession | null {
    return id === CoordinatingLiveSessions.SESSION.id ? CoordinatingLiveSessions.SESSION : null
  }

  watch(): LiveSessionStream {
    return { printed: '', stop: (): void => {} }
  }
}

class AuthorisedGroom extends ReadEpicGroom {
  constructor() {
    super({
      specs: new EpicSpecs(),
      published: new PublishedSpecs(),
      issues: new EpicIssues(),
      groom: new EpicGroom(),
      branch: new EpicBranch(),
      pullRequests: new PullRequests(),
      fingerprint: new PlanFingerprint({ digest: (text) => text }),
      revisions: new SpecRevision({ digest: (text) => text }),
    })
  }

  override async execute(): Promise<EpicGroomRead> {
    return new EpicGroomRead({
      state: EpicGroomState.AUTHORISED,
      spec: null,
      milestone: Rehearsal.MILESTONE,
      plan: null,
      planFingerprint: null,
      issues: [],
    })
  }
}

type BoundaryCall = Readonly<{ tool: 'gh' | 'git' | 'node', argv: readonly string[], cwd: string | null }>

class ScriptedBoundaries {
  readonly calls: BoundaryCall[] = []
  readonly trace: string[]
  readonly checkoutRoot: string
  readonly worktree: string
  readonly commonGit: string
  readonly attemptsPath: string
  readonly attemptBytes: string
  readonly seedPath: string
  readonly publicationBodyPath: string
  readonly failFirstPublication: boolean
  readonly failRecoveryPublication: boolean
  postedBody: string | null = null
  publicationAttempts = 0

  constructor(root: string, trace: string[], failFirstPublication: boolean, failRecoveryPublication: boolean) {
    this.trace = trace
    this.failFirstPublication = failFirstPublication
    this.failRecoveryPublication = failRecoveryPublication
    this.checkoutRoot = join(root, 'checkout')
    this.worktree = join(this.checkoutRoot, '.worktrees', String(Rehearsal.ISSUE))
    this.commonGit = join(root, 'git-common')
    this.attemptsPath = join(this.worktree, 'docs', 'superpowers', 'metrics', `issue-${Rehearsal.ISSUE}.jsonl`)
    this.attemptBytes = '{"step":"implement","task":1,"attempt":1,"outcome":"done"}\n'
    this.seedPath = join(this.worktree, SliceSeed.RELATIVE_PATH)
    this.publicationBodyPath = join(
      root, 'state', 'harness', Rehearsal.CONVERSATION, 'publication', Rehearsal.PLAN_HASH, 'part-1.md',
    )
  }

  readonly gh = async (argv: string[]): Promise<ProcessOutput> => {
    if (ScriptedBoundaries.same(argv, Rehearsal.listing(['OPEN']))) {
      this.accept('gh', argv, null)
      return ScriptedBoundaries.output(Rehearsal.pages([Rehearsal.issueNode()]))
    }
    if (ScriptedBoundaries.same(argv, Rehearsal.listing(['CLOSED']))) {
      this.accept('gh', argv, null)
      return ScriptedBoundaries.output(Rehearsal.pages([]))
    }
    if (ScriptedBoundaries.same(argv, [
      'issue', 'view', String(Rehearsal.ISSUE), '--repo', Rehearsal.REPOSITORY,
      '--json', 'number,title,body,labels,milestone',
    ])) {
      this.accept('gh', argv, null)
      return ScriptedBoundaries.output(JSON.stringify(Rehearsal.issueView()))
    }
    if (ScriptedBoundaries.same(argv, [
      'api', `repos/${Rehearsal.REPOSITORY}/issues/${Rehearsal.ISSUE}/comments`, '--paginate', '--slurp',
    ])) {
      this.accept('gh', argv, null)
      return ScriptedBoundaries.output('[[]]')
    }
    if (ScriptedBoundaries.same(argv, [
      'issue', 'comment', String(Rehearsal.ISSUE), '--repo', Rehearsal.REPOSITORY,
      '--body-file', this.publicationBodyPath,
    ])) {
      this.accept('gh', argv, null)
      this.postedBody = await readFile(this.publicationBodyPath, 'utf8')
      this.publicationAttempts += 1
      if ((this.failFirstPublication && this.publicationAttempts === 1)
        || (this.failRecoveryPublication && this.publicationAttempts === 2)) {
        this.trace.push('publication-refused')
        return new ProcessOutput({ code: 1, stdout: '', stderr: 'scripted publication refusal' })
      }
      this.trace.push('publish')
      return ScriptedBoundaries.output('')
    }
    throw new Error(`unlisted gh command: ${JSON.stringify(argv)}`)
  }

  readonly git = async (argv: string[]): Promise<ProcessOutput> => {
    if (this.accepts(argv, ['-C', this.checkoutRoot, 'remote', 'get-url', 'origin'])) {
      return ScriptedBoundaries.output(`git@github.com:${Rehearsal.REPOSITORY}.git\n`)
    }
    if (this.accepts(argv, ['-C', this.checkoutRoot, 'rev-parse', '--show-toplevel'])) {
      return ScriptedBoundaries.output(`${this.checkoutRoot}\n`)
    }
    if (this.accepts(argv, ['-C', this.checkoutRoot, 'symbolic-ref', 'refs/remotes/origin/HEAD'])) {
      return ScriptedBoundaries.output('refs/remotes/origin/main\n')
    }
    if (this.accepts(argv, ['-C', this.checkoutRoot, 'fetch', 'origin', 'main'])) {
      return ScriptedBoundaries.output('')
    }
    if (this.accepts(argv, ['-C', this.checkoutRoot, 'rev-parse', '--verify', '--quiet', 'origin/main^{commit}'])) {
      return ScriptedBoundaries.output(`${'a'.repeat(40)}\n`)
    }
    if (this.accepts(argv, [
      '-C', this.checkoutRoot, 'worktree', 'add', '-b', `feat/${Rehearsal.ISSUE}`,
      this.worktree, 'origin/main',
    ])) {
      await fs.mkdir(dirname(this.attemptsPath), { recursive: true })
      await fs.mkdir(join(this.commonGit, 'info'), { recursive: true })
      await fs.writeFile(this.attemptsPath, this.attemptBytes, 'utf8')
      return ScriptedBoundaries.output('')
    }
    if (this.accepts(argv, ['-C', this.worktree, 'rev-parse', '--git-common-dir'])) {
      return ScriptedBoundaries.output(`${this.commonGit}\n`)
    }
    if (this.accepts(argv, ['-C', this.worktree, 'status', '--porcelain', '--untracked-files=all'])) {
      return ScriptedBoundaries.output('')
    }
    if (this.accepts(argv, ['-C', this.worktree, 'status', '--porcelain', '--', PlanContractProgress.PLANS])) {
      return ScriptedBoundaries.output('')
    }
    if (this.accepts(argv, [
      '-C', this.worktree, 'ls-tree', '-r', '--name-only', 'HEAD', '--', PlanContractProgress.PLANS,
    ])) {
      return ScriptedBoundaries.output(`${Rehearsal.PLAN_PATH}\n`)
    }
    if (this.accepts(argv, ['-C', this.worktree, 'show', `HEAD:${Rehearsal.PLAN_PATH}`])) {
      return ScriptedBoundaries.output(Rehearsal.PLAN)
    }
    throw new Error(`unlisted git command: ${JSON.stringify(argv)}`)
  }

  readonly node = async (argv: string[], options: { cwd?: string } = {}): Promise<ProcessOutput> => {
    const cwd = options.cwd ?? null
    if (cwd === this.worktree && ScriptedBoundaries.same(argv, [
      '/plugin/dispatch-check.mjs', String(Rehearsal.ISSUE), '--repo', Rehearsal.REPOSITORY, '--check-plan',
    ])) {
      this.accept('node', argv, cwd)
      return ScriptedBoundaries.output('')
    }
    if (cwd === this.checkoutRoot && ScriptedBoundaries.same(argv, [
      '/plugin/dispatch-check.mjs', String(Rehearsal.ISSUE), '--repo', Rehearsal.REPOSITORY,
    ])) {
      this.accept('node', argv, cwd)
      this.trace.push('claim')
      return ScriptedBoundaries.output('')
    }
    throw new Error(`unlisted node command: ${JSON.stringify(argv)}`)
  }

  static output(stdout: string): ProcessOutput {
    return new ProcessOutput({ code: 0, stdout, stderr: '' })
  }

  private accepts(argv: readonly string[], expected: readonly string[]): boolean {
    if (!ScriptedBoundaries.same(argv, expected)) return false
    this.accept('git', argv, null)
    return true
  }

  private accept(tool: BoundaryCall['tool'], argv: readonly string[], cwd: string | null): void {
    this.calls.push({ tool, argv: [...argv], cwd })
  }

  static same(actual: readonly string[], expected: readonly string[]): boolean {
    return actual.length === expected.length && actual.every((argument, index) => argument === expected[index])
  }
}

class Rehearsal {
  static readonly REPOSITORY = 'mercadona/control-tower-plugin'
  static readonly MILESTONE = 'Headless delivery'
  static readonly ISSUE = 331
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly PLAN_CALL = '22222222-2222-4222-8222-222222222222'
  static readonly IMPLEMENTATION_CALL = '33333333-3333-4333-8333-333333333333'
  static readonly STARTED_AT = '2026-09-16T09:00:00.000Z'
  static readonly FINISHED_AT = '2026-09-16T09:00:09.000Z'
  static readonly PLAN_PATH = 'docs/superpowers/plans/2026-09-16-issue-331-headless.md'
  static readonly PLAN = '# Issue 331 plan\n\nCommitted rehearsal plan.\n'
  static readonly PLAN_HASH = createHash('sha256').update(Rehearsal.PLAN).digest('hex')
  static readonly INITIAL_FIXTURE = join(
    import.meta.dirname, 'fixtures', 'claude-result-initial.jsonl',
  )

  static issue(): Record<string, unknown> {
    return {
      number: Rehearsal.ISSUE,
      html_url: `https://github.com/${Rehearsal.REPOSITORY}/issues/${Rehearsal.ISSUE}`,
      title: 'Headless dispatcher',
      body: '<!-- ct-order:1 -->',
      milestone: { number: 1, title: Rehearsal.MILESTONE },
      labels: [{ name: 'status:ready' }, { name: 'gate:none' }],
    }
  }

  static listing(states: string[]): string[] {
    const [owner, name] = Rehearsal.REPOSITORY.split('/')
    return ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${issuesQueryFor(states)}`, '-f', `owner=${owner}`, '-f', `name=${name}`]
  }

  static issueNode(): Record<string, unknown> {
    const issue = Rehearsal.issue()
    return {
      number: issue.number,
      url: issue.html_url,
      title: issue.title,
      body: issue.body,
      state: 'OPEN',
      stateReason: null,
      milestone: { ...(issue.milestone as Record<string, unknown>), description: null },
      labels: { nodes: issue.labels },
    }
  }

  static pages(nodes: Record<string, unknown>[]): string {
    return JSON.stringify([{ data: { repository: { issues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } }])
  }

  static issueView(): Record<string, unknown> {
    const issue = Rehearsal.issue()
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      milestone: issue.milestone,
      labels: issue.labels,
    }
  }

  static async plannerCompletion() {
    const fixture = readFileSync(Rehearsal.INITIAL_FIXTURE, 'utf8')
    return ClaudeCallResult.read({
      lines: (async function* () { yield fixture })(),
      call: { conversation: Rehearsal.CONVERSATION, id: Rehearsal.PLAN_CALL },
      code: 0,
      signal: null,
      finishedAt: Rehearsal.FINISHED_AT,
      wallDurationMs: 9_000,
      mode: 'initial',
    })
  }

  static deferredCompletion(): string {
    return `${JSON.stringify({
      code: null,
      signal: null,
      finishedAt: Rehearsal.FINISHED_AT,
      wallDurationMs: 9_000,
      execution: { kind: 'unavailable', diagnostic: 'scripted rehearsal closed after accepted continuation' },
      measurement: {
        cost: { kind: 'unavailable', reason: 'implementation completion was deliberately deferred' },
        turns: null,
        durationMs: null,
        unavailable: ['implementation completion was deliberately deferred'],
      },
    }, null, 2)}\n`
  }
}

describe('headless dispatch dry run', () => {
  type CleanupObligation = {
    release: Deferred,
    completed: Deferred,
    registered: boolean,
    finalize: () => void | Promise<void>,
  }

  const roots: string[] = []
  const servers: ApiServer[] = []
  const pending: CleanupObligation[] = []

  async function cleanup(): Promise<void> {
    const failures: unknown[] = []
    const obligations = pending.splice(0)
    const finalizations = obligations.map(async (obligation) => {
      try {
        await obligation.finalize()
      } catch (cause) {
        failures.push(cause)
      }
    })
    for (const obligation of obligations) obligation.release.release()
    await Promise.all(finalizations)
    await Promise.all(obligations.map(async (obligation) => {
      if (!obligation.registered) return
      try {
        await BoundedDrain.wait(obligation.completed.promise, 1_000)
      } catch (cause) {
        failures.push(cause)
      }
    }))
    try {
      await Promise.all(servers.splice(0).map((server) => server.stop()))
    } finally {
      await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
    }
    if (failures.length > 0) throw new AggregateError(failures, 'supervisor cleanup failed')
  }

  it.each([
    {
      title: 'headless start preserves publication', needsRecovery: false,
      abortAfterAcceptance: false, failBeforeAcceptance: false,
    },
    {
      title: 'coordinator recovery reaches the production continuation', needsRecovery: true,
      abortAfterAcceptance: false, failBeforeAcceptance: false,
    },
    {
      title: 'accepted recovery abort drains every registered supervisor', needsRecovery: true,
      abortAfterAcceptance: true, failBeforeAcceptance: false,
    },
    {
      title: 'publication failure before implementation acceptance drains its supervisor', needsRecovery: true,
      abortAfterAcceptance: false, failBeforeAcceptance: true,
    },
  ])('$title', async ({ needsRecovery, abortAfterAcceptance, failBeforeAcceptance }) => {
    const root = await mkdtemp(join(tmpdir(), 'ct-331-headless-rehearsal-'))
    roots.push(root)
    try {
    const stateRoot = join(root, 'state')
    const trace: string[] = []
    const boundaries = new ScriptedBoundaries(root, trace, needsRecovery, failBeforeAcceptance)
    await fs.mkdir(boundaries.checkoutRoot, { recursive: true })
    const files = new HeadlessFiles({ root: stateRoot, fs, newId: () => 'temporary-record' })
    const plannerCompletion = await Rehearsal.plannerCompletion()
    const releasePendingWait = new Deferred()
    let reportFailure!: () => void
    const diagnostic = new Promise<void>((resolve) => { reportFailure = resolve })
    const implementationAccepted = new Deferred()
    const initialSupervisorCompleted = new Deferred()
    const initialRegistrations: typeof pending = []
    const finalizeImplementation = async (obligation: CleanupObligation, descriptor: () => string | undefined) => {
      if (!obligation.registered) return
      const outcome = await BoundedDrain.value(Promise.race([
        implementationAccepted.promise.then(() => 'accepted' as const),
        obligation.completed.promise.then(() => 'completed' as const),
      ]), 1_000)
      if (outcome === 'completed') return
      const path = descriptor()
      if (path !== undefined) {
        writeFileSync(join(dirname(path), CallDescriptor.COMPLETION), Rehearsal.deferredCompletion())
      }
    }
    const callIds = [Rehearsal.PLAN_CALL, Rehearsal.IMPLEMENTATION_CALL]
    const spawnedDescriptors: string[] = []
    const calls = new ClaudeCalls({
      files,
      binary: '/usr/local/bin/claude',
      worker: '/backend/headless-call-worker.ts',
      spawn: ((binary: string, argv: readonly string[]) => {
        const descriptorPath = argv[1]
        const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as Record<string, unknown>
        const promptPath = join(dirname(descriptorPath), CallDescriptor.PROMPT)
        expect(readFileSync(promptPath, 'utf8').length).toBeGreaterThan(0)
        expect(binary).toBe(process.execPath)
        expect(readFileSync(files.dispatchPath(Rehearsal.CONVERSATION), 'utf8')).toContain(`"issue": {`)
        if (descriptor.purpose === 'plan') {
          const seed = readFileSync(boundaries.seedPath, 'utf8')
          expect(seed).toContain(`branch: feat/${Rehearsal.ISSUE}`)
          expect(seed).toContain('base: main')
          expect(seed).toContain(`base_sha: ${'a'.repeat(40)}`)
          expect(seed).toContain(`github_issue: ${Rehearsal.ISSUE}`)
          expect(seed).toContain('outcome: verde')
          expect(seed).toContain('command: npm test')
          expect(seed).toContain('summary: exit 0 · passed')
        }
        spawnedDescriptors.push(descriptorPath)
        trace.push(`spawn-${String(descriptor.purpose)}`)
        if (descriptor.purpose === 'plan') {
          writeFileSync(join(dirname(descriptorPath), CallDescriptor.COMPLETION), StoredCompletion.text(plannerCompletion))
        } else {
          implementationAccepted.release()
        }
        const worker = new AcceptedWorker()
        queueMicrotask(() => worker.emit('message', { kind: 'accepted' }))
        return worker
      }) as typeof import('node:child_process').spawn,
      env: { PATH: '/usr/bin', CT_PHASE_PROMPT: '/coordinator.md', CT_SESSION_HOOKS_URL: 'http://hooks' },
      newId: () => {
        const next = callIds.shift()
        if (next === undefined) throw new Error('no further call id is authorised')
        return next
      },
      now: (() => {
        const times = ['2026-09-16T09:00:01.000Z', '2026-09-16T09:00:02.000Z']
        return () => times.shift() ?? '2026-09-16T09:00:02.000Z'
      })(),
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
      acceptanceMs: 10_000,
      pollMs: 250,
      sleep: async () => releasePendingWait.promise,
    })
    const gh = new Gh({
      launch: boundaries.gh,
      policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
      sleep: async () => {},
    })
    const records = new DiskPlanRecords({
      files,
      newId: () => Rehearsal.CONVERSATION,
      now: () => Rehearsal.STARTED_AT,
      exists: async (path) => fs.stat(path).then(() => true, () => false),
    })
    const planCalls = new ClaudePlanCalls({
      calls,
      brief: new PlanAgentBrief({
        dispatchCheck: '/plugin/dispatch-check.mjs',
        conventions: '/plugin/conventions',
        ctStep: '/plugin/ct-step.mjs',
      }),
      pluginRoot: '/plugin',
      resumable: async (watch) => watch.agent === Rehearsal.CONVERSATION,
      records,
      nowMs: () => Date.parse(Rehearsal.STARTED_AT),
    })
    const publication = new GhPlanPublication({
      gh,
      git: boundaries.git,
      progress: new PlanContractProgress({
        node: boundaries.node,
        git: boundaries.git,
        dispatchCheck: '/plugin/dispatch-check.mjs',
      }),
      files,
      digest: (text) => createHash('sha256').update(text).digest('hex'),
    })
    const continuation = new ContinuePlan({ calls: planCalls, publication })
    const agents = new class extends HeadlessPlanAgents {
      override async launch(briefing: PlanBriefing): Promise<string> {
        const launched = await super.launch(briefing)
        const obligation = initialRegistrations.shift()
        if (obligation !== undefined) obligation.registered = true
        return launched
      }
    }({
      records,
      calls: planCalls,
      continuation,
      newId: () => { throw new Error('fix identity is not requested') },
      stderr: () => {
        reportFailure()
        initialSupervisorCompleted.release()
      },
    })
    const workspace = new GitWorkspace({
      run: boundaries.git,
      write: async (path, text) => {
        await fs.mkdir(dirname(path), { recursive: true })
        await fs.writeFile(path, text, 'utf8')
        if (path === boundaries.seedPath) trace.push('seed-slice')
      },
      read: async (path) => fs.readFile(path, 'utf8').catch(() => null),
      stderr: () => {},
      baseline: new Baseline({
        read: () => 'test: `npm test`',
        run: async () => ({ code: 0, stdout: 'passed', stderr: '' }),
      }),
      gh,
    })
    const checkouts = new RememberingCheckouts()
    const start = new StartMilestonePlan({
      candidates: new GhDispatchCandidates({ gh }),
      claims: new DispatchCheckClaims({ node: boundaries.node, dispatchCheck: '/plugin/dispatch-check.mjs' }),
      workspace,
      agents,
      records,
      checkouts,
    })
    const coordinating = new CoordinatingSessions({
      liveSessions: new CoordinatingLiveSessions(), stderr: () => {},
    })
    coordinating.remember(new HeldCoordinatingSession({
      target: '6d13bc52-740f-49f8-b128-15e597674f3a',
      state: CoordinatingSessionState.LIVE,
      conversation: new CoordinatingConversation({
        id: new ConversationId('44444444-4444-4444-8444-444444444444'),
        repository: new RepositoryName(Rehearsal.REPOSITORY),
        root: new CheckoutRoot(boundaries.checkoutRoot),
      }),
      session: CoordinatingLiveSessions.SESSION,
      attention: SessionAttention.working(),
    }))
    if (!needsRecovery) {
      const sessions = new PlanSessions()
      const activePlans = new ActivePlans({ sessions })
      const server = new ApiServer({
        port: 0,
        startPlan: null,
        startMilestonePlan: start,
        sessions,
        activePlans,
        coordinatingSessions: coordinating,
        readEpicGroom: new AuthorisedGroom(),
        frontendRoot: join(root, 'frontend-not-built'),
      })
      servers.push(server)
      const port = await server.start()
      const obligation = {
        release: releasePendingWait,
        completed: initialSupervisorCompleted,
        registered: false,
        finalize: () => finalizeImplementation(obligation, () => spawnedDescriptors[1]),
      }
      pending.push(obligation)
      initialRegistrations.push(obligation)
      const response = await fetch(`http://127.0.0.1:${port}/start-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ milestone: Rehearsal.MILESTONE }),
      })
      expect(response.status).toBe(202)
      await BoundedDrain.wait(implementationAccepted.promise, 1_000)
      expect(await response.json()).toEqual({
        status: 'started',
        id: null,
        repo: Rehearsal.REPOSITORY,
        issue: { number: Rehearsal.ISSUE, url: `https://github.com/${Rehearsal.REPOSITORY}/issues/${Rehearsal.ISSUE}` },
        agent: Rehearsal.CONVERSATION,
        branch: `feat/${Rehearsal.ISSUE}`,
        worktree: boundaries.worktree,
        root: boundaries.checkoutRoot,
        baseline: { outcome: 'verde', command: 'npm test', summary: 'exit 0 · passed' },
      })
      expect(trace).toEqual(['claim', 'seed-slice', 'spawn-plan', 'publish', 'spawn-implementation'])
      expect(spawnedDescriptors).toHaveLength(2)
      const plannerDescriptor = JSON.parse(await readFile(spawnedDescriptors[0], 'utf8')) as Record<string, unknown>
      const plannerPromptPath = join(dirname(spawnedDescriptors[0]), CallDescriptor.PROMPT)
      expect(plannerDescriptor.argv).toEqual([
        '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,Skill,Agent',
        '--model', 'opus', '--plugin-dir', '/plugin', '--session-id', Rehearsal.CONVERSATION,
        CallDescriptor.opening(plannerPromptPath),
      ])
      expect(plannerCompletion.measurement).toEqual({
        cost: { kind: 'reported', totalUsd: 0.4208795, attribution: 'initial-invocation' },
        turns: 1,
        durationMs: 7071,
        unavailable: [],
      })
      expect(plannerCompletion.wallDurationMs).toBe(9_000)
      expect(boundaries.postedBody).toBe(
        `Plan ${Rehearsal.PLAN_HASH} — part 1/1\n`
        + `Source: ${Rehearsal.PLAN_PATH}\n\n${Rehearsal.PLAN}`
      )
      expect(await readFile(boundaries.attemptsPath, 'utf8')).toBe(boundaries.attemptBytes)
      expect(boundaries.publicationAttempts).toBe(1)
      const implementationDescriptor = JSON.parse(await readFile(spawnedDescriptors[1], 'utf8')) as Record<string, unknown>
      expect(implementationDescriptor.requestId).toBe(`implementation:${Rehearsal.PLAN_CALL}`)
      expect(implementationDescriptor.argv).toEqual([
        '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,Skill,Agent',
        '--model', 'opus', '--plugin-dir', '/plugin', '--resume', Rehearsal.CONVERSATION,
        CallDescriptor.opening(join(dirname(spawnedDescriptors[1]), CallDescriptor.PROMPT)),
      ])
      const restartedFiles = new HeadlessFiles({ root: stateRoot, fs, newId: () => 'read-only-temporary-record' })
      const restartedRecords = new DiskPlanRecords({
        files: restartedFiles,
        newId: () => { throw new Error('read-only restart must not allocate conversation identity') },
        now: () => { throw new Error('read-only restart must preserve recorded time') },
        exists: async (path) => fs.stat(path).then(() => true, () => false),
      })
      let restartSpawns = 0
      let restartIdentities = 0
      const readOnlyCalls = new ClaudeCalls({
        files: restartedFiles,
        binary: '/usr/local/bin/claude',
        worker: '/backend/headless-call-worker.ts',
        spawn: (() => { restartSpawns += 1; throw new Error('read-only restart must not spawn') }) as typeof import('node:child_process').spawn,
        env: {},
        newId: () => { restartIdentities += 1; throw new Error('read-only restart must not allocate identity') },
        now: () => { throw new Error('read-only restart must preserve recorded time') },
        budgetMs: 7_200_000,
        killGraceMs: 5_000,
        acceptanceMs: 10_000,
        pollMs: 250,
        sleep: async () => { throw new Error('read-only restart must not wait') },
      })
      const readOnlyPlanCalls = new ClaudePlanCalls({
        calls: readOnlyCalls,
        brief: new PlanAgentBrief({
          dispatchCheck: '/plugin/dispatch-check.mjs',
          conventions: '/plugin/conventions',
          ctStep: '/plugin/ct-step.mjs',
        }),
        pluginRoot: '/plugin',
        resumable: async () => { throw new Error('read-only restart must not inspect transcript') },
        records: restartedRecords,
        nowMs: () => Date.parse('2026-09-16T09:00:03.000Z'),
      })
      const restartedSessions = new PlanSessions()
      const restartedActivePlans = new ActivePlans({ sessions: restartedSessions })
      const projector = new RecordedPlanRecovery({
        records: restartedRecords,
        calls: readOnlyPlanCalls,
        ownership: readOnlyCalls,
        checkouts: new RememberingCheckouts(),
        activePlans: restartedActivePlans,
        reviews: new ReviewWatch({
          asked: async () => ({ changes: [] }), review: async () => {},
          sleep: () => new Promise<void>(() => {}), stderr: () => {},
          label: 'headless rehearsal read-only restart', log: new ReviewLog(),
        }),
      })
      expect(await projector.recover()).toBeNull()
      expect(restartedActivePlans.known()).toEqual([
        expect.objectContaining({
          phase: 'uncertain',
          diagnostic: expect.stringContaining('not owned by this API process'),
          plan: expect.objectContaining({ agent: Rehearsal.CONVERSATION }),
        }),
      ])
      expect(restartSpawns).toBe(0)
      expect(restartIdentities).toBe(0)
      expect(await readFile(boundaries.attemptsPath, 'utf8')).toBe(boundaries.attemptBytes)
      return
    }

    await fs.mkdir(dirname(boundaries.attemptsPath), { recursive: true })
    await fs.writeFile(boundaries.attemptsPath, boundaries.attemptBytes, 'utf8')
    const seededWatch = await records.prepare(new PlanBriefing({
      story: null,
      issue: new PlanIssue({
        number: Rehearsal.ISSUE,
        url: `https://github.com/${Rehearsal.REPOSITORY}/issues/${Rehearsal.ISSUE}`,
      }),
      repository: new RepositoryName(Rehearsal.REPOSITORY),
      located: new WorkspaceLocation({
        root: boundaries.checkoutRoot,
        path: boundaries.worktree,
        branch: `feat/${Rehearsal.ISSUE}`,
      }),
    }))
    const seededPlanner = new StartedPlanCall({
      conversation: Rehearsal.CONVERSATION,
      id: Rehearsal.PLAN_CALL,
    })
    const seededDirectory = files.callDirectory(seededPlanner)
    await fs.mkdir(seededDirectory, { recursive: true })
    await fs.writeFile(join(seededDirectory, CallDescriptor.FILE), new CallDescriptor({
      conversation: Rehearsal.CONVERSATION,
      purpose: 'plan',
      requestId: null,
      cwd: boundaries.worktree,
      binary: '/usr/local/bin/claude',
      argv: [
        '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,Skill,Agent',
        '--model', 'opus', '--plugin-dir', '/plugin', '--session-id', Rehearsal.CONVERSATION,
        CallDescriptor.opening(join(seededDirectory, CallDescriptor.PROMPT)),
      ],
      startedAt: '2026-09-16T09:00:01.000Z',
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
    }).text(), 'utf8')
    await fs.writeFile(join(seededDirectory, CallDescriptor.PROMPT), 'Independently seeded planner prompt.', 'utf8')
    await fs.writeFile(
      join(seededDirectory, CallDescriptor.COMPLETION), StoredCompletion.text(plannerCompletion), 'utf8',
    )
    expect(seededWatch.agent).toBe(Rehearsal.CONVERSATION)
    expect(plannerCompletion.measurement).toEqual({
      cost: { kind: 'reported', totalUsd: 0.4208795, attribution: 'initial-invocation' },
      turns: 1,
      durationMs: 7071,
      unavailable: [],
    })
    expect(plannerCompletion.wallDurationMs).toBe(9_000)
    await agents.recover({
      agent: Rehearsal.CONVERSATION,
      issue: Rehearsal.ISSUE,
      repository: new RepositoryName(Rehearsal.REPOSITORY),
    })
    await BoundedDrain.wait(diagnostic, 1_000)
    expect(trace).toEqual(['publication-refused'])
    expect(boundaries.publicationAttempts).toBe(1)
    expect(spawnedDescriptors).toHaveLength(0)

    const restartedFiles = new HeadlessFiles({ root: stateRoot, fs, newId: () => 'restarted-temporary-record' })
    const restartedRecords = new DiskPlanRecords({
      files: restartedFiles,
      newId: () => { throw new Error('recovery must preserve the original conversation') },
      now: () => { throw new Error('recovery must preserve the original dispatch time') },
      exists: async (path) => fs.stat(path).then(() => true, () => false),
    })
    const restartedSupervisorDiagnostics = [new Deferred(), new Deferred()]
    const restartedRegistrations: typeof pending = []
    const registeredSupervisors: typeof pending = []
    const rootPresenceAtSupervisorCompletion: boolean[] = []
    const restartedCalls = new ClaudeCalls({
      files: restartedFiles,
      binary: '/usr/local/bin/claude',
      worker: '/backend/headless-call-worker.ts',
      spawn: ((binary: string, argv: readonly string[]) => {
        const descriptorPath = argv[1]
        const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as Record<string, unknown>
        expect(binary).toBe(process.execPath)
        expect(descriptor.purpose).toBe('implementation')
        spawnedDescriptors.push(descriptorPath)
        trace.push('spawn-implementation')
        implementationAccepted.release()
        const worker = new AcceptedWorker()
        queueMicrotask(() => worker.emit('message', { kind: 'accepted' }))
        return worker
      }) as typeof import('node:child_process').spawn,
      env: {},
      newId: () => Rehearsal.IMPLEMENTATION_CALL,
      now: () => '2026-09-16T09:00:02.000Z',
      budgetMs: 7_200_000,
      killGraceMs: 5_000,
      acceptanceMs: 10_000,
      pollMs: 250,
      sleep: async () => releasePendingWait.promise,
    })
    const restartedPlanCalls = new ClaudePlanCalls({
      calls: restartedCalls,
      brief: new PlanAgentBrief({
        dispatchCheck: '/plugin/dispatch-check.mjs',
        conventions: '/plugin/conventions',
        ctStep: '/plugin/ct-step.mjs',
      }),
      pluginRoot: '/plugin',
      resumable: async () => true,
      records: restartedRecords,
      nowMs: () => Date.parse(Rehearsal.STARTED_AT),
    })
    const restartedPublication = new GhPlanPublication({
      gh,
      git: boundaries.git,
      progress: new PlanContractProgress({
        node: boundaries.node,
        git: boundaries.git,
        dispatchCheck: '/plugin/dispatch-check.mjs',
      }),
      files: restartedFiles,
      digest: (text) => createHash('sha256').update(text).digest('hex'),
    })
    const restartedAgents = new class extends HeadlessPlanAgents {
      override async recover(asked: {
        agent: string,
        issue: number,
        repository: RepositoryName,
      }): Promise<void> {
        await super.recover(asked)
        const obligation = restartedRegistrations.shift()
        if (obligation !== undefined) {
          obligation.registered = true
          registeredSupervisors.push(obligation)
        }
      }
    }({
      records: restartedRecords,
      calls: restartedPlanCalls,
      continuation: new ContinuePlan({ calls: restartedPlanCalls, publication: restartedPublication }),
      newId: () => { throw new Error('fix identity is not requested') },
      stderr: () => {
        rootPresenceAtSupervisorCompletion.push(existsSync(root))
        registeredSupervisors.shift()?.completed.release()
      },
    })
    const recoveredSessions = new PlanSessions()
    const recoveredPlans = new ActivePlans({ sessions: recoveredSessions })
    const reviews = new ReviewWatch({
      asked: async () => ({ changes: [] }),
      review: async () => {},
      sleep: () => new Promise<void>(() => {}),
      stderr: () => {},
      label: 'headless rehearsal recovery',
      log: new ReviewLog(),
    })
    const recovery = new RecordedPlanRecovery({
      records: restartedRecords,
      calls: restartedPlanCalls,
      ownership: restartedCalls,
      checkouts: new RememberingCheckouts(),
      activePlans: recoveredPlans,
      reviews,
    })
    const recoveredServer = new ApiServer({
      port: 0,
      recoverPlan: new RecoverPlan({ agents: restartedAgents }),
      recovery,
      frontendRoot: join(root, 'frontend-not-built'),
    })
    servers.push(recoveredServer)
    const recoveredPort = await recoveredServer.start()
    const firstObligation = {
      release: releasePendingWait,
      completed: restartedSupervisorDiagnostics[0],
      registered: false,
      finalize: () => finalizeImplementation(firstObligation, () => spawnedDescriptors[0]),
    }
    pending.push(firstObligation)
    restartedRegistrations.push(firstObligation)
    const recovered = await fetch(`http://127.0.0.1:${recoveredPort}/recover-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: Rehearsal.REPOSITORY,
        issue: Rehearsal.ISSUE,
        agent: Rehearsal.CONVERSATION,
      }),
    })
    if (!abortAfterAcceptance) {
      expect(recovered.status).toBe(202)
      expect(await recovered.json()).toEqual({ agent: Rehearsal.CONVERSATION })
    }
    if (failBeforeAcceptance) {
      await cleanup()
      expect(firstObligation.registered).toBe(true)
      expect(firstObligation.completed.released).toBe(true)
      expect(implementationAccepted.released).toBe(false)
      expect(boundaries.publicationAttempts).toBe(2)
      expect(trace).toEqual(['publication-refused', 'publication-refused'])
      expect(spawnedDescriptors).toHaveLength(0)
      expect(rootPresenceAtSupervisorCompletion).toEqual([true])
      await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
      return
    }
    await BoundedDrain.wait(implementationAccepted.promise, 1_000)
    expect(boundaries.publicationAttempts).toBe(2)
    expect(boundaries.postedBody).toBe(
      `Plan ${Rehearsal.PLAN_HASH} — part 1/1\n`
      + `Source: ${Rehearsal.PLAN_PATH}\n\n${Rehearsal.PLAN}`
    )
    expect(trace).toEqual([
      'publication-refused', 'publish', 'spawn-implementation',
    ])
    expect(spawnedDescriptors).toHaveLength(1)
    const implementationDescriptor = JSON.parse(await readFile(spawnedDescriptors[0], 'utf8')) as Record<string, unknown>
    expect(implementationDescriptor.requestId).toBe(`implementation:${Rehearsal.PLAN_CALL}`)
    expect(implementationDescriptor.argv).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,Skill,Agent',
      '--model', 'opus', '--plugin-dir', '/plugin', '--resume', Rehearsal.CONVERSATION,
      CallDescriptor.opening(join(dirname(spawnedDescriptors[0]), CallDescriptor.PROMPT)),
    ])
    expect(boundaries.publicationAttempts).toBe(2)
    expect(spawnedDescriptors).toHaveLength(1)
    expect(await readFile(boundaries.attemptsPath, 'utf8')).toBe(boundaries.attemptBytes)

    const secondObligation = {
      release: releasePendingWait,
      completed: restartedSupervisorDiagnostics[1],
      registered: false,
      finalize: () => finalizeImplementation(secondObligation, () => spawnedDescriptors[0]),
    }
    pending.push(secondObligation)
    restartedRegistrations.push(secondObligation)
    const repeated = await BoundedDrain.value(fetch(`http://127.0.0.1:${recoveredPort}/recover-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: Rehearsal.REPOSITORY,
        issue: Rehearsal.ISSUE,
        agent: Rehearsal.CONVERSATION,
      }),
    }), 1_000)
    if (!abortAfterAcceptance) {
      expect(repeated.status).toBe(202)
      expect(await repeated.json()).toEqual({ agent: Rehearsal.CONVERSATION })
    }
    expect(boundaries.publicationAttempts).toBe(2)
    expect(spawnedDescriptors).toHaveLength(1)

    if (abortAfterAcceptance) {
      const sentinel = new Error('response assertion aborted after both supervisors registered')
      let aborted: unknown
      try {
        expect(recovered.status).toBe(202)
        expect(await recovered.json()).toEqual({ agent: Rehearsal.CONVERSATION })
        expect(repeated.status).toBe(202)
        expect(await repeated.json()).toEqual({ agent: Rehearsal.CONVERSATION })
        throw sentinel
      } catch (cause) {
        aborted = cause
      } finally {
        await cleanup()
      }
      expect(aborted).toBe(sentinel)
      expect(firstObligation.registered).toBe(true)
      expect(secondObligation.registered).toBe(true)
      expect(firstObligation.completed.released).toBe(true)
      expect(secondObligation.completed.released).toBe(true)
      expect(rootPresenceAtSupervisorCompletion).toEqual([true, true])
      await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
      return
    }

    writeFileSync(join(dirname(spawnedDescriptors[0]), CallDescriptor.COMPLETION), Rehearsal.deferredCompletion())
    releasePendingWait.release()
    const completedImplementation = await BoundedDrain.value(restartedCalls.wait(new StartedPlanCall({
      conversation: Rehearsal.CONVERSATION,
      id: Rehearsal.IMPLEMENTATION_CALL,
    })), 1_000)
    expect(completedImplementation).toMatchObject({
      succeeded: false,
      execution: { kind: 'unavailable', diagnostic: 'scripted rehearsal closed after accepted continuation' },
    })
    await Promise.all(restartedSupervisorDiagnostics.map((barrier) => BoundedDrain.wait(barrier.promise, 1_000)))

    expect(boundaries.calls.filter((call) => call.tool === 'node' && !call.argv.includes('--check-plan'))).toEqual([])

    await expect(boundaries.node([
      '/plugin/dispatch-check.mjs', '332', '--repo', Rehearsal.REPOSITORY, '--check-plan',
    ], { cwd: boundaries.worktree })).rejects.toThrow('unlisted node command')
    await expect(boundaries.node([
      '/plugin/dispatch-check.mjs', String(Rehearsal.ISSUE), '--repo', Rehearsal.REPOSITORY, '--check-plan',
    ], { cwd: boundaries.checkoutRoot })).rejects.toThrow('unlisted node command')
    await expect(boundaries.git([
      '-C', boundaries.worktree, 'show', `HEAD:docs/superpowers/plans/wrong.md`,
    ])).rejects.toThrow('unlisted git command')
    await expect(boundaries.gh([
      'issue', 'comment', '332', '--repo', Rehearsal.REPOSITORY,
      '--body-file', boundaries.publicationBodyPath,
    ])).rejects.toThrow('unlisted gh command')

    } finally {
      await cleanup()
    }
  })
})
