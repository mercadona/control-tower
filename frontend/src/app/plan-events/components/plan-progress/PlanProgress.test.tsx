import { act, render, screen } from '@testing-library/react'
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

const renderProgress = async () => {
  const onReady = vi.fn()
  render(<PlanProgress plan={plan} onReady={onReady} />)
  await screen.findByRole('status')

  return { onReady }
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
})
