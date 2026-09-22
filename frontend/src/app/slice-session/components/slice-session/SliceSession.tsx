import { ImplementProgress } from 'app/implement-progress/components/implement-progress'
import { useImplementProgress } from 'app/implement-progress/useImplementProgress'
import { RecoveryAction } from 'app/active-plans/ActivePlan.types'
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

type SliceSessionProps = {
  issue: number
  root: string
  repo: string
  recovery?: SliceRecovery | null
  onSelect?: () => void
}

const actionLabel = (action: RecoveryAction) => (action === 'cleanup' ? CLEANUP_LABEL : RECOVER_LABEL)

const SliceSession = ({ issue, root, repo, recovery = null, onSelect }: SliceSessionProps) => {
  const progress = useImplementProgress(issue, root, repo)

  return (
    <section className="slice-session" aria-label={`Slice #${issue}`}>
      <h2 className="slice-session__title lg-body-medium">{`Slice #${issue}`}</h2>
      {onSelect !== undefined && <Button variant="secondary" onClick={onSelect}>Ver detalle</Button>}
      <ImplementProgress progress={progress} />
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
