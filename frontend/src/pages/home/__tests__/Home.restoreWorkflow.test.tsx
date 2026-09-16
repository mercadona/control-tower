import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkflowSnapshot, WORKFLOW_SNAPSHOT_KEY, WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import {
  backendRecovering,
  openHome,
  openRestored,
  pressStart,
  streamFrame,
  typePath,
  typeRepository,
  typeTicket,
} from './helpers'
import { FakeEventSource } from './FakeEventSource'

type RecoveredPhase = 'planning' | 'implementing' | 'uncertain'

const activePlan = (phase: RecoveredPhase = 'planning', repo = StartPlanMother.REPO, issue = StartPlanMother.ISSUE.number) => ({
  phase,
  request: { id: StartPlanMother.TICKET, repo, path: StartPlanMother.PATH },
  plan: {
    id: StartPlanMother.TICKET,
    repo,
    issue: { number: issue, url: `https://github.com/${repo}/issues/${issue}` },
    agent: StartPlanMother.AGENT,
    branch: StartPlanMother.BRANCH,
    worktree: StartPlanMother.WORKTREE,
  },
})

const activePlansAnswer = (...plans: ReturnType<typeof activePlan>[]) => ({
  status: 200,
  body: JSON.stringify({ plans }),
})

const EXTERNAL_TOOLS_READY = '{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}]}'
const NO_SESSIONS = SessionsMother.noSessions().body

const NO_COORDINATING_SESSION = CoordinatingSessionMother.none().body
const NO_SPEC_FREEZE = SpecFreezeMother.none().body
const NO_EPIC_GROOM = EpicGroomMother.none().body

const withReadyTools = <T extends (input: string | URL | Request, init?: RequestInit) => Promise<Response>>(fetching: T) => {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
    if (input === '/external-tools') return Promise.resolve(new Response(EXTERNAL_TOOLS_READY))
    if (input === '/sessions') return Promise.resolve(new Response(NO_SESSIONS))
    if (input === '/coordinating-session' && init === undefined) return Promise.resolve(new Response(NO_COORDINATING_SESSION))
    if (input === '/spec-freeze') return Promise.resolve(new Response(NO_SPEC_FREEZE))
    if (input === '/epic-groom') return Promise.resolve(new Response(NO_EPIC_GROOM))
    if (String(input).startsWith('/implement-progress/')) {
      return Promise.resolve(new Response('{"code":"implementation-progress-not-read","detail":"not started"}', { status: 400 }))
    }
    return init === undefined ? fetching(input) : fetching(input, init)
  }))

  return fetching
}

const storeWorkflow = (phase: WorkflowSnapshot['phase']) => {
  const active = activePlan()
  WorkflowSnapshotStorage.save({ phase, request: active.request, plan: active.plan })
}

const startPlanning = async () => {
  const opened = openRestored({ phase: 'planning' })
  await screen.findByRole('status')
  await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))

  return opened
}

describe('Home · restore workflow', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('an initially empty held coordinator discovers a later dispatched plan', async () => {
    vi.useFakeTimers()
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response(HeadlessPlanMother.empty().body))
      .mockResolvedValueOnce(new Response(HeadlessPlanMother.planning().body))
    withReadyTools(fetching)
    const coordinating = CoordinatingSessionMother.working()
    const currentFetch = vi.mocked(fetch)
    currentFetch.mockImplementation((input, init) => {
      if (input === '/coordinating-session' && init === undefined) return Promise.resolve(new Response(coordinating.body))
      if (input === '/active-plans') return fetching(input)
      if (input === '/external-tools') return Promise.resolve(new Response(EXTERNAL_TOOLS_READY))
      if (input === '/sessions') return Promise.resolve(new Response(NO_SESSIONS))
      if (input === '/spec-freeze') return Promise.resolve(new Response(NO_SPEC_FREEZE))
      if (input === '/epic-groom') return Promise.resolve(new Response(NO_EPIC_GROOM))
      throw new Error(`unexpected fetch to ${String(input)}`)
    })

    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(fetching).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(2000))

    expect(screen.getByText('Plan arrancado')).toBeInTheDocument()
    expect(fetching).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['fresh and restored implementing work both become uncertain and block launch', 'fresh'],
    ['restored implementing work becomes uncertain and blocks launch', 'restored'],
  ] as const)('%s', async (_name, origin) => {
    vi.useFakeTimers()
    if (origin === 'restored') storeWorkflow('implementing')
    const changes = HeadlessPlanMother.deferredChanges()
    withReadyTools(changes.read)
    openHome()
    expect(changes.activeReadCount()).toBe(1)
    await act(async () => changes.answerWith(HeadlessPlanMother.implementing()))
    expect(screen.getByRole('heading', { name: 'Implementación' })).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(changes.activeReadCount()).toBe(2)
    await act(async () => changes.answerWith(HeadlessPlanMother.uncertain()))

    expect(screen.getByRole('alert')).toHaveTextContent('No se puede confirmar el estado de implementación')
    expect(screen.queryByRole('button', { name: 'Arrancar otro plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
  })

  it('late discovery cannot replace a newer workflow or coordinator', async () => {
    vi.useFakeTimers()
    const changes = HeadlessPlanMother.deferredChanges()
    const coordinating = CoordinatingSessionMother.working()
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (input === '/active-plans') return changes.read(input)
      if (input === '/coordinating-session' && init === undefined) return Promise.resolve(new Response(coordinating.body))
      if (input === '/external-tools') return Promise.resolve(new Response(EXTERNAL_TOOLS_READY))
      if (input === '/sessions') return Promise.resolve(new Response(NO_SESSIONS))
      if (input === '/spec-freeze') return Promise.resolve(new Response(NO_SPEC_FREEZE))
      if (input === '/epic-groom') return Promise.resolve(new Response(NO_EPIC_GROOM))
      throw new Error(`unexpected fetch to ${String(input)}`)
    }))
    openHome()
    expect(changes.activeReadCount()).toBe(1)

    fireEvent.change(screen.getByLabelText('Ticket'), { target: { value: StartPlanMother.TICKET } })
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => changes.answerWith(HeadlessPlanMother.planning()))

    expect(screen.getByLabelText('Ticket')).toHaveValue(StartPlanMother.TICKET)
    expect(screen.queryByText('Plan arrancado')).toBeNull()
  })

  it('polling stops on unmount and cannot readopt a discarded plan', async () => {
    vi.useFakeTimers()
    const changes = HeadlessPlanMother.deferredChanges()
    withReadyTools(changes.read)
    const { unmount } = openHome()
    expect(changes.activeReadCount()).toBe(1)
    await act(async () => changes.answerWith(HeadlessPlanMother.uncertain()))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(changes.activeReadCount()).toBe(2)
    screen.getByRole('button', { name: 'Descartar estado' }).click()
    await act(async () => changes.answerWith(HeadlessPlanMother.planning()))
    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.queryByText('Plan arrancado')).toBeNull()

    unmount()
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(changes.activeReadCount()).toBe(2)
  })

  it('only allows another repository after backend implementation and resets the old workflow', async () => {
    vi.useFakeTimers()
    storeWorkflow('ready')
    const changes = HeadlessPlanMother.deferredChanges()
    const fetching = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (input === '/active-plans') return changes.read(input)
      if (input === '/coordinating-session' && init === undefined) return Promise.resolve(new Response(NO_COORDINATING_SESSION))
      if (input === '/coordinating-session') return Promise.resolve(new Response(CoordinatingSessionMother.opened().body, { status: 202 }))
      if (input === '/external-tools') return Promise.resolve(new Response(EXTERNAL_TOOLS_READY))
      if (input === '/sessions') return Promise.resolve(new Response(NO_SESSIONS))
      if (input === '/spec-freeze') return Promise.resolve(new Response(NO_SPEC_FREEZE))
      if (input === '/epic-groom') return Promise.resolve(new Response(NO_EPIC_GROOM))
      if (String(input).startsWith('/implement-progress/') || String(input).startsWith('/implement-history/')) {
        return Promise.resolve(new Response('{}', { status: 400 }))
      }
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetching)
    openHome()
    await act(async () => changes.answerWith(HeadlessPlanMother.planning()))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(FakeEventSource.opened).toHaveLength(1)
    const oldStream = FakeEventSource.last()

    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => changes.answerWith(HeadlessPlanMother.implementing()))
    fireEvent.click(screen.getByRole('button', { name: 'Arrancar otro plan' }))

    expect(oldStream.closes).toBe(1)
    expect(localStorage).toHaveLength(0)
    expect(screen.getByLabelText('Ticket')).toHaveValue('')
    expect(screen.getByLabelText(/Repositorio/)).toHaveValue('')
    expect(screen.getByLabelText(/Ruta local/)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Ticket'), { target: { value: StartPlanMother.TICKET } })
    fireEvent.change(screen.getByLabelText(/Repositorio/), { target: { value: StartPlanMother.ANOTHER_REPO } })
    fireEvent.change(screen.getByLabelText(/Ruta local/), { target: { value: StartPlanMother.PATH } })
    fireEvent.click(screen.getByRole('button', { name: 'Arrancar brainstorming' }))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    const opening = fetching.mock.calls.find(([input, init]) => input === '/coordinating-session' && init !== undefined)
    expect(opening?.[1]?.body).toContain(StartPlanMother.ANOTHER_REPO)
  })

  it('does not readopt the implementing plan it just left when the backend still reports it', async () => {
    vi.useFakeTimers()
    storeWorkflow('implementing')
    const changes = HeadlessPlanMother.deferredChanges()
    withReadyTools(changes.read)
    openHome()
    await act(async () => changes.answerWith(HeadlessPlanMother.implementing()))

    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(changes.activeReadCount()).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Arrancar otro plan' }))
    await act(async () => changes.answerWith(HeadlessPlanMother.implementing()))

    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.getByLabelText('Ticket')).toHaveValue('')
    expect(screen.queryByText('Implementación iniciada automáticamente')).toBeNull()
  })

  it('should restore planning after the page unmounts without starting the plan twice', async () => {
    const { unmount, fetching } = await startPlanning()
    const oldStream = FakeEventSource.last()

    unmount()
    expect(oldStream.closes).toBe(1)
    backendRecovering(activePlansAnswer(activePlan()))
    openHome()

    expect(await screen.findByText('Plan arrancado')).toBeInTheDocument()
    await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
    expect(FakeEventSource.last()).not.toBe(oldStream)
    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('should restore ready into review and resume listening for a possible review once confirmed', async () => {
    const { unmount, fetching } = await startPlanning()
    await streamFrame(PlanEventsMother.ready())

    unmount()
    backendRecovering(activePlansAnswer(activePlan()))
    openHome()

    expect(await screen.findByRole('link', { name: 'Abrir el plan en GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Revisar plan' })).toBeInTheDocument()
    expect(screen.getByText('El plan está listo. La implementación continuará automáticamente cuando el backend la registre.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('should restore implementing without sending another implementation request', async () => {
    storeWorkflow('implementing')
    const fetching = backendRecovering(activePlansAnswer(activePlan('implementing')))
    openHome()

    expect(await screen.findByText('Implementación iniciada automáticamente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arrancar otro plan' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(fetching.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('keeps implementation current when reopening the completed review summary with the keyboard', async () => {
    backendRecovering(activePlansAnswer(activePlan('implementing')))
    const { user } = openHome()

    await screen.findByText('Implementación iniciada automáticamente')
    const reviewSummary = screen.getByRole('button', { name: /Revisar plan.*Completado/ })
    reviewSummary.focus()
    await user.keyboard('{Enter}')

    expect(reviewSummary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('navigation', { name: 'Flujo del plan' }).querySelector('[aria-current="step"]')).toHaveTextContent('Implementación')
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('a same-phase poll keeps the completed review summary expanded', async () => {
    vi.useFakeTimers()
    storeWorkflow('implementing')
    const changes = HeadlessPlanMother.deferredChanges()
    withReadyTools(changes.read)
    openHome()

    await act(async () => changes.answerWith(HeadlessPlanMother.implementing()))
    const reviewSummary = screen.getByRole('button', { name: /Revisar plan.*Completado/ })
    expect(screen.getByText('Detalles del agente y del entorno').closest('.workflow-step__content-wrap')).toHaveAttribute(
      'aria-hidden',
      'true',
    )

    fireEvent.click(reviewSummary)
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => changes.answerWith(HeadlessPlanMother.implementing()))

    expect(reviewSummary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Detalles del agente y del entorno').closest('.workflow-step__content-wrap')).toHaveAttribute(
      'aria-hidden',
      'false',
    )
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('should treat invalid storage as empty', async () => {
    localStorage.setItem(WORKFLOW_SNAPSHOT_KEY, '{not-json')
    const fetching = backendRecovering(activePlansAnswer())

    openHome()

    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    await waitFor(() => expect(fetching).toHaveBeenCalledWith('/active-plans'))
  })

  it('should restore one backend plan automatically', async () => {
    const fetching = backendRecovering(activePlansAnswer(activePlan()))

    openHome()

    const progress = await screen.findByLabelText('Progreso del plan')
    expect(within(progress).getByRole('status')).toHaveTextContent('Plan arrancado')
    expect(progress).toHaveTextContent(StartPlanMother.REPO)
    expect(fetching).toHaveBeenCalledTimes(1)
    expect(fetching).toHaveBeenCalledWith('/active-plans')
  })

  it('should request active plans once under StrictMode', async () => {
    const fetching = backendRecovering(activePlansAnswer())

    openHome()

    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('should mark restored planning as stale without opening SSE', async () => {
    storeWorkflow('planning')
    const fetching = backendRecovering(activePlansAnswer())

    openHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('backend o cmux ya no tiene este plan activo')
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('uses neutral review copy while a restored ready plan is still checking', async () => {
    storeWorkflow('ready')
    let resolveRecovery: (response: Response) => void = () => undefined
    const recovery = new Promise<Response>((resolve) => {
      resolveRecovery = resolve
    })
    withReadyTools(vi.fn(() => recovery))
    const { unmount } = openHome()

    expect(screen.getByRole('heading', { name: 'Revisar plan' })).toBeInTheDocument()
    expect(screen.getByText('Estamos comprobando el estado del plan guardado.')).toBeInTheDocument()
    expect(screen.queryByText('El plan está listo. La implementación continuará automáticamente cuando el backend la registre.')).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)

    unmount()
    await act(async () => resolveRecovery(new Response(activePlansAnswer(activePlan()).body)))
  })

  it.each([
    ['unavailable', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['inconclusive', () => Promise.resolve(new Response('{"code":"active-plans-recovery-inconclusive","detail":"cmux unavailable"}', { status: 400 }))],
    ['uncertain', () => Promise.resolve(new Response(activePlansAnswer(activePlan('uncertain')).body, { status: 200 }))],
  ])('does not open plan events for an unconfirmed restored workflow that is %s', async (_state, response) => {
    storeWorkflow('ready')
    withReadyTools(vi.fn(response))

    openHome()

    await screen.findByRole('alert')
    expect(screen.getByText('Estamos comprobando el estado del plan guardado.')).toBeInTheDocument()
    expect(screen.queryByText('El plan está listo. La implementación continuará automáticamente cuando el backend la registre.')).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('should mark restored ready as stale without sending duplicate implementation', async () => {
    storeWorkflow('ready')
    const fetching = backendRecovering(activePlansAnswer())

    openHome()

    await screen.findByRole('alert')
    expect(screen.getByText('Estamos comprobando el estado del plan guardado.')).toBeInTheDocument()
    expect(screen.queryByText('El plan está listo. La implementación continuará automáticamente cuando el backend la registre.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
    expect(fetching).toHaveBeenCalledTimes(1)
    expect(fetching).toHaveBeenCalledWith('/active-plans')
  })

  it('should block restored actions when recovery is unavailable and retry', async () => {
    storeWorkflow('ready')
    const fetching = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ plans: [activePlan()] }), { status: 200 }))
    withReadyTools(fetching)
    const { user } = openHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo comprobar el plan guardado')
    expect(screen.getByText('Estamos comprobando el estado del plan guardado.')).toBeInTheDocument()
    expect(screen.queryByText('El plan está listo. La implementación continuará automáticamente cuando el backend la registre.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByRole('link', { name: 'Abrir el plan en GitHub' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(fetching).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
  })

  it('should block implementation when the backend reports a stored plan as uncertain', async () => {
    storeWorkflow('ready')
    backendRecovering(activePlansAnswer(activePlan('uncertain')))

    openHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede confirmar el estado de implementación')
    expect(screen.getByText('Estamos comprobando el estado del plan guardado.')).toBeInTheDocument()
    expect(screen.queryByText('El plan está listo. La implementación continuará automáticamente cuando el backend la registre.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
    expect(WorkflowSnapshotStorage.load()?.phase).toBe('ready')
  })

  it('should block an uncertain candidate and recover it on retry', async () => {
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ plans: [activePlan('uncertain')] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ plans: [activePlan()] }), { status: 200 }))
    withReadyTools(fetching)
    const { user } = openHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede confirmar el estado de implementación')
    expect(screen.queryByRole('button', { name: 'Arrancar brainstorming' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Reintentar recuperación' }))

    expect(await screen.findByText('Plan arrancado')).toBeInTheDocument()
    expect(fetching).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
  })

  it.each([
    ['an empty discovery', HeadlessPlanMother.empty()],
    ['an unrelated plan', activePlansAnswer(activePlan('planning', StartPlanMother.ANOTHER_REPO, 9))],
  ])('keeps uncertain plan identity when followed by %s', async (_name, nextAnswer) => {
    vi.useFakeTimers()
    const changes = HeadlessPlanMother.deferredChanges()
    withReadyTools(changes.read)
    openHome()
    await act(async () => changes.answerWith(HeadlessPlanMother.uncertain()))

    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => changes.answerWith(nextAnswer))

    expect(screen.getByRole('alert')).toHaveTextContent('El trabajo incierto ya no figura como activo')
    expect(screen.getByText(StartPlanMother.TICKET)).toBeInTheDocument()
    expect(screen.getByText(StartPlanMother.REPO)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrancar brainstorming' })).toBeNull()
    expect(screen.queryByText(StartPlanMother.ANOTHER_REPO)).toBeNull()
    expect(screen.getByRole('button', { name: 'Descartar estado' })).toBeEnabled()
  })

  it('should discard an uncertain candidate and unlock a fresh request even if the backend still reports it', async () => {
    const fetching = backendRecovering(activePlansAnswer(activePlan('uncertain')))
    const { user } = openHome()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Descartar estado' }))

    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()
    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it.each(['planning', 'ready'] as const)('should reconcile restored %s with backend planning', async (phase) => {
    storeWorkflow(phase)
    const fetching = backendRecovering(activePlansAnswer(activePlan()))

    openHome()

    if (phase === 'ready') {
      expect(await screen.findByRole('link', { name: 'Abrir el plan en GitHub' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    } else {
      expect(await screen.findByText('Plan arrancado')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    }
    expect(screen.getByRole('button', { name: 'Descartar estado' })).toBeEnabled()
    expect(fetching).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
  })

  it('should promote a restored planning workflow when the backend is implementing', async () => {
    storeWorkflow('planning')
    backendRecovering(activePlansAnswer(activePlan('implementing')))

    openHome()

    expect(await screen.findByText('Implementación iniciada automáticamente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arrancar otro plan' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
    expect(WorkflowSnapshotStorage.load()?.phase).toBe('implementing')
  })

  it('should discard stale storage and return to a fresh request', async () => {
    storeWorkflow('ready')
    backendRecovering(activePlansAnswer())
    const { user } = openHome()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Descartar estado' }))

    expect(localStorage.getItem(WORKFLOW_SNAPSHOT_KEY)).toBeNull()
    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.queryByText('Implementación')).toBeInTheDocument()
  })

  it('should adopt a live plan after discarding a saved one the backend no longer knows, without a reload', async () => {
    storeWorkflow('ready')
    const live = activePlan('planning', StartPlanMother.ANOTHER_REPO, 9)
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response(activePlansAnswer(live).body, { status: 200 }))
      .mockResolvedValueOnce(new Response(activePlansAnswer(live).body, { status: 200 }))
    withReadyTools(fetching)
    const { user } = openHome()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Descartar estado' }))

    expect(await screen.findByText('Plan arrancado')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Revisar plan' })).toBeInTheDocument()
    expect(screen.getByLabelText('Progreso del plan')).toHaveTextContent(StartPlanMother.ANOTHER_REPO)
    expect(fetching).toHaveBeenCalledTimes(2)
  })

  it('should open one GET and one SSE for restored planning under StrictMode', async () => {
    storeWorkflow('planning')
    const fetching = backendRecovering(activePlansAnswer(activePlan()))

    openHome()

    await screen.findByText('Plan arrancado')
    expect(fetching).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
    expect(FakeEventSource.last().closes).toBe(0)
  })

  it('should ignore delayed recovery after the user edits the form', async () => {
    let answerRecovery: (response: Response) => void = () => undefined
    const recovery = new Promise<Response>((resolve) => { answerRecovery = resolve })
    withReadyTools(vi.fn(() => recovery))
    const { user } = openHome()

    await typeTicket(user, StartPlanMother.TICKET)
    await act(async () => answerRecovery(new Response(JSON.stringify({ plans: [activePlan()] }), { status: 200 })))

    expect(screen.getByLabelText('Ticket')).toHaveValue(StartPlanMother.TICKET)
    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('should let the user select one of multiple backend plans', async () => {
    const second = activePlan('implementing', StartPlanMother.ANOTHER_REPO, 9)
    backendRecovering(activePlansAnswer(activePlan(), second))
    const { user } = openHome()

    const choices = await screen.findAllByRole('button', { name: /Continuar plan/ })
    expect(choices).toHaveLength(2)
    expect(choices[0]).toHaveAccessibleName(/ABC-123, owner\/name, issue #7/)
    expect(choices[1]).toHaveAccessibleName(/ABC-123, owner\/other-name, issue #9/)
    await user.click(choices[1])

    expect(screen.getByText('Implementación iniciada automáticamente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arrancar otro plan' })).toBeEnabled()
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('should discard recovered candidates when a new plan starts', async () => {
    const second = activePlan('implementing', StartPlanMother.ANOTHER_REPO, 9)
    const fetching = vi.fn((input: string | URL | Request) =>
      input === '/active-plans'
        ? Promise.resolve(new Response(JSON.stringify({ plans: [activePlan(), second] }), { status: 200 }))
        : Promise.resolve(new Response(CoordinatingSessionMother.opened().body, { status: 202 })),
    )
    withReadyTools(fetching)
    const { user } = openHome()
    expect(await screen.findAllByRole('button', { name: /Continuar plan/ })).toHaveLength(2)

    await typeTicket(user, StartPlanMother.TICKET)
    expect(screen.queryByRole('button', { name: /Continuar plan/ })).toBeNull()
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)
    await pressStart(user)

    await waitFor(() => expect(fetching.mock.calls.filter(([input]) => input === '/coordinating-session')).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /Continuar plan/ })).toBeNull()
  })

  it('a coordinator opened by gate 2 invalidates discovery from the previous conversation', async () => {
    vi.useFakeTimers()
    const changes = HeadlessPlanMother.deferredChanges()
    const coordinating = CoordinatingSessionMother.working()
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (input === '/active-plans') return changes.read(input)
      if (input === '/coordinating-session' && init === undefined) return Promise.resolve(new Response(coordinating.body))
      if (input === '/groom-session') return Promise.resolve(new Response(EpicGroomMother.groomSessionOpened().body, { status: 202 }))
      if (input === '/external-tools') return Promise.resolve(new Response(EXTERNAL_TOOLS_READY))
      if (input === '/sessions') return Promise.resolve(new Response(NO_SESSIONS))
      if (input === '/spec-freeze') return Promise.resolve(new Response(NO_SPEC_FREEZE))
      if (input === '/epic-groom') return Promise.resolve(new Response(EpicGroomMother.groomable().body))
      throw new Error(`unexpected fetch to ${String(input)}`)
    }))
    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getAllByText('Trabajando')).not.toHaveLength(0)
    expect(changes.activeReadCount()).toBe(1)
    await act(async () => changes.answerWith(HeadlessPlanMother.empty()))
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(changes.activeReadCount()).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Revisar el slicing con la sesión' }))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => changes.answerWith(HeadlessPlanMother.planning()))

    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.queryByText('Plan arrancado')).toBeNull()
  })

  it('should show it cannot tell what is running, and offer a retry, when the backend cannot be reached', async () => {
    const fetching = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(activePlansAnswer().body, { status: 200 }))
    withReadyTools(fetching)
    const { user } = openHome()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se pudo comprobar el estado del plan')
    expect(screen.getByLabelText('Ticket')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Descartar estado' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByLabelText('Ticket')).toBeEnabled()
    expect(fetching).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps fresh mutations blocked while a retry is still checking, then unlocks an empty recovery', async () => {
    let answerRetry: (response: Response) => void = () => undefined
    const retry = new Promise<Response>((resolve) => { answerRetry = resolve })
    const fetching = vi.fn((input: string | URL | Request) => {
      if (input === '/external-tools') {
        return Promise.resolve(new Response('{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}]}'))
      }
      if (fetching.mock.calls.filter(([path]) => path === '/active-plans').length === 1) {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      return retry
    })
    withReadyTools(fetching)
    const { user } = openHome()

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(screen.getByLabelText('Ticket')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()

    await act(async () => answerRetry(new Response(activePlansAnswer().body, { status: 200 })))
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)

    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeEnabled()
  })

  it('should show it cannot tell what is running, and offer a retry, on a fresh inconclusive recovery', async () => {
    const inconclusiveAnswer = {
      status: 400,
      body: '{"code":"active-plans-recovery-inconclusive","detail":"cmux could not be asked"}',
    }
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response(inconclusiveAnswer.body, { status: inconclusiveAnswer.status }))
      .mockResolvedValueOnce(new Response(activePlansAnswer().body, { status: 200 }))
    withReadyTools(fetching)
    const { user } = openHome()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se puede saber qué hay en marcha')
    expect(alert).not.toHaveTextContent('No se pudo contactar con el backend')
    expect(screen.getByLabelText('Ticket')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Descartar estado' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByLabelText('Ticket')).toBeEnabled()
    expect(fetching).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
