import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { PtyLiveSessions } from '../../src/infrastructure/pty-live-sessions.ts'
import type { TerminalSpawn } from '../../src/infrastructure/pty-live-sessions.ts'
import type { LiveSession } from '../../src/domain/value-objects/live-session.ts'

class RealTerminals {
  readonly #opened: IPty[] = []

  spawn(): TerminalSpawn {
    return (file, argv, options) => {
      const terminal = spawn(file, argv, options)
      this.#opened.push(terminal)

      return terminal
    }
  }

  killAll(): void {
    for (const terminal of this.#opened) terminal.kill()
  }
}

class RealCabin {
  static opening(realTerminals: RealTerminals): PtyLiveSessions {
    return new PtyLiveSessions({
      spawn: realTerminals.spawn(),
      newId: () => randomUUID(),
      stderr: () => {},
    })
  }
}

class Echoed {
  static waits({ sessions, session, token }: {
    sessions: PtyLiveSessions, session: LiveSession, token: string,
  }): Promise<void> {
    return new Promise((resolve) => {
      let seen = ''
      const watch = sessions.watch({
        session,
        onBytes: (bytes) => {
          seen += bytes
          if (seen.includes(token)) {
            watch.stop()
            resolve()
          }
        },
        onEnded: () => {},
      })
      seen = watch.printed
      if (seen.includes(token)) {
        watch.stop()
        resolve()
      }
    })
  }

  static token(): string {
    return `ct-real-pty-${randomUUID()}`
  }

  static typedInHalvesForTheShellToJoin(token: string): string {
    const first = token.slice(0, 1)
    const rest = token.slice(1)

    return `A=${first}; B=${rest}; echo "$A$B"\n`
  }
}

describe('PtyLiveSessions with a real process', () => {
  let realTerminals: RealTerminals

  beforeEach(() => {
    realTerminals = new RealTerminals()
  })

  afterEach(() => {
    realTerminals.killAll()
  })

  it('a real terminal prints into the scrollback and answers what is written to it', async () => {
    const sessions = RealCabin.opening(realTerminals)
    const session = sessions.open(PtyLiveSessions.loginShell(process.env.SHELL, process.cwd(), process.env))
    const token = Echoed.token()

    const echoed = Echoed.waits({ sessions, session, token })
    sessions.write({ session, text: Echoed.typedInHalvesForTheShellToJoin(token) })
    await echoed

    const watch = sessions.watch({ session, onBytes: () => {}, onEnded: () => {} })
    watch.stop()
    expect(watch.printed).toContain(token)
  })

  it('the real process stays alive after every watcher has stopped', async () => {
    const sessions = RealCabin.opening(realTerminals)
    const session = sessions.open(PtyLiveSessions.loginShell(process.env.SHELL, process.cwd(), process.env))
    const abandoned = sessions.watch({ session, onBytes: () => {}, onEnded: () => {} })
    abandoned.stop()

    const token = Echoed.token()
    const echoed = Echoed.waits({ sessions, session, token })
    sessions.write({ session, text: Echoed.typedInHalvesForTheShellToJoin(token) })
    await echoed

    expect(sessions.find(session.id)).not.toBeNull()
  })

  it('a resize reaches the real terminal, and the shell sees the new size', async () => {
    const sessions = RealCabin.opening(realTerminals)
    const session = sessions.open(PtyLiveSessions.loginShell(process.env.SHELL, process.cwd(), process.env))
    const token = '40 120'

    const echoed = Echoed.waits({ sessions, session, token })
    sessions.resize({ session, cols: 120, rows: 40 })
    sessions.write({ session, text: 'stty size\n' })
    await echoed

    const watch = sessions.watch({ session, onBytes: () => {}, onEnded: () => {} })
    watch.stop()
    expect(watch.printed).toContain(token)
  })
})
