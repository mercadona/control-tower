import { describe, it, expect } from 'vitest'
import {
  CoordinatingSessions, HeldCoordinatingSession, CoordinatingSessionState,
} from '../../src/infrastructure/coordinating-sessions.ts'
import { LiveSessions } from '../../src/domain/ports/live-sessions.ts'
import type { LiveSessionStream } from '../../src/domain/ports/live-sessions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ConversationId } from '../../src/domain/value-objects/conversation-id.ts'
import { CoordinatingConversation } from '../../src/domain/value-objects/coordinating-conversation.ts'
import { LiveSession } from '../../src/domain/value-objects/live-session.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { SessionAttention } from '../../src/domain/value-objects/session-attention.ts'

class LiveSessionsDouble extends LiveSessions {
  readonly stopped: string[]
  readonly #open: Map<string, LiveSession>
  readonly #following: Map<string, () => void>

  private constructor(open: LiveSession[]) {
    super()
    this.stopped = []
    this.#open = new Map(open.map((session) => [session.id, session]))
    this.#following = new Map()
  }

  static holding(...open: LiveSession[]): LiveSessionsDouble {
    return new LiveSessionsDouble(open)
  }

  find(id: string): LiveSession | null {
    return this.#open.get(id) ?? null
  }

  watch({ session, onEnded }: {
    session: LiveSession, onBytes: (bytes: string) => void, onEnded: () => void,
  }): LiveSessionStream {
    this.#following.set(session.id, onEnded)

    return {
      printed: '',
      stop: (): void => {
        this.stopped.push(session.id)
        this.#following.delete(session.id)
      },
    }
  }

  isFollowing(session: LiveSession): boolean {
    return this.#following.has(session.id)
  }

  exits(session: LiveSession): void {
    this.#open.delete(session.id)
    const ended = this.#following.get(session.id)
    if (ended === undefined) throw new Error(`LiveSessionsDouble: nobody follows ${session.id}`)
    this.#following.delete(session.id)
    ended()
  }
}

class Mother {
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly FIRST_SESSION = new LiveSession({ id: 'session-1', name: 'brainstorming' })
  static readonly SECOND_SESSION = new LiveSession({ id: 'session-2', name: 'brainstorming' })

  static conversation(id: string): CoordinatingConversation {
    return new CoordinatingConversation({
      id: new ConversationId(id),
      repository: Mother.REPOSITORY,
      root: Mother.ROOT,
    })
  }

  static readonly FIRST = Mother.conversation('2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f')
  static readonly SECOND = Mother.conversation('7c3d5e1a-4b2f-4c6d-8e9a-1b2c3d4e5f6a')

  static live(conversation: CoordinatingConversation, session: LiveSession): HeldCoordinatingSession {
    return new HeldCoordinatingSession({
      state: CoordinatingSessionState.LIVE,
      conversation,
      session,
      attention: SessionAttention.working(),
    })
  }
}

class Registry {
  static of(liveSessions: LiveSessionsDouble): { held: CoordinatingSessions, said: string[] } {
    const said: string[] = []

    return {
      held: new CoordinatingSessions({ liveSessions, stderr: (line) => { said.push(line) } }),
      said,
    }
  }
}

describe('CoordinatingSessions', () => {
  it('holds as ended the live session whose terminal exits', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held, said } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    liveSessions.exits(Mother.FIRST_SESSION)

    const holding = held.held()
    expect(holding?.state).toBe('ended')
    expect(holding?.conversation).toBe(Mother.FIRST)
    expect(holding?.session).toBeNull()
    expect(holding?.attention).toBeNull()
    expect(said).toContain(`coordinating session ${Mother.FIRST.id.text} ended\n`)
  })

  it('holds as ended a session that is no longer open when it is remembered', () => {
    const liveSessions = LiveSessionsDouble.holding()
    const { held } = Registry.of(liveSessions)

    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    expect(held.held()?.state).toBe('ended')
  })

  it('refuses to attend a conversation that has ended', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))
    liveSessions.exits(Mother.FIRST_SESSION)

    const attended = held.attend({
      conversation: Mother.FIRST.id.text,
      attention: SessionAttention.waiting('are you still there?'),
    })

    expect(attended).toBe(false)
    expect(held.held()?.attention).toBeNull()
  })

  it('stops following the previous session when a new one is remembered', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION, Mother.SECOND_SESSION)
    const { held } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    held.remember(Mother.live(Mother.SECOND, Mother.SECOND_SESSION))

    expect(liveSessions.stopped).toEqual([Mother.FIRST_SESSION.id])
    expect(liveSessions.isFollowing(Mother.FIRST_SESSION)).toBe(false)
    expect(liveSessions.isFollowing(Mother.SECOND_SESSION)).toBe(true)
  })

  it('follows no session for a conversation Claude Code no longer holds', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held } = Registry.of(liveSessions)

    held.remember(new HeldCoordinatingSession({
      state: CoordinatingSessionState.UNRESUMABLE,
      conversation: Mother.FIRST,
      session: null,
      attention: null,
    }))

    expect(liveSessions.isFollowing(Mother.FIRST_SESSION)).toBe(false)
    expect(held.held()?.state).toBe('unresumable')
  })

  it('moves the attention of the live conversation it holds', () => {
    const liveSessions = LiveSessionsDouble.holding(Mother.FIRST_SESSION)
    const { held, said } = Registry.of(liveSessions)
    held.remember(Mother.live(Mother.FIRST, Mother.FIRST_SESSION))

    const attended = held.attend({
      conversation: Mother.FIRST.id.text,
      attention: SessionAttention.waiting('which of the two screens do you mean?'),
    })

    expect(attended).toBe(true)
    expect(held.held()?.attention).toEqual(SessionAttention.waiting('which of the two screens do you mean?'))
    expect(said).toContain(`coordinating session ${Mother.FIRST.id.text} waiting\n`)
  })
})
