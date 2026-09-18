import { EpicGroomOutcome, EpicIssue, GroomPlanIssue } from 'app/epic-groom/EpicGroom.types'
import { useEpicGroom } from 'app/epic-groom/useEpicGroom'
import { useGatePresses } from 'app/epic-groom/useGatePresses'
import { useMergedReslicing } from 'app/epic-groom/useMergedReslicing'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import './EpicGroomPanel.css'

const EPIC_GROOM_GATE_HEADING = 'Puerta 2 · El groom y la autorización'
const WILL_CREATE = 'Se van a crear estas issues'
const GROOM = 'Ejecutar el groom'
const GROOMING = 'Ejecutando el groom'
const OPEN_SESSION = 'Revisar el slicing con la sesión'
const OPENING_SESSION = 'Abriendo la sesión'
const SESSION_OPENED = 'Sesión del groom abierta: habla con ella en el panel de sesiones.'
const SESSION_UNCONFIRMED_TITLE = 'No se ha podido confirmar la apertura de la sesión'
const SESSION_UNCONFIRMED_DETAIL = 'Mira el panel de sesiones: puede estar abierta.'
const RESLICING_UNCONFIRMED_TITLE = 'No se ha podido confirmar la publicación del nuevo slicing'
const RESLICING_UNCONFIRMED_DETAIL = 'Puede haberse publicado: la página lo dirá en cuanto lo sepa.'
const RESLICED =
  'La sesión ha cambiado el slicing del spec. Publícalo en un pull request: al mergearlo se crearán las issues.'
const PUBLISH_RESLICING = 'Publicar el nuevo slicing'
const PUBLISHING_RESLICING = 'Publicando el nuevo slicing'
const RESLICING_PUBLISHED = 'El nuevo slicing viaja en este pull request: mergéalo y las issues se crearán solas.'
const RESLICING_MERGED =
  'El nuevo slicing se aprobó al mergear su pull request: las issues se crean sin pulsar nada.'
const CREATED = 'Issues del epic'
const PROMOTE = 'Autorizar el trabajo'
const PROMOTING = 'Autorizando el trabajo'
const AUTHORISED = 'Trabajo autorizado: el loop ya puede despachar el primer slice.'
const FINISH_GROOM_FIRST = 'Termina el groom antes de autorizar el trabajo.'
const ONLY_FROM_THE_PAGE = 'Esta puerta solo se abre desde la página que sirve el backend.'
const GROOM_UNCONFIRMED_TITLE = 'No se ha podido confirmar el groom'
const GROOM_UNCONFIRMED_DETAIL = 'Puede seguir en marcha: no lo vuelvas a pulsar. La página lo dirá en cuanto lo sepa.'
const ISSUES_UNCERTAIN_TITLE = 'No se ha podido leer completa la lista de issues del epic'
const AWAITING_MERGE = 'El spec congelado espera en un pull request: mergéalo para abrir el groom.'
const AWAITING_WITHOUT_PULL_REQUEST =
  'El spec congelado sigue sin publicar y no se ha encontrado ningún pull request abierto para su rama.'
const PULL_REQUEST = 'Pull request'

const EPIC_GROOM_NOTHING_TO_SHOW_KINDS: readonly EpicGroomOutcome['kind'][] = [
  'none',
  'no-spec',
  'draft',
  'unavailable',
]

const KEYED_KINDS: readonly EpicGroomOutcome['kind'][] = [
  'resliced', 'groomable', 'partially-groomed', 'groomed',
]

const planCount = (count: number): string => `${count} issues`
const partialCount = (existing: number, planned: number): string => `${existing} de ${planned} issues creadas`
const planItem = (issue: GroomPlanIssue, home: string): string =>
  issue.repo === home ? `#${issue.order} · ${issue.title}` : `#${issue.order} · ${issue.title} · ${issue.repo}`
const issueItem = (issue: EpicIssue): string => `#${issue.number} · ${issue.title}`

const EpicGroomPanelLabels = {
  planCount,
  partialCount,
  planItem,
  issueItem,
}

type EpicGroomPanelProps = {
  target: string
  openingBlocked: boolean
  operationBusy: boolean
  openSession: (key: string, target: string) => Promise<import('app/epic-groom/EpicGroom.types').GroomSessionOutcome>
}

const EpicGroomPanel = ({ target, openingBlocked, operationBusy, openSession }: EpicGroomPanelProps) => {
  const presses = useGatePresses({ target, openingBlocked, operationBusy, openSession })
  const { acted, refusal, session, reslicing } = presses
  const isReviewingTheSlicing = session?.kind === 'opened' || refusal?.kind === 'unconfirmed'
  const read = useEpicGroom(isReviewingTheSlicing, target)
  const gateKey = read.phase === 'read' && KEYED_KINDS.includes(read.kind) && 'key' in read ? read.key : null
  useMergedReslicing({ read, operationBusy, press: (planFingerprint) => presses.groom(gateKey, planFingerprint) })

  if (read.phase === 'connecting') return null
  if (acted === null && EPIC_GROOM_NOTHING_TO_SHOW_KINDS.includes(read.kind)) return null
  if (acted === null && read.kind === 'refused') {
    return (
      <div className="epic-groom-panel">
        <Banner type="error" role="alert" title={read.error} />
      </div>
    )
  }
  if (acted === null && read.kind === 'issues-uncertain') {
    return (
      <div className="epic-groom-panel">
        <Banner type="warning" role="alert" title={ISSUES_UNCERTAIN_TITLE} description={read.reason} />
      </div>
    )
  }

  if (acted === null && read.kind === 'awaiting-publication') {
    const { pullRequest } = read
    return (
      <div className="epic-groom-panel">
        <p className="epic-groom-panel__awaiting">
          {pullRequest === null ? AWAITING_WITHOUT_PULL_REQUEST : AWAITING_MERGE}
        </p>
        {pullRequest !== null && (
          <a className="epic-groom-panel__pull-request" href={pullRequest.url}>
            {`${PULL_REQUEST} #${pullRequest.number}`}
          </a>
        )}
      </div>
    )
  }

  const isPressing = presses.pressed !== 'none'

  const gateNotice = gateKey === null && (
    <p className="epic-groom-panel__only-from-the-page">{ONLY_FROM_THE_PAGE}</p>
  )
  const askBanner =
    refusal?.kind === 'refused' ? (
      <Banner type="error" role="alert" title={refusal.error} />
    ) : refusal?.kind === 'unconfirmed' ? (
      <Banner
        type="warning"
        role="alert"
        title={GROOM_UNCONFIRMED_TITLE}
        description={GROOM_UNCONFIRMED_DETAIL}
      />
    ) : null
  const reslicingBanner =
    reslicing?.kind === 'refused' ? (
      <Banner type="error" role="alert" title={reslicing.error} />
    ) : reslicing?.kind === 'unconfirmed' ? (
      <Banner
        type="warning"
        role="alert"
        title={RESLICING_UNCONFIRMED_TITLE}
        description={RESLICING_UNCONFIRMED_DETAIL}
      />
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

  if (acted === null && read.kind === 'resliced') {
    return (
      <div className="epic-groom-panel">
        <p className="epic-groom-panel__resliced">{RESLICED}</p>
        <Button onClick={() => void presses.publishReslicing(gateKey)} disabled={gateKey === null || isPressing || operationBusy}>
          {presses.pressed === 'reslicing' ? PUBLISHING_RESLICING : PUBLISH_RESLICING}
        </Button>
        {reslicing?.kind === 'published' && (
          <>
            <p className="epic-groom-panel__reslicing-published">{RESLICING_PUBLISHED}</p>
            <a className="epic-groom-panel__pull-request" href={reslicing.pullRequest.url}>
              {`${PULL_REQUEST} #${reslicing.pullRequest.number}`}
            </a>
          </>
        )}
        {gateNotice}
        {reslicingBanner}
      </div>
    )
  }

  if (acted === null && read.kind === 'groomable') {
    const { milestone, plan, home, planFingerprint, reslicing: merged } = read
    return (
      <div className="epic-groom-panel">
        <p className="epic-groom-panel__milestone">{milestone}</p>
        <p className="epic-groom-panel__will-create">{WILL_CREATE}</p>
        <p className="epic-groom-panel__count">{EpicGroomPanelLabels.planCount(plan.length)}</p>
        <ul className="epic-groom-panel__plan">
          {plan.map((issue) => (
            <li key={issue.order} className="epic-groom-panel__plan-item">
              <span className="epic-groom-panel__plan-title">{EpicGroomPanelLabels.planItem(issue, home)}</span>
              <span className="epic-groom-panel__plan-labels">{issue.labels.join(', ')}</span>
            </li>
          ))}
        </ul>
        {merged !== null && (
          <>
            <p className="epic-groom-panel__reslicing-merged">{RESLICING_MERGED}</p>
            <a className="epic-groom-panel__pull-request" href={merged.url}>
              {`${PULL_REQUEST} #${merged.number}`}
            </a>
          </>
        )}
        <Button onClick={() => void presses.openSession(gateKey)} disabled={gateKey === null || isPressing || openingBlocked || operationBusy}>
          {presses.pressed === 'session' ? OPENING_SESSION : OPEN_SESSION}
        </Button>
        <Button onClick={() => void presses.groom(gateKey, planFingerprint)} disabled={gateKey === null || isPressing || operationBusy}>
          {presses.pressed === 'groom' ? GROOMING : GROOM}
        </Button>
        {sessionNotice}
        {gateNotice}
        {askBanner}
      </div>
    )
  }

  if (acted === null && read.kind === 'partially-groomed') {
    const { milestone, plan, issues, planFingerprint } = read
    return (
      <div className="epic-groom-panel">
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
        <Button onClick={() => void presses.groom(gateKey, planFingerprint)} disabled={gateKey === null || isPressing || operationBusy}>
          {presses.pressed === 'groom' ? GROOMING : GROOM}
        </Button>
        {gateNotice}
        {askBanner}
      </div>
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
      <div className="epic-groom-panel">
        <p className="epic-groom-panel__created">{CREATED}</p>
        <ul className="epic-groom-panel__issues">
          {groomedIssues.map((issue) => (
            <li key={issue.number} className="epic-groom-panel__issue">
              <span className="epic-groom-panel__issue-title">{EpicGroomPanelLabels.issueItem(issue)}</span>
              <span className="epic-groom-panel__issue-status">{issue.status}</span>
            </li>
          ))}
        </ul>
        <Button onClick={() => void presses.promote(gateKey)} disabled={gateKey === null || isPressing || operationBusy}>
          {presses.pressed === 'promote' ? PROMOTING : PROMOTE}
        </Button>
        {gateNotice}
        {askBanner}
      </div>
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
      <div className="epic-groom-panel">
        <ul className="epic-groom-panel__issues">
          {authorisedIssues.map((issue) => (
            <li key={issue.number} className="epic-groom-panel__issue">
              <span className="epic-groom-panel__issue-title">{EpicGroomPanelLabels.issueItem(issue)}</span>
              <span className="epic-groom-panel__issue-status">{issue.status}</span>
            </li>
          ))}
        </ul>
        <p className="epic-groom-panel__authorised">{AUTHORISED}</p>
      </div>
    )
  }

  return null
}

export { EPIC_GROOM_GATE_HEADING, EPIC_GROOM_NOTHING_TO_SHOW_KINDS, EpicGroomPanel }
