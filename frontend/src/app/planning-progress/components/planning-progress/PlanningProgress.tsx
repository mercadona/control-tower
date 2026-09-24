import { PlanningActivityState, type PlanningActivity } from 'app/planning-progress/PlanningProgress.types'
import type { WorkReading } from 'app/work-progress/WorkProgress.types'
import { Banner } from 'system-ui/banner'
import './PlanningProgress.css'

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
  progress: WorkReading<PlanningActivity>
}

const PlanningProgress = ({ progress }: PlanningProgressProps) => {
  const activity = progress.kind === 'available' ? progress.value : null

  return (
    <section className="planning-progress" aria-label="Progreso de la planificación">
      {activity !== null && (
        <div className="planning-progress__hierarchy">
          <p className="planning-progress__stage lg-body-medium" role="status" aria-live="polite">
            {activity.state === PlanningActivityState.FINISHED ? FINISHED_MESSAGE : RUNNING_MESSAGE}
          </p>
          <p className="planning-progress__tally">
            {formatDuration(activity.runningMs)} · {activity.toolCalls} llamadas a herramientas
          </p>
          {activity.lastTool !== null && (
            <p className="planning-progress__last-tool">
              Última herramienta: {activity.lastTool.name}
              {activity.lastTool.argument !== null && ` — ${activity.lastTool.argument}`}
            </p>
          )}
          {activity.lastText !== null && (
            <p className="planning-progress__last-text">Último mensaje: «{activity.lastText}»</p>
          )}
        </div>
      )}
      {progress.kind === 'unavailable' && <Banner type="warning" role="alert" title="Actividad del agente no disponible" description={progress.detail} />}
    </section>
  )
}

export { PlanningProgress }
export type { PlanningProgressProps }
