import { ReactElement, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { SessionsClient } from 'app/sessions/client'
import { LiveSession, TypeOutcome } from 'app/sessions/Sessions.types'
import { Banner } from 'system-ui/banner'
import '@xterm/xterm/css/xterm.css'
import './SessionTerminal.css'

const COLUMNS = 80
const ROWS = 24

const GONE_MESSAGE = 'Esta sesión ya no existe'
const UNREADABLE_MESSAGE = 'No se puede leer esta sesión'
const REFUSED_WRITE_MESSAGE = 'No se ha podido enviar lo que has escrito'
const UNREACHABLE_WRITE_MESSAGE = 'Sin conexión con el backend'

type SessionStreamState = 'streaming' | 'gone' | 'unreadable'

export type SessionTerminalProps = { session: LiveSession; onGone?: () => void }

const writeMessageFor = (outcome: TypeOutcome): string | null => {
  switch (outcome.kind) {
    case 'refused': return REFUSED_WRITE_MESSAGE
    case 'unreachable': return UNREACHABLE_WRITE_MESSAGE
    case 'typed': return null
  }
}

export const SessionTerminal = ({ session, onGone = () => undefined }: SessionTerminalProps): ReactElement => {
  const screenRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<SessionStreamState>('streaming')
  const [writeMessage, setWriteMessage] = useState<string | null>(null)
  const onGoneRef = useRef(onGone)
  onGoneRef.current = onGone

  useEffect(() => {
    setState('streaming')
    setWriteMessage(null)
    const screen = screenRef.current
    if (screen === null) return

    let cancelled = false
    const terminal = new Terminal({ cols: COLUMNS, rows: ROWS })
    terminal.open(screen)
    terminal.onData((text) => {
      void SessionsClient.type(session.id, text).then((outcome) => {
        if (cancelled) return
        setWriteMessage(writeMessageFor(outcome))
      })
    })

    const subscription = SessionsClient.watch(session.id, {
      onOpened: () => terminal.reset(),
      onBytes: (bytes) => terminal.write(bytes),
      onFailure: () => setState('unreadable'),
      onRefused: () => {
        setState('gone')
        onGoneRef.current()
      },
      onUnreachable: () => setState('unreadable'),
    })

    return () => {
      cancelled = true
      subscription.close()
      terminal.dispose()
    }
  }, [session.id])

  return (
    <section className="session-terminal" aria-label="Terminal de la sesión">
      <div ref={screenRef} className="session-terminal__screen" />
      {state === 'gone' && <Banner type="error" role="alert" title={GONE_MESSAGE} />}
      {state === 'unreadable' && <Banner type="error" role="alert" title={UNREADABLE_MESSAGE} />}
      {writeMessage !== null && <Banner type="error" role="alert" title={writeMessage} />}
    </section>
  )
}
