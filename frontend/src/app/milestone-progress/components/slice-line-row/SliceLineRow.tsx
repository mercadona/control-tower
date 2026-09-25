import { ImplementationStep, STEP_LABELS } from 'app/implement-progress/ImplementProgress.types'
import { ElapsedTime } from 'app/milestone-progress/ElapsedTime'
import type { SliceLine } from 'app/milestone-progress/MilestoneProgress.types'
import './SliceLineRow.css'

const PLANNING_STEP = 'planning'
const PLANNING_LABEL = 'Preparando el plan'
const PENDING_LABEL = 'Pendiente'
const DELIVERED_LABEL = 'Entregada'
const NEEDS_PERSON_LABEL = 'Necesita atención'

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

const runningLabelOf = (line: SliceLine, now: number): string => {
  const parts = [
    line.step === null ? null : stepLabelOf(line.step),
    line.task === null ? null : `Tarea ${line.task} de ${line.totalTasks}`,
    line.stepStartedAt === null ? null : ElapsedTime.since(line.stepStartedAt, now),
  ].filter((part): part is string => part !== null)

  return parts.join(' · ')
}

const SliceLineRow = ({ line, now }: SliceLineRowProps) => (
  <div className="slice-line-row">
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
  </div>
)

export { SliceLineRow }
export type { SliceLineRowProps }
