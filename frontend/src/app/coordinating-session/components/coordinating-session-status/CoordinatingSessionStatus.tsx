import { CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'
import { Banner } from 'system-ui/banner'

const UNRESUMABLE_TITLE = 'No se ha podido recuperar la conversación coordinadora'
const UNRESUMABLE_DESCRIPTION = 'Claude Code ya no guarda esta conversación. No se ha abierto otra en su lugar.'
const ENDED_TITLE = 'La conversación coordinadora ha terminado'
const ENDED_DESCRIPTION = 'Su terminal se ha cerrado. No se ha abierto otra en su lugar.'

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
  if (read.kind === 'ended') {
    return <Banner type="warning" role="alert" title={ENDED_TITLE} description={ENDED_DESCRIPTION} />
  }

  return null
}

export { CoordinatingSessionStatus }
export type { CoordinatingSessionStatusProps }
