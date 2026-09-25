import { CoordinatingLifecycle, CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'
import { FocusedSessionHeader } from 'app/focused-session/components/focused-session-header'
import { GateBand } from 'app/focused-session/components/gate-band'
import { SessionStageOf } from 'app/focused-session/SessionStage'
import { MilestoneBoard } from 'app/milestone-progress/components/milestone-board'
import type { MilestoneProgressOutcome } from 'app/milestone-progress/MilestoneProgress.types'
import { CentredSession } from 'app/sessions/components/centred-session'
import { LiveSession } from 'app/sessions/Sessions.types'
import { Banner } from 'system-ui/banner'
import './FocusedSession.css'

const BACKEND_UNREACHABLE = 'Sin conexión con el backend'
const BACKEND_UNREACHABLE_DETAIL = 'La sesión sigue en marcha, pero no podemos enseñarte lo que pasa. Reintentamos cada pocos segundos.'
const GATE_BAND_NO_DISPATCH = 0
const NO_SESSION_PANEL_YET = null

type HeldRead = Extract<CoordinatingSessionRead, { kind: 'live' | 'ended' | 'unresumable' }>

type FocusedSessionProps = {
  held: HeldRead
  terminal: LiveSession | null
  stage: SessionStageOf
  lifecycle: Pick<
    CoordinatingLifecycle, 'connection' | 'closeError' | 'close' | 'liveAsk' | 'blocksOpening' | 'operationBusy' | 'openGroom'
  >
  closing: boolean
  milestoneProgress: MilestoneProgressOutcome | null
  onRereadMilestone: () => void
}

const FocusedSession = ({
  held, terminal, stage, lifecycle, closing, milestoneProgress, onRereadMilestone,
}: FocusedSessionProps) => (
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
    {stage.step === 'implementation' ? (
      <MilestoneBoard
        progress={milestoneProgress}
        onTalk={NO_SESSION_PANEL_YET}
        repo={held.repo}
        story={held.story}
        onReread={onRereadMilestone}
        onClose={() => void lifecycle.close()}
      />
    ) : (
      terminal !== null && <CentredSession session={terminal} />
    )}
  </main>
)

export { FocusedSession }
export type { FocusedSessionProps, HeldRead }
