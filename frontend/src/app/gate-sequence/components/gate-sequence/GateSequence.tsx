import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { LiveAsk } from 'app/coordinating-session/CoordinatingSession.types'
import { GroomSessionOutcome } from 'app/epic-groom/EpicGroom.types'
import {
  EPIC_GROOM_GATE_HEADING,
  EPIC_GROOM_NOTHING_TO_SHOW_KINDS,
  EpicGroomPanel,
} from 'app/epic-groom/components/epic-groom-panel'
import { EpicGroomRead } from 'app/epic-groom/useEpicGroom'
import { SPEC_FREEZE_GATE_HEADING, SpecFreezePanel } from 'app/spec-freeze/components/spec-freeze-panel'
import { SpecFreezeGateSummary } from 'app/spec-freeze/SpecFreeze.types'
import { SpecFreezeRead } from 'app/spec-freeze/useSpecFreeze'
import { CollapsableCard } from 'system-ui/collapsable-card'
import './GateSequence.css'

const PULL_REQUEST = 'Pull request'
const NO_ROOM: CSSProperties = { display: 'none' }

const gate1Subtitle = (summary: Extract<SpecFreezeGateSummary, { kind: 'frozen' }>): string => {
  const on = summary.on === null ? 'sin fecha' : `el ${summary.on}`
  const pullRequest = summary.pullRequest === null ? '' : ` · ${PULL_REQUEST} #${summary.pullRequest.number}`
  return `Completada ${on}${pullRequest}`
}

type GateSequenceProps = {
  specFreezeRead: SpecFreezeRead
  epicGroomRead: EpicGroomRead
  target: string | null
  liveAsk: LiveAsk | null
  openingBlocked: boolean
  operationBusy: boolean
  openSession: (key: string, target: string) => Promise<GroomSessionOutcome>
  dispatched?: number
}

const GateSequence = ({
  specFreezeRead, epicGroomRead, target, liveAsk, openingBlocked, operationBusy, openSession, dispatched = 0,
}: GateSequenceProps) => {
  const [gate1ManualExpanded, setGate1ManualExpanded] = useState<boolean | null>(null)
  const [gate2ManualExpanded, setGate2ManualExpanded] = useState<boolean | null>(null)

  const gate1Summary: SpecFreezeGateSummary =
    specFreezeRead.phase === 'read' && specFreezeRead.kind === 'frozen'
      ? { kind: 'frozen', on: specFreezeRead.on, pullRequest: specFreezeRead.pullRequest }
      : specFreezeRead.phase === 'read' && (specFreezeRead.kind === 'draft' || specFreezeRead.kind === 'refused')
        ? { kind: 'active' }
        : { kind: 'hidden' }

  const epicGroomKind = epicGroomRead.phase === 'read' ? epicGroomRead.kind : null
  const isGate2Visible = epicGroomKind !== null && !EPIC_GROOM_NOTHING_TO_SHOW_KINDS.includes(epicGroomKind)
  const isGate2Actionable = isGate2Visible && epicGroomKind !== 'awaiting-publication'
  const isGate2Authorised = epicGroomKind === 'authorised'

  useEffect(() => setGate1ManualExpanded(null), [isGate2Visible])
  useEffect(() => setGate2ManualExpanded(null), [isGate2Authorised])

  const gate1DefaultExpanded = gate1Summary.kind !== 'frozen' || !isGate2Visible
  const gate1Expanded = gate1ManualExpanded ?? gate1DefaultExpanded

  const gate2DefaultExpanded = !isGate2Authorised
  const gate2Expanded = gate2ManualExpanded ?? gate2DefaultExpanded

  const nothingToShow = gate1Summary.kind === 'hidden' && !isGate2Visible

  return (
    <div className="gate-sequence" hidden={nothingToShow} style={nothingToShow ? NO_ROOM : undefined}>
      <CollapsableCard
        heading={SPEC_FREEZE_GATE_HEADING}
        subtitle={gate1Summary.kind === 'frozen' ? gate1Subtitle(gate1Summary) : undefined}
        expanded={gate1Expanded}
        onToggle={setGate1ManualExpanded}
        hidden={gate1Summary.kind === 'hidden'}
      >
        <SpecFreezePanel isGate2Actionable={isGate2Actionable} target={target} operationBusy={operationBusy} />
      </CollapsableCard>
      <CollapsableCard
        heading={EPIC_GROOM_GATE_HEADING}
        expanded={gate2Expanded}
        onToggle={setGate2ManualExpanded}
        hidden={!isGate2Visible}
      >
        <EpicGroomPanel
          target={target}
          liveAsk={liveAsk}
          openingBlocked={openingBlocked}
          operationBusy={operationBusy}
          openSession={openSession}
          dispatched={dispatched}
        />
      </CollapsableCard>
    </div>
  )
}

export { GateSequence }
