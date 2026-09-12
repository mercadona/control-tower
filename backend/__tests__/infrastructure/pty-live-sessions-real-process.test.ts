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
      shell: process.env.SHELL,
      cwd: process.cwd(),
      env: process.env,
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
    const session = sessions.open()
    const token = Echoed.token()

    const echoed = Echoed.waits({ sessions, session, token })
    sessions.write({ session, text: `echo ${token}\n` })
    await echoed

    const watch = sessions.watch({ session, onBytes: () => {} })
    watch.stop()
    expect(watch.printed).toContain(token)
  })

  it('the real process stays alive after every watcher has stopped', async () => {
    const sessions = RealCabin.opening(realTerminals)
    const session = sessions.open()
    const abandoned = sessions.watch({ session, onBytes: () => {} })
    abandoned.stop()

    const token = Echoed.token()
    const echoed = Echoed.waits({ sessions, session, token })
    sessions.write({ session, text: `echo ${token}\n` })
    await echoed

    expect(sessions.find(session.id)).not.toBeNull()
  })
})
