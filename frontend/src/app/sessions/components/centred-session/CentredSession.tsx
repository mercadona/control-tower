import { SessionTerminal } from 'app/sessions/components/session-terminal'
import { LiveSession } from 'app/sessions/Sessions.types'
import './CentredSession.css'

const THE_COORDINATING_POLL_ENDS_THE_VIEW = () => undefined

type CentredSessionProps = {
  session: LiveSession
}

const CentredSession = ({ session }: CentredSessionProps) => (
  <section className="centred-session" aria-label={session.name}>
    <SessionTerminal session={session} onGone={THE_COORDINATING_POLL_ENDS_THE_VIEW} />
  </section>
)

export { CentredSession }
export type { CentredSessionProps }
