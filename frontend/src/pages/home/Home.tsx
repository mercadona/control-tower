import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { ActivePlansClient } from 'app/active-plans/client'
import { ToolsStatus } from 'app/external-tools/components/tools-status'
import { ImplementPlanAction } from 'app/implement-plan/components/implement-plan-action'
import { ImplementProgress } from 'app/implement-progress/components/implement-progress'
import { PlanProgress } from 'app/plan-events/components/plan-progress'
import { AskPlanChanges } from 'app/review-plan/components/ask-plan-changes'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'
import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'
import { WorkflowSnapshot, WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { TopBar } from 'system-ui/top-bar'
import { WorkflowStep, WorkflowStepStatus } from 'system-ui/workflow-step'
import './Home.css'

type WorkflowStageName = 'request' | 'review' | 'implementation'
type Reconciliation = 'not-required' | 'checking' | 'confirmed' | 'stale' | 'unavailable' | 'inconclusive' | 'uncertain' | 'uncertain-start'

const isSameWorkflow = (workflow: WorkflowSnapshot, active: ActivePlan) =>
  workflow.request.id === active.request.id &&
  workflow.request.repo === active.request.repo &&
  workflow.plan.id === active.plan.id &&
  workflow.plan.repo === active.plan.repo &&
  workflow.plan.issue.number === active.plan.issue.number &&
  workflow.plan.agent === active.plan.agent

const isSameRequest = (request: StartPlanRequest, active: ActivePlan) =>
  request.id === active.request.id && request.repo === active.request.repo && request.path === active.request.path

const Home = () => {
  const [workflow, setWorkflow] = useState<WorkflowSnapshot | null>(() => WorkflowSnapshotStorage.load())
  const workflowRef = useRef(workflow)
  const restoredRef = useRef(workflow !== null)
  const [reconciliation, setReconciliation] = useState<Reconciliation>(workflow === null ? 'not-required' : 'checking')
  const [candidates, setCandidates] = useState<ActivePlan[]>([])
  const [uncertainRequest, setUncertainRequest] = useState<StartPlanRequest | null>(null)
  const [expandedSummary, setExpandedSummary] = useState<WorkflowStageName | null>(null)
  const [requestFormVersion, setRequestFormVersion] = useState(0)
  const recoveryStartedRef = useRef(false)
  const retryingRef = useRef(false)
  const recoveryTokenRef = useRef<symbol | null>(null)
  const mountedRef = useRef(false)

  const selectWorkflow = useCallback((selected: WorkflowSnapshot, restored = true) => {
    workflowRef.current = selected
    restoredRef.current = restored
    setWorkflow(selected)
    setReconciliation(restored ? 'confirmed' : 'not-required')
    setCandidates([])
    setUncertainRequest(null)
    setExpandedSummary(null)
    WorkflowSnapshotStorage.save(selected)
  }, [])

  const selectActivePlan = useCallback((active: ActivePlan) => {
    if (active.phase === 'uncertain') {
      workflowRef.current = null
      restoredRef.current = false
      setWorkflow(null)
      setUncertainRequest(active.request)
      setCandidates([])
      setExpandedSummary(null)
      setReconciliation('uncertain')
      return
    }
    selectWorkflow({ phase: active.phase, request: active.request, plan: active.plan })
  }, [selectWorkflow])

  const reconcile = useCallback(async (submittedRequest?: StartPlanRequest) => {
    const token = Symbol('recovery')
    recoveryTokenRef.current = token
    const outcome = await ActivePlansClient.get()
    if (!mountedRef.current || recoveryTokenRef.current !== token) return

    const current = workflowRef.current
    if (current !== null && restoredRef.current) {
      if (outcome.kind === 'unavailable') {
        setReconciliation('unavailable')
        return
      }
      if (outcome.kind === 'inconclusive') {
        setReconciliation('inconclusive')
        return
      }

      const active = outcome.plans.find((candidate) => isSameWorkflow(current, candidate))
      if (active === undefined) {
        setReconciliation('stale')
        return
      }

      if (active.phase === 'uncertain') {
        setReconciliation('uncertain')
        return
      }

      const reconciled: WorkflowSnapshot = {
        ...current,
        phase: active.phase === 'implementing' ? 'implementing' : current.phase === 'ready' ? 'ready' : 'planning',
      }
      workflowRef.current = reconciled
      setWorkflow(reconciled)
      setExpandedSummary(null)
      setReconciliation('confirmed')
      WorkflowSnapshotStorage.save(reconciled)
      return
    }

    if (current !== null) return
    if (submittedRequest !== undefined) {
      if (outcome.kind === 'unavailable') {
        setReconciliation('unavailable')
        return
      }
      if (outcome.kind === 'inconclusive') {
        setReconciliation('inconclusive')
        return
      }
      const active = outcome.plans.find((candidate) => isSameRequest(submittedRequest, candidate))
      if (active === undefined) {
        setReconciliation('uncertain-start')
        return
      }
      selectActivePlan(active)
      return
    }
    if (outcome.kind !== 'loaded') {
      setReconciliation(outcome.kind)
      return
    }
    if (outcome.plans.length === 1) {
      selectActivePlan(outcome.plans[0])
    } else if (outcome.plans.length > 1) {
      setCandidates(outcome.plans)
    } else {
      setReconciliation('not-required')
    }
  }, [selectActivePlan])

  useEffect(() => {
    mountedRef.current = true
    if (!recoveryStartedRef.current) {
      recoveryStartedRef.current = true
      void reconcile()
    }

    return () => {
      mountedRef.current = false
    }
  }, [reconcile])

  const formInteracted = useCallback(() => {
    recoveryTokenRef.current = null
    setCandidates([])
  }, [])

  const expandSummary = (stage: WorkflowStageName) => (isExpanded: boolean) => {
    setExpandedSummary(isExpanded ? stage : null)
  }

  const planStarted = useCallback(
    (plan: StartedPlan, request: StartPlanRequest) => {
      if (workflowRef.current !== null) return
      selectWorkflow({ phase: 'planning', request, plan }, false)
    },
    [selectWorkflow],
  )

  const planStartUncertain = useCallback((request: StartPlanRequest) => {
    if (workflowRef.current !== null) return
    setUncertainRequest(request)
    setCandidates([])
    setReconciliation('checking')
    void reconcile(request)
  }, [reconcile])

  const planReady = useCallback(() => {
    const current = workflowRef.current
    if (current === null || current.phase === 'implementing') return
    const ready: WorkflowSnapshot = { ...current, phase: 'ready' }
    workflowRef.current = ready
    setWorkflow(ready)
    WorkflowSnapshotStorage.save(ready)
  }, [])

  const implementationStarted = useCallback(() => {
    const current = workflowRef.current
    if (current === null) return
    const implementing: WorkflowSnapshot = { ...current, phase: 'implementing' }
    workflowRef.current = implementing
    setWorkflow(implementing)
    WorkflowSnapshotStorage.save(implementing)
  }, [])

  const discardWorkflow = () => {
    recoveryTokenRef.current = null
    workflowRef.current = null
    restoredRef.current = false
    setWorkflow(null)
    setReconciliation('not-required')
    setCandidates([])
    setUncertainRequest(null)
    setExpandedSummary(null)
    setRequestFormVersion((version) => version + 1)
    WorkflowSnapshotStorage.remove()
  }

  const retryReconciliation = () => {
    retryingRef.current = true
    setReconciliation('checking')
    void reconcile(uncertainRequest ?? undefined)
  }

  const hasDiscardableState = restoredRef.current || uncertainRequest !== null
  const restoredNeedsRecovery = restoredRef.current && (reconciliation === 'stale' || reconciliation === 'unavailable' || reconciliation === 'inconclusive' || reconciliation === 'uncertain')
  const restoredIsConfirmed = !restoredRef.current || reconciliation === 'confirmed'
  const showRestoredDiscard = restoredRef.current && workflow?.phase !== 'implementing' && !restoredNeedsRecovery

  const currentStage: WorkflowStageName = workflow === null
    ? 'request'
    : workflow.phase === 'implementing'
      ? 'implementation'
      : 'review'
  const reviewIsComplete = workflow?.phase === 'implementing'
  const requestStatus: WorkflowStepStatus = workflow === null ? 'active' : 'completed'
  const reviewStatus: WorkflowStepStatus = workflow === null ? 'pending' : reviewIsComplete ? 'completed' : 'active'
  const implementationStatus: WorkflowStepStatus = workflow?.phase === 'implementing' ? 'active' : 'pending'
  const reviewDescription = !restoredIsConfirmed
    ? 'Estamos comprobando el estado del plan guardado.'
    : workflow?.phase === 'planning'
      ? 'Seguimos el estado del plan. Aún no necesitas hacer nada.'
      : 'El plan está listo. Revísalo antes de decidir si quieres implementarlo.'

  const recovery = (
    <>
      {reconciliation === 'checking' && (restoredRef.current || uncertainRequest !== null) && (
        <div className="home__recovery">
          <Banner type="informative" title="Comprobando que el plan sigue activo" />
          {workflow?.phase !== 'implementing' && (
            <Button variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
          )}
        </div>
      )}
      {reconciliation === 'stale' && (
        <div className="home__recovery">
          <Banner
            type="warning"
            role="alert"
            title="El plan guardado ya no está activo"
            description="El backend o cmux ya no tiene este plan activo. Descarta el estado para crear una solicitud nueva."
          />
          <Button variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
        </div>
      )}
      {reconciliation === 'unavailable' && (
        <div className="home__recovery">
          <Banner
            type="warning"
            role="alert"
            title={restoredRef.current ? 'No se pudo comprobar el plan guardado' : 'No se pudo comprobar el estado del plan'}
            description="No se pudo contactar con el backend. No se harán acciones hasta que se confirme el estado."
          />
          <div className="home__recovery-actions">
            <Button onClick={retryReconciliation}>Reintentar</Button>
            {hasDiscardableState && (
              <Button variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
            )}
          </div>
        </div>
      )}
      {reconciliation === 'inconclusive' && (
        <div className="home__recovery">
          <Banner
            type="warning"
            role="alert"
            title={restoredRef.current ? 'No se puede confirmar el plan guardado' : 'No se puede saber qué hay en marcha'}
            description="El backend contestó, pero no pudo preguntar a cmux. No puede saber qué planes hay activos. No se harán acciones hasta que se confirme el estado."
          />
          <div className="home__recovery-actions">
            <Button onClick={retryReconciliation}>Reintentar</Button>
            {hasDiscardableState && (
              <Button variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
            )}
          </div>
        </div>
      )}
      {(reconciliation === 'uncertain' || reconciliation === 'uncertain-start') && (
        <div className="home__recovery">
          <Banner
            type="warning"
            role="alert"
            title={reconciliation === 'uncertain-start' ? 'No se puede confirmar si el plan arrancó' : 'No se puede confirmar el estado de implementación'}
            description={reconciliation === 'uncertain-start'
              ? 'La solicitud puede completarse más tarde. Reintenta la recuperación o descarta el estado para crear otra solicitud.'
              : 'No se abrirán eventos ni se podrá implementar hasta que el backend confirme el estado.'}
          />
          <div className="home__recovery-actions">
            <Button onClick={retryReconciliation}>Reintentar recuperación</Button>
            <Button variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
          </div>
        </div>
      )}
    </>
  )

  return (
    <div className="home">
      <TopBar
        productName="Control Tower"
        logo={<span className="home__logo">CT</span>}
        actions={<ToolsStatus />}
      />
      <main className="home__content">
        <nav className="home__flow" aria-label="Flujo del plan">
          <ol>
            {[
              { number: 1, name: 'Solicitud', stage: 'request', status: requestStatus },
              { number: 2, name: 'Revisar plan', stage: 'review', status: reviewStatus },
              { number: 3, name: 'Implementación', stage: 'implementation', status: implementationStatus },
            ].map((step) => (
              <li
                key={step.stage}
                className={`home__flow-step home__flow-step--${step.status}`}
                aria-current={step.stage === currentStage ? 'step' : undefined}
              >
                <span className="home__flow-number">{step.number}</span>
                <span>{step.name}</span>
                <span className="lg-caption1-regular">
                  {step.status === 'completed' ? 'Completado' : step.status === 'active' ? 'En curso' : 'Pendiente'}
                </span>
              </li>
            ))}
          </ol>
        </nav>

        <section className="home__workspace" aria-labelledby={`workspace-${currentStage}`}>
          {currentStage === 'request' && (
            <>
              <header className="home__workspace-heading">
                <span className="home__workspace-number">1</span>
                <div>
                  <h1 id="workspace-request" className="lg-title3-semibold">Solicitud</h1>
                  <p>Cuéntanos qué quieres planificar y dónde está el repositorio.</p>
                </div>
              </header>
              {recovery}
              {candidates.length > 1 && (
                <ul className="home__active-plans" aria-label="Planes activos">
                  {candidates.map((candidate) => (
                    <li key={`${candidate.plan.repo}:${candidate.plan.issue.number}`} className="home__active-plan">
                      <span>
                        <strong>{candidate.request.id}</strong> · <code>{candidate.request.repo}</code> · issue #{candidate.plan.issue.number}
                      </span>
                      <Button
                        variant="secondary"
                        aria-label={`Continuar plan ${candidate.request.id}, ${candidate.request.repo}, issue #${candidate.plan.issue.number}`}
                        onClick={() => selectActivePlan(candidate)}
                      >
                        Continuar plan
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <StartPlanForm
                key={requestFormVersion}
                onStarted={planStarted}
                onBackendUnreachable={planStartUncertain}
                onInteraction={formInteracted}
                isLocked={uncertainRequest !== null}
                isMutationBlocked={reconciliation === 'unavailable' || reconciliation === 'inconclusive' || (reconciliation === 'checking' && retryingRef.current)}
                request={uncertainRequest ?? undefined}
              />
            </>
          )}

          {currentStage === 'review' && workflow !== null && (
            <>
              <header className="home__workspace-heading">
                <span className="home__workspace-number">2</span>
                <div>
                  <h1 id="workspace-review" className="lg-title3-semibold">Revisar plan</h1>
                  <p>{reviewDescription}</p>
                </div>
              </header>
              {recovery}
              <PlanProgress
                key={`${workflow.plan.repo}:${workflow.plan.issue.number}`}
                plan={workflow.plan}
                onReady={planReady}
                observe={workflow.phase === 'planning' && restoredIsConfirmed}
              />
              {workflow.phase === 'ready' && restoredIsConfirmed && (
                <div className="home__review-action">
                  <a href={workflow.plan.issue.url} target="_blank" rel="noreferrer" className="home__issue-link lg-body-medium">
                    Abrir el plan en GitHub
                  </a>
                  <AskPlanChanges plan={workflow.plan} />
                  <ImplementPlanAction
                    plan={workflow.plan}
                    onImplementationStarted={implementationStarted}
                  />
                </div>
              )}
              {showRestoredDiscard && workflow.phase === 'planning' && (
                <Button className="home__discard" variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
              )}
              {showRestoredDiscard && workflow.phase === 'ready' && (
                <Button className="home__discard" variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
              )}
            </>
          )}

          {currentStage === 'implementation' && workflow !== null && (
            <>
              <header className="home__workspace-heading">
                <span className="home__workspace-number">3</span>
                <div>
                  <h1 id="workspace-implementation" className="lg-title3-semibold">Implementación</h1>
                  <p>Seguimos la implementación. Aquí verás el progreso que comunica el backend.</p>
                </div>
              </header>
              {recovery}
              {restoredIsConfirmed && (
                <ImplementPlanAction
                  plan={workflow.plan}
                  onImplementationStarted={implementationStarted}
                  isImplementationStarted
                />
              )}
              {restoredIsConfirmed && (
                <ImplementProgress
                  key={`${workflow.plan.repo}:${workflow.plan.issue.number}`}
                  issue={workflow.plan.issue.number}
                  root={workflow.plan.root ?? workflow.request.path}
                  repo={workflow.plan.repo}
                />
              )}
              {restoredIsConfirmed && (
                <Button className="home__start-another" type="button" variant="secondary" onClick={discardWorkflow}>
                  Arrancar otro plan
                </Button>
              )}
            </>
          )}
        </section>

        {workflow !== null && (
          <section className="home__completed" aria-label="Etapas completadas">
            <WorkflowStep
              title="Solicitud"
              status="completed"
              isExpanded={expandedSummary === 'request'}
              onExpandedChange={expandSummary('request')}
            >
              <StartPlanForm
                key={requestFormVersion}
                onStarted={planStarted}
                onBackendUnreachable={planStartUncertain}
                onInteraction={formInteracted}
                isLocked
                request={workflow.request}
              />
            </WorkflowStep>
            {reviewIsComplete && (
              <WorkflowStep
                title="Revisar plan"
                subtitle="Plan revisado"
                status="completed"
                isExpanded={expandedSummary === 'review'}
                onExpandedChange={expandSummary('review')}
              >
                <PlanProgress
                  plan={workflow.plan}
                  onReady={planReady}
                  observe={false}
                />
              </WorkflowStep>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

export { Home }
