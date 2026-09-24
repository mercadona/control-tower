import { LiveAsk } from 'app/coordinating-session/CoordinatingSession.types'
import { GroomSessionOutcome } from 'app/epic-groom/EpicGroom.types'
import { EPIC_GROOM_GATE_HEADING, EpicGroomPanel } from 'app/epic-groom/components/epic-groom-panel'
import { GateBandKind } from 'app/focused-session/SessionStage'
import { SPEC_FREEZE_GATE_HEADING, SpecFreezePanel } from 'app/spec-freeze/components/spec-freeze-panel'
import './GateBand.css'

type GateBandProps = {
  band: GateBandKind
  target: string
  liveAsk: LiveAsk | null
  openingBlocked: boolean
  operationBusy: boolean
  openSession: (key: string, target: string) => Promise<GroomSessionOutcome>
  dispatched: number
}

const GateBand = ({ band, target, liveAsk, openingBlocked, operationBusy, openSession, dispatched }: GateBandProps) => {
  switch (band) {
    case 'none':
      return null
    case 'spec-freeze':
      return (
        <section className="gate-band" aria-label={SPEC_FREEZE_GATE_HEADING}>
          <SpecFreezePanel target={target} operationBusy={operationBusy} />
        </section>
      )
    case 'epic-groom':
      return (
        <section className="gate-band" aria-label={EPIC_GROOM_GATE_HEADING}>
          <EpicGroomPanel
            target={target}
            liveAsk={liveAsk}
            openingBlocked={openingBlocked}
            operationBusy={operationBusy}
            openSession={openSession}
            dispatched={dispatched}
          />
        </section>
      )
  }
}

export { GateBand }
export type { GateBandProps }
