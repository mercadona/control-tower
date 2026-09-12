import { describe, it, expect } from 'vitest'
import { ListLiveSessions, ListLiveSessionsResult } from '../../src/application/queries/list-live-sessions.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'

class LiveSessionMother {
  static zsh(): LiveSession {
    return new LiveSession({ id: 'session-1', name: 'zsh' })
  }

  static claude(): LiveSession {
    return new LiveSession({ id: 'session-2', name: 'claude' })
  }
}

class LiveSessionsDouble extends LiveSessions {
  readonly sessions: LiveSession[]

  constructor(sessions: LiveSession[]) {
    super()
    this.sessions = sessions
  }

  static holding(...sessions: LiveSession[]): LiveSessionsDouble {
    return new LiveSessionsDouble(sessions)
  }

  all(): LiveSession[] {
    return this.sessions
  }
}

describe('ListLiveSessions', () => {
  it('the query answers what the port holds', () => {
    const zsh = LiveSessionMother.zsh()
    const claude = LiveSessionMother.claude()
    const liveSessions = LiveSessionsDouble.holding(zsh, claude)

    const result = new ListLiveSessions({ liveSessions }).execute()

    expect(result).toBeInstanceOf(ListLiveSessionsResult)
    expect(result.sessions).toEqual([zsh, claude])
  })

  it('a live session refuses a blank id', () => {
    expect(() => new LiveSession({ id: '', name: 'zsh' })).toThrow(/id must be a non-empty string/)
  })

  it('a live session refuses a blank name', () => {
    expect(() => new LiveSession({ id: 'session-1', name: '' })).toThrow(/name must be a non-empty string/)
  })
})
