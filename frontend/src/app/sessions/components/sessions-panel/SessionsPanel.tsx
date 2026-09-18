import { ReactElement, useEffect, useState } from 'react'
import { OpenedCoordinatingSession } from 'app/coordinating-session/CoordinatingSession.types'
import { CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'
import { SessionTerminal } from 'app/sessions/components/session-terminal'
import { LiveSession } from 'app/sessions/Sessions.types'
import { useLiveSessions } from 'app/sessions/useLiveSessions'
import { Banner } from 'system-ui/banner'
import { Loading } from 'system-ui/loading'
import { Button } from 'system-ui/button'
import { Tabs } from 'system-ui/tabs'
import './SessionsPanel.css'

const UNAVAILABLE_MESSAGE = 'No se pudo contactar con las sesiones en marcha'
const NO_SESSIONS_MESSAGE = 'No hay ninguna sesión en marcha'
const SESSIONS_TABLIST_LABEL = 'Sesiones abiertas'
const NO_CLOSED_SESSIONS: readonly string[] = []

type SessionsPanelProps = {
  opened?: LiveSession | null
  coordinating?: CoordinatingSessionRead
  adopted?: OpenedCoordinatingSession | null
  closing?: boolean
  closeError?: string | null
  closedSessionIds?: readonly string[]
  onClose?: () => void
}

export const SessionsPanel = ({
  opened = null, coordinating, adopted = null, closing = false, closeError = null,
  closedSessionIds = NO_CLOSED_SESSIONS, onClose = () => undefined,
}: SessionsPanelProps): ReactElement => {
  const selectedSession = adopted?.session ?? opened
  const { state, refresh } = useLiveSessions({ adopted: selectedSession, removedSessionIds: closedSessionIds })
  const [chosenId, setChosenId] = useState<string | null>(null)

  useEffect(() => {
    if (selectedSession === null) return
    setChosenId(selectedSession.id)
    refresh()
  }, [adopted?.target, opened?.id, refresh])

  const held = coordinating?.phase === 'read' &&
    (coordinating.kind === 'live' || coordinating.kind === 'ended' || coordinating.kind === 'unresumable')
    ? coordinating
    : null
  const action = held === null ? null : (
    <div className="sessions-panel__coordinating-action">
      <p>Sesión coordinadora · <code>{held.repo}</code></p>
      <Button disabled={closing} onClick={onClose}>
        {closing ? 'Cancelando…' : held.kind === 'live' ? 'Cancelar la sesión' : 'Cerrar sesión'}
      </Button>
      {closeError !== null && <Banner type="error" role="alert" title={closeError} />}
    </div>
  )

  if (state.status === 'loading' && state.sessions.length === 0) {
    return <div className="sessions-panel">{action}<Loading /></div>
  }

  if (state.status === 'unavailable' && state.sessions.length === 0) {
    return <div className="sessions-panel">{action}<Banner type="error" role="alert" title={UNAVAILABLE_MESSAGE} /></div>
  }

  if (state.sessions.length === 0) {
    return <div className="sessions-panel">{action}<p className="sessions-panel__empty">{NO_SESSIONS_MESSAGE}</p></div>
  }

  const chosen = state.sessions.find((session) => session.id === chosenId) ?? state.sessions[0]
  const tabOptions = state.sessions.map((session) => ({ value: session.id, label: session.name }))

  return (
    <div className="sessions-panel">
      {action}
      {state.status === 'unavailable' && <Banner type="error" role="alert" title={UNAVAILABLE_MESSAGE} />}
      <Tabs options={tabOptions} value={chosen.id} onChange={setChosenId} aria-label={SESSIONS_TABLIST_LABEL} />
      <div role="tabpanel" className="sessions-panel__screen" aria-label={chosen.name}>
        <SessionTerminal session={chosen} onGone={refresh} />
      </div>
    </div>
  )
}
