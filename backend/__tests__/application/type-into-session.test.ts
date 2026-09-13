import { describe, it, expect } from 'vitest'
import { TypeIntoSession, TypeIntoSessionParams } from '../../src/application/actions/type-into-session.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'

type WriteAsked = { session: LiveSession, text: string }

class LiveSessionMother {
  static claude(): LiveSession {
    return new LiveSession({ id: 'session-1', name: 'claude' })
  }
}

class LiveSessionsSpy extends LiveSessions {
  readonly asked: WriteAsked[]

  constructor() {
    super()
    this.asked = []
  }

  write(params: WriteAsked): void {
    this.asked.push(params)
  }
}

describe('TypeIntoSession', () => {
  it('the action hands the port the session and the text', () => {
    const claude = LiveSessionMother.claude()
    const liveSessions = new LiveSessionsSpy()

    new TypeIntoSession({ liveSessions }).execute(new TypeIntoSessionParams({ session: claude, text: 'ls\r' }))

    expect(liveSessions.asked).toEqual([{ session: claude, text: 'ls\r' }])
  })
})
