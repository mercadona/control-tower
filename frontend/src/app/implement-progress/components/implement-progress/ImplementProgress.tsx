import { ImplementationStep, STEP_LABELS } from 'app/implement-progress/ImplementProgress.types'
import type { ImplementProgressRead } from 'app/implement-progress/ImplementProgress.types'
import { Banner } from 'system-ui/banner'
import './ImplementProgress.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
const WAITING_MESSAGE = 'Esperando a que arranque la implementación…'
const CONNECTING_MESSAGE = 'Comprobando el progreso de la implementación…'

type ImplementProgressProps = { progress: ImplementProgressRead }

const ImplementProgress = ({ progress }: ImplementProgressProps) => {
  const hasProgress = progress.phase === 'progress' || progress.phase === 'partial'
  const taskProgress = hasProgress && progress.task !== null
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
      {hasProgress && (
        <div className="implement-progress__hierarchy">
          <p className="implement-progress__stage lg-body-medium" role="status" aria-live="polite">
            {progress.phase === 'partial' && progress.step === ImplementationStep.DELIVERED
              ? 'Implementación terminada; publicación sin confirmar'
              : STEP_LABELS[progress.step]}
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
      {hasProgress && progress.pullRequest !== null && (
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
