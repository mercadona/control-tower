import { useState } from 'react'
import { ImplementationStep, STEP_LABELS } from 'app/implement-progress/ImplementProgress.types'
import { ElapsedTime } from 'app/milestone-progress/ElapsedTime'
import type { SliceLine, SliceTask } from 'app/milestone-progress/MilestoneProgress.types'
import './SliceLineRow.css'

const PLANNING_STEP = 'planning'
const PLANNING_LABEL = 'Preparando el plan'
const PENDING_LABEL = 'Pendiente'
const DELIVERED_LABEL = 'Entregada'
const NEEDS_PERSON_LABEL = 'Necesita atención'
const EXPAND_LABEL = 'Ver tareas'
const COLLAPSE_LABEL = 'Ocultar tareas'
const TASK_DONE_LABEL = 'Hecha'
const TASK_PENDING_LABEL = 'Pendiente'
const TASK_STOPPED_LABEL = 'Detenida'

type SliceLineRowProps = {
  line: SliceLine
  now: number
  onTalk: (() => void) | null
  repo: string
  onReread: () => void
}

const isImplementationStep = (step: string): step is ImplementationStep =>
  (Object.values(ImplementationStep) as string[]).includes(step)

const stepLabelOf = (step: string): string => {
  if (step === PLANNING_STEP) return PLANNING_LABEL

  return isImplementationStep(step) ? STEP_LABELS[step] : step
}

const stepWithTimeOf = (line: SliceLine, now: number): string => {
  const parts = [
    line.step === null ? null : stepLabelOf(line.step),
    line.stepStartedAt === null ? null : ElapsedTime.since(line.stepStartedAt, now),
  ].filter((part): part is string => part !== null)

  return parts.join(' · ')
}

const runningLabelOf = (line: SliceLine, now: number): string => {
  const parts = [
    line.step === null ? null : stepLabelOf(line.step),
    line.task === null ? null : `Tarea ${line.task} de ${line.totalTasks}`,
    line.stepStartedAt === null ? null : ElapsedTime.since(line.stepStartedAt, now),
  ].filter((part): part is string => part !== null)

  return parts.join(' · ')
}

const taskTitleOf = (task: SliceTask): string =>
  task.name === null ? `Tarea ${task.number}` : `Tarea ${task.number} · ${task.name}`

const taskStatusLabelOf = (task: SliceTask, line: SliceLine, now: number): string => {
  switch (task.status) {
    case 'done': return TASK_DONE_LABEL
    case 'pending': return TASK_PENDING_LABEL
    case 'stopped': return TASK_STOPPED_LABEL
    case 'running': return stepWithTimeOf(line, now)
  }
}

const SliceLineRow = ({ line, now }: SliceLineRowProps) => {
  const [expanded, setExpanded] = useState(false)
  const canExpand = line.state === 'running'

  return (
    <div className="slice-line-row">
      <div className="slice-line-row__summary">
        <span className="slice-line-row__title">{`#${line.number} ${line.title}`}</span>
        {line.state === 'pending' && <span className="slice-line-row__status">{PENDING_LABEL}</span>}
        {line.state === 'running' && <span className="slice-line-row__status">{runningLabelOf(line, now)}</span>}
        {line.state === 'needs-person' && <span className="slice-line-row__status">{NEEDS_PERSON_LABEL}</span>}
        {line.state === 'delivered' && (
          <span className="slice-line-row__status">
            {DELIVERED_LABEL}
            {line.pullRequest !== null && (
              <>
                {' '}
                <a href={line.pullRequest.url} target="_blank" rel="noreferrer">
                  {`Pull request #${line.pullRequest.number}`}
                </a>
              </>
            )}
          </span>
        )}
        {canExpand && (
          <button
            type="button"
            className="slice-line-row__toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? COLLAPSE_LABEL : EXPAND_LABEL}
          </button>
        )}
      </div>
      {canExpand && expanded && (
        <div className="slice-line-row__detail">
          <ul className="slice-line-row__tasks">
            {line.tasks.map((task) => (
              <li key={task.number} className="slice-line-row__task">
                <span>{taskTitleOf(task)}</span>
                <span>{taskStatusLabelOf(task, line, now)}</span>
                {task.findings !== null && (
                  <p className="slice-line-row__findings">{`Lo que encontró el juez: ${task.findings}`}</p>
                )}
              </li>
            ))}
          </ul>
          {line.stepStartedAt !== null && (
            <p className="slice-line-row__activity" role="status">
              {`El agente está trabajando · ${ElapsedTime.since(line.stepStartedAt, now)} en este paso`}
              {line.lastTool !== null && (
                <>
                  <br />
                  {`Última herramienta: ${line.lastTool.name}${line.lastTool.argument === null ? '' : ` · ${line.lastTool.argument}`}`}
                </>
              )}
              {line.lastText !== null && (
                <>
                  <br />
                  {`Último mensaje: «${line.lastText}»`}
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export { SliceLineRow }
export type { SliceLineRowProps }
