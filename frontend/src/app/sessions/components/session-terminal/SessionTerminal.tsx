import { ReactElement, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SessionsClient } from 'app/sessions/client'
import { LiveSession, TerminalSize, TypeOutcome } from 'app/sessions/Sessions.types'
import { Banner } from 'system-ui/banner'
import '@xterm/xterm/css/xterm.css'
import './SessionTerminal.css'

const COLUMNS = 80
const ROWS = 24
const FONT_FAMILY = "ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Mono', Consolas, monospace"
const FONT_SIZE = 13
const RESIZE_DEBOUNCE_MS = 100
const BACKGROUND_FALLBACK = '#1f1c1b'
const FOREGROUND_FALLBACK = '#ffffff'

const GONE_MESSAGE = 'Esta sesión ya no existe'
const UNREADABLE_MESSAGE = 'No se puede leer esta sesión'
const REFUSED_WRITE_MESSAGE = 'No se ha podido enviar lo que has escrito'
const UNREACHABLE_WRITE_MESSAGE = 'Sin conexión con el backend'

const readColorToken = (name: string, fallback: string): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

const terminalTheme = () => ({
  background: readColorToken('--neutral-950', BACKGROUND_FALLBACK),
  foreground: readColorToken('--neutral-0', FOREGROUND_FALLBACK),
})

type SessionStreamState = 'streaming' | 'gone' | 'unreadable'

export type SessionTerminalProps = { session: LiveSession; onGone: () => void }

const writeMessageFor = (outcome: TypeOutcome): string | null => {
  switch (outcome.kind) {
    case 'refused': return REFUSED_WRITE_MESSAGE
    case 'unreachable': return UNREACHABLE_WRITE_MESSAGE
    case 'typed': return null
  }
}

export const SessionTerminal = ({ session, onGone }: SessionTerminalProps): ReactElement => {
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
    const terminal = new Terminal({
      cols: COLUMNS,
      rows: ROWS,
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      theme: terminalTheme(),
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(screen)

    let lastSize: TerminalSize = { cols: COLUMNS, rows: ROWS }
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const fitAndResize = () => {
      const proposed = fitAddon.proposeDimensions()
      if (proposed === undefined || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return
      fitAddon.fit()
      if (proposed.cols === lastSize.cols && proposed.rows === lastSize.rows) return
      lastSize = { cols: proposed.cols, rows: proposed.rows }
      void SessionsClient.resize(session.id, lastSize)
    }

    fitAndResize()

    const resizeObserver = new ResizeObserver(() => {
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(fitAndResize, RESIZE_DEBOUNCE_MS)
    })
    resizeObserver.observe(screen)

    terminal.onData((text) => {
      void SessionsClient.type(session.id, text).then((outcome) => {
        if (cancelled) return
        setWriteMessage(writeMessageFor(outcome))
      })
    })

    const subscription = SessionsClient.watch(session.id, {
      onOpened: () => { terminal.reset(); setState('streaming') },
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
      resizeObserver.disconnect()
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      subscription.close()
      fitAddon.dispose()
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
