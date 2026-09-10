import { vi } from 'vitest'
import { ApiServer } from '../../src/infrastructure/api-server.js'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.js'
import { PlanSessions } from '../../src/infrastructure/plan-events-route.js'
import { StartPlan } from '../../src/application/actions/start-plan.ts'
import { ImplementPlan } from '../../src/application/actions/implement-plan.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { UserStories } from '../../src/domain/ports/user-stories.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import { GoRegistry } from '../../src/domain/ports/go-registry.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { SownWorkspace } from '../../src/domain/value-objects/sown-workspace.ts'
import { UserStory } from '../../src/domain/value-objects/user-story.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import { BaselineResult } from '../../../plugin/scripts/baseline.js'
import { WorktreePlans } from '../../src/infrastructure/worktree-plans.js'
import { WorkspaceSurvey } from '../../src/domain/value-objects/workspace-survey.ts'
import { PreparedWorkspace } from '../../src/domain/value-objects/prepared-workspace.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ActivePlanRecovery } from '../../src/infrastructure/active-plan-recovery.js'
import { PlansInFlight } from '../../src/domain/value-objects/plans-in-flight.ts'
import { ImplementationState } from '../../src/domain/value-objects/implementation-state.ts'
import { ReviewWatch } from '../../src/infrastructure/review-watch.js'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.ts'

export class Deferred<T> {
  readonly promise: Promise<T>
  resolve!: (value: T) => void
  reject!: (reason: Error) => void

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

export class PlanWatchMother {
  static of(repo = 'owner/alpha', issue = 7, agent = `workspace:${issue}`): PlanWatch {
    return new PlanWatch({
      repository: new RepositoryName(repo),
      issue: new PlanIssue({ number: issue, url: `https://github.com/${repo}/issues/${issue}` }),
      located: new WorkspaceLocation({ root: `/${repo}`, path: `/${repo}/.worktrees/${issue}`, branch: `feat/${issue}` }),
      story: new UserStoryKey(`ABC-${issue}`),
      agent,
    })
  }
}

export class WorktreeDiscovery {
  readonly watches = [PlanWatchMother.of(), PlanWatchMother.of('owner/beta', 7, 'workspace:8')]
  roots: CheckoutRoot[] | null = this.watches.map((watch) => new CheckoutRoot(watch.located.root))
  entries = this.watches.map((watch) => ({
    ref: watch.agent, title: 'ct-plan-fixture', cwd: watch.located.path, cwdKnown: true,
  }))
  readonly story = vi.fn(async () => new UserStoryKey('ABC-7'))
  readonly stderr = vi.fn()
  readonly survey = vi.fn(async (root: CheckoutRoot) => {
    const watches = this.watches.filter((watch) => watch.located.root === root.text)
    return new WorkspaceSurvey({
      repository: watches[0]!.repository,
      prepared: watches.map((watch) => new PreparedWorkspace({ issueNumber: watch.issue.number, located: watch.located })),
    })
  })
  readonly plans = new WorktreePlans({
    checkouts: { known: () => this.roots },
    survey: this.survey,
    sessions: () => ({ wasAnswered: true, entries: this.entries }),
    story: this.story,
    realpathOf: (path: string) => path,
    stderr: this.stderr,
  })
}

export class RecoveryFixture {
  time = 0
  watches = [PlanWatchMother.of()]
  readonly implementing = new Set<string>()
  readonly authorized = new Set<string>()
  readonly sessions: PlanSessions
  readonly activePlans: ActivePlans
  readonly reviews: Pick<ParallelWorkflows['reviews'], 'startRecovered' | 'stop'>
  readonly pullRequestReviews: Pick<ParallelWorkflows['pullRequestReviews'], 'startRecovered' | 'stop'>
  readonly plans = { inFlight: vi.fn(async (_known: PlanWatch[] = []) => PlansInFlight.listed(this.watches)) }
  readonly implementationProgress = { of: vi.fn(async () => ImplementationState.starting()) }
  readonly recovery: ActivePlanRecovery

  constructor(app?: ParallelWorkflows) {
    this.sessions = app?.sessions ?? new PlanSessions()
    this.activePlans = app?.activePlans ?? new ActivePlans({ sessions: this.sessions })
    this.reviews = app?.reviews ?? { startRecovered: vi.fn(), stop: vi.fn() }
    this.pullRequestReviews = app?.pullRequestReviews ?? { startRecovered: vi.fn(), stop: vi.fn() }
    this.recovery = new ActivePlanRecovery({
      plans: this.plans, sessions: this.sessions, activePlans: this.activePlans,
      checkouts: { remember: vi.fn() },
      implementationStarts: { matches: (watch: PlanWatch) => this.implementing.has(watch.agent) },
      goRegistry: { matches: (watch: PlanWatch) => this.authorized.has(watch.agent) },
      implementationProgress: this.implementationProgress,
      reviews: this.reviews, pullRequestReviews: this.pullRequestReviews,
      now: () => this.time, freshnessMs: 15_000,
    })
  }

  async refresh(): Promise<string | null> {
    this.time += 15_000
    return this.recovery.recover()
  }
}

export class ReviewWatchFixture {
  static readonly CHANGE = new ChangeAsked({ id: 'comment-1', text: 'Cover the empty request' })
  readonly ticks: Deferred<void>[] = []
  readonly running: Promise<void>[] = []
  readonly subjects: PlanWatch[] = []
  readonly asked = vi.fn(async (_watch: PlanWatch) => ({ changes: [ReviewWatchFixture.CHANGE] }))
  readonly review = vi.fn(async (_params: { agent: string, issue: number, repository: RepositoryName, changes: string }) => {})
  readonly watch = new ReviewWatch({
    asked: this.asked, review: this.review,
    sleep: () => {
      const tick = new Deferred<void>()
      this.ticks.push(tick)
      return tick.promise
    },
    stderr: vi.fn(), label: 'review fixture',
  })

  start(subject: PlanWatch, recovered = false): void {
    this.subjects.push(subject)
    this.running.push(recovered ? this.watch.startRecovered(subject) : this.watch.start(subject))
  }

  static async settle(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  async tick(index: number): Promise<void> {
    this.ticks[index]!.resolve()
    await ReviewWatchFixture.settle()
  }

  async stop(): Promise<void> {
    for (const subject of this.subjects) this.watch.stop({ issue: subject.issue.number, repository: subject.repository })
    for (const tick of this.ticks) tick.resolve()
    await Promise.all(this.running)
  }
}

class Stories extends UserStories {
  override async detail(key: Parameters<UserStories['detail']>[0]): Promise<UserStory> {
    return new UserStory({ key, summary: 'Independent work', description: 'Implement a feature' })
  }
}

class Issues extends PlanIssues {
  readonly numbers = new Map<string, number>()
  override claim = vi.fn<PlanIssues['claim']>(async () => {})
  override answerGo = vi.fn<PlanIssues['answerGo']>(async () => {})

  override async open({ repository }: Parameters<PlanIssues['open']>[0]): Promise<PlanIssue> {
    const number = this.numbers.get(repository.text) ?? 7
    this.numbers.set(repository.text, number + 1)
    return new PlanIssue({ number, url: `https://github.com/${repository.text}/issues/${number}` })
  }
}

class Workspaces extends Workspace {
  override async confirm({ root }: Parameters<Workspace['confirm']>[0]) {
    return root
  }

  override async prepare({ root, issue }: Parameters<Workspace['prepare']>[0]): Promise<SownWorkspace> {
    return new SownWorkspace({
      located: new WorkspaceLocation({ root: root.text, path: `${root.text}/.worktrees/${issue.number}`, branch: `feat/${issue.number}` }),
      baseline: new BaselineResult({ outcome: 'verde', command: 'npm test', summary: '42 passed' }),
    })
  }
}

class Agents extends PlanAgents {
  next = 20
  override resume = vi.fn<PlanAgents['resume']>(async () => {})

  override async launch(): Promise<string> {
    return `workspace:${this.next++}`
  }
}

class Checkouts extends CheckoutRegistry {
  override remember = vi.fn<CheckoutRegistry['remember']>()
}

class Authorizations extends GoRegistry {
  override async mint(): Promise<string> {
    return 'test-authorization'
  }
}

export class ParallelWorkflows {
  readonly agents = new Agents()
  readonly issues = new Issues()
  readonly sessions = new PlanSessions()
  readonly activePlans = new ActivePlans({ sessions: this.sessions })
  readonly reviews = { start: vi.fn(), stop: vi.fn(), startRecovered: vi.fn() }
  readonly pullRequestReviews = { start: vi.fn(), stop: vi.fn(), startRecovered: vi.fn() }
  readonly implementationStarts = { remember: vi.fn(async () => {}) }
  readonly server = new ApiServer({
    port: 0,
    startPlan: new StartPlan({
      userStories: new Stories(), planIssues: this.issues, workspace: new Workspaces(),
      planAgents: this.agents, checkouts: new Checkouts(),
    }),
    implementPlan: new ImplementPlan({ goRegistry: new Authorizations(), planIssues: this.issues, planAgents: this.agents }),
    askPlanChanges: null, implementProgress: null, planEvents: null, externalTools: null,
    reviews: this.reviews, pullRequestReviews: this.pullRequestReviews,
    sessions: this.sessions, activePlans: this.activePlans,
    implementationStarts: this.implementationStarts,
    stderr: vi.fn(), frontendRoot: '/ct-fixture-without-frontend',
  })
  port = 0

  async listen(): Promise<void> {
    this.port = await this.server.start()
  }

  async post(path: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`http://127.0.0.1:${this.port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }

  async start(repo: string, id = 'ABC-7'): Promise<Response> {
    return this.post('/start-plan', { id, repo, path: `/${repo}` })
  }

  async listed(): Promise<Response> {
    return fetch(`http://127.0.0.1:${this.port}/active-plans`)
  }

  async stop(): Promise<void> {
    await this.server.stop()
  }
}
