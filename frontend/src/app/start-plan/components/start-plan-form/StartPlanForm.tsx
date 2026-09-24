import { FormEvent, useRef, useState } from 'react'
import { OpenedCoordinatingSession, OpenOutcome } from 'app/coordinating-session/CoordinatingSession.types'
import { LocalPath } from 'app/start-plan/LocalPath'
import { StartPlanRequest, StartPlanSubmission } from 'app/start-plan/StartPlan.types'
import { TicketKey } from 'app/start-plan/TicketKey'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { FormField } from 'system-ui/form-field'
import { Input } from 'system-ui/input'
import { Loading } from 'system-ui/loading'
import './StartPlanForm.css'

type OpenRefusal = Exclude<OpenOutcome, { kind: 'opened' }>

const MUTATION_BLOCKED_HELP = 'No puedes arrancar otro plan hasta confirmar el estado del backend.'
const ALREADY_LIVE_HELP = 'Ya hay una conversación coordinadora en marcha. Termínala antes de abrir otra.'
const INCOMPLETE_HELP = 'Da un ticket válido y la ruta local del repositorio.'

type StartPlanFormProps = {
  onOpened: (opened: OpenedCoordinatingSession) => void
  onUnreachable: () => void
  onInteraction: () => void
  isLocked: boolean
  isMutationBlocked?: boolean
  isCoordinatingSessionLive?: boolean
  openSession?: (submission: StartPlanSubmission) => Promise<OpenOutcome>
  request?: StartPlanRequest
}

const StartPlanForm = ({
  onOpened, onUnreachable, onInteraction, isLocked, isMutationBlocked = false,
  isCoordinatingSessionLive = false, openSession, request,
}: StartPlanFormProps) => {
  const [ticketKey, setTicketKey] = useState('')
  const [path, setPath] = useState('')
  const [isSending, setIsSending] = useState(false)
  const isSendingRef = useRef(false)
  const [refusal, setRefusal] = useState<OpenRefusal | null>(null)
  const [touched, setTouched] = useState({ ticket: false, path: false })

  const hasWellFormedTicket = TicketKey.isWellFormed(ticketKey)
  const ticketError = touched.ticket && !hasWellFormedTicket
  const pathError = touched.path && !LocalPath.isWellFormed(path)

  const canStart =
    hasWellFormedTicket &&
    LocalPath.isWellFormed(path) &&
    !isSending &&
    !isLocked && !isMutationBlocked && !isCoordinatingSessionLive

  const helpText = isCoordinatingSessionLive
    ? ALREADY_LIVE_HELP
    : isMutationBlocked
      ? MUTATION_BLOCKED_HELP
      : INCOMPLETE_HELP

  const openBrainstorming = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSendingRef.current || isLocked || isMutationBlocked || isCoordinatingSessionLive) return
    onInteraction()
    isSendingRef.current = true
    setIsSending(true)
    setRefusal(null)
    const submission: StartPlanSubmission = {
      id: ticketKey,
      path: LocalPath.normalize(path),
    }
    let outcome: OpenOutcome
    try {
      outcome = await openSession?.(submission) ?? { kind: 'backend-unreachable' }
    } catch {
      outcome = { kind: 'backend-unreachable' }
    } finally {
      isSendingRef.current = false
      setIsSending(false)
    }
    if (outcome.kind === 'opened') {
      onOpened(outcome.opened)
      return
    }
    if (outcome.kind === 'backend-unreachable') onUnreachable()
    setRefusal(outcome)
  }

  if (isLocked) {
    const shownTicket = request?.id ?? (ticketKey !== '' ? ticketKey : null)

    return (
      <dl className="start-plan-form__summary">
        {shownTicket !== null && (
          <div>
            <dt className="lg-caption1-regular">Ticket</dt>
            <dd>{shownTicket}</dd>
          </div>
        )}
        {request?.repo !== undefined && (
          <div>
            <dt className="lg-caption1-regular">Repositorio</dt>
            <dd><code>{request.repo}</code></dd>
          </div>
        )}
        <div>
          <dt className="lg-caption1-regular">Ruta local</dt>
          <dd><code>{request?.path ?? LocalPath.normalize(path)}</code></dd>
        </div>
      </dl>
    )
  }

  return (
    <form className="start-plan-form" onSubmit={openBrainstorming}>
      <FormField
        label="Ticket"
        required
        message={
          ticketError
            ? `Usa una clave como ${TicketKey.EXAMPLE} o una URL como ${TicketKey.URL_EXAMPLE}`
            : `Una clave ${TicketKey.EXAMPLE} o la URL de un issue de GitHub`
        }
        error={ticketError}
      >
        <Input
          aria-label="Ticket"
          placeholder={TicketKey.EXAMPLE}
          value={ticketKey}
          disabled={isSending || isLocked || isMutationBlocked || isCoordinatingSessionLive}
          autoComplete="off"
          onBlur={() => setTouched((current) => ({ ...current, ticket: true }))}
          onChange={(event) => {
            onInteraction()
            setTicketKey(event.target.value)
          }}
        />
      </FormField>
      <FormField label="Ruta local" required message={pathError ? `Indica una ruta absoluta válida, como ${LocalPath.EXAMPLE}` : `Con la forma ${LocalPath.EXAMPLE}`} error={pathError}>
        <Input
          placeholder={LocalPath.EXAMPLE}
          value={path}
          disabled={isSending || isLocked || isMutationBlocked || isCoordinatingSessionLive}
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
          {isSending ? <><Loading aria-label="Enviando la solicitud" /> Abriendo el brainstorming</> : 'Arrancar brainstorming'}
        </Button>
      </div>
      {!canStart && !isSending && <p id="start-plan-help" className="start-plan-form__help">{helpText}</p>}
      {isSending && <p className="start-plan-form__pending" role="status">Preparar el plan puede tardar varios minutos mientras se ejecutan las comprobaciones del repositorio. No cierres esta página ni vuelvas a enviarlo.</p>}
      {refusal?.kind === 'refused' && <Banner type="error" role="alert" title={refusal.error} />}
    </form>
  )
}

export { StartPlanForm }
export type { StartPlanFormProps }
