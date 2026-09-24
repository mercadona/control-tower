import type { LiveSession } from '../value-objects/live-session.ts'
import type { ConversationId } from '../value-objects/conversation-id.ts'
import type { SessionClosure } from '../value-objects/session-closure.ts'

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

  submit({ session, text }: { session: LiveSession, text: string }): Promise<void> {
    throw new Error(`${this.constructor.name} must implement submit()`)
  }

  resize({ session, cols, rows }: { session: LiveSession, cols: number, rows: number }): void {
    throw new Error(`${this.constructor.name} must implement resize()`)
  }

  terminationEvidence({ conversation, target, session }: {
    conversation: ConversationId, target: string, session: LiveSession | null,
  }): SessionClosure {
    throw new Error(
      `${this.constructor.name} must implement terminationEvidence(), asked for ${conversation.text} ${target} ${session?.id ?? 'none'}`
    )
  }

  async terminate(closure: SessionClosure): Promise<void> {
    throw new Error(`${this.constructor.name} must implement terminate(), asked for ${closure.target}`)
  }

  async prepareTermination(closure: SessionClosure): Promise<SessionClosure> {
    throw new Error(`${this.constructor.name} must implement prepareTermination(), asked for ${closure.target}`)
  }

  async confirmTermination(closure: SessionClosure): Promise<void> {
    throw new Error(`${this.constructor.name} must implement confirmTermination(), asked for ${closure.target}`)
  }
}
