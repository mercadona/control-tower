import { useRef, useState } from 'react'
import { SpecFreezeClient } from 'app/spec-freeze/client'
import { FreezeAskOutcome, FreezeFinding } from 'app/spec-freeze/SpecFreeze.types'
import { useSpecFreeze } from 'app/spec-freeze/useSpecFreeze'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { Panel } from 'system-ui/panel'
import './SpecFreezePanel.css'

const HEADING = 'Puerta 1 · Congelación del spec'
const BLOCKED = 'La vara todavía no deja congelar'
const FINDING: Record<string, string> = {
  'clarification-marker': 'Marcador de clarificación sin resolver',
  'hypothesis-absent': 'El spec no tiene sección «## Hipótesis»',
  'hypothesis-empty': 'La sección «## Hipótesis» está vacía',
  'decision-without-provenance': 'Decisión congelada sin procedencia',
}
const FREEZE = 'Congelar el spec'
const FREEZING = 'Congelando el spec'
const ONLY_FROM_THE_PAGE = 'Esta puerta solo se abre desde la página que sirve el backend.'
const FROZEN = 'Spec congelado el'
const FROZEN_UNDATED = 'Spec congelado, sin fecha en la línea de congelación.'
const PULL_REQUEST = 'Pull request'
const WAITING = 'El groom espera al merge de este pull request.'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

const findingLabel = (finding: FreezeFinding): string =>
  finding.line === null ? FINDING[finding.code] : `${FINDING[finding.code]}, línea ${finding.line}: ${finding.detail}`

const SpecFreezePanel = () => {
  const read = useSpecFreeze()
  const [asked, setAsked] = useState<FreezeAskOutcome | null>(null)
  const [isFreezing, setIsFreezing] = useState(false)
  const isFreezingRef = useRef(false)

  const frozen = asked?.kind === 'frozen' ? asked : read.phase === 'read' && read.kind === 'frozen' ? read : null

  if (frozen !== null) {
    return (
      <Panel heading={HEADING}>
        <p className="spec-freeze-panel__frozen">{frozen.on === null ? FROZEN_UNDATED : `${FROZEN} ${frozen.on}.`}</p>
        {frozen.pullRequest !== null && (
          <a className="spec-freeze-panel__pull-request" href={frozen.pullRequest.url}>
            {`${PULL_REQUEST} #${frozen.pullRequest.number}`}
          </a>
        )}
        <p className="spec-freeze-panel__waiting">{WAITING}</p>
      </Panel>
    )
  }

  if (read.phase === 'connecting') return null
  if (read.kind === 'refused') {
    return (
      <Panel heading={HEADING}>
        <Banner type="error" role="alert" title={read.error} />
      </Panel>
    )
  }
  if (read.kind !== 'draft') return null

  const { findings, key: gateKey } = read
  const isBlocked = findings.length > 0
  const isDisabled = isBlocked || gateKey === null || isFreezing

  const freezeSpec = async () => {
    if (gateKey === null || isFreezingRef.current) return
    isFreezingRef.current = true
    setIsFreezing(true)
    const answered = await SpecFreezeClient.freeze(gateKey)
    isFreezingRef.current = false
    setIsFreezing(false)
    setAsked(answered)
  }

  return (
    <Panel heading={HEADING}>
      {isBlocked && (
        <>
          <p className="spec-freeze-panel__blocked">{BLOCKED}</p>
          <ul className="spec-freeze-panel__findings">
            {findings.map((finding, index) => (
              <li key={index} className="spec-freeze-panel__finding">
                {findingLabel(finding)}
              </li>
            ))}
          </ul>
        </>
      )}
      <Button onClick={() => void freezeSpec()} disabled={isDisabled}>
        {isFreezing ? FREEZING : FREEZE}
      </Button>
      {gateKey === null && <p className="spec-freeze-panel__only-from-the-page">{ONLY_FROM_THE_PAGE}</p>}
      {asked?.kind === 'refused' && <Banner type="error" role="alert" title={asked.error} />}
      {asked?.kind === 'backend-unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </Panel>
  )
}

export { SpecFreezePanel }
