import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { ActivePlansClient } from 'app/active-plans/client'
import { CoordinatingSessionStatus } from 'app/coordinating-session/components/coordinating-session-status'
import { useCoordinatingSession } from 'app/coordinating-session/useCoordinatingSession'
import { ToolsNavbar } from 'app/external-tools/components/tools-navbar'
import { GateSequence } from 'app/gate-sequence/components/gate-sequence'
import { useEpicGroom } from 'app/epic-groom/useEpicGroom'
import { useSpecFreeze } from 'app/spec-freeze/useSpecFreeze'
import { ImplementHistory } from 'app/implement-history/components/implement-history'
import { WorkDetails } from 'app/work-progress/WorkDetails'
import { useWorkConclusion } from 'app/work-progress/useWorkConclusion'
import { useWorkProgress } from 'app/work-progress/useWorkProgress'
import { SessionsPanel } from 'app/sessions/components/sessions-panel'
import { SliceSession, SliceProgress, type SliceRecovery } from 'app/slice-session/components/slice-session'
import { sharesCheckout, useAutomaticSliceSelection } from 'app/slice-session/useAutomaticSliceSelection'
import { BaselineNotice } from 'app/start-plan/components/baseline-notice'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'
import { StartPlanRequest } from 'app/start-plan/StartPlan.types'
import { WorkflowSnapshot, WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { ColumnResizer } from 'pages/home/components/column-resizer'
import { useSessionsColumnCollapse } from 'pages/home/useSessionsColumnCollapse'
import { useSessionsColumnWidth } from 'pages/home/useSessionsColumnWidth'
import { Banner } from 'system-ui/banner'
import { Breadcrumbs } from 'system-ui/breadcrumbs'
import { Button } from 'system-ui/button'
import { Drawer } from 'system-ui/drawer'
import { Navigation } from 'system-ui/navigation'
import { TopBar } from 'system-ui/top-bar'
import { WorkflowStep, WorkflowStepStatus } from 'system-ui/workflow-step'
import './Home.css'

const SESSIONS_COLUMN_LABEL = 'Ancho del panel de sesiones'
const SESSIONS_DRAWER_COLLAPSED_WIDTH_PX = 48
const ACTIVE_PLANS_POLL_INTERVAL_MS = 2000
const NO_COORDINATING_TARGET = 'no-coordinating-target'

type WorkflowStageName = 'request' | 'implementation'
type Reconciliation = 'not-required' | 'checking' | 'confirmed' | 'stale' | 'unavailable' | 'inconclusive' | 'uncertain'

const STAGE_LABEL: Record<WorkflowStageName, string> = {
  request: 'Solicitud',
  implementation: 'Implementación',
}

const isSameWorkflow = (workflow: WorkflowSnapshot, active: ActivePlan) =>
  workflow.request.id === active.request.id &&
  workflow.request.repo === active.request.repo &&
  workflow.plan.id === active.plan.id &&
  workflow.plan.repo === active.plan.repo &&
  workflow.plan.issue.number === active.plan.issue.number &&
  workflow.plan.agent === active.plan.agent

const activePlanIdentity = (active: ActivePlan) => `${active.plan.repo}:${active.plan.issue.number}:${active.plan.agent}`

const workflowIdentity = (workflow: WorkflowSnapshot) => `${workflow.plan.repo}:${workflow.plan.issue.number}:${workflow.plan.agent}`

const Home = () => {
  const [workflow, setWorkflow] = useState<WorkflowSnapshot | null>(() => WorkflowSnapshotStorage.load())
  const workflowRef = useRef(workflow)
  const restoredRef = useRef(workflow !== null)
  const [reconciliation, setReconciliation] = useState<Reconciliation>(workflow === null ? 'not-required' : 'checking')
  const [slicesInFlight, setSlicesInFlight] = useState<ActivePlan[]>([])
  const [activePlans, setActivePlans] = useState<ActivePlan[]>([])
  const [dispatchedSlices, setDispatchedSlices] = useState(0)
  const [uncertainRequest, setUncertainRequest] = useState<StartPlanRequest | null>(null)
  const [brainstormingUnreachable, setBrainstormingUnreachable] = useState(false)
  const sessionsRef = useRef<HTMLDivElement | null>(null)
  const columnsRef = useRef<HTMLDivElement>(null)
  const sessionsColumnWidth = useSessionsColumnWidth(columnsRef)
  const coordinatingSession = useCoordinatingSession()
  const specFreezeRead = useSpecFreeze(coordinatingSession.target)
  const epicGroomRead = useEpicGroom(false, coordinatingSession.target)
  const sessionsColumnCollapse = useSessionsColumnCollapse(coordinatingSession.target)
  const [requestExpanded, setRequestExpanded] = useState(false)
  const [requestFormVersion, setRequestFormVersion] = useState(0)
  const recoveryStartedRef = useRef(false)
  const retryingRef = useRef(false)
  const recoveryTokenRef = useRef<symbol | null>(null)
  const recoveryGenerationRef = useRef(0)
  const recoveryInFlightRef = useRef<Promise<void> | null>(null)
  const recoveryMutationRef = useRef<symbol | null>(null)
  const [recoveryMutationPending, setRecoveryMutationPending] = useState(false)
  const [recoveryFailure, setRecoveryFailure] = useState<string | null>(null)
  const [recoveringSlice, setRecoveringSlice] = useState<string | null>(null)
  const [sliceRecoveryFailure, setSliceRecoveryFailure] = useState<{ identity: string, detail: string } | null>(null)
  const discardedPlansRef = useRef(new Set<string>())
  const uncertainActiveRef = useRef<ActivePlan | null>(null)
  const mountedRef = useRef(false)
  const liveCoordinatingSession = coordinatingSession.read.phase === 'read' && coordinatingSession.read.kind === 'live'
    ? coordinatingSession.read
    : null
  const isCoordinatingSessionLive = liveCoordinatingSession !== null
  const coordinatingConversation = coordinatingSession.opened?.conversation ?? liveCoordinatingSession?.conversation ?? null
  const coordinatingConversationRef = useRef(coordinatingConversation)

  useEffect(() => {
    if (coordinatingConversationRef.current === coordinatingConversation) return
    recoveryGenerationRef.current += 1
    recoveryTokenRef.current = null
    coordinatingConversationRef.current = coordinatingConversation
  }, [coordinatingConversation])

  const selectWorkflow = useCallback((selected: WorkflowSnapshot, restored = true) => {
    recoveryGenerationRef.current += 1
    workflowRef.current = selected
    restoredRef.current = restored
    uncertainActiveRef.current = null
    setRecoveryFailure(null)
    setWorkflow(selected)
    setReconciliation(restored ? 'confirmed' : 'not-required')
    setUncertainRequest(null)
    setRequestExpanded(false)
    WorkflowSnapshotStorage.save(selected)
  }, [])

  const selectActivePlan = useCallback((active: ActivePlan) => {
    if (active.phase === 'uncertain') {
      recoveryGenerationRef.current += 1
      workflowRef.current = null
      restoredRef.current = false
      uncertainActiveRef.current = active
      setRecoveryFailure(null)
      setWorkflow(null)
      setUncertainRequest(active.request)
      setRequestExpanded(false)
      setReconciliation('uncertain')
      return
    }
    selectWorkflow({ phase: active.phase, request: active.request, plan: active.plan })
  }, [selectWorkflow])

  const selectSlice = useCallback((slice: ActivePlan) => {
    selectActivePlan(slice)
    setSlicesInFlight(activePlans.filter((active) => activePlanIdentity(active) !== activePlanIdentity(slice)))
  }, [activePlans, selectActivePlan])

  const observeSliceProgress = useAutomaticSliceSelection({
    workflow,
    plans: activePlans,
    enabled: reconciliation === 'confirmed' || reconciliation === 'stale',
    onSelect: selectSlice,
  })

  const adoptFromRead = useCallback((plans: ActivePlan[]): ActivePlan | null => {
    const current = workflowRef.current
    if (current !== null) {
      const active = plans.find((candidate) => isSameWorkflow(current, candidate))
      if (active === undefined) {
        setReconciliation('stale')
        return null
      }
      if (active.phase === 'uncertain') {
        uncertainActiveRef.current = active
        setReconciliation('uncertain')
        return active
      }

      uncertainActiveRef.current = null
      const reconciled: WorkflowSnapshot = {
        ...current,
        phase: active.phase,
      }
      workflowRef.current = reconciled
      setWorkflow(reconciled)
      setReconciliation('confirmed')
      WorkflowSnapshotStorage.save(reconciled)
      return active
    }

    const uncertain = uncertainActiveRef.current
    if (uncertain !== null) {
      const active = plans.find((candidate) => activePlanIdentity(candidate) === activePlanIdentity(uncertain))
      if (active === undefined) {
        setReconciliation('stale')
        return null
      }
      if (active.phase === 'uncertain') {
        uncertainActiveRef.current = active
        setUncertainRequest(active.request)
        setReconciliation('uncertain')
        return active
      }
      selectActivePlan(active)
      return active
    }

    if (plans.length === 1) {
      selectActivePlan(plans[0])
      return plans[0]
    }
    setReconciliation('not-required')
    return null
  }, [selectActivePlan])

  const reconcile = useCallback((afterMutation = false): Promise<void> => {
    if (recoveryMutationRef.current !== null && !afterMutation) return Promise.resolve()
    if (recoveryInFlightRef.current !== null) return recoveryInFlightRef.current

    const token = Symbol('recovery')
    const generation = recoveryGenerationRef.current
    const expectedCoordinator = coordinatingConversationRef.current
    const expectedWorkflow = workflowRef.current
    recoveryTokenRef.current = token
    const request = (async () => {
      const outcome = await ActivePlansClient.get()
      if (
        !mountedRef.current ||
        recoveryTokenRef.current !== token ||
        recoveryGenerationRef.current !== generation ||
        coordinatingConversationRef.current !== expectedCoordinator ||
        workflowRef.current !== expectedWorkflow
      ) return

      if (outcome.kind !== 'loaded') {
        setReconciliation(outcome.kind)
        return
      }

      const plans = outcome.plans.filter((active) => !discardedPlansRef.current.has(activePlanIdentity(active)))
      setActivePlans(plans)
      const adopted = adoptFromRead(plans)
      setDispatchedSlices(plans.length)
      setSlicesInFlight(plans.filter((plan) => plan !== adopted))
    })()
    recoveryInFlightRef.current = request
    void request.finally(() => {
      if (recoveryInFlightRef.current === request) recoveryInFlightRef.current = null
    })
    return request
  }, [adoptFromRead])

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

  const keepsFollowingActivePlans =
    workflow !== null || slicesInFlight.length > 0 || uncertainRequest !== null || (workflow === null && isCoordinatingSessionLive)

  useEffect(() => {
    if (!keepsFollowingActivePlans) return
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      await reconcile()
      if (!cancelled) timer = window.setTimeout(poll, ACTIVE_PLANS_POLL_INTERVAL_MS)
    }

    timer = window.setTimeout(poll, ACTIVE_PLANS_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [keepsFollowingActivePlans, reconcile])

  const formInteracted = useCallback(() => {
    recoveryGenerationRef.current += 1
    recoveryTokenRef.current = null
    setBrainstormingUnreachable(false)
  }, [])

  const sessionOpened = useCallback(() => {
    recoveryGenerationRef.current += 1
    recoveryTokenRef.current = null
    setBrainstormingUnreachable(false)
  }, [])

  useEffect(() => {
    if (coordinatingSession.target !== null) {
      sessionsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }
  }, [coordinatingSession.target])

  const sessionUnreachable = useCallback(() => {
    setBrainstormingUnreachable(true)
  }, [])

  const discardWorkflow = () => {
    const current = workflowRef.current
    const uncertain = uncertainActiveRef.current
    if (current !== null) discardedPlansRef.current.add(workflowIdentity(current))
    if (uncertain !== null) discardedPlansRef.current.add(activePlanIdentity(uncertain))
    recoveryGenerationRef.current += 1
    recoveryTokenRef.current = null
    workflowRef.current = null
    restoredRef.current = false
    uncertainActiveRef.current = null
    recoveryMutationRef.current = null
    setRecoveryMutationPending(false)
    setRecoveryFailure(null)
    setWorkflow(null)
    setReconciliation('not-required')
    setUncertainRequest(null)
    setRequestExpanded(false)
    setRequestFormVersion((version) => version + 1)
    WorkflowSnapshotStorage.remove()
  }

  const startAnotherPlan = () => {
    if (coordinatingSession.blocksOpening) return
    discardWorkflow()
  }

  const discardStaleWorkflow = () => {
    discardWorkflow()
    void reconcile()
  }

  const retryReconciliation = () => {
    retryingRef.current = true
    setReconciliation('checking')
    void reconcile()
  }

  const runRecoveryAction = async () => {
    const active = uncertainActiveRef.current
    if (active === null || active.phase !== 'uncertain' || active.recovery.action === 'inspect'
      || recoveryMutationRef.current !== null) return
    const mutation = Symbol('recovery-mutation')
    const generation = recoveryGenerationRef.current
    const expectedCoordinator = coordinatingConversationRef.current
    const identity = activePlanIdentity(active)
    recoveryMutationRef.current = mutation
    setRecoveryMutationPending(true)
    setRecoveryFailure(null)
    try {
      await recoveryInFlightRef.current
      const current = uncertainActiveRef.current
      if (!mountedRef.current || generation !== recoveryGenerationRef.current
        || expectedCoordinator !== coordinatingConversationRef.current
        || current === null || current.phase !== 'uncertain'
        || current.recovery.action === 'inspect'
        || activePlanIdentity(current) !== identity) return
      const outcome = current.recovery.action === 'cleanup'
        ? await ActivePlansClient.cleanup(current)
        : await ActivePlansClient.recover(current)
      if (!mountedRef.current || generation !== recoveryGenerationRef.current
        || expectedCoordinator !== coordinatingConversationRef.current
        || uncertainActiveRef.current === null
        || activePlanIdentity(uncertainActiveRef.current) !== identity) return
      if (outcome.kind === 'unavailable') {
        setRecoveryFailure('No se pudo contactar con el backend para ejecutar la recuperación.')
      }
      if (outcome.kind === 'refused') setRecoveryFailure(outcome.detail)
      setReconciliation('checking')
      await reconcile(true)
    } finally {
      if (recoveryMutationRef.current === mutation) {
        recoveryMutationRef.current = null
        setRecoveryMutationPending(false)
      }
    }
  }

  const runSliceRecovery = async (active: ActivePlan) => {
    if (active.phase !== 'uncertain' || active.recovery.action === 'inspect') return
    const identity = activePlanIdentity(active)
    if (recoveringSlice !== null || recoveryMutationRef.current !== null) return
    const expectedCoordinator = coordinatingConversationRef.current
    setRecoveringSlice(identity)
    setSliceRecoveryFailure(null)
    try {
      const outcome = active.recovery.action === 'cleanup'
        ? await ActivePlansClient.cleanup(active)
        : await ActivePlansClient.recover(active)
      if (!mountedRef.current || expectedCoordinator !== coordinatingConversationRef.current) return
      if (outcome.kind === 'unavailable') {
        setSliceRecoveryFailure({ identity, detail: 'No se pudo contactar con el backend para ejecutar la recuperación.' })
      }
      if (outcome.kind === 'refused') setSliceRecoveryFailure({ identity, detail: outcome.detail })
      await reconcile(true)
    } finally {
      if (mountedRef.current) setRecoveringSlice(null)
    }
  }

  const sliceRecoveryOf = (slice: ActivePlan): SliceRecovery | null => {
    if (slice.phase !== 'uncertain') return null
    const identity = activePlanIdentity(slice)

    return {
      diagnostic: slice.diagnostic,
      action: slice.recovery.action,
      refusal: slice.refusal ?? null,
      pending: recoveringSlice === identity,
      failure: sliceRecoveryFailure?.identity === identity ? sliceRecoveryFailure.detail : null,
      onAct: () => void runSliceRecovery(slice),
      onRetry: retryReconciliation,
    }
  }

  const hasDiscardableState = restoredRef.current || uncertainRequest !== null
  const restoredNeedsRecovery = reconciliation === 'stale' || reconciliation === 'unavailable' || reconciliation === 'inconclusive' || reconciliation === 'uncertain'
  const restoredIsConfirmed = reconciliation === 'confirmed' || reconciliation === 'not-required'
  const activePlan = uncertainActiveRef.current
  const uncertainActive = activePlan?.phase === 'uncertain' ? activePlan : null
  const selectedWork = workflow?.plan ?? uncertainActive?.plan ?? null
  const canReadWork = restoredIsConfirmed || reconciliation === 'uncertain'
  const workRead = useWorkProgress(selectedWork !== null
    ? { repo: selectedWork.repo, issue: selectedWork.issue.number, agent: selectedWork.agent }
    : null, canReadWork, uncertainActive !== null ? 'uncertain' : workflow?.phase ?? null)
  const workProgress = workRead.kind === 'read' || workRead.kind === 'stale' ? workRead.snapshot.progress : null
  const savedWorkflowIsGone = workflow !== null && reconciliation === 'stale' && uncertainRequest === null
  const conclusion = useWorkConclusion(savedWorkflowIsGone
    ? { repo: workflow.plan.repo, issue: workflow.plan.issue.number, agent: workflow.plan.agent }
    : null)
  const savedWorkflowFinished = savedWorkflowIsGone && conclusion.kind === 'finished' ? conclusion : null
  const successors = workflow === null ? [] : slicesInFlight.filter((active) => sharesCheckout(workflow, active))
  const planIsReady = workProgress?.phase === 'planning' && workProgress.plan.kind === 'available' && workProgress.plan.value === 'ready'
  const executionStarted = workProgress?.phase === 'implementing'
  const showRestoredDiscard = restoredRef.current && workflow?.phase !== 'implementing' && !restoredNeedsRecovery

  const currentStage: WorkflowStageName = workflow === null ? 'request' : 'implementation'
  const requestStatus: WorkflowStepStatus = workflow === null ? 'active' : 'completed'
  const implementationStatus: WorkflowStepStatus = workflow === null ? 'pending' : 'active'
  const implementationDescription = savedWorkflowFinished !== null
    ? 'El slice seleccionado ha terminado.'
    : !restoredIsConfirmed
    ? 'Estamos comprobando el estado del plan guardado.'
    : executionStarted
      ? 'Seguimos la implementación. Aquí verás el progreso que comunica el backend.'
      : !planIsReady
        ? 'El agente está preparando el plan como parte de la implementación. No necesitas aprobarlo.'
        : 'El plan está listo. La implementación continuará automáticamente cuando el backend la registre.'

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
      {savedWorkflowFinished !== null && workflow !== null && (
        <div className="home__recovery">
          <Banner
            type="informative"
            aria-label={`Slice #${workflow.plan.issue.number} entregado`}
            title={`Slice #${workflow.plan.issue.number} entregado`}
            description={successors.length > 0
              ? `En marcha: ${successors.map((successor) => `#${successor.plan.issue.number}`).join(', ')}.`
              : 'No hay más slices en marcha en este repositorio.'}
          />
          {savedWorkflowFinished.pullRequest !== null && (
            <p className="lg-body-medium">
              Pull request: {' '}
              <a href={savedWorkflowFinished.pullRequest.url} target="_blank" rel="noreferrer">
                #{savedWorkflowFinished.pullRequest.number}
              </a>
            </p>
          )}
          <Button variant="secondary" onClick={discardStaleWorkflow}>Cerrar</Button>
        </div>
      )}
      {savedWorkflowIsGone && conclusion.kind === 'checking' && (
        <div className="home__recovery">
          <Banner type="informative" title="Comprobando que el plan sigue activo" />
          <Button variant="secondary" onClick={discardStaleWorkflow}>Descartar estado</Button>
        </div>
      )}
      {reconciliation === 'stale' && (uncertainRequest !== null || conclusion.kind === 'not-found') && (
        <div className="home__recovery">
          <Banner
            type="warning"
            role="alert"
            title={uncertainRequest === null ? 'El plan guardado ya no está activo' : 'El trabajo incierto ya no figura como activo'}
            description={uncertainRequest === null
              ? 'El backend ya no tiene constancia de este plan. Descarta el estado para volver a empezar.'
              : 'El backend ya no informa de este trabajo. Descarta el estado para crear una solicitud nueva.'}
          />
          <Button variant="secondary" onClick={discardStaleWorkflow}>Descartar estado</Button>
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
      {reconciliation === 'uncertain' && (
        <div className="home__recovery">
          <Banner
            type="warning"
            role="alert"
            title="No se puede confirmar el estado de implementación"
            description={uncertainActive === null ? undefined : (
              <>
                {recoveryFailure ?? uncertainActive.diagnostic} {' '}
                <code>{uncertainActive.plan.repo}#{uncertainActive.plan.issue.number}</code>
                {' · '}<code>{uncertainActive.plan.agent}</code>
              </>
            )}
          />
          <div className="home__recovery-actions">
            {uncertainActive?.recovery.action === 'inspect' && (
              <Button onClick={retryReconciliation}>Reintentar recuperación</Button>
            )}
            {(uncertainActive?.recovery.action === 'observe'
              || uncertainActive?.recovery.action === 'continue') && (
              <Button disabled={recoveryMutationPending} onClick={() => void runRecoveryAction()}>Recuperar trabajo</Button>
            )}
            {uncertainActive?.recovery.action === 'cleanup' && (
              <Button disabled={recoveryMutationPending} onClick={() => void runRecoveryAction()}>Limpiar arranque fallido</Button>
            )}
            <Button variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
          </div>
        </div>
      )}
      {workflow === null && uncertainActive !== null && workProgress?.phase === 'uncertain' && workProgress.execution.kind !== 'unavailable' && (
        <SliceProgress issue={uncertainActive.plan.issue.number} read={workRead} showUncertainty={false} />
      )}
    </>
  )

  const brainstormingRecovery = brainstormingUnreachable && (
    <div className="home__recovery">
      <Banner type="warning" role="alert" title="No se pudo contactar con el backend" description="No se pudo abrir el brainstorming. Inténtalo de nuevo." />
    </div>
  )

  const breadcrumbItems = workflow === null
    ? []
    : [
        { label: workflow.plan.repo },
        { label: `#${workflow.plan.issue.number}` },
        { label: STAGE_LABEL[currentStage] },
      ]
  const showStartAnother = workflow?.phase === 'implementing' && restoredIsConfirmed
  const showHistory = workflow !== null && executionStarted && restoredIsConfirmed

  return (
    <div className="home">
      <Navigation
        navbar={<ToolsNavbar />}
        topBar={
          <TopBar
            productName={workflow === null ? 'Control Tower' : undefined}
            breadcrumbs={workflow !== null ? <Breadcrumbs items={breadcrumbItems} /> : undefined}
            actions={showStartAnother ? (
              <Button variant="secondary" disabled={coordinatingSession.blocksOpening} onClick={startAnotherPlan}>Arrancar otro plan</Button>
            ) : undefined}
          />
        }
      >
        <div
          className={`home__columns${sessionsColumnCollapse.collapsed ? ' home__columns--sessions-collapsed' : ''}`}
          ref={columnsRef}
          style={
            sessionsColumnCollapse.collapsed
              ? ({ '--home-sessions-width': `${SESSIONS_DRAWER_COLLAPSED_WIDTH_PX}px` } as CSSProperties)
              : sessionsColumnWidth.value === null ? undefined : ({ '--home-sessions-width': `${sessionsColumnWidth.value}px` } as CSSProperties)
          }
        >
        <main className="home__content">
          <nav className="home__flow" aria-label="Flujo del plan">
            <ol>
              {[
                { number: 1, name: 'Solicitud', stage: 'request', status: requestStatus },
                { number: 2, name: 'Implementación', stage: 'implementation', status: implementationStatus },
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

          {slicesInFlight.length > 0 && (
            <section className="home__slices" aria-label="Slices en vuelo">
              {slicesInFlight.map((slice) => (
                <SliceSession
                  key={`${slice.plan.repo}:${slice.plan.issue.number}`}
                  issue={slice.plan.issue.number}
                  repo={slice.plan.repo}
                  agent={slice.plan.agent}
                  recovery={sliceRecoveryOf(slice)}
                  onSelect={() => selectSlice(slice)}
                  onProgress={(progress) => observeSliceProgress(slice.plan, progress)}
                />
              ))}
            </section>
          )}

          {currentStage === 'request' && (
            <WorkflowStep
              aria-label={STAGE_LABEL.request}
              title={STAGE_LABEL.request}
              level={1}
              subtitle="Cuéntanos qué quieres planificar y dónde está el repositorio."
              status="active"
              canCollapse={false}
            >
              {recovery}
              {brainstormingRecovery}
              <StartPlanForm
                key={requestFormVersion}
                onOpened={sessionOpened}
                onUnreachable={sessionUnreachable}
                onInteraction={formInteracted}
                isLocked={uncertainRequest !== null}
                isMutationBlocked={reconciliation === 'unavailable' || reconciliation === 'inconclusive' || (reconciliation === 'checking' && retryingRef.current)}
                isCoordinatingSessionLive={coordinatingSession.occupied}
                openSession={coordinatingSession.open}
                request={uncertainRequest ?? undefined}
              />
            </WorkflowStep>
          )}

          {currentStage === 'implementation' && workflow !== null && (
            <WorkflowStep
              aria-label={STAGE_LABEL.implementation}
              title={STAGE_LABEL.implementation}
              level={1}
              subtitle={implementationDescription}
              status="active"
              canCollapse={false}
            >
              {recovery}
              <BaselineNotice baseline={workflow.plan.baseline} />
              {restoredIsConfirmed && executionStarted && (
                <Banner
                  type="informative"
                  title="Implementación iniciada automáticamente"
                  description={<>El backend ha registrado al agente <code>{workflow.plan.agent}</code>.</>}
                />
              )}
              {(canReadWork || workRead.kind === 'stale') && (
                <SliceProgress
                  key={`${workflow.plan.repo}:${workflow.plan.issue.number}:implementation`}
                  issue={workflow.plan.issue.number}
                  read={workRead}
                  showUncertainty={reconciliation !== 'uncertain'}
                  onProgress={(progress) => observeSliceProgress(workflow.plan, progress)}
                />
              )}
              <WorkDetails
                key={`${workflow.plan.repo}:${workflow.plan.issue.number}`}
                plan={workflow.plan}
              />
              {planIsReady && restoredIsConfirmed && (
                <div className="home__plan-link">
                  <a href={workflow.plan.issue.url} target="_blank" rel="noreferrer" className="home__issue-link lg-body-medium">
                    Abrir el plan en GitHub
                  </a>
                </div>
              )}
              {showRestoredDiscard && (
                <Button className="home__discard" variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
              )}
            </WorkflowStep>
          )}

          <GateSequence
            key={coordinatingSession.target ?? NO_COORDINATING_TARGET}
            specFreezeRead={specFreezeRead}
            epicGroomRead={epicGroomRead}
            target={coordinatingSession.target}
            liveAsk={coordinatingSession.liveAsk}
            openingBlocked={coordinatingSession.blocksOpening}
            operationBusy={coordinatingSession.operationBusy}
            openSession={coordinatingSession.openGroom}
            dispatched={dispatchedSlices}
          />

          {workflow !== null && (
            <section className="home__completed" aria-label="Etapas completadas">
              <WorkflowStep
                title="Solicitud"
                status="completed"
                isExpanded={requestExpanded}
                onExpandedChange={setRequestExpanded}
              >
                <StartPlanForm
                  key={requestFormVersion}
                  onOpened={sessionOpened}
                  onUnreachable={sessionUnreachable}
                  onInteraction={formInteracted}
                  isLocked
                  request={workflow.request}
                />
              </WorkflowStep>
            </section>
          )}
        </main>
        <ColumnResizer
          value={sessionsColumnWidth.value}
          min={sessionsColumnWidth.min}
          max={sessionsColumnWidth.max}
          onChange={sessionsColumnWidth.setValue}
          label={SESSIONS_COLUMN_LABEL}
          disabled={sessionsColumnCollapse.collapsed}
        />
        <div className="home__side" ref={sessionsRef}>
          <Drawer
            title="Sesión coordinadora"
            collapsed={sessionsColumnCollapse.collapsed}
            onToggle={() => sessionsColumnCollapse.toggle()}
          >
            <div className="home__session-panel">
              <CoordinatingSessionStatus read={coordinatingSession.read} />
              <div className="home__terminal-pane">
                <SessionsPanel
                  coordinating={coordinatingSession.read}
                  adopted={coordinatingSession.opened}
                  closing={coordinatingSession.closing || (
                    coordinatingSession.read.phase === 'read' &&
                    coordinatingSession.read.kind !== 'unavailable' &&
                    coordinatingSession.read.operation === 'closing'
                  )}
                  closeError={coordinatingSession.closeError}
                  closedSessionIds={coordinatingSession.closedSessionIds}
                  onClose={() => void coordinatingSession.close()}
                />
              </div>
              {showHistory && workflow !== null && (
                <aside className="home__history" aria-label="Progreso de la implementación">
                    <ImplementHistory
                    key={`${workflow.plan.repo}:${workflow.plan.issue.number}:history`}
                    issue={workflow.plan.issue.number}
                    root={workflow.plan.root ?? workflow.request.path}
                      repo={workflow.plan.repo}
                      visible={!sessionsColumnCollapse.collapsed}
                  />
                </aside>
              )}
            </div>
          </Drawer>
        </div>
      </div>
      </Navigation>
    </div>
  )
}

export { Home }
