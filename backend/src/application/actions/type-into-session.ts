import type { LiveSessions } from '../../domain/ports/live-sessions.ts'
import type { LiveSession } from '../../domain/value-objects/live-session.ts'

export class TypeIntoSessionParams {
  readonly session: LiveSession
  readonly text: string

  constructor({ session, text }: { session: LiveSession, text: string }) {
    this.session = session
    this.text = text
    Object.freeze(this)
  }
}

export class TypeIntoSession {
  readonly liveSessions: LiveSessions

  constructor({ liveSessions }: { liveSessions: LiveSessions }) {
    this.liveSessions = liveSessions
  }

  execute(params: TypeIntoSessionParams): void {
    this.liveSessions.write({ session: params.session, text: params.text })
  }
}
