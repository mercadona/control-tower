import { describe, expect, it } from 'vitest'
import {
  CloseCoordinatingSession,
  CloseCoordinatingSessionParams,
} from '../../src/application/actions/close-coordinating-session.ts'
import { ConversationRecords } from '../../src/domain/ports/conversation-records.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { ClosureStatus, SessionClosure } from '../../src/domain/value-objects/session-closure.ts'
import { SessionTerminationUnconfirmed } from '../../src/domain/exceptions.ts'

class Deferred {
  readonly promise: Promise<void>
  #resolve: (() => void) | null = null
  #reject: ((failure: Error) => void) | null = null

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
  }

  pass(): void {
    this.#resolve!()
  }

  fail(failure: Error): void {
    this.#reject!(failure)
  }
}

class RecordsDouble extends ConversationRecords {
  recalled: SessionClosure | null
  requested: SessionClosure[] = []
  completed: SessionClosure[] = []
  requestCut: Deferred | null = null
  completeCut: Deferred | null = null

  constructor(recalled: SessionClosure | null = null) {
    super()
    this.recalled = recalled
  }

  async recallClosure(): Promise<SessionClosure | null> {
    return this.recalled
  }

  async requestClosure(closure: SessionClosure): Promise<void> {
    this.requested.push(closure)
    if (this.requestCut !== null) await this.requestCut.promise
    this.recalled = closure
  }

  async completeClosure(closure: SessionClosure): Promise<void> {
    this.completed.push(closure)
    if (this.completeCut !== null) await this.completeCut.promise
    this.recalled = closure
  }
}

class LiveSessionsDouble extends LiveSessions {
  readonly evidence: SessionClosure
  terminated: SessionClosure[] = []
  confirmed: SessionClosure[] = []
  terminateCut: Deferred | null = null
  terminateFailure: Error | null = null
  confirmationFailure: Error | null = null

  constructor(evidence: SessionClosure) {
    super()
    this.evidence = evidence
  }

  terminationEvidence(): SessionClosure {
    return this.evidence
  }

  async terminate(closure: SessionClosure): Promise<void> {
    this.terminated.push(closure)
    if (this.terminateCut !== null) await this.terminateCut.promise
    if (this.terminateFailure !== null) throw this.terminateFailure
  }

  async confirmTermination(closure: SessionClosure): Promise<void> {
    this.confirmed.push(closure)
    if (this.confirmationFailure !== null) throw this.confirmationFailure
  }
}

class ClosureMother {
  static readonly CONVERSATION = new ConversationId('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
  static readonly TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
  static readonly OTHER_TARGET = 'f910a470-13f7-4956-b750-bef89f55dd6d'
  static readonly SESSION = new LiveSession({ id: 'terminal-1', name: 'brainstorming' })

  static requested({ session = ClosureMother.SESSION.id, processGroup = 4102 }: {
    session?: string | null, processGroup?: number | null,
  } = {}): SessionClosure {
    return new SessionClosure({
      conversation: ClosureMother.CONVERSATION,
      target: ClosureMother.TARGET,
      session,
      processGroup,
      status: ClosureStatus.REQUESTED,
    })
  }

  static closed(target = ClosureMother.TARGET): SessionClosure {
    return new SessionClosure({
      conversation: ClosureMother.CONVERSATION,
      target,
      session: ClosureMother.SESSION.id,
      processGroup: 4102,
      status: ClosureStatus.CLOSED,
    })
  }

  static params(session: LiveSession | null = ClosureMother.SESSION): CloseCoordinatingSessionParams {
    return new CloseCoordinatingSessionParams({
      conversation: ClosureMother.CONVERSATION,
      target: ClosureMother.TARGET,
      session,
    })
  }
}

class Flow {
  readonly records: RecordsDouble
  readonly liveSessions: LiveSessionsDouble

  constructor({ recalled = null, evidence = ClosureMother.requested() }: {
    recalled?: SessionClosure | null, evidence?: SessionClosure,
  } = {}) {
    this.records = new RecordsDouble(recalled)
    this.liveSessions = new LiveSessionsDouble(evidence)
  }

  close(params = ClosureMother.params()) {
    return new CloseCoordinatingSession({ records: this.records, liveSessions: this.liveSessions }).execute(params)
  }
}

describe('CloseCoordinatingSession', () => {
  it('records cancellation intent before terminating and acknowledges only durable confirmed closure', async () => {
    const flow = new Flow()
    flow.records.requestCut = new Deferred()
    flow.liveSessions.terminateCut = new Deferred()
    flow.records.completeCut = new Deferred()

    const closing = flow.close()
    await Promise.resolve()
    expect(flow.liveSessions.terminated).toEqual([])

    flow.records.requestCut.pass()
    await expect.poll(() => flow.liveSessions.terminated).toEqual([ClosureMother.requested()])
    expect(flow.records.completed).toEqual([])

    flow.liveSessions.terminateCut.pass()
    await expect.poll(() => flow.records.completed).toEqual([ClosureMother.closed()])

    let settled = false
    closing.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    flow.records.completeCut.pass()
    await expect(closing).resolves.toEqual({
      conversation: ClosureMother.CONVERSATION,
      target: ClosureMother.TARGET,
    })

    const ended = new Flow({ evidence: ClosureMother.requested({ session: null, processGroup: null }) })
    await expect(ended.close(ClosureMother.params(null))).resolves.toEqual({
      conversation: ClosureMother.CONVERSATION,
      target: ClosureMother.TARGET,
    })
    expect(ended.liveSessions.terminated).toEqual([ClosureMother.requested({ session: null, processGroup: null })])
  })

  it('retains retryable closure when intent termination or completion fails', async () => {
    const intent = new Flow()
    intent.records.requestCut = new Deferred()
    const intentClose = intent.close()
    intent.records.requestCut.fail(new Error('intent refused'))
    await expect(intentClose).rejects.toThrow('intent refused')
    expect(intent.liveSessions.terminated).toEqual([])

    const termination = new Flow()
    termination.liveSessions.terminateFailure = new Error('still alive')
    await expect(termination.close()).rejects.toThrow('still alive')
    expect(termination.records.recalled).toEqual(ClosureMother.requested())
    expect(termination.records.completed).toEqual([])

    const completion = new Flow()
    completion.records.completeCut = new Deferred()
    const first = completion.close()
    completion.records.completeCut.fail(new Error('completion refused'))
    await expect(first).rejects.toThrow('completion refused')
    expect(completion.records.recalled).toEqual(ClosureMother.requested())

    completion.records.completeCut = null
    await expect(completion.close()).resolves.toEqual({
      conversation: ClosureMother.CONVERSATION,
      target: ClosureMother.TARGET,
    })
    expect(completion.liveSessions.terminated).toHaveLength(1)
    expect(completion.liveSessions.confirmed).toEqual([ClosureMother.requested()])
    expect(completion.records.completed).toHaveLength(2)

    const retryableTermination = new Flow({ recalled: ClosureMother.requested() })
    retryableTermination.liveSessions.confirmationFailure = new SessionTerminationUnconfirmed('still present')
    await expect(retryableTermination.close()).resolves.toEqual({
      conversation: ClosureMother.CONVERSATION,
      target: ClosureMother.TARGET,
    })
    expect(retryableTermination.liveSessions.terminated).toEqual([ClosureMother.requested()])
  })

  it('retries the same closed identity without changing another conversation', async () => {
    const closed = new Flow({ recalled: ClosureMother.closed() })

    await expect(closed.close()).resolves.toEqual({
      conversation: ClosureMother.CONVERSATION,
      target: ClosureMother.TARGET,
    })
    expect(closed.liveSessions.terminated).toEqual([])
    expect(closed.records.requested).toEqual([])
    expect(closed.records.completed).toEqual([])

    const mismatched = new Flow({ recalled: ClosureMother.closed(ClosureMother.OTHER_TARGET) })
    await expect(mismatched.close()).rejects.toThrow(ClosureMother.OTHER_TARGET)
    expect(mismatched.liveSessions.terminated).toEqual([])
    expect(mismatched.records.requested).toEqual([])
    expect(mismatched.records.completed).toEqual([])
  })
})
