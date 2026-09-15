import { useRef, useState } from 'react'
import { EpicGroomClient } from 'app/epic-groom/client'
import { EpicGroomAskOutcome, EpicGroomOutcome, EpicIssue, GroomPlanIssue } from 'app/epic-groom/EpicGroom.types'
import { useEpicGroom } from 'app/epic-groom/useEpicGroom'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { Panel } from 'system-ui/panel'
import './EpicGroomPanel.css'

const HEADING = 'Puerta 2 · El groom y la autorización'
const WILL_CREATE = 'Se van a crear estas issues'
const GROOM = 'Ejecutar el groom'
const GROOMING = 'Ejecutando el groom'
const CREATED = 'Issues del epic'
const PROMOTE = 'Autorizar el trabajo'
const PROMOTING = 'Autorizando el trabajo'
const AUTHORISED = 'Trabajo autorizado: el loop ya puede despachar el primer slice.'
const FINISH_GROOM_FIRST = 'Termina el groom antes de autorizar el trabajo.'
const ONLY_FROM_THE_PAGE = 'Esta puerta solo se abre desde la página que sirve el backend.'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

const NOTHING_TO_SHOW_KINDS: readonly EpicGroomOutcome['kind'][] = [
  'none',
  'no-spec',
  'draft',
  'awaiting-publication',
  'unavailable',
]

type EpicGroomActed = Extract<EpicGroomAskOutcome, { kind: 'acted' }>
type EpicGroomAskRefusal = Exclude<EpicGroomAskOutcome, { kind: 'acted' }>

const planCount = (count: number): string => `${count} issues`
const partialCount = (existing: number, planned: number): string => `${existing} de ${planned} issues creadas`
const planItem = (issue: GroomPlanIssue): string => `#${issue.order} · ${issue.title}`
const issueItem = (issue: EpicIssue): string => `#${issue.number} · ${issue.title}`

const EpicGroomPanelLabels = {
  planCount,
  partialCount,
  planItem,
  issueItem,
}

const EpicGroomPanel = () => {
  const read = useEpicGroom()
  const [acted, setActed] = useState<EpicGroomActed | null>(null)
  const [refusal, setRefusal] = useState<EpicGroomAskRefusal | null>(null)
  const [isPressing, setIsPressing] = useState(false)
  const isPressingRef = useRef(false)

  if (read.phase === 'connecting') return null
  if (acted === null && NOTHING_TO_SHOW_KINDS.includes(read.kind)) return null
  if (acted === null && read.kind === 'refused') {
    return (
      <Panel heading={HEADING}>
        <Banner type="error" role="alert" title={read.error} />
      </Panel>
    )
  }

  const gateKey =
    read.kind === 'groomable' || read.kind === 'partially-groomed' || read.kind === 'groomed' ? read.key : null

  const settle = (answered: EpicGroomAskOutcome) => {
    isPressingRef.current = false
    setIsPressing(false)
    if (answered.kind === 'acted') {
      setActed(answered)
      setRefusal(null)
    } else {
      setRefusal(answered)
    }
  }

  const pressGroom = async (planFingerprint: string) => {
    if (gateKey === null || isPressingRef.current) return
    isPressingRef.current = true
    setIsPressing(true)
    settle(await EpicGroomClient.groom(gateKey, planFingerprint))
  }

  const pressPromote = async () => {
    if (gateKey === null || isPressingRef.current) return
    isPressingRef.current = true
    setIsPressing(true)
    settle(await EpicGroomClient.promote(gateKey))
  }

  const gateNotice = gateKey === null && (
    <p className="epic-groom-panel__only-from-the-page">{ONLY_FROM_THE_PAGE}</p>
  )
  const askBanner =
    refusal?.kind === 'refused' ? (
      <Banner type="error" role="alert" title={refusal.error} />
    ) : refusal?.kind === 'backend-unreachable' ? (
      <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />
    ) : null

  if (acted === null && read.kind === 'groomable') {
    const { milestone, plan, planFingerprint } = read
    return (
      <Panel heading={HEADING}>
        <p className="epic-groom-panel__milestone">{milestone}</p>
        <p className="epic-groom-panel__will-create">{WILL_CREATE}</p>
        <p className="epic-groom-panel__count">{EpicGroomPanelLabels.planCount(plan.length)}</p>
        <ul className="epic-groom-panel__plan">
          {plan.map((issue) => (
            <li key={issue.order} className="epic-groom-panel__plan-item">
              <span className="epic-groom-panel__plan-title">{EpicGroomPanelLabels.planItem(issue)}</span>
              <span className="epic-groom-panel__plan-labels">{issue.labels.join(', ')}</span>
            </li>
          ))}
        </ul>
        <Button onClick={() => void pressGroom(planFingerprint)} disabled={gateKey === null || isPressing}>
          {isPressing ? GROOMING : GROOM}
        </Button>
        {gateNotice}
        {askBanner}
      </Panel>
    )
  }

  if (acted === null && read.kind === 'partially-groomed') {
    const { milestone, plan, issues, planFingerprint } = read
    return (
      <Panel heading={HEADING}>
        <p className="epic-groom-panel__milestone">{milestone}</p>
        <p className="epic-groom-panel__partial-count">{EpicGroomPanelLabels.partialCount(issues.length, plan.length)}</p>
        <ul className="epic-groom-panel__issues">
          {issues.map((issue) => (
            <li key={issue.number} className="epic-groom-panel__issue">
              <span className="epic-groom-panel__issue-title">{EpicGroomPanelLabels.issueItem(issue)}</span>
              <span className="epic-groom-panel__issue-status">{issue.status}</span>
            </li>
          ))}
        </ul>
        <p className="epic-groom-panel__partial-notice">{FINISH_GROOM_FIRST}</p>
        <Button onClick={() => void pressGroom(planFingerprint)} disabled={gateKey === null || isPressing}>
          {isPressing ? GROOMING : GROOM}
        </Button>
        {gateNotice}
        {askBanner}
      </Panel>
    )
  }

  const groomedIssues =
    acted !== null && acted.status === 'groomed'
      ? acted.issues
      : acted === null && read.kind === 'groomed'
        ? read.issues
        : null

  if (groomedIssues !== null) {
    return (
      <Panel heading={HEADING}>
        <p className="epic-groom-panel__created">{CREATED}</p>
        <ul className="epic-groom-panel__issues">
          {groomedIssues.map((issue) => (
            <li key={issue.number} className="epic-groom-panel__issue">
              <span className="epic-groom-panel__issue-title">{EpicGroomPanelLabels.issueItem(issue)}</span>
              <span className="epic-groom-panel__issue-status">{issue.status}</span>
            </li>
          ))}
        </ul>
        <Button onClick={() => void pressPromote()} disabled={gateKey === null || isPressing}>
          {isPressing ? PROMOTING : PROMOTE}
        </Button>
        {gateNotice}
        {askBanner}
      </Panel>
    )
  }

  const authorisedIssues =
    acted !== null && acted.status === 'authorised'
      ? acted.issues
      : acted === null && read.kind === 'authorised'
        ? read.issues
        : null

  if (authorisedIssues !== null) {
    return (
      <Panel heading={HEADING}>
        <ul className="epic-groom-panel__issues">
          {authorisedIssues.map((issue) => (
            <li key={issue.number} className="epic-groom-panel__issue">
              <span className="epic-groom-panel__issue-title">{EpicGroomPanelLabels.issueItem(issue)}</span>
              <span className="epic-groom-panel__issue-status">{issue.status}</span>
            </li>
          ))}
        </ul>
        <p className="epic-groom-panel__authorised">{AUTHORISED}</p>
      </Panel>
    )
  }

  return null
}

export { EpicGroomPanel }
