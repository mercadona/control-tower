import { useEffect, useState } from 'react'
import { usePlanProgress } from 'app/plan-events/usePlanProgress'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import './PlanProgress.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
const REFUSED_MESSAGE = 'El backend no reconoce esta sesión de plan, puede haberse reiniciado'
const REWORKING_MESSAGE = 'Rehaciendo el plan con los cambios pedidos…'

type PlanProgressProps = {
  plan: StartedPlan
  onReady: () => void
  onReviewing?: () => void
  observe?: boolean
  writeToClipboard?: (text: string) => Promise<void>
}

const PlanProgress = ({
  plan,
  onReady,
  onReviewing,
  observe = true,
  writeToClipboard = (text) => navigator.clipboard.writeText(text),
}: PlanProgressProps) => {
  const progress = usePlanProgress(plan.issue.number, plan.repo, observe)
  const [copyResult, setCopyResult] = useState<string | null>(null)

  useEffect(() => {
    if (progress.phase === 'ready') onReady()
  }, [onReady, progress.phase])

  useEffect(() => {
    if (progress.phase === 'reviewing') onReviewing?.()
  }, [onReviewing, progress.phase])

  const copyFacts = async () => {
    try {
      await writeToClipboard(`Issue #${plan.issue.number}: ${plan.issue.url}\nRepositorio: ${plan.repo}\nAgente: ${plan.agent}\nRama: ${plan.branch}\nWorktree: ${plan.worktree}`)
      setCopyResult('Datos del plan copiados')
    } catch {
      setCopyResult('No se pudieron copiar los datos del plan')
    }
  }

  return (
    <section className="plan-progress" aria-label="Progreso del plan">
      {observe && progress.phase === 'connecting' && <p className="plan-progress__state" role="status">Plan arrancado</p>}
      {observe && progress.phase === 'writing' && <p className="plan-progress__state" role="status">Escribiendo el plan…</p>}
      {observe && progress.phase === 'ready' && <p className="plan-progress__state" role="status" aria-live="polite">Plan listo</p>}
      {observe && progress.phase === 'reviewing' && <p className="plan-progress__state" role="status">{REWORKING_MESSAGE}</p>}
      {observe && progress.phase === 'failed' && <Banner type="error" role="alert" title={progress.detail} />}
      {observe && progress.phase === 'refused' && <Banner type="error" role="alert" title={REFUSED_MESSAGE} />}
      {observe && progress.phase === 'unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
      <div className="plan-progress__summary">
        <p className="plan-progress__facts">
          Solicitud: issue{' '}
          <a href={plan.issue.url} target="_blank" rel="noreferrer">
            #{plan.issue.number}
          </a>{' '}
          en <code>{plan.repo}</code>
        </p>
        <details className="plan-progress__details">
          <summary>Detalles del agente y del entorno</summary>
          <dl>
            <div>
              <dt className="lg-caption1-regular">Agente</dt>
              <dd><code>{plan.agent}</code></dd>
            </div>
            <div>
              <dt className="lg-caption1-regular">Rama</dt>
              <dd><code>{plan.branch}</code></dd>
            </div>
            <div>
              <dt className="lg-caption1-regular">Worktree</dt>
              <dd><code>{plan.worktree}</code></dd>
            </div>
          </dl>
        </details>
      </div>
      <Button type="button" variant="secondary" onClick={() => void copyFacts()}>Copiar datos del plan</Button>
      {copyResult !== null && <p role="status" className="plan-progress__copy-result">{copyResult}</p>}
    </section>
  )
}

export { PlanProgress }
export type { PlanProgressProps }
