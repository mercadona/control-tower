import type { LiveSession } from '../value-objects/live-session.ts'

export type LiveSessionStream = { readonly printed: string, readonly stop: () => void }

export class LiveSessions {
  all(): LiveSession[] {
    throw new Error(`${this.constructor.name} must implement all()`)
  }

  find(id: string): LiveSession | null {
    throw new Error(`${this.constructor.name} must implement find()`)
  }

  watch({ session, onBytes }: { session: LiveSession, onBytes: (bytes: string) => void }): LiveSessionStream {
    throw new Error(`${this.constructor.name} must implement watch()`)
  }

  write({ session, text }: { session: LiveSession, text: string }): void {
    throw new Error(`${this.constructor.name} must implement write()`)
  }
}
