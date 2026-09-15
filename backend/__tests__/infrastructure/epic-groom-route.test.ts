import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { Browsers } from '../../src/infrastructure/http.ts'
import { EpicGroomRoute } from '../../src/infrastructure/epic-groom-route.ts'
import { GateKey } from '../../src/infrastructure/gate-key.ts'
import {
  ReadEpicGroom, ReadEpicGroomParams, EpicGroomRead, EpicGroomState,
} from '../../src/application/queries/read-epic-groom.ts'
import { GroomEpic, GroomEpicParams, EpicGroomed, PlanStaleness } from '../../src/application/actions/groom-epic.ts'
import { WorkInFlight } from '../../src/infrastructure/work-in-flight.ts'
import { EpicNotGroomed } from '../../src/domain/exceptions.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { PublishedSpecs } from '../../src/domain/ports/published-specs.ts'
import { EpicIssues } from '../../src/domain/ports/epic-issues.ts'
import { EpicGroom } from '../../src/domain/ports/epic-groom.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { EpicIssue } from '../../src/domain/value-objects/epic-issue.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import { GroomPlan, GroomPlanIssue } from '../../src/domain/value-objects/groom-plan.ts'
import { PlanFingerprint } from '../../src/domain/policies/plan-fingerprint.ts'

class ReadEpicGroomSpy extends ReadEpicGroom {
  static neverAsked(): ReadEpicGroomSpy {
    return new ReadEpicGroomSpy(async () => { throw new Error('the read must not be asked') })
  }

  readonly asked: ReadEpicGroomParams[]
  readonly answer: (params: ReadEpicGroomParams) => Promise<EpicGroomRead>

  constructor(answer: (params: ReadEpicGroomParams) => Promise<EpicGroomRead>) {
    super({
      specs: new EpicSpecs(), published: new PublishedSpecs(), issues: new EpicIssues(), groom: new EpicGroom(),
      branch: new EpicBranch(), pullRequests: new PullRequests(), fingerprint: Mother.FINGERPRINT,
    })
    this.asked = []
    this.answer = answer
  }

  static answering(read: EpicGroomRead): ReadEpicGroomSpy {
    return new ReadEpicGroomSpy(async () => read)
  }

  async execute(params: ReadEpicGroomParams): Promise<EpicGroomRead> {
    this.asked.push(params)

    return this.answer(params)
  }
}

class GroomEpicSpy extends GroomEpic {
  readonly asked: GroomEpicParams[]
  readonly answer: (params: GroomEpicParams) => Promise<EpicGroomed>

  constructor(answer: (params: GroomEpicParams) => Promise<EpicGroomed>) {
    super({
      read: new ReadEpicGroom({
        specs: new EpicSpecs(), published: new PublishedSpecs(), issues: new EpicIssues(), groom: new EpicGroom(),
        branch: new EpicBranch(), pullRequests: new PullRequests(), fingerprint: Mother.FINGERPRINT,
      }),
      groom: new EpicGroom(),
      fingerprint: Mother.FINGERPRINT,
    })
    this.asked = []
    this.answer = answer
  }

  static answering(groomed: EpicGroomed): GroomEpicSpy {
    return new GroomEpicSpy(async () => groomed)
  }

  static neverAsked(): GroomEpicSpy {
    return new GroomEpicSpy(async () => { throw new Error('the groom must not be asked') })
  }

  static refusing(cause: Error): GroomEpicSpy {
    return new GroomEpicSpy(async () => { throw cause })
  }

  static hanging(): GroomEpicSpy {
    let answer: (groomed: EpicGroomed) => void = () => undefined
    const pending = new Promise<EpicGroomed>((resolve) => { answer = resolve })
    const hanging = new GroomEpicSpy(async () => await pending)
    hanging.answerTheHangingOne = (): void => answer(Mother.groomedOutcome([Mother.backlogIssue()]))

    return hanging
  }

  answerTheHangingOne: () => void = () => undefined

  async execute(params: GroomEpicParams): Promise<EpicGroomed> {
    this.asked.push(params)

    return this.answer(params)
  }
}

class Keys {
  static readonly RANDOM = (size: number): Buffer => Buffer.alloc(size, 7)
  static readonly MINTED = '07'.repeat(GateKey.BYTES)

  static minted(): GateKey {
    return new GateKey({ random: Keys.RANDOM })
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

class Mother {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly CONVERSATION = new CoordinatingConversation({
    id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    repository: Mother.REPOSITORY,
    root: Mother.ROOT,
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })
  static readonly MILESTONE = 'Test epic'
  static readonly PLAN = new GroomPlan({
    milestone: Mother.MILESTONE,
    issues: [new GroomPlanIssue({ order: 1, title: '#1 First slice', labels: ['type:feature'] })],
  })
  static readonly FINGERPRINT = new PlanFingerprint({
    digest: (text) => Buffer.from(text, 'utf8').toString('hex'),
  })
  static readonly PLAN_FINGERPRINT = Mother.FINGERPRINT.of(Mother.PLAN)

  static live(): CoordinatingSessions {
    const held = new CoordinatingSessions({
      liveSessions: new LiveSessionsDouble(Mother.SESSION), stderr: (): void => {},
    })
    held.remember(new HeldCoordinatingSession({
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    }))

    return held
  }

  static none(): CoordinatingSessions {
    return new CoordinatingSessions({
      liveSessions: new LiveSessionsDouble(Mother.SESSION), stderr: (): void => {},
    })
  }

  static backlogIssue(): EpicIssue {
    return new EpicIssue({
      number: 1,
      url: `https://github.com/${Mother.REPOSITORY.text}/issues/1`,
      title: 'wears status:backlog and stays open',
      status: PlanIssueStatus.BACKLOG,
      isOpen: true,
      order: 1,
    })
  }

  static readyIssue(): EpicIssue {
    return new EpicIssue({
      number: 2,
      url: `https://github.com/${Mother.REPOSITORY.text}/issues/2`,
      title: 'already promoted to status:ready',
      status: PlanIssueStatus.READY,
      isOpen: true,
      order: 2,
    })
  }

  static groomableRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.GROOMABLE, spec: null, milestone: Mother.MILESTONE, plan: Mother.PLAN,
      planFingerprint: Mother.PLAN_FINGERPRINT, issues: [],
    })
  }

  static groomedRead(issues: EpicIssue[]): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.GROOMED, spec: null, milestone: Mother.MILESTONE, plan: null, planFingerprint: null,
      issues,
    })
  }

  static authorisedRead(issues: EpicIssue[]): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.AUTHORISED, spec: null, milestone: Mother.MILESTONE, plan: null, planFingerprint: null,
      issues,
    })
  }

  static partiallyGroomedRead(issues: EpicIssue[]): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.PARTIALLY_GROOMED, spec: null, milestone: Mother.MILESTONE, plan: Mother.PLAN,
      planFingerprint: Mother.PLAN_FINGERPRINT, issues,
    })
  }

  static readonly PULL_REQUEST = Object.freeze({
    number: 341, url: `https://github.com/${Mother.REPOSITORY.text}/pull/341`,
  })

  static awaitingPublicationRead(pullRequest: { number: number, url: string } | null): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.AWAITING_PUBLICATION, spec: null, milestone: null, plan: null, planFingerprint: null,
      issues: [], pullRequest,
    })
  }

  static reslicedRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.RESLICED, spec: null, milestone: null, plan: null, planFingerprint: null, issues: [],
    })
  }

  static reslicedGroomed(): EpicGroomed {
    return new EpicGroomed({
      state: EpicGroomState.RESLICED, milestone: null, plan: null, issues: [], staleness: PlanStaleness.FRESH,
    })
  }

  static readonly ISSUES_UNCERTAIN_REASON = 'the milestone may hold more issues than this backend could read'

  static issuesUncertainRead(): EpicGroomRead {
    return new EpicGroomRead({
      state: EpicGroomState.ISSUES_UNCERTAIN, spec: null, milestone: Mother.MILESTONE, plan: null,
      planFingerprint: null, issues: [], reason: Mother.ISSUES_UNCERTAIN_REASON,
    })
  }

  static issuesUncertainGroomed(): EpicGroomed {
    return new EpicGroomed({
      state: EpicGroomState.ISSUES_UNCERTAIN, milestone: Mother.MILESTONE, plan: null, issues: [],
      staleness: PlanStaleness.FRESH, reason: Mother.ISSUES_UNCERTAIN_REASON,
    })
  }

  static draftGroomed(): EpicGroomed {
    return new EpicGroomed({
      state: EpicGroomState.DRAFT, milestone: null, plan: null, issues: [], staleness: PlanStaleness.FRESH,
    })
  }

  static awaitingPublicationGroomed(): EpicGroomed {
    return new EpicGroomed({
      state: EpicGroomState.AWAITING_PUBLICATION, milestone: null, plan: null, issues: [],
      staleness: PlanStaleness.FRESH,
    })
  }

  static groomedOutcome(issues: EpicIssue[]): EpicGroomed {
    return new EpicGroomed({
      state: EpicGroomState.GROOMED, milestone: Mother.MILESTONE, plan: Mother.PLAN, issues,
      staleness: PlanStaleness.FRESH,
    })
  }

  static regroomedOutcome(issues: EpicIssue[]): EpicGroomed {
    return new EpicGroomed({
      state: EpicGroomState.GROOMED, milestone: Mother.MILESTONE, plan: null, issues, staleness: PlanStaleness.FRESH,
    })
  }

  static staleGroomable(): EpicGroomed {
    return new EpicGroomed({
      state: EpicGroomState.GROOMABLE, milestone: Mother.MILESTONE, plan: Mother.PLAN, issues: [],
      staleness: PlanStaleness.CHANGED,
    })
  }
}

class RunningApi {
  static readonly #started: Server[] = []
  static readonly PATH = EpicGroomRoute.PATH

  static async listening(
    held: CoordinatingSessions,
    read: ReadEpicGroom,
    groom: GroomEpic,
    key: GateKey,
    inFlight: WorkInFlight = new WorkInFlight(),
    stderr: (line: string) => void = (): void => {}
  ): Promise<number> {
    const app = express()
    app.get(RunningApi.PATH, Browsers.turnAwayForeign, EpicGroomRoute.reading(held, read, key))
    app.post(RunningApi.PATH, EpicGroomRoute.grooming(held, groom, key, inFlight, stderr))
    app.all(RunningApi.PATH, EpicGroomRoute.refuseOtherMethods)
    const server = createServer(app)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    RunningApi.#started.push(server)

    return (server.address() as AddressInfo).port
  }

  static async stopAll(): Promise<void> {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve())
    })))
  }

  static ownOrigin(port: number): string {
    return `http://127.0.0.1:${port}`
  }

  static async fetching(port: number, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${RunningApi.ownOrigin(port)}${RunningApi.PATH}`, { headers })
  }

  static async posting(port: number, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${RunningApi.ownOrigin(port)}${RunningApi.PATH}`, { method: 'POST', headers })
  }

  static async get(held: CoordinatingSessions, read: ReadEpicGroom, groom: GroomEpic, key: GateKey): Promise<Response> {
    const port = await RunningApi.listening(held, read, groom, key)

    return RunningApi.fetching(port, { Origin: RunningApi.ownOrigin(port) })
  }

  static async other(held: CoordinatingSessions, read: ReadEpicGroom, groom: GroomEpic, key: GateKey): Promise<Response> {
    const port = await RunningApi.listening(held, read, groom, key)

    return fetch(`${RunningApi.ownOrigin(port)}${RunningApi.PATH}`, { method: 'DELETE' })
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('EpicGroomRoute', () => {
  it('the read hands the gate key only at a rung with something to press', async () => {
    const key = Keys.minted()
    const groomablePort = await RunningApi.listening(
      Mother.live(), ReadEpicGroomSpy.answering(Mother.groomableRead()), GroomEpicSpy.neverAsked(), key
    )
    const authorisedPort = await RunningApi.listening(
      Mother.live(), ReadEpicGroomSpy.answering(Mother.authorisedRead([Mother.readyIssue()])), GroomEpicSpy.neverAsked(), key
    )

    const groomable = await RunningApi.fetching(groomablePort, { Origin: RunningApi.ownOrigin(groomablePort) })
    const authorised = await RunningApi.fetching(authorisedPort, { Origin: RunningApi.ownOrigin(authorisedPort) })
    const fromThePage = await RunningApi.fetching(groomablePort, { 'Sec-Fetch-Site': 'same-origin' })
    const fromElsewhere = await RunningApi.fetching(groomablePort)

    expect(await groomable.json()).toEqual({
      status: 'groomable',
      milestone: Mother.MILESTONE,
      plan: { issues: [{ order: 1, title: '#1 First slice', labels: ['type:feature'] }] },
      planFingerprint: Mother.PLAN_FINGERPRINT,
      key: Keys.MINTED,
    })
    expect(await authorised.json()).toEqual({
      status: 'authorised',
      milestone: Mother.MILESTONE,
      issues: [{
        number: 2,
        url: `https://github.com/${Mother.REPOSITORY.text}/issues/2`,
        title: 'already promoted to status:ready',
        status: 'ready',
      }],
    })
    expect(await fromThePage.json()).toEqual({
      status: 'groomable',
      milestone: Mother.MILESTONE,
      plan: { issues: [{ order: 1, title: '#1 First slice', labels: ['type:feature'] }] },
      planFingerprint: Mother.PLAN_FINGERPRINT,
      key: Keys.MINTED,
    })
    expect(await fromElsewhere.json()).toEqual({
      status: 'groomable',
      milestone: Mother.MILESTONE,
      plan: { issues: [{ order: 1, title: '#1 First slice', labels: ['type:feature'] }] },
      planFingerprint: Mother.PLAN_FINGERPRINT,
    })
  })

  it('a post with no gate key is refused and the groom is never asked', async () => {
    const held = Mother.live()
    const groom = GroomEpicSpy.neverAsked()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, ReadEpicGroomSpy.neverAsked(), groom, key)

    const response = await RunningApi.posting(port)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'gate-not-from-the-page',
      detail: 'gate 2 answers only a request carrying the key the page was given',
    })
    expect(groom.asked).toEqual([])
  })

  it('a second press while the first is in flight is refused and the groom runs once', async () => {
    const held = Mother.live()
    const groom = GroomEpicSpy.hanging()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, ReadEpicGroomSpy.neverAsked(), groom, key)

    const first = RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })
    const second = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({
      code: 'groom-in-progress',
      detail: 'a groom of this checkout is under way: wait for it to answer before pressing again',
    })
    expect(groom.asked).toHaveLength(1)
    groom.answerTheHangingOne()
    await first
    expect(groom.asked).toHaveLength(1)
  })

  it('a groom that failed frees the next press instead of locking the checkout for ever', async () => {
    const held = Mother.live()
    const groom = GroomEpicSpy.refusing(new EpicNotGroomed('ct-groom exited with something other than 0 or 3'))
    const port = await RunningApi.listening(held, ReadEpicGroomSpy.neverAsked(), groom, Keys.minted())

    const refused = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })
    const again = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(refused.status).toBe(400)
    expect(again.status).toBe(400)
    expect(await again.json()).toEqual({
      code: 'epic-not-groomed',
      detail: 'ct-groom exited with something other than 0 or 3',
    })
    expect(groom.asked).toHaveLength(2)
  })

  it('a groomable read answers the milestone and what would be created', async () => {
    const held = Mother.live()
    const read = ReadEpicGroomSpy.answering(Mother.groomableRead())
    const groom = GroomEpicSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, groom, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'groomable',
      milestone: Mother.MILESTONE,
      plan: { issues: [{ order: 1, title: '#1 First slice', labels: ['type:feature'] }] },
      planFingerprint: Mother.PLAN_FINGERPRINT,
      key: Keys.MINTED,
    })
  })

  it('a groomed read answers each issue with the rung it stands at', async () => {
    const held = Mother.live()
    const issues = [Mother.backlogIssue(), Mother.readyIssue()]
    const read = ReadEpicGroomSpy.answering(Mother.groomedRead(issues))
    const groom = GroomEpicSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, groom, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'groomed',
      milestone: Mother.MILESTONE,
      issues: [
        {
          number: 1,
          url: `https://github.com/${Mother.REPOSITORY.text}/issues/1`,
          title: 'wears status:backlog and stays open',
          status: 'backlog',
        },
        {
          number: 2,
          url: `https://github.com/${Mother.REPOSITORY.text}/issues/2`,
          title: 'already promoted to status:ready',
          status: 'ready',
        },
      ],
      key: Keys.MINTED,
    })
  })

  it('a partially groomed read answers the milestone, the plan and the issues that already exist, with a key to press', async () => {
    const held = Mother.live()
    const read = ReadEpicGroomSpy.answering(Mother.partiallyGroomedRead([Mother.backlogIssue()]))
    const groom = GroomEpicSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, groom, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'partially-groomed',
      milestone: Mother.MILESTONE,
      plan: { issues: [{ order: 1, title: '#1 First slice', labels: ['type:feature'] }] },
      planFingerprint: Mother.PLAN_FINGERPRINT,
      issues: [{
        number: 1,
        url: `https://github.com/${Mother.REPOSITORY.text}/issues/1`,
        title: 'wears status:backlog and stays open',
        status: 'backlog',
      }],
      key: Keys.MINTED,
    })
  })

  it('a read still waiting for the pull request that publishes the spec answers it, so the page can link it', async () => {
    const held = Mother.live()
    const read = ReadEpicGroomSpy.answering(Mother.awaitingPublicationRead(Mother.PULL_REQUEST))
    const groom = GroomEpicSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, groom, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'awaiting-publication',
      pullRequest: { number: 341, url: `https://github.com/${Mother.REPOSITORY.text}/pull/341` },
    })
  })

  it('a wait with no pull request to name answers the wait with a null one, never without the field', async () => {
    const held = Mother.live()
    const read = ReadEpicGroomSpy.answering(Mother.awaitingPublicationRead(null))
    const groom = GroomEpicSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, groom, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'awaiting-publication', pullRequest: null })
  })

  it('a resliced read answers the state and the gate key, and names no plan to press over', async () => {
    const held = Mother.live()
    const read = ReadEpicGroomSpy.answering(Mother.reslicedRead())
    const groom = GroomEpicSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, groom, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'resliced', key: Keys.MINTED })
  })

  it('a press over a resliced spec is refused as spec-resliced and names what has to happen first', async () => {
    const held = Mother.live()
    const read = ReadEpicGroomSpy.neverAsked()
    const groom = GroomEpicSpy.answering(Mother.reslicedGroomed())
    const key = Keys.minted()
    const port = await RunningApi.listening(held, read, groom, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'spec-resliced',
      detail: 'the slicing changed in the coordinating session: publish it and merge it before the groom runs',
    })
  })

  it('an uncertain read answers the milestone and why, and offers no key to press', async () => {
    const held = Mother.live()
    const read = ReadEpicGroomSpy.answering(Mother.issuesUncertainRead())
    const groom = GroomEpicSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, groom, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'issues-uncertain',
      milestone: Mother.MILESTONE,
      reason: Mother.ISSUES_UNCERTAIN_REASON,
    })
  })

  it('a spec that is not frozen refuses the groom as spec-not-frozen', async () => {
    const held = Mother.live()
    const groom = GroomEpicSpy.answering(Mother.draftGroomed())
    const key = Keys.minted()
    const port = await RunningApi.listening(held, ReadEpicGroomSpy.neverAsked(), groom, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'spec-not-frozen',
      detail: 'the spec is not frozen: gate 1 first',
    })
  })

  it('a listing that could not be exhausted refuses the groom as epic-issues-uncertain, carrying why', async () => {
    const held = Mother.live()
    const groom = GroomEpicSpy.answering(Mother.issuesUncertainGroomed())
    const key = Keys.minted()
    const port = await RunningApi.listening(held, ReadEpicGroomSpy.neverAsked(), groom, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'epic-issues-uncertain',
      detail: Mother.ISSUES_UNCERTAIN_REASON,
    })
  })

  it('a spec that is not published refuses the groom as spec-not-published', async () => {
    const held = Mother.live()
    const groom = GroomEpicSpy.answering(Mother.awaitingPublicationGroomed())
    const key = Keys.minted()
    const port = await RunningApi.listening(held, ReadEpicGroomSpy.neverAsked(), groom, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'spec-not-published',
      detail: 'the spec is frozen, but its committed copy is not yet readable on the default branch',
    })
  })

  it('a successful groom answers the issues and records what was planned and what exists', async () => {
    const held = Mother.live()
    const issuesAfter = [Mother.backlogIssue()]
    const groom = GroomEpicSpy.answering(Mother.groomedOutcome(issuesAfter))
    const key = Keys.minted()
    const said: string[] = []
    const port = await RunningApi.listening(held, ReadEpicGroomSpy.neverAsked(), groom, key, new WorkInFlight(), (line) => { said.push(line) })

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'groomed',
      milestone: Mother.MILESTONE,
      issues: [{
        number: 1,
        url: `https://github.com/${Mother.REPOSITORY.text}/issues/1`,
        title: 'wears status:backlog and stays open',
        status: 'backlog',
      }],
    })
    expect(said).toEqual([`${EpicGroomRoute.RECORD}: "${Mother.MILESTONE}" planned 1 issue(s), holds 1 now\n`])
  })

  it('a regroom records that no plan was taken rather than a plan of zero issues', async () => {
    const held = Mother.live()
    const groom = GroomEpicSpy.answering(Mother.regroomedOutcome([Mother.backlogIssue()]))
    const key = Keys.minted()
    const said: string[] = []
    const port = await RunningApi.listening(held, ReadEpicGroomSpy.neverAsked(), groom, key, new WorkInFlight(), (line) => { said.push(line) })

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(200)
    expect(said).toEqual([
      `${EpicGroomRoute.RECORD}: "${Mother.MILESTONE}" ${EpicGroomRoute.NO_PLAN_ON_THIS_PRESS}, holds 1 now\n`,
    ])
  })

  it('the plan fingerprint header travels through to the groom, and a press with none asks with none at all', async () => {
    const held = Mother.live()
    const groom = GroomEpicSpy.answering(Mother.groomedOutcome([Mother.backlogIssue()]))
    const key = Keys.minted()
    const port = await RunningApi.listening(held, ReadEpicGroomSpy.neverAsked(), groom, key)

    await RunningApi.posting(
      port, { [GateKey.HEADER]: Keys.MINTED, [EpicGroomRoute.PLAN_FINGERPRINT_HEADER]: Mother.PLAN_FINGERPRINT }
    )
    await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(groom.asked.map((asked) => asked.fingerprint)).toEqual([Mother.PLAN_FINGERPRINT, null])
  })

  it('a press whose plan no longer matches what is on screen is refused as plan-changed and nothing is recorded', async () => {
    const held = Mother.live()
    const groom = GroomEpicSpy.answering(Mother.staleGroomable())
    const key = Keys.minted()
    const said: string[] = []
    const port = await RunningApi.listening(held, ReadEpicGroomSpy.neverAsked(), groom, key, new WorkInFlight(), (line) => { said.push(line) })

    const response = await RunningApi.posting(
      port,
      { [GateKey.HEADER]: Keys.MINTED, [EpicGroomRoute.PLAN_FINGERPRINT_HEADER]: 'the fingerprint of a plan nobody sees any more' }
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'plan-changed',
      detail: 'the spec changed since this plan was shown: read the new plan before pressing again',
    })
    expect(said).toEqual([])
  })

  it('another method is refused naming the allowed ones', async () => {
    const held = Mother.live()
    const read = ReadEpicGroomSpy.neverAsked()
    const groom = GroomEpicSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.other(held, read, groom, key)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(read.asked).toEqual([])
  })
})
