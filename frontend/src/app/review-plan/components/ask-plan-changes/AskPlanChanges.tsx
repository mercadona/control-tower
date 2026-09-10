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
const WHERE_MESSAGE = 'El plan se publica como comentario del issue, y el rehecho también.'
const ASKED_MESSAGE = 'Cambios pedidos. El agente los recibe en unos 30 segundos y publicará el plan rehecho en el issue.'
const STALE_TITLE = 'El backend ya no tiene este plan activo'
const STALE_DESCRIPTION = 'Nadie leería los cambios. Recupera el plan activo antes de volver a pedirlos.'
const IMPLEMENTING_TITLE = 'Este plan ya se está implementando'
const IMPLEMENTING_DESCRIPTION = 'Ya nadie escucha los cambios al plan. Sigue la implementación en curso.'
const UNCERTAIN_TITLE = 'No se puede saber si la implementación ya empezó'
const UNCERTAIN_DESCRIPTION = 'Una persona tiene que comprobarlo antes de reintentar.'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

type AskPlanChangesProps = {
  plan: StartedPlan
}

const AskPlanChanges = ({ plan }: AskPlanChangesProps) => {
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
  }

  return (
    <section className="ask-plan-changes" aria-label="Pedir cambios en el plan">
      <p className="ask-plan-changes__where">{WHERE_MESSAGE}</p>
      <FormField label={FIELD_LABEL} message={FIELD_MESSAGE}>
        <TextArea
          placeholder="Qué hay que cambiar"
          value={changes}
          disabled={isSending}
          autoComplete="off"
          onChange={(event) => setChanges(event.target.value)}
        />
      </FormField>
      <Button onClick={askChanges} disabled={isSending || changes.trim().length === 0}>
        Pedir cambios
      </Button>
      {outcome?.kind === 'changes-asked' && (
        <p className="ask-plan-changes__asked" role="status">{ASKED_MESSAGE}</p>
      )}
      {outcome?.kind === 'stale-plan' && (
        <Banner type="warning" role="alert" title={STALE_TITLE} description={STALE_DESCRIPTION} />
      )}
      {outcome?.kind === 'plan-implementing' && (
        <Banner type="warning" role="alert" title={IMPLEMENTING_TITLE} description={IMPLEMENTING_DESCRIPTION} />
      )}
      {outcome?.kind === 'phase-uncertain' && (
        <Banner type="error" role="alert" title={UNCERTAIN_TITLE} description={UNCERTAIN_DESCRIPTION} />
      )}
      {outcome?.kind === 'refused' && <Banner type="error" role="alert" title={outcome.detail} />}
      {outcome?.kind === 'backend-unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </section>
  )
}

export { AskPlanChanges }
export type { AskPlanChangesProps }
