import type { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { RecoveryAction } from 'app/active-plans/ActivePlan.types'
import { ImplementProgress } from 'app/implement-progress/components/implement-progress'
import { useImplementProgress } from 'app/implement-progress/useImplementProgress'
import { PlanningProgress } from 'app/planning-progress/components/planning-progress'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import './SliceSession.css'

const UNCERTAIN_TITLE = 'No se puede confirmar el estado de implementación'
const RECOVER_LABEL = 'Recuperar trabajo'
const CLEANUP_LABEL = 'Limpiar arranque fallido'
const RETRY_LABEL = 'Reintentar recuperación'

type SliceRecovery = {
  diagnostic: string
  action: RecoveryAction
  pending: boolean
  failure: string | null
  onAct: () => void
  onRetry: () => void
}

type SlicePhase = ActivePlan['phase']

type SliceSessionProps = {
  issue: number
  root: string
  repo: string
  phase: SlicePhase
  recovery?: SliceRecovery | null
}

const actionLabel = (action: RecoveryAction) => (action === 'cleanup' ? CLEANUP_LABEL : RECOVER_LABEL)

const SliceImplementationPanel = ({ issue, root, repo }: { issue: number; root: string; repo: string }) => {
  const progress = useImplementProgress(issue, root, repo)
  return <ImplementProgress progress={progress} />
}

const SlicePanel = ({ issue, root, repo, phase }: { issue: number; root: string; repo: string; phase: SlicePhase }) => {
  switch (phase) {
    case 'planning':
      return <PlanningProgress issue={issue} repo={repo} />
    case 'implementing':
    case 'uncertain':
      return <SliceImplementationPanel issue={issue} root={root} repo={repo} />
    default: {
      const exhaustive: never = phase
      throw new Error(`unsupported slice phase: ${JSON.stringify(exhaustive)}`)
    }
  }
}

const SliceSession = ({ issue, root, repo, phase, recovery = null }: SliceSessionProps) => {
  return (
    <section className="slice-session" aria-label={`Slice #${issue}`}>
      <h2 className="slice-session__title lg-body-medium">{`Slice #${issue}`}</h2>
      <SlicePanel issue={issue} root={root} repo={repo} phase={phase} />
      {recovery !== null && (
        <div className="slice-session__recovery">
          <Banner
            type="warning"
            role="alert"
            title={UNCERTAIN_TITLE}
            description={recovery.failure ?? recovery.diagnostic}
          />
          <div className="slice-session__recovery-actions">
            {recovery.action === 'inspect' ? (
              <Button onClick={recovery.onRetry}>{RETRY_LABEL}</Button>
            ) : (
              <Button disabled={recovery.pending} onClick={recovery.onAct}>{actionLabel(recovery.action)}</Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export { SliceSession }
export type { SliceRecovery, SliceSessionProps }
