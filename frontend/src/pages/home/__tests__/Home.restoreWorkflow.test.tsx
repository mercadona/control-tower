import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import type { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkflowSnapshot, WORKFLOW_SNAPSHOT_KEY, WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { FakeEventSource } from './FakeEventSource'
import { FakeFitAddon, FakeTerminal } from './FakeXterm'
import {
  UnscriptedWork,
  backendRecovering,
  openHome,
  openRestored,
  typePath,
  typeTicket,
} from './helpers'

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

type RecoveredPhase = 'planning' | 'implementing' | 'uncertain'

const activePlan = (phase: RecoveredPhase = 'planning', repo = StartPlanMother.REPO, issue = StartPlanMother.ISSUE.number) => ({
  phase,
  ...(phase === 'uncertain' ? {
    diagnostic: 'The recorded call needs inspection',
    recovery: { action: 'inspect', detail: 'Refresh evidence only' },
  } : {}),
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

const withReadyTools = <T extends (input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
  fetching: T,
  concluded: (input: string) => { status: number; body: string } = UnscriptedWork.answer,
) => {
  let plans: ActivePlan[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (input === '/external-tools') return Promise.resolve(new Response(EXTERNAL_TOOLS_READY))
    if (input === '/sessions') return Promise.resolve(new Response(NO_SESSIONS))
    if (input === '/coordinating-session' && init === undefined) return Promise.resolve(new Response(NO_COORDINATING_SESSION))
    if (input === '/spec-freeze') return Promise.resolve(new Response(NO_SPEC_FREEZE))
    if (input === '/epic-groom') return Promise.resolve(new Response(NO_EPIC_GROOM))
    if (String(input).startsWith('/work-progress/')) {
      const url = new URL(String(input), 'http://localhost')
      const active = plans.find((plan) => plan.plan.issue.number === Number(url.pathname.split('/')[2]) && plan.plan.repo === url.searchParams.get('repo'))
      if (active === undefined) {
        const answer = concluded(String(input))
        return new Response(answer.body, { status: answer.status })
      }
      return new Response(WorkProgressMother.fromActive(active).body)
    }
    const response = await (init === undefined ? fetching(input) : fetching(input, init))
    if (input === '/active-plans' && response.ok) plans = (await response.clone().json()).plans
    return response
  }))

  return fetching
}

const storeWorkflow = (phase: WorkflowSnapshot['phase'] | 'ready') => {
  const active = activePlan()
  localStorage.setItem(WORKFLOW_SNAPSHOT_KEY, JSON.stringify({ version: 2, workflow: { phase, request: active.request, plan: active.plan } }))
}

const startPlanning = async () => {
  const opened = openRestored({ phase: 'planning' })
  await screen.findByRole('status')
  await screen.findByText('Escribiendo el plan…')

  return opened
}

describe('Home · restore workflow', () => {
  beforeEach(() => {
    FakeTerminal.install()
    FakeFitAddon.install()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('a plan dispatched later while the brainstorming is live does not take the page over', async () => {
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
      if (String(input).startsWith('/work-progress/')) return Promise.resolve(new Response(WorkProgressMother.planning().body))
      throw new Error(`unexpected fetch to ${String(input)}`)
    })

    openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(fetching).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(2000))

    expect(fetching).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('navigation', { name: 'Pasos de la sesión' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Implementación', { selector: 'section' })).not.toBeInTheDocument()
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

  it('late discovery cannot replace the live coordinator', async () => {
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

    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => changes.answerWith(HeadlessPlanMother.planning()))

    expect(screen.getByRole('navigation', { name: 'Pasos de la sesión' })).toBeInTheDocument()
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

  it('only allows a new request after backend implementation and resets the old workflow', async () => {
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
      if (String(input).startsWith('/work-progress/')) return Promise.resolve(new Response(WorkProgressMother.planning().body))
      if (String(input).startsWith('/implement-history/')) {
        return Promise.resolve(new Response('{}', { status: 400 }))
      }
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetching)
    openHome()
    await act(async () => changes.answerWith(HeadlessPlanMother.planning()))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    const oldRead = fetching.mock.calls.find(([input]) => String(input).startsWith('/work-progress/'))
    expect(oldRead).toBeDefined()

    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => changes.answerWith(HeadlessPlanMother.implementing()))
    fireEvent.click(screen.getByRole('button', { name: 'Arrancar otro plan' }))

    expect(oldRead?.[1]?.signal?.aborted).toBe(true)
    expect(localStorage).toHaveLength(0)
    expect(screen.getByLabelText('Ticket')).toHaveValue('')
    expect(screen.getByLabelText(/Ruta local/)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Arrancar brainstorming' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Ticket'), { target: { value: StartPlanMother.TICKET } })
    fireEvent.change(screen.getByLabelText(/Ruta local/), { target: { value: StartPlanMother.PATH } })
    fireEvent.click(screen.getByRole('button', { name: 'Arrancar brainstorming' }))
    await act(async () => vi.advanceTimersByTimeAsync(0))

    const opening = fetching.mock.calls.find(([input, init]) => input === '/coordinating-session' && init !== undefined)
    expect(opening?.[1]?.body).toBe(StartPlanMother.REQUEST_BODY)
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
    const signal = fetching.progressRequests.mock.calls[0][1]?.signal

    unmount()
    expect(signal?.aborted).toBe(true)
    const restored = backendRecovering(activePlansAnswer(activePlan()))
    openHome()

    expect(await screen.findByText('Escribiendo el plan…')).toBeInTheDocument()
    expect(restored.progressRequests).toHaveBeenCalledTimes(1)
    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('restores a ready plan inside implementation and resumes tracking once confirmed', async () => {
    storeWorkflow('ready')
    const fetching = backendRecovering(activePlansAnswer(activePlan()), () => WorkProgressMother.planning('ready'))
    openHome()

    expect(await screen.findByRole('link', { name: 'Abrir el plan en GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Implementación' })).toBeInTheDocument()
    expect(screen.getByText('El plan está listo. La implementación continuará automáticamente cuando el backend la registre.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(fetching.progressRequests).toHaveBeenCalledTimes(1)
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

  it('keeps implementation current when reopening the completed request with the keyboard', async () => {
    backendRecovering(activePlansAnswer(activePlan('implementing')))
    const { user } = openHome()

    await screen.findByText('Implementación iniciada automáticamente')
    const requestSummary = screen.getByRole('button', { name: /Solicitud.*Completado/ })
    requestSummary.focus()
    await user.keyboard('{Enter}')

    expect(requestSummary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('navigation', { name: 'Flujo del plan' }).querySelector('[aria-current="step"]')).toHaveTextContent('Implementación')
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('a same-phase poll preserves expanded environment details inside implementation', async () => {
    vi.useFakeTimers()
    storeWorkflow('implementing')
    const changes = HeadlessPlanMother.deferredChanges()
    withReadyTools(changes.read)
    openHome()

    await act(async () => changes.answerWith(HeadlessPlanMother.implementing()))
    const implementation = screen.getByLabelText('Implementación', { selector: 'section' })
    const details = within(implementation).getByText('Detalles del agente y del entorno')
    expect(details.closest('details')).not.toHaveAttribute('open')

    fireEvent.click(details)
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => changes.answerWith(HeadlessPlanMother.implementing()))

    expect(details.closest('details')).toHaveAttribute('open')
    expect(within(implementation).getByText(StartPlanMother.WORKTREE)).toBeVisible()
    expect(screen.queryByText('Plan revisado')).not.toBeInTheDocument()
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('should treat invalid storage as empty', async () => {
    localStorage.setItem(WORKFLOW_SNAPSHOT_KEY, '{not-json')
    const fetching = backendRecovering(activePlansAnswer())

    openHome()

    await waitFor(() => expect(screen.getByLabelText('Ticket')).toBeEnabled())
    await waitFor(() => expect(fetching).toHaveBeenCalledWith('/active-plans'))
  })

  it('should restore one backend plan automatically', async () => {
    const fetching = backendRecovering(activePlansAnswer(activePlan()))

    openHome()

    const progress = await screen.findByLabelText('Progreso del plan')
    expect(within(progress).getByRole('status')).toHaveTextContent('Escribiendo el plan…')
    expect(screen.getByLabelText('Detalles del trabajo')).toHaveTextContent(StartPlanMother.REPO)
    expect(fetching).toHaveBeenCalledTimes(1)
    expect(fetching).toHaveBeenCalledWith('/active-plans')
  })

  it('should request active plans once under StrictMode', async () => {
    const fetching = backendRecovering(activePlansAnswer())

    openHome()

    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByLabelText('Ticket')).toBeEnabled())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('should mark restored planning as stale without opening SSE', async () => {
    storeWorkflow('planning')
    const fetching = backendRecovering(activePlansAnswer(), WorkProgressMother.fromActive, WorkProgressMother.notFound)

    openHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('El backend ya no tiene constancia de este plan')
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('uses neutral implementation copy while a restored ready plan is still checking', async () => {
    storeWorkflow('ready')
    let resolveRecovery: (response: Response) => void = () => undefined
    const recovery = new Promise<Response>((resolve) => {
      resolveRecovery = resolve
    })
    withReadyTools(vi.fn(() => recovery))
    const { unmount } = openHome()

    expect(screen.getByRole('heading', { name: 'Implementación' })).toBeInTheDocument()
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
    const fetching = backendRecovering(activePlansAnswer(), WorkProgressMother.fromActive, WorkProgressMother.notFound)

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

    expect(await screen.findByText('Escribiendo el plan…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(fetching).toHaveBeenCalledTimes(2)
    await screen.findByText('Escribiendo el plan…')
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
    expect(WorkflowSnapshotStorage.load()?.phase).toBe('planning')
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

    expect(await screen.findByText('Escribiendo el plan…')).toBeInTheDocument()
    expect(fetching).toHaveBeenCalledTimes(2)
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('uncertain recovery invokes the action without starting another plan', async () => {
    const calls: string[] = []
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      if (input === '/active-plans' && calls.filter((call) => call === 'GET /active-plans').length === 1) {
        return new Response(HeadlessPlanMother.awaitingContinuation().body)
      }
      if (input === '/recover-plan') {
        expect(init?.body).toBe(JSON.stringify({
          repo: StartPlanMother.REPO,
          issue: StartPlanMother.ISSUE.number,
          agent: StartPlanMother.AGENT,
        }))
        return new Response(JSON.stringify({ agent: StartPlanMother.AGENT }), { status: 202 })
      }
      if (input === '/active-plans') return new Response(HeadlessPlanMother.planning().body)
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    withReadyTools(fetching)
    const { user } = openHome()
    expect(await screen.findByRole('button', { name: 'Recuperar trabajo' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Recuperar trabajo' }))

    expect(await screen.findByText('Escribiendo el plan…')).toBeInTheDocument()
    expect(calls).toEqual(['GET /active-plans', 'POST /recover-plan', 'GET /active-plans'])
    expect(calls).not.toContain('POST /start-plan')
  })

  it('finishes an earlier observation before recovering and then reads fresh state', async () => {
    vi.useFakeTimers()
    let answerObservation: (response: Response) => void = () => {}
    const observation = new Promise<Response>((resolve) => { answerObservation = resolve })
    const calls: string[] = []
    let reads = 0
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      if (input === '/active-plans') {
        reads += 1
        if (reads === 1) return new Response(HeadlessPlanMother.awaitingContinuation().body)
        if (reads === 2) return observation
        return new Response(HeadlessPlanMother.planning().body)
      }
      if (input === '/recover-plan') {
        return new Response(JSON.stringify({ agent: StartPlanMother.AGENT }), { status: 202 })
      }
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    withReadyTools(fetching)
    openHome()
    await act(async () => Promise.resolve())
    const recover = screen.getByRole('button', { name: 'Recuperar trabajo' })
    await act(async () => vi.advanceTimersByTimeAsync(2000))

    fireEvent.click(recover)
    await act(async () => Promise.resolve())
    expect(calls).toEqual(['GET /active-plans', 'GET /active-plans'])

    await act(async () => {
      answerObservation(new Response(HeadlessPlanMother.awaitingContinuation().body))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByLabelText('Implementación', { selector: 'section' })).toBeInTheDocument()
    expect(calls).toEqual([
      'GET /active-plans',
      'GET /active-plans',
      'POST /recover-plan',
      'GET /active-plans',
    ])
  })

  it.each([
    ['recover', HeadlessPlanMother.awaitingContinuation(), '/recover-plan', 'Recuperar trabajo', HeadlessPlanMother.planning()],
    ['cleanup', HeadlessPlanMother.unlaunched(), '/cleanup-plan', 'Limpiar arranque fallido', HeadlessPlanMother.empty()],
  ] as const)('polling during %s cannot replace the fresh read', async (_name, initial, endpoint, action, fresh) => {
    vi.useFakeTimers()
    let answerMutation: (response: Response) => void = () => {}
    const mutation = new Promise<Response>((resolve) => { answerMutation = resolve })
    const calls: string[] = []
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      if (input === '/active-plans' && calls.filter((call) => call === 'GET /active-plans').length === 1) {
        return new Response(initial.body)
      }
      if (input === endpoint) return mutation
      if (input === '/active-plans') return new Response(fresh.body)
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    withReadyTools(fetching)
    openHome()
    await act(async () => Promise.resolve())

    fireEvent.click(screen.getByRole('button', { name: action }))
    await act(async () => Promise.resolve())
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(calls).toEqual(['GET /active-plans', `POST ${endpoint}`])

    await act(async () => {
      answerMutation(new Response(JSON.stringify({ agent: StartPlanMother.AGENT }), {
        status: endpoint === '/recover-plan' ? 202 : 200,
      }))
      await mutation
      await Promise.resolve()
    })

    expect(calls).toEqual(['GET /active-plans', `POST ${endpoint}`, 'GET /active-plans'])
  })

  it('an unavailable recovery keeps its diagnostic and performs a fresh read', async () => {
    const calls: string[] = []
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      if (input === '/active-plans') return new Response(HeadlessPlanMother.awaitingContinuation().body)
      if (input === '/recover-plan') throw new TypeError('Failed to fetch')
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    withReadyTools(fetching)
    const { user } = openHome()

    await user.click(await screen.findByRole('button', { name: 'Recuperar trabajo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo contactar con el backend para ejecutar la recuperación.',
    )
    expect(calls).toEqual(['GET /active-plans', 'POST /recover-plan', 'GET /active-plans'])
  })

  it('proven non-launch exposes checked cleanup', async () => {
    const calls: string[] = []
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      if (input === '/active-plans' && calls.filter((call) => call === 'GET /active-plans').length === 1) {
        return new Response(HeadlessPlanMother.unlaunched().body)
      }
      if (input === '/cleanup-plan') {
        return new Response(JSON.stringify({ agent: StartPlanMother.AGENT }), { status: 200 })
      }
      if (input === '/active-plans') return new Response(HeadlessPlanMother.empty().body)
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    withReadyTools(fetching)
    const { user } = openHome()

    await user.click(await screen.findByRole('button', { name: 'Limpiar arranque fallido' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El trabajo incierto ya no figura como activo')
    expect(calls).toEqual(['GET /active-plans', 'POST /cleanup-plan', 'GET /active-plans'])
    expect(calls).not.toContain('POST /start-plan')
  })

  it('late recovery cannot replace the selected workflow', async () => {
    let answerRecovery: (response: Response) => void = () => {}
    const pendingRecovery = new Promise<Response>((resolve) => { answerRecovery = resolve })
    const fetching = vi.fn(async (input: string | URL | Request) => {
      if (input === '/active-plans') return new Response(HeadlessPlanMother.awaitingObservation().body)
      if (input === '/recover-plan') return pendingRecovery
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    withReadyTools(fetching)
    const { user } = openHome()
    const recover = await screen.findByRole('button', { name: 'Recuperar trabajo' })

    await user.click(recover)
    expect(recover).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Descartar estado' }))
    answerRecovery(new Response(JSON.stringify({ agent: StartPlanMother.AGENT }), { status: 202 }))
    await act(async () => pendingRecovery)

    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.queryByText('Plan arrancado')).toBeNull()
    expect(fetching.mock.calls.filter(([input]) => input === '/active-plans')).toHaveLength(1)
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

    expect(await screen.findByText('Escribiendo el plan…')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Abrir el plan en GitHub' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Descartar estado' })).toBeEnabled()
    expect(fetching).toHaveBeenCalledTimes(1)
    expect(FakeEventSource.opened).toHaveLength(0)
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
    backendRecovering(activePlansAnswer(), WorkProgressMother.fromActive, WorkProgressMother.notFound)
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
    withReadyTools(fetching, WorkProgressMother.notFound)
    const { user } = openHome()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Descartar estado' }))

    expect(await screen.findByText('Escribiendo el plan…')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Implementación' })).toBeInTheDocument()
    expect(screen.getByLabelText('Detalles del trabajo')).toHaveTextContent(StartPlanMother.ANOTHER_REPO)
    expect(fetching).toHaveBeenCalledTimes(2)
  })

  it('opens one inventory query and one progress query for restored planning under StrictMode', async () => {
    storeWorkflow('planning')
    const fetching = backendRecovering(activePlansAnswer(activePlan()))

    openHome()

    await screen.findByText('Escribiendo el plan…')
    expect(fetching).toHaveBeenCalledTimes(1)
    expect(fetching.progressRequests).toHaveBeenCalledTimes(1)
    expect(fetching.progressRequests.mock.calls[0][1]?.signal?.aborted).toBe(false)
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

  it('should paint a panel for each of several backend plans without adopting one', async () => {
    const several = activePlansAnswer(activePlan('implementing'), activePlan('implementing', StartPlanMother.REPO, 9))
    withReadyTools(vi.fn(() => Promise.resolve(new Response(several.body, { status: several.status }))))
    openHome()

    expect(await screen.findByRole('heading', { name: 'Slice #7', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Slice #9', level: 2 })).toBeInTheDocument()
    expect(screen.queryByText('Implementación iniciada automáticamente')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Arrancar otro plan' })).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('a live coordinator blocks gate 2 from opening a second conversation', async () => {
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
    expect(screen.getByRole('button', { name: 'Cancelar la sesión' })).toBeInTheDocument()
    expect(changes.activeReadCount()).toBe(1)
    await act(async () => changes.answerWith(HeadlessPlanMother.empty()))
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(changes.activeReadCount()).toBe(2)

    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('button', { name: 'Revisar el slicing con la sesión' })).toBeDisabled()
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === '/groom-session')).toHaveLength(0)
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
