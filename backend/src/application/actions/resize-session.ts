import type { LiveSessions } from '../../domain/ports/live-sessions.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'

export class ResizeSessionParams {
  readonly session: LiveSession
  readonly cols: number
  readonly rows: number

  constructor({ session, cols, rows }: { session: LiveSession, cols: number, rows: number }) {
    this.session = session
    this.cols = cols
    this.rows = rows
    Object.freeze(this)
  }
}

export class ResizeSession {
  readonly liveSessions: LiveSessions

  constructor({ liveSessions }: { liveSessions: LiveSessions }) {
    this.liveSessions = liveSessions
  }

  execute(params: ResizeSessionParams): void {
    this.liveSessions.resize({ session: params.session, cols: params.cols, rows: params.rows })
  }
}
