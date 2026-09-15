import { useEffect, useState } from 'react'
import { OpenedCoordinatingSession } from 'app/coordinating-session/CoordinatingSession.types'
import {
  EPIC_GROOM_GATE_HEADING,
  EPIC_GROOM_NOTHING_TO_SHOW_KINDS,
  EpicGroomPanel,
} from 'app/epic-groom/components/epic-groom-panel'
import { useEpicGroom } from 'app/epic-groom/useEpicGroom'
import { SPEC_FREEZE_GATE_HEADING, SpecFreezePanel } from 'app/spec-freeze/components/spec-freeze-panel'
import { SpecFreezeGateSummary } from 'app/spec-freeze/SpecFreeze.types'
import { useSpecFreeze } from 'app/spec-freeze/useSpecFreeze'
import { CollapsableCard } from 'system-ui/collapsable-card'
import './GateSequence.css'

const PULL_REQUEST = 'Pull request'

const gate1Subtitle = (summary: Extract<SpecFreezeGateSummary, { kind: 'frozen' }>): string => {
  const on = summary.on === null ? 'sin fecha' : `el ${summary.on}`
  const pullRequest = summary.pullRequest === null ? '' : ` · ${PULL_REQUEST} #${summary.pullRequest.number}`
  return `Completada ${on}${pullRequest}`
}

type GateSequenceProps = { onSessionOpened: (opened: OpenedCoordinatingSession) => void }

const GateSequence = ({ onSessionOpened }: GateSequenceProps) => {
  const specFreezeRead = useSpecFreeze()
  const epicGroomRead = useEpicGroom()
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

  return (
    <div className="gate-sequence">
      <CollapsableCard
        heading={SPEC_FREEZE_GATE_HEADING}
        subtitle={gate1Summary.kind === 'frozen' ? gate1Subtitle(gate1Summary) : undefined}
        expanded={gate1Expanded}
        onToggle={setGate1ManualExpanded}
        hidden={gate1Summary.kind === 'hidden'}
      >
        <SpecFreezePanel isGate2Actionable={isGate2Actionable} />
      </CollapsableCard>
      <CollapsableCard
        heading={EPIC_GROOM_GATE_HEADING}
        expanded={gate2Expanded}
        onToggle={setGate2ManualExpanded}
        hidden={!isGate2Visible}
      >
        <EpicGroomPanel onSessionOpened={onSessionOpened} />
      </CollapsableCard>
    </div>
  )
}

export { GateSequence }
