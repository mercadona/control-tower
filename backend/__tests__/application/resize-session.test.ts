import { describe, it, expect } from 'vitest'
import { ResizeSession, ResizeSessionParams } from '../../src/application/actions/resize-session.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'

type ResizeAsked = { session: LiveSession, cols: number, rows: number }

class LiveSessionMother {
  static claude(): LiveSession {
    return new LiveSession({ id: 'session-1', name: 'claude' })
  }
}

class LiveSessionsSpy extends LiveSessions {
  readonly asked: ResizeAsked[]

  constructor() {
    super()
    this.asked = []
  }

  resize(params: ResizeAsked): void {
    this.asked.push(params)
  }
}

describe('ResizeSession', () => {
  it('the action hands the port the session, its columns and its rows', () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = new LiveSessionsSpy()

    new ResizeSession({ liveSessions }).execute(new ResizeSessionParams({ session: claude, cols: 120, rows: 40 }))

    expect(liveSessions.asked).toEqual([{ session: claude, cols: 120, rows: 40 }])
  })
})
