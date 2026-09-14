import { CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'
import { Banner } from 'system-ui/banner'

const WORKING_LABEL = 'Trabajando'
const WAITING_LABEL = 'Esperando'
const QUESTION_LABEL = 'Te está preguntando'
const UNRESUMABLE_TITLE = 'No se ha podido recuperar la conversación coordinadora'
const UNRESUMABLE_DESCRIPTION = 'Claude Code ya no guarda esta conversación. No se ha abierto otra en su lugar.'

type CoordinatingSessionStatusProps = {
  read: CoordinatingSessionRead
}

const CoordinatingSessionStatus = ({ read }: CoordinatingSessionStatusProps) => {
  if (read.phase === 'connecting') return null
  if (read.kind === 'none') return null
  if (read.kind === 'unavailable') return null
  if (read.kind === 'unresumable') {
    return <Banner type="error" role="alert" title={UNRESUMABLE_TITLE} description={UNRESUMABLE_DESCRIPTION} />
  }

  if (read.attention.status === 'waiting') {
    return (
      <p className="coordinating-session-status" role="status">
        <span className="coordinating-session-status__attention">{WAITING_LABEL}</span>
        {read.attention.question !== null && (
          <span className="coordinating-session-status__question">{`${QUESTION_LABEL}: ${read.attention.question}`}</span>
        )}
      </p>
    )
  }

  return <p className="coordinating-session-status" role="status">{WORKING_LABEL}</p>
}

export { CoordinatingSessionStatus }
export type { CoordinatingSessionStatusProps }
