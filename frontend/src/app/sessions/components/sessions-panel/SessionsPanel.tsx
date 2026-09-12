import { ReactElement, useState } from 'react'
import { SessionTerminal } from 'app/sessions/components/session-terminal'
import { useLiveSessions } from 'app/sessions/useLiveSessions'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { Loading } from 'system-ui/loading'
import './SessionsPanel.css'

const UNAVAILABLE_MESSAGE = 'No se pudo contactar con las sesiones en marcha'
const NO_SESSIONS_MESSAGE = 'No hay ninguna sesión en marcha'

export const SessionsPanel = (): ReactElement => {
  const sessions = useLiveSessions()
  const [chosenId, setChosenId] = useState<string | null>(null)

  if (sessions.status === 'loading') {
    return <Loading />
  }

  if (sessions.status === 'unavailable') {
    return <Banner type="error" role="alert" title={UNAVAILABLE_MESSAGE} />
  }

  if (sessions.sessions.length === 0) {
    return <p className="sessions-panel__empty">{NO_SESSIONS_MESSAGE}</p>
  }

  const chosen = sessions.sessions.find((session) => session.id === chosenId) ?? sessions.sessions[0]

  return (
    <div className="sessions-panel">
      <ul className="sessions-panel__list">
        {sessions.sessions.map((session) => (
          <li key={session.id} className="sessions-panel__item">
            <Button
              variant={session.id === chosen.id ? 'primary' : 'secondary'}
              aria-current={session.id === chosen.id ? 'true' : undefined}
              onClick={() => setChosenId(session.id)}
            >
              {session.name}
            </Button>
          </li>
        ))}
      </ul>
      <SessionTerminal session={chosen} />
    </div>
  )
}
