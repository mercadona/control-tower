import { ReactElement, useEffect, useState } from 'react'
import { SessionTerminal } from 'app/sessions/components/session-terminal'
import { LiveSession } from 'app/sessions/Sessions.types'
import { useLiveSessions } from 'app/sessions/useLiveSessions'
import { Banner } from 'system-ui/banner'
import { Loading } from 'system-ui/loading'
import { Tabs } from 'system-ui/tabs'
import './SessionsPanel.css'

const UNAVAILABLE_MESSAGE = 'No se pudo contactar con las sesiones en marcha'
const NO_SESSIONS_MESSAGE = 'No hay ninguna sesión en marcha'
const SESSIONS_TABLIST_LABEL = 'Sesiones abiertas'

type SessionsPanelProps = { opened?: LiveSession | null }

export const SessionsPanel = ({ opened = null }: SessionsPanelProps): ReactElement => {
  const { state, refresh } = useLiveSessions()
  const [chosenId, setChosenId] = useState<string | null>(null)

  useEffect(() => {
    if (opened === null) return
    setChosenId(opened.id)
    refresh()
  }, [opened, refresh])

  if (state.status === 'loading') {
    return <Loading />
  }

  if (state.status === 'unavailable') {
    return <Banner type="error" role="alert" title={UNAVAILABLE_MESSAGE} />
  }

  if (state.sessions.length === 0) {
    return <p className="sessions-panel__empty">{NO_SESSIONS_MESSAGE}</p>
  }

  const chosen = state.sessions.find((session) => session.id === chosenId) ?? state.sessions[0]
  const tabOptions = state.sessions.map((session) => ({ value: session.id, label: session.name }))

  return (
    <div className="sessions-panel">
      <Tabs options={tabOptions} value={chosen.id} onChange={setChosenId} aria-label={SESSIONS_TABLIST_LABEL} />
      <div role="tabpanel" aria-label={chosen.name}>
        <SessionTerminal session={chosen} onGone={refresh} />
      </div>
    </div>
  )
}
