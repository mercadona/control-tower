import { ImplementProgress } from 'app/implement-progress/components/implement-progress'
import { useImplementProgress } from 'app/implement-progress/useImplementProgress'
import './SliceSession.css'

type SliceSessionProps = { issue: number; root: string; repo: string }

const SliceSession = ({ issue, root, repo }: SliceSessionProps) => {
  const progress = useImplementProgress(issue, root, repo)

  return (
    <section className="slice-session" aria-label={`Slice #${issue}`}>
      <h2 className="slice-session__title lg-body-medium">{`Slice #${issue}`}</h2>
      <ImplementProgress progress={progress} />
    </section>
  )
}

export { SliceSession }
export type { SliceSessionProps }
