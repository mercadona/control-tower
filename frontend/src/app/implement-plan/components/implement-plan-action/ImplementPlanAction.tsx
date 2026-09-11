import { useState } from 'react'
import { ImplementPlanClient } from 'app/implement-plan/client'
import { ImplementPlanOutcome } from 'app/implement-plan/ImplementPlan.types'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import './ImplementPlanAction.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
const UNDER_REVIEW_TITLE = 'El plan se está rehaciendo con los cambios pedidos'
const UNDER_REVIEW_DESCRIPTION = 'Espera a que el agente publique el plan rehecho y vuelve a intentarlo.'

type ImplementPlanActionProps = {
  plan: StartedPlan
  onImplementationStarted: () => void
  isImplementationStarted?: boolean
}

const ImplementPlanAction = ({ plan, onImplementationStarted, isImplementationStarted = false }: ImplementPlanActionProps) => {
  const [outcome, setOutcome] = useState<ImplementPlanOutcome | null>(null)
  const [isSending, setIsSending] = useState(false)

  const implementPlan = async () => {
    setIsSending(true)
    setOutcome(null)
    const outcome = await ImplementPlanClient.implement({ agent: plan.agent, issue: plan.issue.number, repo: plan.repo })
    setOutcome(outcome)
    setIsSending(false)
    if (outcome.kind === 'implementing') {
      onImplementationStarted()
    }
  }

  if (isImplementationStarted || outcome?.kind === 'implementing') {
    return (
      <div className="implement-plan-action">
        <Banner
          type="informative"
          title="Agente asignado"
          description={
            <span className="implement-plan-action__facts">
              El agente <code>{outcome?.kind === 'implementing' ? outcome.agent : plan.agent}</code> lleva este plan
            </span>
          }
        />
      </div>
    )
  }

  return (
    <div className="implement-plan-action">
      <Button onClick={implementPlan} disabled={isSending || outcome?.kind === 'uncertain'}>
        Implementar plan
      </Button>
      {outcome?.kind === 'refused' && <Banner type="error" role="alert" title={outcome.detail} />}
      {outcome?.kind === 'stale-agent' && (
        <Banner
          type="error"
          role="alert"
          title="El agente que recordaba esta página ya no vale"
          description="El backend ya no reconoce esa sesión de planificación. Coge el agente actual desde los planes activos e inténtalo de nuevo."
        />
      )}
      {outcome?.kind === 'uncertain' && (
        <Banner
          type="error"
          role="alert"
          title="No se puede saber si la implementación ya empezó"
          description="Una persona tiene que comprobarlo antes de reintentar."
        />
      )}
      {outcome?.kind === 'under-review' && (
        <Banner
          type="warning"
          role="alert"
          title={UNDER_REVIEW_TITLE}
          description={UNDER_REVIEW_DESCRIPTION}
        />
      )}
      {outcome?.kind === 'backend-unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </div>
  )
}

export { ImplementPlanAction }
export type { ImplementPlanActionProps }
