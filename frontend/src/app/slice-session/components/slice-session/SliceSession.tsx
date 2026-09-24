import { useEffect, useMemo } from 'react'
import { PlanRefusal, RecoveryAction } from 'app/active-plans/ActivePlan.types'
import { ImplementProgress } from 'app/implement-progress/components/implement-progress'
import type { ImplementProgressRead } from 'app/implement-progress/ImplementProgress.types'
import type { WorkProgressRead } from 'app/work-progress/WorkProgress.types'
import { useWorkProgress } from 'app/work-progress/useWorkProgress'
import { WorkProgressPresentation } from 'app/work-progress/presentation'
import { PlanningProgress } from 'app/planning-progress/components/planning-progress'
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

type SliceSessionProps = {
  issue: number
  repo: string
  agent: string
  recovery?: SliceRecovery | null
  onSelect?: (() => void) | null
  onProgress?: ((progress: ImplementProgressRead) => void) | null
}

const actionLabel = (action: RecoveryAction) => (action === 'cleanup' ? CLEANUP_LABEL : RECOVER_LABEL)

type SliceImplementationPanelProps = {
  recovery: SliceRecovery | null
  onSelect: (() => void) | null
  onProgress: ((progress: ImplementProgressRead) => void) | null
  progress: ImplementProgressRead
  observation: ImplementProgressRead
}

const SliceImplementationPanel = ({ recovery, onSelect, onProgress, progress, observation }: SliceImplementationPanelProps) => {
  const closure = recovery?.refusal ?? null
  const vetoed = closure !== null && closure.state === BLOCKED_JUDGE && closure.outcome === VETOED
    ? closure
    : null

  useEffect(() => {
    onProgress?.(observation)
  }, [observation, onProgress])

  return (
    <>
      {onSelect !== null && <Button variant="secondary" onClick={onSelect}>Ver detalle</Button>}
      {progress.phase !== 'unreachable' && (recovery === null || progress.phase !== 'waiting') && <ImplementProgress progress={progress} />}
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
    </>
  )
}

const SliceProgress = ({ issue, read, recovery = null, onSelect = null, onProgress = null, showUncertainty = true }: Omit<SliceSessionProps, 'repo' | 'agent'> & { read: WorkProgressRead; showUncertainty?: boolean }) => {
  const progress = useMemo(() => WorkProgressPresentation.execution(read), [read])
  const observation = useMemo(() => WorkProgressPresentation.observation(read), [read])
  const snapshot = read.kind === 'read' || read.kind === 'stale' ? read.snapshot : null
  const planning = snapshot?.progress.phase === 'planning' ? snapshot.progress : null
  const uncertain = snapshot?.progress.phase === 'uncertain' ? snapshot.progress : null
  const partial = snapshot?.progress.phase === 'implementing' && snapshot.progress.execution.kind === 'partial'
    ? snapshot.progress.execution
    : null
  return (
    <section className="slice-session" aria-label={`Slice #${issue}`}>
      <h2 className="slice-session__title lg-body-medium">{`Slice #${issue}`}</h2>
      {(read.kind === 'stale' || read.kind === 'unavailable') && <Banner type="warning" role="alert" title={read.detail} description={read.kind === 'stale' ? 'Mostramos la última lectura. Reintentando la conexión…' : 'Reintentando la lectura…'} />}
      {uncertain !== null && recovery === null && showUncertainty && <Banner type="warning" role="alert" title={UNCERTAIN_TITLE} description={uncertain.diagnostic} />}
      {partial !== null && <Banner type="warning" role="alert" title="Entrega a GitHub sin confirmar" description={partial.detail} />}
      {planning !== null ? (
        <>
          {onSelect !== null && <Button variant="secondary" onClick={onSelect}>Ver detalle</Button>}
          <section aria-label="Progreso del plan">
            {planning.plan.kind === 'available'
              ? <p role="status">{planning.plan.value === 'ready' ? 'Plan listo' : 'Escribiendo el plan…'}</p>
              : <Banner type="warning" role="alert" title="Estado del plan no disponible" description={planning.plan.detail} />}
          </section>
          <PlanningProgress progress={planning.activity} />
        </>
      ) : (
      <SliceImplementationPanel
        progress={progress}
        observation={observation}
        recovery={recovery}
        onSelect={onSelect}
        onProgress={onProgress}
      />
      )}
    </section>
  )
}

const SliceSession = (props: SliceSessionProps) => {
  const read = useWorkProgress({ repo: props.repo, issue: props.issue, agent: props.agent })
  return <SliceProgress {...props} read={read} />
}

export { SliceSession, SliceProgress }
export type { SliceRecovery, SliceSessionProps }
