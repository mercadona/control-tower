import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkflowSnapshot, WORKFLOW_SNAPSHOT_KEY, WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import {
  backendAnswering,
  backendRecovering,
  openHome,
  pressStart,
  startPlan,
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

const withReadyTools = <T extends (input: string | URL | Request, init?: RequestInit) => Promise<Response>>(fetching: T) => {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
    if (input === '/external-tools') return Promise.resolve(new Response(EXTERNAL_TOOLS_READY))
    return init === undefined ? fetching(input) : fetching(input, init)
  }))

  return fetching
}

const storeWorkflow = (phase: WorkflowSnapshot['phase']) => {
  const active = activePlan()
  WorkflowSnapshotStorage.save({ phase, request: active.request, plan: active.plan })
}

const startPlanning = async () => {
  const fetching = backendAnswering(StartPlanMother.started())
  const opened = openHome()
  await startPlan(opened.user)
  await screen.findByRole('status')
  await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))

  return { ...opened, fetching }
}

describe('Home · restore workflow', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('should restore ready into review without reopening its plan stream', async () => {
    const { unmount, fetching } = await startPlanning()
    await streamFrame(PlanEventsMother.ready())

    unmount()
    backendRecovering(activePlansAnswer(activePlan()))
    openHome()

    expect(await screen.findByRole('button', { name: 'Implementar plan' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Revisar plan' })).toBeInTheDocument()
    expect(screen.getByText('El plan está listo. Revísalo antes de decidir si quieres implementarlo.')).toBeInTheDocument()
    expect(FakeEventSource.opened).toHaveLength(0)
    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('should restore implementing without sending another implementation request', async () => {
    const { user, unmount } = await startPlanning()
    await streamFrame(PlanEventsMother.ready())
    const implementing = backendAnswering(ImplementPlanMother.implementing())
    await user.click(screen.getByRole('button', { name: 'Implementar plan' }))
    await screen.findByText('Agente asignado')

    unmount()
    backendRecovering(activePlansAnswer(activePlan('implementing')))
    openHome()

    expect(await screen.findByText('Agente asignado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arrancar otro plan' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(implementing).toHaveBeenCalledTimes(1)
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('keeps restored plan facts expandable during implementation without reopening SSE', async () => {
    backendRecovering(activePlansAnswer(activePlan('implementing')))
    openHome()

    await screen.findByText('Agente asignado')
    await screen.findByRole('button', { name: /Revisar plan.*Completado/ })
    expect(screen.getByText('Detalles del agente y del entorno').closest('.workflow-step__content')).toHaveAttribute('hidden')

    await userEvent.setup().click(screen.getByRole('button', { name: /Revisar plan.*Completado/ }))

    expect(screen.getByText('Detalles del agente y del entorno').closest('.workflow-step__content')).not.toHaveAttribute('hidden')
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('should treat invalid storage as empty', async () => {
    localStorage.setItem(WORKFLOW_SNAPSHOT_KEY, '{not-json')
    const fetching = backendRecovering(activePlansAnswer())

    openHome()

    expect(screen.getByLabelText('Clave del ticket')).toBeEnabled()
    await waitFor(() => expect(fetching).toHaveBeenCalledWith('/active-plans'))
  })

  it('should restore one backend plan automatically', async () => {
    const fetching = backendRecovering(activePlansAnswer(activePlan()))

    openHome()

    expect(await screen.findByRole('status')).toHaveTextContent('Plan arrancado')
    expect(screen.getByLabelText('Progreso del plan')).toHaveTextContent(StartPlanMother.REPO)
    expect(fetching).toHaveBeenCalledTimes(1)
    expect(fetching).toHaveBeenCalledWith('/active-plans')
  })

  it('should request active plans once under StrictMode', async () => {
    const fetching = backendRecovering(activePlansAnswer())

    openHome()

    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('Clave del ticket')).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('should mark restored planning as stale without opening SSE', async () => {
    storeWorkflow('planning')
    const fetching = backendRecovering(activePlansAnswer())

    openHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('El backend ya no tiene este plan activo')
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
    expect(screen.queryByText('El plan está listo. Revísalo antes de decidir si quieres implementarlo.')).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)

    unmount()
    await act(async () => resolveRecovery(new Response(activePlansAnswer(activePlan()).body)))
  })

  it.each([
    ['unavailable', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['inconclusive', () => Promise.resolve(new Response('{"code":"active-plans-recovery-inconclusive","detail":"cmux unavailable"}', { status: 503 }))],
    ['uncertain', () => Promise.resolve(new Response(activePlansAnswer(activePlan('uncertain')).body, { status: 200 }))],
  ])('does not open plan events for an unconfirmed restored workflow that is %s', async (_state, response) => {
    storeWorkflow('ready')
    withReadyTools(vi.fn(response))

    openHome()

    await screen.findByRole('alert')
    expect(screen.getByText('Estamos comprobando el estado del plan guardado.')).toBeInTheDocument()
    expect(screen.queryByText('El plan está listo. Revísalo antes de decidir si quieres implementarlo.')).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('should mark restored ready as stale without sending duplicate implementation', async () => {
    storeWorkflow('ready')
    const fetching = backendRecovering(activePlansAnswer())

    openHome()

    await screen.findByRole('alert')
    expect(screen.getByText('Estamos comprobando el estado del plan guardado.')).toBeInTheDocument()
    expect(screen.queryByText('El plan está listo. Revísalo antes de decidir si quieres implementarlo.')).toBeNull()
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
    expect(screen.queryByText('El plan está listo. Revísalo antes de decidir si quieres implementarlo.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByRole('button', { name: 'Implementar plan' })).toBeEnabled()
    expect(fetching).toHaveBeenCalledTimes(2)
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('should block implementation when the backend reports a stored plan as uncertain', async () => {
    storeWorkflow('ready')
    backendRecovering(activePlansAnswer(activePlan('uncertain')))

    openHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede confirmar el estado de implementación')
    expect(screen.getByText('Estamos comprobando el estado del plan guardado.')).toBeInTheDocument()
    expect(screen.queryByText('El plan está listo. Revísalo antes de decidir si quieres implementarlo.')).toBeNull()
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
    expect(screen.queryByRole('button', { name: 'Arrancar plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(FakeEventSource.opened).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Reintentar recuperación' }))

    expect(await screen.findByText('Plan arrancado')).toBeInTheDocument()
    expect(fetching).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
  })

  it('should discard an uncertain candidate and unlock a fresh request', async () => {
    backendRecovering(activePlansAnswer(activePlan('uncertain')))
    const { user } = openHome()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Descartar estado' }))

    expect(screen.getByLabelText('Clave del ticket')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
  })

  it.each(['planning', 'ready'] as const)('should reconcile restored %s with backend planning', async (phase) => {
    storeWorkflow(phase)
    const fetching = backendRecovering(activePlansAnswer(activePlan()))

    openHome()

    if (phase === 'ready') {
      expect(await screen.findByRole('button', { name: 'Implementar plan' })).toBeEnabled()
    } else {
      expect(await screen.findByText('Plan arrancado')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    }
    expect(screen.getByRole('button', { name: 'Descartar estado' })).toBeEnabled()
    expect(fetching).toHaveBeenCalledTimes(1)
    if (phase === 'planning') await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
    if (phase === 'ready') expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('should promote a restored planning workflow when the backend is implementing', async () => {
    storeWorkflow('planning')
    backendRecovering(activePlansAnswer(activePlan('implementing')))

    openHome()

    expect(await screen.findByText('Agente asignado')).toBeInTheDocument()
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
    expect(screen.getByLabelText('Clave del ticket')).toBeEnabled()
    expect(screen.queryByText('Implementación')).toBeInTheDocument()
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

    expect(screen.getByLabelText('Clave del ticket')).toHaveValue(StartPlanMother.TICKET)
    expect(screen.getByLabelText('Clave del ticket')).toBeEnabled()
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

    expect(screen.getByText('Agente asignado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arrancar otro plan' })).toBeEnabled()
    expect(FakeEventSource.opened).toHaveLength(0)
  })

  it('should discard recovered candidates when a new plan starts', async () => {
    const second = activePlan('implementing', StartPlanMother.ANOTHER_REPO, 9)
    let answerStart: (response: Response) => void = () => undefined
    const starting = new Promise<Response>((resolve) => { answerStart = resolve })
    const fetching = vi.fn((input: string | URL | Request) =>
      input === '/active-plans'
        ? Promise.resolve(new Response(JSON.stringify({ plans: [activePlan(), second] }), { status: 200 }))
        : String(input).startsWith('/implement-progress/')
          ? Promise.resolve(new Response('{"code":"implementation-progress-not-read","detail":"not read"}', { status: 400 }))
        : starting,
    )
    withReadyTools(fetching)
    const { user } = openHome()
    expect(await screen.findAllByRole('button', { name: /Continuar plan/ })).toHaveLength(2)

    await typeTicket(user, StartPlanMother.TICKET)
    expect(screen.queryByRole('button', { name: /Continuar plan/ })).toBeNull()
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)
    await pressStart(user)

    await act(async () => answerStart(new Response(StartPlanMother.started().body, { status: 202 })))

    expect(await screen.findByText('Plan arrancado')).toBeInTheDocument()
    expect(screen.getByLabelText('Progreso del plan')).toHaveTextContent(StartPlanMother.REPO)
    expect(screen.queryByRole('button', { name: /Continuar plan/ })).toBeNull()
    expect(fetching.mock.calls.filter(([input]) => input === '/start-plan')).toHaveLength(1)
  })

  it('should show it cannot tell what is running, and offer a retry, when the backend cannot be reached', async () => {
    const fetching = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(activePlansAnswer().body, { status: 200 }))
    withReadyTools(fetching)
    const { user } = openHome()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se pudo comprobar el estado del plan')
    expect(screen.getByLabelText('Clave del ticket')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Descartar estado' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByLabelText('Clave del ticket')).toBeEnabled()
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

    expect(screen.getByLabelText('Clave del ticket')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()

    await act(async () => answerRetry(new Response(activePlansAnswer().body, { status: 200 })))
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)

    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeEnabled()
  })

  it('should show it cannot tell what is running, and offer a retry, on a fresh 503', async () => {
    const inconclusiveAnswer = {
      status: 503,
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
    expect(screen.getByLabelText('Clave del ticket')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Descartar estado' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByLabelText('Clave del ticket')).toBeEnabled()
    expect(fetching).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
