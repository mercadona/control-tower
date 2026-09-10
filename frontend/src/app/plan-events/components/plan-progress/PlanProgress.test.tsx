import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { PlanProgress } from './PlanProgress'

const plan: StartedPlan = {
  id: StartPlanMother.TICKET,
  repo: StartPlanMother.REPO,
  issue: StartPlanMother.ISSUE,
  agent: StartPlanMother.AGENT,
  branch: StartPlanMother.BRANCH,
  worktree: StartPlanMother.WORKTREE,
}

const renderProgress = async (writeToClipboard?: (text: string) => Promise<void>) => {
  const onReady = vi.fn()
  const onReviewing = vi.fn()
  render(<PlanProgress plan={plan} onReady={onReady} onReviewing={onReviewing} writeToClipboard={writeToClipboard} />)
  await screen.findByRole('status')

  return { onReady, onReviewing }
}

describe('PlanProgress', () => {
  beforeEach(() => FakeEventSource.install())
  afterEach(() => vi.unstubAllGlobals())

  it('should show a stream failure as an alert, without closing the stream', async () => {
    await renderProgress()

    act(() => FakeEventSource.last().failWith(PlanEventsMother.unreadable()))

    expect(await screen.findByRole('alert')).toHaveTextContent('git status could not say whether the plan is committed')
    expect(FakeEventSource.last().closes).toBe(0)
  })

  it('should recover once the state arrives after a stream failure', async () => {
    await renderProgress()

    act(() => FakeEventSource.last().failWith(PlanEventsMother.unreadable()))
    act(() => FakeEventSource.last().receive(PlanEventsMother.writing()))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Escribiendo el plan…')
  })

  it('should not blame the backend as unreachable when it refused the plan for good', async () => {
    await renderProgress()

    act(() => FakeEventSource.last().refuseBeforeOpen())

    expect(await screen.findByRole('alert')).toHaveTextContent('El backend no reconoce esta sesión de plan')
  })

  it('should say the backend is unreachable when the connection drops without a body', async () => {
    await renderProgress()

    act(() => FakeEventSource.last().dropConnection())

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })

  it('should call onReady once the plan reaches the ready state', async () => {
    const { onReady } = await renderProgress()

    act(() => FakeEventSource.last().receive(PlanEventsMother.ready()))

    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('should say the plan is being reworked while a review is in flight', async () => {
    await renderProgress()

    act(() => FakeEventSource.last().receive(PlanEventsMother.reviewing()))

    expect(await screen.findByRole('status')).toHaveTextContent(/Rehaciendo el plan/)
  })

  it('should tell its parent when a review starts, so the page can stop offering the go', async () => {
    const { onReviewing } = await renderProgress()

    act(() => FakeEventSource.last().receive(PlanEventsMother.reviewing()))

    expect(onReviewing).toHaveBeenCalledTimes(1)
  })

  it('should not tell its parent a review started when the plan is merely ready', async () => {
    const { onReady, onReviewing } = await renderProgress()

    act(() => FakeEventSource.last().receive(PlanEventsMother.ready()))

    expect(onReady).toHaveBeenCalled()
    expect(onReviewing).not.toHaveBeenCalled()
  })

  it('keeps a readable plan summary and reports whether copying details worked', async () => {
    const writeText = vi.fn(async () => undefined)
    const user = userEvent.setup()

    await renderProgress(writeText)

    expect(screen.getByText('Solicitud:', { exact: false })).toHaveTextContent(StartPlanMother.REPO)
    await user.click(screen.getByRole('button', { name: 'Copiar datos del plan' }))
    expect(await screen.findByText('Datos del plan copiados')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`Issue #${StartPlanMother.ISSUE.number}`))
  })

  it('reports a failed copy without losing plan details', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied') })
    const user = userEvent.setup()

    await renderProgress(writeText)
    await user.click(screen.getByRole('button', { name: 'Copiar datos del plan' }))

    expect(await screen.findByText('No se pudieron copiar los datos del plan')).toBeInTheDocument()
    expect(screen.getByText('Detalles del agente y del entorno')).toBeInTheDocument()
  })
})
