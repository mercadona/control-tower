import { SliceLineRow } from 'app/milestone-progress/components/slice-line-row'
import { useSecondTick } from 'app/milestone-progress/useSecondTick'
import type { MilestoneProgressOutcome } from 'app/milestone-progress/MilestoneProgress.types'
import { Banner } from 'system-ui/banner'
import './MilestoneBoard.css'

const BOARD_LABEL = 'Issues del milestone'
const BASELINE_TITLE = 'El repositorio ya estaba en rojo antes de empezar.'
const BASELINE_DESCRIPTION = 'Un slice puede fallar por algo que no ha tocado.'

type MilestoneBoardProps = {
  progress: MilestoneProgressOutcome | null
  onTalk: (() => void) | null
  repo: string
  story: string
  onReread: () => void
  onClose: () => void
}

const MilestoneBoard = ({ progress, onTalk, repo, onReread }: MilestoneBoardProps) => {
  const now = useSecondTick()
  if (progress === null || progress.kind !== 'milestone') return null

  const baselineRed = progress.issues.some((line) => line.baselineRed)

  return (
    <section className="milestone-board" aria-label={BOARD_LABEL}>
      {baselineRed && <Banner type="warning" role="alert" title={BASELINE_TITLE} description={BASELINE_DESCRIPTION} />}
      <p className="milestone-board__summary">{`${progress.delivered} de ${progress.total} entregadas`}</p>
      <ul className="milestone-board__list">
        {progress.issues.map((line) => (
          <li key={line.number}>
            <SliceLineRow line={line} now={now} onTalk={onTalk} repo={repo} onReread={onReread} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export { MilestoneBoard }
export type { MilestoneBoardProps }
