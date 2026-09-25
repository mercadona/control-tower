import { CoordinatingLifecycle, CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'
import { FocusedSessionHeader } from 'app/focused-session/components/focused-session-header'
import { GateBand } from 'app/focused-session/components/gate-band'
import { SessionStageOf } from 'app/focused-session/SessionStage'
import { CentredSession } from 'app/sessions/components/centred-session'
import { LiveSession } from 'app/sessions/Sessions.types'
import { Banner } from 'system-ui/banner'
import './FocusedSession.css'

const BACKEND_UNREACHABLE = 'Sin conexión con el backend'
const BACKEND_UNREACHABLE_DETAIL = 'La sesión sigue en marcha, pero no podemos enseñarte lo que pasa. Reintentamos cada pocos segundos.'
const GATE_BAND_NO_DISPATCH = 0

type HeldRead = Extract<CoordinatingSessionRead, { kind: 'live' | 'ended' | 'unresumable' }>

type FocusedSessionProps = {
  held: HeldRead
  terminal: LiveSession | null
  stage: SessionStageOf
  lifecycle: Pick<
    CoordinatingLifecycle, 'connection' | 'closeError' | 'close' | 'liveAsk' | 'blocksOpening' | 'operationBusy' | 'openGroom'
  >
  closing: boolean
}

const FocusedSession = ({ held, terminal, stage, lifecycle, closing }: FocusedSessionProps) => (
  <main className="focused-session">
    {lifecycle.connection === 'unreachable' && (
      <Banner type="error" role="alert" title={BACKEND_UNREACHABLE} description={BACKEND_UNREACHABLE_DETAIL} />
    )}
    <FocusedSessionHeader
      step={stage.step}
      story={held.story}
      repo={held.repo}
      closing={closing}
      closeError={lifecycle.closeError}
      onCancel={() => void lifecycle.close()}
    />
    <GateBand
      band={stage.band}
      target={held.target}
      liveAsk={lifecycle.liveAsk}
      openingBlocked={lifecycle.blocksOpening}
      operationBusy={lifecycle.operationBusy}
      openSession={lifecycle.openGroom}
      dispatched={GATE_BAND_NO_DISPATCH}
    />
    {terminal !== null && <CentredSession session={terminal} />}
  </main>
)

export { FocusedSession }
export type { FocusedSessionProps, HeldRead }
