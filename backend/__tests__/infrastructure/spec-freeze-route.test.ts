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
import { FreezeSpec, FreezeSpecParams, FreezeOutcome, SpecFrozen } from '../../src/application/actions/freeze-spec.ts'
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

class FreezeSpecSpy extends FreezeSpec {
  readonly asked: FreezeSpecParams[]
  readonly answer: (params: FreezeSpecParams) => Promise<SpecFrozen>

  constructor(answer: (params: FreezeSpecParams) => Promise<SpecFrozen>) {
    super({
      specs: new EpicSpecs(), branch: new EpicBranch(), pullRequests: new PullRequests(), now: () => new Date('2026-09-14T00:00:00Z'),
    })
    this.asked = []
    this.answer = answer
  }

  static answering(frozen: SpecFrozen): FreezeSpecSpy {
    return new FreezeSpecSpy(async () => frozen)
  }

  static neverAsked(): FreezeSpecSpy {
    return new FreezeSpecSpy(async () => { throw new Error('the freeze must not be asked') })
  }

  async execute(params: FreezeSpecParams): Promise<SpecFrozen> {
    this.asked.push(params)

    return this.answer(params)
  }
}

class Keys {
  static readonly RANDOM = (size: number): Buffer => Buffer.alloc(size, 7)
  static readonly MINTED = '07'.repeat(GateKey.BYTES)
  static readonly FROM_ANOTHER_RUN = '09'.repeat(GateKey.BYTES)

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

  static frozenOutcome(): SpecFrozen {
    return new SpecFrozen({
      outcome: FreezeOutcome.FROZEN,
      findings: [],
      on: '2026-09-14',
      pullRequest: Mother.PULL_REQUEST,
    })
  }

  static notFreezableOutcome(): SpecFrozen {
    return new SpecFrozen({
      outcome: FreezeOutcome.NOT_FREEZABLE,
      findings: [
        new FreezeFinding({
          code: FreezeFindingCode.CLARIFICATION_MARKER,
          line: 9,
          detail: '- [NEEDS CLARIFICATION: who signs the freeze?]',
        }),
        new FreezeFinding({ code: FreezeFindingCode.HYPOTHESIS_ABSENT, line: null, detail: null }),
      ],
      on: null,
      pullRequest: null,
    })
  }
}

class RunningApi {
  static readonly #started: Server[] = []
  static readonly PATH = SpecFreezeRoute.PATH

  static async listening(held: CoordinatingSessions, read: ReadSpecFreeze, freeze: FreezeSpec, key: GateKey): Promise<number> {
    const app = express()
    app.get(RunningApi.PATH, Browsers.turnAwayForeign, SpecFreezeRoute.reading(held, read, key))
    app.post(RunningApi.PATH, SpecFreezeRoute.freezing(held, freeze, key))
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

  static async posting(port: number, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${RunningApi.ownOrigin(port)}${RunningApi.PATH}`, { method: 'POST', headers })
  }

  static async get(held: CoordinatingSessions, read: ReadSpecFreeze, freeze: FreezeSpec, key: GateKey): Promise<Response> {
    const port = await RunningApi.listening(held, read, freeze, key)

    return RunningApi.fetching(port, { Origin: RunningApi.ownOrigin(port) })
  }

  static async other(held: CoordinatingSessions, read: ReadSpecFreeze, freeze: FreezeSpec, key: GateKey): Promise<Response> {
    const port = await RunningApi.listening(held, read, freeze, key)

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
    const freeze = FreezeSpecSpy.neverAsked()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, read, freeze, key)

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
    const freeze = FreezeSpecSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, freeze, key)

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
    const freeze = FreezeSpecSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, freeze, key)

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
    const freeze = FreezeSpecSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.get(held, read, freeze, key)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
    expect(read.asked).toEqual([])
  })

  it('another method is refused naming the allowed ones', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.neverAsked()
    const freeze = FreezeSpecSpy.neverAsked()
    const key = Keys.minted()

    const response = await RunningApi.other(held, read, freeze, key)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(read.asked).toEqual([])
  })

  it('a post with no gate key is refused as gate-not-from-the-page and the freeze is never asked', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.neverAsked()
    const freeze = FreezeSpecSpy.neverAsked()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, read, freeze, key)

    const response = await RunningApi.posting(port)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'gate-not-from-the-page',
      detail: 'gate 1 answers only a request carrying the key the page was given',
    })
    expect(freeze.asked).toEqual([])
  })

  it('a post carrying the key a get gave a request from the page freezes and answers its date and its pull request', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.answering(Mother.draftRead())
    const freeze = FreezeSpecSpy.answering(Mother.frozenOutcome())
    const key = Keys.minted()
    const port = await RunningApi.listening(held, read, freeze, key)

    const fromThePage = await RunningApi.fetching(port, { Origin: RunningApi.ownOrigin(port) })
    const { key: minted } = await fromThePage.json() as { key: string }

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: minted })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'frozen',
      on: '2026-09-14',
      pullRequest: Mother.PULL_REQUEST,
    })
  })

  it('a post carrying a key this run never minted is refused like one with none', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.neverAsked()
    const freeze = FreezeSpecSpy.neverAsked()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, read, freeze, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.FROM_ANOTHER_RUN })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'gate-not-from-the-page',
      detail: 'gate 1 answers only a request carrying the key the page was given',
    })
    expect(freeze.asked).toEqual([])
  })

  it('a refused freeze names the offending line in its detail', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.neverAsked()
    const freeze = FreezeSpecSpy.answering(Mother.notFreezableOutcome())
    const key = Keys.minted()
    const port = await RunningApi.listening(held, read, freeze, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'spec-not-freezable',
      detail: 'the spec is not freezable: 2 finding(s) remain, the first on line 9',
    })
  })

  it('a post with no coordinating session is refused without asking the freeze', async () => {
    const held = Mother.none()
    const read = ReadSpecFreezeSpy.neverAsked()
    const freeze = FreezeSpecSpy.neverAsked()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, read, freeze, key)

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'no-coordinating-session',
      detail: 'no coordinating session is held: there is nothing to freeze',
    })
    expect(freeze.asked).toEqual([])
  })
})
