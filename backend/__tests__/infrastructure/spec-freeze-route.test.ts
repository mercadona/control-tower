import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { Browsers } from '../../src/infrastructure/http.ts'
import { SpecFreezeRoute } from '../../src/infrastructure/spec-freeze-route.ts'
import { GateKey } from '../../src/infrastructure/gate-key.ts'
import { CoordinatingSessionTarget } from '../../src/infrastructure/coordinating-session-target.ts'
import { WorkInFlight } from '../../src/infrastructure/work-in-flight.ts'
import { EpicSpecNotUnderstood } from '../../src/domain/exceptions.ts'
import {
  ReadSpecFreeze, ReadSpecFreezeParams, SpecFreezeRead, SpecFreezeState,
} from '../../src/application/queries/read-spec-freeze.ts'
import { FreezeSpec, FreezeSpecParams, FreezeOutcome, SpecFrozen } from '../../src/application/actions/freeze-spec.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { EpicBranch } from '../../src/domain/ports/epic-branch.ts'
import { PullRequests } from '../../src/domain/ports/pull-requests.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingOperation, CoordinatingSessionState,
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
  static refusing(cause: Error): ReadSpecFreezeSpy {
    const refusing = new ReadSpecFreezeSpy(async () => { throw cause })
    return refusing
  }

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

  static hanging(): ReadSpecFreezeSpy {
    let announce: () => void = () => undefined
    let answer: (read: SpecFreezeRead) => void = () => undefined
    const hanging = new ReadSpecFreezeSpy(async () => {
      announce()
      return await new Promise<SpecFreezeRead>((resolve) => { answer = resolve })
    })
    hanging.started = new Promise<void>((resolve) => { announce = resolve })
    hanging.answerTheHangingOne = (): void => answer(Mother.draftRead())

    return hanging
  }

  started: Promise<void> = Promise.resolve()
  answerTheHangingOne: () => void = () => undefined

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

  static refusing(cause: Error): FreezeSpecSpy {
    return new FreezeSpecSpy(async () => { throw cause })
  }

  static hanging(): FreezeSpecSpy {
    let announce: () => void = () => undefined
    let answer: (frozen: SpecFrozen) => void = () => undefined
    const pending = new Promise<SpecFrozen>((resolve) => { answer = resolve })
    const hanging = new FreezeSpecSpy(async () => {
      announce()
      return await pending
    })
    hanging.started = new Promise<void>((resolve) => { announce = resolve })
    hanging.answerTheHangingOne = (): void => answer(Mother.frozenOutcome())

    return hanging
  }

  answerTheHangingOne: () => void = () => undefined
  started: Promise<void> = Promise.resolve()

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
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
  static readonly OLD_TARGET = 'f135ce89-e980-4fa3-a02d-44dd12228304'
  static readonly NEXT_TARGET = '69d8d78f-1f6f-47db-98c5-3a13b1710691'
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
    const held = new CoordinatingSessions({
      liveSessions: new LiveSessionsDouble(Mother.SESSION), stderr: (): void => {},
    })
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
    return new CoordinatingSessions({
      liveSessions: new LiveSessionsDouble(Mother.SESSION), stderr: (): void => {},
    })
  }

  static replacement(): HeldCoordinatingSession {
    return new HeldCoordinatingSession({
      target: Mother.NEXT_TARGET,
      state: CoordinatingSessionState.LIVE,
      conversation: new CoordinatingConversation({
        id: new ConversationId('b596b567-dfc7-46ec-9777-55d1664e9f46'),
        repository: Mother.REPOSITORY,
        root: new CheckoutRoot('/replacement'),
      }),
      session: Mother.SESSION,
      attention: SessionAttention.working(),
    })
  }

  static occupied(operation: 'opening' | 'recovering' | 'closing' | 'close-failed'): CoordinatingSessions {
    const held = operation === CoordinatingOperation.OPENING || operation === CoordinatingOperation.RECOVERING
      ? Mother.none()
      : Mother.live()
    if (operation === CoordinatingOperation.OPENING) held.reserve()
    if (operation === CoordinatingOperation.RECOVERING) held.beginRecovery()
    if (operation === CoordinatingOperation.CLOSING || operation === CoordinatingOperation.CLOSE_FAILED) {
      const identity = { conversation: Mother.CONVERSATION.id.text, target: Mother.TARGET }
      held.beginClose(identity)
      if (operation === CoordinatingOperation.CLOSE_FAILED) {
        held.failClose(identity, { code: 'session-not-terminated', detail: 'the process group remains alive' })
      }
    }

    return held
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
    app.post(RunningApi.PATH, SpecFreezeRoute.freezing(held, freeze, key, new WorkInFlight()))
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

  static async posting(
    port: number, headers: Record<string, string> = {}, target: string | null = Mother.TARGET
  ): Promise<Response> {
    return fetch(`${RunningApi.ownOrigin(port)}${RunningApi.PATH}`, {
      method: 'POST',
      headers: { ...(target === null ? {} : { [CoordinatingSessionTarget.HEADER]: target }), ...headers },
    })
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
  it('the read hands the gate key to the browser on this origin, which sends no Origin on a GET, and not to a bare curl', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.answering(Mother.draftRead())
    const freeze = FreezeSpecSpy.neverAsked()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, read, freeze, key)

    const fromThePage = await RunningApi.fetching(port, { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' })
    const fromElsewhere = await RunningApi.fetching(port)

    expect(fromThePage.status).toBe(200)
    expect(await fromThePage.json()).toEqual({
      status: 'draft',
      target: Mother.TARGET,
      spec: Mother.SPEC_PATH,
      findings: [
        { code: 'clarification-marker', line: 9, detail: '- [NEEDS CLARIFICATION: who signs the freeze?]' },
      ],
      key: Keys.MINTED,
    })

    expect(fromElsewhere.status).toBe(200)
    expect(await fromElsewhere.json()).toEqual({
      status: 'draft',
      target: Mother.TARGET,
      spec: Mother.SPEC_PATH,
      findings: [
        { code: 'clarification-marker', line: 9, detail: '- [NEEDS CLARIFICATION: who signs the freeze?]' },
      ],
    })
  })

  it('a second press while the first is in flight is refused and the freeze runs once', async () => {
    const held = Mother.live()
    const freeze = FreezeSpecSpy.hanging()
    const key = Keys.minted()
    const port = await RunningApi.listening(held, ReadSpecFreezeSpy.answering(Mother.draftRead()), freeze, key)

    const first = RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })
    await freeze.started
    const second = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({
      code: 'freeze-in-progress',
      detail: 'a freeze of this checkout is under way: wait for it to answer before pressing again',
    })
    expect(freeze.asked).toHaveLength(1)
    freeze.answerTheHangingOne()
    await first
    expect(freeze.asked).toHaveLength(1)
  })

  it.each([
    CoordinatingOperation.OPENING,
    CoordinatingOperation.RECOVERING,
    CoordinatingOperation.CLOSING,
  ])('a gate mutation is refused while the coordinating session is %s', async (operation) => {
    const freeze = FreezeSpecSpy.neverAsked()
    const port = await RunningApi.listening(
      Mother.occupied(operation), ReadSpecFreezeSpy.neverAsked(), freeze, Keys.minted()
    )

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: CoordinatingSessionTarget.BUSY,
      detail: `the coordinating session is ${operation}: wait for it to settle before acting`,
    })
    expect(freeze.asked).toEqual([])
  })

  it('failed closure preserves current-work gate eligibility without opening another session', async () => {
    const held = Mother.occupied(CoordinatingOperation.CLOSE_FAILED)
    const freeze = FreezeSpecSpy.answering(Mother.frozenOutcome())
    const port = await RunningApi.listening(held, ReadSpecFreezeSpy.neverAsked(), freeze, Keys.minted())

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(response.status).toBe(200)
    expect(freeze.asked).toHaveLength(1)
    expect(freeze.asked[0].root).toEqual(Mother.ROOT)
    expect(held.reserve().outcome).toBe('live-held')

    const stale = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED }, Mother.NEXT_TARGET)
    expect(stale.status).toBe(400)
    expect(freeze.asked).toHaveLength(1)
  })

  it('a delayed read cannot issue gate authority after its coordinating target is replaced', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.hanging()
    const port = await RunningApi.listening(held, read, FreezeSpecSpy.neverAsked(), Keys.minted())

    const pending = RunningApi.fetching(port, { Origin: RunningApi.ownOrigin(port) })
    await read.started
    held.remember(Mother.replacement())
    read.answerTheHangingOne()
    const response = await pending

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
  })

  it('an admitted freeze finishes against its captured checkout after the target is replaced', async () => {
    const held = Mother.live()
    const freeze = FreezeSpecSpy.hanging()
    const port = await RunningApi.listening(
      held, ReadSpecFreezeSpy.neverAsked(), freeze, Keys.minted()
    )

    const pending = RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })
    await freeze.started
    held.remember(Mother.replacement())
    freeze.answerTheHangingOne()
    const response = await pending

    expect(response.status).toBe(200)
    expect(freeze.asked).toEqual([new FreezeSpecParams({
      root: Mother.ROOT, repository: Mother.REPOSITORY,
    })])
    expect(held.held()?.target).toBe(Mother.NEXT_TARGET)
  })

  it('a freeze that failed frees the next press instead of locking the checkout for ever', async () => {
    const held = Mother.live()
    const freeze = FreezeSpecSpy.refusing(new EpicSpecNotUnderstood('the spec carries no title'))
    const port = await RunningApi.listening(held, ReadSpecFreezeSpy.answering(Mother.draftRead()), freeze, Keys.minted())

    const refused = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })
    const again = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED })

    expect(refused.status).toBe(400)
    expect(again.status).toBe(400)
    expect(await again.json()).toEqual({ code: 'epic-spec-not-understood', detail: 'the spec carries no title' })
    expect(freeze.asked).toHaveLength(2)
  })

  it('a tool that refuses under the read answers its own code instead of a generic failure', async () => {
    const held = Mother.live()
    const read = ReadSpecFreezeSpy.refusing(new EpicSpecNotUnderstood('the spec carries no title'))
    const freeze = FreezeSpecSpy.neverAsked()
    const port = await RunningApi.listening(held, read, freeze, Keys.minted())

    const answered = await RunningApi.fetching(port)

    expect(answered.status).toBe(400)
    expect(await answered.json()).toEqual({
      code: 'epic-spec-not-understood',
      detail: 'the spec carries no title',
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
      target: Mother.TARGET,
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
      target: Mother.TARGET,
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

  it.each([
    ['missing', null],
    ['malformed', 'not-a-uuid'],
    ['stale', Mother.OLD_TARGET],
  ])('a post with a %s coordinating target is refused before freezing', async (_kind, target) => {
    const freeze = FreezeSpecSpy.neverAsked()
    const port = await RunningApi.listening(
      Mother.live(), ReadSpecFreezeSpy.neverAsked(), freeze, Keys.minted()
    )

    const response = await RunningApi.posting(port, { [GateKey.HEADER]: Keys.MINTED }, target)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: CoordinatingSessionTarget.CHANGED,
      detail: 'the coordinating session target changed: refresh before acting',
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
      code: CoordinatingSessionTarget.CHANGED,
      detail: 'the coordinating session target changed: refresh before acting',
    })
    expect(freeze.asked).toEqual([])
  })
})
