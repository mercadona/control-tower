import { CoordinatingLifecycle } from 'app/coordinating-session/useCoordinatingSession'
import { FocusedSessionHeader } from 'app/focused-session/components/focused-session-header'
import { GateBand } from 'app/focused-session/components/gate-band'
import { SessionStageOf } from 'app/focused-session/SessionStage'
import { CentredSession } from 'app/sessions/components/centred-session'
import { LiveSession } from 'app/sessions/Sessions.types'
import { Banner } from 'system-ui/banner'
import './FocusedSession.css'

const BACKEND_UNREACHABLE = 'Sin conexión con el backend'
const BACKEND_UNREACHABLE_DETAIL = 'La sesión sigue en marcha, pero no podemos enseñarte lo que pasa. Reintentamos cada pocos segundos.'

type FocusedSessionProps = {
  story: string
  repo: string
  target: string
  terminal: LiveSession
  stage: SessionStageOf
  lifecycle: CoordinatingLifecycle
  closing: boolean
  dispatched: number
}

const FocusedSession = ({ story, repo, target, terminal, stage, lifecycle, closing, dispatched }: FocusedSessionProps) => (
  <main className="focused-session">
    {lifecycle.connection === 'unreachable' && (
      <Banner type="error" role="alert" title={BACKEND_UNREACHABLE} description={BACKEND_UNREACHABLE_DETAIL} />
    )}
    <FocusedSessionHeader
      step={stage.step}
      story={story}
      repo={repo}
      closing={closing}
      closeError={lifecycle.closeError}
      onCancel={() => void lifecycle.close()}
    />
    <GateBand
      band={stage.band}
      target={target}
      liveAsk={lifecycle.liveAsk}
      openingBlocked={lifecycle.blocksOpening}
      operationBusy={lifecycle.operationBusy}
      openSession={lifecycle.openGroom}
      dispatched={dispatched}
    />
    <CentredSession session={terminal} />
  </main>
)

export { FocusedSession }
export type { FocusedSessionProps }
