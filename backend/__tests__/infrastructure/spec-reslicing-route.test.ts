import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { RunningServers } from '../servers.ts'
import { Browsers } from '../../src/infrastructure/http.ts'
import { GateKey } from '../../src/infrastructure/gate-key.ts'
import { CoordinatingSessionTarget } from '../../src/infrastructure/coordinating-session-target.ts'
import { WorkInFlight } from '../../src/infrastructure/work-in-flight.ts'
import { SpecReslicingRoute, SpecReslicingOutcome } from '../../src/infrastructure/spec-reslicing-route.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState,
} from '../../src/infrastructure/coordinating-sessions.ts'
import {
  PublishReslicing, PublishReslicingParams, ReslicingPublished, ReslicingOutcome,
} from '../../src/application/actions/publish-reslicing.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { SpecRevision } from '../../src/domain/policies/spec-revision.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { EpicBranchNotPublished } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversationMother } from '../coordinating-conversation-mother.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'

class PublishReslicingSpy extends PublishReslicing {
  readonly asked: PublishReslicingParams[]
  readonly answer: () => Promise<ReslicingPublished>

  constructor(answer: () => Promise<ReslicingPublished>) {
    super({
      specs: new EpicSpecs(), branch: new EpicBranch(), pullRequests: new PullRequests(),
      revisions: new SpecRevision({ digest: (text) => text }),
    })
    this.asked = []
    this.answer = answer
  }

  static publishing(): PublishReslicingSpy {
    return new PublishReslicingSpy(async () => ReslicingPublished.published(Mother.PULL_REQUEST))
  }

  static refusing(outcome: typeof ReslicingOutcome.NO_SPEC | typeof ReslicingOutcome.NOT_FROZEN): PublishReslicingSpy {
    return new PublishReslicingSpy(async () => ReslicingPublished.refused(outcome))
  }

  static collapsing(): PublishReslicingSpy {
    return new PublishReslicingSpy(async () => {
      throw new EpicBranchNotPublished('git push of milestone/2026-01-01-test-execution failed: no upstream')
    })
  }

  static neverAsked(): PublishReslicingSpy {
    return new PublishReslicingSpy(async () => {
      throw new Error('PublishReslicing was asked although the request should have been refused first')
    })
  }

  async execute(params: PublishReslicingParams): Promise<ReslicingPublished> {
    this.asked.push(params)

    return this.answer()
  }
}

class APublicationYouFinishByHand {
  static inFlight(): { publish: PublishReslicingSpy, started: Promise<void>, finish: () => void } {
    let announce: () => void = (): void => {}
    const started = new Promise<void>((resolve) => { announce = resolve })
    let release: () => void = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const publish = new PublishReslicingSpy(async () => {
      announce()
      await gate

      return ReslicingPublished.published(Mother.PULL_REQUEST)
    })

    return { publish, started, finish: () => release() }
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

class Keys {
  static readonly MINTED = '07'.repeat(GateKey.BYTES)
  static readonly FROM_ANOTHER_RUN = '09'.repeat(GateKey.BYTES)

  static minted(): GateKey {
    return new GateKey({ random: (size: number) => Buffer.alloc(size, 0x07) })
  }
}

class Mother {
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
  static readonly OLD_TARGET = 'f135ce89-e980-4fa3-a02d-44dd12228304'
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly PULL_REQUEST = Object.freeze({
    number: 13, url: 'https://github.com/owner/name/pull/13',
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })
  static readonly CONVERSATION = CoordinatingConversationMother.of({
    id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    repository: Mother.REPOSITORY,
    root: Mother.ROOT,
  })

  static registry(): CoordinatingSessions {
    return new CoordinatingSessions({ liveSessions: new LiveSessionsDouble(), stderr: (): void => {} })
  }

  static live(): CoordinatingSessions {
    const held = Mother.registry()
    held.remember(new HeldCoordinatingSession({
      target: Mother.TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    }))

    return held
  }

  static failedClose(): CoordinatingSessions {
    const held = Mother.live()
    const identity = { conversation: Mother.CONVERSATION.id.text, target: Mother.TARGET }
    held.beginClose(identity)
    held.failClose(identity, { code: 'session-not-terminated', detail: 'group still exists' })
    return held
  }
}

class RunningApi {
  static readonly PATH = SpecReslicingRoute.PATH

  static async listening(held: CoordinatingSessions, publish: PublishReslicing, key: GateKey): Promise<number> {
    const app = express()
    app.post(
      RunningApi.PATH,
      Browsers.turnAwayForeign,
      SpecReslicingRoute.publishing(held, publish, key, new WorkInFlight())
    )
    app.all(RunningApi.PATH, SpecReslicingRoute.refuseOtherMethods)
    return RunningServers.listening(app)
  }

  static async stopAll(): Promise<void> {
    await RunningServers.stopAll()
  }

  static posting(
    port: number, headers: Record<string, string> = {}, target: string | null = Mother.TARGET
  ): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, {
      method: 'POST',
      headers: { ...(target === null ? {} : { [CoordinatingSessionTarget.HEADER]: target }), ...headers },
    })
  }

  static async press(
    held: CoordinatingSessions,
    publish: PublishReslicing,
    headers: Record<string, string> = {},
    target: string | null = Mother.TARGET,
  ): Promise<Response> {
    return RunningApi.posting(await RunningApi.listening(held, publish, Keys.minted()), headers, target)
  }

  static async getting(held: CoordinatingSessions, publish: PublishReslicing): Promise<Response> {
    const port = await RunningApi.listening(held, publish, Keys.minted())

    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('SpecReslicingRoute', () => {
  it('a press carrying the gate key answers the pull request the correction travels in', async () => {
    const publish = PublishReslicingSpy.publishing()

    const response = await RunningApi.press(Mother.live(), publish, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'published', pullRequest: Mother.PULL_REQUEST })
    expect(publish.asked).toEqual([new PublishReslicingParams({
      root: Mother.ROOT, repository: Mother.REPOSITORY,
    })])
  })

  it('a failed closure keeps the matching spec reslicing action eligible', async () => {
    const publish = PublishReslicingSpy.publishing()

    const response = await RunningApi.press(
      Mother.failedClose(), publish, { [GateKey.HEADER]: Keys.MINTED }
    )

    expect(response.status).toBe(200)
    expect(publish.asked).toEqual([new PublishReslicingParams({
      root: Mother.ROOT, repository: Mother.REPOSITORY,
    })])
  })

  it('a press without the gate key is refused and the use case is never asked', async () => {
    const publish = PublishReslicingSpy.neverAsked()

    const response = await RunningApi.press(
      Mother.live(), publish, { [GateKey.HEADER]: Keys.FROM_ANOTHER_RUN }
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: SpecReslicingOutcome.NOT_FROM_THE_PAGE,
      detail: 'gate 2 answers only a request carrying the key the page was given',
    })
    expect(publish.asked).toEqual([])
  })

  it.each([
    ['missing', null],
    ['malformed', 'not-a-uuid'],
    ['stale', Mother.OLD_TARGET],
  ])('a press with a %s coordinating target is refused before publication', async (_kind, target) => {
    const publish = PublishReslicingSpy.neverAsked()

    const response = await RunningApi.press(
      Mother.live(), publish, { [GateKey.HEADER]: Keys.MINTED }, target
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: CoordinatingSessionTarget.CHANGED,
      detail: 'the coordinating session target changed: refresh before acting',
    })
    expect(publish.asked).toEqual([])
  })

  it('a press with no coordinating session held is refused before the use case is asked', async () => {
    const publish = PublishReslicingSpy.neverAsked()

    const response = await RunningApi.press(Mother.registry(), publish, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: CoordinatingSessionTarget.CHANGED,
      detail: 'the coordinating session target changed: refresh before acting',
    })
    expect(publish.asked).toEqual([])
  })

  it('a second press while one is in flight is refused as reslicing-in-progress', async () => {
    const { publish, started, finish } = APublicationYouFinishByHand.inFlight()
    const port = await RunningApi.listening(Mother.live(), publish, Keys.minted())

    const first = RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })
    await started
    const second = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })
    finish()

    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({
      code: SpecReslicingOutcome.IN_PROGRESS,
      detail: 'a publication of this slicing is under way: wait for it to answer before pressing again',
    })
    expect((await first).status).toBe(200)
    expect(publish.asked).toHaveLength(1)
  })

  it('a spec that is not frozen is refused with the reason gate 1 owns', async () => {
    const response = await RunningApi.press(
      Mother.live(), PublishReslicingSpy.refusing(ReslicingOutcome.NOT_FROZEN), { [GateKey.HEADER]: Keys.MINTED }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: SpecReslicingOutcome.SPEC_NOT_FROZEN,
      detail: 'the spec is not frozen: gate 1 first',
    })
  })

  it('a checkout with no execution spec is refused as no-epic-spec', async () => {
    const response = await RunningApi.press(
      Mother.live(), PublishReslicingSpy.refusing(ReslicingOutcome.NO_SPEC), { [GateKey.HEADER]: Keys.MINTED }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: SpecReslicingOutcome.NO_EPIC_SPEC,
      detail: 'no execution spec exists in this checkout to publish',
    })
  })

  it('a git that refused answers its own words and leaves the next press free', async () => {
    const publish = PublishReslicingSpy.collapsing()
    const port = await RunningApi.listening(Mother.live(), publish, Keys.minted())

    const refused = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })
    const again = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      code: 'epic-branch-not-published',
      detail: 'git push of milestone/2026-01-01-test-execution failed: no upstream',
    })
    expect((await again).status).toBe(400)
    expect(publish.asked).toHaveLength(2)
  })

  it('a get on the re-slicing door answers 405 naming the method it takes', async () => {
    const response = await RunningApi.getting(Mother.live(), PublishReslicingSpy.neverAsked())

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe(SpecReslicingRoute.METHODS)
  })
})
