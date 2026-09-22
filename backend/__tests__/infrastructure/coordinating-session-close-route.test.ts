import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RunningServers } from '../servers.ts'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { JsonBody } from '../../src/infrastructure/http.ts'
import {
  CloseCoordinatingSession,
  CloseCoordinatingSessionParams,
  CoordinatingSessionClosed,
} from '../../src/application/actions/close-coordinating-session.ts'
import {
  CoordinatingSessionOpened,
  OpenCoordinatingSession,
} from '../../src/application/actions/open-coordinating-session.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import {
  CoordinatingSessions,
  HeldCoordinatingSession,
  CoordinatingOperation,
  CoordinatingSessionState,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'
import {
  CoordinatingSessionTargetChanged,
  SessionClosureNotRecorded,
  SessionClosureNotUnderstood,
  SessionNotTerminated,
  SessionOwnershipUnverifiable,
  SessionTerminationPermissionDenied,
  SessionTerminationUnconfirmed,
} from '../../src/domain/exceptions.ts'

class Deferred<T> {
  readonly promise: Promise<T>
  #resolve: ((value: T) => void) | null = null

  constructor() {
    this.promise = new Promise((resolve) => { this.#resolve = resolve })
  }

  pass(value: T): void {
    this.#resolve!(value)
  }
}

class CloseSpy extends CloseCoordinatingSession {
  executed: CloseCoordinatingSessionParams[] = []
  acknowledged: CloseCoordinatingSessionParams[] = []
  executeAnswer: (params: CloseCoordinatingSessionParams) => Promise<CoordinatingSessionClosed>
  acknowledgeAnswer: (params: CloseCoordinatingSessionParams) => Promise<CoordinatingSessionClosed>

  constructor() {
    super({ records: new ConversationRecords(), liveSessions: new LiveSessions() })
    this.executeAnswer = async (params) => new CoordinatingSessionClosed(params)
    this.acknowledgeAnswer = async () => { throw new CoordinatingSessionTargetChanged('target changed') }
  }

  async execute(params: CloseCoordinatingSessionParams): Promise<CoordinatingSessionClosed> {
    this.executed.push(params)
    return this.executeAnswer(params)
  }

  async acknowledge(params: CloseCoordinatingSessionParams): Promise<CoordinatingSessionClosed> {
    this.acknowledged.push(params)
    return this.acknowledgeAnswer(params)
  }
}

class LiveSessionsDouble extends LiveSessions {
  find(id: string): LiveSession | null {
    return id === CloseMother.SESSION.id ? CloseMother.SESSION : null
  }

  watch(): LiveSessionStream {
    return { printed: '', stop: () => {} }
  }
}

class CloseMother {
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
  static readonly OTHER_TARGET = 'f910a470-13f7-4956-b750-bef89f55dd6d'
  static readonly CONVERSATION = new CoordinatingConversation({
    id: new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'),
    repository: new RepositoryName('josemerca/ct-loop-sandbox'),
    root: new CheckoutRoot('/repo'),
  })
  static readonly SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })
  static readonly BODY = JSON.stringify({ conversation: CloseMother.CONVERSATION.id.text, target: CloseMother.TARGET })

  static registry(target = CloseMother.TARGET): CoordinatingSessions {
    const registry = new CoordinatingSessions({ liveSessions: new LiveSessionsDouble(), stderr: () => {} })
    registry.remember(new HeldCoordinatingSession({
      target,
      state: CoordinatingSessionState.LIVE,
      conversation: CloseMother.CONVERSATION,
      session: CloseMother.SESSION,
      attention: SessionAttention.working(),
    }))
    return registry
  }

  static unresumable(): CoordinatingSessions {
    const registry = new CoordinatingSessions({ liveSessions: new LiveSessionsDouble(), stderr: () => {} })
    registry.remember(new HeldCoordinatingSession({
      target: CloseMother.TARGET,
      state: CoordinatingSessionState.UNRESUMABLE,
      conversation: CloseMother.CONVERSATION,
      session: null,
      attention: null,
    }))
    return registry
  }

  static none(): CoordinatingSessions {
    return new CoordinatingSessions({ liveSessions: new LiveSessionsDouble(), stderr: () => {} })
  }
}

class RunningCloseApi {
  static readonly #servers: ApiServer[] = []
  static readonly #NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')

  static async start(
    close: CloseCoordinatingSession,
    registry: CoordinatingSessions,
    openCoordinatingSession?: OpenCoordinatingSession,
  ): Promise<number> {
    const server = new ApiServer({
      port: 0,
      frontendRoot: RunningCloseApi.#NO_FRONTEND,
      closeCoordinatingSession: close,
      coordinatingSessions: registry,
      openCoordinatingSession,
    })
    return RunningServers.started(server)
  }

  static async stopAll(): Promise<void> {
    await RunningServers.stopAll()
  }

  static post(port: number, body = CloseMother.BODY, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/coordinating-session/close`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  }

  static open(port: number): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/coordinating-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_comment: 'new work after confirmed closure',
        repo: CloseMother.CONVERSATION.repository.text,
        path: CloseMother.CONVERSATION.root.text,
      }),
    })
  }
}

afterEach(async () => {
  await RunningCloseApi.stopAll()
})

describe('CoordinatingSessionCloseRoute', () => {
  it('acknowledges only the requested durably closed target', async () => {
    const close = new CloseSpy()
    const registry = CloseMother.registry()
    const completed = new Deferred<CoordinatingSessionClosed>()
    close.executeAnswer = (params) => completed.promise.then(() => new CoordinatingSessionClosed(params))
    const port = await RunningCloseApi.start(close, registry)

    const response = RunningCloseApi.post(port)
    await expect.poll(() => registry.operation()).toBe(CoordinatingOperation.CLOSING)
    expect(registry.held()?.target).toBe(CloseMother.TARGET)

    completed.pass(new CoordinatingSessionClosed(close.executed[0]))
    const answered = await response

    expect(answered.status).toBe(200)
    expect(await answered.json()).toEqual({
      status: 'closed',
      conversation: CloseMother.CONVERSATION.id.text,
      target: CloseMother.TARGET,
    })
    expect(close.executed).toHaveLength(1)
    expect(registry.held()).toBeNull()
    expect(registry.timeline()).toEqual([])
  })

  it('joins concurrent HTTP closes and executes the use case once', async () => {
    const close = new CloseSpy()
    const completed = new Deferred<CoordinatingSessionClosed>()
    close.executeAnswer = () => completed.promise
    const registry = CloseMother.registry()
    const beginClose = vi.spyOn(registry, 'beginClose')
    const port = await RunningCloseApi.start(close, registry)

    const first = RunningCloseApi.post(port)
    await expect.poll(() => close.executed).toHaveLength(1)
    const second = RunningCloseApi.post(port)
    let secondSettled = false
    second.then(() => { secondSettled = true })
    await expect.poll(() => beginClose.mock.calls).toHaveLength(2)
    expect(registry.operation()).toBe(CoordinatingOperation.CLOSING)
    expect(secondSettled).toBe(false)
    const opening = await RunningCloseApi.open(port)
    expect(opening.status).toBe(409)
    completed.pass(new CoordinatingSessionClosed(close.executed[0]))

    const answered = await Promise.all([first, second])
    expect(answered.map(({ status }) => status)).toEqual([200, 200])
    expect(close.executed).toHaveLength(1)
  })

  it('closes an unresumable target without inventing terminal ownership', async () => {
    const close = new CloseSpy()
    const registry = CloseMother.unresumable()
    const port = await RunningCloseApi.start(close, registry)

    const response = await RunningCloseApi.post(port)

    expect(response.status).toBe(200)
    expect(close.executed).toHaveLength(1)
    expect(close.executed[0].session).toBeNull()
    expect(registry.held()).toBeNull()
  })

  it('refuses malformed or foreign close requests without asking the use case', async () => {
    const malformed = [
      '', 'null', '[]', '{}',
      JSON.stringify({ conversation: CloseMother.CONVERSATION.id.text }),
      JSON.stringify({ conversation: CloseMother.CONVERSATION.id.text, target: 'not-a-uuid' }),
      JSON.stringify({ conversation: CloseMother.CONVERSATION.id.text, target: CloseMother.TARGET, extra: true }),
    ]
    for (const body of malformed) {
      const close = new CloseSpy()
      const port = await RunningCloseApi.start(close, CloseMother.registry())
      const response = await RunningCloseApi.post(port, body)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'malformed-session-close' })
      expect(close.executed).toEqual([])
      expect(close.acknowledged).toEqual([])
    }

    const foreignClose = new CloseSpy()
    const foreignPort = await RunningCloseApi.start(foreignClose, CloseMother.registry())
    const foreign = await RunningCloseApi.post(foreignPort, CloseMother.BODY, { Origin: 'https://foreign.example' })
    expect(foreign.status).toBe(403)
    expect(foreignClose.executed).toEqual([])

    const methodClose = new CloseSpy()
    const methodPort = await RunningCloseApi.start(methodClose, CloseMother.registry())
    const method = await fetch(`http://127.0.0.1:${methodPort}/coordinating-session/close`)
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('POST')
    expect(methodClose.executed).toEqual([])

    const mediaClose = new CloseSpy()
    const mediaPort = await RunningCloseApi.start(mediaClose, CloseMother.registry())
    const media = await fetch(`http://127.0.0.1:${mediaPort}/coordinating-session/close`, {
      method: 'POST', body: CloseMother.BODY,
    })
    expect(media.status).toBe(415)
    expect(await media.json()).toEqual({
      code: 'unsupported-media-type', detail: 'Content-Type must be application/json',
    })
    expect(mediaClose.executed).toEqual([])

    const largeClose = new CloseSpy()
    const largePort = await RunningCloseApi.start(largeClose, CloseMother.registry())
    const large = await RunningCloseApi.post(largePort, 'x'.repeat(JsonBody.MAX_BYTES + 1))
    expect(large.status).toBe(413)
    expect(await large.json()).toEqual({
      code: 'body-too-large', detail: `body must not exceed ${JsonBody.MAX_BYTES} bytes`,
    })
    expect(largeClose.executed).toEqual([])
  })

  it('a late close request cannot close a replacement target', async () => {
    const close = new CloseSpy()
    const replacement = CloseMother.registry(CloseMother.OTHER_TARGET)
    const port = await RunningCloseApi.start(close, replacement)

    const stale = await RunningCloseApi.post(port)

    expect(stale.status).toBe(400)
    expect(await stale.json()).toEqual({ code: 'coordinating-session-target-changed', detail: 'target changed' })
    expect(close.executed).toEqual([])
    expect(close.acknowledged).toHaveLength(1)
    expect(replacement.held()?.target).toBe(CloseMother.OTHER_TARGET)

    close.acknowledgeAnswer = async (params) => new CoordinatingSessionClosed(params)
    const repeated = await RunningCloseApi.post(port)
    expect(repeated.status).toBe(200)
    expect(replacement.held()?.target).toBe(CloseMother.OTHER_TARGET)
  })

  it('absent and different-conversation targets are refused without close authority', async () => {
    const absentClose = new CloseSpy()
    const absentPort = await RunningCloseApi.start(absentClose, CloseMother.none())

    const absent = await RunningCloseApi.post(absentPort)

    expect(absent.status).toBe(400)
    expect(await absent.json()).toMatchObject({ code: 'coordinating-session-target-changed' })
    expect(absentClose.executed).toEqual([])
    expect(absentClose.acknowledged).toHaveLength(1)

    const otherClose = new CloseSpy()
    const registry = CloseMother.registry()
    const otherPort = await RunningCloseApi.start(otherClose, registry)
    const otherConversation = 'b596b567-dfc7-46ec-9777-55d1664e9f46'
    const different = await RunningCloseApi.post(otherPort, JSON.stringify({
      conversation: otherConversation, target: CloseMother.TARGET,
    }))

    expect(different.status).toBe(400)
    expect(await different.json()).toMatchObject({ code: 'coordinating-session-target-changed' })
    expect(otherClose.executed).toEqual([])
    expect(otherClose.acknowledged).toHaveLength(1)
    expect(registry.held()?.target).toBe(CloseMother.TARGET)
  })

  it('the close API can recover a failed null-terminal target and then admit a new plan', async () => {
    const failures = [
      [new SessionClosureNotRecorded('intent not written'), 'session-closure-not-recorded'],
      [new SessionClosureNotUnderstood('receipt corrupt'), 'session-closure-not-understood'],
      [new SessionNotTerminated('group still alive'), 'session-not-terminated'],
      [new SessionTerminationUnconfirmed('group ownership lost'), 'session-termination-unconfirmed'],
      [new SessionOwnershipUnverifiable('original identity missing'), 'session-ownership-unverifiable'],
      [new SessionTerminationPermissionDenied('permission denied'), 'session-termination-permission-denied'],
    ] as const

    for (const [failure, code] of failures) {
      const close = new CloseSpy()
      close.executeAnswer = async () => { throw failure }
      const registry = CloseMother.registry()
      const port = await RunningCloseApi.start(close, registry)

      const refused = await RunningCloseApi.post(port)

      expect(refused.status).toBe(400)
      expect(await refused.json()).toEqual({ code, detail: failure.message })
      expect(registry.operation()).toBe(CoordinatingOperation.CLOSE_FAILED)
      expect(registry.held()?.target).toBe(CloseMother.TARGET)

      const retained = await fetch(`http://127.0.0.1:${port}/coordinating-session`)
      expect(await retained.json()).toMatchObject({
        status: 'live',
        operation: 'close-failed',
        target: CloseMother.TARGET,
        closureError: { code, detail: failure.message },
      })
      const opening = await fetch(`http://127.0.0.1:${port}/coordinating-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_comment: 'replacement must wait',
          repo: CloseMother.CONVERSATION.repository.text,
          path: CloseMother.CONVERSATION.root.text,
        }),
      })
      expect(opening.status).toBe(409)
      expect(registry.operation()).toBe(CoordinatingOperation.CLOSE_FAILED)

      close.executeAnswer = async (params) => new CoordinatingSessionClosed(params)
      const retried = await RunningCloseApi.post(port)
      expect(retried.status).toBe(200)
      expect(registry.held()).toBeNull()
    }

    const recoveredClose = new CloseSpy()
    recoveredClose.executeAnswer = async () => { throw new SessionOwnershipUnverifiable('saved identity incomplete') }
    const recovered = CloseMother.unresumable()
    const open = {
      execute: vi.fn(async () => new CoordinatingSessionOpened({
        conversation: CloseMother.CONVERSATION,
        session: CloseMother.SESSION,
        timeline: [],
      })),
    } as unknown as OpenCoordinatingSession
    const recoveredPort = await RunningCloseApi.start(recoveredClose, recovered, open)
    const first = await RunningCloseApi.post(recoveredPort)
    expect(first.status).toBe(400)
    expect(await first.json()).toEqual({
      code: 'session-ownership-unverifiable', detail: 'saved identity incomplete',
    })
    expect(recoveredClose.executed[0].session).toBeNull()
    expect(recovered.reserve().outcome).toBe('live-held')

    recoveredClose.executeAnswer = async (params) => new CoordinatingSessionClosed(params)
    const retried = await RunningCloseApi.post(recoveredPort)
    expect(retried.status).toBe(200)
    expect(recovered.held()).toBeNull()
    const admitted = await RunningCloseApi.open(recoveredPort)
    expect(admitted.status).toBe(202)
    expect(open.execute).toHaveBeenCalledTimes(1)
  })
})
