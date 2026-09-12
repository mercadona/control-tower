import { ReactElement, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { SessionsClient } from 'app/sessions/client'
import { LiveSession } from 'app/sessions/Sessions.types'
import { Banner } from 'system-ui/banner'
import '@xterm/xterm/css/xterm.css'
import './SessionTerminal.css'

const COLUMNS = 80
const ROWS = 24

const GONE_MESSAGE = 'Esta sesión ya no existe'
const UNREADABLE_MESSAGE = 'No se puede leer esta sesión'

type SessionStreamState = 'streaming' | 'gone' | 'unreadable'

export type SessionTerminalProps = { session: LiveSession }

export const SessionTerminal = ({ session }: SessionTerminalProps): ReactElement => {
  const screenRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<SessionStreamState>('streaming')

  useEffect(() => {
    setState('streaming')
    const screen = screenRef.current
    if (screen === null) return

    const terminal = new Terminal({ cols: COLUMNS, rows: ROWS })
    terminal.open(screen)
    terminal.onData((text) => void SessionsClient.type(session.id, text))

    const subscription = SessionsClient.watch(session.id, {
      onBytes: (bytes) => terminal.write(bytes),
      onFailure: () => setState('unreadable'),
      onRefused: () => setState('gone'),
      onUnreachable: () => setState('unreadable'),
    })

    return () => {
      subscription.close()
      terminal.dispose()
    }
  }, [session.id])

  return (
    <section className="session-terminal" aria-label="Terminal de la sesión">
      <div ref={screenRef} className="session-terminal__screen" />
      {state === 'gone' && <Banner type="error" role="alert" title={GONE_MESSAGE} />}
      {state === 'unreadable' && <Banner type="error" role="alert" title={UNREADABLE_MESSAGE} />}
    </section>
  )
}
