import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { Loopback, RunningServers } from '../servers.ts'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { ListLiveSessions, ListLiveSessionsResult } from '../../src/application/queries/list-live-sessions.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'

class ListLiveSessionsSpy extends ListLiveSessions {
  asked: number
  readonly sessions: readonly LiveSession[]

  constructor(sessions: readonly LiveSession[]) {
    super({ liveSessions: new LiveSessions() })
    this.asked = 0
    this.sessions = sessions
  }

  static answeringTwoSessions(): ListLiveSessionsSpy {
    return new ListLiveSessionsSpy([
      new LiveSession({ id: 'session-1', name: 'zsh' }),
      new LiveSession({ id: 'session-2', name: 'claude' }),
    ])
  }

  static answeringNoSessions(): ListLiveSessionsSpy {
    return new ListLiveSessionsSpy([])
  }

  execute(): ListLiveSessionsResult {
    this.asked += 1

    return new ListLiveSessionsResult({ sessions: this.sessions })
  }
}

type Answered = { response: Response, spy: ListLiveSessionsSpy }

class RunningApi {
  static readonly PATH = '/sessions'

  static async listening(spy: ListLiveSessionsSpy): Promise<number> {
    const server = new ApiServer({
      port: 0,
      externalTools: undefined,
      listLiveSessions: spy,
      activePlans: undefined,
      stderr: undefined,
      frontendRoot: Loopback.FRONTEND_NEVER_BUILT,
    })
    return RunningServers.started(server)
  }

  static async stopAll(): Promise<void> {
    await RunningServers.stopAll()
  }

  static async asking(spy: ListLiveSessionsSpy): Promise<Answered> {
    const port = await RunningApi.listening(spy)
    const response = await fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`)

    return { response, spy }
  }

  static async posting(spy: ListLiveSessionsSpy): Promise<Answered> {
    const port = await RunningApi.listening(spy)
    const response = await fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'POST' })

    return { response, spy }
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('SessionsRoute', () => {
  it('the live sessions the backend owns are listed with their names', async () => {
    const { response } = await RunningApi.asking(ListLiveSessionsSpy.answeringTwoSessions())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      sessions: [
        { id: 'session-1', name: 'zsh' },
        { id: 'session-2', name: 'claude' },
      ],
    })
  })

  it('no live session is an empty list and not a refusal', async () => {
    const { response } = await RunningApi.asking(ListLiveSessionsSpy.answeringNoSessions())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sessions: [] })
  })

  it('a method other than GET is refused naming GET as the allowed one', async () => {
    const { response, spy } = await RunningApi.posting(ListLiveSessionsSpy.answeringTwoSessions())

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(await response.json()).toEqual({ code: 'method-not-allowed', detail: 'method not allowed' })
    expect(spy.asked).toBe(0)
  })
})
