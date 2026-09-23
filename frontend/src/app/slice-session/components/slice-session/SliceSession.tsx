import { useEffect } from 'react'
import { ImplementProgress } from 'app/implement-progress/components/implement-progress'
import { ImplementProgressRead, useImplementProgress } from 'app/implement-progress/useImplementProgress'
import { PlanRefusal, RecoveryAction } from 'app/active-plans/ActivePlan.types'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import './SliceSession.css'

const UNCERTAIN_TITLE = 'No se puede confirmar el estado de implementación'
const RECOVER_LABEL = 'Recuperar trabajo'
const CLEANUP_LABEL = 'Limpiar arranque fallido'
const RETRY_LABEL = 'Reintentar recuperación'
const VETOED_TITLE = 'El juez cerró este slice'
const VETOED_HINT = 'Habla con la sesión coordinadora para decidir qué hacer.'
const FOUND_LABEL = 'Lo que encontró el juez'
const VERDICT_LABEL = 'Veredicto completo'
const BLOCKED_JUDGE = 'blocked-judge'
const VETOED = 'failed'

type SliceRecovery = {
  diagnostic: string
  action: RecoveryAction
  pending: boolean
  failure: string | null
  refusal?: PlanRefusal | null
  onAct: () => void
  onRetry: () => void
}

interface SliceSessionProps {
  issue: number
  root: string
  repo: string
  recovery?: SliceRecovery | null
  onSelect?: (() => void) | null
  onProgress?: ((progress: ImplementProgressRead) => void) | null
}

const actionLabel = (action: RecoveryAction) => (action === 'cleanup' ? CLEANUP_LABEL : RECOVER_LABEL)

const SliceSession = ({ issue, root, repo, recovery = null, onSelect = null, onProgress = null }: SliceSessionProps) => {
  const progress = useImplementProgress(issue, root, repo)
  const closure = recovery?.refusal ?? null
  const vetoed = closure !== null && closure.state === BLOCKED_JUDGE && closure.outcome === VETOED
    ? closure
    : null

  useEffect(() => {
    onProgress?.(progress)
  }, [progress, onProgress])

  return (
    <section className="slice-session" aria-label={`Slice #${issue}`}>
      <h2 className="slice-session__title lg-body-medium">{`Slice #${issue}`}</h2>
      {onSelect !== null && <Button variant="secondary" onClick={onSelect}>Ver detalle</Button>}
      <ImplementProgress progress={progress} />
      {recovery !== null && (
        <div className="slice-session__recovery">
          <Banner
            type="warning"
            role="alert"
            title={vetoed === null ? UNCERTAIN_TITLE : VETOED_TITLE}
            description={vetoed === null ? (recovery.failure ?? recovery.diagnostic) : VETOED_HINT}
          />
          {vetoed !== null && (
            <dl className="slice-session__veto">
              {vetoed.findings !== null && (
                <>
                  <dt className="lg-body-small">{FOUND_LABEL}</dt>
                  <dd className="slice-session__veto-findings">{vetoed.findings}</dd>
                </>
              )}
              {vetoed.verdict !== null && (
                <>
                  <dt className="lg-body-small">{VERDICT_LABEL}</dt>
                  <dd className="slice-session__veto-verdict">{vetoed.verdict}</dd>
                </>
              )}
            </dl>
          )}
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
