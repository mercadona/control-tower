import { afterEach, describe, expect, it } from 'vitest'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { CoordinatingConversationMother } from '../coordinating-conversation-mother.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import {
  MilestoneProgressRead, type ReadMilestoneProgress, type ReadMilestoneProgressParams,
} from '../../src/application/queries/read-milestone-progress.ts'
import { MilestoneProgress } from '../../src/domain/value-objects/milestone-progress.ts'
import { SliceLine, SliceLineState } from '../../src/domain/value-objects/slice-line.ts'
import { SliceTask, SliceTaskStatus } from '../../src/domain/value-objects/slice-task.ts'
import { EpicIssue } from '../../src/domain/value-objects/epic-issue.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import { PlanningToolCall } from '../../src/domain/value-objects/planning-activity.ts'
import { ImplementationProgressNotRead } from '../../src/domain/exceptions.ts'

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

class ReadMilestoneProgressDouble {
  readonly asked: ReadMilestoneProgressParams[] = []
  answer: (params: ReadMilestoneProgressParams) => Promise<MilestoneProgressRead> = async () => {
    throw new Error('no answer scripted for this double')
  }

  static answering(read: MilestoneProgressRead): ReadMilestoneProgressDouble {
    const double = new ReadMilestoneProgressDouble()
    double.answer = async () => read
    return double
  }

  static failing(failure: Error): ReadMilestoneProgressDouble {
    const double = new ReadMilestoneProgressDouble()
    double.answer = async () => { throw failure }
    return double
  }

  static neverAsked(): ReadMilestoneProgressDouble {
    return new ReadMilestoneProgressDouble()
  }

  static hanging(): ReadMilestoneProgressDouble {
    let announce: () => void = () => undefined
    let answer: (read: MilestoneProgressRead) => void = () => undefined
    const hanging = new ReadMilestoneProgressDouble()
    hanging.answer = async () => {
      announce()
      return await new Promise<MilestoneProgressRead>((resolve) => { answer = resolve })
    }
    hanging.started = new Promise<void>((resolve) => { announce = resolve })
    hanging.answerTheHangingOne = (): void => answer(new MilestoneProgressRead(null))

    return hanging
  }

  started: Promise<void> = Promise.resolve()
  answerTheHangingOne: () => void = () => undefined

  async execute(params: ReadMilestoneProgressParams): Promise<MilestoneProgressRead> {
    this.asked.push(params)
    return this.answer(params)
  }
}

class RunningApi {
  static readonly live: ApiServer[] = []
  readonly server: ApiServer

  constructor({ coordinatingSessions, readMilestoneProgress }: {
    coordinatingSessions: CoordinatingSessions, readMilestoneProgress: Pick<ReadMilestoneProgress, 'execute'>,
  }) {
    this.server = new ApiServer({ port: 0, frontendRoot: '/no-frontend', coordinatingSessions, readMilestoneProgress })
  }

  async start(): Promise<string> {
    RunningApi.live.push(this.server)
    return `http://127.0.0.1:${await this.server.start()}`
  }

  static async stop(): Promise<void> {
    await Promise.all(RunningApi.live.splice(0).map((server) => server.stop()))
  }
}

class Mother {
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
  static readonly NEXT_TARGET = '69d8d78f-1f6f-47db-98c5-3a13b1710691'
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly CONVERSATION = CoordinatingConversationMother.of({
    id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    repository: Mother.REPOSITORY,
    root: Mother.ROOT,
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'implementation' })

  static live(): CoordinatingSessions {
    const held = new CoordinatingSessions({ liveSessions: new LiveSessionsDouble(Mother.SESSION), stderr: (): void => {} })
    held.remember(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    }))

    return held
  }

  static none(): CoordinatingSessions {
    return new CoordinatingSessions({ liveSessions: new LiveSessionsDouble(Mother.SESSION), stderr: (): void => {} })
  }

  static replacement(): HeldCoordinatingSession {
    return new HeldCoordinatingSession({
      target: Mother.NEXT_TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    })
  }

  static pendingIssue(): EpicIssue {
    return new EpicIssue({
      number: 1, url: `https://github.com/${Mother.REPOSITORY.text}/issues/1`, title: 'Pending slice',
      status: PlanIssueStatus.BACKLOG, isOpen: true, order: 1,
    })
  }

  static pendingLine(): SliceLine {
    return new SliceLine({
      issue: Mother.pendingIssue(), state: SliceLineState.PENDING, step: null, task: null, totalTasks: null,
      stepStartedAt: null, lastToolCall: null, lastText: null, pullRequest: null, baselineRed: false,
      attention: null, tasks: [],
    })
  }

  static vetoedIssue(): EpicIssue {
    return new EpicIssue({
      number: 2, url: `https://github.com/${Mother.REPOSITORY.text}/issues/2`, title: 'Vetoed slice',
      status: PlanIssueStatus.IN_PROGRESS, isOpen: true, order: 2,
    })
  }

  static vetoedLine(): SliceLine {
    return new SliceLine({
      issue: Mother.vetoedIssue(), state: SliceLineState.NEEDS_PERSON, step: 'judge', task: 2, totalTasks: 3,
      stepStartedAt: null,
      lastToolCall: new PlanningToolCall({ name: 'Bash', argument: 'npx vitest run' }),
      lastText: 'the judge vetoed the task',
      pullRequest: null, baselineRed: true,
      attention: { kind: 'veto', task: 2, findings: 'a missing test', verdict: 'blocked' },
      tasks: [
        new SliceTask({ number: 1, name: 'Write the port', status: SliceTaskStatus.DONE, ruling: 'approved', findings: null }),
        new SliceTask({ number: 2, name: 'Wire the route', status: SliceTaskStatus.STOPPED, ruling: null, findings: 'a missing test' }),
        new SliceTask({ number: 3, name: null, status: SliceTaskStatus.PENDING, ruling: null, findings: null }),
      ],
    })
  }

  static closedByControlsLine(): SliceLine {
    return new SliceLine({
      issue: Mother.vetoedIssue(), state: SliceLineState.NEEDS_PERSON, step: 'controls', task: 2, totalTasks: 3,
      stepStartedAt: null, lastToolCall: null, lastText: null, pullRequest: null, baselineRed: false,
      attention: {
        kind: 'controls', task: 2, outcome: 'failed', command: 'npm test', code: 1, log: '.agent/run-7/controls.log',
      },
      tasks: [],
    })
  }
}

describe('MilestoneProgressRoute', () => {
  afterEach(() => RunningApi.stop())

  it('a held session with a milestone answers one line per issue in snake case', async () => {
    const read = ReadMilestoneProgressDouble.answering(new MilestoneProgressRead(
      new MilestoneProgress({ milestone: 'Some milestone', lines: [Mother.pendingLine(), Mother.vetoedLine()] })
    ))
    const api = new RunningApi({ coordinatingSessions: Mother.live(), readMilestoneProgress: read })

    const response = await fetch(`${await api.start()}/milestone-progress`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'milestone',
      target: Mother.TARGET,
      milestone: 'Some milestone',
      delivered: 0,
      total: 2,
      issues: [
        {
          number: 1, url: `https://github.com/${Mother.REPOSITORY.text}/issues/1`, title: 'Pending slice',
          state: 'pending', step: null, task: null, total_tasks: null, step_started_at: null,
          last_tool: null, last_text: null, pull_request: null, attention: null, baseline_red: false, tasks: [],
        },
        {
          number: 2, url: `https://github.com/${Mother.REPOSITORY.text}/issues/2`, title: 'Vetoed slice',
          state: 'needs-person', step: 'judge', task: 2, total_tasks: 3, step_started_at: null,
          last_tool: { name: 'Bash', argument: 'npx vitest run' }, last_text: 'the judge vetoed the task',
          pull_request: null, attention: { kind: 'veto', task: 2, findings: 'a missing test', verdict: 'blocked' },
          baseline_red: true,
          tasks: [
            { number: 1, name: 'Write the port', status: 'done', ruling: 'approved', findings: null },
            { number: 2, name: 'Wire the route', status: 'stopped', ruling: null, findings: 'a missing test' },
            { number: 3, name: null, status: 'pending', ruling: null, findings: null },
          ],
        },
      ],
    })
    expect(read.asked[0].root.text).toBe(Mother.ROOT.text)
    expect(read.asked[0].repository.text).toBe(Mother.REPOSITORY.text)
  })

  it('a line closed by its controls answers the controls attention with the command and the log', async () => {
    const read = ReadMilestoneProgressDouble.answering(new MilestoneProgressRead(
      new MilestoneProgress({ milestone: 'Some milestone', lines: [Mother.closedByControlsLine()] })
    ))
    const api = new RunningApi({ coordinatingSessions: Mother.live(), readMilestoneProgress: read })

    const response = await fetch(`${await api.start()}/milestone-progress`)

    expect(response.status).toBe(200)
    const body = await response.json() as { issues: { attention: unknown }[] }
    expect(body.issues[0].attention).toEqual({
      kind: 'controls', task: 2, outcome: 'failed', command: 'npm test', code: 1, log: '.agent/run-7/controls.log',
    })
  })

  it('an authorised checkout with no frozen milestone answers no-milestone', async () => {
    const read = ReadMilestoneProgressDouble.answering(new MilestoneProgressRead(null))
    const api = new RunningApi({ coordinatingSessions: Mother.live(), readMilestoneProgress: read })

    const response = await fetch(`${await api.start()}/milestone-progress`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'no-milestone', target: Mother.TARGET })
  })

  it('a delayed read cannot issue gate authority after its coordinating target is replaced', async () => {
    const held = Mother.live()
    const read = ReadMilestoneProgressDouble.hanging()
    const api = new RunningApi({ coordinatingSessions: held, readMilestoneProgress: read })
    const origin = await api.start()

    const pending = fetch(`${origin}/milestone-progress`)
    await read.started
    held.remember(Mother.replacement())
    read.answerTheHangingOne()
    const response = await pending

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
  })

  it('no held session answers none and the read gets no call', async () => {
    const read = ReadMilestoneProgressDouble.neverAsked()
    const api = new RunningApi({ coordinatingSessions: Mother.none(), readMilestoneProgress: read })

    const response = await fetch(`${await api.start()}/milestone-progress`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
    expect(read.asked).toEqual([])
  })

  it('a session the person closed answers none and the read gets no call', async () => {
    const held = Mother.live()
    const identity = { conversation: Mother.CONVERSATION.id.text, target: Mother.TARGET }
    held.beginClose(identity)
    held.finishClose(identity)
    const read = ReadMilestoneProgressDouble.neverAsked()
    const api = new RunningApi({ coordinatingSessions: held, readMilestoneProgress: read })

    const response = await fetch(`${await api.start()}/milestone-progress`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
    expect(read.asked).toEqual([])
  })

  it('a read that fails answers milestone-progress-not-read', async () => {
    const failure = new ImplementationProgressNotRead('the run file could not be read')
    const read = ReadMilestoneProgressDouble.failing(failure)
    const api = new RunningApi({ coordinatingSessions: Mother.live(), readMilestoneProgress: read })

    const response = await fetch(`${await api.start()}/milestone-progress`)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'milestone-progress-not-read', detail: 'the run file could not be read',
    })
  })

  it('a method other than GET is refused', async () => {
    const read = ReadMilestoneProgressDouble.neverAsked()
    const api = new RunningApi({ coordinatingSessions: Mother.live(), readMilestoneProgress: read })

    const response = await fetch(`${await api.start()}/milestone-progress`, { method: 'POST' })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(read.asked).toEqual([])
  })
})
