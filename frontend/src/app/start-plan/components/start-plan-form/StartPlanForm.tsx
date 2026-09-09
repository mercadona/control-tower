import { FormEvent, useRef, useState } from 'react'
import { StartPlanClient } from 'app/start-plan/client'
import { LocalPath } from 'app/start-plan/LocalPath'
import { RepositoryName } from 'app/start-plan/RepositoryName'
import { StartPlanOutcome, StartedPlan, StartPlanRequest, StartPlanSubmission } from 'app/start-plan/StartPlan.types'
import { TicketKey } from 'app/start-plan/TicketKey'
import { UserComment } from 'app/start-plan/UserComment'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { FormField } from 'system-ui/form-field'
import { Input } from 'system-ui/input'
import { Loading } from 'system-ui/loading'
import { TextArea } from 'system-ui/text-area'
import './StartPlanForm.css'

type StartPlanRefusal = Exclude<StartPlanOutcome, { kind: 'started' }>

type StartPlanFormProps = {
  onStarted: (plan: StartedPlan, request: StartPlanRequest) => void
  onBackendUnreachable: (request: StartPlanRequest) => void
  onInteraction: () => void
  isLocked: boolean
  isMutationBlocked?: boolean
  request?: StartPlanRequest
}

const StartPlanForm = ({ onStarted, onBackendUnreachable, onInteraction, isLocked, isMutationBlocked = false, request }: StartPlanFormProps) => {
  const [ticketKey, setTicketKey] = useState('')
  const [userComment, setUserComment] = useState('')
  const [repository, setRepository] = useState('')
  const [path, setPath] = useState('')
  const [isSending, setIsSending] = useState(false)
  const isSendingRef = useRef(false)
  const [refusal, setRefusal] = useState<StartPlanRefusal | null>(null)
  const [touched, setTouched] = useState({ ticket: false, repository: false, path: false })

  const hasWellFormedTicket = TicketKey.isWellFormed(ticketKey)
  const ticketBlocksStart = ticketKey !== '' && !hasWellFormedTicket
  const hasSomethingToPlan = hasWellFormedTicket || UserComment.isWellFormed(userComment)
  const ticketError = touched.ticket && ticketKey !== '' && !hasWellFormedTicket
  const repositoryError = touched.repository && !RepositoryName.isWellFormed(repository)
  const pathError = touched.path && !LocalPath.isWellFormed(path)

  const canStart =
    !ticketBlocksStart &&
    hasSomethingToPlan &&
    RepositoryName.isWellFormed(repository) &&
    LocalPath.isWellFormed(path) &&
    !isSending &&
    !isLocked && !isMutationBlocked

  const startPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSendingRef.current || isLocked || isMutationBlocked) return
    onInteraction()
    isSendingRef.current = true
    setIsSending(true)
    setRefusal(null)
    const submission: StartPlanSubmission = {
      id: hasWellFormedTicket ? ticketKey : null,
      userComment: UserComment.isWellFormed(userComment) ? UserComment.normalize(userComment) : null,
      repo: repository,
      path: LocalPath.normalize(path),
    }
    const submitted: StartPlanRequest = { id: submission.id, userComment: submission.userComment, repo: submission.repo, path: submission.path }
    const outcome = await StartPlanClient.start(submission)
    isSendingRef.current = false
    setIsSending(false)
    if (outcome.kind === 'started') {
      onStarted(outcome.plan, submitted)
      return
    }
    if (outcome.kind === 'backend-unreachable') onBackendUnreachable(submitted)
    setRefusal(outcome)
  }

  if (isLocked) {
    const shownTicket = request?.id ?? (ticketKey !== '' ? ticketKey : null)
    const shownComment = request?.userComment ?? (userComment.trim() !== '' ? userComment : null)

    return (
      <dl className="start-plan-form__summary">
        {shownTicket !== null && (
          <div>
            <dt className="lg-caption1-regular">Ticket</dt>
            <dd>{shownTicket}</dd>
          </div>
        )}
        {shownComment !== null && (
          <div>
            <dt className="lg-caption1-regular">Qué quieres planificar</dt>
            <dd>{shownComment}</dd>
          </div>
        )}
        <div>
          <dt className="lg-caption1-regular">Repositorio</dt>
          <dd><code>{request?.repo ?? repository}</code></dd>
        </div>
        <div>
          <dt className="lg-caption1-regular">Ruta local</dt>
          <dd><code>{request?.path ?? LocalPath.normalize(path)}</code></dd>
        </div>
      </dl>
    )
  }

  return (
    <form className="start-plan-form" onSubmit={startPlan}>
      <FormField
        label="Clave del ticket"
        message={ticketError ? `Usa la forma ${TicketKey.EXAMPLE}` : `Con la forma ${TicketKey.EXAMPLE}`}
        error={ticketError}
      >
        <Input
          placeholder={TicketKey.EXAMPLE}
          value={ticketKey}
          disabled={isSending || isLocked || isMutationBlocked}
          autoComplete="off"
          onBlur={() => setTouched((current) => ({ ...current, ticket: true }))}
          onChange={(event) => {
            onInteraction()
            setTicketKey(event.target.value)
          }}
        />
      </FormField>
      <FormField label="Qué quieres planificar" message="Da un ticket, una descripción o ambos" error={false}>
        <TextArea
          placeholder="Qué hay que planificar"
          value={userComment}
          disabled={isSending || isLocked || isMutationBlocked}
          autoComplete="off"
          onChange={(event) => {
            onInteraction()
            setUserComment(event.target.value)
          }}
        />
      </FormField>
      <FormField label="Repositorio" required message={repositoryError ? `Indica un repositorio válido, como ${RepositoryName.EXAMPLE}` : `Con la forma ${RepositoryName.EXAMPLE}`} error={repositoryError}>
        <Input
          placeholder={RepositoryName.EXAMPLE}
          value={repository}
          disabled={isSending || isLocked || isMutationBlocked}
          autoComplete="off"
          onBlur={() => setTouched((current) => ({ ...current, repository: true }))}
          onChange={(event) => {
            onInteraction()
            setRepository(event.target.value)
          }}
        />
      </FormField>
      <FormField label="Ruta local" required message={pathError ? `Indica una ruta absoluta válida, como ${LocalPath.EXAMPLE}` : `Con la forma ${LocalPath.EXAMPLE}`} error={pathError}>
        <Input
          placeholder={LocalPath.EXAMPLE}
          value={path}
          disabled={isSending || isLocked || isMutationBlocked}
          autoComplete="off"
          onBlur={() => setTouched((current) => ({ ...current, path: true }))}
          onChange={(event) => {
            onInteraction()
            setPath(event.target.value)
          }}
        />
      </FormField>
      <div className="start-plan-form__actions">
        <Button type="submit" disabled={!canStart} aria-describedby={!canStart ? 'start-plan-help' : undefined}>
          {isSending ? <><Loading aria-label="Enviando la solicitud" /> Enviando solicitud</> : 'Arrancar plan'}
        </Button>
      </div>
      {!canStart && !isSending && <p id="start-plan-help" className="start-plan-form__help">{isMutationBlocked ? 'No puedes arrancar otro plan hasta confirmar el estado del backend.' : 'Da un ticket o una descripción válida, además del repositorio y su ruta local.'}</p>}
      {isSending && <p className="start-plan-form__pending" role="status">Preparar el plan puede tardar varios minutos mientras se ejecutan las comprobaciones del repositorio. No cierres esta página ni vuelvas a enviarlo.</p>}
      {refusal?.kind === 'refused' && <Banner type="error" role="alert" title={refusal.error} />}
    </form>
  )
}

export { StartPlanForm }
export type { StartPlanFormProps }
