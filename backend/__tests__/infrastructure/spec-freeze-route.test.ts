import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { Browsers } from '../../src/infrastructure/http.ts'
import { SpecFreezeRoute } from '../../src/infrastructure/spec-freeze-route.ts'
import { GateKey } from '../../src/infrastructure/gate-key.ts'
import {
  ReadSpecFreeze, ReadSpecFreezeParams, SpecFreezeRead, SpecFreezeState,
} from '../../src/application/queries/read-spec-freeze.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { FreezeFinding, FreezeFindingCode } from '../../src/domain/value-objects/freeze-finding.ts'

class ReadSpecFreezeSpy extends ReadSpecFreeze {
  readonly asked: ReadSpecFreezeParams[]
  readonly answer: (params: ReadSpecFreezeParams) => Promise<SpecFreezeRead>

  constructor(answer: (params: ReadSpecFreezeParams) => Promise<SpecFreezeRead>) {
    super({ specs: new EpicSpecs(), branch: new EpicBranch(), pullRequests: new PullRequests() })
    this.asked = []
    this.answer = answer
  }

  static answering(read: SpecFreezeRead): ReadSpecFreezeSpy {
    return new ReadSpecFreezeSpy(async () => read)
  }

  static neverAsked(): ReadSpecFreezeSpy {
    return new ReadSpecFreezeSpy(async () => { throw new Error('the read must not be asked') })
  }

  async execute(params: ReadSpecFreezeParams): Promise<SpecFreezeRead> {
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

class Mother {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly CONVERSATION = new CoordinatingConversation({
    id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    repository: Mother.REPOSITORY,
    root: Mother.ROOT,
  })

  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })
  static readonly SPEC_PATH = 'docs/superpowers/specs/2026-09-14-issue-329-test-execution.md'
  static readonly PULL_REQUEST = { number: 12, url: 'https://github.com/josemerca/ct-loop-sandbox/pull/12' }

  static live(): CoordinatingSessions {
    const held = new CoordinatingSessions({ stderr: (): void => {} })
    held.remember(new HeldCoordinatingSession({
      state: CoordinatingSessionState.LIVE,
      conversation: Mother.CONVERSATION,
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    }))

    return held
  }

  static none(): CoordinatingSessions {
    return new CoordinatingSessions({ stderr: (): void => {} })
  }

  static spec(): EpicSpec {
    return new EpicSpec({ path: Mother.SPEC_PATH, text: '# Test epic — Execution spec\n' })
  }

  static draftRead(): SpecFreezeRead {
    return new SpecFreezeRead({
      state: SpecFreezeState.DRAFT,
      spec: Mother.spec(),
      findings: [
        new FreezeFinding({
          code: FreezeFindingCode.CLARIFICATION_MARKER,
          line: 9,
          detail: '- [NEEDS CLARIFICATION: who signs the freeze?]',
        }),
      ],
      frozenOn: null,
      pullRequest: null,
    })
  }

  static draftReadWithSeveralFindings(): SpecFreezeRead {
    return new SpecFreezeRead({
      state: SpecFreezeState.DRAFT,
      spec: Mother.spec(),
      findings: [
        new FreezeFinding({
          code: FreezeFindingCode.CLARIFICATION_MARKER,
          line: 9,
          detail: '- [NEEDS CLARIFICATION: who signs the freeze?]',
        }),
        new FreezeFinding({ code: FreezeFindingCode.HYPOTHESIS_ABSENT, line: null, detail: null }),
      ],
      frozenOn: null,
      pullRequest: null,
    })
  }

  static frozenRead(): SpecFreezeRead {
    return new SpecFreezeRead({
      state: SpecFreezeState.FROZEN,
      spec: Mother.spec(),
      findings: [],
      frozenOn: '2026-09-14',
      pullRequest: Mother.PULL_REQUEST,
    })
  }
}

class RunningApi {
  static readonly #started: Server[] = []
  static readonly PATH = SpecFreezeRoute.PATH

  static async listening(held: CoordinatingSessions, read: ReadSpecFreeze, key: GateKey): Promise<number> {
    const app = express()
    app.get(RunningApi.PATH, Browsers.turnAwayForeign, SpecFreezeRoute.reading(held, read, key))
    app.all(RunningApi.PATH, SpecFreezeRoute.refuseOtherMethods)
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

  static async get(held: CoordinatingSessions, read: ReadSpecFreeze, key: GateKey): Promise<Response> {
    const port = await RunningApi.listening(held, read, key)

    return RunningApi.fetching(port, { Origin: RunningApi.ownOrigin(port) })
  }

  static async other(held: CoordinatingSessions, read: ReadSpecFreeze, key: GateKey): Promise<Response> {
    const port = await RunningApi.listening(held, read, key)

    return fetch(`${RunningApi.ownOrigin(port)}${RunningApi.PATH}`, { method: 'DELETE' })
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('SpecFreezeRoute', () => {
  it('the read hands the gate key only to a request carrying the page own origin', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.answering(Mother.draftRead())
    const key = Keys.minted()
    const port = await RunningApi.listening(held, read, key)

    const fromThePage = await RunningApi.fetching(port, { Origin: RunningApi.ownOrigin(port) })
    const fromElsewhere = await RunningApi.fetching(port)

    expect(fromThePage.status).toBe(200)
    expect(await fromThePage.json()).toEqual({
      status: 'draft',
      spec: Mother.SPEC_PATH,
      findings: [
        { code: 'clarification-marker', line: 9, detail: '- [NEEDS CLARIFICATION: who signs the freeze?]' },
      ],
      key: Keys.MINTED,
    })

    expect(fromElsewhere.status).toBe(200)
    expect(await fromElsewhere.json()).toEqual({
      status: 'draft',
      spec: Mother.SPEC_PATH,
      findings: [
        { code: 'clarification-marker', line: 9, detail: '- [NEEDS CLARIFICATION: who signs the freeze?]' },
      ],
    })
  })

  it('a draft answers each finding with the line and the raw text the module gave', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.answering(Mother.draftReadWithSeveralFindings())
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'draft',
      spec: Mother.SPEC_PATH,
      findings: [
        { code: 'clarification-marker', line: 9, detail: '- [NEEDS CLARIFICATION: who signs the freeze?]' },
        { code: 'hypothesis-absent', line: null, detail: null },
      ],
      key: Keys.MINTED,
    })
  })

  it('a frozen spec answers its date and its pull request', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.answering(Mother.frozenRead())
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'frozen',
      spec: Mother.SPEC_PATH,
      on: '2026-09-14',
      pullRequest: Mother.PULL_REQUEST,
    })
  })

  it('with no coordinating session it answers none without asking the read', async () => {
    const held = Mother.none()
    const read = ReadSpecFreezeSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
    expect(read.asked).toEqual([])
  })

  it('another method is refused naming the allowed ones', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.other(held, read, key)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(read.asked).toEqual([])
  })
})
