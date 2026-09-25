import { LiveAsk } from 'app/coordinating-session/CoordinatingSession.types'
import { EpicGroomOutcome, EpicIssue, EpicPullRequest, GroomPlanIssue } from 'app/epic-groom/EpicGroom.types'
import { useEpicGroom } from 'app/epic-groom/useEpicGroom'
import { useGatePresses } from 'app/epic-groom/useGatePresses'
import { useAskRead } from 'app/epic-groom/useAskRead'
import { useMergedReslicing } from 'app/epic-groom/useMergedReslicing'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { GateLayout, GateLink, GateList, GateListItem, GateNotice } from 'system-ui/gate-layout'
import { Tag } from 'system-ui/tag'
import './EpicGroomPanel.css'

const EPIC_GROOM_GATE_HEADING = 'Puerta 2 · El groom y la autorización'
const WILL_CREATE = 'Se van a crear estas issues'
const GROOM = 'Ejecutar el groom'
const GROOMING = 'Ejecutando el groom'
const OPEN_SESSION = 'Revisar el slicing con la sesión'
const OPENING_SESSION = 'Abriendo la sesión'
const SESSION_OPENED = 'Sesión del groom abierta: habla con ella en el panel de sesiones.'
const ASK_SENT = 'Petición enviada a la sesión. Aún no se ha confirmado que la haya leído.'
const ASK_READ = 'La sesión ha leído la petición: habla con ella en el panel de sesiones.'
const SENDING_ASK = 'Enviando la petición'
const SESSION_WORKING =
  'La sesión está trabajando: espera a que termine el turno para pedirle que revise el slicing.'
const SESSION_AWAITING_PERMISSION =
  'La sesión está esperando un permiso en su terminal: respóndelo y vuelve a intentarlo.'
const SESSION_TURN_UNKNOWN =
  'No se sabe qué está mostrando la terminal de la sesión: espera a que termine un turno.'
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
const AWAITING_DISPATCH = 'Trabajo autorizado: el primer slice sale en el próximo barrido.'
const FINISH_GROOM_FIRST = 'Termina el groom antes de autorizar el trabajo.'
const ONLY_FROM_THE_PAGE = 'Esta puerta solo se abre desde la página que sirve el backend.'
const NO_COORDINATING_SESSION = 'No hay ninguna sesión coordinadora abierta: ábrela para actuar en esta puerta.'
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
  'resliced', 'groomable', 'partially-groomed', 'groomed', 'authorised',
]

const dispatchedCount = (count: number): string =>
  count === 1 ? 'Trabajo en marcha: 1 slice despachado.' : `Trabajo en marcha: ${count} slices despachados.`
const partialCount = (existing: number, planned: number): string => `${existing} de ${planned} issues creadas`
const planItem = (issue: GroomPlanIssue, home: string): string =>
  issue.repo === home ? issue.title : `${issue.title} · ${issue.repo}`
const issueItem = (issue: EpicIssue): string => `#${issue.number} · ${issue.title}`

const EpicGroomPanelLabels = {
  dispatchedCount,
  partialCount,
  planItem,
  issueItem,
}

const IssueList = ({ issues }: { issues: EpicIssue[] }) => (
  <GateList>
    {issues.map((issue) => (
      <GateListItem key={issue.number}>
        <span>{EpicGroomPanelLabels.issueItem(issue)}</span>
        <Tag className="epic-groom-panel__issue-status">{issue.status}</Tag>
      </GateListItem>
    ))}
  </GateList>
)

const PullRequestLink = ({ pullRequest }: { pullRequest: EpicPullRequest }) => (
  <GateLink href={pullRequest.url}>{`${PULL_REQUEST} #${pullRequest.number}`}</GateLink>
)

type EpicGroomPanelProps = {
  target: string | null
  liveAsk: LiveAsk | null
  openingBlocked: boolean
  operationBusy: boolean
  openSession: (key: string, target: string) => Promise<import('app/epic-groom/EpicGroom.types').GroomSessionOutcome>
  dispatched?: number
}

const EpicGroomPanel = ({
  target, liveAsk, openingBlocked, operationBusy, openSession, dispatched = 0,
}: EpicGroomPanelProps) => {
  const sessionMidTurn = liveAsk !== null && liveAsk !== 'ready'
  const askBlocked = liveAsk === null ? openingBlocked : sessionMidTurn
  const presses = useGatePresses({ target, askBlocked, operationBusy, openSession })
  const { acted, refusal, session, reslicing } = presses
  const preparationRefused = refusal?.kind === 'refused' && refusal.code === 'repository-preparation-required'
  const askWasRead = useAskRead(session, liveAsk)
  const isReviewingTheSlicing =
    session?.kind === 'opened' || session?.kind === 'typed' || refusal?.kind === 'unconfirmed'
  const read = useEpicGroom(isReviewingTheSlicing, target, true)
  const gateKey = read.phase === 'read' && KEYED_KINDS.includes(read.kind) && 'key' in read ? read.key ?? null : null
  useMergedReslicing({
    read, held: operationBusy || sessionMidTurn, press: (planFingerprint) => presses.groom(gateKey, planFingerprint),
  })

  if (read.phase === 'connecting') return null
  if (acted === null && EPIC_GROOM_NOTHING_TO_SHOW_KINDS.includes(read.kind)) return null
  if (acted === null && read.kind === 'refused') {
    return (
      <Banner type="error" role="alert" title={read.error} />
    )
  }
  if (acted === null && read.kind === 'issues-uncertain') {
    return (
      <Banner type="warning" role="alert" title={ISSUES_UNCERTAIN_TITLE} description={read.reason} />
    )
  }

  if (acted === null && read.kind === 'awaiting-publication') {
    const { pullRequest } = read
    return (
      <GateLayout heading={pullRequest === null ? AWAITING_WITHOUT_PULL_REQUEST : AWAITING_MERGE}>
        {pullRequest !== null && <PullRequestLink pullRequest={pullRequest} />}
      </GateLayout>
    )
  }

  const isPressing = presses.pressed !== 'none'
  const preparationDetail = read.kind === 'groomed' || read.kind === 'authorised' ? read.preparation ?? null : null
  const preparationBlocked = preparationRefused || preparationDetail !== null

  const gateNotice = gateKey === null && (
    <GateNotice>{ONLY_FROM_THE_PAGE}</GateNotice>
  )
  const sessionNeeded = target === null && (
    <GateNotice>{NO_COORDINATING_SESSION}</GateNotice>
  )
  const askBanner =
    refusal?.kind === 'refused' ? (
      <Banner type="error" role="alert"
        title={preparationBlocked ? 'El repositorio necesita preparación antes de continuar' : refusal.error}
        description={preparationBlocked ? refusal.error : undefined} />
    ) : refusal?.kind === 'unconfirmed' ? (
      <Banner
        type="warning"
        role="alert"
        title={GROOM_UNCONFIRMED_TITLE}
        description={GROOM_UNCONFIRMED_DETAIL}
      />
    ) : preparationDetail !== null ? (
      <Banner type="error" role="alert" title="El repositorio necesita preparación antes de continuar" description={preparationDetail} />
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
  const askNotice = liveAsk === 'working' ? (
    <GateNotice>{SESSION_WORKING}</GateNotice>
  ) : liveAsk === 'awaiting-permission' ? (
    <GateNotice>{SESSION_AWAITING_PERMISSION}</GateNotice>
  ) : liveAsk === 'turn-not-finished' ? (
    <GateNotice>{SESSION_TURN_UNKNOWN}</GateNotice>
  ) : null
  const sessionNotice =
    session?.kind === 'opened' ? (
      <GateNotice>{SESSION_OPENED}</GateNotice>
    ) : session?.kind === 'typed' ? (
      <GateNotice>{askWasRead ? ASK_READ : ASK_SENT}</GateNotice>
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
      <GateLayout
        heading={RESLICED}
        actions={
          <Button onClick={() => void presses.publishReslicing(gateKey)} disabled={gateKey === null || target === null || isPressing || operationBusy}>
            {presses.pressed === 'reslicing' ? PUBLISHING_RESLICING : PUBLISH_RESLICING}
          </Button>
        }
      >
        {reslicing?.kind === 'published' && (
          <GateNotice>
            <span>{RESLICING_PUBLISHED}</span> <PullRequestLink pullRequest={reslicing.pullRequest} />
          </GateNotice>
        )}
        {gateNotice}
        {sessionNeeded}
        {reslicingBanner}
      </GateLayout>
    )
  }

  if (acted === null && read.kind === 'groomable') {
    const { plan, home, planFingerprint, reslicing: merged } = read
    return (
      <GateLayout
        heading={WILL_CREATE}
        actions={
          <>
            {presses.pressed !== 'groom' && (
              <Button variant="secondary" onClick={() => void presses.openSession(gateKey)} disabled={gateKey === null || target === null || isPressing || askBlocked || operationBusy}>
                {presses.pressed === 'session'
                  ? (liveAsk === null ? OPENING_SESSION : SENDING_ASK)
                  : OPEN_SESSION}
              </Button>
            )}
            <Button onClick={() => void presses.groom(gateKey, planFingerprint)} disabled={gateKey === null || target === null || isPressing || operationBusy || sessionMidTurn}>
              {presses.pressed === 'groom' ? GROOMING : GROOM}
            </Button>
          </>
        }
      >
        <GateList>
          {plan.map((issue) => (
            <GateListItem key={issue.order}>{EpicGroomPanelLabels.planItem(issue, home)}</GateListItem>
          ))}
        </GateList>
        {merged !== null && (
          <GateNotice>
            <span>{RESLICING_MERGED}</span> <PullRequestLink pullRequest={merged} />
          </GateNotice>
        )}
        {askNotice}
        {sessionNotice}
        {gateNotice}
        {sessionNeeded}
        {askBanner}
      </GateLayout>
    )
  }

  if (acted === null && read.kind === 'partially-groomed') {
    const { plan, issues, planFingerprint } = read
    return (
      <GateLayout
        heading={EpicGroomPanelLabels.partialCount(issues.length, plan.length)}
        actions={
          <Button onClick={() => void presses.groom(gateKey, planFingerprint)} disabled={gateKey === null || target === null || isPressing || operationBusy || sessionMidTurn}>
            {presses.pressed === 'groom' ? GROOMING : GROOM}
          </Button>
        }
      >
        <IssueList issues={issues} />
        <GateNotice>{FINISH_GROOM_FIRST}</GateNotice>
        {gateNotice}
        {sessionNeeded}
        {askBanner}
      </GateLayout>
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
      <GateLayout
        heading={CREATED}
        actions={
          <Button onClick={() => void presses.promote(gateKey)} disabled={gateKey === null || target === null || isPressing || operationBusy}>
            {presses.pressed === 'promote' ? PROMOTING : preparationBlocked ? 'Volver a comprobar y autorizar' : PROMOTE}
          </Button>
        }
      >
        <IssueList issues={groomedIssues} />
        {gateNotice}
        {sessionNeeded}
        {askBanner}
      </GateLayout>
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
      <GateLayout
        heading={preparationBlocked ? 'Despacho pendiente de corregir la preparación del repositorio.' : dispatched === 0 ? AWAITING_DISPATCH : EpicGroomPanelLabels.dispatchedCount(dispatched)}
        actions={preparationBlocked ? (
          <Button onClick={() => void presses.promote(gateKey)} disabled={gateKey === null || target === null || isPressing || operationBusy}>
            {presses.pressed === 'promote' ? 'Comprobando la preparación' : 'Volver a comprobar'}
          </Button>
        ) : undefined}
      >
        <IssueList issues={authorisedIssues} />
        {askBanner}
      </GateLayout>
    )
  }

  return null
}

export { EPIC_GROOM_GATE_HEADING, EpicGroomPanel }
