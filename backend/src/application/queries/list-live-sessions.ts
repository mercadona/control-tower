import type { LiveSessions } from '../../domain/ports/live-sessions.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'

export class ListLiveSessionsResult {
  readonly sessions: readonly LiveSession[]

  constructor({ sessions }: { sessions: readonly LiveSession[] }) {
    this.sessions = Object.freeze([...sessions])
    Object.freeze(this)
  }
}

export class ListLiveSessions {
  readonly liveSessions: LiveSessions

  constructor({ liveSessions }: { liveSessions: LiveSessions }) {
    this.liveSessions = liveSessions
  }

  execute(): ListLiveSessionsResult {
    return new ListLiveSessionsResult({ sessions: this.liveSessions.all() })
  }
}
