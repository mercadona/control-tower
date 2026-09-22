import { PlanningActivityState } from 'app/planning-progress/PlanningProgress.types'
import { usePlanningProgress } from 'app/planning-progress/usePlanningProgress'
import { Banner } from 'system-ui/banner'
import './PlanningProgress.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
const NOT_WATCHED_MESSAGE = 'El backend no está siguiendo esta planificación, puede haberse reiniciado'
const CHECKING_MESSAGE = 'Comprobando lo que hace el agente…'
const RUNNING_MESSAGE = 'El agente está trabajando'
const FINISHED_MESSAGE = 'El agente ha terminado'

const pad = (value: number) => String(value).padStart(2, '0')

const formatDuration = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${pad(minutes)}:${pad(seconds)}`
}

type PlanningProgressProps = {
  issue: number
  repo: string
}

const PlanningProgress = ({ issue, repo }: PlanningProgressProps) => {
  const progress = usePlanningProgress(issue, repo)

  return (
    <section className="planning-progress" aria-label="Progreso de la planificación">
      {(progress.phase === 'connecting' || progress.phase === 'waiting') && (
        <p className="planning-progress__state" role="status">{CHECKING_MESSAGE}</p>
      )}
      {progress.phase === 'activity' && (
        <div className="planning-progress__hierarchy">
          <p className="planning-progress__stage lg-body-medium" role="status" aria-live="polite">
            {progress.state === PlanningActivityState.FINISHED ? FINISHED_MESSAGE : RUNNING_MESSAGE}
          </p>
          <p className="planning-progress__tally">
            {formatDuration(progress.runningMs)} · {progress.toolCalls} llamadas a herramientas
          </p>
          {progress.lastTool !== null && (
            <p className="planning-progress__last-tool">
              Última herramienta: {progress.lastTool.name}
              {progress.lastTool.argument !== null && ` — ${progress.lastTool.argument}`}
            </p>
          )}
          {progress.lastText !== null && (
            <p className="planning-progress__last-text">Último mensaje: «{progress.lastText}»</p>
          )}
        </div>
      )}
      {progress.phase === 'not-watched' && <Banner type="error" role="alert" title={NOT_WATCHED_MESSAGE} />}
      {progress.phase === 'failed' && <Banner type="error" role="alert" title={progress.error} />}
      {progress.phase === 'unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </section>
  )
}

export { PlanningProgress }
export type { PlanningProgressProps }
