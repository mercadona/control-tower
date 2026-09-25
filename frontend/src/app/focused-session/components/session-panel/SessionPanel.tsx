import { CentredSession } from 'app/sessions/components/centred-session'
import { LiveSession } from 'app/sessions/Sessions.types'
import { Button } from 'system-ui/button'
import './SessionPanel.css'

const DIALOG_LABEL = 'Sesión coordinadora'
const BACK_LABEL = 'Volver a la lista'

type SessionPanelProps = { session: LiveSession; onClose: () => void }

const SessionPanel = ({ session, onClose }: SessionPanelProps) => (
  <div className="session-panel" role="dialog" aria-label={DIALOG_LABEL}>
    <Button variant="secondary" onClick={onClose}>{BACK_LABEL}</Button>
    <CentredSession session={session} />
  </div>
)

export { SessionPanel }
export type { SessionPanelProps }
