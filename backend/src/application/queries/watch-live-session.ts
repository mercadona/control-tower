import type { LiveSessions } from '../../domain/ports/live-sessions.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'

export class WatchLiveSessionParams {
  readonly session: LiveSession
  readonly onBytes: (bytes: string) => void

  constructor({ session, onBytes }: { session: LiveSession, onBytes: (bytes: string) => void }) {
    this.session = session
    this.onBytes = onBytes
    Object.freeze(this)
  }
}

export class WatchLiveSessionResult {
  readonly printed: string
  readonly stop: () => void

  constructor({ printed, stop }: { printed: string, stop: () => void }) {
    this.printed = printed
    this.stop = stop
    Object.freeze(this)
  }
}

export class WatchLiveSession {
  readonly liveSessions: LiveSessions

  constructor({ liveSessions }: { liveSessions: LiveSessions }) {
    this.liveSessions = liveSessions
  }

  execute(params: WatchLiveSessionParams): WatchLiveSessionResult {
    const watched = this.liveSessions.watch({ session: params.session, onBytes: params.onBytes })

    return new WatchLiveSessionResult({ printed: watched.printed, stop: watched.stop })
  }
}
