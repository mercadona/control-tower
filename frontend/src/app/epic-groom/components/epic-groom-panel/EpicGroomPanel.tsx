import { EpicGroomOutcome, EpicIssue, GroomPlanIssue } from 'app/epic-groom/EpicGroom.types'
import { useEpicGroom } from 'app/epic-groom/useEpicGroom'
import { useGatePresses } from 'app/epic-groom/useGatePresses'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { Panel } from 'system-ui/panel'
import './EpicGroomPanel.css'

const HEADING = 'Puerta 2 · El groom y la autorización'
const WILL_CREATE = 'Se van a crear estas issues'
const GROOM = 'Ejecutar el groom'
const GROOMING = 'Ejecutando el groom'
const OPEN_SESSION = 'Revisar el slicing con la sesión'
const OPENING_SESSION = 'Abriendo la sesión'
const SESSION_OPENED = 'Sesión del groom abierta: habla con ella en el panel de sesiones.'
const SESSION_UNCONFIRMED_TITLE = 'No se ha podido confirmar la apertura de la sesión'
const SESSION_UNCONFIRMED_DETAIL = 'Mira el panel de sesiones: puede estar abierta.'
const CREATED = 'Issues del epic'
const PROMOTE = 'Autorizar el trabajo'
const PROMOTING = 'Autorizando el trabajo'
const AUTHORISED = 'Trabajo autorizado: el loop ya puede despachar el primer slice.'
const FINISH_GROOM_FIRST = 'Termina el groom antes de autorizar el trabajo.'
const ONLY_FROM_THE_PAGE = 'Esta puerta solo se abre desde la página que sirve el backend.'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
const ISSUES_UNCERTAIN_TITLE = 'No se ha podido leer completa la lista de issues del epic'
const AWAITING_MERGE = 'El spec congelado espera en un pull request: mergéalo para abrir el groom.'
const AWAITING_WITHOUT_PULL_REQUEST =
  'El spec congelado sigue sin publicar y no se ha encontrado ningún pull request abierto para su rama.'
const PULL_REQUEST = 'Pull request'

const NOTHING_TO_SHOW_KINDS: readonly EpicGroomOutcome['kind'][] = [
  'none',
  'no-spec',
  'draft',
  'unavailable',
]

const KEYED_KINDS: readonly EpicGroomOutcome['kind'][] = ['groomable', 'partially-groomed', 'groomed']

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
  const gateKey = read.phase === 'read' && KEYED_KINDS.includes(read.kind) && 'key' in read ? read.key : null
  const presses = useGatePresses(gateKey)
  const { acted, refusal, session } = presses

  if (read.phase === 'connecting') return null
  if (acted === null && NOTHING_TO_SHOW_KINDS.includes(read.kind)) return null
  if (acted === null && read.kind === 'refused') {
    return (
      <Panel heading={HEADING}>
        <Banner type="error" role="alert" title={read.error} />
      </Panel>
    )
  }
  if (acted === null && read.kind === 'issues-uncertain') {
    return (
      <Panel heading={HEADING}>
        <Banner type="warning" role="alert" title={ISSUES_UNCERTAIN_TITLE} description={read.reason} />
      </Panel>
    )
  }

  if (acted === null && read.kind === 'awaiting-publication') {
    const { pullRequest } = read
    return (
      <Panel heading={HEADING}>
        <p className="epic-groom-panel__awaiting">
          {pullRequest === null ? AWAITING_WITHOUT_PULL_REQUEST : AWAITING_MERGE}
        </p>
        {pullRequest !== null && (
          <a className="epic-groom-panel__pull-request" href={pullRequest.url}>
            {`${PULL_REQUEST} #${pullRequest.number}`}
          </a>
        )}
      </Panel>
    )
  }

  const isPressing = presses.pressed !== 'none'

  const gateNotice = gateKey === null && (
    <p className="epic-groom-panel__only-from-the-page">{ONLY_FROM_THE_PAGE}</p>
  )
  const askBanner =
    refusal?.kind === 'refused' ? (
      <Banner type="error" role="alert" title={refusal.error} />
    ) : refusal?.kind === 'backend-unreachable' ? (
      <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />
    ) : null
  const sessionNotice =
    session?.kind === 'opened' ? (
      <p className="epic-groom-panel__session-opened">{SESSION_OPENED}</p>
    ) : session?.kind === 'refused' ? (
      <Banner type="error" role="alert" title={session.error} />
    ) : session?.kind === 'unconfirmed' ? (
      <Banner
        type="warning"
        role="alert"
        title={SESSION_UNCONFIRMED_TITLE}
        description={SESSION_UNCONFIRMED_DETAIL}
      />
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
        <Button onClick={() => void presses.groom(planFingerprint)} disabled={gateKey === null || isPressing}>
          {presses.pressed === 'groom' ? GROOMING : GROOM}
        </Button>
        <Button onClick={() => void presses.openSession()} disabled={gateKey === null || isPressing}>
          {presses.pressed === 'session' ? OPENING_SESSION : OPEN_SESSION}
        </Button>
        {sessionNotice}
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
        <Button onClick={() => void presses.groom(planFingerprint)} disabled={gateKey === null || isPressing}>
          {presses.pressed === 'groom' ? GROOMING : GROOM}
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
        <Button onClick={() => void presses.promote()} disabled={gateKey === null || isPressing}>
          {presses.pressed === 'promote' ? PROMOTING : PROMOTE}
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
