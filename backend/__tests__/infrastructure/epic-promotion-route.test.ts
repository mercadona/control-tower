import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { EpicPromotionRoute } from '../../src/infrastructure/epic-promotion-route.ts'
import { GateKey } from '../../src/infrastructure/gate-key.ts'
import { PromoteEpic, PromoteEpicParams, EpicPromoted } from '../../src/application/actions/promote-epic.ts'
import { EpicGroomState } from '../../src/application/queries/read-epic-groom.ts'
import { ReadEpicGroom } from '../../src/application/queries/read-epic-groom.ts'
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
import { SpecRevision } from '../../src/domain/policies/spec-revision.ts'

class PromoteEpicSpy extends PromoteEpic {
  static neverAsked(): PromoteEpicSpy {
    return new PromoteEpicSpy(async () => { throw new Error('the promotion must not be asked') })
  }

  readonly asked: PromoteEpicParams[]
  readonly answer: (params: PromoteEpicParams) => Promise<EpicPromoted>

  constructor(answer: (params: PromoteEpicParams) => Promise<EpicPromoted>) {
    super({
      read: new ReadEpicGroom({
        specs: new EpicSpecs(), published: new PublishedSpecs(), issues: new EpicIssues(), groom: new EpicGroom(),
        branch: new EpicBranch(), pullRequests: new PullRequests(),
        fingerprint: new PlanFingerprint({ digest: (text) => text }),
        revisions: new SpecRevision({ digest: (text) => text }),
      }),
      issues: new EpicIssues(),
    })
    this.asked = []
    this.answer = answer
  }

  static answering(promoted: EpicPromoted): PromoteEpicSpy {
    return new PromoteEpicSpy(async () => promoted)
  }

  async execute(params: PromoteEpicParams): Promise<EpicPromoted> {
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
  static readonly HOME = Mother.REPOSITORY.text
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly CONVERSATION = new CoordinatingConversation({
    id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    repository: Mother.REPOSITORY,
    root: Mother.ROOT,
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })
  static readonly MILESTONE = 'Test epic'

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

  static readonly PLAN = new GroomPlan({
    home: Mother.HOME,
    milestone: Mother.MILESTONE,
    issues: [
      new GroomPlanIssue({ order: 1, title: '#1 First slice', labels: ['type:feature'], repo: Mother.HOME }),
      new GroomPlanIssue({ order: 2, title: '#2 Second slice', labels: ['type:feature'], repo: Mother.HOME }),
    ],
  })

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
      number: 1,
      url: `https://github.com/${Mother.REPOSITORY.text}/issues/1`,
      title: 'now promoted to status:ready',
      status: PlanIssueStatus.READY,
      isOpen: true,
      order: 1,
    })
  }

  static groomableWithNoIssues(): EpicPromoted {
    return new EpicPromoted({
      state: EpicGroomState.GROOMABLE, milestone: Mother.MILESTONE, plan: null, issues: [], promoted: [],
    })
  }

  static promoted(issuesAfter: EpicIssue[], numbers: number[]): EpicPromoted {
    return new EpicPromoted({
      state: EpicGroomState.GROOMED, milestone: Mother.MILESTONE, plan: null, issues: issuesAfter, promoted: numbers,
    })
  }

  static partiallyGroomed(issues: EpicIssue[]): EpicPromoted {
    return new EpicPromoted({
      state: EpicGroomState.PARTIALLY_GROOMED, milestone: Mother.MILESTONE, plan: Mother.PLAN, issues, promoted: [],
    })
  }

  static readonly ISSUES_UNCERTAIN_REASON = 'the milestone may hold more issues than this backend could read'

  static issuesUncertain(): EpicPromoted {
    return new EpicPromoted({
      state: EpicGroomState.ISSUES_UNCERTAIN, milestone: Mother.MILESTONE, plan: null, issues: [], promoted: [],
      reason: Mother.ISSUES_UNCERTAIN_REASON,
    })
  }
}

class RunningApi {
  static readonly #started: Server[] = []
  static readonly PATH = EpicPromotionRoute.PATH

  static async listening(
    held: CoordinatingSessions,
    promote: PromoteEpic,
    key: GateKey,
    stderr: (line: string) => void = (): void => {}
  ): Promise<number> {
    const app = express()
    app.post(RunningApi.PATH, EpicPromotionRoute.promoting(held, promote, key, stderr))
    app.all(RunningApi.PATH, EpicPromotionRoute.refuseOtherMethods)
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

  static async posting(port: number, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${RunningApi.ownOrigin(port)}${RunningApi.PATH}`, { method: 'POST', headers })
  }

  static async other(port: number): Promise<Response> {
    return fetch(`${RunningApi.ownOrigin(port)}${RunningApi.PATH}`)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('EpicPromotionRoute', () => {
  it('a post with no gate key is refused and the promotion is never asked', async () => {
    const held = Mother.live()
    const promote = PromoteEpicSpy.neverAsked()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, promote, key)

    const response = await RunningApi.posting(port)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'gate-not-from-the-page',
      detail: 'gate 2 answers only a request carrying the key the page was given',
    })
    expect(promote.asked).toEqual([])
  })

  it('the same post carrying the key answers the issues and which numbers it moved', async () => {
    const held = Mother.live()
    const promote = PromoteEpicSpy.answering(Mother.promoted([Mother.readyIssue()], [1]))
    const key = Keys.minted()
    const port = await RunningApi.listening(held, promote, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'groomed',
      milestone: Mother.MILESTONE,
      issues: [{
        number: 1,
        url: `https://github.com/${Mother.REPOSITORY.text}/issues/1`,
        title: 'now promoted to status:ready',
        status: 'ready',
      }],
      promoted: [1],
    })
  })

  it('an epic with no issues is refused as no-epic-issues', async () => {
    const held = Mother.live()
    const promote = PromoteEpicSpy.answering(Mother.groomableWithNoIssues())
    const key = Keys.minted()
    const port = await RunningApi.listening(held, promote, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'no-epic-issues',
      detail: 'the milestone holds no issue yet: the groom has to run first',
    })
  })

  it('a partially groomed epic is refused as epic-partially-groomed, naming how many of how many issues exist', async () => {
    const held = Mother.live()
    const promote = PromoteEpicSpy.answering(Mother.partiallyGroomed([Mother.backlogIssue()]))
    const key = Keys.minted()
    const port = await RunningApi.listening(held, promote, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'epic-partially-groomed',
      detail: 'the milestone holds 1 of 2 issue(s): finish the groom before authorising',
    })
  })

  it('a listing that could not be exhausted is refused as epic-issues-uncertain, carrying why', async () => {
    const held = Mother.live()
    const promote = PromoteEpicSpy.answering(Mother.issuesUncertain())
    const key = Keys.minted()
    const port = await RunningApi.listening(held, promote, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'epic-issues-uncertain',
      detail: Mother.ISSUES_UNCERTAIN_REASON,
    })
  })

  it('with no coordinating session it is refused without asking the promotion', async () => {
    const held = Mother.none()
    const promote = PromoteEpicSpy.neverAsked()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, promote, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'no-coordinating-session',
      detail: 'no coordinating session is held: there is nothing to promote',
    })
    expect(promote.asked).toEqual([])
  })

  it('a successful press records the milestone and the numbers that moved', async () => {
    const held = Mother.live()
    const issuesAfter = [Mother.readyIssue()]
    const promote = PromoteEpicSpy.answering(Mother.promoted(issuesAfter, [1]))
    const key = Keys.minted()
    const said: string[] = []
    const port = await RunningApi.listening(held, promote, key, (line) => { said.push(line) })

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(200)
    expect(said).toEqual([`${EpicPromotionRoute.RECORD}: "${Mother.MILESTONE}" holds 1 issue(s), moved 1 to status:ready\n`])
  })

  it('another method is refused naming the allowed one', async () => {
    const held = Mother.live()
    const promote = PromoteEpicSpy.neverAsked()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, promote, key)

    const response = await RunningApi.other(port)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(promote.asked).toEqual([])
  })
})
