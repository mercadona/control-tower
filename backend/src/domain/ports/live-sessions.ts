import type { LiveSession } from '../value-objects/live-session.ts'

export type LiveSessionStream = { readonly printed: string, readonly stop: () => void }

export class LiveSessionNotLive extends Error {
  constructor(id: string) {
    super(`session ${id} is no longer live`)
    this.name = new.target.name
  }
}

export class LiveSessions {
  all(): LiveSession[] {
    throw new Error(`${this.constructor.name} must implement all()`)
  }

  find(id: string): LiveSession | null {
    throw new Error(`${this.constructor.name} must implement find()`)
  }

  watch({ session, onBytes, onEnded }: {
    session: LiveSession, onBytes: (bytes: string) => void, onEnded: () => void,
  }): LiveSessionStream {
    throw new Error(`${this.constructor.name} must implement watch()`)
  }

  write({ session, text }: { session: LiveSession, text: string }): void {
    throw new Error(`${this.constructor.name} must implement write()`)
  }

  resize({ session, cols, rows }: { session: LiveSession, cols: number, rows: number }): void {
    throw new Error(`${this.constructor.name} must implement resize()`)
  }
}
