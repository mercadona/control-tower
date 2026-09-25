import { SliceLineRow } from 'app/milestone-progress/components/slice-line-row'
import { useSecondTick } from 'app/milestone-progress/useSecondTick'
import type { MilestoneProgressOutcome } from 'app/milestone-progress/MilestoneProgress.types'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import './MilestoneBoard.css'

const BOARD_LABEL = 'Issues del milestone'
const BASELINE_TITLE = 'El repositorio ya estaba en rojo antes de empezar.'
const BASELINE_DESCRIPTION = 'Un slice puede fallar por algo que no ha tocado.'
const COMPLETED_TITLE = 'Milestone completado'
const CLOSE_LABEL = 'Cerrar la sesión y volver al inicio'

type MilestoneBoardProps = {
  progress: MilestoneProgressOutcome | null
  onTalk: (() => void) | null
  repo: string
  story: string
  onReread: () => void
  onClose: () => void
}

const MilestoneBoard = ({ progress, onTalk, repo, story, onReread, onClose }: MilestoneBoardProps) => {
  const now = useSecondTick()
  if (progress === null || progress.kind !== 'milestone') return null

  const baselineRed = progress.issues.some((line) => line.baselineRed)
  const completed = progress.total > 0 && progress.delivered === progress.total

  return (
    <section className="milestone-board" aria-label={BOARD_LABEL}>
      {baselineRed && <Banner type="warning" role="alert" title={BASELINE_TITLE} description={BASELINE_DESCRIPTION} />}
      <p className="milestone-board__summary">{`${progress.delivered} de ${progress.total} entregadas`}</p>
      {completed ? (
        <>
          <h2>{COMPLETED_TITLE}</h2>
          <p>{`Las ${progress.total} issues están entregadas y mergeadas`}</p>
          <p>{`${story} está terminado.`}</p>
          <Button onClick={onClose}>{CLOSE_LABEL}</Button>
        </>
      ) : (
        <ul className="milestone-board__list">
          {progress.issues.map((line) => (
            <li key={line.number}>
              <SliceLineRow line={line} now={now} onTalk={onTalk} repo={repo} onReread={onReread} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export { MilestoneBoard }
export type { MilestoneBoardProps }
