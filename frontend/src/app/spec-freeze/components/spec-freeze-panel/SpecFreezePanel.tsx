import { useRef, useState } from 'react'
import { SpecFreezeClient } from 'app/spec-freeze/client'
import { FreezeAskOutcome, FreezeFinding } from 'app/spec-freeze/SpecFreeze.types'
import { useSpecFreeze } from 'app/spec-freeze/useSpecFreeze'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { GateLayout, GateLink, GateList, GateListItem, GateNotice } from 'system-ui/gate-layout'

const SPEC_FREEZE_GATE_HEADING = 'Puerta 1 · Congelación del spec'
const BLOCKED = 'La vara todavía no deja congelar'
const READY = 'El spec está listo para congelar'
const FINDING: Record<string, string> = {
  'clarification-marker': 'Marcador de clarificación sin resolver',
  'hypothesis-absent': 'El spec no tiene sección «## Hipótesis»',
  'hypothesis-empty': 'La sección «## Hipótesis» está vacía',
  'decision-without-provenance': 'Decisión congelada sin procedencia',
  'scope-absent': 'El contexto del milestone no declara «Alcance:», la línea que lee el gate de alcance en cada issue',
}
const FREEZE = 'Congelar el spec'
const FREEZING = 'Congelando el spec'
const ONLY_FROM_THE_PAGE = 'Esta puerta solo se abre desde la página que sirve el backend.'
const NO_COORDINATING_SESSION = 'No hay ninguna sesión coordinadora abierta: ábrela para actuar en esta puerta.'
const FROZEN = 'Spec congelado el'
const FROZEN_UNDATED = 'Spec congelado, sin fecha en la línea de congelación.'
const PULL_REQUEST = 'Pull request'
const WAITING = 'El spec ya vive en este pull request: mergéalo para continuar al groom.'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

const findingCount = (count: number): string =>
  count === 1 ? '1 hallazgo por resolver' : `${count} hallazgos por resolver`

const findingLabel = (finding: FreezeFinding): string =>
  finding.line === null ? FINDING[finding.code] : `${FINDING[finding.code]}, línea ${finding.line}: ${finding.detail}`

interface SpecFreezePanelProps {
  isGate2Actionable?: boolean
  target: string | null
  operationBusy?: boolean
}

const SpecFreezePanel = ({ isGate2Actionable = false, target, operationBusy = false }: SpecFreezePanelProps) => {
  const read = useSpecFreeze(target)
  const [asked, setAsked] = useState<FreezeAskOutcome | null>(null)
  const [isFreezing, setIsFreezing] = useState(false)
  const isFreezingRef = useRef(false)
  const frozen = asked?.kind === 'frozen' ? asked : read.phase === 'read' && read.kind === 'frozen' ? read : null

  if (frozen !== null) {
    return (
      <GateLayout heading={frozen.on === null ? FROZEN_UNDATED : `${FROZEN} ${frozen.on}.`}>
        {(!isGate2Actionable || frozen.pullRequest !== null) && (
          <GateNotice>
            {!isGate2Actionable && <span>{WAITING}</span>}
            {!isGate2Actionable && frozen.pullRequest !== null && ' '}
            {frozen.pullRequest !== null && (
              <GateLink href={frozen.pullRequest.url}>{`${PULL_REQUEST} #${frozen.pullRequest.number}`}</GateLink>
            )}
          </GateNotice>
        )}
      </GateLayout>
    )
  }

  if (read.phase === 'connecting') return null
  if (read.kind === 'refused') {
    return (
      <Banner type="error" role="alert" title={read.error} />
    )
  }
  if (read.kind !== 'draft') return null

  const { spec, findings, key: gateKey } = read
  const isBlocked = findings.length > 0
  const isDisabled = isBlocked || gateKey === null || target === null || isFreezing || operationBusy

  const freezeSpec = async () => {
    if (gateKey === null || target === null || operationBusy || isFreezingRef.current) return
    isFreezingRef.current = true
    setIsFreezing(true)
    try {
      setAsked(await SpecFreezeClient.freeze(gateKey, target))
    } finally {
      isFreezingRef.current = false
      setIsFreezing(false)
    }
  }

  return (
    <GateLayout
      heading={isBlocked ? BLOCKED : READY}
      actions={
        <Button onClick={() => void freezeSpec()} disabled={isDisabled}>
          {isFreezing ? FREEZING : FREEZE}
        </Button>
      }
    >
      <GateNotice>{isBlocked ? `${spec} · ${findingCount(findings.length)}` : spec}</GateNotice>
      {isBlocked && (
        <GateList>
          {findings.map((finding, index) => (
            <GateListItem key={index}>{findingLabel(finding)}</GateListItem>
          ))}
        </GateList>
      )}
      {gateKey === null && <GateNotice>{ONLY_FROM_THE_PAGE}</GateNotice>}
      {target === null && <GateNotice>{NO_COORDINATING_SESSION}</GateNotice>}
      {asked?.kind === 'refused' && <Banner type="error" role="alert" title={asked.error} />}
      {asked?.kind === 'backend-unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </GateLayout>
  )
}

export { SpecFreezePanel, SPEC_FREEZE_GATE_HEADING }
