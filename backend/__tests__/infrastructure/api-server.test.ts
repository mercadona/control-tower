import { describe, it, expect, afterEach, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { RunningServers } from '../servers.ts'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import type { ApiCollaborators } from '../../src/infrastructure/api-server.ts'
import { StartPlan, StartPlanResult, PlanStarted, PlanNotStarted } from '../../src/application/actions/start-plan.ts'
import type { StartPlanParams } from '../../src/application/actions/start-plan.ts'
import { Baseline, BaselineResult } from '../../../plugin/scripts/baseline.js'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PlanSessions } from '../../src/infrastructure/plan-sessions.ts'
import {
  PlanAgentNeverLaunched, PlanAgentNotLaunched, PlanAgentNotNamed, UserStoryNotRead, PlanIssueNotCreated, PlanIssueNotNamed,
  WorkspaceNotPrepared,
  PlanCleanupConflict, PlanCleanupNotRead, PlanCleanupNotUnderstood,
  PlanIssueNotClaimed, PlanStatusNotRead, PlanStatusNotUnderstood,
} from '../../src/domain/exceptions.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.ts'
import { RecordedPlanRecovery } from '../../src/infrastructure/recorded-plan-recovery.ts'
import { PlansInFlight } from '../../src/domain/value-objects/plans-in-flight.ts'
import { SurveyExternalTools, SurveyExternalToolsResult } from '../../src/application/queries/survey-external-tools.ts'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { ReviewLog } from '../../src/domain/ports/review-log.ts'
import { ToolSessions } from '../../src/domain/ports/tool-sessions.ts'
import { MetricsDelivery } from '../../src/domain/value-objects/metrics-delivery.ts'
import { UserStories } from '../../src/domain/ports/user-stories.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import { DispatchClaims } from '../../src/domain/ports/dispatch-claims.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { ReviewWatch } from '../../src/infrastructure/review-watch.ts'
import { ClaudeCalls } from '../../src/infrastructure/claude-calls.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import type { RecordedCall } from '../../src/domain/value-objects/recorded-call.ts'
import { PlanCalls } from '../../src/domain/ports/plan-calls.ts'
import { PlanRecovery } from '../../src/domain/policies/plan-recovery.ts'
import { GateKey } from '../../src/infrastructure/gate-key.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { ReadSpecFreeze, ReadSpecFreezeParams, SpecFreezeRead, SpecFreezeState } from '../../src/application/queries/read-spec-freeze.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { PlanNonLaunch } from '../../src/domain/value-objects/plan-non-launch.ts'
import { RecoverPlan } from '../../src/application/actions/recover-plan.ts'
import { CleanupPlan } from '../../src/application/actions/cleanup-plan.ts'
import { PlanOperationRequest } from '../../src/infrastructure/plan-operation-request.ts'
import { GitWorkspace } from '../../src/infrastructure/git-workspace.ts'
import { DiskPlanRecords } from '../../src/infrastructure/disk-plan-records.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'
import { PlanIssueStatus, type PlanIssueStatusValue } from '../../src/domain/value-objects/plan-issue-status.ts'
import { UnusedWorkspace } from '../../src/domain/value-objects/unused-workspace.ts'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.ts'

class StartPlanSpy extends StartPlan {
  static readonly AGENT = 'workspace:4'
  static readonly BASELINE = new BaselineResult({ outcome: 'verde', command: 'npm test', summary: '42 passed' })
  static readonly ISSUE = new PlanIssue({ number: 7, url: 'https://github.com/owner/name/issues/7' })
  static readonly LOCATED = new WorkspaceLocation({ root: '/repo/checkout', path: '/repo/checkout/.worktrees/7', branch: 'feat/7' })
  static readonly WATCH = new PlanWatch({
    story: new UserStoryKey('ABC-123'),
    issue: StartPlanSpy.ISSUE,
    located: StartPlanSpy.LOCATED,
    repository: new RepositoryName('owner/name'),
    agent: StartPlanSpy.AGENT,
  })

  readonly asked: (string | null)[]
  readonly repositories: string[]
  readonly roots: string[]
  readonly failing: boolean

  constructor({ failing = false }: { failing?: boolean } = {}) {
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
    this.repositories = []
    this.roots = []
    this.failing = failing
  }

  static failingWith(cause: Error): StartPlanSpy {
    const spy = new StartPlanSpy()
    spy.execute = async () => {
      throw cause
    }

    return spy
  }

  static buggy(): StartPlanSpy {
    const spy = new StartPlanSpy()
    spy.execute = async () => {
      throw new TypeError('a bug of ours')
    }

    return spy
  }

  async execute(params: StartPlanParams): Promise<StartPlanResult> {
    this.asked.push(params.story === null ? null : params.story.text)
    const [target] = params.targets
    this.repositories.push(target.repository.text)
    this.roots.push(target.root.text)
    if (this.failing) throw new PlanAgentNotLaunched('cmux is not reachable')
    return new StartPlanResult({
      started: [new PlanStarted({
        agent: StartPlanSpy.AGENT,
        baseline: StartPlanSpy.BASELINE,
        watch: new PlanWatch({
          story: params.story,
          issue: StartPlanSpy.ISSUE,
          located: StartPlanSpy.LOCATED,
          repository: target.repository,
          agent: StartPlanSpy.AGENT,
        }),
      })],
      failed: [],
    })
  }
}

class ExternalToolsSpy extends SurveyExternalTools {
  constructor() {
    super({ toolSessions: new ToolSessions(), metricsDelivery: MetricsDelivery.disabled() })
  }

  async execute(): Promise<SurveyExternalToolsResult> {
    return new SurveyExternalToolsResult({ sessions: [], metricsDelivery: MetricsDelivery.disabled() })
  }
}

class NeverWatching extends ReviewWatch {
  constructor(label: string) {
    super({
      asked: () => { throw new Error(`${label} never asks`) },
      review: () => { throw new Error(`${label} never reviews`) },
      sleep: () => { throw new Error(`${label} never sleeps`) },
      stderr: () => undefined,
      label,
      log: new ReviewLog(),
    })
  }
}

class RecoveryRecords extends PlanRecords {
  readonly found: PlansInFlight

  constructor(found: PlansInFlight) {
    super()
    this.found = found
  }

  async inFlight(): Promise<PlansInFlight> {
    return this.found
  }
}

class RecoveryCalls extends ClaudeCalls {
  readonly recorded: readonly RecordedCall[]

  constructor(recorded: readonly RecordedCall[]) {
    super({
      files: new HeadlessFiles({ root: '/state', fs, newId: () => 'unused' }),
      binary: 'claude',
      worker: 'worker',
      spawn,
      env: {},
      newId: () => { throw new Error('a recovery double never mints a call') },
      now: () => { throw new Error('a recovery double never asks for the current time') },
      budgetMs: 1,
      killGraceMs: 1,
      acceptanceMs: 1,
      pollMs: 1,
      sleep: () => { throw new Error('a recovery double never sleeps') },
    })
    this.recorded = recorded
  }

  async history(): Promise<readonly RecordedCall[]> {
    return this.recorded
  }
}

class RecoveryDecisions extends PlanCalls {
  readonly recorded: readonly RecordedCall[]

  constructor(recorded: readonly RecordedCall[]) {
    super()
    this.recorded = recorded
  }

  override async recoveryFor(): Promise<PlanRecovery> {
    return PlanRecovery.from({
      calls: this.recorded.map((recorded) => ({
        call: recorded.call,
        purpose: recorded.purpose,
        startedAt: recorded.startedAt,
        deadlineMs: Date.parse(recorded.startedAt) + 7_205_000,
        completion: recorded.completion,
      })),
      proof: null,
      cleanup: null,
      nowMs: Date.parse('2026-09-16T10:00:00.000Z'),
    })
  }
}

class RecoveryFixture {
  static refusingWith(reason: string): RecordedPlanRecovery {
    return RecoveryFixture.with(PlansInFlight.refused(reason), [])
  }

  static with(records: PlansInFlight, calls: readonly RecordedCall[]): RecordedPlanRecovery {
    const sessions = new PlanSessions()
    const ownership = new RecoveryCalls(calls)

    return new RecordedPlanRecovery({
      records: new RecoveryRecords(records),
      calls: new RecoveryDecisions(calls),
      ownership,
      checkouts: new CheckoutRegistry(),
      activePlans: new ActivePlans({ sessions }),
      reviews: new NeverWatching('pull request review watch double'),
    })
  }
}

class FrontendFixture {
  static readonly INDEX = '<!doctype html><title>control tower</title>'

  static built(): string {
    const root = mkdtempSync(join(tmpdir(), 'ct-frontend-'))
    writeFileSync(join(root, 'index.html'), FrontendFixture.INDEX)

    return root
  }

  static missing(): string {
    return join(tmpdir(), 'ct-frontend-never-built')
  }
}

class RunningApi {
  static readonly STORY = 'ABC-123'
  static readonly REPO = 'owner/name'
  static readonly ACCEPTED_BODY = `{"id":"ABC-123","repo":"owner/name","path":"/repo/checkout"}`
  static readonly REVIEW_BODY = `{"issue":7,"repo":"owner/name","changes":"parte la tarea 2"}`
  static readonly ANSWER =
    '{"status":"started","id":"ABC-123","repo":"owner/name",' +
    '"issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},"agent":"workspace:4",' +
    '"branch":"feat/7","worktree":"/repo/checkout/.worktrees/7","root":"/repo/checkout",' +
    '"baseline":{"outcome":"verde","command":"npm test","summary":"42 passed"}}'
  static spy: StartPlanSpy = new StartPlanSpy()

  static server(options: Partial<ApiCollaborators> = {}): ApiServer {
    RunningApi.spy = new StartPlanSpy()
    const sessions = options.sessions ?? new PlanSessions()
    const activePlans = options.activePlans ?? new ActivePlans({ sessions })

    return new ApiServer({
      port: 0,
      startPlan: RunningApi.spy,
      sessions,
      activePlans,
      externalTools: options.externalTools ?? new ExternalToolsSpy(),
      frontendRoot: FrontendFixture.missing(),
      ...options,
    })
  }

  static async listening(options: Partial<ApiCollaborators> = {}): Promise<number> {
    return RunningServers.started(RunningApi.server(options))
  }

  static async stopAll(): Promise<void> {
    await RunningServers.stopAll()
  }

  static async post(port: number, path: string, body: string, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    })
  }

  static async startPlan(port: number, body: string, headers: Record<string, string> = {}): Promise<Response> {
    return RunningApi.post(port, '/start-plan', body, headers)
  }

  static async accepted(port: number): Promise<Response> {
    return RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY)
  }

  static ask(port: number, lines: string): Promise<string> {
    return new Promise((resolve) => {
      const socket = connect(port, '127.0.0.1', () => socket.write(lines))
      let said = ''
      socket.on('data', (chunk) => {
        said += chunk
      })
      socket.on('close', () => resolve(said.split('\r\n')[0]))
    })
  }

  static asking(path: string, headers: string[], body?: string, host = '127.0.0.1'): string {
    const written = [`POST ${path} HTTP/1.1`, `Host: ${host}`, 'Connection: close', ...headers]
    if (body !== undefined) written.push(`Content-Length: ${Buffer.byteLength(body)}`)

    return `${written.join('\r\n')}\r\n\r\n${body ?? ''}`
  }

  static cutMidBody(port: number): Promise<void> {
    return new Promise((resolve) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(
          'POST /start-plan HTTP/1.1\r\nHost: 127.0.0.1\r\n' +
            'Content-Type: application/json\r\nContent-Length: 5000\r\n\r\n{"id":"'
        )
        socket.destroy()
        resolve()
      })
    })
  }
}

class ReadSpecFreezeSpy extends ReadSpecFreeze {
  readonly asked: ReadSpecFreezeParams[]
  readonly answer: SpecFreezeRead

  constructor(answer: SpecFreezeRead) {
    super({ specs: new EpicSpecs(), branch: new EpicBranch(), pullRequests: new PullRequests() })
    this.asked = []
    this.answer = answer
  }

  async execute(params: ReadSpecFreezeParams): Promise<SpecFreezeRead> {
    this.asked.push(params)

    return this.answer
  }
}

class LiveSessionsDouble extends LiveSessions {
  readonly #open: LiveSession

  constructor(open: LiveSession) {
    super()
    this.#open = open
  }

  find(id: string): LiveSession | null {
    return this.#open.id === id ? this.#open : null
  }

  watch(): LiveSessionStream {
    return { printed: '', stop: (): void => {} }
  }
}

class CoordinatingSessionFixture {
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
  static readonly CONVERSATION = new CoordinatingConversation({
    id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    repository: new RepositoryName('owner/name'),
    root: new CheckoutRoot('/repo/checkout'),
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })

  static live(): CoordinatingSessions {
    const held = new CoordinatingSessions({
      liveSessions: new LiveSessionsDouble(CoordinatingSessionFixture.SESSION), stderr: () => undefined,
    })
    held.remember(new HeldCoordinatingSession({
      target: CoordinatingSessionFixture.TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: CoordinatingSessionFixture.CONVERSATION,
      session: CoordinatingSessionFixture.SESSION,
      attention: SessionAttention.working(),
    }))

    return held
  }
}

describe('ApiServer', () => {
  afterEach(async () => {
    await RunningApi.stopAll()
  })

  it('a_request_cut_halfway_through_its_body_does_not_take_the_whole_process_down_with_it', async () => {
    const port = await RunningApi.listening()

    await RunningApi.cutMidBody(port)
    const afterwards = await RunningApi.accepted(port)

    expect(afterwards.status).toBe(202)
  })

  it('a_client_that_hangs_up_is_ordinary_and_does_not_get_reported_as_something_gone_wrong', async () => {
    const port = await RunningApi.listening()
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      await RunningApi.cutMidBody(port)
      await RunningApi.accepted(port)

      expect(complaining.mock.calls).toEqual([])
    } finally {
      complaining.mockRestore()
    }
  })

  it('start_plan_accepts_and_answers_with_the_agent_it_launched_rather_than_waiting_for_it', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.accepted(port)

    expect(response.status).toBe(202)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.text()).toBe(RunningApi.ANSWER)
  })

  it('an_agent_that_cannot_be_launched_is_reported_as_such_instead_of_a_generic_failure', async () => {
    RunningApi.spy = new StartPlanSpy({ failing: true })
    const server = RunningApi.server({ startPlan: RunningApi.spy })
    const port = await server.start()

    try {
      const response = await RunningApi.accepted(port)

      expect(response.status).toBe(400)
      expect(await response.text()).toBe(
        '{"code":"plan-agent-not-launched","detail":"cmux is not reachable"}'
      )
    } finally {
      await server.stop()
    }
  })

  it('loose start exposes definite non-launch', async () => {
    const proof = new PlanNonLaunch({
      conversation: '11111111-1111-4111-8111-111111111111',
      callId: null,
      source: 'before-worker',
      diagnostic: 'headless worker spawn was refused',
      observedAt: '2026-09-16T10:00:00.000Z',
    })
    const spy = new StartPlanSpy()
    spy.execute = async () => new StartPlanResult({
      started: [],
      failed: [new PlanNotStarted({
        repository: new RepositoryName(RunningApi.REPO),
        cause: new PlanAgentNeverLaunched(proof),
      })],
    })
    const server = RunningApi.server({ startPlan: spy })
    const port = await server.start()

    try {
      const response = await RunningApi.accepted(port)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        code: 'plan-agent-never-launched',
        detail: 'headless worker spawn was refused',
      })
    } finally {
      await server.stop()
    }
  })

  it('a_story_an_issue_or_a_worktree_the_tool_refuses_are_all_answered_as_a_400_naming_the_specific_code', async () => {
    const causes = [
      { cause: new UserStoryNotRead('acli is not authenticated'), code: 'user-story-not-read' },
      { cause: new PlanIssueNotCreated('label not found'), code: 'plan-issue-not-created' },
    ]

    for (const { cause, code } of causes) {
      const server = RunningApi.server({ startPlan: StartPlanSpy.failingWith(cause) })
      const port = await server.start()

      try {
        const response = await RunningApi.accepted(port)

        expect(response.status).toBe(400)
        expect(await response.text()).toBe(`{"code":"${code}","detail":"${cause.message}"}`)
      } finally {
        await server.stop()
      }
    }
  })

  it('a_plan_issue_that_could_not_be_created_after_the_preflight_is_answered_by_its_own_code', async () => {
    const spy = new StartPlanSpy()
    spy.execute = async () => new StartPlanResult({
      started: [],
      failed: [new PlanNotStarted({
        repository: new RepositoryName(RunningApi.REPO),
        cause: new PlanIssueNotCreated('label not found'),
      })],
    })
    const server = RunningApi.server({ startPlan: spy })
    const port = await server.start()

    try {
      const response = await RunningApi.accepted(port)

      expect(response.status).toBe(400)
      expect(await response.text()).toBe('{"code":"plan-issue-not-created","detail":"label not found"}')
    } finally {
      await server.stop()
    }
  })

  it('a_workspace_that_cannot_be_prepared_after_the_preflight_is_answered_by_its_own_code', async () => {
    const spy = new StartPlanSpy()
    spy.execute = async () => new StartPlanResult({
      started: [],
      failed: [new PlanNotStarted({
        repository: new RepositoryName(RunningApi.REPO),
        cause: new WorkspaceNotPrepared('branch is taken'),
      })],
    })
    const server = RunningApi.server({ startPlan: spy })
    const port = await server.start()

    try {
      const response = await RunningApi.accepted(port)

      expect(response.status).toBe(400)
      expect(await response.text()).toBe('{"code":"workspace-not-prepared","detail":"branch is taken"}')
    } finally {
      await server.stop()
    }
  })

  it('a_tool_that_answered_something_unreadable_is_a_400_too_but_with_a_code_of_its_own', async () => {
    const server = RunningApi.server({
      startPlan: StartPlanSpy.failingWith(new PlanIssueNotNamed('gh printed "done"')),
    })
    const port = await server.start()

    try {
      const response = await RunningApi.accepted(port)

      expect(response.status).toBe(400)
      expect(await response.text()).toBe('{"code":"plan-issue-not-named","detail":"gh printed \\"done\\""}')
    } finally {
      await server.stop()
    }
  })

  it('a_failure_that_is_not_a_refusal_to_start_is_not_dressed_up_as_one', async () => {
    const server = RunningApi.server({ startPlan: StartPlanSpy.buggy() })
    const port = await server.start()
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      const response = await RunningApi.accepted(port)

      expect(response.status).toBe(400)
      expect(await response.text()).toBe('{"code":"request-failed","detail":"request failed"}')
    } finally {
      complaining.mockRestore()
      await server.stop()
    }
  })

  it('both plan operation routes enforce the shared body matrix', async () => {
    const recover = vi.fn(async () => {})
    const cleanup = vi.fn(async () => {})
    const projection = { recover: vi.fn(async () => null) }
    const port = await RunningApi.listening({
      recoverPlan: { execute: recover } as unknown as RecoverPlan,
      cleanupPlan: { execute: cleanup } as unknown as CleanupPlan,
      recovery: projection,
    })
    const validAgent = '11111111-1111-4111-8111-111111111111'
    const invalidBodies = [
      '{',
      'null',
      '[]',
      '7',
      '{}',
      '{"repo":"owner/name"}',
      `{"issue":331,"agent":"${validAgent}"}`,
      `{"repo":"owner/name","agent":"${validAgent}"}`,
      '{"repo":"owner/name","issue":331}',
      `{"repo":"owner/name","issue":331,"agent":"${validAgent}","extra":true}`,
      `{"repo":"name","issue":331,"agent":"${validAgent}"}`,
      `{"repo":"owner/name","issue":0,"agent":"${validAgent}"}`,
      `{"repo":"owner/name","issue":-1,"agent":"${validAgent}"}`,
      `{"repo":"owner/name","issue":1.5,"agent":"${validAgent}"}`,
      `{"repo":"owner/name","issue":"331","agent":"${validAgent}"}`,
      `{"repo":"owner/name","issue":9007199254740992,"agent":"${validAgent}"}`,
      '{"repo":"owner/name","issue":331,"agent":""}',
      '{"repo":"owner/name","issue":331,"agent":"not-a-uuid"}',
    ]

    for (const path of ['/recover-plan', '/cleanup-plan']) {
      for (const body of invalidBodies) {
        const response = await RunningApi.post(port, path, body)
        expect(response.status, `${path} ${body}`).toBe(400)
        expect(await response.json(), `${path} ${body}`).toMatchObject({ code: `${path.slice(1)}-invalid-request` })
      }
    }
    expect(recover).not.toHaveBeenCalled()
    expect(cleanup).not.toHaveBeenCalled()
    expect(projection.recover).not.toHaveBeenCalled()
  })

  it('both plan operation routes preserve parser bugs', async () => {
    const recover = vi.fn(async () => {})
    const cleanup = vi.fn(async () => {})
    const projection = { recover: vi.fn(async () => null) }
    const port = await RunningApi.listening({
      recoverPlan: { execute: recover } as unknown as RecoverPlan,
      cleanupPlan: { execute: cleanup } as unknown as CleanupPlan,
      recovery: projection,
    })
    const parser = vi.spyOn(PlanOperationRequest, 'from').mockImplementation(() => {
      throw new TypeError('sentinel parser defect')
    })
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const body = '{"repo":"owner/name","issue":331,"agent":"11111111-1111-4111-8111-111111111111"}'

    try {
      for (const path of ['/recover-plan', '/cleanup-plan']) {
        const response = await RunningApi.post(port, path, body)
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ code: 'request-failed', detail: 'request failed' })
      }
      expect(complaining.mock.calls.map(([line]) => line).join('')).toContain('sentinel parser defect')
      expect(recover).not.toHaveBeenCalled()
      expect(cleanup).not.toHaveBeenCalled()
      expect(projection.recover).not.toHaveBeenCalled()
    } finally {
      parser.mockRestore()
      complaining.mockRestore()
    }
  })

  it('actual cleanup producers retain their exact HTTP refusal and release the reservation', async () => {
    const agent = '11111111-1111-4111-8111-111111111111'
    const repository = new RepositoryName('owner/name')
    const watch = new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 331, url: 'https://github.com/owner/name/issues/331' }),
      located: new WorkspaceLocation({
        root: '/repo/checkout', path: '/repo/checkout/.worktrees/331', branch: 'feat/331',
      }),
      repository,
      agent,
    })
    const body = `{"repo":"owner/name","issue":331,"agent":"${agent}"}`
    const output = (stdout = '') => new ProcessOutput({ code: 0, stdout, stderr: '' })
    const listing = [
      `worktree ${watch.located.root}`,
      `HEAD ${'a'.repeat(40)}`,
      'branch refs/heads/main',
      '',
      `worktree ${watch.located.path}`,
      `HEAD ${'a'.repeat(40)}`,
      'branch refs/heads/feat/331',
      '',
    ].join('\n')
    const workspace = (read: (path: string) => Promise<string | null>) => new GitWorkspace({
      baseline: new Baseline({ run: async () => ({ code: 0, stdout: '', stderr: '' }), read: () => '' }),
      stderr: () => {},
      write: async () => {},
      read,
      run: async (argv) => {
        if (argv.includes('get-url')) return output('https://github.com/owner/name.git\n')
        if (argv.includes('--show-toplevel')) return output(`${watch.located.root}\n`)
        if (argv.includes('worktree') && argv.includes('list')) return output(listing)
        throw new Error(`unlisted git request: ${argv.join(' ')}`)
      },
      gh: new Gh({
        launch: async (argv) => { throw new Error(`unlisted gh request: ${argv.join(' ')}`) },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
        sleep: async () => {},
      }),
    })
    type ProducerEffects = {
      laterEffects: number,
      archiveAttempts: number,
      successfulRetirements: number,
      activeBytesPreserved: boolean | null,
    }
    type DiskFailure =
      | 'snapshot-read'
      | 'malformed-record'
      | 'proof-listing'
      | 'immutable-readback'
      | 'archive-mkdir'
      | 'archive-stat'
      | 'archive-rename'
    const diskFailure = async (kind: DiskFailure, effects: ProducerEffects): Promise<never> => {
      const root = await fs.mkdtemp(join(tmpdir(), `ct-api-cleanup-${kind}-`))
      try {
        const active = join(root, DiskPlanRecords.DIRECTORY, agent)
        const destinationRoot = join(root, DiskPlanRecords.RETIRED_DIRECTORY)
        const destination = join(destinationRoot, agent)
        if (kind === 'malformed-record') {
          const path = join(active, 'dispatch.json')
          await fs.mkdir(active, { recursive: true })
          await fs.writeFile(path, '{not json', 'utf8')
          const malformedBytes = await fs.readFile(path, 'utf8')
          try {
            await new DiskPlanRecords({
              files: new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }),
              newId: () => agent,
              now: () => '2026-09-16T10:00:00.000Z',
              exists: async () => true,
            }).recorded(agent)
          } catch (cause) {
            effects.activeBytesPreserved = await fs.readFile(path, 'utf8') === malformedBytes
            throw cause
          }
          throw new Error('malformed record unexpectedly succeeded')
        }
        const original = new DiskPlanRecords({
          files: new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }),
          newId: () => agent,
          now: () => '2026-09-16T10:00:00.000Z',
          exists: async () => true,
        })
        const recorded = await original.prepare(new PlanBriefing({
          story: null, issue: watch.issue, repository, located: watch.located,
        }))
        const proof = new PlanNonLaunch({
          conversation: agent,
          callId: null,
          source: 'before-worker',
          diagnostic: 'worker did not start',
          observedAt: '2026-09-16T10:00:00.000Z',
        })
        if (kind !== 'snapshot-read') await original.recordNonLaunch(recorded, proof)
        if (kind.startsWith('archive-')) {
          await original.recordCleanupEvidence(new UnusedWorkspace({
            watch: recorded, baseSha: 'a'.repeat(40), checkedAt: '2026-09-16T10:01:00.000Z',
          }))
        }
        const snapshotPath = join(root, 'harness', agent, DiskPlanRecords.CLEANUP_EVIDENCE)
        const proofPath = join(active, DiskPlanRecords.NON_LAUNCH)
        const callsPath = join(active, 'calls')
        const names = await fs.readdir(active)
        const originalBytes = new Map(await Promise.all(names.map(async (name) => [
          name, await fs.readFile(join(active, name), 'utf8'),
        ] as const)))
        const failure = Object.assign(new Error(`${kind} input/output error`), { code: 'EIO' })
        const files = Object.assign(new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }), {
          read: async (path: string) => {
            if (kind === 'snapshot-read' && path === snapshotPath) throw failure
            if (kind === 'immutable-readback' && path === proofPath) throw failure
            return new HeadlessFiles({ root, fs, newId: () => 'unused' }).read(path)
          },
          list: async (path: string) => {
            if (kind === 'proof-listing' && path === callsPath) throw failure
            return new HeadlessFiles({ root, fs, newId: () => 'unused' }).list(path)
          },
        })
        const faultedFs = {
          ...fs,
          mkdir: (async (path: Parameters<typeof fs.mkdir>[0], options?: Parameters<typeof fs.mkdir>[1]) => {
            if (kind === 'archive-mkdir' && String(path) === destinationRoot) {
              effects.archiveAttempts += 1
              throw failure
            }
            return fs.mkdir(path, options)
          }) as typeof fs.mkdir,
          stat: (async (path: Parameters<typeof fs.stat>[0], options?: Parameters<typeof fs.stat>[1]) => {
            if (kind === 'archive-stat' && String(path) === destination) {
              effects.archiveAttempts += 1
              throw failure
            }
            return fs.stat(path, options)
          }) as typeof fs.stat,
          rename: async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => {
            if (kind === 'archive-rename' && String(source) === active && String(target) === destination) {
              effects.archiveAttempts += 1
              throw failure
            }
            return fs.rename(source, target)
          },
        }
        const records = new DiskPlanRecords({
          files: kind.startsWith('archive-')
            ? new HeadlessFiles({ root, fs: faultedFs, newId: () => 'temporary-record' })
            : files,
          newId: () => agent,
          now: () => '2026-09-16T10:00:00.000Z',
          exists: async () => true,
        })
        try {
          if (kind === 'snapshot-read') await records.cleanupEvidence(recorded)
          else if (kind === 'proof-listing') await records.nonLaunch(recorded)
          else if (kind === 'immutable-readback') await records.recordNonLaunch(recorded, proof)
          else await records.archive(recorded)
        } catch (cause) {
          effects.activeBytesPreserved = (await Promise.all([...originalBytes].map(async ([name, bytes]) => (
            await fs.readFile(join(active, name), 'utf8') === bytes
          )))).every(Boolean)
          effects.successfulRetirements = await fs.stat(destination).then(() => 1, () => 0)
          throw cause
        }
        throw new Error(`${kind} unexpectedly succeeded`)
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    }
    const lostRequeueFailure = async (statusFailure: Error, effects: ProducerEffects): Promise<never> => {
      let status: PlanIssueStatusValue = PlanIssueStatus.IN_PROGRESS
      let reads = 0
      class Records extends PlanRecords {
        override async recorded(): Promise<PlanWatch | null> { return watch }
        override async retired(): Promise<PlanWatch | null> { return null }
        override async nonLaunch(): Promise<PlanNonLaunch> {
          return new PlanNonLaunch({
            conversation: agent,
            callId: null,
            source: 'before-worker',
            diagnostic: 'worker did not start',
            observedAt: '2026-09-16T10:00:00.000Z',
          })
        }
        override async cleanupEvidence(): Promise<UnusedWorkspace | null> { return null }
        override async recordCleanupEvidence(): Promise<void> {}
        override async archive(): Promise<void> { effects.successfulRetirements += 1 }
      }
      class CleanupWorkspace extends Workspace {
        override async inspectUnlaunched(): Promise<UnusedWorkspace> {
          return new UnusedWorkspace({ watch, baseSha: 'a'.repeat(40), checkedAt: '2026-09-16T10:01:00.000Z' })
        }
        override async undoUnlaunched(): Promise<void> {}
        override async confirmAbsent(): Promise<void> {}
      }
      class Issues extends PlanIssues {
        override async statusOf(): Promise<PlanIssueStatusValue> {
          reads += 1
          if (reads === 3) throw statusFailure
          return status
        }
      }
      class Claims extends DispatchClaims {
        override async requeue(): Promise<void> {
          status = PlanIssueStatus.READY
          throw new PlanIssueNotClaimed('checked requeue answer was lost')
        }
      }
      await new CleanupPlan({
        records: new Records(), workspace: new CleanupWorkspace(), claims: new Claims(), planIssues: new Issues(),
      }).execute({ agent, issue: 331, repository } as never)
      throw new Error('lost requeue unexpectedly succeeded')
    }
    type Producer = (effects: ProducerEffects) => Promise<never>
    const cases: readonly [
      string, Producer, new (...args: never[]) => Error, string, number, boolean | null,
    ][] = [
      [
        'remaining registration',
        async () => workspace(async () => null).confirmAbsent(watch) as Promise<never>,
        PlanCleanupConflict,
        'cleanup-plan-conflict',
        0,
        null,
      ],
      [
        'seed errno',
        async () => workspace(async () => {
          throw Object.assign(new Error('seed permission denied'), { code: 'EACCES' })
        }).inspectUnlaunched(watch, null) as Promise<never>,
        PlanCleanupNotRead,
        'cleanup-plan-failed',
        0,
        null,
      ],
      [
        'malformed seed',
        async () => workspace(async () => 'not a state document').inspectUnlaunched(watch, null) as Promise<never>,
        PlanCleanupNotUnderstood,
        'cleanup-plan-unreadable',
        0,
        null,
      ],
      ['record snapshot errno', (effects) => diskFailure('snapshot-read', effects), PlanAgentNotLaunched, 'cleanup-plan-failed', 0, true],
      ['record proof listing errno', (effects) => diskFailure('proof-listing', effects), PlanAgentNotLaunched, 'cleanup-plan-failed', 0, true],
      ['record immutable readback errno', (effects) => diskFailure('immutable-readback', effects), PlanAgentNotLaunched, 'cleanup-plan-failed', 0, true],
      ['record archive mkdir errno', (effects) => diskFailure('archive-mkdir', effects), PlanAgentNotLaunched, 'cleanup-plan-failed', 1, true],
      ['record archive stat errno', (effects) => diskFailure('archive-stat', effects), PlanAgentNotLaunched, 'cleanup-plan-failed', 1, true],
      ['record archive rename errno', (effects) => diskFailure('archive-rename', effects), PlanAgentNotLaunched, 'cleanup-plan-failed', 1, true],
      ['malformed record', (effects) => diskFailure('malformed-record', effects), PlanAgentNotNamed, 'cleanup-plan-unreadable', 0, true],
      [
        'lost requeue status read',
        (effects) => lostRequeueFailure(new PlanStatusNotRead('status command failed'), effects),
        PlanCleanupNotRead,
        'cleanup-plan-failed',
        0,
        null,
      ],
      [
        'lost requeue malformed status',
        (effects) => lostRequeueFailure(new PlanStatusNotUnderstood('status labels malformed'), effects),
        PlanCleanupNotUnderstood,
        'cleanup-plan-unreadable',
        0,
        null,
      ],
    ]
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      for (const [name, produce, constructor, code, archiveAttempts, activeBytesPreserved] of cases) {
        const effects: ProducerEffects = {
          laterEffects: 0,
          archiveAttempts: 0,
          successfulRetirements: 0,
          activeBytesPreserved: null,
        }
        const causes: Error[] = []
        let first = true
        const execute = vi.fn(async () => {
          if (!first) return
          first = false
          try {
            await produce(effects)
          } catch (cause) {
            causes.push(cause as Error)
            throw cause
          }
          effects.laterEffects += 1
        })
        const projection = { recover: vi.fn(async () => null) }
        const port = await RunningApi.listening({
          cleanupPlan: { execute } as unknown as CleanupPlan,
          recovery: projection,
        })

        const refused = await RunningApi.post(port, '/cleanup-plan', body)
        expect(refused.status, name).toBe(400)
        expect(causes[0], name).toBeInstanceOf(constructor)
        expect(await refused.json(), name).toEqual({ code, detail: causes[0]!.message })
        expect(effects.laterEffects, name).toBe(0)
        expect(effects.archiveAttempts, name).toBe(archiveAttempts)
        expect(effects.successfulRetirements, name).toBe(0)
        expect(effects.activeBytesPreserved, name).toBe(activeBytesPreserved)
        expect(projection.recover, name).not.toHaveBeenCalled()

        const retried = await RunningApi.post(port, '/cleanup-plan', body)
        expect(retried.status, name).toBe(200)
        expect(await retried.json(), name).toEqual({ agent })
        expect(execute, name).toHaveBeenCalledTimes(2)
        expect(projection.recover, name).toHaveBeenCalledTimes(1)
      }
      expect(complaining.mock.calls).toEqual([])
    } finally {
      complaining.mockRestore()
    }
  })

  it('an actual cleanup adapter bug keeps identity through the shared fallback and releases the reservation', async () => {
    const agent = '11111111-1111-4111-8111-111111111111'
    const watch = new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: 331, url: 'https://github.com/owner/name/issues/331' }),
      located: new WorkspaceLocation({
        root: '/repo/checkout', path: '/repo/checkout/.worktrees/331', branch: 'feat/331',
      }),
      repository: new RepositoryName('owner/name'),
      agent,
    })
    const defect = new TypeError('seed reader sentinel defect')
    const output = (stdout = '') => new ProcessOutput({ code: 0, stdout, stderr: '' })
    const adapter = new GitWorkspace({
      baseline: new Baseline({ run: async () => ({ code: 0, stdout: '', stderr: '' }), read: () => '' }),
      stderr: () => {},
      write: async () => {},
      read: async () => { throw defect },
      run: async (argv) => {
        if (argv.includes('get-url')) return output('https://github.com/owner/name.git\n')
        if (argv.includes('--show-toplevel')) return output(`${watch.located.root}\n`)
        if (argv.includes('worktree') && argv.includes('list')) {
          return output(
            `worktree ${watch.located.root}\nHEAD ${'a'.repeat(40)}\nbranch refs/heads/main\n\n`
            + `worktree ${watch.located.path}\nHEAD ${'a'.repeat(40)}\nbranch refs/heads/feat/331\n`
          )
        }
        throw new Error(`unlisted git request: ${argv.join(' ')}`)
      },
      gh: new Gh({
        launch: async () => { throw new Error('GitHub must not be reached') },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
        sleep: async () => {},
      }),
    })
    const causes: unknown[] = []
    let first = true
    const execute = vi.fn(async () => {
      if (!first) return
      first = false
      try {
        await adapter.inspectUnlaunched(watch, null)
      } catch (cause) {
        causes.push(cause)
        throw cause
      }
    })
    const projection = { recover: vi.fn(async () => null) }
    const port = await RunningApi.listening({
      cleanupPlan: { execute } as unknown as CleanupPlan,
      recovery: projection,
    })
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const body = `{"repo":"owner/name","issue":331,"agent":"${agent}"}`
    try {
      const refused = await RunningApi.post(port, '/cleanup-plan', body)
      expect(refused.status).toBe(400)
      expect(await refused.json()).toEqual({ code: 'request-failed', detail: 'request failed' })
      expect(causes).toHaveLength(1)
      expect(causes[0]).toBe(defect)
      expect(projection.recover).not.toHaveBeenCalled()
      expect(complaining.mock.calls.map(([line]) => line).join('')).toContain('seed reader sentinel defect')

      const retried = await RunningApi.post(port, '/cleanup-plan', body)
      expect(retried.status).toBe(200)
      expect(execute).toHaveBeenCalledTimes(2)
      expect(projection.recover).toHaveBeenCalledTimes(1)
    } finally {
      complaining.mockRestore()
    }
  })

  it('a_bug_of_ours_leaves_a_trace_on_the_error_channel_instead_of_vanishing_behind_that_400', async () => {
    const server = RunningApi.server({ startPlan: StartPlanSpy.buggy() })
    const port = await server.start()
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      await RunningApi.accepted(port)

      const said = complaining.mock.calls.map(([line]) => line).join('')
      expect(said).toContain('request to /start-plan failed')
      expect(said).toContain('a bug of ours')
    } finally {
      complaining.mockRestore()
      await server.stop()
    }
  })

  it('the_id_that_reaches_the_agent_is_the_one_the_body_carried_and_not_a_default', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, '/start-plan', '{"id":"MO_SHOP-42","repo":"owner/name","path":"/repo/checkout"}')

    expect(RunningApi.spy.asked).toEqual(['MO_SHOP-42'])
    expect(await response.text()).toBe(RunningApi.ANSWER.replace('ABC-123', 'MO_SHOP-42'))
  })

  it('an_id_that_is_a_github_issue_url_reaches_the_agent_as_that_same_url', async () => {
    const port = await RunningApi.listening()
    const url = 'https://github.com/mercadona/control-tower/issues/141'

    const response = await RunningApi.post(
      port, '/start-plan', `{"id":${JSON.stringify(url)},"repo":"owner/name","path":"/repo/checkout"}`
    )

    expect(RunningApi.spy.asked).toEqual([url])
    expect(await response.text()).toBe(RunningApi.ANSWER.replace('ABC-123', url))
  })

  it('the_root_the_answer_carries_is_the_checkout_and_not_the_worktree', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.accepted(port)
    const body = JSON.parse(await response.text())

    expect(body.root).not.toBe(body.worktree)
    expect(body.worktree).toMatch(new RegExp(`^${body.root}`))
  })

  it('a_refused_request_never_starts_a_process', async () => {
    const port = await RunningApi.listening()

    await RunningApi.startPlan(port, '{"id":"nope","repo":"owner/name"}')

    expect(RunningApi.spy.asked).toEqual([])
  })

  it('trailing_slashes_do_not_change_the_route_however_many_of_them_are_written', async () => {
    const port = await RunningApi.listening()

    const one = await RunningApi.post(port, '/start-plan/', RunningApi.ACCEPTED_BODY)
    const two = await RunningApi.post(port, '/start-plan//', RunningApi.ACCEPTED_BODY)

    expect([one.status, two.status]).toEqual([202, 202])
  })

  it('a_query_string_does_not_hide_the_route_because_routing_reads_the_path_and_not_the_raw_url', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, '/start-plan?from=ui', RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
  })

  it('reading_start_plan_is_refused_because_starting_a_plan_claims_the_issue_and_cuts_a_worktree', async () => {
    const port = await RunningApi.listening()

    const response = await fetch(`http://127.0.0.1:${port}/start-plan`)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('an_unknown_route_is_rejected_instead_of_answering_ok_to_anything', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, '/whatever', RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('{"code":"not-found","detail":"not found"}')
  })

  it('the retired implementation endpoint is not found', async () => {
    const port = await RunningApi.listening()

    const posted = await RunningApi.post(
      port,
      '/implement-plan',
      '{"agent":"workspace:20","issue":33,"repo":"owner/name"}'
    )
    const read = await fetch(`http://127.0.0.1:${port}/implement-plan`)

    expect(posted.status).toBe(404)
    expect(await posted.json()).toEqual({ code: 'not-found', detail: 'not found' })
    expect(read.status).toBe(404)
    expect(await read.json()).toEqual({ code: 'not-found', detail: 'not found' })
  })

  it('a_request_from_a_foreign_page_is_refused_because_any_site_can_post_to_localhost', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY, {
      Origin: 'https://evil.example',
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('{"code":"foreign-origin","detail":"this api only serves the page it hosts"}')
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_request_from_the_page_this_server_hosts_is_accepted_because_that_page_is_the_frontend', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY, {
      Origin: `http://127.0.0.1:${port}`,
    })

    expect(response.status).toBe(202)
  })

  it('the_page_opened_as_localhost_is_still_our_own_because_the_host_header_says_so_too', async () => {
    const port = await RunningApi.listening()

    const said = await RunningApi.ask(
      port,
      RunningApi.asking(
        '/start-plan',
        [`Origin: http://localhost:${port}`, 'Content-Type: application/json'],
        RunningApi.ACCEPTED_BODY,
        `localhost:${port}`
      )
    )

    expect(said).toContain('202')
  })

  it('a_host_that_is_not_loopback_does_not_vouch_for_its_origin_because_dns_can_point_any_name_here', async () => {
    const port = await RunningApi.listening()

    const said = await RunningApi.ask(
      port,
      RunningApi.asking(
        '/start-plan',
        [`Origin: http://rebound.example:${port}`, 'Content-Type: application/json'],
        RunningApi.ACCEPTED_BODY,
        `rebound.example:${port}`
      )
    )

    expect(said).toContain('403')
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_origin_on_another_port_of_loopback_is_foreign_because_another_local_server_is_another_site', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY, {
      Origin: `http://127.0.0.1:${port + 1}`,
    })

    expect(response.status).toBe(403)
  })

  it('the_frontend_build_is_served_from_the_root_so_page_and_api_share_one_origin', async () => {
    const root = FrontendFixture.built()
    const port = await RunningApi.listening({ frontendRoot: root })

    const response = await fetch(`http://127.0.0.1:${port}/`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(FrontendFixture.INDEX)
  })

  it('a_frontend_root_that_does_not_exist_yet_leaves_the_api_up_instead_of_refusing_to_start', async () => {
    const port = await RunningApi.listening({ frontendRoot: FrontendFixture.missing() })

    const page = await fetch(`http://127.0.0.1:${port}/`)
    const api = await RunningApi.accepted(port)

    expect(page.status).toBe(404)
    expect(api.status).toBe(202)
  })

  it('serving_pages_does_not_open_start_plan_to_a_get_because_static_files_fall_through_to_the_routes', async () => {
    const port = await RunningApi.listening({ frontendRoot: FrontendFixture.built() })

    const response = await fetch(`http://127.0.0.1:${port}/start-plan`)

    expect(response.status).toBe(405)
  })

  it('a_body_not_declared_as_json_is_refused_so_a_page_cannot_reach_this_without_a_preflight', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY, {
      'Content-Type': 'text/plain',
    })

    expect(response.status).toBe(415)
  })

  it('a_charset_on_the_content_type_is_still_json_because_clients_add_one_unasked', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY, {
      'Content-Type': 'application/json; charset=utf-8',
    })

    expect(response.status).toBe(202)
  })

  it('a_body_that_is_not_json_is_refused_instead_of_starting_a_plan_for_nothing', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, 'ABC-123')

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"code":"body-not-a-json-object","detail":"body must be a JSON object"}')
  })

  it('valid_json_that_is_not_an_object_is_refused_as_such_and_not_mistaken_for_a_missing_id', async () => {
    const port = await RunningApi.listening()

    const refused = await Promise.all(
      ['"ABC-123"', '[{"id":"ABC-123"}]', 'null', '123'].map((body) => RunningApi.startPlan(port, body))
    )

    expect(await Promise.all(refused.map((response) => response.text()))).toEqual(
      Array(4).fill('{"code":"body-not-a-json-object","detail":"body must be a JSON object"}')
    )
  })

  it('a_body_without_a_ticket_is_refused', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, '{}')

    expect(response.status).toBe(400)
    expect(await response.text()).toBe(
      '{"code":"nothing-to-plan","detail":"id is required to say what to plan"}'
    )
  })

  it('rejects_the_removed_description_before_starting_any_work', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(
      port,
      '{"user_comment":"Plan the health endpoint","repo":"owner/name","path":"/repo/checkout"}'
    )

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"code":"unknown-field","detail":"unknown field: user_comment"}')
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_id_that_is_not_shaped_like_a_story_key_is_refused_before_it_ever_becomes_a_branch_name', async () => {
    const port = await RunningApi.listening()

    const refused = await Promise.all(
      [
        '{"id":"   "}',
        '{"id":123}',
        '{"id":"../../etc/passwd"}',
        '{"id":"-o"}',
        '{"id":"abc-1"}',
        '{"id":"ABC"}',
        '{"id":"ABC-123 rm -rf"}',
        '{"id":"ABC-123\\n"}',
      ].map((body) => RunningApi.startPlan(port, body))
    )

    expect(refused.map((response) => response.status)).toEqual(Array(8).fill(400))
  })

  it('an_unknown_field_is_refused_because_it_means_the_other_side_changed_shape', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, `{"id":"${RunningApi.STORY}","repo":"owner/name","priority":"high"}`)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"code":"unknown-field","detail":"unknown field: priority"}')
  })

  it('the_repository_the_body_names_is_the_one_the_use_case_is_asked_to_open_the_issue_in', async () => {
    const port = await RunningApi.listening()

    await RunningApi.post(port, '/start-plan', '{"id":"ABC-123","repo":"josemerca/ct-loop-sandbox","path":"/repo/checkout"}')

    expect(RunningApi.spy.repositories).toEqual(['josemerca/ct-loop-sandbox'])
  })

  it('the_path_the_body_names_is_the_root_the_use_case_is_asked_to_cut_the_worktree_in', async () => {
    const port = await RunningApi.listening()

    await RunningApi.post(port, '/start-plan', '{"id":"ABC-123","repo":"owner/name","path":"/Users/someone/repos/name"}')

    expect(RunningApi.spy.roots).toEqual(['/Users/someone/repos/name'])
  })

  it('a_body_with_no_path_is_refused_because_the_worktree_has_to_be_cut_somewhere', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, `{"id":"${RunningApi.STORY}","repo":"${RunningApi.REPO}"}`)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe(
      '{"code":"malformed-path","detail":"path must be an absolute path"}'
    )
  })

  it('a_path_that_is_not_absolute_is_refused_before_it_ever_becomes_an_argument_of_git', async () => {
    const port = await RunningApi.listening()

    const refused = await Promise.all(
      [
        '{"id":"ABC-123","repo":"owner/name","path":"repos/name"}',
        '{"id":"ABC-123","repo":"owner/name","path":"~/repos/name"}',
        '{"id":"ABC-123","repo":"owner/name","path":""}',
        '{"id":"ABC-123","repo":"owner/name","path":123}',
      ].map((body) => RunningApi.startPlan(port, body))
    )

    expect(refused.map((response) => response.status)).toEqual([400, 400, 400, 400])
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_trailing_slash_reaches_the_use_case_because_git_absorbs_it_when_it_canonicalises_the_root', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, '{"id":"ABC-123","repo":"owner/name","path":"/repos/name/"}')

    expect(response.status).toBe(202)
    expect(RunningApi.spy.roots).toEqual(['/repos/name/'])
  })

  it('a_path_with_a_semicolon_in_a_segment_is_still_well_formed_because_nothing_ever_reaches_a_shell', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(
      port,
      '{"id":"ABC-123","repo":"owner/name","path":"/repos/name; rm -rf ~"}'
    )

    expect(response.status).toBe(202)
    expect(RunningApi.spy.roots).toEqual(['/repos/name; rm -rf ~'])
  })

  it('a_body_with_no_repo_is_refused_because_an_issue_has_to_be_opened_somewhere', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, `{"id":"${RunningApi.STORY}"}`)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"code":"malformed-repo","detail":"repo must be a repository such as owner/name"}')
  })

  it('a_body_carrying_the_retired_repo_list_field_is_refused_with_what_to_send_instead', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(
      port,
      '{"id":"ABC-123","repo_list":[' +
        '{"repo":"owner/name","path":"/repo/checkout"},' +
        '{"repo":"owner/other","path":"/repo/other-checkout"}' +
        ']}'
    )

    expect(response.status).toBe(400)
    expect(await response.text()).toBe(
      '{"code":"repo-list-retired","detail":"repo_list is retired: send repo and path for one repository instead"}'
    )
    expect(RunningApi.spy.repositories).toEqual([])
  })

  it('a_repo_that_is_not_shaped_like_one_is_refused_before_it_ever_becomes_an_argument_of_gh', async () => {
    const port = await RunningApi.listening()

    const refused = await Promise.all(
      [
        '{"id":"ABC-123","repo":"name"}',
        '{"id":"ABC-123","repo":"owner/name/extra"}',
        '{"id":"ABC-123","repo":"-o/name"}',
        '{"id":"ABC-123","repo":"owner/../../etc"}',
        '{"id":"ABC-123","repo":"owner/name rm -rf"}',
        '{"id":"ABC-123","repo":""}',
        '{"id":"ABC-123","repo":123}',
      ].map((body) => RunningApi.startPlan(port, body))
    )

    expect(refused.map((response) => response.status)).toEqual(Array(7).fill(400))
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_body_over_the_cap_is_refused_instead_of_being_buffered_whole', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, `{"id":"${'A'.repeat(9000)}","repo":"owner/name"}`)

    expect(response.status).toBe(413)
  })

  it('the_route_is_one_exact_name_and_not_the_thousand_aliases_a_case_blind_router_answers_to', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, '/START-PLAN', `{"id":"${RunningApi.STORY}"}`)

    expect(response.status).toBe(404)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_compressed_body_is_not_a_shape_this_api_agreed_to_accept_and_never_reaches_the_domain_inflated', async () => {
    const port = await RunningApi.listening()

    const response = await fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: gzipSync(Buffer.from(`{"id":"${RunningApi.STORY}"}`)),
    })

    expect(response.status).toBe(400)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('the_cap_counts_the_bytes_the_client_sent_so_a_refusal_never_names_a_size_nobody_wrote', async () => {
    const port = await RunningApi.listening()
    const squeezed = gzipSync(Buffer.from(`{"id":"${'A'.repeat(20000)}"}`))

    const response = await fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: squeezed,
    })

    expect(squeezed.length).toBeLessThan(8 * 1024)
    expect(response.status).not.toBe(413)
  })

  it('a_body_that_arrives_with_no_length_is_judged_by_the_domain_instead_of_blamed_on_its_media_type', async () => {
    const port = await RunningApi.listening()

    const said = await RunningApi.ask(port, RunningApi.asking('/start-plan', ['Content-Type: application/json']))

    expect(said).toContain('400')
  })

  it('the_trace_of_a_failure_names_the_url_the_client_asked_for_and_not_the_one_routing_rewrote', async () => {
    const server = RunningApi.server({ startPlan: StartPlanSpy.buggy() })
    const port = await server.start()
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      await RunningApi.post(port, '/start-plan//', RunningApi.ACCEPTED_BODY)

      expect(complaining.mock.calls.map(([line]) => line).join('')).toContain('request to /start-plan// failed')
    } finally {
      complaining.mockRestore()
      await server.stop()
    }
  })

  it('a_path_that_climbs_out_and_back_in_is_not_the_route_however_a_client_writes_it', async () => {
    const port = await RunningApi.listening()
    const body = `{"id":"${RunningApi.STORY}"}`

    const climbed = await RunningApi.ask(
      port,
      RunningApi.asking('/foo/../start-plan', ['Content-Type: application/json'], body)
    )

    expect(climbed).toContain('404')
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('the_answer_does_not_advertise_the_stack_that_serves_it', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.accepted(port)

    expect(response.headers.get('x-powered-by')).toBe(null)
  })

  it('stop_closes_the_socket_so_a_later_request_cannot_reach_a_server_believed_dead', async () => {
    const server = RunningApi.server({ startPlan: new StartPlanSpy() })
    const port = await server.start()

    await server.stop()

    await expect(RunningApi.accepted(port)).rejects.toThrow()
  })

  it('an_error_after_a_successful_listen_is_not_swallowed_by_the_promise_that_already_resolved', async () => {
    const server = RunningApi.server({ startPlan: new StartPlanSpy() })
    await server.start()

    try {
      expect(() => server.server!.emit('error', new Error('boom'))).toThrow('boom')
    } finally {
      await server.stop()
    }
  })

  it('starting_twice_is_refused_instead_of_leaking_the_first_server_out_of_reach', async () => {
    const server = RunningApi.server({ startPlan: new StartPlanSpy() })
    await server.start()

    try {
      await expect(server.start()).rejects.toThrow(/already listening/)
    } finally {
      await server.stop()
    }
  })

  it.each(['plan-events', 'planning-progress', 'implement-progress'])('the retired %s route is absent for reads and writes', async (route) => {
    const port = await RunningApi.listening()
    for (const method of ['GET', 'POST']) {
      const response = await fetch(`http://127.0.0.1:${port}/${route}/7?repo=${encodeURIComponent(RunningApi.REPO)}`, { method })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ code: 'not-found', detail: 'not found' })
    }
  })

  it('a_started_plan_leaves_no_watch_over_its_issue', async () => {
    const sessions = new PlanSessions()
    const port = await RunningApi.listening({ sessions })

    const response = await RunningApi.accepted(port)

    expect(response.status).toBe(202)
    expect(sessions.known()).toEqual([StartPlanSpy.WATCH])
  })

  it('active_plans_returns_the_exact_live_plan_started_by_the_ordinary_route', async () => {
    const port = await RunningApi.listening()

    await RunningApi.accepted(port)
    const response = await fetch(`http://127.0.0.1:${port}/active-plans`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ plans: [{
      phase: 'planning',
      acceptsChange: false,
      request: { id: 'ABC-123', repo: 'owner/name', path: '/repo/checkout' },
      plan: {
        id: 'ABC-123',
        repo: 'owner/name',
        issue: { number: 7, url: 'https://github.com/owner/name/issues/7' },
        agent: 'workspace:4',
        branch: 'feat/7',
        worktree: '/repo/checkout/.worktrees/7',
      },
    }] })
  })

  it('active_plans_refuses_other_methods_and_declares_get', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, '/active-plans', '{}')

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
  })

  it('active_plans_turns_away_a_foreign_browser_origin', async () => {
    const port = await RunningApi.listening()

    const response = await fetch(`http://127.0.0.1:${port}/active-plans`, {
      headers: { Origin: 'https://evil.example' },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'foreign-origin', detail: 'this api only serves the page it hosts',
    })
  })

  it('review_plan_is_no_longer_routed_and_falls_to_the_last_net', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, '/review-plan', RunningApi.REVIEW_BODY)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('{"code":"not-found","detail":"not found"}')
  })

  it('active_plans_retries_inconclusive_inspection_without_running_recovery', async () => {
    const inspection = { inspect: vi.fn().mockReturnValueOnce('records could not be listed').mockReturnValueOnce(null) }
    const recovery = { recover: vi.fn() }
    const port = await RunningApi.listening({ inspection, recovery })

    const unknown = await fetch(`http://127.0.0.1:${port}/active-plans`)
    const recovered = await fetch(`http://127.0.0.1:${port}/active-plans`)

    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toEqual({
      code: 'active-plans-recovery-inconclusive',
      detail: 'records could not be listed',
    })
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toEqual({ plans: [] })
    expect(inspection.inspect).toHaveBeenCalledTimes(2)
    expect(recovery.recover).not.toHaveBeenCalled()
  })

  it('the_detail_of_an_inconclusive_recovery_carries_what_the_records_answered_and_not_a_fixed_sentence', async () => {
    const answered = 'the state root could not be read'
    const recovery = RecoveryFixture.refusingWith(answered)
    const port = await RunningApi.listening({ inspection: recovery })

    const response = await fetch(`http://127.0.0.1:${port}/active-plans`)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'active-plans-recovery-inconclusive',
      detail: answered,
    })
  })

  it('the_spec_freeze_read_is_served_and_another_method_on_its_path_is_refused', async () => {
    const coordinatingSessions = CoordinatingSessionFixture.live()
    const readSpecFreeze = new ReadSpecFreezeSpy(
      new SpecFreezeRead({ state: SpecFreezeState.NO_SPEC, spec: null, findings: [], frozenOn: null, pullRequest: null })
    )
    const gateKey = new GateKey({ random: (size) => Buffer.alloc(size, 1) })
    const port = await RunningApi.listening({ coordinatingSessions, readSpecFreeze, gateKey })

    const response = await fetch(`http://127.0.0.1:${port}/spec-freeze`)
    const refused = await fetch(`http://127.0.0.1:${port}/spec-freeze`, { method: 'DELETE' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'no-spec', target: CoordinatingSessionFixture.TARGET,
    })
    expect(readSpecFreeze.asked).toHaveLength(1)
    expect(refused.status).toBe(405)
    expect(refused.headers.get('allow')).toBe('GET, POST')
  })

  it('the two paths of gate 2 refuse a method they do not serve naming the ones they do', async () => {
    const port = await RunningApi.listening()

    const groomRefused = await fetch(`http://127.0.0.1:${port}/epic-groom`, { method: 'DELETE' })
    const promotionRefused = await fetch(`http://127.0.0.1:${port}/epic-promotion`)

    expect(groomRefused.status).toBe(405)
    expect(groomRefused.headers.get('allow')).toBe('GET, POST')
    expect(promotionRefused.status).toBe(405)
    expect(promotionRefused.headers.get('allow')).toBe('POST')
  })
})
