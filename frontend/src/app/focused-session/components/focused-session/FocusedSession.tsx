import { useState } from 'react'
import { CoordinatingLifecycle, CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'
import { FocusedSessionHeader } from 'app/focused-session/components/focused-session-header'
import { GateBand } from 'app/focused-session/components/gate-band'
import { SessionEndedNotice } from 'app/focused-session/components/session-ended-notice'
import { SessionPanel } from 'app/focused-session/components/session-panel'
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
const IMPLEMENTATION_STEP = 'implementation'

type HeldRead = Extract<CoordinatingSessionRead, { kind: 'live' | 'ended' | 'unresumable' }>

type FocusedSessionProps = {
  held: HeldRead
  terminal: LiveSession | null
  stage: SessionStageOf
  lifecycle: Pick<
    CoordinatingLifecycle,
    'connection' | 'closeError' | 'close' | 'liveAsk' | 'blocksOpening' | 'operationBusy' | 'openGroom' | 'reopen'
  >
  closing: boolean
  milestoneProgress: MilestoneProgressOutcome | null
  milestoneUnavailable: boolean
  onRereadMilestone: () => void
}

const FocusedSession = ({
  held, terminal, stage, lifecycle, closing, milestoneProgress, milestoneUnavailable, onRereadMilestone,
}: FocusedSessionProps) => {
  const [talking, setTalking] = useState(false)
  const isImplementation = stage.step === IMPLEMENTATION_STEP
  const talkAction = terminal !== null ? () => setTalking(true) : null

  return (
    <main className="focused-session">
      {lifecycle.connection === 'unreachable' && (
        <Banner type="error" role="alert" title={BACKEND_UNREACHABLE} description={BACKEND_UNREACHABLE_DETAIL} />
      )}
      {milestoneUnavailable && lifecycle.connection !== 'unreachable' && (
        <Banner type="warning" role="alert" title="No se ha podido actualizar el milestone"
          description="Reintentamos cada pocos segundos. La información visible corresponde a la última lectura disponible." />
      )}
      <FocusedSessionHeader
        step={stage.step}
        story={held.story}
        repo={held.repo}
        closing={closing}
        closeError={lifecycle.closeError}
        onCancel={() => void lifecycle.close()}
        onTalk={isImplementation ? talkAction : undefined}
      />
      {(held.kind === 'ended' || held.kind === 'unresumable') && (
        <SessionEndedNotice step={stage.step} busy={lifecycle.operationBusy} onReopen={lifecycle.reopen} />
      )}
      <GateBand
        band={stage.band}
        target={held.target}
        liveAsk={lifecycle.liveAsk}
        openingBlocked={lifecycle.blocksOpening}
        operationBusy={lifecycle.operationBusy}
        openSession={lifecycle.openGroom}
        dispatched={GATE_BAND_NO_DISPATCH}
      />
      {isImplementation ? (
        <div className="focused-session__implementation">
          <MilestoneBoard
            progress={milestoneProgress}
            onTalk={talkAction}
            repo={held.repo}
            story={held.story}
            onReread={onRereadMilestone}
            onClose={() => void lifecycle.close()}
          />
          {talking && terminal !== null && <SessionPanel session={terminal} onClose={() => setTalking(false)} />}
        </div>
      ) : (
        terminal !== null && <CentredSession session={terminal} />
      )}
    </main>
  )
}

export { FocusedSession }
export type { FocusedSessionProps, HeldRead }
