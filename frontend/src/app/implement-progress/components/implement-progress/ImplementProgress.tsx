import { ImplementationStep } from 'app/implement-progress/ImplementProgress.types'
import { useImplementProgress } from 'app/implement-progress/useImplementProgress'
import { Banner } from 'system-ui/banner'
import './ImplementProgress.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
const WAITING_MESSAGE = 'Esperando a que arranque la implementación…'
const CONNECTING_MESSAGE = 'Comprobando el progreso de la implementación…'

const STEP_LABELS: Record<ImplementationStep, string> = {
  [ImplementationStep.STARTING]: 'Arrancando',
  [ImplementationStep.IMPLEMENT]: 'Implementando',
  [ImplementationStep.CONTROLS]: 'Revisando controles',
  [ImplementationStep.JUDGE]: 'Evaluando',
  [ImplementationStep.ADVISE]: 'Generando consejo',
  [ImplementationStep.COMMIT]: 'Guardando cambios',
  [ImplementationStep.RECONCILE]: 'Reconciliando',
  [ImplementationStep.GLOBAL]: 'Revisión global',
  [ImplementationStep.SLICE_JUDGE]: 'Evaluando el slice',
  [ImplementationStep.E2E]: 'Ejecutando pruebas end-to-end',
  [ImplementationStep.DELIVERED]: 'Entregado',
  [ImplementationStep.IN_REVIEW]: 'En revisión',
  [ImplementationStep.FIXING]: 'Corrigiendo lo pedido en la revisión',
}

type ImplementProgressProps = {
  issue: number
  root: string
  repo: string
}

const ImplementProgress = ({ issue, root, repo }: ImplementProgressProps) => {
  const progress = useImplementProgress(issue, root, repo)
  const taskProgress = progress.phase === 'progress' && progress.task !== null
    ? progress.totalTasks === null
      ? `Tarea ${progress.task}`
      : `Tarea ${progress.task} de ${progress.totalTasks}`
    : null

  return (
    <section className="implement-progress" aria-label="Progreso de la implementación">
      {progress.phase === 'connecting' && (
        <p className="implement-progress__state" role="status">{CONNECTING_MESSAGE}</p>
      )}
      {progress.phase === 'waiting' && (
        <p className="implement-progress__state" role="status">{WAITING_MESSAGE}</p>
      )}
      {progress.phase === 'progress' && (
        <div className="implement-progress__hierarchy">
          <p className="implement-progress__stage lg-body-medium" role="status" aria-live="polite">
            {STEP_LABELS[progress.step]}
          </p>
          {taskProgress !== null && <p className="implement-progress__task">{taskProgress}</p>}
          {progress.totalTasks !== null && progress.task === null && (
            <p className="implement-progress__task">{progress.totalTasks} tareas previstas</p>
          )}
          {progress.name !== null && <p className="implement-progress__task-name">{progress.name}</p>}
          {progress.attempt !== null && (
            <p className="implement-progress__diagnostics">
              {'Intento '}{progress.attempt}
            </p>
          )}
          {progress.discards !== null && (
            <p className="implement-progress__diagnostics">
              Diagnóstico: descartes {progress.discards}
            </p>
          )}
        </div>
      )}
      {progress.phase === 'progress' && progress.pullRequest !== null && (
        <p className="implement-progress__facts implement-progress__facts--pr lg-body-medium">
          Pull request abierta: {' '}
          <a href={progress.pullRequest.url} target="_blank" rel="noreferrer">
            #{progress.pullRequest.number}
          </a>
        </p>
      )}
      {progress.phase === 'failed' && <Banner type="error" role="alert" title={progress.error} />}
      {progress.phase === 'unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </section>
  )
}

export { ImplementProgress }
export type { ImplementProgressProps }
