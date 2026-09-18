import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import {
  SliceNotStarted, StartMilestonePlan, StartMilestonePlanParams, StartMilestonePlanResult,
} from '../../src/application/actions/start-milestone-plan.ts'
import { PlanStarted, StartPlan, StartPlanResult } from '../../src/application/actions/start-plan.ts'
import type { StartPlanParams } from '../../src/application/actions/start-plan.ts'
import { ReadEpicGroom, ReadEpicGroomParams, EpicGroomRead, EpicGroomState } from '../../src/application/queries/read-epic-groom.ts'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.ts'
import { CoordinatingSessions, CoordinatingSessionState, HeldCoordinatingSession } from '../../src/infrastructure/coordinating-sessions.ts'
import { PlanSessions } from '../../src/infrastructure/plan-events-route.ts'
import { WorkInFlight } from '../../src/infrastructure/work-in-flight.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { DispatchCandidates } from '../../src/domain/ports/dispatch-candidates.ts'
import { DispatchClaims } from '../../src/domain/ports/dispatch-claims.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { EpicGroom } from '../../src/domain/ports/epic-groom.ts'
import { EpicIssues } from '../../src/domain/ports/epic-issues.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { PublishedSpecs } from '../../src/domain/ports/published-specs.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import { UserStories } from '../../src/domain/ports/user-stories.ts'
import { PlanFingerprint } from '../../src/domain/policies/plan-fingerprint.ts'
import { SpecRevision } from '../../src/domain/policies/spec-revision.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { BaselineResult } from '../../../plugin/scripts/baseline.js'
import { PlanAgentNeverLaunched, WorkspaceNotPrepared } from '../../src/domain/exceptions.ts'
import type { PlanFailure } from '../../src/domain/exceptions.ts'
import { PlanNonLaunch } from '../../src/domain/value-objects/plan-non-launch.ts'

class StartMilestonePlanDouble extends StartMilestonePlan {
  readonly asked: StartMilestonePlanParams[]
  readonly answer: (params: StartMilestonePlanParams) => Promise<StartMilestonePlanResult>

  constructor(
    answer: (params: StartMilestonePlanParams) => Promise<StartMilestonePlanResult> =
      async () => Mother.dispatching(Mother.started()),
  ) {
    super({
      candidates: new DispatchCandidates(),
      claims: new DispatchClaims(),
      workspace: new Workspace(),
      agents: new PlanAgents(),
      records: new PlanRecords(),
      checkouts: new CheckoutRegistry(),
    })
    this.asked = []
    this.answer = answer
  }

  async execute(params: StartMilestonePlanParams): Promise<StartMilestonePlanResult> {
    this.asked.push(params)
    return await this.answer(params)
  }
}

class ReadEpicGroomDouble extends ReadEpicGroom {
  readonly asked: ReadEpicGroomParams[]
  readonly answer: EpicGroomRead

  constructor(answer: EpicGroomRead = Mother.groomed(EpicGroomState.AUTHORISED)) {
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
    this.asked = []
    this.answer = answer
  }

  async execute(params: ReadEpicGroomParams): Promise<EpicGroomRead> {
    this.asked.push(params)
    return this.answer
  }
}

class StartPlanDouble extends StartPlan {
  readonly asked: StartPlanParams[]
  readonly answer: () => Promise<StartPlanResult>

  constructor(answer: () => Promise<StartPlanResult>) {
    super({
      userStories: new UserStories(),
      planIssues: new PlanIssues(),
      workspace: new Workspace(),
      planAgents: new PlanAgents(),
      checkouts: new CheckoutRegistry(),
      records: new PlanRecords(),
      claims: new DispatchClaims(),
    })
    this.asked = []
    this.answer = answer
  }

  async execute(params: StartPlanParams): Promise<StartPlanResult> {
    this.asked.push(params)
    return await this.answer()
  }
}

class ControlledStart {
  readonly action: StartPlanDouble
  readonly started: Promise<void>
  readonly finish: () => void

  constructor() {
    let announce: () => void = (): void => {}
    this.started = new Promise<void>((resolve) => { announce = resolve })
    let finish: () => void = (): void => {}
    const held = new Promise<void>((resolve) => { finish = resolve })
    this.finish = finish
    this.action = new StartPlanDouble(async () => {
      announce()
      await held
      return new StartPlanResult({ started: [Mother.started()], failed: [] })
    })
    Object.freeze(this)
  }
}

class LiveSessionsDouble extends LiveSessions {
  find(id: string): LiveSession | null {
    return id === Mother.SESSION.id ? Mother.SESSION : null
  }

  watch(): LiveSessionStream {
    return { printed: '', stop: (): void => {} }
  }
}

class Mother {
  static readonly MILESTONE = 'Checkout delivery'
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly ROOT = new CheckoutRoot('/repo/checkout')
  static readonly ISSUE = new PlanIssue({ number: 12, url: 'https://github.com/owner/name/issues/12' })
  static readonly LOCATION = new WorkspaceLocation({
    root: Mother.ROOT.text,
    path: '/repo/checkout/.worktrees/12',
    branch: 'feat/12',
  })
  static readonly AGENT = '11111111-1111-4111-8111-111111111111'
  static readonly AGENT_PREFIX = 'agent-'
  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'coordinator' })
  static readonly BASELINE = new BaselineResult({ outcome: 'verde', command: 'npm test', summary: '42 passed' })
  static readonly LOOSE_ANSWER =
    '{"status":"started","id":null,"repo":"owner/name",' +
    '"issue":{"number":12,"url":"https://github.com/owner/name/issues/12"},' +
    '"agent":"11111111-1111-4111-8111-111111111111","branch":"feat/12",' +
    '"worktree":"/repo/checkout/.worktrees/12","root":"/repo/checkout",' +
    '"baseline":{"outcome":"verde","command":"npm test","summary":"42 passed"}}'

  static plan(issue: number): Record<string, unknown> {
    return {
      id: null,
      repo: Mother.REPOSITORY.text,
      issue: { number: issue, url: `https://github.com/owner/name/issues/${issue}` },
      agent: Mother.agentOf(issue),
      branch: `feat/${issue}`,
      worktree: `${Mother.ROOT.text}/.worktrees/${issue}`,
      root: Mother.ROOT.text,
      baseline: { outcome: 'verde', command: 'npm test', summary: '42 passed' },
    }
  }

  static agentOf(issue: number): string {
    return issue === 12 ? Mother.AGENT : `${Mother.AGENT_PREFIX}${issue}`
  }

  static started(issue = 12): PlanStarted {
    return new PlanStarted({
      agent: Mother.agentOf(issue),
      baseline: Mother.BASELINE,
      watch: new PlanWatch({
        story: null,
        issue: Mother.issue(issue),
        located: Mother.location(issue),
        repository: Mother.REPOSITORY,
        agent: Mother.agentOf(issue),
      }),
    })
  }

  static issue(number: number): PlanIssue {
    return number === 12
      ? Mother.ISSUE
      : new PlanIssue({ number, url: `https://github.com/owner/name/issues/${number}` })
  }

  static location(issue: number): WorkspaceLocation {
    return issue === 12 ? Mother.LOCATION : new WorkspaceLocation({
      root: Mother.ROOT.text,
      path: `${Mother.ROOT.text}/.worktrees/${issue}`,
      branch: `feat/${issue}`,
    })
  }

  static dispatching(...started: PlanStarted[]): StartMilestonePlanResult {
    return new StartMilestonePlanResult({ started, failed: [] })
  }

  static notStarted(issue: number, cause: PlanFailure): SliceNotStarted {
    return new SliceNotStarted({ issue: Mother.issue(issue), repository: Mother.REPOSITORY, cause })
  }

  static coordinating(): CoordinatingSessions {
    const sessions = new CoordinatingSessions({ liveSessions: new LiveSessionsDouble(), stderr: (): void => {} })
    sessions.remember(new HeldCoordinatingSession({
      target: '6d13bc52-740f-49f8-b128-15e597674f3a',
      state: CoordinatingSessionState.LIVE,
      conversation: new CoordinatingConversation({
        id: new ConversationId('22222222-2222-4222-8222-222222222222'),
        repository: Mother.REPOSITORY,
        root: Mother.ROOT,
      }),
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    }))
    return sessions
  }

  static none(): CoordinatingSessions {
    return new CoordinatingSessions({ liveSessions: new LiveSessionsDouble(), stderr: (): void => {} })
  }

  static closed(): CoordinatingSessions {
    const sessions = Mother.coordinating()
    const identity = {
      conversation: '22222222-2222-4222-8222-222222222222',
      target: '6d13bc52-740f-49f8-b128-15e597674f3a',
    }
    sessions.beginClose(identity)
    sessions.finishClose(identity)

    return sessions
  }

  static groomed(state: typeof EpicGroomState.GROOMED | typeof EpicGroomState.AUTHORISED): EpicGroomRead {
    return new EpicGroomRead({
      state,
      spec: null,
      milestone: Mother.MILESTONE,
      plan: null,
      planFingerprint: null,
      issues: [],
    })
  }

  static context(state: typeof EpicGroomState.AWAITING_PUBLICATION, milestone: string | null): EpicGroomRead {
    return new EpicGroomRead({
      state,
      spec: null,
      milestone,
      plan: null,
      planFingerprint: null,
      issues: [],
    })
  }
}

type RunningApiOptions = Readonly<{
  startMilestonePlan: StartMilestonePlan,
  readEpicGroom: ReadEpicGroom,
  coordinatingSessions?: CoordinatingSessions,
  startPlan?: StartPlan | null,
  startsInFlight?: WorkInFlight,
  registry?: PlanRegistryFixture,
}>

class PlanRegistryFixture {
  readonly sessions: PlanSessions
  readonly activePlans: ActivePlans

  constructor() {
    this.sessions = new PlanSessions()
    this.activePlans = new ActivePlans({ sessions: this.sessions })
    Object.freeze(this)
  }
}

class RunningApi {
  static readonly #servers: ApiServer[] = []

  static async listening(options: RunningApiOptions): Promise<number> {
    const registry = options.registry ?? new PlanRegistryFixture()
    const server = new ApiServer({
      port: 0,
      startPlan: options.startPlan ?? null,
      startMilestonePlan: options.startMilestonePlan,
      startsInFlight: options.startsInFlight ?? new WorkInFlight(),
      sessions: registry.sessions,
      activePlans: registry.activePlans,
      coordinatingSessions: options.coordinatingSessions ?? Mother.coordinating(),
      readEpicGroom: options.readEpicGroom,
      frontendRoot: join(tmpdir(), 'ct-frontend-never-built'),
    })
    RunningApi.#servers.push(server)
    return await server.start()
  }

  static post(port: number, body: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  }

  static async stopAll(): Promise<void> {
    const servers = RunningApi.#servers.splice(0)
    await Promise.all(servers.map((server) => server.stop()))
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('StartPlanRoute milestone entrance', () => {
  it('a milestone command dispatches in the held checkout and its 202 carries every started plan', async () => {
    const registry = new PlanRegistryFixture()
    const start = new StartMilestonePlanDouble(
      async () => Mother.dispatching(Mother.started(12), Mother.started(13), Mother.started(14))
    )
    const groom = new ReadEpicGroomDouble()
    const port = await RunningApi.listening({ startMilestonePlan: start, readEpicGroom: groom, registry })

    const response = await RunningApi.post(port, `{"milestone":"${Mother.MILESTONE}"}`)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      status: 'started',
      started: [Mother.plan(12), Mother.plan(13), Mother.plan(14)],
      failed: [],
    })
    expect(registry.sessions.known().map((watch) => watch.issue.number)).toEqual([12, 13, 14])
    expect(start.asked).toHaveLength(1)
    expect(start.asked[0].milestone).toBe(Mother.MILESTONE)
    expect(start.asked[0].repository).toBe(Mother.REPOSITORY)
    expect(start.asked[0].root).toBe(Mother.ROOT)
    expect(groom.asked[0].repository).toBe(Mother.REPOSITORY)
    expect(groom.asked[0].root).toBe(Mother.ROOT)
  })

  it('a milestone 202 names the slice that could not start beside the ones that did', async () => {
    const registry = new PlanRegistryFixture()
    const start = new StartMilestonePlanDouble(async () => new StartMilestonePlanResult({
      started: [Mother.started(12), Mother.started(14)],
      failed: [Mother.notStarted(13, new WorkspaceNotPrepared('the worktree could not be cut'))],
    }))
    const port = await RunningApi.listening({
      startMilestonePlan: start, readEpicGroom: new ReadEpicGroomDouble(), registry,
    })

    const response = await RunningApi.post(port, `{"milestone":"${Mother.MILESTONE}"}`)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      status: 'started',
      started: [Mother.plan(12), Mother.plan(14)],
      failed: [{
        issue: { number: 13, url: 'https://github.com/owner/name/issues/13' },
        repo: 'owner/name',
        code: 'workspace-not-prepared',
        detail: 'the worktree could not be cut',
      }],
    })
    expect(registry.sessions.known().map((watch) => watch.issue.number)).toEqual([12, 14])
  })

  it('a loose issue answers exactly the shape it always answered', async () => {
    const port = await RunningApi.listening({
      startMilestonePlan: new StartMilestonePlanDouble(),
      readEpicGroom: new ReadEpicGroomDouble(),
      startPlan: new StartPlanDouble(async () => new StartPlanResult({ started: [Mother.started()], failed: [] })),
    })

    const response = await RunningApi.post(
      port,
      `{"user_comment":"plan this","repo":"${Mother.REPOSITORY.text}","path":"${Mother.ROOT.text}"}`,
    )

    expect(response.status).toBe(202)
    expect(await response.text()).toBe(Mother.LOOSE_ANSWER)
  })

  it('milestone start exposes definite non-launch', async () => {
    const proof = new PlanNonLaunch({
      conversation: Mother.AGENT,
      callId: null,
      source: 'before-worker',
      diagnostic: 'headless worker spawn was refused',
      observedAt: '2026-09-16T10:00:00.000Z',
    })
    const thrown = new StartMilestonePlanDouble(async () => {
      throw new PlanAgentNeverLaunched(proof)
    })
    const collected = new StartMilestonePlanDouble(async () => new StartMilestonePlanResult({
      started: [],
      failed: [Mother.notStarted(12, new PlanAgentNeverLaunched(proof))],
    }))
    const thrownPort = await RunningApi.listening({
      startMilestonePlan: thrown, readEpicGroom: new ReadEpicGroomDouble(),
    })
    const collectedPort = await RunningApi.listening({
      startMilestonePlan: collected, readEpicGroom: new ReadEpicGroomDouble(),
    })

    const responses = await Promise.all(
      [thrownPort, collectedPort].map((port) => RunningApi.post(port, `{"milestone":"${Mother.MILESTONE}"}`))
    )

    expect(responses.map((response) => response.status)).toEqual([400, 400])
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual(Array(2).fill({
      code: 'plan-agent-never-launched',
      detail: 'headless worker spawn was refused',
    }))
  })

  it('mixed malformed and unknown milestone fields reach no action', async () => {
    const start = new StartMilestonePlanDouble()
    const groom = new ReadEpicGroomDouble()
    const port = await RunningApi.listening({ startMilestonePlan: start, readEpicGroom: groom })
    const bodies = [
      '{"milestone":"Checkout delivery","repo":"owner/name"}',
      '{"milestone":" Checkout delivery"}',
      '{"milestone":""}',
      '{"milestone":12}',
      '{"milestone":"Checkout delivery","unknown":true}',
      '{"milestone":"Checkout delivery","repo_list":[]}',
    ]

    const responses = await Promise.all(bodies.map((body) => RunningApi.post(port, body)))

    expect(responses.map((response) => response.status)).toEqual(Array(bodies.length).fill(400))
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual(
      bodies.map((body) => ({
        code: 'start-milestone-malformed',
        detail: `milestone command must be exactly {"milestone":"name"}, got ${body}`,
      }))
    )
    expect(start.asked).toEqual([])
    expect(groom.asked).toEqual([])
  })

  it('missing mismatched and unpublished context cannot dispatch', async () => {
    const missingStart = new StartMilestonePlanDouble()
    const mismatchedStart = new StartMilestonePlanDouble()
    const unpublishedStart = new StartMilestonePlanDouble()
    const missingPort = await RunningApi.listening({
      startMilestonePlan: missingStart,
      readEpicGroom: new ReadEpicGroomDouble(),
      coordinatingSessions: Mother.none(),
    })
    const mismatchedPort = await RunningApi.listening({
      startMilestonePlan: mismatchedStart,
      readEpicGroom: new ReadEpicGroomDouble(new EpicGroomRead({
        state: EpicGroomState.AUTHORISED,
        spec: null,
        milestone: 'Another milestone',
        plan: null,
        planFingerprint: null,
        issues: [],
      })),
    })
    const unpublishedPort = await RunningApi.listening({
      startMilestonePlan: unpublishedStart,
      readEpicGroom: new ReadEpicGroomDouble(Mother.context(EpicGroomState.AWAITING_PUBLICATION, null)),
    })

    const responses = await Promise.all(
      [missingPort, mismatchedPort, unpublishedPort]
        .map((port) => RunningApi.post(port, `{"milestone":"${Mother.MILESTONE}"}`))
    )

    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      { code: 'start-milestone-no-session', detail: 'no coordinating session is held' },
      {
        code: 'start-milestone-mismatch',
        detail: 'held checkout is for milestone "Another milestone", not "Checkout delivery"',
      },
      {
        code: 'start-milestone-not-dispatchable',
        detail: 'milestone "Checkout delivery" is awaiting-publication',
      },
    ])
    expect([...missingStart.asked, ...mismatchedStart.asked, ...unpublishedStart.asked]).toEqual([])
  })

  it('groomed and authorised context without a milestone cannot dispatch', async () => {
    const groomedStart = new StartMilestonePlanDouble()
    const authorisedStart = new StartMilestonePlanDouble()
    const groomedPort = await RunningApi.listening({
      startMilestonePlan: groomedStart,
      readEpicGroom: new ReadEpicGroomDouble(new EpicGroomRead({
        state: EpicGroomState.GROOMED,
        spec: null,
        milestone: null,
        plan: null,
        planFingerprint: null,
        issues: [],
      })),
    })
    const authorisedPort = await RunningApi.listening({
      startMilestonePlan: authorisedStart,
      readEpicGroom: new ReadEpicGroomDouble(new EpicGroomRead({
        state: EpicGroomState.AUTHORISED,
        spec: null,
        milestone: null,
        plan: null,
        planFingerprint: null,
        issues: [],
      })),
    })

    const responses = await Promise.all(
      [groomedPort, authorisedPort]
        .map((port) => RunningApi.post(port, `{"milestone":"${Mother.MILESTONE}"}`))
    )

    expect(await Promise.all(responses.map((response) => response.json()))).toEqual(Array(2).fill({
      code: 'start-milestone-mismatch',
      detail: 'held checkout is for milestone null, not "Checkout delivery"',
    }))
    expect([...groomedStart.asked, ...authorisedStart.asked]).toEqual([])
  })

  it('a coordinator can start ready work without a browser gate key', async () => {
    const registry = new PlanRegistryFixture()
    const start = new StartMilestonePlanDouble(async () => {
      const started = Mother.started()
      registry.activePlans.rememberImplementing(started.watch)
      return Mother.dispatching(started)
    })
    const port = await RunningApi.listening({
      startMilestonePlan: start,
      readEpicGroom: new ReadEpicGroomDouble(Mother.groomed(EpicGroomState.GROOMED)),
      registry,
    })

    const response = await RunningApi.post(port, `{"milestone":"${Mother.MILESTONE}"}`)

    expect(response.status).toBe(202)
    expect(start.asked).toHaveLength(1)
    expect(registry.sessions.known()).toEqual([])
    expect(registry.activePlans.find({ issue: Mother.ISSUE.number, repository: Mother.REPOSITORY })?.phase)
      .toBe('implementing')
  })

  it('concurrent starts in one repository reach only one action', async () => {
    const controlled = new ControlledStart()
    const milestone = new StartMilestonePlanDouble()
    const port = await RunningApi.listening({
      startPlan: controlled.action,
      startMilestonePlan: milestone,
      readEpicGroom: new ReadEpicGroomDouble(),
    })

    const loose = RunningApi.post(
      port,
      '{"id":"ABC-123","repo":"owner/name","path":"/repo/checkout"}',
    )
    await controlled.started
    const collision = await RunningApi.post(port, `{"milestone":"${Mother.MILESTONE}"}`)

    expect(collision.status).toBe(400)
    expect(await collision.json()).toEqual({
      code: 'start-plan-in-progress',
      detail: 'a plan start in owner/name is already in progress',
    })
    expect(controlled.action.asked).toHaveLength(1)
    expect(milestone.asked).toEqual([])

    controlled.finish()
    expect((await loose).status).toBe(202)
  })
})

describe('StartPlanRoute and the closed coordinating checkout', () => {
  const loosePlan = (path: string): string =>
    JSON.stringify({ user_comment: 'plan this', repo: Mother.REPOSITORY.text, path })

  it('forgets the closed coordinating checkout when the plan starts in another one', async () => {
    const coordinatingSessions = Mother.closed()
    const port = await RunningApi.listening({
      startMilestonePlan: new StartMilestonePlanDouble(),
      readEpicGroom: new ReadEpicGroomDouble(),
      coordinatingSessions,
      startPlan: new StartPlanDouble(async () => new StartPlanResult({ started: [Mother.started()], failed: [] })),
    })

    const response = await RunningApi.post(port, loosePlan('/another/checkout'))

    expect(response.status).toBe(202)
    expect(coordinatingSessions.gateCheckout()).toBe(null)
  })

  it('keeps the closed coordinating checkout when the plan starts in the same one', async () => {
    const coordinatingSessions = Mother.closed()
    const port = await RunningApi.listening({
      startMilestonePlan: new StartMilestonePlanDouble(),
      readEpicGroom: new ReadEpicGroomDouble(),
      coordinatingSessions,
      startPlan: new StartPlanDouble(async () => new StartPlanResult({ started: [Mother.started()], failed: [] })),
    })

    const response = await RunningApi.post(port, loosePlan(Mother.ROOT.text))

    expect(response.status).toBe(202)
    expect(coordinatingSessions.gateCheckout()?.conversation.root.text).toBe(Mother.ROOT.text)
  })
})
