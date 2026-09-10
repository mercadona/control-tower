import { screen } from '@testing-library/react'
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import {
  backendAnswering,
  backendPending,
  backendUnreachable,
  openHome,
  pressStart,
  startPlan,
  streamFrame,
  typePath,
  typeRepository,
  typeTicket,
} from './helpers'
import { FakeEventSource } from './FakeEventSource'

const IMPLEMENT_BUTTON = { name: 'Implementar plan' }

describe('Home · implement plan', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const planStarted = async () => {
    backendAnswering(StartPlanMother.started())
    const opened = openHome()
    await startPlan(opened.user)
    await screen.findByRole('status')

    return opened
  }

  const planReady = async () => {
    const opened = await planStarted()
    await streamFrame(PlanEventsMother.ready())

    return opened
  }

  const pressImplement = async (user: Awaited<ReturnType<typeof planReady>>['user']) => {
    await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))
  }

  it('should offer to implement the plan only once it is ready', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.writing())
    expect(screen.queryByRole('button', IMPLEMENT_BUTTON)).toBeNull()

    await streamFrame(PlanEventsMother.ready())
    expect(screen.getByRole('button', IMPLEMENT_BUTTON)).toBeEnabled()
  })

  it('keeps a ready plan in review with its issue link until implementation succeeds', async () => {
    await planStarted()
    await streamFrame(PlanEventsMother.ready())

    const current = screen.getByRole('navigation', { name: 'Flujo del plan' }).querySelector('[aria-current="step"]')
    expect(current).toHaveTextContent('Revisar plan')
    expect(screen.getByRole('link', { name: 'Abrir el plan en GitHub' })).toHaveAttribute('href', StartPlanMother.ISSUE.url)
    expect(screen.getByRole('button', IMPLEMENT_BUTTON)).toBeEnabled()
    expect(screen.queryByRole('heading', { name: 'Implementación' })).toBeNull()
  })

  it('keeps implementation current when reopening the completed review summary with the keyboard', async () => {
    const { user } = await planReady()
    backendAnswering(ImplementPlanMother.implementing())
    await pressImplement(user)
    await screen.findByText('Agente asignado')

    const reviewSummary = screen.getByRole('button', { name: /Revisar plan.*Completado/ })
    reviewSummary.focus()
    await user.keyboard('{Enter}')

    expect(reviewSummary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('navigation', { name: 'Flujo del plan' }).querySelector('[aria-current="step"]')).toHaveTextContent('Implementación')
  })

  it('should send exactly the payload the backend contract declares', async () => {
    const { user } = await planReady()
    const fetching = backendAnswering(ImplementPlanMother.implementing())

    await pressImplement(user)

    await screen.findByText('Agente asignado')
    expect(fetching).toHaveBeenCalledTimes(1)
    const [url, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/implement-plan')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.body).toBe(ImplementPlanMother.REQUEST_BODY)
  })

  it('should say the implementation started and name the agent', async () => {
    const { user } = await planReady()
    backendAnswering(ImplementPlanMother.implementing())

    await pressImplement(user)

    const started = await screen.findByText('Agente asignado')
    const status = started.closest('[role="status"]')
    expect(status).not.toBeNull()
    expect(status).toHaveTextContent(ImplementPlanMother.AGENT)
    expect(screen.queryByRole('button', IMPLEMENT_BUTTON)).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Flujo del plan' }).querySelector('[aria-current="step"]')).toHaveTextContent('Implementación')
  })

  it('should show the backend refusal text as it came and keep offering the button', async () => {
    const { user } = await planReady()
    backendAnswering(ImplementPlanMother.agentNotResumed())

    await pressImplement(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('cmux send failed: no such workspace')
    expect(screen.getByRole('button', IMPLEMENT_BUTTON)).toBeEnabled()
  })

  it('should show the backend refusal text as it came for a malformed repo', async () => {
    const { user } = await planReady()
    backendAnswering(ImplementPlanMother.malformedRepo())

    await pressImplement(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('repo must be a repository such as owner/name')
    expect(screen.getByRole('button', IMPLEMENT_BUTTON)).toBeEnabled()
  })

  it('should say the backend is unreachable when the network fails', async () => {
    const { user } = await planReady()
    backendUnreachable()

    await pressImplement(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(screen.getByRole('button', IMPLEMENT_BUTTON)).toBeEnabled()
  })

  it('should keep the button disabled while the request is in flight', async () => {
    const { user } = await planReady()
    const backend = backendPending()

    await pressImplement(user)

    expect(screen.getByRole('button', IMPLEMENT_BUTTON)).toBeDisabled()
    await backend.answerWith(ImplementPlanMother.implementing())
    expect(await screen.findByText('Agente asignado')).toBeInTheDocument()
  })

  it('should only allow another repository after implementation starts and close the old stream', async () => {
    const { user } = await planReady()
    backendAnswering(ImplementPlanMother.implementing())

    await pressImplement(user)
    await screen.findByRole('button', { name: 'Arrancar otro plan' })
    const oldStream = FakeEventSource.last()

    const fetching = backendAnswering(StartPlanMother.startedInAnotherRepo())
    await user.click(screen.getByRole('button', { name: 'Arrancar otro plan' }))
    expect(oldStream.closes).toBe(1)
    expect(localStorage).toHaveLength(0)
    expect(screen.getByLabelText('Ticket')).toHaveValue('')
    expect(screen.getByLabelText(/Repositorio/)).toHaveValue('')
    expect(screen.getByLabelText(/Ruta local/)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    expect(fetching).not.toHaveBeenCalled()

    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.ANOTHER_REPO)
    await typePath(user, StartPlanMother.PATH)
    await pressStart(user)
    await screen.findByRole('status')
    expect(FakeEventSource.last().url).toContain(encodeURIComponent(StartPlanMother.ANOTHER_REPO))
  })

  it('should not readopt the plan it just left when starting another one, even if the backend still reports it', async () => {
    const { user } = await planReady()
    backendAnswering(ImplementPlanMother.implementing())
    await pressImplement(user)
    await screen.findByRole('button', { name: 'Arrancar otro plan' })

    const stillReported = JSON.stringify({
      plans: [{
        phase: 'implementing',
        request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
        plan: {
          id: StartPlanMother.TICKET,
          repo: StartPlanMother.REPO,
          issue: StartPlanMother.ISSUE,
          agent: StartPlanMother.AGENT,
          branch: StartPlanMother.BRANCH,
          worktree: StartPlanMother.WORKTREE,
        },
      }],
    })
    const fetching = vi.fn(async (input: string | URL | Request) => {
      if (input === '/active-plans') return new Response(stillReported, { status: 200 })
      if (input === '/external-tools') return new Response('{"ready":true,"tools":[{"tool":"gh","installed":true,"session":"ready","fix":null}]}')
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetching)

    await user.click(screen.getByRole('button', { name: 'Arrancar otro plan' }))

    expect(screen.getByLabelText('Ticket')).toBeEnabled()
    expect(screen.getByLabelText('Ticket')).toHaveValue('')
    expect(screen.queryByText('Agente asignado')).toBeNull()
    expect(fetching.mock.calls.filter(([calledInput]) => calledInput === '/active-plans')).toHaveLength(0)
  })
})
