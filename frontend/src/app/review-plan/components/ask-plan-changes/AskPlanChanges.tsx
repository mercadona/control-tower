import { useState } from 'react'
import { ReviewPlanClient } from 'app/review-plan/client'
import { ReviewPlanOutcome } from 'app/review-plan/ReviewPlan.types'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { FormField } from 'system-ui/form-field'
import { TextArea } from 'system-ui/text-area'
import './AskPlanChanges.css'

const FIELD_LABEL = 'Qué quieres cambiar del plan'
const FIELD_MESSAGE = 'Lo que escribas es lo que se le pide al agente'
const WHERE_MESSAGE = 'El plan está publicado como el último comentario del issue.'
const ASKED_MESSAGE = 'Cambios pedidos. El agente los recibe en menos de medio minuto y publicará el plan rehecho en el issue.'
const STALE_TITLE = 'El backend ya no tiene este plan activo'
const STALE_DESCRIPTION = 'Nadie leería los cambios. Recupera el plan activo antes de volver a pedirlos.'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

type AskPlanChangesProps = {
  plan: StartedPlan
  onChangesAsked?: () => void
}

const AskPlanChanges = ({ plan, onChangesAsked }: AskPlanChangesProps) => {
  const [changes, setChanges] = useState('')
  const [outcome, setOutcome] = useState<ReviewPlanOutcome | null>(null)
  const [isSending, setIsSending] = useState(false)

  const askChanges = async () => {
    setIsSending(true)
    setOutcome(null)
    const answered = await ReviewPlanClient.askChanges({
      issue: plan.issue.number,
      repo: plan.repo,
      changes,
    })
    setOutcome(answered)
    setIsSending(false)
    if (answered.kind !== 'changes-asked') return
    setChanges('')
    onChangesAsked?.()
  }

  return (
    <section className="ask-plan-changes" aria-label="Pedir cambios en el plan">
      <p className="ask-plan-changes__where">{WHERE_MESSAGE}</p>
      <FormField label={FIELD_LABEL} message={FIELD_MESSAGE} error={false}>
        <TextArea
          placeholder="Qué hay que cambiar"
          value={changes}
          disabled={isSending}
          autoComplete="off"
          onChange={(event) => setChanges(event.target.value)}
        />
      </FormField>
      <Button onClick={() => void askChanges()} disabled={isSending || changes.trim().length === 0}>
        Pedir cambios
      </Button>
      {outcome?.kind === 'changes-asked' && (
        <p className="ask-plan-changes__asked" role="status" aria-live="polite">{ASKED_MESSAGE}</p>
      )}
      {outcome?.kind === 'stale-plan' && (
        <Banner type="warning" role="alert" title={STALE_TITLE} description={STALE_DESCRIPTION} />
      )}
      {outcome?.kind === 'refused' && <Banner type="error" role="alert" title={outcome.detail} />}
      {outcome?.kind === 'backend-unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </section>
  )
}

export { AskPlanChanges }
export type { AskPlanChangesProps }
