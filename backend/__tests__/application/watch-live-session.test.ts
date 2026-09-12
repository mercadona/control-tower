import { describe, it, expect } from 'vitest'
import { WatchLiveSession, WatchLiveSessionParams, WatchLiveSessionResult } from '../../src/application/queries/watch-live-session.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'

type WatchAsked = { session: LiveSession, onBytes: (bytes: string) => void }

class LiveSessionMother {
  static claude(): LiveSession {
    return new LiveSession({ id: 'session-1', name: 'claude' })
  }
}

class LiveSessionsSpy extends LiveSessions {
  readonly asked: WatchAsked[]
  readonly answer: LiveSessionStream

  constructor(answer: LiveSessionStream) {
    super()
    this.asked = []
    this.answer = answer
  }

  static answering(printed: string, stop: () => void): LiveSessionsSpy {
    return new LiveSessionsSpy({ printed, stop })
  }

  watch(params: WatchAsked): LiveSessionStream {
    this.asked.push(params)

    return this.answer
  }
}

describe('WatchLiveSession', () => {
  it('watching hands the port the session and answers what it printed', () => {
    const claude = LiveSessionMother.claude()
    const stop = (): void => {}
    const onBytes = (bytes: string): void => {}
    const liveSessions = LiveSessionsSpy.answering('hola', stop)

    const result = new WatchLiveSession({ liveSessions }).execute(
      new WatchLiveSessionParams({ session: claude, onBytes })
    )

    expect(result).toBeInstanceOf(WatchLiveSessionResult)
    expect(result.printed).toBe('hola')
    expect(result.stop).toBe(stop)
    expect(liveSessions.asked).toEqual([{ session: claude, onBytes }])
  })
})
